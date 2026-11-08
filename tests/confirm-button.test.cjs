const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const start = source.indexOf('function syncConfirmButton(');
const end = source.indexOf('\nfunction confirmAction(', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

function fixture() {
  const button = { hidden: true, disabled: true };
  const label = { textContent: '' };
  const state = { sleepDial: false, sleepMoved: false, stage: 'ready', busy: false };
  const ctx = {
    state,
    $(id) { return id === 'btn-confirm' ? button : id === 'confirm-label' ? label : null; },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return { ctx, state, button, label };
}

test('heading confirm stays hidden on the ready window', () => {
  const f = fixture();
  f.ctx.syncConfirmButton();
  assert.equal(f.button.hidden, true);
});

test('triple-tap takeoff consumes the takeoff reed so it cannot fire twice', () => {
  const srcStart = source.indexOf('function fireScreenFallback(');
  const srcEnd = source.indexOf('\nfunction bindScreenFallback(', srcStart);
  const calls = [];
  const ctx = {
    state: { busy: false, sleepDial: false, stage: 'ready' },
    window: {
      BroadcastAudio: { primeFromUserGesture() {}, armWakeupCarrier() {} },
      FlightDeviceControls: { consumeEndpoint: (endpoint) => calls.push(['consume', endpoint]) },
    },
    restart() { calls.push(['restart']); },
    doTakeoff() { calls.push(['takeoff']); },
    doLand() { calls.push(['land']); },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(srcStart, srcEnd), ctx);
  ctx.fireScreenFallback();
  assert.deepEqual(calls, [['consume', 'takeoff'], ['takeoff']]);
  ctx.state.stage = 'cruise';
  ctx.fireScreenFallback();
  assert.deepEqual(calls.at(-2), ['consume', 'land']);
  assert.deepEqual(calls.at(-1), ['land']);
});

test('heading overlay waits for the knob then the confirm button', () => {
  const setStart = source.indexOf('function setDirection(');
  const setEnd = source.indexOf('\nfunction render(', setStart);
  const setFn = source.slice(setStart, setEnd);
  assert.match(setFn, /headingMoved = true/);
  assert.doesNotMatch(setFn, /showCompass/);

  const pointStart = source.indexOf('const pointToIndex = (event) => {');
  const pointEnd = source.indexOf('wrap?.addEventListener(\'touchstart\'', pointStart);
  const pointFn = source.slice(pointStart, pointEnd);
  assert.match(pointFn, /headingMoved = true/);
  assert.doesNotMatch(pointFn, /showCompass/);

  const confirmStart = source.indexOf('function confirmAction(');
  const confirmEnd = source.indexOf('\nfunction applyWindowOnly(', confirmStart);
  const confirmFn = source.slice(confirmStart, confirmEnd);
  assert.match(confirmFn, /請先轉動旋鈕，再按確認航向/);
  assert.match(confirmFn, /showCompass/);
});

test('mood confirm appears only after the sleep dial is open', () => {
  const f = fixture();
  f.state.sleepDial = true;
  f.state.sleepMoved = false;
  f.ctx.syncConfirmButton();
  assert.equal(f.button.hidden, false);
  assert.equal(f.button.disabled, true);
  assert.equal(f.label.textContent, '先轉動旋鈕');
  f.state.sleepMoved = true;
  f.ctx.syncConfirmButton();
  assert.equal(f.button.disabled, false);
  assert.equal(f.label.textContent, '確認心情');
});
