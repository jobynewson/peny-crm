// scripts/seed-tasks.js
//
// Local-dev seed for the task board. Creates a spread of tasks that exercises
// every state the two shells render — unacknowledged, doing, overdue,
// unassigned, done — so the board isn't an empty screen while building the UI.
//
//   VITE_DATABASE_URL=postgres://… node scripts/seed-tasks.js          # dry run (default)
//   VITE_DATABASE_URL=postgres://… node scripts/seed-tasks.js --apply  # actually writes
//   VITE_DATABASE_URL=postgres://… node scripts/seed-tasks.js --apply --reset
//
// --reset deletes every seeded row first (matched by the marker below), so the
// script is safe to re-run. It never touches tasks you created by hand.
//
// Assigns round-robin across the real app_users rows already in the DB, so run
// it after at least one person has signed in.

import { neon } from '@neondatabase/serverless'

const APPLY = process.argv.includes('--apply')
const RESET = process.argv.includes('--reset')

// Seeded rows are tagged in parent_type so --reset can find them again without
// guessing from titles. Real tasks never set this in Phase 1.
const MARKER = 'seed'

const url = process.env.VITE_DATABASE_URL
if (!url) {
  console.error('VITE_DATABASE_URL is required')
  process.exit(1)
}
const sql = neon(url)

const hours = (n) => new Date(Date.now() - n * 3600_000).toISOString()
const days  = (n) => new Date(Date.now() + n * 86400_000).toISOString()

// [title, status, assigneeOffset|null, due_at, acknowledged, ageHours]
// assigneeOffset indexes into the app_users list; null = unassigned tray.
const SEEDS = [
  ['Send the Q3 retainer report to Maple',       'todo',  0, days(1),  false, 5],
  ['Chase the missing invoice from Northwind',   'todo',  1, days(3),  true,  30],
  ['Book the studio for the November shoot',     'todo',  0, null,     true,  50],
  ['Someone grab the drive from the office',     'todo',  null, null,  false, 2],
  ['Nobody has picked this up yet',              'todo',  null, days(2), false, 26],
  ['Overdue: renew the equipment insurance',     'todo',  1, days(-2), true,  100],
  ['Edit the Harbourside cutdowns',              'doing', 0, days(5),  true,  70],
  ['Colour grade the Meridian spot',             'doing', 1, null,     true,  20],
  ['Just assigned, not seen yet',                'todo',  1, null,     false, 1],
  ['Deliver the Ashcroft masters',               'done',  0, days(-4), true,  200],
  ['Archive last quarter call sheets',           'done',  1, null,     true,  300],
]

async function main() {
  const users = await sql`SELECT id, name, email FROM app_users ORDER BY created_at`
  if (!users.length) {
    console.error('No app_users rows — sign in to the app once first.')
    process.exit(1)
  }
  const workspace = await sql`SELECT owner_id FROM workspace LIMIT 1`
  if (!workspace[0]) {
    console.error('No workspace row — sign in to the app once first.')
    process.exit(1)
  }
  const workspaceId = workspace[0].owner_id
  console.log(`Workspace ${workspaceId} · ${users.length} user(s): ${users.map(u => u.name || u.email).join(', ')}`)

  if (RESET) {
    if (APPLY) {
      const gone = await sql`DELETE FROM tasks WHERE parent_type = ${MARKER} RETURNING id`
      console.log(`Reset: deleted ${gone.length} seeded task(s) (comments/events/notifications cascade)`)
    } else {
      const [{ count }] = await sql`SELECT count(*)::int AS count FROM tasks WHERE parent_type = ${MARKER}`
      console.log(`Reset: would delete ${count} seeded task(s)`)
    }
  }

  const pick = (offset) => offset === null ? null : users[offset % users.length].id
  const creator = users[0].id

  let position = 1024
  for (const [title, status, offset, due, acked, ageHours] of SEEDS) {
    const assignee = pick(offset)
    // Mirrors the acknowledgement rule: only an assigned task can be
    // unacknowledged, and doing/done always implies it was seen.
    const acknowledged = assignee && (acked || status !== 'todo') ? hours(ageHours - 1) : null

    if (!APPLY) {
      console.log(`  would create [${status}] ${title}${assignee ? '' : '  (unassigned)'}${acknowledged ? '' : '  ← unacknowledged'}`)
      position += 1024
      continue
    }

    const [task] = await sql`
      INSERT INTO tasks (user_id, title, status, assignee_id, created_by, due_at,
                         acknowledged_at, project_id, parent_type, position, created_at, updated_at)
      VALUES (${workspaceId}, ${title}, ${status}::task_status, ${assignee}, ${creator}, ${due},
              ${acknowledged}, NULL, ${MARKER}, ${position}, ${hours(ageHours)}, ${hours(ageHours)})
      RETURNING id
    `
    // Every task carries its created event — the board's activity feed and all
    // notification generation read from task_events, never from the handlers.
    await sql`
      INSERT INTO task_events (task_id, actor_id, type, payload, created_at)
      VALUES (${task.id}, ${creator}, 'created', ${JSON.stringify({ title })}::jsonb, ${hours(ageHours)})
    `
    if (assignee) {
      await sql`
        INSERT INTO task_events (task_id, actor_id, type, payload, created_at)
        VALUES (${task.id}, ${creator}, 'assigned', ${JSON.stringify({ assignee_id: assignee })}::jsonb, ${hours(ageHours)})
      `
    }
    console.log(`  created [${status}] ${title}`)
    position += 1024
  }

  console.log(APPLY ? '\nDone.' : '\nDry run — nothing written. Re-run with --apply.')
}

main().catch(err => { console.error(err); process.exit(1) })
