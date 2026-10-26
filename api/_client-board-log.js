// api/_client-board-log.js
// A record of staff changes to what a client sees on their deliverables board:
// rounds hidden or shown, a round's link or note edited, a status set by hand.
// Staff read it on the deliverable's Worklist tab; the portal never does.
// Writing it must never fail the change itself, so logChange swallows errors.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

export const LOG_LABELS = {
  round_hidden:   'Took a round off the client’s board',
  round_shown:    'Put a round back on the client’s board',
  round_edited:   'Edited a round',
  status_set:     'Changed the status',
}

export async function logChange(sql, { deliverableId, deliveryId = null, user, action, detail = null }) {
  try {
    await sql`
      INSERT INTO client_board_log (deliverable_id, delivery_id, actor_id, actor_name, action, detail)
      VALUES (${deliverableId}, ${deliveryId}, ${user.id}, ${user.name || user.email || null}, ${action}, ${detail})`
  } catch (err) {
    console.error('[client-board-log] could not record change:', err?.message)
  }
}

export async function loadLog(sql, deliverableId, { limit = 50 } = {}) {
  const rows = await sql`
    SELECT l.id, l.delivery_id, l.actor_name, l.action, l.detail, l.created_at
    FROM client_board_log l
    WHERE l.deliverable_id = ${deliverableId}
    ORDER BY l.created_at DESC
    LIMIT ${limit}`
  return rows.map(r => ({ ...r, label: LOG_LABELS[r.action] ?? r.action }))
}
