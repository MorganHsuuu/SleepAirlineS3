/**
 * Social cue priority + group summary contract checks.
 * Run: npx tsx scripts/check-social-cue-priority.ts
 */
import {
  buildGroupSocialSummary,
  pickPrioritySocialCueCandidate,
  shouldAttachGroupSummary,
  type CurrentFlightContext,
  type SocialCueCandidate,
} from '../src/lib/flight/social-candidates';
import { composeSocialTakeaway, isSelfLandingTakeaway, isMisaddressedSelfTakeaway } from '../src/lib/ai/social-takeaway';
import type { Flight } from '../src/types';

let failed = 0;

function assert(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

function baseCtx(phase: 'takeoff' | 'landing'): CurrentFlightContext {
  return {
    passengerId: 'p_self',
    passengerName: 'Self',
    departureLocation: 'Taipei, Taiwan',
    departureLatitude: 25.03,
    departureLongitude: 121.56,
    arrivalLocation: phase === 'landing' ? 'Kyoto, Japan' : null,
    arrivalLatitude: phase === 'landing' ? 35.01 : null,
    arrivalLongitude: phase === 'landing' ? 135.77 : null,
    routeDirection: 'eastbound',
    takeoffTime: '2026-07-11T16:00:00.000Z',
    landingTime: phase === 'landing' ? '2026-07-11T20:00:00.000Z' : null,
    flightProgress: phase === 'landing' ? 100 : 0,
    phase,
  };
}

function flight(partial: Partial<Flight> & Pick<Flight, 'passengerId' | 'passengerName' | 'status'>): Flight {
  return {
    notionId: partial.notionId ?? partial.passengerId,
    flightId: partial.flightId ?? `f_${partial.passengerId}`,
    passengerId: partial.passengerId,
    passengerName: partial.passengerName,
    groupId: '0001',
    status: partial.status,
    departureLocation: partial.departureLocation ?? 'Taipei, Taiwan',
    departureLatitude: partial.departureLatitude ?? 25.03,
    departureLongitude: partial.departureLongitude ?? 121.56,
    arrivalLocation: partial.arrivalLocation ?? null,
    arrivalLatitude: partial.arrivalLatitude ?? null,
    arrivalLongitude: partial.arrivalLongitude ?? null,
    takeoffTime: partial.takeoffTime ?? '2026-07-11T15:00:00.000Z',
    landingTime: partial.landingTime ?? null,
    flightDurationMinutes: partial.flightDurationMinutes ?? 120,
    estimatedFlightDistanceKm: partial.estimatedFlightDistanceKm ?? 1800,
    flightProgress: partial.flightProgress ?? (partial.status === 'landed' ? 100 : 40),
    narrativeRegion: partial.narrativeRegion ?? 'pacific_drift',
    routeDirection: partial.routeDirection ?? 'eastbound',
    takeoffBroadcastStyle: null,
    takeoffBroadcast: null,
    captainBroadcast: null,
    socialCueType: null,
    socialCueText: null,
    relatedPassenger: null,
    textMemo: null,
    idPhotoUrl: null,
    createdAt: '2026-07-11T15:00:00.000Z',
    updatedAt: '2026-07-11T15:00:00.000Z',
  };
}

const mixed: SocialCueCandidate[] = [
  { cueType: 'solo', relatedPassenger: null, facts: {} },
  { cueType: 'squad_in_sky', relatedPassenger: null, facts: { inFlightCount: 2, landedCount: 1 } },
  { cueType: 'teammate_arrival', relatedPassenger: 'Amy', facts: { teammateName: 'Amy', eventTimeMs: 9 } },
  { cueType: 'route_convergence', relatedPassenger: 'Ben', facts: { teammateName: 'Ben', eventTimeMs: 1 } },
  { cueType: 'fresh_arrival', relatedPassenger: 'Cara', facts: { teammateName: 'Cara', eventTimeMs: 99 } },
  { cueType: 'relay_flight', relatedPassenger: 'Dan', facts: { teammateName: 'Dan', eventTimeMs: 50 } },
];

{
  const picked = pickPrioritySocialCueCandidate(mixed, 'landing', () => 0);
  assert(
    'landing prefers route_convergence over newer cues',
    picked?.cueType === 'route_convergence',
    picked?.cueType
  );
}

{
  const takeoffPool: SocialCueCandidate[] = [
    { cueType: 'first_of_night', relatedPassenger: null, facts: {} },
    { cueType: 'same_departure', relatedPassenger: 'Amy', facts: { teammateName: 'Amy' } },
    { cueType: 'teammate_in_sky', relatedPassenger: 'Ben', facts: { teammateName: 'Ben' } },
    { cueType: 'squad_in_sky', relatedPassenger: null, facts: { inFlightCount: 2, landedCount: 0 } },
  ];
  const picked = pickPrioritySocialCueCandidate(takeoffPool, 'takeoff', () => 0.9);
  assert(
    'takeoff prefers teammate_in_sky over lower tiers',
    picked?.cueType === 'teammate_in_sky',
    picked?.cueType
  );
}

{
  const earlyLate: SocialCueCandidate[] = [
    { cueType: 'squad_in_sky', relatedPassenger: null, facts: { inFlightCount: 0, landedCount: 2 } },
    { cueType: 'early_landing', relatedPassenger: 'Amy', facts: { teammateName: 'Amy' } },
    { cueType: 'late_landing', relatedPassenger: 'Ben', facts: { teammateName: 'Ben' } },
  ];
  const first = pickPrioritySocialCueCandidate(earlyLate, 'landing', () => 0);
  const second = pickPrioritySocialCueCandidate(earlyLate, 'landing', () => 0.99);
  assert(
    'early/late landing share one priority tier',
    !!first && !!second
      && ['early_landing', 'late_landing'].includes(first.cueType)
      && ['early_landing', 'late_landing'].includes(second.cueType)
      && first.relatedPassenger !== second.relatedPassenger,
    `${first?.cueType}/${second?.cueType}`
  );
}

const NOW_MS = Date.parse('2026-07-12T14:00:00.000Z');

{
  const few = [
    flight({ passengerId: 'p_self', passengerName: 'Self', status: 'in_flight' }),
    flight({ passengerId: 'p1', passengerName: 'A', status: 'in_flight' }),
    flight({ passengerId: 'p2', passengerName: 'B', status: 'landed', landingTime: '2026-07-12T12:00:00.000Z', arrivalLocation: 'Kyoto, Japan' }),
  ];
  const summary = buildGroupSocialSummary(baseCtx('takeoff'), few, NOW_MS);
  assert('small group skips group summary', summary == null, String(summary));
}

{
  const many = [
    flight({ passengerId: 'p_self', passengerName: 'Self', status: 'in_flight' }),
    flight({ passengerId: 'p1', passengerName: 'A', status: 'in_flight', flightProgress: 30, takeoffTime: '2026-07-12T10:00:00.000Z' }),
    flight({ passengerId: 'p2', passengerName: 'B', status: 'in_flight', flightProgress: 55, takeoffTime: '2026-07-12T11:00:00.000Z' }),
    flight({ passengerId: 'p3', passengerName: 'C', status: 'landed', takeoffTime: '2026-07-12T08:00:00.000Z', landingTime: '2026-07-12T12:00:00.000Z', arrivalLocation: 'Osaka, Japan' }),
    flight({ passengerId: 'p4', passengerName: 'D', status: 'landed', takeoffTime: '2026-07-12T09:00:00.000Z', landingTime: '2026-07-12T13:00:00.000Z', arrivalLocation: 'Tokyo, Japan' }),
  ];
  const summary = buildGroupSocialSummary(baseCtx('landing'), many, NOW_MS);
  assert('large group adds group summary', !!summary && summary.length > 0, String(summary));
  assert(
    'group summary does not list every teammate by name',
    !!summary && !/A.*B.*C|Amy|Ben|Cara/.test(summary) && !/排行|比較|睡得更|睡眠狀態/.test(summary),
    String(summary)
  );
  assert(
    'group summary sounds like a radar skim',
    !!summary && /雷達|小隊|夜航|雲上|著陸|在飛/.test(summary),
    String(summary)
  );
}

{
  const one = composeSocialTakeaway('Amy 還在飛，你不是唯一醒著的人');
  assert('takeaway stays one sentence without group summary', !one.includes('。', one.indexOf('。') + 1) && /。$/.test(one), one);

  const two = composeSocialTakeaway(
    'Amy 還在飛，你不是唯一醒著的人',
    '今晚小隊有 3 班還在雲上'
  );
  const sentences = two.split(/[。！？]/).filter(Boolean);
  assert('takeaway with group summary is at most two sentences', sentences.length === 2, two);
  assert('composed takeaway keeps primary then group summary', two.startsWith('Amy') && /雲上/.test(two), two);
}

{
  assert(
    'rejects takeoff takeaway that says current passenger already landed',
    isSelfLandingTakeaway('Momo 已經安全降落，辛苦啦。', 'Momo', 'takeoff') === true
  );
  assert(
    'allows takeoff takeaway about a teammate landing',
    isSelfLandingTakeaway('Bobo 已經降落，先替小隊探了路。', 'Momo', 'takeoff') === false
  );
  assert(
    'allows landing takeaway for self',
    isSelfLandingTakeaway('你完成了一趟安靜的個人航班。', 'Momo', 'landing') === false
  );
}

{
  const firstNightOnly = [
    flight({ passengerId: 'p_self', passengerName: 'Self', status: 'in_flight', takeoffTime: '2026-07-12T14:00:00.000Z' }),
    // 舊航班：不應算進「今晚」氛圍
    flight({
      passengerId: 'p_old1',
      passengerName: 'Old1',
      status: 'landed',
      takeoffTime: '2026-07-10T10:00:00.000Z',
      landingTime: '2026-07-10T18:00:00.000Z',
      arrivalLocation: 'Osaka, Japan',
    }),
    flight({
      passengerId: 'p_old2',
      passengerName: 'Old2',
      status: 'landed',
      takeoffTime: '2026-07-10T11:00:00.000Z',
      landingTime: '2026-07-10T19:00:00.000Z',
      arrivalLocation: 'Tokyo, Japan',
    }),
    flight({
      passengerId: 'p_old3',
      passengerName: 'Old3',
      status: 'landed',
      takeoffTime: '2026-07-09T11:00:00.000Z',
      landingTime: '2026-07-09T19:00:00.000Z',
      arrivalLocation: 'Seoul, Korea',
    }),
    flight({
      passengerId: 'p_old4',
      passengerName: 'Old4',
      status: 'landed',
      takeoffTime: '2026-07-08T11:00:00.000Z',
      landingTime: '2026-07-08T19:00:00.000Z',
      arrivalLocation: 'Bangkok, Thailand',
    }),
  ];
  const summary = buildGroupSocialSummary(baseCtx('takeoff'), firstNightOnly, NOW_MS);
  assert(
    'ignores stale landed flights outside tonight window',
    summary == null,
    String(summary)
  );
}

{
  const mostlyLandedTonight = [
    flight({ passengerId: 'p_self', passengerName: 'Self', status: 'landed', landingTime: '2026-07-12T14:30:00.000Z', arrivalLocation: 'Kyoto, Japan' }),
    flight({ passengerId: 'p1', passengerName: 'A', status: 'landed', takeoffTime: '2026-07-12T10:00:00.000Z', landingTime: '2026-07-12T12:00:00.000Z', arrivalLocation: 'Osaka, Japan' }),
    flight({ passengerId: 'p2', passengerName: 'B', status: 'landed', takeoffTime: '2026-07-12T10:30:00.000Z', landingTime: '2026-07-12T12:30:00.000Z', arrivalLocation: 'Tokyo, Japan' }),
    flight({ passengerId: 'p3', passengerName: 'C', status: 'landed', takeoffTime: '2026-07-12T11:00:00.000Z', landingTime: '2026-07-12T13:00:00.000Z', arrivalLocation: 'Seoul, Korea' }),
  ];
  const summary = buildGroupSocialSummary(
    { ...baseCtx('landing'), landingTime: '2026-07-12T14:30:00.000Z', flightProgress: 100 },
    mostlyLandedTonight,
    NOW_MS
  );
  assert('landed-heavy night mentions landing, not soaring', !!summary && /著陸|降落/.test(summary) && !/翱翔|都在飛|雲上/.test(summary), String(summary));
}

{
  assert(
    'first_of_night does not attach group summary',
    shouldAttachGroupSummary('first_of_night') === false
  );
  assert(
    'solo does not attach group summary',
    shouldAttachGroupSummary('solo') === false
  );
  assert(
    'teammate_in_sky may attach group summary',
    shouldAttachGroupSummary('teammate_in_sky') === true
  );
}

{
  assert(
    'composed takeaway keeps exact rule-based second sentence',
    composeSocialTakeaway('你是今晚小隊第一班起飛的航班', '小隊雷達上還有 2 班在飛，夜航仍未散場。')
      === '你是今晚小隊第一班起飛的航班。小隊雷達上還有 2 班在飛，夜航仍未散場。'
  );
}

{
  assert(
    'rejects takeoff takeaway that narrates current passenger in third person',
    isMisaddressedSelfTakeaway(
      'Morgan 現在在夜空中翱翔，讓我們一起祝他一路平安。',
      'Morgan',
      'takeoff'
    ) === true
  );
  assert(
    'allows takeoff takeaway about a different teammate',
    isMisaddressedSelfTakeaway(
      'Bobo 還在飛，你不是唯一醒著的人。',
      'Morgan',
      'takeoff'
    ) === false
  );
  assert(
    'allows takeoff takeaway that addresses the passenger as 你',
    isMisaddressedSelfTakeaway(
      '你是今晚小隊第一班起飛的航班。',
      'Morgan',
      'takeoff'
    ) === false
  );
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\n✓ social cue priority checks passed');
}
