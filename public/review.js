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
};

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3200);
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

function paintControls() {
  const dir = currentDirection();
  $('dial-pointer').style.transform = `translate(-50%,-100%) rotate(${dir.angle}deg)`;
  $('direction-name').textContent = `${dir.name} · ${String(dir.angle).padStart(3, '0')}°`;
  const minutes = Number($('duration-bar').value);
  $('duration-readout').textContent = formatDuration(minutes);
  const hour = Number($('hour-bar').value);
  $('hour-readout').textContent = hourLabel(hour);
  if (!state.sampleId) {
    $('route-line').textContent = `臺北出發 · ${dir.name} · ${formatDuration(minutes)} · ${hourLabel(hour)}`;
  }
}

function setBusy(busy, message) {
  state.busy = busy;
  ['btn-takeoff', 'btn-landing', 'btn-scenery', 'btn-comment', 'btn-new'].forEach((id) => {
    $(id).disabled = busy;
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
    sample.departureLocation || '臺北出發',
    sample.arrivalLocation || dir.name,
    formatDuration(sample.durationMinutes || Number($('duration-bar').value)),
    hourLabel(hour),
  ].join(' · ');
  $('takeoff-copy').textContent = sample.takeoffBroadcast || '還沒有起飛文字。';
  $('landing-copy').textContent = sample.landingBroadcast || '還沒有降落文字。';
  $('image-prompt').textContent = sample.imagePrompt || '';
  const frame = $('image-frame');
  if (sample.imageUrl) {
    frame.innerHTML = `<img alt="降落風景" src="${sample.imageUrl}">`;
  } else {
    frame.innerHTML = '<p>需要對照畫面時再按生圖。</p>';
  }
  $('comments').textContent = sample.comments || '還沒有評論。';
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
    return `<button type="button" class="sample-item${active}" data-id="${sample.sampleId}">
      <strong>${sample.sampleId}</strong>
      <small>${dir} · ${formatDuration(sample.durationMinutes)} · ${sample.arrivalLocation || '尚未降落'}</small>
    </button>`;
  }).join('');
}

function upsertSample(sample) {
  if (!sample) return;
  const rest = state.samples.filter((item) => item.sampleId !== sample.sampleId);
  state.samples = [sample, ...rest].slice(0, 24);
  renderSample(sample);
  renderList();
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

async function loadSamples() {
  try {
    const res = await fetch('/api/review/samples');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '讀取失敗');
    state.samples = data.samples || [];
    applyStore(data);
    if (state.samples[0]) renderSample(state.samples[0]);
    renderList();
  } catch (err) {
    toast(err.message || '讀取測試內容失敗');
  }
}

function payload() {
  return {
    sampleId: state.sampleId,
    routeDirection: currentDirection().key,
    durationMinutes: Number($('duration-bar').value),
    landingHour: Number($('hour-bar').value),
  };
}

async function generate(kind, waitText) {
  if (state.busy) return;
  setBusy(true, waitText);
  try {
    const res = await fetch('/api/review/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload(), kind }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '生成失敗');
    applyStore(data.review);
    upsertSample(data.sample);
    toast(kind === 'scenery' ? '風景圖已寫入' : '文字已寫入');
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
    toast('評論已寫回');
  } catch (err) {
    toast(err.message || '評論寫入失敗');
  } finally {
    setBusy(false);
  }
}

function startNew() {
  state.sampleId = '';
  $('sample-id').textContent = '尚未生成';
  $('takeoff-copy').textContent = '按「生成起飛文字」即可，不會播語音。';
  $('landing-copy').textContent = '按「生成降落文字」會依方向與飛行時間算出目的地。';
  $('image-frame').innerHTML = '<p>需要對照畫面時再按生圖。</p>';
  $('image-prompt').textContent = '';
  $('comments').textContent = '還沒有評論。';
  paintControls();
  renderList();
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
$('btn-takeoff').addEventListener('click', () => generate('takeoff', '正在寫起飛文字…'));
$('btn-landing').addEventListener('click', () => generate('landing', '正在寫降落文字…'));
$('btn-scenery').addEventListener('click', () => generate('scenery', '生圖中，可能需要半分鐘…'));
$('btn-comment').addEventListener('click', saveComment);
$('btn-new').addEventListener('click', startNew);
$('sample-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  const sample = state.samples.find((item) => item.sampleId === button.dataset.id);
  if (!sample) return;
  const index = directions.findIndex((item) => item.key === sample.routeDirection);
  if (index >= 0) state.direction = index;
  $('duration-bar').value = String(Math.max(30, Math.min(720, sample.durationMinutes || 90)));
  $('hour-bar').value = String(sample.landingHour == null ? -1 : sample.landingHour);
  paintControls();
  renderSample(sample);
  renderList();
});

bindDial();
paintControls();
loadSamples();
