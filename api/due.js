// api/due.js
// GET /api/due?days=14&owner=me — what's due across Slate (see _due-feed.js):
// overdue work plus the next `days` days (0–90, default 14), everyone's or just
// the caller's. "me" is resolved from the session, never from the request.
//
// Slate staff only (dispatch() requires an app_users row).

import { neon } from '@neondatabase/serverless'
import { dispatch, workspaceId } from './_api.js'
import { dueFeed } from './_due-feed.js'

export const ROUTES = [
  { method: 'GET', pattern: /^due$/, handler: listDue },
]

async function listDue(req, res, { sql, user }) {
  const asked = Number.parseInt(req.query?.days, 10)
  const days = Number.isInteger(asked) ? Math.min(Math.max(asked, 0), 90) : 14
  const ownerId = req.query?.owner === 'me' ? user.id : null
  const feed = await dueFeed(sql, { ws: await workspaceId(sql), days, ownerId })
  return res.status(200).json(feed)
}

export default function handler(req, res) {
  return dispatch(req, res, { name: 'due', routes: ROUTES, sql: neon(process.env.VITE_DATABASE_URL) })
}
