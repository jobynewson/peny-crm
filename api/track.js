// api/track.js
// Public endpoint — no authentication required
// GET  /api/track?token=xxx  → returns project info, crew, trackable lines, entries
// POST /api/track             → submits a time entry

import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sql = neon(process.env.VITE_DATABASE_URL)

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { token } = req.query
    if (!token) return res.status(400).json({ error: 'Token required' })

    const rows = await sql`
      SELECT id, name, crew, budget_ids, is_retainer, retainer_hours, retainer_start, retainer_alert
      FROM projects
      WHERE track_token = ${token}
      LIMIT 1
    `
    if (!rows[0]) return res.status(404).json({ error: 'Tracking link not found' })
    const project = rows[0]

    // budget_ids comes back as a string from raw SQL — parse it
    let budgetIds = []
    try {
      const raw = project.budget_ids
      budgetIds = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : [])
    } catch { budgetIds = [] }

    let trackableLines = []
    let budgetId = null

    if (budgetIds.length > 0) {
      const budgets = await sql`
        SELECT id, name, sections FROM budgets WHERE id = ANY(${budgetIds}::uuid[])
      `
      for (const budget of budgets) {
        let sections = budget.sections
        if (typeof sections === 'string') { try { sections = JSON.parse(sections) } catch { sections = [] } }
        for (const section of (sections || [])) {
          if (!section.enabled) continue
          for (const line of (section.lines || [])) {
            if (!line.track_time || !line.item) continue
            const days = parseFloat(line.days) || 0
            const qty  = isNaN(parseFloat(line.qty)) ? 0 : parseFloat(line.qty)
            const allocatedHours = line.useDays ? Math.round(days * qty * 8) : Math.round(qty * 8)
            trackableLines.push({
              label: line.item,
              allocatedHours,
              budgetId: budget.id,
              budgetName: budget.name,
            })
            if (!budgetId) budgetId = budget.id
          }
        }
      }
    }

    // Retainer fallback
    if (trackableLines.length === 0 && project.is_retainer) {
      trackableLines.push({
        label: 'Retainer work',
        allocatedHours: parseFloat(project.retainer_hours) || 0,
        budgetId: null,
      })
    }

    // Non-retainer project with no trackable budget lines — add a general task
    // so editors can still log time (they just won't have budget-specific lines)
    if (trackableLines.length === 0) {
      trackableLines.push({
        label: 'General / production work',
        allocatedHours: 0,
        budgetId: null,
      })
    }

    // Crew — parse if needed
    let crew = project.crew
    if (typeof crew === 'string') { try { crew = JSON.parse(crew) } catch { crew = [] } }
    const crewNames = (Array.isArray(crew) ? crew : [])
      .filter(c => c.name)
      .map(c => c.name)

    const entries = await sql`
      SELECT id, crew_name, line_label, hours, entry_date, note, created_at
      FROM time_entries
      WHERE project_id = ${project.id}
      ORDER BY created_at DESC
      LIMIT 50
    `

    return res.status(200).json({
      project: { id: project.id, name: project.name },
      crew: crewNames,
      trackableLines,
      budgetId,
      entries,
    })
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { token, crewName, lineLabel, hours, date, note, budgetId } = req.body

    if (!token) return res.status(400).json({ error: 'Token required' })
    if (!crewName) return res.status(400).json({ error: 'Please enter your name' })
    if (!lineLabel) return res.status(400).json({ error: 'Please select a task' })
    const h = parseFloat(hours)
    if (!h || h <= 0 || h > 24) return res.status(400).json({ error: 'Please enter valid hours (0.5–24)' })

    const projects = await sql`
      SELECT id FROM projects WHERE track_token = ${token} LIMIT 1
    `
    if (!projects[0]) return res.status(404).json({ error: 'Invalid tracking link' })

    const [entry] = await sql`
      INSERT INTO time_entries (project_id, budget_id, line_label, crew_name, hours, entry_date, note)
      VALUES (
        ${projects[0].id},
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
