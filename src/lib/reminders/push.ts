import webpush, { WebPushError } from 'web-push';

import type { LandingReminderRecord, PushSubscriptionPayload } from './types';

let configured = false;

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export function isWebPushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureWebPush() {
  if (configured || !isWebPushConfigured()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:sleep-airline@example.com',
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string
  );
  configured = true;
}

export function isGonePushError(err: unknown): boolean {
  return err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410);
}

export async function sendLandingReminderPush(record: LandingReminderRecord): Promise<void> {
  configureWebPush();
  if (!isWebPushConfigured()) throw new Error('Web Push VAPID keys are not configured.');

  const payload = JSON.stringify({
    title: '甦醒航班提醒',
    body: '醒來後記得回到 Sleep Airline 按下「降落」。',
    url: '/',
    tag: 'sleep-airline-landing-reminder',
  });

  await webpush.sendNotification(
    record.subscription as PushSubscriptionPayload,
    payload,
    { TTL: 60 * 60 * 24 }
  );
}
