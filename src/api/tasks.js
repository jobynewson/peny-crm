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

// Deliverables on the board (api/_board.js): cards read from the deliverables
// table, one record shown here and on the Retainers page. The server decides
// which columns they sit in and what a drag may do.
export const listBoardCards = days => request(`/api/retainers/board${days ? `?days=${days}` : ''}`).then(r => r.cards)
// → { card }, or a 409 with code 'board_refused' whose message is the sentence to show.
export const moveBoardCard = (id, column) => request(`/api/retainers/deliverables/${id}/board-move`, { method: 'POST', body: { column } })
