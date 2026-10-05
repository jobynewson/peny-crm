// api/training.js
// Personal Tools › Training — each person's sport, kit and completed sessions.
//   GET    /api/training
//   PUT    /api/training/profile
//   POST   /api/training/sessions
//   DELETE /api/training/sessions/:sport/:week/:key
//
// Slate staff only (dispatch() requires an app_users row), and every query is
// filtered by the caller's own Clerk id. vercel.json rewrites /api/training/*
// here with ?route=. Routes live in _training.js.

import { neon } from '@neondatabase/serverless'
import { dispatch } from './_api.js'
import { ROUTES } from './_training.js'

export default function handler(req, res) {
  return dispatch(req, res, { name: 'training', routes: ROUTES, sql: neon(process.env.DATABASE_URL) })
}
