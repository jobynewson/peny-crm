// api/_requests.js
// Triage: where a client's request gets its owner and its date. Routes behind
// /api/retainers (merged into _retainers.js's table), for Slate staff:
//   GET  retainers/requests?status=new|accepted|declined   the inbox
//   GET  retainers/requests/:id                            one request, and what
//                                                          it needs to be accepted
//   POST retainers/requests/:id/accept   { workstream_id | new_workstream_title,
//                                          owner_id, due_date, title? }
//   POST retainers/requests/:id/decline  { note }  — the client sees the note
//
// Deliberately not a second to-do list. Triage decides; it holds no work.
// Accepting creates the deliverable — owned, dated and shown to the client —
// and from then on the deliverable is the only record of the work: it is what
// What's due lists and the task board shows. A decided request is history.
//
// Both decisions are one statement guarded on status = 'new', so two people
// answering at once can't both win.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { UUID, fail, invalid, readBody, workspaceId } from './_api.js'
import { londonDate, formatDay } from './_dates.js'
import { REQUEST_STATUSES, requestLabel, requestSourceLabel, validateAccept, validateDecline } from './_retainer-rules.js'
import { sendOwnerAssigned } from './_alerts.js'

const ID = `(?<id>${UUID})`
export const REQUEST_ROUTES = [
  { method: 'GET',  pattern: /^retainers\/requests$/,                            handler: listRequests },
  { method: 'GET',  pattern: new RegExp(`^retainers/requests/${ID}$`),            handler: getRequest },
  { method: 'POST', pattern: new RegExp(`^retainers/requests/${ID}/accept$`),      handler: acceptRequest,  access: 'editor' },
  { method: 'POST', pattern: new RegExp(`^retainers/requests/${ID}/decline$`),     handler: declineRequest, access: 'editor' },
]

const shape = (r, today) => ({
  id: r.id,
  company_id: r.company_id ?? null,
  company: r.company,
  project_id: r.project_id ?? null,
  project: r.project ?? null,
  source: r.submitted_via ?? 'login',
  source_label: requestSourceLabel(r.submitted_via),
  title: r.title,
  detail: r.detail,
  wanted_by: r.wanted_by,
  wanted_by_display: r.wanted_by ? formatDay(r.wanted_by, today) : null,
  status: r.status,
  status_label: requestLabel(r.status),
  sent_by: r.submitted_by_name || null,
  sent_at: r.created_at,
  decided_at: r.decided_at,
  decided_by: r.decided_by_name || null,
  decline_note: r.decline_note,
  deliverable_id: r.deliverable_id,
})

// ── GET retainers/requests ───────────────────────────────────────────────────
// New ones oldest first (the one that has waited longest is on top); decided
// ones newest first. `counts` is what the inbox's tabs show.
async function listRequests(req, res, { sql }) {
  const ws = await workspaceId(sql)
  const status = req.query?.status ?? 'new'
  if (!REQUEST_STATUSES.includes(status)) return invalid(res, 'status', 'Unknown status')
  const today = londonDate()

  const rows = status === 'new'
    ? await sql`
        SELECT r.id, r.company_id, r.project_id, p.name AS project, COALESCE(c.name, p.name) AS company, r.submitted_via,
               r.title, r.detail, r.wanted_by::text AS wanted_by, r.status,
               r.submitted_by_name, r.created_at, r.decided_at, r.decline_note, r.deliverable_id,
               COALESCE(u.name, u.email) AS decided_by_name
        FROM requests r
        LEFT JOIN companies c ON c.id = r.company_id
        LEFT JOIN projects p ON p.id = r.project_id
        LEFT JOIN app_users u ON u.id = r.decided_by
        WHERE r.user_id = ${ws} AND r.status = 'new'
        ORDER BY r.created_at
        LIMIT 200`
    : await sql`
        SELECT r.id, r.company_id, r.project_id, p.name AS project, COALESCE(c.name, p.name) AS company, r.submitted_via,
               r.title, r.detail, r.wanted_by::text AS wanted_by, r.status,
               r.submitted_by_name, r.created_at, r.decided_at, r.decline_note, r.deliverable_id,
               COALESCE(u.name, u.email) AS decided_by_name
        FROM requests r
        LEFT JOIN companies c ON c.id = r.company_id
        LEFT JOIN projects p ON p.id = r.project_id
        LEFT JOIN app_users u ON u.id = r.decided_by
        WHERE r.user_id = ${ws} AND r.status = ${status}::request_status
        ORDER BY r.decided_at DESC NULLS LAST
        LIMIT 100`
  const counts = await sql`
    SELECT count(*) FILTER (WHERE status = 'new')::int AS new,
           count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
           count(*) FILTER (WHERE status = 'declined')::int AS declined
    FROM requests WHERE user_id = ${ws}`
  return res.status(200).json({ today, status, requests: rows.map(r => shape(r, today)), counts: counts[0] })
}

// ── GET retainers/requests/:id ───────────────────────────────────────────────
// The request, plus what accepting it needs: the projects it could go in, each
// with its active workstreams, and the company's lead. A request sent from a
// project link belongs to that project alone; a signed-in client's belongs to
// the company, so it can go in any of the company's projects. `workstreams`
// (the company's, flat) is what the screen used before worklists were per
// project.
async function getRequest(req, res, { sql, params }) {
  const ws = await workspaceId(sql)
  const today = londonDate()
  const [row] = await sql`
    SELECT r.id, r.company_id, r.project_id, p.name AS project, COALESCE(c.name, p.name) AS company, r.submitted_via,
           r.title, r.detail, r.wanted_by::text AS wanted_by, r.status,
           r.submitted_by_name, r.created_at, r.decided_at, r.decline_note, r.deliverable_id,
           COALESCE(u.name, u.email) AS decided_by_name, c.lead_id
    FROM requests r
    LEFT JOIN companies c ON c.id = r.company_id
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN app_users u ON u.id = r.decided_by
    WHERE r.id = ${params.id} AND r.user_id = ${ws}`
  if (!row) return fail(res, 404, 'not_found', 'Request not found')
  const projects = await sql`
    SELECT p.id, p.name, p.is_retainer,
           COALESCE((SELECT json_agg(json_build_object('id', w.id, 'title', w.title) ORDER BY w.sort_order, w.created_at)
                     FROM workstreams w WHERE w.project_id = p.id AND w.status = 'active'), '[]'::json) AS workstreams
    FROM projects p
    WHERE p.user_id = ${ws}
      AND (p.id = ${row.project_id}::uuid OR (${row.project_id}::uuid IS NULL AND p.company_id = ${row.company_id}::uuid))
    ORDER BY p.is_retainer DESC, lower(p.name)`
  const workstreams = row.company_id ? await sql`
    SELECT w.id, w.title FROM workstreams w
    WHERE w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${row.company_id}) AND w.user_id = ${ws} AND w.status = 'active'
    ORDER BY w.sort_order, w.created_at` : []
  return res.status(200).json({ today, request: { ...shape(row, today), lead_id: row.lead_id ?? null }, projects, workstreams })
}

// ── POST retainers/requests/:id/accept ───────────────────────────────────────
// Creates the deliverable in one step with marking the request accepted: in
// the chosen workstream (or a new one, in the request's company), owned, dated,
// planned and shown to the client — so the client's request visibly becomes
// part of their worklist. The client's own words go in the internal notes.
async function acceptRequest(req, res, { sql, user, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const userIds = (await sql`SELECT id FROM app_users`).map(u => u.id)
  const bad = validateAccept(body, { userIds })
  if (bad) return invalid(res, bad.field, bad.message)

  const ws = await workspaceId(sql)
  const [request] = await sql`
    SELECT r.id, r.company_id, r.project_id, r.title, r.detail, r.wanted_by::text AS wanted_by, r.status, r.submitted_by_name
    FROM requests r WHERE r.id = ${params.id} AND r.user_id = ${ws}`
  if (!request) return fail(res, 404, 'not_found', 'Request not found')
  if (request.status !== 'new') return fail(res, 409, 'already_decided', `This request was already ${requestLabel(request.status).toLowerCase()}`)

  // Which project the work goes in. A link request is already for one; a
  // signed-in client's can go in any of the company's. With none chosen the
  // work goes in a company-level workstream (how worklists used to be made).
  let projectId = request.project_id
  if (body.project_id) {
    if (projectId && body.project_id !== projectId) return invalid(res, 'project_id', 'This request is for a different project')
    const [p] = await sql`
      SELECT id FROM projects WHERE id = ${body.project_id} AND user_id = ${ws}
        AND (${request.project_id}::uuid IS NOT NULL OR company_id = ${request.company_id}::uuid)`
    if (!p) return invalid(res, 'project_id', 'Choose one of this client’s projects')
    projectId = p.id
  }

  const creating = typeof body.new_workstream_title === 'string' && body.new_workstream_title.trim() !== ''
  if (!creating) {
    const [w] = await sql`
      SELECT id FROM workstreams
      WHERE id = ${body.workstream_id} AND user_id = ${ws} AND status = 'active'
        AND (project_id = ${projectId}::uuid
             OR (${projectId}::uuid IS NULL AND id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${request.company_id}::uuid)))`
    if (!w) return invalid(res, 'workstream_id', 'Choose one of this client’s active workstreams')
  }

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
      INSERT INTO workstreams (user_id, company_id, project_id, title, sort_order)
      SELECT ${ws}, CASE WHEN ${projectId}::uuid IS NULL THEN req.company_id END, ${projectId}::uuid,
             ${creating ? body.new_workstream_title.trim() : null},
             COALESCE((SELECT max(sort_order) + 1 FROM workstreams
                        WHERE (${projectId}::uuid IS NOT NULL AND project_id = ${projectId}::uuid)
                           OR (${projectId}::uuid IS NULL AND company_id = req.company_id)), 0)
      FROM req WHERE ${creating}::boolean
      RETURNING id
    ), chosen AS (
      SELECT id FROM made_ws
      UNION ALL
      SELECT w.id FROM workstreams w, req
      WHERE NOT ${creating}::boolean AND w.id = ${creating ? null : body.workstream_id}::uuid
        AND w.user_id = ${ws} AND w.status = 'active'
        AND (w.project_id = ${projectId}::uuid
             OR (${projectId}::uuid IS NULL AND w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = req.company_id)))
    ), made_d AS (
      INSERT INTO deliverables (workstream_id, title, owner_id, due_kind, due_date, status, client_visible, internal_notes, sort_order)
      SELECT chosen.id, ${title}, ${body.owner_id}, 'exact', ${body.due_date}::date, 'planned', true, ${notes},
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
