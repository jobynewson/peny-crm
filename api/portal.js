// api/portal.js
// One Vercel function carrying several routes, a pattern left over from the
// Hobby plan's function cap (see claude.md):
//   ?view=tasks     → the task board API (_tasks.js, its own Clerk auth)
//   ?view=offloads  → the Offload Log ingest (_offloads.js, its own key)
//   ?view=dashboard → the public office screen (_dashboard.js, a fixed token)
// Project portal links are no longer served here — see /api/client.

import { neon } from '@neondatabase/serverless'
import { isRateLimited, getClientIp } from './_ratelimit.js'
import { handleDashboard } from './_dashboard.js'
import { handleOffloadIngest } from './_offloads.js'
import { handleTasks } from './_tasks.js'

export default async function handler(req, res) {
  // The task board API shares this function for the same reason as the two
  // handlers below — we are at Vercel's 12-function cap (see claude.md). Every
  // /api/tasks/* and /api/notifications/* request is rewritten here as
  // ?view=tasks; _tasks.js does its own Clerk auth, method and path handling, so
  // dispatch before the public-portal CORS/GET guard below.
  if (req.query.view === 'tasks') {
    return handleTasks(req, res, neon(process.env.VITE_DATABASE_URL))
  }

  // The Offload Log ingest (POST /api/offloads → rewritten here as
  // ?view=offloads) shares this function to stay within Vercel's 12-function
  // limit — see claude.md. It has its own auth and method handling, so dispatch
  // before the GET-only portal guard below.
  if (req.query.view === 'offloads') {
    return handleOffloadIngest(req, res, neon(process.env.VITE_DATABASE_URL))
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (isRateLimited(getClientIp(req))) {
    return res.status(429).json({ error: 'Too many requests' })
  }

  const sql = neon(process.env.VITE_DATABASE_URL)

  // The public office dashboard shares this function (rather than its own file)
  // to stay within Vercel's 12-function limit — see claude.md.
  if (req.query.view === 'dashboard') return handleDashboard(req, res, sql)

  // The old project portal (GET /api/portal?token=) lived here. Portal links
  // are now served by the client portal API (/api/client, scoped in
  // _client.js); nothing else is answered here.
  return res.status(404).json({ error: 'Not found' })
}
