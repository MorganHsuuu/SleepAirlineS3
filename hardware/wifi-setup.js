// Loaded inline by the device's HTTP page. Passwords never enter APP/cloud storage.
const params = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', location.pathname);
const form = document.getElementById('form');
const rows = document.getElementById('networks');
const add = document.getElementById('add');
const submit = document.getElementById('submit');
const connect = document.getElementById('connect');
const result = document.getElementById('result');
const returnApp = document.getElementById('return-app');
returnApp.href = config.returnUrl;
connect.checked = config.mode === 'hotspot';
connect.disabled = config.mode === 'hotspot';
let waiting = false, polling = false;
function addNetwork() {
  if (rows.children.length >= 10) return;
  const row = document.createElement('section');
  row.className = 'network-row';
  row.innerHTML = '<h2>日常 Wi-Fi</h2><label>網路名稱 / SSID<input class="ssid" required maxlength="32" autocomplete="off"></label><label>網路密碼（開放網路可留白）<input class="password" type="password" autocomplete="new-password"></label><button type="button" class="remove">移除此組網路 ×</button>';
  row.querySelector('.remove').onclick = () => { if (!waiting && rows.children.length > 1) { row.remove(); add.disabled = false; } };
  rows.appendChild(row);
  add.disabled = rows.children.length >= 10;
}
add.onclick = addNetwork;
addNetwork();
function controls(disabled) {
  form.querySelectorAll('button,input').forEach(item => { item.disabled = disabled; });
  if (!disabled) { connect.disabled = config.mode === 'hotspot'; add.disabled = rows.children.length >= 10; }
}
function retry(message) {
  waiting = false;
  controls(false);
  submit.textContent = '修正後重新送出 →';
  returnApp.hidden = true;
  result.textContent = message;
}
async function request(url, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try { return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' }); }
  finally { clearTimeout(timer); }
}
async function checkStatus() {
  if (!waiting || polling) return;
  polling = true;
  try {
    const response = await request('/api/status');
    if (!response.ok) return;
    const status = await response.json();
    if (status.paired && !status.setupRequired && !status.busy) {
      waiting = false;
      form.querySelectorAll('.password').forEach(input => { input.value = ''; });
      result.textContent = status.message || '網路已儲存，旅客綁定已確認。未在附近的網路尚未測試。';
      if (!config.paired) returnApp.hidden = false;
    } else if (status.setupRevision !== config.revision || status.setupCodeChanged) {
      waiting = false;
      result.textContent = '設定碼已更新或過期，請重新掃描裝置螢幕上的 QR。';
    } else if (!status.busy && ['ready', 'error'].includes(status.status)) {
      retry(status.message || '連線未完成，請修正 Wi-Fi 後重新送出。');
    } else { result.textContent = status.message || '裝置正在設定，請稍候…'; }
  } catch {
    result.textContent = '裝置可能正在切換網路。請查看裝置螢幕；若恢復暫時熱點，連回後可在此頁修正重送。';
    if (!config.paired) returnApp.hidden = false;
  } finally { polling = false; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (waiting) return;
  const networks = Array.from(rows.children, row => ({
    ssid: row.querySelector('.ssid').value, password: row.querySelector('.password').value,
  }));
  const connectNow = connect.checked;
  waiting = true;
  controls(true);
  result.textContent = '正在將網路資料送給裝置…';
  try {
    const response = await request('/api/provision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ networks, connectNow, grant: params.get('grant') || '', setupCode: params.get('code') || '' }),
    });
    if (!response.ok) { const data = await response.json(); retry(data.error || '無法開始設定'); return; }
    result.textContent = connectNow ? '正在連線；請看裝置螢幕確認結果。' : '網路已送出，正在確認綁定；目前的 Wi-Fi 會保持連線。';
    await checkStatus();
  } catch { result.textContent = '未收到回覆，正在確認裝置狀態。請勿重複送出。'; await checkStatus(); }
});
setInterval(checkStatus, 2500);
