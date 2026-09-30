// api/_requests.js
// Client requests, on the task board. A new request is a card in the unassigned
// tray (api/_board.js reads loadOpenRequests below); there is no separate
// inbox. Routes behind /api/retainers (merged into _retainers.js's table), for
// Slate staff:
//   GET  retainers/request-count                 { new, feedback }: the Tasks tab's bubble
//   POST retainers/requests/:id/accept   { due_date?, project_id?, workstream_id |
//                                          new_workstream_title?, owner_id?, title? }
//   POST retainers/requests/:id/decline  { note }  — the client sees the note
//
// Accepting asks for nothing the board can't supply: the owner is whoever
// accepts, the date is optional, the project is the request's own (or the
// company's only one, or its one retainer — asked for only when that is
// ambiguous) and the workstream is the project's "Requests" one, made on first
// use. Accepting creates the deliverable — owned, shown to the client — and
// from then on the deliverable is the only record of the work. A decided
// request is history: the client sees it in the portal.
//
// Both decisions are one statement guarded on status = 'new', so two people
// answering at once can't both win.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { UUID, fail, invalid, readBody, workspaceId } from './_api.js'
import { formatDay } from './_dates.js'
import { requestLabel, requestSourceLabel, validateAccept, validateDecline, worklistLink } from './_retainer-rules.js'
import { sendOwnerAssigned } from './_alerts.js'

const ID = `(?<id>${UUID})`
export const REQUEST_ROUTES = [
  { method: 'GET',  pattern: /^retainers\/request-count$/,                        handler: requestCount },
  { method: 'POST', pattern: new RegExp(`^retainers/requests/${ID}/accept$`),      handler: acceptRequest,  access: 'editor' },
  { method: 'POST', pattern: new RegExp(`^retainers/requests/${ID}/decline$`),     handler: declineRequest, access: 'editor' },
]

// ── GET retainers/request-count ──────────────────────────────────────────────
// { new, feedback } — what the Tasks tab's bubble counts, polled: new client
// requests waiting in the tray, and feedback waiting to be acted on (changes
// requested, or comments are in) on deliverables that are yours or nobody's. It
// clears itself when the next round goes out or the deliverable moves on.
async function requestCount(req, res, { sql, user }) {
  const ws = await workspaceId(sql)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM requests WHERE user_id = ${ws} AND status = 'new'`
  const [{ f }] = await sql`
    SELECT count(*)::int AS f
    FROM deliverables d JOIN workstreams w ON w.id = d.workstream_id
    WHERE w.user_id = ${ws} AND w.status = 'active' AND d.status IN ('changes_requested', 'comments_in')
      AND (d.owner_id = ${user.id} OR d.owner_id IS NULL)`
  return res.status(200).json({ new: n, feedback: f })
}

// The new requests, for the task board's tray: the one that has waited longest
// first. Everything a card and its popover need, nothing more.
export async function loadOpenRequests(sql, ws, today) {
  const rows = await sql`
    SELECT r.id, r.company_id, r.project_id, p.name AS project, COALESCE(c.name, p.name) AS company, r.submitted_via,
           r.title, r.detail, r.wanted_by::text AS wanted_by, r.submitted_by_name, r.created_at
    FROM requests r
    LEFT JOIN companies c ON c.id = r.company_id
    LEFT JOIN projects p ON p.id = r.project_id
    WHERE r.user_id = ${ws} AND r.status = 'new'
    ORDER BY r.created_at
    LIMIT 200`
  return rows.map(r => ({
    id: r.id,
    kind: 'request',
    in_tray: true,
    title: r.title,
    detail: r.detail,
    company: r.company,
    company_id: r.company_id ?? null,
    project: r.project ?? null,
    project_id: r.project_id ?? null,
    source: r.submitted_via ?? 'login',
    source_label: requestSourceLabel(r.submitted_via),
    sent_by: r.submitted_by_name || null,
    sent_at: r.created_at,
    wanted_by: r.wanted_by,
    wanted_by_display: r.wanted_by ? formatDay(r.wanted_by, today) : null,
  }))
}

// ── POST retainers/requests/:id/accept ───────────────────────────────────────
// Makes the deliverable and marks the request accepted, in one statement: owned
// (by the caller unless told otherwise), planned, shown to the client — so the
// client's request visibly becomes part of their worklist. The client's own
// words go in the internal notes. Nothing is required of the body (see the top).
// 409 needs_project (with `projects`) when the company has several and none is
// clearly the one; 422 project_id when it has none to put the work in.
export const REQUESTS_WORKSTREAM = 'Requests'

async function acceptRequest(req, res, { sql, user, params }) {
  const body = readBody(req) ?? {}
  const userIds = (await sql`SELECT id FROM app_users`).map(u => u.id)
  const bad = validateAccept(body, { userIds })
  if (bad) return invalid(res, bad.field, bad.message)

  const ws = await workspaceId(sql)
  const [request] = await sql`
    SELECT r.id, r.company_id, r.project_id, r.title, r.detail, r.wanted_by::text AS wanted_by, r.status, r.submitted_by_name
    FROM requests r WHERE r.id = ${params.id} AND r.user_id = ${ws}`
  if (!request) return fail(res, 404, 'not_found', 'Request not found')
  if (request.status !== 'new') return fail(res, 409, 'already_decided', `This request was already ${requestLabel(request.status).toLowerCase()}`)

  // A workstream named in the request decides the project (an older,
  // company-level workstream has none). It must be this client's.
  let projectId = request.project_id
  let workstreamId = null
  if (body.workstream_id) {
    const [w] = await sql`
      SELECT w.id, w.project_id, wc.company_id
      FROM workstreams w JOIN workstream_company wc ON wc.workstream_id = w.id
      WHERE w.id = ${body.workstream_id} AND w.user_id = ${ws} AND w.status = 'active'`
    const theirs = w && (request.project_id ? w.project_id === request.project_id : (!!request.company_id && w.company_id === request.company_id))
    if (!theirs) return invalid(res, 'workstream_id', 'Choose one of this client’s active workstreams')
    if (body.project_id && body.project_id !== w.project_id) return invalid(res, 'project_id', 'That workstream is in a different project')
    workstreamId = w.id
    projectId = w.project_id
  } else {
    // Which project the work goes in: the one chosen (it must be the request's
    // own, or one of its company's), else the request's own, else the company's
    // only project, else its one retainer. Anything murkier is a question.
    if (body.project_id) {
      if (projectId && body.project_id !== projectId) return invalid(res, 'project_id', 'This request is for a different project')
      const [p] = await sql`
        SELECT id FROM projects WHERE id = ${body.project_id} AND user_id = ${ws}
          AND (${request.project_id}::uuid IS NOT NULL OR company_id = ${request.company_id}::uuid)`
      if (!p) return invalid(res, 'project_id', 'Choose one of this client’s projects')
      projectId = p.id
    }
    if (!projectId) {
      const mine = request.company_id
        ? await sql`SELECT id, name, is_retainer FROM projects WHERE user_id = ${ws} AND company_id = ${request.company_id} ORDER BY is_retainer DESC, lower(name)`
        : []
      const retainers = mine.filter(p => p.is_retainer)
      if (mine.length === 1) projectId = mine[0].id
      else if (retainers.length === 1) projectId = retainers[0].id
      else if (!mine.length) return invalid(res, 'project_id', 'This client has no project to put it in yet — make one first')
      else return fail(res, 409, 'needs_project', 'Which project is this for?', { projects: mine.map(p => ({ id: p.id, name: p.name })) })
    }
  }

  // Which workstream: the one named, a new one, or the project's "Requests".
  let newTitle = typeof body.new_workstream_title === 'string' && body.new_workstream_title.trim() ? body.new_workstream_title.trim() : null
  if (!workstreamId && !newTitle) {
    const [w] = await sql`SELECT id FROM workstreams WHERE project_id = ${projectId} AND user_id = ${ws} AND status = 'active' AND lower(title) = lower(${REQUESTS_WORKSTREAM}) ORDER BY created_at LIMIT 1`
    if (w) workstreamId = w.id
    else newTitle = REQUESTS_WORKSTREAM
  }
  const creating = !workstreamId

  const ownerId = body.owner_id || user.id
  const dueDate = body.due_date || null
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : request.title
  const notes = [
    `From a client request${request.submitted_by_name ? ` by ${request.submitted_by_name}` : ''}.`,
    request.wanted_by && `They asked for it by ${request.wanted_by}.`,
    request.detail && `\n${request.detail}`,
  ].filter(Boolean).join(' ')

  const [done] = await sql`
    WITH req AS (
      SELECT id, company_id FROM requests
      WHERE id = ${request.id} AND user_id = ${ws} AND status = 'new'
      FOR UPDATE
    ), made_ws AS (
      INSERT INTO workstreams (user_id, project_id, title, sort_order)
      SELECT ${ws}, ${projectId}::uuid, ${newTitle},
             COALESCE((SELECT max(sort_order) + 1 FROM workstreams WHERE project_id = ${projectId}::uuid), 0)
      FROM req WHERE ${creating}::boolean
      RETURNING id
    ), chosen AS (
      SELECT id FROM made_ws
      UNION ALL
      SELECT w.id FROM workstreams w, req
      WHERE NOT ${creating}::boolean AND w.id = ${workstreamId}::uuid
        AND w.user_id = ${ws} AND w.status = 'active'
    ), made_d AS (
      INSERT INTO deliverables (workstream_id, title, owner_id, due_kind, due_date, status, client_visible, internal_notes, sort_order)
      SELECT chosen.id, ${title}, ${ownerId}::uuid, 'exact', ${dueDate}::date, 'planned', true, ${notes},
             COALESCE((SELECT max(sort_order) + 1 FROM deliverables WHERE workstream_id = chosen.id), 0)
      FROM chosen
      RETURNING id, workstream_id
    ), decided AS (
      UPDATE requests SET status = 'accepted', deliverable_id = made_d.id,
             decided_by = ${user.id}, decided_at = NOW(), updated_at = NOW()
      FROM made_d, req WHERE requests.id = req.id
      RETURNING requests.id
    )
    SELECT made_d.id AS deliverable_id, made_d.workstream_id, decided.id AS request_id FROM made_d, decided`
  if (!done) return fail(res, 409, 'conflict', 'Someone answered this request while you were looking — refresh and try again')

  try {
    await sendOwnerAssigned(sql, { deliverableId: done.deliverable_id, assignedBy: user })
  } catch (err) {
    console.error('[requests] owner email failed:', err?.message)   // accepted either way
  }
  return res.status(200).json({
    ok: true, request_id: done.request_id, deliverable_id: done.deliverable_id,
    workstream_id: done.workstream_id, company_id: request.company_id, project_id: projectId,
    link: worklistLink({ project_id: projectId, company_id: request.company_id, id: done.deliverable_id }),
  })
}

// ── POST retainers/requests/:id/decline ──────────────────────────────────────
// { note } — a line or two the client will read in the portal.
async function declineRequest(req, res, { sql, user, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const bad = validateDecline(body)
  if (bad) return invalid(res, bad.field, bad.message)

  const ws = await workspaceId(sql)
  const [row] = await sql`
    UPDATE requests SET status = 'declined', decline_note = ${body.note.trim()},
           decided_by = ${user.id}, decided_at = NOW(), updated_at = NOW()
    WHERE id = ${params.id} AND user_id = ${ws} AND status = 'new'
    RETURNING id`
  if (row) return res.status(200).json({ ok: true, request_id: row.id })

  const [exists] = await sql`SELECT status FROM requests WHERE id = ${params.id} AND user_id = ${ws}`
  if (!exists) return fail(res, 404, 'not_found', 'Request not found')
  return fail(res, 409, 'already_decided', `This request was already ${requestLabel(exists.status).toLowerCase()}`)
}
