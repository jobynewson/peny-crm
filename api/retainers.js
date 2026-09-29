// api/retainers.js
// The Peny side of the retainer worklist:
//   GET    /api/retainers/companies                        companies with a worklist or a retainer project
//   GET    /api/retainers/companies/:id                    the whole company page
//   POST   /api/retainers/workstreams                      PATCH | DELETE /api/retainers/workstreams/:id
//   POST   /api/retainers/deliverables                     PATCH | DELETE /api/retainers/deliverables/:id
//   POST   /api/retainers/deliverables/:id/deliveries      { url, note } → next round, in review
//   DELETE /api/retainers/deliveries/:id                   take back an unanswered latest round
//   POST   /api/retainers/deliveries/:id/preview           fill the link preview after sending
//   POST   /api/retainers/deliveries/:id/response          record the client's answer
//
// Slate staff only (dispatch() requires an app_users row); writes need a
// non-viewer. vercel.json rewrites /api/retainers/* here with ?route=.
// Routes live in _retainers.js.

import { neon } from '@neondatabase/serverless'
import { dispatch } from './_api.js'
import { ROUTES } from './_retainers.js'

export default function handler(req, res) {
  return dispatch(req, res, { name: 'retainers', routes: ROUTES, sql: neon(process.env.DATABASE_URL) })
}
