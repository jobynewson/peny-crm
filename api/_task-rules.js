// api/_task-rules.js
// Pure behaviour rules for the task board — no DB, no req/res, so every rule in
// the spec can be unit-tested directly (see _task-rules.test.js). The handlers
// in _tasks.js do the I/O and call in here for the decisions.
//
// Not a Vercel function: the `_` prefix keeps it out of the function count.

export const TASK_STATUSES = ['todo', 'doing', 'done']
export const TITLE_MAX = 500

// Fractional indexing, same approach as board_cards.position — a move writes one
// row instead of renumbering the column.
export const POSITION_GAP = 1024
export const MIN_GAP = 0.001

// ── Ordering ─────────────────────────────────────────────────────────────────

// Position for a card dropped between two neighbours. Either side may be null
// (dropped at the top or bottom of a column, or into an empty one).
export function positionBetween(before, after) {
  if (before == null && after == null) return POSITION_GAP
  if (before == null) return after - POSITION_GAP
  if (after == null) return before + POSITION_GAP
  return (before + after) / 2
}

// Doubles run out of precision between two very close neighbours. Once the gap
// closes to MIN_GAP the whole column is rewritten to clean multiples of 1024.
export function needsRebalance(before, after) {
  if (before == null || after == null) return false
  return Math.abs(after - before) < MIN_GAP
}

// New positions for a column being rebalanced, in the order given.
export function rebalancedPositions(count) {
  return Array.from({ length: count }, (_, i) => (i + 1) * POSITION_GAP)
}

// ── Mentions ─────────────────────────────────────────────────────────────────

// The handles a user can be @-mentioned by. The composer's client-side
// autocomplete inserts one of these; typing one by hand resolves the same way.
export function userHandles(user) {
  const handles = new Set()
  if (user.email) handles.add(user.email.split('@')[0].toLowerCase())
  if (user.name) {
    const parts = user.name.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (parts.length) {
      handles.add(parts[0])
      handles.add(parts.join(''))
      handles.add(parts.join('.'))
    }
  }
  return handles
}

// Pull @tokens out of a comment body and resolve them to user IDs.
//
// The leading (^|[^\w.@-]) guard stops an email address in the body
// ("mail joby@wearepeny.com") from registering @wearepeny.com as a mention.
// A token matching two people resolves to neither — notifying the wrong person
// is worse than leaving the text plain, which is what the spec asks for anyway.
export function parseMentions(body, users) {
  if (!body) return []

  const byHandle = new Map()
  for (const user of users) {
    for (const handle of userHandles(user)) {
      if (byHandle.has(handle)) byHandle.set(handle, null)   // ambiguous
      else byHandle.set(handle, user.id)
    }
  }

  const ids = []
  for (const match of body.matchAll(/(^|[^\w.@-])@([\w.-]+)/g)) {
    const token = match[2].replace(/[.\-]+$/, '').toLowerCase()   // trailing punctuation
    const id = byHandle.get(token)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

// ── Notifications ────────────────────────────────────────────────────────────

// Who hears about an event. Notifications are generated from task_events and
// nowhere else — this function is the whole policy, so adding a mutation means
// writing an event, never hand-rolling a notification in a handler.
//
// `task` is the task AFTER the mutation.
export function notificationsFor({ type, actorId, task, mentionedIds = [] }) {
  const out = []
  const add = (recipientId, notifType) => {
    if (!recipientId) return
    if (recipientId === actorId) return                              // never your own action
    if (out.some(n => n.recipient_id === recipientId)) return        // one per (user, event)
    out.push({ recipient_id: recipientId, type: notifType })
  }

  switch (type) {
    case 'assigned':
      add(task.assignee_id, 'assigned')
      break
    case 'acknowledged':
      add(task.created_by, 'acknowledged')
      break
    case 'commented':
      // Mentions win: a mentioned user gets 'mentioned', not 'commented'. The
      // (recipient_id, event_id) unique index enforces the same thing in the DB.
      for (const id of mentionedIds) add(id, 'mentioned')
      add(task.created_by, 'commented')
      add(task.assignee_id, 'commented')
      break
    case 'status_changed':
      if (task.status === 'done') add(task.created_by, 'completed')
      break
    case 'nudged':
      add(task.assignee_id, 'unacknowledged_nudge')
      break
  }
  return out
}

// ── Acknowledgement ──────────────────────────────────────────────────────────

// Derive acknowledged_at / nudged_at for a PATCH. Returns the fields to write.
//
// Two rules interact, and the order matters:
//   - Reassigning clears the acknowledgement: the new person has not seen it.
//   - Moving to doing/done acknowledges implicitly, so nobody has to do both —
//     but only when the ACTOR is the resulting assignee. A creator assigning
//     work and setting it to 'doing' in one go must not acknowledge on the
//     assignee's behalf; they still have not seen it.
// Finally, an unassigned task is never unacknowledged (it sits in the tray
// instead), so its acknowledgement is cleared outright.
export function acknowledgementPatch({ task, patch, actorId }) {
  const nextAssignee = 'assignee_id' in patch ? patch.assignee_id : task.assignee_id
  const nextStatus   = 'status'      in patch ? patch.status      : task.status
  const reassigned   = 'assignee_id' in patch && patch.assignee_id !== task.assignee_id

  let acknowledged_at = reassigned ? null : task.acknowledged_at
  let nudged_at       = reassigned ? null : task.nudged_at

  const movedToActive = nextStatus !== 'todo' && nextStatus !== task.status
  if (!acknowledged_at && movedToActive && nextAssignee && nextAssignee === actorId) {
    acknowledged_at = new Date()
  }

  if (!nextAssignee) {
    acknowledged_at = null
    nudged_at = null
  }
  return { acknowledged_at, nudged_at }
}

// ── Validation ───────────────────────────────────────────────────────────────

// Returns { field, message } for the first problem, or null when input is fine.
// Every caller turns this into a 422 — bad input must never surface as a 500.
export function validateTaskInput(input, { userIds = [], projectIds = null, partial = false } = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k)

  if (!partial || has('title')) {
    const title = input.title
    if (typeof title !== 'string' || !title.trim()) {
      return { field: 'title', message: 'Title is required' }
    }
    if (title.trim().length > TITLE_MAX) {
      return { field: 'title', message: `Title must be ${TITLE_MAX} characters or fewer` }
    }
  }

  if (has('body') && input.body != null && typeof input.body !== 'string') {
    return { field: 'body', message: 'Body must be text' }
  }

  if (has('status') && !TASK_STATUSES.includes(input.status)) {
    return { field: 'status', message: `Status must be one of ${TASK_STATUSES.join(', ')}` }
  }

  if (has('due_at') && input.due_at != null && input.due_at !== '') {
    if (isNaN(new Date(input.due_at).getTime())) {
      return { field: 'due_at', message: 'Due date could not be read as a date' }
    }
  }

  if (has('assignee_id') && input.assignee_id != null && input.assignee_id !== '') {
    if (!userIds.includes(input.assignee_id)) {
      return { field: 'assignee_id', message: 'Assignee is not a member of this workspace' }
    }
  }

  if (has('project_id') && input.project_id != null && input.project_id !== '' && projectIds) {
    if (!projectIds.includes(input.project_id)) {
      return { field: 'project_id', message: 'Project not found' }
    }
  }

  if (has('position') && input.position != null && !Number.isFinite(Number(input.position))) {
    return { field: 'position', message: 'Position must be a number' }
  }

  return null
}

// Normalise an optional timestamp field coming off the wire: '' and null both
// mean "clear it", anything else is parsed. Validation has already run.
export function toTimestamp(value) {
  if (value == null || value === '') return null
  return new Date(value)
}
