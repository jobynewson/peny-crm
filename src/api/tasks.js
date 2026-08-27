// src/api/tasks.js
// Client for the task board API.
//
// Unlike the rest of the app — which queries Neon straight from the browser via
// src/db/client.js — tasks go through /api. The server owns acknowledgement,
// event writing and notification fan-out, so those rules live in one place
// instead of being re-implemented per view.

import { getAuthToken } from '../auth/clerk.js'

async function request(path, { method = 'GET', body } = {}) {
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
    // The API always answers { error: { code, message, field? } }; anything else
    // means something upstream failed, so fall back to the status.
    const err = new Error(data?.error?.message || `Request failed (${res.status})`)
    err.code   = data?.error?.code
    err.field  = data?.error?.field
    err.status = res.status
    throw err
  }
  return data
}

const qs = (params) => {
  const clean = Object.entries(params || {}).filter(([, v]) => v != null && v !== '')
  return clean.length ? '?' + new URLSearchParams(clean) : ''
}

export const listTasks       = (params)   => request(`/api/tasks${qs(params)}`)
export const getTask         = (id)       => request(`/api/tasks/${id}`)
export const createTask      = (body)     => request('/api/tasks', { method: 'POST', body })
export const patchTask       = (id, body) => request(`/api/tasks/${id}`, { method: 'PATCH', body })
export const acknowledgeTask = (id)       => request(`/api/tasks/${id}/acknowledge`, { method: 'POST' })
export const addComment      = (id, body) => request(`/api/tasks/${id}/comments`, { method: 'POST', body: { body } })

export const listNotifications = (unreadOnly) => request(`/api/notifications${unreadOnly ? '?unread=true' : ''}`)
export const markRead = (payload) => request('/api/notifications/read', { method: 'POST', body: payload })
