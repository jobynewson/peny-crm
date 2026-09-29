// The client view's rules, checked by reading its source: every query carries
// the scope itself, and none names an internal column. Plus the shaping —
// client labels, nothing internal, who can answer what.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { worklistJson, requestsJson } from './_client-view.js'

const SOURCE = fs.readFileSync(new URL('./_client-view.js', import.meta.url), 'utf8')
const QUERIES = [...SOURCE.matchAll(/sql`([\s\S]*?)`/g)].map(m => m[1])

describe('_client-view.js queries', () => {
  it('found the queries', () => {
    expect(QUERIES.length).toBeGreaterThanOrEqual(14)
  })

  it('every query carries the scope itself', () => {
    for (const q of QUERIES) {
      expect(q, q).toMatch(/\$\{scope\.ws\}/)
      // Worklist, project and company data is always tied to the company or
      // the project; only the studio's own name and website are workspace-wide.
      if (!/FROM settings s/.test(q)) expect(q, q).toMatch(/\$\{scope\.(companyId|projectId)\}/)
      // Nothing from outside the scope is interpolated.
      for (const [, expr] of q.matchAll(/\$\{([^}]*)\}/g)) expect(expr, q).toMatch(/^scope\.(ws|companyId|projectId)$/)
    }
  })

  it('never selects an internal column', () => {
    for (const q of QUERIES) {
      expect(q, q).not.toMatch(/\bSELECT\s+\*|\w\.\*/i)
      for (const col of ['internal_notes', 'owner_id', 'sent_by', 'waiting_since', 'portal_token', 'clerk_org_id']) {
        expect(q, `${col} in: ${q}`).not.toContain(col)
      }
      // responded_by is only used to tell whether Peny recorded the answer.
      expect(q.replace('u.clerk_id = dv.responded_by)', ''), q).not.toMatch(/responded_by\b(?!_name)/)
    }
  })

  it('only shows deliverables the client may see', () => {
    for (const q of QUERIES.filter(q => /FROM (deliverables|deliveries) /.test(q))) expect(q, q).toMatch(/d\.client_visible/)
    for (const q of QUERIES.filter(q => /FROM workstreams w\s+WHERE/.test(q) && /SELECT w\.id/.test(q))) {
      expect(q, q).toMatch(/EXISTS \(SELECT 1 FROM deliverables d WHERE d\.workstream_id = w\.id AND d\.client_visible\)/)
    }
  })
})

describe('worklistJson', () => {
  const today = '2026-09-28'
  const base = {
    workstreams: [{ id: 'w1', title: 'Launch', brief: 'Autumn', status: 'active' }],
    deliverables: [
      { id: 'd1', workstream_id: 'w1', title: 'Hero film', format: '16:9', due_kind: 'exact', due_date: '2026-10-02', due_label: null, cadence: null, status: 'in_review', waiting_note: null },
      { id: 'd2', workstream_id: 'w1', title: 'Stills', format: null, due_kind: 'window', due_date: '2026-10-07', due_label: '1st week of October', cadence: null, status: 'waiting_on_client', waiting_note: 'Logo files' },
      { id: 'd3', workstream_id: 'w1', title: 'Cutdowns', format: null, due_kind: 'month', due_date: '2026-11-30', due_label: null, cadence: null, status: 'changes_requested', waiting_note: null },
    ],
    rounds: [
      { id: 'r1', deliverable_id: 'd1', round: 1, url: 'https://f.io/a', note: null, sent_at: 't1', client_response: 'pending', client_comment: null, responded_at: null, responded_by_name: null, recorded: false },
      { id: 'r2', deliverable_id: 'd1', round: 2, url: 'https://f.io/b', note: 'v2', sent_at: 't2', client_response: 'pending', client_comment: null, responded_at: null, responded_by_name: null, recorded: false },
      { id: 'r3', deliverable_id: 'd3', round: 1, url: 'https://example.com/c', note: null, sent_at: 't3', client_response: 'changes_requested', client_comment: 'Brighter', responded_at: 't4', responded_by_name: 'Ana Silva', recorded: true },
    ],
    today,
  }

  it('speaks the client\'s language', () => {
    const [w] = worklistJson({ ...base, canRespond: true })
    expect(w.deliverables.map(d => [d.title, d.status, d.status_label, d.due])).toEqual([
      ['Hero film', 'ready_for_review', 'Ready for review', 'Fri 2 Oct'],
      ['Stills', 'waiting_on_you', 'Waiting on you', '1st week of October'],
      ['Cutdowns', 'in_progress', 'In progress', 'November'],
    ])
    expect(w.deliverables[1].waiting_for).toBe('Logo files')
    expect(w.deliverables[0].waiting_for).toBeNull()
    // Internal status names never leave; nor does the name of whoever at Peny
    // recorded an answer.
    const json = JSON.stringify(w)
    for (const internal of ['"in_review"', '"waiting_on_client"', 'Ana Silva']) expect(json).not.toContain(internal)
  })

  it('offers an answer only on the latest unanswered round, and only if the scope can', () => {
    const [w] = worklistJson({ ...base, canRespond: true })
    expect(w.deliverables[0].rounds.map(r => [r.round, r.response, r.response_label, r.can_respond])).toEqual([
      [1, 'superseded', 'Superseded', false],
      [2, 'pending', 'Awaiting response', true],
    ])
    const [readOnly] = worklistJson({ ...base, canRespond: false })
    expect(readOnly.deliverables.flatMap(d => d.rounds).some(r => r.can_respond)).toBe(false)
  })

  it('says an answer Peny recorded was recorded, without naming who', () => {
    const [w] = worklistJson({ ...base, canRespond: true })
    expect(w.deliverables[2].rounds[0]).toMatchObject({ response: 'changes_requested', comment: 'Brighter', answered_by: null, recorded_by_studio: true })
  })
})

describe('requestsJson', () => {
  const today = '2026-09-28'
  const row = over => ({
    id: 'q1', title: 'Cut-down', detail: 'See https://x.test', wanted_by: '2026-10-30', status: 'new', decline_note: null,
    submitted_by_name: 'Sam', created_at: 't1', deliverable_id: null, due_kind: null, due_date: null, due_label: null,
    cadence: null, deliverable_status: null, ...over,
  })

  it('reads Submitted, Accepted and Declined', () => {
    const [a, b, c] = requestsJson([
      row(),
      row({ id: 'q2', status: 'accepted', deliverable_id: 'd9', due_kind: 'exact', due_date: '2026-10-09', deliverable_status: 'in_progress' }),
      row({ id: 'q3', status: 'declined', decline_note: 'Outside this retainer.' }),
    ], today)
    expect([a.status, a.status_label]).toEqual(['submitted', 'Submitted'])
    expect([b.status, b.status_label]).toEqual(['accepted', 'Accepted'])
    expect([c.status, c.status_label, c.note]).toEqual(['declined', 'Declined', 'Outside this retainer.'])
  })

  it('an accepted request carries the date we gave it and where it sits', () => {
    const [r] = requestsJson([row({ status: 'accepted', deliverable_id: 'd9', due_kind: 'exact', due_date: '2026-10-09', deliverable_status: 'in_progress' })], today)
    expect(r.accepted).toEqual({ deliverable_id: 'd9', due: 'Fri 9 Oct', status_label: 'In progress' })
  })

  it('accepted but not shown to the client reads as accepted, with nothing to link to', () => {
    const [r] = requestsJson([row({ status: 'accepted' })], today)
    expect(r.status_label).toBe('Accepted')
    expect(r.accepted).toBeNull()
  })

  it('only a declined request shows a note, and nothing internal leaves', () => {
    const [r] = requestsJson([row({ decline_note: 'stale note left over' })], today)
    expect(r.note).toBeNull()
    expect(Object.keys(r).sort()).toEqual(['accepted', 'detail', 'id', 'note', 'sent_at', 'sent_by', 'status', 'status_label', 'title', 'wanted_by'])
  })
})
