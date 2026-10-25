"""BlueZ peripheral. Runs in a background thread; the kiosk HTTP UI stays usable
when the radio is unavailable. Requires python3-dbus-next and cryptography.
"""
import asyncio
import json
import threading
import time

from dbus_next import BusType, PropertyAccess, Variant, DBusError, Message, MessageType
from dbus_next.aio import MessageBus
from dbus_next.service import ServiceInterface, method, dbus_property

from ble_protocol import SERVICE_UUID, INFO_UUID, WRITE_UUID, NOTIFY_UUID, Session, frames, seal

ROOT = "/com/sleepairline/setup"
SERVICE = ROOT + "/service0"


class Service(ServiceInterface):
    def __init__(self):
        super().__init__("org.bluez.GattService1")

    @dbus_property(access=PropertyAccess.READ)
    def UUID(self) -> 's': return SERVICE_UUID

    @dbus_property(access=PropertyAccess.READ)
    def Primary(self) -> 'b': return True

    @dbus_property(access=PropertyAccess.READ)
    def Includes(self) -> 'ao': return []


class Characteristic(ServiceInterface):
    def __init__(self, controller, kind, uuid, flags):
        super().__init__("org.bluez.GattCharacteristic1")
        self.controller, self.kind, self.uuid, self.flags = controller, kind, uuid, flags
        self.value = b""
        self.notifying = False

    @dbus_property(access=PropertyAccess.READ)
    def UUID(self) -> 's': return self.uuid

    @dbus_property(access=PropertyAccess.READ)
    def Service(self) -> 'o': return SERVICE

    @dbus_property(access=PropertyAccess.READ)
    def Flags(self) -> 'as': return self.flags

    @dbus_property(access=PropertyAccess.READ)
    def Value(self) -> 'ay': return self.value

    @dbus_property(access=PropertyAccess.READ)
    def Notifying(self) -> 'b': return self.notifying

    @method()
    def ReadValue(self, options: 'a{sv}') -> 'ay':
        if self.kind != "info": raise DBusError("org.bluez.Error.NotPermitted", "write_only")
        device = options.get("device")
        if not device: raise DBusError("org.bluez.Error.NotAuthorized", "device_required")
        session = self.controller.session(device.value)
        return session.info()[options.get("offset", Variant('q', 0)).value:]

    @method()
    def WriteValue(self, value: 'ay', options: 'a{sv}'):
        if self.kind != "write": raise DBusError("org.bluez.Error.NotPermitted", "read_only")
        device = options.get("device")
        if not device: raise DBusError("org.bluez.Error.NotAuthorized", "device_required")
        try:
            session = self.controller.sessions.get(device.value)
            if not session: raise ValueError("read_info_first")
            message = session.assembler.feed(value)
            if message is not None:
                request = session.request(message)
                # Admit only one outstanding request per central, bounding work/memory.
                if device.value in self.controller.pending: raise ValueError("request_in_progress")
                self.controller.pending.add(device.value)
                asyncio.create_task(self.controller.handle(device.value, session, request))
        except Exception:
            raise DBusError("org.bluez.Error.NotAuthorized", "invalid_or_expired_request")

    @method()
    def StartNotify(self):
        if self.kind != "notify": raise DBusError("org.bluez.Error.NotSupported", "not_notify")
        self.notifying = True
        self.emit_properties_changed({"Notifying": True})

    @method()
    def StopNotify(self):
        self.notifying = False
        self.emit_properties_changed({"Notifying": False})


class Advertisement(ServiceInterface):
    def __init__(self, device_id):
        super().__init__("org.bluez.LEAdvertisement1")
        self.local_name = "SA" + device_id[-6:]

    @dbus_property(access=PropertyAccess.READ)
    def Type(self) -> 's': return "peripheral"

    @dbus_property(access=PropertyAccess.READ)
    def ServiceUUIDs(self) -> 'as': return [SERVICE_UUID]

    @dbus_property(access=PropertyAccess.READ)
    def LocalName(self) -> 's': return self.local_name

    @method()
    def Release(self): pass


class BleServer:
    def __init__(self, kiosk):
        self.kiosk = kiosk
        self.sessions = {}
        self.pending = set()
        self.owner = None
        self.owner_seen = 0
        self.tx = Characteristic(self, "notify", NOTIFY_UUID, ["notify"])
        self.send_lock = None

    def start(self):
        threading.Thread(target=self.run, name="ble-provisioning", daemon=True).start()

    def run(self):
        while True:
            try:
                asyncio.run(self.serve())
            except Exception as error:
                self.kiosk.ble_ready = False
                # Never include request bodies or keys in logs/UI.
                self.kiosk.ble_error = "裝置藍牙暫時無法啟動，正在重試。可展開下方的其他連線方式。"
                print(f"BLE service retry: {type(error).__name__}", flush=True)
                time.sleep(5)

    def session(self, device):
        if device in self.sessions: return self.sessions[device]
        material = self.kiosk.ble_material()
        if not material or len(self.sessions) >= 4:
            raise DBusError("org.bluez.Error.NotAuthorized", "setup_unavailable")
        state = self.kiosk.state
        session = Session(state["deviceId"], *material)
        self.sessions[device] = session
        return session

    async def handle(self, device, session, request):
        try:
            op, args = request["op"], request.get("args", {})
            receipt = self.kiosk.ble_receipt
            completed = bool(receipt and receipt[0] == session.setup_code and receipt[1] > time.time())
            if time.time() >= session.expires and not completed:
                raise ValueError("setup_expired")
            if op not in ("hello", "status") and (not self.kiosk.accepting_ble() or session.setup_code != self.kiosk.state.get("setupCode")):
                raise ValueError("setup_expired")
            if self.owner and self.owner != device and (self.kiosk.busy or time.monotonic() - self.owner_seen < 30):
                raise ValueError("device_busy")
            self.owner, self.owner_seen = device, time.monotonic()
            if op in ("hello", "status"):
                result = self.kiosk.ble_status()
            elif op == "networks":
                if self.kiosk.busy: raise ValueError("device_busy")
                result = {"networks": await asyncio.to_thread(self.kiosk.wifi_networks)}
            else:
                if not self.kiosk.valid_provision(args): raise ValueError("invalid_wifi")
                if not self.kiosk.provision(args["ssid"], args["password"], args["grant"], session.setup_code):
                    raise ValueError("device_busy_or_expired")
                result = self.kiosk.ble_status()
            response = {"id": request["id"], "ok": True, "result": result}
        except ValueError as error:
            response = {"id": request["id"], "ok": False, "error": str(error)}
        except Exception:
            response = {"id": request["id"], "ok": False, "error": "device_unavailable"}
        try:
            async with self.send_lock:
                for packet in frames(seal(session.write_key, response)):
                    if not self.tx.notifying: break
                    self.tx.value = packet
                    self.tx.emit_properties_changed({"Value": packet})
                    await asyncio.sleep(0.015)
        finally:
            self.pending.discard(device)

    async def serve(self):
        self.sessions.clear()
        self.pending.clear()
        self.owner = None
        self.tx = Characteristic(self, "notify", NOTIFY_UUID, ["notify"])
        self.send_lock = asyncio.Lock()
        bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        try:
            introspection = await bus.introspect("org.bluez", "/")
            objects = await bus.get_proxy_object("org.bluez", "/", introspection).get_interface("org.freedesktop.DBus.ObjectManager").call_get_managed_objects()
            adapter = next((path for path, interfaces in objects.items() if "org.bluez.GattManager1" in interfaces and "org.bluez.LEAdvertisingManager1" in interfaces), None)
            if not adapter: raise RuntimeError("no_ble_adapter")
            adapter_proxy = bus.get_proxy_object("org.bluez", adapter, await bus.introspect("org.bluez", adapter))
            await adapter_proxy.get_interface("org.freedesktop.DBus.Properties").call_set("org.bluez.Adapter1", "Powered", Variant('b', True))
            manager = adapter_proxy.get_interface("org.bluez.GattManager1")
            advertiser = adapter_proxy.get_interface("org.bluez.LEAdvertisingManager1")
            bus.export(SERVICE, Service())
            bus.export(SERVICE + "/info", Characteristic(self, "info", INFO_UUID, ["read"]))
            bus.export(SERVICE + "/write", Characteristic(self, "write", WRITE_UUID, ["write"]))
            bus.export(SERVICE + "/notify", self.tx)
            bus.export(ROOT + "/advertisement", Advertisement(self.kiosk.state["deviceId"]))
            # dbus-next supplies ObjectManager/GetManagedObjects for exported children.
            await manager.call_register_application(ROOT, {})
            def disconnected(message):
                if message.message_type == MessageType.SIGNAL and message.interface == "org.freedesktop.DBus.Properties" and message.member == "PropertiesChanged":
                    if message.body[0] == "org.bluez.Device1" and "Connected" in message.body[1] and not message.body[1]["Connected"].value:
                        self.sessions.pop(message.path, None)
                        if self.owner == message.path: self.owner = None
            bus.add_message_handler(disconnected)
            await bus.call(Message(destination="org.freedesktop.DBus", path="/org/freedesktop/DBus", interface="org.freedesktop.DBus", member="AddMatch", signature="s", body=["type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'"]))
            bluez_alive = True
            def bluez_owner(message):
                nonlocal bluez_alive
                if message.message_type == MessageType.SIGNAL and message.interface == "org.freedesktop.DBus" and message.member == "NameOwnerChanged" and message.body[0] == "org.bluez":
                    bluez_alive = False
            bus.add_message_handler(bluez_owner)
            await bus.call(Message(destination="org.freedesktop.DBus", path="/org/freedesktop/DBus", interface="org.freedesktop.DBus", member="AddMatch", signature="s", body=["type='signal',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.bluez'"]))
            advertised = False
            while bus.connected and bluez_alive:
                desired = self.kiosk.ble_material() is not None
                if desired and not advertised:
                    await advertiser.call_register_advertisement(ROOT + "/advertisement", {})
                    advertised = True
                elif not desired and advertised:
                    await advertiser.call_unregister_advertisement(ROOT + "/advertisement")
                    advertised = False
                self.kiosk.ble_ready, self.kiosk.ble_error = True, ""
                for device, session in list(self.sessions.items()):
                    if time.time() >= session.expires: self.sessions.pop(device, None)
                await asyncio.sleep(1)
            raise RuntimeError("bluez_disconnected")
        finally:
            self.kiosk.ble_ready = False
            bus.disconnect()
