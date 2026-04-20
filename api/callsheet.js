// api/callsheet.js
// Public endpoint — GET /api/callsheet?token=SHEET_TOKEN&crew=CREW_TOKEN
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

  const sheets = await sql`
    SELECT cs.*, p.name AS project_name, p.brief AS project_brief,
           c.first_name, c.last_name, c.company,
           s.company_name AS studio_name
    FROM call_sheets cs
    JOIN projects p ON p.id = cs.project_id
    LEFT JOIN contacts c ON c.id = p.client_id
    LEFT JOIN settings s ON s.user_id = cs.user_id
    WHERE cs.sheet_token = ${token}
    LIMIT 1
  `
  if (!sheets[0]) return res.status(404).json({ error: 'Call sheet not found' })
  const sheet = sheets[0]

  const [crew, schedule, locations] = await Promise.all([
    sql`SELECT * FROM call_sheet_crew WHERE call_sheet_id = ${sheet.id} ORDER BY sort_order`,
    sql`SELECT * FROM call_sheet_schedule WHERE call_sheet_id = ${sheet.id} ORDER BY sort_order`,
    sql`SELECT * FROM call_sheet_locations WHERE call_sheet_id = ${sheet.id} ORDER BY sort_order`,
  ])

  // Find the specific crew member if crew token provided
  const thisCrew = crewToken ? crew.find(c => c.crew_token === crewToken) : null

  return res.status(200).json({
    sheet: {
      date: sheet.sheet_date,
      status: sheet.status,
      general_call: sheet.general_call,
      location_name: sheet.location_name,
      location_address: sheet.location_address,
      location_map_link: sheet.location_map_link,
      weather_text: sheet.weather_text,
      notes: sheet.notes,
      sheet_token: sheet.sheet_token,
    },
    project: { name: sheet.project_name, brief: sheet.project_brief },
    client: sheet.first_name ? { name: sheet.first_name + ' ' + sheet.last_name, company: sheet.company } : null,
    studio: { name: sheet.studio_name },
    thisCrew,
    crew,
    schedule,
    locations,
  })
}
