// Runs the What's due feed's SQL (fetchDueSources + collectDue) against a real
// Postgres. Skipped unless SLATE_TEST_DATABASE_URL is set — see _test-db.js.
//
// One row of each kind that should show, beside the ones that shouldn't:
// another workspace's, finished work, a paused workstream, a passed Team
// Calendar deadline and anything past the window.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TEST_DB, connectTestDb } from './_test-db.js'
import { dueFeed } from './_due-feed.js'

const describeDb = TEST_DB ? describe : describe.skip
const WS = 'user_due_ws'
const OTHER = 'user_due_other'
const today = '2026-09-28'
let sql, ana, ben

async function wipe() {
  for (const ws of [WS, OTHER]) {
    await sql`DELETE FROM workstreams WHERE user_id = ${ws}`
    await sql`DELETE FROM companies WHERE user_id = ${ws}`
    await sql`DELETE FROM tasks WHERE user_id = ${ws}`
    await sql`DELETE FROM team_calendar_entries WHERE user_id = ${ws}`
    await sql`DELETE FROM post_production_schedules WHERE user_id = ${ws}`
    await sql`DELETE FROM boards WHERE user_id = ${ws}`
    await sql`DELETE FROM canvases WHERE user_id = ${ws}`
    await sql`DELETE FROM marketing_cards WHERE user_id = ${ws}`
    await sql`DELETE FROM projects WHERE user_id = ${ws}`
  }
  await sql`DELETE FROM app_users WHERE clerk_id IN ('user_due_ana', 'user_due_ben')`
}

async function seed(ws, prefix) {
  const [co] = await sql`INSERT INTO companies (user_id, name) VALUES (${ws}, ${prefix + 'DMM'}) RETURNING id`
  const [live] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${co.id}, 'Launch') RETURNING id`
  const [paused] = await sql`INSERT INTO workstreams (user_id, company_id, title, status) VALUES (${ws}, ${co.id}, 'On hold', 'paused') RETURNING id`
  await sql`INSERT INTO deliverables (workstream_id, title, due_kind, due_date, status, owner_id) VALUES
    (${live.id}, ${prefix + 'Hero film'}, 'exact', '2026-10-02', 'in_progress', ${ana.id}),
    (${live.id}, ${prefix + 'Approved film'}, 'exact', '2026-10-02', 'approved', ${ana.id}),
    (${live.id}, ${prefix + 'Far film'}, 'exact', '2026-11-20', 'planned', ${ana.id}),
    (${paused.id}, ${prefix + 'Paused film'}, 'exact', '2026-10-02', 'planned', ${ana.id})`

  const [project] = await sql`
    INSERT INTO projects (user_id, name, deliverables)
    VALUES (${ws}, ${prefix + 'Brand film'}, ${JSON.stringify([
      { text: prefix + 'Master', due: '2026-10-01', assignee_id: ben.id, done: false },
      { text: prefix + 'Done master', due: '2026-10-01', done: true },
    ])}::jsonb) RETURNING id`

  await sql`INSERT INTO marketing_cards (user_id, title, due_date, lead_owner_id, sub_tasks, status) VALUES
    (${ws}, ${prefix + 'Newsletter'}, '2026-10-05', 'user_due_ana',
     ${JSON.stringify([{ id: 's1', text: prefix + 'Write intro', due_date: '2026-09-30', owner_id: 'user_due_ben', done: false }])}::jsonb, 'in-progress'),
    (${ws}, ${prefix + 'Shipped post'}, '2026-10-05', 'user_due_ana', '[]'::jsonb, 'done')`

  const [canvas] = await sql`INSERT INTO canvases (user_id, name) VALUES (${ws}, ${prefix + 'Shoot plan'}) RETURNING id`
  await sql`INSERT INTO canvas_items (canvas_id, kind, sub_tasks) VALUES
    (${canvas.id}, 'todo', ${JSON.stringify([{ id: 'x', text: prefix + 'Book van', due_date: '2026-10-03', owner_id: 'user_due_ana', done: false }])}::jsonb),
    (${canvas.id}, 'note', ${JSON.stringify([{ id: 'y', text: prefix + 'Not a checklist', due_date: '2026-10-03' }])}::jsonb)`

  const [board] = await sql`INSERT INTO boards (user_id, name) VALUES (${ws}, ${prefix + 'Autumn'}) RETURNING id`
  const [doing] = await sql`INSERT INTO board_columns (board_id, name) VALUES (${board.id}, 'In progress') RETURNING id`
  const [done] = await sql`INSERT INTO board_columns (board_id, name) VALUES (${board.id}, 'Done') RETURNING id`
  await sql`INSERT INTO board_cards (board_id, column_id, title, due_date, assignee_id) VALUES
    (${board.id}, ${doing.id}, ${prefix + 'Script'}, '2026-10-04', ${ben.id}),
    (${board.id}, ${done.id}, ${prefix + 'Finished script'}, '2026-10-04', ${ben.id})`

  const [schedule] = await sql`INSERT INTO post_production_schedules (user_id, project_id) VALUES (${ws}, ${project.id}) RETURNING id`
  await sql`INSERT INTO pps_phases (schedule_id, name, blocks) VALUES (${schedule.id}, 'Edit', ${JSON.stringify([
    { id: 'bk1', title: prefix + 'Picture lock', end_date: '2026-10-06', is_deadline: true, assignee_id: ana.id },
    { id: 'bk2', title: prefix + 'Rough cut', end_date: '2026-10-06', is_deadline: false },
  ])}::jsonb)`

  await sql`INSERT INTO team_calendar_entries (user_id, assignee_id, entry_date, label, is_deadline) VALUES
    (${ws}, ${ben.id}, '2026-10-07', ${prefix + 'Online deadline'}, true),
    (${ws}, ${ben.id}, '2026-09-20', ${prefix + 'Passed deadline'}, true),
    (${ws}, ${ben.id}, '2026-10-07', ${prefix + 'Just a booking'}, false)`

  await sql`INSERT INTO tasks (user_id, title, due_at, assignee_id, status, archived_at) VALUES
    (${ws}, ${prefix + 'Send invoice'}, '2026-10-08T10:00:00Z', ${ana.id}, 'todo', NULL),
    (${ws}, ${prefix + 'Chase reply'}, '2026-09-21T10:00:00Z', NULL, 'todo', NULL),
    (${ws}, ${prefix + 'Done task'}, '2026-10-08T10:00:00Z', ${ana.id}, 'done', NULL),
    (${ws}, ${prefix + 'Archived task'}, '2026-10-08T10:00:00Z', ${ana.id}, 'todo', now()),
    (${ws}, ${prefix + 'Undated task'}, NULL, ${ana.id}, 'todo', NULL)`
}

describeDb('the What\'s due feed against Postgres', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await wipe()
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('user_due_ana', 'ana@due.test', 'Ana', 'user') RETURNING id`
    ;[ben] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('user_due_ben', 'ben@due.test', 'Ben', 'user') RETURNING id`
    await seed(WS, '')
    await seed(OTHER, 'Other ')
  })
  afterAll(async () => { await wipe(); await sql.end() })

  it('lists one of each kind, in date order, and nothing that shouldn\'t be there', async () => {
    const feed = await dueFeed(sql, { ws: WS, days: 14, today })
    expect(feed).toMatchObject({ today, to: '2026-10-12' })
    expect(feed.items.map(i => [i.date, i.type, i.title, i.owner?.name ?? null])).toEqual([
      ['2026-09-21', 'task', 'Chase reply', null],
      ['2026-09-30', 'marketing_task', 'Write intro', 'Ben'],
      ['2026-10-01', 'project_deliverable', 'Master', 'Ben'],
      ['2026-10-02', 'deliverable', 'Hero film', 'Ana'],
      ['2026-10-03', 'checklist', 'Book van', 'Ana'],
      ['2026-10-04', 'board_card', 'Script', 'Ben'],
      ['2026-10-05', 'marketing_card', 'Newsletter', 'Ana'],
      ['2026-10-06', 'edit_deadline', 'Picture lock', 'Ana'],
      ['2026-10-07', 'edit_deadline', 'Online deadline', 'Ben'],
      ['2026-10-08', 'task', 'Send invoice', 'Ana'],
    ])
    expect(feed.items[0]).toMatchObject({ overdue: true, days: -7 })
  })

  it('narrows to one person', async () => {
    const feed = await dueFeed(sql, { ws: WS, days: 14, today, ownerId: ana.id })
    expect(feed.items.map(i => i.title)).toEqual(['Hero film', 'Book van', 'Newsletter', 'Picture lock', 'Send invoice'])
  })

  it('reaches further with a longer window', async () => {
    const feed = await dueFeed(sql, { ws: WS, days: 60, today })
    expect(feed.items.map(i => i.title)).toContain('Far film')
    expect(feed.items.map(i => i.title)).not.toContain('Paused film')
  })
})
