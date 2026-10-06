// src/api/pdf-documents.js
// Client for /api/pdf-documents — the team's shared library of saved one-pagers.

import { request } from './http.js'

export const listPdfDocuments = () => request('/api/pdf-documents')
export const getPdfDocument = id => request(`/api/pdf-documents/${id}`)
export const createPdfDocument = doc => request('/api/pdf-documents', { method: 'POST', body: doc })
export const updatePdfDocument = (id, doc) => request(`/api/pdf-documents/${id}`, { method: 'PUT', body: doc })
export const deletePdfDocument = id => request(`/api/pdf-documents/${id}`, { method: 'DELETE' })
