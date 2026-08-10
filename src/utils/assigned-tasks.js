// src/utils/assigned-tasks.js
// Pure collector behind the Dashboard's personal to-do list. Given the data the
// app already holds (plus two small extra queries for planning boards and
// canvas checklists), it works out every outstanding task allocated to one
// person and flattens them into a single row shape.
//
// "Allocated to me" is spelled differently in each feature, which is the whole
// reason this lives in one place:
//
//   projects.deliverables[] / .monthly_deliverables[]  assignee_id  app_users.id
//   pps_phases.blocks[]  (is_deadline only)            assignee_id  app_users.id
//   team_calendar_entries (is_deadline only)           assignee_id  app_users.id
//   board_cards                                        assignee_id  app_users.id
//   marketing_cards.sub_tasks[]                        owner_id     Clerk ID
//   canvas_items.sub_tasks[] (kind 'todo')             owner_id     Clerk ID
//
// Every row comes out as:
//   { key, text, due, source, sourceLabel, completable, ref }
//     key         — stable across renders, safe to use as a DOM data attribute
//     due         — 'YYYY-MM-DD' or null
//     completable — whether ticking the row can be written back to the source
//     ref         — the ids the dashboard needs to save that tick and to
//                   deep-link to where the task actually lives
//
// Everything here is pure — unit-tested in assigned-tasks.test.js.

// A kanban card has no done flag; its column is its status. Cards parked in a
// column the board owner named "Done" (or similar) are finished, so they never
// reach the to-do list. Matched on the first word only, so "Done" and
// "Complete — Q3" drop out but "Doneness review" stays.
const DONE_COLUMN = /^\s*(done|complete|completed|finished)\b/i

const str = v => (typeof v === 'string' ? v.trim() : '')

export function collectAssignedTasks({
  projects = [],
  marketingCards = [],
  canvasChecklists = [],
  boardCards = [],
  ppsPhases = [],
  teamCalendarEntries = [],
  clerkId = null,
  appUserId = null,
} = {}) {
  const rows = []

  // ── Project deliverables (and a retainer's monthly deliverables) ───────────
  // Deliverables are an unkeyed array on the project, so the index is the only
  // handle we have for writing a completion back.
  if (appUserId) {
    for (const p of projects) {
      for (const field of ['deliverables', 'monthly_deliverables']) {
        const arr = Array.isArray(p[field]) ? p[field] : []
        arr.forEach((d, index) => {
          const text = str(d?.text)
          if (!text || d.done || d.assignee_id !== appUserId) return
          rows.push({
            key: `deliverable:${p.id}:${field}:${index}`,
            text,
            due: str(d.due) || null,
            source: 'deliverable',
            sourceLabel: p.name || 'Project',
            completable: true,
            ref: { projectId: p.id, field, index },
          })
        })
      }
    }
  }

  // ── Marketing card sub-tasks ───────────────────────────────────────────────
  if (clerkId) {
    for (const card of marketingCards) {
      const subTasks = Array.isArray(card?.sub_tasks) ? card.sub_tasks : []
      for (const st of subTasks) {
        const text = str(st?.text)
        if (!text || st.done || st.owner_id !== clerkId) continue
        rows.push({
          key: `marketing:${card.id}:${st.id ?? text}`,
          text,
          due: str(st.due_date) || null,
          source: 'marketing',
          sourceLabel: card.title || 'Marketing',
          completable: true,
          ref: { cardId: card.id, taskId: st.id ?? null, text },
        })
      }
    }
  }

  // ── Planning canvas checklist rows ─────────────────────────────────────────
  if (clerkId) {
    for (const item of canvasChecklists) {
      const subTasks = Array.isArray(item?.sub_tasks) ? item.sub_tasks : []
      for (const st of subTasks) {
        const text = str(st?.text)
        if (!text || st.done || st.owner_id !== clerkId) continue
        rows.push({
          key: `canvas:${item.id}:${st.id ?? text}`,
          text,
          due: str(st.due_date) || null,
          source: 'canvas',
          sourceLabel: item.canvas_name || 'Canvas',
          completable: true,
          ref: { itemId: item.id, canvasId: item.canvas_id, taskId: st.id ?? null, text },
        })
      }
    }
  }

  // ── Planning board cards ───────────────────────────────────────────────────
  // Read-only: there's no per-card done flag to write to, so the row links out
  // to the board instead of offering a tick.
  if (appUserId) {
    for (const card of boardCards) {
      const text = str(card?.title)
      if (!text || DONE_COLUMN.test(card.column_name || '')) continue
      rows.push({
        key: `board:${card.id}`,
        text,
        due: str(card.due_date) || null,
        source: 'board',
        sourceLabel: card.board_name || 'Planning board',
        completable: false,
        ref: { cardId: card.id, boardId: card.board_id },
      })
    }
  }

  // ── Post-production deadline blocks ────────────────────────────────────────
  if (appUserId) {
    for (const phase of ppsPhases) {
      const blocks = Array.isArray(phase?.blocks) ? phase.blocks : []
      for (const b of blocks) {
        if (!b?.is_deadline || b.is_complete || b.assignee_id !== appUserId) continue
        const text = str(b.title) || str(phase.name)
        if (!text) continue
        rows.push({
          key: `pps:${phase.id}:${b.id}`,
          text,
          due: str(b.end_date) || null,
          source: 'pps',
          sourceLabel: phase.project_name || phase.name || 'Post production',
          completable: true,
          ref: { phaseId: phase.id, blockId: b.id, projectId: phase.project_id ?? null },
        })
      }
    }
  }

  // ── Team calendar deadlines ────────────────────────────────────────────────
  // Read-only: calendar entries carry no completion state.
  if (appUserId) {
    for (const e of teamCalendarEntries) {
      const text = str(e?.label)
      if (!e?.is_deadline || !text || e.assignee_id !== appUserId) continue
      rows.push({
        key: `calendar:${e.id}`,
        text,
        due: str(e.end_date) || str(e.entry_date) || null,
        source: 'calendar',
        sourceLabel: 'Team calendar',
        completable: false,
        ref: { entryId: e.id },
      })
    }
  }

  return sortByDue(rows)
}

// Soonest first, undated last, then alphabetical so the order never jitters
// between renders for two tasks sharing a date.
export function sortByDue(rows) {
  return [...rows].sort((a, b) => {
    if (a.due !== b.due) {
      if (!a.due) return 1
      if (!b.due) return -1
      return a.due < b.due ? -1 : 1
    }
    return a.text.localeCompare(b.text)
  })
}

// Whole days between today and a 'YYYY-MM-DD' due date, both at local midnight.
// Negative = overdue, 0 = today. Returns null for an unparseable/absent date.
export function daysUntil(due, today = new Date()) {
  if (!due) return null
  const d = new Date(`${due}T00:00:00`)
  if (isNaN(d.getTime())) return null
  const t = new Date(today)
  t.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - t.getTime()) / 86400000)
}

// The little date pill next to each row: { label, tone }.
// tone is 'overdue' | 'today' | 'normal' | 'none'.
export function describeDue(due, today = new Date()) {
  const days = daysUntil(due, today)
  if (days === null) return { label: '', tone: 'none' }
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'overdue' }
  if (days === 0) return { label: 'Today', tone: 'today' }
  const d = new Date(`${due}T00:00:00`)
  return { label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), tone: 'normal' }
}
