// api/maps.js
// Combined location/maps proxy — three actions via ?action= query param
//
// GET /api/maps?action=resolve&url=https://maps.app.goo.gl/...
//   Resolves Google Maps short URLs server-side to get the full URL with coordinates.
//
// GET /api/maps?action=nearby&lat=51.23&lng=-2.45
//   Proxies Overpass API to find nearby hospitals, police, fire stations, and rail.
//
// GET /api/maps?action=place&q=<name>&lat=&lng=
//   Looks up a place's phone number via Google Places (Text Search). Rate-limited
//   and budgeted to stay inside the Places API free tier.

import { neon } from '@neondatabase/serverless'
import { isRateLimited, getClientIp } from './_ratelimit.js'

// ── Google Places monthly budget tracking ────────────────────────────────────
// A phone-returning Text Search bills on the Places "Pro" SKU, which includes
// 5,000 free events/month. We cap conservatively below that (per call, and each
// "Nearby" click makes up to 2 calls). Override with GOOGLE_PLACES_MONTHLY_CAP.
const PLACES_SERVICE = 'google_places'

function currentPeriod() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

async function placesUsedThisMonth(sql) {
  const rows = await sql`SELECT count FROM api_usage WHERE service = ${PLACES_SERVICE} AND period = ${currentPeriod()}`
  return Number(rows[0]?.count ?? 0)
}

async function recordPlacesCall(sql) {
  await sql`
    INSERT INTO api_usage (service, period, count) VALUES (${PLACES_SERVICE}, ${currentPeriod()}, 1)
    ON CONFLICT (service, period) DO UPDATE SET count = api_usage.count + 1`
}

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

  // ── Look up a place's phone number via Google Places (enrichment) ───────────
  // GET /api/maps?action=place&q=Hereford County Hospital&lat=52.05&lng=-2.71
  // Returns { phone, source }. Degrades gracefully to { phone:null } when no
  // GOOGLE_MAPS_API_KEY is configured or Google has no match, so the caller can
  // fall back to the OpenStreetMap phone tag (or leave the field blank).
  if (action === 'place') {
    const { q, lat, lng } = req.query
    const key = process.env.GOOGLE_MAPS_API_KEY
    if (!key) return res.status(200).json({ phone: null, source: null })
    if (!q || !lat || !lng) return res.status(400).json({ error: 'q, lat and lng required' })

    // Burst guard — stops a runaway client loop from draining the budget.
    // In-memory/per-instance, so it only catches rapid-fire bursts.
    if (isRateLimited(getClientIp(req), { windowMs: 60_000, max: 20 })) {
      return res.status(200).json({ phone: null, source: null, reason: 'rate_limited' })
    }

    // Monthly budget guard — never call Google once we've hit the free-tier cap.
    const cap = Number(process.env.GOOGLE_PLACES_MONTHLY_CAP || 4500)
    let dbSql = null
    try {
      if (process.env.VITE_DATABASE_URL) {
        dbSql = neon(process.env.VITE_DATABASE_URL)
        if (await placesUsedThisMonth(dbSql) >= cap) {
          return res.status(200).json({ phone: null, source: null, reason: 'budget' })
        }
      }
    } catch (err) {
      // Fail open on counter errors — the Cloud Console quota is the hard backstop
      console.warn('Places usage check failed:', err.message)
      dbSql = null
    }

    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          // Field mask keeps this on the cheapest billable SKU that still returns a phone
          'X-Goog-FieldMask': 'places.nationalPhoneNumber,places.internationalPhoneNumber,places.displayName',
        },
        body: JSON.stringify({
          textQuery: q,
          maxResultCount: 1,
          locationBias: { circle: { center: { latitude: Number(lat), longitude: Number(lng) }, radius: 30000 } },
        }),
        signal: AbortSignal.timeout(8000),
      })
      // A request was sent to Google, so it counts against the monthly budget
      if (dbSql) recordPlacesCall(dbSql).catch(e => console.warn('Places usage record failed:', e.message))
      if (!response.ok) return res.status(200).json({ phone: null, source: null })
      const data = await response.json()
      const place = data.places?.[0]
      const phone = place?.nationalPhoneNumber || place?.internationalPhoneNumber || null
      return res.status(200).json({ phone, source: phone ? 'google' : null })
    } catch (err) {
      console.warn('Places lookup failed:', err.message)
      return res.status(200).json({ phone: null, source: null })
    }
  }

  return res.status(400).json({ error: 'action must be "resolve", "nearby" or "place"' })
}
