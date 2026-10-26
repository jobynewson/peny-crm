// What the portal's Time section is built from: totals only, and a retainer's
// months against its allocation. The queries start from the signed-in scope and
// never select who logged an entry or its note.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { timeJson } from './_client-time.js'

const SOURCE = fs.readFileSync(new URL('./_client-time.js', import.meta.url), 'utf8')
const QUERIES = [...SOURCE.matchAll(/sql`([\s\S]*?)`/g)].map(m => m[1])

describe('_client-time.js queries', () => {
  it('found both queries', () => expect(QUERIES).toHaveLength(2))

  it('carry the scope and only shared projects', () => {
    for (const q of QUERIES) {
      expect(q, q).toMatch(/\$\{scope\.ws\}/)
      expect(q, q).toMatch(/\$\{scope\.companyId\}/)
      expect(q, q).toMatch(/show_time_to_client/)
      for (const [, expr] of q.matchAll(/\$\{([^}]*)\}/g)) expect(expr, q).toMatch(/^scope\.(ws|companyId)$/)
    }
  })

  it('never selects who logged time or the notes', () => {
    for (const q of QUERIES) {
      expect(q, q).not.toMatch(/crew_name|\bnote\b|budget_id|\bSELECT\s+\*|\w\.\*/i)
    }
  })
})

describe('timeJson', () => {
  const entries = [
    { project_id: 'a', line_label: 'Editing', hours: '3.50', entry_date: '2026-10-02' },
    { project_id: 'a', line_label: 'Editing', hours: '1.00', entry_date: '2026-10-05' },
    { project_id: 'a', line_label: 'Grade', hours: '2.00', entry_date: '2026-09-20' },
    { project_id: 'b', line_label: 'Other project', hours: '9', entry_date: '2026-10-01' },
  ]

  it('totals hours by role, biggest first, per project', () => {
    const [p] = timeJson([{ id: 'a', name: 'Film', is_retainer: false }], entries)
    expect(p.total).toBe(6.5)
    expect(p.roles).toEqual([{ label: 'Editing', hours: 4.5 }, { label: 'Grade', hours: 2 }])
    expect(p.retainer).toBeNull()
  })

  it('gives a retainer its months, oldest first, against the allocation, with contract and window', () => {
    const retainer = { id: 'a', name: 'Retainer', is_retainer: true, retainer_start: '2026-09-01', retainer_hours: null,
      retainer_items: [{ label: 'Editing', unit: 'hours', qty: 10, period: 'month' }] }
    const [p] = timeJson([retainer], entries, new Date('2026-10-15'))
    expect(p.retainer.months.map(m => m.label)).toEqual(['Sep 26', 'Oct 26'])
    expect(p.retainer.months[1].current).toBe(true)
    expect(p.retainer.months[1].lines[0]).toEqual({ label: 'Editing', logged: 4.5, allocated: 10, level: 'ok' })
    expect(p.retainer.overall.months).toBe(2)
    expect(p.retainer.contract).toEqual([{ label: 'Editing', hours: 10, period: 'month' }])
    expect(p.retainer.window).toMatchObject({ start: '2026-09-01', end: '2027-08-31', month: 2, complete: false })
  })

  it('carries nothing but totals', () => {
    const json = JSON.stringify(timeJson([{ id: 'a', name: 'Film', is_retainer: false }], [{ ...entries[0], crew_name: 'Sam', note: 'secret' }]))
    expect(json).not.toMatch(/Sam|secret/)
  })
})
