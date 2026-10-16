// The shared-boards reader's rules, checked by reading its source (every query
// carries the scope, no internal column, nothing interpolated from outside),
// plus the shaping: what a client does and doesn't get on a card.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { companyScope, projectScope } from './_worklist.js'
import { listSharedBoards, readSharedBoard, readSharedImage } from './_client-boards.js'

const SOURCE = fs.readFileSync(new URL('./_client-boards.js', import.meta.url), 'utf8')
const QUERIES = [...SOURCE.matchAll(/sql`([\s\S]*?)`/g)].map(m => m[1])

const ID = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const scope = companyScope({ ws: 'ws_1', companyId: '33333333-3333-4333-8333-333333333333', clerkUserId: 'user_c' })

describe('_client-boards.js queries', () => {
  it('found the queries', () => {
    expect(QUERIES.length).toBeGreaterThanOrEqual(8)
  })

  it('every query carries the workspace, and the company wherever a share is looked up', () => {
    for (const q of QUERIES) {
      expect(q, q).toMatch(/\$\{scope\.ws\}/)
      if (/board_shares/.test(q)) expect(q, q).toMatch(/\$\{scope\.companyId\}/)
    }
  })

  it('only interpolates the scope and the ids from the route', () => {
    for (const q of QUERIES) {
      for (const [, expr] of q.matchAll(/\$\{([^}]*)\}/g)) expect(expr, q).toMatch(/^(scope\.(ws|companyId)|canvasId|boardId|itemId|MAX_ITEMS|MAX_ARROWS)$/)
    }
  })

  it('never selects everything or an internal column', () => {
    for (const q of QUERIES) {
      expect(q, q).not.toMatch(/\bSELECT\s+\*|\w\.\*/i)
      for (const col of ['assignee_id', 'due_date', 'labels', 'links', 'owner_id', 'user_id, ', 'created_by', 'spawned_from', 'updated_by']) {
        expect(q, `${col} in: ${q}`).not.toContain(col)
      }
    }
  })

  it('writes nothing', () => {
    for (const q of QUERIES) expect(q, q).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i)
  })
})

describe('only a signed-in company scope may read boards', () => {
  const sql = async () => { throw new Error('should not query') }
  const link = projectScope({ ws: 'ws_1', projectId: ID })
  it('refuses a project link', async () => {
    await expect(listSharedBoards(sql, link)).rejects.toThrow()
    await expect(readSharedBoard(sql, link, 'canvas', ID)).rejects.toThrow()
    await expect(readSharedImage(sql, link, ID, ITEM)).rejects.toThrow()
  })
  it('refuses anything that is not a scope', async () => {
    await expect(readSharedBoard(sql, { kind: 'company', ws: 'ws_1', companyId: 'x' }, 'canvas', ID)).rejects.toThrow()
  })
})

// A stand-in for the database: answers by what the query says.
function fakeSql(handlers) {
  return async (strings) => {
    const text = strings.join('?')
    for (const [match, rows] of handlers) if (text.includes(match)) return typeof rows === 'function' ? rows(text) : rows
    return []
  }
}

describe('a canvas that is not shared with the company', () => {
  it('reads as not found', async () => {
    const sql = fakeSql([['WITH RECURSIVE', []]])
    expect(await readSharedBoard(sql, scope, 'canvas', ID)).toBeNull()
  })
  it('gives no picture either', async () => {
    const sql = fakeSql([['WITH RECURSIVE', []]])
    expect(await readSharedImage(sql, scope, ID, ITEM)).toBeNull()
  })
})

describe('a shared canvas', () => {
  const items = [
    { id: 'n1', kind: 'note', x: 0, y: 0, w: 220, h: 140, z: 1, content: 'Hello', color: '#FFF8C5', image_url: null, url: null, sub_tasks: [], child_canvas_id: null },
    { id: 't1', kind: 'todo', x: 300, y: 0, w: 220, h: 140, z: 2, content: 'To do', color: null, image_url: null, url: null, child_canvas_id: null,
      sub_tasks: [{ id: 'r1', text: 'Pick locations', owner_id: 'user_staff', due_date: '2026-11-01', done: true }] },
    { id: 'i1', kind: 'image', x: 0, y: 200, w: 200, h: 200, z: 3, content: null, color: null, url: null, sub_tasks: [], child_canvas_id: null,
      image_url: 'https://abc.private.blob.vercel-storage.com/x.png' },
    { id: 'i2', kind: 'image', x: 0, y: 500, w: 200, h: 200, z: 4, content: null, color: null, url: null, sub_tasks: [], child_canvas_id: null, image_url: 'javascript:alert(1)' },
    { id: 'l1', kind: 'link', x: 300, y: 200, w: 240, h: 100, z: 5, content: 'Brief', color: null, image_url: null, url: 'javascript:alert(1)', sub_tasks: [], child_canvas_id: null },
    { id: 'b1', kind: 'board', x: 600, y: 0, w: 200, h: 160, z: 6, content: null, color: '#10B981', image_url: null, url: null, sub_tasks: [], child_canvas_id: 'child-1' },
    { id: 'b2', kind: 'board', x: 600, y: 300, w: 200, h: 160, z: 7, content: 'Elsewhere', color: null, image_url: null, url: null, sub_tasks: [], child_canvas_id: 'not-a-child' },
  ]
  const sql = fakeSql([
    ['WITH RECURSIVE', [{ id: 'root', name: 'Root' }, { id: ID, name: 'Shoot plan' }].map(c => ({ ...c, parent_id: null }))],
    ['FROM canvas_items', items],
    ['FROM canvas_arrows', [{ id: 'a1', from_item_id: 'n1', to_item_id: 't1', label: 'then' }]],
    ['WHERE c.parent_id', [{ id: 'child-1', name: 'Day one' }]],
  ])

  it('gives the client what it needs and nothing internal', async () => {
    const { board } = { board: await readSharedBoard(sql, scope, 'canvas', ID) }
    expect(board.name).toBe('Shoot plan')
    expect(board.path).toEqual([{ id: 'root', name: 'Root' }])
    const note = board.items.find(i => i.id === 'n1')
    expect(note).toMatchObject({ kind: 'note', text: 'Hello', color: '#FFF8C5' })
    const todo = board.items.find(i => i.id === 't1')
    expect(todo.rows).toEqual([{ id: 'r1', text: 'Pick locations', done: true }])
    expect(JSON.stringify(board)).not.toMatch(/user_staff|2026-11-01|owner|due/)
    expect(board.arrows).toEqual([{ id: 'a1', from: 'n1', to: 't1', label: 'then' }])
  })

  it('serves private pictures only through the checked route, and drops unsafe addresses', async () => {
    const board = await readSharedBoard(sql, scope, 'canvas', ID)
    expect(board.items.find(i => i.id === 'i1').image).toBe(`/api/client/boards/canvas/${ID}/items/i1/image`)
    expect(JSON.stringify(board)).not.toContain('blob.vercel-storage.com')
    expect(board.items.find(i => i.id === 'i2').image).toBeNull()
    expect(board.items.find(i => i.id === 'l1').url).toBeNull()
  })

  it('opens a nested board only when it really is inside this canvas', async () => {
    const board = await readSharedBoard(sql, scope, 'canvas', ID)
    expect(board.items.find(i => i.id === 'b1')).toMatchObject({ name: 'Day one', canvas_id: 'child-1' })
    expect(board.items.find(i => i.id === 'b2')).toMatchObject({ name: 'Elsewhere', canvas_id: null })
  })
})

describe('a shared kanban board', () => {
  const sql = fakeSql([
    ['FROM boards b\n      WHERE', [{ id: ID, name: 'Production' }]],
    ['FROM board_columns', [{ id: 'c1', name: 'To do', color: '#8590A2' }, { id: 'c2', name: 'Done', color: 'not a colour' }]],
    ['FROM board_cards', [{ id: 'k1', column_id: 'c1', title: 'Book crew', description: 'Two operators' }, { id: 'k2', column_id: 'c1', title: 'Recce', description: null }]],
  ])
  it('gives columns with their cards: title and description only', async () => {
    const board = await readSharedBoard(sql, scope, 'board', ID)
    expect(board.columns).toHaveLength(2)
    expect(board.columns[0].cards).toEqual([{ id: 'k1', title: 'Book crew', description: 'Two operators' }, { id: 'k2', title: 'Recce', description: null }])
    expect(board.columns[1]).toMatchObject({ name: 'Done', color: null, cards: [] })
  })
  it('reads as not found when it is not shared', async () => {
    expect(await readSharedBoard(fakeSql([]), scope, 'board', ID)).toBeNull()
  })
})

describe('the list', () => {
  it('names boards and canvases together, A to Z', async () => {
    const sql = fakeSql([
      ['JOIN boards b', [{ id: 'b', name: 'Zebra', updated_at: 'x' }]],
      ['JOIN canvases c', [{ id: 'c', name: 'apple', updated_at: 'y' }]],
    ])
    expect((await listSharedBoards(sql, scope)).map(b => `${b.kind}:${b.name}`)).toEqual(['canvas:apple', 'board:Zebra'])
  })
})
