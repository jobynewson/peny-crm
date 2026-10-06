// api/pdf-documents.js
// Tools › PDF Generator — the team's shared library of saved one-pagers.
//   GET    /api/pdf-documents
//   GET    /api/pdf-documents/:id
//   POST   /api/pdf-documents
//   PUT    /api/pdf-documents/:id
//   DELETE /api/pdf-documents/:id
//
// Slate staff only (dispatch() requires an app_users row); viewers can read but
// not change. vercel.json rewrites /api/pdf-documents/* here with ?route=.
// Routes live in _pdf-documents.js.

import { neon } from '@neondatabase/serverless'
import { dispatch } from './_api.js'
import { ROUTES } from './_pdf-documents.js'

export default function handler(req, res) {
  return dispatch(req, res, { name: 'pdf-documents', routes: ROUTES, sql: neon(process.env.DATABASE_URL) })
}
