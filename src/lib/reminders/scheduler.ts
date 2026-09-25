import { getAllActiveFlights } from '../notion/flights';
import {
  listLandingReminders,
  markLandingReminderSent,
  removeLandingReminder,
} from './store';
import { isGonePushError, isWebPushConfigured, sendLandingReminderPush } from './push';
import type { Flight } from '../../types';
import type { ReminderCronResult } from './types';

function flightKey(flight: Flight): string {
  return `${flight.passengerId}:${flight.flightId}`;
}

function isReminderDue(lastReminderAt: string | null): boolean {
  return !lastReminderAt;
}

export async function runLandingReminderCron(now = new Date()): Promise<ReminderCronResult> {
  const result: ReminderCronResult = {
    checked: 0,
    due: 0,
    sent: 0,
    removed: 0,
    skipped: 0,
    errors: [],
  };

  const records = await listLandingReminders();
  result.checked = records.length;
  if (!isWebPushConfigured()) {
    result.skipped = records.length;
    result.errors.push({ id: 'config', error: 'Web Push VAPID keys are not configured.' });
    return result;
  }

  const activeFlights = await getAllActiveFlights();
  const activeByKey = new Map(activeFlights.map((flight) => [flightKey(flight), flight]));

  for (const record of records) {
    const activeFlight = activeByKey.get(`${record.passengerId}:${record.flightId}`);
    if (!record.enabled || !activeFlight) {
      await removeLandingReminder(record.id);
      result.removed += 1;
      continue;
    }
    if (!isReminderDue(record.lastReminderAt)) {
      result.skipped += 1;
      continue;
    }

    result.due += 1;
    try {
      await sendLandingReminderPush(record);
      await markLandingReminderSent(record.id, now);
      result.sent += 1;
    } catch (err) {
      if (isGonePushError(err)) {
        await removeLandingReminder(record.id);
        result.removed += 1;
        continue;
      }
      result.errors.push({
        id: record.id,
        error: err instanceof Error ? err.message : '未知錯誤',
      });
    }
  }

  return result;
}
