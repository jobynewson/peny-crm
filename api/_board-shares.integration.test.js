// Runs sharing a Planning board or canvas with a client company: the staff
// routes that set it (/api/board-shares) and the portal routes that read it
// (/api/client/boards) against a real Postgres, with Clerk's checks replaced so
// each test can say who is calling. Skipped unless SLATE_TEST_DATABASE_URL is
// set — see _test-db.js.
//
// Two client companies: only what is shared with a company is visible to it,
// nested canvases only through their shared root, nothing internal comes out,
// and the portal can't change anything.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let STAFF = null
let CLAIMS = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (STAFF ? { user: STAFF } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
  verifyClerkSession: async () => (CLAIMS ? { claims: CLAIMS } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))
vi.mock('@clerk/backend', () => ({ createClerkClient: () => ({ users: { getUser: async () => ({ firstName: 'Dana', lastName: 'Client' }) } }) }))
vi.mock('./_ratelimit.js', () => ({ isRateLimited: () => false, getClientIp: () => '127.0.0.1' }))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES: STAFF_ROUTES } = await import('./_board-shares.js')
const { dispatchClient } = await import('./_client.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws
const ids = {}
const DANA = { sub: 'user_bs_dana', v: 2, o: { id: 'org_bs_alpha', rol: 'org:member' } }
const OLU = { sub: 'user_bs_olu', v: 2, o: { id: 'org_bs_beta', rol: 'org:member' } }
const SECRET = 'SECRET-INTERNAL-NOTE'

const staff = async (method, route, body) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route }, body, headers: {} }, res, { name: 'board-shares', routes: STAFF_ROUTES, sql })
  return res
}
const client = async (route, { token } = {}) => {
  const res = fakeRes()
  await dispatchClient({ method: 'GET', url: `/api/${route}`, query: { route }, headers: token ? { 'x-portal-token': token } : {} }, res, { sql })
  return res
}

async function wipe() {
  await sql`DELETE FROM canvases WHERE name LIKE 'BSTest %'`
  await sql`DELETE FROM boards WHERE name LIKE 'BSTest %'`
  await sql`DELETE FROM companies WHERE name LIKE 'BSTest %'`
  await sql`DELETE FROM projects WHERE name LIKE 'BSTest %'`
  await sql`DELETE FROM app_users WHERE clerk_id IN ('user_bs_staff', 'user_bs_viewer', 'user_bs_dana')`
}

describeDb('sharing boards with clients', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_bs_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    const [s] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('user_bs_staff', 'staff@peny.test', 'Staff', 'user') RETURNING id`
    ids.staff = s.id
    ids.staffRow = { id: s.id, clerk_id: 'user_bs_staff', role: 'user' }
    ids.viewerRow = { id: s.id, clerk_id: 'user_bs_viewer', role: 'viewer' }

    ids.alpha = (await sql`INSERT INTO companies (user_id, name, clerk_org_id, type) VALUES (${ws}, 'BSTest Alpha', 'org_bs_alpha', 'client') RETURNING id`)[0].id
    ids.beta = (await sql`INSERT INTO companies (user_id, name, clerk_org_id, type) VALUES (${ws}, 'BSTest Beta', 'org_bs_beta', 'client') RETURNING id`)[0].id

    // A root canvas with every kind of card, a nested canvas inside it, and a second, unshared root.
    const canvas = async (name, parent = null) => (await sql`INSERT INTO canvases (user_id, name, parent_id) VALUES (${ws}, ${name}, ${parent}) RETURNING id`)[0].id
    ids.root = await canvas('BSTest Shoot plan')
    ids.nested = await canvas('BSTest Day one', ids.root)
    ids.deep = await canvas('BSTest Call times', ids.nested)
    ids.other = await canvas('BSTest Private plan')
    const item = (canvasId, kind, cols = {}) => sql`
      INSERT INTO canvas_items (canvas_id, kind, x, y, w, h, content, color, url, image_url, sub_tasks, child_canvas_id, updated_by)
      VALUES (${canvasId}, ${kind}, ${cols.x ?? 0}, 0, 200, 120, ${cols.content ?? null}, ${cols.color ?? null}, ${cols.url ?? null}, ${cols.image_url ?? null},
              ${JSON.stringify(cols.sub_tasks ?? [])}::jsonb, ${cols.child ?? null}, ${SECRET}) RETURNING id`
    ids.note = (await item(ids.root, 'note', { content: 'Hello client', color: '#FFF8C5' }))[0].id
    ids.todo = (await item(ids.root, 'todo', { x: 300, content: 'Prep', sub_tasks: [{ id: 'r1', text: 'Book crew', owner_id: SECRET, due_date: '2026-11-01', done: false }] }))[0].id
    ids.img = (await item(ids.root, 'image', { x: 600, image_url: 'https://x.private.blob.vercel-storage.com/a.png' }))[0].id
    ids.board = (await item(ids.root, 'board', { x: 900, color: '#10B981', child: ids.nested }))[0].id
    await item(ids.nested, 'note', { content: 'Nested note' })
    await item(ids.deep, 'note', { content: 'Deep note' })
    await item(ids.other, 'note', { content: 'Not for clients' })
    await sql`INSERT INTO canvas_arrows (canvas_id, from_item_id, to_item_id, label) VALUES (${ids.root}, ${ids.note}, ${ids.todo}, 'then')`

    ids.kanban = (await sql`INSERT INTO boards (user_id, name) VALUES (${ws}, 'BSTest Production') RETURNING id`)[0].id
    const col = (await sql`INSERT INTO board_columns (board_id, name, sort_order) VALUES (${ids.kanban}, 'To do', 0) RETURNING id`)[0].id
    await sql`INSERT INTO board_cards (board_id, column_id, title, description, assignee_id, labels, due_date)
      VALUES (${ids.kanban}, ${col}, 'Book crew', 'Two operators', ${ids.staff}, ${JSON.stringify([{ name: SECRET, color: '#ff0000' }])}::jsonb, '2026-11-02')`
    ids.otherKanban = (await sql`INSERT INTO boards (user_id, name) VALUES (${ws}, 'BSTest Hidden board') RETURNING id`)[0].id

    ids.link = (await sql`INSERT INTO projects (user_id, name, status, portal_token) VALUES (${ws}, 'BSTest Link', 'Post', 'bstestlinktoken00001') RETURNING id`)[0].id
  })
  afterAll(async () => { await wipe(); await sql.end() })
  beforeEach(async () => {
    STAFF = ids.staffRow
    CLAIMS = DANA
    await sql`DELETE FROM board_shares WHERE company_id IN (${ids.alpha}, ${ids.beta})`
  })

  describe('setting it (staff)', () => {
    it('shares a canvas and a board, lists them and replaces the set', async () => {
      let r = await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [ids.alpha, ids.beta] })
      expect(r.statusCode).toBe(200)
      expect(r.body.companies.map(c => c.name)).toEqual(['BSTest Alpha', 'BSTest Beta'])
      r = await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [ids.alpha] })
      expect(r.body.companies.map(c => c.name)).toEqual(['BSTest Alpha'])
      r = await staff('GET', `board-shares/canvas/${ids.root}`)
      expect(r.body.companies.map(c => c.name)).toEqual(['BSTest Alpha'])
      r = await staff('PUT', `board-shares/board/${ids.kanban}`, { company_ids: [ids.beta, ids.beta] })
      expect(r.body.companies.map(c => c.name)).toEqual(['BSTest Beta'])
      r = await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [] })
      expect(r.body.companies).toEqual([])
    })

    it('keeps who shared it first when saved again', async () => {
      await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [ids.alpha] })
      const [first] = await sql`SELECT id FROM board_shares WHERE company_id = ${ids.alpha}`
      await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [ids.alpha, ids.beta] })
      const [again] = await sql`SELECT id FROM board_shares WHERE company_id = ${ids.alpha}`
      expect(again.id).toBe(first.id)
    })

    it('refuses a nested canvas, an unknown board, an unknown company and nonsense', async () => {
      expect((await staff('PUT', `board-shares/canvas/${ids.nested}`, { company_ids: [ids.alpha] })).statusCode).toBe(404)
      expect((await staff('PUT', `board-shares/board/${ids.root}`, { company_ids: [ids.alpha] })).statusCode).toBe(404)
      expect((await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: ['44444444-4444-4444-8444-444444444444'] })).statusCode).toBe(422)
      expect((await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: 'all' })).statusCode).toBe(422)
      expect((await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: ['x'] })).statusCode).toBe(422)
      expect((await staff('GET', `board-shares/canvas/${ids.nested}`)).statusCode).toBe(404)
    })

    it('is for editors: a viewer and a signed-out visitor are refused', async () => {
      STAFF = ids.viewerRow
      expect((await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [ids.alpha] })).statusCode).toBe(403)
      expect((await staff('GET', `board-shares/canvas/${ids.root}`)).statusCode).toBe(403)
      STAFF = null
      expect((await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [ids.alpha] })).statusCode).toBe(401)
      expect((await sql`SELECT 1 FROM board_shares WHERE company_id = ${ids.alpha}`)).toHaveLength(0)
    })
  })

  describe('looking at it (client)', () => {
    beforeEach(async () => {
      await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [ids.alpha] })
      await staff('PUT', `board-shares/board/${ids.kanban}`, { company_ids: [ids.alpha] })
    })

    it('lists only what is shared with the signed-in company', async () => {
      let r = await client('client/view')
      expect(r.statusCode).toBe(200)
      expect(r.body.boards.map(b => `${b.kind}:${b.name}`)).toEqual(['board:BSTest Production', 'canvas:BSTest Shoot plan'])
      CLAIMS = OLU
      r = await client('client/view')
      expect(r.body.boards).toEqual([])
    })

    it('shows a shared canvas: cards, arrows, nothing internal', async () => {
      const r = await client(`client/boards/canvas/${ids.root}`)
      expect(r.statusCode).toBe(200)
      const b = r.body.board
      expect(b.name).toBe('BSTest Shoot plan')
      expect(b.path).toEqual([])
      expect(b.items.find(i => i.id === ids.note)).toMatchObject({ kind: 'note', text: 'Hello client' })
      expect(b.items.find(i => i.id === ids.todo).rows).toEqual([{ id: 'r1', text: 'Book crew', done: false }])
      expect(b.items.find(i => i.id === ids.board)).toMatchObject({ name: 'BSTest Day one', canvas_id: ids.nested })
      expect(b.items.find(i => i.id === ids.img).image).toBe(`/api/client/boards/canvas/${ids.root}/items/${ids.img}/image`)
      expect(b.arrows).toEqual([{ id: expect.any(String), from: ids.note, to: ids.todo, label: 'then' }])
      expect(JSON.stringify(r.body)).not.toMatch(new RegExp(`${SECRET}|2026-11-01|blob.vercel-storage|user_id`))
    })

    it('opens canvases nested inside it, however deep, and says where they are', async () => {
      let r = await client(`client/boards/canvas/${ids.nested}`)
      expect(r.statusCode).toBe(200)
      expect(r.body.board.path).toEqual([{ id: ids.root, name: 'BSTest Shoot plan' }])
      r = await client(`client/boards/canvas/${ids.deep}`)
      expect(r.statusCode).toBe(200)
      expect(r.body.board.path.map(p => p.id)).toEqual([ids.root, ids.nested])
    })

    it('shows a kanban board: columns, titles, descriptions, nothing else', async () => {
      const r = await client(`client/boards/board/${ids.kanban}`)
      expect(r.statusCode).toBe(200)
      expect(r.body.board.columns[0]).toMatchObject({ name: 'To do', cards: [{ title: 'Book crew', description: 'Two operators' }] })
      expect(JSON.stringify(r.body)).not.toMatch(new RegExp(`${SECRET}|2026-11-02|assignee|labels`))
    })

    it('reads everything that is not theirs as not found', async () => {
      for (const route of [`client/boards/canvas/${ids.other}`, `client/boards/board/${ids.otherKanban}`, `client/boards/canvas/${ids.kanban}`,
                           `client/boards/board/${ids.root}`, 'client/boards/canvas/55555555-5555-4555-8555-555555555555']) {
        expect((await client(route)).statusCode, route).toBe(404)
      }
      CLAIMS = OLU   // another company: not shared with them, nested or not
      for (const route of [`client/boards/canvas/${ids.root}`, `client/boards/canvas/${ids.nested}`, `client/boards/canvas/${ids.deep}`, `client/boards/board/${ids.kanban}`]) {
        expect((await client(route)).statusCode, route).toBe(404)
      }
    })

    it('does not open on a project link, a signed-out visitor, or for staff', async () => {
      expect((await client(`client/boards/canvas/${ids.root}`, { token: 'bstestlinktoken00001' })).statusCode).toBe(404)
      CLAIMS = null
      expect((await client(`client/boards/canvas/${ids.root}`)).statusCode).toBe(401)
      CLAIMS = { sub: 'user_bs_dana', v: 2, o: { id: 'org_bs_alpha' } }
      await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('user_bs_dana', 'dana@peny.test', 'Dana', 'user')`
      expect((await client(`client/boards/canvas/${ids.root}`)).statusCode).toBe(403)
      await sql`DELETE FROM app_users WHERE clerk_id = 'user_bs_dana'`
    })

    it('has no picture to give for a card that has none, or an address outside the private store', async () => {
      const plain = (await sql`INSERT INTO canvas_items (canvas_id, kind, image_url) VALUES (${ids.root}, 'image', 'https://example.com/a.png') RETURNING id`)[0].id
      expect((await client(`client/boards/canvas/${ids.root}/items/${plain}/image`)).statusCode).toBe(404)
      expect((await client(`client/boards/canvas/${ids.root}/items/${ids.note}/image`)).statusCode).toBe(404)
      // A picture on a canvas that isn't theirs.
      const hidden = (await sql`INSERT INTO canvas_items (canvas_id, kind, image_url) VALUES (${ids.other}, 'image', 'https://x.private.blob.vercel-storage.com/z.png') RETURNING id`)[0].id
      expect((await client(`client/boards/canvas/${ids.other}/items/${hidden}/image`)).statusCode).toBe(404)
      // …nor one named under a canvas they can see.
      expect((await client(`client/boards/canvas/${ids.root}/items/${hidden}/image`)).statusCode).toBe(404)
    })

    it('stops the moment sharing is turned off, and when the canvas or company goes', async () => {
      await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [] })
      expect((await client(`client/boards/canvas/${ids.root}`)).statusCode).toBe(404)
      expect((await client(`client/boards/canvas/${ids.deep}`)).statusCode).toBe(404)
      await staff('PUT', `board-shares/canvas/${ids.root}`, { company_ids: [ids.alpha] })
      const [{ id: throwaway }] = await sql`INSERT INTO canvases (user_id, name) VALUES (${ws}, 'BSTest Throwaway') RETURNING id`
      await staff('PUT', `board-shares/canvas/${throwaway}`, { company_ids: [ids.alpha] })
      await sql`DELETE FROM canvases WHERE id = ${throwaway}`
      expect(await sql`SELECT 1 FROM board_shares WHERE canvas_id = ${throwaway}`).toHaveLength(0)
    })

    it('cannot be written to: the portal has no route that changes a board', async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = fakeRes()
        await dispatchClient({ method, url: `/api/client/boards/canvas/${ids.root}`, query: { route: `client/boards/canvas/${ids.root}` }, body: {}, headers: {} }, res, { sql })
        expect(res.statusCode, method).toBe(405)
      }
    })
  })
})
