import { Client } from '@notionhq/client';
import {
  getNotionClient,
  isNotionConfigured,
  readTitle,
  readSelect,
  readNumber,
  readDate,
  readFirstFileUrl,
  wTitle,
  wSelect,
  wNumber,
  wDate,
} from './client';
import { REVIEW_DB_TITLE, getReviewProperties } from './review-schema';
import { attachFileUploadToProperty, uploadImageToNotion } from './notion-file-upload';

export interface ReviewSample {
  notionId: string;
  sampleId: string;
  phase: string;
  routeDirection: string;
  durationMinutes: number;
  landingHour: number | null;
  departureLocation: string;
  arrivalLocation: string;
  takeoffBroadcast: string;
  landingBroadcast: string;
  imagePrompt: string;
  imageUrl: string;
  comments: string;
  reviewer: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewStoreStatus {
  ready: boolean;
  mode: 'notion' | 'memory';
  hint: string;
}

const mem: ReviewSample[] = [];
const RICH_TEXT_CHUNK = 2000;
const COMMENTS_LIMIT = 18000;

function readTextAll(props: Record<string, unknown>, key: string): string {
  const p = props[key] as { rich_text?: { plain_text: string }[] } | undefined;
  return (p?.rich_text ?? []).map((part) => part.plain_text).join('');
}

function wLongText(value: string | null) {
  const text = value || '';
  const chunks: { text: { content: string } }[] = [];
  for (let i = 0; i < text.length && chunks.length < 10; i += RICH_TEXT_CHUNK) {
    chunks.push({ text: { content: text.slice(i, i + RICH_TEXT_CHUNK) } });
  }
  return { rich_text: chunks };
}

function parseSample(id: string, props: Record<string, unknown>): ReviewSample {
  return {
    notionId: id,
    sampleId: readTitle(props, 'Sample ID'),
    phase: readSelect(props, 'Phase') || 'draft',
    routeDirection: readSelect(props, 'Route Direction') || 'eastbound',
    durationMinutes: readNumber(props, 'Duration Minutes') || 0,
    landingHour: readNumber(props, 'Landing Hour'),
    departureLocation: readTextAll(props, 'Departure Location'),
    arrivalLocation: readTextAll(props, 'Arrival Location'),
    takeoffBroadcast: readTextAll(props, 'Takeoff Broadcast'),
    landingBroadcast: readTextAll(props, 'Landing Broadcast'),
    imagePrompt: readTextAll(props, 'Image Prompt'),
    imageUrl: readFirstFileUrl(props, 'Image'),
    comments: readTextAll(props, 'Comments'),
    reviewer: readTextAll(props, 'Reviewer'),
    createdAt: readDate(props, 'Created At') || '',
    updatedAt: readDate(props, 'Updated At') || '',
  };
}

export async function getReviewStoreStatus(): Promise<ReviewStoreStatus> {
  if (!isNotionConfigured()) {
    return {
      ready: false,
      mode: 'memory',
      hint: '尚未接上 Notion，測試內容只存在伺服器記憶體，Redeploy 後會清空。',
    };
  }
  try {
    const id = await resolveReviewDbId();
    if (!id) {
      return {
        ready: false,
        mode: 'memory',
        hint: '請新增獨立資料庫 Sleep Airline Review Lab，並把 ID 填進 Vercel 的 NOTION_REVIEW_DB_ID。主庫不用改。',
      };
    }
    return { ready: true, mode: 'notion', hint: '' };
  } catch (err) {
    return {
      ready: false,
      mode: 'memory',
      hint: err instanceof Error ? err.message : '審查庫尚未就緒，這次先寫進記憶體。',
    };
  }
}

export async function resolveReviewDbId(): Promise<string | null> {
  const raw = process.env.NOTION_REVIEW_DB_ID?.replace(/-/g, '').trim();
  if (raw && raw.length >= 32) return raw;
  return null;
}

export async function listReviewSamples(limit = 24): Promise<ReviewSample[]> {
  const dbId = await resolveReviewDbId().catch(() => null);
  if (!isNotionConfigured() || !dbId) {
    return [...mem].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  const client = getNotionClient();
  const response = await client.databases.query({
    database_id: dbId,
    page_size: Math.min(limit, 50),
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
  });

  return response.results.map((page) => {
    const typed = page as { id: string; properties: Record<string, unknown> };
    return parseSample(typed.id, typed.properties);
  });
}

export async function getReviewSample(sampleId: string): Promise<ReviewSample | null> {
  const fromMem = mem.find((item) => item.sampleId === sampleId || item.notionId === sampleId);
  const dbId = await resolveReviewDbId().catch(() => null);
  if (!isNotionConfigured() || !dbId) return fromMem || null;

  if (fromMem && !fromMem.notionId.startsWith('mem_')) {
    try {
      const page = await getNotionClient().pages.retrieve({ page_id: fromMem.notionId });
      const typed = page as { id: string; properties: Record<string, unknown> };
      return parseSample(typed.id, typed.properties);
    } catch { /* fall through */ }
  }

  const samples = await listReviewSamples(50);
  const listed = samples.find((item) => item.sampleId === sampleId || item.notionId === sampleId) || fromMem || null;
  if (listed && listed.notionId && !listed.notionId.startsWith('mem_')) {
    try {
      const page = await getNotionClient().pages.retrieve({ page_id: listed.notionId });
      const typed = page as { id: string; properties: Record<string, unknown> };
      return parseSample(typed.id, typed.properties);
    } catch {
      return listed;
    }
  }
  return listed;
}

export async function createReviewSample(input: Partial<ReviewSample>): Promise<ReviewSample> {
  const now = new Date().toISOString();
  const sample: ReviewSample = {
    notionId: '',
    sampleId: input.sampleId || `RV-${Date.now().toString(36).toUpperCase()}`,
    phase: input.phase || 'draft',
    routeDirection: input.routeDirection || 'eastbound',
    durationMinutes: input.durationMinutes || 60,
    landingHour: input.landingHour ?? null,
    departureLocation: input.departureLocation || '',
    arrivalLocation: input.arrivalLocation || '',
    takeoffBroadcast: input.takeoffBroadcast || '',
    landingBroadcast: input.landingBroadcast || '',
    imagePrompt: input.imagePrompt || '',
    imageUrl: input.imageUrl || '',
    comments: input.comments || '',
    reviewer: input.reviewer || '',
    createdAt: now,
    updatedAt: now,
  };

  const dbId = await resolveReviewDbId().catch(() => null);
  if (!isNotionConfigured() || !dbId) {
    sample.notionId = `mem_${sample.sampleId}`;
    mem.unshift(sample);
    return sample;
  }

  const client = getNotionClient();
  const page = await client.pages.create({
    parent: { database_id: dbId },
    properties: sampleToProperties(sample),
  });
  sample.notionId = page.id;
  mem.unshift(sample);
  return sample;
}

export async function updateReviewSample(
  sampleId: string,
  updates: Partial<ReviewSample>
): Promise<ReviewSample> {
  const current = await getReviewSample(sampleId);
  if (!current) throw new Error('找不到這筆測試內容。');
  const next: ReviewSample = {
    ...current,
    ...updates,
    sampleId: current.sampleId,
    notionId: current.notionId,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const memIndex = mem.findIndex((item) => item.sampleId === current.sampleId || item.notionId === current.notionId);
  if (memIndex >= 0) mem[memIndex] = next;
  else mem.unshift(next);

  if (isNotionConfigured() && next.notionId && !next.notionId.startsWith('mem_')) {
    await getNotionClient().pages.update({
      page_id: next.notionId,
      properties: sampleToProperties(next),
    });
  }
  return next;
}

export async function appendReviewComment(
  sampleId: string,
  comment: string,
  reviewer: string
): Promise<ReviewSample> {
  const current = await getReviewSample(sampleId);
  if (!current) throw new Error('找不到這筆測試內容。');
  const stamp = new Date().toLocaleString('zh-TW', { hour12: false });
  const name = reviewer.trim() || '匿名';
  const line = `[${stamp} ${name}]\n${comment.trim()}`;
  const comments = [current.comments, line].filter(Boolean).join('\n\n').slice(-COMMENTS_LIMIT);
  return updateReviewSample(current.sampleId, { comments, reviewer: name, phase: current.phase });
}

type CachedReviewImage = { buffer: Buffer; contentType: string; at: number };
const imageCache = new Map<string, CachedReviewImage>();
const IMAGE_CACHE_MS = 30 * 60 * 1000;

export function cacheReviewImage(sampleId: string, buffer: Buffer, contentType: string) {
  imageCache.set(sampleId, { buffer, contentType, at: Date.now() });
}

export function toReviewClient(sample: ReviewSample) {
  const hasImage = Boolean(sample.imageUrl);
  return {
    ...sample,
    hasImage,
    imageUrl: hasImage ? `/api/review/image?sampleId=${encodeURIComponent(sample.sampleId)}` : '',
  };
}

export async function loadReviewImage(sampleId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const cached = imageCache.get(sampleId);
  if (cached && Date.now() - cached.at < IMAGE_CACHE_MS) return cached;

  const sample = await getReviewSample(sampleId);
  if (!sample?.imageUrl) return cached || null;

  if (sample.imageUrl.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(sample.imageUrl);
    if (!match) return null;
    const payload = {
      buffer: match[2]
        ? Buffer.from(match[3], 'base64')
        : Buffer.from(decodeURIComponent(match[3]), 'utf8'),
      contentType: match[1] || 'image/png',
      at: Date.now(),
    };
    imageCache.set(sampleId, payload);
    return payload;
  }

  let upstream = await fetch(sample.imageUrl);
  if (!upstream.ok && sample.notionId && !sample.notionId.startsWith('mem_')) {
    const refreshed = await getReviewSample(sampleId);
    if (refreshed?.imageUrl && refreshed.imageUrl !== sample.imageUrl) {
      upstream = await fetch(refreshed.imageUrl);
    }
  }
  if (!upstream.ok) return cached || null;

  const payload = {
    buffer: Buffer.from(await upstream.arrayBuffer()),
    contentType: upstream.headers.get('content-type') || 'image/jpeg',
    at: Date.now(),
  };
  imageCache.set(sampleId, payload);
  return payload;
}

export async function attachReviewImage(
  sample: ReviewSample,
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  cacheReviewImage(sample.sampleId, buffer, contentType);
  if (!isNotionConfigured() || !sample.notionId || sample.notionId.startsWith('mem_')) {
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }
  const uploadId = await uploadImageToNotion(buffer, filename, contentType);
  await attachFileUploadToProperty(sample.notionId, 'Image', uploadId, filename);
  const refreshed = await getReviewSample(sample.sampleId);
  return refreshed?.imageUrl || `data:${contentType};base64,${buffer.toString('base64')}`;
}

function sampleToProperties(sample: ReviewSample) {
  return {
    'Sample ID': wTitle(sample.sampleId),
    Phase: wSelect(sample.phase),
    'Route Direction': wSelect(sample.routeDirection),
    'Duration Minutes': wNumber(sample.durationMinutes),
    'Landing Hour': wNumber(sample.landingHour),
    'Departure Location': wLongText(sample.departureLocation),
    'Arrival Location': wLongText(sample.arrivalLocation),
    'Takeoff Broadcast': wLongText(sample.takeoffBroadcast),
    'Landing Broadcast': wLongText(sample.landingBroadcast),
    'Image Prompt': wLongText(sample.imagePrompt),
    Comments: wLongText(sample.comments),
    Reviewer: wLongText(sample.reviewer),
    'Created At': wDate(sample.createdAt),
    'Updated At': wDate(sample.updatedAt),
  };
}

export async function applyReviewDatabaseSchema(databaseId: string): Promise<string[]> {
  const client = getNotionClient();
  const id = databaseId.replace(/-/g, '');
  const db = await client.databases.retrieve({ database_id: id }) as {
    properties: Record<string, { type: string; name: string }>;
  };
  const current = db.properties;
  const wanted = getReviewProperties() as Record<string, object>;
  const updates: Record<string, object> = {};

  const titleProp = Object.values(current).find((prop) => prop.type === 'title');
  if (titleProp && titleProp.name !== 'Sample ID') {
    updates[titleProp.name] = { name: 'Sample ID', title: {} };
  }

  for (const [name, schema] of Object.entries(wanted)) {
    if (name === 'Sample ID') continue;
    const existing = current[name];
    if (!existing || existing.type === 'select') updates[name] = schema;
  }

  await client.databases.update({
    database_id: id,
    title: [{ type: 'text', text: { content: REVIEW_DB_TITLE } }],
    properties: updates as Parameters<Client['databases']['update']>[0]['properties'],
  });

  const refreshed = await client.databases.retrieve({ database_id: id }) as {
    properties: Record<string, { type: string }>;
  };
  return Object.entries(refreshed.properties).map(([name, prop]) => `${name} (${prop.type})`);
}

export async function createReviewDatabase(parentPageId: string): Promise<string> {
  const client = getNotionClient();
  const db = await client.databases.create({
    parent: { type: 'page_id', page_id: parentPageId.replace(/-/g, '') },
    title: [{ type: 'text', text: { content: REVIEW_DB_TITLE } }],
    properties: getReviewProperties(),
  });
  return db.id;
}

export async function findReviewDatabaseOnPage(parentPageId: string): Promise<string | null> {
  const client = getNotionClient();
  let cursor: string | undefined;
  do {
    const response = await client.blocks.children.list({
      block_id: parentPageId.replace(/-/g, ''),
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of response.results) {
      const typed = block as { type?: string; id?: string };
      if (typed.type !== 'child_database' || !typed.id) continue;
      const db = await (client as Client).databases.retrieve({ database_id: typed.id });
      const title = (db as { title?: { plain_text: string }[] }).title?.[0]?.plain_text ?? '';
      if (title === REVIEW_DB_TITLE) return typed.id;
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return null;
}
