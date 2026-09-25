import type { LandingScenery } from '../../types';
import {
  getNotionClient,
  isNotionConfigured,
  readTitle,
  readText,
  readSelect,
  readNumber,
  readDate,
  readUrl,
  readFirstFileUrl,
  wTitle,
  wText,
  wSelect,
  wNumber,
  wDate,
  wUrl,
} from './client';
import { resolveLandscapeDbId } from './ensure-landscape-db';
import { uploadImageToNotion, wFileUpload } from './notion-file-upload';
import {
  getLandscapePropertyNames,
  getLandscapePropertyTypes,
  pickExistingProperties,
} from './schema-introspect';

const mem: LandingScenery[] = [];
const NOTION_RICH_TEXT_CONTENT_LIMIT = 2000;

export function toNotionImagePrompt(value: string): string {
  if (value.length <= NOTION_RICH_TEXT_CONTENT_LIMIT) return value;
  const clipped = value.slice(0, NOTION_RICH_TEXT_CONTENT_LIMIT);
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

function normalizeGroupDigits(groupId: string): string {
  const legacy = /^group_(\d{2})$/i.exec(groupId || '');
  if (legacy) return legacy[1].padStart(4, '0');
  const digits = String(groupId || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.slice(-4).padStart(4, '0');
}

function readGroupId(props: Record<string, unknown>): string {
  const numeric = readNumber(props, 'Group ID');
  if (typeof numeric === 'number' && Number.isFinite(numeric)) {
    return String(Math.trunc(numeric)).padStart(4, '0');
  }
  return readSelect(props, 'Group ID') ?? '';
}

function groupNumber(groupId: string): number | null {
  const digits = normalizeGroupDigits(groupId);
  if (!/^\d{4}$/.test(digits)) return null;
  return Number(digits);
}

function wGroupId(value: string, type: string | undefined) {
  if (type === 'number') return wNumber(groupNumber(value));
  return wSelect(value);
}

function resolveImageUrl(props: Record<string, unknown>): string {
  return readFirstFileUrl(props, 'Image') || readUrl(props, 'Image URL');
}

function parseLandscape(page: Record<string, unknown>): LandingScenery {
  const props = page.properties as Record<string, unknown>;
  return {
    notionId: page.id as string,
    entryId: readTitle(props, 'Entry ID'),
    flightId: readText(props, 'Flight ID'),
    passengerId: readText(props, 'Passenger ID'),
    passengerName: readText(props, 'Name'),
    groupId: readGroupId(props),
    arrivalLocation: readText(props, 'Arrival Location'),
    country: readText(props, 'Country'),
    imageUrl: resolveImageUrl(props),
    imagePrompt: readText(props, 'Image Prompt'),
    landingTime: readDate(props, 'Landing Time'),
    createdAt: readDate(props, 'Created At') ?? new Date().toISOString(),
  };
}

export async function saveLandingScenery(params: {
  flightId: string;
  passengerId: string;
  passengerName: string;
  groupId: string;
  arrivalLocation: string;
  country: string;
  imageBuffer: Buffer;
  filename: string;
  contentType: string;
  imagePrompt: string;
  landingTime: string;
}): Promise<LandingScenery | null> {
  const now = new Date().toISOString();
  const entryId = `SC-${params.flightId}`;

  if (!isNotionConfigured()) {
    const dataUrl = `data:${params.contentType};base64,${params.imageBuffer.toString('base64')}`;
    const record: LandingScenery = {
      notionId: `mem_scenery_${params.flightId}`,
      entryId,
      flightId: params.flightId,
      passengerId: params.passengerId,
      passengerName: params.passengerName,
      groupId: params.groupId,
      arrivalLocation: params.arrivalLocation,
      country: params.country,
      imageUrl: dataUrl,
      imagePrompt: params.imagePrompt,
      landingTime: params.landingTime,
      createdAt: now,
    };
    mem.push(record);
    return record;
  }

  const fileUploadId = await uploadImageToNotion(
    params.imageBuffer,
    params.filename,
    params.contentType
  );

  const client = getNotionClient();
  const dbId = await resolveLandscapeDbId();
  const allowed = await getLandscapePropertyNames();
  const types = await getLandscapePropertyTypes();

  const fullProperties = {
      'Entry ID': wTitle(entryId),
      'Flight ID': wText(params.flightId),
      'Passenger ID': wText(params.passengerId),
      'Name': wText(params.passengerName),
      'Group ID': wGroupId(params.groupId, types.get('Group ID')),
      'Arrival Location': wText(params.arrivalLocation),
      'Country': wText(params.country),
      'Image': wFileUpload(fileUploadId, params.filename),
      'Image Prompt': wText(toNotionImagePrompt(params.imagePrompt)),
      'Landing Time': wDate(params.landingTime),
      'Created At': wDate(now),
  };

  const page = await client.pages.create({
    parent: { database_id: dbId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: pickExistingProperties(fullProperties, allowed) as any,
  });

  const fresh = await client.pages.retrieve({ page_id: page.id });
  const props = (fresh as { properties: Record<string, unknown> }).properties;
  const imageUrl = resolveImageUrl(props);

  if (imageUrl && allowed.has('Image URL')) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.pages.update({
      page_id: page.id,
      properties: { 'Image URL': wUrl(imageUrl) } as any,
    });
  }

  return parseLandscape(fresh as unknown as Record<string, unknown>);
}

export async function getLandscapeByFlightId(flightId: string): Promise<LandingScenery | null> {
  if (!flightId) return null;

  if (!isNotionConfigured()) {
    return mem.find((r) => r.flightId === flightId) ?? null;
  }

  const client = getNotionClient();
  const dbId = await resolveLandscapeDbId();

  const result = await client.databases.query({
    database_id: dbId,
    filter: { property: 'Flight ID', rich_text: { equals: flightId } },
    sorts: [{ property: 'Created At', direction: 'descending' }],
    page_size: 1,
  });

  if (result.results.length === 0) return null;

  // query 結果通常已含 properties；有圖就直接用，省一次 pages.retrieve
  const page = result.results[0] as unknown as Record<string, unknown>;
  const parsed = parseLandscape(page);
  if (parsed.imageUrl) return parsed;

  const fresh = await client.pages.retrieve({ page_id: result.results[0].id });
  return parseLandscape(fresh as unknown as Record<string, unknown>);
}
