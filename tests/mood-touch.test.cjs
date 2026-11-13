const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function element() {
  const handlers = {};
  const classes = new Set();
  return { handlers, _sleepValue: 70,
    classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)) },
    addEventListener(name, fn) { (handlers[name] ||= []).push(fn); },
    emit(name, values = {}) {
      const event = { pointerId: 1, button: 0, clientX: 100, clientY: 100,
        target: { closest: () => null }, preventDefault() {}, ...values };
      for (const fn of handlers[name] || []) fn(event);
    },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, width: 1000 }; },
  };
}
function fixture() {
  let now = 1000, fired = 0, sequence = 0;
  const jobs = new Map();
  const schedule = (fn, ms, repeat = false) => { const id = ++sequence; jobs.set(id, { fn, ms, at: now + ms, repeat }); return id; };
  const glass = element(), dial = element(), document = element(), window = element();
  Object.assign(window, { setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => jobs.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => jobs.delete(id) });
  const state = { sleepDial: false, stage: 'ready', direction: 2, screenHeadingOpen: true, busy: false, sleepTouchActive: false };
  const ctx = { state, Date: { now: () => now }, window, document,
    $(id) { return { 'window-glass': glass, 'direction-dial': dial }[id]; },
    applySleepPercent(value) { dial._sleepValue = Math.max(0, Math.min(100, value)); state.sleepMoved = true; },
    setDirection(value) { state.direction = Math.max(0, Math.min(7, value)); state.headingMoved = true; },
    fireScreenFallback() { fired++; }, paintSleep() {}, };
  vm.createContext(ctx);
  for (const [start, end] of [ ['function bindScreenFallback()', 'function startDeviceControls()'],
    ['function applySleepFromDevice(', 'function bindDial()'] ]) {
    vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), ctx);
  }
  ctx.bindScreenFallback();
  return { ctx, glass, dial, state, window, document, get fired() { return fired; },
    advance(ms = 600) {
      const target = now + ms;
      while (true) {
        const next = [...jobs].filter(([, j]) => j.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, job] = next; now = job.at;
        if (job.repeat) job.at += job.ms; else jobs.delete(id);
        job.fn();
      }
      now = target;
    } };
}
function tap(f) { f.glass.emit('pointerdown'); f.glass.emit('pointerup'); f.glass.emit('lostpointercapture'); f.glass.emit('pointerleave'); }
test('three completed taps still advance ready, cruise, and mood stages', () => {
  const f = fixture();
  for (const stage of ['ready', 'cruise', 'mood']) {
    f.advance(); f.state.sleepDial = stage === 'mood'; f.state.stage = stage === 'mood' ? 'landed' : stage;
    const before = f.fired; tap(f); tap(f); assert.equal(f.fired, before); tap(f); assert.equal(f.fired, before + 1);
  }
});
test('right hold increases continuously, left hold decreases, release stops', () => {
  const f = fixture(); f.state.sleepDial = true;
  f.glass.emit('pointerdown', { clientX: 800 }); f.advance(300); assert.equal(f.dial._sleepValue, 70);
  f.advance(550); assert.equal(f.dial._sleepValue, 81);
  f.glass.emit('pointerup', { clientX: 800 }); f.advance(); assert.equal(f.dial._sleepValue, 81);
  f.glass.emit('pointerdown'); f.advance(850); assert.equal(f.dial._sleepValue, 70);
  f.glass.emit('pointerup'); assert.equal(f.fired, 0);
  f.ctx.applySleepFromDevice(10); assert.equal(f.dial._sleepValue, 70);
});
test('long hold clamps to 0 and 100', () => {
  const f = fixture(); f.state.sleepDial = true;
  f.glass.emit('pointerdown', { clientX: 800 }); f.advance(10000); assert.equal(f.dial._sleepValue, 100);
  f.glass.emit('pointerup', { clientX: 800 }); f.glass.emit('pointerdown'); f.advance(10000);
  assert.equal(f.dial._sleepValue, 0);
});
test('hold clears pending taps and requires three fresh taps after release cooldown', () => {
  const f = fixture(); f.state.sleepDial = true; tap(f); tap(f);
  f.glass.emit('pointerdown'); f.advance(600); f.glass.emit('pointerup'); tap(f);
  assert.equal(f.fired, 0); f.advance(); tap(f); tap(f); assert.equal(f.fired, 0); tap(f); assert.equal(f.fired, 1);
});
test('movement, cancellation, focus loss, and phase completion stop repeating', () => {
  for (const reason of ['move', 'cancel', 'blur', 'hidden', 'finish']) {
    const f = fixture(); f.state.sleepDial = true; f.glass.emit('pointerdown'); f.advance(600);
    const value = f.dial._sleepValue;
    if (reason === 'move') f.glass.emit('pointermove', { clientX: 150 });
    if (reason === 'cancel') f.glass.emit('pointercancel');
    if (reason === 'blur') f.window.emit('blur');
    if (reason === 'hidden') { f.document.hidden = true; f.document.emit('visibilitychange'); }
    if (reason === 'finish') f.state.sleepDial = false;
    f.advance(); assert.equal(f.dial._sleepValue, value, reason); assert.equal(f.fired, 0);
  }
});
test('drags and expired tap sequences do not advance a flight', () => {
  const f = fixture(); tap(f); tap(f); f.glass.emit('pointerdown');
  f.glass.emit('pointermove', { clientX: 150 }); f.glass.emit('pointerup', { clientX: 150 });
  f.advance(); tap(f); tap(f); assert.equal(f.fired, 0); f.advance(1000); tap(f); assert.equal(f.fired, 0);
});

test('heading long holds change direction, short taps do not, and release stops', () => {
  const f = fixture(); tap(f); tap(f); assert.equal(f.state.direction, 2);
  f.glass.emit('pointerdown', { clientX: 800 }); f.advance(349); assert.equal(f.state.direction, 2);
  f.advance(1); assert.equal(f.state.direction, 3); f.advance(600); assert.equal(f.state.direction, 4);
  f.glass.emit('pointerup', { clientX: 800 }); f.advance(); assert.equal(f.state.direction, 4);
  assert.equal(f.fired, 0); assert.equal(f.state.headingTouchActive, true);
  tap(f); tap(f); assert.equal(f.fired, 0); tap(f); assert.equal(f.fired, 1);
  f.advance(); f.glass.emit('pointerdown'); f.advance(350); assert.equal(f.state.direction, 3);
  f.glass.emit('pointerup');
});
test('heading hold stops during takeoff or busy transition and cannot land', () => {
  for (const transition of ['stage', 'busy']) {
    const f = fixture(); f.glass.emit('pointerdown'); f.advance(350);
    const direction = f.state.direction;
    if (transition === 'stage') f.state.stage = 'cruise'; else f.state.busy = true;
    f.advance(1200); assert.equal(f.state.direction, direction); assert.equal(f.fired, 0);
  }
});

test('a parked knob cannot overwrite touch mood, but turning it can take over', () => {
  const f = fixture(); f.state.sleepDial = true;
  f.ctx.applySleepFromDevice(30);
  f.glass.emit('pointerdown', { clientX: 800 }); f.advance(600); f.glass.emit('pointerup', { clientX: 800 });
  const touched = f.dial._sleepValue;
  f.ctx.applySleepFromDevice(30); f.ctx.applySleepFromDevice(31);
  assert.equal(f.dial._sleepValue, touched);
  f.ctx.applySleepFromDevice(40); assert.equal(f.dial._sleepValue, 40);
  assert.equal(f.state.sleepTouchActive, false);
});
test('holding the initial scenery does not adjust direction until the first triple-tap opens selection', () => {
  const f = fixture(); f.state.screenHeadingOpen = false;
  f.glass.emit('pointerdown'); f.advance(1500); f.glass.emit('pointerup');
  assert.equal(f.state.direction, 2); assert.equal(f.fired, 0);
});
