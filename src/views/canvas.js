// src/views/canvas.js
// Planning canvas — lightweight moodboard: sticky notes, images and straight
// arrows. Item positions are stored in canvas space; the viewport applies a
// single CSS transform (translate + scale). Coordinate maths lives in
// src/utils/canvas-math.js (unit-tested). Near-realtime sync uses the same
// short-interval polling pattern as planning boards.

import {
  getCanvases, createCanvas, updateCanvas, deleteCanvas, getCanvasData, getCanvasForProject,
  createCanvasItem, updateCanvasItem, deleteCanvasItem,
  createCanvasArrow, deleteCanvasArrow,
} from '../db/client.js'
import {
  clampZoom, screenToCanvas, zoomAtPoint, dragDeltaToCanvas, fitToItems, arrowEndpoints,
} from '../utils/canvas-math.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const NOTE_COLORS = ['#FFF8C5', '#DCEBFE', '#DCFCE7', '#FCE7F3', '#F3E8FF', '#FFEAD5']
const POLL_MS = 4000

const LINK_TYPES = [
  { id: 'client',  label: 'Client',  icon: '👤', color: '#a78bfa' },
  { id: 'project', label: 'Project', icon: '🎬', color: '#4a90d9' },
  { id: 'budget',  label: 'Budget',  icon: '£',  color: '#6ec96e' },
]

const inputStyle = 'font-size:13px;padding:6px 9px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none'
const labelStyle = 'font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px'

function imgSrc(url) {
  if (!url) return ''
  if (url.includes('.private.blob.vercel-storage.com')) {
    return `/api/blob?url=${encodeURIComponent(url)}`
  }
  return esc(url)
}

// A tidy display form for a link card's URL — protocol and trailing slash off.
function displayUrl(url) {
  return String(url ?? '').replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

export class CanvasView {
  constructor(app) {
    this.app = app
    this.currentId = null
    this.canvas = null
    this.items = []
    this.arrows = []
    this.viewport = { panX: 0, panY: 0, zoom: 1 }
    this.mode = 'select'        // select | arrow
    this._arrowFromId = null
    this._editingId = null      // note currently in text-edit mode
    this._canvases = null       // list cache
    this._pollTimer = null
    this._snapshot = null
    this._interacting = false   // pointer drag/pan/resize in progress
    this._writes = 0
  }

  get canEdit() { return this.app.permissions?.projects_edit !== false }

  // ── List (rendered inside the Planning view's Canvases tab) ─────────────────

  async renderList(mc) {
    mc.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading canvases…</div>'
    try {
      this._canvases = await getCanvases(this.app.userId)
    } catch (e) {
      console.error(e)
      mc.innerHTML = '<div class="empty-state" style="padding-top:60px">Could not load canvases.</div>'
      return
    }
    const list = this._canvases

    if (!list.length) {
      mc.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:45vh;gap:14px;text-align:center">
          <div style="font-size:36px">🖼</div>
          <div style="font-size:16px;font-weight:500">No canvases yet</div>
          <div style="font-size:13px;color:var(--text-tertiary);max-width:340px;line-height:1.6">A canvas is a free-form space for sticky notes, images and arrows — moodboards and visual planning.</div>
          ${this.canEdit ? '<button class="btn-primary" id="cv-empty-new" style="margin-top:4px">+ Create first canvas</button>' : ''}
        </div>`
      mc.querySelector('#cv-empty-new')?.addEventListener('click', () => this.openNewCanvasModal())
      return
    }

    mc.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;max-width:680px">
        ${list.map(c => {
          const proj = c.project_id ? this.app.projects.find(p => p.id === c.project_id) : null
          return `
          <div class="bd-list-row" data-canvas-id="${c.id}">
            <span style="font-size:15px;flex-shrink:0">🖼</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:550;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px">${proj ? `Linked to ${esc(proj.name)}` : 'Standalone'}</div>
            </div>
            <span style="font-size:11px;color:var(--text-tertiary);flex-shrink:0">${new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>`
        }).join('')}
      </div>`
    mc.querySelectorAll('[data-canvas-id]').forEach(row => {
      row.addEventListener('click', () => this.openCanvas(row.dataset.canvasId))
    })
  }

  openCanvas(id) {
    this.currentId = id
    this.app.boardsView.currentId = null
    this.app._pushAppState(`#planning/canvas/${id}`, { view: 'planning', canvasId: id })
    this.app.render()
  }

  openNewCanvasModal(projectId = null) {
    document.getElementById('cv-new-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'cv-new-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'
    overlay.innerHTML = `
      <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:380px;padding:20px" onclick="event.stopPropagation()">
        <div style="font-size:14px;font-weight:600;margin-bottom:14px">New canvas</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input id="cv-new-name" placeholder="Canvas name…" maxlength="120" style="${inputStyle}">
          ${projectId ? '' : `
          <select id="cv-new-project" style="${inputStyle}">
            <option value="">Standalone (no project)</option>
            ${this.app.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select>`}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button class="btn-cancel" id="cv-new-cancel">Cancel</button>
          <button class="btn-primary" id="cv-new-save">Create canvas</button>
        </div>
      </div>`
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    const nameEl = overlay.querySelector('#cv-new-name')
    setTimeout(() => nameEl?.focus(), 10)
    const save = async () => {
      const name = nameEl?.value.trim()
      if (!name) { nameEl?.focus(); return }
      const project_id = projectId || overlay.querySelector('#cv-new-project')?.value || null
      try {
        const canvas = await createCanvas(this.app.userId, { name, project_id })
        this._canvases = null
        overlay.remove()
        this.app.toast('Canvas created')
        if (this.app.currentView === 'planning') this.openCanvas(canvas.id)
        else this.app.render()
      } catch (e) { console.error(e); this.app.toast('Error creating canvas') }
    }
    overlay.querySelector('#cv-new-cancel')?.addEventListener('click', () => overlay.remove())
    overlay.querySelector('#cv-new-save')?.addEventListener('click', save)
    nameEl?.addEventListener('keydown', e => { if (e.key === 'Enter') save() })
  }

  // ── Canvas (standalone) ──────────────────────────────────────────────────────

  async render(mc) {
    this._stopPolling()
    mc.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading canvas…</div>'
    try {
      const all = this._canvases ?? await getCanvases(this.app.userId)
      this._canvases = all
      this.canvas = all.find(c => c.id === this.currentId) ?? null
      if (!this.canvas) {
        mc.innerHTML = '<div class="empty-state" style="padding-top:60px">Canvas not found.</div>'
        return
      }
      await this._loadData()
      this.app.updateTitle()
    } catch (e) {
      console.error(e)
      mc.innerHTML = '<div class="empty-state" style="padding-top:60px">Could not load canvas.</div>'
      return
    }

    const proj = this.canvas.project_id ? this.app.projects.find(p => p.id === this.canvas.project_id) : null
    mc.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn-cancel" id="cv-back" style="font-size:12px">← All canvases</button>
        <input id="cv-name" value="${esc(this.canvas.name)}" maxlength="120" ${this.canEdit ? '' : 'disabled'}
          style="flex:1;min-width:140px;font-size:15px;font-weight:600;background:transparent;border:none;outline:none;color:var(--text-primary);font-family:var(--font)">
        ${this.canEdit ? `
          <select id="cv-project" title="Link to project" style="${inputStyle};max-width:180px">
            <option value="">Standalone</option>
            ${this.app.projects.map(p => `<option value="${p.id}"${this.canvas.project_id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
          <button class="btn-cancel" id="cv-delete" style="font-size:12px;color:#e07070">Delete</button>
        ` : (proj ? `<span style="font-size:11px;color:var(--text-tertiary)">Linked to ${esc(proj.name)}</span>` : '')}
      </div>
      <div id="cv-host"></div>`

    mc.querySelector('#cv-back')?.addEventListener('click', () => {
      this.currentId = null; this.canvas = null
      this.app._pushAppState('#planning', { view: 'planning' })
      this.app.render()
    })
    mc.querySelector('#cv-name')?.addEventListener('change', async e => {
      const name = e.target.value.trim()
      if (!name) { e.target.value = this.canvas.name; return }
      try { await updateCanvas(this.app.userId, this.canvas.id, { name }); this.canvas.name = name } catch (err) { console.error(err) }
    })
    mc.querySelector('#cv-project')?.addEventListener('change', async e => {
      try {
        await updateCanvas(this.app.userId, this.canvas.id, { project_id: e.target.value || null })
        this.canvas.project_id = e.target.value || null
        this.app.toast(this.canvas.project_id ? 'Canvas linked to project' : 'Canvas unlinked')
      } catch (err) { console.error(err); this.app.toast('Error linking canvas') }
    })
    mc.querySelector('#cv-delete')?.addEventListener('click', async () => {
      const ok = await this.app.confirm({ title: 'Delete this canvas?', message: 'All notes, images and arrows on it will be deleted.', confirmLabel: 'Delete canvas' })
      if (!ok) return
      try {
        await deleteCanvas(this.app.userId, this.canvas.id)
        this._canvases = null; this.currentId = null; this.canvas = null
        this.app.toast('Canvas deleted')
        this.app._pushAppState('#planning', { view: 'planning' })
        this.app.render()
      } catch (e) { console.error(e); this.app.toast('Error deleting canvas') }
    })

    this._mountCanvas(mc.querySelector('#cv-host'), 'calc(100vh - 190px)')
  }

  // ── Canvas (embedded in a project's Planning tab) ────────────────────────────

  async renderEmbedded(container, project) {
    this._stopPolling()
    container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading canvas…</div>'
    let canvas
    try {
      canvas = await getCanvasForProject(this.app.userId, project.id)
    } catch (e) {
      console.error(e)
      container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Could not load canvas.</div>'
      return
    }

    if (!canvas) {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 0;text-align:center">
          <div style="font-size:32px">🖼</div>
          <div style="font-size:14px;font-weight:500">No canvas for this project yet</div>
          <div style="font-size:12px;color:var(--text-tertiary);max-width:320px;line-height:1.6">A free-form space for sticky notes, images and arrows — moodboarding and visual planning.</div>
          ${this.canEdit ? '<button class="btn-primary" id="cv-emb-create" style="margin-top:2px">+ Create canvas</button>' : ''}
        </div>`
      container.querySelector('#cv-emb-create')?.addEventListener('click', async () => {
        try {
          await createCanvas(this.app.userId, { name: project.name, project_id: project.id })
          this._canvases = null
          this.renderEmbedded(container, project)
        } catch (e) { console.error(e); this.app.toast('Error creating canvas') }
      })
      return
    }

    this.canvas = canvas
    this.currentId = canvas.id
    try { await this._loadData() } catch (e) {
      console.error(e)
      container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Could not load canvas.</div>'
      return
    }

    container.innerHTML = `
      ${this.canEdit ? `
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px">
        <button class="btn-cancel" id="cv-open-standalone" style="font-size:12px">Open full view</button>
      </div>` : ''}
      <div id="cv-host"></div>`
    container.querySelector('#cv-open-standalone')?.addEventListener('click', () => {
      this.app.currentView = 'planning'
      this.app.boardsView.currentId = null
      this.app._pushAppState(`#planning/canvas/${canvas.id}`, { view: 'planning', canvasId: canvas.id })
      this.app.render()
    })
    this._mountCanvas(container.querySelector('#cv-host'), '62vh')
  }

  async _loadData() {
    const { items, arrows } = await getCanvasData(this.currentId)
    this.items = items
    this.arrows = arrows
    this._snapshot = this._serialize(items, arrows)
    try {
      const saved = JSON.parse(localStorage.getItem(`cv-vp-${this.currentId}`) || 'null')
      this.viewport = saved && isFinite(saved.zoom) ? { ...saved, zoom: clampZoom(saved.zoom) } : { panX: 40, panY: 40, zoom: 1 }
    } catch { this.viewport = { panX: 40, panY: 40, zoom: 1 } }
  }

  // ── Canvas surface ───────────────────────────────────────────────────────────

  _mountCanvas(host, height) {
    if (!host) return
    this.mode = 'select'
    this._arrowFromId = null
    this._editingId = null
    host.innerHTML = `
      ${this.canEdit ? `
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
        <button class="btn-cancel cv-tool" id="cv-add-note" style="font-size:12px">✏️ Note</button>
        <button class="btn-cancel cv-tool" id="cv-add-image" style="font-size:12px">🖼 Image</button>
        <button class="btn-cancel cv-tool" id="cv-add-link" style="font-size:12px">🔗 Link</button>
        <button class="btn-cancel cv-tool" id="cv-arrow-mode" style="font-size:12px">→ Arrow</button>
        <span id="cv-mode-hint" style="font-size:11px;color:var(--text-tertiary)"></span>
        <input type="file" id="cv-image-input" accept="image/*" style="display:none">
      </div>` : ''}
      <div class="cv-wrap" id="cv-wrap" style="height:${height}">
        <div class="cv-world" id="cv-world">
          <svg class="cv-arrows" id="cv-arrows" style="overflow:visible;position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none"></svg>
          <div id="cv-items"></div>
        </div>
        <div class="cv-zoom">
          <button id="cv-zoom-out" title="Zoom out">−</button>
          <button id="cv-zoom-reset" title="Reset zoom"><span id="cv-zoom-pct">100%</span></button>
          <button id="cv-zoom-in" title="Zoom in">+</button>
          <button id="cv-zoom-fit" title="Fit to content">⊡</button>
        </div>
      </div>`

    const wrap = host.querySelector('#cv-wrap')
    this._wrap = wrap
    this._renderItems()
    this._applyViewport()
    this._bindToolbar(host)
    this._bindSurface(wrap)
    this._startPolling(wrap)
  }

  _applyViewport() {
    const world = this._wrap?.querySelector('#cv-world')
    if (!world) return
    const { panX, panY, zoom } = this.viewport
    world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`
    const pct = this._wrap.querySelector('#cv-zoom-pct')
    if (pct) pct.textContent = `${Math.round(zoom * 100)}%`
  }

  _saveViewport() {
    try { localStorage.setItem(`cv-vp-${this.currentId}`, JSON.stringify(this.viewport)) } catch {}
  }

  _renderItems() {
    const itemsEl = this._wrap?.querySelector('#cv-items')
    if (!itemsEl) return
    const sorted = [...this.items].sort((a, b) => (a.z - b.z) || (new Date(a.created_at) - new Date(b.created_at)))
    itemsEl.innerHTML = sorted.map(it => this._renderItem(it)).join('')
    this._redrawArrows()
    this._bindItems(itemsEl)
  }

  _renderItem(it) {
    const links = Array.isArray(it.links) ? it.links : []
    const chips = links.map(l => {
      const t = LINK_TYPES.find(x => x.id === l.type)
      const name = this._entityName(l.type, l.id)
      if (!t || !name) return ''
      return `<span class="bd-chip" data-chip-type="${l.type}" data-chip-id="${l.id}" style="color:${t.color};background:${t.color}26">${t.icon} ${esc(name)}</span>`
    }).join('')

    const toolbar = !this.canEdit ? '' : `
      <div class="cv-item-tools">
        ${it.kind === 'note' ? NOTE_COLORS.map(c => `<button class="cv-color-dot" data-color="${c}" style="background:${c}"></button>`).join('') : ''}
        <button class="cv-item-btn" data-item-links title="Links & options">⋯</button>
        <button class="cv-item-btn" data-item-del title="Delete">×</button>
      </div>`

    if (it.kind === 'image') {
      return `
      <div class="cv-item cv-item--image" data-item="${it.id}"
        style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;z-index:${it.z}">
        ${toolbar}
        <img src="${imgSrc(it.image_url)}" alt="" draggable="false" loading="lazy">
        ${chips ? `<div class="cv-item-chips">${chips}</div>` : ''}
        ${this.canEdit ? '<div class="cv-resize" data-resize></div>' : ''}
      </div>`
    }
    if (it.kind === 'link') {
      return `
      <div class="cv-item cv-item--link" data-item="${it.id}"
        style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;z-index:${it.z}">
        ${toolbar}
        <div class="cv-link-body">
          ${it.image_url ? `<div class="cv-link-thumb"><img src="${imgSrc(it.image_url)}" alt="" draggable="false" loading="lazy"></div>` : ''}
          <div class="cv-link-meta">
            <div class="cv-link-title">${esc(it.content || displayUrl(it.url))}</div>
            <a class="cv-link-url" href="${esc(it.url || '#')}" target="_blank" rel="noopener" data-link-open>${esc(displayUrl(it.url))}</a>
          </div>
        </div>
        ${chips ? `<div class="cv-item-chips">${chips}</div>` : ''}
        ${this.canEdit ? '<div class="cv-resize" data-resize></div>' : ''}
      </div>`
    }
    return `
    <div class="cv-item cv-item--note" data-item="${it.id}"
      style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;z-index:${it.z};background:${esc(it.color || NOTE_COLORS[0])}">
      ${toolbar}
      <textarea class="cv-note-text" spellcheck="false" placeholder="Type something…" ${this.canEdit ? '' : 'disabled'}>${esc(it.content || '')}</textarea>
      ${chips ? `<div class="cv-item-chips">${chips}</div>` : ''}
      ${this.canEdit ? '<div class="cv-resize" data-resize></div>' : ''}
    </div>`
  }

  _redrawArrows() {
    const svg = this._wrap?.querySelector('#cv-arrows')
    if (!svg) return
    const byId = Object.fromEntries(this.items.map(i => [i.id, i]))
    svg.innerHTML = `
      <defs>
        <marker id="cv-arrowhead" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
          <polygon points="0 0, 9 3.5, 0 7" fill="var(--text-tertiary)"></polygon>
        </marker>
      </defs>
      ${this.arrows.map(a => {
        const from = byId[a.from_item_id], to = byId[a.to_item_id]
        if (!from || !to) return ''
        const e = arrowEndpoints(from, to)
        return `<line data-arrow="${a.id}" x1="${e.from.x}" y1="${e.from.y}" x2="${e.to.x}" y2="${e.to.y}"
          stroke="var(--text-tertiary)" stroke-width="2" marker-end="url(#cv-arrowhead)"
          style="pointer-events:stroke;cursor:pointer"></line>`
      }).join('')}`

    if (this.canEdit) {
      svg.querySelectorAll('[data-arrow]').forEach(line => {
        line.addEventListener('click', async e => {
          e.stopPropagation()
          const ok = await this.app.confirm({ title: 'Delete this arrow?', confirmLabel: 'Delete arrow' })
          if (!ok) return
          const id = line.dataset.arrow
          try {
            await deleteCanvasArrow(id)
            this.arrows = this.arrows.filter(a => a.id !== id)
            this._snapshot = this._serialize(this.items, this.arrows)
            this._redrawArrows()
          } catch (err) { console.error(err) }
        })
      })
    }
  }

  _entityName(type, id) {
    if (type === 'client') {
      const c = this.app.contacts.find(x => x.id === id)
      return c ? `${c.first_name} ${c.last_name}`.trim() : null
    }
    if (type === 'project') return this.app.projects.find(x => x.id === id)?.name ?? null
    if (type === 'budget') return this.app.budgets.find(x => x.id === id)?.name ?? null
    return null
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────────

  _bindToolbar(host) {
    const hint = host.querySelector('#cv-mode-hint')
    const arrowBtn = host.querySelector('#cv-arrow-mode')
    const setMode = mode => {
      this.mode = mode
      this._arrowFromId = null
      if (arrowBtn) {
        arrowBtn.style.background = mode === 'arrow' ? 'var(--accent)' : ''
        arrowBtn.style.color = mode === 'arrow' ? '#fff' : ''
      }
      if (hint) hint.textContent = mode === 'arrow' ? 'Click the start item, then the end item (Esc to cancel)' : ''
      this._wrap?.classList.toggle('cv-wrap--arrow', mode === 'arrow')
    }
    this._setMode = setMode

    host.querySelector('#cv-add-note')?.addEventListener('click', async () => {
      const wrapRect = this._wrap.getBoundingClientRect()
      const centre = screenToCanvas({ x: wrapRect.width / 2, y: wrapRect.height / 2 }, this.viewport)
      await this._createItem({
        kind: 'note', content: '', color: NOTE_COLORS[0],
        x: Math.round(centre.x - 110 + (Math.random() * 40 - 20)),
        y: Math.round(centre.y - 70 + (Math.random() * 40 - 20)),
        w: 220, h: 140,
      })
    })

    host.querySelector('#cv-arrow-mode')?.addEventListener('click', () => {
      setMode(this.mode === 'arrow' ? 'select' : 'arrow')
    })

    // Image: upload a file or paste a URL
    host.querySelector('#cv-add-image')?.addEventListener('click', () => this._openImageModal(host))
    host.querySelector('#cv-image-input')?.addEventListener('change', e => this._handleImageFile(e))

    // Link: prompt for a URL, fetch a preview, drop a link card
    host.querySelector('#cv-add-link')?.addEventListener('click', () => this._addLinkItem())

    // Zoom controls
    const zoomBy = factor => {
      const rect = this._wrap.getBoundingClientRect()
      this.viewport = zoomAtPoint(this.viewport, { x: rect.width / 2, y: rect.height / 2 }, this.viewport.zoom * factor)
      this._applyViewport(); this._saveViewport()
    }
    host.querySelector('#cv-zoom-in')?.addEventListener('click', () => zoomBy(1.2))
    host.querySelector('#cv-zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.2))
    host.querySelector('#cv-zoom-reset')?.addEventListener('click', () => {
      this.viewport = { ...this.viewport, zoom: 1 }
      this._applyViewport(); this._saveViewport()
    })
    host.querySelector('#cv-zoom-fit')?.addEventListener('click', () => {
      const rect = this._wrap.getBoundingClientRect()
      this.viewport = fitToItems(this.items, { width: rect.width, height: rect.height })
      this._applyViewport(); this._saveViewport()
    })

    // Esc cancels arrow mode
    this._escHandler = e => {
      if (e.key === 'Escape' && this.mode === 'arrow') setMode('select')
    }
    document.addEventListener('keydown', this._escHandler)
  }

  _openImageModal(host) {
    document.getElementById('cv-image-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'cv-image-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'
    overlay.innerHTML = `
      <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:380px;padding:20px" onclick="event.stopPropagation()">
        <div style="font-size:14px;font-weight:600;margin-bottom:14px">Add image</div>
        <button class="btn-primary" id="cvi-upload" style="width:100%;margin-bottom:12px">Upload a file…</button>
        <div style="${labelStyle};margin-bottom:6px">Or paste an image URL</div>
        <div style="display:flex;gap:8px">
          <input id="cvi-url" placeholder="https://…" style="flex:1;min-width:0;${inputStyle}">
          <button class="btn-cancel" id="cvi-url-add">Add</button>
        </div>
      </div>`
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    overlay.querySelector('#cvi-upload')?.addEventListener('click', () => {
      overlay.remove()
      host.querySelector('#cv-image-input')?.click()
    })
    overlay.querySelector('#cvi-url-add')?.addEventListener('click', async () => {
      const url = overlay.querySelector('#cvi-url')?.value.trim()
      if (!url) return
      overlay.remove()
      await this._addImageItem(url)
    })
  }

  // <input type="file"> change handler — delegates to the shared pipeline.
  async _handleImageFile(e) {
    const file = e.target.files[0]
    try { await this._processImageFile(file) }
    finally { e.target.value = '' }
  }

  // Shared image pipeline: compress → upload → place. Used by the file input,
  // drag-and-drop and clipboard paste. `point` is an optional canvas-space
  // centre (drop/paste location); without it the image lands at the viewport
  // centre (toolbar-button behaviour).
  async _processImageFile(file, point = null) {
    if (!file || !file.type?.startsWith('image/')) return
    if (file.size > 20 * 1024 * 1024) {
      this.app.toast('Image is too large — use a file under 20 MB')
      return
    }
    this.app.toast('Uploading image…')
    try {
      // Compress via Canvas: max 2000px on longest side, JPEG at 85% — keeps
      // the base64 payload well under Vercel's 4.5 MB body limit.
      const base64 = await new Promise((resolve, reject) => {
        const img = new Image()
        const objectUrl = URL.createObjectURL(file)
        img.onload = () => {
          URL.revokeObjectURL(objectUrl)
          const MAX = 2000
          let { width, height } = img
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX }
            else                { width  = Math.round(width  * MAX / height); height = MAX }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          canvas.getContext('2d').drawImage(img, 0, 0, width, height)
          resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
        }
        img.onerror = reject
        img.src = objectUrl
      })

      const { getAuthToken } = await import('../auth/clerk.js')
      const authToken = await getAuthToken()
      const res = await fetch('/api/blob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({
          base64,
          filename: (file.name || 'pasted.png').replace(/\.[^.]+$/, '.jpg'),
          contentType: 'image/jpeg',
          projectId: this.canvas?.project_id || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Upload failed')
      }
      const { url } = await res.json()
      await this._addImageItem(url, point)
    } catch (err) {
      console.error(err)
      this.app.toast('Image upload failed')
    }
  }

  // Place an image item centred on `point` (canvas space) or, if omitted, the
  // viewport centre.
  async _addImageItem(url, point = null) {
    const wrapRect = this._wrap.getBoundingClientRect()
    const centre = point || screenToCanvas({ x: wrapRect.width / 2, y: wrapRect.height / 2 }, this.viewport)
    await this._createItem({
      kind: 'image', image_url: url,
      x: Math.round(centre.x - 140), y: Math.round(centre.y - 100),
      w: 280, h: 200,
    })
  }

  // Fetch link metadata from the SSRF-guarded preview endpoint. Throws on
  // failure so the caller can fall back to a bare-URL card.
  async _fetchPreview(url) {
    const { getAuthToken } = await import('../auth/clerk.js')
    const authToken = await getAuthToken()
    const res = await fetch(`/api/blob?action=preview&url=${encodeURIComponent(url)}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!res.ok) throw new Error('Preview failed')
    return res.json()
  }

  async _addLinkItem() {
    const raw = prompt('Paste a link (web page, YouTube, Vimeo…):')
    const trimmed = raw?.trim()
    if (!trimmed) return
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const wrapRect = this._wrap.getBoundingClientRect()
    const centre = screenToCanvas({ x: wrapRect.width / 2, y: wrapRect.height / 2 }, this.viewport)
    // Best-effort preview — never block card creation on a failed/blocked fetch.
    let preview = null
    try { preview = await this._fetchPreview(url) } catch (e) { console.warn('Link preview failed:', e) }
    await this._createItem({
      kind: 'link', url,
      content: preview?.title || '',
      image_url: preview?.image || null,
      x: Math.round(centre.x - 140), y: Math.round(centre.y - 60),
      w: 280, h: 120,
    })
  }

  async _createItem(data) {
    const maxZ = this.items.reduce((m, i) => Math.max(m, i.z || 0), 0)
    this._writes++
    try {
      const created = await createCanvasItem(this.currentId, { ...data, z: maxZ + 1 })
      this.items.push(created)
      this._snapshot = this._serialize(this.items, this.arrows)
      this._renderItems()
      if (created.kind === 'note') {
        this._startEditing(created.id)
      }
    } catch (e) { console.error(e); this.app.toast('Error adding item') }
    finally { this._writes-- }
  }

  _startEditing(itemId) {
    const el = this._wrap?.querySelector(`[data-item="${itemId}"] .cv-note-text`)
    if (!el) return
    this._editingId = itemId
    el.classList.add('cv-note-text--editing')
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }

  // ── Surface interactions: drag, resize, pan, zoom, arrows ───────────────────

  _bindItems(itemsEl) {
    itemsEl.querySelectorAll('.cv-item').forEach(el => {
      const id = el.dataset.item

      // Entity chips navigate (and never start a drag)
      el.querySelectorAll('.bd-chip').forEach(chip => {
        chip.addEventListener('pointerdown', e => e.stopPropagation())
        chip.addEventListener('click', e => {
          e.stopPropagation()
          if (this.mode === 'arrow') return
          const type = chip.dataset.chipType, cid = chip.dataset.chipId
          if (type === 'project') this.app.openProject(cid)
          else if (type === 'budget') this.app.openBudget(cid)
          else if (type === 'client') { this.app.navigate('contacts'); setTimeout(() => this.app.contactsView.selectContact(cid), 50) }
        })
      })

      // Link card: the URL anchor opens in a new tab and never starts a drag
      el.querySelectorAll('[data-link-open]').forEach(a => {
        a.addEventListener('pointerdown', e => e.stopPropagation())
        a.addEventListener('click', e => { if (this.mode === 'arrow') e.preventDefault(); else e.stopPropagation() })
      })

      // Hover toolbar buttons
      el.querySelectorAll('.cv-item-tools button').forEach(b => b.addEventListener('pointerdown', e => e.stopPropagation()))
      el.querySelectorAll('.cv-color-dot').forEach(dot => {
        dot.addEventListener('click', async e => {
          e.stopPropagation()
          const item = this.items.find(i => i.id === id)
          if (!item) return
          item.color = dot.dataset.color
          el.style.background = item.color
          this._writes++
          try {
            await updateCanvasItem(id, { color: item.color })
            this._snapshot = this._serialize(this.items, this.arrows)
          } catch (err) { console.error(err) } finally { this._writes-- }
        })
      })
      el.querySelector('[data-item-del]')?.addEventListener('click', async e => {
        e.stopPropagation()
        const ok = await this.app.confirm({ title: 'Delete this item?', message: 'Arrows attached to it are removed too.', confirmLabel: 'Delete item' })
        if (!ok) return
        try {
          await deleteCanvasItem(id)
          this.items = this.items.filter(i => i.id !== id)
          this.arrows = this.arrows.filter(a => a.from_item_id !== id && a.to_item_id !== id)
          this._snapshot = this._serialize(this.items, this.arrows)
          this._renderItems()
        } catch (err) { console.error(err); this.app.toast('Error deleting item') }
      })
      el.querySelector('[data-item-links]')?.addEventListener('click', e => {
        e.stopPropagation()
        const item = this.items.find(i => i.id === id)
        if (item) this._openItemModal(item)
      })

      // Note text editing: double-click to edit, blur to save
      const ta = el.querySelector('.cv-note-text')
      if (ta && this.canEdit) {
        el.addEventListener('dblclick', e => {
          if (this.mode === 'arrow') return
          e.stopPropagation()
          this._startEditing(id)
        })
        let saveTimer
        const saveContent = async () => {
          const item = this.items.find(i => i.id === id)
          if (!item || item.content === ta.value) return
          item.content = ta.value
          this._writes++
          try {
            await updateCanvasItem(id, { content: ta.value })
            this._snapshot = this._serialize(this.items, this.arrows)
          } catch (err) { console.error(err) } finally { this._writes-- }
        }
        ta.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveContent, 700) })
        ta.addEventListener('blur', () => {
          clearTimeout(saveTimer)
          ta.classList.remove('cv-note-text--editing')
          if (this._editingId === id) this._editingId = null
          saveContent()
        })
        ta.addEventListener('pointerdown', e => {
          // While editing, let the textarea handle selection; otherwise the
          // pointerdown falls through to the item drag below.
          if (ta.classList.contains('cv-note-text--editing')) e.stopPropagation()
        })
      }

      // Arrow-mode clicks
      el.addEventListener('click', async () => {
        if (this.mode !== 'arrow' || !this.canEdit) return
        if (!this._arrowFromId) {
          this._arrowFromId = id
          el.classList.add('cv-item--arrow-from')
          return
        }
        if (this._arrowFromId === id) return
        const fromId = this._arrowFromId
        this._setMode('select')
        if (this.arrows.some(a => a.from_item_id === fromId && a.to_item_id === id)) return
        try {
          const arrow = await createCanvasArrow(this.currentId, fromId, id)
          this.arrows.push(arrow)
          this._snapshot = this._serialize(this.items, this.arrows)
          this._redrawArrows()
        } catch (err) { console.error(err); this.app.toast('Error adding arrow') }
      })

      if (!this.canEdit) return

      // Drag to move (pointer events — works at any zoom because deltas are
      // divided by the current zoom)
      el.addEventListener('pointerdown', e => {
        if (this.mode === 'arrow') return
        if (e.button !== 0) return
        if (e.target.closest('.cv-item-tools') || e.target.closest('.bd-chip')) return

        const isResize = !!e.target.closest('[data-resize]')
        const item = this.items.find(i => i.id === id)
        if (!item) return
        e.preventDefault()
        e.stopPropagation()
        this._interacting = true

        // Bring to front (unless it's already the topmost item)
        const maxZ = this.items.reduce((m, i) => Math.max(m, i.z || 0), 0)
        let zChanged = false
        if ((item.z || 0) < maxZ || this.items.filter(i => (i.z || 0) === maxZ).length > 1) {
          item.z = maxZ + 1
          el.style.zIndex = item.z
          zChanged = true
        }

        const start = { x: e.clientX, y: e.clientY }
        const orig = { x: item.x, y: item.y, w: item.w, h: item.h }
        let moved = false

        const onMove = ev => {
          const d = dragDeltaToCanvas({ x: ev.clientX - start.x, y: ev.clientY - start.y }, this.viewport)
          if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 2) moved = true
          if (isResize) {
            item.w = Math.max(80, orig.w + d.x)
            item.h = Math.max(50, orig.h + d.y)
            el.style.width = `${item.w}px`
            el.style.height = `${item.h}px`
          } else {
            item.x = orig.x + d.x
            item.y = orig.y + d.y
            el.style.left = `${item.x}px`
            el.style.top = `${item.y}px`
          }
          this._redrawArrowsThrottled()
        }
        const onUp = async () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          this._interacting = false
          if (!moved && !zChanged) return
          this._writes++
          try {
            await updateCanvasItem(id, { x: item.x, y: item.y, w: item.w, h: item.h, z: item.z })
            this._snapshot = this._serialize(this.items, this.arrows)
          } catch (err) { console.error(err); this.app.toast('Error saving move') }
          finally { this._writes-- }
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      })
    })
  }

  _redrawArrowsThrottled() {
    if (this._arrowRaf) return
    this._arrowRaf = requestAnimationFrame(() => {
      this._arrowRaf = null
      this._redrawArrows()
    })
  }

  _bindSurface(wrap) {
    // Pan: drag the background
    wrap.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      if (e.target.closest('.cv-item') || e.target.closest('.cv-zoom') || e.target.closest('[data-arrow]')) return
      e.preventDefault()
      this._interacting = true
      const start = { x: e.clientX, y: e.clientY }
      const orig = { panX: this.viewport.panX, panY: this.viewport.panY }
      const onMove = ev => {
        this.viewport.panX = orig.panX + (ev.clientX - start.x)
        this.viewport.panY = orig.panY + (ev.clientY - start.y)
        this._applyViewport()
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        this._interacting = false
        this._saveViewport()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    })

    // Wheel: zoom at the cursor
    wrap.addEventListener('wheel', e => {
      e.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      this.viewport = zoomAtPoint(this.viewport, cursor, this.viewport.zoom * factor)
      this._applyViewport()
      clearTimeout(this._vpSaveTimer)
      this._vpSaveTimer = setTimeout(() => this._saveViewport(), 400)
    }, { passive: false })

    if (!this.canEdit) return

    // Drag-and-drop an image file onto the canvas — lands where it's dropped.
    wrap.addEventListener('dragover', e => { e.preventDefault() })
    wrap.addEventListener('drop', e => {
      e.preventDefault()
      const file = [...(e.dataTransfer?.files || [])].find(f => f.type?.startsWith('image/'))
      if (!file) return
      const rect = wrap.getBoundingClientRect()
      const point = screenToCanvas({ x: e.clientX - rect.left, y: e.clientY - rect.top }, this.viewport)
      this._processImageFile(file, point)
    })

    // Paste a screenshot/image from the clipboard while the canvas is mounted.
    this._pasteHandler = e => {
      if (!this._wrap || !document.contains(this._wrap)) return
      if (this._editingId) return
      const ae = document.activeElement
      if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return
      const file = [...(e.clipboardData?.files || [])].find(f => f.type?.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      this._processImageFile(file)   // no cursor for paste → viewport centre
    }
    document.addEventListener('paste', this._pasteHandler)
  }

  // ── Item links/options modal ─────────────────────────────────────────────────

  _openItemModal(item) {
    document.getElementById('cv-item-modal')?.remove()
    let links = Array.isArray(item.links) ? item.links.map(l => ({ ...l })) : []

    const overlay = document.createElement('div')
    overlay.id = 'cv-item-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'

    const linkOptions = type => {
      if (type === 'client') return this.app.contacts.map(c => `<option value="${c.id}">${esc(`${c.first_name} ${c.last_name}`.trim())}</option>`).join('')
      if (type === 'project') return this.app.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')
      return this.app.budgets.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')
    }

    const renderModal = () => {
      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:400px;padding:20px" onclick="event.stopPropagation()">
          <div style="font-size:14px;font-weight:600;margin-bottom:12px">${({ image: 'Image', link: 'Link', todo: 'Checklist' }[item.kind] || 'Note')} links</div>
          ${links.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
            ${links.map((l, i) => {
              const t = LINK_TYPES.find(x => x.id === l.type)
              return `<span class="bd-chip" style="color:${t?.color};background:${t?.color}1a">${t?.icon} ${esc(this._entityName(l.type, l.id) || 'Missing record')}
                <button class="cvm-link-del" data-idx="${i}" style="background:none;border:none;cursor:pointer;color:inherit;font-size:12px;padding:0 0 0 4px;line-height:1">×</button></span>`
            }).join('')}
          </div>` : '<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">No links yet — link this item to a client, project or budget.</div>'}
          <div style="display:flex;gap:8px;margin-bottom:16px">
            <select id="cvm-link-type" style="${inputStyle};font-size:12px">
              ${LINK_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}
            </select>
            <select id="cvm-link-entity" style="${inputStyle};font-size:12px;flex:1;min-width:0">${linkOptions('client')}</select>
            <button class="btn-cancel" id="cvm-link-add" style="font-size:12px">+ Add</button>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button class="btn-cancel" id="cvm-cancel">Cancel</button>
            <button class="btn-primary" id="cvm-save">Save</button>
          </div>
        </div>`

      overlay.querySelector('#cvm-cancel')?.addEventListener('click', () => overlay.remove())
      overlay.querySelector('#cvm-link-type')?.addEventListener('change', e => {
        const sel = overlay.querySelector('#cvm-link-entity')
        if (sel) sel.innerHTML = linkOptions(e.target.value)
      })
      overlay.querySelector('#cvm-link-add')?.addEventListener('click', () => {
        const type = overlay.querySelector('#cvm-link-type')?.value
        const id = overlay.querySelector('#cvm-link-entity')?.value
        if (!type || !id || links.some(l => l.type === type && l.id === id)) return
        links.push({ type, id })
        renderModal()
      })
      overlay.querySelectorAll('.cvm-link-del').forEach(btn => {
        btn.addEventListener('click', () => { links.splice(parseInt(btn.dataset.idx), 1); renderModal() })
      })
      overlay.querySelector('#cvm-save')?.addEventListener('click', async () => {
        this._writes++
        try {
          await updateCanvasItem(item.id, { links })
          item.links = links
          this._snapshot = this._serialize(this.items, this.arrows)
          overlay.remove()
          this._renderItems()
        } catch (e) { console.error(e); this.app.toast('Error saving links') }
        finally { this._writes-- }
      })
    }

    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    renderModal()
  }

  // ── Polling sync (same pattern as boards) ────────────────────────────────────

  _serialize(items, arrows) {
    const its = [...items]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(i => [i.id, i.kind, i.x, i.y, i.w, i.h, i.z, i.content, i.color, i.image_url, i.url, JSON.stringify(i.links), JSON.stringify(i.sub_tasks)])
    const ars = [...arrows]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(a => [a.id, a.from_item_id, a.to_item_id])
    return JSON.stringify([its, ars])
  }

  _stopPolling() {
    clearInterval(this._pollTimer)
    this._pollTimer = null
    if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null }
    if (this._pasteHandler) { document.removeEventListener('paste', this._pasteHandler); this._pasteHandler = null }
  }

  _startPolling(wrap) {
    clearInterval(this._pollTimer)
    const canvasId = this.currentId
    this._pollTimer = setInterval(async () => {
      if (!wrap || !document.contains(wrap) || this.currentId !== canvasId) { this._stopPolling(); return }
      if (document.hidden || this._interacting || this._editingId || this._writes > 0 || this.mode === 'arrow') return
      if (document.getElementById('cv-item-modal') || document.getElementById('cv-new-modal') || document.getElementById('cv-image-modal')) return
      const ae = document.activeElement
      if (ae && wrap.contains(ae) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return

      try {
        const { items, arrows } = await getCanvasData(canvasId)
        const snap = this._serialize(items, arrows)
        if (snap !== this._snapshot) {
          this.items = items
          this.arrows = arrows
          this._snapshot = snap
          this._renderItems()
        }
      } catch (e) { console.warn('Canvas sync failed:', e) }
    }, POLL_MS)
  }
}
