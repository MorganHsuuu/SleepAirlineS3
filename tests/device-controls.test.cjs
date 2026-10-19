const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../public/device-controls.js');

function fixture() {
  const state = { stage: 'ready', busy: false, sleepDial: false, direction: 2 };
  const actions = [];
  const messages = [];
  const errors = [];
  const sample = { version: 2, session: 'one', takeoffCount: 0, landCount: 0,
    takeoffClosed: false, landClosed: false, direction: 2 };
  const controller = createController({
    getState: () => state,
    setDirection: (value) => { state.direction = value; actions.push(['direction', value]); },
    setSleep: (value) => { actions.push(['sleep', value]); },
    confirm: () => { actions.push(['confirm']); },
    takeoff: () => { actions.push(['takeoff', state.direction]); state.stage = 'takeoff'; state.busy = true; },
    land: () => { actions.push(['land']); state.stage = 'landing'; state.busy = true; },
    notify: (message) => messages.push(message),
    setError: (kind, message) => errors.push([kind, message]),
  });
  return { state, actions, messages, errors, controller,
    send: (changes = {}) => { Object.assign(sample, changes); controller.accept(sample); } };
}

test('startup with magnets already present does not create a flight', () => {
  const f = fixture();
  f.send({ takeoffClosed: true, takeoffCount: 8 });
  f.send();
  assert.deepEqual(f.actions, []);
});
test('knob sets the departure direction before a fresh takeoff; held/released magnet never lands', () => {
  const f = fixture();
  f.send();
  f.send({ direction: 6, takeoffClosed: true, takeoffCount: 1 });
  f.send({ direction: 0 });
  f.state.stage = 'cruise'; f.state.busy = false;
  f.send({ takeoffClosed: false });
  assert.deepEqual(f.actions, [['direction', 6], ['takeoff', 6]]);
});
test('a landing pulse during takeoff lands immediately', () => {
  const f = fixture();
  f.send(); f.send({ takeoffCount: 1 });
  f.send({ landCount: 1 });
  assert.deepEqual(f.actions, [['takeoff', 2], ['land']]);
});
test('landing before departure and takeoff during landing are not replayed later', () => {
  const f = fixture();
  f.send(); f.send({ landCount: 1 }); f.send({ takeoffCount: 1 });
  f.state.stage = 'cruise'; f.state.busy = false; f.send();
  assert.deepEqual(f.actions, [['takeoff', 2]]);
  f.send({ landCount: 2 }); f.send({ takeoffCount: 2 });
  f.state.stage = 'landed'; f.state.busy = false; f.send();
  assert.deepEqual(f.actions, [['takeoff', 2], ['land']]);
  f.send({ direction: 7, takeoffCount: 3 });
  assert.deepEqual(f.actions.slice(-2), [['direction', 7], ['takeoff', 7]]);
});
test('simultaneous reed activations are ignored until a fresh unambiguous event', () => {
  const f = fixture(); f.send();
  f.send({ takeoffCount: 1, landCount: 1, takeoffClosed: true, landClosed: true });
  f.send({ takeoffClosed: false, landClosed: false });
  assert.deepEqual(f.actions, []);
  f.send({ takeoffCount: 2, takeoffClosed: true });
  assert.deepEqual(f.actions, [['takeoff', 2]]);
  assert.equal(f.messages.length, 1);
});
test('disconnection and Python restart discard stale commands and queued landing', () => {
  const f = fixture(); f.send(); f.send({ takeoffCount: 1 }); f.send({ landCount: 1 });
  assert.deepEqual(f.actions, [['takeoff', 2], ['land']]);
  f.controller.reset();
  f.state.stage = 'cruise'; f.state.busy = false;
  f.send({ landCount: 5 }); f.send();
  f.send({ session: 'two', takeoffCount: 0, landCount: 1 }); f.send();
  f.send({ landCount: 2 });
  assert.deepEqual(f.actions.at(-1), ['land']);
});
test('a landing during takeoff does not replay after a later takeoff', () => {
  const f = fixture(); f.send(); f.send({ takeoffCount: 1 }); f.send({ landCount: 1 });
  f.state.stage = 'ready'; f.state.busy = false; f.send(); f.send({ takeoffCount: 2 });
  f.state.stage = 'cruise'; f.state.busy = false; f.send();
  assert.deepEqual(f.actions, [['takeoff', 2], ['land'], ['takeoff', 2]]);
});
test('ADC failure preserves heading and reed controls; invalid payloads are rejected', () => {
  const f = fixture(); f.send();
  f.send({ direction: null }); f.send({ takeoffCount: 1 });
  assert.deepEqual(f.actions, [['takeoff', 2]]);
  assert.equal(f.messages.length, 1);
  assert.match(f.errors.at(-1)[1], /ADS1115/);
  f.send({ direction: 2 });
  assert.deepEqual(f.errors.at(-1), ['adc', '']);
  assert.throws(() => f.send({ direction: 99 }));
  assert.throws(() => f.send({ version: 1, direction: 0 }));
});
test('sleep feedback and busy state cannot change direction or start a new flight', () => {
  const f = fixture(); f.send();
  f.state.stage = 'landed'; f.state.sleepDial = true;
  f.send({ direction: 5, takeoffCount: 1 });
  assert.deepEqual(f.actions, []);
  f.state.sleepDial = false; f.send();
  assert.deepEqual(f.actions, [['direction', 5]]);
});
test('confirm button fires without blocking magnet takeoff', () => {
  const f = fixture(); f.send();
  f.send({ confirmCount: 1 });
  f.send({ takeoffCount: 1 });
  assert.deepEqual(f.actions, [['confirm'], ['takeoff', 2]]);
});
test('sleep dial uses the absolute pot position instead of wrapping extra turns', () => {
  const f = fixture(); f.send();
  f.state.stage = 'landed'; f.state.sleepDial = true;
  f.send({ position: 0.2 });
  f.send({ position: 1, direction: 7, takeoffCount: 1 });
  assert.deepEqual(f.actions, [['sleep', 20], ['sleep', 100]]);
});
test('pot position outside 0-1 is rejected', () => {
  const f = fixture(); f.send();
  assert.throws(() => f.send({ position: 1.2 }));
});
test('ordinary browsers skip the local Pi kiosk probe', () => {
  const { shouldProbeLocalBridge } = require('../public/device-controls.js');
  assert.equal(shouldProbeLocalBridge(
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0', platform: 'MacIntel' },
    { search: '' },
  ), false);
  assert.equal(shouldProbeLocalBridge(
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120.0.0.0 Mobile', platform: 'Linux armv8l' },
    { search: '' },
  ), false);
});
test('Raspberry Pi kiosk or explicit device flag still probes the local bridge', () => {
  const { shouldProbeLocalBridge } = require('../public/device-controls.js');
  assert.equal(shouldProbeLocalBridge(
    { userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36', platform: 'Linux aarch64' },
    { search: '' },
  ), true);
  assert.equal(shouldProbeLocalBridge(
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0', platform: 'MacIntel' },
    { search: '?device=1' },
  ), true);
});
