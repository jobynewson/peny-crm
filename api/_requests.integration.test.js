// Runs triage (/api/retainers/requests) against a real Postgres. Skipped
// unless SLATE_TEST_DATABASE_URL is set — see _test-db.js. notify() is a
// recorder, so nothing is sent.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT
    ? { user: CURRENT }
    : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))
const sent = []
vi.mock('./_notify.js', async orig => ({
  ...(await orig()),
  notify: async (sql, { kind, to, subject }) => {
    const list = Array.isArray(to) ? to : [to]
    return list.map(r => { sent.push({ kind, to: r.email, subject }); return { to: r.email, sent: true } })
  },
}))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES } = await import('./_retainers.js')
const { readClientView } = await import('./_client-view.js')
const { companyScope } = await import('./_worklist.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, ana, ben, vic, alpha, beta, otherWs, launch, paused, betaStream, foreignStream

const call = async (method, route, body, query = {}) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route, ...query }, body, headers: {} }, res, { name: 'retainers', routes: ROUTES, sql })
  return res
}
const as = user => { CURRENT = user }
const staff = u => ({ id: u.id, clerk_id: u.clerk_id, role: u.role, name: u.name, email: u.email })

async function makeRequest(over = {}) {
  const r = { company: alpha.id, title: 'Cut-down of the film', detail: 'See https://x.test/brief', by: '2026-10-30', at: null, ...over }
  const [row] = await sql`
    INSERT INTO requests (user_id, company_id, submitted_by, submitted_by_name, title, detail, wanted_by, created_at)
    VALUES (${r.ws ?? ws}, ${r.company}, 'user_rq_dana', 'Dana Client', ${r.title}, ${r.detail}, ${r.by}, COALESCE(${r.at}::timestamptz, now()))
    RETURNING id`
  return row.id
}
const project = async (name, companyId = null, retainer = false) =>
  (await sql`INSERT INTO projects (user_id, name, company_id, is_retainer) VALUES (${ws}, ${name}, ${companyId}, ${retainer}) RETURNING id`)[0]
const linkRequest = async projectId => (await sql`
  INSERT INTO requests (user_id, project_id, submitted_by_name, submitted_via, title) VALUES (${ws}, ${projectId}, 'Sam (typed)', 'link', 'From the link') RETURNING id`)[0].id
const deliverablesIn = async id => sql`SELECT * FROM deliverables WHERE workstream_id = ${id}`
const clientView = async () => readClientView(sql, companyScope({ ws, companyId: alpha.id, clerkUserId: 'user_rq_dana' }))
const OK = () => ({ workstream_id: launch.id, owner_id: ben.id, due_date: '2026-10-09' })

async function wipe() {
  await sql`DELETE FROM requests WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'RqTest %')`
  await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'RqTest %') OR project_id IN (SELECT id FROM projects WHERE name LIKE 'RqTest %')`
  await sql`DELETE FROM projects WHERE name LIKE 'RqTest %'`
  await sql`DELETE FROM companies WHERE name LIKE 'RqTest %'`
  await sql`DELETE FROM app_users WHERE clerk_id LIKE 'rq_%'`
}

describeDb('client requests on the task board', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_rq_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('rq_ana', 'ana@rq.test', 'Ana', 'user') RETURNING id, clerk_id, email, name, role`
    ;[ben] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('rq_ben', 'ben@rq.test', 'Ben', 'user') RETURNING id, clerk_id, email, name, role`
    ;[vic] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('rq_vic', 'vic@rq.test', 'Vic', 'viewer') RETURNING id, clerk_id, email, name, role`
    ;[alpha] = await sql`INSERT INTO companies (user_id, name, lead_id) VALUES (${ws}, 'RqTest Alpha', ${ana.id}) RETURNING id`
    ;[beta] = await sql`INSERT INTO companies (user_id, name, lead_id) VALUES (${ws}, 'RqTest Beta', ${ana.id}) RETURNING id`
    ;[otherWs] = await sql`INSERT INTO companies (user_id, name) VALUES ('someone_else', 'RqTest Other') RETURNING id`
    ;[launch] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${alpha.id}, 'Launch') RETURNING id`
    ;[paused] = await sql`INSERT INTO workstreams (user_id, company_id, title, status) VALUES (${ws}, ${alpha.id}, 'Old', 'paused') RETURNING id`
    ;[betaStream] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${beta.id}, 'Beta work') RETURNING id`
    ;[foreignStream] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES ('someone_else', ${otherWs.id}, 'Theirs') RETURNING id`
  })
  beforeEach(async () => {
    sent.length = 0
    await sql`DELETE FROM requests WHERE user_id = ${ws}`
    await sql`DELETE FROM deliverables WHERE workstream_id IN (SELECT id FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'RqTest %') OR project_id IN (SELECT id FROM projects WHERE name LIKE 'RqTest %'))`
    await sql`DELETE FROM workstreams WHERE (company_id IN (SELECT id FROM companies WHERE name LIKE 'RqTest %') AND title NOT IN ('Launch', 'Old', 'Beta work', 'Theirs')) OR project_id IN (SELECT id FROM projects WHERE name LIKE 'RqTest %')`
    await sql`DELETE FROM projects WHERE name LIKE 'RqTest %'`
    as(staff(ana))
  })
  afterAll(async () => { await wipe(); await sql.end() })

  describe('the tray', () => {
    it('gives the board the new requests, oldest first, and only this workspace\'s', async () => {
      await makeRequest({ title: 'Second', at: '2026-09-28T10:00:00Z' })
      await makeRequest({ title: 'First', at: '2026-09-27T10:00:00Z' })
      await makeRequest({ title: 'Not ours', company: otherWs.id, ws: 'someone_else' })
      const accepted = await makeRequest({ title: 'Done already' })
      await sql`UPDATE requests SET status = 'accepted', decided_at = now() WHERE id = ${accepted}`
      const r = await call('GET', 'retainers/board')
      expect(r.statusCode).toBe(200)
      expect(r.body.requests.map(x => x.title)).toEqual(['First', 'Second'])
      expect(r.body.requests[0]).toMatchObject({
        kind: 'request', in_tray: true, company: 'RqTest Alpha', sent_by: 'Dana Client', wanted_by: '2026-10-30',
        source: 'login', project_id: null,
      })
      expect(r.body.requests[0].detail).toContain('https://x.test/brief')
    })

    it('marks a request sent from a project link, and names its project', async () => {
      const p = await project('RqTest Link Film', alpha.id)
      const id = await linkRequest(p.id)
      const r = await call('GET', 'retainers/board')
      const card = r.body.requests.find(x => x.id === id)
      expect(card).toMatchObject({ source: 'link', source_label: 'Sent via project link', project: 'RqTest Link Film', company: 'RqTest Link Film', sent_by: 'Sam (typed)' })
    })

    it('counts them for the Tasks tab, and anyone on the team can read the board, even a viewer', async () => {
      await makeRequest(); await makeRequest({ title: 'Another' })
      expect((await call('GET', 'retainers/request-count')).body).toEqual({ new: 2, feedback: 0 })
      as(staff(vic))
      expect((await call('GET', 'retainers/board')).statusCode).toBe(200)
    })

    it('has no separate inbox any more', async () => {
      const id = await makeRequest()
      expect((await call('GET', 'retainers/requests')).statusCode).toBe(404)
      expect((await call('GET', `retainers/requests/${id}`)).statusCode).toBe(404)
    })
  })

  describe('accepting', () => {
    it('makes the deliverable — owned, dated, planned and shown to the client — and tells the owner', async () => {
      const id = await makeRequest()
      const r = await call('POST', `retainers/requests/${id}/accept`, OK())
      expect(r.statusCode).toBe(200)
      const [d] = await deliverablesIn(launch.id)
      expect(d).toMatchObject({
        title: 'Cut-down of the film', owner_id: ben.id, status: 'planned', client_visible: true, due_kind: 'exact',
      })
      expect(String(d.due_date instanceof Date ? d.due_date.toISOString() : d.due_date)).toContain('2026-10-0')
      expect(d.internal_notes).toContain('Dana Client')
      expect(d.internal_notes).toContain('https://x.test/brief')
      expect(r.body).toMatchObject({ deliverable_id: d.id, workstream_id: launch.id, company_id: alpha.id })

      const [req] = await sql`SELECT status, deliverable_id, decided_by, decided_at FROM requests WHERE id = ${id}`
      expect(req).toMatchObject({ status: 'accepted', deliverable_id: d.id, decided_by: ana.id })
      expect(req.decided_at).toBeTruthy()
      expect(sent).toEqual([{ kind: 'task_assigned', to: 'ben@rq.test', subject: 'New deliverable: Cut-down of the film' }])
    })

    it('shows up in the client\'s worklist and on their request, with the date we gave it', async () => {
      const id = await makeRequest()
      await call('POST', `retainers/requests/${id}/accept`, { ...OK(), title: 'Cut-down (two versions)' })
      const view = await clientView()
      const mine = view.workstreams.flatMap(w => w.deliverables).find(d => d.title === 'Cut-down (two versions)')
      expect(mine).toMatchObject({ status: 'planned', due: 'Fri 9 Oct' })
      expect(view.requests[0]).toMatchObject({ status_label: 'Accepted', accepted: { deliverable_id: mine.id, due: 'Fri 9 Oct', status_label: 'Planned' } })
    })

    it('can make the workstream in the same step, in the project', async () => {
      const p = await project('RqTest Film', alpha.id)
      const id = await makeRequest()
      const r = await call('POST', `retainers/requests/${id}/accept`, { owner_id: ben.id, due_date: '2026-10-09', new_workstream_title: '  Launch extras ' })
      expect(r.statusCode).toBe(200)
      const [w] = await sql`SELECT company_id, project_id, title, status, user_id FROM workstreams WHERE id = ${r.body.workstream_id}`
      expect(w).toEqual({ company_id: null, project_id: p.id, title: 'Launch extras', status: 'active', user_id: ws })
      expect(await deliverablesIn(r.body.workstream_id)).toHaveLength(1)
    })

    it('asks for nothing: the owner is whoever accepts, no date is fine, and it goes in the project\'s "Requests" workstream', async () => {
      const p = await project('RqTest Film', alpha.id)
      const id = await makeRequest()
      const r = await call('POST', `retainers/requests/${id}/accept`, {})
      expect(r.statusCode).toBe(200)
      const [d] = await deliverablesIn(r.body.workstream_id)
      expect(d).toMatchObject({ owner_id: ana.id, due_date: null, status: 'planned', client_visible: true, title: 'Cut-down of the film' })
      const [w] = await sql`SELECT title, project_id FROM workstreams WHERE id = ${r.body.workstream_id}`
      expect(w).toEqual({ title: 'Requests', project_id: p.id })
      expect(r.body.link).toBe(`#projects/${p.id}/worklist/${d.id}`)
      expect(sent).toEqual([])                               // you gave it to yourself
      // The next one reuses it.
      const second = await call('POST', `retainers/requests/${await makeRequest({ title: 'Another' })}/accept`, { due_date: '2026-10-09' })
      expect(second.body.workstream_id).toBe(r.body.workstream_id)
      expect((await sql`SELECT count(*)::int AS n FROM workstreams WHERE project_id = ${p.id}`)[0].n).toBe(1)
    })

    it('puts a project-link request in that project, and a signed-in client\'s in their only project or their one retainer', async () => {
      const film = await project('RqTest Film', alpha.id)
      const viaLink = await linkRequest(film.id)
      expect((await call('POST', `retainers/requests/${viaLink}/accept`, {})).body.project_id).toBe(film.id)

      const signedIn = await makeRequest()
      expect((await call('POST', `retainers/requests/${signedIn}/accept`, {})).body.project_id).toBe(film.id)   // the only one

      const retainer = await project('RqTest Retainer', alpha.id, true)
      await project('RqTest Shoot', alpha.id)
      const again = await makeRequest({ title: 'Third' })
      expect((await call('POST', `retainers/requests/${again}/accept`, {})).body.project_id).toBe(retainer.id)   // the one retainer
    })

    it('asks which project only when it cannot tell, then takes the answer; with none it says to make one', async () => {
      const id = await makeRequest()
      const none = await call('POST', `retainers/requests/${id}/accept`, {})
      expect([none.statusCode, none.body.error.field]).toEqual([422, 'project_id'])

      const one = await project('RqTest One', alpha.id)
      const two = await project('RqTest Two', alpha.id)
      const ask = await call('POST', `retainers/requests/${id}/accept`, {})
      expect([ask.statusCode, ask.body.error.code]).toEqual([409, 'needs_project'])
      expect(ask.body.error.projects.map(p => p.name).sort()).toEqual(['RqTest One', 'RqTest Two'])
      expect((await sql`SELECT status FROM requests WHERE id = ${id}`)[0].status).toBe('new')

      const bad = await call('POST', `retainers/requests/${id}/accept`, { project_id: (await project('RqTest Elsewhere', beta.id)).id })
      expect([bad.statusCode, bad.body.error.field]).toEqual([422, 'project_id'])
      const ok = await call('POST', `retainers/requests/${id}/accept`, { project_id: two.id })
      expect([ok.statusCode, ok.body.project_id]).toEqual([200, two.id])
      expect(one.id).not.toBe(two.id)
    })

    it('still rejects nonsense: an owner who is not on the team, a bad date, a bad workstream', async () => {
      const id = await makeRequest()
      for (const [bad, field] of [
        [{ ...OK(), owner_id: '00000000-0000-4000-8000-000000000000' }, 'owner_id'],
        [{ ...OK(), due_date: '2026-02-30' }, 'due_date'],
        [{ ...OK(), workstream_id: 'nope' }, 'workstream_id'],
      ]) {
        const r = await call('POST', `retainers/requests/${id}/accept`, bad)
        expect([r.statusCode, r.body.error.field]).toEqual([422, field])
      }
      expect(await deliverablesIn(launch.id)).toEqual([])
      expect((await sql`SELECT status FROM requests WHERE id = ${id}`)[0].status).toBe('new')
      expect(sent).toEqual([])
    })

    it('will not put it in another company\'s, another workspace\'s or a paused workstream', async () => {
      const id = await makeRequest()
      for (const workstream_id of [betaStream.id, foreignStream.id, paused.id, '00000000-0000-4000-8000-000000000000']) {
        const r = await call('POST', `retainers/requests/${id}/accept`, { ...OK(), workstream_id })
        expect([r.statusCode, r.body.error.field], workstream_id).toEqual([422, 'workstream_id'])
      }
      for (const w of [betaStream, foreignStream, paused, launch]) expect(await deliverablesIn(w.id)).toEqual([])
      expect((await sql`SELECT status FROM requests WHERE id = ${id}`)[0].status).toBe('new')
    })

    it('happens once: a second accept, and two at the same moment, make one deliverable', async () => {
      const id = await makeRequest()
      const both = await Promise.all([
        call('POST', `retainers/requests/${id}/accept`, OK()),
        call('POST', `retainers/requests/${id}/accept`, { ...OK(), owner_id: ana.id }),
      ])
      expect(both.map(r => r.statusCode).sort()).toEqual([200, 409])
      expect(await deliverablesIn(launch.id)).toHaveLength(1)
      const again = await call('POST', `retainers/requests/${id}/accept`, OK())
      expect([again.statusCode, again.body.error.code]).toEqual([409, 'already_decided'])
      expect(await deliverablesIn(launch.id)).toHaveLength(1)
    })

    it('a new workstream is not left behind when it loses the race', async () => {
      const p = await project('RqTest Film', alpha.id)
      const id = await makeRequest()
      await call('POST', `retainers/requests/${id}/accept`, OK())
      const before = (await sql`SELECT count(*)::int AS n FROM workstreams WHERE project_id = ${p.id}`)[0].n
      await call('POST', `retainers/requests/${id}/accept`, { owner_id: ben.id, due_date: '2026-10-09', new_workstream_title: 'Orphan' })
      expect((await sql`SELECT count(*)::int AS n FROM workstreams WHERE project_id = ${p.id}`)[0].n).toBe(before)
    })

    it('does not email you about work you gave yourself', async () => {
      const id = await makeRequest()
      await call('POST', `retainers/requests/${id}/accept`, { ...OK(), owner_id: ana.id })
      expect(sent).toEqual([])
    })

    it('a viewer cannot, and another workspace\'s request is not found', async () => {
      const id = await makeRequest()
      as(staff(vic))
      expect((await call('POST', `retainers/requests/${id}/accept`, OK())).statusCode).toBe(403)
      as(staff(ana))
      const foreign = await makeRequest({ company: otherWs.id, ws: 'someone_else' })
      expect((await call('POST', `retainers/requests/${foreign}/accept`, OK())).statusCode).toBe(404)
    })
  })

  describe('declining', () => {
    it('needs a note, then sends it back to the client', async () => {
      const id = await makeRequest()
      const bare = await call('POST', `retainers/requests/${id}/decline`, { note: '  ' })
      expect([bare.statusCode, bare.body.error.field]).toEqual([422, 'note'])
      expect((await sql`SELECT status FROM requests WHERE id = ${id}`)[0].status).toBe('new')

      const r = await call('POST', `retainers/requests/${id}/decline`, { note: 'Outside this retainer — we will quote separately.' })
      expect(r.statusCode).toBe(200)
      const [req] = await sql`SELECT status, decline_note, decided_by, deliverable_id FROM requests WHERE id = ${id}`
      expect(req).toEqual({ status: 'declined', decline_note: 'Outside this retainer — we will quote separately.', decided_by: ana.id, deliverable_id: null })
      expect((await clientView()).requests[0]).toMatchObject({ status: 'declined', status_label: 'Declined', note: 'Outside this retainer — we will quote separately.' })
    })

    it('cannot undo an acceptance, or be answered twice', async () => {
      const id = await makeRequest()
      await call('POST', `retainers/requests/${id}/accept`, OK())
      const r = await call('POST', `retainers/requests/${id}/decline`, { note: 'Changed our minds' })
      expect([r.statusCode, r.body.error.code]).toEqual([409, 'already_decided'])
      const other = await makeRequest()
      await call('POST', `retainers/requests/${other}/decline`, { note: 'No' })
      expect((await call('POST', `retainers/requests/${other}/decline`, { note: 'Still no' })).statusCode).toBe(409)
      expect((await call('POST', 'retainers/requests/11111111-1111-4111-8111-111111111111/decline', { note: 'x' })).statusCode).toBe(404)
    })

    it('a viewer cannot', async () => {
      const id = await makeRequest()
      as(staff(vic))
      expect((await call('POST', `retainers/requests/${id}/decline`, { note: 'No' })).statusCode).toBe(403)
    })
  })

  describe('handing a deliverable to someone', () => {
    it('tells the new owner when it is created or reassigned, but not on an edit that leaves the owner alone', async () => {
      const created = await call('POST', 'retainers/deliverables', { workstream_id: launch.id, title: 'Reel', owner_id: ben.id })
      expect(created.statusCode).toBe(201)
      expect(sent.map(s => s.to)).toEqual(['ben@rq.test'])
      const id = created.body.deliverable.id
      sent.length = 0
      await call('PATCH', `retainers/deliverables/${id}`, { title: 'Reel v2' })
      expect(sent).toEqual([])
      await call('PATCH', `retainers/deliverables/${id}`, { owner_id: ben.id })
      expect(sent).toEqual([])
      const [other] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('rq_cy', 'cy@rq.test', 'Cy', 'user') RETURNING id`
      await call('PATCH', `retainers/deliverables/${id}`, { owner_id: other.id })
      expect(sent.map(s => s.to)).toEqual(['cy@rq.test'])
      await sql`DELETE FROM deliverables WHERE id = ${id}`
      await sql`DELETE FROM app_users WHERE id = ${other.id}`
    })
  })
})
