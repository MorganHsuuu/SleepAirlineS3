"""NetworkManager profiles; credentials stay on the device, never in device.json."""
import ipaddress
import re
import subprocess
import uuid


def is_fallback(ssid, configured="T2-308教室"):
    normalize = lambda text: re.sub(r"[\s_-]", "", text).casefold()
    return normalize(ssid) in {normalize(configured), "t2308", "t2308教室"}


def validate_networks(networks):
    if not isinstance(networks, list) or not 1 <= len(networks) <= 10:
        raise ValueError("請輸入 1 至 10 組 Wi-Fi")
    seen = set()
    for network in networks:
        if not isinstance(network, dict):
            raise ValueError("Wi-Fi 資料不完整")
        ssid, password = network.get("ssid"), network.get("password", "")
        if not isinstance(ssid, str) or not 1 <= len(ssid.encode()) <= 32 or any(c in ssid for c in "\0\n\r") or ssid in seen:
            raise ValueError("Wi-Fi 名稱不可空白、重複或超過 32 bytes")
        if not isinstance(password, str) or any(c in password for c in "\0\n\r") or (password and not (
                8 <= len(password.encode()) <= 63 or re.fullmatch(r"[0-9a-fA-F]{64}", password))):
            raise ValueError("Wi-Fi 密碼需為 8 至 63 bytes；開放網路可留白")
        seen.add(ssid)
    return networks


class WifiNetworks:
    def __init__(self, interface="wlan0", fallback_ssid="T2-308教室", dry_run=False):
        self.interface, self.fallback_ssid, self.dry_run = interface, fallback_ssid, dry_run
        self.simulated = []

    def run(self, *args, timeout=12):
        try:
            result = subprocess.run(["nmcli", "--escape", "no", *args], capture_output=True, text=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            # Never include the command: it may contain a password.
            raise RuntimeError("Wi-Fi 設定指令無回應，請稍後重試") from None
        if result.returncode:
            raise RuntimeError("Wi-Fi 設定失敗，請檢查網路名稱、密碼與裝置權限")
        return result.stdout.rstrip("\n")

    def current(self):
        if self.dry_run:
            return {"ssid": "T2-308教室", "address": "192.168.1.20", "uuid": "dry-current"}
        try:
            connection = self.run("-g", "GENERAL.CON-UUID", "device", "show", self.interface)
            if not connection or connection == "--":
                return None
            mode = self.run("-g", "802-11-wireless.mode", "connection", "show", "uuid", connection)
            if mode == "ap":
                return None
            ssid = self.run("-g", "802-11-wireless.ssid", "connection", "show", "uuid", connection)
            addresses = self.run("-g", "IP4.ADDRESS", "device", "show", self.interface)
            for raw in addresses.splitlines():
                try:
                    address = ipaddress.ip_interface(raw.replace("\\:", ":")).ip
                    if address.version == 4 and address.is_private and not address.is_loopback and not address.is_link_local:
                        return {"ssid": ssid, "address": str(address), "uuid": connection}
                except ValueError:
                    continue
        except RuntimeError:
            pass
        return None

    def profiles(self):
        if self.dry_run:
            return list(self.simulated)
        profiles = []
        for connection in self.run("-g", "UUID", "connection", "show").splitlines():
            if not re.fullmatch(r"[a-fA-F0-9-]{36}", connection):
                continue
            kind = self.run("-g", "connection.type", "connection", "show", "uuid", connection)
            if kind != "802-11-wireless":
                continue
            mode = self.run("-g", "802-11-wireless.mode", "connection", "show", "uuid", connection)
            if mode == "ap":
                continue
            interface = self.run("-g", "connection.interface-name", "connection", "show", "uuid", connection)
            if interface not in ("", "--", self.interface):
                continue
            ssid = self.run("-g", "802-11-wireless.ssid", "connection", "show", "uuid", connection)
            priority = self.run("-g", "connection.autoconnect-priority", "connection", "show", "uuid", connection)
            profiles.append({"uuid": connection, "ssid": ssid, "priority": int(priority or 0)})
        return profiles

    def save(self, networks):
        validate_networks(networks)
        if self.dry_run:
            for network in networks:
                self.simulated = [n for n in self.simulated if n["ssid"] != network["ssid"]]
                self.simulated.append({"ssid": network["ssid"], "uuid": str(uuid.uuid4()), "priority": 100})
            return
        existing = {n["uuid"] for n in self.profiles()}
        for index, network in enumerate(networks):
            ssid, password = network["ssid"], network.get("password", "")
            connection = str(uuid.uuid5(uuid.NAMESPACE_URL, "sleep-airline:wifi:" + ssid))
            new = connection not in existing
            try:
                if new:
                    self.run("connection", "add", "type", "wifi", "ifname", self.interface,
                             "con-name", "SleepAirline saved " + ssid, "connection.uuid", connection,
                             "ssid", ssid, "connection.autoconnect", "no")
                security = ["802-11-wireless-security.key-mgmt", "wpa-psk", "802-11-wireless-security.psk", password] if password else []
                if not password and not new:
                    key_mgmt = self.run("-g", "802-11-wireless-security.key-mgmt", "connection", "show", "uuid", connection)
                    if key_mgmt:
                        self.run("connection", "modify", "uuid", connection, "remove", "802-11-wireless-security")
                priority = -999 if is_fallback(ssid, self.fallback_ssid) else 100 - index
                self.run("connection", "modify", "uuid", connection, *security,
                         "connection.autoconnect", "yes", "connection.autoconnect-priority", str(priority),
                         "connection.autoconnect-retries", "1")
            except RuntimeError:
                if new:
                    try:
                        self.run("connection", "delete", "uuid", connection)
                    except RuntimeError:
                        pass
                raise RuntimeError(f"第 {index + 1} 組 Wi-Fi 儲存失敗；前面已儲存的網路仍保留，請修正後重送") from None

    def connect_saved(self):
        if self.dry_run:
            return self.current()
        profiles = self.profiles()
        # Also demote old class profiles created before this feature.
        for profile in profiles:
            if is_fallback(profile["ssid"], self.fallback_ssid):
                self.run("connection", "modify", "uuid", profile["uuid"],
                         "connection.autoconnect-priority", "-999", "connection.autoconnect", "yes")
        profiles.sort(key=lambda p: (is_fallback(p["ssid"], self.fallback_ssid), -p["priority"]))
        current = self.current()
        # Keep an unmanaged active connection as an option too.
        if current and current["uuid"] not in {p["uuid"] for p in profiles}:
            profiles.insert(0, {**current, "priority": 0})
            profiles.sort(key=lambda p: (is_fallback(p["ssid"], self.fallback_ssid), -p["priority"]))
        for profile in profiles:
            active = self.current()
            if active and active["uuid"] == profile["uuid"]:
                return active
            try:
                self.run("--wait", "12", "connection", "up", "uuid", profile["uuid"], "ifname", self.interface, timeout=16)
                active = self.current()
                if active and active["uuid"] == profile["uuid"]:
                    return active
            except RuntimeError:
                continue
        return None
