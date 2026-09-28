// api/client.js
// The client portal's API (routes and scoping in _client.js):
//   GET  /api/client/view                     what this visitor may see
//   POST /api/client/deliveries/:id/response  approve or request changes
//
// Not a Slate-staff endpoint: portal visitors are Clerk users in a company's
// organisation, or holders of a project's portal link. Every query is scoped
// by resolveScope() in _client.js. vercel.json rewrites /api/client/* here
// with ?route=.

import { neon } from '@neondatabase/serverless'
import { dispatchClient } from './_client.js'

export default function handler(req, res) {
  return dispatchClient(req, res, { sql: neon(process.env.VITE_DATABASE_URL) })
}
