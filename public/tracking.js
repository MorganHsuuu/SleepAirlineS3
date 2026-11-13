(function () {
  const TZ = 'Asia/Taipei';
  const DEFAULT_GROUP = '0001';
  const DAY_COUNT = 14;
  const STUDY_START = '2026-11-11';
  const HOUR_PX = 8;
  const MIN_HOUR_PX = 4;
  const MAX_HOUR_PX = 28;
  const ROSTER = {
    '0001': [
      { passengerId: 'PAX-55437891114D2919', name: 'P1' },
      { passengerId: 'PAX-B3BE4881874F9979', name: 'P2' },
      { passengerId: 'PAX-4B2833F4A0C45412', name: 'P3' },
      { passengerId: 'PAX-37D428C61D98D16C', name: 'P4' },
      { passengerId: 'PAX-F8CCB63A79A2ABF7', name: 'P5' },
    ],
  };

  const PLANE_SVG = '<svg class="plane" aria-hidden="true"><use href="#plane"/></svg>';
  const KIND_LABEL = { night: '夜間休息', day: '日間使用', nap: '小憩／午睡', blip: '短暫測試' };
  const HEADINGS = {
    northbound: { zh: '向北', deg: 0 },
    northeast: { zh: '東北', deg: 45 },
    eastbound: { zh: '向東', deg: 90 },
    southeast: { zh: '東南', deg: 135 },
    southbound: { zh: '向南', deg: 180 },
    southwest: { zh: '西南', deg: 225 },
    westbound: { zh: '向西', deg: 270 },
    northwest: { zh: '西北', deg: 315 },
  };
  const FLAG_ALIASES = [
    [['日本', 'japan'], 'JP'],
    [['韓國', '南韓', 'south korea', 'korea'], 'KR'],
    [['臺灣', '台灣', 'taiwan'], 'TW'],
    [['中國', 'china'], 'CN'],
    [['香港', 'hong kong'], 'HK'],
    [['菲律賓', 'philippines'], 'PH'],
    [['泰國', 'thailand'], 'TH'],
    [['新加坡', 'singapore'], 'SG'],
    [['越南', 'vietnam'], 'VN'],
    [['馬來西亞', 'malaysia'], 'MY'],
    [['埃及', 'egypt'], 'EG'],
    [['阿拉伯聯合酋長國', '阿聯酋', '阿聯', 'uae', 'united arab emirates'], 'AE'],
    [['美國', 'united states', 'usa'], 'US'],
    [['英國', 'united kingdom', 'uk'], 'GB'],
  ];
  let countryIsoMap = {};

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
    // Empty fields mean "not recorded yet" (a flight still in the air), not 0 minutes.
    const recorded = (value) => (value == null || value === '' ? NaN : Number(value));
    const sleep = recorded(flight.sleepOpportunityMinutes);
    if (Number.isFinite(sleep) && sleep >= 0) return Math.round(sleep);
    const logged = recorded(flight.flightDurationMinutes);
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
    if (n < 60) return `${n}m`;
    const h = Math.floor(n / 60);
    const m = n % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function classifyKind(flight, tz, now) {
    const takeoff = zonedParts(flight.takeoffTime, tz);
    if (!takeoff) return 'day';
    const minutes = durationMinutes(flight, now);
    if (minutes != null && minutes < 10) return 'blip';
    const hour = takeoff.hour;
    // Still in the air: the length is not final yet, so a flight that took off
    // at night stays a night leg instead of starting out as a nap.
    const open = flight.status === 'in_flight' && !flight.landingTime;
    if (open && (hour >= 20 || hour < 7)) return 'night';
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
      routeDirection: flight.routeDirection || '',
      takeoffBroadcast: String(flight.takeoffBroadcast || '').trim(),
      captainBroadcast: String(flight.captainBroadcast || '').trim(),
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
        name: '',
      });
    }
    extras.sort((a, b) => a.passengerId.localeCompare(b.passengerId));
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
      const name = person.name || `P${index + 1}`;
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
      hourPx: options?.hourPx || HOUR_PX,
      totalMin: range.totalMin,
      nowMin: nowMin > 0 && nowMin < range.totalMin ? nowMin : null,
      progress: Math.min(1, Math.max(0, nowMin / range.totalMin)),
      dayNumber: Math.min(dayCount, Math.max(1, Math.floor(nowMin / 1440) + 1)),
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clampHourPx(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return HOUR_PX;
    return Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, Math.round(n * 10) / 10));
  }

  function scrollLeftForAnchor(scrollLeft, clientX, rectLeft, whoW, prevPx, nextPx) {
    const hours = (scrollLeft + (clientX - rectLeft) - whoW) / prevPx;
    return hours * nextPx - (clientX - rectLeft) + whoW;
  }

  function hourMarks(days, hourPx) {
    const hours = hourPx >= 16 ? [3, 6, 9, 12, 15, 18, 21] : hourPx >= 7 ? [6, 12, 18] : [12];
    return days.map((day, index) => {
      const ticks = hours.map((hour) =>
        `<span class="hour-tick" style="left:${(index * 24 + hour) / (days.length * 24) * 100}%">${String(hour).padStart(2, '0')}</span>`
      ).join('');
      return `<div class="day-band" style="left:${index / days.length * 100}%;width:${100 / days.length}%">
        <b>${escapeHtml(day.key)}</b>
        <small>${escapeHtml(day.short)}</small>
        <i>${escapeHtml(day.weekday)}</i>
      </div>${ticks}`;
    }).join('');
  }

  // Point-to-point leg: takeoff dot, line, landing dot. Timestamps sit above
  // each dot and the duration above the line; legs too short for two
  // timestamps keep only the duration.
  // A flight still in the air (10 minutes or more) always shows its takeoff
  // stamp; its line keeps growing to "now" in a translucent tone with a plane
  // at the tip, and turns solid with a landing dot once the passenger wakes.
  function renderBar(person, event, hourPx) {
    const px = ((event.endMin - event.startMin) / 60) * hourPx;
    const note = event.immigrationNote ? '<b class="note-pip" title="Immigration Note">N</b>' : '';
    const wide = px >= 34;
    const dep = wide || event.open
      ? `<span class="leg-time dep">${escapeHtml(event.takeoffTime)}</span>`
      : '';
    const arr = wide
      ? `<span class="leg-time arr">${escapeHtml(event.landingTime)}</span>`
      : '';
    const head = event.open
      ? `<span class="leg-plane">${PLANE_SVG}</span>`
      : '<i class="leg-dot arr"></i>';
    const state = event.open ? ` open${px < 22 ? ' fresh' : ''}` : '';
    return `<button type="button" class="sleep-bar ${event.kind}${state}" data-person="${escapeHtml(person.code)}" data-flight="${escapeHtml(event.flightId)}" style="left:${event.leftPct}%;width:${event.widthPct}%" aria-label="${escapeHtml(person.code)} ${escapeHtml(event.takeoffTime)} 到 ${escapeHtml(event.landingTime)}，${escapeHtml(event.durationLabel)}">
      <span class="leg-dur">${escapeHtml(event.durationLabel)}${note}</span>
      ${dep}${arr}
      <i class="leg-line"></i>
      <i class="leg-dot dep"></i>
      ${head}
    </button>`;
  }

  function renderTick(person, event) {
    return `<span class="sleep-tick" data-person="${escapeHtml(person.code)}" data-flight="${escapeHtml(event.flightId)}" style="left:${event.leftPct}%" title="測試 ${escapeHtml(event.takeoffTime)}"></span>`;
  }

  function renderChart(chart) {
    const hourPx = chart.hourPx || HOUR_PX;
    const trackWidth = chart.days.length * 24 * hourPx;
    const nowLeft = chart.nowMin != null ? `${(chart.nowMin / chart.totalMin) * 100}%` : '';
    const nowLine = nowLeft ? `<span class="now-line" style="left:${nowLeft}"></span>` : '';
    const nowLabel = nowLeft ? `<span class="now-line labeled" style="left:${nowLeft}"><em>現在</em></span>` : '';
    const axis = `<div class="axis">
      <div class="who-label">Pax</div>
      <div class="track" style="width:${trackWidth}px">
        ${hourMarks(chart.days, hourPx)}${nowLabel}
      </div>
    </div>`;

    const rows = chart.participants.map((person, index) => {
      const bars = person.bars.map((event) => renderBar(person, event, hourPx)).join('');
      const ticks = person.ticks.map((event) => renderTick(person, event)).join('');
      return `<article class="lane tone-${index % 6}">
        <div class="who">
          <small>PAX</small>
          <span class="pid">${escapeHtml(person.code)}</span>
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
      return '<tr><td colspan="4">這個航站還沒有航班紀錄。</td></tr>';
    }
    return chart.participants.map((person) => {
      const status = person.status === 'in_flight'
        ? '<span class="status-pill open">飛行中</span>'
        : person.status === 'landed'
          ? '<span class="status-pill landed">已降落</span>'
          : '<span class="status-pill">尚未起飛</span>';
      return `<tr>
        <td>${escapeHtml(person.code)}</td>
        <td>${person.totalFlights}</td>
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

  function headingInfo(key) {
    return HEADINGS[key] || null;
  }

  function headingLabel(key) {
    const info = headingInfo(key);
    if (!info) return '—';
    return `${info.zh} ${String(info.deg).padStart(3, '0')}°`;
  }

  function isoFromName(name) {
    const normalized = String(name || '').trim().replaceAll('台灣', '臺灣').toLowerCase();
    if (!normalized) return '';
    if (countryIsoMap[normalized]) return countryIsoMap[normalized];
    const hit = FLAG_ALIASES.find(([names]) => names.some((part) => normalized.includes(part)));
    return hit ? hit[1] : '';
  }

  function countryFlag(location) {
    const parts = String(location || '').split(/[,，]/).map((part) => part.trim()).filter(Boolean);
    for (const part of [...parts].reverse()) {
      const iso = isoFromName(part);
      if (iso) return [...iso].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
    }
    return '';
  }

  function loadCountryIso() {
    if (typeof fetch !== 'function') return;
    fetch('/country-iso.json')
      .then((res) => res.json())
      .then((data) => { countryIsoMap = data || {}; })
      .catch(() => {});
  }

  // "Taipei, Taiwan" + "TPE" → { main: 'Taipei', sub: 'Taiwan · TPE' }
  function splitPlace(location, airport, fallback) {
    const parts = String(location || '').split(/[,，]/).map((part) => part.trim()).filter(Boolean);
    const code = String(airport || '').trim().toUpperCase();
    if (!parts.length && !code) return { main: fallback, sub: '' };
    if (!parts.length) return { main: code, sub: '' };
    return {
      main: parts[0],
      sub: [parts.slice(1).join(', '), code].filter(Boolean).join(' · '),
    };
  }

  function shortDate(dateStr) {
    return dateStr ? dateStr.slice(5).replace('-', '/') : '—';
  }

  function renderPass(event) {
    const from = splitPlace(event.departureLocation, event.departureAirport, '出發地未記錄');
    const to = event.open
      ? { main: '飛行中', sub: '尚未降落' }
      : splitPlace(event.arrivalLocation, event.arrivalAirport, '降落點未記錄');
    const place = (label, value, side, location) => {
      const flag = countryFlag(location);
      return `<div class="pass-place${side}">
        <small>${label}</small>
        <strong>${flag ? `<span class="pass-flag">${flag}</span>` : ''}${escapeHtml(value.main)}</strong>
        <span>${escapeHtml(value.sub)}</span>
      </div>`;
    };
    const field = (label, value, accent) => `<div${accent ? ' class="accent"' : ''}><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
    const photo = event.open ? '' : `<figure class="pass-photo">
        <img alt="降落風景">
        <figcaption>降落風景</figcaption>
      </figure>`;
    const voiceBits = [
      event.takeoffBroadcast && `<p><span>起飛</span>${escapeHtml(event.takeoffBroadcast)}</p>`,
      event.captainBroadcast && `<p><span>降落</span>${escapeHtml(event.captainBroadcast)}</p>`,
    ].filter(Boolean);
    const voice = voiceBits.length
      ? `<details class="pass-voice"><summary>機長廣播</summary><div>${voiceBits.join('')}</div></details>`
      : '';
    const note = event.immigrationNote
      ? `<blockquote class="imm-note"><span>Immigration Note</span><p>${escapeHtml(event.immigrationNote)}</p></blockquote>`
      : '<p class="pass-empty">這班沒有留下 Immigration Note。</p>';
    return `<article class="pass ${event.kind}${event.open ? ' open' : ''}">
      ${photo}
      <div class="pass-route">
        ${place('From', from, '', event.departureLocation)}
        <div class="pass-path" aria-hidden="true"><i class="pass-line"></i>${PLANE_SVG}<i class="pass-line"></i></div>
        ${place('To', to, ' to', event.open ? '' : event.arrivalLocation)}
      </div>
      <dl class="pass-fields">
        ${field('Depart', event.takeoffTime)}
        ${field('Arrive', event.open ? '—' : event.landingTime)}
        ${field('Duration', event.durationLabel, true)}
        ${field('Heading', headingLabel(event.routeDirection))}
      </dl>
      <div class="pass-tear" aria-hidden="true"></div>
      ${note}
      ${voice}
    </article>`;
  }

  function openDetail(chart, personCode, flightId) {
    const dialog = document.getElementById('flight-detail');
    if (!dialog || !chart) return;
    const person = chart.participants.find((row) => row.code === personCode);
    const event = [...(person?.bars || []), ...(person?.ticks || [])]
      .find((row) => row.flightId === flightId);
    const heading = document.getElementById('detail-heading');
    const sub = document.getElementById('detail-sub');
    const hdg = document.getElementById('detail-hdg');
    const body = document.getElementById('detail-body');
    if (!person || !event || !heading || !sub || !body) return;
    heading.textContent = person.code;
    sub.textContent = `${KIND_LABEL[event.kind] || KIND_LABEL.day} · ${shortDate(event.takeoffDate)}${event.open ? ' · 飛行中' : ''}`;
    if (hdg) {
      const info = headingInfo(event.routeDirection);
      const fromFlag = countryFlag(event.departureLocation);
      const toFlag = event.open ? '' : countryFlag(event.arrivalLocation);
      const flags = fromFlag && toFlag ? `${fromFlag} → ${toFlag}` : (fromFlag || toFlag);
      if (info || flags) {
        hdg.hidden = false;
        hdg.innerHTML = `${flags ? `<span class="detail-flags">${flags}</span>` : ''}${info ? `<b>${escapeHtml(info.zh)}</b><i>${String(info.deg).padStart(3, '0')}°</i>` : ''}`;
      } else {
        hdg.hidden = true;
        hdg.replaceChildren();
      }
    }
    body.innerHTML = renderPass(event);
    const photo = body.querySelector('.pass-photo');
    const img = photo?.querySelector('img');
    if (photo && img && !event.open) {
      const reveal = () => {
        window.requestAnimationFrame(() => photo.classList.add('is-ready'));
      };
      img.onload = reveal;
      img.onerror = () => {
        photo.classList.add('is-missing');
        const cap = photo.querySelector('figcaption');
        if (cap) cap.textContent = '尚無風景';
      };
      img.src = `/api/scenery-image?flightId=${encodeURIComponent(event.flightId)}`;
      if (img.complete && img.naturalWidth) reveal();
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  // Distance from the scroller's left edge to hour 0 of the track: sticky stub + track lead-in margin.
  function whoWidth(scroller) {
    const stub = scroller.querySelector('.who')?.getBoundingClientRect().width || 88;
    const track = scroller.querySelector('.track');
    const lead = track ? parseFloat(getComputedStyle(track).marginLeft) || 0 : 0;
    return stub + lead;
  }

  function applyHourPx(scroller, chart, nextPx, focalClientX, relabel) {
    if (!scroller || !chart) return chart?.hourPx || HOUR_PX;
    const prev = chart.hourPx || HOUR_PX;
    const hourPx = clampHourPx(nextPx);
    const rect = scroller.getBoundingClientRect();
    const ww = whoWidth(scroller);
    const nextScroll = scrollLeftForAnchor(
      scroller.scrollLeft,
      focalClientX,
      rect.left,
      ww,
      prev,
      hourPx
    );
    chart.hourPx = hourPx;
    scroller.style.setProperty('--hour', `${hourPx}px`);
    const trackWidth = chart.days.length * 24 * hourPx;
    scroller.querySelectorAll('.track').forEach((el) => {
      el.style.width = `${trackWidth}px`;
    });
    scroller.scrollLeft = nextScroll;
    if (relabel) {
      const keep = scroller.scrollLeft;
      scroller.innerHTML = renderChart(chart);
      scroller.scrollLeft = keep;
    }
    return hourPx;
  }

  function bindChartGestures(scroller) {
    let pan = null;
    let pinch = null;
    let relabelTimer = 0;

    const touchPoint = (touch) => ({ x: touch.clientX, y: touch.clientY });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a, b) => (a.x + b.x) / 2;

    const scheduleRelabel = () => {
      window.clearTimeout(relabelTimer);
      relabelTimer = window.setTimeout(() => {
        if (!lastChart) return;
        const keep = scroller.scrollLeft;
        scroller.innerHTML = renderChart(lastChart);
        scroller.scrollLeft = keep;
      }, 90);
    };

    const zoomAt = (nextPx, clientX, relabel) => {
      if (!lastChart) return;
      userHourPx = applyHourPx(scroller, lastChart, nextPx, clientX, relabel);
    };

    // One finger is left to the browser (CSS touch-action: pan-x pan-y), so the
    // timeline scrolls sideways and the page still scrolls up and down. Only
    // two-finger pinches are handled here.
    scroller.addEventListener('touchstart', (event) => {
      if (event.touches.length < 2) return;
      if (event.cancelable) event.preventDefault();
      const a = touchPoint(event.touches[0]);
      const b = touchPoint(event.touches[1]);
      pinch = {
        startDist: Math.max(1, dist(a, b)),
        startPx: lastChart?.hourPx || userHourPx,
      };
      scroller.classList.add('pinching');
    }, { passive: false });

    scroller.addEventListener('touchmove', (event) => {
      if (event.touches.length < 2 || !pinch || !lastChart) return;
      if (event.cancelable) event.preventDefault();
      const a = touchPoint(event.touches[0]);
      const b = touchPoint(event.touches[1]);
      zoomAt(pinch.startPx * (dist(a, b) / pinch.startDist), midX(a, b), false);
    }, { passive: false });

    const endTouch = (event) => {
      if (event.touches.length < 2 && pinch) {
        pinch = null;
        scroller.classList.remove('pinching');
        scheduleRelabel();
      }
    };
    scroller.addEventListener('touchend', endTouch);
    scroller.addEventListener('touchcancel', endTouch);

    scroller.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse') return;
      if (event.target.closest?.('.sleep-bar, .sleep-tick, a, input, button')) return;
      pan = { x: event.clientX, scroll: scroller.scrollLeft };
      scroller.classList.add('panning');
      scroller.setPointerCapture?.(event.pointerId);
    });
    scroller.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' || !pan || pinch) return;
      scroller.scrollLeft = pan.scroll - (event.clientX - pan.x);
    });
    const stopMousePan = () => {
      if (pinch) return;
      pan = null;
      scroller.classList.remove('panning');
    };
    scroller.addEventListener('pointerup', stopMousePan);
    scroller.addEventListener('pointercancel', stopMousePan);

    scroller.addEventListener('gesturestart', (event) => {
      event.preventDefault();
      pinch = { startDist: 1, startPx: lastChart?.hourPx || userHourPx };
      scroller.classList.add('pinching');
    }, { passive: false });
    scroller.addEventListener('gesturechange', (event) => {
      event.preventDefault();
      if (!pinch) return;
      zoomAt(pinch.startPx * event.scale, event.clientX || scroller.getBoundingClientRect().left + scroller.clientWidth / 2, false);
    }, { passive: false });
    scroller.addEventListener('gestureend', (event) => {
      event.preventDefault();
      pinch = null;
      scroller.classList.remove('pinching');
      scheduleRelabel();
    }, { passive: false });

    return { zoomAt, scheduleRelabel };
  }

  function lockPageZoom() {
    const block = (event) => {
      if (event.touches && event.touches.length > 1 && !event.target.closest?.('#chart')) {
        event.preventDefault();
      }
    };
    document.addEventListener('touchmove', block, { passive: false });
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((name) => {
      document.addEventListener(name, (event) => event.preventDefault(), { capture: true, passive: false });
    });
    let lastTap = 0;
    document.addEventListener('touchend', (event) => {
      if (event.target.closest?.('input, textarea, button, a, .sleep-bar')) return;
      const now = Date.now();
      if (now - lastTap < 280) event.preventDefault();
      lastTap = now;
    }, { passive: false });
    let wheelRelabel = 0;
    window.addEventListener('wheel', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const scroller = document.getElementById('chart');
      if (!lastChart || !scroller) return;
      if (!scroller.contains(event.target) && event.target !== scroller) return;
      const factor = Math.exp(-event.deltaY * 0.008);
      userHourPx = applyHourPx(
        scroller,
        lastChart,
        (lastChart.hourPx || userHourPx) * factor,
        event.clientX,
        false
      );
      window.clearTimeout(wheelRelabel);
      wheelRelabel = window.setTimeout(() => {
        const keep = scroller.scrollLeft;
        scroller.innerHTML = renderChart(lastChart);
        scroller.scrollLeft = keep;
      }, 90);
    }, { passive: false, capture: true });
  }

  function scrollToNow(scroller, chart) {
    if (!scroller || !chart) return;
    const hourPx = chart.hourPx || HOUR_PX;
    const ww = whoWidth(scroller);
    const visibleMin = Math.max(6 * 60, ((scroller.clientWidth - ww) / hourPx) * 60);
    const latestBar = chart.participants
      .flatMap((person) => person.bars)
      .sort((a, b) => b.endMin - a.endMin)[0];
    const focusMin = chart.nowMin != null
      ? chart.nowMin
      : (latestBar ? latestBar.endMin : 0);
    const targetMin = Math.max(0, focusMin - visibleMin * 0.78);
    scroller.scrollLeft = (targetMin / 60) * hourPx;
  }

  // Header route line: a plane sitting at "today" between D1 and the last day.
  function renderFlightpath(chart) {
    const first = chart.days[0];
    const last = chart.days[chart.days.length - 1];
    const line = document.getElementById('fp-line');
    if (!first || !last || !line) return;
    line.style.setProperty('--progress', `${(chart.progress * 100).toFixed(2)}%`);
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set('fp-start-key', first.key);
    set('fp-start', first.short);
    set('fp-end-key', last.key);
    set('fp-end', last.short);
    set('fp-day', `DAY ${chart.dayNumber}/${chart.days.length}`);
  }

  let lastChart = null;
  let userHourPx = HOUR_PX;
  let chartGestures = null;
  let hasView = false;

  async function refresh() {
    const dialog = document.getElementById('flight-detail');
    if (dialog?.open) return;
    const scroller = document.getElementById('chart');
    if (scroller?.classList.contains('pinching')) return;
    const input = document.getElementById('group-input');
    const groupId = normalizeGroupId(input?.value || DEFAULT_GROUP);
    if (input) input.value = groupId;
    document.getElementById('group-label').textContent = groupId;
    const status = document.getElementById('status-line');
    status.classList.remove('error');
    status.textContent = `讀取航站 ${groupId} 的航班紀錄…`;
    const keepHours = hasView && scroller && lastChart
      ? scroller.scrollLeft / (lastChart.hourPx || userHourPx)
      : null;
    try {
      const chart = await loadChart(groupId);
      chart.hourPx = userHourPx;
      lastChart = chart;
      scroller.style.setProperty('--hour', `${chart.hourPx}px`);
      scroller.innerHTML = renderChart(chart);
      document.getElementById('ledger-body').innerHTML = renderLedger(chart);
      renderFlightpath(chart);
      if (keepHours != null) scroller.scrollLeft = keepHours * chart.hourPx;
      else scrollToNow(scroller, chart);
      hasView = true;
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
    MIN_HOUR_PX,
    MAX_HOUR_PX,
    clampHourPx,
    scrollLeftForAnchor,
    normalizeGroupId,
    durationMinutes,
    classifyKind,
    inferPattern,
    buildChart,
    formatDuration,
    splitPlace,
    headingLabel,
    countryFlag,
  };

  if (typeof document !== 'undefined' && document.getElementById('chart')) {
    loadCountryIso();
    const params = new URLSearchParams(window.location.search);
    const input = document.getElementById('group-input');
    if (input) input.value = normalizeGroupId(params.get('groupId') || DEFAULT_GROUP);
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
      hasView = false;
      refresh();
    });
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
    if (scroller && !chartGestures) {
      chartGestures = bindChartGestures(scroller);
      lockPageZoom();
    }
    const bumpZoom = (factor) => {
      if (!scroller || !lastChart) return;
      const rect = scroller.getBoundingClientRect();
      userHourPx = applyHourPx(
        scroller,
        lastChart,
        (lastChart.hourPx || userHourPx) * factor,
        rect.left + scroller.clientWidth * 0.58,
        true
      );
    };
    document.getElementById('zoom-in')?.addEventListener('click', () => bumpZoom(1.28));
    document.getElementById('zoom-out')?.addEventListener('click', () => bumpZoom(1 / 1.28));
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
