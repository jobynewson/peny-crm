// Runs the client portal API (/api/client) against a real Postgres, with
// Clerk's session check replaced so each test can say who is calling. Skipped
// unless SLATE_TEST_DATABASE_URL is set — see _test-db.js.
//
// Two client companies, a Slate user, an impersonation and two project links:
// nobody may see or change anything outside their own scope, and nothing
// internal may reach any of them.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CLAIMS = null
vi.mock('./_auth.js', () => ({
  verifyClerkSession: async () => (CLAIMS ? { claims: CLAIMS } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
  verifyClerkUser: async () => ({ error: { status: 500, code: 'unused', message: 'not used by the client API' } }),
}))
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ users: { getUser: async id => ({ firstName: id === 'user_cl_dana' ? 'Dana' : 'Someone', lastName: 'Client' }) } }),
}))
const newRequestAlerts = []
const changesAlerts = []
const replyAlerts = []
vi.mock('./_alerts.js', async orig => ({
  ...(await orig()),
  alertNewRequest: async (sql, args) => { newRequestAlerts.push(args); return [] },
  alertChangesRequested: async (sql, args) => { changesAlerts.push(args); return [] },
  alertClientReply: async (sql, args) => { replyAlerts.push(args); return [] },
}))
vi.mock('./_ratelimit.js', () => ({ isRateLimited: () => false, getClientIp: () => '127.0.0.1' }))

const { workspaceId } = await import('./_api.js')
const { dispatchClient } = await import('./_client.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws
const ids = {}
const call = async (method, route, { body, token } = {}) => {
  const res = fakeRes()
  const headers = token ? { 'x-portal-token': token } : {}
  await dispatchClient({ method, url: `/api/${route}`, query: { route }, body, headers }, res, { sql })
  return res
}
const DANA = { sub: 'user_cl_dana', v: 2, o: { id: 'org_cl_alpha', rol: 'org:member' } }
const OLU = { sub: 'user_cl_olu', v: 2, o: { id: 'org_cl_beta', rol: 'org:member' } }
const SECRET = 'SECRET-INTERNAL-NOTE'

async function wipe() {
  await sql`DELETE FROM requests WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'CLTest %')`
  await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'CLTest %')`
  await sql`DELETE FROM companies WHERE name LIKE 'CLTest %'`
  await sql`DELETE FROM post_production_schedules WHERE project_id IN (SELECT id FROM projects WHERE name LIKE 'CLTest %')`
  await sql`DELETE FROM work_log WHERE project_id IN (SELECT id FROM projects WHERE name LIKE 'CLTest %')`
  await sql`DELETE FROM projects WHERE name LIKE 'CLTest %'`
  await sql`DELETE FROM app_users WHERE clerk_id = 'user_cl_staff'`
}

describeDb('/api/client', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_cl_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    const [staff] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('user_cl_staff', 'staff@peny.test', 'Staff', 'user') RETURNING id`
    ids.staff = staff.id

    const [alpha] = await sql`INSERT INTO companies (user_id, name, clerk_org_id) VALUES (${ws}, 'CLTest Alpha', 'org_cl_alpha') RETURNING id`
    const [beta] = await sql`INSERT INTO companies (user_id, name, clerk_org_id) VALUES (${ws}, 'CLTest Beta', 'org_cl_beta') RETURNING id`
    ids.alpha = alpha.id

    const [launch] = await sql`INSERT INTO workstreams (user_id, company_id, title, brief) VALUES (${ws}, ${alpha.id}, 'Launch', 'The autumn launch') RETURNING id`
    const [internal] = await sql`INSERT INTO workstreams (user_id, company_id, title, brief) VALUES (${ws}, ${alpha.id}, 'Internal only', 'Not for the client') RETURNING id`
    const [bws] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${beta.id}, 'Beta work') RETURNING id`

    const [hero] = await sql`INSERT INTO deliverables (workstream_id, title, format, owner_id, status, client_visible, internal_notes, due_kind, due_date)
      VALUES (${launch.id}, 'Hero film', '16:9', ${staff.id}, 'in_review', true, ${SECRET}, 'exact', '2026-10-02') RETURNING id`
    const [hidden] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible) VALUES (${launch.id}, 'Hidden cut', 'in_review', false) RETURNING id`
    const [waiting] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible, waiting_note, waiting_since) VALUES (${launch.id}, 'Stills', 'waiting_on_client', true, 'Logo files', now()) RETURNING id`
    await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible) VALUES (${internal.id}, 'Internal thing', 'planned', false)`
    const [bdel] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible) VALUES (${bws.id}, 'Beta film', 'in_review', true) RETURNING id`
    ids.hero = hero.id
    ids.waiting = waiting.id

    const round = async (deliverable, n, by = staff.id) => (await sql`
      INSERT INTO deliveries (deliverable_id, url, round, sent_by) VALUES (${deliverable}, ${`https://f.io/${deliverable.slice(0, 6)}-${n}`}, ${n}, ${by}) RETURNING id`)[0].id
    ids.hero1 = await round(hero.id, 1)
    ids.hero2 = await round(hero.id, 2)
    ids.hidden1 = await round(hidden.id, 1)
    ids.beta1 = await round(bdel.id, 1)

    // A project on the old JSON deliverables, with a work log and a schedule.
    const [legacy] = await sql`INSERT INTO projects (user_id, name, status, portal_token, frame_io_link, deliverables)
      VALUES (${ws}, 'CLTest Legacy', 'Post', 'cltestlegacytoken0001', 'javascript:alert(1)', ${JSON.stringify([
        { text: 'Master', due: '2026-10-01', done: false, assignee_id: staff.id, link: 'https://f.io/master' },
        { text: 'Trailer', done: true, link: 'javascript:alert(1)' },
        { text: '' },
      ])}::jsonb) RETURNING id`
    await sql`INSERT INTO work_log (project_id, note, entry_date, created_by) VALUES (${legacy.id}, 'Graded the hero', '2026-09-20', 'Ana')`
    const [sched] = await sql`INSERT INTO post_production_schedules (user_id, project_id, start_date, end_date) VALUES (${ws}, ${legacy.id}, '2026-09-01', '2026-10-31') RETURNING id`
    await sql`INSERT INTO pps_phases (schedule_id, name, show_in_portal, blocks) VALUES
      (${sched.id}, 'Edit', true, ${JSON.stringify([{ id: 'b1', title: 'Picture lock', start_date: '2026-10-01', end_date: '2026-10-03', is_deadline: true, notes: 'For the client' }])}::jsonb),
      (${sched.id}, 'Internal QC', false, ${JSON.stringify([{ id: 'b2', title: 'QC pass', start_date: '2026-10-04', end_date: '2026-10-04' }])}::jsonb)`

    // A project that has moved to worklists.
    const [moved] = await sql`INSERT INTO projects (user_id, name, status, portal_token, deliverables)
      VALUES (${ws}, 'CLTest Moved', 'Post', 'cltestmovedtoken00002', ${JSON.stringify([{ text: 'Old JSON item' }])}::jsonb) RETURNING id`
    const [mws] = await sql`INSERT INTO workstreams (user_id, company_id, project_id, title) VALUES (${ws}, ${beta.id}, ${moved.id}, 'Moved work') RETURNING id`
    await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible) VALUES (${mws.id}, 'Moved visible', 'planned', true), (${mws.id}, 'Moved hidden', 'planned', false)`
  })
  afterAll(async () => { await wipe(); await sql.end() })

  it('shows a signed-in client their company\'s visible worklist and nothing else', async () => {
    CLAIMS = DANA
    const r = await call('GET', 'client/view')
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatchObject({ scope: { kind: 'company', can_respond: true }, title: 'CLTest Alpha' })
    expect(r.body.workstreams.map(w => w.title)).toEqual(['Launch'])
    const [launch] = r.body.workstreams
    expect(launch.deliverables.map(d => [d.title, d.status, d.status_label])).toEqual([
      ['Hero film', 'ready_for_review', 'Ready for review'],
      ['Stills', 'waiting_on_you', 'Waiting on you'],
    ])
    expect(launch.deliverables[1].waiting_for).toBe('Logo files')
    expect(launch.deliverables[0].rounds.map(x => [x.round, x.response, x.can_respond])).toEqual([[1, 'superseded', false], [2, 'pending', true]])

    const json = JSON.stringify(r.body)
    for (const leak of [SECRET, 'internal_notes', 'owner', 'sent_by', ids.staff, 'Hidden cut', 'Internal only', 'Not for the client', 'Beta film', 'in_review', 'waiting_on_client']) {
      expect(json, leak).not.toContain(leak)
    }
  })

  it('takes an answer on the latest round of a visible deliverable', async () => {
    CLAIMS = DANA
    const bare = await call('POST', `client/deliveries/${ids.hero2}/response`, { body: { response: 'changes_requested' } })
    expect([bare.statusCode, bare.body.error.field]).toEqual([422, 'comment'])
    const old = await call('POST', `client/deliveries/${ids.hero1}/response`, { body: { response: 'approved' } })
    expect([old.statusCode, old.body.error.code]).toEqual([409, 'superseded'])

    const ok = await call('POST', `client/deliveries/${ids.hero2}/response`, { body: { response: 'approved', comment: 'Lovely' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.body.view.workstreams[0].deliverables[0]).toMatchObject({ status: 'approved', status_label: 'Approved' })
    const [dv] = await sql`SELECT client_response, client_comment, responded_by, responded_by_name FROM deliveries WHERE id = ${ids.hero2}`
    expect(dv).toEqual({ client_response: 'approved', client_comment: 'Lovely', responded_by: 'user_cl_dana', responded_by_name: 'Dana Client' })
    const again = await call('POST', `client/deliveries/${ids.hero2}/response`, { body: { response: 'changes_requested', comment: 'Wait' } })
    expect([again.statusCode, again.body.error.code]).toEqual([409, 'already_answered'])
  })

  it('treats another company\'s round, or a hidden one, as not found — whatever the body says', async () => {
    CLAIMS = DANA
    for (const id of [ids.beta1, ids.hidden1]) {
      const r = await call('POST', `client/deliveries/${id}/response`, {
        body: { response: 'approved', company_id: 'anything', org_id: 'org_cl_beta', organizationId: 'org_cl_beta' },
      })
      expect([r.statusCode, r.body.error.code]).toEqual([404, 'not_found'])
    }
    const rows = await sql`SELECT client_response FROM deliveries WHERE id IN (${ids.beta1}, ${ids.hidden1})`
    expect(rows.map(r => r.client_response)).toEqual(['pending', 'pending'])

    // And the other company sees only its own.
    CLAIMS = OLU
    const beta = await call('GET', 'client/view')
    expect(beta.body.title).toBe('CLTest Beta')
    expect(JSON.stringify(beta.body)).not.toContain('Hero film')
  })

  it('refuses Slate staff, a session with no organisation and an organisation with no portal', async () => {
    CLAIMS = { sub: 'user_cl_staff', v: 2, o: { id: 'org_cl_alpha' } }
    expect((await call('GET', 'client/view')).body.error.code).toBe('staff')
    CLAIMS = { sub: 'user_cl_dana', v: 2 }
    expect((await call('GET', 'client/view')).body.error.code).toBe('no_organisation')
    CLAIMS = { sub: 'user_cl_dana', v: 2, o: { id: 'org_nobody' } }
    expect((await call('GET', 'client/view')).body.error.code).toBe('no_portal')
    CLAIMS = { sub: 'user_cl_dana', org_id: 'org_cl_alpha' }   // v1 token
    expect((await call('GET', 'client/view')).body.title).toBe('CLTest Alpha')
    CLAIMS = null
    expect((await call('GET', 'client/view')).statusCode).toBe(401)
  })

  it('lets an impersonation look but not answer', async () => {
    CLAIMS = { ...DANA, act: { sub: 'user_cl_staff' } }
    const view = await call('GET', 'client/view')
    expect(view.body.scope.can_respond).toBe(false)
    expect(JSON.stringify(view.body)).not.toContain('"can_respond":true')
    const r = await call('POST', `client/deliveries/${ids.hero2}/response`, { body: { response: 'approved' } })
    expect([r.statusCode, r.body.error.code]).toEqual([403, 'read_only'])
  })

  it('gives a project link that project only, read-only, from the old JSON until it moves', async () => {
    CLAIMS = DANA   // a session as well: the link still wins
    const r = await call('GET', 'client/view', { token: 'cltestlegacytoken0001' })
    expect(r.body).toMatchObject({ scope: { kind: 'project', can_respond: false }, title: 'CLTest Legacy', workstreams: null })
    expect(r.body.project.frame_io_link).toBeNull()            // not http(s): dropped
    expect(r.body.deliverables).toEqual([
      { text: 'Master', due: '2026-10-01', done: false, link: 'https://f.io/master' },
      { text: 'Trailer', due: null, done: true, link: null },
    ])
    expect(r.body.work_log).toEqual([{ note: 'Graded the hero', date: '2026-09-20', by: 'Ana' }])
    expect(r.body.schedule.phases.map(p => p.name)).toEqual(['Edit'])
    expect(JSON.stringify(r.body)).not.toContain('assignee')
    expect(JSON.stringify(r.body)).not.toContain('CLTest Alpha')

    const moved = await call('GET', 'client/view', { token: 'cltestmovedtoken00002' })
    expect(moved.body.deliverables).toBeNull()
    expect(moved.body.workstreams.flatMap(w => w.deliverables.map(d => d.title))).toEqual(['Moved visible'])

    const answer = await call('POST', `client/deliveries/${ids.hero1}/response`, { token: 'cltestlegacytoken0001', body: { response: 'approved' } })
    expect([answer.statusCode, answer.body.error.code]).toEqual([403, 'read_only'])
    for (const bad of ['nope', 'x'.repeat(8), "' OR 1=1 --"]) {
      expect((await call('GET', 'client/view', { token: bad })).statusCode).toBe(404)
    }
  })

  it('resolves the route before asking who is calling', async () => {
    CLAIMS = null
    expect((await call('GET', 'client/everything')).statusCode).toBe(404)
    expect((await call('DELETE', 'client/view')).statusCode).toBe(405)
    expect((await call('POST', 'client/deliveries/not-a-uuid/response', { body: {} })).statusCode).toBe(404)
  })

  describe('requests', () => {
    const mine = `company_id IN (SELECT id FROM companies WHERE name LIKE 'CLTest %') OR project_id IN (SELECT id FROM projects WHERE name LIKE 'CLTest %')`
    beforeEach(async () => {
      await sql`DELETE FROM requests WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'CLTest %') OR project_id IN (SELECT id FROM projects WHERE name LIKE 'CLTest %')`
      await sql`UPDATE projects SET status = 'Post' WHERE name LIKE 'CLTest %'`
      newRequestAlerts.length = 0
    })
    const raise = (body, opts = {}) => call('POST', 'client/requests', { body, ...opts })
    const count = async () => (await sql`SELECT count(*)::int AS n FROM requests WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'CLTest %') OR project_id IN (SELECT id FROM projects WHERE name LIKE 'CLTest %')`)[0].n

    it('lets a signed-in client raise one, shows it as Submitted, and tells us', async () => {
      CLAIMS = DANA
      const r = await raise({ title: '  Cut-down of the film ', detail: 'See https://x.test/brief', wanted_by: '2026-10-30' })
      expect(r.statusCode).toBe(201)
      expect(r.body.view.requests).toHaveLength(1)
      expect(r.body.view.requests[0]).toMatchObject({
        title: 'Cut-down of the film', detail: 'See https://x.test/brief', wanted_by: '2026-10-30',
        status: 'submitted', status_label: 'Submitted', sent_by: 'Dana Client', accepted: null, note: null,
      })
      const [row] = await sql`SELECT status, submitted_by, submitted_by_name, company_id, user_id FROM requests`
      expect(row).toEqual({ status: 'new', submitted_by: 'user_cl_dana', submitted_by_name: 'Dana Client', company_id: ids.alpha, user_id: ws })
      expect(newRequestAlerts).toHaveLength(1)
      expect(newRequestAlerts[0]).toMatchObject({ companyName: 'CLTest Alpha', request: { title: 'Cut-down of the film', company_id: ids.alpha } })
    })

    it('needs a title and a real date, and writes nothing otherwise', async () => {
      CLAIMS = DANA
      const none = await raise({ title: '   ' })
      expect([none.statusCode, none.body.error.field]).toEqual([422, 'title'])
      const bad = await raise({ title: 'x', wanted_by: '2026-02-30' })
      expect([bad.statusCode, bad.body.error.field]).toEqual([422, 'wanted_by'])
      expect(await count()).toBe(0)
      expect(newRequestAlerts).toEqual([])
    })

    it('is for signed-in clients and project links only: not an impersonation, Slate staff or an Approve link', async () => {
      CLAIMS = { ...DANA, act: { sub: 'user_cl_staff' } }
      const impersonated = await raise({ title: 'x' })
      expect([impersonated.statusCode, impersonated.body.error.code]).toEqual([403, 'read_only'])
      CLAIMS = { sub: 'user_cl_staff', v: 2, o: { id: 'org_cl_alpha' } }
      expect((await raise({ title: 'x' })).body.error.code).toBe('staff')
      CLAIMS = null
      expect((await raise({ title: 'x' })).statusCode).toBe(401)
      expect(await count()).toBe(0)
      expect(newRequestAlerts).toEqual([])
    })

    describe('through a project link', () => {
      const LINK = 'cltestlegacytoken0001'   // CLTest Legacy: a project with no company
      const viaLink = (body, token = LINK) => raise(body, { token })

      it('takes one with a name, files it under the project, marks it as sent via the link, and tells us', async () => {
        CLAIMS = null
        const r = await viaLink({ name: '  Sam   Lee ', title: 'A cut-down', detail: 'See https://x.test', wanted_by: '2026-10-30' })
        expect(r.statusCode).toBe(201)
        expect(r.body.view.requests).toHaveLength(1)
        expect(r.body.view.requests[0]).toMatchObject({ title: 'A cut-down', status: 'submitted', sent_by: 'Sam Lee', accepted: null })
        const [row] = await sql`SELECT project_id, company_id, submitted_via, submitted_by, submitted_by_name, user_id FROM requests`
        expect(row).toMatchObject({ submitted_via: 'link', submitted_by: null, submitted_by_name: 'Sam Lee', company_id: null, user_id: ws })
        const [legacy] = await sql`SELECT id FROM projects WHERE name = 'CLTest Legacy'`
        expect(row.project_id).toBe(legacy.id)
        expect(newRequestAlerts).toHaveLength(1)
        expect(newRequestAlerts[0]).toMatchObject({ companyName: 'CLTest Legacy', request: { submitted_via: 'link', submitted_by_name: 'Sam Lee', project_id: legacy.id } })
      })

      it('needs a name, and a title, and writes nothing otherwise', async () => {
        CLAIMS = null
        for (const [body, field] of [[{ title: 'x' }, 'name'], [{ name: '   ', title: 'x' }, 'name'], [{ name: 'x'.repeat(101), title: 'x' }, 'name'], [{ name: 'Sam', title: ' ' }, 'title'], [{ name: 'Sam', title: 'x', wanted_by: '2026-02-30' }, 'wanted_by']]) {
          const r = await viaLink(body)
          expect([r.statusCode, r.body.error.field], JSON.stringify(body)).toEqual([422, field])
        }
        expect(await count()).toBe(0)
        expect(newRequestAlerts).toEqual([])
      })

      it('files it under the link\'s project, whatever the body says', async () => {
        CLAIMS = null
        await viaLink({ name: 'Sam', title: 'x', project_id: '11111111-1111-4111-8111-111111111111', company_id: ids.alpha, submitted_via: 'login', status: 'accepted' })
        const [row] = await sql`SELECT project_id, company_id, submitted_via, status FROM requests`
        const [legacy] = await sql`SELECT id FROM projects WHERE name = 'CLTest Legacy'`
        expect(row).toEqual({ project_id: legacy.id, company_id: null, submitted_via: 'link', status: 'new' })
      })

      it('shows the people holding the link what was sent through it — and not a signed-in client\'s requests', async () => {
        CLAIMS = DANA
        await raise({ title: 'Signed-in ask' })
        CLAIMS = null
        await viaLink({ name: 'Sam', title: 'Link ask' })
        const view = await call('GET', 'client/view', { token: LINK })
        expect(view.body.scope).toMatchObject({ kind: 'project', can_respond: false, can_request: true })
        expect(view.body.requests.map(r => r.title)).toEqual(['Link ask'])
        expect(JSON.stringify(view.body)).not.toContain('Signed-in ask')
      })

      it('stops at ten unanswered per project, separately from each other project, and from a company\'s signed-in clients', async () => {
        CLAIMS = null
        for (let i = 1; i <= 10; i++) expect((await viaLink({ name: 'Sam', title: `Ask ${i}` })).statusCode).toBe(201)
        const eleventh = await viaLink({ name: 'Sam', title: 'Ask 11' })
        expect([eleventh.statusCode, eleventh.body.error.code]).toEqual([429, 'too_many_open'])
        expect((await viaLink({ name: 'Sam', title: 'Other project' }, 'cltestmovedtoken00002')).statusCode).toBe(201)
        await sql`UPDATE requests SET status = 'declined', decline_note = 'No' WHERE title = 'Ask 1'`
        expect((await viaLink({ name: 'Sam', title: 'Ask 11' })).statusCode).toBe(201)
      })

      it('does not stop a company\'s signed-in clients, even when the link is full of requests for its projects', async () => {
        CLAIMS = null
        const [alphaProject] = await sql`INSERT INTO projects (user_id, name, company_id, portal_token) VALUES (${ws}, 'CLTest Alpha project', ${ids.alpha}, 'cltestalphatoken000003') RETURNING id`
        for (let i = 1; i <= 10; i++) expect((await viaLink({ name: 'Sam', title: `Link ${i}` }, 'cltestalphatoken000003')).statusCode).toBe(201)
        CLAIMS = DANA
        expect((await raise({ title: 'Signed-in ask' })).statusCode).toBe(201)
        // …and the company's own view shows both, the link ones with the name typed.
        const view = await call('GET', 'client/view')
        expect(view.body.requests).toHaveLength(11)
        await sql`DELETE FROM requests WHERE project_id = ${alphaProject.id}`
        await sql`DELETE FROM projects WHERE id = ${alphaProject.id}`
      })

      it('stops taking requests once the project is Delivered, and says so, and still shows the page', async () => {
        CLAIMS = null
        await sql`UPDATE projects SET status = 'Delivered' WHERE name = 'CLTest Legacy'`
        const r = await viaLink({ name: 'Sam', title: 'Too late' })
        expect([r.statusCode, r.body.error.code]).toEqual([409, 'project_closed'])
        expect(r.body.error.message).toMatch(/delivered/i)
        expect(await count()).toBe(0)
        const view = await call('GET', 'client/view', { token: LINK })
        expect(view.body.scope.can_request).toBe(false)
        expect(view.body.title).toBe('CLTest Legacy')
      })

      it('still cannot answer or reply: a link is not a client', async () => {
        CLAIMS = null
        const answer = await call('POST', `client/deliveries/${ids.hero1}/response`, { token: LINK, body: { response: 'approved' } })
        expect([answer.statusCode, answer.body.error.code]).toEqual([403, 'read_only'])
        const reply = await call('POST', `client/deliverables/${ids.waiting}/reply`, { token: LINK, body: { reply: 'hi' } })
        expect(reply.statusCode).toBeGreaterThanOrEqual(400)
      })

      it('does not take one from an unknown link', async () => {
        CLAIMS = null
        expect((await viaLink({ name: 'Sam', title: 'x' }, 'nosuchlinktoken0000')).statusCode).toBe(404)
        expect(await count()).toBe(0)
      })
    })

    it('files it under the caller\'s own company, whatever the body says, and keeps companies apart', async () => {
      CLAIMS = DANA
      await raise({ title: 'Alpha ask', company_id: 'anything', org_id: 'org_cl_beta', user_id: 'someone_else', status: 'accepted' })
      const [row] = await sql`SELECT company_id, user_id, status FROM requests`
      expect(row).toEqual({ company_id: ids.alpha, user_id: ws, status: 'new' })
      CLAIMS = OLU
      const beta = await call('GET', 'client/view')
      expect(beta.body.requests).toEqual([])
      expect(JSON.stringify(beta.body)).not.toContain('Alpha ask')
    })

    it('stops at ten unanswered, and lets more in once we have answered', async () => {
      CLAIMS = DANA
      for (let i = 1; i <= 10; i++) expect((await raise({ title: `Ask ${i}` })).statusCode).toBe(201)
      const eleventh = await raise({ title: 'Ask 11' })
      expect([eleventh.statusCode, eleventh.body.error.code]).toEqual([429, 'too_many_open'])
      expect(await count()).toBe(10)
      await sql`UPDATE requests SET status = 'declined', decline_note = 'No' WHERE title = 'Ask 1'`
      expect((await raise({ title: 'Ask 11' })).statusCode).toBe(201)
      // another company's queue is its own
      CLAIMS = OLU
      expect((await raise({ title: 'Beta ask' })).statusCode).toBe(201)
    })

    it('shows what we decided in the client\'s words, and nothing of who decided', async () => {
      CLAIMS = DANA
      const [launch] = await sql`SELECT id FROM workstreams WHERE company_id = ${ids.alpha} AND title = 'Launch'`
      const [shown] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible, due_kind, due_date, owner_id)
        VALUES (${launch.id}, 'Cut-down of the film', 'in_progress', true, 'exact', '2026-10-09', ${ids.staff}) RETURNING id`
      const [hiddenD] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible, due_kind, due_date)
        VALUES (${launch.id}, 'Quietly hidden', 'planned', false, 'exact', '2026-10-10') RETURNING id`
      await sql`INSERT INTO requests (user_id, company_id, submitted_by, submitted_by_name, title, status, deliverable_id, decided_by, decided_at)
        VALUES (${ws}, ${ids.alpha}, 'user_cl_dana', 'Dana Client', 'Accepted one', 'accepted', ${shown.id}, ${ids.staff}, now()),
               (${ws}, ${ids.alpha}, 'user_cl_dana', 'Dana Client', 'Accepted but hidden', 'accepted', ${hiddenD.id}, ${ids.staff}, now()),
               (${ws}, ${ids.alpha}, 'user_cl_dana', 'Dana Client', 'Declined one', 'declined', NULL, ${ids.staff}, now())`
      await sql`UPDATE requests SET decline_note = 'Outside this retainer — we will quote separately.' WHERE title = 'Declined one'`
      const view = (await call('GET', 'client/view')).body
      const byTitle = Object.fromEntries(view.requests.map(r => [r.title, r]))
      expect(byTitle['Accepted one']).toMatchObject({ status: 'accepted', status_label: 'Accepted', accepted: { deliverable_id: shown.id, due: 'Fri 9 Oct', status_label: 'In progress' } })
      expect(byTitle['Accepted but hidden']).toMatchObject({ status_label: 'Accepted', accepted: null })
      expect(byTitle['Declined one']).toMatchObject({ status: 'declined', note: 'Outside this retainer — we will quote separately.' })
      const json = JSON.stringify(view)
      for (const leak of [ids.staff, 'decided', 'Quietly hidden']) expect(json, leak).not.toContain(leak)
    })
  })

  describe('replies on items waiting on the client', () => {
    beforeEach(async () => {
      await sql`UPDATE deliverables SET client_reply = NULL, client_replied_at = NULL WHERE id = ${ids.waiting}`
      replyAlerts.length = 0
    })
    const reply = (id, body, opts = {}) => call('POST', `client/deliverables/${id}/reply`, { body, ...opts })
    const stored = async () => (await sql`SELECT client_reply, status, waiting_note FROM deliverables WHERE id = ${ids.waiting}`)[0]

    it('saves the note, leaves the item waiting, shows it back, and tells the owner', async () => {
      CLAIMS = DANA
      const r = await reply(ids.waiting, { reply: '  The product shipped on Friday. ' })
      expect(r.statusCode).toBe(200)
      expect(await stored()).toEqual({ client_reply: 'The product shipped on Friday.', status: 'waiting_on_client', waiting_note: 'Logo files' })
      const stills = r.body.view.workstreams[0].deliverables.find(d => d.title === 'Stills')
      expect(stills).toMatchObject({ status: 'waiting_on_you', waiting_for: 'Logo files', reply: { text: 'The product shipped on Friday.' }, can_reply: true })
      expect(replyAlerts).toEqual([{ deliverableId: ids.waiting, reply: 'The product shipped on Friday.', by: 'Dana Client' }])
    })

    it('keeps the latest and tells us every time', async () => {
      CLAIMS = DANA
      await reply(ids.waiting, { reply: 'Not yet' })
      await reply(ids.waiting, { reply: 'Shipped now' })
      expect((await stored()).client_reply).toBe('Shipped now')
      expect(replyAlerts.map(a => a.reply)).toEqual(['Not yet', 'Shipped now'])
    })

    it('needs a note, and a short one', async () => {
      CLAIMS = DANA
      for (const body of [{}, { reply: '   ' }, { reply: 'x'.repeat(1001) }]) {
        const r = await reply(ids.waiting, body)
        expect([r.statusCode, r.body.error.field]).toEqual([422, 'reply'])
      }
      expect((await stored()).client_reply).toBeNull()
      expect(replyAlerts).toEqual([])
    })

    it('only for an item that is waiting on them, shown to them, in their company', async () => {
      CLAIMS = DANA
      const notWaiting = await reply(ids.hero, { reply: 'hello' })
      expect([notWaiting.statusCode, notWaiting.body.error.code]).toEqual([409, 'not_waiting'])
      const [hiddenD] = await sql`SELECT d.id FROM deliverables d WHERE d.title = 'Hidden cut'`
      const [betaD] = await sql`SELECT d.id FROM deliverables d WHERE d.title = 'Beta film'`
      await sql`UPDATE deliverables SET status = 'waiting_on_client' WHERE id IN (${hiddenD.id}, ${betaD.id})`
      for (const id of [hiddenD.id, betaD.id, '11111111-1111-4111-8111-111111111111']) {
        const r = await reply(id, { reply: 'hello', company_id: 'anything', org_id: 'org_cl_beta' })
        expect([r.statusCode, r.body.error.code], id).toEqual([404, 'not_found'])
      }
      await sql`UPDATE deliverables SET status = 'in_review' WHERE id IN (${hiddenD.id}, ${betaD.id})`
      const rows = await sql`SELECT client_reply FROM deliverables WHERE id IN (${hiddenD.id}, ${betaD.id}, ${ids.hero})`
      expect(rows.map(r => r.client_reply)).toEqual([null, null, null])
      expect(replyAlerts).toEqual([])
    })

    it('is for signed-in clients only: not a portal link, an impersonation or Slate staff', async () => {
      CLAIMS = DANA
      const viaLink = await reply(ids.waiting, { reply: 'hi' }, { token: 'cltestmovedtoken00002' })
      expect([viaLink.statusCode, viaLink.body.error.code]).toEqual([403, 'signed_in_only'])
      CLAIMS = { ...DANA, act: { sub: 'user_cl_staff' } }
      expect((await reply(ids.waiting, { reply: 'hi' })).body.error.code).toBe('read_only')
      CLAIMS = { sub: 'user_cl_staff', v: 2, o: { id: 'org_cl_alpha' } }
      expect((await reply(ids.waiting, { reply: 'hi' })).body.error.code).toBe('staff')
      CLAIMS = null
      expect((await reply(ids.waiting, { reply: 'hi' })).statusCode).toBe(401)
      expect((await stored()).client_reply).toBeNull()
      expect(replyAlerts).toEqual([])
    })

    it('a project link never sees a reply, and an impersonation sees it but cannot add to it', async () => {
      CLAIMS = DANA
      await reply(ids.waiting, { reply: 'PRIVATE-REPLY-TEXT' })
      CLAIMS = { ...DANA, act: { sub: 'user_cl_staff' } }
      const seen = (await call('GET', 'client/view')).body.workstreams[0].deliverables.find(d => d.title === 'Stills')
      expect(seen).toMatchObject({ reply: { text: 'PRIVATE-REPLY-TEXT' }, can_reply: false })
      const moved = await call('GET', 'client/view', { token: 'cltestmovedtoken00002' })
      expect(JSON.stringify(moved.body)).not.toContain('PRIVATE-REPLY-TEXT')
    })
  })

  describe('changes requested', () => {
    beforeEach(async () => {
      changesAlerts.length = 0
      await sql`UPDATE deliveries SET client_response = 'pending', client_comment = NULL, responded_at = NULL WHERE id = ${ids.hero2}`
      await sql`UPDATE deliverables SET status = 'in_review' WHERE id = ${ids.hero}`
    })

    it('tells the owner when a client asks for changes, with what they said', async () => {
      CLAIMS = DANA
      const r = await call('POST', `client/deliveries/${ids.hero2}/response`, { body: { response: 'changes_requested', comment: ' Bigger logo, please ' } })
      expect(r.statusCode).toBe(200)
      expect(changesAlerts).toEqual([{ deliverableId: ids.hero, comment: 'Bigger logo, please', by: 'Dana Client' }])
    })

    it('says nothing about an approval (that is for the digest), or about an answer that was refused', async () => {
      CLAIMS = DANA
      await call('POST', `client/deliveries/${ids.hero2}/response`, { body: { response: 'changes_requested' } })   // no comment: 422
      await call('POST', `client/deliveries/${ids.hero1}/response`, { body: { response: 'changes_requested', comment: 'old round' } })   // superseded: 409
      await call('POST', `client/deliveries/${ids.beta1}/response`, { body: { response: 'changes_requested', comment: 'not ours' } })   // 404
      expect(changesAlerts).toEqual([])
      await call('POST', `client/deliveries/${ids.hero2}/response`, { body: { response: 'approved' } })
      expect(changesAlerts).toEqual([])
    })

    it('does not fail the answer if the email does', async () => {
      CLAIMS = DANA
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      changesAlerts.push = () => { throw new Error('Gmail said no') }
      const r = await call('POST', `client/deliveries/${ids.hero2}/response`, { body: { response: 'changes_requested', comment: 'Brighter' } })
      delete changesAlerts.push
      spy.mockRestore()
      expect(r.statusCode).toBe(200)
      expect((await sql`SELECT client_response FROM deliveries WHERE id = ${ids.hero2}`)[0].client_response).toBe('changes_requested')
    })
  })
})
