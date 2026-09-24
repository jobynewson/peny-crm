// src/utils/planning-tabs.js
// Pure ordering logic for a project's Planning tab strip, which mixes kanban
// boards and canvases. The saved order lives on the project as a list of
// keys ('board:<id>' / 'canvas:<id>'), so one write reorders every tab for
// everyone. Unit-tested in planning-tabs.test.js.

export const tabKey = (kind, id) => `${kind}:${id}`

// Tabs in display order: everything in `order` first (skipping keys whose
// board/canvas no longer exists), then anything not yet ordered — oldest
// first, so a newly created or linked tab lands at the end.
export function orderTabs(boards, canvases, order) {
  const all = [
    ...boards.map(b => ({ key: tabKey('board', b.id), kind: 'board', id: b.id, name: b.name, created_at: b.created_at, row: b })),
    ...canvases.map(c => ({ key: tabKey('canvas', c.id), kind: 'canvas', id: c.id, name: c.name, created_at: c.created_at, row: c })),
  ]
  const byKey = new Map(all.map(t => [t.key, t]))
  const out = []
  const seen = new Set()
  for (const key of Array.isArray(order) ? order : []) {
    const t = byKey.get(key)
    if (t && !seen.has(key)) { out.push(t); seen.add(key) }
  }
  const rest = all
    .filter(t => !seen.has(t.key))
    .sort((a, b) => new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0))
  return [...out, ...rest]
}

// Move `key` to position `toIndex` (0-based, in the list *without* the moved
// tab). Returns a new key list; unknown keys are returned unchanged.
export function moveTab(keys, key, toIndex) {
  const from = keys.indexOf(key)
  if (from === -1) return [...keys]
  const rest = keys.filter(k => k !== key)
  const i = Math.max(0, Math.min(rest.length, toIndex))
  return [...rest.slice(0, i), key, ...rest.slice(i)]
}

// Where a dragged tab should be inserted, given the pointer's x and the
// (left, width) boxes of the OTHER tabs in order: before the first tab whose
// midpoint lies right of the pointer.
export function insertIndex(x, boxes) {
  for (let i = 0; i < boxes.length; i++) {
    if (x < boxes[i].left + boxes[i].width / 2) return i
  }
  return boxes.length
}

// The tab to show: the remembered one if it still exists, else the first.
export function pickActive(tabs, remembered) {
  if (remembered && tabs.some(t => t.key === remembered)) return remembered
  return tabs[0]?.key ?? null
}
