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
  busy: false,
  samples: [],
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

function sampleImageSrc(sample) {
  if (!sample?.sampleId) return '';
  if (sample.hasImage || sample.imageUrl) {
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

function renderSample(sample) {
  if (!sample) return;
  state.sampleId = sample.sampleId;
  const dir = directions.find((item) => item.key === sample.routeDirection) || currentDirection();
  const hour = sample.landingHour == null ? -1 : Number(sample.landingHour);
  $('sample-id').textContent = sample.sampleId;
  $('route-line').textContent = [
    `${shortPlace(sample.departureLocation || '臺北')} → ${shortPlace(sample.arrivalLocation || dir.name)}`,
    formatDuration(sample.durationMinutes || Number($('duration-bar').value)),
    hourLabel(hour),
  ].join(' · ');
  $('takeoff-copy').textContent = sample.takeoffBroadcast || '還沒有起飛文字。';
  $('landing-copy').textContent = sample.landingBroadcast || '還沒有降落文字。';
  $('image-prompt').textContent = sample.imagePrompt || '';
  const frame = $('image-frame');
  const src = sampleImageSrc(sample);
  if (src) {
    const img = document.createElement('img');
    img.alt = '降落風景';
    img.src = src;
    img.onload = () => { img.dataset.ok = '1'; };
    img.onerror = () => {
      frame.innerHTML = '<p>圖片暫時無法載入。通常是 Notion 網址過期，請再點一次這筆紀錄。</p>';
    };
    frame.replaceChildren(img);
  } else {
    frame.innerHTML = '<p>選擇「文字＋圖片」時會一起生成風景。</p>';
  }
  $('comments').textContent = sample.comments || '還沒有評論。';
  $('origin-note').textContent = `下一班從${originLabel()}接著飛`;
  renderList();
}

function renderList() {
  const box = $('sample-list');
  if (!state.samples.length) {
    box.innerHTML = '<p class="hint">生成第一筆後會出現在這裡。</p>';
    return;
  }
  box.innerHTML = state.samples.map((sample) => {
    const dir = directions.find((item) => item.key === sample.routeDirection)?.name || sample.routeDirection;
    const active = sample.sampleId === state.sampleId ? ' active' : '';
    const from = shortPlace(sample.departureLocation || '臺北');
    const to = shortPlace(sample.arrivalLocation || '尚未降落');
    const pic = sample.hasImage || sample.imageUrl ? ' · 有圖' : '';
    return `<button type="button" class="sample-item${active}" data-id="${escapeHtml(sample.sampleId)}">
      <strong>${escapeHtml(sample.sampleId)}</strong>
      <small>${escapeHtml(from)} → ${escapeHtml(to)} · ${escapeHtml(dir)} · ${escapeHtml(formatDuration(sample.durationMinutes))}${pic}</small>
    </button>`;
  }).join('');
}

function upsertSample(sample) {
  if (!sample) return;
  const rest = state.samples.filter((item) => item.sampleId !== sample.sampleId);
  state.samples = [sample, ...rest].slice(0, 40);
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

async function drawGlobe(route, progress = 1) {
  const points = globeFromRoute(route);
  if (!points) return;
  const caption = `${points.from.name} → ${points.to.name}`;
  $('globe-caption').textContent = caption;
  try { await window.FlightGlobe.ready; } catch { /* still draw the sphere */ }
  window.FlightGlobe.draw(points.from, points.to, progress);
}

async function flyGlobe(route) {
  const points = globeFromRoute(route);
  if (!points) return;
  $('globe-caption').textContent = `${points.from.name} → ${points.to.name}`;
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
    applyStore(data);
    renderList();
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
    toast(data.warning || (includeImage ? '已新增文字與圖片' : '已新增一筆文字紀錄'));
    await flyGlobe(data.route || state.preview);
  } catch (err) {
    toast(err.message || '生成失敗');
  } finally {
    setBusy(false);
  }
}

async function saveComment() {
  if (state.busy) return;
  if (!state.sampleId) {
    toast('請先生成一筆內容。');
    return;
  }
  const comment = $('comment').value.trim();
  if (!comment) {
    toast('請先寫評論。');
    return;
  }
  setBusy(true);
  try {
    const res = await fetch('/api/review/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleId: state.sampleId,
        comment,
        reviewer: $('reviewer').value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '評論寫入失敗');
    upsertSample(data.sample);
    $('comment').value = '';
    toast('評論已寫回這一筆');
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
$('btn-comment').addEventListener('click', saveComment);
$('sample-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  const sample = state.samples.find((item) => item.sampleId === button.dataset.id);
  if (!sample) return;
  const index = directions.findIndex((item) => item.key === sample.routeDirection);
  if (index >= 0) state.direction = index;
  $('duration-bar').value = String(Math.max(30, Math.min(720, sample.durationMinutes || 90)));
  $('hour-bar').value = String(sample.landingHour == null ? -1 : sample.landingHour);
  renderSample(sample);
  $('dial-pointer').style.transform = `translate(-50%,-100%) rotate(${currentDirection().angle}deg)`;
  $('direction-name').textContent = `${currentDirection().name} · ${String(currentDirection().angle).padStart(3, '0')}°`;
  $('duration-readout').textContent = formatDuration(Number($('duration-bar').value));
  $('hour-readout').textContent = hourLabel(Number($('hour-bar').value));
  await loadHop(sample.departureLocation, sample.arrivalLocation);
});

bindDial();
paintControls();
loadSamples().then(() => loadPreview());
