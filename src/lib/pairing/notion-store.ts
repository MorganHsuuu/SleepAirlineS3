import { getNotionClient, readText, readTitle, wText, wTitle } from '../notion/client';

export const PAIRING_DATABASE_TITLE = 'Sleep Airline S3 Device Pairing';
const requiredProperties = {
  Name: 'title',
  Kind: 'select',
  'Recovery Hash': 'rich_text',
  'Device Secret Hash': 'rich_text',
  'Passenger ID': 'rich_text',
  'Last Grant Hash': 'rich_text',
  'Bound At': 'date',
} as const;

type PairingProperties = Record<string, unknown>;
type PairingPage = { id: string; properties: PairingProperties };

export type PassengerRecord = { pageId: string; passengerId: string; recoveryHash: string };
export type DeviceRecord = {
  pageId: string;
  deviceId: string;
  deviceSecretHash: string;
  passengerId: string | null;
  lastGrantHash: string;
};

export class PairingStoreError extends Error {
  constructor(public readonly code: string) { super(code); }
}

let cachedId: string | null = null;
let resolving: Promise<string> | null = null;

const normalizeId = (id: string) => id.replace(/-/g, '').toLowerCase();

function parentPageId(): string {
  const id = process.env.NOTION_PARENT_PAGE_ID?.trim();
  if (!id) throw new PairingStoreError('pairing_not_configured');
  return id;
}

function checkDatabase(db: { title?: Array<{ plain_text?: string }>; parent?: { type?: string; page_id?: string }; properties?: PairingProperties }) {
  if (db.title?.[0]?.plain_text !== PAIRING_DATABASE_TITLE ||
    db.parent?.type !== 'page_id' || normalizeId(db.parent.page_id || '') !== normalizeId(parentPageId())) {
    throw new PairingStoreError('pairing_database_mismatch');
  }
  for (const [name, type] of Object.entries(requiredProperties)) {
    if ((db.properties?.[name] as { type?: string } | undefined)?.type !== type) {
      throw new PairingStoreError('pairing_schema_mismatch');
    }
  }
}

export async function pairingDatabaseId(): Promise<string> {
  if (cachedId) return cachedId;
  if (!resolving) {
    resolving = (async () => {
      if (!process.env.NOTION_API_KEY || !process.env.NOTION_PAIRING_DB_ID) throw new PairingStoreError('pairing_not_configured');
      const client = getNotionClient();
      const id = process.env.NOTION_PAIRING_DB_ID.trim();
      const db = await client.databases.retrieve({ database_id: id });
      checkDatabase(db);
      cachedId = db.id;
      return db.id;
    })().finally(() => { resolving = null; });
  }
  return resolving;
}

async function byName(name: string): Promise<PairingPage | null> {
  const client = getNotionClient();
  const response = await client.databases.query({
    database_id: await pairingDatabaseId(),
    filter: { property: 'Name', title: { equals: name } },
    page_size: 2,
  });
  if (response.results.length > 1) throw new PairingStoreError('duplicate_pairing_record');
  const page = response.results[0] as PairingPage | undefined;
  return page ?? null;
}

function kind(page: PairingPage): string {
  return (page.properties.Kind as { select?: { name?: string } | null })?.select?.name || '';
}

export async function findPassenger(id: string): Promise<PassengerRecord | null> {
  const page = await byName(id);
  if (!page) return null;
  if (kind(page) !== 'Passenger' || readTitle(page.properties, 'Name') !== id) throw new PairingStoreError('pairing_record_mismatch');
  return { pageId: page.id, passengerId: id, recoveryHash: readText(page.properties, 'Recovery Hash') };
}

export async function createPassenger(id: string, recoveryHash: string): Promise<boolean> {
  if (await findPassenger(id)) return false;
  await getNotionClient().pages.create({
    parent: { database_id: await pairingDatabaseId() },
    properties: { Name: wTitle(id), Kind: { select: { name: 'Passenger' } }, 'Recovery Hash': wText(recoveryHash) },
  });
  // Notion does not enforce a unique Name. Detect concurrent duplicate creation instead of trusting either row.
  await findPassenger(id);
  return true;
}

export async function findDevice(id: string): Promise<DeviceRecord | null> {
  const page = await byName(id);
  if (!page) return null;
  if (kind(page) !== 'Device' || readTitle(page.properties, 'Name') !== id) throw new PairingStoreError('pairing_record_mismatch');
  return {
    pageId: page.id,
    deviceId: id,
    deviceSecretHash: readText(page.properties, 'Device Secret Hash'),
    passengerId: readText(page.properties, 'Passenger ID') || null,
    lastGrantHash: readText(page.properties, 'Last Grant Hash'),
  };
}

export async function devicesForPassenger(passengerId: string): Promise<DeviceRecord[]> {
  const result: DeviceRecord[] = [];
  let cursor: string | undefined;
  do {
    const response = await getNotionClient().databases.query({
      database_id: await pairingDatabaseId(),
      // A new database may not have a "Device" select option until its first
      // device is written. Notion can reject filters for missing select options.
      filter: { property: 'Passenger ID', rich_text: { equals: passengerId } },
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of response.results as PairingPage[]) {
      if (kind(page) !== 'Device') continue;
      result.push({
        pageId: page.id,
        deviceId: readTitle(page.properties, 'Name'),
        deviceSecretHash: readText(page.properties, 'Device Secret Hash'),
        passengerId,
        lastGrantHash: readText(page.properties, 'Last Grant Hash'),
      });
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return result;
}

export async function bindDevice(params: {
  deviceId: string; deviceSecretHash: string; passengerId: string; grantHash: string; existing: DeviceRecord | null;
}): Promise<void> {
  const properties = {
    'Device Secret Hash': wText(params.deviceSecretHash),
    'Passenger ID': wText(params.passengerId),
    'Last Grant Hash': wText(params.grantHash),
    'Bound At': { date: { start: new Date().toISOString() } },
  };
  if (params.existing) {
    await getNotionClient().pages.update({ page_id: params.existing.pageId, properties });
  } else {
    await getNotionClient().pages.create({
      parent: { database_id: await pairingDatabaseId() },
      properties: { Name: wTitle(params.deviceId), Kind: { select: { name: 'Device' } }, ...properties },
    });
  }
}

export async function unbindDevice(record: DeviceRecord): Promise<void> {
  await getNotionClient().pages.update({
    page_id: record.pageId,
    properties: { 'Passenger ID': wText(null), 'Bound At': { date: null } },
  });
}
