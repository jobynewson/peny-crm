// src/db/api.js
// Browser side of POST /api/db (api/db.js). Helpers in client.js that have
// moved to the server call through here under their old names, so views don't
// change. The server works out the caller, their role and the workspace from
// the Clerk session; nothing sent from here can widen that.
import { getAuthToken } from '../auth/clerk.js'

export async function callDb(op, ...args) {
  const token = await getAuthToken()
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, args }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Database request failed (${res.status})`)
  return body.result
}
