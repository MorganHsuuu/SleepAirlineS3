import type { Flight } from '../../types';
import { getNotionClient, isNotionConfigured } from '../notion/client';
import { resolveDashboardDbId } from '../notion/ensure-dashboard';
import { getGroupFlights, parseFlight } from '../notion/flights';
import { getDashboardPropertyTypes } from '../notion/schema-introspect';

export const TRACKING_TZ = 'Asia/Taipei';
export const STUDY_START_DATE = '2026-11-09';
export const STUDY_DAY_COUNT = 14;

export const TERMINAL_001_ROSTER = [
  { passengerId: 'PAX-55437891114D2919', name: '方藝璇' },
  { passengerId: 'PAX-B3BE4881874F9979', name: '戴佑珊' },
  { passengerId: 'PAX-4B2833F4A0C45412', name: '翎翎' },
  { passengerId: 'PAX-37D428C61D98D16C', name: 'Zephyra' },
  { passengerId: 'PAX-F8CCB63A79A2ABF7', name: '陳希愷' },
] as const;

export type TrackingFlight = {
  flightId: string;
  passengerId: string;
  passengerName: string;
  groupId: string;
  status: string;
  takeoffTime: string;
  landingTime: string | null;
  sleepOpportunityMinutes: number | null;
  flightDurationMinutes: number | null;
  relatedPassenger: string | null;
  departureLocation: string;
  arrivalLocation: string | null;
  departureAirport: string;
  arrivalAirport: string;
  immigrationNote: string;
};

export function normalizeGroupId(value: string): string {
  const legacy = /^group_(\d{2})$/i.exec(value || '');
  if (legacy) return legacy[1].padStart(4, '0');
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '0001';
  return digits.slice(-4).padStart(4, '0');
}

function groupFilter(groupId: string, type: string | undefined) {
  const digits = normalizeGroupId(groupId);
  if (type === 'number') {
    return { property: 'Group ID', number: { equals: Number(digits) } };
  }
  return { property: 'Group ID', select: { equals: digits } };
}

function readAllPlainText(props: Record<string, unknown>, key: string): string {
  const value = props[key] as { rich_text?: { plain_text?: string }[] } | undefined;
  return (value?.rich_text ?? []).map((part) => part.plain_text || '').join('').trim();
}

function studyStartIso(): string {
  return `${STUDY_START_DATE}T00:00:00+08:00`;
}

function hoursSinceStudyStart(): number {
  const start = new Date(studyStartIso()).getTime();
  return Math.max(24, Math.ceil((Date.now() - start) / 3600000) + 24);
}

function toTrackingFlight(flight: Flight, props?: Record<string, unknown>): TrackingFlight {
  return {
    flightId: flight.flightId,
    passengerId: flight.passengerId,
    passengerName: flight.passengerName,
    groupId: flight.groupId,
    status: flight.status,
    takeoffTime: flight.takeoffTime,
    landingTime: flight.landingTime,
    sleepOpportunityMinutes: flight.sleepOpportunityMinutes ?? null,
    flightDurationMinutes: flight.flightDurationMinutes,
    relatedPassenger: flight.relatedPassenger,
    departureLocation: flight.departureLocation || '',
    arrivalLocation: flight.arrivalLocation,
    departureAirport: props ? readAllPlainText(props, 'Departure Airport Code') : '',
    arrivalAirport: props ? readAllPlainText(props, 'Arrival Airport Code') : '',
    immigrationNote: props ? readAllPlainText(props, 'Immigration Note') : '',
  };
}

export async function listTrackingFlights(groupId: string): Promise<TrackingFlight[]> {
  const gid = normalizeGroupId(groupId);
  const since = studyStartIso();
  if (!isNotionConfigured()) {
    const flights = await getGroupFlights(gid, hoursSinceStudyStart());
    return flights.map((flight) => toTrackingFlight(flight));
  }

  const client = getNotionClient();
  const dbId = await resolveDashboardDbId();
  const types = await getDashboardPropertyTypes();
  const flights: TrackingFlight[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ property: 'Takeoff Time', direction: 'descending' }],
      filter: {
        and: [
          groupFilter(gid, types.get('Group ID')),
          { property: 'Takeoff Time', date: { on_or_after: since } },
        ],
        // Notion SDK types are a strict union; this helper switches between number/select at runtime.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    for (const page of result.results) {
      const record = page as unknown as Record<string, unknown>;
      const flight = parseFlight(record);
      if (flight.status === 'in_flight' || flight.status === 'landed') {
        flights.push(toTrackingFlight(flight, record.properties as Record<string, unknown>));
      }
    }
    cursor = result.has_more && result.next_cursor ? result.next_cursor : undefined;
  } while (cursor && flights.length < 400);

  return flights;
}
