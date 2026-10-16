// src/api/board-shares.js
// Client for /api/board-shares: which client companies see a board or canvas
// in their portal (view only). kind is 'board' (kanban) or 'canvas' (a root canvas).

import { request } from './http.js'

// → [{ id, name }]
export const getBoardShares = (kind, id) => request(`/api/board-shares/${kind}/${id}`).then(r => r.companies)
// Replaces the whole set. → [{ id, name }]
export const setBoardShares = (kind, id, companyIds) =>
  request(`/api/board-shares/${kind}/${id}`, { method: 'PUT', body: { company_ids: companyIds } }).then(r => r.companies)
