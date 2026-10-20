import { getNotionClient, isNotionConfigured, readDate, readFirstFileUrl, readNumber, readSelect, readText, readTitle, wText } from '../notion/client';
import { resolveDashboardDbId } from '../notion/ensure-dashboard';

type Properties = Record<string, unknown>;
type NotionPage = { id: string; created_time?: string; properties: Properties };

const headings: Record<string, number> = {
  northbound: 0, northeast: 45, eastbound: 90, southeast: 135,
  southbound: 180, southwest: 225, westbound: 270, northwest: 315,
};
const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function location(value: string): { city: string; country: string } {
  const [city = '', ...country] = value.split(',').map((part) => part.trim());
  return { city, country: country.join(', ') };
}

function heading(props: Properties): { degrees: number | null; label: string } {
  const selected = readSelect(props, 'Route Direction') || '';
  let degrees = headings[selected];
  if (degrees === undefined) {
    const lat1 = readNumber(props, 'Departure Latitude');
    const lon1 = readNumber(props, 'Departure Longitude');
    const lat2 = readNumber(props, 'Arrival Latitude');
    const lon2 = readNumber(props, 'Arrival Longitude');
    if ([lat1, lon1, lat2, lon2].every((part) => part !== null) && (lat1 !== lat2 || lon1 !== lon2)) {
      const a = (lat1 as number) * Math.PI / 180;
      const b = (lat2 as number) * Math.PI / 180;
      const delta = ((lon2 as number) - (lon1 as number)) * Math.PI / 180;
      degrees = (Math.round(Math.atan2(Math.sin(delta) * Math.cos(b),
        Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) * 180 / Math.PI) + 360) % 360;
    }
  }
  return degrees === undefined
    ? { degrees: null, label: '' }
    : { degrees, label: labels[Math.round(degrees / 45) % labels.length] };
}

export function archiveJourney(page: NotionPage, passengerId: string) {
  const props = page.properties;
  if (readText(props, 'Passenger ID') !== passengerId) return null;
  const id = readTitle(props, 'Flight ID') || readText(props, 'Flight ID');
  const departureTime = readDate(props, 'Takeoff Time');
  if (!id || !departureTime) return null;
  const landingTime = readDate(props, 'Landing Time');
  const origin = location(readText(props, 'Departure Location'));
  const destination = location(readText(props, 'Arrival Location'));
  const storedMinutes = readNumber(props, 'Flight Duration Minutes');
  const calculatedMinutes = landingTime
    ? Math.max(0, Math.round((Date.parse(landingTime) - Date.parse(departureTime)) / 60_000))
    : null;
  const durationMinutes = storedMinutes ?? (Number.isFinite(calculatedMinutes) ? calculatedMinutes : null);
  return {
    id, userId: passengerId, flightNumber: id,
    passengerName: readText(props, 'Name'),
    origin: { ...origin, airportCode: readText(props, 'Departure Airport Code'),
      latitude: readNumber(props, 'Departure Latitude'), longitude: readNumber(props, 'Departure Longitude') },
    destination: { ...destination, airportCode: readText(props, 'Arrival Airport Code'),
      latitude: readNumber(props, 'Arrival Latitude'), longitude: readNumber(props, 'Arrival Longitude') },
    departureTime, landingTime, timeZone: readText(props, 'Client Time Zone'),
    durationMinutes, direction: heading(props),
    imageUrl: readFirstFileUrl(props, 'Files & media'),
    imageAlt: destination.city || '',
    note: readText(props, 'Immigration Note'),
    status: readSelect(props, 'Status') === 'landed' && landingTime ? 'completed' : 'processing',
    createdAt: readDate(props, 'Created At') || page.created_time || departureTime,
  };
}

function requireLiveDatabase() {
  if (!isNotionConfigured()) throw new Error('archive_not_configured');
}

export async function listArchiveJourneys(passengerId: string) {
  requireLiveDatabase();
  const client = getNotionClient();
  const databaseId = await resolveDashboardDbId();
  const journeys: NonNullable<ReturnType<typeof archiveJourney>>[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.databases.query({
      database_id: databaseId,
      filter: { property: 'Passenger ID', rich_text: { equals: passengerId } },
      sorts: [{ property: 'Takeoff Time', direction: 'descending' }],
      page_size: 100,
      start_cursor: cursor,
    });
    for (const result of response.results) {
      const journey = archiveJourney(result as unknown as NotionPage, passengerId);
      if (journey) journeys.push(journey);
    }
    cursor = response.has_more ? response.next_cursor || undefined : undefined;
  } while (cursor);
  return journeys;
}

export function isWritableArchivePage(page: NotionPage, passengerId: string, flightId: string): boolean {
  return readText(page.properties, 'Passenger ID') === passengerId &&
    readTitle(page.properties, 'Flight ID') === flightId &&
    readSelect(page.properties, 'Status') === 'landed';
}

export async function saveArchiveNote(passengerId: string, flightId: string, note: string) {
  requireLiveDatabase();
  const client = getNotionClient();
  const databaseId = await resolveDashboardDbId();
  const response = await client.databases.query({
    database_id: databaseId,
    filter: { and: [
      { property: 'Passenger ID', rich_text: { equals: passengerId } },
      { property: 'Flight ID', title: { equals: flightId } },
      { property: 'Status', select: { equals: 'landed' } },
    ] },
    page_size: 2,
  });
  if (response.results.length !== 1) return false;
  const page = response.results[0] as unknown as NotionPage;
  if (!isWritableArchivePage(page, passengerId, flightId)) return false;
  await client.pages.update({ page_id: page.id, properties: { 'Immigration Note': wText(note) } });
  return true;
}
