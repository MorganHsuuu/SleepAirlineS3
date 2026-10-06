"""Two reed switches (BCM17/27) and ADS1115 A0 -> local S3 browser.

Install python3-gpiozero and python3-smbus; enable I2C.
See the S3 repository's hardware/DEVICE_CONTROLS.md for wiring and setup.
"""

import argparse
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from threading import Event, Lock, Thread
import time
import uuid


SITE_ORIGIN = "https://sleep-airline-s3.vercel.app"
DIRECTIONS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


class ADS1115:
    """TI ADS1115: A0-GND, +/-4.096 V range, single shot, 128 samples/s."""

    def __init__(self, bus, address=0x48):
        self.bus = bus
        self.address = address

    def read_voltage(self):
        # MSB first; disable comparator. Configuration register: 0xC383.
        self.bus.write_i2c_block_data(self.address, 1, [0xC3, 0x83])
        deadline = time.monotonic() + 0.1
        while time.monotonic() < deadline:
            time.sleep(0.002)
            config = self.bus.read_i2c_block_data(self.address, 1, 2)
            if config[0] & 0x80:
                high, low = self.bus.read_i2c_block_data(self.address, 0, 2)
                raw = (high << 8) | low
                if raw & 0x8000:
                    raw -= 0x10000
                return raw * 4.096 / 32768
        raise OSError("ADS1115 conversion timed out")


class DirectionFilter:
    def __init__(self, minimum=0.0, maximum=3.3, reverse=False):
        self.minimum, self.maximum, self.reverse = minimum, maximum, reverse
        self.filtered = None
        self.direction = None

    def update(self, voltage):
        position = max(0.0, min(1.0, (voltage - self.minimum) / (self.maximum - self.minimum)))
        if self.reverse:
            position = 1.0 - position
        self.filtered = position if self.filtered is None else self.filtered + 0.35 * (position - self.filtered)
        candidate = min(7, int(self.filtered * 8))
        # Keep the current direction within 1.5% of a sector boundary.
        if (self.direction is None
                or self.filtered < self.direction / 8 - 0.015
                or self.filtered > (self.direction + 1) / 8 + 0.015):
            self.direction = candidate
        return self.direction


class DeviceState:
    def __init__(self):
        self.lock = Lock()
        self.data = dict(version=2, session=uuid.uuid4().hex, takeoffClosed=False,
                         landClosed=False, takeoffCount=0, landCount=0,
                         direction=None, voltage=None, adcError="Starting ADS1115")

    def reed(self, name, closed, initial=False):
        with self.lock:
            old = self.data[name + "Closed"]
            self.data[name + "Closed"] = closed
            if closed and not old and not initial:
                self.data[name + "Count"] += 1
                print(f"{name.upper()} magnet detected", flush=True)

    def adc(self, direction, voltage, error=None):
        with self.lock:
            if error != self.data["adcError"]:
                print(f"ADC: {error or 'connected'}", flush=True)
            if direction is not None and direction != self.data["direction"]:
                print(f"Direction: {DIRECTIONS[direction]} ({voltage:.3f} V)", flush=True)
            self.data.update(direction=direction, voltage=voltage, adcError=error)

    def snapshot(self):
        with self.lock:
            return dict(self.data)


def sample_adc(state, stop, args):
    from smbus import SMBus

    while not stop.is_set():
        try:
            bus = SMBus(args.i2c_bus)
            try:
                adc = ADS1115(bus, args.address)
                smoothing = DirectionFilter(args.min_voltage, args.max_voltage, args.reverse)
                while not stop.is_set():
                    voltage = adc.read_voltage()
                    state.adc(smoothing.update(voltage), round(voltage, 4))
                    stop.wait(0.04)
            finally:
                bus.close()
        except OSError as error:
            state.adc(None, None, str(error))
            stop.wait(1)


def make_handler(state, origin):
    class Handler(BaseHTTPRequestHandler):
        def end_headers(self):
            if self.headers.get("Origin") == origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Vary", "Origin, Access-Control-Request-Private-Network")
            super().end_headers()

        def allowed(self):
            if self.headers.get("Origin") not in (None, origin):
                self.send_error(403)
                return False
            if self.path != "/state":
                self.send_error(404)
                return False
            return True

        def do_OPTIONS(self):
            if self.allowed():
                self.send_response(204)
                self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return
            body = json.dumps(state.snapshot(), allow_nan=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--takeoff-pin", type=int, default=17, help="BCM numbering")
    parser.add_argument("--land-pin", type=int, default=27, help="BCM numbering")
    parser.add_argument("--i2c-bus", type=int, default=1)
    parser.add_argument("--address", type=lambda value: int(value, 0), default=0x48)
    parser.add_argument("--min-voltage", type=float, default=0.0)
    parser.add_argument("--max-voltage", type=float, default=3.3)
    parser.add_argument("--reverse", action="store_true", help="Reverse knob direction")
    parser.add_argument("--origin", default=SITE_ORIGIN, help="One allowed website origin, no trailing slash")
    args = parser.parse_args()
    if (not all(math.isfinite(v) for v in (args.min_voltage, args.max_voltage))
            or not 0 <= args.min_voltage < args.max_voltage <= 3.3):
        parser.error("Voltage calibration must satisfy 0 <= min < max <= 3.3")
    if args.takeoff_pin == args.land_pin:
        parser.error("Use separate GPIO pins for the two reed switches")
    try:
        from gpiozero import Button
        import smbus  # Check dependency before starting threads.
    except ImportError:
        parser.exit(1, "Install dependencies: sudo apt install python3-gpiozero python3-smbus\n")

    state, stop = DeviceState(), Event()
    try:
        with ExitStack() as resources:
            for name, pin in (("takeoff", args.takeoff_pin), ("land", args.land_pin)):
                reed = resources.enter_context(Button(pin, pull_up=True, bounce_time=0.05))
                state.reed(name, reed.is_pressed, initial=True)
                reed.when_pressed = lambda name=name: state.reed(name, True)
                reed.when_released = lambda name=name: state.reed(name, False)
            server = ThreadingHTTPServer(("127.0.0.1", 8765), make_handler(state, args.origin))
            resources.callback(server.server_close)
            worker = Thread(target=sample_adc, args=(state, stop, args), daemon=True)
            worker.start()
            print("Device bridge: http://127.0.0.1:8765/state", flush=True)
            print(f"Open {args.origin}/?device=1 on this Pi. Ctrl+C stops the bridge.", flush=True)
            try:
                server.serve_forever()
            finally:
                stop.set()
                worker.join(timeout=2)
    except KeyboardInterrupt:
        pass
    except OSError as error:
        parser.exit(1, f"Cannot start bridge: {error}. Stop reed_bridge.py if port 8765 is in use.\n")


if __name__ == "__main__":
    main()
