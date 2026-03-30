// api/track.js
// Public endpoint — no authentication required
// GET  /api/track?token=xxx  → returns project info, crew, trackable lines, entries
// POST /api/track             → submits a time entry

import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  // CORS — allow the public tracking page to call this
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sql = neon(process.env.VITE_DATABASE_URL)

  // ── GET — load project data for the tracking page ─────────────────────────
  if (req.method === 'GET') {
    const { token } = req.query
    if (!token) return res.status(400).json({ error: 'Token required' })

    // Fetch the project by token
    const projects = await sql`
      SELECT id, name, crew, budget_ids, is_retainer, retainer_hours, retainer_start, retainer_alert
      FROM projects
      WHERE track_token = ${token}
      LIMIT 1
    `
    if (!projects[0]) return res.status(404).json({ error: 'Tracking link not found' })
    const project = projects[0]

    // Find the linked budgets and extract trackable lines
    const budgetIds = Array.isArray(project.budget_ids) ? project.budget_ids : []
    let trackableLines = []
    let budgetId = null

    if (budgetIds.length > 0) {
      const budgets = await sql`
        SELECT id, sections FROM budgets WHERE id = ANY(${budgetIds}::uuid[])
      `
      // Collect all lines with track_time = true
      for (const budget of budgets) {
        for (const section of (budget.sections || [])) {
          if (!section.enabled) continue
          for (const line of (section.lines || [])) {
            if (!line.track_time || !line.item) continue
            const days = parseFloat(line.days) || 0
            const qty  = isNaN(parseFloat(line.qty)) ? 1 : parseFloat(line.qty)
            const allocatedHours = line.useDays ? Math.round(days * qty * 8) : Math.round(qty * 8)
            trackableLines.push({
              label: line.item,
              allocatedHours,
              budgetId: budget.id,
            })
            if (!budgetId) budgetId = budget.id
          }
        }
      }
    }

    // For retainers with no budget trackable lines, add a default "Retainer work" line
    if (trackableLines.length === 0 && project.is_retainer) {
      trackableLines.push({
        label: 'Retainer work',
        allocatedHours: parseFloat(project.retainer_hours) || 0,
        budgetId: null,
      })
    }

    // Extract crew names from the project crew list
    const crew = (project.crew || [])
      .filter(c => c.name)
      .map(c => c.name)

    // Fetch existing time entries for this project
    const entries = await sql`
      SELECT id, crew_name, line_label, hours, entry_date, note, created_at
      FROM time_entries
      WHERE project_id = ${project.id}
      ORDER BY created_at DESC
      LIMIT 50
    `

    return res.status(200).json({
      project: { id: project.id, name: project.name },
      crew,
      trackableLines,
      budgetId,
      entries,
    })
  }

  // ── POST — submit a time entry ────────────────────────────────────────────
  if (req.method === 'POST') {
    const { token, crewName, lineLabel, hours, date, note, budgetId } = req.body

    if (!token) return res.status(400).json({ error: 'Token required' })
    if (!crewName || !lineLabel) return res.status(400).json({ error: 'Crew name and task required' })
    const h = parseFloat(hours)
    if (!h || h <= 0 || h > 24) return res.status(400).json({ error: 'Invalid hours (0–24)' })

    // Verify token is valid
    const projects = await sql`
      SELECT id FROM projects WHERE track_token = ${token} LIMIT 1
    `
    if (!projects[0]) return res.status(404).json({ error: 'Invalid tracking link' })
    const projectId = projects[0].id

    const [entry] = await sql`
      INSERT INTO time_entries (project_id, budget_id, line_label, crew_name, hours, entry_date, note)
      VALUES (
        ${projectId},
        ${budgetId || null},
        ${lineLabel},
        ${crewName},
        ${h},
        ${date || new Date().toISOString().split('T')[0]},
        ${note || null}
      )
      RETURNING *
    `

    return res.status(201).json({ entry })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
