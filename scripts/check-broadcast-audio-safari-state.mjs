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
assert.match(source, /const SPEECH_DUCK_RATIO = 0\.05;/);
assert.match(
  source,
  /muteCeremonyBedForSpeech\(\)[\s\S]*landingVolume \* SPEECH_DUCK_RATIO/,
  'speech must duck the landing bed quieter without pausing it',
);
assert.doesNotMatch(
  source,
  /muteCeremonyBedForSpeech\(\)[\s\S]{0,400}\.pause\(\)/,
  'speech must not pause the landing bed',
);
assert.match(
  source,
  /const speechOpts = \{ volume: 1, tag: 'speech'/,
  'prepared speech still passes unit volume; playWebAudioBuffer applies SPEECH_GAIN',
);
assert.match(source, /const SPEECH_GAIN = 2\.6;/);
assert.match(
  source,
  /tag === 'speech' \? mixGain\(Number\(volume\) \* SPEECH_GAIN, SPEECH_GAIN_CAP\)/,
  'OpenAI TTS must be boosted above unit gain so it can match captain.mp3 / wakeup',
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
assert.doesNotMatch(
  app,
  /warmWakeupBed\?\.\(/,
  'shade pull must not start wakeup music before the window is fully open',
);
assert.match(
  app,
  /armWakeupCarrier\?\.\(/,
  'first touch may only unlock a silent bed carrier',
);
assert.match(
  app,
  /playLandingMusic\?\.\(`media\/\$\{nextWakeup\(\)\}`/,
  'landing music must rotate wakeup tracks after the window is open',
);
const takeoff = app.slice(app.indexOf('async function doTakeoff()'), app.indexOf('async function requestScenery('));
assert.ok(
  takeoff.indexOf('markSpeechReady(true)') < takeoff.indexOf('await leadIn;')
    && takeoff.indexOf('await leadIn;') < takeoff.indexOf('await playBroadcast('),
  'takeoff must wait for speech readiness, then captain lead-in, then generated speech',
);
const landing = app.slice(app.indexOf('async function doLand()'), app.indexOf('async function submitSleepReport('));
assert.ok(
  landing.indexOf('await delay(1000)') < landing.indexOf('playApproachClip?.(')
    && !/playCaptainIntro/.test(landing.slice(0, landing.indexOf('landingCueGen += 1'))),
  'descent plays the approach clip once; captain.mp3 waits for the arrival PA',
);
assert.match(
  landing,
  /skipCaptainIntro:\s*false/,
  'after landing, captain.mp3 must finish before the AI voice',
);
assert.match(
  landing,
  /landingCueGen \+= 1/,
  'arrival PA must cancel the descent chime so it cannot overlap the AI voice',
);
assert.match(
  landing,
  /preferWebAudio:\s*true/,
  'arrival speech must prefer Web Audio after the open-window gesture has expired',
);
assert.match(
  landing,
  /await Promise\.race\(\[speechPlay, delay\(90000\)\]\)/,
  'arrival chime plus speech must finish before the post-landing UI takes over',
);
assert.match(
  landing,
  /delay\(3500\)\.then\(\(\) => null\)/,
  'landing UI must not wait for the full scenery job after descent',
);
assert.match(
  landing,
  /await Promise\.race\(\[landPromise, delay\(5000\)\]\)/,
  'route arc must wait briefly for the real landing destination',
);
assert.match(
  landing,
  /delay\(9000\)/,
  'descent through clouds must hold long enough to feel like flying down',
);
assert.doesNotMatch(
  landing,
  /classList\.add\('arc-dive'\)/,
  'landing must not trigger the holy-light flash at the start of descent',
);
assert.match(
  landing,
  /classList\.add\('arrival-flash'\)/,
  'clouds must hold then flash into the arrival image',
);
assert.match(
  landing,
  /classList\.add\('is-fading'\)/,
  'descent clouds must fade out instead of snapping away',
);
assert.doesNotMatch(
  landing,
  /data = await api\('POST', '\/api\/flight\/land'/,
  'landing visuals must not wait for the land API before descent',
);
assert.doesNotMatch(
  app.slice(app.indexOf('function bindShadeGesture()')),
  /setTimeout\(\(\) => \{[\s\S]*void doTakeoff\(\);/,
  'closing the shade must start takeoff inside the user gesture',
);
assert.doesNotMatch(
  app.slice(app.indexOf('function bindShadeGesture()')),
  /addEventListener\('pointercancel', end\)/,
  'Safari pointercancel must not snap the shade closed before takeoff',
);
assert.match(
  app.slice(app.indexOf('function bindShadeGesture()')),
  /lip > height \* 0\.9/,
  'takeoff must wait until the shade is pulled nearly closed',
);
assert.doesNotMatch(
  app.slice(app.indexOf('function bindShadeGesture()')),
  /height \* 0\.52/,
  'takeoff must not start at half shade',
);
assert.match(
  source,
  /preferWebAudio = false/,
  'prepared speech can skip late Safari src-swap playback',
);

console.log('✓ Safari keepalive stays silent');
console.log('✓ captain uses a dedicated one-shot gesture element');
console.log('✓ foreground resume cannot replay captain');
console.log('✓ wakeup bed and ceremony ordering remain intact');
