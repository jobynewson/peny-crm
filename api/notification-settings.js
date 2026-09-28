// api/notification-settings.js
// GET /api/notification-settings — your email settings
// PUT /api/notification-settings — { kind, email } changes one of yours
//
// Slate staff only (dispatch() requires an app_users row). Routes live in
// _notification-settings.js; the kinds in _notify.js.

import { neon } from '@neondatabase/serverless'
import { dispatch } from './_api.js'
import { ROUTES } from './_notification-settings.js'

export default function handler(req, res) {
  return dispatch(req, res, { name: 'notification-settings', routes: ROUTES, sql: neon(process.env.VITE_DATABASE_URL) })
}
