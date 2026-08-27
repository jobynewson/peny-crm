// api/_tasks.js
// Task board API — every task and notification route behind one internal router.
//
// NOT its own Vercel function. The `_` prefix keeps this file out of Vercel's
// function detection: we are AT the Hobby plan's 12-function cap (see
// claude.md), so a new file under api/ would fail the deployment outright.
// Reached via vercel.json rewrites onto /api/portal?view=tasks, which passes the
// original sub-path through as ?route= and delegates here.
//
// >>> New task endpoints go in the ROUTES table below — never in a new file. <<<
//
// Contract:
//   - Clerk session verification runs ONCE, before dispatch (handlers can trust
//     `ctx.user` is a real app_users row).
//   - Unknown path      → 404
//   - Known path, wrong method → 405 + Allow header
//   - Every response is JSON. Errors are always { error: { code, message } };
//     validation failures add a `field` so the UI can point at the input.

import { verifyClerkUser } from './_auth.js'
import {
  positionBetween, needsRebalance, rebalancedPositions,
  parseMentions, notificationsFor, acknowledgementPatch,
  validateTaskInput, toTimestamp, POSITION_GAP,
} from './_task-rules.js'

// ── Response helpers ─────────────────────────────────────────────────────────
export const fail = (res, status, code, message, extra = {}) =>
  res.status(status).json({ error: { code, message, ...extra } })

// 422 with a field-level message, per the spec — never a bare 500 for bad input.
export const invalid = (res, field, message) =>
  fail(res, 422, 'validation_failed', message, { field })

// ── Route table ──────────────────────────────────────────────────────────────
// Matched against `${req.method} ${route}`, where `route` is the path with the
// /api/ prefix stripped (e.g. "tasks/<uuid>/acknowledge").
//
// :id is constrained to a uuid rather than a loose segment. That keeps garbage
// ids from ever reaching a query, and lets literal sub-paths (like tasks/_ping)
// coexist with tasks/:id without ordering games.
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

export const ROUTES = [
  { method: 'GET',   pattern: /^tasks\/_ping$/,                                 handler: ping },
  { method: 'GET',   pattern: /^tasks$/,                                        handler: listTasks },
  { method: 'POST',  pattern: /^tasks$/,                                        handler: createTask },
  { method: 'GET',   pattern: new RegExp(`^tasks/(?<id>${UUID})$`),             handler: getTask },
  { method: 'PATCH', pattern: new RegExp(`^tasks/(?<id>${UUID})$`),             handler: patchTask },
  { method: 'POST',  pattern: new RegExp(`^tasks/(?<id>${UUID})/acknowledge$`), handler: acknowledgeTask },
  { method: 'POST',  pattern: new RegExp(`^tasks/(?<id>${UUID})/comments$`),    handler: createComment },
  { method: 'GET',   pattern: /^notifications$/,                                handler: listNotifications },
  { method: 'POST',  pattern: /^notifications\/read$/,                          handler: markNotificationsRead },
]

// ── Pure route matching (unit-tested in _tasks.test.js) ──────────────────────
// Returns { route, params } on a hit, or { status, code, message, allow? } for
// the 404 / 405 cases. Kept free of req/res so it can be tested directly.
export function matchRoute(method, path, routes = ROUTES) {
  const allow = []

  for (const route of routes) {
    const m = route.pattern.exec(path)
    if (!m) continue
    if (route.method === method) return { route, params: m.groups ?? {} }
    if (!allow.includes(route.method)) allow.push(route.method)
  }

  if (allow.length) {
    return {
      status: 405, code: 'method_not_allowed',
      message: `${method} is not allowed on this route`, allow,
    }
  }
  return { status: 404, code: 'not_found', message: 'Unknown route' }
}

// Normalise the incoming request to a bare route path.
// The vercel.json rewrites hand us the full route in ?route=; parsing req.url is
// the fallback so /api/portal?view=tasks&route=… also works when called directly
// (and so a missing rewrite fails as a clean 404 rather than a crash).
export function routePathFrom(req) {
  const raw = typeof req.query?.route === 'string' ? req.query.route : ''
  if (raw) return raw.replace(/^\/+|\/+$/g, '')

  const pathname = (req.url || '').split('?')[0]
  return pathname.replace(/^\/api\//, '').replace(/^\/+|\/+$/g, '')
}

// ── Entry point ──────────────────────────────────────────────────────────────
export async function handleTasks(req, res, sql) {
  // Same-origin only: the SPA calls these with an Authorization header, which
  // does not preflight. Deliberately no CORS headers — unlike the public portal
  // routes in the host function, this API is not for third parties.
  if (req.method === 'OPTIONS') return res.status(204).end()

  const path = routePathFrom(req)
  const match = matchRoute(req.method, path)

  // Resolve the route BEFORE authenticating so an unknown path can't be used to
  // probe token validity — but still authenticate before running any handler.
  if (match.status) {
    if (match.allow) res.setHeader('Allow', match.allow.join(', '))
    return fail(res, match.status, match.code, match.message)
  }

  const { user, error } = await verifyClerkUser(req, sql)
  if (error) return fail(res, error.status, error.code, error.message)

  try {
    return await match.route.handler(req, res, { sql, user, params: match.params })
  } catch (err) {
    // Never let an exception escape as Vercel's HTML error page.
    console.error(`[tasks] ${req.method} ${path} failed:`, err)
    return fail(res, 500, 'internal_error', 'Something went wrong')
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Proves the whole pipe end to end: rewrite → host function → router → auth →
// handler → JSON. Cheap to curl after a deploy.
async function ping(req, res, { user }) {
  return res.status(200).json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email },
    server_time: new Date().toISOString(),
  })
}

// ── Shared query helpers ─────────────────────────────────────────────────────

// Every table in this app is scoped by the workspace owner's Clerk ID. There is
// exactly one workspace row (see getOrCreateWorkspace in src/db/client.js).
async function workspaceId(sql) {
  const rows = await sql`SELECT owner_id FROM workspace LIMIT 1`
  if (!rows[0]) throw new Error('No workspace row')
  return rows[0].owner_id
}

// Task columns are listed explicitly in each query rather than SELECT *, so a
// future column cannot reach the browser without someone deciding it should.

async function loadTask(sql, ws, id) {
  const rows = await sql`
    SELECT id, user_id, title, body, status, assignee_id, created_by, due_at,
           acknowledged_at, nudged_at, project_id, parent_type, parent_id,
           position, archived_at, created_at, updated_at
    FROM tasks WHERE id = ${id} AND user_id = ${ws} LIMIT 1
  `
  return rows[0] ?? null
}

async function workspaceUserIds(sql) {
  const rows = await sql`SELECT id FROM app_users`
  return rows.map(r => r.id)
}

// THE choke point. Every mutation writes its event here, and notifications are
// generated from that event — never directly by a handler. Adding a mutation
// means calling this; see claude.md.
async function recordEvent(sql, { task, actorId, type, payload = {}, mentionedIds = [] }) {
  const [event] = await sql`
    INSERT INTO task_events (task_id, actor_id, type, payload)
    VALUES (${task.id}, ${actorId}, ${type}, ${JSON.stringify(payload)}::jsonb)
    RETURNING id, task_id, actor_id, type, payload, created_at
  `
  for (const r of notificationsFor({ type, actorId, task, mentionedIds })) {
    // ON CONFLICT makes a retried write a no-op rather than a double-notify;
    // the unique index is the real guarantee.
    await sql`
      INSERT INTO notifications (recipient_id, task_id, event_id, type)
      VALUES (${r.recipient_id}, ${task.id}, ${event.id}, ${r.type})
      ON CONFLICT (recipient_id, event_id) DO NOTHING
    `
  }
  return event
}

async function unreadCount(sql, userId) {
  const [row] = await sql`
    SELECT count(*)::int AS count FROM notifications
    WHERE recipient_id = ${userId} AND read_at IS NULL
  `
  return row.count
}

// Rewrite a column's positions to clean multiples of 1024 when midpoint inserts
// have exhausted double precision. One statement, so it is atomic.
async function rebalanceColumn(sql, ws, status) {
  const rows = await sql`
    SELECT id, position FROM tasks
    WHERE user_id = ${ws} AND status = ${status}::task_status AND archived_at IS NULL
    ORDER BY position, created_at
  `
  let tight = false
  for (let i = 1; i < rows.length; i++) {
    if (needsRebalance(rows[i - 1].position, rows[i].position)) { tight = true; break }
  }
  if (!tight) return false

  const ids = rows.map(r => r.id)
  const positions = rebalancedPositions(rows.length)
  await sql`
    UPDATE tasks AS t SET position = d.pos, updated_at = NOW()
    FROM (
      SELECT unnest(${ids}::uuid[]) AS id, unnest(${positions}::double precision[]) AS pos
    ) d
    WHERE t.id = d.id
  `
  return true
}

// Body may arrive parsed (Vercel does it for application/json) or as a string.
function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch { return null }
  }
  return req.body
}

const DONE_LIMIT = 25

// ── GET /api/tasks ───────────────────────────────────────────────────────────
async function listTasks(req, res, { sql, user }) {
  const ws = await workspaceId(sql)
  const { scope = 'board', project_id, assignee_id, updated_since, include_done } = req.query

  const since = updated_since ? new Date(updated_since) : null
  if (updated_since && isNaN(since.getTime())) {
    return invalid(res, 'updated_since', 'updated_since could not be read as a date')
  }

  const mineOnly   = scope === 'mine'
  const allDone    = include_done === 'all'
  const projectId  = project_id  || null
  const assigneeId = assignee_id || null

  // Every list query filters archived_at IS NULL, so Phase 2's auto-archive can
  // be switched on without revisiting any of them.
  const active = await sql`
    SELECT id, user_id, title, body, status, assignee_id, created_by, due_at,
           acknowledged_at, nudged_at, project_id, parent_type, parent_id,
           position, archived_at, created_at, updated_at
    FROM tasks
    WHERE user_id = ${ws}
      AND archived_at IS NULL
      AND status <> 'done'
      AND (${mineOnly}::boolean = false OR assignee_id = ${user.id})
      AND (${projectId}::uuid  IS NULL OR project_id  = ${projectId}::uuid)
      AND (${assigneeId}::uuid IS NULL OR assignee_id = ${assigneeId}::uuid)
      AND (${since}::timestamptz IS NULL OR updated_at > ${since}::timestamptz)
    ORDER BY position, created_at
  `

  // The Done column would otherwise grow without limit.
  const done = await sql`
    SELECT id, user_id, title, body, status, assignee_id, created_by, due_at,
           acknowledged_at, nudged_at, project_id, parent_type, parent_id,
           position, archived_at, created_at, updated_at
    FROM tasks
    WHERE user_id = ${ws}
      AND archived_at IS NULL
      AND status = 'done'
      AND (${mineOnly}::boolean = false OR assignee_id = ${user.id})
      AND (${projectId}::uuid  IS NULL OR project_id  = ${projectId}::uuid)
      AND (${assigneeId}::uuid IS NULL OR assignee_id = ${assigneeId}::uuid)
      AND (${since}::timestamptz IS NULL OR updated_at > ${since}::timestamptz)
    ORDER BY updated_at DESC
    LIMIT ${allDone ? 100000 : DONE_LIMIT}
  `

  const payload = {
    tasks: [...active, ...done],
    unread_notifications: await unreadCount(sql, user.id),
    // Clients echo this back as the next updated_since, so polling never
    // depends on the browser's clock agreeing with the server's.
    server_time: new Date().toISOString(),
  }

  // A poll also needs to know what to DROP, which a row-set of live tasks
  // cannot express.
  if (since) {
    const archived = await sql`
      SELECT id FROM tasks
      WHERE user_id = ${ws} AND archived_at IS NOT NULL AND updated_at > ${since}::timestamptz
    `
    payload.archived_ids = archived.map(r => r.id)
  }

  return res.status(200).json(payload)
}

// ── GET /api/tasks/:id ───────────────────────────────────────────────────────
async function getTask(req, res, { sql, user, params }) {
  const ws = await workspaceId(sql)
  const task = await loadTask(sql, ws, params.id)
  if (!task) return fail(res, 404, 'not_found', 'Task not found')

  const comments = await sql`
    SELECT c.id, c.task_id, c.author_id, c.body, c.created_at,
           u.name AS author_name, u.email AS author_email
    FROM task_comments c
    LEFT JOIN app_users u ON u.id = c.author_id
    WHERE c.task_id = ${task.id}
    ORDER BY c.created_at
  `
  const events = await sql`
    SELECT e.id, e.task_id, e.actor_id, e.type, e.payload, e.created_at,
           u.name AS actor_name, u.email AS actor_email
    FROM task_events e
    LEFT JOIN app_users u ON u.id = e.actor_id
    WHERE e.task_id = ${task.id}
    ORDER BY e.created_at DESC
  `
  return res.status(200).json({ task, comments, events })
}

// ── POST /api/tasks ──────────────────────────────────────────────────────────
async function createTask(req, res, { sql, user }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')

  const userIds = await workspaceUserIds(sql)
  const bad = validateTaskInput(body, { userIds })
  if (bad) return invalid(res, bad.field, bad.message)

  const ws = await workspaceId(sql)
  const assignee = body.assignee_id || null

  // New cards land at the bottom of To do.
  const [{ max }] = await sql`
    SELECT COALESCE(MAX(position), 0)::double precision AS max FROM tasks
    WHERE user_id = ${ws} AND status = 'todo' AND archived_at IS NULL
  `
  const [task] = await sql`
    INSERT INTO tasks (user_id, title, body, assignee_id, created_by, due_at, project_id, position)
    VALUES (${ws}, ${body.title.trim()}, ${body.body ?? null}, ${assignee}, ${user.id},
            ${toTimestamp(body.due_at)}, ${body.project_id || null}, ${Number(max) + POSITION_GAP})
    RETURNING id, user_id, title, body, status, assignee_id, created_by, due_at,
              acknowledged_at, nudged_at, project_id, parent_type, parent_id,
              position, archived_at, created_at, updated_at
  `

  await recordEvent(sql, { task, actorId: user.id, type: 'created', payload: { title: task.title } })
  if (assignee) {
    await recordEvent(sql, { task, actorId: user.id, type: 'assigned', payload: { assignee_id: assignee } })
  }
  return res.status(201).json({ task })
}

// ── PATCH /api/tasks/:id ─────────────────────────────────────────────────────
async function patchTask(req, res, { sql, user, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')

  const ws = await workspaceId(sql)
  const task = await loadTask(sql, ws, params.id)
  if (!task) return fail(res, 404, 'not_found', 'Task not found')

  const userIds = await workspaceUserIds(sql)
  const bad = validateTaskInput(body, { userIds, partial: true })
  if (bad) return invalid(res, bad.field, bad.message)

  const has = (k) => Object.prototype.hasOwnProperty.call(body, k)
  const patch = {}
  if (has('title'))       patch.title       = body.title.trim()
  if (has('body'))        patch.body        = body.body ?? null
  if (has('status'))      patch.status      = body.status
  if (has('assignee_id')) patch.assignee_id = body.assignee_id || null
  if (has('due_at'))      patch.due_at      = toTimestamp(body.due_at)
  if (has('project_id'))  patch.project_id  = body.project_id || null
  if (has('position'))    patch.position    = Number(body.position)

  const ack = acknowledgementPatch({ task, patch, actorId: user.id })

  const [updated] = await sql`
    UPDATE tasks SET
      title           = ${has('title')       ? patch.title       : task.title},
      body            = ${has('body')        ? patch.body        : task.body},
      status          = ${has('status')      ? patch.status      : task.status}::task_status,
      assignee_id     = ${has('assignee_id') ? patch.assignee_id : task.assignee_id},
      due_at          = ${has('due_at')      ? patch.due_at      : task.due_at},
      project_id      = ${has('project_id')  ? patch.project_id  : task.project_id},
      position        = ${has('position')    ? patch.position    : task.position},
      acknowledged_at = ${ack.acknowledged_at},
      nudged_at       = ${ack.nudged_at},
      updated_at      = NOW()
    WHERE id = ${task.id} AND user_id = ${ws}
    RETURNING id, user_id, title, body, status, assignee_id, created_by, due_at,
              acknowledged_at, nudged_at, project_id, parent_type, parent_id,
              position, archived_at, created_at, updated_at
  `

  // One event per thing that actually changed — the activity feed reads these,
  // and so does every notification.
  if (has('assignee_id') && patch.assignee_id !== task.assignee_id) {
    await recordEvent(sql, {
      task: updated, actorId: user.id,
      type: patch.assignee_id ? 'assigned' : 'unassigned',
      payload: { from: task.assignee_id, to: patch.assignee_id },
    })
  }
  if (has('status') && patch.status !== task.status) {
    await recordEvent(sql, {
      task: updated, actorId: user.id, type: 'status_changed',
      payload: { from: task.status, to: patch.status },
    })
  }
  if (has('due_at') && String(patch.due_at) !== String(task.due_at)) {
    await recordEvent(sql, {
      task: updated, actorId: user.id, type: 'due_changed',
      payload: { from: task.due_at, to: patch.due_at },
    })
  }
  // An implicit acknowledgement (assignee moved their own card to doing/done)
  // still owes the creator a receipt.
  if (!task.acknowledged_at && updated.acknowledged_at) {
    await recordEvent(sql, { task: updated, actorId: user.id, type: 'acknowledged' })
  }

  if (has('position')) await rebalanceColumn(sql, ws, updated.status)

  return res.status(200).json({ task: await loadTask(sql, ws, task.id) })
}

// ── POST /api/tasks/:id/acknowledge ──────────────────────────────────────────
async function acknowledgeTask(req, res, { sql, user, params }) {
  const ws = await workspaceId(sql)
  const task = await loadTask(sql, ws, params.id)
  if (!task) return fail(res, 404, 'not_found', 'Task not found')

  if (!task.assignee_id) {
    return fail(res, 409, 'not_assigned', 'An unassigned task cannot be acknowledged')
  }
  // Only the assignee. Acknowledging on someone else's behalf would make the
  // receipt meaningless.
  if (task.assignee_id !== user.id) {
    return fail(res, 403, 'not_assignee', 'Only the assignee can acknowledge this task')
  }
  // Idempotent: a double-tap on a flaky connection is not an error.
  if (task.acknowledged_at) return res.status(200).json({ task })

  const [updated] = await sql`
    UPDATE tasks SET acknowledged_at = NOW(), updated_at = NOW()
    WHERE id = ${task.id} AND user_id = ${ws}
    RETURNING id, user_id, title, body, status, assignee_id, created_by, due_at,
              acknowledged_at, nudged_at, project_id, parent_type, parent_id,
              position, archived_at, created_at, updated_at
  `
  await recordEvent(sql, { task: updated, actorId: user.id, type: 'acknowledged' })
  return res.status(200).json({ task: updated })
}

// ── POST /api/tasks/:id/comments ─────────────────────────────────────────────
async function createComment(req, res, { sql, user, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  if (typeof body.body !== 'string' || !body.body.trim()) {
    return invalid(res, 'body', 'Comment cannot be empty')
  }

  const ws = await workspaceId(sql)
  const task = await loadTask(sql, ws, params.id)
  if (!task) return fail(res, 404, 'not_found', 'Task not found')

  const [comment] = await sql`
    INSERT INTO task_comments (task_id, author_id, body)
    VALUES (${task.id}, ${user.id}, ${body.body.trim()})
    RETURNING id, task_id, author_id, body, created_at
  `

  // Mentions are resolved at write time and recorded on the event, so the
  // activity feed and the notification fan-out agree on who was named.
  const users = await sql`SELECT id, name, email FROM app_users`
  const mentionedIds = parseMentions(comment.body, users)

  await recordEvent(sql, {
    task, actorId: user.id, type: 'commented',
    payload: { comment_id: comment.id, mentioned_ids: mentionedIds },
    mentionedIds,
  })

  return res.status(201).json({ comment: { ...comment, mentioned_ids: mentionedIds } })
}

// ── GET /api/notifications ───────────────────────────────────────────────────
async function listNotifications(req, res, { sql, user }) {
  const unreadOnly = req.query.unread === 'true'
  const rows = await sql`
    SELECT n.id, n.task_id, n.event_id, n.type, n.read_at, n.created_at,
           t.title AS task_title, t.status AS task_status,
           e.actor_id, a.name AS actor_name, a.email AS actor_email
    FROM notifications n
    JOIN tasks t       ON t.id = n.task_id
    LEFT JOIN task_events e ON e.id = n.event_id
    LEFT JOIN app_users a   ON a.id = e.actor_id
    WHERE n.recipient_id = ${user.id}
      AND t.archived_at IS NULL
      AND (${unreadOnly}::boolean = false OR n.read_at IS NULL)
    ORDER BY n.created_at DESC
    LIMIT 100
  `
  return res.status(200).json({
    notifications: rows,
    unread_notifications: await unreadCount(sql, user.id),
    server_time: new Date().toISOString(),
  })
}

// ── POST /api/notifications/read ─────────────────────────────────────────────
async function markNotificationsRead(req, res, { sql, user }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')

  if (body.all === true) {
    await sql`
      UPDATE notifications SET read_at = NOW()
      WHERE recipient_id = ${user.id} AND read_at IS NULL
    `
    return res.status(200).json({ ok: true })
  }

  if (!Array.isArray(body.ids) || !body.ids.length) {
    return invalid(res, 'ids', 'Provide either { ids: [...] } or { all: true }')
  }
  // Scoped to the caller, so one person cannot mark another's inbox read.
  await sql`
    UPDATE notifications SET read_at = NOW()
    WHERE recipient_id = ${user.id} AND read_at IS NULL AND id = ANY(${body.ids}::uuid[])
  `
  return res.status(200).json({ ok: true })
}
