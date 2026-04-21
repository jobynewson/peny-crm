// api/nearby.js
// Proxy for Overpass API — avoids CORS issues from the browser
// GET /api/nearby?lat=51.23&lng=-2.45

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

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

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'PenyCRM/1.0 (production tool; contact@wearepeny.com)',
  }
  const body = 'data=' + encodeURIComponent(query)

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(25000),
      })
      if (!response.ok) continue
      const data = await response.json()
      return res.status(200).json(data)
    } catch (err) {
      console.warn(`Overpass endpoint failed: ${endpoint}`, err.message)
      continue
    }
  }

  res.status(502).json({ error: 'All Overpass endpoints failed — try again shortly' })
}
