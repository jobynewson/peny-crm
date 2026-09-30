// Runs /api/retainers against a real Postgres. Skipped unless
// SLATE_TEST_DATABASE_URL is set — see _test-db.js for setup.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT
    ? { user: CURRENT }
    : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES } = await import('./_retainers.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, ana, vic, company, project, otherCompany, otherProject, foreignDeliverable

const call = async (method, route, body) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route }, body, headers: {} }, res, { name: 'retainers', routes: ROUTES, sql })
  return res
}
const as = user => { CURRENT = user }

async function wipe() {
  await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'RetTest %')
            OR project_id IN (SELECT id FROM projects WHERE name LIKE 'RetTest %')`
  await sql`DELETE FROM projects WHERE name LIKE 'RetTest %'`
  await sql`DELETE FROM companies WHERE name LIKE 'RetTest %'`
  await sql`DELETE FROM app_users WHERE clerk_id IN ('ret_ana', 'ret_vic')`
}

describeDb('/api/retainers', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_ret_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('ret_ana', 'ana@ret.test', 'Ana', 'user') RETURNING id, clerk_id, email, name, role`
    ;[vic] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('ret_vic', 'vic@ret.test', 'Vic', 'viewer') RETURNING id, clerk_id, email, name, role`
    ;[company] = await sql`INSERT INTO companies (user_id, name) VALUES (${ws}, 'RetTest DMM') RETURNING id`
    ;[project] = await sql`INSERT INTO projects (user_id, name, company_id, is_retainer) VALUES (${ws}, 'RetTest Retainer', ${company.id}, true) RETURNING id`
    // Another workspace's worklist: must read as not found.
    ;[otherCompany] = await sql`INSERT INTO companies (user_id, name) VALUES ('someone_else', 'RetTest Other') RETURNING id`
    ;[otherProject] = await sql`INSERT INTO projects (user_id, name, company_id) VALUES ('someone_else', 'RetTest Theirs', ${otherCompany.id}) RETURNING id`
    const [ow] = await sql`INSERT INTO workstreams (user_id, company_id, project_id, title) VALUES ('someone_else', ${otherCompany.id}, ${otherProject.id}, 'Theirs') RETURNING id`
    ;[foreignDeliverable] = await sql`INSERT INTO deliverables (workstream_id, title) VALUES (${ow.id}, 'Not yours') RETURNING id`
  })
  afterAll(async () => { await wipe(); await sql.end() })

  let workstream, hero
  it('creates a workstream and a deliverable, hidden from the client by default', async () => {
    as(ana)
    const w = await call('POST', 'retainers/workstreams', { project_id: project.id, title: ' Launch ', brief: 'Autumn launch' })
    expect(w.statusCode).toBe(201)
    workstream = w.body.workstream
    expect(workstream).toMatchObject({ title: 'Launch', brief: 'Autumn launch', status: 'active', sort_order: 0, deliverables: [] })

    const d = await call('POST', 'retainers/deliverables', {
      workstream_id: workstream.id, title: 'Hero film', format: '16:9', owner_id: ana.id, due_kind: 'exact', due_date: '2026-10-02',
    })
    expect(d.statusCode).toBe(201)
    hero = d.body.deliverable
    expect(hero).toMatchObject({
      title: 'Hero film', format: '16:9', owner_id: ana.id, owner_name: 'Ana', due_date: '2026-10-02', status: 'planned',
      status_label: 'Planned', client_status: 'Planned', client_visible: false, deliveries: [],
    })
    const second = await call('POST', 'retainers/deliverables', { workstream_id: workstream.id, title: 'Cutdowns', due_kind: 'month', due_month: '2026-11' })
    expect(second.body.deliverable).toMatchObject({ sort_order: 1, due_date: '2026-11-30', due_display: 'November' })
  })

  it('says which field is wrong', async () => {
    as(ana)
    const cases = [
      ['retainers/workstreams', { project_id: project.id, title: '  ' }, 'title'],
      ['retainers/workstreams', { project_id: 'nope', title: 'X' }, 'project_id'],
      ['retainers/workstreams', { project_id: otherProject.id, title: 'X' }, 'project_id'],
      ['retainers/workstreams', { title: 'X' }, 'project_id'],
      ['retainers/deliverables', { workstream_id: workstream.id, title: 'X', owner_id: '00000000-0000-0000-0000-000000000000' }, 'owner_id'],
      ['retainers/deliverables', { workstream_id: workstream.id, title: 'X', due_kind: 'someday' }, 'due_kind'],
      ['retainers/deliverables', { workstream_id: workstream.id, title: 'X', due_kind: 'recurring' }, 'cadence'],
      ['retainers/deliverables', { workstream_id: workstream.id, title: 'X', waiting_note: 'Logo files' }, 'waiting_note'],
      [`retainers/deliverables/${hero.id}/deliveries`, { url: 'javascript:alert(1)' }, 'url'],
    ]
    for (const [route, body, field] of cases) {
      const r = await call('POST', route, body)
      expect([r.statusCode, r.body.error.field], `${route} ${JSON.stringify(body)}`).toEqual([422, field])
    }
  })

  it('sends rounds: previous + 1, into review, with the sender', async () => {
    as(ana)
    const r1 = await call('POST', `retainers/deliverables/${hero.id}/deliveries`, { url: ' https://f.io/abc ', note: 'First cut' })
    expect(r1.statusCode).toBe(201)
    expect(r1.body.delivery.round).toBe(1)
    expect(r1.body.deliverable).toMatchObject({ status: 'in_review', client_status: 'Ready for review' })
    // sending is where the client is emailed; a hidden deliverable has no one to tell, and it says so
    expect(r1.body.notified).toMatchObject({ sent: 0, reason: 'hidden' })
    expect(r1.body.notified.message).toMatch(/isn't shown to/)
    expect(r1.body.deliverable.deliveries[0]).toMatchObject({
      round: 1, url: 'https://f.io/abc', frame_io: true, note: 'First cut', sent_by: ana.id, sent_by_name: 'Ana',
      client_response: 'pending', response_label: 'Awaiting response', latest: true,
    })
    const r2 = await call('POST', `retainers/deliverables/${hero.id}/deliveries`, { url: 'https://f.io/def' })
    expect(r2.body.delivery.round).toBe(2)
    expect(r2.body.deliverable.deliveries.map(d => [d.round, d.latest, d.response_label])).toEqual([
      [1, false, 'Superseded'], [2, true, 'Awaiting response'],
    ])
  })

  it('records a response on the latest round only; changes need a comment', async () => {
    as(ana)
    const [round1, round2] = (await call('GET', `retainers/projects/${project.id}`)).body.workstreams[0].deliverables[0].deliveries
    const old = await call('POST', `retainers/deliveries/${round1.id}/response`, { response: 'approved' })
    expect([old.statusCode, old.body.error.code]).toEqual([409, 'superseded'])

    const bare = await call('POST', `retainers/deliveries/${round2.id}/response`, { response: 'changes_requested', comment: ' ' })
    expect([bare.statusCode, bare.body.error.field]).toEqual([422, 'comment'])

    const ok = await call('POST', `retainers/deliveries/${round2.id}/response`, { response: 'changes_requested', comment: 'Brighter logo' })
    expect(ok.statusCode).toBe(200)
    expect(ok.body.deliverable).toMatchObject({ status: 'changes_requested', client_status: 'In progress' })
    expect(ok.body.deliverable.deliveries[1]).toMatchObject({
      client_response: 'changes_requested', client_comment: 'Brighter logo', responded_by_name: 'Ana', responded_by_staff: true,
    })
    const again = await call('POST', `retainers/deliveries/${round2.id}/response`, { response: 'approved' })
    expect([again.statusCode, again.body.error.code]).toEqual([409, 'already_answered'])
  })

  it('takes back an unanswered latest round and puts the status back', async () => {
    as(ana)
    const r3 = await call('POST', `retainers/deliverables/${hero.id}/deliveries`, { url: 'https://f.io/wrong' })
    expect(r3.body.deliverable.status).toBe('in_review')
    const back = await call('DELETE', `retainers/deliveries/${r3.body.delivery.id}`)
    expect(back.statusCode).toBe(200)
    expect(back.body.deliverable.status).toBe('changes_requested')        // where round 2 left it
    expect(back.body.deliverable.deliveries.map(d => d.round)).toEqual([1, 2])

    const answered = back.body.deliverable.deliveries[1]
    const refused = await call('DELETE', `retainers/deliveries/${answered.id}`)
    expect([refused.statusCode, refused.body.error.code]).toEqual([409, 'answered'])
  })

  it('keeps the waiting clock: set on entering, cleared with the note on leaving', async () => {
    as(ana)
    const noteFirst = await call('PATCH', `retainers/deliverables/${hero.id}`, { waiting_note: 'Logo files' })
    expect([noteFirst.statusCode, noteFirst.body.error.field]).toEqual([422, 'waiting_note'])

    const waiting = await call('PATCH', `retainers/deliverables/${hero.id}`, { status: 'waiting_on_client', waiting_note: 'Logo files' })
    expect(waiting.body.deliverable).toMatchObject({ status: 'waiting_on_client', waiting_note: 'Logo files', client_status: 'Waiting on you' })
    expect(waiting.body.deliverable.waiting_since).toBeTruthy()

    expect(waiting.body.deliverable.waiting_days).toBe(0)

    const back = await call('PATCH', `retainers/deliverables/${hero.id}`, { status: 'in_progress' })
    expect(back.body.deliverable).toMatchObject({ status: 'in_progress', waiting_since: null, waiting_note: null, waiting_days: null })
  })

  it('clears the client\'s reply with the note, however the item stops waiting — and only then', async () => {
    as(ana)
    const reply = () => sql`SELECT client_reply, client_replied_at FROM deliverables WHERE id = ${hero.id}`.then(r => r[0])
    const waitWithReply = async () => {
      await call('PATCH', `retainers/deliverables/${hero.id}`, { status: 'waiting_on_client', waiting_note: 'Ship date' })
      await sql`UPDATE deliverables SET client_reply = 'Shipped Friday', client_replied_at = now() WHERE id = ${hero.id}`
    }

    // editing the note or the title while it waits leaves the reply
    await waitWithReply()
    await call('PATCH', `retainers/deliverables/${hero.id}`, { waiting_note: 'Ship date, please' })
    await call('PATCH', `retainers/deliverables/${hero.id}`, { title: 'Hero film v2' })
    expect((await reply()).client_reply).toBe('Shipped Friday')

    // moving it on (a status change) clears it
    await call('PATCH', `retainers/deliverables/${hero.id}`, { status: 'in_progress' })
    expect(await reply()).toEqual({ client_reply: null, client_replied_at: null })

    // sending a round for review moves it on too
    await waitWithReply()
    await call('POST', `retainers/deliverables/${hero.id}/deliveries`, { url: 'https://f.io/reply-clear' })
    expect(await reply()).toEqual({ client_reply: null, client_replied_at: null })
    const [{ id: roundId }] = await sql`SELECT id FROM deliveries WHERE deliverable_id = ${hero.id} AND url = 'https://f.io/reply-clear'`
    await call('DELETE', `retainers/deliveries/${roundId}`)
    // put the shared fixture back the way the next test expects it
    await call('PATCH', `retainers/deliverables/${hero.id}`, { title: 'Hero film', status: 'in_progress' })
  })

  it('writes only what a PATCH sends, and normalises due dates as a set', async () => {
    as(ana)
    const r = await call('PATCH', `retainers/deliverables/${hero.id}`, { title: 'Hero film v2', client_visible: true })
    expect(r.body.deliverable).toMatchObject({ title: 'Hero film v2', client_visible: true, format: '16:9', status: 'in_progress', owner_id: ana.id })

    const win = await call('PATCH', `retainers/deliverables/${hero.id}`, { due_kind: 'window', due_date: '2026-10-07', due_label: '1st week of October' })
    expect(win.body.deliverable).toMatchObject({ due_kind: 'window', due_date: '2026-10-07', due_display: '1st week of October' })
    // Changing the kind drops the old words unless new ones are sent.
    const exact = await call('PATCH', `retainers/deliverables/${hero.id}`, { due_kind: 'exact', due_date: '2026-10-09' })
    expect(exact.body.deliverable).toMatchObject({ due_kind: 'exact', due_label: null, due_display: 'Fri 9 Oct' })
  })

  it('refuses to delete work with rounds sent, and deletes work without', async () => {
    as(ana)
    const d = await call('DELETE', `retainers/deliverables/${hero.id}`)
    expect([d.statusCode, d.body.error.code]).toEqual([409, 'has_rounds'])
    const w = await call('DELETE', `retainers/workstreams/${workstream.id}`)
    expect([w.statusCode, w.body.error.code]).toEqual([409, 'has_rounds'])

    const spare = await call('POST', 'retainers/deliverables', { workstream_id: workstream.id, title: 'Spare' })
    expect((await call('DELETE', `retainers/deliverables/${spare.body.deliverable.id}`)).statusCode).toBe(200)
    const empty = await call('POST', 'retainers/workstreams', { project_id: project.id, title: 'Empty' })
    expect((await call('DELETE', `retainers/workstreams/${empty.body.workstream.id}`)).statusCode).toBe(200)
  })

  it('sends the page the words it needs, so the browser holds no copy of the rules', async () => {
    as(ana)
    const r = await call('GET', `retainers/projects/${project.id}`)
    expect(r.body.vocab.statuses.map(s => s.key)).toEqual(['planned', 'in_progress', 'waiting_on_client', 'in_review', 'changes_requested', 'approved'])
    expect(r.body.vocab.statuses.find(s => s.key === 'changes_requested')).toMatchObject({ label: 'Changes requested', client_label: 'In progress' })
    expect(r.body.vocab.workstream_statuses.map(s => s.key)).toEqual(['active', 'paused', 'complete'])
    expect(r.body.workstreams[0].status_label).toBe('Active')
    const late = await call('POST', 'retainers/deliverables', { workstream_id: workstream.id, title: 'Late one', due_date: '2020-01-01' })
    expect(late.body.deliverable).toMatchObject({ overdue: true })
    expect(late.body.deliverable.days_late).toBeGreaterThan(365)
    await call('DELETE', `retainers/deliverables/${late.body.deliverable.id}`)
  })

  it('lets a viewer read but not write', async () => {
    as(vic)
    expect((await call('GET', `retainers/projects/${project.id}`)).statusCode).toBe(200)
    for (const [method, route, body] of [
      ['POST', 'retainers/workstreams', { project_id: project.id, title: 'X' }],
      ['PATCH', `retainers/deliverables/${hero.id}`, { title: 'X' }],
      ['POST', `retainers/deliverables/${hero.id}/deliveries`, { url: 'https://f.io/x' }],
      ['DELETE', `retainers/workstreams/${workstream.id}`],
    ]) {
      const r = await call(method, route, body)
      expect([r.statusCode, r.body.error.code], `${method} ${route}`).toEqual([403, 'read_only'])
    }
  })

  it('treats another workspace\'s worklist as not found', async () => {
    as(ana)
    expect((await call('GET', `retainers/projects/${otherProject.id}`)).statusCode).toBe(404)
    expect((await call('PATCH', `retainers/deliverables/${foreignDeliverable.id}`, { title: 'Mine now' })).statusCode).toBe(404)
    expect((await call('POST', `retainers/deliverables/${foreignDeliverable.id}/deliveries`, { url: 'https://f.io/x' })).statusCode).toBe(404)
    expect((await call('DELETE', `retainers/deliverables/${foreignDeliverable.id}`)).statusCode).toBe(404)
    const [still] = await sql`SELECT title FROM deliverables WHERE id = ${foreignDeliverable.id}`
    expect(still.title).toBe('Not yours')
  })

  it('never gives two sends at once the same round', async () => {
    as(ana)
    const d = await call('POST', 'retainers/deliverables', { workstream_id: workstream.id, title: 'Race', status: 'in_review' })
    const id = d.body.deliverable.id
    const sends = await Promise.all([1, 2, 3].map(n => call('POST', `retainers/deliverables/${id}/deliveries`, { url: `https://f.io/${n}` })))
    expect(sends.map(s => s.statusCode).every(c => c === 201 || c === 409)).toBe(true)
    const rounds = (await sql`SELECT round FROM deliveries WHERE deliverable_id = ${id} ORDER BY round`).map(r => r.round)
    expect(rounds).toEqual(rounds.map((_, i) => i + 1))
    expect(rounds.length).toBe(sends.filter(s => s.statusCode === 201).length)
  })

  it('treats a link without a preview as fine', async () => {
    as(ana)
    const d = await call('POST', 'retainers/deliverables', { workstream_id: workstream.id, title: 'Local' })
    const sent = await call('POST', `retainers/deliverables/${d.body.deliverable.id}/deliveries`, { url: 'http://127.0.0.1/private' })
    const r = await call('POST', `retainers/deliveries/${sent.body.delivery.id}/preview`)
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatchObject({ preview: null, reason: 'Host not allowed' })
  })
})
