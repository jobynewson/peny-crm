// src/api/notification-settings.js
// Client for /api/notification-settings — the signed-in person's own email
// settings (the kinds live in api/_notify.js).

import { request } from './http.js'

export const getNotificationSettings = () =>
  request('/api/notification-settings').then(r => r.settings)

// `change` is { email } and/or { push }; whatever is left out stays as it was.
export const setNotificationSetting = (kind, change) =>
  request('/api/notification-settings', { method: 'PUT', body: { kind, ...change } }).then(r => r.settings)
