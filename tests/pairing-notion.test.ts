import assert from 'node:assert/strict';
import { test } from 'node:test';

const parentId = '3e5a7f1b413c80f592e8ce14af8c2ec0';
const databaseId = '11111111111111111111111111111111';
const passengerId = 'PAX-TEST0001';
const deviceId = 'SA-TEST0001';
const recoveryCode = 'recovery-code-with-at-least-32-characters';
const setupCode = 'setup-code-with-at-least-32-characters---';
const deviceSecret = 'device-secret-with-at-least-32-characters';

function responseProperties(properties: Record<string, any>) {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => {
    if (value?.title) return [key, { title: value.title.map((part: any) => ({ plain_text: part.text.content })) }];
    if (value?.rich_text) return [key, { rich_text: value.rich_text.map((part: any) => ({ plain_text: part.text.content })) }];
    return [key, value];
  }));
}

test('Notion pairing preserves the phone/Pi API contract, recovery, replay protection and unbinding', async () => {
  process.env.NOTION_API_KEY = 'test-token';
  process.env.NOTION_PARENT_PAGE_ID = parentId;
  process.env.NOTION_PAIRING_DB_ID = databaseId;
  process.env.PAIRING_SIGNING_SECRET = 'a-test-signing-key-that-is-at-least-32-characters';
  const { getNotionClient } = await import('../src/lib/notion/client');
  const client = getNotionClient() as any;
  const rows: Array<{ id: string; properties: Record<string, any> }> = [];
  client.databases.retrieve = async () => ({
    id: databaseId,
    title: [{ plain_text: 'Sleep Airline S3 Device Pairing' }],
    parent: { type: 'page_id', page_id: parentId },
    properties: Object.fromEntries([
      ['Name', 'title'], ['Kind', 'select'], ['Recovery Hash', 'rich_text'],
      ['Device Secret Hash', 'rich_text'], ['Passenger ID', 'rich_text'],
      ['Last Grant Hash', 'rich_text'], ['Bound At', 'date'],
    ].map(([name, type]) => [name, { type }])),
  });
  client.databases.query = async ({ filter }: any) => {
    let selected = rows;
    if (filter.property === 'Name') {
      selected = rows.filter(row => row.properties.Name?.title?.[0]?.plain_text === filter.title.equals);
    } else {
      const id = filter.and[1].rich_text.equals;
      selected = rows.filter(row => row.properties.Kind?.select?.name === 'Device' &&
        row.properties['Passenger ID']?.rich_text?.[0]?.plain_text === id);
    }
    return { results: selected, has_more: false, next_cursor: null };
  };
  client.pages.create = async ({ properties }: any) => {
    const row = { id: `row-${rows.length + 1}`, properties: responseProperties(properties) };
    rows.push(row);
    return row;
  };
  client.pages.update = async ({ page_id, properties }: any) => {
    const row = rows.find(candidate => candidate.id === page_id);
    assert.ok(row);
    Object.assign(row.properties, responseProperties(properties));
    return row;
  };

  const { default: router } = await import('../src/lib/pairing/routes');
  const call = async (path: string, _method = 'POST', body?: object, session?: string) => {
    const layer = (router as any).stack.find((entry: any) => entry.route?.path === path);
    assert.ok(layer, path);
    return await new Promise<{ code: number; body: any }>((resolve, reject) => {
      const request = { body, get: (name: string) => name.toLowerCase() === 'authorization' && session ? `Bearer ${session}` : undefined };
      const response = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(value: any) { resolve({ code: this.statusCode, body: value }); return this; },
      };
      Promise.resolve(layer.route.stack[0].handle(request, response)).catch(reject);
    });
  };

    const created = await call('/passengers', 'POST', { passengerId, recoveryCode });
    assert.equal(created.code, 201);
    assert.equal(created.body.passengerId, passengerId);
    assert.equal((await call('/passengers', 'POST', { passengerId, recoveryCode })).code, 409);
    assert.equal((await call('/sessions', 'POST', { passengerId, recoveryCode: 'wrong-code-with-at-least-32-characters' })).code, 401);
    const restored = await call('/sessions', 'POST', { passengerId, recoveryCode });
    assert.equal(restored.code, 200);
    const session = restored.body.session as string;
    assert.equal((await call('/status', 'GET', undefined, session.slice(0, -1) + 'x')).code, 401);
    assert.equal((await call('/status', 'GET', undefined, session)).body.status, 'unpaired');
    const granted = await call('/grants', 'POST', { deviceId, setupCode }, session);
    assert.equal(granted.code, 200);
    assert.equal((await call('/devices/complete', 'POST', { deviceId, deviceSecret, setupCode: 'wrong-code-with-at-least-32-characters', grant: granted.body.grant })).code, 401);
    const complete = { deviceId, deviceSecret, setupCode, grant: granted.body.grant };
    assert.equal((await call('/devices/complete', 'POST', complete)).body.status, 'paired');
    assert.equal((await call('/devices/complete', 'POST', complete)).body.status, 'paired');
    assert.equal((await call('/status', 'GET', undefined, session)).body.deviceId, deviceId);
    assert.equal((await call('/devices/status', 'POST', { deviceId, deviceSecret })).body.status, 'paired');
    assert.equal((await call('/devices/status', 'POST', { deviceId, deviceSecret: 'wrong-device-secret-with-at-least-32-characters' })).code, 404);
    const otherDevice = await call('/grants', 'POST', { deviceId: 'SA-TEST0002', setupCode }, session);
    assert.equal(otherDevice.body.error, 'passenger_already_bound');
    const otherPassenger = await call('/passengers', 'POST', { passengerId: 'PAX-TEST0002', recoveryCode });
    const theirGrant = await call('/grants', 'POST', { deviceId, setupCode }, otherPassenger.body.session);
    assert.equal((await call('/devices/complete', 'POST', { ...complete, grant: theirGrant.body.grant })).body.error, 'device_already_bound');
    assert.ok(!JSON.stringify(rows).includes(recoveryCode));
    assert.ok(!JSON.stringify(rows).includes(deviceSecret));
    assert.equal((await call('/unbind', 'POST', {}, session)).body.status, 'unpaired');
    assert.equal((await call('/devices/complete', 'POST', complete)).body.error, 'grant_used');
    assert.equal((await call('/devices/status', 'POST', { deviceId, deviceSecret })).body.status, 'unpaired');
    assert.equal((await call('/status', 'GET', undefined, session)).body.status, 'unpaired');
});
