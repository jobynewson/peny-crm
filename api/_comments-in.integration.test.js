// "Comments are in": the third answer to a round. Runs against a real Postgres
// (skipped unless SLATE_TEST_DATABASE_URL is set), through the portal and the
// emailed link: it is not approval and not changes_requested, it tells the
// owner, it leaves the deliverable reading Comments in, and the client can take
// it back until we have picked it up.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CLAIMS = null
vi.mock('./_auth.js', () => ({
  verifyClerkSession: async () => (CLAIMS ? { claims: CLAIMS } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
  verifyClerkUser: async () => ({ error: { status: 500, code: 'unused', message: 'not used' } }),
}))
vi.mock('@clerk/backend', () => ({ createClerkClient: () => ({ users: { getUser: async () => ({ firstName: 'Dana', lastName: 'Client' }) } }) }))
vi.mock('./_ratelimit.js', () => ({ isRateLimited: () => false, getClientIp: () => '127.0.0.1' }))
const mails = []
vi.mock('./_notify.js', async orig => ({
  ...(await orig()),
  notify: async (sql, { kind, to, subject, html }) => { mails.push({ kind, to: to.email, subject, html }); return [{ to: to.email, sent: true }] },
}))
const commentAlerts = []
vi.mock('./_alerts.js', async orig => ({
  ...(await orig()),
  alertCommentsIn: async (sql, args) => { commentAlerts.push(args); return [] },
}))

const { workspaceId } = await import('./_api.js')
const { dispatchClient } = await import('./_client.js')
const { emailDelivery } = await import('./_delivery-mail.js')
const { staffScope, respondToDelivery } = await import('./_worklist.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, staff, alpha, stream, hero, roundId
const DANA = { sub: 'user_ci_dana', v: 2, o: { id: 'org_ci_alpha', rol: 'org:member' } }
const call = async (method, route, { token, body } = {}) => {
  const res = fakeRes()
  await dispatchClient({ method, url: `/api/${route}`, query: { route }, body, headers: token ? { 'x-action-token': token } : {} }, res, { sql })
  return res
}
const state = async () => ({
  d: (await sql`SELECT status FROM deliverables WHERE id = ${hero.id}`)[0].status,
  r: (await sql`SELECT client_response, client_comment, responded_at, responded_by_name FROM deliveries WHERE id = ${roundId}`)[0],
})
const theirs = async () => (await call('GET', 'client/view')).body.workstreams[0].deliverables[0]

async function wipe() {
  await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'CiTest %')`
  await sql`DELETE FROM companies WHERE name LIKE 'CiTest %'`
  await sql`DELETE FROM app_users WHERE clerk_id = 'user_ci_staff'`
}

describeDb('comments are in', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_ci_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    ;[staff] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('user_ci_staff', 'staff@ci.test', 'Staff', 'user') RETURNING id`
    ;[alpha] = await sql`INSERT INTO companies (user_id, name, clerk_org_id) VALUES (${ws}, 'CiTest Alpha', 'org_ci_alpha') RETURNING id`
    ;[stream] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${alpha.id}, 'Launch') RETURNING id`
  })
  beforeEach(async () => {
    CLAIMS = DANA
    mails.length = 0
    commentAlerts.length = 0
    await sql`DELETE FROM deliverables WHERE workstream_id = ${stream.id}`
    ;[hero] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible, owner_id) VALUES (${stream.id}, 'Reel', 'in_review', true, ${staff.id}) RETURNING id`
    ;[{ id: roundId }] = await sql`INSERT INTO deliveries (deliverable_id, url, round, sent_by) VALUES (${hero.id}, 'https://f.io/r1', 1, ${staff.id}) RETURNING id`
  })
  afterAll(async () => { await wipe(); await sql.end() })

  const comments = (body = { response: 'comments_in' }) => call('POST', `client/deliveries/${roundId}/response`, { body })

  it('is its own answer: the round reads comments_in, the deliverable Comments in, no comment stored, the owner told', async () => {
    const r = await comments({ response: 'comments_in', comment: 'ignored' })
    expect(r.statusCode).toBe(200)
    const s = await state()
    expect(s.d).toBe('comments_in')
    expect(s.r).toMatchObject({ client_response: 'comments_in', client_comment: null, responded_by_name: 'Dana Client' })
    expect(commentAlerts).toHaveLength(1)
    expect(commentAlerts[0]).toMatchObject({ deliverableId: hero.id, by: 'Dana Client', undone: false })
    expect(await theirs()).toMatchObject({ status: 'comments_received', status_label: 'Comments received' })
    const round = (await theirs()).rounds[0]
    expect(round).toMatchObject({ response: 'comments_in', response_label: 'Comments are in', can_respond: false, can_undo: true })
  })

  it('is not approval and not changes_requested: neither reaches the digest or asks for words', async () => {
    await comments()
    expect((await state()).d).not.toBe('approved')
    expect((await state()).d).not.toBe('changes_requested')
    const again = await call('POST', `client/deliveries/${roundId}/response`, { body: { response: 'approved' } })
    expect([again.statusCode, again.body.error.code]).toEqual([409, 'already_answered'])
  })

  it('can be taken back by the client: the round reopens, the deliverable is back in review, the owner is told', async () => {
    await comments()
    const r = await call('POST', `client/deliveries/${roundId}/undo`, { body: {} })
    expect(r.statusCode).toBe(200)
    const s = await state()
    expect(s.d).toBe('in_review')
    expect(s.r).toMatchObject({ client_response: 'pending', responded_at: null, responded_by_name: null })
    expect(commentAlerts.map(a => a.undone)).toEqual([false, true])
    expect((await theirs()).rounds[0]).toMatchObject({ can_respond: true, can_undo: false })
    // And they can answer again, properly.
    expect((await comments({ response: 'approved' })).statusCode).toBe(200)
  })

  it('cannot be taken back once we have picked it up, or for a round that was not comments-in', async () => {
    const notYet = await call('POST', `client/deliveries/${roundId}/undo`, { body: {} })
    expect([notYet.statusCode, notYet.body.error.code]).toEqual([409, 'cannot_undo'])
    await comments()
    await sql`UPDATE deliverables SET status = 'in_progress' WHERE id = ${hero.id}`     // staff started on it
    const late = await call('POST', `client/deliveries/${roundId}/undo`, { body: {} })
    expect([late.statusCode, late.body.error.code]).toEqual([409, 'cannot_undo'])
    expect((await state()).r.client_response).toBe('comments_in')
    expect((await theirs()).rounds[0].can_undo).toBe(false)
  })

  it('cannot be taken back after the next round is sent', async () => {
    await comments()
    await sql`INSERT INTO deliveries (deliverable_id, url, round, sent_by) VALUES (${hero.id}, 'https://f.io/r2', 2, ${staff.id})`
    await sql`UPDATE deliverables SET status = 'in_review' WHERE id = ${hero.id}`
    const r = await call('POST', `client/deliveries/${roundId}/undo`, { body: {} })
    expect(r.statusCode).toBe(409)
    expect((await state()).r.client_response).toBe('comments_in')
  })

  it('another company, and someone with no session, cannot answer or undo', async () => {
    CLAIMS = { sub: 'user_ci_other', v: 2, o: { id: 'org_ci_nobody', rol: 'org:member' } }
    expect((await comments()).statusCode).toBeGreaterThanOrEqual(400)
    expect((await call('POST', `client/deliveries/${roundId}/undo`, { body: {} })).statusCode).toBeGreaterThanOrEqual(400)
    CLAIMS = null
    expect((await comments()).statusCode).toBe(401)
    expect((await state()).r.client_response).toBe('pending')
  })

  describe('from the emailed link', () => {
    const linkTokens = async () => {
      mails.length = 0
      await emailDelivery(sql, { deliveryId: roundId, members: [{ clerk_id: 'user_ci_dana', email: 'dana@ci.test', name: 'Dana', first: 'Dana' }] })
      const html = mails[0].html
      return {
        approve: /\/portal\/approve#([A-Za-z0-9_-]{43})/.exec(html)[1],
        commentsUrl: /(https?:\/\/[^"]*\/portal\/approve\?comments=1#[A-Za-z0-9_-]{43})/.exec(html)?.[1],
        html,
      }
    }
    it('puts a third button in the email, and opens the same page for everyone', async () => {
      const { html, commentsUrl } = await linkTokens()
      expect(html).toContain('Comments are in')
      expect(html).toContain('Approve')
      expect(html).toContain('Request changes')
      expect(commentsUrl).toBeTruthy()
    })
    it('says comments are in without using the link up, then undoes it; approving still works after', async () => {
      CLAIMS = null
      const { approve } = await linkTokens()
      const seen = await call('GET', 'client/link', { token: approve })
      expect(seen.body).toMatchObject({ state: 'open', can_say_comments_in: true })
      const r = await call('POST', 'client/link/comments', { token: approve, body: {} })
      expect(r.statusCode).toBe(200)
      expect(r.body.link).toMatchObject({ state: 'comments_in', can_undo: true, can_approve: false })
      expect((await state()).d).toBe('comments_in')
      expect((await sql`SELECT used_at FROM action_links WHERE email = 'dana@ci.test'`)[0].used_at).toBeNull()
      expect(commentAlerts).toHaveLength(1)
      const undone = await call('POST', 'client/link/undo', { token: approve, body: {} })
      expect(undone.body.link).toMatchObject({ state: 'open', can_undo: false })
      expect((await state()).d).toBe('in_review')
      expect(commentAlerts.map(a => a.undone)).toEqual([false, true])
      expect((await call('POST', 'client/link/approve', { token: approve, body: {} })).statusCode).toBe(200)
      expect((await state()).d).toBe('approved')
    })
  })

  it('staff can record it too, and it carries no comment', async () => {
    const r = await respondToDelivery(sql, staffScope(ws), { deliveryId: roundId, input: { response: 'comments_in', comment: 'they said so by phone' }, by: { clerkId: 'user_ci_staff', name: 'Staff' } })
    expect(r.error).toBeUndefined()
    expect((await state()).r).toMatchObject({ client_response: 'comments_in', client_comment: null })
  })
})
