// Runs the client portal API (/api/client) against a real Postgres, with
// Clerk's session check replaced so each test can say who is calling. Skipped
// unless SLATE_TEST_DATABASE_URL is set — see _test-db.js.
//
// Two client companies, a Slate user, an impersonation and two project links:
// nobody may see or change anything outside their own scope, and nothing
// internal may reach any of them.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CLAIMS = null
vi.mock('./_auth.js', () => ({
  verifyClerkSession: async () => (CLAIMS ? { claims: CLAIMS } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
  verifyClerkUser: async () => ({ error: { status: 500, code: 'unused', message: 'not used by the client API' } }),
}))
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ users: { getUser: async id => ({ firstName: id === 'user_cl_dana' ? 'Dana' : 'Someone', lastName: 'Client' }) } }),
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
})
