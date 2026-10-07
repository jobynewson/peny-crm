// Runs the task board's deliverable cards (/api/retainers/board and board-move)
// against a real Postgres. Skipped unless SLATE_TEST_DATABASE_URL is set.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT ? { user: CURRENT } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES } = await import('./_retainers.js')
const { DRAG_REFUSALS } = await import('./_retainer-rules.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, ana, ben, vic, co, live, paused
const call = async (method, route, body, query = {}) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route, ...query }, body, headers: {} }, res, { name: 'retainers', routes: ROUTES, sql })
  return res
}
const staff = u => ({ id: u.id, clerk_id: u.clerk_id, role: u.role, name: u.name, email: u.email })
const iso = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
async function add(title, over = {}) {
  const o = { owner: ana.id, status: 'planned', due: null, stream: live.id, ...over }
  const [row] = await sql`INSERT INTO deliverables (workstream_id, title, owner_id, status, due_date, updated_at)
    VALUES (${o.stream}, ${title}, ${o.owner}, ${o.status}::deliverable_status, ${o.due}, COALESCE(${o.updated}::timestamptz, now())) RETURNING id`
  return row.id
}
const cards = async () => (await call('GET', 'retainers/board')).body.cards
const status = async id => (await sql`SELECT status, owner_id FROM deliverables WHERE id = ${id}`)[0]

async function wipe() {
  await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'BdTest %')`
  await sql`DELETE FROM companies WHERE name LIKE 'BdTest %'`
  await sql`DELETE FROM app_users WHERE clerk_id LIKE 'bd_%'`
}

describeDb('the board\'s deliverable cards', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_bd_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('bd_ana', 'ana@bd.test', 'Ana', 'user') RETURNING id, clerk_id, email, name, role`
    ;[ben] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('bd_ben', 'ben@bd.test', 'Ben', 'user') RETURNING id, clerk_id, email, name, role`
    ;[vic] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('bd_vic', 'vic@bd.test', 'Vic', 'viewer') RETURNING id, clerk_id, email, name, role`
    ;[co] = await sql`INSERT INTO companies (user_id, name, lead_id) VALUES (${ws}, 'BdTest DMM', ${ana.id}) RETURNING id`
    ;[live] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${co.id}, 'Monthly') RETURNING id`
    ;[paused] = await sql`INSERT INTO workstreams (user_id, company_id, title, status) VALUES (${ws}, ${co.id}, 'Old', 'paused') RETURNING id`
  })
  beforeEach(async () => {
    CURRENT = staff(ana)
    await sql`DELETE FROM deliverables WHERE workstream_id IN (${live.id}, ${paused.id})`
  })
  afterAll(async () => { await wipe(); await sql.end() })

  it('lists cards with their column, chips and whether anyone owns them, and only for active workstreams', async () => {
    await add('Planned soon', { due: iso(3) })
    await add('Doing', { status: 'in_progress' })
    await add('Waiting', { status: 'waiting_on_client' })
    await add('Nobody', { owner: null, status: 'planned' })
    await add('Paused stream', { stream: paused.id, status: 'in_progress' })
    const list = await cards()
    const by = Object.fromEntries(list.map(c => [c.title, c]))
    expect(Object.keys(by).sort()).toEqual(['Doing', 'Nobody', 'Planned soon', 'Waiting'])
    expect(by['Planned soon']).toMatchObject({ column: 'todo', muted: false, chip: null, company: 'BdTest DMM', workstream: 'Monthly' })
    expect(by.Doing.column).toBe('doing')
    expect(by.Waiting).toMatchObject({ column: 'doing', muted: true, chip: { key: 'waiting_on_client' } })
    expect(by.Nobody).toMatchObject({ column: 'todo', unassigned: true, owner_id: null })
    expect(by.Nobody.unassigned_since).toBeTruthy()
    expect(by.Doing).toMatchObject({ unassigned: false, unassigned_since: null })
  })

  it('hides a far-off dated plan but never an undated, unowned or started one', async () => {
    await add('Far plan', { due: iso(60) })
    await add('Undated owned')
    await add('Unowned far', { owner: null, due: iso(200) })
    await add('Started far', { status: 'in_progress', due: iso(200) })
    expect((await cards()).map(c => c.title).sort()).toEqual(['Started far', 'Undated owned', 'Unowned far'])
  })

  it('the window is the person\'s choice: 7, 14, 30 or 60 days, and anything else means the default', async () => {
    await add('In ten days', { due: iso(10) })
    await add('In forty days', { due: iso(40) })
    const titles = async days => (await call('GET', 'retainers/board', undefined, days ? { days: String(days) } : {})).body.cards.map(c => c.title).sort()
    expect(await titles(7)).toEqual([])
    expect(await titles(14)).toEqual(['In ten days'])
    expect(await titles()).toEqual(['In ten days'])
    expect(await titles(9)).toEqual(['In ten days'])       // not one of the four: the 30-day default
    expect(await titles(60)).toEqual(['In forty days', 'In ten days'])
    expect((await call('GET', 'retainers/board', undefined, { days: '60' })).body.days).toBe(60)
  })

  it('an unowned deliverable in a paused workstream is still on the board, unassigned; an owned one is parked', async () => {
    await add('Nobody paused', { stream: paused.id, owner: null })
    await add('Owned paused', { stream: paused.id })
    const list = await cards()
    expect(list.map(c => c.title)).toEqual(['Nobody paused'])
    expect(list[0]).toMatchObject({ unassigned: true, column: 'todo', workstream_status: 'paused' })
  })

  it('keeps approved work in Done for 30 days, and only if owned', async () => {
    await add('Fresh', { status: 'approved' })
    await add('Old', { status: 'approved', updated: new Date(Date.now() - 40 * 86400000).toISOString() })
    await add('Ownerless', { status: 'approved', owner: null })
    const list = await cards()
    expect(list.map(c => [c.title, c.column])).toEqual([['Fresh', 'done']])
  })

  describe('dragging', () => {
    it('moves planned <-> in progress, and nothing else', async () => {
      const id = await add('Reel')
      const up = await call('POST', `retainers/deliverables/${id}/board-move`, { column: 'doing' })
      expect(up.statusCode).toBe(200)
      expect(up.body.card).toMatchObject({ status: 'in_progress', column: 'doing' })
      expect((await status(id)).status).toBe('in_progress')
      const back = await call('POST', `retainers/deliverables/${id}/board-move`, { column: 'todo' })
      expect(back.body.card.status).toBe('planned')
    })

    it('refuses every other move with the sentence to show, and writes nothing', async () => {
      const cases = [
        ['planned', 'done', 'approve'], ['in_progress', 'done', 'approve'],
        ['in_review', 'todo', 'with_client'], ['waiting_on_client', 'todo', 'with_client'],
        ['changes_requested', 'todo', 'changes'], ['approved', 'doing', 'approved'],
      ]
      for (const [from, column, reason] of cases) {
        const id = await add(`${from}-${column}`, { status: from })
        const r = await call('POST', `retainers/deliverables/${id}/board-move`, { column })
        expect([r.statusCode, r.body.error.code, r.body.error.reason, r.body.error.message], `${from} → ${column}`).toEqual([409, 'board_refused', reason, DRAG_REFUSALS[reason]])
        expect((await status(id)).status).toBe(from)
      }
    })

    it('dropping a card where it already is does nothing', async () => {
      const id = await add('Waiting', { status: 'waiting_on_client' })
      const r = await call('POST', `retainers/deliverables/${id}/board-move`, { column: 'doing' })
      expect([r.statusCode, r.body.card.status]).toEqual([200, 'waiting_on_client'])
    })

    it('moving an unowned card to another column claims it — but not if the move is refused', async () => {
      CURRENT = staff(ben)
      const claimable = await add('Unowned', { owner: null })
      const r = await call('POST', `retainers/deliverables/${claimable}/board-move`, { column: 'doing' })
      expect(r.body.card).toMatchObject({ owner_id: ben.id, status: 'in_progress', unassigned: false })
      const stuck = await add('Unowned review', { owner: null, status: 'in_review' })
      const refused = await call('POST', `retainers/deliverables/${stuck}/board-move`, { column: 'todo' })
      expect(refused.statusCode).toBe(409)
      expect((await status(stuck)).owner_id).toBeNull()
      // dropped back in the column it is already in: nothing changes, nobody takes it
      const stays = await call('POST', `retainers/deliverables/${stuck}/board-move`, { column: 'doing' })
      expect(stays.body.card).toMatchObject({ owner_id: null, status: 'in_review', unassigned: true })
      expect((await status(stuck)).owner_id).toBeNull()
    })

    it('never takes an owned card from its owner', async () => {
      CURRENT = staff(ben)
      const id = await add('Anas')
      await call('POST', `retainers/deliverables/${id}/board-move`, { column: 'doing' })
      expect((await status(id)).owner_id).toBe(ana.id)
    })

    it('validates the column, 404s a stranger, and a viewer cannot drag', async () => {
      const id = await add('Reel')
      const bad = await call('POST', `retainers/deliverables/${id}/board-move`, { column: 'nope' })
      expect([bad.statusCode, bad.body.error.field]).toEqual([422, 'column'])
      expect((await call('POST', 'retainers/deliverables/11111111-1111-4111-8111-111111111111/board-move', { column: 'doing' })).statusCode).toBe(404)
      const inPaused = await add('Paused', { stream: paused.id })
      expect((await call('POST', `retainers/deliverables/${inPaused}/board-move`, { column: 'doing' })).statusCode).toBe(404)
      CURRENT = staff(vic)
      expect((await call('POST', `retainers/deliverables/${id}/board-move`, { column: 'doing' })).statusCode).toBe(403)
      expect((await call('GET', 'retainers/board')).statusCode).toBe(200)
    })
  })
})
