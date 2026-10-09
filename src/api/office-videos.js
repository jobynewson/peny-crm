// src/api/office-videos.js
// Client for /api/office-videos: the signed-in person's own YouTube links for
// the office screen. The server filters everything by the verified session.

import { request } from './http.js'

export const fetchOfficeVideos = () => request('/api/office-videos')
export const addOfficeVideo = url => request('/api/office-videos', { method: 'POST', body: { url } })
export const deleteOfficeVideo = id => request(`/api/office-videos/${id}`, { method: 'DELETE' })
