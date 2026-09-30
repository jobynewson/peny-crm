// Runs the urgent alerts against a real Postgres. Skipped unless
// SLATE_TEST_DATABASE_URL is set — see _test-db.js for setup. notify() is
// replaced by a recorder, so nothing is sent.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { TEST_DB, connectTestDb, setShowLeads } from './_test-db.js'

const sent = []
let outcome = r => ({ to: r.email, sent: true })
vi.mock('./_notify.js', async orig => ({
  ...(await orig()),
  notify: async (sql, { kind, to, subject, html }) => {
    const list = Array.isArray(to) ? to : [to]
    return list.map(r => {
      const result = outcome(r)
      if (result.sent) sent.push({ kind, to: r.email, subject, html })
      return result
    })
  },
}))

const { runTimedAlerts, alertNewRequest, alertChangesRequested, alertClientReply, loadRecipients } = await import('./_alerts.js')
const { workspaceId } = await import('./_api.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, ana, lee, boss, co, stream, paused

const NOON = new Date('2026-09-29T11:00:00Z')            // 12:00 BST, Tuesday
const daysFrom = n => new Date(Date.UTC(2026, 8, 29 + n)).toISOString().slice(0, 10)
const ago = days => new Date(NOON.getTime() - days * 86400000).toISOString()

async function deliverable(over = {}) {
  const d = { title: 'Reel', owner: ana.id, due: null, status: 'planned', since: null, workstream: stream.id, ...over }
  const [row] = await sql`
    INSERT INTO deliverables (workstream_id, title, owner_id, due_date, status, waiting_since, waiting_note)
    VALUES (${d.workstream}, ${d.title}, ${d.owner}, ${d.due}, ${d.status}::deliverable_status, ${d.since},
            ${d.status === 'waiting_on_client' ? 'Ship date' : null})
    RETURNING id`
  return row.id
}

describeDb('urgent alerts', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_alert_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await setShowLeads(sql, true)   // these tests are about lead routing
    await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'AlertTest %')`
    await sql`DELETE FROM companies WHERE name LIKE 'AlertTest %'`
    await sql`DELETE FROM app_users WHERE clerk_id LIKE 'alert_%'`
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('alert_ana', 'ana@alert.test', 'Ana', 'user') RETURNING id, clerk_id, email, name`
    ;[lee] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('alert_lee', 'lee@alert.test', 'Lee', 'user') RETURNING id, clerk_id, email, name`
    ;[boss] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('alert_boss', 'boss@alert.test', 'Boss', 'superadmin') RETURNING id, clerk_id, email, name`
    ;[co] = await sql`INSERT INTO companies (user_id, name, lead_id) VALUES (${ws}, 'AlertTest DMM', ${lee.id}) RETURNING id`
    ;[stream] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${co.id}, 'Monthly') RETURNING id`
    ;[paused] = await sql`INSERT INTO workstreams (user_id, company_id, title, status) VALUES (${ws}, ${co.id}, 'Old', 'paused') RETURNING id`
  })
  beforeEach(async () => {
    sent.length = 0
    outcome = r => ({ to: r.email, sent: true })
    await sql`DELETE FROM deliverables WHERE workstream_id IN (${stream.id}, ${paused.id})`
    await sql`DELETE FROM alert_log`
    await sql`UPDATE companies SET lead_id = ${lee.id} WHERE id = ${co.id}`
  })
  afterAll(async () => {
    await setShowLeads(sql, false)
    await sql`DELETE FROM alert_log`
    await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'AlertTest %')`
    await sql`DELETE FROM companies WHERE name LIKE 'AlertTest %'`
    await sql`DELETE FROM app_users WHERE clerk_id LIKE 'alert_%'`
  })

  describe('who hears', () => {
    it('the owner, else the lead, else every superadmin', async () => {
      expect((await loadRecipients(sql, { ownerId: ana.id, companyId: co.id })).to.map(p => p.email)).toEqual(['ana@alert.test'])
      expect((await loadRecipients(sql, { ownerId: null, companyId: co.id })).to.map(p => p.email)).toEqual(['lee@alert.test'])
      await sql`UPDATE companies SET lead_id = NULL WHERE id = ${co.id}`
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const r = await loadRecipients(sql, { ownerId: null, companyId: co.id })
      expect(r.via).toBe('superadmins')
      expect(r.to.map(p => p.email)).toContain('boss@alert.test')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no owner or lead'))
      warn.mockRestore()
    })

    it('with leads off, a lead is ignored and the superadmins hear instead', async () => {
      await setShowLeads(sql, false)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const r = await loadRecipients(sql, { ownerId: null, companyId: co.id })
        expect(r.via).toBe('superadmins')
        expect(r.to.map(p => p.email)).toContain('boss@alert.test')
        expect(r.to.map(p => p.email)).not.toContain('lee@alert.test')
        // The owner still comes first.
        expect((await loadRecipients(sql, { ownerId: ana.id, companyId: co.id })).to.map(p => p.email)).toEqual(['ana@alert.test'])
        // Nothing was cleared: turning leads back on brings Lee back.
        await setShowLeads(sql, true)
        expect((await loadRecipients(sql, { ownerId: null, companyId: co.id })).to.map(p => p.email)).toEqual(['lee@alert.test'])
      } finally { await setShowLeads(sql, true); warn.mockRestore() }
    })
  })

  describe('immediate alerts', () => {
    it('a new request goes to the company lead', async () => {
      await alertNewRequest(sql, {
        companyName: 'AlertTest DMM',
        request: { id: '11111111-1111-4111-8111-111111111111', company_id: co.id, title: 'Cut-down', detail: null, wanted_by: null, submitted_by_name: 'Sam' },
      })
      expect(sent.map(s => [s.kind, s.to])).toEqual([['alert_new_request', 'lee@alert.test']])
    })
    it('changes requested and a reply go to the owner, or the lead when there is none', async () => {
      const owned = await deliverable()
      const unowned = await deliverable({ owner: null })
      await alertChangesRequested(sql, { deliverableId: owned, comment: 'Bigger logo', by: 'Sam' })
      await alertClientReply(sql, { deliverableId: unowned, reply: 'Shipped', by: 'Sam' })
      expect(sent.map(s => [s.kind, s.to])).toEqual([
        ['alert_changes_requested', 'ana@alert.test'],
        ['alert_client_reply', 'lee@alert.test'],
      ])
      expect(sent[0].html).toContain('Bigger logo')
    })
    it('a deliverable that has gone says nothing and throws nothing', async () => {
      expect(await alertChangesRequested(sql, { deliverableId: '22222222-2222-4222-8222-222222222222', comment: 'x' })).toEqual([])
    })
  })

  describe('due within 48 hours', () => {
    it('alerts the owner once for what is due inside two days and not in review', async () => {
      await deliverable({ title: 'Today', due: daysFrom(0) })
      await deliverable({ title: 'Tomorrow', due: daysFrom(1), status: 'in_progress' })
      await deliverable({ title: 'Day after', due: daysFrom(2), status: 'waiting_on_client', since: ago(1) })
      await deliverable({ title: 'Changes', due: daysFrom(1), status: 'changes_requested' })
      await deliverable({ title: 'Too far', due: daysFrom(3) })
      await deliverable({ title: 'Late', due: daysFrom(-1) })
      await deliverable({ title: 'In review', due: daysFrom(1), status: 'in_review' })
      await deliverable({ title: 'Approved', due: daysFrom(1), status: 'approved' })
      await deliverable({ title: 'Undated' })
      await deliverable({ title: 'Paused stream', due: daysFrom(1), workstream: paused.id })

      const first = await runTimedAlerts(sql, { now: NOON })
      expect(first).toEqual({ due_soon: 4, input_overdue: 0 })
      const subjects = sent.map(s => s.subject).join('\n')
      for (const t of ['Today', 'Tomorrow', 'Day after', 'Changes']) expect(subjects).toContain(t)
      for (const t of ['Too far', 'Late', 'In review', 'Approved', 'Undated', 'Paused']) expect(subjects).not.toContain(t)
      expect(new Set(sent.map(s => s.to))).toEqual(new Set(['ana@alert.test']))

      // the next hourly run: nothing again
      sent.length = 0
      expect(await runTimedAlerts(sql, { now: new Date(NOON.getTime() + 3600000) })).toEqual({ due_soon: 0, input_overdue: 0 })
      expect(sent).toEqual([])
    })
    it('starts over when the due date moves', async () => {
      const id = await deliverable({ due: daysFrom(1) })
      await runTimedAlerts(sql, { now: NOON })
      expect(sent).toHaveLength(1)
      await sql`UPDATE deliverables SET due_date = ${daysFrom(2)} WHERE id = ${id}`
      await runTimedAlerts(sql, { now: NOON })
      expect(sent).toHaveLength(2)
    })
    it('goes to the lead when the deliverable has no owner', async () => {
      await deliverable({ owner: null, due: daysFrom(1) })
      await runTimedAlerts(sql, { now: NOON })
      expect(sent.map(s => s.to)).toEqual(['lee@alert.test'])
    })
  })

  describe('client input overdue', () => {
    it('alerts once when an item has waited seven days, not before', async () => {
      await deliverable({ title: 'Eight days', status: 'waiting_on_client', since: ago(8) })
      await deliverable({ title: 'Six days', status: 'waiting_on_client', since: ago(6) })
      expect(await runTimedAlerts(sql, { now: NOON })).toEqual({ due_soon: 0, input_overdue: 1 })
      expect(sent[0].subject).toContain('Eight days')
      sent.length = 0
      await runTimedAlerts(sql, { now: new Date(NOON.getTime() + 86400000) })   // "not daily"
      expect(sent.map(s => s.subject).join()).not.toContain('Eight days')
    })
    it('uses CLIENT_INPUT_ALERT_DAYS', async () => {
      await deliverable({ status: 'waiting_on_client', since: ago(4) })
      expect((await runTimedAlerts(sql, { now: NOON, env: { CLIENT_INPUT_ALERT_DAYS: '3' } })).input_overdue).toBe(1)
    })
    it('starts over when the item goes back to waiting', async () => {
      const id = await deliverable({ status: 'waiting_on_client', since: ago(9) })
      await runTimedAlerts(sql, { now: NOON })
      expect(sent).toHaveLength(1)
      await sql`UPDATE deliverables SET waiting_since = ${ago(8)} WHERE id = ${id}`
      await runTimedAlerts(sql, { now: NOON })
      expect(sent).toHaveLength(2)
    })
  })

  describe('sending', () => {
    it('does nothing outside 07:00–20:00 London, and sends it all at the next window', async () => {
      await deliverable({ due: daysFrom(1) })
      expect(await runTimedAlerts(sql, { now: new Date('2026-09-29T02:00:00Z') })).toEqual({ skipped: 'quiet_hours' })
      expect(sent).toEqual([])
      expect((await runTimedAlerts(sql, { now: new Date('2026-09-29T06:00:00Z') })).due_soon).toBe(1)
    })
    it('a failed send is tried again on the next run', async () => {
      await deliverable({ due: daysFrom(1) })
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      outcome = r => ({ to: r.email, error: 'Gmail said no' })
      expect((await runTimedAlerts(sql, { now: NOON })).due_soon).toBe(0)
      outcome = r => ({ to: r.email, sent: true })
      expect((await runTimedAlerts(sql, { now: NOON })).due_soon).toBe(1)
      err.mockRestore()
    })
    it('someone who muted it is not asked again', async () => {
      await deliverable({ due: daysFrom(1) })
      outcome = r => ({ to: r.email, skipped: 'setting' })
      await runTimedAlerts(sql, { now: NOON })
      outcome = r => ({ to: r.email, sent: true })
      await runTimedAlerts(sql, { now: NOON })
      expect(sent).toEqual([])
    })
    it('two runs at once send it once', async () => {
      await deliverable({ due: daysFrom(1) })
      await Promise.all([runTimedAlerts(sql, { now: NOON }), runTimedAlerts(sql, { now: NOON })])
      expect(sent).toHaveLength(1)
    })
  })
})
