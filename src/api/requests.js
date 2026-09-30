// src/api/requests.js
// Client requests on the task board (api/_requests.js, api/_board.js): the new
// ones arrive with the board's cards (src/api/tasks.js listBoard); here are the
// count for the Tasks tab, and accepting or declining one. Worklist data only
// ever travels through the server, never through src/db/client.js.

import { request } from './http.js'

const base = '/api/retainers/requests'

// → { new } — the number on the header's Tasks tab.
export const getRequestCount = () => request('/api/retainers/request-count').then(r => r.new)
// body (all optional): { due_date, project_id, workstream_id | new_workstream_title, owner_id, title }
// → { request_id, deliverable_id, workstream_id, company_id, project_id, link }.
// 409 needs_project carries `projects: [{ id, name }]` when it can't tell which.
export const acceptRequest = (id, body = {}) => request(`${base}/${id}/accept`, { method: 'POST', body })
export const declineRequest = (id, note) => request(`${base}/${id}/decline`, { method: 'POST', body: { note } })
