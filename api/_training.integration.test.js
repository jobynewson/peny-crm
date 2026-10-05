// Training (_training.js) against a real Postgres: the routes through the real
// handler, two people who must never see each other's data, idempotent saves
// and "Mark not done". Skipped unless SLATE_TEST_DATABASE_URL is set — see
// _test-db.js.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'
import { ROUTES } from './_training.js'
import { matchRoute } from './_api.js'

const describeDb = TEST_DB ? describe : describe.skip
const A = 'train_a', B = 'train_b'
const ID1 = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const ID2 = '3f2504e0-4f89-11d3-9a0c-0305e82c3302'
const ID3 = '3f2504e0-4f89-11d3-9a0c-0305e82c3303'
let sql

async function call(clerk_id, method, path, body) {
  const m = matchRoute(method, path, ROUTES)
  const res = fakeRes()
  await m.route.handler({ body }, res, { sql, user: { clerk_id }, params: m.params })
  return res
}

describeDb('Training storage', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`
    const ddl = readFileSync(new URL('../drizzle/0046_add_training.sql', import.meta.url), 'utf8')
    for (const stmt of ddl.split(/;\s*\n/).map(s => s.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await sql([stmt])
  })
  afterEach(async () => {
    await sql`DELETE FROM training_sessions WHERE clerk_user_id IN (${A}, ${B})`
    await sql`DELETE FROM training_profiles WHERE clerk_user_id IN (${A}, ${B})`
  })
  afterAll(() => sql.end())

  it('starts with no profile and saves one per person', async () => {
    expect((await call(A, 'GET', 'training')).body).toEqual({ profile: null, done: [] })
    await call(A, 'PUT', 'training/profile', { sport: 'mtb', areas: ['ham', 'calf'], kit: ['band'], gen: { dur: 45, focus: 'legs', phase: 2 } })
    await call(B, 'PUT', 'training/profile', { sport: 'climbing', areas: ['forearm'], kit: [], gen: {} })
    expect((await call(A, 'GET', 'training')).body.profile).toEqual({ sport: 'mtb', areas: ['ham', 'calf'], kit: ['band'], gen: { dur: 45, focus: 'legs', phase: 2 } })
    expect((await call(B, 'GET', 'training')).body.profile.sport).toBe('climbing')
    // Changing it replaces it.
    await call(A, 'PUT', 'training/profile', { sport: 'road', areas: [], kit: [], gen: {} })
    expect((await call(A, 'GET', 'training')).body.profile.sport).toBe('road')
  })

  it('keeps progress per person and per sport', async () => {
    await call(A, 'POST', 'training/sessions', { id: ID1, sport: 'mtb', kind: 'program', week: 1, session_key: 'A' })
    await call(A, 'POST', 'training/sessions', { id: ID2, sport: 'road', kind: 'program', week: 1, session_key: 'A' })
    await call(B, 'POST', 'training/sessions', { id: ID3, sport: 'mtb', kind: 'program', week: 2, session_key: 'C' })
    const a = (await call(A, 'GET', 'training')).body.done
    expect(a.map(d => `${d.sport}${d.week}${d.session_key}`).sort()).toEqual(['mtb1A', 'road1A'])
    const b = (await call(B, 'GET', 'training')).body.done
    expect(b.map(d => `${d.sport}${d.week}${d.session_key}`)).toEqual(['mtb2C'])
  })

  it('marking the same session done twice, or re-sending a queued one, leaves one row', async () => {
    const s = { id: ID1, sport: 'mtb', kind: 'program', week: 3, session_key: 'B' }
    await call(A, 'POST', 'training/sessions', s)
    await call(A, 'POST', 'training/sessions', s)
    await call(A, 'POST', 'training/sessions', { ...s, id: ID2, items: [{ id: 'row' }], duration_seconds: 1500 })   // the timer finishing after "Mark done"
    const rows = await sql`SELECT items, duration_seconds FROM training_sessions WHERE clerk_user_id = ${A}`
    expect(rows).toHaveLength(1)
    expect(rows[0].duration_seconds).toBe(1500)
    expect(rows[0].items).toEqual([{ id: 'row' }])
  })

  it('logs custom sessions and a retried one lands once', async () => {
    const s = { id: ID1, sport: 'snow', kind: 'custom', items: [{ id: 'goblet', sets: 3 }], started_at: '2026-10-05T09:00:00Z', completed_at: '2026-10-05T09:30:00Z', duration_seconds: 1800 }
    await call(A, 'POST', 'training/sessions', s)
    await call(A, 'POST', 'training/sessions', s)
    const rows = await sql`SELECT kind, sport, week FROM training_sessions WHERE clerk_user_id = ${A}`
    expect(rows).toEqual([{ kind: 'custom', sport: 'snow', week: null }])
    expect((await call(A, 'GET', 'training')).body.done).toEqual([])   // custom rows are not plan progress
  })

  it('"Mark not done" deletes my row only', async () => {
    await call(A, 'POST', 'training/sessions', { id: ID1, sport: 'mtb', kind: 'program', week: 1, session_key: 'A' })
    await call(B, 'POST', 'training/sessions', { id: ID2, sport: 'mtb', kind: 'program', week: 1, session_key: 'A' })
    await call(A, 'DELETE', 'training/sessions/mtb/1/A')
    expect((await call(A, 'GET', 'training')).body.done).toEqual([])
    expect((await call(B, 'GET', 'training')).body.done).toHaveLength(1)
  })

  it('cannot be pointed at someone else’s session by id', async () => {
    await call(B, 'POST', 'training/sessions', { id: ID1, sport: 'mtb', kind: 'custom' })
    await call(A, 'POST', 'training/sessions', { id: ID1, sport: 'road', kind: 'custom' })   // same id: ignored
    const rows = await sql`SELECT clerk_user_id, sport FROM training_sessions`
    expect(rows.filter(r => r.clerk_user_id === A)).toEqual([])
    expect(rows.filter(r => r.clerk_user_id === B)).toEqual([{ clerk_user_id: B, sport: 'mtb' }])
  })
})
