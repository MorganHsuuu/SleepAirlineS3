'use strict';

const LANDING_REMINDER_TAG = 'sleep-airline-landing-reminder';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  event.waitUntil(self.registration.showNotification(payload.title || '甦醒航班提醒', {
    body: payload.body || '醒來後記得回到 Sleep Airline 按下「降落」。',
    tag: payload.tag || LANDING_REMINDER_TAG,
    renotify: false,
    requireInteraction: true,
    icon: '/media/icon-192.png',
    badge: '/media/icon-192.png',
    data: { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    return undefined;
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'SHOW_LANDING_REMINDER') return;
  event.waitUntil(self.registration.showNotification(data.title || '甦醒航班提醒', {
    body: data.body || '醒來後記得回到 Sleep Airline 按下「降落」。',
    tag: data.tag || LANDING_REMINDER_TAG,
    renotify: false,
    requireInteraction: true,
    icon: '/media/icon-192.png',
    badge: '/media/icon-192.png',
    data: { url: data.url || '/' },
  }));
});
