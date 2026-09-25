// Kanban boards on phones: one column at a time, picked with a segmented
// status control above the board, instead of side-scrolling columns. On
// wider screens the control is hidden (CSS) and every column shows as usual.
// Used by the Projects pipeline, the Marketing kanban and Planning boards.

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The column each board last showed, for this session (boards re-render
// often, e.g. on every sync, and should stay on the same column).
const picked = new Map()

/**
 * @param {HTMLElement | null} board  the element whose children are the columns
 * @param {{ key: string, colAttr: string, columns: { key: string, label: string, count: number }[] }} opts
 *   key identifies the board; colAttr is the attribute on each column
 *   element that holds its key.
 */
export function mountStatusSwitch(board, { key, colAttr, columns }) {
  if (!board || !columns.length) return
  let current = picked.get(key)
  if (!columns.some(c => c.key === current)) current = columns[0].key

  const bar = document.createElement('div')
  bar.className = 'seg board-status'
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', 'Show column')
  bar.innerHTML = columns.map(c =>
    `<button type="button" class="seg-btn" data-status="${esc(c.key)}">${esc(c.label)} <span class="seg-count">${c.count}</span></button>`).join('')
  board.before(bar)
  board.classList.add('board--switchable')

  const cols = [...board.children].filter(el => el.hasAttribute(colAttr))
  const apply = () => {
    cols.forEach(el => el.classList.toggle('is-current', el.getAttribute(colAttr) === current))
    bar.querySelectorAll('[data-status]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === current)))
  }
  cols.forEach(el => el.classList.add('is-col'))
  bar.addEventListener('click', e => {
    const btn = e.target.closest('[data-status]')
    if (!btn) return
    current = btn.dataset.status
    picked.set(key, current)
    apply()
  })
  apply()
}
