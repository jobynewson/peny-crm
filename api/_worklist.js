// api/_worklist.js
// Recording a response on a delivery — approve, or request changes — is the
// one write the Peny side and the client portal share. Both come through
// respondToDelivery(), so the rule (api/_retainer-rules.js) is applied one way
// whoever answers: a client in the portal, or a Peny user recording an
// approval that came by email.
//
// Scopes decide which deliveries a caller can reach. They are made ONLY by the
// constructors below, from values the server already trusts (the workspace;
// in the portal, the company linked to the caller's Clerk organisation) and
// never from request input. respondToDelivery() refuses anything else, and
// each kind of scope has its own complete SQL with the scope's conditions
// inside the statement that writes, so there is no gap between checking and
// writing, and a delivery outside the scope reads as not found.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import {
  RESPONSES, statusAfterResponse, statusPatch, validateResponse, isUuid,
} from './_retainer-rules.js'

// Only the objects the constructors made count as scopes — not copies
// (`{ ...scope, ws: other }`) and not look-alikes — and they're frozen.
const SCOPES = new WeakSet()
const made = scope => { SCOPES.add(Object.freeze(scope)); return scope }
export const isScope = s => typeof s === 'object' && s !== null && SCOPES.has(s)

// Peny staff: every worklist in the workspace.
export function staffScope(ws) {
  if (typeof ws !== 'string' || !ws) throw new Error('staffScope needs the workspace id')
  return made({ kind: 'staff', ws })
}

// { delivery } on success, or { error: { status, code, message, field? } }.
//   deliveryId — from the route (already a uuid)
//   input      — the request body: { response, comment }
//   by         — who is answering: { clerkId, name }
export async function respondToDelivery(sql, scope, { deliveryId, input, by }) {
  if (!isScope(scope)) throw new Error('respondToDelivery needs a scope from _worklist.js')
  if (!isUuid(deliveryId)) return notFound()

  const bad = validateResponse(input)
  if (bad) return { error: { status: 422, code: 'validation_failed', ...bad } }
  const response = input.response
  const comment = typeof input.comment === 'string' && input.comment.trim() ? input.comment.trim() : null
  if (!RESPONSES.includes(response)) return notFound()   // unreachable after validation

  if (scope.kind === 'staff') return respondAsStaff(sql, scope, { deliveryId, response, comment, by })
  throw new Error(`Unknown scope kind: ${scope.kind}`)
}

const notFound = () => ({ error: { status: 404, code: 'not_found', message: 'Delivery not found' } })

// Why a response can't be taken, for a delivery the caller can see.
function refusal(row) {
  if (row.round !== row.latest_round) {
    return { status: 409, code: 'superseded', message: 'A newer round has been sent since — respond to that one' }
  }
  if (row.client_response !== 'pending') {
    return { status: 409, code: 'already_answered', message: 'This round has already been answered' }
  }
  return null
}

async function respondAsStaff(sql, scope, { deliveryId, response, comment, by }) {
  const [row] = await sql`
    SELECT dv.id, dv.round, dv.client_response, d.status,
           (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id) AS latest_round
    FROM deliveries dv
    JOIN deliverables d ON d.id = dv.deliverable_id
    JOIN workstreams w ON w.id = d.workstream_id
    WHERE dv.id = ${deliveryId} AND w.user_id = ${scope.ws}
  `
  if (!row) return notFound()
  const refused = refusal(row)
  if (refused) return { error: refused }

  const patch = statusPatch({ from: row.status, to: statusAfterResponse(response) })
  const [done] = await sql`
    WITH target AS (
      SELECT dv.id
      FROM deliveries dv
      JOIN deliverables d ON d.id = dv.deliverable_id
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE dv.id = ${deliveryId} AND w.user_id = ${scope.ws}
        AND dv.client_response = 'pending'
        AND d.status = ${row.status}::deliverable_status
        AND dv.round = (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id)
      FOR UPDATE OF dv, d
    ), answered AS (
      UPDATE deliveries SET
        client_response   = ${response}::delivery_response,
        client_comment    = ${comment},
        responded_at      = NOW(),
        responded_by      = ${by.clerkId},
        responded_by_name = ${by.name}
      FROM target WHERE deliveries.id = target.id
      RETURNING deliveries.id, deliveries.deliverable_id
    )
    UPDATE deliverables SET
      status        = ${patch.status}::deliverable_status,
      waiting_since = CASE WHEN ${'waiting_since' in patch} THEN ${patch.waiting_since ?? null}::timestamptz ELSE waiting_since END,
      waiting_note  = CASE WHEN ${'waiting_note' in patch} THEN ${patch.waiting_note ?? null}::text ELSE waiting_note END,
      updated_at    = NOW()
    FROM answered WHERE deliverables.id = answered.deliverable_id
    RETURNING answered.id AS delivery_id, deliverables.id AS deliverable_id
  `
  if (!done) return { error: { status: 409, code: 'conflict', message: 'This changed while you were answering — refresh and try again' } }
  return { delivery: { id: done.delivery_id, deliverable_id: done.deliverable_id } }
}
