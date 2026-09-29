// api/_retainer-rules.js
// Pure behaviour rules for the retainer worklist — no DB, no req/res — so each
// can be unit-tested (_retainer-rules.test.js). The handlers do the I/O and
// call in here for the decisions. Nothing else decides what a status means to
// the client, how a due date reads or what a response does.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import {
  isDateString, lastDayOfMonth, formatDay, formatShortDay, formatMonth,
} from './_dates.js'

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
export const isUuid = v => typeof v === 'string' && UUID_RE.test(v)

export const TITLE_MAX = 300
export const TEXT_MAX = 5000
export const URL_MAX = 2000

// ── Statuses ─────────────────────────────────────────────────────────────────

export const WORKSTREAM_STATUSES = ['active', 'paused', 'complete']
export const WORKSTREAM_LABELS = { active: 'Active', paused: 'Paused', complete: 'Complete' }

export const DELIVERABLE_STATUSES = [
  'planned', 'in_progress', 'waiting_on_client', 'in_review', 'changes_requested', 'approved',
]
export const STATUS_LABELS = {
  planned:           'Planned',
  in_progress:       'In progress',
  waiting_on_client: 'Waiting on client',
  in_review:         'In review',
  changes_requested: 'Changes requested',
  approved:          'Approved',
}

// What the client sees. Mapped on the server: internal status names never
// reach the portal. changes_requested reads as "In progress" — to the client
// it's back with Peny.
const CLIENT_STATUS = {
  planned:           { key: 'planned',          label: 'Planned' },
  in_progress:       { key: 'in_progress',      label: 'In progress' },
  changes_requested: { key: 'in_progress',      label: 'In progress' },
  waiting_on_client: { key: 'waiting_on_you',   label: 'Waiting on you' },
  in_review:         { key: 'ready_for_review', label: 'Ready for review' },
  approved:          { key: 'approved',         label: 'Approved' },
}
export const clientStatus = status => CLIENT_STATUS[status] ?? CLIENT_STATUS.planned

// The status a deliverable should have after a change to `to`, plus the
// waiting bookkeeping: entering waiting_on_client starts the clock; leaving it
// clears the clock, the note (which described what we were waiting for) and
// the client's reply to it.
export function statusPatch({ from, to, now = new Date() }) {
  if (to === from) return { status: to }
  if (to === 'waiting_on_client') return { status: to, waiting_since: now }
  if (from === 'waiting_on_client') {
    return { status: to, waiting_since: null, waiting_note: null, client_reply: null, client_replied_at: null }
  }
  return { status: to }
}

// ── Deliveries and responses ─────────────────────────────────────────────────

// Sending a round puts the deliverable in front of the client.
export const STATUS_AFTER_DELIVERY = 'in_review'

export const RESPONSES = ['approved', 'changes_requested']
export const RESPONSE_LABELS = { pending: 'Awaiting response', approved: 'Approved', changes_requested: 'Changes requested' }

// What a response does to the deliverable. The same rule for the client in the
// portal and for a Peny user recording an approval that came by email.
export const statusAfterResponse = response => (response === 'approved' ? 'approved' : 'changes_requested')

// Taking back a round sent by mistake (only possible while it is the latest
// and unanswered). The deliverable returns to where the previous round left
// it — or to in progress if there was none — but only if it is still in the
// review the mistaken round started; a status someone has set since stands.
export function statusAfterUnsend({ current, previousResponse = null }) {
  if (current !== STATUS_AFTER_DELIVERY) return current
  if (!previousResponse) return 'in_progress'
  return previousResponse === 'pending' ? STATUS_AFTER_DELIVERY : statusAfterResponse(previousResponse)
}

// null if fine, else { field, message }.
export function validateResponse(body) {
  if (!body || !RESPONSES.includes(body.response)) {
    return { field: 'response', message: 'Choose approve or request changes' }
  }
  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
  if (body.response === 'changes_requested' && !comment) {
    return { field: 'comment', message: 'Say what needs to change' }
  }
  if (comment.length > TEXT_MAX) return { field: 'comment', message: `Keep it under ${TEXT_MAX} characters` }
  return null
}

// { url } or { error: { field, message } }. Only http(s): the URL becomes a
// link in the client portal, so javascript: and friends must never get in.
export function normaliseDeliveryUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { error: { field: 'url', message: 'Paste the link to send' } }
  if (text.length > URL_MAX) return { error: { field: 'url', message: 'That link is too long' } }
  let url
  try { url = new URL(text) } catch { return { error: { field: 'url', message: "That doesn't look like a link" } } }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: { field: 'url', message: 'Only http and https links can be sent' } }
  }
  return { url: url.href }
}

export function isFrameIoUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'f.io' || host === 'frame.io' || host.endsWith('.frame.io')
  } catch { return false }
}

// ── Due dates ────────────────────────────────────────────────────────────────
// due_date is always the DEADLINE, so sorting and "overdue" work the same for
// every kind. due_label keeps the words someone used, and wins on display.

export const DUE_KINDS = ['exact', 'month', 'window', 'recurring']
export const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly']
export const CADENCE_LABELS = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Quarterly' }

// Turns form input into the stored due fields, or { error: { field, message } }.
//   exact     — due_date, or none yet ("No date")
//   month     — due_month 'YYYY-MM' (or a due_date in that month) → its last day
//   window    — due_date is the window's last day; due_label says it in words
//   recurring — cadence; due_date is the next one, if known
export function normaliseDue(input = {}) {
  const kind = input.due_kind ?? 'exact'
  if (!DUE_KINDS.includes(kind)) return { error: { field: 'due_kind', message: 'Unknown kind of due date' } }

  const label = typeof input.due_label === 'string' && input.due_label.trim() ? input.due_label.trim() : null
  if (label && label.length > TITLE_MAX) return { error: { field: 'due_label', message: 'That description is too long' } }
  const date = input.due_date || null
  if (date && !isDateString(date)) return { error: { field: 'due_date', message: 'That date is not valid' } }

  if (kind === 'exact') return { due_kind: kind, due_date: date, due_label: label, cadence: null }

  if (kind === 'month') {
    const month = input.due_month || (date ? date.slice(0, 7) : null)
    if (!month || !/^\d{4}-\d{2}$/.test(month) || !isDateString(`${month}-01`)) {
      return { error: { field: 'due_month', message: 'Choose the month it is due' } }
    }
    return { due_kind: kind, due_date: lastDayOfMonth(month), due_label: label, cadence: null }
  }

  if (kind === 'window') {
    if (!date) return { error: { field: 'due_date', message: 'Choose the last day of the window' } }
    return { due_kind: kind, due_date: date, due_label: label, cadence: null }
  }

  // recurring
  if (!CADENCES.includes(input.cadence)) return { error: { field: 'cadence', message: 'Choose how often it repeats' } }
  return { due_kind: kind, due_date: date, due_label: label, cadence: input.cadence }
}

// How a deliverable's due date reads, in Slate and in the portal alike.
export function dueDisplay(d, today) {
  if (d.due_label) return d.due_label
  const date = d.due_date
  switch (d.due_kind) {
    case 'month':
      return date ? formatMonth(date, today) : 'No date'
    case 'window':
      return date ? `By ${formatShortDay(date, today)}` : 'No date'
    case 'recurring': {
      const every = CADENCE_LABELS[d.cadence] || 'Repeats'
      return date ? `${every} · next ${formatShortDay(date, today)}` : every
    }
    default:
      return date ? formatDay(date, today) : 'No date'
  }
}

export const isOverdue = (d, today) => d.status !== 'approved' && !!d.due_date && d.due_date < today

// ── Input validation ─────────────────────────────────────────────────────────
// null if fine, else { field, message }. `partial` for PATCH: only the fields
// present are checked.

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const optionalText = (body, key, max) =>
  has(body, key) && body[key] != null && (typeof body[key] !== 'string' || body[key].length > max)

export function validateWorkstreamInput(body, { partial = false } = {}) {
  if (!partial || has(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim()) return { field: 'title', message: 'Give the workstream a title' }
    if (body.title.trim().length > TITLE_MAX) return { field: 'title', message: 'That title is too long' }
  }
  if (optionalText(body, 'brief', TEXT_MAX)) return { field: 'brief', message: 'That brief is too long' }
  if (has(body, 'status') && !WORKSTREAM_STATUSES.includes(body.status)) return { field: 'status', message: 'Unknown status' }
  if (has(body, 'project_id') && body.project_id != null && !isUuid(body.project_id)) return { field: 'project_id', message: 'That project is not valid' }
  if (has(body, 'sort_order') && !Number.isInteger(body.sort_order)) return { field: 'sort_order', message: 'Order must be a whole number' }
  return null
}

export function validateDeliverableInput(body, { partial = false, userIds = [] } = {}) {
  if (!partial || has(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim()) return { field: 'title', message: 'Give the deliverable a title' }
    if (body.title.trim().length > TITLE_MAX) return { field: 'title', message: 'That title is too long' }
  }
  if (optionalText(body, 'format', TITLE_MAX)) return { field: 'format', message: 'That format is too long' }
  if (has(body, 'owner_id') && body.owner_id != null && !userIds.includes(body.owner_id)) {
    return { field: 'owner_id', message: 'Choose someone on the team' }
  }
  if (has(body, 'status') && !DELIVERABLE_STATUSES.includes(body.status)) return { field: 'status', message: 'Unknown status' }
  if (has(body, 'client_visible') && typeof body.client_visible !== 'boolean') return { field: 'client_visible', message: 'Visible must be yes or no' }
  if (optionalText(body, 'internal_notes', TEXT_MAX)) return { field: 'internal_notes', message: 'Those notes are too long' }
  if (optionalText(body, 'waiting_note', TEXT_MAX)) return { field: 'waiting_note', message: 'That note is too long' }
  if (has(body, 'sort_order') && !Number.isInteger(body.sort_order)) return { field: 'sort_order', message: 'Order must be a whole number' }
  return null
}

// Whether a PATCH body touches the due date at all (and so must be re-normalised).
export const DUE_FIELDS = ['due_kind', 'due_date', 'due_month', 'due_label', 'cadence']
export const touchesDue = body => DUE_FIELDS.some(k => has(body, k))


// ── Client requests ──────────────────────────────────────────────────────────

export const REQUEST_STATUSES = ['new', 'accepted', 'declined']
// What the client sees: Submitted / Accepted / Declined. Mapped here, so the
// portal never shows the internal 'new'.
export const REQUEST_LABELS = { new: 'Submitted', accepted: 'Accepted', declined: 'Declined' }
export const requestLabel = status => REQUEST_LABELS[status] ?? REQUEST_LABELS.new

// How many unanswered requests one company may have at a time. A stuck script
// or a keen client can't flood the inbox: past this, they wait for triage.
export const MAX_OPEN_REQUESTS = 10

export const NOTE_MAX = 1000

// null if fine, else { field, message }. wanted_by is optional.
export function validateRequestInput(body) {
  if (!body || typeof body !== 'object') return { field: 'body', message: 'Request body is not valid JSON' }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return { field: 'title', message: 'Give the request a title' }
  if (title.length > TITLE_MAX) return { field: 'title', message: 'That title is too long' }
  if (body.detail != null && (typeof body.detail !== 'string' || body.detail.length > TEXT_MAX)) {
    return { field: 'detail', message: 'That detail is too long' }
  }
  if (body.wanted_by != null && body.wanted_by !== '' && !isDateString(body.wanted_by)) {
    return { field: 'wanted_by', message: 'That date is not valid' }
  }
  return null
}

// A decline goes back to the client, so it needs words. null if fine.
export function validateDecline(body) {
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  if (!note) return { field: 'note', message: 'Say why, in a line or two — the client will see this' }
  if (note.length > NOTE_MAX) return { field: 'note', message: `Keep it under ${NOTE_MAX} characters` }
  return null
}

// A client's reply on a "waiting on you" item: short, not a thread. null if fine.
export const REPLY_MAX = 1000
export function validateReply(body) {
  const text = typeof body?.reply === 'string' ? body.reply.trim() : ''
  if (!text) return { field: 'reply', message: 'Write your reply' }
  if (text.length > REPLY_MAX) return { field: 'reply', message: `Keep it under ${REPLY_MAX} characters` }
  return null
}

// ── The task board ───────────────────────────────────────────────────────────
// Deliverables sit on the task board as cards read straight from the
// deliverables table: one record, shown in both places. The board has three
// columns; this is the whole mapping, both ways. The server decides it and
// the browser holds no copy.
//
//   planned                                   → To do
//   in_progress                               → Doing
//   changes_requested                         → Doing (chip: changes requested)
//   waiting_on_client, in_review              → Doing, muted (with the client)
//   approved                                  → Done
//
// Dragging only ever moves planned <-> in_progress. The rest are the client's
// moves, or need a note or a link, so they happen on the Retainers page.

export const BOARD_COLUMNS = ['todo', 'doing', 'done']

const BOARD_COLUMN = {
  planned: 'todo', in_progress: 'doing', changes_requested: 'doing',
  waiting_on_client: 'doing', in_review: 'doing', approved: 'done',
}
export const boardColumn = status => BOARD_COLUMN[status] ?? 'todo'

// A card that is with the client, so the owner isn't the one holding it.
export const isWithClient = status => status === 'waiting_on_client' || status === 'in_review'

// What a board card says about its deliverable beyond the title, or null.
export function boardChip(d, now = new Date()) {
  if (d.status === 'changes_requested') return { key: 'changes_requested', label: 'Changes requested' }
  if (d.status === 'waiting_on_client') {
    const days = d.waiting_since ? Math.max(0, Math.floor((now - new Date(d.waiting_since)) / 86400000)) : null
    return { key: 'waiting_on_client', label: days == null ? 'Waiting on client' : `Waiting on client · ${days}d` }
  }
  if (d.status === 'in_review') {
    return { key: 'in_review', label: d.round ? `With client · round ${d.round}` : 'With client' }
  }
  return null
}

// The board's refusals, worded as the board doing its job: what is true, and
// where to go instead. Short enough for a phone.
export const DRAG_REFUSALS = {
  approve:   'Only the client can approve this — record their answer on the Retainers page.',
  with_client: 'This is with the client, so it stays in Doing until they answer — the Retainers page has the detail.',
  changes:   'The client asked for changes, so it stays in Doing until you send the next round.',
  approved:  'This is approved — reopen it from the Retainers page if it needs more work.',
}

// A card dropped in `column`. → { status } to write (status may equal the
// current one: nothing to do), or { refused: <one of DRAG_REFUSALS> }.
export function statusAfterBoardDrag({ from, column }) {
  if (!BOARD_COLUMNS.includes(column)) return { refused: DRAG_REFUSALS.with_client, code: 'with_client' }
  if (boardColumn(from) === column) return { status: from }
  const refuse = code => ({ refused: DRAG_REFUSALS[code], code })

  if (from === 'approved') return refuse('approved')
  if (column === 'done') return refuse('approve')
  if (from === 'planned' && column === 'doing') return { status: 'in_progress' }
  if (from === 'in_progress' && column === 'todo') return { status: 'planned' }
  // Everything else is a card in Doing being dragged to To do.
  if (from === 'changes_requested') return refuse('changes')
  return refuse('with_client')
}
