import { CITIES } from '../../data/cities';
import { calculateFlightDistance } from '../flight/distance';
import { findArrivalDestination } from '../flight/direction';
import { fetchLocalContext, resolveCountryIso } from '../flight/local-context';
import type { Destination, RouteDirection } from '../../types';

const DEFAULT_DEPARTURE = {
  displayName: '臺北, 臺灣',
  city: 'Taipei',
  country: 'Taiwan',
  countryIso: 'TW',
  timezone: 'Asia/Taipei',
  latitude: 25.033,
  longitude: 121.5654,
};

export interface SimulatedRoute {
  departureLocation: string;
  departureLatitude: number;
  departureLongitude: number;
  arrivalLocation: string;
  arrivalLatitude: number;
  arrivalLongitude: number;
  arrivalCity: string;
  arrivalCountry: string;
  arrivalIso: string;
  arrivalTimezone: string;
  durationMinutes: number;
  distanceKm: number;
  routeDirection: RouteDirection;
  takeoffTime: string;
  landingTime: string;
}

export interface GlobeRoute {
  from: { name: string; lat: number; lon: number };
  to: { name: string; lat: number; lon: number };
  arrivalLocation: string;
  departureLocation: string;
  durationMinutes: number;
  routeDirection: RouteDirection;
}

function shortPlace(displayName: string) {
  return displayName.split(',')[0].trim() || displayName;
}

export function globePoints(route: SimulatedRoute): GlobeRoute {
  return {
    from: {
      name: shortPlace(route.departureLocation),
      lat: route.departureLatitude,
      lon: route.departureLongitude,
    },
    to: {
      name: shortPlace(route.arrivalLocation),
      lat: route.arrivalLatitude,
      lon: route.arrivalLongitude,
    },
    arrivalLocation: route.arrivalLocation,
    departureLocation: route.departureLocation,
    durationMinutes: route.durationMinutes,
    routeDirection: route.routeDirection,
  };
}

const TIME_LABELS = [
  [5, '當地深夜'],
  [8, '當地黎明'],
  [11, '當地清晨'],
  [16, '當地午後'],
  [18, '當地傍晚'],
  [20, '當地黃昏'],
  [24, '當地夜晚'],
] as const;

export function labelForHour(hour: number): string {
  const safe = ((hour % 24) + 24) % 24;
  for (const [limit, label] of TIME_LABELS) {
    if (safe < limit) return label;
  }
  return '當地夜晚';
}

function findTaipei(): Destination | typeof DEFAULT_DEPARTURE {
  return CITIES.find((city) => city.city === 'Taipei' && city.countryIso === 'TW')
    || CITIES.find((city) => /taipei/i.test(city.city))
    || DEFAULT_DEPARTURE;
}

export function findCityByLocation(displayName?: string | null): Destination | null {
  const name = (displayName || '').trim();
  if (!name) return null;
  const exact = CITIES.find((city) => city.displayName === name);
  if (exact) return exact;
  const city = name.split(',')[0].trim();
  const lower = city.toLowerCase();
  return CITIES.find((item) => {
    const short = item.displayName.split(',')[0].trim();
    return short === city
      || item.city === city
      || item.city.toLowerCase() === lower
      || short.toLowerCase() === lower;
  }) || null;
}

export function findOriginByLocation(displayName?: string | null): Destination | typeof DEFAULT_DEPARTURE {
  return findCityByLocation(displayName) || findTaipei();
}

export function globeHop(fromLocation: string, toLocation: string): GlobeRoute {
  const from = findOriginByLocation(fromLocation);
  const to = findCityByLocation(toLocation) || findOriginByLocation(toLocation);
  return {
    from: {
      name: shortPlace(from.displayName),
      lat: from.latitude,
      lon: from.longitude,
    },
    to: {
      name: shortPlace(to.displayName),
      lat: to.latitude,
      lon: to.longitude,
    },
    arrivalLocation: to.displayName,
    departureLocation: from.displayName,
    durationMinutes: 0,
    routeDirection: 'eastbound',
  };
}

export function simulateRoute(
  routeDirection: RouteDirection,
  durationMinutes: number,
  landingHour: number | null,
  originLocation?: string | null
): SimulatedRoute {
  const minutes = Math.max(30, Math.min(720, Math.round(durationMinutes || 90)));
  const origin = findOriginByLocation(originLocation);
  const distanceKm = calculateFlightDistance(minutes);
  const arrival = findArrivalDestination(
    origin.latitude,
    origin.longitude,
    distanceKm,
    routeDirection,
    CITIES,
    origin.displayName
  );
  const landingTime = landingTimeForHour(arrival.timezone, landingHour);
  const takeoffTime = new Date(new Date(landingTime).getTime() - minutes * 60000).toISOString();
  return {
    departureLocation: origin.displayName,
    departureLatitude: origin.latitude,
    departureLongitude: origin.longitude,
    arrivalLocation: arrival.displayName,
    arrivalLatitude: arrival.latitude,
    arrivalLongitude: arrival.longitude,
    arrivalCity: arrival.city,
    arrivalCountry: arrival.country,
    arrivalIso: arrival.countryIso,
    arrivalTimezone: arrival.timezone,
    durationMinutes: minutes,
    distanceKm,
    routeDirection,
    takeoffTime,
    landingTime,
  };
}

function landingTimeForHour(timezone: string, landingHour: number | null): string {
  const now = new Date();
  if (landingHour == null || Number.isNaN(landingHour)) return now.toISOString();
  const target = Math.max(0, Math.min(23, landingHour));
  const zone = timezone || 'Asia/Taipei';
  try {
    for (let hour = 0; hour < 24; hour += 1) {
      const candidate = new Date(now.getTime());
      candidate.setUTCHours(hour, 0, 0, 0);
      const localHour = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(candidate));
      if (localHour === target) return candidate.toISOString();
    }
  } catch { /* fall through */ }
  return now.toISOString();
}

export async function localContextFor(
  cityName: string,
  countryName: string,
  countryIso: string,
  latitude: number,
  longitude: number,
  displayName: string,
  landingHour: number | null
) {
  const local = await fetchLocalContext({
    cityName,
    countryName,
    countryIso: countryIso || resolveCountryIso(latitude, longitude, displayName),
    latitude,
    longitude,
  }).catch(() => null);
  if (!local) return null;
  if (landingHour == null) return local;
  return { ...local, localTimeLabel: labelForHour(landingHour) };
}
