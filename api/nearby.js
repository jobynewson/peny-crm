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

  const radius = 20000
  const query = `[out:json][timeout:15];(
    node["amenity"="hospital"](around:${radius},${lat},${lng});
    way["amenity"="hospital"](around:${radius},${lat},${lng});
    node["amenity"="police"](around:${radius},${lat},${lng});
    way["amenity"="police"](around:${radius},${lat},${lng});
    node["amenity"="fire_station"](around:${radius},${lat},${lng});
    way["amenity"="fire_station"](around:${radius},${lat},${lng});
    node["railway"="station"](around:${radius},${lat},${lng});
  );out center;`

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    })
    if (!response.ok) throw new Error(`Overpass error: ${response.status}`)
    const data = await response.json()
    res.status(200).json(data)
  } catch (err) {
    console.error('Overpass error:', err)
    res.status(502).json({ error: 'Failed to reach Overpass API' })
  }
}
