// api/retainers.js
// The Peny side of a project's worklist:
//   GET    /api/retainers/projects/:id                     a project's whole worklist (the Worklist tab)
//   GET    /api/retainers/project-counts                   open / overdue / waiting per project
//   POST   /api/retainers/projects/:id/attach              bring a company's older workstreams into it
//   POST   /api/retainers/projects/:id/link                { action: create | replace | off } the client link
//   PUT    /api/retainers/projects/:id/portal-emails       extra addresses for the delivery email
//   GET    /api/retainers/request-count                    new requests, for the header tab
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
