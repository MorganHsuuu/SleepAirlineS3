const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const rendered = spawnSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('device_kiosk', 'hardware/device_kiosk.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
kiosk = module.Kiosk.__new__(module.Kiosk)
kiosk.state = {'setupRevision': 1}
print(kiosk.setup_page())
`], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
assert.equal(rendered.status, 0, rendered.stderr);
const script = rendered.stdout.match(/<script>([\s\S]*?)<\/script>/)[1];

function page() {
  const button = { disabled: false, textContent: '' };
  const elements = { result: { textContent: '' }, 'return-app': { hidden: true }, ssid: { value: 'Home' }, password: { value: 'wrong' } };
  let submit, tick;
  elements.form = { querySelector: () => button, addEventListener: (_, handler) => { submit = handler; } };
  const responses = [], requests = [];
  const context = {
    document: { getElementById: id => elements[id] },
    location: { hash: '#grant=token&code=setup-code', pathname: '/setup' }, history: { replaceState() {} },
    URLSearchParams, AbortController, setTimeout: () => 1, clearTimeout() {},
    setInterval: fn => { tick = fn; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, 'unexpected request');
      return { ok: next.ok !== false, json: async () => next };
    },
  };
  vm.runInNewContext(script, context);
  return { elements, button, responses, requests, submit: () => submit({ preventDefault() {} }), poll: async () => { tick(); await new Promise(resolve => setImmediate(resolve)); } };
}

test('wrong password restores the same form and sends corrected credentials without reloading', async () => {
  const p = page();
  p.responses.push({ status: 'connecting' });
  await p.submit();
  assert.equal(p.button.disabled, true);
  await p.submit();
  assert.equal(p.requests.length, 1);
  p.responses.push(new Error('AP temporarily disconnected'));
  await p.poll();
  assert.equal(p.button.disabled, true);
  p.responses.push({ status: 'ready', busy: false, paired: false, setupRevision: 1, message: 'Wi-Fi 密碼錯誤' });
  await p.poll();
  assert.equal(p.button.disabled, false);
  assert.equal(p.elements.password.value, 'wrong');
  p.elements.password.value = 'corrected';
  p.responses.push({ status: 'connecting' });
  await p.submit();
  const payload = JSON.parse(p.requests.at(-1).options.body);
  assert.equal(payload.password, 'corrected');
  assert.equal(payload.grant, 'token');
  assert.equal(payload.setupCode, 'setup-code');
  p.responses.push({ status: 'paired', paired: true, busy: false, setupRevision: 1 });
  await p.poll();
  assert.equal(p.button.disabled, true);
  assert.equal(p.elements['return-app'].hidden, false);
});

test('lost submit response recovers from device status, but expired codes require rescan', async () => {
  const p = page();
  p.responses.push(new Error('response lost'));
  await p.submit();
  p.responses.push({ status: 'ready', busy: false, paired: false, setupRevision: 1 });
  await p.poll();
  assert.equal(p.button.disabled, false);
  p.responses.push({ status: 'connecting' });
  await p.submit();
  p.responses.push({ status: 'ready', busy: false, paired: false, setupRevision: 2 });
  await p.poll();
  assert.equal(p.button.disabled, true);
  assert.match(p.elements.result.textContent, /重新掃描/);
});
