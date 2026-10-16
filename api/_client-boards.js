// api/_client-boards.js
// The Planning boards and canvases a signed-in client company can look at
// (view only). Staff choose them in Share (_board-shares.js); everything here
// starts from the company scope and nothing else:
//   - Every query carries scope.ws and scope.companyId. A board or canvas is
//     only reachable through a board_shares row for that company; a nested
//     canvas through its ROOT's row.
//   - Explicit column lists, and only what a client should see: a canvas
//     card's words, colour, picture, link and checklist ticks (no owners, due
//     dates or entity links); a kanban card's title and description (no
//     assignee, due date, labels, links or recurrence).
//   - Pictures held in the private blob store are never given out as links:
//     they stream through readSharedImage(), after the same check.
// Written for scopes from _worklist.js only: a project link or an Approve link
// has none of this.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { isScope } from './_worklist.js'

const MAX_ITEMS = 2000
const MAX_ARROWS = 4000
const PRIVATE_BLOB = '.private.blob.vercel-storage.com'

const company = scope => {
  if (!isScope(scope) || scope.kind !== 'company') throw new Error('Shared boards are only for a signed-in company scope')
  return scope
}

// → [{ kind, id, name, updated_at }] — what the portal lists.
export async function listSharedBoards(sql, scope) {
  company(scope)
  const [boards, canvases] = await Promise.all([
    sql`
      SELECT b.id, b.name, b.updated_at
      FROM board_shares s JOIN boards b ON b.id = s.board_id
      WHERE s.user_id = ${scope.ws} AND s.company_id = ${scope.companyId} AND b.user_id = ${scope.ws}
    `,
    sql`
      SELECT c.id, c.name, c.updated_at
      FROM board_shares s JOIN canvases c ON c.id = s.canvas_id
      WHERE s.user_id = ${scope.ws} AND s.company_id = ${scope.companyId} AND c.user_id = ${scope.ws} AND c.parent_id IS NULL
    `,
  ])
  return [
    ...boards.map(b => ({ kind: 'board', id: b.id, name: b.name, updated_at: b.updated_at })),
    ...canvases.map(c => ({ kind: 'canvas', id: c.id, name: c.name, updated_at: c.updated_at })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}

// The canvas, from itself up to the root it hangs from, only if the company
// has been given that root. → [{ id, name }] root first, or null.
async function sharedChain(sql, scope, canvasId) {
  const chain = await sql`
    WITH RECURSIVE up AS (
      SELECT c.id, c.parent_id, c.name, 0 AS depth FROM canvases c WHERE c.id = ${canvasId} AND c.user_id = ${scope.ws}
      UNION ALL
      SELECT p.id, p.parent_id, p.name, up.depth + 1 FROM canvases p JOIN up ON p.id = up.parent_id
      WHERE p.user_id = ${scope.ws} AND up.depth < 64
    )
    SELECT up.id, up.parent_id, up.name FROM up
    WHERE EXISTS (SELECT 1 FROM board_shares s WHERE s.user_id = ${scope.ws} AND s.company_id = ${scope.companyId}
                  AND s.canvas_id = (SELECT u.id FROM up u WHERE u.parent_id IS NULL))
    ORDER BY up.depth DESC
  `
  return chain.length ? chain.map(c => ({ id: c.id, name: c.name })) : null
}

const hex = v => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null)
const webUrl = v => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null)

// Where the portal can load a card's picture from: a web address, or (for the
// private store) our own route, which checks the company again.
function imageFor(url, canvasId, itemId) {
  if (typeof url !== 'string' || !url) return null
  if (url.includes(PRIVATE_BLOB)) return `/api/client/boards/canvas/${canvasId}/items/${itemId}/image`
  return webUrl(url)
}

// → the whole canvas for the portal, or null when it isn't shared with this company.
async function readCanvas(sql, scope, canvasId) {
  const chain = await sharedChain(sql, scope, canvasId)
  if (!chain) return null
  const [items, arrows, children] = await Promise.all([
    sql`
      SELECT i.id, i.kind, i.x, i.y, i.w, i.h, i.z, i.content, i.color, i.image_url, i.url, i.sub_tasks, i.child_canvas_id
      FROM canvas_items i JOIN canvases c ON c.id = i.canvas_id
      WHERE i.canvas_id = ${canvasId} AND c.user_id = ${scope.ws}
      ORDER BY i.z, i.created_at
      LIMIT ${MAX_ITEMS}
    `,
    sql`
      SELECT a.id, a.from_item_id, a.to_item_id, a.label
      FROM canvas_arrows a JOIN canvases c ON c.id = a.canvas_id
      WHERE a.canvas_id = ${canvasId} AND c.user_id = ${scope.ws}
      LIMIT ${MAX_ARROWS}
    `,
    sql`SELECT c.id, c.name FROM canvases c WHERE c.parent_id = ${canvasId} AND c.user_id = ${scope.ws}`,
  ])
  const child = new Map(children.map(c => [c.id, c.name]))
  const out = items.map(i => {
    const base = { id: i.id, kind: i.kind, x: i.x, y: i.y, w: i.w, h: i.h, z: i.z }
    switch (i.kind) {
      case 'image': return { ...base, image: imageFor(i.image_url, canvasId, i.id) }
      case 'link':  return { ...base, url: webUrl(i.url), title: i.content || null, image: imageFor(i.image_url, canvasId, i.id) }
      case 'swatch': return { ...base, color: hex(i.color), name: i.content || null }
      case 'todo': return {
        ...base, title: i.content || null,
        rows: (Array.isArray(i.sub_tasks) ? i.sub_tasks : []).map(r => ({ id: String(r?.id ?? ''), text: String(r?.text ?? ''), done: !!r?.done })),
      }
      case 'board': {
        const open = i.child_canvas_id && child.has(i.child_canvas_id) ? i.child_canvas_id : null
        return { ...base, color: hex(i.color), name: i.content || (open ? child.get(open) : null) || 'Board', canvas_id: open }
      }
      default: return { ...base, kind: 'note', text: i.content || '', color: hex(i.color) }
    }
  })
  return {
    kind: 'canvas', id: canvasId, name: chain[chain.length - 1].name,
    path: chain.slice(0, -1),   // root first, not including this canvas
    items: out,
    arrows: arrows.map(a => ({ id: a.id, from: a.from_item_id, to: a.to_item_id, label: a.label || null })),
  }
}

// → a kanban board for the portal, or null when it isn't shared with this company.
async function readKanban(sql, scope, boardId) {
  const [boards, columns, cards] = await Promise.all([
    sql`
      SELECT b.id, b.name FROM boards b
      WHERE b.id = ${boardId} AND b.user_id = ${scope.ws}
        AND EXISTS (SELECT 1 FROM board_shares s WHERE s.user_id = ${scope.ws} AND s.company_id = ${scope.companyId} AND s.board_id = b.id)
    `,
    sql`
      SELECT col.id, col.name, col.color FROM board_columns col JOIN boards b ON b.id = col.board_id
      WHERE col.board_id = ${boardId} AND b.user_id = ${scope.ws}
        AND EXISTS (SELECT 1 FROM board_shares s WHERE s.user_id = ${scope.ws} AND s.company_id = ${scope.companyId} AND s.board_id = b.id)
      ORDER BY col.sort_order, col.created_at
    `,
    sql`
      SELECT k.id, k.column_id, k.title, k.description FROM board_cards k JOIN boards b ON b.id = k.board_id
      WHERE k.board_id = ${boardId} AND b.user_id = ${scope.ws}
        AND EXISTS (SELECT 1 FROM board_shares s WHERE s.user_id = ${scope.ws} AND s.company_id = ${scope.companyId} AND s.board_id = b.id)
      ORDER BY k.position, k.created_at
    `,
  ])
  if (!boards[0]) return null
  return {
    kind: 'board', id: boardId, name: boards[0].name,
    columns: columns.map(c => ({
      id: c.id, name: c.name, color: hex(c.color),
      cards: cards.filter(k => k.column_id === c.id).map(k => ({ id: k.id, title: k.title, description: k.description || null })),
    })),
  }
}

// → the board or canvas for this company, or null (it reads as not found, so a
// board that exists but isn't theirs can't be told apart from one that doesn't).
export async function readSharedBoard(sql, scope, kind, id) {
  company(scope)
  if (kind === 'canvas') return readCanvas(sql, scope, id)
  if (kind === 'board') return readKanban(sql, scope, id)
  return null
}

// → { url } of a picture on a card of a shared canvas, to stream; or null.
export async function readSharedImage(sql, scope, canvasId, itemId) {
  company(scope)
  if (!(await sharedChain(sql, scope, canvasId))) return null
  const [row] = await sql`
    SELECT i.image_url FROM canvas_items i JOIN canvases c ON c.id = i.canvas_id
    WHERE i.id = ${itemId} AND i.canvas_id = ${canvasId} AND c.user_id = ${scope.ws} AND i.kind IN ('image', 'link')
  `
  return row?.image_url && row.image_url.includes(PRIVATE_BLOB) ? { url: row.image_url } : null
}
