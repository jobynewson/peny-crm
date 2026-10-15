// api/push.js
// GET    /api/push/status       — is push set up, and which of your devices are on
// POST   /api/push/subscribe    — { endpoint, keys } switch this device on
// POST   /api/push/unsubscribe  — { endpoint } switch this device off
// DELETE /api/push/devices/:id  — remove one of your devices
// POST   /api/push/test         — send yourself a test notification
//
// Slate staff only (dispatch() requires an app_users row). vercel.json
// rewrites /api/push/* here with ?route=. Routes live in _push-routes.js.

import { neon } from '@neondatabase/serverless'
import { dispatch } from './_api.js'
import { ROUTES } from './_push-routes.js'

export default function handler(req, res) {
  return dispatch(req, res, { name: 'push', routes: ROUTES, sql: neon(process.env.DATABASE_URL) })
}
