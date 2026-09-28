// src/api/http.js
// The one way the browser calls Slate's own JSON APIs (/api/tasks,
// /api/companies, …): same-origin, with the Clerk session as a Bearer token.
// Errors come back as { error: { code, message, field? } } (see api/_api.js)
// and are thrown as an Error carrying code, field and status.

import { getAuthToken } from '../auth/clerk.js'

export async function request(path, { method = 'GET', body } = {}) {
  const token = await getAuthToken()
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* non-JSON body */ }

  if (!res.ok) {
    // Anything but our error shape means something upstream failed, so fall
    // back to the status.
    const err = new Error(data?.error?.message || `Request failed (${res.status})`)
    err.code   = data?.error?.code
    err.field  = data?.error?.field
    err.status = res.status
    throw err
  }
  return data
}

export const qs = (params) => {
  const clean = Object.entries(params || {}).filter(([, v]) => v != null && v !== '')
  return clean.length ? '?' + new URLSearchParams(clean) : ''
}
