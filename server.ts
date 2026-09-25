import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import { join } from 'path';

import { getOrCreatePassenger } from './src/lib/notion/passengers';
import {
  createFlight, getActiveFlight, updateFlight, getGroupFlights, getGroupBoardFlights,
  getLastLandedFlight, getAllActiveFlights, parseFlight, applyMemIdPhoto,
} from './src/lib/notion/flights';
import { getAvailableDestinations, seedDestinations } from './src/lib/notion/destinations';
import { calculateFlightDistance } from './src/lib/flight/distance';
import { calculateFlightProgress } from './src/lib/flight/progress';
import { getNarrativeRegion } from './src/lib/flight/region';
import { findArrivalDestination } from './src/lib/flight/direction';
import { fetchLocalContext, resolveCountryIso } from './src/lib/flight/local-context';
import { resolveGroupSocialCue } from './src/lib/flight/social';
import { generateCaptainBroadcast, fallbackCaptainBroadcast } from './src/lib/ai/broadcast';
import { generateBroadcastSpeech } from './src/lib/ai/speech';
import { generateSocialTakeaway, fallbackSocialTakeaway } from './src/lib/ai/social-takeaway';
import type { SocialTakeawayInput } from './src/lib/ai/social-takeaway';
import { getLandscapeByFlightId } from './src/lib/notion/landscape-images';
import { backfillSceneryForFlights, generateSceneryForLanding } from './src/lib/notion/scenery-backfill';
import { runInBackground } from './src/lib/run-in-background';
import { withTimeout } from './src/lib/with-timeout';
import { getDataModeStatus } from './src/lib/data-mode';
import { isNotionConfigured } from './src/lib/notion/client';
import {
  attachIdPhotoToPage,
  clampTextMemo,
  savePassengerIdPhoto,
} from './src/lib/notion/id-photo';
import { isResearchConsentGranted, stampResearchConsent } from './src/lib/notion/research-consent';
import { getVapidPublicKey, isWebPushConfigured, sendLandingReminderPush } from './src/lib/reminders/push';
import {
  isPersistentReminderStoreConfigured,
  markLandingReminderSent,
  removeLandingReminderByEndpoint,
  removeLandingRemindersForFlight,
  upsertLandingReminder,
} from './src/lib/reminders/store';
import { runLandingReminderCron } from './src/lib/reminders/scheduler';
import type { PushSubscriptionPayload } from './src/lib/reminders/types';

import type { RouteDirection, BroadcastStyle, NarrativeRegion, SocialCue } from './src/types';

const SOLO_SOCIAL_CUE: SocialCue = {
  cueType: 'solo',
  relatedPassenger: null,
  cueText: '今晚你獨自享受這片天空。同組雷達上暫時只有你一人。',
};

async function resolveSocialCueWithBudget(
  current: Parameters<typeof resolveGroupSocialCue>[0],
  groupFlights: Awaited<ReturnType<typeof getGroupFlights>>
): Promise<SocialCue> {
  return withTimeout(resolveGroupSocialCue(current, groupFlights), 8_000, () => SOLO_SOCIAL_CUE);
}

async function generateBroadcastWithBudget(
  input: Parameters<typeof generateCaptainBroadcast>[0],
  fallback: () => string
): Promise<string> {
  try {
    return await withTimeout(generateCaptainBroadcast(input), 12_000, fallback);
  } catch {
    return fallback();
  }
}

async function generateTakeawayWithBudget(input: SocialTakeawayInput): Promise<string> {
  try {
    return await withTimeout(generateSocialTakeaway(input), 8_000, () => fallbackSocialTakeaway(input));
  } catch {
    return fallbackSocialTakeaway(input);
  }
}

async function generateSpeechWithBudget(
  text: string,
  style: BroadcastStyle
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY || !text?.trim()) return null;
  try {
    return await withTimeout(
      generateBroadcastSpeech(text.trim(), style).then((buf) => buf.toString('base64')),
      12_000,
      () => null
    );
  } catch {
    return null;
  }
}

function parseDisplayLocation(displayName: string): { cityName: string; countryName: string } {
  const parts = displayName.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { cityName: parts[0], countryName: parts[parts.length - 1] };
  }
  return { cityName: displayName, countryName: '' };
}
import { formatNotionError } from './src/lib/notion/db-access';
import { introspectNotionSchemas } from './src/lib/notion/schema-introspect';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(process.cwd(), 'public')));

function isValidPushSubscription(value: unknown): value is PushSubscriptionPayload {
  const sub = value as PushSubscriptionPayload | null;
  return !!sub
    && typeof sub.endpoint === 'string'
    && sub.endpoint.startsWith('https://')
    && typeof sub.keys?.p256dh === 'string'
    && typeof sub.keys?.auth === 'string';
}

function isCronAuthorized(req: express.Request): boolean {
  const secret = process.env.REMINDER_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.get('authorization') || '';
  const querySecret = typeof req.query.secret === 'string' ? req.query.secret : '';
  return auth === `Bearer ${secret}` || querySecret === secret;
}

function logReminderCleanup(err: unknown) {
  console.warn('[landing-reminder] cleanup failed:', err instanceof Error ? err.message : err);
}

// ── GET /api/config ───────────────────────────────────────────────────────────

app.get('/api/config', async (_req, res) => {
  try {
    res.json(await getDataModeStatus());
  } catch (err) {
    res.status(500).json({ error: formatNotionError(err) });
  }
});

// ── Landing reminder push config / subscription ──────────────────────────────

app.get('/api/reminders/config', (_req, res) => {
  res.json({
    webPushReady: isWebPushConfigured(),
    vapidPublicKey: getVapidPublicKey(),
    persistentStoreReady: isPersistentReminderStoreConfigured(),
    firstReminderMinutes: 0,
    repeatReminderMinutes: 0,
  });
});

app.post('/api/reminders/subscribe', async (req, res) => {
  try {
    const {
      passengerId,
      passengerName = '',
      name = '',
      groupId = '',
      flightId = '',
      takeoffTime = '',
      subscription,
    } = req.body as {
      passengerId?: string;
      passengerName?: string;
      name?: string;
      groupId?: string;
      flightId?: string;
      takeoffTime?: string;
      subscription?: unknown;
    };

    if (!isWebPushConfigured()) {
      res.status(503).json({ error: 'web_push_not_configured', message: '尚未設定 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY。' });
      return;
    }
    if (!passengerId || !flightId || !isValidPushSubscription(subscription)) {
      res.status(400).json({ error: 'invalid_subscription', message: '缺少乘客、航班或推播訂閱資料。' });
      return;
    }

    const activeFlight = await getActiveFlight(passengerId);
    if (!activeFlight || activeFlight.flightId !== flightId) {
      res.status(409).json({ error: 'no_active_flight', message: '找不到這位乘客目前飛行中的航班。' });
      return;
    }

    const record = await upsertLandingReminder({
      passengerId,
      passengerName: passengerName || name || activeFlight.passengerName,
      groupId: groupId || activeFlight.groupId,
      flightId,
      takeoffTime: takeoffTime || activeFlight.takeoffTime,
      subscription,
    });

    let sent = false;
    if (!record.lastReminderAt) {
      try {
        await sendLandingReminderPush(record);
        await markLandingReminderSent(record.id);
        sent = true;
      } catch (err) {
        console.warn('[landing-reminder] immediate push failed:', err instanceof Error ? err.message : err);
      }
    }

    res.json({
      ok: true,
      reminder: {
        id: record.id,
        flightId: record.flightId,
        sent,
        persistentStoreReady: isPersistentReminderStoreConfigured(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

app.post('/api/reminders/unsubscribe', async (req, res) => {
  try {
    const { passengerId, endpoint } = req.body as { passengerId?: string; endpoint?: string };
    if (!passengerId || !endpoint) {
      res.status(400).json({ error: 'missing_subscription', message: '請提供 passengerId 與 endpoint。' });
      return;
    }
    const removed = await removeLandingReminderByEndpoint(passengerId, endpoint);
    res.json({ ok: true, removed });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

async function handleReminderCron(req: express.Request, res: express.Response) {
  if (!isCronAuthorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const result = await runLandingReminderCron();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
}

app.get('/api/reminders/cron', handleReminderCron);
app.post('/api/reminders/cron', handleReminderCron);

// ── GET /api/notion/schema ────────────────────────────────────────────────────

/** 讀取主辦 Notion 總表目前實際欄位（對照刪欄後的現況）。 */
app.get('/api/notion/schema', async (_req, res) => {
  try {
    res.json(await introspectNotionSchemas());
  } catch (err) {
    res.status(500).json({ error: formatNotionError(err) });
  }
});

// ── POST /api/passenger ───────────────────────────────────────────────────────

app.post('/api/passenger', async (req, res) => {
  try {
    const { passengerId, name, groupId } = req.body;
    if (!isResearchConsentGranted(req.body)) {
      res.status(403).json({ error: '需同意研究資料使用後才能登機。' });
      return;
    }
    if (!passengerId || !name || !groupId) {
      res.status(400).json({ error: '請填寫乘客 ID、姓名和小隊 ID。' });
      return;
    }
    const result = await getOrCreatePassenger(passengerId, name, groupId);

    // 飛行中：直接用已查到的航班列更新姓名／小隊，不再重打 getActiveFlight
    if (result.passenger.status === 'in_flight' && result.sourcePage) {
      const patch: { passengerName?: string; groupId?: string } = {};
      if (name && name !== result.passenger.name) patch.passengerName = name;
      if (groupId && groupId !== result.passenger.groupId) patch.groupId = groupId;
      if (Object.keys(patch).length > 0) {
        await updateFlight(result.passenger.notionId, patch);
        if (patch.passengerName) result.passenger.name = patch.passengerName;
        if (patch.groupId) result.passenger.groupId = patch.groupId;
      }
    }

    const consentAt = typeof req.body.researchConsentAt === 'string'
      ? req.body.researchConsentAt
      : new Date().toISOString();
    const stampPageId = result.sourcePage && typeof (result.sourcePage as { id?: string }).id === 'string'
      ? (result.sourcePage as { id: string }).id
      : result.passenger.notionId;
    await stampResearchConsent(stampPageId, consentAt).catch(() => {});

    // 重用 getOrCreatePassenger 已查到的 landed 列，避免再打一次 Notion
    let lastLandedFlight = null;
    if (result.passenger.status !== 'in_flight') {
      if (result.sourceKind === 'landed' && result.sourcePage) {
        lastLandedFlight = parseFlight(result.sourcePage);
      } else {
        lastLandedFlight = await getLastLandedFlight(passengerId);
      }
    }

    // 風景圖改由前端背景載入，不擋登入回應
    res.json({
      passenger: {
        ...result.passenger,
        idPhotoUrl: result.passenger.idPhotoUrl || lastLandedFlight?.idPhotoUrl || null,
      },
      created: result.created,
      lastLandedFlight,
      landingScenery: null,
    });
  } catch (err) {
    const message = formatNotionError(err);
    res.status(500).json({ error: message, message });
  }
});

app.post('/api/passenger/avatar', async (req, res) => {
  try {
    const { passengerId, imageDataUrl } = req.body as { passengerId?: string; imageDataUrl?: string };
    if (!passengerId || !imageDataUrl) {
      res.status(400).json({ error: '請提供乘客 ID 與頭像。' });
      return;
    }
    const result = await savePassengerIdPhoto(passengerId, imageDataUrl);
    if (result.idPhotoUrl) applyMemIdPhoto(passengerId, result.idPhotoUrl);
    res.json(result);
  } catch (err) {
    const message = formatNotionError(err);
    res.status(500).json({ error: message, message });
  }
});

app.post('/api/flight/memo', async (req, res) => {
  try {
    const { passengerId, flightId, textMemo } = req.body as {
      passengerId?: string;
      flightId?: string;
      textMemo?: string;
    };
    if (!passengerId) {
      res.status(400).json({ error: '請提供乘客 ID。' });
      return;
    }
    const flight = await getActiveFlight(passengerId);
    if (!flight) {
      res.status(404).json({ error: '找不到進行中的航班。' });
      return;
    }
    if (flightId && flight.flightId !== flightId) {
      res.status(409).json({ error: '航班已更新，請重新整理。' });
      return;
    }
    const memo = clampTextMemo(textMemo);
    await updateFlight(flight.notionId, { textMemo: memo });
    res.json({ textMemo: memo, flight: { ...flight, textMemo: memo } });
  } catch (err) {
    const message = formatNotionError(err);
    res.status(500).json({ error: message, message });
  }
});

// ── POST /api/flight/takeoff ──────────────────────────────────────────────────

app.post('/api/flight/takeoff', async (req, res) => {
  const triggeredAt = new Date().toISOString();
  try {
    const {
      passengerId,
      name = '',
      groupId = '',
      routeDirection = 'auto',
      broadcastStyle = 'formal_captain',
      simulatedTakeoffTime,
      clientTimeZone,
      locale = 'zh',
      idPhotoBase64,
    } = req.body;

    if (!passengerId) { res.status(400).json({ error: '請提供乘客 ID。' }); return; }
    if (!isResearchConsentGranted(req.body)) {
      res.status(403).json({ error: '需同意研究資料使用後才能起飛。' });
      return;
    }

    const { passenger } = await getOrCreatePassenger(passengerId, name, groupId);
    if (!passenger.name || !passenger.groupId) {
      res.status(400).json({
        error: 'missing_profile',
        message: '找不到乘客姓名或小隊，請重新登入後再起飛。',
      });
      return;
    }

    const existing = await getActiveFlight(passengerId);
    if (existing) {
      res.status(409).json({ error: 'already_in_flight', message: '你已有一趟尚未降落的航班，請先降落或取消。' });
      return;
    }

    const takeoffTime = typeof simulatedTakeoffTime === 'string' && simulatedTakeoffTime
      ? simulatedTakeoffTime
      : triggeredAt;

    const flight = await createFlight({
      passengerId,
      passengerName: passenger.name,
      groupId: passenger.groupId,
      departureLocation: passenger.currentLocation,
      departureLatitude: passenger.currentLatitude,
      departureLongitude: passenger.currentLongitude,
      routeDirection: routeDirection as RouteDirection,
      takeoffTime,
      clientTimeZone: typeof clientTimeZone === 'string' ? clientTimeZone.slice(0, 80) : undefined,
    });
    const consentAt = typeof req.body.researchConsentAt === 'string'
      ? req.body.researchConsentAt
      : new Date().toISOString();
    await stampResearchConsent(flight.notionId, consentAt).catch(() => {});

    if (typeof idPhotoBase64 === 'string' && idPhotoBase64.startsWith('data:image/')) {
      try {
        if (isNotionConfigured() && !flight.notionId.startsWith('mem_')) {
          flight.idPhotoUrl = await attachIdPhotoToPage(flight.notionId, idPhotoBase64);
        } else {
          applyMemIdPhoto(passengerId, idPhotoBase64);
          flight.idPhotoUrl = idPhotoBase64;
        }
      } catch (err) {
        console.warn('[takeoff id photo]', err);
      }
    }

    const groupFlights = await getGroupFlights(passenger.groupId);
    const depPlace = parseDisplayLocation(flight.departureLocation);
    const [socialCue, depLocal] = await Promise.all([
      resolveSocialCueWithBudget(
        {
          passengerId,
          passengerName: passenger.name,
          departureLocation: flight.departureLocation,
          departureLatitude: flight.departureLatitude,
          departureLongitude: flight.departureLongitude,
          arrivalLocation: null,
          arrivalLatitude: null,
          arrivalLongitude: null,
          routeDirection: flight.routeDirection,
          takeoffTime: flight.takeoffTime,
          landingTime: null,
          flightProgress: 0,
          phase: 'takeoff',
        },
        groupFlights
      ),
      fetchLocalContext({
        cityName: depPlace.cityName,
        countryName: depPlace.countryName,
        countryIso: resolveCountryIso(
          flight.departureLatitude,
          flight.departureLongitude,
          flight.departureLocation
        ),
        latitude: flight.departureLatitude,
        longitude: flight.departureLongitude,
      }).catch(() => null),
    ]);

    // 社交短句與完整廣播並行生成：只依賴 socialCue，不互相等待
    const takeawayPromise = generateTakeawayWithBudget({
      phase: 'takeoff',
      passengerName: passenger.name,
      socialCue,
      routeDirection: flight.routeDirection,
      departureLocation: flight.departureLocation,
    });

    const takeoffBroadcast = await generateBroadcastWithBudget(
      {
        phase: 'takeoff',
        passengerName: passenger.name,
        departureLocation: flight.departureLocation,
        arrivalLocation: null,
        narrativeRegion: 'departure_clouds',
        flightDurationMinutes: null,
        flightProgress: 0,
        estimatedDistanceKm: null,
        routeDirection: flight.routeDirection,
        socialCue,
        style: broadcastStyle as BroadcastStyle,
        localContext: depLocal,
        locale: locale === 'en' ? 'en' : 'zh',
      },
      () => fallbackCaptainBroadcast(
        'takeoff',
        passenger.name,
        flight.departureLocation,
        null,
        flight.routeDirection,
        null,
        socialCue.cueText,
        depLocal,
        locale === 'en' ? 'en' : 'zh'
      )
    );

    const [_, speechAudioBase64, socialTakeaway] = await Promise.all([
      updateFlight(flight.notionId, {
        takeoffBroadcastStyle: broadcastStyle as BroadcastStyle,
        takeoffBroadcast,
        socialCueType: socialCue.cueType,
        socialCueText: socialCue.cueText,
        relatedPassenger: socialCue.relatedPassenger ?? '',
      }),
      generateSpeechWithBudget(takeoffBroadcast, broadcastStyle as BroadcastStyle),
      takeawayPromise,
    ]);

    res.json({
      flight: {
        ...flight,
        takeoffBroadcastStyle: broadcastStyle as BroadcastStyle,
        takeoffBroadcast,
        socialCueType: socialCue.cueType,
        socialCueText: socialCue.cueText,
        relatedPassenger: socialCue.relatedPassenger,
      },
      speechAudioBase64,
      socialTakeaway,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// ── POST /api/flight/land ─────────────────────────────────────────────────────

app.post('/api/flight/land', async (req, res) => {
  const triggeredAt = new Date().toISOString();
  try {
    const {
      passengerId,
      name = '',
      groupId = '',
      broadcastStyle = 'formal_captain',
      simulatedDurationMinutes,
      simulatedLandingTime,
      locale = 'zh',
    } = req.body;
    if (!passengerId) { res.status(400).json({ error: '請提供乘客 ID。' }); return; }

    const { passenger } = await getOrCreatePassenger(passengerId, name, groupId);
    const activeFlight = await getActiveFlight(passengerId);

    if (!activeFlight) {
      res.status(404).json({ error: 'no_active_flight', message: '找不到進行中的航班。' });
      return;
    }

    const simMinutes = typeof simulatedDurationMinutes === 'number' && simulatedDurationMinutes > 0
      ? Math.round(simulatedDurationMinutes)
      : null;
    const landingTime = typeof simulatedLandingTime === 'string' && simulatedLandingTime
      ? simulatedLandingTime
      : simMinutes
        ? new Date(new Date(activeFlight.takeoffTime).getTime() + simMinutes * 60000).toISOString()
        : triggeredAt;
    const sleepOpportunityMinutes = Math.max(0, Math.round(
      (new Date(landingTime).getTime() - new Date(activeFlight.takeoffTime).getTime()) / 60000 * 100
    ) / 100);
    const durationMinutes = Math.max(1, Math.round(
      (new Date(landingTime).getTime() - new Date(activeFlight.takeoffTime).getTime()) / 60000
    ));
    const distanceKm = calculateFlightDistance(durationMinutes);
    const progress = 100;
    const region = getNarrativeRegion(progress);

    const destinations = await getAvailableDestinations();
    const arrival = findArrivalDestination(
      activeFlight.departureLatitude,
      activeFlight.departureLongitude,
      distanceKm,
      activeFlight.routeDirection,
      destinations,
      activeFlight.departureLocation
    );

    const arrPlace = parseDisplayLocation(arrival.displayName);
    const [groupFlights, arrLocal] = await Promise.all([
      getGroupFlights(passenger.groupId),
      fetchLocalContext({
        cityName: arrival.city || arrPlace.cityName,
        countryName: arrival.country || arrPlace.countryName,
        countryIso: arrival.countryIso,
        latitude: arrival.latitude,
        longitude: arrival.longitude,
      }).catch(() => null),
    ]);
    const socialCue = await resolveSocialCueWithBudget(
      {
        passengerId,
        passengerName: passenger.name,
        departureLocation: activeFlight.departureLocation,
        departureLatitude: activeFlight.departureLatitude,
        departureLongitude: activeFlight.departureLongitude,
        arrivalLocation: arrival.displayName,
        arrivalLatitude: arrival.latitude,
        arrivalLongitude: arrival.longitude,
        routeDirection: activeFlight.routeDirection,
        takeoffTime: activeFlight.takeoffTime,
        landingTime,
        flightProgress: 100,
        phase: 'landing',
      },
      groupFlights
    );

    // 社交短句與完整廣播並行生成：只依賴 socialCue，不互相等待
    const takeawayPromise = generateTakeawayWithBudget({
      phase: 'landing',
      passengerName: passenger.name,
      socialCue,
      routeDirection: activeFlight.routeDirection,
      departureLocation: activeFlight.departureLocation,
      arrivalLocation: arrival.displayName,
      flightDurationMinutes: durationMinutes,
      estimatedDistanceKm: Math.round(distanceKm),
    });

    const broadcastFallback = () => fallbackCaptainBroadcast(
      'landing',
      passenger.name,
      activeFlight.departureLocation,
      arrival.displayName,
      activeFlight.routeDirection,
      durationMinutes,
      socialCue.cueText,
      arrLocal,
      locale === 'en' ? 'en' : 'zh'
    );

    const captainBroadcast = await generateBroadcastWithBudget(
      {
        phase: 'landing',
        passengerName: passenger.name,
        departureLocation: activeFlight.departureLocation,
        arrivalLocation: arrival.displayName,
        narrativeRegion: region,
        flightDurationMinutes: durationMinutes,
        flightProgress: 100,
        estimatedDistanceKm: distanceKm,
        routeDirection: activeFlight.routeDirection,
        socialCue,
        style: broadcastStyle as BroadcastStyle,
        localContext: arrLocal,
        locale: locale === 'en' ? 'en' : 'zh',
      },
      broadcastFallback
    );

    const [_, speechAudioBase64, socialTakeaway] = await Promise.all([
      updateFlight(activeFlight.notionId, {
        status: 'landed',
        landingTime,
        flightDurationMinutes: durationMinutes,
        sleepOpportunityMinutes,
        estimatedFlightDistanceKm: Math.round(distanceKm),
        arrivalLocation: arrival.displayName,
        arrivalLatitude: arrival.latitude,
        arrivalLongitude: arrival.longitude,
        captainBroadcast,
        socialCueType: socialCue.cueType,
        socialCueText: socialCue.cueText,
        relatedPassenger: socialCue.relatedPassenger ?? '',
      }),
      generateSpeechWithBudget(captainBroadcast, broadcastStyle as BroadcastStyle),
      takeawayPromise,
    ]);

    removeLandingRemindersForFlight(activeFlight.passengerId, activeFlight.flightId)
      .catch(logReminderCleanup);

    // 降落確認後即在伺服器生圖並寫入 Notion：乘客關掉頁面也會完成（前端只輪詢結果）
    runInBackground(`scenery ${activeFlight.flightId}`, async () => {
      const result = await generateSceneryForLanding({
        flightId: activeFlight.flightId,
        passengerId: activeFlight.passengerId,
        passengerName: activeFlight.passengerName,
        groupId: passenger.groupId,
        arrivalLocation: arrival.displayName,
        landingTime,
        timezone: arrival.timezone,
      });
      if (result.error) {
        console.error(`[scenery] ${activeFlight.flightId} 降落背景生圖失敗：${result.error}`);
      }
    });

    res.json({
      flight: {
        ...activeFlight,
        status: 'landed',
        landingTime,
        flightDurationMinutes: durationMinutes,
        sleepOpportunityMinutes,
        estimatedFlightDistanceKm: Math.round(distanceKm),
        arrivalLocation: arrival.displayName,
        arrivalLatitude: arrival.latitude,
        arrivalLongitude: arrival.longitude,
        flightProgress: 100,
        narrativeRegion: 'arrival_harbor',
        captainBroadcast,
        socialCueType: socialCue.cueType,
        socialCueText: socialCue.cueText,
        relatedPassenger: socialCue.relatedPassenger,
      },
      landingScenery: null,
      speechAudioBase64,
      socialTakeaway,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// Optional self-report. The timed window interval remains separate from time actually slept.
app.post('/api/flight/sleep-report', async (req, res) => {
  try {
    const { passengerId, flightId, selfReportedSleepMinutes, sleepQuality } = req.body;
    const minutes = selfReportedSleepMinutes === '' || selfReportedSleepMinutes == null
      ? null : Number(selfReportedSleepMinutes);
    const quality = sleepQuality === '' || sleepQuality == null ? null : Number(sleepQuality);
    if (typeof passengerId !== 'string' || !passengerId || typeof flightId !== 'string' || !flightId) {
      res.status(400).json({ error: '請提供乘客與航班 ID。' }); return;
    }
    if (minutes === null && quality === null) {
      res.status(400).json({ error: '請至少填寫一項睡眠回報。' }); return;
    }
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440)) {
      res.status(400).json({ error: '睡眠分鐘數需介於 0 與 1440。' }); return;
    }
    if (quality !== null && (!Number.isInteger(quality) || quality < 1 || quality > 5)) {
      res.status(400).json({ error: '睡眠品質需介於 1 與 5。' }); return;
    }
    const flight = await getLastLandedFlight(passengerId);
    if (!flight || flight.flightId !== flightId) {
      res.status(404).json({ error: '找不到這趟已降落航班。' }); return;
    }
    await updateFlight(flight.notionId, {
      ...(minutes === null ? {} : { selfReportedSleepMinutes: minutes }),
      ...(quality === null ? {} : { sleepQuality: quality }),
    });
    res.json({ ok: true, flightId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// ── GET /api/flight/progress ──────────────────────────────────────────────────

app.get('/api/flight/progress', async (req, res) => {
  try {
    const passengerId = req.query.passengerId as string;
    if (!passengerId) { res.status(400).json({ error: '請提供 passengerId。' }); return; }

    const flight = await getActiveFlight(passengerId);
    if (!flight) { res.json({ activeFlight: null }); return; }

    const progress = calculateFlightProgress(flight.takeoffTime);
    const region = getNarrativeRegion(progress);
    res.json({ activeFlight: { ...flight, flightProgress: progress, narrativeRegion: region } });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// ── GET /api/board ────────────────────────────────────────────────────────────

app.get('/api/board', async (req, res) => {
  try {
    const groupId = req.query.groupId as string;
    if (!groupId) { res.status(400).json({ error: '請提供 groupId。' }); return; }

    const flights = await getGroupBoardFlights(groupId);
    const enriched = flights.map((f) => {
      if (f.status !== 'in_flight') return f;
      const progress = calculateFlightProgress(f.takeoffTime);
      const region = getNarrativeRegion(progress);
      return {
        ...f,
        arrivalLocation: null,
        arrivalLatitude: null,
        arrivalLongitude: null,
        landingTime: null,
        flightDurationMinutes: null,
        estimatedFlightDistanceKm: null,
        captainBroadcast: null,
        flightProgress: progress,
        narrativeRegion: region,
      };
    });
    res.json({ flights: enriched });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// ── GET /api/scenery ──────────────────────────────────────────────────────────
// 唯讀：依 flightId 取降落風景（供小隊看板查看隊友的降落風景圖）

app.get('/api/scenery', async (req, res) => {
  try {
    const flightId = req.query.flightId as string;
    if (!flightId) { res.status(400).json({ error: '請提供 flightId。' }); return; }
    const scenery = await getLandscapeByFlightId(flightId);
    res.json({ scenery });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// ── GET /api/scenery-image ────────────────────────────────────────────────────
// 同源代理降落風景圖：Notion 檔案是 S3 簽名網址、沒有 CORS 標頭，
// 前端 DOM 擷取（html2canvas）讀不到跨域 pixel，改由伺服器抓回再轉送。

app.get('/api/scenery-image', async (req, res) => {
  try {
    const flightId = req.query.flightId as string;
    if (!flightId) { res.status(400).json({ error: '請提供 flightId。' }); return; }
    const scenery = await getLandscapeByFlightId(flightId);
    const imageUrl = scenery?.imageUrl;
    if (!imageUrl) { res.status(404).json({ error: '找不到風景圖。' }); return; }

    if (imageUrl.startsWith('data:')) {
      const match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(imageUrl);
      if (!match) { res.status(500).json({ error: '風景圖格式錯誤。' }); return; }
      const buffer = match[2]
        ? Buffer.from(match[3], 'base64')
        : Buffer.from(decodeURIComponent(match[3]), 'utf8');
      res.setHeader('Content-Type', match[1] || 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
      return;
    }

    const upstream = await fetch(imageUrl);
    if (!upstream.ok) { res.status(502).json({ error: `風景圖下載失敗（${upstream.status}）。` }); return; }
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// ── GET /api/workshop ─────────────────────────────────────────────────────────

app.get('/api/workshop', async (_req, res) => {
  try {
    const activeFlights = await getAllActiveFlights();
    const groupIds = new Set(activeFlights.map((f) => f.groupId));

    const regionCounts: Partial<Record<NarrativeRegion, number>> = {};
    for (const f of activeFlights) {
      const progress = calculateFlightProgress(f.takeoffTime);
      const region = getNarrativeRegion(progress);
      regionCounts[region] = (regionCounts[region] ?? 0) + 1;
    }

    const mostCommonRegion = Object.entries(regionCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] as NarrativeRegion | undefined;

    res.json({
      summary: {
        activeGroupCount: groupIds.size,
        totalInFlightCount: activeFlights.length,
        totalLandedCount: null,
        mostCommonRegion: mostCommonRegion ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// ── POST /api/broadcast/speech ────────────────────────────────────────────────

app.post('/api/broadcast/speech', async (req, res) => {
  try {
    const { text, style } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: '請提供廣播文字。' });
      return;
    }
    const audio = await generateBroadcastSpeech(text.trim(), style as BroadcastStyle | undefined);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(audio);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '語音生成失敗' });
  }
});

// ── POST /api/scenery/backfill ────────────────────────────────────────────────

app.post('/api/scenery/backfill', async (req, res) => {
  try {
    const { flightIds, force } = req.body as { flightIds?: string[]; force?: boolean };
    if (!Array.isArray(flightIds) || flightIds.length === 0) {
      res.status(400).json({ error: '請提供 flightIds 陣列。' });
      return;
    }
    if (flightIds.length > 10) {
      res.status(400).json({ error: '一次最多 10 筆。' });
      return;
    }
    const results = await backfillSceneryForFlights(flightIds, { force: !!force });
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// ── POST /api/seed ────────────────────────────────────────────────────────────

app.post('/api/seed', async (_req, res) => {
  try {
    const result = await seedDestinations();
    res.json({
      message: `城市資料已在後台載入（${result.skipped} 筆），不需寫入 Notion。`,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '未知錯誤' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

if (!process.env.VERCEL) {
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`✈  甦醒航班 server running → http://localhost:${PORT}`);
  });
}

export default app;
