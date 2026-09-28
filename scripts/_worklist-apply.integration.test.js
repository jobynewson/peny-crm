// Writes an import plan to a real Postgres. Skipped unless
// SLATE_TEST_DATABASE_URL is set — see api/_test-db.js.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TEST_DB, connectTestDb } from '../api/_test-db.js'
import { workspaceId } from '../api/_api.js'
import { planImport } from './_worklist-sheet.js'
import { applyPlan, checkPlan } from './_worklist-apply.js'

const describeDb = TEST_DB ? describe : describe.skip
const COMPANY = 'ImportTest Co'
const rows = [
  { A: 'Products', B: 'Brief', C: 'Deliverables', D: 'Deadlines' },
  { A: 'Launch film', B: 'The launch', C: 'Hero film\nCan it be short?', D: '17th October' },
  { C: 'Cutdowns' },
  { A: 'Winter', B: 'Axes', C: 'Macro images', D: 'Cortex – 7th November' },
  { D: 'Apex – 1st December' },
  { A: 'Weekly', B: 'Editing', C: '1 video per week' },
]
let sql, ws

async function wipe() {
  await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE lower(name) = lower(${COMPANY}))`
  await sql`DELETE FROM companies WHERE lower(name) = lower(${COMPANY})`
}

describeDb('applying a worklist import', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_import_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
  })
  afterAll(async () => { await wipe(); await sql.end() })

  it('creates the company, its workstreams and deliverables in one go', async () => {
    const plan = planImport(rows, { year: 2026, visible: true, approved: ['Launch film'] })
    expect(checkPlan(plan)).toEqual([])
    const result = await applyPlan(sql, { ws, companyName: ` ${COMPANY} `, plan })
    expect(result).toMatchObject({ createdCompany: true, workstreams: 3, deliverables: 5, skipped: [] })

    const saved = await sql`
      SELECT w.title AS workstream, w.status AS ws_status, w.brief, w.sort_order AS ws_order, d.title, d.due_kind,
             d.due_date::text AS due_date, d.cadence, d.status, d.client_visible, d.sort_order, d.format
      FROM workstreams w JOIN deliverables d ON d.workstream_id = w.id
      JOIN companies c ON c.id = w.company_id
      WHERE c.name = ${COMPANY}
      ORDER BY w.sort_order, d.sort_order
    `
    expect(saved.map(r => [r.workstream, r.title, r.due_kind, r.due_date, r.status])).toEqual([
      ['Launch film', 'Hero film', 'exact', '2026-10-17', 'approved'],
      ['Launch film', 'Cutdowns', 'exact', '2026-10-17', 'approved'],
      ['Winter', 'Cortex', 'exact', '2026-11-07', 'planned'],
      ['Winter', 'Apex', 'exact', '2026-12-01', 'planned'],
      ['Weekly', '1 video per week', 'recurring', null, 'planned'],
    ])
    expect(saved[0]).toMatchObject({ ws_status: 'complete', brief: 'The launch\nFrom the client: Can it be short?' })
    expect(saved[4].cadence).toBe('weekly')
    expect(saved.every(r => r.client_visible)).toBe(true)
    expect(saved[2].format).toBe('Macro images')
  })

  it('is safe to run again: what the company already has is skipped', async () => {
    const plan = planImport(rows, { year: 2026 })
    const again = await applyPlan(sql, { ws, companyName: COMPANY.toUpperCase(), plan })
    expect(again).toMatchObject({ createdCompany: false, workstreams: 0, deliverables: 0, skipped: ['Launch film', 'Winter', 'Weekly'] })
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM deliverables d JOIN workstreams w ON w.id = d.workstream_id JOIN companies c ON c.id = w.company_id WHERE c.name = ${COMPANY}`
    expect(n).toBe(5)
  })

  it('writes nothing when the plan breaks a rule', async () => {
    const plan = planImport([...rows, { A: 'Broken', B: 'x', C: 'x'.repeat(400), D: '1st May' }], { year: 2026 })
    expect(checkPlan(plan)).toEqual(['Broken › ' + 'x'.repeat(400) + ': That title is too long'])
    await expect(applyPlan(sql, { ws, companyName: COMPANY, plan })).rejects.toThrow(/problems/)
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM workstreams w JOIN companies c ON c.id = w.company_id WHERE c.name = ${COMPANY}`
    expect(n).toBe(3)
  })
})
