import { getNotionClient, isNotionConfigured } from '../notion/client';
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
  generatedAt: string;
}

function dashboardId(): string | null {
  const raw = process.env.NOTION_DASHBOARD_DB_ID?.replace(/-/g, '').trim();
  return raw && raw.length >= 32 ? raw : null;
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
    generatedAt: flight.landingTime || flight.takeoffTime || flight.updatedAt || flight.createdAt || '',
  };
}

export async function listRecentLiveFlights(limit = 16): Promise<LiveReviewFlight[]> {
  const dbId = dashboardId();
  if (!isNotionConfigured() || !dbId) return [];

  const client = getNotionClient();
  const result = await client.databases.query({
    database_id: dbId,
    filter: {
      or: [
        { property: 'Status', select: { equals: 'landed' } },
        { property: 'Status', select: { equals: 'in_flight' } },
      ],
    },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: Math.min(limit, 24),
  });

  return result.results
    .map((page) => parseFlight(page as unknown as Record<string, unknown>))
    .filter((flight) => flight.takeoffBroadcast || flight.captainBroadcast || flight.arrivalLocation)
    .map(toLiveReviewFlight);
}
