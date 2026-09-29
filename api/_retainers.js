// api/_retainers.js
// Routes behind /api/retainers (see retainers.js): the Peny side of the
// retainer worklist — companies with a worklist, their workstreams, the
// deliverables in each and the rounds sent for review.
//
// Slate staff only (dispatch() requires an app_users row); every write also
// needs a non-viewer. Worklist data is read and written only through here and
// the portal API, never from src/db/client.js. The rules — statuses, due
// dates, rounds, responses — come from _retainer-rules.js; recording a
// response goes through _worklist.js, which the portal shares.
//
// Deleting: a workstream or deliverable with rounds sent can't be deleted, so
// a client's approvals can't vanish by accident — mark it approved or complete
// instead. A round sent by mistake can be taken back while it is the latest
// and unanswered.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { UUID, fail, invalid, readBody, workspaceId } from './_api.js'
import { londonDate, daysBetween, formatDay } from './_dates.js'
import { fetchLinkPreview } from './_preview.js'
import {
  DELIVERABLE_STATUSES, STATUS_LABELS, WORKSTREAM_STATUSES, WORKSTREAM_LABELS, RESPONSE_LABELS,
  DUE_KINDS, CADENCES, CADENCE_LABELS, STATUS_AFTER_DELIVERY, TITLE_MAX, TEXT_MAX,
  clientStatus, statusPatch, statusAfterUnsend, normaliseDeliveryUrl, isFrameIoUrl,
  normaliseDue, dueDisplay, isOverdue, validateWorkstreamInput, validateDeliverableInput,
  touchesDue, isUuid,
} from './_retainer-rules.js'
import { staffScope, respondToDelivery } from './_worklist.js'
import { REQUEST_ROUTES } from './_requests.js'
import { sendOwnerAssigned } from './_alerts.js'
import { emailDelivery } from './_delivery-mail.js'

const ID = `(?<id>${UUID})`
export const ROUTES = [
  { method: 'GET',    pattern: /^retainers\/companies$/,                                 handler: listCompanies },
  { method: 'GET',    pattern: new RegExp(`^retainers/companies/${ID}$`),                 handler: getCompanyPage },
  { method: 'POST',   pattern: /^retainers\/workstreams$/,                               handler: createWorkstream,  access: 'editor' },
  { method: 'PATCH',  pattern: new RegExp(`^retainers/workstreams/${ID}$`),               handler: updateWorkstream,  access: 'editor' },
  { method: 'DELETE', pattern: new RegExp(`^retainers/workstreams/${ID}$`),               handler: deleteWorkstream,  access: 'editor' },
  { method: 'POST',   pattern: /^retainers\/deliverables$/,                              handler: createDeliverable, access: 'editor' },
  { method: 'PATCH',  pattern: new RegExp(`^retainers/deliverables/${ID}$`),              handler: updateDeliverable, access: 'editor' },
  { method: 'DELETE', pattern: new RegExp(`^retainers/deliverables/${ID}$`),              handler: deleteDeliverable, access: 'editor' },
  { method: 'POST',   pattern: new RegExp(`^retainers/deliverables/${ID}/deliveries$`),   handler: sendDelivery,      access: 'editor' },
  { method: 'DELETE', pattern: new RegExp(`^retainers/deliveries/${ID}$`),                handler: unsendDelivery,    access: 'editor' },
  { method: 'POST',   pattern: new RegExp(`^retainers/deliveries/${ID}/preview$`),        handler: fillPreview,       access: 'editor' },
  { method: 'POST',   pattern: new RegExp(`^retainers/deliveries/${ID}/response$`),       handler: recordResponse,    access: 'editor' },
  // Client requests: triage (_requests.js).
  ...REQUEST_ROUTES,
]

// Whoever a deliverable is given to hears about it (the "Tasks assigned to
// you" switch). A failed email never fails the change.
async function tellOwner(sql, deliverableId, user) {
  try {
    await sendOwnerAssigned(sql, { deliverableId, assignedBy: user })
  } catch (err) {
    console.error('[retainers] owner email failed:', err?.message)
  }
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const cleanText = v => (typeof v === 'string' && v.trim() ? v.trim() : null)

// The words the page needs to offer choices, from the rules module, so the
// browser holds no copy of them (and the status menu can say what the client
// will see).
export const VOCAB = Object.freeze({
  statuses: DELIVERABLE_STATUSES.map(key => ({ key, label: STATUS_LABELS[key], client_label: clientStatus(key).label })),
  workstream_statuses: WORKSTREAM_STATUSES.map(key => ({ key, label: WORKSTREAM_LABELS[key] })),
  due_kinds: DUE_KINDS,
  cadences: CADENCES.map(key => ({ key, label: CADENCE_LABELS[key] })),
})

// ── Shapes ───────────────────────────────────────────────────────────────────
// What the Retainers page gets for a deliverable: the stored fields plus how
// the rules read them (due text, overdue, both status labels) and its rounds.

function deliveryJson(dv, latestRound) {
  const superseded = dv.round !== latestRound && dv.client_response === 'pending'
  return {
    id: dv.id,
    deliverable_id: dv.deliverable_id,
    round: dv.round,
    url: dv.url,
    frame_io: isFrameIoUrl(dv.url),
    note: dv.note,
    sent_by: dv.sent_by,
    sent_by_name: dv.sent_by_name || dv.sent_by_email || null,
    sent_at: dv.sent_at,
    client_response: dv.client_response,
    response_label: superseded ? 'Superseded' : RESPONSE_LABELS[dv.client_response],
    client_comment: dv.client_comment,
    responded_at: dv.responded_at,
    responded_by_name: dv.responded_by_name,
    responded_by_staff: !!dv.responded_by_staff,   // recorded by Peny, not answered in the portal
    preview_title: dv.preview_title,
    preview_image: dv.preview_image,
    latest: dv.round === latestRound,
  }
}

function deliverableJson(d, deliveries, today) {
  const latestRound = deliveries.length ? deliveries[deliveries.length - 1].round : 0
  return {
    id: d.id,
    workstream_id: d.workstream_id,
    title: d.title,
    format: d.format,
    owner_id: d.owner_id,
    owner_name: d.owner_name || d.owner_email || null,
    due_kind: d.due_kind,
    due_date: d.due_date,
    due_label: d.due_label,
    cadence: d.cadence,
    due_display: dueDisplay(d, today),
    overdue: isOverdue(d, today),
    days_late: isOverdue(d, today) ? daysBetween(d.due_date, today) : 0,
    status: d.status,
    status_label: STATUS_LABELS[d.status],
    client_status: clientStatus(d.status).label,
    waiting_since: d.waiting_since,
    waiting_days: d.waiting_since ? Math.max(0, daysBetween(londonDate(new Date(d.waiting_since)), today)) : null,
    waiting_note: d.waiting_note,
    client_visible: d.client_visible,
    internal_notes: d.internal_notes,
    sort_order: d.sort_order,
    created_at: d.created_at,
    updated_at: d.updated_at,
    deliveries: deliveries.map(dv => deliveryJson(dv, latestRound)),
  }
}

// Deliverables (with their rounds) in the given workstreams and/or with the
// given ids — the company page asks by workstream, a single edit by id.
async function loadDeliverables(sql, ws, { workstreamIds = [], ids = [] }) {
  const rows = await sql`
    SELECT d.id, d.workstream_id, d.title, d.format, d.owner_id, u.name AS owner_name, u.email AS owner_email,
           d.due_kind, d.due_date::text AS due_date, d.due_label, d.cadence, d.status,
           d.waiting_since, d.waiting_note, d.client_visible, d.internal_notes, d.sort_order,
           d.created_at, d.updated_at
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    LEFT JOIN app_users u ON u.id = d.owner_id
    WHERE w.user_id = ${ws}
      AND (d.workstream_id = ANY(${workstreamIds}::uuid[]) OR d.id = ANY(${ids}::uuid[]))
    ORDER BY d.sort_order, d.created_at
  `
  if (!rows.length) return []
  const deliveries = await sql`
    SELECT dv.id, dv.deliverable_id, dv.url, dv.note, dv.round, dv.sent_by,
           su.name AS sent_by_name, su.email AS sent_by_email, dv.sent_at,
           dv.client_response, dv.client_comment, dv.responded_at, dv.responded_by_name,
           (ru.id IS NOT NULL) AS responded_by_staff, dv.preview_title, dv.preview_image
    FROM deliveries dv
    LEFT JOIN app_users su ON su.id = dv.sent_by
    LEFT JOIN app_users ru ON ru.clerk_id = dv.responded_by
    WHERE dv.deliverable_id = ANY(${rows.map(r => r.id)}::uuid[])
    ORDER BY dv.round
  `
  const today = londonDate()
  const byDeliverable = new Map(rows.map(r => [r.id, []]))
  for (const dv of deliveries) byDeliverable.get(dv.deliverable_id)?.push(dv)
  return rows.map(r => deliverableJson(r, byDeliverable.get(r.id), today))
}

async function loadDeliverable(sql, ws, id) {
  const [d] = await loadDeliverables(sql, ws, { ids: [id] })
  return d ?? null
}

async function loadWorkstreams(sql, ws, { companyId = null, id = null }) {
  const rows = await sql`
    SELECT w.id, w.company_id, w.project_id, p.name AS project_name, w.title, w.brief, w.status,
           w.sort_order, w.created_at, w.updated_at
    FROM workstreams w
    LEFT JOIN projects p ON p.id = w.project_id
    WHERE w.user_id = ${ws} AND (w.company_id = ${companyId} OR w.id = ${id})
    ORDER BY w.sort_order, w.created_at
  `
  return rows.map(w => ({ ...w, status_label: WORKSTREAM_LABELS[w.status] }))
}

async function projectInWorkspace(sql, ws, id) {
  const [p] = await sql`SELECT id FROM projects WHERE id = ${id} AND user_id = ${ws}`
  return !!p
}

// ── GET /api/retainers/companies ─────────────────────────────────────────────
// The Retainers list: every company with a worklist or a retainer project,
// with counts from its active workstreams. next_due is the next deadline still
// ahead (overdue ones are counted separately).
async function listCompanies(req, res, { sql }) {
  const ws = await workspaceId(sql)
  const today = londonDate()
  const companies = await sql`
    SELECT c.id, c.name, (c.clerk_org_id IS NOT NULL) AS portal, c.lead_id, lu.name AS lead_name, lu.email AS lead_email,
           COALESCE(s.open, 0) AS open, COALESCE(s.waiting, 0) AS waiting,
           COALESCE(s.in_review, 0) AS in_review, COALESCE(s.overdue, 0) AS overdue, s.next_due,
           wc.workstreams, COALESCE(rp.projects, '[]'::json) AS retainer_projects
    FROM companies c
    LEFT JOIN app_users lu ON lu.id = c.lead_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE d.status <> 'approved')::int AS open,
             count(*) FILTER (WHERE d.status = 'waiting_on_client')::int AS waiting,
             count(*) FILTER (WHERE d.status = 'in_review')::int AS in_review,
             count(*) FILTER (WHERE d.status <> 'approved' AND d.due_date < ${today}::date)::int AS overdue,
             (min(d.due_date) FILTER (WHERE d.status <> 'approved' AND d.due_date >= ${today}::date))::text AS next_due
      FROM workstreams w
      JOIN deliverables d ON d.workstream_id = w.id
      WHERE w.company_id = c.id AND w.user_id = ${ws} AND w.status = 'active'
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS workstreams FROM workstreams w WHERE w.company_id = c.id AND w.user_id = ${ws}
    ) wc ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('id', p.id, 'name', p.name) ORDER BY p.name) AS projects
      FROM projects p WHERE p.company_id = c.id AND p.user_id = ${ws} AND p.is_retainer
    ) rp ON true
    WHERE c.user_id = ${ws} AND (wc.workstreams > 0 OR rp.projects IS NOT NULL)
    ORDER BY lower(c.name)
  `
  return res.status(200).json({
    today,
    companies: companies.map(({ lead_name, lead_email, ...c }) => ({
      ...c,
      lead_name: lead_name || lead_email || null,
      next_due_display: c.next_due ? formatDay(c.next_due, today) : null,
    })),
  })
}

// ── GET /api/retainers/companies/:id ─────────────────────────────────────────
// The whole company page in one payload: its workstreams, each with its
// deliverables and their rounds, and the company's projects (to link a
// workstream to one).
async function getCompanyPage(req, res, { sql, params }) {
  const ws = await workspaceId(sql)
  const [company] = await sql`
    SELECT c.id, c.name, c.clerk_org_id, c.lead_id, u.name AS lead_name, u.email AS lead_email
    FROM companies c LEFT JOIN app_users u ON u.id = c.lead_id
    WHERE c.id = ${params.id} AND c.user_id = ${ws}
  `
  if (!company) return fail(res, 404, 'not_found', 'Company not found')

  const [workstreams, projects] = await Promise.all([
    loadWorkstreams(sql, ws, { companyId: company.id }),
    sql`
      SELECT id, name, status, is_retainer FROM projects
      WHERE company_id = ${company.id} AND user_id = ${ws}
      ORDER BY is_retainer DESC, lower(name)
    `,
  ])
  const deliverables = await loadDeliverables(sql, ws, { workstreamIds: workstreams.map(w => w.id) })
  const byWorkstream = new Map(workstreams.map(w => [w.id, []]))
  for (const d of deliverables) byWorkstream.get(d.workstream_id)?.push(d)

  return res.status(200).json({
    today: londonDate(),
    vocab: VOCAB,
    company: {
      id: company.id, name: company.name, portal: !!company.clerk_org_id,
      lead_id: company.lead_id, lead_name: company.lead_name || company.lead_email || null,
    },
    workstreams: workstreams.map(w => ({ ...w, deliverables: byWorkstream.get(w.id) })),
    projects,
  })
}

// ── POST /api/retainers/workstreams ──────────────────────────────────────────
// { company_id, title, brief?, project_id?, status? } → added at the end.
async function createWorkstream(req, res, { sql }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  if (!isUuid(body.company_id)) return invalid(res, 'company_id', 'Choose the company')
  const bad = validateWorkstreamInput(body)
  if (bad) return invalid(res, bad.field, bad.message)

  const ws = await workspaceId(sql)
  const [company] = await sql`SELECT id FROM companies WHERE id = ${body.company_id} AND user_id = ${ws}`
  if (!company) return invalid(res, 'company_id', 'That company does not exist')
  if (body.project_id && !(await projectInWorkspace(sql, ws, body.project_id))) {
    return invalid(res, 'project_id', 'That project does not exist')
  }

  const [row] = await sql`
    INSERT INTO workstreams (user_id, company_id, project_id, title, brief, status, sort_order)
    SELECT ${ws}, ${company.id}, ${body.project_id || null}, ${body.title.trim()}, ${cleanText(body.brief)},
           ${body.status || 'active'}::workstream_status,
           COALESCE((SELECT max(sort_order) + 1 FROM workstreams WHERE company_id = ${company.id}), 0)
    RETURNING id
  `
  const [workstream] = await loadWorkstreams(sql, ws, { id: row.id })
  return res.status(201).json({ workstream: { ...workstream, deliverables: [] } })
}

// ── PATCH /api/retainers/workstreams/:id ─────────────────────────────────────
// Any of { title, brief, status, project_id, sort_order }; only what's sent
// is written. Returns the workstream without its deliverables.
async function updateWorkstream(req, res, { sql, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const bad = validateWorkstreamInput(body, { partial: true })
  if (bad) return invalid(res, bad.field, bad.message)

  const ws = await workspaceId(sql)
  if (body.project_id && !(await projectInWorkspace(sql, ws, body.project_id))) {
    return invalid(res, 'project_id', 'That project does not exist')
  }

  const [row] = await sql`
    UPDATE workstreams SET
      title      = CASE WHEN ${has(body, 'title')} THEN ${has(body, 'title') ? body.title.trim() : null} ELSE title END,
      brief      = CASE WHEN ${has(body, 'brief')} THEN ${cleanText(body.brief)} ELSE brief END,
      status     = CASE WHEN ${has(body, 'status')} THEN ${body.status ?? null}::workstream_status ELSE status END,
      project_id = CASE WHEN ${has(body, 'project_id')} THEN ${body.project_id || null}::uuid ELSE project_id END,
      sort_order = CASE WHEN ${has(body, 'sort_order')} THEN ${body.sort_order ?? null}::int ELSE sort_order END,
      updated_at = NOW()
    WHERE id = ${params.id} AND user_id = ${ws}
    RETURNING id
  `
  if (!row) return fail(res, 404, 'not_found', 'Workstream not found')
  const [workstream] = await loadWorkstreams(sql, ws, { id: row.id })
  return res.status(200).json({ workstream })
}

// ── DELETE /api/retainers/workstreams/:id ────────────────────────────────────
// Takes its deliverables with it — so only while none of them has had a round
// sent.
async function deleteWorkstream(req, res, { sql, params }) {
  const ws = await workspaceId(sql)
  const [gone] = await sql`
    DELETE FROM workstreams w
    WHERE w.id = ${params.id} AND w.user_id = ${ws}
      AND NOT EXISTS (
        SELECT 1 FROM deliverables d JOIN deliveries dv ON dv.deliverable_id = d.id
        WHERE d.workstream_id = w.id
      )
    RETURNING w.id
  `
  if (gone) return res.status(200).json({ ok: true, id: gone.id })
  const [exists] = await sql`SELECT id FROM workstreams WHERE id = ${params.id} AND user_id = ${ws}`
  if (!exists) return fail(res, 404, 'not_found', 'Workstream not found')
  return fail(res, 409, 'has_rounds', 'Rounds have been sent from this workstream, so it stays on the record — mark it complete instead')
}

// ── POST /api/retainers/deliverables ─────────────────────────────────────────
// { workstream_id, title, format?, owner_id?, due_kind?, due_date?, due_month?,
//   due_label?, cadence?, status?, waiting_note?, client_visible?,
//   internal_notes? } → added at the end of the workstream. Hidden from the
// client unless client_visible is sent as true.
async function createDeliverable(req, res, { sql, user }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  if (!isUuid(body.workstream_id)) return invalid(res, 'workstream_id', 'Choose the workstream')

  const userIds = (await sql`SELECT id FROM app_users`).map(u => u.id)
  const bad = validateDeliverableInput(body, { userIds })
  if (bad) return invalid(res, bad.field, bad.message)
  const due = normaliseDue(body)
  if (due.error) return invalid(res, due.error.field, due.error.message)

  const status = body.status || 'planned'
  const patch = statusPatch({ from: 'planned', to: status })
  const waitingNote = cleanText(body.waiting_note)
  if (waitingNote && status !== 'waiting_on_client') {
    return invalid(res, 'waiting_note', 'Say what we need from the client once it is waiting on them')
  }

  const ws = await workspaceId(sql)
  const [workstream] = await sql`SELECT id FROM workstreams WHERE id = ${body.workstream_id} AND user_id = ${ws}`
  if (!workstream) return invalid(res, 'workstream_id', 'That workstream does not exist')

  const [row] = await sql`
    INSERT INTO deliverables (workstream_id, title, format, owner_id, due_kind, due_date, due_label, cadence,
                              status, waiting_since, waiting_note, client_visible, internal_notes, sort_order)
    SELECT ${workstream.id}, ${body.title.trim()}, ${cleanText(body.format)}, ${body.owner_id || null},
           ${due.due_kind}::deliverable_due_kind, ${due.due_date}::date, ${due.due_label}, ${due.cadence},
           ${patch.status}::deliverable_status, ${patch.waiting_since ?? null}::timestamptz, ${waitingNote},
           ${body.client_visible === true}, ${cleanText(body.internal_notes)},
           COALESCE((SELECT max(sort_order) + 1 FROM deliverables WHERE workstream_id = ${workstream.id}), 0)
    RETURNING id
  `
  if (body.owner_id) await tellOwner(sql, row.id, user)
  return res.status(201).json({ deliverable: await loadDeliverable(sql, ws, row.id) })
}

// ── PATCH /api/retainers/deliverables/:id ────────────────────────────────────
// Any of the fields above (plus workstream_id to move it and sort_order);
// only what's sent is written, so two people changing different things don't
// undo each other. A status change follows statusPatch (the waiting clock) and
// is refused with 409 if the status moved on meanwhile.
async function updateDeliverable(req, res, { sql, user, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const userIds = (await sql`SELECT id FROM app_users`).map(u => u.id)
  const bad = validateDeliverableInput(body, { partial: true, userIds })
  if (bad) return invalid(res, bad.field, bad.message)
  if (has(body, 'workstream_id') && !isUuid(body.workstream_id)) return invalid(res, 'workstream_id', 'Choose the workstream')

  const ws = await workspaceId(sql)
  const current = await loadDeliverable(sql, ws, params.id)
  if (!current) return fail(res, 404, 'not_found', 'Deliverable not found')

  if (has(body, 'workstream_id')) {
    const [target] = await sql`SELECT id FROM workstreams WHERE id = ${body.workstream_id} AND user_id = ${ws}`
    if (!target) return invalid(res, 'workstream_id', 'That workstream does not exist')
  }

  // Due fields are normalised as a set. Changing the kind drops words that
  // described the old one unless new words are sent.
  let due = null
  if (touchesDue(body)) {
    const kindChanged = has(body, 'due_kind') && body.due_kind !== current.due_kind
    due = normaliseDue({
      due_kind:  has(body, 'due_kind') ? body.due_kind : current.due_kind,
      due_date:  has(body, 'due_date') ? body.due_date : current.due_date,
      due_month: body.due_month,
      due_label: has(body, 'due_label') ? body.due_label : (kindChanged ? null : current.due_label),
      cadence:   has(body, 'cadence') ? body.cadence : current.cadence,
    })
    if (due.error) return invalid(res, due.error.field, due.error.message)
  }

  const statusChange = has(body, 'status') ? statusPatch({ from: current.status, to: body.status }) : {}
  const nextStatus = statusChange.status ?? current.status
  let waitingNote = has(statusChange, 'waiting_note') ? statusChange.waiting_note
    : has(body, 'waiting_note') ? cleanText(body.waiting_note) : undefined
  if (waitingNote && nextStatus !== 'waiting_on_client') {
    return invalid(res, 'waiting_note', 'Say what we need from the client once it is waiting on them')
  }
  const setNote = waitingNote !== undefined
  const setSince = has(statusChange, 'waiting_since')

  const [row] = await sql`
    UPDATE deliverables SET
      workstream_id  = CASE WHEN ${has(body, 'workstream_id')} THEN ${body.workstream_id ?? null}::uuid ELSE workstream_id END,
      title          = CASE WHEN ${has(body, 'title')} THEN ${has(body, 'title') ? body.title.trim() : null} ELSE title END,
      format         = CASE WHEN ${has(body, 'format')} THEN ${cleanText(body.format)} ELSE format END,
      owner_id       = CASE WHEN ${has(body, 'owner_id')} THEN ${body.owner_id || null}::uuid ELSE owner_id END,
      due_kind       = CASE WHEN ${!!due} THEN ${due?.due_kind ?? null}::deliverable_due_kind ELSE due_kind END,
      due_date       = CASE WHEN ${!!due} THEN ${due?.due_date ?? null}::date ELSE due_date END,
      due_label      = CASE WHEN ${!!due} THEN ${due?.due_label ?? null} ELSE due_label END,
      cadence        = CASE WHEN ${!!due} THEN ${due?.cadence ?? null} ELSE cadence END,
      status         = ${nextStatus}::deliverable_status,
      waiting_since  = CASE WHEN ${setSince} THEN ${statusChange.waiting_since ?? null}::timestamptz ELSE waiting_since END,
      waiting_note   = CASE WHEN ${setNote} THEN ${waitingNote ?? null} ELSE waiting_note END,
      client_reply      = CASE WHEN ${has(statusChange, 'client_reply')} THEN NULL ELSE client_reply END,
      client_replied_at = CASE WHEN ${has(statusChange, 'client_reply')} THEN NULL ELSE client_replied_at END,
      client_visible = CASE WHEN ${has(body, 'client_visible')} THEN ${body.client_visible === true} ELSE client_visible END,
      internal_notes = CASE WHEN ${has(body, 'internal_notes')} THEN ${cleanText(body.internal_notes)} ELSE internal_notes END,
      sort_order     = CASE WHEN ${has(body, 'sort_order')} THEN ${body.sort_order ?? null}::int ELSE sort_order END,
      updated_at     = NOW()
    WHERE id = ${current.id} AND status = ${current.status}::deliverable_status
      AND workstream_id IN (SELECT id FROM workstreams WHERE user_id = ${ws})
    RETURNING id
  `
  if (!row) return fail(res, 409, 'conflict', 'Someone changed this while you were editing — refresh and try again')
  if (has(body, 'owner_id') && body.owner_id && body.owner_id !== current.owner_id) await tellOwner(sql, current.id, user)
  return res.status(200).json({ deliverable: await loadDeliverable(sql, ws, current.id) })
}

// ── DELETE /api/retainers/deliverables/:id ───────────────────────────────────
// Only before any round has been sent.
async function deleteDeliverable(req, res, { sql, params }) {
  const ws = await workspaceId(sql)
  const [gone] = await sql`
    DELETE FROM deliverables d
    USING workstreams w
    WHERE d.id = ${params.id} AND w.id = d.workstream_id AND w.user_id = ${ws}
      AND NOT EXISTS (SELECT 1 FROM deliveries dv WHERE dv.deliverable_id = d.id)
    RETURNING d.id
  `
  if (gone) return res.status(200).json({ ok: true, id: gone.id })
  if (!(await loadDeliverable(sql, ws, params.id))) return fail(res, 404, 'not_found', 'Deliverable not found')
  return fail(res, 409, 'has_rounds', 'Rounds have been sent for this, so it stays on the record — mark it approved instead')
}

// ── POST /api/retainers/deliverables/:id/deliveries ──────────────────────────
// { url, note? } → the next round (previous + 1), sent by the caller, and the
// deliverable goes into review. One statement. Sends at the same moment can
// both read the same previous round (the statement's snapshot predates the
// other's commit); the unique (deliverable_id, round) turns that into an
// error, and the loser simply tries again with the next number.
const SEND_ATTEMPTS = 5
async function sendDelivery(req, res, { sql, user, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const link = normaliseDeliveryUrl(body.url)
  if (link.error) return invalid(res, link.error.field, link.error.message)
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > TEXT_MAX)) {
    return invalid(res, 'note', 'That note is too long')
  }

  const ws = await workspaceId(sql)
  const current = await loadDeliverable(sql, ws, params.id)
  if (!current) return fail(res, 404, 'not_found', 'Deliverable not found')
  const patch = statusPatch({ from: current.status, to: STATUS_AFTER_DELIVERY })

  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    let sent
    try {
      ;[sent] = await sql`
        WITH target AS (
          SELECT d.id
          FROM deliverables d
          JOIN workstreams w ON w.id = d.workstream_id
          WHERE d.id = ${current.id} AND w.user_id = ${ws} AND d.status = ${current.status}::deliverable_status
          FOR UPDATE OF d
        ), sent AS (
          INSERT INTO deliveries (deliverable_id, url, note, round, sent_by)
          SELECT target.id, ${link.url}, ${cleanText(body.note)},
                 COALESCE((SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = target.id), 0) + 1,
                 ${user.id}
          FROM target
          RETURNING id, deliverable_id, round
        )
        UPDATE deliverables SET
          status        = ${patch.status}::deliverable_status,
          waiting_since = CASE WHEN ${'waiting_since' in patch} THEN ${patch.waiting_since ?? null}::timestamptz ELSE waiting_since END,
          waiting_note  = CASE WHEN ${'waiting_note' in patch} THEN ${patch.waiting_note ?? null}::text ELSE waiting_note END,
      client_reply      = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_reply END,
      client_replied_at = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_replied_at END,
          updated_at    = NOW()
        FROM sent WHERE deliverables.id = sent.deliverable_id
        RETURNING sent.id, sent.round
      `
    } catch (err) {
      if (err?.code === '23505' && attempt < SEND_ATTEMPTS) continue   // round taken by a send at the same moment
      throw err
    }
    if (!sent) return fail(res, 409, 'conflict', 'Someone changed this while you were sending — refresh and try again')
    // The client is emailed as part of sending — there is no separate step to
    // forget. `notified` says who, so the page can say it, and why not if not.
    const notified = await emailDelivery(sql, { deliveryId: sent.id })
    return res.status(201).json({
      delivery: { id: sent.id, round: sent.round },
      deliverable: await loadDeliverable(sql, ws, current.id),
      notified,
    })
  }
  return fail(res, 409, 'conflict', 'Someone sent a round at the same moment — refresh and try again')
}

// ── DELETE /api/retainers/deliveries/:id ─────────────────────────────────────
// Takes back a round sent by mistake: only the latest, and only while nobody
// has answered it. The deliverable goes back to where the previous round left
// it (statusAfterUnsend).
async function unsendDelivery(req, res, { sql, params }) {
  const ws = await workspaceId(sql)
  const [dv] = await sql`
    SELECT dv.id, dv.round, dv.client_response, d.id AS deliverable_id, d.status,
           (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = d.id) AS latest_round,
           (SELECT x.client_response FROM deliveries x
             WHERE x.deliverable_id = d.id AND x.round < dv.round ORDER BY x.round DESC LIMIT 1) AS previous_response
    FROM deliveries dv
    JOIN deliverables d ON d.id = dv.deliverable_id
    JOIN workstreams w ON w.id = d.workstream_id
    WHERE dv.id = ${params.id} AND w.user_id = ${ws}
  `
  if (!dv) return fail(res, 404, 'not_found', 'Round not found')
  if (dv.round !== dv.latest_round) return fail(res, 409, 'not_latest', 'Only the latest round can be taken back')
  if (dv.client_response !== 'pending') return fail(res, 409, 'answered', 'This round has been answered, so it stays on the record')

  const patch = statusPatch({ from: dv.status, to: statusAfterUnsend({ current: dv.status, previousResponse: dv.previous_response }) })
  const [done] = await sql`
    WITH target AS (
      SELECT dv.id
      FROM deliveries dv
      JOIN deliverables d ON d.id = dv.deliverable_id
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE dv.id = ${dv.id} AND w.user_id = ${ws}
        AND dv.client_response = 'pending' AND d.status = ${dv.status}::deliverable_status
        AND dv.round = (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id)
      FOR UPDATE OF dv, d
    ), gone AS (
      DELETE FROM deliveries USING target WHERE deliveries.id = target.id
      RETURNING deliveries.deliverable_id
    )
    UPDATE deliverables SET
      status        = ${patch.status}::deliverable_status,
      waiting_since = CASE WHEN ${'waiting_since' in patch} THEN ${patch.waiting_since ?? null}::timestamptz ELSE waiting_since END,
      waiting_note  = CASE WHEN ${'waiting_note' in patch} THEN ${patch.waiting_note ?? null}::text ELSE waiting_note END,
      client_reply      = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_reply END,
      client_replied_at = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_replied_at END,
      updated_at    = NOW()
    FROM gone WHERE deliverables.id = gone.deliverable_id
    RETURNING deliverables.id
  `
  if (!done) return fail(res, 409, 'conflict', 'This changed while you were taking it back — refresh and try again')
  return res.status(200).json({ ok: true, deliverable: await loadDeliverable(sql, ws, dv.deliverable_id) })
}

// ── POST /api/retainers/deliveries/:id/preview ───────────────────────────────
// Fetches the link's preview (title and image) after sending, so sending
// never waits on someone else's server. A link without one isn't an error:
// the card falls back to the deliverable's title and the round.
async function fillPreview(req, res, { sql, params }) {
  const ws = await workspaceId(sql)
  const [dv] = await sql`
    SELECT dv.id, dv.url
    FROM deliveries dv
    JOIN deliverables d ON d.id = dv.deliverable_id
    JOIN workstreams w ON w.id = d.workstream_id
    WHERE dv.id = ${params.id} AND w.user_id = ${ws}
  `
  if (!dv) return fail(res, 404, 'not_found', 'Round not found')

  let found
  try { found = await fetchLinkPreview(dv.url) } catch (err) {
    return res.status(200).json({ preview: null, reason: err.message })
  }
  // The image becomes an <img> in the portal: http(s) only.
  const img = found.image ? normaliseDeliveryUrl(found.image) : null
  const image = img && !img.error ? img.url : null
  const title = found.title ? String(found.title).slice(0, TITLE_MAX) : null
  await sql`UPDATE deliveries SET preview_title = ${title}, preview_image = ${image} WHERE id = ${dv.id}`
  return res.status(200).json({ preview: { title, image } })
}

// ── POST /api/retainers/deliveries/:id/response ──────────────────────────────
// A Peny user recording the client's answer that came another way (email, a
// call): { response: 'approved' | 'changes_requested', comment } — a comment
// is needed to request changes. Same rule and code as the portal.
async function recordResponse(req, res, { sql, user, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const ws = await workspaceId(sql)
  const result = await respondToDelivery(sql, staffScope(ws), {
    deliveryId: params.id,
    input: body,
    by: { clerkId: user.clerk_id, name: user.name || user.email },
  })
  if (result.error) {
    const { status, code, message, field } = result.error
    return fail(res, status, code, message, field ? { field } : {})
  }
  return res.status(200).json({ deliverable: await loadDeliverable(sql, ws, result.delivery.deliverable_id) })
}
