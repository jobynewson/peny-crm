// A worklist that belongs to a project, including one with no company: the
// project's page, the counts, attaching older company-level workstreams, where
// the company comes from (the project, read live), and every place that used to
// join workstreams to companies. Runs against a real Postgres; skipped unless
// SLATE_TEST_DATABASE_URL is set (_test-db.js).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes, setShowLeads } from './_test-db.js'

let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT
    ? { user: CURRENT }
    : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))
vi.mock('./_notify.js', async orig => ({ ...(await orig()), notify: async (sql, { to }) => [{ to: to.email, sent: true }] }))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES } = await import('./_retainers.js')
const { loadRecipients, loadDeliverableContext } = await import('./_alerts.js')
const { fetchDueSources, collectDue } = await import('./_due-feed.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, ana, boss, dmm, other

const call = async (method, route, body, query = {}) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route, ...query }, body, headers: {} }, res, { name: 'retainers', routes: ROUTES, sql })
  return res
}

async function wipe() {
  await sql`DELETE FROM requests WHERE user_id = ${ws}`
  await sql`DELETE FROM workstreams WHERE user_id = ${ws} AND title LIKE 'PW %'`
  await sql`DELETE FROM projects WHERE user_id = ${ws} AND name LIKE 'PW %'`
  await sql`DELETE FROM companies WHERE name LIKE 'PW %'`
  await sql`DELETE FROM contacts WHERE last_name = 'PWLee'`
}
const project = async (name, companyId = null, extra = {}) =>
  (await sql`INSERT INTO projects (user_id, name, company_id, is_retainer) VALUES (${ws}, ${name}, ${companyId}, ${!!extra.retainer}) RETURNING id`)[0]

describeDb('worklists that belong to a project', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_pw_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await sql`DELETE FROM app_users WHERE clerk_id IN ('pw_ana', 'pw_boss')`
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('pw_ana', 'ana@pw.test', 'Ana', 'user') RETURNING id, clerk_id, email, name, role`
    ;[boss] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('pw_boss', 'boss@pw.test', 'Boss', 'superadmin') RETURNING id, clerk_id, email, name, role`
    await wipe()
    ;[dmm] = await sql`INSERT INTO companies (user_id, name) VALUES (${ws}, 'PW DMM') RETURNING id`
    ;[other] = await sql`INSERT INTO companies (user_id, name) VALUES (${ws}, 'PW Other') RETURNING id`
  })
  afterAll(async () => {
    await wipe()
    await sql`DELETE FROM app_users WHERE clerk_id IN ('pw_ana', 'pw_boss')`
    await setShowLeads(sql, false)
    await sql.end()
  })
  beforeEach(async () => { CURRENT = ana; await sql`DELETE FROM requests WHERE user_id = ${ws}`; await sql`DELETE FROM workstreams WHERE user_id = ${ws} AND title LIKE 'PW %'` })

  it('makes a workstream for a project with no company, and stores no company on it', async () => {
    const p = await project('PW Shoot and edit')
    const r = await call('POST', 'retainers/workstreams', { project_id: p.id, title: 'PW Edit days' })
    expect(r.statusCode).toBe(201)
    expect(r.body.workstream).toMatchObject({ project_id: p.id, company_id: null, project_name: 'PW Shoot and edit' })
    const [row] = await sql`SELECT company_id FROM workstream_company WHERE workstream_id = ${r.body.workstream.id}`
    expect(row.company_id).toBeNull()
  })

  it('needs a project or a company, and refuses a project that is not in the workspace', async () => {
    expect((await call('POST', 'retainers/workstreams', { title: 'PW x' })).body.error.field).toBe('project_id')
    expect((await call('POST', 'retainers/workstreams', { project_id: 'nope', title: 'PW x' })).body.error.field).toBe('project_id')
    expect((await call('POST', 'retainers/workstreams', { project_id: '11111111-1111-4111-8111-111111111111', title: 'PW x' })).body.error.field).toBe('project_id')
  })

  it('will not take a project workstream out of its project', async () => {
    const p = await project('PW Keep')
    const { body } = await call('POST', 'retainers/workstreams', { project_id: p.id, title: 'PW Keep me' })
    const r = await call('PATCH', `retainers/workstreams/${body.workstream.id}`, { project_id: null })
    expect(r.statusCode).toBe(422)
    expect(r.body.error.field).toBe('project_id')
  })

  it('gives the project page: its workstreams and deliverables, the company, and what can be attached', async () => {
    const p = await project('PW Retainer', dmm.id, { retainer: true })
    const { body } = await call('POST', 'retainers/workstreams', { project_id: p.id, title: 'PW Monthly' })
    await call('POST', 'retainers/deliverables', { workstream_id: body.workstream.id, title: 'Reel', owner_id: ana.id })
    await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${dmm.id}, 'PW Older')`

    const r = await call('GET', `retainers/projects/${p.id}`)
    expect(r.statusCode).toBe(200)
    expect(r.body.project).toMatchObject({ id: p.id, name: 'PW Retainer', is_retainer: true, has_link: false, portal_emails: [] })
    expect(r.body.company).toMatchObject({ id: dmm.id, name: 'PW DMM', portal: false })
    expect(r.body.workstreams.map(w => w.title)).toEqual(['PW Monthly'])
    expect(r.body.workstreams[0].deliverables.map(d => d.title)).toEqual(['Reel'])
    expect(r.body.unattached.map(w => w.title)).toEqual(['PW Older'])
    expect(r.body.vocab.statuses.length).toBeGreaterThan(0)
  })

  it('has no company on the page of a project with none, and 404s another workspace\'s project', async () => {
    const p = await project('PW Solo')
    expect((await call('GET', `retainers/projects/${p.id}`)).body.company).toBeNull()
    const [foreign] = await sql`INSERT INTO projects (user_id, name) VALUES ('someone_else', 'PW Foreign') RETURNING id`
    expect((await call('GET', `retainers/projects/${foreign.id}`)).statusCode).toBe(404)
    await sql`DELETE FROM projects WHERE id = ${foreign.id}`
  })

  it('attaches the company\'s older workstreams to a project, only those with no project', async () => {
    const p = await project('PW Retainer 2', dmm.id)
    const elsewhere = await project('PW Elsewhere', dmm.id)
    await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${dmm.id}, 'PW Old A'), (${ws}, ${dmm.id}, 'PW Old B')`
    await sql`INSERT INTO workstreams (user_id, company_id, project_id, title) VALUES (${ws}, ${dmm.id}, ${elsewhere.id}, 'PW Already placed')`
    await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${other.id}, 'PW Not theirs')`
    const r = await call('POST', `retainers/projects/${p.id}/attach`, {})
    expect(r.body).toEqual({ attached: 2 })
    const rows = await sql`SELECT title, project_id FROM workstreams WHERE title LIKE 'PW %' ORDER BY title`
    const at = Object.fromEntries(rows.map(w => [w.title, w.project_id]))
    expect(at['PW Old A']).toBe(p.id)
    expect(at['PW Old B']).toBe(p.id)
    expect(at['PW Already placed']).toBe(elsewhere.id)
    expect(at['PW Not theirs']).toBeNull()
  })

  it('will not attach for a project with no company, and a viewer cannot attach', async () => {
    const p = await project('PW Companyless')
    expect((await call('POST', `retainers/projects/${p.id}/attach`, {})).statusCode).toBe(422)
    CURRENT = { ...ana, role: 'viewer' }
    const q = await project('PW Viewer', dmm.id)
    expect((await call('POST', `retainers/projects/${q.id}/attach`, {})).statusCode).toBe(403)
  })

  it('counts open, overdue and waiting items per project', async () => {
    const p = await project('PW Counted')
    const { body } = await call('POST', 'retainers/workstreams', { project_id: p.id, title: 'PW Counts' })
    const w = body.workstream.id
    await call('POST', 'retainers/deliverables', { workstream_id: w, title: 'Late', due_kind: 'exact', due_date: '2020-01-01' })
    await call('POST', 'retainers/deliverables', { workstream_id: w, title: 'Waiting', status: 'waiting_on_client', waiting_note: 'Logo' })
    await call('POST', 'retainers/deliverables', { workstream_id: w, title: 'Done', status: 'approved' })
    const r = await call('GET', 'retainers/project-counts')
    expect(r.body.counts[p.id]).toEqual({ open: 2, overdue: 1, waiting: 1 })
  })

  it('reads the company from the project, live: changing the project\'s company moves the worklist', async () => {
    const p = await project('PW Moves', dmm.id)
    const { body } = await call('POST', 'retainers/workstreams', { project_id: p.id, title: 'PW Moving' })
    const w = body.workstream.id
    const companyOf = async () => (await sql`SELECT company_id FROM workstream_company WHERE workstream_id = ${w}`)[0].company_id
    expect(await companyOf()).toBe(dmm.id)
    await sql`UPDATE projects SET company_id = ${other.id} WHERE id = ${p.id}`
    expect(await companyOf()).toBe(other.id)
    await sql`UPDATE projects SET company_id = NULL WHERE id = ${p.id}`
    expect(await companyOf()).toBeNull()
  })

  describe('the dashboard\'s deliverables', () => {
    it('lists open ones and ones approved this week, from active worklists of projects only', async () => {
      const p = await project('PW Dash')
      const { body } = await call('POST', 'retainers/workstreams', { project_id: p.id, title: 'PW Dash stream' })
      const paused = await call('POST', 'retainers/workstreams', { project_id: p.id, title: 'PW Dash paused', status: 'paused' })
      const w = body.workstream.id
      const make = (workstream_id, title, extra = {}) => call('POST', 'retainers/deliverables', { workstream_id, title, ...extra })
      await make(w, 'Open late', { due_kind: 'exact', due_date: '2020-01-01', owner_id: ana.id })
      await make(w, 'Open undated')
      const fresh = (await make(w, 'Approved today', { status: 'approved' })).body.deliverable
      const old = (await make(w, 'Approved long ago', { status: 'approved' })).body.deliverable
      await sql`UPDATE deliverables SET updated_at = now() - interval '30 days' WHERE id = ${old.id}`
      await make(paused.body.workstream.id, 'In a paused stream')
      await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${dmm.id}, 'PW Dash no project')`
      const [orphan] = await sql`SELECT id FROM workstreams WHERE title = 'PW Dash no project'`
      await sql`INSERT INTO deliverables (workstream_id, title) VALUES (${orphan.id}, 'No project')`

      const r = await call('GET', 'retainers/dashboard-deliverables')
      const mine = r.body.deliverables.filter(d => d.project_id === p.id)
      expect(mine.map(d => [d.title, d.done])).toEqual([['Open late', false], ['Open undated', false], ['Approved today', true]])
      expect(mine[0]).toMatchObject({ overdue: true, owner_name: 'Ana', status: 'planned', workstream: 'PW Dash stream' })
      expect(mine[0].days_late).toBeGreaterThan(365)
      expect(mine[2].id).toBe(fresh.id)
      expect(r.body.deliverables.some(d => d.title === 'No project')).toBe(false)
    })

    it('reads a tick as approved: the status change it makes is the ordinary one', async () => {
      const p = await project('PW Tick')
      const { body } = await call('POST', 'retainers/workstreams', { project_id: p.id, title: 'PW Tick stream' })
      const d = (await call('POST', 'retainers/deliverables', { workstream_id: body.workstream.id, title: 'Film' })).body.deliverable
      expect((await call('PATCH', `retainers/deliverables/${d.id}`, { status: 'approved' })).body.deliverable).toMatchObject({ status: 'approved', client_status: 'Approved' })
      expect((await call('PATCH', `retainers/deliverables/${d.id}`, { status: 'in_progress' })).body.deliverable.status).toBe('in_progress')
    })
  })

  describe('copying a worklist to a duplicated project', () => {
    it('copies workstreams and deliverables as a fresh plan: planned, hidden, no owner, no dates, no rounds', async () => {
      const from = await project('PW Copy from')
      const to = await project('PW Copy to')
      const a = (await call('POST', 'retainers/workstreams', { project_id: from.id, title: 'PW Copy A', brief: 'For the client' })).body.workstream
      const b = (await call('POST', 'retainers/workstreams', { project_id: from.id, title: 'PW Copy B', status: 'complete' })).body.workstream
      const hero = (await call('POST', 'retainers/deliverables', { workstream_id: a.id, title: 'Hero', format: '16:9', owner_id: ana.id, due_kind: 'exact', due_date: '2026-10-02', client_visible: true, internal_notes: 'SECRET' })).body.deliverable
      await call('POST', 'retainers/deliverables', { workstream_id: a.id, title: 'Weekly', due_kind: 'recurring', cadence: 'weekly', due_label: 'Every Monday' })
      await call('POST', 'retainers/deliverables', { workstream_id: b.id, title: 'Old job', status: 'approved' })
      await sql`INSERT INTO deliveries (deliverable_id, url, round, client_response, client_comment) VALUES (${hero.id}, 'https://f.io/x', 1, 'approved', 'Lovely')`

      const r = await call('POST', `retainers/projects/${from.id}/copy-worklist`, { to_project_id: to.id })
      expect(r.body).toEqual({ workstreams: 2, deliverables: 3 })
      const page = (await call('GET', `retainers/projects/${to.id}`)).body
      expect(page.workstreams.map(w => [w.title, w.brief, w.status])).toEqual([['PW Copy A', 'For the client', 'active'], ['PW Copy B', null, 'active']])
      const copied = page.workstreams.flatMap(w => w.deliverables)
      expect(copied.map(d => d.title).sort()).toEqual(['Hero', 'Old job', 'Weekly'])
      for (const d of copied) expect(d).toMatchObject({ status: 'planned', client_visible: false, owner_id: null, deliveries: [], internal_notes: null, waiting_note: null })
      expect(copied.find(d => d.title === 'Hero')).toMatchObject({ format: '16:9', due_kind: 'exact', due_date: null })
      expect(copied.find(d => d.title === 'Weekly')).toMatchObject({ due_kind: 'recurring', cadence: 'weekly', due_label: 'Every Monday' })
      expect(JSON.stringify(page)).not.toContain('SECRET')
      // The original is untouched.
      const original = (await call('GET', `retainers/projects/${from.id}`)).body.workstreams.flatMap(w => w.deliverables)
      expect(original.find(d => d.title === 'Hero')).toMatchObject({ owner_id: ana.id, client_visible: true, internal_notes: 'SECRET' })
    })

    it('refuses the same project, a bad id, another workspace\'s project and a viewer', async () => {
      const from = await project('PW Copy from 2')
      const to = await project('PW Copy to 2')
      expect((await call('POST', `retainers/projects/${from.id}/copy-worklist`, { to_project_id: from.id })).statusCode).toBe(422)
      expect((await call('POST', `retainers/projects/${from.id}/copy-worklist`, { to_project_id: 'nope' })).statusCode).toBe(422)
      const [foreign] = await sql`INSERT INTO projects (user_id, name) VALUES ('someone_else', 'PW Foreign copy') RETURNING id`
      expect((await call('POST', `retainers/projects/${from.id}/copy-worklist`, { to_project_id: foreign.id })).statusCode).toBe(404)
      expect((await call('POST', `retainers/projects/${foreign.id}/copy-worklist`, { to_project_id: to.id })).statusCode).toBe(404)
      await sql`DELETE FROM projects WHERE id = ${foreign.id}`
      CURRENT = { ...ana, role: 'viewer' }
      expect((await call('POST', `retainers/projects/${from.id}/copy-worklist`, { to_project_id: to.id })).statusCode).toBe(403)
    })
  })

  describe('the project\'s client link', () => {
    const tokenOf = async id => (await sql`SELECT portal_token FROM projects WHERE id = ${id}`)[0].portal_token
    it('creates one, refuses a second create, replaces it, and turns it off', async () => {
      const p = await project('PW Link')
      const made = await call('POST', `retainers/projects/${p.id}/link`, { action: 'create' })
      expect(made.statusCode).toBe(200)
      expect(made.body.has_link).toBe(true)
      expect(made.body.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
      expect(await tokenOf(p.id)).toBe(made.body.token)

      const again = await call('POST', `retainers/projects/${p.id}/link`, { action: 'create' })
      expect([again.statusCode, again.body.error.code]).toEqual([409, 'has_link'])
      expect(await tokenOf(p.id)).toBe(made.body.token)

      const swapped = await call('POST', `retainers/projects/${p.id}/link`, { action: 'replace' })
      expect(swapped.body.token).not.toBe(made.body.token)
      expect(await tokenOf(p.id)).toBe(swapped.body.token)   // the old one no longer matches any project

      const off = await call('POST', `retainers/projects/${p.id}/link`, { action: 'off' })
      expect(off.body).toEqual({ has_link: false, token: null })
      expect(await tokenOf(p.id)).toBeNull()
      const page = await call('GET', `retainers/projects/${p.id}`)
      expect(page.body.project.has_link).toBe(false)
    })
    it('refuses an unknown action, another workspace\'s project, and a viewer', async () => {
      const p = await project('PW Link 2')
      expect((await call('POST', `retainers/projects/${p.id}/link`, { action: 'nope' })).body.error.field).toBe('action')
      const [foreign] = await sql`INSERT INTO projects (user_id, name) VALUES ('someone_else', 'PW Foreign link') RETURNING id`
      expect((await call('POST', `retainers/projects/${foreign.id}/link`, { action: 'create' })).statusCode).toBe(404)
      expect(await tokenOf(foreign.id)).toBeNull()
      await sql`DELETE FROM projects WHERE id = ${foreign.id}`
      CURRENT = { ...ana, role: 'viewer' }
      const v = await call('POST', `retainers/projects/${p.id}/link`, { action: 'create' })
      expect([v.statusCode, v.body.error.code]).toEqual([403, 'read_only'])
      expect(await tokenOf(p.id)).toBeNull()
    })
  })

  describe('extra delivery addresses', () => {
    const emailsOf = async id => (await sql`SELECT portal_emails FROM projects WHERE id = ${id}`)[0].portal_emails
    it('cleans and stores the list, and shows the client contact on the page', async () => {
      const [k] = await sql`INSERT INTO contacts (user_id, first_name, last_name, email) VALUES (${ws}, 'Sam', 'PWLee', 'sam@pw.test') RETURNING id`
      const p = await project('PW Emails')
      await sql`UPDATE projects SET client_id = ${k.id} WHERE id = ${p.id}`
      const r = await call('PUT', `retainers/projects/${p.id}/portal-emails`, { portal_emails: [' Ops@PW.test ', 'ops@pw.test', '', 'fin@pw.test'] })
      expect(r.body).toEqual({ portal_emails: ['ops@pw.test', 'fin@pw.test'] })
      expect(await emailsOf(p.id)).toEqual(['ops@pw.test', 'fin@pw.test'])
      const page = await call('GET', `retainers/projects/${p.id}`)
      expect(page.body.project).toMatchObject({ portal_emails: ['ops@pw.test', 'fin@pw.test'], client_contact: { name: 'Sam PWLee', email: 'sam@pw.test' } })
      await sql`UPDATE projects SET client_id = NULL WHERE id = ${p.id}`
      await sql`DELETE FROM contacts WHERE id = ${k.id}`
    })

    it('refuses anything that is not an address, too many, a viewer and another workspace\'s project — and stores nothing', async () => {
      const p = await project('PW Emails 2')
      for (const portal_emails of ['a@b.test', ['nope'], Array.from({ length: 11 }, (_, i) => `p${i}@x.test`)]) {
        const r = await call('PUT', `retainers/projects/${p.id}/portal-emails`, { portal_emails })
        expect([r.statusCode, r.body.error.field]).toEqual([422, 'portal_emails'])
      }
      const [foreign] = await sql`INSERT INTO projects (user_id, name) VALUES ('someone_else', 'PW Foreign emails') RETURNING id`
      expect((await call('PUT', `retainers/projects/${foreign.id}/portal-emails`, { portal_emails: ['a@b.test'] })).statusCode).toBe(404)
      await sql`DELETE FROM projects WHERE id = ${foreign.id}`
      CURRENT = { ...ana, role: 'viewer' }
      expect((await call('PUT', `retainers/projects/${p.id}/portal-emails`, { portal_emails: ['a@b.test'] })).statusCode).toBe(403)
      expect(await emailsOf(p.id)).toEqual([])
    })

    it('takes an address off: its unused links on this project stop working, and nothing else is touched', async () => {
      const p = await project('PW Emails 3')
      const other = await project('PW Emails 3b')
      const round = async (proj, email, { clerk = null, used = false } = {}) => {
        const [w] = await sql`INSERT INTO workstreams (user_id, project_id, title) VALUES (${ws}, ${proj.id}, 'PW Links') RETURNING id`
        const [d] = await sql`INSERT INTO deliverables (workstream_id, title) VALUES (${w.id}, 'Film') RETURNING id`
        const [dv] = await sql`INSERT INTO deliveries (deliverable_id, url, round) VALUES (${d.id}, 'https://f.io/x', 1) RETURNING id`
        const [l] = await sql`INSERT INTO action_links (delivery_id, clerk_user_id, email, token_hash, expires_at, used_at)
          VALUES (${dv.id}, ${clerk}, ${email}, ${`pwhash-${Math.random()}`}, now() + interval '1 day', ${used ? new Date() : null}) RETURNING id`
        return l.id
      }
      await call('PUT', `retainers/projects/${p.id}/portal-emails`, { portal_emails: ['ops@pw.test', 'fin@pw.test'] })
      const ops = await round(p, 'ops@pw.test')
      const opsUsed = await round(p, 'ops@pw.test', { used: true })
      const opsLogin = await round(p, 'ops@pw.test', { clerk: 'user_pw_ops' })
      const fin = await round(p, 'fin@pw.test')
      const opsElsewhere = await round(other, 'ops@pw.test')
      await call('PUT', `retainers/projects/${p.id}/portal-emails`, { portal_emails: ['fin@pw.test'] })
      const left = new Set((await sql`SELECT id FROM action_links WHERE id = ANY(${[ops, opsUsed, opsLogin, fin, opsElsewhere]}::uuid[])`).map(r => r.id))
      expect(left.has(ops)).toBe(false)             // unused, this project, taken off → gone
      expect(left.has(opsUsed)).toBe(true)          // already used: the record stays
      expect(left.has(opsLogin)).toBe(true)         // a login's link isn't this list's business
      expect(left.has(fin)).toBe(true)              // still on the list
      expect(left.has(opsElsewhere)).toBe(true)     // another project
      await sql`DELETE FROM workstreams WHERE user_id = ${ws} AND title = 'PW Links'`
    })
  })

  describe('where a company-less worklist shows up', () => {
    let p, d
    beforeEach(async () => {
      p = await project('PW Board and alerts')
      const { body } = await call('POST', 'retainers/workstreams', { project_id: p.id, title: 'PW Stream' })
      const r = await call('POST', 'retainers/deliverables', { workstream_id: body.workstream.id, title: 'Teaser', due_kind: 'exact', due_date: '2026-10-05' })
      d = r.body.deliverable
    })

    it('on the task board, named for the project, linking to its Worklist tab', async () => {
      const { body } = await call('GET', 'retainers/board')
      const card = body.cards.find(c => c.id === d.id)
      expect(card).toMatchObject({ company: 'PW Board and alerts', company_id: null, project: 'PW Board and alerts', project_id: p.id })
      expect(card.link).toBe(`#projects/${p.id}/worklist/${d.id}`)
    })

    it('in What\'s due, linking to its Worklist tab', async () => {
      const src = await fetchDueSources(sql, { ws, today: '2026-10-01', to: '2026-10-31' })
      const item = collectDue(src, { today: '2026-10-01', to: '2026-10-31' }).find(i => i.title === 'Teaser')
      expect(item.link).toBe(`#projects/${p.id}/worklist/${d.id}`)
      expect(item.context).toContain('PW Board and alerts')
    })

    it('in an alert, which finds the deliverable and goes to the superadmins when it has no owner', async () => {
      const ctx = await loadDeliverableContext(sql, d.id)
      expect(ctx).toMatchObject({ company: 'PW Board and alerts', company_id: null, project_id: p.id })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const r = await loadRecipients(sql, { ownerId: null, companyId: ctx.company_id })
      warn.mockRestore()
      expect(r.via).toBe('superadmins')
      expect(r.to.map(u => u.email)).toContain('boss@pw.test')
    })

    it('with leads on, the lead of the project\'s company (read live) is who hears', async () => {
      await setShowLeads(sql, true)
      try {
        await sql`UPDATE companies SET lead_id = ${ana.id} WHERE id = ${dmm.id}`
        await sql`UPDATE projects SET company_id = ${dmm.id} WHERE id = ${p.id}`
        const ctx = await loadDeliverableContext(sql, d.id)
        expect(ctx.company_id).toBe(dmm.id)
        expect((await loadRecipients(sql, { ownerId: null, companyId: ctx.company_id })).to.map(u => u.email)).toEqual(['ana@pw.test'])
      } finally { await sql`UPDATE companies SET lead_id = NULL WHERE id = ${dmm.id}`; await setShowLeads(sql, false) }
    })
  })

  describe('accepting a request into a project', () => {
    const accept = (id, body) => call('POST', `retainers/requests/${id}/accept`, body)
    const newRequest = async (fields = {}) => (await sql`
      INSERT INTO requests (user_id, company_id, project_id, title, submitted_via, submitted_by_name)
      VALUES (${ws}, ${fields.company ?? null}, ${fields.project ?? null}, 'A cutdown', ${fields.via ?? 'login'}, 'Sam')
      RETURNING id`)[0]

    it('from a company-level request: into a chosen project of that company, in a new workstream', async () => {
      const p = await project('PW Accept', dmm.id)
      const r = await newRequest({ company: dmm.id })
      const page = await call('GET', `retainers/requests/${r.id}`)
      const names = page.body.projects.map(x => x.name)
      expect(names).toContain('PW Accept')
      expect(page.body.projects.every(x => Array.isArray(x.workstreams))).toBe(true)
      const done = await accept(r.id, { project_id: p.id, new_workstream_title: 'PW Asks', owner_id: ana.id, due_date: '2026-10-20' })
      expect(done.statusCode).toBe(200)
      const [w] = await sql`SELECT project_id, company_id FROM workstreams WHERE id = ${done.body.workstream_id}`
      expect(w).toEqual({ project_id: p.id, company_id: null })
    })

    it('refuses a project that is not the request\'s company\'s', async () => {
      const p = await project('PW Wrong company', other.id)
      const r = await newRequest({ company: dmm.id })
      const res = await accept(r.id, { project_id: p.id, new_workstream_title: 'PW Asks', owner_id: ana.id, due_date: '2026-10-20' })
      expect(res.statusCode).toBe(422)
      expect(res.body.error.field).toBe('project_id')
    })

    it('from a link request: always into its own project, which is all the page offers', async () => {
      const p = await project('PW Link project')
      const elsewhere = await project('PW Somewhere else', dmm.id)
      const r = await newRequest({ project: p.id, via: 'link' })
      const page = await call('GET', `retainers/requests/${r.id}`)
      expect(page.body.request).toMatchObject({ project_id: p.id, company_id: null, source: 'link', source_label: 'Sent via project link', company: 'PW Link project' })
      expect(page.body.projects.map(x => x.id)).toEqual([p.id])
      const wrong = await accept(r.id, { project_id: elsewhere.id, new_workstream_title: 'PW Asks', owner_id: ana.id, due_date: '2026-10-20' })
      expect(wrong.statusCode).toBe(422)
      const ok = await accept(r.id, { new_workstream_title: 'PW Asks', owner_id: ana.id, due_date: '2026-10-20' })
      expect(ok.statusCode).toBe(200)
      expect(ok.body.project_id).toBe(p.id)
    })

    it('lists a link request in the inbox, named for its project', async () => {
      const p = await project('PW Inbox project')
      await newRequest({ project: p.id, via: 'link' })
      const list = await call('GET', 'retainers/requests', undefined, { status: 'new' })
      expect(list.body.requests.find(x => x.project_id === p.id)).toMatchObject({ company: 'PW Inbox project', source: 'link' })
    })
  })
})
