'use strict';

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

const GRADE_LABELS = ['', '很差', '偏差', '普通', '不錯', '很好'];

function toStoredScore(grade) {
  const n = Math.max(1, Math.min(5, Math.round(Number(grade) || 3)));
  return n * 2;
}

function fromStoredScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return 3;
  return Math.max(1, Math.min(5, Math.round(n / 2)));
}

function gradeLabel(grade) {
  return GRADE_LABELS[grade] || '普通';
}

const hourLabels = [
  [5, '當地深夜'],
  [8, '當地黎明'],
  [11, '當地清晨'],
  [16, '當地午後'],
  [18, '當地傍晚'],
  [20, '當地黃昏'],
  [24, '當地夜晚'],
];

const $ = (id) => document.getElementById(id);
const state = {
  direction: 2,
  sampleId: '',
  source: 'lab',
  archive: 'live',
  busy: false,
  account: '',
  samples: [],
  flights: [],
  preview: null,
};

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3200);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function shortPlace(name) {
  const text = String(name || '').trim();
  return text.split(',')[0].trim() || text || '臺北';
}

function formatDuration(minutes) {
  const safe = Math.max(30, Math.min(720, Number(minutes) || 90));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${safe} 分鐘`;
  if (!rest) return `${hours} 小時`;
  return `${hours} 小時 ${rest} 分`;
}

function hourLabel(hour) {
  if (hour < 0) return '現在';
  const tag = hourLabels.find(([limit]) => hour < limit)?.[1] || '當地夜晚';
  return `${String(hour).padStart(2, '0')}:00 · ${tag}`;
}

function currentDirection() {
  return directions[state.direction];
}

function chainOriginLocation() {
  return (state.samples[0]?.arrivalLocation || '').trim();
}

function originLabel() {
  return shortPlace(chainOriginLocation() || '臺北');
}

let scenerySeq = 0;

function showSceneryLoading(message = '窗外漸漸亮了起來…') {
  const frame = $('image-frame');
  scenerySeq += 1;
  frame.classList.add('is-loading');
  frame.innerHTML = `<div class="image-veil" aria-busy="true"><span>${escapeHtml(message)}</span></div>`;
}

function paintScenery(src, emptyMessage) {
  const frame = $('image-frame');
  const seq = ++scenerySeq;
  if (!src) {
    frame.classList.remove('is-loading');
    frame.innerHTML = `<p>${escapeHtml(emptyMessage)}</p>`;
    return;
  }
  frame.classList.add('is-loading');
  const veil = document.createElement('div');
  veil.className = 'image-veil';
  veil.setAttribute('aria-busy', 'true');
  veil.innerHTML = '<span>窗外漸漸亮了起來…</span>';
  const img = document.createElement('img');
  img.alt = '降落風景';
  const reveal = () => {
    if (seq !== scenerySeq) return;
    img.dataset.ok = '1';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (seq !== scenerySeq) return;
        img.classList.add('is-in');
        frame.classList.remove('is-loading');
      });
    });
  };
  img.onload = reveal;
  img.onerror = () => {
    if (seq !== scenerySeq) return;
    frame.classList.remove('is-loading');
    frame.innerHTML = '<p>這筆還沒有風景圖，或圖片暫時無法載入。</p>';
  };
  frame.replaceChildren(img, veil);
  img.src = src;
  if (img.complete && img.naturalWidth) reveal();
}

function sampleImageSrc(sample) {
  if (sample?.imageUrl) return sample.imageUrl;
  if (!sample?.sampleId) return '';
  if (sample.source === 'live' && sample.hasImage) {
    return `/api/scenery-image?flightId=${encodeURIComponent(sample.flightId || sample.sampleId)}`;
  }
  if (sample.hasImage) {
    return `/api/review/image?sampleId=${encodeURIComponent(sample.sampleId)}`;
  }
  return '';
}

function paintControls() {
  const dir = currentDirection();
  $('dial-pointer').style.transform = `translate(-50%,-100%) rotate(${dir.angle}deg)`;
  $('direction-name').textContent = `${dir.name} · ${String(dir.angle).padStart(3, '0')}°`;
  const minutes = Number($('duration-bar').value);
  $('duration-readout').textContent = formatDuration(minutes);
  const hour = Number($('hour-bar').value);
  $('hour-readout').textContent = hourLabel(hour);
  $('origin-note').textContent = `下一班從${originLabel()}接著飛`;
  if (!state.sampleId) {
    const dest = state.preview?.to?.name || '預覽中';
    $('route-line').textContent = [
      `${originLabel()}出發`,
      dir.name,
      formatDuration(minutes),
      hourLabel(hour),
      dest,
    ].join(' · ');
  }
  schedulePreview();
}

function setBusy(busy, message) {
  state.busy = busy;
  $('btn-flight').disabled = busy;
  $('btn-comment').disabled = busy;
  document.querySelectorAll('input[name="generate-mode"]').forEach((input) => {
    input.disabled = busy;
  });
  if (message) toast(message);
}

function setArchive(kind) {
  state.archive = kind === 'lab' ? 'lab' : 'live';
  const liveOn = state.archive === 'live';
  $('tab-live').classList.toggle('is-on', liveOn);
  $('tab-lab').classList.toggle('is-on', !liveOn);
  $('tab-live').setAttribute('aria-selected', liveOn ? 'true' : 'false');
  $('tab-lab').setAttribute('aria-selected', liveOn ? 'false' : 'true');
  $('archive-live').classList.toggle('is-on', liveOn);
  $('archive-lab').classList.toggle('is-on', !liveOn);
  $('archive-live').hidden = !liveOn;
  $('archive-lab').hidden = liveOn;
}

function paintImagePrompt(text) {
  const el = $('image-prompt');
  const prompt = String(text || '').trim();
  el.textContent = prompt ? `生圖 prompt　${prompt}` : '';
  el.hidden = !prompt;
}

async function fillLivePrompt(sample) {
  if (sample?.source !== 'live' || sample.imagePrompt) return;
  const flightId = sample.flightId || sample.sampleId;
  if (!flightId) return;
  try {
    const res = await fetch(`/api/scenery?flightId=${encodeURIComponent(flightId)}`);
    const data = await res.json();
    const prompt = data?.scenery?.imagePrompt || '';
    if (!prompt) return;
    sample.imagePrompt = prompt;
    if (state.sampleId === sample.sampleId && state.source === 'live') {
      paintImagePrompt(prompt);
    }
  } catch { /* prompt is optional */ }
}

function formatWhen(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(t).toLocaleString('zh-Hant', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function recordWhen(sample) {
  return formatWhen(sample.updatedAt || sample.generatedAt || sample.createdAt || sample.landingTime || sample.takeoffTime);
}

function renderRecordButton(sample, kind) {
  const dir = directions.find((item) => item.key === sample.routeDirection)?.name || '';
  const active = sample.sampleId === state.sampleId && state.source === kind ? ' active' : '';
  const from = shortPlace(sample.departureLocation || '臺北');
  const to = shortPlace(sample.arrivalLocation || '尚未降落');
  const bits = [];
  if (sample.hasImage || sample.imageUrl) bits.push('<em class="ok">有圖</em>');
  else bits.push('<em class="warn">沒圖</em>');
  if (!sample.takeoffBroadcast) bits.push('<em class="warn">缺起飛</em>');
  if (!sample.landingBroadcast) bits.push('<em class="warn">缺降落</em>');
  if (kind === 'live' && sample.phase === 'in_flight') bits.push('飛行中');
  if (dir) bits.push(escapeHtml(dir));
  if (sample.durationMinutes) bits.push(escapeHtml(formatDuration(sample.durationMinutes)));
  if (sample.myScore != null) {
    const grade = fromStoredScore(sample.myScore);
    bits.push(`<em class="${grade >= 4 ? 'ok' : grade <= 2 ? 'warn' : ''}">我的${grade}分</em>`);
  }
  else if ((sample.ratings || []).some((item) => item.score != null)) bits.push('有評分');
  if (sample.comments) bits.push('有評論');
  const when = recordWhen(sample);
  if (when) bits.push(escapeHtml(when));
  return `<button type="button" class="sample-item${active}" data-id="${escapeHtml(sample.sampleId)}" data-source="${kind}">
      <strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong>
      <small>${bits.join(' · ')}</small>
    </button>`;
}

function renderSample(sample) {
  if (!sample) return;
  state.sampleId = sample.sampleId;
  state.source = sample.source === 'live' ? 'live' : 'lab';
  const dir = directions.find((item) => item.key === sample.routeDirection) || currentDirection();
  const hour = sample.landingHour == null ? -1 : Number(sample.landingHour);
  $('source-chip').textContent = state.source === 'live' ? '真實飛行' : '手動生成';
  $('source-chip').className = state.source === 'live' ? 'chip live' : 'chip';
  $('sample-id').textContent = sample.sampleId;
  $('route-line').textContent = [
    `${shortPlace(sample.departureLocation || '臺北')} → ${shortPlace(sample.arrivalLocation || dir.name)}`,
    sample.durationMinutes ? formatDuration(sample.durationMinutes) : '',
    state.source === 'lab' ? hourLabel(hour) : (sample.passengerName || ''),
  ].filter(Boolean).join(' · ');
  $('takeoff-copy').textContent = sample.takeoffBroadcast || '還沒有起飛文字。';
  $('landing-copy').textContent = sample.landingBroadcast || '還沒有降落文字。';
  paintImagePrompt(sample.imagePrompt);
  paintScenery(
    sampleImageSrc(sample),
    state.source === 'live'
      ? '這班真實飛行還沒有降落風景。'
      : '選擇「文字＋圖片」時會一起生成風景。',
  );
  renderComments(sample);
  $('text-score').value = String(fromStoredScore(sample.myScore));
  paintScoreReadout();
  $('comment').placeholder = state.account
    ? `以 @${state.account} 寫評論`
    : '對這段語音／圖片的評論';
  $('btn-comment').disabled = state.busy;
  $('origin-note').textContent = `下一班從${originLabel()}接著飛`;
  setArchive(state.source);
  renderList();
  void fillLivePrompt(sample);
}

function renderList(flightsError = '') {
  const liveBox = $('live-list');
  const labBox = $('sample-list');
  $('live-count').textContent = String(state.flights.length);
  $('lab-count').textContent = String(state.samples.length);
  liveBox.innerHTML = state.flights.length
    ? state.flights.map((item) => renderRecordButton(item, 'live')).join('')
    : `<p class="hint">${escapeHtml(flightsError || '還沒有從 Flight Log 讀到航班。')}</p>`;
  labBox.innerHTML = state.samples.length
    ? state.samples.map((item) => renderRecordButton(item, 'lab')).join('')
    : '<p class="hint">生成第一筆後會出現在這裡。</p>';
}

function upsertSample(sample) {
  if (!sample) return;
  if (sample.source === 'live') {
    const rest = state.flights.filter((item) => item.sampleId !== sample.sampleId);
    state.flights = [sample, ...rest];
  } else {
    const rest = state.samples.filter((item) => item.sampleId !== sample.sampleId);
    state.samples = [sample, ...rest].slice(0, 40);
  }
  renderSample(sample);
}

function applyStore(review) {
  const pill = $('store-pill');
  const banner = $('store-banner');
  if (review?.ready) {
    pill.textContent = '已接審查庫';
    pill.className = 'pill ok';
    banner.hidden = true;
    return;
  }
  pill.textContent = review?.mode === 'memory' ? '記憶體暫存' : '尚未接庫';
  pill.className = 'pill warn';
  banner.hidden = !review?.hint;
  banner.textContent = review?.hint || '';
}

function globeFromRoute(route) {
  if (!route?.from || !route?.to || !window.FlightGlobe) return null;
  return route;
}

function hopCaption(route) {
  if (!route?.from || !route?.to) return '';
  const base = `${route.from.name} → ${route.to.name}`;
  if (route.bearing == null) return base;
  const deg = String(Math.round(route.bearing)).padStart(3, '0');
  return `${base} · ${deg}° ${route.bearingLabel || ''}`.trim();
}

function paintBearing(route, chosenName) {
  if (!route || route.bearing == null) {
    $('bearing-note').textContent = '實際航向會顯示在地球儀上';
    return;
  }
  const deg = String(Math.round(route.bearing)).padStart(3, '0');
  const actual = route.bearingLabel || '';
  const chosen = chosenName || currentDirection().name;
  const same = actual === chosen;
  $('bearing-note').textContent = same
    ? `實際出發航向 ${deg}°，與旋鈕「${chosen}」相符`
    : `實際出發航向 ${deg}° ${actual}，旋鈕是「${chosen}」`;
}

async function drawGlobe(route, progress = 1) {
  const points = globeFromRoute(route);
  if (!points) return;
  $('globe-caption').textContent = hopCaption(points);
  paintBearing(points);
  try { await window.FlightGlobe.ready; } catch { /* still draw the sphere */ }
  window.FlightGlobe.draw(points.from, points.to, progress);
}

async function flyGlobe(route) {
  const points = globeFromRoute(route);
  if (!points) return;
  $('globe-caption').textContent = hopCaption(points);
  paintBearing(points);
  try {
    await window.FlightGlobe.ready;
    await window.FlightGlobe.animate(points.from, points.to);
  } catch {
    drawGlobe(route, 1);
  }
}

async function loadHop(fromLocation, toLocation) {
  try {
    const params = new URLSearchParams({
      fromLocation: fromLocation || '',
      toLocation: toLocation || '',
    });
    const res = await fetch(`/api/review/preview?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '航線載入失敗');
    drawGlobe(data.route, 1);
    const sample = state.samples.find((item) => item.sampleId === state.sampleId);
    const dir = directions.find((item) => item.key === sample?.routeDirection)?.name;
    paintBearing(data.route, dir);
  } catch {
    $('globe-caption').textContent = '航線暫時無法載入';
  }
}

let previewTimer = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(loadPreview, 220);
}

async function loadPreview() {
  try {
    const params = new URLSearchParams({
      routeDirection: currentDirection().key,
      durationMinutes: String($('duration-bar').value),
      landingHour: String($('hour-bar').value),
      fromLocation: chainOriginLocation(),
    });
    const res = await fetch(`/api/review/preview?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '預覽失敗');
    state.preview = data.route;
    if (!state.sampleId) {
      $('route-line').textContent = [
        `${originLabel()}出發`,
        currentDirection().name,
        formatDuration(Number($('duration-bar').value)),
        hourLabel(Number($('hour-bar').value)),
        data.route?.to?.name || '',
      ].filter(Boolean).join(' · ');
    }
    drawGlobe(data.route, 1);
  } catch {
    $('globe-caption').textContent = '航線預覽暫時無法載入';
  }
}

async function loadSamples() {
  try {
    const res = await fetch('/api/review/samples');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '讀取失敗');
    state.samples = data.samples || [];
    state.flights = data.flights || [];
    applyStore(data);
    renderList(data.flightsError || '');
    $('origin-note').textContent = `下一班從${originLabel()}接著飛`;
  } catch (err) {
    toast(err.message || '讀取測試內容失敗');
  }
}

function controlsPayload() {
  return {
    routeDirection: currentDirection().key,
    durationMinutes: Number($('duration-bar').value),
    landingHour: Number($('hour-bar').value),
    fromLocation: chainOriginLocation(),
  };
}

function wantsImage() {
  return document.querySelector('input[name="generate-mode"]:checked')?.value === 'image';
}

async function generateFlight() {
  if (state.busy) return;
  const includeImage = wantsImage();
  setBusy(true, includeImage ? '正在生成文字與圖片…' : '正在生成起飛與降落文字…');
  if (includeImage) showSceneryLoading();
  try {
    const res = await fetch('/api/review/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...controlsPayload(), kind: 'flight', includeImage }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '生成失敗');
    applyStore(data.review);
    upsertSample(data.sample);
    setArchive('lab');
    toast(data.warning || (includeImage ? '已新增文字與圖片' : '已新增一筆文字紀錄'));
    await flyGlobe(data.route || state.preview);
  } catch (err) {
    toast(err.message || '生成失敗');
  } finally {
    setBusy(false);
  }
}

function renderComments(sample) {
  const box = $('comments');
  const ratings = sample.ratings || [];
  if (!ratings.length) {
    box.textContent = sample.comments || '還沒有評論。';
    return;
  }
  box.innerHTML = ratings.map((item) => {
    const grade = item.score == null ? null : fromStoredScore(item.score);
    const band = grade == null ? '' : grade >= 4 ? '' : grade <= 2 ? 'warn' : '';
    const score = grade != null ? `${grade} · ${gradeLabel(grade)}` : '';
    return `<div class="comment-line"><div class="comment-meta"><strong>@${escapeHtml(item.account)}</strong><em class="${band}">${escapeHtml(score)}</em></div><span>${escapeHtml(item.comment || '')}</span></div>`;
  }).join('');
}

function setAccount(account) {
  state.account = account || '';
  const pill = $('account-pill');
  const out = $('btn-logout');
  if (state.account) {
    pill.hidden = false;
    pill.textContent = `@${state.account}`;
    out.hidden = false;
    document.body.classList.remove('gate-on');
    maybeStartTour();
  } else {
    pill.hidden = true;
    out.hidden = true;
    document.body.classList.add('gate-on');
  }
}

function gateHint(message) {
  $('gate-hint').textContent = message || '';
}

async function submitAuth(kind, account, password) {
  const res = await fetch(`/api/review/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || (kind === 'register' ? '註冊失敗' : '登入失敗'));
  setAccount(data.account);
  gateHint('');
  await loadSamples();
  await loadPreview();
}

async function saveComment() {
  if (state.busy) return;
  if (!state.account) {
    toast('請先登入審查帳號。');
    setAccount('');
    return;
  }
  if (!state.sampleId) {
    toast('請先選一筆內容。');
    return;
  }
  const comment = $('comment').value.trim();
  const grade = Math.max(1, Math.min(5, Number($('text-score').value) || 3));
  const textScore = toStoredScore(grade);
  if (!comment && !(grade >= 1)) {
    toast('請先寫評論或選評分。');
    return;
  }
  setBusy(true);
  try {
    const res = await fetch('/api/review/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleId: state.sampleId,
        source: state.source,
        comment,
        textScore,
      }),
    });
    const data = await res.json();
    if (res.status === 401) {
      setAccount('');
      throw new Error(data.error || '請先登入審查帳號。');
    }
    if (!res.ok) throw new Error(data.error || '評論寫入失敗');
    upsertSample(data.sample);
    $('comment').value = '';
    toast(`@${state.account} 已寫回 ${grade} · ${gradeLabel(grade)}`);
  } catch (err) {
    toast(err.message || '評論寫入失敗');
  } finally {
    setBusy(false);
  }
}

function setDirectionFromAngle(angle) {
  const nearest = directions.reduce((best, item, index) => {
    const diff = Math.min(Math.abs(item.angle - angle), 360 - Math.abs(item.angle - angle));
    return diff < best.diff ? { index, diff } : best;
  }, { index: state.direction, diff: 360 });
  state.direction = nearest.index;
  paintControls();
}

function bindDial() {
  const dial = $('direction-dial');
  let dragging = false;
  const readAngle = (event) => {
    const box = dial.getBoundingClientRect();
    const x = (event.clientX ?? event.touches?.[0]?.clientX) - (box.left + box.width / 2);
    const y = (event.clientY ?? event.touches?.[0]?.clientY) - (box.top + box.height / 2);
    return (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
  };
  const start = (event) => {
    dragging = true;
    setDirectionFromAngle(readAngle(event));
  };
  const move = (event) => {
    if (!dragging) return;
    event.preventDefault();
    setDirectionFromAngle(readAngle(event));
  };
  const end = () => { dragging = false; };
  dial.addEventListener('pointerdown', start);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

$('duration-bar').addEventListener('input', paintControls);
$('hour-bar').addEventListener('input', paintControls);
$('btn-flight').addEventListener('click', generateFlight);
function paintScoreReadout() {
  const el = $('text-score');
  if (!el) return;
  const n = Math.max(1, Math.min(5, Number(el.value) || 3));
  el.value = String(n);
  document.querySelectorAll('.grade').forEach((button) => {
    button.classList.toggle('is-on', Number(button.dataset.score) === n);
  });
}

document.querySelector('.grades')?.addEventListener('click', (event) => {
  const button = event.target.closest('.grade');
  if (!button) return;
  $('text-score').value = button.dataset.score;
  paintScoreReadout();
});
$('btn-comment').addEventListener('click', saveComment);
paintScoreReadout();
async function openRecord(sample) {
  if (!sample) return;
  const index = directions.findIndex((item) => item.key === sample.routeDirection);
  if (index >= 0) state.direction = index;
  if (sample.durationMinutes) {
    $('duration-bar').value = String(Math.max(30, Math.min(720, sample.durationMinutes)));
  }
  $('hour-bar').value = String(sample.landingHour == null ? -1 : sample.landingHour);
  renderSample(sample);
  $('dial-pointer').style.transform = `translate(-50%,-100%) rotate(${currentDirection().angle}deg)`;
  $('direction-name').textContent = `${currentDirection().name} · ${String(currentDirection().angle).padStart(3, '0')}°`;
  $('duration-readout').textContent = formatDuration(Number($('duration-bar').value));
  $('hour-readout').textContent = hourLabel(Number($('hour-bar').value));
  await loadHop(sample.departureLocation, sample.arrivalLocation);
}

function bindArchive(box) {
  box.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-id]');
    if (!button) return;
    const source = button.dataset.source || 'lab';
    const sample = source === 'live'
      ? state.flights.find((item) => item.sampleId === button.dataset.id)
      : state.samples.find((item) => item.sampleId === button.dataset.id);
    await openRecord(sample);
  });
}

bindArchive($('sample-list'));
bindArchive($('live-list'));
$('tab-live').addEventListener('click', () => setArchive('live'));
$('tab-lab').addEventListener('click', () => setArchive('lab'));

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await submitAuth('login', $('login-account').value, $('login-password').value);
  } catch (err) {
    gateHint(err.message || '登入失敗');
  }
});
$('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await submitAuth('register', $('register-account').value, $('register-password').value);
  } catch (err) {
    gateHint(err.message || '註冊失敗');
  }
});
$('btn-logout').addEventListener('click', async () => {
  try { await fetch('/api/review/logout', { method: 'POST' }); } catch { /* still leave */ }
  setAccount('');
  gateHint('');
});

async function bootReview() {
  try {
    const res = await fetch('/api/review/me');
    const data = await res.json();
    if (data.account) {
      setAccount(data.account);
      await loadSamples();
      await loadPreview();
      return;
    }
  } catch { /* stay on the gate */ }
  setAccount('');
}

const TOUR_KEY = 'sleep-review-tour-v2';
const TOUR_STEPS = [
  {
    id: 'tour-console',
    prefer: 'below',
    title: '上方可生成',
    copy: '設航向與時間，再按開始生成。可只做文字，也可連風景圖一起做。',
  },
  {
    id: 'tour-ledger',
    prefer: 'right',
    title: '左選航班',
    copy: '切換真實飛行或手動生成，點一筆就能開始看。',
  },
  {
    id: 'tour-sheet',
    prefer: 'right',
    title: '中看廣播與圖',
    copy: '起飛廣播、降落廣播和降落風景都在這裡。',
  },
  {
    id: 'tour-judge',
    prefer: 'left',
    title: '右評 1–5 分',
    copy: '選等級，再寫回饋。分數會記在你的帳號下面。',
  },
  {
    id: '',
    title: '評論會改進生成',
    copy: '系統會根據評論自動調整生成狀態，讓下次體驗更好。',
  },
];

const tour = { index: 0, open: false };

function tourSeen() {
  try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return false; }
}

function markTourSeen() {
  try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* ignore */ }
}

function placeTour() {
  const step = TOUR_STEPS[tour.index];
  const target = step.id ? $(step.id) : null;
  const hole = $('tour-hole');
  const card = $('tour-card');
  const overlay = $('review-tour');
  if (!hole || !card || !overlay) return;

  $('tour-step').textContent = `${tour.index + 1} / ${TOUR_STEPS.length}`;
  $('tour-title').textContent = step.title;
  $('tour-copy').textContent = step.copy;
  $('tour-next').textContent = tour.index === TOUR_STEPS.length - 1 ? '開始審查' : '下一步';

  if (!target) {
    overlay.classList.add('is-center');
    hole.hidden = true;
    card.style.left = '';
    card.style.top = '';
    return;
  }

  overlay.classList.remove('is-center');
  hole.hidden = false;
  const pad = 7;
  const margin = 16;
  const gap = 16;
  const vw = innerWidth;
  const vh = innerHeight;
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const raw = target.getBoundingClientRect();
  const holeRect = {
    left: Math.max(8, raw.left - pad),
    top: Math.max(8, raw.top - pad),
    right: Math.min(vw - 8, raw.right + pad),
    bottom: Math.min(vh - 8, raw.bottom + pad),
  };
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const space = (side) => {
    if (side === 'right') return vw - margin - holeRect.right;
    if (side === 'left') return holeRect.left - margin;
    if (side === 'below') return vh - margin - holeRect.bottom;
    return holeRect.top - margin;
  };
  const need = (side) => (side === 'right' || side === 'left' ? cw + gap : ch + gap);
  const order = [step.prefer, 'right', 'left', 'below', 'above'].filter((side, index, list) => (
    side && list.indexOf(side) === index
  ));
  const side = order.find((item) => space(item) >= need(item))
    || order.reduce((best, item) => (space(item) > space(best) ? item : best));

  if (side === 'right' && space('right') < need('right')) {
    holeRect.right = Math.max(holeRect.left + 96, vw - margin - cw - gap);
  } else if (side === 'left' && space('left') < need('left')) {
    holeRect.left = Math.min(holeRect.right - 96, margin + cw + gap);
  } else if (side === 'below' && space('below') < need('below')) {
    holeRect.bottom = Math.max(holeRect.top + 96, vh - margin - ch - gap);
  } else if (side === 'above' && space('above') < need('above')) {
    holeRect.top = Math.min(holeRect.bottom - 96, margin + ch + gap);
  }

  hole.style.left = `${holeRect.left}px`;
  hole.style.top = `${holeRect.top}px`;
  hole.style.width = `${Math.max(80, holeRect.right - holeRect.left)}px`;
  hole.style.height = `${Math.max(80, holeRect.bottom - holeRect.top)}px`;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let left = margin;
  let top = margin;
  if (side === 'right') {
    left = holeRect.right + gap;
    top = clamp(holeRect.top, margin, vh - margin - ch);
  } else if (side === 'left') {
    left = holeRect.left - gap - cw;
    top = clamp(holeRect.top, margin, vh - margin - ch);
  } else if (side === 'below') {
    top = holeRect.bottom + gap;
    left = clamp(holeRect.left + (holeRect.right - holeRect.left - cw) / 2, margin, vw - margin - cw);
  } else {
    top = holeRect.top - gap - ch;
    left = clamp(holeRect.left + (holeRect.right - holeRect.left - cw) / 2, margin, vw - margin - cw);
  }
  card.style.left = `${clamp(left, margin, vw - margin - cw)}px`;
  card.style.top = `${clamp(top, margin, vh - margin - ch)}px`;
}

function closeTour() {
  tour.open = false;
  $('review-tour').hidden = true;
  markTourSeen();
}

function showTourStep(index) {
  tour.index = Math.max(0, Math.min(TOUR_STEPS.length - 1, index));
  placeTour();
}

function startTour(force) {
  if (document.body.classList.contains('gate-on')) return;
  if (tour.open && !force) return;
  tour.open = true;
  tour.index = 0;
  $('review-tour').hidden = false;
  placeTour();
}

function maybeStartTour() {
  if (!state.account || document.body.classList.contains('gate-on')) return;
  const force = new URLSearchParams(location.search).has('tour');
  if (!force && tourSeen()) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(startTour);
  });
}

$('btn-tour').addEventListener('click', () => startTour(true));
$('tour-skip').addEventListener('click', closeTour);
$('tour-next').addEventListener('click', () => {
  if (tour.index >= TOUR_STEPS.length - 1) {
    closeTour();
    return;
  }
  showTourStep(tour.index + 1);
});
window.addEventListener('keydown', (event) => {
  if (!tour.open) return;
  if (event.key === 'Escape') closeTour();
  if (event.key === 'ArrowRight') $('tour-next').click();
});
window.addEventListener('resize', () => { if (tour.open) placeTour(); });

bindDial();
paintControls();
bootReview();
