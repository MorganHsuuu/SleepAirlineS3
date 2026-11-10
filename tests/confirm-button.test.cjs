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
    state: { busy: false, sleepDial: false, headingMoved: true, stage: 'ready' },
    window: {
      BroadcastAudio: { primeFromUserGesture() {}, armWakeupCarrier() {} },
      FlightDeviceControls: { consumeEndpoint: (endpoint) => calls.push(['consume', endpoint]) },
    },
    showToast(message) { calls.push(['toast', message]); },
    confirmAction() { calls.push(['confirm']); },
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

test('triple-tap waits for heading then takeoff, and for mood then confirm', () => {
  const srcStart = source.indexOf('function fireScreenFallback(');
  const srcEnd = source.indexOf('\nfunction bindScreenFallback(', srcStart);
  const calls = [];
  const ctx = {
    state: { busy: false, sleepDial: false, headingMoved: false, stage: 'ready' },
    window: {
      BroadcastAudio: { primeFromUserGesture() {}, armWakeupCarrier() {} },
      FlightDeviceControls: { consumeEndpoint: (endpoint) => calls.push(['consume', endpoint]) },
    },
    showToast(message) { calls.push(['toast', message]); },
    confirmAction() { calls.push(['confirm']); },
    restart() { calls.push(['restart']); },
    doTakeoff() { calls.push(['takeoff']); },
    doLand() { calls.push(['land']); },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(srcStart, srcEnd), ctx);
  ctx.fireScreenFallback();
  assert.deepEqual(calls, [['toast', '請先轉動旋鈕，再點三下起飛']]);
  ctx.state.sleepDial = true;
  ctx.fireScreenFallback();
  assert.deepEqual(calls.at(-1), ['confirm']);
  assert.equal(calls.some((call) => call[0] === 'takeoff'), false);
  ctx.state.busy = true;
  ctx.fireScreenFallback();
  assert.equal(calls.filter((call) => call[0] === 'confirm').length, 2);
  assert.equal(calls.some((call) => call[0] === 'takeoff'), false);
});

test('heading overlay appears as soon as the knob changes direction', () => {
  const setStart = source.indexOf('function setDirection(');
  const setEnd = source.indexOf('\nfunction render(', setStart);
  const setFn = source.slice(setStart, setEnd);
  assert.match(setFn, /headingMoved = true/);
  assert.match(setFn, /showCompass/);

  const pointStart = source.indexOf('const pointToIndex = (event) => {');
  const pointEnd = source.indexOf('wrap?.addEventListener(\'touchstart\'', pointStart);
  const pointFn = source.slice(pointStart, pointEnd);
  assert.match(pointFn, /headingMoved = true/);
  assert.match(pointFn, /showCompass/);
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
