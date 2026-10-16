// api/_board-shares.js
// Staff routes behind /api/board-shares (see board-shares.js): which client
// companies see a Planning board or canvas in their portal, view only.
//   GET /api/board-shares/:kind/:id   → { companies: [{ id, name }] }
//   PUT /api/board-shares/:kind/:id   { company_ids: [uuid, …] } → the same.
//     Replaces the whole set; an empty list stops sharing.
// :kind is 'board' (a kanban board) or 'canvas' (a ROOT canvas: one nested in
// another comes with its parent and is never shared on its own). Editors only.
// The portal reads these through _client-boards.js.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { UUID, fail, invalid, readBody, workspaceId } from './_api.js'

export const MAX_COMPANIES = 50

export const ROUTES = [
  { method: 'GET', pattern: new RegExp(`^board-shares/(?<kind>board|canvas)/(?<id>${UUID})$`), handler: getShares, access: 'editor' },
  { method: 'PUT', pattern: new RegExp(`^board-shares/(?<kind>board|canvas)/(?<id>${UUID})$`), handler: setShares, access: 'editor' },
]

// The board or root canvas in this workspace, or null.
async function findItem(sql, ws, kind, id) {
  const rows = kind === 'board'
    ? await sql`SELECT id FROM boards WHERE id = ${id} AND user_id = ${ws} LIMIT 1`
    : await sql`SELECT id FROM canvases WHERE id = ${id} AND user_id = ${ws} AND parent_id IS NULL LIMIT 1`
  return rows[0] ?? null
}

async function sharedWith(sql, ws, kind, id) {
  return kind === 'board'
    ? sql`SELECT c.id, c.name FROM board_shares s JOIN companies c ON c.id = s.company_id
          WHERE s.board_id = ${id} AND s.user_id = ${ws} AND c.user_id = ${ws} ORDER BY lower(c.name)`
    : sql`SELECT c.id, c.name FROM board_shares s JOIN companies c ON c.id = s.company_id
          WHERE s.canvas_id = ${id} AND s.user_id = ${ws} AND c.user_id = ${ws} ORDER BY lower(c.name)`
}

async function getShares(req, res, { sql, params }) {
  const ws = await workspaceId(sql)
  if (!(await findItem(sql, ws, params.kind, params.id))) return fail(res, 404, 'not_found', 'Board not found')
  return res.status(200).json({ companies: await sharedWith(sql, ws, params.kind, params.id) })
}

async function setShares(req, res, { sql, user, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const ids = body.company_ids
  if (!Array.isArray(ids) || ids.length > MAX_COMPANIES || ids.some(x => typeof x !== 'string' || !new RegExp(`^${UUID}$`).test(x))) {
    return invalid(res, 'company_ids', 'Choose companies from the list')
  }
  const wanted = [...new Set(ids.map(x => x.toLowerCase()))]

  const ws = await workspaceId(sql)
  if (!(await findItem(sql, ws, params.kind, params.id))) return fail(res, 404, 'not_found', 'Board not found')
  if (wanted.length) {
    const found = await sql`SELECT id FROM companies WHERE user_id = ${ws} AND id = ANY(${wanted}::uuid[])`
    if (found.length !== wanted.length) return invalid(res, 'company_ids', 'One of those companies no longer exists')
  }

  // Drop the ones no longer wanted, add the new ones; the rest are untouched
  // (so who shared it first and when is kept).
  if (params.kind === 'board') {
    await sql`DELETE FROM board_shares WHERE board_id = ${params.id} AND user_id = ${ws} AND NOT (company_id = ANY(${wanted}::uuid[]))`
    if (wanted.length) {
      await sql`INSERT INTO board_shares (user_id, company_id, board_id, created_by)
                SELECT ${ws}, c, ${params.id}, ${user.clerk_id} FROM unnest(${wanted}::uuid[]) AS c
                ON CONFLICT (board_id, company_id) WHERE board_id IS NOT NULL DO NOTHING`
    }
  } else {
    await sql`DELETE FROM board_shares WHERE canvas_id = ${params.id} AND user_id = ${ws} AND NOT (company_id = ANY(${wanted}::uuid[]))`
    if (wanted.length) {
      await sql`INSERT INTO board_shares (user_id, company_id, canvas_id, created_by)
                SELECT ${ws}, c, ${params.id}, ${user.clerk_id} FROM unnest(${wanted}::uuid[]) AS c
                ON CONFLICT (canvas_id, company_id) WHERE canvas_id IS NOT NULL DO NOTHING`
    }
  }
  return res.status(200).json({ companies: await sharedWith(sql, ws, params.kind, params.id) })
}
