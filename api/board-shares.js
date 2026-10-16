// api/board-shares.js
// Which client companies see a Planning board or canvas in their portal.
//   GET /api/board-shares/:kind/:id
//   PUT /api/board-shares/:kind/:id   { company_ids }
//
// Slate staff only (dispatch() requires an app_users row; changing needs a
// non-viewer). vercel.json rewrites /api/board-shares/* here with ?route=.
// Routes live in _board-shares.js.

import { neon } from '@neondatabase/serverless'
import { dispatch } from './_api.js'
import { ROUTES } from './_board-shares.js'

export default function handler(req, res) {
  return dispatch(req, res, { name: 'board-shares', routes: ROUTES, sql: neon(process.env.DATABASE_URL) })
}
