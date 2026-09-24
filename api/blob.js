// api/blob.js
// Unified Vercel Blob handler — routes by HTTP method and action:
//   POST   /api/blob?action=upload       — upload image, returns { url }
//   DELETE /api/blob?url=<blobUrl>        — delete image
//   GET    /api/blob?url=<blobUrl>        — proxy private blob for <img> tags
//   GET    /api/blob?action=preview&url=  — SSRF-guarded link/URL preview
//   GET    /api/blob?action=youtube&id=   — view count for the dashboard ticker

import { put, del } from '@vercel/blob'
import { verifyToken } from '@clerk/backend'
import { fetchLinkPreview } from './_preview.js'
import { getYoutubeViews } from './_youtube.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

async function requireAuth(req, res) {
  const raw = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!raw) { res.status(401).json({ error: 'Unauthorised' }); return null }
  try {
    const payload = await verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY })
    return payload.sub
  } catch {
    res.status(401).json({ error: 'Invalid session token' }); return null
  }
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── GET ?action=preview: fetch link metadata (title/thumbnail/favicon) ──────
  // Authed, SSRF-guarded. Doesn't need a blob token, so it's handled first.
  if (req.method === 'GET' && req.query.action === 'preview') {
    const userId = await requireAuth(req, res)
    if (!userId) return
    const { url } = req.query
    if (!url) return res.status(400).json({ error: 'Missing url parameter' })
    try {
      const preview = await fetchLinkPreview(url)
      return res.status(200).json(preview)
    } catch (err) {
      return res.status(422).json({ error: err.message || 'Preview failed' })
    }
  }

  // ── GET ?action=youtube: view count for the in-app dashboard ticker ────────
  // The office dashboard gets this from /api/portal?view=dashboard, but that is
  // gated by DASHBOARD_TOKEN which the app doesn't hold. This is the same
  // lookup behind Clerk auth instead. It lives here rather than in a new file
  // because we are at Vercel's 12-function limit (see claude.md), and above the
  // blob-token check because, like ?action=preview, it doesn't need one.
  // YOUTUBE_API_KEY stays server-side — it is never shipped to the browser.
  if (req.method === 'GET' && req.query.action === 'youtube') {
    const userId = await requireAuth(req, res)
    if (!userId) return
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'Missing id parameter' })
    const stats = await getYoutubeViews(id)
    if (stats?.views != null) return res.status(200).json({ views: stats.views, stale: !!stats.stale })
    return res.status(200).json({ error: stats?.error || 'No view count available' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not configured' })

  // ── GET: proxy private blob so <img> tags can load it ──────────────────────
  if (req.method === 'GET') {
    const { url } = req.query
    if (!url) return res.status(400).json({ error: 'Missing url parameter' })
    if (!url.includes('.blob.vercel-storage.com')) {
      return res.status(400).json({ error: 'URL not allowed' })
    }
    try {
      const upstream = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!upstream.ok) return res.status(upstream.status).end()
      const buffer = Buffer.from(await upstream.arrayBuffer())
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
      res.setHeader('Content-Length', buffer.length)
      return res.status(200).send(buffer)
    } catch (err) {
      console.error('Blob serve error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  // ── POST: upload image, returns { url } ────────────────────────────────────
  if (req.method === 'POST') {
    const userId = await requireAuth(req, res)
    if (!userId) return
    const { base64, filename, contentType, projectId } = req.body
    if (!base64 || !filename || !contentType) {
      return res.status(400).json({ error: 'Missing required fields: base64, filename, contentType' })
    }
    try {
      const buffer = Buffer.from(base64, 'base64')
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `planning/${projectId || 'general'}/${Date.now()}-${safeName}`
      const { url } = await put(path, buffer, { access: 'private', contentType, token })
      return res.status(200).json({ url })
    } catch (err) {
      console.error('Blob upload error:', err)
      return res.status(500).json({ error: 'Upload failed', detail: err.message })
    }
  }

  // ── DELETE: remove blob ────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const userId = await requireAuth(req, res)
    if (!userId) return
    const { url } = req.query
    if (!url) return res.status(400).json({ error: 'Missing required query param: url' })
    try {
      await del(url, { token })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('Blob delete error:', err)
      return res.status(200).json({ ok: true, warning: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
