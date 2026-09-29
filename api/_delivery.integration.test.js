// Runs the delivery email and its one-time Approve links against a real
// Postgres. Skipped unless SLATE_TEST_DATABASE_URL is set — see _test-db.js.
// Clerk and the mail transport are replaced; every email is recorded, and the
// tests read the links out of the recorded HTML exactly as a client would.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CLAIMS = null
vi.mock('./_auth.js', () => ({
  verifyClerkSession: async () => (CLAIMS ? { claims: CLAIMS } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
  verifyClerkUser: async () => ({ error: { status: 500, code: 'unused', message: 'not used' } }),
}))
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    users: { getUser: async id => ({ firstName: id === 'user_dl_dana' ? 'Dana' : 'Olu', lastName: 'Client' }) },
  }),
}))
vi.mock('./_ratelimit.js', () => ({ isRateLimited: () => false, getClientIp: () => '127.0.0.1' }))
const mails = []
let mailOutcome = () => ({ sent: true })
vi.mock('./_notify.js', async orig => ({
  ...(await orig()),
  notify: async (sql, { kind, to, subject, html }) => {
    const r = mailOutcome(to)
    if (r.sent) mails.push({ kind, to: to.email, subject, html })
    return [{ to: to.email, ...r }]
  },
}))

const { workspaceId } = await import('./_api.js')
const { dispatchClient } = await import('./_client.js')
const { emailDelivery, hashToken } = await import('./_delivery-mail.js')
const { deliveryScope, respondToDelivery } = await import('./_worklist.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, staff, alpha, stream, hero
const DANA = { clerk_id: 'user_dl_dana', email: 'dana@dl.test', name: 'Dana Client', first: 'Dana' }
const OLU = { clerk_id: 'user_dl_olu', email: 'olu@dl.test', name: 'Olu Client', first: 'Olu' }
const PEN = { clerk_id: 'user_dl_staff', email: 'staff@dl.test', name: 'Staff', first: 'Staff' }

const call = async (method, route, { token, body, headers = {} } = {}) => {
  const res = fakeRes()
  const h = { ...headers, ...(token !== undefined ? { 'x-action-token': token } : {}) }
  await dispatchClient({ method, url: `/api/${route}`, query: { route }, body, headers: h }, res, { sql })
  return res
}
const linkRow = async token => (await sql`SELECT * FROM action_links WHERE token_hash = ${hashToken(token)}`)[0]
const tokenFrom = mail => /\/portal\/approve#([A-Za-z0-9_-]{43})/.exec(mail.html)[1]

async function newRound(deliverableId, round, { people = [DANA, OLU], sendVia = emailDelivery } = {}) {
  const [dv] = await sql`INSERT INTO deliveries (deliverable_id, url, round, sent_by, note) VALUES (${deliverableId}, ${`https://f.io/r${round}`}, ${round}, ${staff.id}, 'Colour fixed') RETURNING id`
  await sql`UPDATE deliverables SET status = 'in_review' WHERE id = ${deliverableId}`
  mails.length = 0
  const result = await sendVia(sql, { deliveryId: dv.id, members: people })
  return { id: dv.id, result, tokens: Object.fromEntries(mails.map(m => [m.to, tokenFrom(m)])) }
}

async function wipe() {
  await sql`DELETE FROM workstreams WHERE company_id IN (SELECT id FROM companies WHERE name LIKE 'DlTest %')`
  await sql`DELETE FROM companies WHERE name LIKE 'DlTest %'`
  await sql`DELETE FROM app_users WHERE clerk_id = 'user_dl_staff'`
}

describeDb('the delivery email and Approve links', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_dl_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await wipe()
    ;[staff] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('user_dl_staff', 'staff@dl.test', 'Staff', 'user') RETURNING id`
    ;[alpha] = await sql`INSERT INTO companies (user_id, name, clerk_org_id) VALUES (${ws}, 'DlTest Alpha', 'org_dl_alpha') RETURNING id`
    ;[stream] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${alpha.id}, 'Launch') RETURNING id`
  })
  beforeEach(async () => {
    CLAIMS = null
    mailOutcome = () => ({ sent: true })
    await sql`DELETE FROM deliverables WHERE workstream_id = ${stream.id}`
    ;[hero] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible, owner_id, waiting_since, waiting_note)
      VALUES (${stream.id}, 'October reel', 'in_progress', true, ${staff.id}, NULL, NULL) RETURNING id`
    await sql`UPDATE companies SET clerk_org_id = 'org_dl_alpha' WHERE id = ${alpha.id}`
  })
  afterAll(async () => { await wipe(); await sql.end() })

  describe('sending the round', () => {
    it('emails everyone in the company\'s portal, each with their own link, and stores only hashes', async () => {
      const round = await newRound(hero.id, 1)
      expect(round.result).toMatchObject({ sent: 2, message: 'emailed 2 people at DlTest Alpha' })
      expect(mails.map(m => [m.kind, m.to, m.subject])).toEqual([
        ['delivery_ready', 'dana@dl.test', 'Ready for your review: October reel'],
        ['delivery_ready', 'olu@dl.test', 'Ready for your review: October reel'],
      ])
      expect(mails[0].html).toContain('Hi Dana')
      expect(mails[0].html).toContain('https://f.io/r1')
      expect(mails[0].html).toContain(`/portal#d-${hero.id}`)
      expect(round.tokens[DANA.email]).not.toBe(round.tokens[OLU.email])

      const rows = await sql`SELECT clerk_user_id, email, token_hash, used_at, expires_at > now() + interval '13 days' AS fresh, expires_at < now() + interval '15 days' AS bounded FROM action_links ORDER BY email`
      expect(rows.map(r => [r.clerk_user_id, r.email, r.used_at, r.fresh, r.bounded])).toEqual([
        ['user_dl_dana', 'dana@dl.test', null, true, true],
        ['user_dl_olu', 'olu@dl.test', null, true, true],
      ])
      for (const r of rows) for (const t of Object.values(round.tokens)) expect(r.token_hash).not.toContain(t)
    })

    it('never emails Slate staff, even one who is in the organisation', async () => {
      const round = await newRound(hero.id, 1, { people: [DANA, PEN] })
      expect(round.result.sent).toBe(1)
      expect(mails.map(m => m.to)).toEqual(['dana@dl.test'])
    })

    it('says why nobody was emailed, and makes no links for it', async () => {
      await sql`UPDATE deliverables SET client_visible = false WHERE id = ${hero.id}`
      expect((await newRound(hero.id, 1)).result).toMatchObject({ sent: 0, reason: 'hidden' })
      await sql`UPDATE deliverables SET client_visible = true WHERE id = ${hero.id}`
      await sql`UPDATE companies SET clerk_org_id = NULL WHERE id = ${alpha.id}`
      expect((await newRound(hero.id, 2)).result).toMatchObject({ sent: 0, reason: 'no_portal' })
      await sql`UPDATE companies SET clerk_org_id = 'org_dl_alpha' WHERE id = ${alpha.id}`
      expect((await newRound(hero.id, 3, { people: [] })).result).toMatchObject({ sent: 0, reason: 'no_members' })
      expect((await sql`SELECT count(*)::int AS n FROM action_links`)[0].n).toBe(0)
      expect(mails).toEqual([])
    })

    it('a link nobody received is not left lying around, and a Clerk failure does not fail the send', async () => {
      mailOutcome = to => (to.email === 'olu@dl.test' ? { error: 'Gmail said no' } : { sent: true })
      const round = await newRound(hero.id, 1)
      expect(round.result.sent).toBe(1)
      expect((await sql`SELECT email FROM action_links`).map(r => r.email)).toEqual(['dana@dl.test'])

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const [dv] = await sql`SELECT id FROM deliveries LIMIT 1`
      const failed = await emailDelivery(sql, { deliveryId: dv.id, members: async () => { throw new Error('Clerk is down') } })
      spy.mockRestore()
      expect(failed).toMatchObject({ sent: 0, reason: 'error' })
    })
  })

  describe('opening the link', () => {
    it('shows the round and changes nothing — however many times a mail scanner opens it', async () => {
      const { tokens } = await newRound(hero.id, 1)
      const token = tokens[DANA.email]
      for (let i = 0; i < 3; i++) {
        const r = await call('GET', 'client/link', { token })
        expect(r.statusCode).toBe(200)
        expect(r.body).toMatchObject({
          scope: { kind: 'delivery', approve_only: true }, company: 'DlTest Alpha', title: 'October reel', round: 1,
          url: 'https://f.io/r1', state: 'open', can_approve: true, deliverable_id: hero.id,
        })
      }
      expect((await linkRow(token)).used_at).toBeNull()
      expect((await sql`SELECT client_response FROM deliveries`)[0].client_response).toBe('pending')
      expect((await sql`SELECT status FROM deliverables WHERE id = ${hero.id}`)[0].status).toBe('in_review')
    })

    it('shows nothing internal', async () => {
      await sql`UPDATE deliverables SET internal_notes = 'SECRET-NOTE' WHERE id = ${hero.id}`
      const { tokens } = await newRound(hero.id, 1)
      const json = JSON.stringify((await call('GET', 'client/link', { token: tokens[DANA.email] })).body)
      for (const leak of ['SECRET-NOTE', 'owner', staff.id, 'in_review', 'user_dl', 'dana@dl.test', 'token']) expect(json, leak).not.toContain(leak)
    })

    it('treats anything that is not a real link as not found', async () => {
      for (const token of ['', 'short', 'x'.repeat(43), 'x'.repeat(200), "' OR 1=1 --", 'a b']) {
        const r = await call('GET', 'client/link', { token })
        expect([r.statusCode, r.body.error.code], token).toEqual([404, 'not_found'])
      }
    })
  })

  describe('approving', () => {
    it('approves as the person the email went to, and uses the link up', async () => {
      const { tokens, id } = await newRound(hero.id, 1)
      const r = await call('POST', 'client/link/approve', { token: tokens[DANA.email], body: {} })
      expect(r.statusCode).toBe(200)
      expect(r.body.link).toMatchObject({ state: 'approved', can_approve: false })
      const [dv] = await sql`SELECT client_response, client_comment, responded_by, responded_by_name FROM deliveries WHERE id = ${id}`
      expect(dv).toEqual({ client_response: 'approved', client_comment: null, responded_by: 'user_dl_dana', responded_by_name: 'Dana Client' })
      expect((await sql`SELECT status FROM deliverables WHERE id = ${hero.id}`)[0].status).toBe('approved')
      expect((await linkRow(tokens[DANA.email])).used_at).not.toBeNull()
    })

    it('works once: the same link again says so, and changes nothing', async () => {
      const { tokens } = await newRound(hero.id, 1)
      await call('POST', 'client/link/approve', { token: tokens[DANA.email], body: {} })
      for (const method of ['POST', 'GET']) {
        const again = await call(method, method === 'POST' ? 'client/link/approve' : 'client/link', { token: tokens[DANA.email], body: {} })
        expect([again.statusCode, again.body.error.code], method).toEqual([410, 'link_used'])
      }
    })

    it('two at the same moment approve once', async () => {
      const { tokens } = await newRound(hero.id, 1)
      const both = await Promise.all([1, 2].map(() => call('POST', 'client/link/approve', { token: tokens[DANA.email], body: {} })))
      expect(both.map(r => r.statusCode).sort()).toEqual([200, 410])
      expect((await sql`SELECT count(*)::int AS n FROM deliveries WHERE client_response = 'approved'`)[0].n).toBe(1)
    })

    it('once anyone has answered the round, everyone else\'s link stops approving — and is not spent', async () => {
      const { tokens } = await newRound(hero.id, 1)
      await call('POST', 'client/link/approve', { token: tokens[DANA.email], body: {} })
      const view = await call('GET', 'client/link', { token: tokens[OLU.email] })
      expect(view.body).toMatchObject({ state: 'approved', can_approve: false })
      const r = await call('POST', 'client/link/approve', { token: tokens[OLU.email], body: {} })
      expect([r.statusCode, r.body.error.code]).toEqual([409, 'already_answered'])
      expect((await linkRow(tokens[OLU.email])).used_at).toBeNull()
    })

    it('a newer round makes the old link useless, and it is not spent either', async () => {
      const first = await newRound(hero.id, 1)
      const second = await newRound(hero.id, 2)
      expect((await call('GET', 'client/link', { token: first.tokens[DANA.email] })).body).toMatchObject({ state: 'superseded', can_approve: false })
      const r = await call('POST', 'client/link/approve', { token: first.tokens[DANA.email], body: {} })
      expect([r.statusCode, r.body.error.code]).toEqual([409, 'superseded'])
      expect((await linkRow(first.tokens[DANA.email])).used_at).toBeNull()
      expect((await sql`SELECT client_response FROM deliveries WHERE round = 1`)[0].client_response).toBe('pending')
      // the new round's own link works
      expect((await call('POST', 'client/link/approve', { token: second.tokens[DANA.email], body: {} })).statusCode).toBe(200)
    })

    it('taking a round back kills its links', async () => {
      const { tokens, id } = await newRound(hero.id, 1)
      await sql`DELETE FROM deliveries WHERE id = ${id}`
      expect((await call('GET', 'client/link', { token: tokens[DANA.email] })).statusCode).toBe(404)
      expect((await call('POST', 'client/link/approve', { token: tokens[DANA.email], body: {} })).statusCode).toBe(404)
    })

    it('an expired link does nothing', async () => {
      const { tokens } = await newRound(hero.id, 1)
      await sql`UPDATE action_links SET expires_at = now() - interval '1 second'`
      for (const [method, route] of [['GET', 'client/link'], ['POST', 'client/link/approve']]) {
        const r = await call(method, route, { token: tokens[DANA.email], body: {} })
        expect([r.statusCode, r.body.error.code], route).toEqual([410, 'link_expired'])
      }
      expect((await sql`SELECT client_response FROM deliveries`)[0].client_response).toBe('pending')
    })

    it('a deliverable hidden after sending cannot be approved from an old email', async () => {
      const { tokens } = await newRound(hero.id, 1)
      await sql`UPDATE deliverables SET client_visible = false WHERE id = ${hero.id}`
      expect((await call('GET', 'client/link', { token: tokens[DANA.email] })).statusCode).toBe(404)
      const r = await call('POST', 'client/link/approve', { token: tokens[DANA.email], body: {} })
      expect(r.statusCode).toBe(404)
      expect((await linkRow(tokens[DANA.email])).used_at).toBeNull()
    })

    it('clears what we were waiting for, as any approval does', async () => {
      await sql`UPDATE deliverables SET waiting_since = now(), waiting_note = 'Logo', client_reply = 'soon', client_replied_at = now() WHERE id = ${hero.id}`
      const { tokens } = await newRound(hero.id, 1)
      await sql`UPDATE deliverables SET status = 'waiting_on_client' WHERE id = ${hero.id}`
      await call('POST', 'client/link/approve', { token: tokens[DANA.email], body: {} })
      expect((await sql`SELECT status, waiting_since, waiting_note, client_reply FROM deliverables WHERE id = ${hero.id}`)[0])
        .toEqual({ status: 'approved', waiting_since: null, waiting_note: null, client_reply: null })
    })
  })

  describe('what a link can and cannot do', () => {
    it('opens one round and nothing else: not the worklist, requests, replies, or another delivery\'s answer', async () => {
      const { tokens, id } = await newRound(hero.id, 1)
      const token = tokens[DANA.email]
      const cases = [
        ['GET', 'client/view', undefined],
        ['POST', 'client/requests', { title: 'x' }],
        ['POST', `client/deliverables/${hero.id}/reply`, { reply: 'x' }],
        ['POST', `client/deliveries/${id}/response`, { response: 'approved' }],
        ['POST', `client/deliveries/${id}/response`, { response: 'changes_requested', comment: 'no' }],
      ]
      for (const [method, route, body] of cases) {
        const r = await call(method, route, { token, body })
        expect([r.statusCode, r.body.error.code], `${method} ${route}`).toEqual([403, 'link_only'])
      }
      expect((await sql`SELECT count(*)::int AS n FROM requests WHERE company_id = ${alpha.id}`)[0].n).toBe(0)
      expect((await sql`SELECT client_response FROM deliveries WHERE id = ${id}`)[0].client_response).toBe('pending')
      expect((await linkRow(token)).used_at).toBeNull()
    })

    it('cannot ask for changes even if it reaches the writer directly: that needs a sign-in and a comment', async () => {
      const { tokens, id } = await newRound(hero.id, 1)
      const row = await linkRow(tokens[DANA.email])
      const scope = deliveryScope({ ws, deliveryId: id, linkId: row.id, clerkUserId: row.clerk_user_id, email: row.email })
      const r = await respondToDelivery(sql, scope, { deliveryId: id, input: { response: 'changes_requested', comment: 'Brighter' }, by: { clerkId: row.clerk_user_id, name: 'Dana' } })
      expect([r.error.status, r.error.code]).toEqual([403, 'approve_only'])
      const other = await respondToDelivery(sql, scope, { deliveryId: '11111111-1111-4111-8111-111111111111', input: { response: 'approved' }, by: { clerkId: 'x', name: 'x' } })
      expect(other.error.code).toBe('not_found')
      expect((await sql`SELECT client_response FROM deliveries WHERE id = ${id}`)[0].client_response).toBe('pending')
    })

    it('the write itself refuses a link that was used or expired after it was looked up', async () => {
      const { tokens, id } = await newRound(hero.id, 1)
      const row = await linkRow(tokens[DANA.email])
      const scope = deliveryScope({ ws, deliveryId: id, linkId: row.id, clerkUserId: row.clerk_user_id, email: row.email })
      const approve = () => respondToDelivery(sql, scope, { deliveryId: id, input: { response: 'approved' }, by: { clerkId: row.clerk_user_id, name: 'Dana' } })
      const pending = async () => (await sql`SELECT client_response FROM deliveries WHERE id = ${id}`)[0].client_response

      await sql`UPDATE action_links SET used_at = now() WHERE id = ${row.id}`
      expect((await approve()).error).toMatchObject({ status: 410, code: 'link_used' })
      expect(await pending()).toBe('pending')

      await sql`UPDATE action_links SET used_at = NULL, expires_at = now() - interval '1 second' WHERE id = ${row.id}`
      expect((await approve()).error).toMatchObject({ status: 410, code: 'link_expired' })
      expect(await pending()).toBe('pending')

      // a link for another round can't approve this one
      const other = await newRound(hero.id, 2)
      const otherRow = await linkRow(other.tokens[DANA.email])
      await sql`UPDATE action_links SET expires_at = now() + interval '1 day' WHERE id = ${row.id}`
      const crossed = deliveryScope({ ws, deliveryId: other.id, linkId: row.id, clerkUserId: row.clerk_user_id, email: row.email })
      const r = await respondToDelivery(sql, crossed, { deliveryId: other.id, input: { response: 'approved' }, by: { clerkId: 'x', name: 'x' } })
      expect(r.error).toBeTruthy()
      expect((await sql`SELECT client_response FROM deliveries WHERE id = ${other.id}`)[0].client_response).toBe('pending')
      expect(otherRow.used_at).toBeNull()
    })

    it('does not care about a session: the link stands for the person it was sent to', async () => {
      const { tokens } = await newRound(hero.id, 1)
      CLAIMS = { sub: 'user_dl_staff', v: 2, o: { id: 'org_dl_alpha' } }   // staff, signed in, in another tab
      const r = await call('POST', 'client/link/approve', { token: tokens[OLU.email], body: {} })
      expect(r.statusCode).toBe(200)
      expect((await sql`SELECT responded_by FROM deliveries`)[0].responded_by).toBe('user_dl_olu')
    })

    it('only takes the header it is sent in, never a query string', async () => {
      const { tokens } = await newRound(hero.id, 1)
      const res = fakeRes()
      await dispatchClient({ method: 'GET', url: '/api/client/link', query: { route: 'client/link', token: tokens[DANA.email], action: tokens[DANA.email] }, headers: {} }, res, { sql })
      expect(res.statusCode).toBe(401)   // no credential: a session is asked for, and there is none
    })
  })
})
