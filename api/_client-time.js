// api/_client-time.js
// Logged time Peny has chosen to show a client company (projects.show_time_to_client),
// for the signed-in portal. Only totals leave the server: hours by role, and for
// a retainer the monthly usage against its allocation. Who logged an entry and
// its note are never selected. Every query starts from the signed-in scope.

import { monthlyUsage, overallUsage, sumHours } from '../src/utils/retainer-usage.js'

const round = n => Math.round(n * 100) / 100

// How many of a retainer's most recent months the portal shows.
const MONTHS_SHOWN = 12

const lineJson = l => ({ label: l.label, logged: round(l.logged), allocated: round(l.allocated) })

// → [{ id, name, total, roles, retainer }], one per shared project of the company.
export async function listSharedTime(sql, scope, now = new Date()) {
  const [projects, entries] = await Promise.all([
    sql`
      SELECT p.id, p.name, p.is_retainer, p.retainer_start::text AS retainer_start,
             p.retainer_hours, p.retainer_items
      FROM projects p
      WHERE p.user_id = ${scope.ws} AND p.company_id = ${scope.companyId} AND p.show_time_to_client
      ORDER BY p.is_retainer DESC, lower(p.name)
    `,
    sql`
      SELECT te.project_id, te.line_label, te.hours, te.entry_date::text AS entry_date
      FROM time_entries te
      JOIN projects p ON p.id = te.project_id
      WHERE p.user_id = ${scope.ws} AND p.company_id = ${scope.companyId} AND p.show_time_to_client
    `,
  ])
  return timeJson(projects, entries, now)
}

export function timeJson(projects, entries, now = new Date()) {
  const byProject = new Map()
  for (const e of entries) {
    if (!byProject.has(e.project_id)) byProject.set(e.project_id, [])
    byProject.get(e.project_id).push(e)
  }
  return projects.map(p => {
    const rows = byProject.get(p.id) || []
    const roles = new Map()
    for (const e of rows) {
      const label = String(e.line_label || '').trim() || 'Other'
      roles.set(label, (roles.get(label) || 0) + (parseFloat(e.hours) || 0))
    }
    const overall = p.is_retainer && p.retainer_start ? overallUsage(p, rows, now) : null
    const retainer = overall
      ? {
          months: monthlyUsage(p, rows, now).slice(-MONTHS_SHOWN).reverse()
            .map(m => ({ label: m.label, current: m.isCurrent, lines: m.lines.map(lineJson) })),
          overall: { months: overall.months, lines: overall.lines.map(lineJson) },
        }
      : null
    return {
      id: p.id,
      name: p.name,
      total: round(sumHours(rows)),
      roles: [...roles.entries()].sort((a, b) => b[1] - a[1]).map(([label, hours]) => ({ label, hours: round(hours) })),
      retainer,
    }
  })
}
