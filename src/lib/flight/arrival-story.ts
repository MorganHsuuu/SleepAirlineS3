import { getNotionClient, isNotionConfigured, readDate, readSelect } from '../notion/client';
import { resolveDashboardDbId } from '../notion/ensure-dashboard';
import { getDashboardPropertyTypes } from '../notion/schema-introspect';

export type PreviousArrivalStory = {
  flightId: string;
  text: string;
  landingTime: string;
};

type StoryFlight = { flightId: string; passengerId: string; takeoffTime: string };
type Page = { properties?: Record<string, unknown> };
function textProperty(props: Record<string, unknown>, name: string): string {
  const field = props[name] as { rich_text?: { plain_text?: string }[]; title?: { plain_text?: string }[] } | undefined;
  return (field?.rich_text ?? field?.title ?? []).map(part => part.plain_text || '').join('').trim();
}

/** Select by flight chronology, never edit date: an old note edited today is still an old flight. */
export function selectPreviousArrivalStory(pages: Page[], current: StoryFlight): PreviousArrivalStory | null {
  const before = Date.parse(current.takeoffTime);
  if (!current.passengerId || !Number.isFinite(before)) return null;
  const candidates = pages.flatMap(page => {
    const props = page.properties || {};
    const flightId = textProperty(props, 'Flight ID');
    const text = textProperty(props, 'Immigration Note');
    const landingTime = readDate(props, 'Landing Time') || '';
    const timestamp = Date.parse(landingTime);
    if (!flightId || flightId === current.flightId || textProperty(props, 'Passenger ID') !== current.passengerId
      || readSelect(props, 'Status') !== 'landed' || !text || !Number.isFinite(timestamp) || timestamp >= before) return [];
    return [{ flightId, text: Array.from(text).slice(0, 800).join(''), landingTime }];
  });
  candidates.sort((a, b) => Date.parse(b.landingTime) - Date.parse(a.landingTime) || a.flightId.localeCompare(b.flightId));
  return candidates[0] || null;
}

export async function loadPreviousArrivalStory(current: StoryFlight): Promise<PreviousArrivalStory | null> {
  if (!isNotionConfigured() || !current.passengerId || !Number.isFinite(Date.parse(current.takeoffTime))) return null;
  const types = await getDashboardPropertyTypes();
  if (types.get('Immigration Note') !== 'rich_text') return null;
  const client = getNotionClient();
  const databaseId = await resolveDashboardDbId();
  let cursor: string | undefined;
  do {
    const result = await client.databases.query({
      database_id: databaseId,
      page_size: 20,
      start_cursor: cursor,
      sorts: [{ property: 'Landing Time', direction: 'descending' }],
      filter: { and: [
        types.get('Passenger ID') === 'title'
          ? { property: 'Passenger ID', title: { equals: current.passengerId } }
          : { property: 'Passenger ID', rich_text: { equals: current.passengerId } },
        { property: 'Status', select: { equals: 'landed' } },
        { property: 'Landing Time', date: { before: current.takeoffTime } },
        { property: 'Immigration Note', rich_text: { is_not_empty: true } },
      ] },
    });
    const story = selectPreviousArrivalStory(result.results as Page[], current);
    if (story) return story;
    cursor = result.has_more ? result.next_cursor || undefined : undefined;
  } while (cursor);
  return null;
}
