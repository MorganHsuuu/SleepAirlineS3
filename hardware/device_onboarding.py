"""Offline first-boot screen. All assets, including the QR, live on the Pi."""
import html
import json


def ble_page(device_id, qr_image, revision, preview=False):
    device = html.escape(device_id)
    preview_label = '<p class="notice">介面預覽 · 此模式不會啟動藍牙或變更網路</p>' if preview else ''
    return '''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>開始旅程 · SLEEP AIRLINE</title><style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;color:#f2efe7;background:#101817}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;padding:clamp(24px,5vw,56px);display:flex;align-items:center;justify-content:center}
main{width:100%;max-width:720px}.top{display:flex;justify-content:space-between;align-items:start;border-bottom:1px solid #46514d;padding-bottom:24px}.brand{font-size:20px;font-weight:400;letter-spacing:.28em;line-height:1.2}.edition{font:10px ui-monospace,monospace;letter-spacing:.12em;color:#b9c3bd;text-align:right;line-height:1.7}
.eyebrow{font:10px ui-monospace,monospace;letter-spacing:.2em;color:#b8c4be;margin:32px 0 12px}h1{font-size:clamp(30px,6.2vw,52px);font-weight:400;line-height:1.35;letter-spacing:.05em;margin:0 0 12px}.intro{font-size:14px;line-height:1.8;color:#b8c4be;max-width:440px;margin:0}.boarding{margin:28px 0;display:grid;grid-template-columns:minmax(150px,230px) 1fr;gap:30px;align-items:center}.qr{background:#fff;padding:12px}.qr img{width:100%;display:block}.steps{list-style:none;padding:0;margin:0;display:grid;gap:22px}.steps li{display:grid;grid-template-columns:24px 1fr;gap:9px}.steps .num{font:11px ui-monospace,monospace;color:#8d9d95;padding-top:4px}.steps strong{font-size:15px;font-weight:500;letter-spacing:.03em}.steps p{font-size:12px;line-height:1.7;color:#b8c4be;margin:5px 0 0}.status{border-top:1px solid #46514d;border-bottom:1px solid #46514d;padding:18px 0;display:flex;gap:12px;align-items:center;font-size:13px;line-height:1.7}.dot{width:7px;height:7px;flex:none;border-radius:50%;background:#c8dfce}.device{display:flex;justify-content:space-between;font:10px ui-monospace,monospace;letter-spacing:.1em;color:#a8b4ac;margin-top:18px}.note{font-size:12px;color:#b8c4be;line-height:1.7;margin-top:18px}details{margin-top:26px;font-size:12px;color:#a8b4ac}summary{cursor:pointer;padding:10px 0}details p{line-height:1.7}button{min-height:44px;font:inherit;border:1px solid #6d7f73;background:none;color:#f2efe7;padding:10px 18px;cursor:pointer}button:disabled{opacity:.4}.notice{color:#dec99c;font-size:12px}.progress-steps{font:10px ui-monospace,monospace;letter-spacing:.1em;color:#91a398;margin-top:14px}
@media(max-width:380px){body{padding:22px}.boarding{grid-template-columns:1fr;gap:20px}.qr{width:180px;margin:auto}.steps{gap:12px}.brand{font-size:16px}}
@media(max-height:640px) and (min-width:381px){body{padding:22px}.eyebrow{margin-top:20px}.boarding{margin:18px 0;grid-template-columns:170px 1fr}.top{padding-bottom:16px}h1{font-size:32px}details{margin-top:12px}}
</style></head><body><main>
<header class="top"><div class="brand">SLEEP<br>AIRLINE</div><span class="edition">FIRST CONNECTION<br>初次啟程</span></header>
<p class="eyebrow">YOUR JOURNEY STARTS HERE</p><h1>讓今晚的旅程<br>從手機開始。</h1>
<p class="intro">掃描下方 QR，取得 Sleep Airline APP。<br>設定時，手機可以繼續使用原本的網路。</p>
''' + preview_label + '''<section class="boarding"><div class="qr"><img alt="下載 APP 與裝置配對 QR Code" src="data:image/png;base64,''' + qr_image + '''"></div>
<ol class="steps"><li><span class="num">01</span><div><strong>取得手機 APP</strong><p>用手機相機掃描 QR，依下載頁指引安裝。</p></div></li>
<li><span class="num">02</span><div><strong>靠近裝置，開啟藍牙</strong><p>在 APP 允許藍牙連線。安裝後若未接續配對，請再掃一次這個 QR。</p></div></li>
<li><span class="num">03</span><div><strong>設定裝置的 Wi-Fi</strong><p>在 APP 選擇網路、輸入密碼，完成後機窗會自動開啟。</p></div></li></ol></section>
<div class="status" role="status"><span class="dot"></span><span id="progress">正在準備藍牙連線…</span></div>
<p class="progress-steps">手機連線 → 裝置連網 → 確認旅客 → 準備起飛</p>
<div class="device"><span>DEVICE</span><span>''' + device + '''</span></div>
<details><summary>其他連線方式</summary><p>若 APP 藍牙暫時無法使用，可以啟用原本的 Wi-Fi 熱點配網。手機需要暫時切換網路。</p><button id="fallback">使用 Wi-Fi 備用設定</button></details>
<p id="control-error" class="notice" role="alert"></p>
</main><script>const revision=''' + json.dumps(revision) + ''';
document.getElementById('fallback').onclick=async function(){this.disabled=true;try{const r=await fetch('/api/setup-mode',{method:'POST',headers:{'Content-Type':'application/json','X-SleepAirline-Control':'1'},body:JSON.stringify({mode:'wifi'})});if(!r.ok)throw Error('目前無法切換，請等待裝置處理完成後重試。');location.reload()}catch(e){document.getElementById('control-error').textContent=e.message;this.disabled=false}};
setInterval(async()=>{try{const s=await(await fetch('/api/status')).json();if(s.paired&&s.online){location.replace('/device');return}if(s.setupRevision!==revision||s.transport!=='ble'){location.reload();return}document.getElementById('progress').textContent=s.message||s.bleError||(s.bleReady?'已準備好，等待手機連線。':'正在準備藍牙連線…')}catch{}},2000);
</script></body></html>'''
