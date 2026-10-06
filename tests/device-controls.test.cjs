const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../public/device-controls.js');

function fixture() {
  const state = { stage: 'ready', busy: false, sleepDial: false, direction: 2 };
  const actions = [];
  const messages = [];
  const sample = { version: 2, session: 'one', takeoffCount: 0, landCount: 0,
    takeoffClosed: false, landClosed: false, direction: 2 };
  const controller = createController({
    getState: () => state,
    setDirection: (value) => { state.direction = value; actions.push(['direction', value]); },
    takeoff: () => { actions.push(['takeoff', state.direction]); state.stage = 'takeoff'; state.busy = true; },
    land: () => { actions.push(['land']); state.stage = 'landing'; state.busy = true; },
    notify: (message) => messages.push(message),
  });
  return { state, actions, messages, controller,
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
test('a brief landing pulse during takeoff is retained until cruise, exactly once', () => {
  const f = fixture();
  f.send(); f.send({ takeoffCount: 1 });
  f.send({ landCount: 1 }); // pulse has already ended before HTTP poll
  f.send();
  f.state.stage = 'cruise'; f.state.busy = false;
  f.send(); f.send();
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
  f.controller.reset();
  f.state.stage = 'cruise'; f.state.busy = false;
  f.send({ landCount: 5 }); f.send();
  f.send({ session: 'two', takeoffCount: 0, landCount: 1 }); f.send();
  assert.deepEqual(f.actions, [['takeoff', 2]]);
  f.send({ landCount: 2 });
  assert.deepEqual(f.actions.at(-1), ['land']);
});
test('failed takeoff clears a pending landing for the next attempt', () => {
  const f = fixture(); f.send(); f.send({ takeoffCount: 1 }); f.send({ landCount: 1 });
  f.state.stage = 'ready'; f.state.busy = false; f.send(); f.send({ takeoffCount: 2 });
  f.state.stage = 'cruise'; f.state.busy = false; f.send();
  assert.deepEqual(f.actions, [['takeoff', 2], ['takeoff', 2]]);
});
test('ADC failure preserves heading and reed controls; invalid payloads are rejected', () => {
  const f = fixture(); f.send();
  f.send({ direction: null }); f.send({ takeoffCount: 1 });
  assert.deepEqual(f.actions, [['takeoff', 2]]);
  assert.equal(f.messages.length, 1);
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
