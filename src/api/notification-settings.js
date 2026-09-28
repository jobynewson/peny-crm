// src/api/notification-settings.js
// Client for /api/notification-settings — the signed-in person's own email
// settings (the kinds live in api/_notify.js).

import { request } from './http.js'

export const getNotificationSettings = () =>
  request('/api/notification-settings').then(r => r.settings)

export const setNotificationSetting = (kind, email) =>
  request('/api/notification-settings', { method: 'PUT', body: { kind, email } }).then(r => r.settings)
