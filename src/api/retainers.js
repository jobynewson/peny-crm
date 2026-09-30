// src/api/retainers.js
// Client for /api/retainers — the retainer worklist (api/_retainers.js).
// Worklist data only ever travels through the server, never through
// src/db/client.js.

import { request } from './http.js'

const base = '/api/retainers'
const post = (path, body) => request(`${base}/${path}`, { method: 'POST', body })
const patch = (path, body) => request(`${base}/${path}`, { method: 'PATCH', body })
const del = path => request(`${base}/${path}`, { method: 'DELETE' })

// A project's worklist — { today, vocab, project, company | null, workstreams: [{ …, deliverables: [{ …, deliveries }] }],
// unattached: [{ id, title }] } — and the open counts the tab and dashboard show.
export const getProjectPage = id => request(`${base}/projects/${id}`)
export const getProjectCounts = () => request(`${base}/project-counts`).then(r => r.counts)
// Brings the project's company's older project-less workstreams into it. → { attached }
export const attachWorkstreams = id => post(`projects/${id}/attach`, {})

// The project's client link: action 'create' | 'replace' | 'off'. → { has_link, token }
export const setProjectLink = (id, action) => post(`projects/${id}/link`, { action })

// Replaces the extra addresses that get the delivery email. → the cleaned list
export const setPortalEmails = (id, emails) => request(`${base}/projects/${id}/portal-emails`, { method: 'PUT', body: { portal_emails: emails } }).then(r => r.portal_emails)

export const createWorkstream = body => post('workstreams', body).then(r => r.workstream)
export const updateWorkstream = (id, body) => patch(`workstreams/${id}`, body).then(r => r.workstream)
export const deleteWorkstream = id => del(`workstreams/${id}`)

export const createDeliverable = body => post('deliverables', body).then(r => r.deliverable)
export const updateDeliverable = (id, body) => patch(`deliverables/${id}`, body).then(r => r.deliverable)
export const deleteDeliverable = id => del(`deliverables/${id}`)

// → { delivery: { id, round }, deliverable, notified: { sent, reason?, message } } — the client is
// emailed as part of sending; `message` says who, or why no one.
export const sendDelivery = (deliverableId, body) => post(`deliverables/${deliverableId}/deliveries`, body)
export const unsendDelivery = id => del(`deliveries/${id}`).then(r => r.deliverable)
// → { preview: { title, image } | null, reason? }
export const fillPreview = id => post(`deliveries/${id}/preview`)
export const recordResponse = (id, body) => post(`deliveries/${id}/response`, body).then(r => r.deliverable)
