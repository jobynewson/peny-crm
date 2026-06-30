// api/_sub-tasks.js
// Pure helpers for the sub-task reminder digest, shared by api/reminders.js and
// unit-tested in _sub-tasks.test.js. A "source" is { title, sub_tasks } where
// each sub-task is { text, owner_id, due_date, done } — the shape used by both
// marketing_cards.sub_tasks and canvas_items.sub_tasks (owner_id is a Clerk ID).

// Whole-day difference (dueDate − today), both floored to local midnight.
// Negative = overdue, 0 = due today, positive = days remaining.
export function daysUntilDue(dueDate, today) {
  const d = new Date(dueDate); d.setHours(0, 0, 0, 0)
  const t = new Date(today); t.setHours(0, 0, 0, 0)
  return Math.round((d - t) / 86400000)
}

// Group due-soon sub-tasks by owner_id, across all sources. A row qualifies
// when it has text, an owner and a due date, isn't done, and is due within
// `windowDays` (overdue rows always included). Returns
//   { [ownerId]: [{ title, text, daysUntil }] }
export function groupDueSubTasks(sources, today, windowDays = 3) {
  const byOwner = {}
  for (const src of (sources || [])) {
    for (const st of (src.sub_tasks || [])) {
      if (!st.text || st.done || !st.due_date || !st.owner_id) continue
      const daysUntil = daysUntilDue(st.due_date, today)
      if (daysUntil > windowDays) continue
      ;(byOwner[st.owner_id] ||= []).push({ title: src.title, text: st.text, daysUntil })
    }
  }
  return byOwner
}
