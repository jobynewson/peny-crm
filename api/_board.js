// api/_board.js
// The task board shows deliverables as cards read straight from the
// deliverables table — one record, visible on the board and on the project's Worklist tab
// page. Routes behind /api/retainers (merged into _retainers.js's table), for
// Slate staff:
//   GET  retainers/board                               the cards
//   POST retainers/deliverables/:id/board-move  { column }
//
// The mapping between the board's three columns and a deliverable's six
// statuses, which cards appear, and every refusal live in _retainer-rules.js;
// this file only reads and writes. A drag moves a card between To do and Doing
// (planned <-> in progress) and nothing else: approval is the client's, and
// waiting or review need a note or a link. Anything else is refused with a
// sentence that says what to do instead, and nothing is written. Dragging an
// unowned card out of the tray also claims it, but only if the move is allowed.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { UUID, fail, invalid, readBody, workspaceId } from './_api.js'
import { londonDate } from './_dates.js'
import {
  BOARD_COLUMNS, BOARD_DONE_DAYS, BOARD_HORIZON_DAYS, boardShows, parseWindowDays, boardCard, compareBoardCards, statusAfterBoardDrag, statusPatch,
} from './_retainer-rules.js'

export const BOARD_ROUTES = [
  { method: 'GET',  pattern: /^retainers\/board$/,                                                       handler: getBoard },
  { method: 'POST', pattern: new RegExp(`^retainers/deliverables/(?<id>${UUID})/board-move$`),            handler: moveCard, access: 'editor' },
]

// Rows for the deliverables that might have a card: open ones (boardShows
// decides about paused workstreams), and approved ones from the last BOARD_DONE_DAYS days.
async function loadRows(sql, ws, { id = null } = {}) {
  return sql`
    SELECT d.id, d.title, d.owner_id, d.status, d.due_kind, d.due_date::text AS due_date, d.due_label, d.cadence,
           d.waiting_since, d.delivered_at, d.updated_at,
           w.title AS workstream, w.status AS workstream_status, w.project_id, wc.company_id, p.name AS project, COALESCE(c.name, p.name) AS company,
           (SELECT max(dv.round) FROM deliveries dv WHERE dv.deliverable_id = d.id) AS round
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    JOIN workstream_company wc ON wc.workstream_id = w.id
    LEFT JOIN companies c ON c.id = wc.company_id
    LEFT JOIN projects p ON p.id = w.project_id
    WHERE w.user_id = ${ws}
      AND (${id}::uuid IS NULL OR d.id = ${id}::uuid)
      AND (d.status <> 'approved' OR d.updated_at >= now() - make_interval(days => ${BOARD_DONE_DAYS}))`
}

// ── GET retainers/board ──────────────────────────────────────────────────────
async function getBoard(req, res, { sql }) {
  const ws = await workspaceId(sql)
  const today = londonDate()
  const now = new Date()
  const days = parseWindowDays(req.query?.days, BOARD_HORIZON_DAYS)
  const cards = (await loadRows(sql, ws))
    .filter(d => boardShows(d, today, days))
    .map(d => boardCard(d, today, now))
    .sort(compareBoardCards)
  return res.status(200).json({ today, days, cards })
}

// ── POST retainers/deliverables/:id/board-move ───────────────────────────────
// { column: 'todo' | 'doing' | 'done' } → { card } (the card as it now is), or
// 409 board_refused with the sentence to show. Moving something already in the
// column it was dropped in is fine and changes nothing (except claiming it, if
// it had no owner).
async function moveCard(req, res, { sql, user, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  if (!BOARD_COLUMNS.includes(body.column)) return invalid(res, 'column', 'Drop it in To do, Doing or Done')

  const ws = await workspaceId(sql)
  const [d] = await loadRows(sql, ws, { id: params.id })
  if (!d || !boardShows(d, londonDate(), BOARD_HORIZON_DAYS)) return fail(res, 404, 'not_found', 'That deliverable is not on the board any more')

  const move = statusAfterBoardDrag({ from: d.status, column: body.column })
  if (move.refused) return fail(res, 409, 'board_refused', move.refused, { reason: move.code })

  const claiming = !d.owner_id
  if (move.status !== d.status || claiming) {
    const patch = statusPatch({ from: d.status, to: move.status })
    const [row] = await sql`
      UPDATE deliverables SET
        status     = ${patch.status}::deliverable_status,
        owner_id   = CASE WHEN ${claiming} THEN ${user.id}::uuid ELSE owner_id END,
        updated_at = NOW()
      WHERE id = ${d.id} AND status = ${d.status}::deliverable_status
        AND (${!claiming} OR owner_id IS NULL)
        AND workstream_id IN (SELECT id FROM workstreams WHERE user_id = ${ws})
      RETURNING id`
    if (!row) return fail(res, 409, 'conflict', 'Someone changed this while you were moving it — the board has been refreshed')
  }

  const [fresh] = await loadRows(sql, ws, { id: d.id })
  return res.status(200).json({ card: boardCard(fresh, londonDate()) })
}
