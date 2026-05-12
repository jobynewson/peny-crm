// api/blob-upload.js
// POST /api/blob-upload — uploads an image to Vercel Blob for the planning board

import { put } from '@vercel/blob'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { base64, filename, contentType, projectId } = req.body

  if (!base64 || !filename || !contentType) {
    return res.status(400).json({ error: 'Missing required fields: base64, filename, contentType' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not configured' })
  }

  try {
    const buffer = Buffer.from(base64, 'base64')
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `planning/${projectId || 'general'}/${Date.now()}-${safeName}`

    const { url } = await put(path, buffer, {
      access: 'public',
      contentType,
      token,
    })

    return res.status(200).json({ url })
  } catch (err) {
    console.error('Blob upload error:', err)
    return res.status(500).json({ error: 'Upload failed', detail: err.message })
  }
}
