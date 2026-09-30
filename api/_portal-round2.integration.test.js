// The client names the project on a request; approving can carry a comment; the
// Tasks bubble counts feedback waiting to be acted on. Against a real Postgres
// (skipped unless SLATE_TEST_DATABASE_URL is set), through the real routes.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let STAFF = null
let CLAIMS = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (STAFF ? { user: STAFF } : { error: { status: 401, code: 'unauthorised', message: 'no' } }),
  verifyClerkSession: async () => (CLAIMS ? { claims: CLAIMS } : { error: { status: 401, code: 'unauthorised', message: 'no' } }),
}))
vi.mock('@clerk/backend', () => ({ createClerkClient: () => ({ users: { getUser: async () => ({ firstName: 'Dana', lastName: 'Client' }) } }) }))
vi.mock('./_ratelimit.js', () => ({ isRateLimited: () => false, getClientIp: () => '127.0.0.1' }))
vi.mock('./_notify.js', async orig => ({ ...(await orig()), notify: async (sql, { to }) => [{ to: to.email, sent: true }] }))
vi.mock('./_alerts.js', async orig => ({ ...(await orig()), alertNewRequest: async () => [], alertChangesRequested: async () => [], alertCommentsIn: async () => [] }))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES } = await import('./_retainers.js')
const { dispatchClient } = await import('./_client.js')
const { loadApprovals, approvalsSectionHtml } = await import('./_alerts.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, ana, ben, alpha, other, filmA, filmB, done, otherFilm, stream
const DANA = { sub: 'user_p2_dana', v: 2, o: { id: 'org_p2_alpha', rol: 'org:member' } }
const staffCall = async (method, route, body) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route }, body, headers: {} }, res, { name: 'retainers', routes: ROUTES, sql })
  return res
}
const clientCall = async (method, route, { body, token } = {}) => {
  const res = fakeRes()
  await dispatchClient({ method, url: `/api/${route}`, query: { route }, body, headers: token ? { 'x-action-token': token } : {} }, res, { sql })
  return res
}
const staff = u => ({ id: u.id, clerk_id: u.clerk_id, role: u.role, name: u.name, email: u.email })
const ask = (over = {}) => clientCall('POST', 'client/requests', { body: { title: 'A thing', ...over } })

async function wipe() {
  await sql`DELETE FROM requests WHERE user_id = ${ws}`
  await sql`DELETE FROM workstreams WHERE user_id = ${ws} AND project_id IN (SELECT id FROM projects WHERE name LIKE 'P2 %')`
  await sql`DELETE FROM projects WHERE user_id = ${ws} AND name LIKE 'P2 %'`
  await sql`DELETE FROM companies WHERE name LIKE 'P2 %'`
  await sql`DELETE FROM app_users WHERE clerk_id LIKE 'p2_%'`
}

describeDb('portal round two', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_p2_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('p2_ana', 'ana@p2.test', 'Ana', 'user') RETURNING id, clerk_id, email, name, role`
    ;[ben] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('p2_ben', 'ben@p2.test', 'Ben', 'user') RETURNING id, clerk_id, email, name, role`
    ;[alpha] = await sql`INSERT INTO companies (user_id, name, clerk_org_id) VALUES (${ws}, 'P2 Alpha', 'org_p2_alpha') RETURNING id`
    ;[other] = await sql`INSERT INTO companies (user_id, name) VALUES (${ws}, 'P2 Other') RETURNING id`
    ;[filmA] = await sql`INSERT INTO projects (user_id, name, company_id, is_retainer) VALUES (${ws}, 'P2 Retainer', ${alpha.id}, true) RETURNING id`
    ;[filmB] = await sql`INSERT INTO projects (user_id, name, company_id) VALUES (${ws}, 'P2 Shoot', ${alpha.id}) RETURNING id`
    ;[done] = await sql`INSERT INTO projects (user_id, name, company_id, status) VALUES (${ws}, 'P2 Finished', ${alpha.id}, 'Delivered') RETURNING id`
    ;[otherFilm] = await sql`INSERT INTO projects (user_id, name, company_id) VALUES (${ws}, 'P2 Theirs', ${other.id}) RETURNING id`
    ;[stream] = await sql`INSERT INTO workstreams (user_id, project_id, title) VALUES (${ws}, ${filmA.id}, 'P2 Edits') RETURNING id`
  })
  afterAll(async () => { await wipe(); await sql.end() })
  beforeEach(async () => {
    STAFF = staff(ana)
    CLAIMS = DANA
    await sql`DELETE FROM requests WHERE user_id = ${ws}`
    await sql`DELETE FROM deliverables WHERE workstream_id = ${stream.id}`
  })

  describe('the client says which project', () => {
    it('offers the company\'s own projects, the retainer first, and not delivered or other companies\' ones', async () => {
      const v = (await clientCall('GET', 'client/view')).body
      expect(v.projects.map(p => p.name)).toEqual(['P2 Retainer', 'P2 Shoot'])
    })
    it('files the request under that project, so accepting never has to ask', async () => {
      const r = await ask({ project_id: filmB.id })
      expect(r.statusCode).toBe(201)
      const [row] = await sql`SELECT project_id, company_id, submitted_via FROM requests WHERE user_id = ${ws}`
      expect(row).toEqual({ project_id: filmB.id, company_id: alpha.id, submitted_via: 'login' })
      const card = (await staffCall('GET', 'retainers/board')).body.requests[0]
      expect(card).toMatchObject({ project: 'P2 Shoot', project_id: filmB.id, source: 'login' })
      const id = card.id
      const accepted = await staffCall('POST', `retainers/requests/${id}/accept`, {})
      expect([accepted.statusCode, accepted.body.project_id]).toEqual([200, filmB.id])      // no needs_project
    })
    it('says which project each workstream belongs to, so approved work can be grouped', async () => {
      await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible) VALUES (${stream.id}, 'Grouped', 'approved', true)`
      const w = (await clientCall('GET', 'client/view')).body.workstreams.find(x => x.id === stream.id)
      expect(w).toMatchObject({ project: 'P2 Retainer', project_id: filmA.id })
    })
    it('shows the project on the client\'s own request list', async () => {
      await ask({ project_id: filmB.id })
      expect((await clientCall('GET', 'client/view')).body.requests[0]).toMatchObject({ project: 'P2 Shoot' })
    })
    it('refuses another company\'s project, a delivered one and nonsense, and is fine with none', async () => {
      for (const project_id of [otherFilm.id, done.id, 'nope', '11111111-1111-4111-8111-111111111111']) {
        const r = await ask({ project_id })
        expect([r.statusCode, r.body.error.field], String(project_id)).toEqual([422, 'project_id'])
      }
      expect((await sql`SELECT count(*)::int AS n FROM requests WHERE user_id = ${ws}`)[0].n).toBe(0)
      expect((await ask()).statusCode).toBe(201)
      expect((await sql`SELECT project_id FROM requests WHERE user_id = ${ws}`)[0].project_id).toBeNull()
    })
    it('with none named, staff still get the old rule: the retainer if there is one, else a question', async () => {
      await ask()
      const id = (await staffCall('GET', 'retainers/board')).body.requests[0].id
      const r = await staffCall('POST', `retainers/requests/${id}/accept`, {})
      expect([r.statusCode, r.body.project_id]).toEqual([200, filmA.id])          // the one retainer
      await ask()
      await sql`UPDATE projects SET is_retainer = false WHERE id = ${filmA.id}`
      const next = (await staffCall('GET', 'retainers/board')).body.requests[0].id
      const q = await staffCall('POST', `retainers/requests/${next}/accept`, {})
      expect([q.statusCode, q.body.error.code]).toEqual([409, 'needs_project'])
      await sql`UPDATE projects SET is_retainer = true WHERE id = ${filmA.id}`
    })
  })

  describe('approving can carry a comment', () => {
    const round = async () => {
      const [d] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible, owner_id) VALUES (${stream.id}, 'Reel', 'in_review', true, ${ana.id}) RETURNING id`
      const [dv] = await sql`INSERT INTO deliveries (deliverable_id, url, round) VALUES (${d.id}, 'https://f.io/r1', 1) RETURNING id`
      return { d: d.id, dv: dv.id }
    }
    it('on a round: kept, shown to the client and to staff, and in the digest', async () => {
      const { d, dv } = await round()
      const r = await clientCall('POST', `client/deliveries/${dv}/response`, { body: { response: 'approved', comment: 'Love it — use the second cut for social' } })
      expect(r.statusCode).toBe(200)
      expect((await sql`SELECT client_comment FROM deliveries WHERE id = ${dv}`)[0].client_comment).toBe('Love it — use the second cut for social')
      const theirs = r.body.view.workstreams[0].deliverables[0].rounds[0]
      expect(theirs).toMatchObject({ response: 'approved', comment: 'Love it — use the second cut for social' })
      const mine = (await staffCall('GET', `retainers/projects/${filmA.id}`)).body.workstreams[0].deliverables[0]
      expect(mine.deliveries[0].client_comment).toBe('Love it — use the second cut for social')
      const list = await loadApprovals(sql, { ws, from: new Date(Date.now() - 3600e3), to: new Date(Date.now() + 3600e3) })
      expect(list.find(a => a.deliverable_id === d).comment).toBe('Love it — use the second cut for social')
      expect(approvalsSectionHtml(list, 'https://x.test')).toContain('use the second cut')
    })
    it('on a delivered deliverable with no round: kept on the deliverable, and shown to staff', async () => {
      const [d] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible, owner_id, delivered_at) VALUES (${stream.id}, 'Stills', 'in_progress', true, ${ana.id}, now()) RETURNING id`
      const r = await clientCall('POST', `client/deliverables/${d.id}/response`, { body: { response: 'approved', comment: 'Great, thanks' } })
      expect(r.statusCode).toBe(200)
      const [row] = await sql`SELECT status, approved_comment FROM deliverables WHERE id = ${d.id}`
      expect(row).toEqual({ status: 'approved', approved_comment: 'Great, thanks' })
      const mine = (await staffCall('GET', `retainers/projects/${filmA.id}`)).body.workstreams[0].deliverables.find(x => x.id === d.id)
      expect(mine.approved_comment).toBe('Great, thanks')
      const list = await loadApprovals(sql, { ws, from: new Date(Date.now() - 3600e3), to: new Date(Date.now() + 3600e3) })
      expect(list.find(a => a.deliverable_id === d.id).comment).toBe('Great, thanks')
    })
    it('from the emailed link, without using up the answer, and with no comment it is unchanged', async () => {
      const { dv } = await round()
      const { createHash, randomBytes } = await import('node:crypto')
      const token = randomBytes(32).toString('base64url')
      await sql`INSERT INTO action_links (delivery_id, clerk_user_id, email, name, token_hash, expires_at) VALUES (${dv}, NULL, 'dana@p2.test', 'Dana', ${createHash('sha256').update(token).digest('hex')}, now() + interval '7 days')`
      CLAIMS = null
      const r = await clientCall('POST', 'client/link/approve', { token, body: { comment: 'Approved, with thanks' } })
      expect(r.statusCode).toBe(200)
      expect((await sql`SELECT client_response, client_comment FROM deliveries WHERE id = ${dv}`)[0]).toEqual({ client_response: 'approved', client_comment: 'Approved, with thanks' })
    })
    it('too long a comment is refused, and nothing is approved', async () => {
      const { d, dv } = await round()
      const r = await clientCall('POST', `client/deliveries/${dv}/response`, { body: { response: 'approved', comment: 'x'.repeat(5001) } })
      expect(r.statusCode).toBe(422)
      expect((await sql`SELECT status FROM deliverables WHERE id = ${d}`)[0].status).toBe('in_review')
    })
  })

  describe('the Tasks bubble', () => {
    const mk = (title, status, owner) => sql`INSERT INTO deliverables (workstream_id, title, status, owner_id) VALUES (${stream.id}, ${title}, ${status}::deliverable_status, ${owner})`
    it('counts requests, and changes requested or comments in on your deliverables and nobody\'s', async () => {
      await sql`INSERT INTO requests (user_id, company_id, title, submitted_by_name) VALUES (${ws}, ${alpha.id}, 'New', 'Dana')`
      await mk('Mine changes', 'changes_requested', ana.id)
      await mk('Mine comments', 'comments_in', ana.id)
      await mk('Nobody changes', 'changes_requested', null)
      await mk('Ben changes', 'changes_requested', ben.id)
      await mk('Mine approved', 'approved', ana.id)
      await mk('Mine doing', 'in_progress', ana.id)
      expect((await staffCall('GET', 'retainers/request-count')).body).toEqual({ new: 1, feedback: 3 })
      STAFF = staff(ben)
      expect((await staffCall('GET', 'retainers/request-count')).body).toEqual({ new: 1, feedback: 2 })
    })
    it('clears itself when the feedback is acted on', async () => {
      await mk('Changes', 'changes_requested', ana.id)
      expect((await staffCall('GET', 'retainers/request-count')).body.feedback).toBe(1)
      await sql`UPDATE deliverables SET status = 'in_progress' WHERE workstream_id = ${stream.id}`
      expect((await staffCall('GET', 'retainers/request-count')).body.feedback).toBe(0)
    })
    it('ignores a paused workstream', async () => {
      await mk('Changes', 'changes_requested', ana.id)
      await sql`UPDATE workstreams SET status = 'paused' WHERE id = ${stream.id}`
      expect((await staffCall('GET', 'retainers/request-count')).body.feedback).toBe(0)
      await sql`UPDATE workstreams SET status = 'active' WHERE id = ${stream.id}`
    })
  })
})
