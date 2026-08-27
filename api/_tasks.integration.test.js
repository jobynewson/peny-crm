// api/_tasks.integration.test.js
// Exercises the real route handlers against a real Postgres — the SQL is the
// part unit tests cannot reach. Skipped unless TASKS_TEST_DATABASE_URL is set,
// so `npm test` stays green with no database and no extra dependency.
//
// To run it:
//   npm i -D pg                 # not a project dependency; the app uses the
//                               # Neon HTTP driver, which cannot reach localhost
//   TASKS_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/slate_test \
//     npx vitest run api/_tasks.integration.test.js
//
// The target database needs the schema from drizzle/0025_add_tasks.sql plus
// app_users rows for a@peny.com and b@peny.com and one workspace row.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

const DB = process.env.TASKS_TEST_DATABASE_URL
const describeDb = DB ? describe : describe.skip

// The router verifies a Clerk session; CURRENT stands in for whoever is calling.
let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT
    ? { user: CURRENT }
    : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))

const { handleTasks } = await import('./_tasks.js')

// Stands in for the Neon tagged template: same (strings, ...values) call shape,
// same "resolves to an array of rows" contract.
let sql = null
async function connect() {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: DB })
  return (strings, ...values) => {
    let text = strings[0]
    for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1]
    return pool.query(text, values).then(r => r.rows)
  }
}

function res$() {
  const r = { statusCode: null, body: null, headers: {} }
  r.status = c => { r.statusCode = c; return r }
  r.json = b => { r.body = b; return r }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = () => r
  return r
}
const call = async (method, route, { body, query } = {}) => {
  const res = res$()
  await handleTasks({ method, url: '/api/portal', query: { route, ...query }, body, headers: {} }, res, sql)
  return res
}

let ana, ben
beforeAll(async () => {
  sql = await connect()
  await sql`DELETE FROM tasks`
  const users = await sql`SELECT id, name, email FROM app_users ORDER BY clerk_id`
  ana = users.find(u => u.email === 'a@peny.com')
  ben = users.find(u => u.email === 'b@peny.com')
  ana.name = 'Ana Silva'; ben.name = 'Ben Torres'
  await sql`UPDATE app_users SET name='Ana Silva' WHERE id=${ana.id}`
  await sql`UPDATE app_users SET name='Ben Torres' WHERE id=${ben.id}`
})
beforeEach(async () => { await sql`DELETE FROM tasks`; CURRENT = ana })

describeDb('routing + auth', () => {
  it('401s without a session', async () => {
    CURRENT = null
    const r = await call('GET', 'tasks')
    expect(r.statusCode).toBe(401)
    expect(r.body.error.code).toBe('unauthorised')
  })
  it('404s an unknown route as JSON', async () => {
    const r = await call('GET', 'widgets')
    expect(r.statusCode).toBe(404)
    expect(r.body.error).toMatchObject({ code: 'not_found' })
  })
  it('405s with an Allow header', async () => {
    const r = await call('DELETE', 'tasks')
    expect(r.statusCode).toBe(405)
    expect(r.headers.Allow).toBe('GET, POST')
  })
  it('pings', async () => {
    const r = await call('GET', 'tasks/_ping')
    expect(r.statusCode).toBe(200)
    expect(r.body.ok).toBe(true)
  })
})

describeDb('create', () => {
  it('creates from a title alone', async () => {
    const r = await call('POST', 'tasks', { body: { title: 'Just a title' } })
    expect(r.statusCode).toBe(201)
    expect(r.body.task).toMatchObject({ title: 'Just a title', status: 'todo', assignee_id: null })
    expect(Number(r.body.task.position)).toBe(1024)
  })
  it('422s an empty title with a field', async () => {
    const r = await call('POST', 'tasks', { body: { title: '  ' } })
    expect(r.statusCode).toBe(422)
    expect(r.body.error).toMatchObject({ code: 'validation_failed', field: 'title' })
  })
  it('422s a bogus assignee rather than 500ing', async () => {
    const r = await call('POST', 'tasks', { body: { title: 'x', assignee_id: '00000000-0000-0000-0000-000000000000' } })
    expect(r.statusCode).toBe(422)
    expect(r.body.error.field).toBe('assignee_id')
  })
  it('stacks new tasks by 1024', async () => {
    await call('POST', 'tasks', { body: { title: 'one' } })
    const r = await call('POST', 'tasks', { body: { title: 'two' } })
    expect(Number(r.body.task.position)).toBe(2048)
  })
  it('writes created + assigned events and notifies the assignee', async () => {
    const r = await call('POST', 'tasks', { body: { title: 'for ben', assignee_id: ben.id } })
    const events = await sql`SELECT type FROM task_events WHERE task_id=${r.body.task.id} ORDER BY created_at`
    expect(events.map(e => e.type)).toEqual(['created', 'assigned'])
    const n = await sql`SELECT type, recipient_id FROM notifications WHERE task_id=${r.body.task.id}`
    expect(n).toEqual([{ type: 'assigned', recipient_id: ben.id }])
  })
})

describeDb('acknowledgement', () => {
  let task
  beforeEach(async () => {
    const r = await call('POST', 'tasks', { body: { title: 'ack me', assignee_id: ben.id } })
    task = r.body.task
  })
  it('refuses anyone who is not the assignee', async () => {
    const r = await call('POST', `tasks/${task.id}/acknowledge`)
    expect(r.statusCode).toBe(403)
    expect(r.body.error.code).toBe('not_assignee')
  })
  it('lets the assignee acknowledge and notifies the creator', async () => {
    CURRENT = ben
    const r = await call('POST', `tasks/${task.id}/acknowledge`)
    expect(r.statusCode).toBe(200)
    expect(r.body.task.acknowledged_at).not.toBeNull()
    const n = await sql`SELECT type, recipient_id FROM notifications WHERE task_id=${task.id} AND type='acknowledged'`
    expect(n).toEqual([{ type: 'acknowledged', recipient_id: ana.id }])
  })
  it('is idempotent', async () => {
    CURRENT = ben
    await call('POST', `tasks/${task.id}/acknowledge`)
    const r = await call('POST', `tasks/${task.id}/acknowledge`)
    expect(r.statusCode).toBe(200)
    const n = await sql`SELECT count(*)::int c FROM notifications WHERE task_id=${task.id} AND type='acknowledged'`
    expect(n[0].c).toBe(1)
  })
  it('is implied when the assignee starts the work', async () => {
    CURRENT = ben
    const r = await call('PATCH', `tasks/${task.id}`, { body: { status: 'doing' } })
    expect(r.body.task.acknowledged_at).not.toBeNull()
    const types = (await sql`SELECT type FROM task_events WHERE task_id=${task.id}`).map(e => e.type)
    expect(types).toContain('acknowledged')
  })
  it('is NOT implied when someone else moves the card', async () => {
    const r = await call('PATCH', `tasks/${task.id}`, { body: { status: 'doing' } })
    expect(r.body.task.acknowledged_at).toBeNull()
  })
  it('is cleared by reassignment', async () => {
    CURRENT = ben
    await call('POST', `tasks/${task.id}/acknowledge`)
    CURRENT = ana
    const r = await call('PATCH', `tasks/${task.id}`, { body: { assignee_id: ana.id } })
    expect(r.body.task.acknowledged_at).toBeNull()
    expect(r.body.task.nudged_at).toBeNull()
  })
})

describeDb('comments and mentions', () => {
  it('notifies mentioned users and the creator, never the author', async () => {
    const t = (await call('POST', 'tasks', { body: { title: 'thread', assignee_id: ben.id } })).body.task
    CURRENT = ben
    const r = await call('POST', `tasks/${t.id}/comments`, { body: { body: 'hi @ana, look at this' } })
    expect(r.statusCode).toBe(201)
    expect(r.body.comment.mentioned_ids).toEqual([ana.id])
    const n = await sql`SELECT type, recipient_id FROM notifications WHERE task_id=${t.id} AND type IN ('mentioned','commented')`
    expect(n).toEqual([{ type: 'mentioned', recipient_id: ana.id }])
  })
  it('rejects an empty comment', async () => {
    const t = (await call('POST', 'tasks', { body: { title: 'x' } })).body.task
    const r = await call('POST', `tasks/${t.id}/comments`, { body: { body: '   ' } })
    expect(r.statusCode).toBe(422)
  })
})

describeDb('status + completion', () => {
  it('notifies the creator on completion by someone else', async () => {
    const t = (await call('POST', 'tasks', { body: { title: 'finish', assignee_id: ben.id } })).body.task
    CURRENT = ben
    await call('PATCH', `tasks/${t.id}`, { body: { status: 'done' } })
    const n = await sql`SELECT type, recipient_id FROM notifications WHERE task_id=${t.id} AND type='completed'`
    expect(n).toEqual([{ type: 'completed', recipient_id: ana.id }])
  })
  it('422s a bad status', async () => {
    const t = (await call('POST', 'tasks', { body: { title: 'x' } })).body.task
    const r = await call('PATCH', `tasks/${t.id}`, { body: { status: 'blocked' } })
    expect(r.statusCode).toBe(422)
    expect(r.body.error.field).toBe('status')
  })
})

describeDb('listing and polling', () => {
  it('scope=mine returns only my tasks', async () => {
    await call('POST', 'tasks', { body: { title: 'mine', assignee_id: ana.id } })
    await call('POST', 'tasks', { body: { title: 'bens', assignee_id: ben.id } })
    await call('POST', 'tasks', { body: { title: 'nobody' } })
    const all = await call('GET', 'tasks', { query: { scope: 'board' } })
    expect(all.body.tasks).toHaveLength(3)
    const mine = await call('GET', 'tasks', { query: { scope: 'mine' } })
    expect(mine.body.tasks.map(t => t.title)).toEqual(['mine'])
  })
  it('always returns server_time and an unread count', async () => {
    const r = await call('GET', 'tasks')
    expect(typeof r.body.server_time).toBe('string')
    expect(typeof r.body.unread_notifications).toBe('number')
  })
  it('updated_since returns only changed rows plus archived_ids', async () => {
    const t = (await call('POST', 'tasks', { body: { title: 'old' } })).body.task
    const stamp = (await call('GET', 'tasks')).body.server_time
    await new Promise(r => setTimeout(r, 20))
    await call('POST', 'tasks', { body: { title: 'new' } })
    await sql`UPDATE tasks SET archived_at=NOW(), updated_at=NOW() WHERE id=${t.id}`
    const poll = await call('GET', 'tasks', { query: { updated_since: stamp } })
    expect(poll.body.tasks.map(x => x.title)).toEqual(['new'])
    expect(poll.body.archived_ids).toEqual([t.id])
  })
  it('excludes archived tasks from the board', async () => {
    const t = (await call('POST', 'tasks', { body: { title: 'gone' } })).body.task
    await sql`UPDATE tasks SET archived_at=NOW() WHERE id=${t.id}`
    expect((await call('GET', 'tasks')).body.tasks).toHaveLength(0)
  })
  it('caps Done at 25 unless include_done=all', async () => {
    for (let i = 0; i < 30; i++) {
      const t = (await call('POST', 'tasks', { body: { title: 'd' + i } })).body.task
      await sql`UPDATE tasks SET status='done' WHERE id=${t.id}`
    }
    expect((await call('GET', 'tasks')).body.tasks).toHaveLength(25)
    expect((await call('GET', 'tasks', { query: { include_done: 'all' } })).body.tasks).toHaveLength(30)
  })
})

describeDb('ordering', () => {
  it('rebalances a column once midpoints exhaust precision', async () => {
    const a = (await call('POST', 'tasks', { body: { title: 'a' } })).body.task
    const b = (await call('POST', 'tasks', { body: { title: 'b' } })).body.task
    let lo = 1024, hi = 2048
    for (let i = 0; i < 60; i++) { hi = (lo + hi) / 2; await call('PATCH', `tasks/${b.id}`, { body: { position: hi } }) }
    const rows = await sql`SELECT position FROM tasks WHERE status='todo' ORDER BY position`
    expect(rows.map(r => Number(r.position))).toEqual([1024, 2048])
  })
})

describeDb('notifications inbox', () => {
  it('lists unread and marks them read', async () => {
    await call('POST', 'tasks', { body: { title: 'ping ben', assignee_id: ben.id } })
    CURRENT = ben
    const list = await call('GET', 'notifications', { query: { unread: 'true' } })
    expect(list.body.notifications).toHaveLength(1)
    expect(list.body.notifications[0]).toMatchObject({ type: 'assigned', task_title: 'ping ben' })
    await call('POST', 'notifications/read', { body: { all: true } })
    expect((await call('GET', 'notifications', { query: { unread: 'true' } })).body.notifications).toHaveLength(0)
  })
  it('cannot mark another persons notifications read', async () => {
    await call('POST', 'tasks', { body: { title: 'for ben', assignee_id: ben.id } })
    const [n] = await sql`SELECT id FROM notifications WHERE recipient_id=${ben.id}`
    await call('POST', 'notifications/read', { body: { ids: [n.id] } })   // as ana
    const [{ read_at }] = await sql`SELECT read_at FROM notifications WHERE id=${n.id}`
    expect(read_at).toBeNull()
  })
})
