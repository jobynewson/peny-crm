// api/_dashboard.js
// Public office-display handler — whole-workspace overview for a permanent
// office screen: calendar, deliverables, live projects, time tracked + retainer
// hours. Deliberately exposes NO financial information (no fees, rates, budget
// totals or amounts of any kind).
//
// NOTE: this is NOT its own serverless function. Files prefixed with `_` are
// ignored by Vercel's function detection, so this code lives here but is invoked
// by api/portal.js (on ?view=dashboard) to keep the project within the Hobby
// plan's 12-function limit. See claude.md.
//
// Access is gated by a single fixed token held in the DASHBOARD_TOKEN env var,
// so the link is totally separate from the authenticated app.

// Mirror the app's calendar palette (src/views/team-calendar.js).
const TYPE_COLORS = { shoot: '#4CAF50', post_production: '#C47E3A', leave: '#0891b2', other: '#7B6EAB' }
const TYPE_LABELS = { shoot: 'Shoot', post_production: 'Post Production', leave: 'Leave', other: 'Other' }

// Stages considered "live" work (excludes Enquiry and Delivered). Retainers are
// always live. Matches STAGES in src/views/projects.js.
const LIVE_STAGES = new Set(['Pre-production', 'In Production', 'Post', 'Active'])
const STAGE_DOT = { Enquiry: '#b5d4f4', 'Pre-production': '#dddaf7', 'In Production': '#d0e8b0', Post: '#fce2b0', Delivered: '#ebebeb', Active: '#d0e8b0', Retainer: '#C47E3A' }

// Coerce a pg `date`/timestamp into a plain YYYY-MM-DD string (UTC), matching
// the normalisation portal.js relies on for grid maths.
const toDateStr = v => {
  if (!v) return null
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  return String(v).slice(0, 10)
}

// Start of the current retainer period for a project, anchored on the
// day-of-month of retainer_start. Mirrors _checkRetainerReset in projects.js.
function retainerPeriodStart(retainerStart, now) {
  const anchor = new Date(retainerStart)
  const day = anchor.getUTCDate()
  const y = now.getUTCFullYear(), m = now.getUTCMonth()
  let ps = new Date(Date.UTC(y, m, day))
  if (ps > now) ps = new Date(Date.UTC(y, m - 1, day))
  return ps
}

// Invoked by api/portal.js. CORS, method check and rate limiting are already
// handled by the caller; `sql` is a ready neon() client.
export async function handleDashboard(req, res, sql) {
  const { token } = req.query
  const expected = process.env.DASHBOARD_TOKEN
  if (!expected) return res.status(503).json({ error: 'Dashboard link not configured' })
  if (!token || token !== expected) return res.status(404).json({ error: 'Dashboard link not found' })

  // All data is scoped to the single workspace owner.
  const wsRows = await sql`SELECT owner_id FROM workspace ORDER BY created_at ASC LIMIT 1`
  if (!wsRows[0]) return res.status(404).json({ error: 'No workspace found' })
  const uid = wsRows[0].owner_id

  const settingsRows = await sql`
    SELECT company_name, countdown_timer, days_since_timer
    FROM settings WHERE user_id = ${uid} LIMIT 1
  `
  const companyName = settingsRows[0]?.company_name || 'Slate'
  const parseObj = v => {
    if (v && typeof v === 'object') return v
    if (typeof v === 'string') { try { return JSON.parse(v) } catch { return null } }
    return null
  }
  const cd = parseObj(settingsRows[0]?.countdown_timer)
  const ds = parseObj(settingsRows[0]?.days_since_timer)
  const timers = {
    countdown: cd?.name && cd?.target ? { name: cd.name, target: cd.target } : null,
    daysSince: ds?.name && ds?.since ? { name: ds.name, since: ds.since } : null,
  }

  const now = new Date()
  const todayStr = toDateStr(now)

  // ── Date ranges ───────────────────────────────────────────────────────────
  // Calendar: from the Monday of this week to +35 days.
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = (weekStart.getUTCDay() + 6) % 7 // 0 = Monday
  weekStart.setUTCDate(weekStart.getUTCDate() - dow)
  const rangeStart = toDateStr(weekStart)
  const rangeEndD = new Date(weekStart); rangeEndD.setUTCDate(rangeEndD.getUTCDate() + 35)
  const rangeEnd = toDateStr(rangeEndD)

  // Start of the current calendar month (for "time tracked this month").
  const monthStartStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  // Time-entry fetch window: 70 days back covers any monthly retainer period.
  const teCutoffD = new Date(now); teCutoffD.setUTCDate(teCutoffD.getUTCDate() - 70)
  const teCutoff = toDateStr(teCutoffD)

  // ── Projects ────────────────────────────────────────────────────────────────
  const projectRows = await sql`
    SELECT
      p.id, p.name, p.status, p.is_retainer, p.shoot_start, p.shoot_end,
      p.retainer_hours, p.retainer_start, p.retainer_alert, p.retainer_rollover,
      p.deliverables, p.monthly_deliverables,
      c.company AS client_company, c.first_name, c.last_name
    FROM projects p
    LEFT JOIN contacts c ON c.id = p.client_id
    WHERE p.user_id = ${uid}
    ORDER BY p.updated_at DESC
  `

  const parseJson = v => {
    if (Array.isArray(v)) return v
    if (typeof v === 'string') { try { return JSON.parse(v) } catch { return [] } }
    return []
  }

  const liveProjects = []
  const retainers = []
  for (const p of projectRows) {
    const isLive = p.is_retainer || LIVE_STAGES.has(p.status)
    if (!isLive) continue
    const clientName = p.client_company || [p.first_name, p.last_name].filter(Boolean).join(' ') || null
    liveProjects.push({
      id: p.id,
      name: p.name,
      status: p.is_retainer ? 'Retainer' : p.status,
      client: clientName,
      is_retainer: p.is_retainer,
      dot: STAGE_DOT[p.is_retainer ? 'Retainer' : p.status] || '#9a9a90',
      shoot_start: toDateStr(p.shoot_start),
      shoot_end: toDateStr(p.shoot_end),
    })
  }

  // ── Time entries (whole workspace, last 70 days) ─────────────────────────────
  const teRows = await sql`
    SELECT te.project_id, te.hours, te.entry_date
    FROM time_entries te
    JOIN projects p ON p.id = te.project_id
    WHERE p.user_id = ${uid} AND te.entry_date >= ${teCutoff}
  `

  const monthHoursByProject = {}
  let monthTotal = 0
  const usedByProject = {} // entry_date >= per-project retainer period start
  for (const r of teRows) {
    const d = toDateStr(r.entry_date)
    const h = parseFloat(r.hours) || 0
    if (d >= monthStartStr) {
      monthHoursByProject[r.project_id] = (monthHoursByProject[r.project_id] || 0) + h
      monthTotal += h
    }
    // Bucket per project for retainer-period summing (filtered below).
    if (!usedByProject[r.project_id]) usedByProject[r.project_id] = []
    usedByProject[r.project_id].push({ date: d, hours: h })
  }

  const projName = {}
  for (const p of projectRows) projName[p.id] = p.name

  // Time tracked this month — per project breakdown (only projects with hours).
  const timeTracked = {
    monthLabel: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    totalHours: Math.round(monthTotal * 10) / 10,
    byProject: Object.entries(monthHoursByProject)
      .map(([pid, h]) => ({ name: projName[pid] || 'Unknown', hours: Math.round(h * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours),
  }

  // Retainer hours — usage in the current period.
  for (const p of projectRows) {
    if (!p.is_retainer) continue
    const allocation = p.retainer_hours != null ? parseFloat(p.retainer_hours) : null
    let used = 0
    let periodStartStr = null
    if (p.retainer_start) {
      const ps = retainerPeriodStart(p.retainer_start, now)
      periodStartStr = toDateStr(ps)
      for (const e of (usedByProject[p.id] || [])) {
        if (e.date >= periodStartStr) used += e.hours
      }
    } else {
      // No anchor — fall back to calendar month.
      used = monthHoursByProject[p.id] || 0
    }
    used = Math.round(used * 10) / 10
    const clientName = p.client_company || [p.first_name, p.last_name].filter(Boolean).join(' ') || null
    retainers.push({
      name: p.name,
      client: clientName,
      allocation,
      used,
      remaining: allocation != null ? Math.round((allocation - used) * 10) / 10 : null,
      pct: allocation ? Math.round((used / allocation) * 100) : null,
      alert: p.retainer_alert != null ? parseFloat(p.retainer_alert) : 80,
      periodStart: periodStartStr,
    })
  }
  retainers.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))

  // ── Deliverables (across live projects, pending, due-date sorted) ────────────
  const deliverables = []
  for (const p of projectRows) {
    const isLive = p.is_retainer || LIVE_STAGES.has(p.status)
    if (!isLive) continue
    const lists = [...parseJson(p.deliverables), ...parseJson(p.monthly_deliverables)]
    for (const d of lists) {
      if (!d || !d.text || d.done) continue
      deliverables.push({
        text: d.text,
        project: p.name,
        due: d.due ? toDateStr(d.due) : null,
      })
    }
  }
  // Sort: dated first (ascending), then undated.
  deliverables.sort((a, b) => {
    if (a.due && b.due) return a.due < b.due ? -1 : 1
    if (a.due) return -1
    if (b.due) return 1
    return 0
  })

  // ── Calendar entries (this week → +35d) ──────────────────────────────────────
  const calRows = await sql`
    SELECT
      e.id, e.entry_date, e.end_date, e.entry_type, e.label, e.color, e.is_deadline,
      u.name AS assignee_name, p.name AS project_name
    FROM team_calendar_entries e
    LEFT JOIN app_users u ON u.id = e.assignee_id
    LEFT JOIN projects p ON p.id = e.project_id
    WHERE e.user_id = ${uid}
      AND e.entry_date <= ${rangeEnd}
      AND COALESCE(e.end_date, e.entry_date) >= ${rangeStart}
    ORDER BY e.entry_date ASC
  `
  const calendar = calRows.map(e => ({
    id: e.id,
    start: toDateStr(e.entry_date),
    end: toDateStr(e.end_date) || toDateStr(e.entry_date),
    type: e.entry_type,
    typeLabel: TYPE_LABELS[e.entry_type] || 'Other',
    label: e.label,
    project: e.project_name || null,
    assignee: e.assignee_name || null,
    color: e.color || TYPE_COLORS[e.entry_type] || TYPE_COLORS.other,
    isDeadline: !!e.is_deadline,
  }))

  // The team calendar in the app also shows entries DERIVED at render time from
  // shoots and post-production schedules (they are not stored in
  // team_calendar_entries). Replicate that here so the office Schedule isn't
  // empty when the workspace plans via shoots / PPS rather than manual entries.
  // See src/views/team-calendar.js (_buildShootEntries / _buildPpsEntries).
  const inRange = d => d && d >= rangeStart && d <= rangeEnd

  // ── Shoots → shoot entries (one per shoot per scheduled date in range) ──
  const shootRows = await sql`
    SELECT s.id, s.name, s.shoot_date, s.shoot_dates, s.crew, p.name AS project_name
    FROM shoots s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.user_id = ${uid}
  `
  for (const s of shootRows) {
    const sd = parseJson(s.shoot_dates)
    let dates = sd.length ? sd.map(x => toDateStr(x?.date)).filter(Boolean) : []
    if (!dates.length && s.shoot_date) dates = [toDateStr(s.shoot_date)]
    const crew = parseJson(s.crew).map(m => m?.name).filter(Boolean)
    const who = crew.length ? (crew.length > 3 ? `${crew.slice(0, 3).join(', ')} +${crew.length - 3}` : crew.join(', ')) : null
    for (const date of dates) {
      if (!inRange(date)) continue
      calendar.push({
        id: `shoot-${s.id}-${date}`,
        start: date,
        end: date,
        type: 'shoot',
        typeLabel: TYPE_LABELS.shoot,
        label: `Shoot — ${s.project_name || 'Project'}${s.name ? ': ' + s.name : ''}`,
        project: s.project_name || null,
        assignee: who,
        color: TYPE_COLORS.shoot,
        isDeadline: false,
      })
    }
  }

  // ── Post-production phase blocks → post_production entries ──
  const userRows = await sql`SELECT id, name FROM app_users`
  const userName = {}
  for (const u of userRows) userName[u.id] = u.name
  const ppsRows = await sql`
    SELECT ph.id, ph.name, ph.color, ph.blocks, p.name AS project_name
    FROM pps_phases ph
    JOIN post_production_schedules ps ON ps.id = ph.schedule_id
    LEFT JOIN projects p ON p.id = ps.project_id
    WHERE ps.user_id = ${uid}
  `
  for (const ph of ppsRows) {
    for (const b of parseJson(ph.blocks)) {
      const bStart = toDateStr(b?.start_date)
      const bEnd = toDateStr(b?.end_date) || bStart
      if (!bStart) continue
      // Overlaps the window?
      if (bStart > rangeEnd || bEnd < rangeStart) continue
      const stage = b.title || ph.name
      calendar.push({
        id: `pps-${b.id || ph.id + '-' + bStart}`,
        start: bStart,
        end: bEnd,
        type: 'post_production',
        typeLabel: TYPE_LABELS.post_production,
        label: `${ph.project_name ? ph.project_name + ' — ' : ''}${stage}`,
        project: ph.project_name || null,
        assignee: b.assignee_id ? (userName[b.assignee_id] || null) : null,
        color: b.color || ph.color || TYPE_COLORS.post_production,
        isDeadline: !!b.is_deadline,
      })
    }
  }

  calendar.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))

  // Public holidays in range — shown as calendar context.
  const holRows = await sql`
    SELECT holiday_date, name FROM public_holidays
    WHERE user_id = ${uid} AND holiday_date >= ${rangeStart} AND holiday_date <= ${rangeEnd}
    ORDER BY holiday_date ASC
  `
  const holidays = holRows.map(h => ({ date: toDateStr(h.holiday_date), name: h.name }))

  return res.status(200).json({
    company: companyName,
    today: todayStr,
    range: { start: rangeStart, end: rangeEnd },
    timers,
    liveProjects,
    deliverables,
    calendar,
    holidays,
    timeTracked,
    retainers,
  })
}
