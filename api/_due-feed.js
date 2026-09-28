// api/_due-feed.js
// What's due, across Slate: ONE sorted list of everything dated, with a type,
// a title, a date, an owner and a link. The Dashboard's What's due list, the
// office screen and the 09:00 email all read it (stage 2's alerts will too);
// nothing else works out what's due.
//
// Sources: worklist deliverables, the older deliverables stored on projects
// (until they are retired — read through _legacy-deliverables.js), marketing
// sub-tasks and card due dates, canvas checklists, planning-board cards,
// edit deadlines (post-production blocks and Team Calendar deadlines) and
// tasks with a due date.
//
// Split in two: fetchDueSources() does the SQL, collectDue() is pure (and
// unit-tested in _due-feed.test.js). "Today" is London time.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { londonDate, addDays, daysBetween, toDateString, isDateString } from './_dates.js'
import { dueDisplay } from './_retainer-rules.js'
import { legacyDeliverables } from './_legacy-deliverables.js'

export const TYPE_LABELS = {
  task:                'Task',
  deliverable:         'Deliverable',
  project_deliverable: 'Deliverable',
  edit_deadline:       'Edit deadline',
  marketing_task:      'Marketing',
  marketing_card:      'Marketing',
  checklist:           'Checklist',
  board_card:          'Board',
}

// Planning-board columns are named by people, so "finished" is read from the
// column's name — the default board's last column is "Done".
const FINISHED_COLUMN = /^(done|complete|completed|finished|delivered|approved|archived)$/i
export const isFinishedColumn = name => FINISHED_COLUMN.test(String(name || '').trim())

// ── SQL ──────────────────────────────────────────────────────────────────────

export async function fetchDueSources(sql, { ws, today, to }) {
  const [worklist, projects, marketing, checklists, boardCards, ppsPhases, calendar, tasks, users] = await Promise.all([
    // Open deliverables in active workstreams (a paused or complete workstream
    // is not chasing anyone).
    sql`
      SELECT d.id, d.title, d.due_kind, d.due_date::text AS due_date, d.due_label, d.cadence, d.status,
             d.owner_id, w.title AS workstream, w.company_id, c.name AS company
      FROM deliverables d
      JOIN workstreams w ON w.id = d.workstream_id
      JOIN companies c ON c.id = w.company_id
      WHERE w.user_id = ${ws} AND w.status = 'active' AND d.status <> 'approved'
        AND d.due_date IS NOT NULL AND d.due_date <= ${to}::date
    `,
    sql`
      SELECT id, name, is_retainer, deliverables, monthly_deliverables
      FROM projects
      WHERE user_id = ${ws}
        AND ((jsonb_typeof(deliverables) = 'array' AND jsonb_array_length(deliverables) > 0)
          OR (jsonb_typeof(monthly_deliverables) = 'array' AND jsonb_array_length(monthly_deliverables) > 0))
    `,
    sql`
      SELECT id, title, due_date::text AS due_date, lead_owner_id, sub_tasks
      FROM marketing_cards
      WHERE user_id = ${ws} AND status <> 'done'
    `,
    sql`
      SELECT ci.id, ci.sub_tasks, c.id AS canvas_id, c.name AS canvas_name
      FROM canvas_items ci
      JOIN canvases c ON c.id = ci.canvas_id
      WHERE c.user_id = ${ws} AND ci.kind = 'todo'
        AND jsonb_typeof(ci.sub_tasks) = 'array' AND jsonb_array_length(ci.sub_tasks) > 0
    `,
    sql`
      SELECT bc.id, bc.title, bc.due_date::text AS due_date, bc.assignee_id,
             b.id AS board_id, b.name AS board_name, col.name AS column_name
      FROM board_cards bc
      JOIN boards b ON b.id = bc.board_id
      JOIN board_columns col ON col.id = bc.column_id
      WHERE b.user_id = ${ws} AND bc.due_date IS NOT NULL AND bc.due_date <= ${to}::date
    `,
    sql`
      SELECT ph.id, ph.name, ph.blocks, s.project_id, p.name AS project_name
      FROM pps_phases ph
      JOIN post_production_schedules s ON s.id = ph.schedule_id
      JOIN projects p ON p.id = s.project_id
      WHERE s.user_id = ${ws}
    `,
    // Team Calendar deadlines can't be ticked off, so only today onwards: one
    // that has passed is history, not overdue.
    sql`
      SELECT e.id, e.label, e.entry_date::text AS entry_date, e.end_date::text AS end_date,
             e.assignee_id, e.project_id, p.name AS project_name
      FROM team_calendar_entries e
      LEFT JOIN projects p ON p.id = e.project_id
      WHERE e.user_id = ${ws} AND e.is_deadline = true
        AND COALESCE(e.end_date, e.entry_date) BETWEEN ${today}::date AND ${to}::date
    `,
    sql`
      SELECT t.id, t.title, t.due_at, t.assignee_id, p.name AS project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ${ws} AND t.archived_at IS NULL AND t.status <> 'done' AND t.due_at IS NOT NULL
    `,
    sql`SELECT id, clerk_id, name, email FROM app_users`,
  ])
  return { worklist, projects, marketing, checklists, boardCards, ppsPhases, calendar, tasks, users }
}

// ── The pure part ────────────────────────────────────────────────────────────

const list = v => (Array.isArray(v) ? v : [])

// The deliverables stored as JSON on projects, until they're retired. Monthly
// deliverables only exist on retainers.
function projectDeliverables(projects) {
  return projects.flatMap(p => legacyDeliverables(p, { monthly: p.is_retainer })
    .filter(d => !d.done && d.due)
    .map(d => ({
      type: 'project_deliverable', key: `pd:${p.id}:${d.source}:${d.index}`, title: d.text, context: p.name,
      date: d.due, owner_id: d.assignee_id, link: `#projects/${p.id}/overview`,
    })))
}

// One line under an item's title: what it is, where it lives and, for work
// with a looser deadline, when (e.g. "Deliverable · DMM · Launch · October").
export const dueMeta = item => [item.type_label, item.context, item.due_label].filter(Boolean).join(' · ')

// Everything due on or before `to` (overdue included), sorted by date.
// `context` is where the item lives, or null when the type says it all.
// ownerId (an app_users.id) narrows it to one person's.
export function collectDue(src, { today, to, ownerId = null }) {
  const users = list(src.users)
  const byId = new Map(users.map(u => [u.id, u]))
  const byClerk = new Map(users.map(u => [u.clerk_id, u]))
  const raw = []

  for (const d of list(src.worklist)) {
    raw.push({
      type: 'deliverable', key: `wd:${d.id}`, title: d.title, context: `${d.company} · ${d.workstream}`,
      // Only when it says more than the date: a window, a month, a cadence or
      // the client's own words ("1st week of October").
      date: toDateString(d.due_date), due_label: d.due_kind === 'exact' && !d.due_label ? null : dueDisplay(d, today),
      owner_id: d.owner_id,
      link: `#retainers/${d.company_id}`,
    })
  }
  raw.push(...projectDeliverables(list(src.projects)))

  for (const card of list(src.marketing)) {
    if (card.due_date) {
      raw.push({
        type: 'marketing_card', key: `mc:${card.id}`, title: card.title, context: null,
        date: toDateString(card.due_date), owner_id: byClerk.get(card.lead_owner_id)?.id ?? null,
        link: `#marketing/${card.id}`,
      })
    }
    list(card.sub_tasks).forEach((st, i) => {
      if (!st?.text || st.done || !st.due_date) return
      raw.push({
        type: 'marketing_task', key: `ms:${card.id}:${st.id ?? i}`, title: st.text, context: card.title,
        date: toDateString(st.due_date), owner_id: byClerk.get(st.owner_id)?.id ?? null,
        link: `#marketing/${card.id}`,
      })
    })
  }

  for (const item of list(src.checklists)) {
    list(item.sub_tasks).forEach((st, i) => {
      if (!st?.text || st.done || !st.due_date) return
      raw.push({
        type: 'checklist', key: `cl:${item.id}:${st.id ?? i}`, title: st.text, context: item.canvas_name || 'Canvas checklist',
        date: toDateString(st.due_date), owner_id: byClerk.get(st.owner_id)?.id ?? null,
        link: `#planning/canvas/${item.canvas_id}`,
      })
    })
  }

  for (const c of list(src.boardCards)) {
    if (isFinishedColumn(c.column_name)) continue
    raw.push({
      type: 'board_card', key: `bc:${c.id}`, title: c.title, context: c.board_name,
      date: toDateString(c.due_date), owner_id: c.assignee_id, link: `#planning/${c.board_id}`,
    })
  }

  for (const ph of list(src.ppsPhases)) {
    for (const b of list(ph.blocks)) {
      if (!b?.is_deadline || !b.end_date || b.is_complete) continue
      raw.push({
        type: 'edit_deadline', key: `pp:${ph.id}:${b.id}`, title: b.title || ph.name, context: ph.project_name,
        date: toDateString(b.end_date), owner_id: b.assignee_id || null,
        link: `#projects/${ph.project_id}/post-production`,
      })
    }
  }

  for (const e of list(src.calendar)) {
    raw.push({
      type: 'edit_deadline', key: `tc:${e.id}`, title: e.label, context: e.project_name || 'Team Calendar',
      date: toDateString(e.end_date || e.entry_date), owner_id: e.assignee_id, link: '#calendar',
    })
  }

  for (const t of list(src.tasks)) {
    raw.push({
      type: 'task', key: `tk:${t.id}`, title: t.title, context: t.project_name || null,
      date: londonDate(t.due_at), owner_id: t.assignee_id, link: `#tasks/${t.id}`,
    })
  }

  return raw
    .filter(i => isDateString(i.date) && i.date <= to && (!ownerId || i.owner_id === ownerId))
    .map(({ owner_id, ...i }) => {
      const owner = owner_id ? byId.get(owner_id) : null
      return {
        ...i,
        due_label: i.due_label ?? null,
        type_label: TYPE_LABELS[i.type],
        owner: owner ? { id: owner.id, name: owner.name || owner.email } : null,
        days: daysBetween(today, i.date),
        overdue: i.date < today,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.type_label.localeCompare(b.type_label) || a.title.localeCompare(b.title))
}

// The feed itself: `days` ahead of today (London), overdue always included.
export async function dueFeed(sql, { ws, days = 14, ownerId = null, today = londonDate() }) {
  const to = addDays(today, days)
  const sources = await fetchDueSources(sql, { ws, today, to })
  return { today, to, items: collectDue(sources, { today, to, ownerId }) }
}
