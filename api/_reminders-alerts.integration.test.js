// The hourly alerts job and the digest's approvals section, through the real
// cron handler (api/reminders.js) against a real Postgres. Skipped unless
// SLATE_TEST_DATABASE_URL is set — see _test-db.js. The Neon driver is
// replaced by the test database; notify() is a recorder.

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let DB = null
vi.mock('@neondatabase/serverless', () => ({ neon: () => DB }))
vi.mock('./google.js', () => ({ syncLeaveRequestGoogle: async () => {} }))
const mails = []
vi.mock('./_notify.js', async orig => ({
  ...(await orig()),
  mailConfigured: () => true,
  notify: async (sql, { kind, to, subject, html }) => {
    const list = Array.isArray(to) ? to : [to]
    return list.map(r => { mails.push({ kind, to: r.email, subject, html }); return { to: r.email, sent: true } })
  },
}))

const { default: handler } = await import('./reminders.js')
const { workspaceId } = await import('./_api.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, ana, lee, boss, co, stream

const run = async (type, headers = { authorization: 'Bearer cron-secret' }) => {
  const res = fakeRes()
  await handler({ method: 'GET', url: `/api/reminders?type=${type}`, query: { type }, headers }, res)
  return res
}
// The tests' calendar is a year ahead of any real date, so rows other suites leave
// behind can never fall inside a window here.
// The superadmins' roundup (a separate, opt-in email) is not the digest.
const digests = () => mails.filter(m => !m.subject.includes('roundup'))
const at = iso => vi.setSystemTime(new Date(iso))

async function approve(title, { owner = ana.id, when, round = 1, by = 'Dana Client', recordedBy = 'user_rm_dana' }) {
  const [d] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible, owner_id) VALUES (${stream.id}, ${title}, 'approved', true, ${owner}) RETURNING id`
  await sql`INSERT INTO deliveries (deliverable_id, url, round, client_response, responded_at, responded_by, responded_by_name)
    VALUES (${d.id}, 'https://f.io/x', ${round}, 'approved', ${when}, ${recordedBy}, ${by})`
  return d.id
}

describeDb('the alerts job and the digest', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    DB = sql
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_rm_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'RmTest %')`
    await sql`DELETE FROM companies WHERE name LIKE 'RmTest %'`
    await sql`DELETE FROM app_users WHERE clerk_id LIKE 'rm_%'`
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('rm_ana', 'ana@rm.test', 'Ana', 'user') RETURNING id`
    ;[lee] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('rm_lee', 'lee@rm.test', 'Lee', 'user') RETURNING id`
    ;[boss] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('rm_boss', 'boss@rm.test', 'Boss', 'superadmin') RETURNING id`
    ;[co] = await sql`INSERT INTO companies (user_id, name, lead_id) VALUES (${ws}, 'RmTest DMM', ${lee.id}) RETURNING id`
    ;[stream] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${co.id}, 'Monthly') RETURNING id`
  })
  beforeEach(async () => {
    mails.length = 0
    process.env.CRON_SECRET = 'cron-secret'
    vi.useFakeTimers({ toFake: ['Date'] })
    await sql`DELETE FROM deliverables WHERE workstream_id = ${stream.id}`
    await sql`DELETE FROM alert_log`
    await sql`DELETE FROM tasks WHERE title LIKE 'RmTest %'`
  })
  afterEach(() => { vi.useRealTimers() })
  afterAll(async () => {
    delete process.env.CRON_SECRET
    await sql`DELETE FROM alert_log`
    await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'RmTest %')`
    await sql`DELETE FROM companies WHERE name LIKE 'RmTest %'`
    await sql`DELETE FROM app_users WHERE clerk_id LIKE 'rm_%'`
    await sql.end()
  })

  describe('type=alerts', () => {
    it('will not run without CRON_SECRET, or with the wrong one', async () => {
      at('2027-09-28T11:00:00Z')
      await sql`INSERT INTO deliverables (workstream_id, title, owner_id, due_date, status) VALUES (${stream.id}, 'Reel', ${ana.id}, '2027-09-29', 'planned')`
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      delete process.env.CRON_SECRET
      const open = await run('alerts', {})
      expect([open.statusCode, open.body.error]).toEqual([503, 'CRON_SECRET is not set'])
      process.env.CRON_SECRET = 'cron-secret'
      expect((await run('alerts', {})).statusCode).toBe(401)
      expect((await run('alerts', { authorization: 'Bearer nope' })).statusCode).toBe(401)
      err.mockRestore()
      expect(mails).toEqual([])
    })

    it('sends the due-soon alert, once, on a weekday', async () => {
      at('2027-09-28T11:00:00Z')   // Tuesday, 12:00 London
      await sql`INSERT INTO deliverables (workstream_id, title, owner_id, due_date, status) VALUES (${stream.id}, 'Reel', ${ana.id}, '2027-09-30', 'planned')`
      const first = await run('alerts')
      expect(first.body).toMatchObject({ ok: true, due_soon: 1, input_overdue: 0 })
      expect(mails.map(m => [m.kind, m.to])).toEqual([['alert_due_soon', 'ana@rm.test']])
      mails.length = 0
      expect((await run('alerts')).body.due_soon).toBe(0)
      expect(mails).toEqual([])
    })

    it('runs on a Saturday too — a Monday deadline is worth a weekend email', async () => {
      at('2027-10-02T11:00:00Z')   // Saturday
      await sql`INSERT INTO deliverables (workstream_id, title, owner_id, due_date, status) VALUES (${stream.id}, 'Reel', ${ana.id}, '2027-10-04', 'planned')`
      expect((await run('alerts')).body).toMatchObject({ ok: true, due_soon: 1 })
    })

    it('sleeps overnight and sends at 07:00', async () => {
      await sql`INSERT INTO deliverables (workstream_id, title, owner_id, due_date, status) VALUES (${stream.id}, 'Reel', ${ana.id}, '2027-09-30', 'planned')`
      at('2027-09-28T21:30:00Z')   // 22:30 London
      expect((await run('alerts')).body).toMatchObject({ ok: true, skipped: 'quiet_hours' })
      expect(mails).toEqual([])
      at('2027-09-29T06:00:00Z')   // 07:00 London
      expect((await run('alerts')).body.due_soon).toBe(1)
    })

    it('alerts on client input that has waited a week, once', async () => {
      at('2027-09-28T11:00:00Z')
      await sql`INSERT INTO deliverables (workstream_id, title, owner_id, status, waiting_since, waiting_note) VALUES (${stream.id}, 'Stills', ${ana.id}, 'waiting_on_client', '2027-09-19T09:00:00Z', 'Logo')`
      expect((await run('alerts')).body.input_overdue).toBe(1)
      expect((await run('alerts')).body.input_overdue).toBe(0)
      expect(mails.map(m => m.kind)).toEqual(['alert_input_overdue'])
    })
  })

  describe('the digest', () => {
    it('carries what was approved since the last one, to the owner — and to the lead when there was no owner', async () => {
      at('2027-09-29T09:00:10Z')   // Wednesday's run: window is Tue 09:00 - Wed 09:00
      await approve('Owned reel', { when: '2027-09-28T15:00:00Z' })
      await approve('Unowned stills', { when: '2027-09-29T08:30:00Z', owner: null })
      await approve('Too early', { when: '2027-09-28T08:59:00Z' })
      await approve('Too late (next digest)', { when: '2027-09-29T09:00:05Z' })
      await run('deliverables')
      const byTo = Object.fromEntries(digests().map(m => [m.to, m]))
      expect(Object.keys(byTo).sort()).toEqual(['ana@rm.test', 'lee@rm.test'])
      expect(byTo['ana@rm.test'].subject).toBe('✅ 1 approved since your last digest')
      expect(byTo['ana@rm.test'].html).toContain('Approved since your last digest')
      expect(byTo['ana@rm.test'].html).toContain('Owned reel')
      expect(byTo['ana@rm.test'].html).not.toContain('Unowned stills')
      expect(byTo['lee@rm.test'].html).toContain('Unowned stills')
      for (const m of digests()) { expect(m.html).not.toContain('Too early'); expect(m.html).not.toContain('Too late') }
      expect(digests().every(m => m.kind === 'due_digest')).toBe(true)
    })

    it('on a Monday covers the weekend', async () => {
      at('2027-09-27T09:00:10Z')   // Monday: window is Fri 09:00 - Mon 09:00
      await approve('Saturday approval', { when: '2027-09-25T10:00:00Z' })
      await approve('Friday morning', { when: '2027-09-24T10:00:00Z' })
      await approve('Thursday', { when: '2027-09-23T10:00:00Z' })
      await run('deliverables')
      const html = digests().map(m => m.html).join()
      expect(html).toContain('Saturday approval')
      expect(html).toContain('Friday morning')
      expect(html).not.toContain('Thursday')
    })

    it('adds the section to the email of someone who also has things due', async () => {
      at('2027-09-29T09:00:10Z')
      await sql`INSERT INTO deliverables (workstream_id, title, owner_id, due_date, status) VALUES (${stream.id}, 'Due soon reel', ${ana.id}, '2027-09-30', 'planned')`
      await approve('Owned reel', { when: '2027-09-28T15:00:00Z' })
      await run('deliverables')
      const ana1 = digests().find(m => m.to === 'ana@rm.test')
      expect(digests().filter(m => m.to === 'ana@rm.test')).toHaveLength(1)
      expect(ana1.subject).toContain('due soon')
      expect(ana1.html).toContain('Due soon reel')
      expect(ana1.html).toContain('Approved since your last digest')
    })

    it('sends nothing extra when nothing was approved', async () => {
      at('2027-09-29T09:00:10Z')
      await run('deliverables')
      expect(mails.filter(m => m.html.includes('Approved since your last digest'))).toEqual([])
    })
  })
})
