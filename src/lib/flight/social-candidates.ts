import type { Flight, RouteDirection, SocialCueType } from '../../types';
import { CITIES } from '../../data/cities';
import { calculateBearing, haversineDistance } from '../utils/haversine';
import {
  bearingToDirectionLabel,
  COMPARABLE_ROUTE_DIRECTIONS,
  estimateFlightPosition,
  findNearestPlace,
} from './geo';

export interface CurrentFlightContext {
  passengerId: string;
  passengerName: string;
  departureLocation: string;
  departureLatitude: number;
  departureLongitude: number;
  arrivalLocation: string | null;
  arrivalLatitude: number | null;
  arrivalLongitude: number | null;
  routeDirection: RouteDirection;
  takeoffTime: string;
  landingTime: string | null;
  flightProgress: number;
  phase: 'takeoff' | 'landing';
}

export interface SocialCueCandidate {
  cueType: SocialCueType;
  relatedPassenger: string | null;
  facts: Record<string, string | number | null>;
}

/** 起飛階段允許的 cue（對齊 takeoff 優先序；避免 heading_contrast 等易寫歪的類型） */
const TAKEOFF_SOCIAL_CUE_TYPES = new Set<SocialCueType>([
  'teammate_in_sky',
  'teammate_departure',
  'squad_in_sky',
  'same_departure',
  'parallel_heading',
  'first_of_night',
]);

/** 降落：高優先類型由上到下；同一階（如 early/late）內再 random */
export const LANDING_SOCIAL_CUE_PRIORITY: Array<SocialCueType | SocialCueType[]> = [
  'route_convergence',
  'relay_flight',
  'parallel_heading',
  'fresh_arrival',
  'teammate_arrival',
  ['early_landing', 'late_landing'],
  'squad_in_sky',
  'solo',
];

/** 起飛：高優先類型由上到下 */
export const TAKEOFF_SOCIAL_CUE_PRIORITY: Array<SocialCueType | SocialCueType[]> = [
  'teammate_in_sky',
  'teammate_departure',
  'squad_in_sky',
  'same_departure',
  'parallel_heading',
  'first_of_night',
  'solo',
];

/** 其他活躍隊友達此人數才附加 group summary（人數少只講 primary cue） */
export const GROUP_SUMMARY_MIN_OTHERS = 3;

/** 只看「今晚／這一輪」隊友動態，避免把前天已降落的舊航班寫進氛圍句 */
export const GROUP_SUMMARY_NIGHT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 這些 primary cue 本身已是整體敘事，不再疊第二句，以免自相矛盾 */
const GROUP_SUMMARY_SKIP_CUE_TYPES = new Set<SocialCueType>([
  'solo',
  'first_of_night',
  'squad_in_sky',
]);

export function shouldAttachGroupSummary(cueType: SocialCueType): boolean {
  return !GROUP_SUMMARY_SKIP_CUE_TYPES.has(cueType);
}

const OPPOSITE_ROUTE_DIRECTIONS: Partial<Record<RouteDirection, RouteDirection[]>> = {
  eastbound: ['westbound'],
  westbound: ['eastbound'],
  northbound: ['southbound'],
  southbound: ['northbound'],
  northeast: ['southwest'],
  southwest: ['northeast'],
  northwest: ['southeast'],
  southeast: ['northwest'],
};

const FRESH_ARRIVAL_WINDOW_MS = 6 * 60 * 60 * 1000;
const FIRST_OF_NIGHT_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} 小時 ${m} 分鐘`;
  if (h > 0) return `${h} 小時`;
  return `${m} 分鐘`;
}

function elapsedMinutesSince(isoTime: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(isoTime).getTime()) / 60000));
}

function eventTimeMs(flight: Flight): number {
  const iso = flight.status === 'landed' && flight.landingTime ? flight.landingTime : flight.takeoffTime;
  return new Date(iso).getTime();
}

function currentPosition(ctx: CurrentFlightContext): { lat: number; lng: number } {
  if (
    ctx.phase === 'landing' &&
    ctx.arrivalLatitude != null &&
    ctx.arrivalLongitude != null
  ) {
    return { lat: ctx.arrivalLatitude, lng: ctx.arrivalLongitude };
  }
  return { lat: ctx.departureLatitude, lng: ctx.departureLongitude };
}

function teammatePosition(flight: Flight): { lat: number; lng: number } {
  const pos = estimateFlightPosition(flight);
  return { lat: pos.latitude, lng: pos.longitude };
}

function addTeammateArrival(
  candidates: SocialCueCandidate[],
  landedOthers: Flight[]
): void {
  for (const other of landedOthers) {
    if (!other.arrivalLocation) continue;
    candidates.push({
      cueType: 'teammate_arrival',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: '已降落',
        departureLocation: other.departureLocation,
        arrivalLocation: other.arrivalLocation,
        flightDuration: formatDuration(other.flightDurationMinutes) || '一段時間',
        flightDurationMinutes: other.flightDurationMinutes,
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addTeammateDeparture(
  candidates: SocialCueCandidate[],
  inFlightOthers: Flight[]
): void {
  for (const other of inFlightOthers) {
    const elapsed = elapsedMinutesSince(other.takeoffTime);
    candidates.push({
      cueType: 'teammate_departure',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: '飛行中',
        departureLocation: other.departureLocation,
        routeDirection: other.routeDirection,
        elapsedMinutes: elapsed,
        elapsedLabel: formatDuration(elapsed) || '剛剛',
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addRouteConvergence(
  candidates: SocialCueCandidate[],
  ctx: CurrentFlightContext,
  others: Flight[]
): void {
  const self = currentPosition(ctx);

  for (const other of others) {
    const otherPos = teammatePosition(other);
    const distanceKm = Math.round(
      haversineDistance(self.lat, self.lng, otherPos.lat, otherPos.lng)
    );
    if (distanceKm < 80) continue;

    const bearing = calculateBearing(
      self.lat,
      self.lng,
      otherPos.lat,
      otherPos.lng
    );
    const suggestDirection = bearingToDirectionLabel(bearing);
    const place = findNearestPlace(otherPos.lat, otherPos.lng, CITIES);
    const placeLabel = place
      ? `${place.country} 一帶`
      : other.status === 'landed' && other.arrivalLocation
        ? other.arrivalLocation
        : '未知空域';

    candidates.push({
      cueType: 'route_convergence',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: other.status === 'landed' ? '已降落' : '飛行中',
        teammatePlace: placeLabel,
        distanceKm,
        suggestDirection,
        selfLocation: ctx.phase === 'takeoff' ? ctx.departureLocation : ctx.arrivalLocation ?? ctx.departureLocation,
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addTeammateInSky(
  candidates: SocialCueCandidate[],
  inFlightOthers: Flight[]
): void {
  for (const other of inFlightOthers) {
    const elapsed = elapsedMinutesSince(other.takeoffTime);
    const pos = teammatePosition(other);
    const place = findNearestPlace(pos.lat, pos.lng, CITIES);
    const progress = Math.round(other.flightProgress);

    candidates.push({
      cueType: 'teammate_in_sky',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: '飛行中',
        elapsedMinutes: elapsed,
        elapsedLabel: formatDuration(elapsed) || '剛剛',
        flightProgress: progress,
        skyRegion: place?.country ?? '未知',
        nearestCity: place?.displayName ?? null,
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addParallelHeading(
  candidates: SocialCueCandidate[],
  ctx: CurrentFlightContext,
  inFlightOthers: Flight[]
): void {
  if (!COMPARABLE_ROUTE_DIRECTIONS.includes(ctx.routeDirection)) return;

  for (const other of inFlightOthers) {
    if (other.routeDirection !== ctx.routeDirection) continue;
    candidates.push({
      cueType: 'parallel_heading',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: '飛行中',
        routeDirection: ctx.routeDirection,
        selfDeparture: ctx.departureLocation,
        teammateDeparture: other.departureLocation,
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addSameDeparture(
  candidates: SocialCueCandidate[],
  ctx: CurrentFlightContext,
  others: Flight[]
): void {
  const selfLoc = ctx.departureLocation.trim();
  if (!selfLoc) return;

  for (const other of others) {
    if (other.status !== 'in_flight' && other.status !== 'landed') continue;
    if (other.departureLocation.trim() !== selfLoc) continue;
    candidates.push({
      cueType: 'same_departure',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        departureLocation: selfLoc,
        teammateStatus: other.status === 'landed' ? '已降落' : '飛行中',
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addHeadingContrast(
  candidates: SocialCueCandidate[],
  ctx: CurrentFlightContext,
  inFlightOthers: Flight[]
): void {
  if (!COMPARABLE_ROUTE_DIRECTIONS.includes(ctx.routeDirection)) return;
  const opposites = OPPOSITE_ROUTE_DIRECTIONS[ctx.routeDirection];
  if (!opposites) return;

  for (const other of inFlightOthers) {
    if (!opposites.includes(other.routeDirection)) continue;
    candidates.push({
      cueType: 'heading_contrast',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: '飛行中',
        selfDirection: ctx.routeDirection,
        teammateDirection: other.routeDirection,
        selfDeparture: ctx.departureLocation,
        teammateDeparture: other.departureLocation,
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addSquadInSky(
  candidates: SocialCueCandidate[],
  inFlightOthers: Flight[],
  landedOthers: Flight[]
): void {
  if (inFlightOthers.length + landedOthers.length === 0) return;
  candidates.push({
    cueType: 'squad_in_sky',
    relatedPassenger: null,
    facts: {
      inFlightCount: inFlightOthers.length,
      landedCount: landedOthers.length,
    },
  });
}

function addFreshArrival(
  candidates: SocialCueCandidate[],
  landedOthers: Flight[]
): void {
  const since = Date.now() - FRESH_ARRIVAL_WINDOW_MS;
  for (const other of landedOthers) {
    if (!other.landingTime || !other.arrivalLocation) continue;
    if (new Date(other.landingTime).getTime() < since) continue;
    candidates.push({
      cueType: 'fresh_arrival',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: '已降落',
        arrivalLocation: other.arrivalLocation,
        flightDuration: formatDuration(other.flightDurationMinutes) || '一段時間',
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addFirstOfNight(
  candidates: SocialCueCandidate[],
  ctx: CurrentFlightContext,
  groupFlights: Flight[]
): void {
  if (ctx.phase !== 'takeoff') return;

  const myTs = new Date(ctx.takeoffTime).getTime();
  const hasEarlierTakeoff = groupFlights.some(
    (f) =>
      f.passengerId !== ctx.passengerId
      && (f.status === 'in_flight' || f.status === 'landed')
      && myTs - new Date(f.takeoffTime).getTime() < FIRST_OF_NIGHT_WINDOW_MS
      && new Date(f.takeoffTime).getTime() < myTs
  );
  if (hasEarlierTakeoff) return;

  candidates.push({
    cueType: 'first_of_night',
    relatedPassenger: null,
    facts: { passengerName: ctx.passengerName },
  });
}

function addRelayFlight(
  candidates: SocialCueCandidate[],
  inFlightOthers: Flight[]
): void {
  for (const other of inFlightOthers) {
    candidates.push({
      cueType: 'relay_flight',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: '飛行中',
        teammateDeparture: other.departureLocation,
        teammateProgress: Math.round(other.flightProgress),
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addEarlyLanding(
  candidates: SocialCueCandidate[],
  earlierLanders: Flight[]
): void {
  for (const other of earlierLanders) {
    candidates.push({
      cueType: 'early_landing',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: '已降落',
        arrivalLocation: other.arrivalLocation ?? '目的地',
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

function addLateLanding(
  candidates: SocialCueCandidate[],
  laterLanders: Flight[]
): void {
  for (const other of laterLanders) {
    candidates.push({
      cueType: 'late_landing',
      relatedPassenger: other.passengerName,
      facts: {
        teammateName: other.passengerName,
        teammateStatus: '已降落',
        arrivalLocation: other.arrivalLocation ?? '目的地',
        eventTimeMs: eventTimeMs(other),
      },
    });
  }
}

/** 收集本趟所有可觸發的社交 cue（不含 solo）。 */
export function collectSocialCueCandidates(
  current: CurrentFlightContext,
  groupFlights: Flight[]
): SocialCueCandidate[] {
  const others = groupFlights.filter((f) => f.passengerId !== current.passengerId);
  const inFlightOthers = others.filter((f) => f.status === 'in_flight');
  const landedOthers = others.filter((f) => f.status === 'landed' && f.landingTime != null);
  const trackableOthers = others.filter(
    (f) => f.status === 'in_flight' || (f.status === 'landed' && f.arrivalLatitude != null)
  );

  const candidates: SocialCueCandidate[] = [];

  addTeammateArrival(candidates, landedOthers);
  addTeammateDeparture(candidates, inFlightOthers);
  addRouteConvergence(candidates, current, trackableOthers);
  addTeammateInSky(candidates, inFlightOthers);
  addParallelHeading(candidates, current, inFlightOthers);
  addSameDeparture(candidates, current, others);
  addHeadingContrast(candidates, current, inFlightOthers);
  addSquadInSky(candidates, inFlightOthers, landedOthers);
  addFreshArrival(candidates, landedOthers);
  addFirstOfNight(candidates, current, groupFlights);

  if (current.phase === 'landing' && current.landingTime) {
    addRelayFlight(candidates, inFlightOthers);

    const earlierLanders = landedOthers.filter(
      (f) => f.landingTime! < current.landingTime!
    );
    const laterLanders = landedOthers.filter(
      (f) => f.landingTime! > current.landingTime!
    );
    addEarlyLanding(candidates, earlierLanders);
    addLateLanding(candidates, laterLanders);
  }

  // 起飛時排除易讓機長廣播誤寫成「隊友 X 分鐘後降落」的 cue（空域／距離／進度）
  if (current.phase === 'takeoff') {
    return candidates.filter((c) => TAKEOFF_SOCIAL_CUE_TYPES.has(c.cueType));
  }

  return candidates;
}

export function pickPrioritySocialCueCandidate(
  candidates: SocialCueCandidate[],
  phase: 'takeoff' | 'landing',
  random: () => number = Math.random
): SocialCueCandidate | null {
  if (candidates.length === 0) return null;

  const priority = phase === 'landing' ? LANDING_SOCIAL_CUE_PRIORITY : TAKEOFF_SOCIAL_CUE_PRIORITY;
  for (const tier of priority) {
    const types: SocialCueType[] = (Array.isArray(tier) ? tier : [tier]).filter((type) => type !== 'solo');
    if (types.length === 0) continue;
    const pool = candidates.filter((candidate) => types.includes(candidate.cueType));
    if (pool.length === 0) continue;
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    return pool[index] ?? null;
  }

  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index] ?? null;
}

/** @deprecated 改用 pickPrioritySocialCueCandidate；保留別名避免舊呼叫炸掉 */
export function pickRandomSocialCueCandidate(
  candidates: SocialCueCandidate[],
  phase: 'takeoff' | 'landing' = 'landing',
  random: () => number = Math.random
): SocialCueCandidate | null {
  return pickPrioritySocialCueCandidate(candidates, phase, random);
}

/** 人數多時一句小隊氛圍；只統計今晚視窗內狀態，不列名單、不排行。 */
export function buildGroupSocialSummary(
  current: CurrentFlightContext,
  groupFlights: Flight[],
  nowMs: number = Date.now()
): string | null {
  const since = nowMs - GROUP_SUMMARY_NIGHT_WINDOW_MS;
  const others = groupFlights.filter((f) => f.passengerId !== current.passengerId);
  const recentOthers = others.filter((f) => eventTimeMs(f) >= since);
  const inFlight = recentOthers.filter((f) => f.status === 'in_flight');
  const landed = recentOthers.filter((f) => f.status === 'landed' && f.landingTime != null);
  const activeOthers = inFlight.length + landed.length;
  if (activeOthers < GROUP_SUMMARY_MIN_OTHERS) return null;

  // 敘事必須跟實際狀態一致：有人在飛就不要說「大家都著陸」，有人著陸就不要說「大家都在翱翔」
  if (inFlight.length >= 2 && landed.length >= 2) {
    return `今晚小隊雷達上 ${inFlight.length} 班仍在飛，另有 ${landed.length} 班已著陸。`;
  }
  if (inFlight.length >= 2 && landed.length === 1) {
    return `小隊雷達上還有 ${inFlight.length} 班在飛，夜航仍未散場。`;
  }
  if (inFlight.length >= 3 && landed.length === 0) {
    return `今晚小隊有 ${inFlight.length} 班還在雲上。`;
  }
  if (inFlight.length === 2 && landed.length === 0) {
    return '小隊雷達掃到兩班並行夜航。';
  }
  if (landed.length >= 3 && inFlight.length === 0) {
    return `今晚已有 ${landed.length} 班平安著陸。`;
  }
  if (landed.length >= 3 && inFlight.length === 1) {
    return `多班已著陸，雷達上仍留一班夜航。`;
  }
  if (landed.length >= 2 && inFlight.length === 1) {
    return '小隊雷達上有人已落地，也有人還在飛。';
  }
  if (landed.length >= 2 && inFlight.length === 0) {
    return `今晚已有 ${landed.length} 班著陸，小隊節奏慢慢收斂。`;
  }
  return null;
}

export function soloSocialCueCandidate(): SocialCueCandidate {
  return {
    cueType: 'solo',
    relatedPassenger: null,
    facts: { mood: 'solo_night_flight' },
  };
}
