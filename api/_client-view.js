// api/_client-view.js
// Everything the client portal shows, read for one scope. The ONLY code that
// reads data for someone outside Peny, and it takes nothing but a scope made
// by _worklist.js (from the verified session or a portal token — see
// _client.js resolveScope).
//
// Rules this file keeps — _client-view.test.js checks the first three by
// reading this file:
//   - Every query carries the scope itself (scope.companyId or
//     scope.projectId, with scope.ws). None is keyed by ids from an earlier
//     query, so no query can reach past the scope because of a bug elsewhere.
//   - Explicit column lists. No SELECT *, and never internal_notes, owner_id,
//     sent_by, waiting_since, responded_by or the portal token.
//   - Deliverables only where client_visible; a workstream only if it has one
//     (so an internal workstream's title and brief don't leak either).
//   - Statuses leave as the client's labels (clientStatus), never the
//     internal names; who at Peny sent or recorded something is not said.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { londonDate } from './_dates.js'
import { clientStatus, dueDisplay, isFrameIoUrl, requestLabel, RESPONSE_LABELS, WORKSTREAM_LABELS } from './_retainer-rules.js'
import { legacyDeliverables } from './_legacy-deliverables.js'
import { isScope } from './_worklist.js'

// → the view, or null if the scope's company or project no longer exists.
export async function readClientView(sql, scope) {
  if (!isScope(scope)) throw new Error('readClientView needs a scope from _worklist.js')
  if (scope.kind === 'company') return companyView(sql, scope)
  if (scope.kind === 'project') return projectView(sql, scope)
  throw new Error(`No client view for a ${scope.kind} scope`)
}

// ── Signed in: the company's whole visible worklist ──────────────────────────

async function companyView(sql, scope) {
  const [companies, studios, workstreams, deliverables, rounds, requests] = await Promise.all([
    sql`
      SELECT c.name FROM companies c
      WHERE c.id = ${scope.companyId} AND c.user_id = ${scope.ws}
    `,
    sql`
      SELECT s.company_name, s.website FROM settings s
      WHERE s.user_id = ${scope.ws} LIMIT 1
    `,
    sql`
      SELECT w.id, w.title, w.brief, w.status
      FROM workstreams w
      WHERE w.user_id = ${scope.ws} AND w.company_id = ${scope.companyId}
        AND EXISTS (SELECT 1 FROM deliverables d WHERE d.workstream_id = w.id AND d.client_visible)
      ORDER BY w.sort_order, w.created_at
    `,
    sql`
      SELECT d.id, d.workstream_id, d.title, d.format, d.due_kind, d.due_date::text AS due_date,
             d.due_label, d.cadence, d.status, d.waiting_note
      FROM deliverables d
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE w.user_id = ${scope.ws} AND w.company_id = ${scope.companyId} AND d.client_visible
      ORDER BY d.sort_order, d.created_at
    `,
    sql`
      SELECT dv.id, dv.deliverable_id, dv.round, dv.url, dv.note, dv.sent_at, dv.client_response,
             dv.client_comment, dv.responded_at, dv.responded_by_name,
             EXISTS (SELECT 1 FROM app_users u WHERE u.clerk_id = dv.responded_by) AS recorded,
             dv.preview_title, dv.preview_image
      FROM deliveries dv
      JOIN deliverables d ON d.id = dv.deliverable_id
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE w.user_id = ${scope.ws} AND w.company_id = ${scope.companyId} AND d.client_visible
      ORDER BY dv.round
    `,
    // The company's requests, newest first. An accepted one shows the date we
    // gave it, read from the deliverable it became (only if that is shown to
    // the client — otherwise it reads as accepted, without a date).
    sql`
      SELECT r.id, r.title, r.detail, r.wanted_by::text AS wanted_by, r.status, r.decline_note,
             r.submitted_by_name, r.created_at,
             d.id AS deliverable_id, d.due_kind, d.due_date::text AS due_date, d.due_label, d.cadence,
             d.status AS deliverable_status
      FROM requests r
      LEFT JOIN deliverables d ON d.id = r.deliverable_id AND d.client_visible
      WHERE r.user_id = ${scope.ws} AND r.company_id = ${scope.companyId}
      ORDER BY r.created_at DESC
      LIMIT 50
    `,
  ])
  if (!companies[0]) return null
  const today = londonDate()
  return {
    scope: { kind: 'company', can_respond: scope.canRespond },
    today,
    title: companies[0].name,
    studio: studioJson(studios[0]),
    workstreams: worklistJson({ workstreams, deliverables, rounds, today, canRespond: scope.canRespond }),
    requests: requestsJson(requests, today),
  }
}

// ── A portal token link: one project, read-only ──────────────────────────────
// What the token portal has always shown — the project, its deliverables, the
// work log and the post-production schedule. The deliverables come from the
// project's workstreams once it has any; until then from the JSON stored on
// the project (_legacy-deliverables.js), so projects can move over one at a
// time.

async function projectView(sql, scope) {
  const [projects, studios, linked, workstreams, deliverables, rounds, log, schedules, phases] = await Promise.all([
    sql`
      SELECT p.name, p.status, p.brief, p.shoot_start::text AS shoot_start, p.shoot_end::text AS shoot_end,
             p.frame_io_link, p.deliverables, c.first_name, c.last_name, c.company
      FROM projects p
      LEFT JOIN contacts c ON c.id = p.client_id
      WHERE p.id = ${scope.projectId} AND p.user_id = ${scope.ws}
    `,
    sql`
      SELECT s.company_name, s.website FROM settings s
      WHERE s.user_id = ${scope.ws} LIMIT 1
    `,
    sql`
      SELECT count(*)::int AS workstreams FROM workstreams w
      WHERE w.user_id = ${scope.ws} AND w.project_id = ${scope.projectId}
    `,
    sql`
      SELECT w.id, w.title, w.brief, w.status
      FROM workstreams w
      WHERE w.user_id = ${scope.ws} AND w.project_id = ${scope.projectId}
        AND EXISTS (SELECT 1 FROM deliverables d WHERE d.workstream_id = w.id AND d.client_visible)
      ORDER BY w.sort_order, w.created_at
    `,
    sql`
      SELECT d.id, d.workstream_id, d.title, d.format, d.due_kind, d.due_date::text AS due_date,
             d.due_label, d.cadence, d.status, d.waiting_note
      FROM deliverables d
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE w.user_id = ${scope.ws} AND w.project_id = ${scope.projectId} AND d.client_visible
      ORDER BY d.sort_order, d.created_at
    `,
    sql`
      SELECT dv.id, dv.deliverable_id, dv.round, dv.url, dv.note, dv.sent_at, dv.client_response,
             dv.client_comment, dv.responded_at, dv.responded_by_name,
             EXISTS (SELECT 1 FROM app_users u WHERE u.clerk_id = dv.responded_by) AS recorded,
             dv.preview_title, dv.preview_image
      FROM deliveries dv
      JOIN deliverables d ON d.id = dv.deliverable_id
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE w.user_id = ${scope.ws} AND w.project_id = ${scope.projectId} AND d.client_visible
      ORDER BY dv.round
    `,
    sql`
      SELECT wl.note, wl.entry_date::text AS entry_date, wl.created_by
      FROM work_log wl
      JOIN projects p ON p.id = wl.project_id
      WHERE p.id = ${scope.projectId} AND p.user_id = ${scope.ws}
      ORDER BY wl.entry_date DESC, wl.created_at DESC
    `,
    sql`
      SELECT s.start_date::text AS start_date, s.end_date::text AS end_date
      FROM post_production_schedules s
      WHERE s.project_id = ${scope.projectId} AND s.user_id = ${scope.ws}
      LIMIT 1
    `,
    sql`
      SELECT ph.id, ph.name, ph.color, ph.blocks, ph.show_in_portal
      FROM pps_phases ph
      JOIN post_production_schedules s ON s.id = ph.schedule_id
      WHERE s.project_id = ${scope.projectId} AND s.user_id = ${scope.ws}
      ORDER BY ph.sort_order, ph.created_at
    `,
  ])
  const project = projects[0]
  if (!project) return null
  const today = londonDate()
  const moved = linked[0].workstreams > 0
  return {
    scope: { kind: 'project', can_respond: false },
    today,
    title: project.name,
    project: {
      name: project.name,
      status: project.status,
      brief: project.brief,
      shoot_start: project.shoot_start,
      shoot_end: project.shoot_end,
      frame_io_link: httpUrl(project.frame_io_link),
    },
    client: project.first_name
      ? { name: [project.first_name, project.last_name].filter(Boolean).join(' '), company: project.company || null }
      : null,
    studio: studioJson(studios[0]),
    workstreams: moved ? worklistJson({ workstreams, deliverables, rounds, today, canRespond: false }) : null,
    deliverables: moved ? null : legacyDeliverables(project).map(d => ({ text: d.text, due: d.due, done: d.done, link: d.link })),
    work_log: log.map(e => ({ note: e.note, date: e.entry_date, by: e.created_by || null })),
    schedule: schedules[0]
      ? { start_date: schedules[0].start_date, end_date: schedules[0].end_date, phases: portalPhases(phases) }
      : null,
  }
}

// ── Shaping ──────────────────────────────────────────────────────────────────

const httpUrl = v => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null)

function studioJson(row) {
  return { name: row?.company_name || null, website: httpUrl(row?.website) }
}

function groupBy(rows, key) {
  const out = new Map()
  for (const r of rows) {
    if (!out.has(r[key])) out.set(r[key], [])
    out.get(r[key]).push(r)
  }
  return out
}

// Requests, in the words the client sees: Submitted, Accepted (with the date
// we gave it, and where it now sits in their worklist) or Declined (with our
// note). Who at Peny decided is not said.
export function requestsJson(rows, today) {
  return rows.map(r => {
    const theirs = clientStatus(r.deliverable_status)
    return {
      id: r.id,
      title: r.title,
      detail: r.detail,
      wanted_by: r.wanted_by,
      status: r.status === 'new' ? 'submitted' : r.status,
      status_label: requestLabel(r.status),
      sent_at: r.created_at,
      sent_by: r.submitted_by_name || null,
      note: r.status === 'declined' ? r.decline_note : null,
      accepted: r.status === 'accepted' && r.deliverable_id
        ? { deliverable_id: r.deliverable_id, due: dueDisplay(r, today), status_label: theirs.label }
        : null,
    }
  })
}

// Workstreams → deliverables → rounds, in the words the client sees.
export function worklistJson({ workstreams, deliverables, rounds, today, canRespond }) {
  const roundsByDeliverable = groupBy(rounds, 'deliverable_id')
  const byWorkstream = groupBy(deliverables, 'workstream_id')
  return workstreams.map(w => ({
    id: w.id,
    title: w.title,
    brief: w.brief,
    status: w.status,
    status_label: WORKSTREAM_LABELS[w.status],
    deliverables: (byWorkstream.get(w.id) || []).map(d => {
      const theirs = clientStatus(d.status)
      const list = roundsByDeliverable.get(d.id) || []
      const latest = list[list.length - 1]
      return {
        id: d.id,
        title: d.title,
        format: d.format,
        due: dueDisplay(d, today),
        status: theirs.key,
        status_label: theirs.label,
        waiting_for: d.status === 'waiting_on_client' ? d.waiting_note || null : null,
        rounds: list.map(r => roundJson(r, r === latest, canRespond)),
      }
    }),
  }))
}

function roundJson(r, latest, canRespond) {
  const superseded = !latest && r.client_response === 'pending'
  return {
    id: r.id,
    round: r.round,
    url: r.url,
    frame_io: isFrameIoUrl(r.url),
    note: r.note,
    sent_at: r.sent_at,
    response: superseded ? 'superseded' : r.client_response,
    response_label: superseded ? 'Superseded' : RESPONSE_LABELS[r.client_response],
    comment: r.client_comment,
    answered_at: r.responded_at,
    // A client's name, or — when Peny recorded an answer that came by email —
    // just that it was recorded.
    answered_by: r.recorded ? null : r.responded_by_name,
    recorded_by_studio: !!r.recorded,
    preview: r.preview_title || r.preview_image ? { title: r.preview_title, image: r.preview_image } : null,
    latest,
    can_respond: !!canRespond && latest && r.client_response === 'pending',
  }
}

// The post-production schedule as the token portal has always shown it: phases
// and blocks marked for the portal, with their dates.
function portalPhases(rows) {
  const out = []
  for (const ph of rows) {
    const blocks = Array.isArray(ph.blocks) ? ph.blocks : []
    const visible = blocks.filter(b => (ph.show_in_portal || b.show_in_portal) && b.start_date && b.end_date)
    if (!visible.length && !ph.show_in_portal) continue
    out.push({
      id: ph.id,
      name: ph.name,
      color: ph.color,
      blocks: visible.map(b => ({
        id: b.id,
        title: b.title || '',
        start_date: String(b.start_date).slice(0, 10),
        end_date: String(b.end_date).slice(0, 10),
        color: b.color || null,
        notes: b.notes || '',
        is_deadline: !!b.is_deadline,
      })),
    })
  }
  return out
}
