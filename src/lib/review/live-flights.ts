import { getNotionClient, isNotionConfigured } from '../notion/client';
import { resolveDashboardDbId } from '../notion/ensure-dashboard';
import { parseFlight } from '../notion/flights';
import type { Flight } from '../../types';

export interface LiveReviewFlight {
  source: 'live';
  sampleId: string;
  flightId: string;
  passengerName: string;
  phase: string;
  routeDirection: string;
  durationMinutes: number;
  landingHour: number | null;
  departureLocation: string;
  arrivalLocation: string;
  takeoffBroadcast: string;
  landingBroadcast: string;
  hasImage: boolean;
  imageUrl: string;
  comments: string;
  reviewer: string;
  textScore: number | null;
  generatedAt: string;
}

function dashboardIdFromEnv(): string | null {
  const raw = process.env.NOTION_DASHBOARD_DB_ID?.replace(/-/g, '').trim();
  return raw && raw.length >= 32 ? raw : null;
}

async function resolveLiveDashboardId(): Promise<string | null> {
  const fromEnv = dashboardIdFromEnv();
  if (fromEnv) return fromEnv;
  try {
    const resolved = await resolveDashboardDbId();
    return resolved?.replace(/-/g, '').trim() || null;
  } catch (err) {
    console.error('[review/live-flights] resolve dashboard failed', err);
    return null;
  }
}

export function toLiveReviewFlight(flight: Flight): LiveReviewFlight {
  return {
    source: 'live',
    sampleId: flight.flightId,
    flightId: flight.flightId,
    passengerName: flight.passengerName || '',
    phase: flight.status,
    routeDirection: flight.routeDirection || 'eastbound',
    durationMinutes: flight.flightDurationMinutes || 0,
    landingHour: null,
    departureLocation: flight.departureLocation || '',
    arrivalLocation: flight.arrivalLocation || '',
    takeoffBroadcast: flight.takeoffBroadcast || '',
    landingBroadcast: flight.captainBroadcast || '',
    hasImage: flight.status === 'landed',
    imageUrl: flight.status === 'landed'
      ? `/api/scenery-image?flightId=${encodeURIComponent(flight.flightId)}`
      : '',
    comments: '',
    reviewer: '',
    textScore: null,
    generatedAt: flight.landingTime || flight.takeoffTime || flight.updatedAt || flight.createdAt || '',
  };
}

function keepLiveFlight(flight: Flight): boolean {
  return Boolean(flight.takeoffBroadcast || flight.captainBroadcast || flight.arrivalLocation);
}

function parseLivePage(page: Record<string, unknown>): LiveReviewFlight | null {
  try {
    const flight = parseFlight(page);
    return keepLiveFlight(flight) ? toLiveReviewFlight(flight) : null;
  } catch (err) {
    console.error('[review/live-flights] skip page', err);
    return null;
  }
}

async function queryFlightPages(dbId: string, limit: number) {
  const client = getNotionClient();
  const pageSize = Math.min(Math.max(limit, 1), 40);
  try {
    return await client.databases.query({
      database_id: dbId,
      filter: {
        or: [
          { property: 'Status', select: { equals: 'landed' } },
          { property: 'Status', select: { equals: 'in_flight' } },
        ],
      },
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: pageSize,
    });
  } catch (err) {
    console.error('[review/live-flights] filtered query failed, retrying open query', err);
    return client.databases.query({
      database_id: dbId,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: pageSize,
    });
  }
}

export async function listRecentLiveFlights(limit = 24): Promise<LiveReviewFlight[]> {
  if (!isNotionConfigured()) return [];

  const dbId = await resolveLiveDashboardId();
  if (!dbId) {
    throw new Error('找不到 Flight Log。請確認 Vercel 已填 NOTION_DASHBOARD_DB_ID。');
  }

  const result = await queryFlightPages(dbId, limit);
  return result.results
    .map((page) => parseLivePage(page as unknown as Record<string, unknown>))
    .filter((item): item is LiveReviewFlight => Boolean(item));
}
