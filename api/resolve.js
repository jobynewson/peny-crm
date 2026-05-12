// api/resolve.js
// Resolves Google Maps short URLs (maps.app.goo.gl) server-side to get the full URL with coordinates
// GET /api/resolve?url=https://maps.app.goo.gl/...

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  // Only allow Google Maps domains
  const allowed = ['maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'www.google.com']
  try {
    const parsed = new URL(url)
    if (!allowed.some(d => parsed.hostname === d)) {
      return res.status(400).json({ error: 'Only Google Maps URLs are supported' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  try {
    // Follow redirects and return the final URL
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SlateCRM/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    const finalUrl = response.url
    res.status(200).json({ url: finalUrl })
  } catch (err) {
    console.error('Resolve error:', err)
    res.status(502).json({ error: 'Could not resolve URL' })
  }
}
