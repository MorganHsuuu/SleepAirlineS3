"""Sleep Airline Pi launcher: local setup, Wi-Fi provisioning and device bridge.

Run from the Pi desktop session with `python3 device_kiosk.py`. The local setup
page remains available without an Internet connection. No home Wi-Fi password is
sent to the cloud or written to this application's state file.
"""

import argparse
import html
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
from threading import Lock, Thread
import time
import urllib.error
import urllib.request
from urllib.parse import quote


HOME = Path.home()
STATE_FILE = Path(os.environ.get("SLEEP_AIRLINE_STATE_FILE", str(HOME / ".config/sleep-airline/device.json")))
APP_URL = "https://night-departures.vercel.app/"
WINDOW_ORIGIN = "https://sleep-airline-s3.vercel.app"
WINDOW_URL = WINDOW_ORIGIN + "/?kiosk=1"
API_URL = "https://sleep-airline-s3.vercel.app/api/pairing"
HOTSPOT_IP = "10.42.0.1"
HOTSPOT_NAME = "SleepAirline-Setup"


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(state, stream)
    os.replace(temporary, STATE_FILE)


def load_state():
    try:
        state = json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        state = {}
    if not state.get("deviceId") or not state.get("deviceSecret"):
        state = {
            "deviceId": "SA-" + secrets.token_hex(6).upper(),
            "deviceSecret": secrets.token_urlsafe(32),
            "passengerId": None,
        }
        save_state(state)
    return state


def cloud_post(path, payload, timeout=12):
    request = urllib.request.Request(
        API_URL + path,
        json.dumps(payload).encode(),
        {"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def html_page(title, content, script=""):
    return f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Cache-Control" content="no-store"><title>{title} · SLEEP AIRLINE</title>
<style>:root{{font-family:system-ui,sans-serif;color:#f4f1e9;background:#000}}
*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px}}
main{{width:min(100%,560px)}}.brand{{font-size:12px;letter-spacing:.28em;line-height:1.5;color:#b7ced0}}
.eyebrow{{font-size:11px;letter-spacing:.18em;color:#a8c1c4;margin-top:42px}}h1{{font-size:clamp(34px,7vw,60px);font-weight:400;line-height:1.12;letter-spacing:.05em;margin:14px 0 18px}}
p{{line-height:1.7;color:#cedcdb}}.qr{{background:white;border-radius:16px;padding:15px;width:min(80vw,260px);margin:28px 0}}
.qr img{{display:block;width:100%}}.card{{border-top:1px solid #496067;padding:18px 0;display:flex;justify-content:space-between;gap:12px}}
.card span{{color:#a8c1c4}}.card strong{{font-weight:500;overflow-wrap:anywhere;text-align:right}}
label{{display:block;margin:20px 0;color:#cedcdb}}input,select{{width:100%;min-height:50px;margin-top:8px;padding:12px;background:#f4f1e9;border:0;border-radius:4px;color:#102c32;font:inherit}}
button{{width:100%;min-height:56px;margin-top:20px;border:0;background:#e1bc75;color:#102c32;font:inherit;font-weight:600}}
small{{color:#9fb6b8}}a{{color:#e1bc75}}.error{{color:#ffbdad}}</style></head><body><main>
<div class="brand">SLEEP<br>AIRLINE</div>{content}</main><script>{script}</script></body></html>"""


class Kiosk:
    def __init__(self, args):
        self.args = args
        self.lock = Lock()
        self.state = load_state()
        self.status = "starting"
        self.online = False
        self.message = ""
        self.browser = None
        self.bridge = None
        self.busy = False
        self.reconfiguring = bool(args.reconfigure_wifi)
        self.transport = getattr(args, "pairing_transport", "ble")
        self.ble_ready = False
        self.ble_error = ""
        self.error_code = ""
        self.ble_receipt = None
        self.confirmed_ssid = None
        self.confirmed_uuid = None
        self.mode_lock = Lock()

    def persist(self):
        save_state(self.state)

    def ensure_setup_code(self):
        with self.lock:
            if not self.busy and (time.time() >= self.state.get("setupExpires", 0) or not self.state.get("setupCode")):
                self.state["setupCode"] = secrets.token_urlsafe(32)
                self.state["setupExpires"] = int(time.time()) + 15 * 60
                self.state["setupRevision"] = self.state.get("setupRevision", 0) + 1
                self.persist()

    def accepting_ble(self):
        return self.transport == "ble" and (not self.state.get("passengerId") or self.reconfiguring)

    def ble_material(self):
        if self.accepting_ble():
            self.ensure_setup_code()
            return self.state["setupCode"], self.state["setupExpires"]
        if self.ble_receipt and self.ble_receipt[1] > time.time():
            return self.ble_receipt
        return None

    def start_setup(self):
        if self.transport == "wifi":
            self.start_hotspot()
            return
        self.ensure_setup_code()
        self.error_code = ""
        self.message = ""
        self.status = "ready"
        # Disable the previous explicitly-started AP; leave other Wi-Fi connected.
        if not self.args.dry_run:
            try:
                subprocess.run(["nmcli", "connection", "down", HOTSPOT_NAME], capture_output=True, timeout=15, check=False)
            except (OSError, subprocess.TimeoutExpired):
                self.message = "舊熱點尚未停止，藍牙設定仍可繼續。"

    def ble_status(self):
        return {"deviceId": self.state["deviceId"], "status": self.status, "message": self.message,
                "error": self.error_code, "busy": self.busy, "online": self.online,
                "paired": bool(self.state.get("passengerId")) and not self.reconfiguring}

    @staticmethod
    def valid_provision(data):
        return (isinstance(data, dict) and isinstance(data.get("ssid"), str) and 0 < len(data["ssid"].encode()) <= 32
                and "\0" not in data["ssid"] and isinstance(data.get("password"), str) and len(data["password"]) <= 128
                and "\0" not in data["password"] and isinstance(data.get("grant"), str) and 0 < len(data["grant"]) <= 2048)

    def wifi_networks(self):
        if self.args.dry_run:
            return []
        result = subprocess.run(["nmcli", "-t", "-f", "SSID,SECURITY,SIGNAL", "device", "wifi", "list",
                                 "ifname", self.args.interface, "--rescan", "yes"], capture_output=True, text=True, timeout=25)
        if result.returncode:
            raise ValueError("wifi_scan_failed")
        networks = {}
        for line in result.stdout.splitlines():
            parts, part, escaped = [], "", False
            for char in line:
                if escaped: part, escaped = part + char, False
                elif char == "\\": escaped = True
                elif char == ":": parts.append(part); part = ""
                else: part += char
            parts.append(part)
            if len(parts) != 3 or not parts[0]: continue
            ssid, security, signal = parts
            strength = int(signal) if signal.isdigit() else 0
            if ssid not in networks or networks[ssid]["signal"] < strength:
                networks[ssid] = {"ssid": ssid, "secure": security not in ("", "--"),
                                  "enterprise": "802.1X" in security, "signal": strength}
        return sorted(networks.values(), key=lambda item: -item["signal"])[:12]

    def start_hotspot(self):
        self.transport = "wifi"
        with self.lock:
            if (time.time() >= self.state.get("setupExpires", 0) or
                    not all(self.state.get(key) for key in ("setupCode", "hotspotPassword", "hotspotSsid"))):
                self.state["setupCode"] = secrets.token_urlsafe(32)
                self.state["hotspotPassword"] = secrets.token_urlsafe(12)[:16]
                self.state["hotspotSsid"] = f"SleepAirline-{self.state['deviceId'][-6:]}"
                self.state["setupExpires"] = int(time.time()) + 15 * 60
                self.state["setupRevision"] = self.state.get("setupRevision", 0) + 1
                self.persist()
            self.status = "setting_up_hotspot"
        if self.args.dry_run:
            self.status = "ready"
            return
        subprocess.run(["nmcli", "connection", "delete", HOTSPOT_NAME], capture_output=True, check=False)
        result = subprocess.run([
            "nmcli", "device", "wifi", "hotspot", "ifname", self.args.interface,
            "con-name", HOTSPOT_NAME, "ssid", self.state["hotspotSsid"],
            "password", self.state["hotspotPassword"],
        ], capture_output=True, text=True, timeout=30)
        if result.returncode:
            self.status = "error"
            print(f"無法建立裝置熱點：{result.stderr.strip() or result.stdout.strip() or f'nmcli exit {result.returncode}'}", file=sys.stderr)
            self.message = "無法建立裝置熱點。請檢查 Wi-Fi 與配對服務權限。"
            return
        # The setup AP is activated explicitly; it must not win at the next boot.
        configured = subprocess.run(["nmcli", "connection", "modify", HOTSPOT_NAME,
                                     "connection.autoconnect", "no", "ipv4.addresses", f"{HOTSPOT_IP}/24",
                                     "ipv4.method", "shared"], capture_output=True, text=True)
        activated = subprocess.run(["nmcli", "connection", "up", HOTSPOT_NAME],
                                   capture_output=True, text=True) if not configured.returncode else configured
        if activated.returncode:
            self.status = "error"
            self.message = "裝置熱點設定失敗。請檢查 NetworkManager 權限。"
            print(f"裝置熱點啟用失敗：{activated.stderr.strip()}", file=sys.stderr)
            return
        self.status = "ready"

    def current_qr(self):
        if self.transport == "ble":
            self.ensure_setup_code()
        elif time.time() >= self.state.get("setupExpires", 0) and not self.busy:
            self.start_hotspot()
        import qrcode
        data = {"v": 1, "transport": "ble", "deviceId": self.state["deviceId"], "setupCode": self.state["setupCode"]} if self.transport == "ble" else {
            "deviceId": self.state["deviceId"],
            "setupCode": self.state["setupCode"],
            "ssid": self.state["hotspotSsid"],
            "password": self.state["hotspotPassword"],
        }
        payload = json.dumps(data, separators=(",", ":")).encode()
        # Fragment is never sent to the Vercel server as part of the URL request.
        url = APP_URL + ("get-app" if self.transport == "ble" else "") + "#pair=" + base64.urlsafe_b64encode(payload).decode().rstrip("=")
        image = qrcode.make(url)
        output = BytesIO()
        image.save(output, format="PNG")
        return base64.b64encode(output.getvalue()).decode()

    def device_page(self):
        if self.state.get("passengerId") and not self.reconfiguring:
            target = WINDOW_URL if self.online else "http://127.0.0.1:8766/offline"
            content = '<p class="eyebrow">CONNECTED DEVICE</p><h1>準備起飛</h1><p>正在開啟飛機窗主畫面…</p>'
            return html_page("裝置已連線", content, f"location.replace({json.dumps(target)});")
        try:
            qr = self.current_qr()
            image = f'<div class="qr"><img src="data:image/png;base64,{qr}" alt="配對 QR Code"></div>'
        except ImportError:
            image = '<p class="error">缺少 QR 程式庫，請安裝 python3-qrcode。</p>'
        if self.transport == "ble":
            from device_onboarding import ble_page
            return ble_page(self.state["deviceId"], qr if 'qr' in locals() else '', self.state.get("setupRevision", 0), self.args.dry_run)
        content = f'''<p class="eyebrow">FIRST CONNECTION · 首次連線</p><h1>請用手機掃描<br>裝置配對碼</h1>
<p>先在手機連網時掃描。APP 會引導你暫時加入下方的裝置 Wi-Fi，再於手機輸入家中的 Wi-Fi 密碼。</p>{image}
<div class="card"><span>裝置代碼</span><strong>{self.state['deviceId']}</strong></div>
<div class="card"><span>暫時 Wi-Fi</span><strong>{self.state.get('hotspotSsid', '—')}</strong></div>
<div class="card"><span>暫時密碼</span><strong>{self.state.get('hotspotPassword', '—')}</strong></div>
<p id="progress">{html.escape(self.message)}</p><button onclick="fetch('/api/setup-mode',{{method:'POST',headers:{{'Content-Type':'application/json','X-SleepAirline-Control':'1'}},body:JSON.stringify({{mode:'ble'}})}}).then(r=>{{if(r.ok)location.reload()}})">返回藍牙設定</button>'''
        revision = self.state.get("setupRevision", 0)
        script = f"""const setupRevision={revision};setInterval(async()=>{{try{{const s=await (await fetch('/api/status')).json();
if(s.paired)location.replace('""" + WINDOW_URL + """');
else if(s.setupRevision!==setupRevision||s.setupCodeChanged)location.reload();
document.getElementById('progress').textContent=s.message||'';}catch{}},3000);"""
        return html_page("首次連線", content, script)

    def setup_page(self):
        content = '''<p class="eyebrow">DEVICE WI-FI · 裝置配網</p><h1>連接家中的<br>Wi-Fi</h1>
<p>這個頁面由樹莓派在本機提供。你輸入的家中 Wi-Fi 密碼只會送到裝置，不會傳到 Vercel。</p>
<form id="form"><label>Wi-Fi 名稱 / SSID<input id="ssid" required autocomplete="off" placeholder="輸入家中 Wi-Fi 名稱"></label>
<label>Wi-Fi 密碼<input id="password" type="password" autocomplete="new-password" placeholder="家中 Wi-Fi 密碼"></label>
<button type="submit">開始連線 ↗</button></form><p id="result" role="status"></p>
<p><small>連線時手機會離開裝置熱點。請回到原本的 Wi-Fi 或行動網路，再返回 APP 查看綁定結果。</small></p>'''
        script = """const p=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname);
const form=document.getElementById('form'),result=document.getElementById('result');
form.addEventListener('submit',async e=>{e.preventDefault();form.querySelector('button').disabled=true;
try{const response=await fetch('/api/provision',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({ssid:document.getElementById('ssid').value,password:document.getElementById('password').value,
grant:p.get('grant'),setupCode:p.get('code')})});
if(!response.ok)throw new Error((await response.json()).error||'無法開始配網');
result.textContent='裝置正在連線。請切回原本網路，再返回 Sleep Airline APP 查看結果。';
}catch(err){result.textContent=err.message;form.querySelector('button').disabled=false;}});"""
        return html_page("設定 Wi-Fi", content, script)

    def offline_page(self):
        content = '''<p class="eyebrow">OFFLINE · 網路中斷</p><h1>航班暫時離線</h1>
<p>旅客綁定已保留。裝置正在確認網路與雲端服務；恢復後會自動開啟飛機窗。</p>
<p id="reason" role="status"></p><button id="change-network">重新設定 Wi-Fi</button>'''
        script = f"""setInterval(async()=>{{try{{const s=await (await fetch('/api/status')).json();
if(!s.paired)location.replace('/device');
else if(s.online)location.replace({json.dumps(WINDOW_URL)});
document.getElementById('reason').textContent=s.message||'';}}catch{{}}}},4000);"""
        script += """document.getElementById('change-network').onclick=async()=>{const r=await fetch('/api/setup-mode',{method:'POST',headers:{'Content-Type':'application/json','X-SleepAirline-Control':'1'},body:JSON.stringify({mode:'ble'})});if(r.ok)location.replace('/device');};"""
        return html_page("暫時離線", content, script)

    def still_on_confirmed_wifi(self):
        if not self.confirmed_uuid:
            return False
        try:
            current = subprocess.run(["nmcli", "-g", "GENERAL.CON-UUID", "device", "show", self.args.interface],
                                     capture_output=True, text=True, timeout=10)
            return current.returncode == 0 and current.stdout.strip() == self.confirmed_uuid
        except (OSError, subprocess.TimeoutExpired):
            return False

    def provision(self, ssid, password, grant, setup_code):
        with self.lock:
            if self.busy or (self.state.get("passengerId") and not self.reconfiguring) or setup_code != self.state.get("setupCode") \
                    or time.time() >= self.state.get("setupExpires", 0):
                return False
            skip_wifi = self.error_code == "cloud_unavailable" and self.confirmed_ssid == ssid
            self.busy = True
            self.error_code = ""
            self.status = "connecting"
            self.message = "正在加入家中 Wi-Fi…"
        Thread(target=self._provision_worker, args=(ssid, password, grant, skip_wifi), daemon=True).start()
        return True

    def _provision_worker(self, ssid, password, grant, skip_wifi=False):
        try:
            if not self.args.dry_run and not (skip_wifi and self.still_on_confirmed_wifi()):
                # Let the local HTTP response reach the phone before wlan0 drops AP mode.
                if self.transport == "wifi":
                    time.sleep(1.5)
                    subprocess.run(["nmcli", "connection", "down", HOTSPOT_NAME], capture_output=True, check=False)
                command = ["nmcli", "--wait", "60", "device", "wifi", "connect", ssid]
                if password:
                    command += ["password", password]
                command += ["ifname", self.args.interface]
                result = subprocess.run(command, capture_output=True, text=True, timeout=75)
                if result.returncode:
                    raise RuntimeError("無法連接家中 Wi-Fi；請檢查名稱與密碼。")
                connection = subprocess.run(["nmcli", "-g", "GENERAL.CON-UUID", "device", "show", self.args.interface],
                                            capture_output=True, text=True, timeout=10)
                connection_uuid = connection.stdout.strip()
                if connection.returncode or not connection_uuid:
                    raise RuntimeError("已連上 Wi-Fi，但無法儲存自動連線設定。")
                priority = subprocess.run(["nmcli", "connection", "modify", connection_uuid,
                                           "connection.autoconnect", "yes", "connection.autoconnect-priority", "999"],
                                          capture_output=True, text=True, timeout=10)
                if priority.returncode:
                    raise RuntimeError("已連上 Wi-Fi，但無法設為預設網路。")
                self.confirmed_ssid, self.confirmed_uuid = ssid, connection_uuid
            self.status = "confirming"
            self.message = "Wi-Fi 已連上，正在確認旅客綁定…"
            if self.args.dry_run:
                data = {"passengerId": "PAX-DRYRUN01"}
            else:
                payload = {
                    "deviceId": self.state["deviceId"],
                    "deviceSecret": self.state["deviceSecret"],
                    "setupCode": self.state["setupCode"],
                    "grant": grant,
                }
                # DNS and the default route can take a few seconds after Wi-Fi says connected.
                for attempt in range(6):
                    try:
                        data = cloud_post('/devices/complete', payload)
                        break
                    except urllib.error.HTTPError as error:
                        if error.code not in (429, 500, 502, 503, 504):
                            raise
                        if attempt == 5:
                            raise
                    except (OSError, urllib.error.URLError):
                        if attempt == 5:
                            raise
                    time.sleep(min(3 * (attempt + 1), 12))
            with self.lock:
                self.ble_receipt = (self.state["setupCode"], time.time() + 120) if self.transport == "ble" else None
                self.state["passengerId"] = data["passengerId"]
                self.state.pop("setupCode", None)
                self.state.pop("hotspotPassword", None)
                self.persist()
                self.online = True
                self.reconfiguring = False
                self.status = "paired"
                self.message = "綁定完成，正在開啟飛機窗。"
        except (RuntimeError, OSError, urllib.error.URLError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            print(f"配對未完成：{type(error).__name__}，階段 {self.status}", file=sys.stderr)
            if isinstance(error, urllib.error.HTTPError) and error.code in (400, 401, 403, 409):
                self.state["setupExpires"] = 0
                self.persist()
                self.message = "配對授權已失效或綁定衝突。請重新掃描裝置配對碼。"
            else:
                self.message = str(error) if isinstance(error, RuntimeError) else "裝置連網後仍無法確認綁定。請檢查網路，再用同一配對碼重試。"
            self.error_code = "authorization_failed" if isinstance(error, urllib.error.HTTPError) and error.code in (400, 401, 403, 409) else ("cloud_unavailable" if self.status == "confirming" else "wifi_failed")
            self.status = "error"
            if self.transport == "wifi":
                self.start_hotspot()
        finally:
            self.busy = False

    def monitor(self):
        while True:
            time.sleep(15)
            if not self.state.get("passengerId") or self.busy or self.reconfiguring or self.args.dry_run:
                continue
            try:
                data = cloud_post('/devices/status', {
                    "deviceId": self.state["deviceId"],
                    "deviceSecret": self.state["deviceSecret"],
                })
                self.online = True
                self.message = ""
                if data.get("status") == "unpaired":
                    self.state["passengerId"] = None
                    self.persist()
                    self.start_setup()
            except urllib.error.HTTPError as error:
                self.online = False
                self.message = f"雲端綁定狀態暫時無法確認（HTTP {error.code}），稍後會自動重試。"
            except (OSError, urllib.error.URLError, ValueError):
                # Keep the existing binding during transient Internet outages.
                self.online = False
                self.message = "目前無法聯絡雲端服務，請檢查網路；裝置會自動重試。"


def handler_for(kiosk):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, body, kind="text/html; charset=utf-8"):
            encoded = body.encode()
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if self.path == "/api/status" and self.headers.get("Origin") == WINDOW_ORIGIN:
                self.send_header("Access-Control-Allow-Origin", WINDOW_ORIGIN)
                self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()
            self.wfile.write(encoded)

        def do_OPTIONS(self):
            if self.path == "/api/status" and self.headers.get("Origin") == WINDOW_ORIGIN:
                self.reply(204, "")
            else:
                self.reply(403, "Forbidden", "text/plain")

        def do_GET(self):
            # QR secrets belong to the physical display, never the classroom LAN.
            if self.path in ("/device", "/offline") and self.client_address[0] not in ("127.0.0.1", "::1"):
                self.reply(403, "Local display only", "text/plain")
                return
            if self.path == "/device":
                self.reply(200, kiosk.device_page())
            elif self.path == "/setup" and kiosk.transport == "wifi":
                self.reply(200, kiosk.setup_page())
            elif self.path == "/offline":
                self.reply(200, kiosk.offline_page())
            elif self.path == "/api/status":
                self.reply(200, json.dumps({
                    "paired": bool(kiosk.state.get("passengerId")) and not kiosk.reconfiguring,
                    "status": kiosk.status, "message": kiosk.message, "online": kiosk.online,
                    "transport": kiosk.transport, "bleReady": kiosk.ble_ready, "bleError": kiosk.ble_error,
                    "bridgeExitCode": kiosk.bridge.poll() if kiosk.bridge else None,
                    "setupRevision": kiosk.state.get("setupRevision", 0),
                    "setupCodeChanged": time.time() >= kiosk.state.get("setupExpires", 0)
                        and not kiosk.state.get("passengerId"),
                }), "application/json")
            else:
                self.reply(404, "Not found", "text/plain")

        def do_POST(self):
            if self.path == "/api/setup-mode":
                # Physical kiosk only: no cross-origin or LAN control of setup mode.
                origin = self.headers.get("Origin")
                if self.client_address[0] not in ("127.0.0.1", "::1") or self.headers.get("X-SleepAirline-Control") != "1" or origin not in ("http://127.0.0.1:8766", "http://localhost:8766"):
                    self.reply(403, '{"error":"local_control_only"}', "application/json")
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length < 128: raise ValueError
                    mode = json.loads(self.rfile.read(length)).get("mode")
                    if mode not in ("ble", "wifi"): raise ValueError
                except (ValueError, TypeError, AttributeError):
                    self.reply(400, '{"error":"invalid_mode"}', "application/json")
                    return
                if kiosk.busy or not kiosk.mode_lock.acquire(blocking=False):
                    self.reply(409, '{"error":"device_busy"}', "application/json")
                    return
                try:
                    kiosk.transport = mode
                    kiosk.ble_receipt = None
                    kiosk.reconfiguring = bool(kiosk.state.get("passengerId"))
                    kiosk.start_setup()
                finally:
                    kiosk.mode_lock.release()
                self.reply(200, '{"ok":true}', "application/json")
                return
            if self.path != "/api/provision" or kiosk.transport != "wifi":
                self.reply(404, "Not found", "text/plain")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096: raise ValueError
                data = json.loads(self.rfile.read(length))
                ssid = data.get("ssid", "")
                password = data.get("password", "")
                grant = data.get("grant", "")
                code = data.get("setupCode", "")
                if not (kiosk.valid_provision(data) and isinstance(code, str) and len(code) >= 32):
                    raise ValueError
            except (ValueError, TypeError, AttributeError):
                self.reply(400, '{"error":"設定資料不完整"}', "application/json")
                return
            if not kiosk.provision(ssid, password, grant, code):
                self.reply(409, '{"error":"配對碼已失效，請重新掃描裝置螢幕"}', "application/json")
                return
            self.reply(202, '{"status":"connecting"}', "application/json")

        def log_message(self, *_):
            pass

    return Handler


def main():
    global STATE_FILE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interface", default="wlan0")
    parser.add_argument("--pairing-transport", choices=("ble", "wifi"), default="ble", help="Primary first-boot setup transport")
    parser.add_argument("--dry-run", action="store_true", help="Test UI without changing Wi-Fi or calling the cloud")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-bridge", action="store_true", help="Use the existing S3 sensor bridge service")
    parser.add_argument("--reconfigure-wifi", action="store_true", help="Reopen setup without unbinding (BLE by default)")
    args = parser.parse_args()
    dry_state = tempfile.TemporaryDirectory(prefix="sleep-airline-dry-run-") if args.dry_run else None
    if dry_state:
        STATE_FILE = Path(dry_state.name) / "device.json"
    kiosk = Kiosk(args)
    if not args.dry_run and not args.no_bridge:
        kiosk.bridge = subprocess.Popen([sys.executable, str(Path(__file__).with_name("device_bridge.py")),
                                        "--identity-file", str(STATE_FILE)])
    if kiosk.state.get("passengerId") and not args.dry_run:
        try:
            data = cloud_post('/devices/status', {"deviceId": kiosk.state["deviceId"],
                                                   "deviceSecret": kiosk.state["deviceSecret"]})
            kiosk.online = True
            kiosk.message = ""
            if data.get("status") == "unpaired":
                kiosk.state["passengerId"] = None
                kiosk.persist()
        except urllib.error.HTTPError as error:
            kiosk.online = False
            kiosk.message = f"雲端綁定狀態暫時無法確認（HTTP {error.code}），稍後會自動重試。"
        except (OSError, urllib.error.URLError, ValueError):
            kiosk.online = False
            kiosk.message = "目前無法聯絡雲端服務，請檢查網路；裝置會自動重試。"
    if not kiosk.state.get("passengerId") or args.reconfigure_wifi:
        kiosk.start_setup()
    if not args.dry_run:
        try:
            from ble_server import BleServer
            kiosk.ble_server = BleServer(kiosk)
            kiosk.ble_server.start()
        except ImportError:
            kiosk.ble_error = "藍牙服務尚未安裝完整，請重新執行裝置安裝程式。"
    Thread(target=kiosk.monitor, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", 8766), handler_for(kiosk))
    url = (WINDOW_URL if kiosk.online else "http://127.0.0.1:8766/offline") if kiosk.state.get("passengerId") and not args.reconfigure_wifi else "http://127.0.0.1:8766/device"
    if not args.no_browser:
        browser = shutil.which("chromium") or shutil.which("chromium-browser")
        if browser:
            kiosk.browser = subprocess.Popen([browser, "--kiosk", "--noerrdialogs",
                                             "--user-data-dir=" + str(HOME / ".config/sleep-airline/chromium"),
                                             "--disable-session-crashed-bubble", url])
        else:
            print("Chromium not found; open", url, flush=True)
    print("Local setup: http://127.0.0.1:8766/device", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if kiosk.bridge:
            kiosk.bridge.terminate()
        if kiosk.browser and kiosk.browser.poll() is None:
            kiosk.browser.terminate()
        if dry_state:
            dry_state.cleanup()


if __name__ == "__main__":
    main()
