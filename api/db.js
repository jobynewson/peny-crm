// api/db.js
// POST /api/db — the browser's database connection. src/db/client.js sends
// every query here instead of to Neon, in Neon's own HTTP format. This checks
// the caller is a Slate user (an app_users row: a client's session or a
// stranger's gets nothing) and forwards the query with the connection string
// only the server has, so the credential never reaches the browser.
//
// It does not look at the SQL. A Slate user can run any query, as they always
// could — the app builds its queries in the browser. The boundary is who, not
// what, and new data still gets its own /api routes (claude.md › Database
// access).
//
// Request:  { query, params } or { queries: [{ query, params }, …] } (one
//           transaction), as the driver sends them, with Neon's batch headers.
// Response: Neon's answer as it is, status included, streamed back, so the
//           driver in the browser reads it as if it had asked Neon itself.

import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { neon, neonConfig } from '@neondatabase/serverless'
import { verifyClerkUser } from './_auth.js'
import { fail, readBody } from './_api.js'

// A transaction's options, passed on when they're values Neon knows.
const BATCH_HEADERS = {
  'neon-batch-isolation-level': v => ['ReadUncommitted', 'ReadCommitted', 'RepeatableRead', 'Serializable'].includes(v),
  'neon-batch-read-only': v => v === 'true' || v === 'false',
  'neon-batch-deferrable': v => v === 'true' || v === 'false',
}

// The Training tables are personal: only /api/training touches them, filtered
// by the verified user. Anything else naming them is refused here, except the
// idempotent CREATE TABLE / INDEX IF NOT EXISTS (for these tables only) that
// runMigrations() sends.
// A guard in the application, not a database boundary: a separate database
// role would be needed to hold against a determined staff member (see
// claude.md › Database access).
const PERSONAL_TABLES = /training_(profiles|sessions)/i
const MIGRATION_DDL = [
  /^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+training_(profiles|sessions)\s*\(/i,
  /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON\s+training_(profiles|sessions)\s*\(/i,
]
export function touchesPersonalTables(query) {
  if (!PERSONAL_TABLES.test(query)) return false
  const inner = query.trim().replace(/;$/, '')
  const isDdl = MIGRATION_DDL.some(re => re.test(inner)) && !inner.includes(';') && !/\bSELECT\b/i.test(inner)
  return !isDdl
}

const isQuery = q => !!q && typeof q.query === 'string' && (q.params === undefined || Array.isArray(q.params))
const oneQuery = q => ({ query: q.query, params: q.params ?? [] })

// Only what the driver sends, rebuilt: a query, or a non-empty list of them.
// null for anything else.
export function queryBody(body) {
  if (Array.isArray(body?.queries)) {
    return body.queries.length && body.queries.every(isQuery) ? { queries: body.queries.map(oneQuery) } : null
  }
  return isQuery(body) ? oneQuery(body) : null
}

// Where the driver itself would send a query for this connection string.
function neonEndpoint(connectionString) {
  const { hostname, port } = new URL(connectionString)
  const endpoint = neonConfig.fetchEndpoint
  return typeof endpoint === 'function' ? endpoint(hostname, port) : endpoint
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return fail(res, 405, 'method_not_allowed', `${req.method} is not allowed on this route`)
  }

  const url = process.env.DATABASE_URL
  const { error } = await verifyClerkUser(req, neon(url), { remember: true })
  if (error) return fail(res, error.status, error.code, error.message)

  const body = queryBody(readBody(req))
  if (!body) return fail(res, 422, 'bad_query', 'Expected { query, params } or { queries: [...] }')
  if ((body.queries ?? [body]).some(q => touchesPersonalTables(q.query))) {
    return fail(res, 403, 'personal_data', 'That data is only available through its own API')
  }

  // Always the server's own connection string: the browser's placeholder
  // header is never read.
  const headers = {
    'Content-Type': 'application/json',
    'Neon-Connection-String': url,
    'Neon-Raw-Text-Output': 'true',
    'Neon-Array-Mode': 'true',
  }
  if (body.queries) {
    for (const [name, valid] of Object.entries(BATCH_HEADERS)) {
      const value = req.headers?.[name]
      if (typeof value === 'string' && valid(value)) headers[name] = value
    }
  }

  let upstream
  try {
    upstream = await (neonConfig.fetchFunction ?? fetch)(neonEndpoint(url), {
      method: 'POST', headers, body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[db] database unreachable:', err.message)
    return fail(res, 502, 'database_unreachable', 'Couldn’t reach the database')
  }

  res.status(upstream.status)
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
  if (!upstream.body) return res.end()
  try {
    await pipeline(Readable.fromWeb(upstream.body), res)
  } catch (err) {
    console.error('[db] answer cut off:', err.message)
    res.destroy?.(err)
  }
}
