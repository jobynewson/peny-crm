// api/maps.js
// Combined location/maps proxy — two actions via ?action= query param
//
// GET /api/maps?action=resolve&url=https://maps.app.goo.gl/...
//   Resolves Google Maps short URLs server-side to get the full URL with coordinates.
//
// GET /api/maps?action=nearby&lat=51.23&lng=-2.45
//   Proxies Overpass API to find nearby hospitals, police, fire stations, and rail.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { action } = req.query

  // ── Resolve a Google Maps short URL ────────────────────────────────────────
  if (action === 'resolve') {
    const { url } = req.query
    if (!url) return res.status(400).json({ error: 'url required' })

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
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SlateCRM/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      return res.status(200).json({ url: response.url })
    } catch (err) {
      console.error('Resolve error:', err)
      return res.status(502).json({ error: 'Could not resolve URL' })
    }
  }

  // ── Find nearby emergency services via Overpass API ────────────────────────
  if (action === 'nearby') {
    const { lat, lng } = req.query
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' })

    const radius = 30000  // 30km — wider for rural areas
    const query = `[out:json][timeout:25];(
      node["amenity"="hospital"]["emergency"="yes"](around:${radius},${lat},${lng});
      way["amenity"="hospital"]["emergency"="yes"](around:${radius},${lat},${lng});
      relation["amenity"="hospital"]["emergency"="yes"](around:${radius},${lat},${lng});
      node["amenity"="police"](around:${radius},${lat},${lng});
      way["amenity"="police"](around:${radius},${lat},${lng});
      relation["amenity"="police"](around:${radius},${lat},${lng});
      node["amenity"="fire_station"](around:${radius},${lat},${lng});
      way["amenity"="fire_station"](around:${radius},${lat},${lng});
      relation["amenity"="fire_station"](around:${radius},${lat},${lng});
      node["railway"="station"](around:${radius},${lat},${lng});
    );out center;`

    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ]
    const body = 'data=' + encodeURIComponent(query)

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SlateCRM/1.0' },
          body,
          signal: AbortSignal.timeout(25000),
        })
        if (!response.ok) continue
        const data = await response.json()
        return res.status(200).json(data)
      } catch (err) {
        console.warn(`Overpass endpoint failed: ${endpoint}`, err.message)
      }
    }

    return res.status(502).json({ error: 'All Overpass endpoints failed — try again shortly' })
  }

  return res.status(400).json({ error: 'action must be "resolve" or "nearby"' })
}
