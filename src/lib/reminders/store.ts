import { createHash } from 'crypto';

import type {
  LandingReminderRecord,
  SubscribeLandingReminderInput,
} from './types';

const memoryRecords = new Map<string, LandingReminderRecord>();
const INDEX_KEY = `${process.env.REMINDER_REDIS_PREFIX || 'sleep-airline'}:landing-reminders:index`;
const RECORD_PREFIX = `${process.env.REMINDER_REDIS_PREFIX || 'sleep-airline'}:landing-reminders:record:`;

function redisUrl(): string | null {
  return process.env.REMINDER_REDIS_REST_URL
    || process.env.KV_REST_API_URL
    || process.env.UPSTASH_REDIS_REST_URL
    || null;
}

function redisToken(): string | null {
  return process.env.REMINDER_REDIS_REST_TOKEN
    || process.env.KV_REST_API_TOKEN
    || process.env.UPSTASH_REDIS_REST_TOKEN
    || null;
}

export function isPersistentReminderStoreConfigured(): boolean {
  return !!(redisUrl() && redisToken());
}

async function redisCommand<T = unknown>(command: unknown[]): Promise<T> {
  const url = redisUrl();
  const token = redisToken();
  if (!url || !token) throw new Error('Reminder Redis REST env is not configured.');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`Reminder Redis command failed (${res.status}).`);
  }
  const data = await res.json() as { result?: T; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result as T;
}

function reminderId(passengerId: string, endpoint: string): string {
  const hash = createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
  const passenger = passengerId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `${passenger}:${hash}`;
}

function recordKey(id: string): string {
  return `${RECORD_PREFIX}${id}`;
}

function parseRecord(raw: unknown): LandingReminderRecord | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const record = JSON.parse(raw) as LandingReminderRecord;
    return record?.id && record?.subscription?.endpoint ? record : null;
  } catch {
    return null;
  }
}

async function readRecord(id: string): Promise<LandingReminderRecord | null> {
  if (!isPersistentReminderStoreConfigured()) return memoryRecords.get(id) ?? null;
  return parseRecord(await redisCommand<string | null>(['GET', recordKey(id)]));
}

async function writeRecord(record: LandingReminderRecord): Promise<void> {
  if (!isPersistentReminderStoreConfigured()) {
    memoryRecords.set(record.id, record);
    return;
  }
  await redisCommand(['SET', recordKey(record.id), JSON.stringify(record)]);
  await redisCommand(['SADD', INDEX_KEY, record.id]);
}

export async function upsertLandingReminder(
  input: SubscribeLandingReminderInput
): Promise<LandingReminderRecord> {
  const id = reminderId(input.passengerId, input.subscription.endpoint);
  const now = new Date().toISOString();
  const existing = await readRecord(id);
  const record: LandingReminderRecord = {
    id,
    passengerId: input.passengerId,
    passengerName: input.passengerName,
    groupId: input.groupId,
    flightId: input.flightId,
    takeoffTime: input.takeoffTime,
    endpoint: input.subscription.endpoint,
    subscription: input.subscription,
    enabled: true,
    lastReminderAt: existing?.flightId === input.flightId ? existing.lastReminderAt : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeRecord(record);
  return record;
}

export async function listLandingReminders(): Promise<LandingReminderRecord[]> {
  if (!isPersistentReminderStoreConfigured()) return Array.from(memoryRecords.values());
  const ids = await redisCommand<string[]>(['SMEMBERS', INDEX_KEY]);
  const records = await Promise.all((ids || []).map((id) => readRecord(id)));
  return records.filter((record): record is LandingReminderRecord => !!record);
}

export async function removeLandingReminder(id: string): Promise<void> {
  if (!isPersistentReminderStoreConfigured()) {
    memoryRecords.delete(id);
    return;
  }
  await redisCommand(['DEL', recordKey(id)]);
  await redisCommand(['SREM', INDEX_KEY, id]);
}

export async function removeLandingReminderByEndpoint(
  passengerId: string,
  endpoint: string
): Promise<boolean> {
  const id = reminderId(passengerId, endpoint);
  const existing = await readRecord(id);
  if (!existing) return false;
  await removeLandingReminder(id);
  return true;
}

export async function removeLandingRemindersForFlight(
  passengerId: string,
  flightId: string
): Promise<number> {
  const records = await listLandingReminders();
  const matches = records.filter((record) =>
    record.passengerId === passengerId && record.flightId === flightId
  );
  await Promise.all(matches.map((record) => removeLandingReminder(record.id)));
  return matches.length;
}

export async function markLandingReminderSent(id: string, sentAt = new Date()): Promise<void> {
  const record = await readRecord(id);
  if (!record) return;
  await writeRecord({
    ...record,
    lastReminderAt: sentAt.toISOString(),
    updatedAt: sentAt.toISOString(),
  });
}
