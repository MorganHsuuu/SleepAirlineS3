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
import { attachFileUploadToProperty, uploadImageToNotion, wFileUpload } from './notion-file-upload';
import { getFlightByFlightId } from './flight-lookup';
import {
  getDashboardPropertyTypes,
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

const LEGACY_SCENERY_URL = 'Image URL';
const FLIGHT_MEDIA_PROP = 'Files & media';

function listUrlProperties(types: Map<string, string>): string[] {
  return [...types.entries()].filter(([, type]) => type === 'url').map(([name]) => name);
}

function urlFieldScore(name: string): number {
  if (/風景|圖片|生圖|scenery|image|photo|landing/i.test(name)) return 2;
  if (/url/i.test(name)) return 1;
  return 0;
}

/**
 * 只選一個 URL 欄。風景庫裡另外加的欄優先於原本的 Image URL；
 * 風景庫沒有新欄時，改寫航班紀錄上使用者加的 URL 欄。
 */
function chooseSceneryUrlField(
  sceneryTypes: Map<string, string>,
  flightTypes: Map<string, string>
): { database: 'scenery' | 'flight'; name: string } | null {
  const addedOnScenery = listUrlProperties(sceneryTypes).filter((name) => name !== LEGACY_SCENERY_URL);
  if (addedOnScenery.length) {
    const [name] = [...addedOnScenery].sort((a, b) => urlFieldScore(b) - urlFieldScore(a));
    return { database: 'scenery', name };
  }

  const flightUrls = listUrlProperties(flightTypes);
  if (flightUrls.length) {
    const [name] = [...flightUrls].sort((a, b) => urlFieldScore(b) - urlFieldScore(a));
    return { database: 'flight', name };
  }

  if (sceneryTypes.get(LEGACY_SCENERY_URL) === 'url') {
    return { database: 'scenery', name: LEGACY_SCENERY_URL };
  }
  return null;
}

function readPropertyFileUrl(prop: unknown): string {
  const files = (prop as { files?: Array<{ type?: string; file?: { url?: string }; external?: { url?: string } }> })?.files;
  const file = files?.[0];
  if (!file) return '';
  if (file.type === 'file' && file.file?.url) return file.file.url;
  if (file.type === 'external' && file.external?.url) return file.external.url;
  return '';
}

function resolveImageUrl(props: Record<string, unknown>): string {
  const namedFile = readFirstFileUrl(props, 'Image');
  if (namedFile) return namedFile;

  for (const prop of Object.values(props)) {
    const typed = prop as { type?: string };
    if (typed?.type === 'files') {
      const url = readPropertyFileUrl(prop);
      if (url) return url;
    }
  }

  const named = readUrl(props, LEGACY_SCENERY_URL);
  if (named) return named;

  for (const prop of Object.values(props)) {
    const typed = prop as { type?: string; url?: string | null };
    if (typed?.type === 'url' && typed.url) return typed.url;
  }
  return '';
}

function filesPropertyName(types: Map<string, string>): string | null {
  if (types.get('Image') === 'files') return 'Image';
  for (const [name, type] of types) {
    if (type === 'files') return name;
  }
  return null;
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
  const flightTypes = await getDashboardPropertyTypes();
  if (flightTypes.get(FLIGHT_MEDIA_PROP) === 'files') {
    const flight = await getFlightByFlightId(params.flightId);
    if (!flight?.notionId) {
      console.error(`[scenery] ${params.flightId} 找不到航班列，無法寫入 ${FLIGHT_MEDIA_PROP}`);
      return null;
    }
    await attachFileUploadToProperty(
      flight.notionId,
      FLIGHT_MEDIA_PROP,
      fileUploadId,
      params.filename
    );
    const freshFlight = await client.pages.retrieve({ page_id: flight.notionId });
    const imageUrl = readFirstFileUrl(
      (freshFlight as { properties?: Record<string, unknown> }).properties ?? {},
      FLIGHT_MEDIA_PROP
    );
    if (!imageUrl) {
      console.error(`[scenery] ${params.flightId} ${FLIGHT_MEDIA_PROP} 沒有讀到圖片`);
      return null;
    }
    return {
      notionId: flight.notionId,
      entryId,
      flightId: params.flightId,
      passengerId: params.passengerId,
      passengerName: params.passengerName,
      groupId: params.groupId,
      arrivalLocation: params.arrivalLocation,
      country: params.country,
      imageUrl,
      imagePrompt: params.imagePrompt,
      landingTime: params.landingTime,
      createdAt: now,
    };
  }

  const dbId = await resolveLandscapeDbId();
  const allowed = await getLandscapePropertyNames();
  const types = await getLandscapePropertyTypes();
  const filesProp = filesPropertyName(types);

  const fullProperties: Record<string, unknown> = {
      'Entry ID': wTitle(entryId),
      'Flight ID': wText(params.flightId),
      'Passenger ID': wText(params.passengerId),
      'Name': wText(params.passengerName),
      'Group ID': wGroupId(params.groupId, types.get('Group ID')),
      'Arrival Location': wText(params.arrivalLocation),
      'Country': wText(params.country),
      'Image Prompt': wText(toNotionImagePrompt(params.imagePrompt)),
      'Landing Time': wDate(params.landingTime),
      'Created At': wDate(now),
  };
  if (filesProp) fullProperties[filesProp] = wFileUpload(fileUploadId, params.filename);

  const page = await client.pages.create({
    parent: { database_id: dbId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: pickExistingProperties(fullProperties, allowed) as any,
  });

  const fresh = await client.pages.retrieve({ page_id: page.id });
  const props = (fresh as { properties: Record<string, unknown> }).properties;
  const imageUrl = resolveImageUrl(props);
  if (!imageUrl) {
    console.error('[scenery] 圖片已上傳，但資料庫沒有檔案欄可掛上，URL 欄寫不進去');
  }
  const target = chooseSceneryUrlField(types, await getDashboardPropertyTypes());

  if (imageUrl && target?.database === 'scenery' && allowed.has(target.name)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.pages.update({
      page_id: page.id,
      properties: { [target.name]: wUrl(imageUrl) } as any,
    });
  } else if (imageUrl && target?.database === 'flight') {
    const flight = await getFlightByFlightId(params.flightId);
    if (flight?.notionId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await client.pages.update({
        page_id: flight.notionId,
        properties: { [target.name]: wUrl(imageUrl) } as any,
      });
    }
  }

  const saved = parseLandscape(fresh as unknown as Record<string, unknown>);
  if (!saved.imageUrl && imageUrl) saved.imageUrl = imageUrl;
  return saved;
}

async function readFlightMedia(flightId: string): Promise<LandingScenery | null> {
  const types = await getDashboardPropertyTypes();
  if (types.get(FLIGHT_MEDIA_PROP) !== 'files') return null;
  const flight = await getFlightByFlightId(flightId);
  if (!flight?.notionId) return null;
  const client = getNotionClient();
  const page = await client.pages.retrieve({ page_id: flight.notionId });
  const imageUrl = readFirstFileUrl(
    (page as { properties?: Record<string, unknown> }).properties ?? {},
    FLIGHT_MEDIA_PROP
  );
  if (!imageUrl) return null;
  return {
    notionId: flight.notionId,
    entryId: `SC-${flight.flightId}`,
    flightId: flight.flightId,
    passengerId: flight.passengerId,
    passengerName: flight.passengerName,
    groupId: flight.groupId,
    arrivalLocation: flight.arrivalLocation ?? '',
    country: '',
    imageUrl,
    imagePrompt: '',
    landingTime: flight.landingTime,
    createdAt: flight.createdAt,
  };
}

export async function getLandscapeByFlightId(flightId: string): Promise<LandingScenery | null> {
  if (!flightId) return null;

  if (!isNotionConfigured()) {
    return mem.find((r) => r.flightId === flightId) ?? null;
  }

  const fromFlight = await readFlightMedia(flightId);
  if (fromFlight) return fromFlight;

  const sceneryProps = await getLandscapePropertyNames();
  if (!sceneryProps.has('Flight ID')) return null;

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
  const refreshed = parseLandscape(fresh as unknown as Record<string, unknown>);
  if (refreshed.imageUrl) return refreshed;

  const flightTypes = await getDashboardPropertyTypes();
  const target = chooseSceneryUrlField(await getLandscapePropertyTypes(), flightTypes);
  if (target?.database !== 'flight') return refreshed;

  const flight = await getFlightByFlightId(flightId);
  if (!flight?.notionId) return refreshed;
  const flightPage = await client.pages.retrieve({ page_id: flight.notionId });
  const flightProps = (flightPage as { properties?: Record<string, unknown> }).properties ?? {};
  const flightUrl = readUrl(flightProps, target.name);
  if (!flightUrl) return refreshed;
  return { ...refreshed, imageUrl: flightUrl };
}
