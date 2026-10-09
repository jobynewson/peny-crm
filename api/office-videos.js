// api/office-videos.js
// Personal Tools › Office screen videos: each person's own YouTube links.
//   GET    /api/office-videos
//   POST   /api/office-videos
//   DELETE /api/office-videos/:id
//
// Slate staff only (dispatch() requires an app_users row), and every query is
// filtered by the caller's own Clerk id. vercel.json rewrites /api/office-videos/*
// here with ?route=. Routes live in _office-videos.js.

import { neon } from '@neondatabase/serverless'
import { dispatch } from './_api.js'
import { ROUTES } from './_office-videos.js'

export default function handler(req, res) {
  return dispatch(req, res, { name: 'office-videos', routes: ROUTES, sql: neon(process.env.DATABASE_URL) })
}
