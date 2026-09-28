// src/api/tasks.js
// Client for the task board API.
//
// Unlike most of the app — which queries Neon straight from the browser via
// src/db/client.js — tasks go through /api. The server owns acknowledgement,
// event writing and notification fan-out, so those rules live in one place
// instead of being re-implemented per view.

import { request, qs } from './http.js'

export const listTasks       = (params)   => request(`/api/tasks${qs(params)}`)
export const getTask         = (id)       => request(`/api/tasks/${id}`)
export const createTask      = (body)     => request('/api/tasks', { method: 'POST', body })
export const patchTask       = (id, body) => request(`/api/tasks/${id}`, { method: 'PATCH', body })
export const deleteTask      = (id)       => request(`/api/tasks/${id}`, { method: 'DELETE' })
export const acknowledgeTask = (id)       => request(`/api/tasks/${id}/acknowledge`, { method: 'POST' })
export const addComment      = (id, body) => request(`/api/tasks/${id}/comments`, { method: 'POST', body: { body } })

export const listNotifications = (unreadOnly) => request(`/api/notifications${unreadOnly ? '?unread=true' : ''}`)
export const markRead = (payload) => request('/api/notifications/read', { method: 'POST', body: payload })
