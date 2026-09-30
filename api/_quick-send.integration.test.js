// Quick send, against a real Postgres (skipped unless SLATE_TEST_DATABASE_URL is
// set): a link and a name make (or pick) the deliverable and send its next round
// in one step, everything stays on the worklist, and a failed send leaves no
// stray deliverable behind.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT ? { user: CURRENT } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))
const mails = []
vi.mock('./_notify.js', async orig => ({ ...(await orig()), notify: async (sql, { to, subject }) => { mails.push({ to: to.email, subject }); return [{ to: to.email, sent: true }] } }))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES } = await import('./_retainers.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, ana, vic, project, other
const call = async (method, route, body) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route }, body, headers: {} }, res, { name: 'retainers', routes: ROUTES, sql })
  return res
}
const staff = u => ({ id: u.id, clerk_id: u.clerk_id, role: u.role, name: u.name, email: u.email })
const LINK = 'https://app.frame.io/reviews/abc'

async function wipe() {
  await sql`DELETE FROM workstreams WHERE user_id = ${ws} AND project_id IN (SELECT id FROM projects WHERE name LIKE 'QS %')`
  await sql`DELETE FROM projects WHERE user_id = ${ws} AND name LIKE 'QS %'`
  await sql`DELETE FROM contacts WHERE last_name = 'QSLee'`
  await sql`DELETE FROM app_users WHERE clerk_id IN ('qs_ana', 'qs_vic')`
}
const titles = async () => (await sql`SELECT d.title FROM deliverables d JOIN workstreams w ON w.id = d.workstream_id WHERE w.project_id = ${project.id} ORDER BY d.title`).map(r => r.title)

describeDb('Quick send', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_qs_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('qs_ana', 'ana@qs.test', 'Ana', 'user') RETURNING id, clerk_id, email, name, role`
    ;[vic] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('qs_vic', 'vic@qs.test', 'Vic', 'viewer') RETURNING id, clerk_id, email, name, role`
    ;[project] = await sql`INSERT INTO projects (user_id, name, portal_emails) VALUES (${ws}, 'QS Film', ${JSON.stringify(['client@qs.test'])}::jsonb) RETURNING id`
    ;[other] = await sql`INSERT INTO projects (user_id, name) VALUES (${ws}, 'QS Other') RETURNING id`
  })
  afterAll(async () => { await wipe(); await sql.end() })
  beforeEach(async () => {
    CURRENT = staff(ana)
    mails.length = 0
    await sql`DELETE FROM workstreams WHERE project_id IN (${project.id}, ${other.id})`
  })
  const send = body => call('POST', `retainers/projects/${project.id}/quick-send`, { url: LINK, ...body })

  it('with a new name it makes the deliverable and sends round 1 in one step, emailing the client', async () => {
    const r = await send({ title: 'Hero film v1' })
    expect(r.statusCode).toBe(201)
    expect(r.body).toMatchObject({ created: true, delivery: { round: 1 }, deliverable: { title: 'Hero film v1', status: 'in_review', client_visible: true, owner_id: ana.id } })
    expect(r.body.notified.sent).toBe(1)
    expect(mails.map(m => [m.to, m.subject])).toEqual([['client@qs.test', 'Ready for your review: Hero film v1']])
    expect(await titles()).toEqual(['Hero film v1'])
    const [ws1] = await sql`SELECT title FROM workstreams WHERE project_id = ${project.id}`
    expect(ws1.title).toBe('Reviews')       // none existed
  })

  it('with an existing deliverable it sends the next round of that one, and shows it if hidden', async () => {
    const first = (await send({ title: 'Reel' })).body.deliverable
    await sql`UPDATE deliverables SET client_visible = false, status = 'changes_requested' WHERE id = ${first.id}`
    const r = await send({ deliverable_id: first.id, note: 'Colour fixed' })
    expect(r.body).toMatchObject({ created: false, delivery: { round: 2 }, deliverable: { id: first.id, status: 'in_review', client_visible: true } })
    expect(await titles()).toEqual(['Reel'])            // nothing new was made
  })

  it('puts a new deliverable in the workstream of the one sent last, or the one chosen', async () => {
    const a = (await call('POST', 'retainers/workstreams', { project_id: project.id, title: 'QS Edits' })).body.workstream
    const b = (await call('POST', 'retainers/workstreams', { project_id: project.id, title: 'QS Social' })).body.workstream
    await send({ title: 'One', workstream_id: b.id })
    const two = (await send({ title: 'Two' })).body.deliverable
    expect(two.workstream_id).toBe(b.id)               // where the last one went
    const three = (await send({ title: 'Three', workstream_id: a.id })).body.deliverable
    expect(three.workstream_id).toBe(a.id)
  })

  it('offers the most recently sent deliverable first, with its next round, and the workstreams', async () => {
    await send({ title: 'Older' })
    await new Promise(r => setTimeout(r, 15))
    const newer = (await send({ title: 'Newer' })).body.deliverable
    const t = (await call('GET', `retainers/projects/${project.id}/send-targets`)).body
    expect(t.deliverables.map(d => d.title)).toEqual(['Newer', 'Older'])
    expect(t.deliverables[0]).toMatchObject({ id: newer.id, round: 1 })
    expect(t.default_workstream_id).toBe(newer.workstream_id)
    expect(t.workstreams).toHaveLength(1)
  })

  it('refuses a bad link, no name, another project\'s deliverable, an approved one, and a viewer', async () => {
    expect((await send({ url: 'javascript:alert(1)', title: 'X' })).statusCode).toBe(422)
    expect((await send({})).body.error.field).toBe('title')
    const foreign = (await call('POST', 'retainers/workstreams', { project_id: other.id, title: 'QS Theirs' })).body.workstream
    const [d] = await sql`INSERT INTO deliverables (workstream_id, title) VALUES (${foreign.id}, 'Not yours') RETURNING id`
    expect((await send({ deliverable_id: d.id })).body.error.field).toBe('deliverable_id')
    const mine = (await send({ title: 'Done one' })).body.deliverable
    await sql`UPDATE deliverables SET status = 'approved' WHERE id = ${mine.id}`
    expect((await send({ deliverable_id: mine.id })).body.error.field).toBe('deliverable_id')
    expect((await call('POST', 'retainers/projects/11111111-1111-4111-8111-111111111111/quick-send', { url: LINK, title: 'x' })).statusCode).toBe(404)
    CURRENT = staff(vic)
    expect((await send({ title: 'Viewer' })).statusCode).toBe(403)
    expect(await titles()).toEqual(['Done one'])
  })

  it('leaves no stray deliverable when the send fails part-way', async () => {
    const real = sql
    let failNext = false
    const wrapped = (strings, ...values) => {
      const text = Array.isArray(strings) ? strings.join('?') : ''
      if (failNext && /INSERT INTO deliveries/.test(text)) return Promise.reject(new Error('boom'))
      return real(strings, ...values)
    }
    Object.assign(wrapped, real)
    failNext = true
    const res = fakeRes()
    await dispatch({ method: 'POST', url: `/api/retainers/projects/${project.id}/quick-send`, query: { route: `retainers/projects/${project.id}/quick-send` }, body: { url: LINK, title: 'Doomed' }, headers: {} }, res, { name: 'retainers', routes: ROUTES, sql: wrapped })
    expect(res.statusCode).toBe(500)
    expect(await titles()).toEqual([])
  })
})
