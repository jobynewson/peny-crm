// api/_office-videos.js
// Routes behind /api/office-videos: Personal Tools › Office screen videos. Each
// person adds YouTube links; the office screen plays everyone's. Every query
// below is filtered by the verified session's Clerk id (user.clerk_id), never
// by anything the browser sends, so you can only see and delete your own.
//
//   GET    /api/office-videos       → { videos: [{ id, video_id, url, created_at }] }
//   POST   /api/office-videos       { url } → { video }
//   DELETE /api/office-videos/:id   → { ok }
//
// The screen reads the lot through the dashboard token (api/_dashboard.js).
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { invalid, readBody } from './_api.js'

export const MAX_VIDEOS_PER_PERSON = 50

export const ROUTES = [
  { method: 'GET',    pattern: /^office-videos$/,                  handler: list },
  { method: 'POST',   pattern: /^office-videos$/,                  handler: add },
  { method: 'DELETE', pattern: /^office-videos\/(?<id>[0-9a-f-]{36})$/i, handler: remove },
]

// The 11-character id of a single YouTube video from a pasted link, or null.
// Playlist and channel links have no single video, so they are refused.
export function youtubeId(input) {
  let u
  try { u = new URL(String(input).trim()) } catch { return null }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '')
  let id = null
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else {
      const m = /^\/(?:shorts|embed|live|v)\/([^/]+)/.exec(u.pathname)
      if (m) id = m[1]
    }
  } else return null
  return /^[A-Za-z0-9_-]{11}$/.test(id ?? '') ? id : null
}

async function list(req, res, { sql, user }) {
  const videos = await sql`
    SELECT id, video_id, url, created_at FROM office_videos
    WHERE clerk_id = ${user.clerk_id} ORDER BY created_at DESC`
  return res.status(200).json({ videos })
}

async function add(req, res, { sql, user }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const videoId = youtubeId(url)
  if (!videoId) return invalid(res, 'url', 'Paste the link to a single YouTube video')

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM office_videos WHERE clerk_id = ${user.clerk_id}`
  if (n >= MAX_VIDEOS_PER_PERSON) return invalid(res, 'url', `You can keep up to ${MAX_VIDEOS_PER_PERSON} videos. Remove one first`)

  const [existing] = await sql`
    SELECT id, video_id, url, created_at FROM office_videos WHERE clerk_id = ${user.clerk_id} AND video_id = ${videoId}`
  if (existing) return res.status(200).json({ video: existing })
  const [video] = await sql`
    INSERT INTO office_videos (clerk_id, video_id, url) VALUES (${user.clerk_id}, ${videoId}, ${url.slice(0, 500)})
    RETURNING id, video_id, url, created_at`
  return res.status(201).json({ video })
}

async function remove(req, res, { sql, user, params }) {
  await sql`DELETE FROM office_videos WHERE id = ${params.id} AND clerk_id = ${user.clerk_id}`
  return res.status(200).json({ ok: true })
}
