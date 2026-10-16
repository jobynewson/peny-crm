// src/portal/boards.js
// Planning boards and canvases Peny has shared with the company, for looking
// at. The list comes with the view (view.boards); a board is fetched when it is
// opened (GET /api/client/boards/:kind/:id) and drawn read-only, over the page:
//   - a kanban board: its columns and cards (title and description)
//   - a canvas: notes, pictures, links, checklists, swatches and nested boards
//     joined by arrows, which can be dragged around and zoomed but never edited
// Nothing here can change anything: no editing, no writes. All the maths for
// pan and zoom is src/utils/canvas-math.js, shared with Slate's own canvas.

import { esc } from './util.js'
import {
  clampZoom, zoomAtPoint, fitToItems, wheelIntent, normalizeWheel, wheelZoomFactor,
  connectorBetween, connectorPath, bezierPoint, normalizeHex, readableOn,
} from '../utils/canvas-math.js'

// ── The list on the portal page ──────────────────────────────────────────────

export function boardsHtml(view) {
  const boards = view.boards || []
  if (!boards.length) return ''
  return `
    <section class="pt-boards" aria-labelledby="pt-boards-h">
      <h2 class="pt-boards-title" id="pt-boards-h">Boards <span class="pt-muted">shared by ${esc(view.studio?.name || 'Peny')}</span></h2>
      <ul class="pt-boards-list">
        ${boards.map(b => `
          <li><button type="button" class="pt-board-card" data-open-board="${esc(b.kind)}:${esc(b.id)}">
            <span class="pt-board-glyph" aria-hidden="true">${b.kind === 'canvas' ? '🖼' : '▦'}</span>
            <span class="pt-board-name">${esc(b.name)}</span>
            <span class="pt-board-kind">${b.kind === 'canvas' ? 'Canvas' : 'Board'} · view only</span>
          </button></li>`).join('')}
      </ul>
    </section>`
}

// `api(path)` → JSON; `image(path)` → an object URL for a picture that needs
// the visitor's sign-in to load.
export function bindBoards(root, { api, image }) {
  root.querySelectorAll('[data-open-board]').forEach(btn => btn.addEventListener('click', () => {
    const [kind, id] = btn.dataset.openBoard.split(':')
    openViewer({ kind, id, api, image, returnTo: btn })
  }))
}

// ── The viewer ───────────────────────────────────────────────────────────────

function openViewer({ kind, id, api, image, returnTo }) {
  document.querySelector('.pt-bv')?.remove()
  const el = document.createElement('div')
  el.className = 'pt-bv'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  el.setAttribute('aria-label', 'Shared board')
  el.innerHTML = '<header class="pt-bv-head"></header><div class="pt-bv-body"><p class="pt-muted pt-bv-loading">Loading…</p></div>'
  document.body.appendChild(el)
  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  const urls = []   // object URLs made for pictures, freed on close
  let destroyView = null
  let token = 0     // a newer open() makes an older, slower one stop

  const close = () => {
    destroyView?.()
    urls.forEach(u => URL.revokeObjectURL(u))
    document.removeEventListener('keydown', onKey)
    document.body.style.overflow = previousOverflow
    el.remove()
    returnTo?.focus?.()
  }
  const onKey = e => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)

  async function open(k, i) {
    const mine = ++token
    destroyView?.(); destroyView = null
    const body = el.querySelector('.pt-bv-body')
    body.innerHTML = '<p class="pt-muted pt-bv-loading">Loading…</p>'
    let board
    try {
      board = (await api(`/api/client/boards/${k}/${i}`)).board
    } catch (err) {
      if (mine !== token) return
      head({ name: 'Board', path: [] })
      body.innerHTML = `<p class="pt-muted pt-bv-loading">${err.status === 404 ? 'This board isn’t shared with you any more.' : 'We couldn’t load this board. Please try again.'}</p>`
      return
    }
    if (mine !== token) return
    head(board)
    body.innerHTML = ''
    destroyView = board.kind === 'canvas'
      ? drawCanvas(body, board, { image: async path => { const u = await image(path); urls.push(u); return u }, go: cid => open('canvas', cid) })
      : drawKanban(body, board)
  }

  function head(board) {
    const path = board.path || []
    const up = path[path.length - 1]
    el.querySelector('.pt-bv-head').innerHTML = `
      <button type="button" class="pt-link pt-bv-back" data-bv-back>${up ? `← ${esc(up.name)}` : '← Back'}</button>
      <div class="pt-bv-titles">
        ${path.length ? `<nav class="pt-bv-crumbs" aria-label="Where you are">${path.map(p => `<button type="button" class="pt-link" data-bv-go="${esc(p.id)}">${esc(p.name)}</button><span aria-hidden="true">›</span>`).join('')}</nav>` : ''}
        <h2 class="pt-bv-title">${esc(board.name)}</h2>
      </div>
      <span class="pt-bv-chip">View only</span>
      <button type="button" class="pt-link pt-bv-close" data-bv-close aria-label="Close">✕</button>`
    el.querySelector('[data-bv-back]').addEventListener('click', () => (up ? open('canvas', up.id) : close()))
    el.querySelector('[data-bv-close]').addEventListener('click', close)
    el.querySelectorAll('[data-bv-go]').forEach(b => b.addEventListener('click', () => open('canvas', b.dataset.bvGo)))
  }

  open(kind, id)
  el.querySelector('[data-bv-close]')?.focus()
}

// ── A kanban board ───────────────────────────────────────────────────────────

function drawKanban(host, board) {
  host.innerHTML = board.columns.length ? `
    <div class="pt-kb">
      ${board.columns.map(col => `
        <section class="pt-kb-col" aria-label="${esc(col.name)}">
          <h3 class="pt-kb-head"><span class="pt-kb-dot" style="background:${normalizeHex(col.color) || 'var(--border-strong)'}"></span>${esc(col.name)} <span class="pt-muted">${col.cards.length}</span></h3>
          <ul class="pt-kb-cards">
            ${col.cards.map(c => `<li class="pt-kb-card"><div class="pt-kb-title">${esc(c.title)}</div>${c.description ? `<div class="pt-kb-desc">${esc(c.description)}</div>` : ''}</li>`).join('') || '<li class="pt-muted pt-kb-empty">Nothing here</li>'}
          </ul>
        </section>`).join('')}
    </div>` : '<p class="pt-muted pt-bv-loading">This board has no columns yet.</p>'
  return null
}

// ── A canvas ─────────────────────────────────────────────────────────────────

const NOTE_FALLBACK = '#FFF8C5'
const BOARD_FALLBACK = '#4F46E5'
const displayUrl = url => String(url ?? '').replace(/^https?:\/\//i, '').replace(/\/$/, '')

function itemHtml(it) {
  const style = `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;z-index:${Math.round(it.z) || 0}`
  const wrap = (cls, inner, extra = '') => `<div class="pt-cv-item ${cls}" data-item="${esc(it.id)}" style="${style}${extra}">${inner}</div>`
  if (it.kind === 'image') return wrap('pt-cv-image', it.image ? `<img alt="" data-src="${esc(it.image)}" draggable="false">` : '')
  if (it.kind === 'link') {
    return wrap('pt-cv-link', `
      <div class="pt-cv-thumb">${it.image ? `<img alt="" data-src="${esc(it.image)}" draggable="false">` : `<span>${esc(displayUrl(it.url).charAt(0).toUpperCase() || '🔗')}</span>`}</div>
      <div class="pt-cv-link-meta">
        <div class="pt-cv-link-title">${esc(it.title || displayUrl(it.url))}</div>
        ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" data-no-pan>${esc(displayUrl(it.url))}</a>` : ''}
      </div>`)
  }
  if (it.kind === 'todo') {
    const done = it.rows.filter(r => r.done).length
    return wrap('pt-cv-todo', `
      <div class="pt-cv-todo-head"><strong>${esc(it.title || 'Checklist')}</strong><span>${it.rows.length ? `${done}/${it.rows.length}` : ''}</span></div>
      <ul>${it.rows.map(r => `<li class="${r.done ? 'is-done' : ''}"><span aria-hidden="true">${r.done ? '☑' : '☐'}</span> ${esc(r.text)}</li>`).join('')}</ul>`)
  }
  if (it.kind === 'swatch') {
    const hex = normalizeHex(it.color) || '#4F46E5'
    return wrap('pt-cv-swatch', `
      <div class="pt-cv-chip" style="background:${hex};color:${readableOn(hex)}">${hex}</div>
      <div class="pt-cv-swatch-name">${esc(it.name || 'Colour')}</div>`)
  }
  if (it.kind === 'board') {
    const color = normalizeHex(it.color) || BOARD_FALLBACK
    return wrap('pt-cv-board', `
      <div class="pt-cv-board-tile" style="background:${color};color:${readableOn(color)}">▦</div>
      <div class="pt-cv-board-meta"><div class="pt-cv-board-name">${esc(it.name)}</div>
        ${it.canvas_id ? `<button type="button" class="pt-link" data-open-nested="${esc(it.canvas_id)}" data-no-pan>Open ›</button>` : ''}</div>`)
  }
  const bg = normalizeHex(it.color) || NOTE_FALLBACK
  return wrap('pt-cv-note', `<div class="pt-cv-note-text">${esc(it.text)}</div>`, `;background:${bg}`)
}

function drawCanvas(host, board, { image, go }) {
  host.innerHTML = `
    <div class="pt-cv" tabindex="0" aria-label="${esc(board.name)}: drag to move around, pinch or use the buttons to zoom">
      <div class="pt-cv-layer">
        <svg class="pt-cv-arrows" width="1" height="1" style="overflow:visible"><defs>
          <marker id="pt-cv-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker>
        </defs></svg>
        ${board.items.map(itemHtml).join('')}
      </div>
      <div class="pt-cv-controls">
        <button type="button" class="pt-btn" data-zoom="in" aria-label="Zoom in">+</button>
        <button type="button" class="pt-btn" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" class="pt-btn" data-zoom="fit" aria-label="Fit everything">Fit</button>
      </div>
      ${board.items.length ? '' : '<p class="pt-muted pt-cv-empty">This canvas is empty.</p>'}
    </div>`
  const view = host.querySelector('.pt-cv')
  const layer = host.querySelector('.pt-cv-layer')

  // Arrows, drawn between the cards they join.
  const byId = new Map(board.items.map(i => [i.id, i]))
  const svg = layer.querySelector('svg')
  const NS = 'http://www.w3.org/2000/svg'
  for (const a of board.arrows) {
    const from = byId.get(a.from), to = byId.get(a.to)
    if (!from || !to) continue
    const c = connectorBetween(from, to)
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', connectorPath(c))
    path.setAttribute('class', 'pt-cv-arrow')
    path.setAttribute('marker-end', 'url(#pt-cv-head)')
    svg.appendChild(path)
    if (a.label) {
      const mid = bezierPoint(c, 0.5)
      const label = document.createElement('div')
      label.className = 'pt-cv-arrow-label'
      label.style.left = `${mid.x}px`
      label.style.top = `${mid.y}px`
      label.textContent = a.label
      layer.appendChild(label)
    }
  }

  // Pictures that need the visitor's sign-in are fetched with it.
  let alive = true
  layer.querySelectorAll('img[data-src]').forEach(async img => {
    const src = img.dataset.src
    try { const url = src.startsWith('/api/') ? await image(src) : src; if (alive) img.src = url } catch { img.closest('.pt-cv-item')?.classList.add('is-broken') }
  })
  layer.querySelectorAll('[data-open-nested]').forEach(b => b.addEventListener('click', () => go(b.dataset.openNested)))

  // Pan and zoom.
  let vp = { zoom: 1, panX: 0, panY: 0 }
  const apply = () => { layer.style.transform = `translate(${vp.panX}px, ${vp.panY}px) scale(${vp.zoom})` }
  const size = () => ({ width: view.clientWidth, height: view.clientHeight })
  const fit = () => { vp = fitToItems(board.items, size(), 40); apply() }
  const zoomBy = (factor, at = { x: view.clientWidth / 2, y: view.clientHeight / 2 }) => { vp = zoomAtPoint(vp, at, clampZoom(vp.zoom * factor)); apply() }
  const local = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  fit()

  host.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
    const z = b.dataset.zoom
    if (z === 'fit') fit(); else zoomBy(z === 'in' ? 1.25 : 0.8)
  }))

  const pointers = new Map()
  let pinch = null
  view.addEventListener('pointerdown', e => {
    if (e.target.closest('[data-no-pan]')) return
    pointers.set(e.pointerId, local(e))
    view.setPointerCapture?.(e.pointerId)
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y) }
    view.classList.add('is-panning')
  })
  view.addEventListener('pointermove', e => {
    const was = pointers.get(e.pointerId)
    if (!was) return
    const now = local(e)
    pointers.set(e.pointerId, now)
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch) zoomBy(d / pinch, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      pinch = d
    } else {
      vp = { ...vp, panX: vp.panX + now.x - was.x, panY: vp.panY + now.y - was.y }
      apply()
    }
  })
  const lift = e => { pointers.delete(e.pointerId); pinch = null; if (!pointers.size) view.classList.remove('is-panning') }
  view.addEventListener('pointerup', lift)
  view.addEventListener('pointercancel', lift)
  view.addEventListener('wheel', e => {
    e.preventDefault()
    const d = normalizeWheel(e)
    if (wheelIntent(e) === 'zoom') zoomBy(wheelZoomFactor(d.y, e.ctrlKey), local(e))
    else { vp = { ...vp, panX: vp.panX - d.x, panY: vp.panY - d.y }; apply() }
  }, { passive: false })
  view.addEventListener('keydown', e => {
    const step = 60
    if (e.key === 'ArrowLeft') vp = { ...vp, panX: vp.panX + step }
    else if (e.key === 'ArrowRight') vp = { ...vp, panX: vp.panX - step }
    else if (e.key === 'ArrowUp') vp = { ...vp, panY: vp.panY + step }
    else if (e.key === 'ArrowDown') vp = { ...vp, panY: vp.panY - step }
    else if (e.key === '+' || e.key === '=') return zoomBy(1.25)
    else if (e.key === '-') return zoomBy(0.8)
    else return
    e.preventDefault(); apply()
  })
  return () => { alive = false }
}
