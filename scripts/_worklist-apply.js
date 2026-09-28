// scripts/_worklist-apply.js
// Writes an import plan (from _worklist-sheet.js) for one company. Server-side
// only — run by scripts/import-worklist.js with the database credential.
//
//   checkPlan(plan)                     every problem, using the worklist rules;
//                                       nothing is written while there are any
//   currentState(sql, { ws, companyName }) the company (if it exists) and the
//                                       workstream titles it already has
//   applyPlan(sql, { ws, companyName, plan }) find-or-create the company, then
//                                       insert every new workstream and its
//                                       deliverables in ONE statement (all or
//                                       nothing). A workstream the company
//                                       already has (same title) is skipped, so
//                                       re-running is safe.

import { randomUUID } from 'node:crypto'
import { normaliseCompanyName } from '../api/_companies.js'
import { normaliseDue, validateDeliverableInput, validateWorkstreamInput } from '../api/_retainer-rules.js'

export function checkPlan(plan) {
  const problems = []
  for (const w of plan.workstreams) {
    const bad = validateWorkstreamInput({ title: w.title, brief: w.brief, status: w.status })
    if (bad) problems.push(`${w.title}: ${bad.message}`)
    for (const d of w.deliverables) {
      const badD = validateDeliverableInput({ title: d.title, format: d.format, status: d.status, client_visible: d.client_visible, internal_notes: d.internal_notes })
      if (badD) problems.push(`${w.title} › ${d.title}: ${badD.message}`)
      const due = normaliseDue(d.due)
      if (due.error) problems.push(`${w.title} › ${d.title}: ${due.error.message}`)
    }
  }
  return problems
}

export async function currentState(sql, { ws, companyName }) {
  const name = normaliseCompanyName(companyName)
  const [company] = await sql`SELECT id, name FROM companies WHERE user_id = ${ws} AND lower(name) = lower(${name}) LIMIT 1`
  const existing = company
    ? (await sql`SELECT title FROM workstreams WHERE company_id = ${company.id} AND user_id = ${ws}`).map(r => r.title.toLowerCase())
    : []
  return { company: company ?? null, existing: new Set(existing) }
}

export async function applyPlan(sql, { ws, companyName, plan }) {
  const problems = checkPlan(plan)
  if (problems.length) throw new Error(`The plan has problems:\n  ${problems.join('\n  ')}`)
  const name = normaliseCompanyName(companyName)
  if (!name) throw new Error('A company name is needed')

  let [company] = await sql`
    INSERT INTO companies (user_id, name) VALUES (${ws}, ${name})
    ON CONFLICT (user_id, lower(name)) DO NOTHING
    RETURNING id, name
  `
  const createdCompany = !!company
  if (!company) [company] = await sql`SELECT id, name FROM companies WHERE user_id = ${ws} AND lower(name) = lower(${name}) LIMIT 1`

  const { existing } = await currentState(sql, { ws, companyName: company.name })
  const fresh = plan.workstreams.filter(w => !existing.has(w.title.toLowerCase()))
  const skipped = plan.workstreams.filter(w => existing.has(w.title.toLowerCase())).map(w => w.title)
  if (!fresh.length) return { company, createdCompany, workstreams: 0, deliverables: 0, skipped }

  const [{ next }] = await sql`SELECT COALESCE(max(sort_order) + 1, 0)::int AS next FROM workstreams WHERE company_id = ${company.id}`
  const wsRows = fresh.map((w, i) => ({ id: randomUUID(), title: w.title, brief: w.brief, status: w.status, sort_order: next + i }))
  const dRows = fresh.flatMap((w, i) => w.deliverables.map((d, j) => {
    const due = normaliseDue(d.due)
    return {
      workstream_id: wsRows[i].id, title: d.title, format: d.format, due_kind: due.due_kind, due_date: due.due_date,
      due_label: due.due_label, cadence: due.cadence, status: d.status, client_visible: !!d.client_visible,
      internal_notes: d.internal_notes, sort_order: j,
    }
  }))

  // One statement, so an import is all or nothing.
  const [counts] = await sql`
    WITH new_ws AS (
      INSERT INTO workstreams (id, user_id, company_id, title, brief, status, sort_order)
      SELECT x.id, ${ws}, ${company.id}, x.title, x.brief, x.status::workstream_status, x.sort_order
      FROM json_to_recordset(${JSON.stringify(wsRows)}::json)
        AS x(id uuid, title text, brief text, status text, sort_order int)
      RETURNING id
    ), new_d AS (
      INSERT INTO deliverables (workstream_id, title, format, due_kind, due_date, due_label, cadence, status,
                                client_visible, internal_notes, sort_order)
      SELECT x.workstream_id, x.title, x.format, x.due_kind::deliverable_due_kind, x.due_date, x.due_label, x.cadence,
             x.status::deliverable_status, x.client_visible, x.internal_notes, x.sort_order
      FROM json_to_recordset(${JSON.stringify(dRows)}::json)
        AS x(workstream_id uuid, title text, format text, due_kind text, due_date date, due_label text, cadence text,
             status text, client_visible boolean, internal_notes text, sort_order int)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM new_ws)::int AS workstreams, (SELECT count(*) FROM new_d)::int AS deliverables
  `
  return { company, createdCompany, workstreams: counts.workstreams, deliverables: counts.deliverables, skipped }
}
