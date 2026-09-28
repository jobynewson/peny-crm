// api/_legacy-deliverables.js
// The deliverables stored as JSON on projects (projects.deliverables and, on
// retainers, projects.monthly_deliverables). They're being replaced by the
// worklist tables; until then this is the ONE server-side reader of that
// JSON — the what's-due feed and portal token links both come through here.
// When the JSON is retired, delete this file and the two call sites.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { toDateString } from './_dates.js'

const list = v => {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : [] } catch { return [] } }
  return []
}

// A project's deliverables as plain records, in stored order, skipping empty
// rows. `monthly` adds the monthly ones (only meaningful on a retainer).
//   → [{ source: 'deliverables' | 'monthly_deliverables', index, text, due, done, assignee_id, link }]
export function legacyDeliverables(project, { monthly = false } = {}) {
  const sets = [['deliverables', project.deliverables], ...(monthly ? [['monthly_deliverables', project.monthly_deliverables]] : [])]
  const out = []
  for (const [source, items] of sets) {
    list(items).forEach((d, index) => {
      if (!d || typeof d !== 'object' || !d.text) return
      out.push({
        source, index,
        text: String(d.text),
        due: d.due ? toDateString(d.due) : null,
        done: !!d.done,
        assignee_id: d.assignee_id || null,
        link: typeof d.link === 'string' && /^https?:\/\//i.test(d.link) ? d.link : null,
      })
    })
  }
  return out
}
