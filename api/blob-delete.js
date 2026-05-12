// api/blob-delete.js
// DELETE /api/blob-delete — removes an image from Vercel Blob

import { del } from '@vercel/blob'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })

  const { url } = req.query

  if (!url) {
    return res.status(400).json({ error: 'Missing required query param: url' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not configured' })
  }

  try {
    await del(url, { token })
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Blob delete error:', err)
    // Don't block the UI if delete fails — card is already gone from DB
    return res.status(200).json({ ok: true, warning: err.message })
  }
}
