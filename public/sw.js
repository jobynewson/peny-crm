// Slate's service worker. It does one job: show a push notification when the
// server sends one (api/_push.js), and open the right page when it is tapped.
// No caching, no offline mode: the app loads from the network as before.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  // Every push must show something (iPhones revoke permission from sites that
  // receive a push and stay silent), so a malformed one still shows.
  event.waitUntil(self.registration.showNotification(data.title || 'Slate', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const app = open.find(c => new URL(c.url).origin === self.location.origin)
    if (app) {
      try {
        // Slate is already open: bring it forward and tell it where to go. (A
        // navigate() would do nothing when only the #part of the address
        // changes, and the app opens the item itself.)
        const focused = (await app.focus()) || app
        focused.postMessage({ type: 'open', url: target })
        return
      } catch { /* fall through to opening a new window */ }
    }
    // Not open: a fresh load of the address opens the item (app.js _openFromAddress).
    await self.clients.openWindow(target)
  })())
})
