// Training routes: validation, and that every query is filtered by the
// verified user's Clerk id. A fake sql records each query and its values.
import { describe, it, expect } from 'vitest'
import { ROUTES, SPORT_IDS, AREA_IDS, KIT_IDS, FOCUS_IDS } from './_training.js'
import { matchRoute } from './_api.js'
import { fakeRes } from './_test-db.js'
import { SPORTS, AREAS, KIT, FOCUS } from '../src/training/data.js'
import { touchesPersonalTables } from './db.js'

const ME = 'user_me'
const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

function run(method, path, body) {
  const calls = []
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values })
    return Promise.resolve([{ sport: 'mtb', areas: [], kit: [], gen: {} }])
  }
  const m = matchRoute(method, path, ROUTES)
  const res = fakeRes()
  return m.route.handler({ body }, res, { sql, user: { clerk_id: ME }, params: m.params }).then(() => ({ res, calls }))
}

describe('lists match the content in src/training/data.js', () => {
  it('sports, areas, kit and focus', () => {
    expect(SPORT_IDS).toEqual(SPORTS.map(s => s.id))
    expect(AREA_IDS).toEqual(AREAS.map(a => a.id))
    expect(KIT_IDS).toEqual(KIT.map(k => k.id))
    expect(FOCUS_IDS).toEqual(Object.keys(FOCUS))
  })
})

describe('every query is scoped to the verified user', () => {
  it('GET reads only my profile and my program rows', async () => {
    const { calls } = await run('GET', 'training')
    expect(calls).toHaveLength(2)
    for (const c of calls) {
      expect(c.text).toContain('clerk_user_id = ?')
      expect(c.values).toContain(ME)
    }
  })

  it('PUT profile writes under my id, never one from the body', async () => {
    const { res, calls } = await run('PUT', 'training/profile', { clerk_user_id: 'user_other', sport: 'mtb', areas: ['ham'], kit: ['band'], gen: { dur: 30, focus: 'full', phase: null } })
    expect(res.statusCode).toBe(200)
    expect(calls[0].values[0]).toBe(ME)
    expect(calls[0].values).not.toContain('user_other')
  })

  it('POST a program session writes under my id', async () => {
    const { res, calls } = await run('POST', 'training/sessions', { id: ID, clerk_user_id: 'user_other', sport: 'mtb', kind: 'program', week: 2, session_key: 'B', items: null })
    expect(res.statusCode).toBe(200)
    expect(calls[0].values).toContain(ME)
    expect(calls[0].values).not.toContain('user_other')
  })

  it('DELETE removes only my row', async () => {
    const { res, calls } = await run('DELETE', 'training/sessions/mtb/2/B')
    expect(res.statusCode).toBe(200)
    expect(calls[0].text).toContain('clerk_user_id = ?')
    expect(calls[0].values).toEqual([ME, 'mtb', 2, 'B'])
  })
})

describe('validation', () => {
  const bad = async (method, path, body, field) => {
    const { res, calls } = await run(method, path, body)
    expect(res.statusCode).toBe(422)
    expect(res.body.error.field).toBe(field)
    expect(calls).toHaveLength(0)
  }
  it('rejects an unknown sport, area or kit', async () => {
    await bad('PUT', 'training/profile', { sport: 'golf', areas: [], kit: [], gen: {} }, 'sport')
    await bad('PUT', 'training/profile', { sport: 'mtb', areas: ['neck'], kit: [], gen: {} }, 'areas')
    await bad('PUT', 'training/profile', { sport: 'mtb', areas: [], kit: ['barbell'], gen: {} }, 'kit')
    await bad('PUT', 'training/profile', { sport: 'mtb', areas: [], kit: [], gen: { dur: 5 } }, 'gen')
  })
  it('rejects a bad session', async () => {
    const ok = { id: ID, sport: 'mtb', kind: 'program', week: 1, session_key: 'A' }
    await bad('POST', 'training/sessions', { ...ok, id: 'nope' }, 'id')
    await bad('POST', 'training/sessions', { ...ok, kind: 'other' }, 'kind')
    await bad('POST', 'training/sessions', { ...ok, week: 9 }, 'week')
    await bad('POST', 'training/sessions', { ...ok, session_key: 'D' }, 'session_key')
    await bad('POST', 'training/sessions', { ...ok, items: 'x' }, 'items')
    await bad('POST', 'training/sessions', { ...ok, duration_seconds: -1 }, 'duration_seconds')
  })
  it('a custom session needs no week', async () => {
    const { res } = await run('POST', 'training/sessions', { id: ID, sport: 'climbing', kind: 'custom', items: [{ id: 'row' }], duration_seconds: 1800 })
    expect(res.statusCode).toBe(200)
  })
  it('routes: unknown paths and methods', () => {
    expect(matchRoute('DELETE', 'training/sessions/mtb/2/D', ROUTES).status).toBe(404)
    expect(matchRoute('POST', 'training', ROUTES).status).toBe(405)
  })
})

describe('/api/db keeps off the Training tables', () => {
  it('refuses reads and writes that name them', () => {
    expect(touchesPersonalTables('SELECT * FROM training_sessions')).toBe(true)
    expect(touchesPersonalTables('select * from "public"."training_profiles"')).toBe(true)
    expect(touchesPersonalTables('DELETE FROM training_sessions WHERE true')).toBe(true)
    expect(touchesPersonalTables('CREATE TABLE IF NOT EXISTS x AS SELECT * FROM training_sessions')).toBe(true)
    expect(touchesPersonalTables('CREATE TABLE IF NOT EXISTS training_profiles (a int); DROP TABLE t')).toBe(true)
  })
  it('lets the boot migrations create them and leaves other tables alone', () => {
    expect(touchesPersonalTables('\n    CREATE TABLE IF NOT EXISTS training_profiles (clerk_user_id TEXT PRIMARY KEY)\n  ')).toBe(false)
    expect(touchesPersonalTables('CREATE UNIQUE INDEX IF NOT EXISTS training_sessions_program_uq ON training_sessions (a) WHERE kind = \'program\'')).toBe(false)
    expect(touchesPersonalTables('SELECT * FROM user_notes')).toBe(false)
  })
})
