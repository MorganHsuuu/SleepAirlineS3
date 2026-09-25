import type { Destination, DestinationResult, RouteDirection } from '../../types';
import { haversineDistance, calculateBearing } from '../utils/haversine';
import { directionCenterBearing, moveAlongBearing } from './geo';

// Bearing ranges for each direction (0° = north, clockwise)
function isInDirection(bearing: number, direction: RouteDirection): boolean {
  const b = ((bearing % 360) + 360) % 360;
  switch (direction) {
    case 'northbound': return b >= 315 || b < 45;
    case 'northeast':  return b >= 22.5 && b < 67.5;
    case 'eastbound':  return b >= 45 && b < 135;
    case 'southeast':  return b >= 112.5 && b < 157.5;
    case 'southbound': return b >= 135 && b < 225;
    case 'southwest':  return b >= 202.5 && b < 247.5;
    case 'westbound':  return b >= 225 && b < 315;
    case 'northwest':  return b >= 292.5 && b < 337.5;
    // auto, circular, unknown → no direction constraint
    default:           return true;
  }
}

/**
 * 選降落城市：優先貼近「飛行軌跡尖端」
 * （出發地沿航向飛 distanceKm 的位置），避免只比距離遠近
 * 導致實際降落地與地圖上飛機位置差很遠。
 */
export function findArrivalDestination(
  departureLat: number,
  departureLng: number,
  distanceKm: number,
  routeDirection: RouteDirection,
  destinations: Destination[],
  departureLocation: string
): DestinationResult {
  const available = destinations.filter(
    (d) => d.availableForLanding && d.displayName !== departureLocation
  );

  const tipBearing = directionCenterBearing(routeDirection) ?? 90;
  const tip = moveAlongBearing(departureLat, departureLng, tipBearing, Math.max(distanceKm, 1));

  type Candidate = DestinationResult & {
    tipDistanceKm: number;
    inDirection: boolean;
  };

  const candidates: Candidate[] = available.map((dest) => {
    const actualDistance = haversineDistance(
      departureLat, departureLng,
      dest.latitude, dest.longitude
    );
    const bearing = calculateBearing(
      departureLat, departureLng,
      dest.latitude, dest.longitude
    );
    const tipDistanceKm = haversineDistance(
      tip.latitude, tip.longitude,
      dest.latitude, dest.longitude
    );
    return {
      ...dest,
      distanceKm: actualDistance,
      tipDistanceKm,
      inDirection: isInDirection(bearing, routeDirection),
    };
  });

  const byTipThenDistance = (a: Candidate, b: Candidate) => {
    const tipDiff = a.tipDistanceKm - b.tipDistanceKm;
    if (Math.abs(tipDiff) > 1) return tipDiff;
    return Math.abs(a.distanceKm - distanceKm) - Math.abs(b.distanceKm - distanceKm);
  };

  const pick = (pool: Candidate[]) => {
    const iconicReach = Math.max(320, distanceKm * 0.72);
    const iconic = pool.filter((c) => isIconicCity(c.city) && c.tipDistanceKm <= iconicReach);
    if (iconic.length > 0) {
      iconic.sort((a, b) => a.tipDistanceKm - b.tipDistanceKm);
      return iconic[0];
    }
    pool.sort(byTipThenDistance);
    return pool[0];
  };

  const directional = candidates.filter((c) => c.inDirection);
  if (directional.length > 0) return pick(directional);
  return pick(candidates);
}

const ICONIC_CITIES = new Set([
  'tokyo', 'kyoto', 'osaka', 'nara', 'hiroshima', 'sapporo', 'fukuoka', 'naha',
  'seoul', 'busan',
  'taipei', 'kaohsiung', 'taichung', 'tainan', 'hualien',
  'hong kong', 'macau', 'macao',
  'shanghai', 'beijing', 'xian', "xi'an", 'guilin', 'chengdu', 'hangzhou',
  'bangkok', 'chiang mai', 'phuket',
  'singapore',
  'hanoi', 'ho chi minh city',
  'manila', 'cebu',
  'jakarta', 'denpasar', 'ubud',
  'kuala lumpur',
  'sydney', 'melbourne', 'cairns',
  'auckland', 'queenstown',
  'paris', 'lyon',
  'london', 'edinburgh',
  'rome', 'venice', 'florence', 'milan',
  'barcelona', 'madrid', 'seville',
  'amsterdam',
  'berlin', 'munich',
  'prague', 'vienna', 'budapest',
  'athens', 'santorini',
  'istanbul',
  'cairo', 'giza', 'luxor',
  'marrakech', 'marrakesh', 'fes',
  'cape town',
  'dubai', 'abu dhabi',
  'jerusalem',
  'mumbai', 'delhi', 'new delhi', 'agra', 'jaipur', 'varanasi',
  'kathmandu',
  'moscow', 'saint petersburg',
  'new york', 'los angeles', 'san francisco', 'las vegas', 'chicago',
  'vancouver', 'toronto', 'montreal', 'banff',
  'rio de janeiro', 'sao paulo', 'são paulo',
  'buenos aires',
  'mexico city', 'cancun', 'cancún',
  'reykjavik', 'reykjavík',
  'lisbon', 'porto',
  'dublin',
  'copenhagen', 'stockholm', 'oslo',
  'zurich', 'zürich', 'geneva',
  'cusco', 'cuzco',
]);

function isIconicCity(city: string): boolean {
  return ICONIC_CITIES.has(city.trim().toLowerCase());
}
