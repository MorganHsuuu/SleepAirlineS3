/**
 * Regression check for Safari ceremony audio carriers.
 * Run: node scripts/check-broadcast-audio-safari-state.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class FakeAudio {
  constructor(src = '') {
    this.src = src;
    this.dataset = {};
    this.paused = true;
    this.ended = false;
    this.loop = false;
    this.volume = 1;
    this.currentTime = 0;
    this.readyState = 1;
    this.duration = 8;
    this.playCount = 0;
    this.style = {};
    this.listeners = new Map();
  }

  setAttribute() {}
  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
  load() {}
  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }
  removeEventListener(name, handler) {
    if (this.listeners.get(name) === handler) this.listeners.delete(name);
  }
  play() {
    this.paused = false;
    this.ended = false;
    this.playCount += 1;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

const elements = new Map();
const documentListeners = new Map();
const windowListeners = new Map();
const document = {
  visibilityState: 'visible',
  body: {
    appendChild(element) {
      elements.set(element.id, element);
    },
  },
  createElement(name) {
    assert.equal(name, 'audio');
    return new FakeAudio();
  },
  getElementById(id) {
    return elements.get(id) || null;
  },
  addEventListener(name, handler) {
    documentListeners.set(name, handler);
  },
};

const window = {
  document,
  navigator: {
    userAgent: 'Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 0,
  },
  addEventListener(name, handler) {
    windowListeners.set(name, handler);
  },
  SLEEP_AIRLINE_CAPTAIN_SFX: { seconds: 0.5 },
};

const context = {
  window,
  document,
  navigator: window.navigator,
  Audio: FakeAudio,
  fetch: async () => ({ ok: false, status: 404 }),
  performance,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (callback) => setTimeout(() => callback(performance.now()), 0),
  console,
  URL,
  Blob,
  Uint8Array,
  Map,
  WeakMap,
  Promise,
};
window.window = window;

vm.createContext(context);
const source = await readFile(new URL('../public/broadcast-audio.js', import.meta.url), 'utf8');
assert.match(source, /const SPEECH_BED_VOLUME = 0\.006;/);
assert.match(
  source,
  /muteCeremonyBedForSpeech\(\)[\s\S]*fadeLandingBedVolume\(SPEECH_BED_VOLUME, ms\)/,
  'speech must duck the landing bed to near silence',
);
assert.doesNotMatch(
  source,
  /muteCeremonyBedForSpeech\(\)[\s\S]{0,500}fadeLandingBedVolume\(0\.08, ms\)/,
);
assert.match(
  source,
  /const speechOpts = \{ volume: 1, tag: 'speech'/,
  'Web Audio speech gain must stay below clipping level',
);
vm.runInContext(source, context, { filename: 'public/broadcast-audio.js' });

assert.equal(window.BroadcastAudio.primeFromUserGesture(), true);

const keepalive = elements.get('ceremony-keepalive');
const captain = elements.get('ceremony-captain-gesture');
assert.ok(keepalive, 'silent keepalive element should exist');
assert.ok(captain, 'dedicated captain gesture element should exist');
assert.match(keepalive.src, /^data:audio\/wav;base64,/, 'keepalive must use silent WAV');
assert.equal(keepalive.dataset.src, keepalive.src);
assert.match(captain.src, /^data:audio\/wav;base64,/, 'captain carrier must warm with silent WAV');
assert.notEqual(captain.src, 'media/captain.mp3', 'first touch must not start captain.mp3');
assert.equal(captain.loop, true, 'captain carrier may only loop the silent WAV');

const warmPlayCount = captain.playCount;
window.BroadcastAudio.primeFromUserGesture();
assert.match(captain.src, /^data:audio\/wav;base64,/);
assert.equal(captain.playCount, warmPlayCount, 'repeated gestures must not restart the carrier');

await window.BroadcastAudio.playCaptainIntro({ handoff: true });
assert.match(captain.src, /^data:audio\/wav;base64,/, 'captain must return to silent WAV');
assert.equal(captain.dataset.src, captain.src);
assert.equal(captain.loop, true, 'only the restored silent WAV may loop');

const captainPlayCount = captain.playCount;
keepalive.pause();
keepalive.src = 'media/captain.mp3';
keepalive.dataset.src = 'media/captain.mp3';
windowListeners.get('focus')();
await Promise.resolve();

assert.match(keepalive.src, /^data:audio\/wav;base64,/, 'foreground resume must force silent WAV');
assert.equal(captain.playCount, captainPlayCount, 'foreground resume must not replay captain');
assert.match(captain.src, /^data:audio\/wav;base64,/, 'captain carrier must remain silent after foreground resume');
assert.equal(captain.paused, false, 'captain carrier keeps only the silent WAV alive');

window.BroadcastAudio.startWakeupBed('media/wakeup.mp3', 0.16);
const bed = elements.get('ceremony-bed');
assert.ok(bed, 'wakeup bed element should still exist');
assert.notEqual(bed, keepalive, 'wakeup bed must remain separate from keepalive');
assert.notEqual(bed, captain, 'wakeup bed must remain separate from captain');
assert.equal(bed.src, 'media/wakeup.mp3');
assert.equal(bed.loop, true);

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const takeoff = app.slice(app.indexOf('async function doTakeoff()'), app.indexOf('async function requestScenery('));
assert.ok(
  takeoff.indexOf('markSpeechReady(true)') < takeoff.indexOf('await leadIn;')
    && takeoff.indexOf('await leadIn;') < takeoff.indexOf('await playBroadcast('),
  'takeoff must wait for speech readiness, then captain lead-in, then generated speech',
);
const landing = app.slice(app.indexOf('async function doLand()'), app.indexOf('async function submitSleepReport('));
assert.ok(
  landing.indexOf('await delay(1000)') < landing.indexOf('playCaptainIntro?.(')
    && landing.indexOf('playCaptainIntro?.(') < landing.indexOf('playApproachClip?.(')
    && landing.indexOf('playApproachClip?.(') < landing.indexOf('startWakeupBed?.('),
  'landing must wait one second, play captain, play approach voice, then fade in music',
);

console.log('✓ Safari keepalive stays silent');
console.log('✓ captain uses a dedicated one-shot gesture element');
console.log('✓ foreground resume cannot replay captain');
console.log('✓ wakeup bed and ceremony ordering remain intact');
