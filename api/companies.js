// api/companies.js
// GET  /api/companies — every company (the company field's suggestions)
// POST /api/companies — { name } → match (ignoring case) or create
//
// Slate staff only: dispatch() requires an app_users row, and creating needs a
// non-viewer. Routes live in _companies.js.

import { neon } from '@neondatabase/serverless'
import { dispatch } from './_api.js'
import { ROUTES } from './_companies.js'

export default function handler(req, res) {
  return dispatch(req, res, { name: 'companies', routes: ROUTES, sql: neon(process.env.VITE_DATABASE_URL) })
}
