import {
  getNotionClient,
  isNotionConfigured,
  readFirstFileUrl,
  wText,
} from './client';
import { resolveDashboardDbId } from './ensure-dashboard';
import { uploadImageToNotion, wFileUpload } from './notion-file-upload';
import { getDashboardPropertyNames } from './schema-introspect';
import type { Flight } from '../../types';

export const ID_PHOTO_PROP = 'ID photo';
export const TEXT_MEMO_PROP = 'Text memo';
export const TEXT_MEMO_MAX = 20;

export function clampTextMemo(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  return Array.from(text).slice(0, TEXT_MEMO_MAX).join('');
}

export function readIdPhotoUrl(props: Record<string, unknown>): string | null {
  return readFirstFileUrl(props, ID_PHOTO_PROP) || null;
}

export function hydrateFlightPhotos(flights: Flight[]): Flight[] {
  const latest = new Map<string, { url: string; t: number }>();
  for (const flight of flights) {
    const url = flight.idPhotoUrl?.trim();
    if (!url || !flight.passengerId) continue;
    const t = new Date(flight.updatedAt || flight.takeoffTime).getTime();
    const prev = latest.get(flight.passengerId);
    if (!prev || t >= prev.t) latest.set(flight.passengerId, { url, t });
  }
  return flights.map((flight) => ({
    ...flight,
    idPhotoUrl: flight.idPhotoUrl || latest.get(flight.passengerId)?.url || null,
  }));
}

function parseDataUrl(input: string): { buffer: Buffer; contentType: string; filename: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(input.trim());
  if (!match) return null;
  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 900_000) return null;
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  return { buffer, contentType, filename: `id-photo.${ext}` };
}

async function findPhotoTargetPageId(passengerId: string): Promise<string | null> {
  if (!isNotionConfigured()) return null;
  const client = getNotionClient();
  const dbId = await resolveDashboardDbId();

  const inFlight = await client.databases.query({
    database_id: dbId,
    filter: {
      and: [
        { property: 'Passenger ID', rich_text: { equals: passengerId } },
        { property: 'Status', select: { equals: 'in_flight' } },
      ],
    },
    page_size: 1,
  });
  if (inFlight.results[0]) return inFlight.results[0].id;

  const lastLanded = await client.databases.query({
    database_id: dbId,
    filter: {
      and: [
        { property: 'Passenger ID', rich_text: { equals: passengerId } },
        { property: 'Status', select: { equals: 'landed' } },
      ],
    },
    sorts: [{ property: 'Landing Time', direction: 'descending' }],
    page_size: 1,
  });
  return lastLanded.results[0]?.id ?? null;
}

export async function attachIdPhotoToPage(
  pageId: string,
  dataUrl: string
): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('頭像格式無效，請改傳 JPG 或 PNG。');
  if (!isNotionConfigured()) return dataUrl;

  const allowed = await getDashboardPropertyNames();
  if (!allowed.has(ID_PHOTO_PROP)) {
    throw new Error('Notion 尚未建立 ID photo 欄位。');
  }

  const fileUploadId = await uploadImageToNotion(
    parsed.buffer,
    parsed.filename,
    parsed.contentType
  );
  const client = getNotionClient();
  await client.pages.update({
    page_id: pageId,
    properties: {
      [ID_PHOTO_PROP]: wFileUpload(fileUploadId, parsed.filename),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
  const fresh = await client.pages.retrieve({ page_id: pageId }) as {
    properties?: Record<string, unknown>;
  };
  return readIdPhotoUrl(fresh.properties ?? {});
}

export async function savePassengerIdPhoto(
  passengerId: string,
  dataUrl: string
): Promise<{ idPhotoUrl: string | null; pending: boolean }> {
  if (!isNotionConfigured()) {
    return { idPhotoUrl: dataUrl, pending: false };
  }
  const pageId = await findPhotoTargetPageId(passengerId);
  if (!pageId) return { idPhotoUrl: null, pending: true };
  const idPhotoUrl = await attachIdPhotoToPage(pageId, dataUrl);
  return { idPhotoUrl, pending: false };
}

export async function saveFlightTextMemo(
  passengerId: string,
  textMemo: string,
  flightId?: string
): Promise<string> {
  const memo = clampTextMemo(textMemo);
  if (!isNotionConfigured()) return memo;

  const allowed = await getDashboardPropertyNames();
  if (!allowed.has(TEXT_MEMO_PROP)) return memo;

  const client = getNotionClient();
  const dbId = await resolveDashboardDbId();
  const filters: Array<Record<string, unknown>> = [
    { property: 'Passenger ID', rich_text: { equals: passengerId } },
    { property: 'Status', select: { equals: 'in_flight' } },
  ];
  if (flightId) {
    filters.push({ property: 'Flight ID', title: { equals: flightId } });
  }
  const result = await client.databases.query({
    database_id: dbId,
    filter: {
      and: filters,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    page_size: 1,
  });
  const page = result.results[0];
  if (!page) throw new Error('找不到進行中的航班，無法寫入留言。');

  await client.pages.update({
    page_id: page.id,
    properties: {
      [TEXT_MEMO_PROP]: wText(memo || null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
  return memo;
}
