'use strict';

// S2 direction and audio behavior are retained. The independent visual prototype
// stays in preview mode until the new data connections are ready.
const FRONTEND_PREVIEW_ONLY = false;
const $ = (id) => document.getElementById(id);
const directions = [
  { key: 'northbound', name: '向北', angle: 0 },
  { key: 'northeast', name: '東北', angle: 45 },
  { key: 'eastbound', name: '向東', angle: 90 },
  { key: 'southeast', name: '東南', angle: 135 },
  { key: 'southbound', name: '向南', angle: 180 },
  { key: 'southwest', name: '西南', angle: 225 },
  { key: 'westbound', name: '向西', angle: 270 },
  { key: 'northwest', name: '西北', angle: 315 },
];
const tracks = ['wakeup1.mp3', 'wakeup2.mp3', 'wakeup3.mp3', 'wakeup4.mp3'];
/** Standby photo inside the oval window when OpenAI scenery is skipped or fails. */
const ARRIVAL_FALLBACK = 'images/arrival-fallback.jpg';
let wakeupIndex = Number(localStorage.getItem('sleepAirlineS3Wakeup') || 0) || 0;
function nextWakeup() {
  const file = tracks[wakeupIndex % tracks.length];
  wakeupIndex = (wakeupIndex + 1) % tracks.length;
  localStorage.setItem('sleepAirlineS3Wakeup', String(wakeupIndex));
  return file;
}
const demoCities = [
  { name: '東京', code: 'TYO', country: '日本', lat: 35.6762, lon: 139.6503 },
  { name: '大阪', code: 'OSA', country: '日本', lat: 34.6937, lon: 135.5023 },
  { name: '首爾', code: 'SEL', country: '韓國', lat: 37.5665, lon: 126.978 },
  { name: '上海', code: 'SHA', country: '中國', lat: 31.2304, lon: 121.4737 },
  { name: '香港', code: 'HKG', country: '中國', lat: 22.3193, lon: 114.1694 },
  { name: '馬尼拉', code: 'MNL', country: '菲律賓', lat: 14.5995, lon: 120.9842 },
  { name: '曼谷', code: 'BKK', country: '泰國', lat: 13.7563, lon: 100.5018 },
  { name: '新加坡', code: 'SIN', country: '新加坡', lat: 1.3521, lon: 103.8198 },
  { name: '胡志明市', code: 'SGN', country: '越南', lat: 10.8231, lon: 106.6297 },
  { name: '札幌', code: 'CTS', country: '日本', lat: 43.0618, lon: 141.3545 },
  { name: '沖繩', code: 'OKA', country: '日本', lat: 26.2124, lon: 127.6809 },
  { name: '臺中', code: 'RMQ', country: '臺灣', lat: 24.1477, lon: 120.6736 },
  { name: '高雄', code: 'KHH', country: '臺灣', lat: 22.6273, lon: 120.3014 },
];
const state = {
  mode: 'preview', stage: 'ready', direction: 2, sound: true,
  profile: null, activeFlight: null, lastFlight: null, takeoffAt: null,
  nextOrigin: null,
  origin: { name: '臺北', code: 'TPE', country: '臺灣', lat: 25.033, lon: 121.5654 },
  destination: null, busy: false, shadeHold: false, sceneryUrl: null, openaiReady: false,
  sleepDial: false,
};
let clockTimer = null;
let toastTimer = null;

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function cityOnly(name) { return String(name || '').split(',')[0].trim() || '未知的遠方'; }
function finiteCoordinate(value, fallback) {
  return value === null || value === undefined || value === '' ? fallback : (Number.isFinite(Number(value)) ? Number(value) : fallback);
}
function codeFor(name) {
  const city = cityOnly(name);
  return demoCities.find((c) => city.includes(c.name) || c.name.includes(city))?.code || 'ARR';
}
function locationFromFlight(flight, prefix) {
  const raw = String(flight?.[prefix + 'Location'] || '');
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  return {
    name: parts[0] || '臺北',
    country: parts[1] || '',
    code: codeFor(raw),
    lat: finiteCoordinate(flight?.[prefix + 'Latitude'], 25.033),
    lon: finiteCoordinate(flight?.[prefix + 'Longitude'], 121.5654),
  };
}
function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500);
}
function setCeremony(label, copy) {
  $('ceremony-tag').textContent = label;
  $('ceremony-copy').textContent = copy;
  $('ceremony').classList.remove('hidden');
}
function hideCeremony() { $('ceremony').classList.add('hidden'); }
function setScene(which) {
  $('cloud-image').classList.toggle('visible', which === 'clouds' || which === 'descent');
  $('arrival-image').classList.toggle('visible', which === 'arrival');
  $('globe-canvas').classList.toggle('active', which === 'globe');
  $('descent-video').classList.toggle('active', which === 'descent');
  $('landing-video').classList.toggle('active', which === 'approach');
}
const SHADE_OPEN_LIP = 34;
function setShade(kind) {
  const panel = document.querySelector('.shade-panel');
  const handle = $('shade-handle');
  if (panel) {
    panel.classList.remove('is-dragging');
    panel.style.transition = '';
    panel.style.transform = '';
  }
  if (handle) handle.classList.remove('is-dragging');
  $('window-shade').classList.toggle('closed', kind === 'closed');
  $('window-shade').classList.toggle('peek', kind === 'peek');
}
function shadeLip() {
  const glass = $('window-glass');
  const panel = document.querySelector('.shade-panel');
  const height = glass.getBoundingClientRect().height;
  const transform = getComputedStyle(panel).transform;
  if (transform && transform !== 'none') {
    const ty = new DOMMatrix(transform).m42;
    return ty + height;
  }
  return $('window-shade').classList.contains('closed') ? height : SHADE_OPEN_LIP;
}
function syncShadeHandle() {}
let compassTimer = null;
let heading = 90;
function spinTo(index, prefer) {
  const next = (index + 8) % 8;
  const target = directions[next].angle;
  const current = ((heading % 360) + 360) % 360;
  let delta = ((target - current + 540) % 360) - 180;
  if (next !== state.direction) {
    if (prefer === 'cw' && delta <= 0) delta += 360;
    if (prefer === 'ccw' && delta >= 0) delta -= 360;
    heading += delta;
  }
  const spin = `translate(-50%,-100%) rotate(${heading}deg)`;
  $('dial-pointer').style.transform = spin;
  $('compass-needle').style.transform = spin;
}
function hideGlassPanel(id) {
  const panel = $(id);
  if (!panel) return;
  panel.classList.remove('is-on', 'is-leaving', 'beat-blur', 'beat-climb', 'beat-arc');
  panel.hidden = true;
}
function showCompass() {
  const d = directions[state.direction];
  $('compass-degree').textContent = `${String(d.angle).padStart(3, '0')}°`;
  $('compass-name').textContent = d.name;
  $('compass-needle').style.transform = `translate(-50%,-100%) rotate(${heading}deg)`;
  const panel = $('glass-compass');
  panel.hidden = false;
  panel.classList.remove('is-leaving');
  void panel.offsetWidth;
  panel.classList.add('is-on');
  clearTimeout(compassTimer);
  compassTimer = setTimeout(() => {
    panel.classList.add('is-leaving');
    compassTimer = setTimeout(() => hideGlassPanel('glass-compass'), 700);
  }, 1600);
}
function setDirection(index, prefer) {
  if (state.stage !== 'ready' || state.sleepDial) return;
  spinTo(index, prefer);
  state.direction = (index + 8) % 8;
  const d = directions[state.direction];
  $('tk-direction').value = d.key;
  $('direction-name').textContent = `${d.name} · ${String(d.angle).padStart(3, '0')}°`;
  $('direction-dial').setAttribute('aria-valuenow', String(state.direction));
  $('direction-dial').setAttribute('aria-valuetext', d.name);
  window.BroadcastAudio?.playCompassTick?.();
  showCompass();
}
function render() {
  const ready = state.stage === 'ready';
  const flying = state.stage === 'cruise';
  const landed = state.stage === 'landed';
  $('btn-takeoff').classList.toggle('hidden', !ready);
  $('btn-land').classList.toggle('hidden', !flying);
  $('shade-handle')?.classList.toggle('is-ready', (ready || flying) && !state.busy);
  $('btn-restart').classList.toggle('hidden', !landed);
  $('btn-sleep-report').classList.toggle('hidden', !landed || FRONTEND_PREVIEW_ONLY);
  $('direction-dial').style.opacity = ready ? '1' : '.52';
  $('direction-dial').setAttribute('aria-disabled', ready ? 'false' : 'true');
  $('flight-duration').textContent = state.takeoffAt ? formatTime(Date.now() - state.takeoffAt) : '00:00';
  $('from-city').textContent = state.origin.name;
  $('from-code').textContent = state.origin.code;
  $('to-city').textContent = state.destination?.name || '未知的遠方';
  $('to-code').textContent = state.destination?.code || '???';
  const labels = {
    ready: ['準備啟程', '用手從窗頂拉到窗底，把窗簾完整拉下，航班就會起飛。', 'READY', '等待登機', 'BOARDING'],
    takeoff: ['正在起飛', '機長廣播中。窗外的故事即將開始。', 'TAKEOFF', '起飛中', 'DEPARTING'],
    cruise: ['飛行途中', '準備好了，就從窗底把窗簾完整拉到窗頂，打開窗戶降落。', 'IN FLIGHT', '飛行中', 'CRUISING'],
    landing: ['即將降落', '機長帶你穿越雲層，前往新的風景。', 'ARRIVING', '降落中', 'ARRIVING'],
    landed: ['你已抵達', '一段新的風景正在窗外等你。也可以再次選擇航向。', 'ARRIVED', '已抵達', 'ARRIVED'],
  };
  const [head, copy, indicator, routeStatus, phase] = labels[state.stage];
  $('action-heading').textContent = head;
  $('stage-copy').textContent = copy;
  $('stage-indicator').textContent = indicator;
  $('route-status').textContent = routeStatus;
  $('window-phase').textContent = phase;
  $('sound-toggle').textContent = state.sound ? '聲音開啟' : '聲音關閉';
  $('sound-toggle').setAttribute('aria-pressed', String(state.sound));
  $('sound-label').textContent = landed ? '甦醒音景已漸弱' : '音樂與機長廣播隨航程轉場';
  if (!state.sleepDial) {
    const heading = document.querySelector('.direction-heading h2');
    const hint = document.querySelector('.direction-heading > span');
    if (heading) heading.textContent = '航向選擇';
    if (hint) hint.textContent = '拖動旋鈕';
    document.querySelector('.dial-wrap')?.classList.remove('is-sleep');
  }
}
function applyWindowOnly(on) {
  document.body.classList.toggle('window-only', on);
  const button = $('view-toggle');
  if (!button) return;
  button.textContent = on ? '完整介面' : '只有窗戶';
  button.setAttribute('aria-pressed', String(on));
  localStorage.setItem('sleepAirlineS3WindowOnly', on ? '1' : '0');
}
function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const seconds = String(s % 60).padStart(2, '0');
  const hours = Math.floor(s / 3600);
  return hours ? `${String(hours).padStart(2, '0')}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}
async function api(method, path, body, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
  } finally { clearTimeout(timer); }
}
function applyPassengerOrigin(passenger) {
  if (!passenger?.currentLocation) return;
  state.origin = {
    name: cityOnly(passenger.currentLocation),
    country: String(passenger.currentLocation).split(',')[1]?.trim() || '',
    code: codeFor(passenger.currentLocation),
    lat: finiteCoordinate(passenger.currentLatitude, 25.033),
    lon: finiteCoordinate(passenger.currentLongitude, 121.5654),
  };
  $('window-caption').textContent = `${state.origin.name}上空 · 等待出發`;
}
function ensureGuestProfile() {
  if (state.profile?.passengerId && state.profile?.name && state.profile?.groupId) return;
  let guest = null;
  try { guest = JSON.parse(localStorage.getItem('sleepAirlineS3Guest') || 'null'); } catch { guest = null; }
  if (!guest?.passengerId || !guest?.name || !guest?.groupId) {
    guest = { passengerId: `G${Date.now().toString(36).toUpperCase()}`, name: '旅人', groupId: '0001' };
    localStorage.setItem('sleepAirlineS3Guest', JSON.stringify(guest));
  }
  state.profile = guest;
}
function flightBody() {
  ensureGuestProfile();
  return {
    passengerId: state.profile.passengerId, name: state.profile.name,
    groupId: state.profile.groupId, locale: 'zh',
  };
}
async function doLogin(event) {
  event?.preventDefault();
  const passengerId = $('input-pid').value.trim();
  const name = $('input-name').value.trim();
  const groupId = $('input-group').value.trim();
  if (!passengerId || !name || !/^[0-9]{4}$/.test(groupId)) {
    $('profile-hint').textContent = '請填寫乘客 ID、姓名與四位數航站代碼。'; return;
  }
  if (state.mode === 'live' && !$('research-consent').checked) {
    $('profile-hint').textContent = '連接活動資料庫前，請先同意資料使用。'; return;
  }
  $('btn-login').disabled = true;
  try {
    if (state.mode === 'live') {
      const result = await api('POST', '/api/passenger', {
        passengerId, name, groupId, researchConsent: true,
        researchConsentAt: new Date().toISOString(),
      });
      state.profile = { passengerId, name, groupId };
      applyPassengerOrigin(result.passenger);
      if (result.passenger?.status === 'in_flight') {
        await refreshProgress();
      }
    } else {
      state.profile = { passengerId, name, groupId };
    }
    localStorage.setItem('sleepAirlineS3Profile', JSON.stringify(state.profile));
    $('profile-dialog').close();
    $('profile-hint').textContent = '';
    render();
    showToast(`歡迎登機，${name}。`);
  } catch (error) { $('profile-hint').textContent = error.message; }
  finally { $('btn-login').disabled = false; }
}
async function fetchBoard() {
  if (state.mode !== 'live' || !state.profile) return null;
  return api('GET', `/api/board?groupId=${encodeURIComponent(state.profile.groupId)}`);
}
async function refreshProgress() {
  if (state.mode !== 'live' || !state.profile) return null;
  const data = await api('GET', `/api/flight/progress?passengerId=${encodeURIComponent(state.profile.passengerId)}`);
  if (data.activeFlight) {
    state.activeFlight = data.activeFlight;
    state.stage = 'cruise';
    state.origin = locationFromFlight(data.activeFlight, 'departure');
    state.takeoffAt = new Date(data.activeFlight.takeoffTime).getTime();
    setScene('clouds'); setShade('closed');
    $('window-caption').textContent = '雲層上方 · 飛行中';
    render();
  }
  return data;
}
function destinationFor(direction) {
  const d = directions[direction];
  const start = state.origin;
  const targetKm = 850;
  const candidates = demoCities.filter((city) => city.name !== start.name).map((city) => {
    const bearing = bearingBetween(start, city);
    const diff = Math.abs(((bearing - d.angle + 540) % 360) - 180);
    const km = haversine(start, city);
    return { ...city, score: diff * 28 + Math.abs(km - targetKm) };
  });
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] || demoCities[0];
}
function radians(d) { return d * Math.PI / 180; }
function haversine(a, b) {
  const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
function bearingBetween(a, b) {
  const dLon = radians(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(radians(b.lat));
  const x = Math.cos(radians(a.lat)) * Math.sin(radians(b.lat)) - Math.sin(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
async function playBroadcast(text, speechBase64, { restoreBed = false, skipCaptainIntro = false } = {}) {
  setCeremony('CAPTAIN SPEAKING', text);
  try {
    if (state.sound && window.BroadcastAudio) {
      await Promise.race([
        BroadcastAudio.playCaptainBroadcast(text, 'formal_captain', {
          speechBase64, restoreBed, skipCaptainIntro,
        }),
        delay(180000).then(() => BroadcastAudio.stopPlayback()),
      ]);
      await BroadcastAudio.waitForSpeechComplete?.({ maxMs: 120000, quietMs: 350 });
    } else await delay(1900);
  } finally { hideCeremony(); }
}
async function doTakeoff() {
  if (state.busy || state.stage !== 'ready') return;
  ensureGuestProfile();
  state.busy = true;
  state.stage = 'takeoff'; render(); setShade('closed');
  clearTimeout(compassTimer);
  hideGlassPanel('glass-compass');
  window.BroadcastAudio?.primeFromUserGesture?.();
  $('window-caption').textContent = '舷窗已關閉 · 準備起飛';
  const localLine = `各位旅客，歡迎搭乘甦醒航班。今天我們從${state.origin.name}出發，朝${directions[state.direction].name}飛行。請輕輕閉上眼睛，把日常留在地面，祝你有一段舒服的旅程。`;
  // 塔台 → captain.mp3 前 7 秒；與 API 並行，語音必須等此鏈結束
  const leadIn = state.sound && window.BroadcastAudio?.playTakeoffLeadIn
    ? BroadcastAudio.playTakeoffLeadIn({ captainVolume: 0.45 }).catch(() => false)
    : Promise.resolve(false);
  try {
    let text, speech;
    if (state.mode === 'live') {
      const data = await api('POST', '/api/flight/takeoff', {
        ...flightBody(), routeDirection: $('tk-direction').value,
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        researchConsent: true, researchConsentAt: new Date().toISOString(),
      }, 60000);
      state.activeFlight = data.flight;
      state.origin = locationFromFlight(data.flight, 'departure');
      state.takeoffAt = new Date(data.flight.takeoffTime).getTime();
      text = data.flight.takeoffBroadcast;
      speech = data.speechAudioBase64;
    } else {
      await delay(1100);
      state.destination = destinationFor(state.direction);
      state.takeoffAt = Date.now();
      text = localLine;
    }
    await leadIn;
    if (state.sound && text) {
      if (speech || state.openaiReady) {
        // 已播過 captain 前奏；有 OpenAI 語音走廣播路徑，勿再疊本地 TTS
        await playBroadcast(text, speech, { skipCaptainIntro: true });
      } else {
        window.BroadcastAudio?.speakFromGesture?.(text);
        await BroadcastAudio.waitForSpeechComplete?.({ maxMs: 120000, quietMs: 350 });
      }
    }
    setCeremony('TAKING OFF', '飛機正在穿越雲層…');
    if (state.sound) void BroadcastAudio?.playFlightSfx?.('media/takeoff.mp3', { loop: false, volume: .45, fadeInMs: 250 });
    await delay(2000);
    await BroadcastAudio?.stopFlightSfx?.({ fade: true, ms: 700 });
    setScene('clouds'); setShade('closed');
    state.stage = 'cruise'; render();
    $('window-caption').textContent = '雲層上方 · 飛行中';
    hideCeremony();
    if (state.mode === 'live') { void fetchBoard().catch(() => {}); }
  } catch (error) {
    window.BroadcastAudio?.stopTowerSignalLoop?.();
    await BroadcastAudio?.stopFlightSfx?.({ fade: false });
    await BroadcastAudio?.stopCaptainIntro?.();
    hideCeremony(); setShade('open'); state.stage = 'ready'; render();
    showToast(`起飛失敗：${error.message}`);
  } finally { state.busy = false; }
}
async function requestScenery(flightId) {
  if (!flightId || state.mode !== 'live' || !state.openaiReady) return null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const data = await api('GET', `/api/scenery?flightId=${encodeURIComponent(flightId)}`, undefined, 12000);
      if (data.scenery?.imageUrl && await preloadImage(data.scenery.imageUrl)) return data.scenery.imageUrl;
    } catch { /* generated image may still be pending */ }
    await delay(3200);
  }
  // S2's recovery path: ask the backend to generate once if its background job did not finish.
  try {
    const data = await api('POST', '/api/scenery/backfill', { flightIds: [flightId] }, 110000);
    const url = data.results?.[0]?.imageUrl;
    if (url && await preloadImage(url)) return url;
  } catch { /* the window can still reveal its local fallback */ }
  return null;
}
function preloadImage(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
    if (image.complete && image.naturalWidth > 0) finish(true);
  });
}
function primeLandingVideos() {
  for (const id of ['descent-video', 'landing-video']) {
    const video = $(id);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.load();
  }
}
async function startSceneVideo(id, loop) {
  const video = $(id);
  video.loop = loop;
  try { video.currentTime = 0; } catch { /* a not-yet-loaded video starts at zero */ }
  const play = video.play().then(() => true).catch(() => false);
  const started = await Promise.race([play, delay(1800).then(() => !video.paused)]);
  return started || !video.paused;
}
function stopLandingVideos() {
  for (const id of ['descent-video', 'landing-video']) {
    const video = $(id);
    video.pause();
    try { video.currentTime = 0; } catch { /* noop */ }
  }
}
function waitForVideoEnd(video, minMs = 4200, maxMs = 14000) {
  return Promise.all([
    delay(minMs),
    new Promise((resolve) => {
      if (video.ended) { resolve(); return; }
      const done = () => {
        clearTimeout(timer);
        video.removeEventListener('ended', done);
        resolve();
      };
      const timer = setTimeout(done, maxMs);
      video.addEventListener('ended', done);
    }),
  ]);
}
function formatFlightSpan(minutes) {
  const total = Math.max(1, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins} min`;
  return mins ? `${hours}h ${mins}min` : `${hours}h`;
}
function playGlassRoute({ minutes, distanceKm, from, to }) {
  const panel = $('glass-route');
  const glass = $('window-glass');
  $('glass-time').textContent = formatFlightSpan(minutes);
  $('glass-to').textContent = `to ${to}`;
  $('glass-meta').textContent = `${Math.round(distanceKm).toLocaleString('zh-Hant')} km · ${from}`;
  $('glass-pin-from').textContent = from;
  $('glass-pin-to').textContent = to;
  hideGlassPanel('glass-compass');
  panel.hidden = false;
  panel.classList.remove('is-on', 'is-leaving', 'beat-blur', 'beat-climb', 'beat-arc');
  glass.classList.remove('sky-soft');
  glass.classList.add('revealing');
  void panel.offsetWidth;
  // Soften the window first, then ease the plane in — no hard cut into climb.
  panel.classList.add('is-on', 'beat-blur');
  requestAnimationFrame(() => glass.classList.add('sky-soft'));
  setScene('clouds');
  return delay(2800).then(() => {
    panel.classList.remove('beat-blur');
    panel.classList.add('beat-climb');
    return delay(4200);
  }).then(() => {
    panel.classList.remove('beat-climb');
    // Brief settle so climb fade-out and arc fade-in cross, not cut.
    return delay(420).then(() => {
      panel.classList.add('beat-arc');
      return delay(9800);
    });
  }).then(() => {
    panel.classList.add('is-leaving');
    window.BroadcastAudio?.fadeOutLandingMusic?.({ ms: 1400 });
    return delay(1400);
  }).then(() => {
    hideGlassPanel('glass-route');
    glass.classList.remove('revealing', 'sky-soft');
  });
}
function weatherKind(code) {
  if (code === 0 || code === 1) return 'sun';
  if (code >= 71 && code <= 77) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  return 'cloud';
}
function climateGuess(lat) {
  const month = new Date().getMonth();
  const northWinter = month <= 1 || month === 11;
  const northSummer = month >= 5 && month <= 7;
  const winter = lat >= 0 ? northWinter : northSummer;
  const summer = lat >= 0 ? northSummer : northWinter;
  const abs = Math.abs(lat);
  let temp = abs < 15 ? 28 : abs < 28 ? 24 : abs < 40 ? 18 : abs < 55 ? 8 : -2;
  if (winter) temp -= abs < 20 ? 3 : 10;
  if (summer) temp += abs < 20 ? 2 : 8;
  const rounded = Math.round(temp);
  return { temp: rounded, kind: rounded >= 27 ? 'sun' : rounded <= 1 ? 'snow' : 'cloud' };
}
async function loadWeather(place) {
  const guess = climateGuess(place?.lat ?? 25);
  try {
    const data = await Promise.race([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code`).then((res) => res.json()),
      delay(4000).then(() => null),
    ]);
    if (!data?.current || !Number.isFinite(data.current.temperature_2m)) return guess;
    return { temp: Math.round(data.current.temperature_2m), kind: weatherKind(data.current.weather_code) };
  } catch {
    return guess;
  }
}
const HELLO_BY_ISO = {
  JP: 'こんにちは', KR: '안녕하세요', KP: '안녕하세요', CN: '你好', TW: '你好', HK: '你好', MO: '你好',
  TH: 'สวัสดี', VN: 'Xin chào', ID: 'Halo', MY: 'Halo', BN: 'Halo', PH: 'Kumusta',
  IN: 'Namaste', NP: 'Namaste', BT: 'Kuzu zangpo', LK: 'Ayubowan', MM: 'Mingalaba', KH: 'សួស្តី', LA: 'ສະບາຍດີ',
  FR: 'Bonjour', BE: 'Bonjour', LU: 'Bonjour', MC: 'Bonjour', RE: 'Bonjour', GP: 'Bonjour', MQ: 'Bonjour', GF: 'Bonjour', NC: 'Bonjour', YT: 'Bonjour', TF: 'Bonjour',
  SN: 'Bonjour', CI: 'Bonjour', ML: 'Bonjour', BF: 'Bonjour', NE: 'Bonjour', TG: 'Bonjour', BJ: 'Bonjour', GN: 'Bonjour', CM: 'Bonjour', GA: 'Bonjour', CG: 'Bonjour', CD: 'Bonjour', CF: 'Bonjour', GQ: 'Bonjour', TD: 'Bonjour', DJ: 'Bonjour', KM: 'Bonjour', MG: 'Bonjour', MU: 'Bonjour', SC: 'Bonjour', HT: 'Bonjour',
  ES: 'Hola', MX: 'Hola', AR: 'Hola', CL: 'Hola', PE: 'Hola', CO: 'Hola', VE: 'Hola', EC: 'Hola', BO: 'Hola', PY: 'Hola', UY: 'Hola', GT: 'Hola', HN: 'Hola', SV: 'Hola', NI: 'Hola', CR: 'Hola', PA: 'Hola', CU: 'Hola', DO: 'Hola', PR: 'Hola', AD: 'Hola',
  PT: 'Olá', BR: 'Olá', CV: 'Olá', ST: 'Olá', AO: 'Olá', MZ: 'Olá', GW: 'Olá',
  IT: 'Ciao', SM: 'Ciao', VA: 'Ciao', DE: 'Hallo', AT: 'Hallo', CH: 'Hallo', LI: 'Hallo', NL: 'Hallo', CW: 'Hallo',
  SE: 'Hej', DK: 'Hej', NO: 'Hej', FI: 'Hei', EE: 'Tere', IS: 'Halló', GR: 'Γεια σου', CY: 'Γεια σου',
  PL: 'Cześć', CZ: 'Ahoj', SK: 'Ahoj', HU: 'Szia', RO: 'Bună', MD: 'Bună',
  HR: 'Bok', SI: 'Živjo', RS: 'Zdravo', BA: 'Zdravo', ME: 'Zdravo', XK: 'Zdravo', BG: 'Здравей', MK: 'Здраво',
  RU: 'Здравствуйте', BY: 'Прывітанне', UA: 'Привіт', KZ: 'Сәлем', UZ: 'Salom', KG: 'Салам', TJ: 'Салом', TM: 'Salam', MN: 'Сайн уу',
  GE: 'გამარჯობა', AM: 'Բարև', AZ: 'Salam', TR: 'Merhaba', IL: 'שלום', IR: 'سلام', AF: 'سلام',
  AE: 'مرحبا', SA: 'مرحبا', QA: 'مرحبا', KW: 'مرحبا', BH: 'مرحبا', OM: 'مرحبا', YE: 'مرحبا', IQ: 'مرحبا', SY: 'مرحبا', JO: 'مرحبا', PS: 'مرحبا', LB: 'مرحبا', EG: 'أهلاً', LY: 'مرحبا', SD: 'مرحبا', SS: 'مرحبا', TN: 'مرحبا', DZ: 'مرحبا', MA: 'سلام', EH: 'سلام', MR: 'سلام', SO: 'مرحبا',
  KE: 'Jambo', TZ: 'Habari', UG: 'Oli otya', RW: 'Muraho', BI: 'Amahoro', ET: 'Selam', ZA: 'Sawubona', BW: 'Dumela', ZW: 'Mhoro',
  US: 'Hello', GB: 'Hello', AU: 'Hello', NZ: 'Hello', IE: 'Hello', CA: 'Hello', SG: 'Hello',
  FJ: 'Bula', WS: 'Talofa', TO: 'Mālō e lelei', VU: 'Halo',
};
let countryIsoMap = null;
function helloForPlace(place) {
  const raw = String(place?.country || '').trim();
  const key = raw.replaceAll('台灣', '臺灣').toLowerCase();
  const iso = countryIsoMap?.[key] || '';
  return HELLO_BY_ISO[iso] || 'Hello';
}
function showWeatherCard(place, weather) {
  $('wx-temp').textContent = String(weather.temp);
  $('wx-city').textContent = place.name;
  $('wx-place').textContent = place.country || '';
  $('wx-hello').textContent = helloForPlace(place);
  $('wx-icon').dataset.kind = weather.kind;
  const panel = $('glass-weather');
  panel.hidden = false;
  panel.classList.remove('is-on', 'is-leaving');
  void panel.offsetWidth;
  panel.classList.add('is-on');
  return delay(5800).then(() => {
    panel.classList.add('is-leaving');
    return delay(1100);
  }).then(() => hideGlassPanel('glass-weather'));
}
function revealArrivalImage(url, late = false) {
  if (!url) return;
  const preload = new Image();
  preload.onload = () => {
    const image = $('arrival-image');
    image.classList.add('developing');
    image.src = url;
    if (late) setScene('arrival');
    requestAnimationFrame(() => setTimeout(() => image.classList.remove('developing'), 100));
    $('window-caption').textContent = `已抵達 ${state.destination.name}`;
  };
  preload.src = url;
}
async function doLand() {
  if (state.busy || state.stage !== 'cruise') return;
  state.busy = true;
  state.stage = 'landing'; render(); setShade('open');
  window.BroadcastAudio?.primeFromUserGesture?.();
  if (state.sound) window.BroadcastAudio?.startWakeupBed?.(`media/${nextWakeup()}`, 0.14);
  if (state.sound && !state.openaiReady) {
    window.BroadcastAudio?.speakFromGesture?.('各位旅客，飛機正在下降。請稍候，我們即將打開窗戶。');
  }
  primeLandingVideos();
  await FlightGlobe.ready;
  setCeremony('ROUTE CONNECTING', '正在離開雲層，升上高空…');
  $('window-caption').textContent = '正在確認航線';
  try {
    let text, speech, sceneryJob = null;
    if (state.mode === 'live') {
      const data = await api('POST', '/api/flight/land', flightBody(), 110000);
      state.lastFlight = data.flight;
      state.destination = locationFromFlight(data.flight, 'arrival');
      text = data.flight.captainBroadcast;
      speech = data.speechAudioBase64;
      // No OpenAI: skip generation entirely — visuals continue with ARRIVAL_FALLBACK.
      sceneryJob = !state.openaiReady
        ? Promise.resolve(null)
        : data.landingScenery?.imageUrl
          ? preloadImage(data.landingScenery.imageUrl).then((ok) => ok ? data.landingScenery.imageUrl : null)
          : requestScenery(data.flight.flightId);
    } else {
      state.destination ||= destinationFor(state.direction);
      text = `各位旅客，甦醒航班即將降落${state.destination.name}。你從${state.origin.name}出發，穿過雲層與時間，現在可以慢慢打開窗戶，看看新的風景。歡迎抵達。`;
      sceneryJob = Promise.resolve(ARRIVAL_FALLBACK);
    }
    $('to-city').textContent = state.destination.name;
    $('to-code').textContent = state.destination.code;
    const weatherJob = loadWeather(state.destination);
    setCeremony('YOUR JOURNEY', `${state.origin.name}  →  ${state.destination.name}`);
    $('window-caption').textContent = `${state.origin.name} → ${state.destination.name}`;
    // Speech runs in parallel; never block the visual landing sequence on TTS.
    void (async () => {
      if (!speech) {
        if (text) await playBroadcast(text, speech, { restoreBed: true });
        return;
      }
      await delay(1600);
      if (text) await playBroadcast(text, speech, { restoreBed: true });
    })().catch(() => {});
    const elapsedMin = state.takeoffAt ? Math.max(1, Math.round((Date.now() - state.takeoffAt) / 60000)) : 1;
    const minutes = state.lastFlight?.flightDurationMinutes || elapsedMin;
    const distanceKm = state.lastFlight?.estimatedFlightDistanceKm || Math.max(12, minutes * 12);
    await playGlassRoute({
      minutes,
      distanceKm,
      from: state.origin.name,
      to: state.destination.name,
    });
    let descentPlayed = false;
    $('window-caption').textContent = `降入 ${state.destination.name} 的雲層`;
    descentPlayed = await startSceneVideo('descent-video', true);
    if (descentPlayed) $('descent-video').classList.add('active');
    $('window-glass').classList.add('cloud-entering');
    await delay(1200);
    setScene(descentPlayed ? 'descent' : 'clouds');
    $('window-caption').textContent = '穿越雲層 · 緩緩下降';
    await delay(1400);
    $('window-glass').classList.remove('cloud-entering', 'destination-zoom');
    hideGlassPanel('glass-route');
    $('window-glass').classList.remove('revealing', 'sky-soft');
    // Wait for generated scenery only when a real job exists; null/skip resolves immediately.
    // The 165s bound only covers an unresponsive backend — not used when OpenAI is off.
    const sceneryWait = sceneryJob
      ? Promise.race([sceneryJob.catch(() => null), delay(165000).then(() => null)])
      : Promise.resolve(null);
    const [readyUrl] = await Promise.all([
      sceneryWait,
      delay(3200),
    ]);
    if (readyUrl && state.mode === 'live') state.sceneryUrl = readyUrl;
    if (!readyUrl && state.mode === 'live' && sceneryJob) {
      const flightId = state.lastFlight?.flightId;
      void sceneryJob.then((url) => {
        if (!url || state.lastFlight?.flightId !== flightId) return;
        state.sceneryUrl = url;
        if (state.stage === 'landed') revealArrivalImage(url, true);
      }).catch(() => {});
    }

    // Final approach uses generated URL when present; otherwise the standby arrival photo.
    let finalImage = state.sceneryUrl || ARRIVAL_FALLBACK;
    if (!await preloadImage(finalImage)) {
      state.sceneryUrl = null;
      finalImage = ARRIVAL_FALLBACK;
      await preloadImage(finalImage);
    }
    setCeremony('FINAL APPROACH', '風景已就緒，正在對準跑道…');
    $('window-caption').textContent = '即將著陸';
    if (state.sound) await BroadcastAudio?.duckCeremonyBed?.();
    const approachPlayed = await startSceneVideo('landing-video', false);
    if (approachPlayed) setScene('approach');
    if (state.sound) {
      void BroadcastAudio?.playFlightSfx?.('media/takeoff.mp3', { loop: true, volume: .55, fadeInMs: 1200 });
    }
    await delay(1600);
    if (approachPlayed) $('descent-video').pause();
    if (approachPlayed) await waitForVideoEnd($('landing-video'));
    else await delay(4200);
    if (state.sound) {
      await BroadcastAudio?.stopFlightSfx?.({ fade: true, ms: 900 });
    } else await BroadcastAudio?.stopFlightSfx?.({ fade: false });

    const image = $('arrival-image');
    image.classList.add('developing');
    image.src = state.sceneryUrl || finalImage;
    await new Promise((resolve) => {
      if (image.complete && image.naturalWidth > 0) { resolve(); return; }
      image.onload = resolve;
      image.onerror = () => {
        state.sceneryUrl = null;
        image.onerror = resolve;
        image.src = ARRIVAL_FALLBACK;
      };
    });
    setScene('arrival');
    stopLandingVideos();
    const weather = await weatherJob;
    // Let the arrival photo ease out of developing blur before weather fades in.
    await delay(2200);
    requestAnimationFrame(() => setTimeout(() => image.classList.remove('developing'), 40));
    await delay(900);
    $('window-caption').textContent = `已抵達 ${state.destination.name}${state.sceneryUrl ? '' : ' · 示意風景'}`;
    state.stage = 'landed'; render(); hideCeremony();
    await offerSleepDial();
    await showWeatherCard(state.destination, weather);
    if (state.sound) void BroadcastAudio?.fadeOutLandingMusic?.({ ms: 4500 });
    state.nextOrigin = state.destination;
    if (state.mode === 'live') void fetchBoard().catch(() => {});
  } catch (error) {
    $('window-glass').classList.remove('cloud-entering', 'destination-zoom');
    hideGlassPanel('glass-route');
    hideGlassPanel('glass-weather');
    $('window-glass').classList.remove('revealing', 'sky-soft');
    hideCeremony();
    stopLandingVideos();
    await BroadcastAudio?.stopFlightSfx?.({ fade: false });
    await BroadcastAudio?.fadeOutLandingMusic?.({ ms: 500 });
    state.stage = 'cruise'; setScene('clouds'); setShade('closed'); render();
    showToast(`降落失敗：${error.message}`);
  } finally { state.busy = false; }
}
async function submitSleepReport(event) {
  event.preventDefault();
  const rawMinutes = $('sleep-minutes').value.trim();
  const rawQuality = $('sleep-quality').value;
  const minutes = rawMinutes === '' ? null : Number(rawMinutes);
  const quality = rawQuality === '' ? null : Number(rawQuality);
  if (minutes === null && quality === null) {
    $('sleep-report-hint').textContent = '請至少填寫一項；若不想回報可直接關閉。'; return;
  }
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) {
    $('sleep-report-hint').textContent = '分鐘數請填 0 到 1440 的整數。'; return;
  }
  const button = $('sleep-report-submit');
  button.disabled = true;
  $('sleep-report-hint').textContent = '';
  try {
    if (state.mode === 'live') {
      if (!state.profile || !state.lastFlight?.flightId) throw new Error('目前沒有可回報的航班。');
      await api('POST', '/api/flight/sleep-report', {
        passengerId: state.profile.passengerId,
        flightId: state.lastFlight.flightId,
        selfReportedSleepMinutes: minutes,
        sleepQuality: quality,
      });
      showToast('睡眠回報已儲存至 S3。');
    } else showToast('體驗模式已記下你的選擇；連線模式才會同步至 Notion。');
    $('sleep-report-dialog').close();
  } catch (error) { $('sleep-report-hint').textContent = error.message; }
  finally { button.disabled = false; }
}
function restart() {
  if (state.busy) return;
  window.BroadcastAudio?.stopPlayback?.();
  window.BroadcastAudio?.stopLandingMusic?.({ fade: true });
  stopLandingVideos();
  $('window-glass').classList.remove('cloud-entering', 'destination-zoom');
  hideGlassPanel('glass-route');
  hideGlassPanel('glass-compass');
  hideGlassPanel('glass-weather');
  $('window-glass').classList.remove('revealing', 'sky-soft');
  state.origin = state.nextOrigin || state.origin;
  state.nextOrigin = null;
  state.stage = 'ready'; state.activeFlight = null; state.lastFlight = null;
  state.destination = null; state.takeoffAt = null; state.sceneryUrl = null;
  $('arrival-image').src = ARRIVAL_FALLBACK;
  $('arrival-image').classList.remove('developing');
  $('window-caption').textContent = `${state.origin.name}上空 · 等待出發`;
  setScene('clouds'); setShade('open'); render();
}

function paintSleep(percent) {
  const p = Math.max(0, Math.min(100, percent));
  const offset = String(339.292 * (1 - p / 100));
  const ring = $('sleep-arc-draw');
  const windowRing = $('sleep-ring-draw');
  if (ring) ring.style.strokeDashoffset = offset;
  if (windowRing) windowRing.style.strokeDashoffset = offset;
  const pct = $('sleep-ring-pct');
  if (pct) pct.textContent = `${Math.round(p)}%`;
  $('dial-pointer').style.transform = `translate(-50%,-100%) rotate(${p * 3.6}deg)`;
  $('direction-name').textContent = `昨夜睡眠 · ${Math.round(p)}%`;
  $('direction-dial').setAttribute('aria-valuetext', `睡眠 ${Math.round(p)}%`);
}
function offerSleepDial() {
  return new Promise((resolve) => {
    state.sleepDial = true;
    let moved = false;
    const wrap = document.querySelector('.dial-wrap');
    wrap?.classList.add('is-sleep');
    const sleepGlass = $('glass-sleep');
    if (sleepGlass) {
      sleepGlass.hidden = false;
      sleepGlass.classList.remove('is-leaving');
      void sleepGlass.offsetWidth;
      sleepGlass.classList.add('is-on');
    }
    document.querySelector('.direction-heading h2').textContent = '昨夜睡得如何';
    document.querySelector('.direction-heading > span').textContent = '轉動旋鈕';
    $('direction-dial').style.opacity = '1';
    $('direction-dial').setAttribute('aria-disabled', 'false');
    paintSleep(0);
    const timer = setTimeout(finish, 10000);
    function finish() {
      clearTimeout(timer);
      const value = moved ? Number($('direction-dial').dataset.sleep || 0) : null;
      state.sleepDial = false;
      wrap?.classList.remove('is-sleep');
      hideGlassPanel('glass-sleep');
      spinTo(state.direction);
      render();
      resolve(value);
    }
    $('direction-dial').dataset.sleepFinish = '1';
    $('direction-dial')._sleepFinish = finish;
    $('direction-dial')._sleepMoved = () => { moved = true; };
  });
}
function bindShadeGesture() {
  const handle = $('shade-handle');
  const glass = $('window-glass');
  const panel = () => document.querySelector('.shade-panel');
  let pulling = false;
  let offset = 0;
  const place = (lip) => {
    const height = glass.getBoundingClientRect().height;
    const clamped = Math.max(SHADE_OPEN_LIP, Math.min(height, lip));
    const shade = panel();
    shade.style.transform = `translateY(${clamped - height}px)`;
    return clamped;
  };
  handle.addEventListener('pointerdown', (event) => {
    if (state.busy || state.shadeHold || (state.stage !== 'ready' && state.stage !== 'cruise')) return;
    event.preventDefault();
    pulling = true;
    const rect = glass.getBoundingClientRect();
    offset = shadeLip() - (event.clientY - rect.top);
    handle.classList.add('is-dragging');
    panel().classList.add('is-dragging');
    try { handle.setPointerCapture(event.pointerId); } catch { /* already released */ }
  });
  handle.addEventListener('pointermove', (event) => {
    if (!pulling) return;
    const rect = glass.getBoundingClientRect();
    place((event.clientY - rect.top) + offset);
  });
  const end = () => {
    if (!pulling) return;
    pulling = false;
    const height = glass.getBoundingClientRect().height;
    const lip = shadeLip();
    if (state.stage === 'ready' && lip > height * 0.86) {
      state.shadeHold = true;
      setShade('closed');
      // iOS：必須在 pointerup 手勢堆疊內解鎖 Audio／後續 HTMLAudio
      window.BroadcastAudio?.primeFromUserGesture?.();
      setTimeout(() => {
        state.shadeHold = false;
        void doTakeoff();
      }, 1000);
      return;
    }
    if (state.stage === 'cruise' && lip < height * 0.22) {
      setShade('open');
      void doLand();
      return;
    }
    setShade(state.stage === 'cruise' ? 'closed' : 'open');
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  syncShadeHandle();
}
function bindDial() {
  const el = $('direction-dial');
  let dragAngle = null;
  const pointToIndex = (event, follow) => {
    const rect = el.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const angle = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    let prefer;
    if (follow && dragAngle != null) {
      let diff = angle - dragAngle;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      if (Math.abs(diff) > 0.5) prefer = diff > 0 ? 'cw' : 'ccw';
    }
    dragAngle = angle;
    if (state.sleepDial) {
      const percent = Math.round(angle / 360 * 100);
      $('direction-dial').dataset.sleep = String(percent);
      $('direction-dial')._sleepMoved?.();
      paintSleep(percent);
      return;
    }
    setDirection(Math.round(angle / 45) % 8, prefer);
  };
  el.addEventListener('pointerdown', (event) => { el.setPointerCapture(event.pointerId); dragAngle = null; pointToIndex(event, false); });
  el.addEventListener('pointermove', (event) => { if (el.hasPointerCapture(event.pointerId)) pointToIndex(event, true); });
  el.addEventListener('pointerup', () => { dragAngle = null; });
  el.addEventListener('pointercancel', () => { dragAngle = null; });
  el.addEventListener('keydown', (event) => {
    if (['ArrowRight', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setDirection(state.direction + 1, 'cw'); }
    if (['ArrowLeft', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setDirection(state.direction - 1, 'ccw'); }
  });
  $('tk-direction').addEventListener('change', () => setDirection(directions.findIndex((d) => d.key === $('tk-direction').value)));
}
async function init() {
  try {
    const profile = JSON.parse(localStorage.getItem('sleepAirlineS3Profile') || 'null');
    if (profile?.passengerId && profile?.name && profile?.groupId) {
      state.profile = profile;
      $('input-pid').value = profile.passengerId;
      $('input-name').value = profile.name;
      $('input-group').value = profile.groupId;
    }
  } catch { /* no stored profile */ }
  if (!FRONTEND_PREVIEW_ONLY) {
    try {
      try {
        countryIsoMap = await (await fetch('country-iso.json')).json();
      } catch { countryIsoMap = {}; }
      const config = await api('GET', '/api/config', undefined, 5000);
      state.openaiReady = Boolean(config.openaiReady);
      state.mode = config.dataMode === 'live' && (config.notionReady || config.notionConfigured) ? 'live' : 'preview';
    } catch { state.mode = 'preview'; }
  }
  $('mode-label').textContent = state.mode === 'live' ? '連線航班' : '獨立體驗';
  const windowOnly = localStorage.getItem('sleepAirlineS3WindowOnly') !== '0';
  applyWindowOnly(windowOnly);
  $('view-toggle').addEventListener('click', () => applyWindowOnly(!document.body.classList.contains('window-only')));
  $('profile-open').classList.toggle('hidden', FRONTEND_PREVIEW_ONLY);
  $('profile-open').addEventListener('click', () => $('profile-dialog').showModal());
  $('profile-close').addEventListener('click', () => $('profile-dialog').close());
  $('login-form').addEventListener('submit', doLogin);
  $('btn-takeoff').addEventListener('click', doTakeoff);
  $('btn-land').addEventListener('click', doLand);
  $('btn-restart').addEventListener('click', restart);
  $('btn-sleep-report').addEventListener('click', () => $('sleep-report-dialog').showModal());
  $('sleep-report-close').addEventListener('click', () => $('sleep-report-dialog').close());
  $('sleep-report-form').addEventListener('submit', submitSleepReport);
  $('sound-toggle').addEventListener('click', () => {
    state.sound = !state.sound;
    if (!state.sound) {
      BroadcastAudio?.stopPlayback?.();
      BroadcastAudio?.stopFlightSfx?.({ fade: true });
      BroadcastAudio?.stopLandingMusic?.({ fade: true });
    }
    render();
  });
  bindDial();
  bindShadeGesture();
  if (state.mode === 'live' && state.profile) {
    try {
      const result = await api('POST', '/api/passenger', {
        ...state.profile,
        researchConsent: true,
        researchConsentAt: new Date().toISOString(),
      });
      applyPassengerOrigin(result.passenger);
      await refreshProgress();
    } catch { showToast('暫時無法恢復航班進度。'); }
  }
  clockTimer = setInterval(() => { if (state.takeoffAt) $('flight-duration').textContent = formatTime(Date.now() - state.takeoffAt); }, 1000);
  render();
}
void init();
