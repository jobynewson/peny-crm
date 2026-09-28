// src/api/companies.js
// Client for /api/companies. Companies are new data, so they only ever travel
// through the server — never through src/db/client.js.

import { request } from './http.js'

export const listCompanies = () => request('/api/companies').then(r => r.companies)

// Whatever is typed resolves to exactly one company: an existing one with the
// same name (ignoring case and spacing) or a new one. Resolves to the company.
export const findOrCreateCompany = (name) =>
  request('/api/companies', { method: 'POST', body: { name } }).then(r => r.company)
