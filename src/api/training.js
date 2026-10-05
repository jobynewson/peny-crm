// src/api/training.js
// Client for /api/training — the signed-in person's own Training profile and
// completed sessions. The server filters everything by the verified session.

import { request } from './http.js'

export const fetchTraining = () => request('/api/training')
export const saveTrainingProfile = profile => request('/api/training/profile', { method: 'PUT', body: profile })
export const saveTrainingSession = session => request('/api/training/sessions', { method: 'POST', body: session })
export const deleteTrainingProgram = (sport, week, key) =>
  request(`/api/training/sessions/${sport}/${week}/${key}`, { method: 'DELETE' })
