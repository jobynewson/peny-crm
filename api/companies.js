// api/companies.js
// GET  /api/companies — every company (the company field's suggestions)
// POST /api/companies — { name } → match (ignoring case) or create
// /api/companies/:id/portal… — the company's client portal access
//   (superadmin; _portal-access.js)
//
// Slate staff only: dispatch() requires an app_users row, and creating needs a
// non-viewer. vercel.json rewrites /api/companies/* here with ?route=. Routes
// live in _companies.js.

import { neon } from '@neondatabase/serverless'
import { dispatch } from './_api.js'
import { ROUTES } from './_companies.js'

export default function handler(req, res) {
  return dispatch(req, res, { name: 'companies', routes: ROUTES, sql: neon(process.env.DATABASE_URL) })
}
