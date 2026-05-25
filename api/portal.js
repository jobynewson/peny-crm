// api/portal.js
// Public endpoint — no authentication required
// GET /api/portal?token=xxx → returns project info, deliverables, work log, frame.io link

import { neon } from '@neondatabase/serverless'
import { isRateLimited, getClientIp } from './_ratelimit.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (isRateLimited(getClientIp(req))) {
    return res.status(429).json({ error: 'Too many requests' })
  }

  const { token } = req.query
  if (!token) return res.status(400).json({ error: 'Token required' })

  const sql = neon(process.env.VITE_DATABASE_URL)

  const rows = await sql`
    SELECT
      p.id, p.name, p.status, p.brief, p.shoot_start, p.shoot_end,
      p.deliverables, p.frame_io_link,
      c.first_name, c.last_name, c.company,
      s.company_name AS studio_name, s.website AS studio_website
    FROM projects p
    LEFT JOIN contacts c ON c.id = p.client_id
    LEFT JOIN settings s ON s.user_id = p.user_id
    WHERE p.portal_token = ${token}
    LIMIT 1
  `
  if (!rows[0]) return res.status(404).json({ error: 'Portal link not found' })

  const project = rows[0]

  let deliverables = project.deliverables
  if (typeof deliverables === 'string') {
    try { deliverables = JSON.parse(deliverables) } catch { deliverables = [] }
  }

  const logEntries = await sql`
    SELECT id, note, entry_date, created_by, created_at
    FROM work_log
    WHERE project_id = ${project.id}
    ORDER BY entry_date DESC, created_at DESC
  `

  const scheduleRows = await sql`
    SELECT id, start_date, end_date FROM post_production_schedules
    WHERE project_id = ${project.id}
    LIMIT 1
  `

  let ppsSchedule = null
  let ppsPhases = []
  if (scheduleRows[0]) {
    const sched = scheduleRows[0]
    ppsSchedule = { start_date: sched.start_date, end_date: sched.end_date }

    const cols = await sql`
      SELECT id, name, color, blocks, show_in_portal, sort_order
      FROM pps_phases
      WHERE schedule_id = ${sched.id}
      ORDER BY sort_order, created_at
    `

    for (const col of cols) {
      const colVisible = col.show_in_portal
      const blocks = Array.isArray(col.blocks) ? col.blocks : []
      const visibleBlocks = blocks.filter(b => (colVisible || b.show_in_portal) && b.start_date && b.end_date)
      if (visibleBlocks.length || colVisible) {
        ppsPhases.push({
          id:    col.id,
          name:  col.name,
          color: col.color,
          blocks: visibleBlocks.map(b => ({
            id:          b.id,
            title:       b.title       || '',
            start_date:  b.start_date,
            end_date:    b.end_date,
            color:       b.color       || null,
            notes:       b.notes       || '',
            is_deadline: b.is_deadline || false,
          })),
        })
      }
    }
  }

  return res.status(200).json({
    project: {
      name:          project.name,
      status:        project.status,
      brief:         project.brief,
      shoot_start:   project.shoot_start,
      shoot_end:     project.shoot_end,
      frame_io_link: project.frame_io_link,
    },
    client: project.first_name
      ? { name: project.first_name + ' ' + project.last_name, company: project.company }
      : null,
    studio:       { name: project.studio_name, website: project.studio_website },
    deliverables: (deliverables || []).filter(d => d.text),
    workLog:      logEntries,
    ppsSchedule,
    ppsPhases,
  })
}
