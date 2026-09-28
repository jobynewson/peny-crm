// src/api/retainers.js
// Client for /api/retainers — the retainer worklist (api/_retainers.js).
// Worklist data only ever travels through the server, never through
// src/db/client.js.

import { request } from './http.js'

const base = '/api/retainers'
const post = (path, body) => request(`${base}/${path}`, { method: 'POST', body })
const patch = (path, body) => request(`${base}/${path}`, { method: 'PATCH', body })
const del = path => request(`${base}/${path}`, { method: 'DELETE' })

// { today, companies: [{ id, name, portal, open, waiting, in_review, overdue, next_due, workstreams, retainer_projects }] }
export const listRetainerCompanies = () => request(`${base}/companies`)
// { today, company, workstreams: [{ …, deliverables: [{ …, deliveries }] }], projects }
export const getCompanyPage = id => request(`${base}/companies/${id}`)

export const createWorkstream = body => post('workstreams', body).then(r => r.workstream)
export const updateWorkstream = (id, body) => patch(`workstreams/${id}`, body).then(r => r.workstream)
export const deleteWorkstream = id => del(`workstreams/${id}`)

export const createDeliverable = body => post('deliverables', body).then(r => r.deliverable)
export const updateDeliverable = (id, body) => patch(`deliverables/${id}`, body).then(r => r.deliverable)
export const deleteDeliverable = id => del(`deliverables/${id}`)

// → { delivery: { id, round }, deliverable }
export const sendDelivery = (deliverableId, body) => post(`deliverables/${deliverableId}/deliveries`, body)
export const unsendDelivery = id => del(`deliveries/${id}`).then(r => r.deliverable)
// → { preview: { title, image } | null, reason? }
export const fillPreview = id => post(`deliveries/${id}/preview`)
export const recordResponse = (id, body) => post(`deliveries/${id}/response`, body).then(r => r.deliverable)
