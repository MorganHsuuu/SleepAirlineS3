/**
 * Phase 1 瀏覽器本機模式：無 npm / 無 Notion 時，資料存 localStorage。
 * 降落邏輯與 server.ts 一致：飛行時長 → 距離 → 從 cities_data.json 選目的地。
 */
(function () {
  const STORAGE_KEY = 'sleepAirline_workshopLocal_v1';
  const DEFAULT_LOCATION = 'Taipei, Taiwan';
  const DEFAULT_LAT = 25.033;
  const DEFAULT_LNG = 121.5654;
  const REFERENCE_MINUTES = 480;
  const KM_PER_MINUTE = 12;
  const EARTH_RADIUS_KM = 6371;

  let active = false;
  let citiesCache = null;
  let citiesLoadPromise = null;

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { passengers: {}, flights: [] };
      const data = JSON.parse(raw);
      return {
        passengers: data.passengers || {},
        flights: Array.isArray(data.flights) ? data.flights : [],
      };
    } catch {
      return { passengers: {}, flights: [] };
    }
  }

  function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function moveAlongBearing(lat, lng, bearingDeg, distanceKm) {
    const angularDistance = distanceKm / EARTH_RADIUS_KM;
    const bearing = toRad(bearingDeg);
    const lat1 = toRad(lat);
    const lon1 = toRad(lng);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
      );
    return {
      latitude: (lat2 * 180) / Math.PI,
      longitude: (((lon2 * 180) / Math.PI + 540) % 360) - 180,
    };
  }

  const DIRECTION_CENTER = {
    northbound: 0, northeast: 45, eastbound: 90, southeast: 135,
    southbound: 180, southwest: 225, westbound: 270, northwest: 315,
  };

  function isInDirection(bearing, direction) {
    const b = ((bearing % 360) + 360) % 360;
    switch (direction) {
      case 'northbound': return b >= 315 || b < 45;
      case 'northeast': return b >= 22.5 && b < 67.5;
      case 'eastbound': return b >= 45 && b < 135;
      case 'southeast': return b >= 112.5 && b < 157.5;
      case 'southbound': return b >= 135 && b < 225;
      case 'southwest': return b >= 202.5 && b < 247.5;
      case 'westbound': return b >= 225 && b < 315;
      case 'northwest': return b >= 292.5 && b < 337.5;
      default: return true;
    }
  }

  function parseCities(raw) {
    return raw
      .filter((e) => e.latitude != null && e.longitude != null && e.city)
      .map((entry) => {
        const country =
          entry.country && entry.country.length > 2
            ? entry.country
            : entry.country_zh || entry.country;
        const displayName =
          entry.city_zh && entry.country_zh
            ? `${entry.city_zh}, ${entry.country_zh}`
            : `${entry.city}, ${entry.country}`;
        return {
          displayName,
          city: entry.city_zh || entry.city,
          country,
          iso: entry.country_iso_code || '',
          latitude: entry.latitude,
          longitude: entry.longitude,
          availableForLanding: true,
        };
      });
  }

  async function loadCities() {
    if (citiesCache) return citiesCache;
    if (citiesLoadPromise) return citiesLoadPromise;
    citiesLoadPromise = (async () => {
      const urls = ['./cities_data.json', '/cities_data.json'];
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          citiesCache = parseCities(await res.json());
          return citiesCache;
        } catch { /* try next */ }
      }
      throw new Error(
        '找不到 cities_data.json。請在專案根目錄執行 npm install（或 npm run dev）後再試。'
      );
    })();
    return citiesLoadPromise;
  }

  function findArrivalDestination(depLat, depLng, distanceKm, routeDirection, destinations, departureLocation) {
    const available = destinations.filter(
      (d) => d.availableForLanding && d.displayName !== departureLocation
    );
    const tipBearing = DIRECTION_CENTER[routeDirection] ?? 90;
    const tip = moveAlongBearing(depLat, depLng, tipBearing, Math.max(distanceKm, 1));
    const candidates = available.map((dest) => {
      const actualDistance = haversineDistance(depLat, depLng, dest.latitude, dest.longitude);
      const bearing = calculateBearing(depLat, depLng, dest.latitude, dest.longitude);
      const tipDistanceKm = haversineDistance(tip.latitude, tip.longitude, dest.latitude, dest.longitude);
      return {
        ...dest,
        distanceKm: actualDistance,
        tipDistanceKm,
        inDirection: isInDirection(bearing, routeDirection),
      };
    });
    const byTip = (a, b) => {
      const tipDiff = a.tipDistanceKm - b.tipDistanceKm;
      if (Math.abs(tipDiff) > 1) return tipDiff;
      return Math.abs(a.distanceKm - distanceKm) - Math.abs(b.distanceKm - distanceKm);
    };
    const directional = candidates.filter((c) => c.inDirection);
    if (directional.length > 0) {
      directional.sort(byTip);
      return directional[0];
    }
    candidates.sort(byTip);
    if (!candidates[0]) {
      throw new Error('沒有可用的降落城市，請確認 cities_data.json 已同步到 public/。');
    }
    return candidates[0];
  }

  function flightProgress(takeoffTime) {
    const elapsed = (Date.now() - new Date(takeoffTime).getTime()) / 60000;
    return Math.min(100, Math.max(0, (elapsed / REFERENCE_MINUTES) * 100));
  }

  function narrativeRegion(progress) {
    if (progress < 20) return 'departure_clouds';
    if (progress < 40) return 'pacific_drift';
    if (progress < 60) return 'deep_night_current';
    if (progress < 80) return 'dawn_corridor';
    return 'arrival_harbor';
  }

  // 抵達時機長會補的當地文化 / 社交小語（依國家 ISO；找不到用通用款）
  const CULTURE_HINT = {
    JP: '記得入境隨俗，見到當地人時輕輕鞠個躬吧。',
    KR: '若和當地人乾杯，晚輩要側身、雙手捧杯才有禮貌喔。',
    CN: '喝茶時被斟茶，用手指輕敲桌面就是在說謝謝。',
    TW: '別忘了逛逛夜市，一句「呷飽沒」就能拉近距離。',
    HK: '茶餐廳可能要和陌生人「搭檯」，點杯凍鴛鴦感受在地節奏。',
    TH: '打招呼時雙手合十微微低頭，這是泰式的溫柔。',
    VN: '找張街邊小塑膠椅坐下，來杯滴漏咖啡就很在地。',
    SG: '熟食中心用面紙包佔位是默契，別搶了別人的座位。',
    MY: '入夜後到 mamak 檔喝杯拉茶，是當地人的宵夜社交。',
    IN: '雙手合十說聲「Namaste」，用右手遞物才有禮貌。',
    GB: '排隊是神聖的，到 pub 和鄰座聊聊天氣最道地。',
    FR: '進店先說聲「Bonjour」，會讓當地人對你另眼相看。',
    DE: '和人乾杯時記得眼神對視，這在德國是基本禮貌。',
    IT: '咖啡站著喝、午後別點卡布奇諾，就是道地義式。',
    ES: '晚餐晚一點才開始，配 tapas 聊天到深夜很正常。',
    US: '一個微笑加上 small talk，就能輕鬆破冰。',
    CA: '多說幾次「sorry」與「thank you」，很快就融入了。',
    AU: '用「no worries」回應一切，你就是半個澳洲人了。',
    BR: '見面用擁抱與貼臉頰問候，熱情是這裡的語言。',
    NL: '運河邊 borrel 小酌是下班社交；直率聊天別誤會為無禮。',
    RE: '見面先說「Bonjour」，克里奧料理與火山景觀值得探索。',
  };

  const MORNING_GREETING = {
    JP: 'おはようございます', KR: '안녕하세요', CN: '早上好', TW: '早安', HK: '早晨',
    TH: 'สวัสดีตอนเช้า', VN: 'Xin chào buổi sáng', FR: 'Bonjour', RE: 'Bonjour',
    NL: 'Goedemorgen', DE: 'Guten Morgen', IT: 'Buongiorno', ES: 'Buenos días',
    PT: 'Bom dia', GB: 'Good morning', US: 'Good morning', AU: 'Good morning',
    IN: 'Namaste', BR: 'Bom dia', MX: 'Buenos días', RU: 'Доброе утро',
  };

  function fallbackBroadcast(phase, name, departure, arrival, durationMinutes, iso, locale) {
    const en = locale === 'en';
    if (phase === 'takeoff') {
      if (en) {
        return `Welcome aboard Sleep Airline, this is your captain. Passengers, we are departing ${departure}. ${name}, fasten your seatbelt, dim the window, and rest.`;
      }
      return `歡迎搭乘 Sleep Airline，這裡是機長。各位乘客，本班即將自 ${departure} 起飛。${name}，請繫好安全帶、調暗舷窗，安心入睡。`;
    }
    const h = durationMinutes ? Math.floor(durationMinutes / 60) : 0;
    const m = durationMinutes ? durationMinutes % 60 : 0;
    const dur = en
      ? (h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min` : 'a stretch')
      : (h > 0 ? `${h} 小時 ${m} 分鐘` : m > 0 ? `${m} 分鐘` : '一段');
    const greet = (iso && MORNING_GREETING[iso]) ? `${MORNING_GREETING[iso]}${en ? '! ' : '！'}` : '';
    const hint = (iso && CULTURE_HINT[iso]) || (en
      ? 'Step out with curiosity and a smile for the locals.'
      : '走出艙門，帶著好奇心向當地人微笑問好吧。');
    if (en) {
      return `${greet}Welcome aboard Sleep Airline, this is your captain. We have arrived safely in ${arrival}. ${name} flew from ${departure} for ${dur}. ${hint} Until we share the same sky again.`;
    }
    return `${greet}歡迎搭乘 Sleep Airline，這裡是機長。各位乘客，甦醒航班已平安降落 ${arrival}，本地時間清晨。${name} 自 ${departure} 出發，共飛行 ${dur}。${hint} 期待與您在同一片天空再會。`;
  }

  function buildBoardFlights(flights, groupId) {
    const group = flights.filter((f) => f.groupId === groupId);
    const inFlight = group.filter((f) => f.status === 'in_flight');
    const flyingIds = new Set(inFlight.map((f) => f.passengerId));
    const latestLanded = new Map();
    for (const f of group) {
      if (f.status !== 'landed' || flyingIds.has(f.passengerId)) continue;
      const prev = latestLanded.get(f.passengerId);
      if (!prev || new Date(f.landingTime || f.takeoffTime) > new Date(prev.landingTime || prev.takeoffTime)) {
        latestLanded.set(f.passengerId, f);
      }
    }
    return [...inFlight, ...latestLanded.values()];
  }

  function enrichFlight(f) {
    if (f.status !== 'in_flight') {
      return {
        ...f,
        flightProgress: f.status === 'landed' ? 100 : 0,
        narrativeRegion: f.status === 'landed' ? 'arrival_harbor' : 'departure_clouds',
      };
    }
    const progress = flightProgress(f.takeoffTime);
    return { ...f, flightProgress: progress, narrativeRegion: narrativeRegion(progress) };
  }

  function handlePassenger(body) {
    if (body.researchConsent !== true) {
      throw new Error('請先勾選研究參與同意，才能登入。');
    }
    const store = loadStore();
    const { passengerId, name, groupId } = body;
    let created = false;
    let p = store.passengers[passengerId];
    if (!p) {
      created = true;
      p = {
        passengerId,
        name,
        groupId,
        status: 'not_started',
        currentLocation: DEFAULT_LOCATION,
        currentLatitude: DEFAULT_LAT,
        currentLongitude: DEFAULT_LNG,
        idPhotoUrl: null,
      };
    } else {
      p.name = name;
      p.groupId = groupId;
    }

    const activeF = store.flights.find((f) => f.passengerId === passengerId && f.status === 'in_flight');
    if (activeF) {
      p.status = 'in_flight';
      p.currentLocation = activeF.departureLocation;
      p.currentLatitude = activeF.departureLatitude;
      p.currentLongitude = activeF.departureLongitude;
    } else {
      const lastLanded = store.flights
        .filter((f) => f.passengerId === passengerId && f.status === 'landed')
        .sort((a, b) => new Date(b.landingTime || 0) - new Date(a.landingTime || 0))[0];
      if (lastLanded) {
        p.status = 'landed';
        p.currentLocation = lastLanded.arrivalLocation || DEFAULT_LOCATION;
        p.currentLatitude = lastLanded.arrivalLatitude ?? DEFAULT_LAT;
        p.currentLongitude = lastLanded.arrivalLongitude ?? DEFAULT_LNG;
      } else if (!created) {
        p.status = p.status || 'not_started';
      }
    }

    store.passengers[passengerId] = p;
    const latestPhoto = [...store.flights]
      .reverse()
      .find((f) => f.passengerId === passengerId && f.idPhotoUrl)?.idPhotoUrl;
    if (latestPhoto && !p.idPhotoUrl) p.idPhotoUrl = latestPhoto;
    saveStore(store);

    const lastLandedFlight = p.status !== 'in_flight'
      ? store.flights
          .filter((f) => f.passengerId === passengerId && f.status === 'landed')
          .sort((a, b) => new Date(b.landingTime || 0) - new Date(a.landingTime || 0))[0] || null
      : null;

    return {
      passenger: { ...p },
      created,
      lastLandedFlight: lastLandedFlight ? enrichFlight(lastLandedFlight) : null,
      landingScenery: null,
    };
  }

  function handleTakeoff(body) {
    const store = loadStore();
    const p = store.passengers[body.passengerId];
    if (!p) throw new Error('請先登入。');
    if (store.flights.some((f) => f.passengerId === body.passengerId && f.status === 'in_flight')) {
      throw new Error('你已有一趟尚未降落的航班，請先降落。');
    }
    if (body.researchConsent !== true) {
      throw new Error('請先勾選研究參與同意，才能起飛。');
    }

    const takeoffTime = new Date().toISOString();
    const flightId = `FL-LOCAL-${Date.now().toString(36).toUpperCase()}`;
    const routeDirection = body.routeDirection || 'auto';
    const locale = body.locale === 'en' ? 'en' : 'zh';
    const takeoffBroadcast = fallbackBroadcast('takeoff', p.name, p.currentLocation, null, null, null, locale);

    const flight = {
      notionId: `local_${flightId}`,
      flightId,
      passengerId: p.passengerId,
      passengerName: p.name,
      groupId: p.groupId,
      status: 'in_flight',
      departureLocation: p.currentLocation,
      departureLatitude: p.currentLatitude ?? DEFAULT_LAT,
      departureLongitude: p.currentLongitude ?? DEFAULT_LNG,
      arrivalLocation: null,
      arrivalLatitude: null,
      arrivalLongitude: null,
      takeoffTime,
      landingTime: null,
      flightDurationMinutes: null,
      estimatedFlightDistanceKm: null,
      routeDirection,
      takeoffBroadcastStyle: 'formal_captain',
      takeoffBroadcast,
      captainBroadcast: null,
      socialCueType: 'solo',
      socialCueText: locale === 'en'
        ? 'Tonight the sky is yours alone.'
        : '今晚你獨自享受這片天空。同組雷達上暫時只有你一人。',
      relatedPassenger: null,
      textMemo: '',
      idPhotoUrl: p.idPhotoUrl || (typeof body.idPhotoBase64 === 'string' ? body.idPhotoBase64 : null),
    };

    if (typeof body.idPhotoBase64 === 'string' && body.idPhotoBase64.startsWith('data:image/')) {
      p.idPhotoUrl = body.idPhotoBase64;
      flight.idPhotoUrl = body.idPhotoBase64;
    }

    store.flights.push(flight);
    p.status = 'in_flight';
    saveStore(store);
    return { flight: enrichFlight(flight) };
  }

  async function handleLand(body) {
    const cities = await loadCities();
    const store = loadStore();
    const p = store.passengers[body.passengerId];
    const idx = store.flights.findIndex((f) => f.passengerId === body.passengerId && f.status === 'in_flight');
    if (idx < 0) throw new Error('找不到進行中的航班。');

    const active = store.flights[idx];
    const landingTime = new Date().toISOString();
    const durationMinutes = Math.max(1, Math.round(
      (new Date(landingTime).getTime() - new Date(active.takeoffTime).getTime()) / 60000
    ));
    const distanceKm = durationMinutes * KM_PER_MINUTE;
    const arrival = findArrivalDestination(
      active.departureLatitude,
      active.departureLongitude,
      distanceKm,
      active.routeDirection,
      cities,
      active.departureLocation
    );
    const captainBroadcast = fallbackBroadcast(
      'landing',
      active.passengerName,
      active.departureLocation,
      arrival.displayName,
      durationMinutes,
      arrival.iso,
      body.locale === 'en' ? 'en' : 'zh'
    );

    const landed = {
      ...active,
      status: 'landed',
      landingTime,
      flightDurationMinutes: durationMinutes,
      estimatedFlightDistanceKm: Math.round(distanceKm),
      arrivalIso: arrival.iso || '',
      arrivalCountry: arrival.country || '',
      arrivalCity: arrival.city || '',
      arrivalLocation: arrival.displayName,
      arrivalLatitude: arrival.latitude,
      arrivalLongitude: arrival.longitude,
      captainBroadcast,
      socialCueType: 'solo',
      socialCueText: '您已平安降落。',
    };

    store.flights[idx] = landed;
    p.status = 'landed';
    p.currentLocation = arrival.displayName;
    p.currentLatitude = arrival.latitude;
    p.currentLongitude = arrival.longitude;
    saveStore(store);
    return { flight: enrichFlight(landed), landingScenery: null };
  }

  function handleBoard(groupId) {
    const store = loadStore();
    return { flights: buildBoardFlights(store.flights.map(enrichFlight), groupId) };
  }

  function handleProgress(passengerId) {
    const store = loadStore();
    const f = store.flights.find((x) => x.passengerId === passengerId && x.status === 'in_flight');
    return { activeFlight: f ? enrichFlight(f) : null };
  }

  async function probe() {
    if (window.location.protocol === 'file:') {
      active = true;
      return;
    }
    const deployed = allowLocalFallback() === false;
    const timeouts = deployed ? [4000, 8000] : [2000];
    for (const ms of timeouts) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        const res = await fetch('/api/config', { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) {
          active = false;
          return;
        }
      } catch { /* retry */ }
    }
    active = !deployed;
  }

  /** 正式部署（Vercel）不應因網路閃斷切換成本機模式，避免與 Notion 不同步 */
  function allowLocalFallback() {
    const h = window.location.hostname;
    if (window.location.protocol === 'file:') return true;
    if (h === 'localhost' || h === '127.0.0.1') return true;
    return false;
  }

  async function handle(method, url, body) {
    const u = new URL(url, window.location.origin || 'http://localhost');
    const path = u.pathname;

    if (method === 'POST' && path === '/api/passenger') return handlePassenger(body);
    if (method === 'POST' && path === '/api/passenger/avatar') {
      const store = loadStore();
      const p = store.passengers[body.passengerId];
      if (!p) throw new Error('請先登入。');
      p.idPhotoUrl = body.imageDataUrl || p.idPhotoUrl;
      store.flights.forEach((f) => {
        if (f.passengerId === body.passengerId) f.idPhotoUrl = p.idPhotoUrl;
      });
      saveStore(store);
      return { idPhotoUrl: p.idPhotoUrl, pending: false };
    }
    if (method === 'POST' && path === '/api/flight/memo') {
      const store = loadStore();
      const flight = store.flights.find((f) => f.passengerId === body.passengerId && f.status === 'in_flight');
      if (!flight) throw new Error('找不到進行中的航班。');
      const memo = Array.from(String(body.textMemo || '')).slice(0, 20).join('');
      flight.textMemo = memo;
      saveStore(store);
      return { textMemo: memo, flight: enrichFlight(flight) };
    }
    if (method === 'POST' && path === '/api/flight/takeoff') return handleTakeoff(body);
    if (method === 'POST' && path === '/api/flight/land') return handleLand(body);
    if (method === 'GET' && path === '/api/board') return handleBoard(u.searchParams.get('groupId') || '');
    if (method === 'GET' && path === '/api/flight/progress') {
      return handleProgress(u.searchParams.get('passengerId') || '');
    }
    if (method === 'GET' && path === '/api/scenery') {
      return { scenery: null };
    }
    if (method === 'GET' && path === '/api/config') {
      return { dataMode: 'preview', notionConfigured: false, notionReady: false, hint: '' };
    }
    throw new Error(`本機模式不支援：${method} ${path}`);
  }

  window.WorkshopLocal = {
    probe,
    isActive: () => active,
    enable: () => { active = true; },
    allowLocalFallback,
    handle,
  };
})();
