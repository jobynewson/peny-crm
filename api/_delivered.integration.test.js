// "Delivered" (the staff tick) and "approved" (the client's answer) are
// separate. Runs against a real Postgres (skipped unless SLATE_TEST_DATABASE_URL
// is set): the tick changes nothing else, the client then sees Delivered with
// Approve and Request changes (no round needed), and each answer lands where it
// should. Staff and the portal are both driven through their real routes.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let STAFF = null
let CLAIMS = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (STAFF ? { user: STAFF } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
  verifyClerkSession: async () => (CLAIMS ? { claims: CLAIMS } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))
vi.mock('@clerk/backend', () => ({ createClerkClient: () => ({ users: { getUser: async () => ({ firstName: 'Dana', lastName: 'Client' }) } }) }))
const changesAlerts = []
vi.mock('./_alerts.js', async orig => ({ ...(await orig()), alertChangesRequested: async (sql, args) => { changesAlerts.push(args); return [] } }))
vi.mock('./_notify.js', async orig => ({ ...(await orig()), notify: async (sql, { to }) => [{ to: to.email, sent: true }] }))
vi.mock('./_ratelimit.js', () => ({ isRateLimited: () => false, getClientIp: () => '127.0.0.1' }))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES } = await import('./_retainers.js')
const { dispatchClient } = await import('./_client.js')
const { loadApprovals } = await import('./_alerts.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, ana, company, project
const staffCall = async (method, route, body) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route }, body, headers: {} }, res, { name: 'retainers', routes: ROUTES, sql })
  return res
}
const clientCall = async (method, route, body) => {
  const res = fakeRes()
  await dispatchClient({ method, url: `/api/${route}`, query: { route }, body, headers: {} }, res, { sql })
  return res
}
const DANA = { sub: 'user_dv_dana', v: 2, o: { id: 'org_dv_alpha', rol: 'org:member' } }
const deliverable = async (title, over = {}) => {
  const o = { status: 'in_progress', visible: true, ...over }
  return (await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible) VALUES (${o.stream}, ${title}, ${o.status}::deliverable_status, ${o.visible}) RETURNING id`)[0].id
}
const row = async id => (await sql`SELECT status, delivered_at, approved_at, approved_by_name, changes_note, changes_at FROM deliverables WHERE id = ${id}`)[0]
const theirs = async title => {
  const v = (await clientCall('GET', 'client/view')).body
  return v.workstreams.flatMap(w => w.deliverables).find(d => d.title === title)
}
let stream

async function wipe() {
  await sql`DELETE FROM workstreams WHERE user_id = ${ws} AND title LIKE 'DV %'`
  await sql`DELETE FROM projects WHERE user_id = ${ws} AND name LIKE 'DV %'`
  await sql`DELETE FROM companies WHERE name LIKE 'DV %'`
  await sql`DELETE FROM app_users WHERE clerk_id = 'user_dv_ana'`
}

describeDb('delivered and approved are separate', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_dv_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('user_dv_ana', 'ana@dv.test', 'Ana', 'user') RETURNING id, clerk_id, email, name, role`
    ;[company] = await sql`INSERT INTO companies (user_id, name, clerk_org_id) VALUES (${ws}, 'DV Alpha', 'org_dv_alpha') RETURNING id`
    ;[project] = await sql`INSERT INTO projects (user_id, name, company_id) VALUES (${ws}, 'DV Film', ${company.id}) RETURNING id`
    ;[stream] = await sql`INSERT INTO workstreams (user_id, project_id, title) VALUES (${ws}, ${project.id}, 'DV Edits') RETURNING id`
  })
  afterAll(async () => { await wipe(); await sql.end() })
  beforeEach(async () => {
    STAFF = { id: ana.id, clerk_id: ana.clerk_id, role: 'user', name: ana.name, email: ana.email }
    CLAIMS = DANA
    changesAlerts.length = 0
    await sql`DELETE FROM deliverables WHERE workstream_id = ${stream.id}`
  })
  const tick = (id, delivered) => staffCall('PATCH', `retainers/deliverables/${id}`, { delivered })

  it('the staff tick sets delivered and nothing else: it does not approve', async () => {
    const id = await deliverable('Reel', { stream: stream.id, status: 'in_progress' })
    const r = await tick(id, true)
    expect(r.statusCode).toBe(200)
    expect(r.body.deliverable).toMatchObject({ delivered: true, status: 'in_progress' })
    const after = await row(id)
    expect(after.delivered_at).not.toBeNull()
    expect(after.approved_at).toBeNull()
    expect(after.status).toBe('in_progress')
    const off = await tick(id, false)
    expect(off.body.deliverable).toMatchObject({ delivered: false, status: 'in_progress' })
    expect((await tick(id, 'yes')).statusCode).toBe(422)
  })

  it('the client sees Delivered with Approve and Request changes, and nothing before the tick', async () => {
    const id = await deliverable('Reel', { stream: stream.id, status: 'in_progress' })
    expect(await theirs('Reel')).toMatchObject({ status: 'in_progress', delivered: false, can_answer: false })
    await tick(id, true)
    expect(await theirs('Reel')).toMatchObject({ status: 'delivered', status_label: 'Delivered', delivered: true, can_answer: true })
  })

  it('approving sets approved, keeps the tick, and records who and when', async () => {
    const id = await deliverable('Reel', { stream: stream.id })
    await tick(id, true)
    const r = await clientCall('POST', `client/deliverables/${id}/response`, { response: 'approved' })
    expect(r.statusCode).toBe(200)
    const after = await row(id)
    expect(after).toMatchObject({ status: 'approved', approved_by_name: 'Dana Client' })
    expect(after.approved_at).not.toBeNull()
    expect(after.delivered_at).not.toBeNull()
    expect(await theirs('Reel')).toMatchObject({ status: 'approved', can_answer: false })
    const again = await clientCall('POST', `client/deliverables/${id}/response`, { response: 'approved' })
    expect([again.statusCode, again.body.error.code]).toEqual([409, 'already_answered'])
  })

  it('asking for changes needs a comment, puts it back with Peny, clears the tick, tells the owner', async () => {
    const id = await deliverable('Reel', { stream: stream.id })
    await tick(id, true)
    expect((await clientCall('POST', `client/deliverables/${id}/response`, { response: 'changes_requested' })).statusCode).toBe(422)
    const r = await clientCall('POST', `client/deliverables/${id}/response`, { response: 'changes_requested', comment: 'Logo too small' })
    expect(r.statusCode).toBe(200)
    expect(await row(id)).toMatchObject({ status: 'changes_requested', delivered_at: null, changes_note: 'Logo too small' })
    expect(changesAlerts).toHaveLength(1)
    expect(changesAlerts[0]).toMatchObject({ deliverableId: id, comment: 'Logo too small' })
    expect(await theirs('Reel')).toMatchObject({ can_answer: false, delivered: false })
    // Ticked again once fixed: the old note goes and the client can answer again.
    await tick(id, true)
    expect((await row(id)).changes_note).toBeNull()
    expect((await theirs('Reel')).can_answer).toBe(true)
  })

  it('refuses an answer before the tick, for a hidden deliverable, and while a round is waiting', async () => {
    const plain = await deliverable('Plain', { stream: stream.id })
    const early = await clientCall('POST', `client/deliverables/${plain}/response`, { response: 'approved' })
    expect([early.statusCode, early.body.error.code]).toEqual([409, 'not_delivered'])
    const hidden = await deliverable('Hidden', { stream: stream.id, visible: false })
    await tick(hidden, true)
    expect((await clientCall('POST', `client/deliverables/${hidden}/response`, { response: 'approved' })).statusCode).toBe(404)
    const rounded = await deliverable('Rounded', { stream: stream.id, status: 'in_review' })
    await sql`INSERT INTO deliveries (deliverable_id, url, round) VALUES (${rounded}, 'https://f.io/x', 1)`
    await tick(rounded, true)
    const r = await clientCall('POST', `client/deliverables/${rounded}/response`, { response: 'approved' })
    expect([r.statusCode, r.body.error.code]).toEqual([409, 'use_round'])
    expect((await theirs('Rounded')).can_answer).toBe(false)      // the round has its own buttons
    expect((await row(rounded)).status).toBe('in_review')
  })

  it('another company, a Slate user and a project link cannot answer it', async () => {
    const id = await deliverable('Reel', { stream: stream.id })
    await tick(id, true)
    CLAIMS = { sub: 'user_dv_other', v: 2, o: { id: 'org_dv_nobody', rol: 'org:member' } }
    expect((await clientCall('POST', `client/deliverables/${id}/response`, { response: 'approved' })).statusCode).toBeGreaterThanOrEqual(400)
    expect((await row(id)).status).not.toBe('approved')
  })

  it('an approval with no round reaches the digest, without a round number', async () => {
    const id = await deliverable('Reel', { stream: stream.id })
    await tick(id, true)
    await clientCall('POST', `client/deliverables/${id}/response`, { response: 'approved' })
    const list = await loadApprovals(sql, { ws, from: new Date(Date.now() - 3600e3), to: new Date(Date.now() + 3600e3) })
    const mine = list.find(a => a.deliverable_id === id)
    expect(mine).toMatchObject({ title: 'Reel', round: null, responded_by_name: 'Dana Client', company: 'DV Alpha' })
  })

  it('the dashboard list treats the tick as done but not approved, and locks an approved one', async () => {
    const a = await deliverable('Ticked', { stream: stream.id })
    const b = await deliverable('Approved', { stream: stream.id, status: 'approved' })
    await tick(a, true)
    const rows = (await staffCall('GET', 'retainers/dashboard-deliverables')).body.deliverables
    expect(rows.find(d => d.id === a)).toMatchObject({ done: true, delivered: true, approved: false })
    expect(rows.find(d => d.id === b)).toMatchObject({ done: true, approved: true })
  })
})
