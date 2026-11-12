(function () {
  const TZ = 'Asia/Taipei';
  const DEFAULT_GROUP = '0001';
  const DAY_COUNT = 14;
  const STUDY_START = '2026-11-09';
  const HOUR_PX = 18;
  const ROSTER = {
    '0001': [
      { passengerId: 'PAX-55437891114D2919', name: '方藝璇' },
      { passengerId: 'PAX-B3BE4881874F9979', name: '戴佑珊' },
      { passengerId: 'PAX-4B2833F4A0C45412', name: '翎翎' },
      { passengerId: 'PAX-37D428C61D98D16C', name: 'Zephyra' },
      { passengerId: 'PAX-F8CCB63A79A2ABF7', name: '陳希愷' },
    ],
  };

  const MOON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M15.2 3.2a8.8 8.8 0 1 1-8 14.7 7.3 7.3 0 1 0 8-14.7z"/></svg>';
  const SUN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6"/></g></svg>';

  function normalizeGroupId(value) {
    const legacy = /^group_(\d{2})$/i.exec(value || '');
    if (legacy) return legacy[1].padStart(4, '0');
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return DEFAULT_GROUP;
    return digits.slice(-4).padStart(4, '0');
  }

  function zonedParts(iso, tz) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
      }).formatToParts(date).map((part) => [part.type, part.value])
    );
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      time: `${parts.hour}:${parts.minute}`,
      weekday: parts.weekday,
    };
  }

  function weekdayZh(dateStr) {
    const labels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    const stamp = new Date(`${dateStr}T12:00:00+08:00`);
    return labels[stamp.getUTCDay()];
  }

  function addDays(dateStr, days) {
    const stamp = new Date(`${dateStr}T12:00:00+08:00`);
    stamp.setUTCDate(stamp.getUTCDate() + days);
    return stamp.toISOString().slice(0, 10);
  }

  function durationMinutes(flight, now) {
    const sleep = Number(flight.sleepOpportunityMinutes);
    if (Number.isFinite(sleep) && sleep >= 0) return Math.round(sleep);
    const logged = Number(flight.flightDurationMinutes);
    if (Number.isFinite(logged) && logged >= 0) return Math.round(logged);
    const start = new Date(flight.takeoffTime).getTime();
    if (!Number.isFinite(start)) return null;
    const end = flight.landingTime ? new Date(flight.landingTime).getTime() : now.getTime();
    if (!Number.isFinite(end) || end < start) return null;
    return Math.max(0, Math.round((end - start) / 60000));
  }

  function formatDuration(minutes) {
    if (minutes == null) return '—';
    const n = Math.max(0, Math.round(minutes));
    if (n < 60) return `${n}分`;
    const h = Math.floor(n / 60);
    const m = n % 60;
    return m ? `${h}時${m}分` : `${h}時`;
  }

  function classifyKind(flight, tz, now) {
    const takeoff = zonedParts(flight.takeoffTime, tz);
    if (!takeoff) return 'day';
    const minutes = durationMinutes(flight, now);
    if (minutes != null && minutes < 10) return 'blip';
    const hour = takeoff.hour;
    if (minutes != null && minutes <= 90 && hour >= 11 && hour < 18) return 'nap';
    if (minutes != null && minutes <= 45) return 'nap';
    if (hour >= 20 || hour < 7) return 'night';
    return 'day';
  }

  function inferPattern(dayFlags) {
    const used = dayFlags.map((flag, index) => (flag ? index : -1)).filter((index) => index >= 0);
    const usedCount = used.length;
    const night = dayFlags.filter((flag) => flag === 'night').length;
    const day = dayFlags.filter((flag) => flag === 'day').length;
    const nap = dayFlags.filter((flag) => flag === 'nap').length;
    const firstUsed = used[0];
    const lastUsed = used[used.length - 1];

    if (usedCount === 0) {
      return { key: 'quiet', en: 'No Flights Yet', zh: '尚未起飛' };
    }
    if (firstUsed >= 2 && usedCount <= Math.ceil(dayFlags.length / 2)) {
      return { key: 'later_shared', en: 'Later + Shared', zh: '較晚加入・共用' };
    }
    if (usedCount >= 3 && lastUsed <= dayFlags.length - 3 && firstUsed <= 1) {
      return { key: 'later_forgetting', en: 'Later Forgetting', zh: '後期忙其他事忘記' };
    }
    if (usedCount <= 3) {
      return { key: 'intermittent', en: 'Intermittent Use', zh: '間歇性使用' };
    }
    if (nap >= 2 && night > 0 && day > 0) {
      return { key: 'flexible', en: 'Flexible Use', zh: '不規律＋午睡' };
    }
    if (night >= Math.max(4, usedCount * 0.7) || (night >= 4 && day === 0)) {
      return { key: 'regular', en: 'Regular Use', zh: '規律的夜班生活' };
    }
    if (day >= Math.max(4, usedCount * 0.7)) {
      return { key: 'regular_day', en: 'Regular Use', zh: '規律的夜班生活' };
    }
    return { key: 'mixed', en: 'Flexible Use', zh: '不規律＋午睡' };
  }

  function buildDays(options) {
    const start = options?.startDate || STUDY_START;
    const count = options?.dayCount || DAY_COUNT;
    return Array.from({ length: count }, (_, index) => {
      const date = addDays(start, index);
      return {
        key: `D${index + 1}`,
        date,
        weekday: weekdayZh(date),
        short: date.slice(5).replace('-', '/'),
      };
    });
  }

  function studyRange(startDate, dayCount) {
    const startMs = new Date(`${startDate}T00:00:00+08:00`).getTime();
    const totalMin = dayCount * 24 * 60;
    return { startMs, totalMin, endMs: startMs + totalMin * 60000 };
  }

  function eventFromFlight(flight, tz, now, range) {
    const takeoff = zonedParts(flight.takeoffTime, tz);
    const landing = flight.landingTime ? zonedParts(flight.landingTime, tz) : null;
    const minutes = durationMinutes(flight, now);
    const kind = classifyKind(flight, tz, now);
    const t0 = new Date(flight.takeoffTime).getTime();
    const t1 = flight.landingTime
      ? new Date(flight.landingTime).getTime()
      : (flight.status === 'in_flight' ? now.getTime() : t0 + (minutes || 40) * 60000);
    const rawStart = (t0 - range.startMs) / 60000;
    const rawEnd = (t1 - range.startMs) / 60000;
    const startMin = Math.max(0, rawStart);
    const endMin = Math.min(range.totalMin, rawEnd);
    const span = Math.max(0, endMin - startMin);
    return {
      flightId: flight.flightId,
      kind,
      open: flight.status === 'in_flight',
      status: flight.status,
      takeoffTime: takeoff ? takeoff.time : '—',
      landingTime: landing ? landing.time : (flight.status === 'in_flight' ? '飛行中' : '—'),
      takeoffDate: takeoff ? takeoff.date : '',
      durationMinutes: minutes,
      durationLabel: formatDuration(minutes),
      startMin,
      endMin,
      leftPct: (startMin / range.totalMin) * 100,
      widthPct: Math.max(kind === 'blip' ? 0.08 : 0.18, (span / range.totalMin) * 100),
      inWindow: endMin > 0 && startMin < range.totalMin && span > 0,
      departureLocation: flight.departureLocation || '',
      arrivalLocation: flight.arrivalLocation || '',
      departureAirport: flight.departureAirport || '',
      arrivalAirport: flight.arrivalAirport || '',
      immigrationNote: String(flight.immigrationNote || '').trim(),
    };
  }

  function rosterFor(groupId, flights, includeExtras) {
    const pinned = ROSTER[groupId] ? ROSTER[groupId].map((row) => ({ ...row })) : [];
    const known = new Set(pinned.map((row) => row.passengerId));
    const extras = [];
    for (const flight of flights) {
      if (!flight.passengerId || known.has(flight.passengerId)) continue;
      known.add(flight.passengerId);
      extras.push({
        passengerId: flight.passengerId,
        name: flight.passengerName || flight.passengerId.slice(-6),
      });
    }
    extras.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    if (pinned.length && !includeExtras) return pinned;
    return pinned.concat(extras);
  }

  function buildChart(flights, options) {
    const tz = options?.timezone || TZ;
    const now = options?.now || new Date();
    const groupId = normalizeGroupId(options?.groupId || DEFAULT_GROUP);
    const startDate = options?.startDate || STUDY_START;
    const dayCount = options?.dayCount || DAY_COUNT;
    const days = buildDays({ startDate, dayCount });
    const range = studyRange(startDate, dayCount);
    const dateSet = new Set(days.map((day) => day.date));
    const people = rosterFor(groupId, flights, options?.includeExtras);
    const nowMin = (now.getTime() - range.startMs) / 60000;

    const participants = people.map((person, index) => {
      const mine = flights
        .filter((flight) => flight.passengerId === person.passengerId)
        .sort((a, b) => new Date(a.takeoffTime) - new Date(b.takeoffTime));
      const name = mine.find((flight) => flight.passengerName)?.passengerName || person.name;
      const allEvents = mine
        .map((flight) => eventFromFlight(flight, tz, now, range))
        .filter((event) => event.inWindow);
      const byDate = new Map();
      for (const event of allEvents) {
        if (!event.takeoffDate || !dateSet.has(event.takeoffDate)) continue;
        const list = byDate.get(event.takeoffDate) || [];
        list.push(event);
        byDate.set(event.takeoffDate, list);
      }

      const dayRows = days.map((day) => {
        const all = byDate.get(day.date) || [];
        const substantial = all
          .filter((event) => event.kind !== 'blip')
          .sort((a, b) => (b.durationMinutes || 0) - (a.durationMinutes || 0));
        const blips = all.filter((event) => event.kind === 'blip');
        return {
          key: day.key,
          date: day.date,
          events: substantial.slice(0, 2),
          blipCount: blips.length,
          hasNote: all.some((event) => event.immigrationNote),
          allEvents: all,
        };
      });
      const flags = dayRows.map((row) => {
        if (!row.events.length) return '';
        if (row.events.some((event) => event.kind === 'night')) return 'night';
        if (row.events.some((event) => event.kind === 'nap')) return 'nap';
        return 'day';
      });
      const pattern = inferPattern(flags);
      const bars = allEvents.filter((event) => event.kind !== 'blip');
      const ticks = allEvents.filter((event) => event.kind === 'blip');
      const totalMinutes = mine.reduce((sum, flight) => sum + (durationMinutes(flight, now) || 0), 0);
      const latest = mine[mine.length - 1] || null;
      const lastLanded = [...mine].reverse().find((flight) => flight.landingTime) || null;
      return {
        code: `P${index + 1}`,
        passengerId: person.passengerId,
        name,
        pattern,
        totalFlights: mine.length,
        totalMinutes,
        openCount: mine.filter((flight) => flight.status === 'in_flight').length,
        latestTakeoff: latest ? zonedParts(latest.takeoffTime, tz)?.time : '—',
        latestLanding: lastLanded?.landingTime ? zonedParts(lastLanded.landingTime, tz)?.time : (latest?.status === 'in_flight' ? 'OPEN' : '—'),
        status: latest?.status === 'in_flight' ? 'in_flight' : (latest ? 'landed' : 'idle'),
        days: dayRows,
        bars,
        ticks,
      };
    });

    return {
      groupId,
      timezone: tz,
      days,
      participants,
      hourPx: HOUR_PX,
      totalMin: range.totalMin,
      nowMin: nowMin > 0 && nowMin < range.totalMin ? nowMin : null,
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function markHtml(kind) {
    if (kind === 'night') return `<span class="mark moon">${MOON_SVG}</span>`;
    if (kind === 'nap') return '<span class="mark zz">Zz</span>';
    return `<span class="mark sun">${SUN_SVG}</span>`;
  }

  function hourMarks(days) {
    return days.map((day, index) => {
      const hours = [6, 12, 18].map((hour) =>
        `<span class="hour-tick" style="left:${(index * 24 + hour) / (days.length * 24) * 100}%"><em>${String(hour).padStart(2, '0')}</em></span>`
      ).join('');
      return `<div class="day-band" style="left:${index / days.length * 100}%;width:${100 / days.length}%">
        <b>${escapeHtml(day.key)}</b>
        <small>${escapeHtml(day.short)}</small>
      </div>${hours}`;
    }).join('');
  }

  function renderBar(person, event) {
    const px = ((event.endMin - event.startMin) / 60) * HOUR_PX;
    const note = event.immigrationNote ? '<span class="note-pip" title="Immigration Note">N</span>' : '';
    let label = '';
    if (px >= 168) {
      label = `<span class="bar-copy">${escapeHtml(event.takeoffTime)} → ${escapeHtml(event.landingTime)} · ${escapeHtml(event.durationLabel)}</span>`;
    } else if (px >= 92) {
      label = `<span class="bar-copy">${escapeHtml(event.takeoffTime)}→${escapeHtml(event.landingTime)}</span>`;
    } else if (px >= 56) {
      label = `<span class="bar-copy short">${escapeHtml(event.durationLabel)}</span>`;
    }
    return `<button type="button" class="sleep-bar ${event.kind}${event.open ? ' open' : ''}${event.immigrationNote ? ' noted' : ''}" data-person="${escapeHtml(person.code)}" data-flight="${escapeHtml(event.flightId)}" style="left:${event.leftPct}%;width:${event.widthPct}%" aria-label="${escapeHtml(person.name)} ${escapeHtml(event.takeoffTime)} 到 ${escapeHtml(event.landingTime)}">
      <i class="cap start" aria-hidden="true"></i>
      ${label}${note}
      <i class="cap end" aria-hidden="true"></i>
    </button>`;
  }

  function renderTick(person, event) {
    return `<span class="sleep-tick" data-person="${escapeHtml(person.code)}" data-flight="${escapeHtml(event.flightId)}" style="left:${event.leftPct}%" title="測試 ${escapeHtml(event.takeoffTime)}"></span>`;
  }

  function renderChart(chart) {
    const trackWidth = chart.days.length * 24 * (chart.hourPx || HOUR_PX);
    const nowLeft = chart.nowMin != null ? `${(chart.nowMin / chart.totalMin) * 100}%` : '';
    const nowLine = nowLeft ? `<span class="now-line" style="left:${nowLeft}"></span>` : '';
    const nowLabel = nowLeft ? `<span class="now-line labeled" style="left:${nowLeft}"><em>現在</em></span>` : '';
    const axis = `<div class="axis">
      <div class="who-label">Passenger</div>
      <div class="track" style="width:${trackWidth}px">
        ${hourMarks(chart.days)}${nowLabel}
      </div>
    </div>`;

    const rows = chart.participants.map((person, index) => {
      const bars = person.bars.map((event) => renderBar(person, event)).join('');
      const ticks = person.ticks.map((event) => renderTick(person, event)).join('');
      return `<article class="lane tone-${index % 6}">
        <div class="who">
          <span class="pid">${escapeHtml(person.code)}</span>
          <strong>${escapeHtml(person.name)}</strong>
          <em>${escapeHtml(person.pattern.zh)}</em>
        </div>
        <div class="track" style="width:${trackWidth}px">
          ${nowLine}${ticks}${bars}
        </div>
      </article>`;
    }).join('');

    return axis + rows;
  }

  function renderLedger(chart) {
    if (!chart.participants.length) {
      return '<tr><td colspan="6">這個航站還沒有航班紀錄。</td></tr>';
    }
    return chart.participants.map((person) => {
      const status = person.status === 'in_flight'
        ? '<span class="status-open">OPEN</span>'
        : person.status === 'landed'
          ? '<span class="status-landed">已降落</span>'
          : '尚未起飛';
      return `<tr>
        <td>${escapeHtml(person.code)} ${escapeHtml(person.name)}</td>
        <td>${person.totalFlights}</td>
        <td>${escapeHtml(formatDuration(person.totalMinutes))}</td>
        <td>${escapeHtml(person.latestTakeoff)}</td>
        <td>${escapeHtml(person.latestLanding)}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');
  }

  async function loadChart(groupId) {
    const res = await fetch(`/api/tracking?groupId=${encodeURIComponent(groupId)}`, { cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || '讀取航班失敗');
    return buildChart(payload.flights || [], {
      groupId: payload.groupId || groupId,
      timezone: payload.timezone || TZ,
      startDate: payload.startDate || STUDY_START,
      dayCount: payload.dayCount || DAY_COUNT,
      includeExtras: document.getElementById('extras-toggle')?.checked === true,
    });
  }

  function formatPlace(location, airport, fallback) {
    const loc = String(location || '').trim();
    const code = String(airport || '').trim().toUpperCase();
    if (!loc && !code) return fallback;
    if (loc && code) return `${loc} · ${code}`;
    return loc || code;
  }

  function renderDetailFlights(events) {
    if (!events.length) return '<p class="empty-copy">這段沒有航班。</p>';
    return events.map((event) => {
      const from = formatPlace(event.departureLocation, event.departureAirport, '出發地未記錄');
      const to = event.open
        ? '飛行中'
        : formatPlace(event.arrivalLocation, event.arrivalAirport, '降落點未記錄');
      const note = event.immigrationNote
        ? `<blockquote class="imm-note"><span>Immigration Note</span><p>${escapeHtml(event.immigrationNote)}</p></blockquote>`
        : '';
      const kindLabel = event.kind === 'night' ? '夜間休息' : event.kind === 'nap' || event.kind === 'blip' ? '小憩／測試' : '日間使用';
      return `<article class="hop ${event.kind}${event.open ? ' open' : ''}">
        <div class="hop-meta">
          ${markHtml(event.kind)}
          <div>
            <strong>${escapeHtml(event.takeoffTime)} → ${escapeHtml(event.landingTime)}</strong>
            <small>${escapeHtml(kindLabel)} · ${escapeHtml(event.durationLabel)}${event.open ? ' · OPEN' : ''}</small>
          </div>
        </div>
        <p class="route"><span>${escapeHtml(from)}</span><i aria-hidden="true">→</i><span>${escapeHtml(to)}</span></p>
        ${note}
      </article>`;
    }).join('');
  }

  function openDetail(chart, personCode, flightId) {
    const dialog = document.getElementById('flight-detail');
    if (!dialog || !chart) return;
    const person = chart.participants.find((row) => row.code === personCode);
    const event = [...(person?.bars || []), ...(person?.ticks || [])]
      .find((row) => row.flightId === flightId);
    const heading = document.getElementById('detail-heading');
    const sub = document.getElementById('detail-sub');
    const body = document.getElementById('detail-body');
    if (!person || !event || !heading || !sub || !body) return;
    heading.textContent = `${person.code} ${person.name}`;
    sub.textContent = `${event.takeoffTime} → ${event.landingTime} · ${event.durationLabel}`;
    body.innerHTML = renderDetailFlights([event]);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function bindPan(scroller) {
    let dragging = false;
    let origin = 0;
    let startScroll = 0;
    scroller.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.sleep-bar, .sleep-tick, a, input, button.ghost')) return;
      dragging = true;
      origin = event.clientX;
      startScroll = scroller.scrollLeft;
      scroller.classList.add('panning');
      scroller.setPointerCapture?.(event.pointerId);
    });
    scroller.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      scroller.scrollLeft = startScroll - (event.clientX - origin);
    });
    const stop = () => {
      dragging = false;
      scroller.classList.remove('panning');
    };
    scroller.addEventListener('pointerup', stop);
    scroller.addEventListener('pointercancel', stop);
  }

  function scrollToNow(scroller, chart) {
    if (!scroller || !chart) return;
    const latestBar = chart.participants
      .flatMap((person) => person.bars)
      .sort((a, b) => b.endMin - a.endMin)[0];
    const targetMin = latestBar
      ? Math.max(0, latestBar.endMin - 20 * 60)
      : (chart.nowMin != null ? Math.max(0, chart.nowMin - 8 * 60) : 0);
    scroller.scrollLeft = (targetMin / 60) * (chart.hourPx || HOUR_PX);
  }

  let lastChart = null;
  let panBound = false;

  async function refresh() {
    const dialog = document.getElementById('flight-detail');
    if (dialog?.open) return;
    const input = document.getElementById('group-input');
    const groupId = normalizeGroupId(input?.value || DEFAULT_GROUP);
    if (input) input.value = groupId;
    document.getElementById('group-label').textContent = groupId;
    const status = document.getElementById('status-line');
    status.classList.remove('error');
    status.textContent = `讀取航站 ${groupId} 的航班紀錄…`;
    try {
      const chart = await loadChart(groupId);
      lastChart = chart;
      const scroller = document.getElementById('chart');
      scroller.innerHTML = renderChart(chart);
      document.getElementById('ledger-body').innerHTML = renderLedger(chart);
      scrollToNow(scroller, chart);
      const open = chart.participants.reduce((sum, person) => sum + person.openCount, 0);
      const flights = chart.participants.reduce((sum, person) => sum + person.totalFlights, 0);
      status.textContent = `Terminal ${groupId} · ${chart.days[0]?.short || STUDY_START} 起 ${chart.days.length} 天時間軸 · ${chart.participants.length} 位乘客 · ${flights} 班 · ${open} 班飛行中`;
    } catch (err) {
      status.classList.add('error');
      status.textContent = err instanceof Error ? err.message : '讀取失敗';
    }
  }

  window.TrackingChart = {
    TZ,
    ROSTER,
    STUDY_START,
    DAY_COUNT,
    HOUR_PX,
    normalizeGroupId,
    durationMinutes,
    classifyKind,
    inferPattern,
    buildChart,
    formatDuration,
    formatPlace,
  };

  if (typeof document !== 'undefined' && document.getElementById('chart')) {
    const params = new URLSearchParams(window.location.search);
    const input = document.getElementById('group-input');
    if (input) input.value = normalizeGroupId(params.get('groupId') || DEFAULT_GROUP);
    document.getElementById('refresh-btn')?.addEventListener('click', refresh);
    document.getElementById('extras-toggle')?.addEventListener('change', refresh);
    input?.addEventListener('change', refresh);
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') refresh();
    });
    const scroller = document.getElementById('chart');
    scroller?.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-person][data-flight]');
      if (!button) return;
      openDetail(lastChart, button.getAttribute('data-person'), button.getAttribute('data-flight'));
    });
    if (scroller && !panBound) {
      bindPan(scroller);
      panBound = true;
    }
    document.getElementById('detail-close')?.addEventListener('click', () => {
      document.getElementById('flight-detail')?.close?.();
    });
    document.getElementById('flight-detail')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) event.currentTarget.close?.();
    });
    refresh();
    setInterval(refresh, 60000);
  }
})();
