const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../hardware/wifi-setup.js'), 'utf8');
function fixture(mode = 'lan') {
  const elements = {};
  const element = () => ({ disabled: false, hidden: true, value: '', checked: false, textContent: '', children: [], querySelector() {}, addEventListener(event, callback) { this[event] = callback; } });
  for (const id of ['form', 'networks', 'add', 'submit', 'connect', 'result', 'return-app']) elements[id] = element();
  elements.networks.appendChild = row => elements.networks.children.push(row);
  elements.form.querySelectorAll = selector => selector === '.password'
    ? elements.networks.children.map(r => r.fields['.password'])
    : [...Object.values(elements), ...elements.networks.children.flatMap(r => Object.values(r.fields))];
  let status = { status: 'connecting', busy: true, setupRevision: 1 }, sent = null, loseReply = false;
  const timers = [];
  const context = {
    config: { mode, paired: false, revision: 1, returnUrl: 'https://night-departures.vercel.app/?pairing=return' },
    URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval: cb => timers.push(cb),
    location: { hash: '#code=code&grant=grant', pathname: '/setup' }, history: { replaceState() {} },
    document: { getElementById: id => elements[id], createElement() {
      const row = element();
      row.fields = { '.ssid': element(), '.password': element(), '.remove': element() };
      row.querySelector = selector => row.fields[selector];
      row.remove = () => { elements.networks.children = elements.networks.children.filter(r => r !== row); };
      return row;
    } },
    async fetch(url, options) {
      if (url === '/api/provision') { sent = JSON.parse(options.body); if (loseReply) throw new TypeError('lost reply'); return { ok: true }; }
      return { ok: true, json: async () => status };
    },
  };
  vm.runInNewContext(source, context);
  return { elements, timers, get sent() { return sent; }, status(s) { status = s; }, loseReply() { loseReply = true; }, async submit() { await elements.form.submit({ preventDefault() {} }); } };
}
test('multiple future networks are submitted without switching the LAN, then passwords clear on success', async () => {
  const f = fixture(); f.elements.add.onclick();
  f.elements.networks.children[0].fields['.ssid'].value = 'Home';
  f.elements.networks.children[0].fields['.password'].value = 'secret123';
  f.elements.networks.children[1].fields['.ssid'].value = 'Backup';
  await f.submit();
  assert.equal(f.sent.networks.length, 2); assert.equal(f.sent.connectNow, false);
  assert.equal(f.elements.submit.disabled, true);
  f.status({ paired: true, setupRequired: false, busy: false, status: 'paired', message: '已儲存；尚未驗證' });
  await f.timers[0]();
  assert.equal(f.elements.networks.children[0].fields['.password'].value, '');
  assert.equal(f.elements['return-app'].hidden, false);
});
test('failed Wi-Fi attempt re-enables corrected resubmission without resetting entered SSID', async () => {
  const f = fixture('hotspot');
  assert.equal(f.elements.connect.checked, true); assert.equal(f.elements.connect.disabled, true);
  f.elements.networks.children[0].fields['.ssid'].value = 'Home';
  await f.submit();
  f.status({ setupRevision: 1, setupCodeChanged: false, busy: false, status: 'ready', message: 'Wi-Fi failed' });
  await f.timers[0]();
  assert.equal(f.elements.submit.disabled, false);
  assert.equal(f.elements.networks.children[0].fields['.ssid'].value, 'Home');
  assert.equal(f.elements.connect.disabled, true);
  f.elements.networks.children[0].fields['.password'].value = 'corrected123';
  await f.submit();
  assert.equal(f.sent.networks[0].password, 'corrected123');
});
test('lost submission reply keeps controls locked until status resolves, then allows a retry', async () => {
  const f = fixture(); f.loseReply(); await f.submit();
  assert.equal(f.elements.submit.disabled, true);
  f.status({ setupRevision: 1, busy: false, status: 'ready', message: 'Retry' });
  await f.timers[0](); assert.equal(f.elements.submit.disabled, false);
});
test('changed setup revision asks for a new scan instead of sending stale credentials', async () => {
  const f = fixture(); await f.submit();
  f.status({ setupRevision: 2, busy: false, status: 'ready' }); await f.timers[0]();
  assert.match(f.elements.result.textContent, /重新掃描/);
  assert.equal(f.elements.submit.disabled, true);
});
