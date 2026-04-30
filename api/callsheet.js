// api/callsheet.js
// Public endpoint — GET /api/callsheet?token=SHOOT_TOKEN&crew=CREW_TOKEN
import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { token, crew: crewToken } = req.query
  if (!token) return res.status(400).json({ error: 'Token required' })

  const sql = neon(process.env.VITE_DATABASE_URL)

  const rows = await sql`
    SELECT
      sh.*,
      p.name      AS project_name,
      p.brief     AS project_brief,
      p.insurer_name      AS project_insurer_name,
      p.insurer_address   AS project_insurer_address,
      p.insurer_email     AS project_insurer_email,
      p.insurer_contact   AS project_insurer_contact,
      c.first_name, c.last_name, c.company,
      s.company_name      AS studio_name,
      s.address           AS studio_address,
      s.default_insurer_name    AS studio_insurer_name,
      s.default_insurer_address AS studio_insurer_address,
      s.default_insurer_email   AS studio_insurer_email,
      s.default_insurer_contact AS studio_insurer_contact,
      s.invoicing_email         AS studio_invoicing_email,
      s.invoicing_boilerplate   AS studio_invoicing_boilerplate
    FROM shoots sh
    JOIN projects p ON p.id = sh.project_id
    LEFT JOIN contacts c ON c.id = p.client_id
    LEFT JOIN settings s ON s.user_id = sh.user_id
    WHERE sh.shoot_token = ${token}
    LIMIT 1
  `
  if (!rows[0]) return res.status(404).json({ error: 'Shoot not found' })
  const sh = rows[0]

  const crew        = Array.isArray(sh.crew)       ? sh.crew      : []
  const schedule    = Array.isArray(sh.schedule)   ? sh.schedule  : []
  const locations   = Array.isArray(sh.locations)  ? sh.locations : []
  const hotels      = Array.isArray(sh.hotels)     ? sh.hotels    : []
  const equipment   = Array.isArray(sh.equipment)  ? sh.equipment : []
  const shoot_dates = Array.isArray(sh.shoot_dates)? sh.shoot_dates: []

  // Cascade insurance: shoot → project → settings
  const insurer = {
    name:    sh.insurer_name    || sh.project_insurer_name    || sh.studio_insurer_name    || null,
    address: sh.insurer_address || sh.project_insurer_address || sh.studio_insurer_address || null,
    email:   sh.insurer_email   || sh.project_insurer_email   || sh.studio_insurer_email   || null,
    contact: sh.insurer_contact || sh.project_insurer_contact || sh.studio_insurer_contact || null,
  }

  // Cascade invoicing: shoot → settings
  const invoicing = {
    email:       sh.invoicing_email   || sh.studio_invoicing_email     || null,
    job_ref:     sh.invoicing_job_ref || null,
    boilerplate: sh.studio_invoicing_boilerplate || null,
  }

  // Client display: shoot override → project client company → project client name
  const projectClientName = sh.first_name ? `${sh.first_name} ${sh.last_name}`.trim() : null
  const client_display = sh.client_display || sh.company || projectClientName || null

  const thisCrew = crewToken ? crew.find(c => c.crew_token === crewToken) : null

  return res.status(200).json({
    sheet: {
      date:          sh.shoot_date,
      shoot_dates,
      status:        sh.status,
      general_call:  sh.general_call,
      location_name: sh.location_name,
      location_address:  sh.location_address,
      location_map_link: sh.location_map_link,
      weather_text:  sh.weather_text,
      notes:         sh.notes,
      hs_notes:      sh.hs_notes,
      parking_notes: sh.parking_notes,
      nearest_transport:        sh.nearest_transport,
      nearest_hospital_name:    sh.nearest_hospital_name,
      nearest_hospital_address: sh.nearest_hospital_address,
      nearest_police_name:      sh.nearest_police_name,
      nearest_police_address:   sh.nearest_police_address,
      nearest_fire_name:        sh.nearest_fire_name,
      nearest_fire_address:     sh.nearest_fire_address,
      hotels,
      equipment,
      client_display,
      insurer,
      invoicing,
      sheet_token: sh.shoot_token,
    },
    project: { name: sh.project_name, brief: sh.project_brief },
    client:  sh.first_name ? { name: projectClientName, company: sh.company } : null,
    studio:  { name: sh.studio_name, address: sh.studio_address },
    thisCrew,
    crew,
    schedule,
    locations,
  })
}
