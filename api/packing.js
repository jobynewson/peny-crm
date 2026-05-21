// api/packing.js
// GET /api/packing?token=SHOOT_TOKEN — read packing state
// POST /api/packing?token=SHOOT_TOKEN — save packing state
// Note: no CORS headers — packing.html is served same-origin from Vercel
import { neon } from '@neondatabase/serverless'
import { isRateLimited, getClientIp } from './_ratelimit.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const ip = getClientIp(req)
  const { token } = req.query
  if (!token) return res.status(400).json({ error: 'Token required' })

  const sql = neon(process.env.VITE_DATABASE_URL)

  if (req.method === 'GET') {
    if (isRateLimited(ip, { max: 60 })) return res.status(429).json({ error: 'Too many requests' })
    const rows = await sql`
      SELECT sh.id, sh.name, sh.shoot_date, sh.shoot_dates, sh.shoot_camera_setups,
             p.name AS project_name,
             s.company_name AS studio_name
      FROM shoots sh
      JOIN projects p ON p.id = sh.project_id
      LEFT JOIN settings s ON s.user_id = sh.user_id
      WHERE sh.shoot_token = ${token}
      LIMIT 1
    `
    if (!rows[0]) return res.status(404).json({ error: 'Shoot not found' })
    const sh = rows[0]

    // Expire token 7 days after the last shoot date
    const shootDates = Array.isArray(sh.shoot_dates)
      ? sh.shoot_dates.map(d => d.date).filter(Boolean)
      : []
    if (sh.shoot_date) shootDates.push(sh.shoot_date)
    const latestDate = shootDates.sort().pop()
    if (latestDate) {
      const expiry = new Date(latestDate + 'T00:00:00')
      expiry.setDate(expiry.getDate() + 7)
      if (new Date() > expiry) return res.status(410).json({ error: 'This link has expired' })
    }

    return res.status(200).json({
      shoot: {
        id:         sh.id,
        name:       sh.name,
        shoot_date: sh.shoot_date,
        shoot_dates: Array.isArray(sh.shoot_dates) ? sh.shoot_dates : [],
      },
      project:      { name: sh.project_name },
      studio:       { name: sh.studio_name },
      camera_setups: Array.isArray(sh.shoot_camera_setups) ? sh.shoot_camera_setups : [],
    })
  }

  if (req.method === 'POST') {
    if (isRateLimited(ip, { max: 20 })) return res.status(429).json({ error: 'Too many requests' })
    const { camera_setups } = req.body
    if (!Array.isArray(camera_setups)) return res.status(400).json({ error: 'camera_setups array required' })
    await sql`
      UPDATE shoots
      SET shoot_camera_setups = ${JSON.stringify(camera_setups)}::jsonb,
          updated_at = NOW()
      WHERE shoot_token = ${token}
    `
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
