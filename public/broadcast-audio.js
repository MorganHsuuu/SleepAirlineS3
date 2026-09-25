/** 機長廣播：captain.mp3 前段 → OpenAI TTS（失敗則瀏覽器 TTS） */
let audioCtx = null;
let currentAudio = null;
let flightSfxAudio = null;
let landingAudio = null;
let landingVolume = 0.22;

const CAPTAIN_SFX = {
  url: 'media/captain.mp3',
  seconds: 7,
  volume: 0.95,
};

const TAKEOFF_SFX_URL = 'media/takeoff.mp3';

/** 儀式音景切換：wakeup ↔ captain ↔ TTS */
const CEREMONY_CROSSFADE_MS = 900;
const CEREMONY_RESTORE_MS = 1400;
/** wakeup 在機長／著陸時壓低但不切斷（相對 landingVolume） */
const WAKEUP_DUCK_RATIO = {
  captain: 0.12,
  approach: 0.07,
  afterLanding: 0.38, // landing.mp4 結束後、抵達面板前
};

function softWakeupVolume(ratio = WAKEUP_DUCK_RATIO.captain) {
  const r = Math.max(0.04, Math.min(0.5, ratio));
  // 著陸底床上限壓低，避免蓋過機長／著陸音效
  const cap = ratio >= WAKEUP_DUCK_RATIO.afterLanding ? 0.1 : 0.045;
  return clampVolume(Math.max(0.01, Math.min(landingVolume * r, cap)));
}

/** 極短無聲 WAV：解鎖 HTML Audio 自動播放，不可聽見（勿用 captain.mp3 loop） */
const SILENT_KEEPALIVE =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

async function ensureAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  // iOS 鎖屏／切出去回來後可能是 'suspended' 或 'interrupted'，一律嘗試喚醒
  if (audioCtx.state !== 'running') {
    try { await audioCtx.resume(); } catch { /* noop */ }
  }
  return audioCtx;
}

function tone(freq, startSec, durSec, volume = 0.12) {
  const ctx = audioCtx;
  if (!ctx || ctx.state !== 'running') return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + startSec;
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + durSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durSec);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopPlayback() {
  stopCeremonyWebAudio();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (window.speechSynthesis) speechSynthesis.cancel();
}

function clampVolume(v) {
  return Math.min(1, Math.max(0, v));
}

function fadeAudioVolume(audio, from, to, ms) {
  return new Promise((resolve) => {
    if (!audio || ms <= 0) {
      if (audio) audio.volume = clampVolume(to);
      resolve();
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      // rAF 的幀時間戳可能早於註冊時的 performance.now()，p 會變負 → 音量負值會 throw
      const p = Math.min(1, Math.max(0, (now - t0) / ms));
      try {
        audio.volume = clampVolume(from + (to - from) * p);
      } catch { /* 元素可能已被釋放 */ }
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

async function playAudioElement(audio) {
  try {
    const p = audio.play();
    if (!p || typeof p.then !== 'function') return !audio.paused;
    let timedOut = false;
    await Promise.race([
      p,
      delay(2000).then(() => { timedOut = true; }),
    ]);
    if (timedOut && audio.paused) throw new Error('play timeout');
    return !audio.paused;
  } catch {
    await unlockMedia();
    try {
      const p2 = audio.play();
      if (!p2 || typeof p2.then !== 'function') return !audio.paused;
      let timedOut = false;
      await Promise.race([
        p2,
        delay(2000).then(() => { timedOut = true; }),
      ]);
      if (timedOut && audio.paused) return false;
      return !audio.paused;
    } catch {
      return false;
    }
  }
}

const bufferCache = new Map();
const activePlaybacks = new WeakMap();
let flightSfxNode = null;
let captainIntroNode = null;
let speechNode = null;

function preloadCeremonyMp3Buffers() {
  void loadAudioBuffer(CAPTAIN_SFX.url).catch(() => { });
  void loadAudioBuffer(TAKEOFF_SFX_URL).catch(() => { });
}

async function loadAudioBuffer(url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio fetch ${res.status}`);
  const ctx = await ensureAudioCtx();
  if (!ctx) throw new Error('no audio ctx');
  const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  bufferCache.set(url, buffer);
  return buffer;
}

async function decodeBlobToBuffer(blob) {
  const ctx = await ensureAudioCtx();
  if (!ctx || !blob) return null;
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

function stopCeremonyWebAudio(tag) {
  const stopNode = (node, clear) => {
    if (!node) return;
    const finish = activePlaybacks.get(node);
    if (finish) finish(true);
    else {
      try { node.source.stop(); } catch { /* noop */ }
      try { node.source.disconnect(); } catch { /* noop */ }
      try { node.gain.disconnect(); } catch { /* noop */ }
    }
    clear();
  };
  if (!tag || tag === 'flightSfx') {
    stopNode(flightSfxNode, () => { flightSfxNode = null; });
  }
  if (!tag || tag === 'captain') {
    stopNode(captainIntroNode, () => { captainIntroNode = null; });
  }
  if (!tag || tag === 'speech') {
    stopNode(speechNode, () => { speechNode = null; });
  }
}

function stopCaptainIntro() {
  stopCeremonyWebAudio('captain');
}

function detachCeremonyNode(node, tag) {
  if (tag === 'flightSfx' && flightSfxNode === node) flightSfxNode = null;
  if (tag === 'captain' && captainIntroNode === node) captainIntroNode = null;
  if (tag === 'speech' && speechNode === node) speechNode = null;
}

/** 與塔台 bibibi 相同引擎：Web Audio 播 MP3（iOS 在 API 等待後仍可用） */
async function playWebAudioBuffer(buffer, {
  volume = 1,
  loop = false,
  maxSeconds = 0,
  fadeInMs = 0,
  padSec = 0,
  tag = 'speech',
} = {}) {
  const ctx = await ensureAudioCtx();
  if (!ctx || !buffer) return false;
  // context 沒在 running 時 source.start() 不會出錯但完全無聲，計時器照樣走完
  // → 廣播會「靜音跑完」。這裡再試一次喚醒，仍失敗就回報 false，讓
  //   HTML Audio／瀏覽器 TTS 後備接手。
  if (ctx.state !== 'running') {
    try { await Promise.race([ctx.resume(), delay(400)]); } catch { /* noop */ }
    if (ctx.state !== 'running') return false;
  }

  let playBuffer = buffer;
  const pad = Math.max(0, Number(padSec) || 0);
  if (pad > 0 && !loop) {
    const padSamples = Math.floor(ctx.sampleRate * pad);
    const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length + padSamples, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      out.getChannelData(c).set(buffer.getChannelData(c), padSamples);
    }
    playBuffer = out;
  }

  if (tag === 'flightSfx') stopCeremonyWebAudio('flightSfx');
  else if (tag === 'captain') stopCeremonyWebAudio('captain');
  else stopCeremonyWebAudio('speech');

  const source = ctx.createBufferSource();
  source.buffer = playBuffer;
  source.loop = !!(loop && maxSeconds <= 0);
  const bufDur = Number.isFinite(playBuffer.duration) && playBuffer.duration > 0 ? playBuffer.duration : 0;
  const clipSec = maxSeconds > 0 && bufDur > 0 ? Math.min(maxSeconds, bufDur) : (maxSeconds > 0 ? maxSeconds : 0);
  const gain = ctx.createGain();
  const targetVol = Math.max(volume, 0.0001);
  gain.gain.value = fadeInMs > 0 ? 0.0001 : targetVol;
  source.connect(gain);
  gain.connect(ctx.destination);

  const node = { source, gain, tag };
  if (tag === 'flightSfx') flightSfxNode = node;
  else if (tag === 'captain') captainIntroNode = node;
  else speechNode = node;

  const stopSource = () => {
    try { source.stop(); } catch { /* noop */ }
    try { source.disconnect(); } catch { /* noop */ }
    try { gain.disconnect(); } catch { /* noop */ }
  };

  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const startedAt = ctx.currentTime;
    const naturalDur = clipSec > 0 ? clipSec : (loop ? 0 : Math.max(0, playBuffer.duration || 0));
    const endAt = naturalDur > 0 ? startedAt + naturalDur + 0.18 : 0;
    const finish = (ok) => {
      if (done) return;
      done = true;
      activePlaybacks.delete(node);
      if (timer) clearTimeout(timer);
      stopSource();
      detachCeremonyNode(node, tag);
      resolve(ok);
    };
    activePlaybacks.set(node, finish);
    source.onended = () => { if (!source.loop) finish(true); };
    // 用 AudioContext 時鐘輪詢結束點，避免 wall-clock setTimeout 在 ctx 暫停／追趕時提早砍語音
    const pollEnd = () => {
      if (done || loop || endAt <= 0) return;
      if (ctx.currentTime >= endAt) {
        finish(true);
        return;
      }
      timer = setTimeout(pollEnd, 120);
    };
    if (endAt > 0) timer = setTimeout(pollEnd, 120);
    try {
      if (clipSec > 0) source.start(0, 0, clipSec);
      else source.start(0);
      if (fadeInMs > 0) {
        gain.gain.exponentialRampToValueAtTime(targetVol, ctx.currentTime + fadeInMs / 1000);
      }
      // Looping ambience/SFX should keep playing until stopCeremonyWebAudio/stopFlightSfx is called.
      if (loop) resolve(true);
    } catch {
      finish(false);
    }
  });
}

async function playMp3Url(url, opts = {}) {
  const buffer = await loadAudioBuffer(url).catch(() => null);
  if (!buffer) return false;
  return playWebAudioBuffer(buffer, opts);
}

async function playMp3Blob(blob, opts = {}) {
  const buffer = await decodeBlobToBuffer(blob).catch(() => null);
  if (!buffer) return false;
  return playWebAudioBuffer(buffer, opts);
}

async function playTimedClip(url, { seconds = 0, volume = 1, loop = false, fadeInMs = 0 } = {}) {
  if (!url) return false;
  await ensureAudioCtx();
  if (await playMp3Url(url, {
    volume,
    loop: false,
    maxSeconds: seconds > 0 ? seconds : 0,
    tag: 'captain',
    fadeInMs,
  })) return true;

  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.volume = fadeInMs > 0 ? 0 : volume;
    audio.loop = false;
    markInlineAudio(audio);
    currentAudio = audio;
    let done = false;
    let timer = null;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      audio.removeEventListener('timeupdate', onCap);
      if (currentAudio === audio) currentAudio = null;
      try { audio.pause(); } catch { /* noop */ }
      resolve(ok);
    };
    const onCap = () => {
      if (seconds > 0 && audio.currentTime >= seconds - 0.05) finish(true);
    };
    if (seconds > 0) {
      timer = setTimeout(() => finish(true), seconds * 1000 + 120);
      audio.addEventListener('timeupdate', onCap);
    }
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    playAudioElement(audio).then(async (ok) => {
      if (!ok) { finish(false); return; }
      if (fadeInMs > 0) await fadeAudioVolume(audio, 0, volume, fadeInMs);
    });
  });
}

async function playTowerSignal() {
  await playAttentionBeeps();
  await playPaChime();
}

let towerSignalActive = false;
let towerSignalTimer = null;

/** 塔台連線等待期：週期播放 bibibibi + PA 叮，直到 stopTowerSignalLoop */
function startTowerSignalLoop(intervalMs = 5200) {
  stopTowerSignalLoop();
  towerSignalActive = true;
  const tick = async () => {
    if (!towerSignalActive) return;
    await playTowerSignal();
    if (towerSignalActive) {
      towerSignalTimer = setTimeout(tick, intervalMs);
    }
  };
  tick();
}

function stopTowerSignalLoop() {
  towerSignalActive = false;
  if (towerSignalTimer) {
    clearTimeout(towerSignalTimer);
    towerSignalTimer = null;
  }
}

async function fadeOutCeremonyTag(tag, ms = 450) {
  const node = tag === 'flightSfx' ? flightSfxNode
    : tag === 'captain' ? captainIntroNode
      : speechNode;
  if (!node?.gain || !audioCtx) {
    stopCeremonyWebAudio(tag);
    return;
  }
  try {
    const g = node.gain.gain;
    const cur = Math.max(g.value, 0.0001);
    g.cancelScheduledValues(0);
    g.setValueAtTime(cur, audioCtx.currentTime);
    g.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    await delay(ms);
  } catch { /* noop */ }
  stopCeremonyWebAudio(tag);
}

async function fadeLandingBedVolume(target, ms = CEREMONY_CROSSFADE_MS) {
  if (!landingAudio) return;
  const want = clampVolume(target);
  // 壓低時保持播放；只有真正要靜音才 pause
  if (want > 0.001 && landingAudio.paused) {
    landingPausedForCaptain = false;
    try {
      landingAudio.volume = Math.min(landingAudio.volume || 0, want);
      await Promise.race([landingAudio.play(), delay(900)]);
    } catch { /* noop */ }
  }
  const vol = landingAudio.volume;
  if (Math.abs(vol - want) < 0.002) {
    if (want <= 0.001 && !landingAudio.paused) {
      landingPausedForCaptain = true;
      landingAudio.pause();
    }
    return;
  }
  await fadeAudioVolume(landingAudio, vol, want, ms);
  if (want <= 0.001 && landingAudio && !landingAudio.paused) {
    landingPausedForCaptain = true;
    landingAudio.pause();
  }
}

async function playCaptainIntro({ fadeInMs = 0 } = {}) {
  const cfg = { ...CAPTAIN_SFX, ...window.SLEEP_AIRLINE_CAPTAIN_SFX };
  if (!cfg.url) return false;
  const sec = Math.max(0.5, Math.min(30, Number(cfg.seconds) || 7));
  // 直接等 playTimedClip（內建 Web Audio → HTML Audio 後備與秒數上限）。
  // 舊寫法 Promise.race(play, delay) 在 play 失敗時會立刻結束，整段 captain.mp3 被跳過。
  const ok = await playTimedClip(cfg.url, {
    seconds: sec,
    volume: cfg.volume ?? 0.95,
    loop: false,
    fadeInMs,
  });
  await fadeOutCeremonyTag('captain', Math.min(450, fadeInMs || 450));
  return ok;
}

/** captain.mp3 起播時：wakeup 同步漸弱至無聲 */
async function crossfadeLandingToCaptainIntro() {
  const cfg = { ...CAPTAIN_SFX, ...window.SLEEP_AIRLINE_CAPTAIN_SFX };
  const ms = Math.max(1100, CEREMONY_CROSSFADE_MS);
  if (!cfg.url) {
    await fadeLandingBedVolume(0, ms);
    return false;
  }
  stopCaptainIntro();
  resetKeepAliveToSilent();
  await ensureAudioCtx();
  const [, ok] = await Promise.all([
    fadeLandingBedVolume(0, ms),
    playCaptainIntro({ fadeInMs: ms }),
  ]);
  return ok;
}

async function playFlightSfx(url, { loop = true, volume = 0.65, fadeInMs = 700 } = {}) {
  stopFlightSfx({ fade: false });
  if (!url) return false;
  await ensureAudioCtx();
  if (await playMp3Url(url, {
    volume,
    loop,
    fadeInMs,
    tag: 'flightSfx',
  })) return true;

  await unlockMedia();
  const audio = new Audio(url);
  audio.loop = loop;
  audio.volume = 0;
  markInlineAudio(audio);
  flightSfxAudio = audio;
  audio.onerror = () => { if (flightSfxAudio === audio) flightSfxAudio = null; };
  try {
    await Promise.race([audio.play(), delay(1200)]);
    await fadeAudioVolume(audio, 0, volume, fadeInMs);
    return true;
  } catch {
    flightSfxAudio = null;
    return false;
  }
}

async function stopFlightSfx({ fade = true, ms = 550 } = {}) {
  if (flightSfxNode) {
    const { source, gain } = flightSfxNode;
    if (fade && gain && audioCtx) {
      try {
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
        await delay(ms);
      } catch { /* noop */ }
    }
    try { source.stop(); } catch { /* noop */ }
    flightSfxNode = null;
  }
  if (!flightSfxAudio) return;
  const audio = flightSfxAudio;
  const vol = audio.volume;
  flightSfxAudio = null;
  if (fade && vol > 0) await fadeAudioVolume(audio, vol, 0, ms);
  audio.pause();
  try { audio.currentTime = 0; } catch { /* noop */ }
  audio.src = '';
}

async function playLandingMusic(url, opts = {}) {
  if (!url) return false;
  await stopLandingMusic({ fade: false });
  await unlockMedia();
  landingVolume = typeof opts.volume === 'number' ? opts.volume : 0.22;
  const audio = new Audio(url);
  audio.loop = opts.loop !== false;
  audio.volume = 0;
  audio.playsInline = true;
  audio.preload = 'auto';
  landingAudio = audio;
  audio.onerror = () => { if (landingAudio === audio) landingAudio = null; };
  const ok = await playAudioElement(audio);
  if (!ok) {
    if (landingAudio === audio) landingAudio = null;
    return false;
  }
  // 維持 keepalive，避免 iOS 在長 API 等待後無法播 TTS
  await fadeAudioVolume(audio, 0, landingVolume, opts.fadeInMs ?? 1600);
  return true;
}

let landingFadeOutPromise = null;

async function stopLandingMusic({ fade = true, ms = 900 } = {}) {
  landingFadeOutPromise = null;
  const audio = landingAudio;
  if (!audio) return;
  landingAudio = null;
  const vol = audio.volume;
  if (fade && vol > 0.001) await fadeAudioVolume(audio, vol, 0, ms);
  audio.pause();
  try { audio.currentTime = 0; } catch { /* noop */ }
  audio.src = '';
}

/** landing.mp4 播完：takeoff 音效漸弱 + wakeup 漸強（同一時間軸） */
async function crossfadeApproachSfxToWakeup({
  sfxFadeMs = CEREMONY_CROSSFADE_MS,
  musicFadeMs = CEREMONY_RESTORE_MS,
} = {}) {
  await Promise.all([
    stopFlightSfx({ fade: true, ms: sfxFadeMs }),
    resumeLandingMusicAfterApproach({ fadeMs: musicFadeMs }),
  ]);
}

/** landing.mp4 播完：wakeup 回升到較小聲的底床（勿拉回全音量） */
async function resumeLandingMusicAfterApproach({ fadeMs = CEREMONY_RESTORE_MS } = {}) {
  landingPausedForCaptain = false;
  if (!landingAudio) return false;
  await unlockMedia();
  try {
    if (landingAudio.paused) {
      landingAudio.volume = 0;
      await Promise.race([landingAudio.play(), delay(900)]);
    }
    const target = softWakeupVolume(WAKEUP_DUCK_RATIO.afterLanding);
    await fadeAudioVolume(landingAudio, landingAudio.volume, target, fadeMs);
    return true;
  } catch {
    return false;
  }
}

/** 抵達面板出現時：wakeup 漸弱至停止 */
async function fadeOutLandingMusic({ ms = 3200 } = {}) {
  const audio = landingAudio;
  if (!audio) return;
  if (landingFadeOutPromise) return landingFadeOutPromise;
  landingFadeOutPromise = (async () => {
    const vol = audio.volume;
    await fadeAudioVolume(audio, vol, 0, ms);
    if (landingAudio === audio) {
      landingAudio = null;
      audio.pause();
      try { audio.currentTime = 0; } catch { /* noop */ }
      audio.src = '';
    }
    landingFadeOutPromise = null;
  })();
  return landingFadeOutPromise;
}

let savedFlightSfxVolume = null;
let landingPausedForCaptain = false;

async function duckCeremonyBed() {
  const jobs = [];
  if (landingAudio) {
    if (landingPausedForCaptain || landingAudio.paused) {
      landingPausedForCaptain = false;
      try {
        landingAudio.volume = 0;
        await Promise.race([landingAudio.play(), delay(900)]);
      } catch { /* noop */ }
    }
    const target = softWakeupVolume(WAKEUP_DUCK_RATIO.approach);
    jobs.push(fadeLandingBedVolume(target, 600));
  }
  if (flightSfxAudio) {
    savedFlightSfxVolume = flightSfxAudio.volume;
    jobs.push(fadeAudioVolume(
      flightSfxAudio,
      flightSfxAudio.volume,
      Math.min(savedFlightSfxVolume * 0.05, 0.012),
      600,
    ));
  }
  if (jobs.length) await Promise.all(jobs);
}

/** 機長 TTS 前：wakeup 漸弱至無聲（避免蓋過廣播） */
async function muteCeremonyBedForSpeech() {
  const ms = Math.max(1100, CEREMONY_CROSSFADE_MS);
  const jobs = [];
  if (landingAudio) {
    jobs.push(fadeLandingBedVolume(0, ms));
  }
  if (flightSfxAudio) {
    if (savedFlightSfxVolume == null) savedFlightSfxVolume = flightSfxAudio.volume;
    jobs.push(fadeAudioVolume(flightSfxAudio, flightSfxAudio.volume, 0, ms));
  }
  if (jobs.length) await Promise.all(jobs);
  if (landingAudio && landingAudio.volume <= 0.01) {
    landingPausedForCaptain = true;
    try { landingAudio.pause(); } catch { /* noop */ }
  }
}

async function restoreCeremonyBed({ ms = CEREMONY_RESTORE_MS } = {}) {
  const jobs = [];
  if (landingAudio) {
    if (landingPausedForCaptain || landingAudio.paused) {
      landingPausedForCaptain = false;
      try {
        landingAudio.volume = 0;
        await Promise.race([landingAudio.play(), delay(900)]);
      } catch { /* noop */ }
    }
    // 廣播後只回小聲底床，勿拉回全音量
    const soft = softWakeupVolume(WAKEUP_DUCK_RATIO.afterLanding);
    jobs.push(fadeAudioVolume(landingAudio, landingAudio.volume, soft, ms));
  }
  if (flightSfxAudio && savedFlightSfxVolume != null) {
    jobs.push(fadeAudioVolume(flightSfxAudio, flightSfxAudio.volume, savedFlightSfxVolume, 900));
    savedFlightSfxVolume = null;
  }
  if (jobs.length) await Promise.all(jobs);
}

function duckLandingMusic() {
  void duckCeremonyBed();
}

function restoreLandingMusic() {
  void restoreCeremonyBed();
}

let mediaUnlocked = false;
let keepAliveAudio = null;

function markInlineAudio(audio) {
  if (!audio) return;
  audio.playsInline = true;
  audio.setAttribute('playsinline', '');
  audio.setAttribute('webkit-playsinline', '');
}

/** 同步建立／喚醒 AudioContext（須在 click 堆疊內呼叫） */
function primeAudioContextSync() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') {
    try { void audioCtx.resume(); } catch { /* noop */ }
  }
}

function ensureKeepAliveElement() {
  if (keepAliveAudio) return keepAliveAudio;
  keepAliveAudio = document.getElementById('ceremony-keepalive');
  if (!keepAliveAudio) {
    keepAliveAudio = document.createElement('audio');
    keepAliveAudio.id = 'ceremony-keepalive';
    keepAliveAudio.loop = true;
    keepAliveAudio.preload = 'auto';
    keepAliveAudio.style.display = 'none';
    markInlineAudio(keepAliveAudio);
    document.body.appendChild(keepAliveAudio);
  }
  return keepAliveAudio;
}

function tryPlayKeepAlive(audio, src) {
  if (src && audio.dataset.src !== src) {
    audio.src = src;
    audio.dataset.src = src;
    audio.load();
  }
  audio.loop = true;
  audio.volume = 0.001;
  markInlineAudio(audio);
  return audio.play();
}

function resetKeepAliveToSilent() {
  const audio = keepAliveAudio || document.getElementById('ceremony-keepalive');
  if (!audio) return;
  if (audio.dataset.src === CAPTAIN_SFX.url || audio.dataset.src === TAKEOFF_SFX_URL) {
    try { audio.pause(); } catch { /* noop */ }
    tryPlayKeepAlive(audio, SILENT_KEEPALIVE);
  }
}

/** 必須同步呼叫（click / touch 當下，不可 await）— iOS 才允許後續 captain / TTS / takeoff.mp3 */
function primeFromUserGesture() {
  primeAudioContextSync();
  preloadCeremonyMp3Buffers();
  const audio = ensureKeepAliveElement();
  if (!audio.paused && audio.currentTime > 0) {
    mediaUnlocked = true;
    return true;
  }
  let playPromise;
  try {
    playPromise = tryPlayKeepAlive(audio, SILENT_KEEPALIVE);
  } catch {
    playPromise = null;
  }
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise.then(() => { mediaUnlocked = true; }).catch(() => { /* silent keepalive only */ });
    mediaUnlocked = true;
    return true;
  }
  try {
    tryPlayKeepAlive(audio, SILENT_KEEPALIVE);
    mediaUnlocked = true;
    return true;
  } catch {
    return false;
  }
}

/** 儀式期間維持無聲 loop，避免 API 等待後 Audio / TTS 被瀏覽器擋住 */
async function startMediaKeepAlive() {
  primeFromUserGesture();
  const audio = keepAliveAudio || ensureKeepAliveElement();
  if (audio && !audio.paused) return true;
  if (audio?.paused) {
    try {
      await tryPlayKeepAlive(audio, audio.dataset.src || SILENT_KEEPALIVE);
      mediaUnlocked = true;
      return true;
    } catch { /* recreate below */ }
  }
  await ensureAudioCtx();
  try {
    await tryPlayKeepAlive(ensureKeepAliveElement(), SILENT_KEEPALIVE);
    mediaUnlocked = true;
    return true;
  } catch {
    return false;
  }
}

function stopMediaKeepAlive() {
  if (!keepAliveAudio) return;
  try { keepAliveAudio.pause(); } catch { /* noop */ }
  try { keepAliveAudio.currentTime = 0; } catch { /* noop */ }
}

/** 在使用者點擊當下解鎖 Audio / Video 自動播放（避免 API 等待後被瀏覽器擋住） */
async function unlockMedia() {
  primeFromUserGesture();
  await ensureAudioCtx();
  if (keepAliveAudio && !keepAliveAudio.paused) {
    mediaUnlocked = true;
    return true;
  }
  if (await startMediaKeepAlive()) return true;
  try {
    const probe = new Audio(SILENT_KEEPALIVE);
    probe.volume = 0.001;
    probe.preload = 'auto';
    markInlineAudio(probe);
    await probe.play();
    probe.pause();
    try { probe.currentTime = 0; } catch { /* noop */ }
    mediaUnlocked = true;
    return true;
  } catch {
    await ensureAudioCtx();
    tone(440, 0, 0.04, 0.001);
    return !!audioCtx;
  }
}

function releaseCeremonyMedia() {
  stopMediaKeepAlive();
  keepAliveAudio = null;
  const el = document.getElementById('ceremony-keepalive');
  if (el) {
    try { el.pause(); } catch { /* noop */ }
    el.removeAttribute('src');
    el.load();
  }
}

async function playAttentionBeeps() {
  await ensureAudioCtx();
  tone(520, 0, 0.08, 0.09);
  await delay(200);
  tone(520, 0, 0.08, 0.09);
  await delay(200);
  tone(520, 0, 0.08, 0.09);
  await delay(280);
}

async function playPaChime() {
  await ensureAudioCtx();
  tone(880, 0, 0.2, 0.13);
  tone(660, 0.24, 0.32, 0.13);
  await delay(620);
}

function pickSpeechVoice(preferredLang) {
  const voices = speechSynthesis.getVoices();
  const lang = preferredLang || 'zh-TW';
  const prefix = lang.slice(0, 2);
  return (
    voices.find((v) => v.lang === lang)
    || voices.find((v) => v.lang?.startsWith(lang))
    || voices.find((v) => v.lang?.startsWith(prefix))
    || null
  );
}

function speakTextOnce(text) {
  return new Promise((resolve) => {
    if (!text?.trim() || !window.speechSynthesis) {
      resolve(false);
      return;
    }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    // This is only a safety net. Let speechSynthesis.onend drive normal completion,
    // otherwise landing/takeoff can advance and cancel the voice mid-sentence.
    const estMs = Math.min(180000, Math.max(45000, text.length * 650));
    const timer = setTimeout(() => finish(true), estMs);
    speechSynthesis.cancel();
    // 開頭短停頓，減少首字「歡迎」被吃掉
    const utter = new SpeechSynthesisUtterance(`… ${text}`);
    const locale = window.SleepI18n?.getLocale?.() === 'en' ? 'en' : 'zh';
    utter.lang = locale === 'en' ? 'en-US' : 'zh-TW';
    utter.rate = 0.9;
    utter.pitch = 0.95;
    utter.volume = 1;
    const voice = pickSpeechVoice(utter.lang);
    if (voice) utter.voice = voice;
    utter.onend = () => finish(true);
    utter.onerror = () => finish(false);
    speechSynthesis.speak(utter);
  });
}

async function speakText(text) {
  await unlockMedia();
  if (await speakTextOnce(text)) return true;
  await unlockMedia();
  return speakTextOnce(text);
}

async function fetchOpenAISpeechBlob(text, style) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch('/api/broadcast/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style: style || 'formal_captain' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || !blob.type.startsWith('audio/')) return null;
    return blob;
  } catch {
    return null;
  }
}

function base64ToMp3Blob(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'audio/mpeg' });
}

async function loadPreparedSpeechAudio(blob, text) {
  if (!blob?.size) return null;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = 'auto';
  markInlineAudio(audio);
  return { kind: 'openai', audio, url, blob, fallbackText: text };
}

/** 後端已生成語音時直接使用，省掉第二趟 /api/broadcast/speech */
async function prepareCaptainSpeechFromBase64(base64, text, style) {
  if (!base64) return prepareCaptainSpeech(text, style);
  try {
    const ready = await loadPreparedSpeechAudio(base64ToMp3Blob(base64), text);
    if (ready) return ready;
  } catch { /* fallback below */ }
  return prepareCaptainSpeech(text, style);
}

/** 先載入語音；OpenAI 失敗時標記可走瀏覽器 TTS。 */
async function prepareCaptainSpeech(text, style) {
  const blob = await fetchOpenAISpeechBlob(text, style);
  if (blob) {
    const ready = await loadPreparedSpeechAudio(blob, text);
    if (ready) return ready;
  }
  if (text?.trim() && window.speechSynthesis) return { kind: 'browser', text, fallbackText: text };
  return null;
}

async function playPreparedSpeech(prepared) {
  if (!prepared) return false;
  if (prepared.kind === 'browser') return speakText(prepared.text);
  stopCeremonyWebAudio('captain');
  await ensureAudioCtx();
  const blob = prepared.blob
    || (prepared.url ? await fetch(prepared.url).then((r) => r.blob()).catch(() => null) : null);
  if (blob) {
    // padSec：開頭留白，避免「歡迎」被 captain 交叉／裝置緩衝吃掉
    const ok = await playMp3Blob(blob, { volume: 1.35, tag: 'speech', fadeInMs: 0, padSec: 0.48 });
    if (ok) {
      if (prepared.url) URL.revokeObjectURL(prepared.url);
      return true;
    }
  }

  await unlockMedia();
  const { audio, url } = prepared;
  markInlineAudio(audio);
  audio.volume = 1;
  currentAudio = audio;
  await delay(420);
  const ok = await playAudioElement(audio);
  if (!ok) {
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
    return speakText(prepared.fallbackText || '');
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      audio.removeEventListener('timeupdate', onTime);
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve(ok);
    };
    const onTime = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0 && audio.currentTime >= d - 0.2) finish(true);
    };
    const textLen = prepared.fallbackText?.length || 0;
    const estMs = Number.isFinite(audio.duration) && audio.duration > 0
      ? Math.min(120000, audio.duration * 1000 + 2500)
      : Math.min(180000, Math.max(45000, textLen * 650));
    const timer = setTimeout(() => finish(true), estMs);
    audio.addEventListener('timeupdate', onTime);
    audio.onended = () => finish(true);
    audio.onerror = async () => {
      finish(await speakText(prepared.fallbackText || ''));
    };
  });
}

async function speakWithOpenAI(text, style) {
  const blob = await fetchOpenAISpeechBlob(text, style);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  return playPreparedSpeech({ kind: 'openai', audio: new Audio(url), url });
}

/**
 * 準備機長 TTS：有 base64 直接用；沒有則短等 OpenAI，逾時改走瀏覽器 TTS，
 * 避免降落後空等 /api/broadcast/speech 造成「廣播靜音空窗」。
 */
async function prepareCaptainSpeechForPlay(text, style, speechBase64) {
  if (speechBase64) {
    const ready = await prepareCaptainSpeechFromBase64(speechBase64, text, style);
    if (ready) return ready;
  }
  const openaiP = prepareCaptainSpeech(text, style);
  const raced = await Promise.race([
    openaiP,
    delay(2800).then(() => 'timeout'),
  ]);
  if (raced && raced !== 'timeout') return raced;
  if (text?.trim() && window.speechSynthesis) {
    return { kind: 'browser', text, fallbackText: text };
  }
  return openaiP;
}

async function playCaptainBroadcast(text, style, { speechBase64, restoreBed = true } = {}) {
  if (!text?.trim()) return false;
  stopPlayback();
  try {
    await unlockMedia();
    await ensureAudioCtx();
    const prepPromise = prepareCaptainSpeechForPlay(text, style, speechBase64);
    await crossfadeLandingToCaptainIntro();
    await muteCeremonyBedForSpeech();
    const prepared = await prepPromise;
    await unlockMedia();
    await ensureAudioCtx();
    // 短間隔，讓裝置緩衝就緒，減少首字「歡迎」被吃
    await delay(280);
    if (!prepared) return await speakText(text);
    const ok = await playPreparedSpeech(prepared);
    // 再等語音真正靜下來，避免 Promise 提前 resolve 就切 landing.mp4
    await waitForSpeechComplete({ maxMs: 120000, quietMs: 420 });
    await delay(280);
    return ok;
  } catch {
    stopCaptainIntro();
    await muteCeremonyBedForSpeech();
    await unlockMedia();
    return speakText(text);
  } finally {
    stopCaptainIntro();
    if (restoreBed) await restoreCeremonyBed({ ms: CEREMONY_RESTORE_MS });
  }
}

function isSpeechActive() {
  if (speechNode) return true;
  if (currentAudio && !currentAudio.paused && !currentAudio.ended) return true;
  try {
    if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) return true;
  } catch { /* noop */ }
  return false;
}

/** 等到機長語音真正播完（含瀏覽器 TTS），才允許切 landing.mp4 / takeoff.mp3 */
async function waitForSpeechComplete({ maxMs = 120000, quietMs = 400 } = {}) {
  const start = Date.now();
  let quietSince = isSpeechActive() ? null : Date.now();
  while (Date.now() - start < maxMs) {
    if (isSpeechActive()) {
      quietSince = null;
    } else if (quietSince == null) {
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMs) {
      return true;
    }
    await delay(90);
  }
  return !isSpeechActive();
}

/** 羅盤拖曳：清脆指針滴答聲（跨刻度 / 對準方位） */
function playCompassTick({ major = false } = {}) {
  if (!audioCtx) {
    primeAudioContextSync();
    if (!audioCtx) return false;
  }
  if (audioCtx.state === 'suspended') {
    try { void audioCtx.resume(); } catch { /* noop */ }
  }
  try {
    const t0 = audioCtx.currentTime;
    const dur = major ? 0.038 : 0.028;

    // 清脆短促「滴」：提高音高與音量，拖曳時在手機喇叭上也能清楚辨識
    const tick = audioCtx.createOscillator();
    const tickGain = audioCtx.createGain();
    const tickFilter = audioCtx.createBiquadFilter();
    tick.type = 'triangle';
    const fStart = major ? 560 : 480;
    const fEnd = major ? 250 : 210;
    tick.frequency.setValueAtTime(fStart, t0);
    tick.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
    tickFilter.type = 'bandpass';
    tickFilter.frequency.setValueAtTime(major ? 900 : 780, t0);
    tickFilter.Q.value = 1.4;
    const peak = major ? 0.075 : 0.052;
    tickGain.gain.setValueAtTime(0.0001, t0);
    tickGain.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    tick.connect(tickFilter);
    tickFilter.connect(tickGain);
    tickGain.connect(audioCtx.destination);
    tick.start(t0);
    tick.stop(t0 + dur + 0.01);

    // 極短高次諧波，增加「喀」的邊緣感（仍遠低於先前尖銳哔聲）
    const edge = audioCtx.createOscillator();
    const edgeGain = audioCtx.createGain();
    edge.type = 'sine';
    edge.frequency.setValueAtTime(major ? 1180 : 980, t0);
    edgeGain.gain.setValueAtTime(major ? 0.017 : 0.012, t0);
    edgeGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.012);
    edge.connect(edgeGain);
    edgeGain.connect(audioCtx.destination);
    edge.start(t0);
    edge.stop(t0 + 0.015);
    return true;
  } catch {
    return false;
  }
}

if (window.speechSynthesis) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener('voiceschanged', () => speechSynthesis.getVoices());
}

/** iOS／背景回來後：喚醒 AudioContext，避免廣播突然無聲 */
function resumeAudioOnForeground() {
  if (document.visibilityState && document.visibilityState !== 'visible') return;
  void ensureAudioCtx();
  if (keepAliveAudio?.paused && mediaUnlocked) {
    try { void tryPlayKeepAlive(keepAliveAudio, keepAliveAudio.dataset.src || SILENT_KEEPALIVE); } catch { /* noop */ }
  }
}
document.addEventListener('visibilitychange', resumeAudioOnForeground);
window.addEventListener('pageshow', resumeAudioOnForeground);
window.addEventListener('focus', resumeAudioOnForeground);

window.BroadcastAudio = {
  playCaptainBroadcast,
  playCaptainIntro,
  stopCaptainIntro,
  prepareCaptainSpeech,
  playTowerSignal,
  startTowerSignalLoop,
  stopTowerSignalLoop,
  playCompassTick,
  speakText,
  stopPlayback,
  isSpeechActive,
  waitForSpeechComplete,
  primeFromUserGesture,
  unlockMedia,
  startMediaKeepAlive,
  stopMediaKeepAlive,
  releaseCeremonyMedia,
  playFlightSfx,
  stopFlightSfx,
  playLandingMusic,
  stopLandingMusic,
  resumeLandingMusicAfterApproach,
  crossfadeApproachSfxToWakeup,
  fadeOutLandingMusic,
  duckCeremonyBed,
  restoreCeremonyBed,
};
