// api/blob-serve.js
// GET /api/blob-serve?url=<encoded-private-blob-url>
// Proxies private Vercel Blob images so <img> tags can load them
// without needing to send an Authorization header.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'Missing url parameter' })

  // Only proxy our own private blob storage — reject anything else
  if (!url.includes('.blob.vercel-storage.com')) {
    return res.status(400).json({ error: 'URL not allowed' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not configured' })

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!upstream.ok) return res.status(upstream.status).end()

    const contentType = upstream.headers.get('content-type') || 'image/jpeg'
    const buffer = Buffer.from(await upstream.arrayBuffer())

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
    res.setHeader('Content-Length', buffer.length)
    return res.status(200).send(buffer)
  } catch (err) {
    console.error('Blob serve error:', err)
    return res.status(500).json({ error: err.message })
  }
}
