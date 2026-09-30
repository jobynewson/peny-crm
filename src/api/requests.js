// src/api/requests.js
// Client for triage (/api/retainers/requests, api/_requests.js): the inbox of
// client requests, and accepting or declining one. Worklist data only ever
// travels through the server, never through src/db/client.js.

import { request } from './http.js'

const base = '/api/retainers/requests'

// → { today, status, requests: [{ id, company_id, company, title, detail, wanted_by,
//     wanted_by_display, status, status_label, sent_by, sent_at, decided_at,
//     decided_by, decline_note, deliverable_id }], counts: { new, accepted, declined } }
// → { new } — the number on the header's Requests tab.
export const getRequestCount = () => request('/api/retainers/request-count').then(r => r.new)
export const listRequests = (status = 'new') => request(`${base}?status=${encodeURIComponent(status)}`)
// → { today, request: { …, project_id, project, source, source_label, lead_id },
//     projects: [{ id, name, is_retainer, workstreams: [{ id, title }] }], workstreams: [{ id, title }] }
export const getRequest = id => request(`${base}/${id}`)
// body: { project_id?, workstream_id | new_workstream_title, owner_id, due_date, title? }
// → { request_id, deliverable_id, workstream_id, company_id, project_id }
export const acceptRequest = (id, body) => request(`${base}/${id}/accept`, { method: 'POST', body })
export const declineRequest = (id, note) => request(`${base}/${id}/decline`, { method: 'POST', body: { note } })
