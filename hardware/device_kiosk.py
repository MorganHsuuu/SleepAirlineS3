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
import html
import os
from pathlib import Path
import secrets
import ipaddress
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
sys.path.insert(0, str(Path(__file__).resolve().parent))
from wifi_networks import WifiNetworks, validate_networks


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
    maintenance_path = Path(__file__).resolve().parents[1] / "public/maintenance.js"
    maintenance = maintenance_path.read_text() if maintenance_path.is_file() else ""
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
.mode-choice{{display:flex;gap:8px;margin-top:24px}}.mode-choice button{{margin:0;min-height:48px;background:transparent;color:var(--ink);font-size:13px;justify-content:center}}
.mode-choice button[aria-pressed="true"]{{background:var(--ink);color:white}}.secondary{{background:transparent;color:var(--ink)}}
.network-row{{border-top:1px solid var(--line);padding-top:12px;margin-top:20px}}.network-row h2{{font-size:14px;font-weight:500}}
.network-row .remove{{min-height:36px;margin:8px 0;padding:6px;background:transparent;color:var(--muted);border:0;font-size:12px}}
.checkbox{{display:flex;gap:10px;align-items:center;letter-spacing:0}}.checkbox input{{width:20px;min-height:20px;margin:0;flex-shrink:0}}
button:disabled{{opacity:.55;cursor:default}}.return-app{{background:transparent;color:var(--ink)}}.return-app[hidden]{{display:none}}
.form-result{{margin-top:17px;color:var(--ink)}}.fine-print{{margin-top:20px;font-size:12px}}.error{{color:#8b4139}}
@media(max-width:560px){{.scan-layout{{gap:14px;margin:22px 0}}.route{{grid-template-columns:1fr;gap:12px}}.masthead-note{{font-size:9px}}}}
@media(max-width:440px){{.scan-layout{{grid-template-columns:1fr}}.qr{{width:min(72vw,236px)}}.scan-step{{padding:10px 0}}}}
@media(max-height:800px) and (min-width:441px){{body{{padding:20px}}h1{{font-size:clamp(32px,5vw,38px);margin:8px 0 10px}}.lead{{font-size:13px;line-height:1.5}}
.progress-rule{{margin:17px 0 20px}}.scan-layout{{margin:18px 0;gap:18px}}
.scan-layout{{grid-template-columns:clamp(175px,37vw,200px) minmax(0,1fr)}}.scan-step{{padding:9px 0}}.card{{padding:9px 0}}
.device-status{{margin-top:12px}}}}
/* Reserve space behind the physical shade; keep the whole pairing block visible. */
body.device-onboarding{{padding-top:calc(clamp(22px,4vw,42px) + 14dvh);padding-bottom:max(12dvh,22px)}}
</style></head><body class="{page_class}"><main>
<header class="masthead"><div class="brand">{logo}</div>
<div class="masthead-note">{title}<small>{header_en}</small></div></header>
{progress}
{content}</main><script>{script}</script><script>{maintenance}</script></body></html>"""


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
        self.last_terminal_open = None
        self.wifi = WifiNetworks(args.interface, getattr(args, "fallback_ssid", "T2-308教室"), args.dry_run)
        self.setup_mode = "hotspot"
        self.local_network = None

    def open_terminal(self):
        if not sys.platform.startswith("linux"):
            raise RuntimeError("維護終端機需在樹莓派桌面執行")
        with self.lock:
            now = time.monotonic()
            if self.last_terminal_open is not None and now - self.last_terminal_open < 5:
                raise RuntimeError("終端機剛已開啟，請稍候再試")
            terminal = next((path for name in ("lxterminal", "x-terminal-emulator", "foot", "xfce4-terminal", "xterm")
                             if (path := shutil.which(name))), None)
            if not terminal:
                raise RuntimeError("找不到終端機，請安裝 lxterminal")
            runtime = Path(f"/run/user/{os.getuid()}")
            env = dict(os.environ, DISPLAY=os.environ.get("DISPLAY", ":0"),
                       XDG_RUNTIME_DIR=str(runtime), DBUS_SESSION_BUS_ADDRESS=f"unix:path={runtime}/bus")
            wayland = next((path.name for path in sorted(runtime.glob("wayland-*")) if path.is_socket()), None)
            if wayland:
                env["WAYLAND_DISPLAY"] = wayland
            if (HOME / ".Xauthority").is_file():
                env["XAUTHORITY"] = str(HOME / ".Xauthority")
            process = subprocess.Popen([terminal], cwd=str(HOME), env=env, start_new_session=True,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                code = process.wait(timeout=0.3)
                if code:
                    raise RuntimeError("終端機無法連上桌面，請確認已登入樹莓派圖形桌面")
            except subprocess.TimeoutExpired:
                pass
            self.last_terminal_open = now
            return {"status": "opened"}

    def persist(self):
        save_state(self.state)

    def apply_cloud_identity(self, data):
        if data.get("status") == "unpaired":
            self.state["passengerId"] = None
            self.state["passengerName"] = ""
            self.persist()
            return "unpaired"
        incoming = (data.get("displayName") or "").strip()
        if incoming and self.state.get("passengerName") != incoming:
            self.state["passengerName"] = incoming
            self.persist()
        return "paired"

    def ensure_setup_code(self):
        with self.lock:
            if (time.time() >= self.state.get("setupExpires", 0) or
                    not all(self.state.get(key) for key in ("setupCode", "hotspotPassword", "hotspotSsid"))):
                self.state["setupCode"] = secrets.token_urlsafe(32)
                self.state["hotspotPassword"] = self.state.get("hotspotPassword") or secrets.token_urlsafe(12)[:16]
                self.state["hotspotSsid"] = f"SleepAirline-{self.state['deviceId'][-6:]}"
                self.state["setupExpires"] = int(time.time()) + 15 * 60
                self.state["setupRevision"] = self.state.get("setupRevision", 0) + 1
                self.persist()

    def start_hotspot(self):
        self.ensure_setup_code()
        self.setup_mode = "hotspot"
        self.local_network = None
        self.status = "setting_up_hotspot"
        if self.args.dry_run:
            self.status = "ready"
            return
        try:
            try:
                self.wifi.run("connection", "delete", HOTSPOT_NAME)
            except RuntimeError:
                pass  # The hotspot profile may not exist yet.
            self.wifi.run("device", "wifi", "hotspot", "ifname", self.args.interface,
                          "con-name", HOTSPOT_NAME, "ssid", self.state["hotspotSsid"],
                          "password", self.state["hotspotPassword"], timeout=35)
            # AP must not win on next boot; it is started only after saved Wi-Fi fails.
            self.wifi.run("connection", "modify", HOTSPOT_NAME, "connection.autoconnect", "no",
                          "ipv4.addresses", f"{HOTSPOT_IP}/24", "ipv4.method", "shared")
            self.wifi.run("connection", "up", HOTSPOT_NAME, timeout=30)
        except RuntimeError:
            self.status = "error"
            self.message = "無法建立裝置暫時熱點，請檢查 Wi-Fi 與設定服務權限。"
            print("Setup hotspot unavailable", file=sys.stderr, flush=True)
            return
        self.status = "ready"

    def current_qr(self):
        if time.time() >= self.state.get("setupExpires", 0) and not self.busy:
            self.ensure_setup_code()
        import qrcode
        if self.state.get("passengerId"):
            # Physical access to this short-lived QR authorizes Wi-Fi repair only.
            # No grant or Passenger ID changes are involved.
            url = self.setup_base() + "#code=" + quote(self.state["setupCode"])
        else:
            payload = json.dumps({
                "deviceId": self.state["deviceId"], "setupCode": self.state["setupCode"],
                "ssid": self.state["hotspotSsid"], "password": self.state["hotspotPassword"],
                "mode": self.setup_mode, "setupUrl": self.setup_base(),
                "networkSsid": (self.local_network or {}).get("ssid", ""),
            }, separators=(",", ":"), ensure_ascii=False).encode()
            # The fragment is not sent to Vercel.
            url = APP_URL + "#pair=" + base64.urlsafe_b64encode(payload).decode().rstrip("=")
        image = qrcode.make(url)
        output = BytesIO()
        image.save(output, format="PNG")
        return base64.b64encode(output.getvalue()).decode()

    def setup_base(self):
        address = (self.local_network or {}).get("address") if self.setup_mode == "lan" else HOTSPOT_IP
        return f"http://{address or HOTSPOT_IP}:8766/setup"

    def select_mode(self, mode):
        with self.lock:
            if self.busy or mode not in ("lan", "hotspot"):
                return False
            self.busy = True
        Thread(target=self._mode_worker, args=(mode,), daemon=True).start()
        return True

    def _mode_worker(self, mode):
        try:
            self.reconfiguring = bool(self.state.get("passengerId"))
            if mode == "hotspot":
                self.start_hotspot()
            else:
                self.status = "connecting"
                self.message = "正在嘗試已儲存的 Wi-Fi…"
                if not self.args.dry_run and self.setup_mode == "hotspot":
                    subprocess.run(["nmcli", "connection", "down", HOTSPOT_NAME], capture_output=True, timeout=12)
                network = self.wifi.connect_saved()
                if not network:
                    raise RuntimeError("無法連上已儲存的 Wi-Fi，已回到裝置暫時熱點。")
                self.local_network = network
                self.setup_mode = "lan"
                self.ensure_setup_code()
                self.status = "ready"
            self.state["setupRevision"] = self.state.get("setupRevision", 0) + 1
            self.persist()
            self.message = "已切換連線方式，請重新掃描 QR。"
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            self.start_hotspot()
            self.message = "無法連上一般 Wi-Fi，請使用裝置暫時熱點，或稍後再切換。"
        finally:
            self.busy = False

    def device_page(self):
        if self.status == "starting" or (self.busy and self.status == "connecting" and not self.state.get("setupCode")):
            return html_page("確認網路", '<h1>正在連接 Wi-Fi</h1><p>先嘗試其他已存網路，再嘗試教室網路。請稍候…</p>',
                             "setTimeout(()=>location.reload(),3000)")
        if self.state.get("passengerId") and not self.reconfiguring:
            target = WINDOW_URL if self.online else "http://127.0.0.1:8766/offline"
            return html_page("裝置已連線", '<h1>準備起飛</h1><p>正在開啟飛機窗…</p>',
                             f"location.replace({json.dumps(target)});")
        try:
            qr = self.current_qr()
            image = f'<div class="qr"><img src="data:image/png;base64,{qr}" alt="裝置網路設定 QR"></div>'
        except ImportError:
            image = '<p class="error">缺少 QR 程式庫，請安裝 python3-qrcode。</p>'
        paired = bool(self.state.get("passengerId"))
        title = "更新裝置網路" if paired else "請用手機掃描<br>這台裝置的 QR"
        network = html.escape((self.local_network or {}).get("ssid", "一般 Wi-Fi"))
        lan = self.setup_mode == "lan"
        instruction = (f"手機與裝置都連上 {network}，不需切換暫時熱點。" if lan
                       else "手機先保持上網；掃描後依指示連上裝置暫時 Wi-Fi。")
        if paired:
            instruction = (f"旅客綁定已保留。手機連上 {network} 後掃碼設定。" if lan
                           else "旅客綁定已保留。先讓手機加入下方暫時 Wi-Fi，再用相機掃碼設定網路；不需登入或重新配對。")
        rows = f'<div class="card"><span>目前連線</span><strong>{network}</strong></div>' if lan else f'''
<div class="card"><span>裝置暫時 Wi-Fi</span><strong>{html.escape(self.state.get('hotspotSsid', '—'))}</strong></div>
<div class="card"><span>裝置暫時密碼</span><strong>{html.escape(self.state.get('hotspotPassword', '—'))}</strong></div>'''
        content = f'''<p class="eyebrow">NETWORK SETUP · {'保留旅客綁定' if paired else '首次連線'}</p><h1>{title}</h1>
<p class="lead">{instruction}</p>
<div class="mode-choice" aria-label="傳送網路資料的方式">
<button data-mode="lan" aria-pressed="{str(lan).lower()}" {'disabled' if self.busy else ''}>一般 Wi-Fi 傳送</button>
<button data-mode="hotspot" aria-pressed="{str(not lan).lower()}" {'disabled' if self.busy else ''}>裝置暫時熱點傳送</button></div>
<div class="scan-layout">{image}<div class="scan-steps">
<div class="scan-step"><b>01</b><div><strong>{'連上相同 Wi-Fi' if lan else '加入裝置暫時 Wi-Fi'}</strong><small>{'若教室網路阻擋裝置互連，請改用暫時熱點。' if lan else '手機顯示無網路是正常的。'}</small></div></div>
<div class="scan-step"><b>02</b><div><strong>掃 QR 設定多組網路</strong><small>可先存好家中 Wi-Fi；儲存不代表已驗證連線。</small></div></div>
<div class="scan-step"><b>03</b><div><strong>{'完成網路設定' if paired else '返回 APP 確認綁定'}</strong><small>開機依序嘗試已存網路，教室網路最後才嘗試。</small></div></div></div></div>
<div class="credential-list"><div class="card"><span>裝置代碼</span><strong>{self.state['deviceId']}</strong></div>{rows}</div>
<div class="device-status" role="status"><span>裝置狀態</span><strong id="progress">{html.escape(self.message or '等待手機設定')}</strong></div>'''
        script = f"const revision={self.state.get('setupRevision', 0)};" + """
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',async()=>{
document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=true);
try{const r=await fetch('/api/setup-mode',{method:'POST',headers:{'Content-Type':'application/json','X-Sleep-Airline-Setup':'1'},body:JSON.stringify({mode:button.dataset.mode})});if(!r.ok)throw Error('目前正在設定，請稍後再試');}
catch(e){document.getElementById('progress').textContent=e.message;document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=false);}}));
setInterval(async()=>{try{const s=await(await fetch('/api/status')).json();
if(s.paired){location.replace(s.online?__WINDOW__:'/offline');return;}
else if(s.setupRevision!==revision||s.setupCodeChanged)location.reload();
document.getElementById('progress').textContent=s.message||'等待手機設定';
}catch{}},2500);""".replace('__WINDOW__', json.dumps(WINDOW_URL))
        return html_page("網路設定" if paired else "首次連線", content, script, "device-onboarding")

    def setup_page(self):
        paired = bool(self.state.get("passengerId"))
        content = '''<p class="eyebrow">DEVICE NETWORKS</p><h1>儲存日常 Wi-Fi</h1>
<p class="lead">可先在教室存好家中的網路。帳密只送到眼前裝置，不會存到雲端。</p>
<p class="fine-print">儲存成功不代表密碼已驗證；不在附近的網路會在下次開機時嘗試。支援一般個人密碼／開放網路，企業登入與網頁登入需另外設定。</p>
<form id="form"><div id="networks"></div>
<button type="button" id="add" class="secondary">＋ 新增另一組 Wi-Fi</button>
<label class="checkbox"><input type="checkbox" id="connect">儲存後立即測試並連線（手機可能斷線）</label>
<button type="submit" id="submit">儲存網路並完成設定 →</button></form>
<p id="result" class="form-result" role="status"></p>
<a id="return-app" class="return-app" hidden>返回 APP 確認 ↗</a>'''
        script = (Path(__file__).with_name("wifi-setup.js")).read_text()
        config = {"revision": self.state.get("setupRevision", 0), "mode": self.setup_mode,
                  "paired": paired, "returnUrl": APP_URL + "?pairing=return"}
        return html_page("設定 Wi-Fi", content, "const config=" + json.dumps(config) + ";\n" + script, "phone-setup")

    def offline_page(self):
        content = '''<p class="eyebrow">OFFLINE · 網路中斷</p><h1>航班暫時離線</h1>
<p>旅客綁定已保留。裝置正在確認網路與雲端服務；恢復後會自動開啟飛機窗。</p>
<p id="reason" role="status"></p>
<button id="wifi-settings">設定 Wi-Fi →</button>'''
        script = """document.getElementById('wifi-settings').onclick=async()=>{
const r=await fetch('/api/setup-mode',{method:'POST',headers:{'Content-Type':'application/json','X-Sleep-Airline-Setup':'1'},body:JSON.stringify({mode:'hotspot'})});if(r.ok)location.replace('/device');};""" + f"""setInterval(async()=>{{try{{const s=await (await fetch('/api/status')).json();
if(!s.paired)location.replace('/device');
else if(s.online)location.replace({json.dumps(WINDOW_URL)});
document.getElementById('reason').textContent=s.message||'';}}catch{{}}}},4000);"""
        return html_page("暫時離線", content, script)

    def provision(self, ssid, password, grant, setup_code, *, networks=None, connect_now=None):
        networks = validate_networks(networks if networks is not None else [{"ssid": ssid, "password": password}])
        with self.lock:
            if self.busy or not self.valid_setup_code(setup_code) or (self.state.get("passengerId") and not self.reconfiguring):
                return False
            if not self.state.get("passengerId") and not grant:
                raise ValueError("請先在 APP 掃描並取得配對授權")
            self.busy = True
            self.status = "connecting"
            self.message = "正在儲存 Wi-Fi…"
        # A hotspot has no upstream; at least one reachable network is required.
        connect_now = self.setup_mode == "hotspot" or bool(connect_now)
        Thread(target=self._provision_worker, args=(networks, grant, connect_now), daemon=True).start()
        return True

    def valid_setup_code(self, code):
        return (isinstance(code, str) and bool(code) and secrets.compare_digest(code, self.state.get("setupCode", ""))
                and time.time() < self.state.get("setupExpires", 0))

    def _provision_worker(self, networks, grant, connect_now):
        previous_mode = self.setup_mode
        try:
            self.wifi.save(networks)
            if connect_now:
                time.sleep(1.5)  # Return HTTP 202 before switching the single radio.
                if not self.args.dry_run and previous_mode == "hotspot":
                    subprocess.run(["nmcli", "connection", "down", HOTSPOT_NAME], capture_output=True, timeout=12)
                self.message = "正在嘗試已儲存網路，教室網路最後嘗試…"
                if not self.wifi.connect_saved():
                    raise RuntimeError("所有已儲存 Wi-Fi 都無法連線，請檢查名稱與密碼。")
            elif not self.wifi.current():
                raise RuntimeError("目前 Wi-Fi 已中斷，請改用裝置暫時熱點。")
            self.status = "confirming"
            if not self.state.get("passengerId"):
                self.message = "Wi-Fi 已儲存，正在確認旅客綁定…"
                payload = {"deviceId": self.state["deviceId"], "deviceSecret": self.state["deviceSecret"],
                           "setupCode": self.state["setupCode"], "grant": grant}
                for attempt in range(6):
                    try:
                        data = {"passengerId": "PAX-DRYRUN01"} if self.args.dry_run else cloud_post('/devices/complete', payload)
                        break
                    except urllib.error.HTTPError as error:
                        if error.code not in (429, 500, 502, 503, 504) or attempt == 5:
                            raise
                    except (OSError, urllib.error.URLError):
                        if attempt == 5:
                            raise
                    time.sleep(min(3 * (attempt + 1), 12))
                self.state["passengerId"] = data["passengerId"]
                self.apply_cloud_identity({**data, "status": "paired"})
                self.online = True
            else:
                # Network recovery must never call /devices/complete or replace the owner.
                self.check_cloud()
            with self.lock:
                self.reconfiguring = False
                self.status = "paired"
                self.message = "網路已儲存。未在附近的 Wi-Fi 將於下次開機嘗試，密碼尚未驗證。"
                self.state.pop("setupCode", None)
                self.state.pop("hotspotPassword", None)
                self.persist()
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            # Never print commands / payloads / password-bearing exceptions.
            self.online = False
            if isinstance(error, urllib.error.HTTPError) and error.code in (400, 401, 403, 409):
                self.state["setupExpires"] = 0
                self.message = "配對授權已失效或衝突，請重新掃碼。已儲存 Wi-Fi 仍保留。"
            else:
                self.message = str(error) if isinstance(error, RuntimeError) else "設定尚未完成，請檢查網路後重試。已儲存的 Wi-Fi 仍保留。"
            if previous_mode == "lan" and self.wifi.current():
                self.status = "ready"
            else:
                self.start_hotspot()
        finally:
            self.busy = False

    def check_cloud(self):
        try:
            data = {"status": "paired"} if self.args.dry_run else cloud_post('/devices/status', {
                "deviceId": self.state["deviceId"], "deviceSecret": self.state["deviceSecret"]})
            self.online = True
            if self.apply_cloud_identity(data) == "unpaired":
                self.ensure_setup_code()
                self.status = "ready"
            else:
                self.message = ""
        except (OSError, ValueError) as error:
            self.online = False
            self.message = "Wi-Fi 已連線，但雲端服務暫時無法連接；旅客綁定已保留，稍後重試。"
            print("Cloud status unavailable: " + type(error).__name__, file=sys.stderr, flush=True)

    def initialize_network(self):
        with self.lock:
            if self.busy:
                return
            self.busy = True
        try:
            self.status = "connecting"
            self.message = "正在依序嘗試已儲存網路，教室網路最後嘗試…"
            network = self.wifi.connect_saved()
            if network:
                self.local_network = network
                self.setup_mode = "lan"
                if self.state.get("passengerId") and not self.reconfiguring:
                    self.check_cloud()
                    self.status = "paired" if self.state.get("passengerId") else "ready"
                else:
                    self.ensure_setup_code()
                    self.status = "ready"
                    self.message = "手機請連上相同 Wi-Fi，再掃碼設定。"
            else:
                self.reconfiguring = bool(self.state.get("passengerId"))
                self.start_hotspot()
                self.message = "已儲存網路皆無法連線，請掃碼更新 Wi-Fi。旅客綁定保留。"
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            self.reconfiguring = bool(self.state.get("passengerId"))
            self.start_hotspot()
            self.message = "Wi-Fi 連線失敗，請使用裝置暫時熱點重新設定。旅客綁定保留。"
        finally:
            self.busy = False

    def monitor_once(self):
        if self.busy or self.args.dry_run:
            return
        # Leave AP setup alone. Keep LAN QR addresses current after DHCP changes.
        if self.reconfiguring or not self.state.get("passengerId"):
            if self.setup_mode == "lan":
                network = self.wifi.current()
                if not network:
                    self.initialize_network()
                elif network != self.local_network:
                    self.local_network = network
                    self.state["setupRevision"] = self.state.get("setupRevision", 0) + 1
                    self.persist()
            return
        if not self.wifi.current():
            self.initialize_network()
        else:
            self.check_cloud()

    def monitor(self):
        while True:
            time.sleep(15)
            self.monitor_once()


def handler_for(kiosk):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, body, kind="text/html; charset=utf-8"):
            encoded = body.encode()
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if self.path in ("/api/status", "/api/maintenance/terminal") and self.headers.get("Origin") == WINDOW_ORIGIN:
                self.send_header("Access-Control-Allow-Origin", WINDOW_ORIGIN)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "X-Sleep-Airline-Maintenance")
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()
            self.wfile.write(encoded)

        def do_OPTIONS(self):
            if (self.path == "/api/status" and self.headers.get("Origin") == WINDOW_ORIGIN) or (self.path == "/api/maintenance/terminal" and self.maintenance_allowed()):
                self.reply(204, "")
            else:
                self.reply(403, "Forbidden", "text/plain")

        def maintenance_allowed(self):
            origin = self.headers.get("Origin")
            return (ipaddress.ip_address(self.client_address[0]).is_loopback
                    and origin in (WINDOW_ORIGIN, "http://127.0.0.1:8766", "http://localhost:8766"))

        def do_GET(self):
            if self.path == "/device":
                self.reply(200, kiosk.device_page())
            elif self.path == "/setup":
                self.reply(200, kiosk.setup_page())
            elif self.path == "/offline":
                self.reply(200, kiosk.offline_page())
            elif self.path == "/api/status":
                self.reply(200, json.dumps({
                    "paired": bool(kiosk.state.get("passengerId")) and not kiosk.reconfiguring and kiosk.status != "starting",
                    "setupRequired": kiosk.reconfiguring or not bool(kiosk.state.get("passengerId")),
                    "setupMode": kiosk.setup_mode,
                    "status": kiosk.status, "message": kiosk.message, "online": kiosk.online, "busy": kiosk.busy,
                    "bridgeExitCode": kiosk.bridge.poll() if kiosk.bridge else None,
                    "setupRevision": kiosk.state.get("setupRevision", 0),
                    "setupCodeChanged": time.time() >= kiosk.state.get("setupExpires", 0)
                        and (kiosk.reconfiguring or not kiosk.state.get("passengerId")),
                }), "application/json")
            else:
                self.reply(404, "Not found", "text/plain")

        def do_POST(self):
            if self.path == "/api/maintenance/terminal":
                if not self.maintenance_allowed() or self.headers.get("X-Sleep-Airline-Maintenance") != "1":
                    self.reply(403, '{"error":"Forbidden"}', "application/json")
                    return
                try:
                    self.reply(200, json.dumps(kiosk.open_terminal()), "application/json")
                except (OSError, RuntimeError) as error:
                    self.reply(503, json.dumps({"error": str(error)}), "application/json")
                return
            if self.path == "/api/setup-mode":
                if (not ipaddress.ip_address(self.client_address[0]).is_loopback
                        or self.headers.get("Origin") not in ("http://127.0.0.1:8766", "http://localhost:8766")
                        or self.headers.get("X-Sleep-Airline-Setup") != "1"):
                    self.reply(403, '{"error":"請在裝置螢幕切換連線方式"}', "application/json")
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 256:
                        raise ValueError
                    data = json.loads(self.rfile.read(length))
                    accepted = kiosk.select_mode(data.get("mode"))
                except (ValueError, TypeError, AttributeError):
                    accepted = False
                self.reply(202 if accepted else 409, json.dumps({"accepted": accepted}), "application/json")
                return
            if self.path != "/api/provision":
                self.reply(404, "Not found", "text/plain")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 8192:
                    raise ValueError("設定資料過大或空白")
                # No cross-origin writes: the APP navigates to /setup first.
                origin = self.headers.get("Origin")
                if origin and origin != "http://" + self.headers.get("Host", ""):
                    self.reply(403, '{"error":"請開啟裝置本機設定頁"}', "application/json")
                    return
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError("設定資料不完整")
                networks = validate_networks(data.get("networks", [{"ssid": data.get("ssid"), "password": data.get("password", "")}]))
                grant, code = data.get("grant", ""), data.get("setupCode", "")
                if not isinstance(grant, str) or len(grant) > 2048 or not isinstance(code, str):
                    raise ValueError("設定資料不完整")
                connect_now = data.get("connectNow", kiosk.setup_mode == "hotspot")
                if not isinstance(connect_now, bool):
                    raise ValueError("設定資料不完整")
                accepted = kiosk.provision("", "", grant, code, networks=networks, connect_now=connect_now)
            except (ValueError, TypeError) as error:
                self.reply(400, json.dumps({"error": str(error)}), "application/json")
                return
            if not accepted:
                self.reply(409, '{"error":"設定進行中或配對碼已失效，請查看裝置螢幕"}', "application/json")
                return
            self.reply(202, '{"status":"connecting"}', "application/json")

        def log_message(self, *_):
            pass

    return Handler


def main():
    global STATE_FILE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interface", default="wlan0")
    parser.add_argument("--fallback-ssid", default="T2-308教室", help="Classroom Wi-Fi is tried last")
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
    server = ThreadingHTTPServer(("0.0.0.0", 8766), handler_for(kiosk))
    Thread(target=kiosk.initialize_network, daemon=True).start()
    Thread(target=kiosk.monitor, daemon=True).start()
    url = "http://127.0.0.1:8766/device"
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
