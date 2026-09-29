// src/api/companies.js
// Client for /api/companies. Companies are new data, so they only ever travel
// through the server — never through src/db/client.js.

import { request } from './http.js'

export const listCompanies = () => request('/api/companies').then(r => r.companies)

// Whatever is typed resolves to exactly one company: an existing one with the
// same name (ignoring case and spacing) or a new one. Resolves to the company.
export const findOrCreateCompany = (name) =>
  request('/api/companies', { method: 'POST', body: { name } }).then(r => r.company)

// Who leads a company: hears about its work when a deliverable has no owner.
// Resolves to the company.
export const setCompanyLead = (id, leadId) =>
  request(`/api/companies/${id}`, { method: 'PATCH', body: { lead_id: leadId } }).then(r => r.company)

// A company's client portal access (superadmin; api/_portal-access.js).
// → { portal: null | { members, invitations }, invites_enabled }
const portal = id => `/api/companies/${id}/portal`
export const getPortalAccess = companyId => request(portal(companyId))
export const setUpPortal = companyId => request(portal(companyId), { method: 'POST' })
export const inviteToPortal = (companyId, email) =>
  request(`${portal(companyId)}/invitations`, { method: 'POST', body: { email } }).then(r => r.invitation)
export const revokePortalInvitation = (companyId, invitationId) =>
  request(`${portal(companyId)}/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' })
export const removePortalMember = (companyId, userId) =>
  request(`${portal(companyId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' })
