"""Sleep Airline Pi launcher: local setup, Wi-Fi provisioning and device bridge.

Run from the Pi desktop session with `python3 device_kiosk.py`. The local setup
page remains available without an Internet connection. No home Wi-Fi password is
sent to the cloud or written to this application's state file.
"""

import argparse
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


def html_page(title, content, script="", page_class=""):
    logo_path = Path(__file__).resolve().parents[1] / "public/images/brand-logo.png"
    logo = (f'<img src="data:image/png;base64,{base64.b64encode(logo_path.read_bytes()).decode()}" alt="Sleep Airline">'
            if logo_path.is_file() else 'SLEEP<span>AIRLINE</span>')
    pairing_page = page_class in ("device-onboarding", "phone-setup")
    header_en = "FIRST CONNECTION" if pairing_page else "DEVICE DISPLAY"
    active_steps = 1 if page_class == "device-onboarding" else 2
    markers = ''.join('<i class="active"></i>' if index < active_steps else '<i></i>' for index in range(3))
    progress = f'<div class="progress-rule" aria-hidden="true">{markers}</div>' if pairing_page else ''
    return f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Cache-Control" content="no-store"><title>{title} · SLEEP AIRLINE</title>
<style>
:root{{font-family:'Manrope','Noto Sans TC',system-ui,sans-serif;color:#1a1c1c;background:#fbfaf7;
--ink:#1a1c1c;--muted:#737672;--line:#d7d8d4;--paper:#fbfaf7;
--mono:'DM Mono','SFMono-Regular',ui-monospace,monospace;-webkit-font-smoothing:antialiased}}
*{{box-sizing:border-box}}html{{-webkit-text-size-adjust:100%}}
body{{margin:0;min-height:100dvh;padding:clamp(22px,4vw,42px);display:flex;justify-content:center}}
main{{width:min(100%,640px)}}.masthead{{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}}
.brand{{position:relative;width:48px;height:64px;overflow:hidden;font-size:clamp(22px,4vw,30px);line-height:1.12;letter-spacing:.23em;font-weight:400}}
.brand img{{position:absolute;width:100px;height:100px;left:-27px;top:-18px}}.brand span{{display:block}}.masthead-note{{padding-top:3px;text-align:right;font-size:11px;letter-spacing:.12em}}
.masthead-note small{{display:block;margin-top:4px;font-family:var(--mono);font-size:8px;letter-spacing:.17em;color:var(--muted)}}
.progress-rule{{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:28px 0 32px}}
.progress-rule i{{height:2px;background:var(--line)}}.progress-rule i.active{{background:var(--ink)}}
.eyebrow{{font-family:var(--mono);font-size:10px;letter-spacing:.17em;color:var(--muted)}}
.eyebrow{{margin:0}}h1{{font-size:clamp(32px,6vw,46px);font-weight:400;line-height:1.2;letter-spacing:.11em;margin:10px 0 16px}}
p{{margin:0;line-height:1.65;color:var(--muted);font-size:14px}}.lead{{max-width:570px;color:var(--ink)}}
.scan-layout{{display:grid;grid-template-columns:clamp(175px,37vw,236px) minmax(0,1fr);gap:24px;align-items:start;margin:30px 0 28px}}
.qr{{width:100%;max-width:236px;padding:12px;background:white;border:1px solid var(--line);border-radius:5px}}
.qr img{{display:block;width:100%;height:auto;image-rendering:pixelated}}.scan-steps{{border-top:1px solid var(--ink)}}
.scan-step{{display:grid;grid-template-columns:30px minmax(0,1fr);gap:9px;border-bottom:1px solid var(--line);padding:13px 0}}
.scan-step b{{font-family:var(--mono);font-size:10px;font-weight:400;color:var(--muted)}}
.scan-step strong{{display:block;font-size:13px;font-weight:500;letter-spacing:.04em}}.scan-step small{{display:block;margin-top:4px;font-size:11px;line-height:1.5;color:var(--muted)}}
.scan-step.current b{{color:var(--ink)}}.scan-step.current strong{{font-weight:600}}
.credential-list{{margin-top:4px;border-top:1px solid var(--ink)}}.card{{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding:13px 0}}
.card span{{color:var(--muted);font-family:var(--mono);font-size:10px;letter-spacing:.08em}}
.card strong{{font-family:var(--mono);font-weight:400;font-size:12px;text-align:right;overflow-wrap:anywhere}}
.device-onboarding .card span{{font-size:11px}}.device-onboarding .card strong{{font-size:16px;line-height:1.4}}
.device-status{{display:flex;justify-content:space-between;gap:20px;margin-top:24px;font-family:var(--mono);font-size:11px;line-height:1.5}}
.device-status span{{color:var(--muted)}}.device-status strong{{font-weight:400;text-align:right;overflow-wrap:anywhere}}
.route{{display:grid;grid-template-columns:1fr 1fr;gap:15px;border-top:1px solid var(--ink);border-bottom:1px solid var(--line);padding:14px 0;margin:25px 0}}
.route div{{font-size:12px;line-height:1.55}}.route strong{{display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:var(--ink)}}
.route span{{color:var(--muted)}}form{{margin-top:28px}}label{{display:block;margin:17px 0;font-size:12px;letter-spacing:.05em}}
input{{display:block;width:100%;min-height:54px;margin-top:8px;padding:12px 14px;background:white;border:1px solid #bfc2bd;border-radius:5px;color:var(--ink);font:inherit;font-size:16px}}
input:focus{{border-color:var(--ink);outline:1px solid var(--ink)}}button,.return-app{{width:100%;min-height:58px;display:flex;align-items:center;justify-content:space-between;margin-top:24px;padding:15px 18px;border:1px solid var(--ink);background:var(--ink);color:white;font:inherit;font-size:15px;text-align:left;cursor:pointer;text-decoration:none}}
button:disabled{{opacity:.55;cursor:default}}.return-app{{background:transparent;color:var(--ink)}}.return-app[hidden]{{display:none}}
.form-result{{margin-top:17px;color:var(--ink)}}.fine-print{{margin-top:20px;font-size:12px}}.error{{color:#8b4139}}
@media(max-width:560px){{.scan-layout{{gap:14px;margin:22px 0}}.route{{grid-template-columns:1fr;gap:12px}}.masthead-note{{font-size:9px}}}}
@media(max-width:440px){{.scan-layout{{grid-template-columns:1fr}}.qr{{width:min(72vw,236px)}}.scan-step{{padding:10px 0}}}}
@media(max-height:800px) and (min-width:441px){{body{{padding:20px}}h1{{font-size:clamp(32px,5vw,38px);margin:8px 0 10px}}.lead{{font-size:13px;line-height:1.5}}
.progress-rule{{margin:17px 0 20px}}.scan-layout{{margin:18px 0;gap:18px}}
.scan-layout{{grid-template-columns:clamp(175px,37vw,200px) minmax(0,1fr)}}.scan-step{{padding:9px 0}}.card{{padding:9px 0}}
.device-status{{margin-top:12px}}}}
</style></head><body class="{page_class}"><main>
<header class="masthead"><div class="brand">{logo}</div>
<div class="masthead-note">{title}<small>{header_en}</small></div></header>
{progress}
{content}</main><script>{script}</script></body></html>"""


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

    def persist(self):
        save_state(self.state)

    def start_hotspot(self):
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
        if time.time() >= self.state.get("setupExpires", 0) and not self.busy:
            self.start_hotspot()
        import qrcode
        payload = json.dumps({
            "deviceId": self.state["deviceId"],
            "setupCode": self.state["setupCode"],
            "ssid": self.state["hotspotSsid"],
            "password": self.state["hotspotPassword"],
        }, separators=(",", ":")).encode()
        # Fragment is never sent to the Vercel server as part of the URL request.
        url = APP_URL + "#pair=" + base64.urlsafe_b64encode(payload).decode().rstrip("=")
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
            image = f'<div class="qr"><img src="data:image/png;base64,{qr}" alt="掃描這台裝置的配對 QR Code"></div>'
        except ImportError:
            image = '<p class="error">缺少 QR 程式庫，請安裝 python3-qrcode。</p>'
        content = f'''<p class="eyebrow">01 / 03 · 登機前準備</p><h1>請用手機掃描<br>這台裝置的 QR</h1>
<p class="lead">手機保持上網，掃描配對碼。接下來可以一邊看這個畫面，一邊依照 APP 的指示操作。</p>
<div class="scan-layout">{image}<div class="scan-steps" aria-label="配對步驟">
<div class="scan-step current"><b>01</b><div><strong>掃描 QR</strong><small>手機保持上網，掃描配對碼並開啟 Sleep Airline APP。</small></div></div>
<div class="scan-step"><b>02</b><div><strong>暫時連上裝置 Wi-Fi</strong><small>手機出現「無網路」是正常的，請保持連線。</small></div></div>
<div class="scan-step"><b>03</b><div><strong>設定日常 Wi-Fi</strong><small>送出後，讓手機回到原本網路，在 APP 確認結果。</small></div></div>
</div></div>
<div class="credential-list">
<div class="card"><span>裝置代碼</span><strong>{self.state['deviceId']}</strong></div>
<div class="card"><span>裝置暫時 Wi-Fi</span><strong>{self.state.get('hotspotSsid', '—')}</strong></div>
<div class="card"><span>裝置暫時密碼</span><strong>{self.state.get('hotspotPassword', '—')}</strong></div></div>
<div class="device-status" role="status"><span>裝置狀態</span><strong id="progress">{self.message or '等待手機完成設定'}</strong></div>'''
        revision = self.state.get("setupRevision", 0)
        script = f"""const setupRevision={revision};setInterval(async()=>{{try{{const s=await (await fetch('/api/status')).json();
if(s.paired)location.replace('""" + WINDOW_URL + """');
else if(s.setupRevision!==setupRevision||s.setupCodeChanged)location.reload();
document.getElementById('progress').textContent=s.message||'等待手機完成設定';
const active=(s.status==='connecting'||s.status==='confirming')?2:0;
document.querySelectorAll('.scan-step').forEach((item,index)=>item.classList.toggle('current',index===active));
document.querySelectorAll('.progress-rule i').forEach((item,index)=>item.classList.toggle('active',index<=active));
}catch{}},3000);"""
        return html_page("首次連線", content, script, "device-onboarding")

    def setup_page(self):
        return_url = APP_URL + "?pairing=return"
        content = f'''<p class="eyebrow">02 / 03 · 設定日常網路</p><h1>讓裝置加入<br>Wi-Fi</h1>
<p class="lead">這一頁由眼前的裝置提供。現在手機連著裝置暫時 Wi-Fi，顯示「無網路」是正常的。</p>
<div class="route"><div><strong>現在 · 手機連裝置</strong><span>輸入裝置日後要使用的 Wi-Fi，與暫時網路不同。</span></div>
<div><strong>送出後 · 回到 APP</strong><span>裝置開始連線；手機恢復上網，再確認綁定結果。</span></div></div>
<form id="form"><label>日常 Wi-Fi 名稱 / SSID<input id="ssid" required autocomplete="off" placeholder="輸入裝置要連的 Wi-Fi 名稱"></label>
<label>日常 Wi-Fi 密碼<input id="password" type="password" autocomplete="new-password" placeholder="輸入這個 Wi-Fi 的密碼"></label>
<button type="submit">將網路資料送給裝置 <span>→</span></button></form><p id="result" class="form-result" role="status"></p>
<a id="return-app" class="return-app" href="{return_url}" hidden>手機恢復上網後，返回 APP 確認 ↗</a>
<p class="fine-print">密碼只會傳給眼前的裝置，不會送到 Vercel。送出後暫時 Wi-Fi 會關閉；請讓手機切回原本 Wi-Fi 或行動網路。</p>'''
        script = """const p=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname);
const form=document.getElementById('form'),result=document.getElementById('result');
form.addEventListener('submit',async e=>{e.preventDefault();form.querySelector('button').disabled=true;
try{const response=await fetch('/api/provision',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({ssid:document.getElementById('ssid').value,password:document.getElementById('password').value,
grant:p.get('grant'),setupCode:p.get('code')})});
if(!response.ok)throw new Error((await response.json()).error||'無法開始配網');
result.textContent='網路資料已送給裝置。裝置暫時 Wi-Fi 即將關閉；請讓手機恢復上網，再按下方按鈕返回 APP。';
document.getElementById('return-app').hidden=false;
document.getElementById('return-app').scrollIntoView({block:'center'});
}catch(err){result.textContent=err instanceof TypeError?'未收到裝置回覆。請先查看裝置螢幕是否正在連線，不要立即重複送出。':err.message;form.querySelector('button').disabled=false;}});"""
        return html_page("設定 Wi-Fi", content, script, "phone-setup")

    def offline_page(self):
        content = '''<p class="eyebrow">OFFLINE · 網路中斷</p><h1>航班暫時離線</h1>
<p>旅客綁定已保留。裝置正在確認網路與雲端服務；恢復後會自動開啟飛機窗。</p>
<p id="reason" role="status"></p>'''
        script = f"""setInterval(async()=>{{try{{const s=await (await fetch('/api/status')).json();
if(!s.paired)location.replace('/device');
else if(s.online)location.replace({json.dumps(WINDOW_URL)});
document.getElementById('reason').textContent=s.message||'';}}catch{{}}}},4000);"""
        return html_page("暫時離線", content, script)

    def provision(self, ssid, password, grant, setup_code):
        with self.lock:
            if self.busy or (self.state.get("passengerId") and not self.reconfiguring) or setup_code != self.state.get("setupCode") \
                    or time.time() >= self.state.get("setupExpires", 0):
                return False
            self.busy = True
            self.status = "connecting"
            self.message = "正在加入家中 Wi-Fi…"
        Thread(target=self._provision_worker, args=(ssid, password, grant), daemon=True).start()
        return True

    def _provision_worker(self, ssid, password, grant):
        try:
            if not self.args.dry_run:
                # Let the local HTTP response reach the phone before wlan0 drops AP mode.
                time.sleep(1.5)
                # The single wlan0 radio leaves AP mode before joining the home SSID.
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
            self.status = "confirming"
            self.message = "正在確認裝置綁定…"
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
                self.state["passengerId"] = data["passengerId"]
                self.state.pop("setupCode", None)
                self.state.pop("hotspotPassword", None)
                self.persist()
                self.online = True
                self.reconfiguring = False
                self.status = "paired"
                self.message = "綁定完成，正在開啟飛機窗。"
        except (RuntimeError, OSError, urllib.error.URLError, ValueError, KeyError) as error:
            print(f"配對未完成：{type(error).__name__}: {error}", file=sys.stderr)
            if isinstance(error, urllib.error.HTTPError) and error.code in (400, 401, 403, 409):
                self.state["setupExpires"] = 0
                self.message = "配對授權已失效或綁定衝突。請重新掃描裝置配對碼。"
            else:
                self.message = str(error) if isinstance(error, RuntimeError) else "裝置連網後仍無法確認綁定。請檢查網路，再用同一配對碼重試。"
            self.status = "error"
            self.start_hotspot()
        finally:
            self.busy = False

    def monitor(self):
        while True:
            time.sleep(15)
            if not self.state.get("passengerId") or self.busy or self.args.dry_run:
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
                    self.start_hotspot()
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
            if self.path == "/device":
                self.reply(200, kiosk.device_page())
            elif self.path == "/setup":
                self.reply(200, kiosk.setup_page())
            elif self.path == "/offline":
                self.reply(200, kiosk.offline_page())
            elif self.path == "/api/status":
                self.reply(200, json.dumps({
                    "paired": bool(kiosk.state.get("passengerId")) and not kiosk.reconfiguring,
                    "status": kiosk.status, "message": kiosk.message, "online": kiosk.online,
                    "bridgeExitCode": kiosk.bridge.poll() if kiosk.bridge else None,
                    "setupRevision": kiosk.state.get("setupRevision", 0),
                    "setupCodeChanged": time.time() >= kiosk.state.get("setupExpires", 0)
                        and not kiosk.state.get("passengerId"),
                }), "application/json")
            else:
                self.reply(404, "Not found", "text/plain")

        def do_POST(self):
            if self.path != "/api/provision":
                self.reply(404, "Not found", "text/plain")
                return
            if int(self.headers.get("Content-Length", "0")) > 4096:
                self.reply(413, '{"error":"request_too_large"}', "application/json")
                return
            try:
                data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                ssid = data.get("ssid", "")
                password = data.get("password", "")
                grant = data.get("grant", "")
                code = data.get("setupCode", "")
                if not (isinstance(ssid, str) and 0 < len(ssid) <= 32 and isinstance(password, str)
                        and len(password) <= 128 and isinstance(grant, str) and len(grant) <= 2048
                        and isinstance(code, str) and len(code) >= 32):
                    raise ValueError
            except (ValueError, TypeError):
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
    parser.add_argument("--dry-run", action="store_true", help="Test UI without changing Wi-Fi or calling the cloud")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-bridge", action="store_true", help="Use the existing S3 sensor bridge service")
    parser.add_argument("--reconfigure-wifi", action="store_true", help="Reopen the setup hotspot without unbinding")
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
        kiosk.start_hotspot()
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
