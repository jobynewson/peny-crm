// @ts-check
// src/views/canvas.js
// Planning canvas — an infinite, Milanote-style planning surface: notes,
// checklists, images, links, colour swatches and nested boards joined by
// connectors. This module owns navigation (the list in Planning → Canvases,
// the standalone page, the project-embedded view and moving in and out of
// nested boards). The canvas itself — rendering, gestures, sync — lives in
// ./canvas-surface.js; its geometry in src/utils/canvas-math.js (unit-tested).

import {
  getCanvases, createCanvas, updateCanvas, deleteCanvas, getCanvasForProject, syncBoardCardName,
} from '../db/client.js'
import { CanvasSurface } from './canvas-surface.js'

/** @typedef {import('./canvas-surface.js').CanvasRow & { created_at?: any }} CanvasRow */

/** @param {any} s */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const inputStyle = 'font-size:13px;padding:6px 9px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none'

export class CanvasView {
  /** @param {any} app */
  constructor(app) {
    this.app = app
    /** @type {string | null} */ this.currentId = null
    /** @type {CanvasRow | null} */ this.canvas = null
    /** @type {CanvasRow[] | null} */ this._canvases = null   // every canvas in the workspace, nested ones included
    /** @type {CanvasSurface | null} */ this.surface = null
    /** @type {{ projectId: string, rootId: string, currentId: string } | null} */ this._embedded = null
    // Nested board each embedded root canvas was last showing, so switching
    // Planning tabs away and back returns to the same place.
    /** @type {Map<string, string>} */ this._embeddedPos = new Map()
  }

  get canEdit() { return this.app.permissions?.projects_edit !== false }

  async _allCanvases(force = false) {
    if (force || !this._canvases) this._canvases = /** @type {CanvasRow[]} */ (await getCanvases(this.app.userId))
    return this._canvases
  }

  // Root → … → id, following parent_id. Guarded against cycles.
  /** @param {string} id */
  _chain(id) {
    const byId = new Map((this._canvases ?? []).map(c => [c.id, c]))
    /** @type {CanvasRow[]} */ const out = []
    let cur = byId.get(id)
    while (cur && out.length < 64 && !out.includes(cur)) {
      out.unshift(cur)
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
    }
    return out
  }

  /** @param {string} id */
  _descendantCount(id) {
    const list = this._canvases ?? []
    let n = 0
    /** @type {string[]} */ const stack = [id]
    const seen = new Set(stack)
    while (stack.length) {
      const cur = /** @type {string} */ (stack.pop())
      for (const c of list) if (c.parent_id === cur && !seen.has(c.id)) { seen.add(c.id); n++; stack.push(c.id) }
    }
    return n
  }

  _destroySurface() {
    this.surface?.destroy()
    this.surface = null
  }

  // Kept for callers that used to stop the old polling loop directly.
  _stopPolling() { this._destroySurface() }

  // ── List (rendered inside the Planning view's Canvases tab) ─────────────────

  /** @param {HTMLElement} mc */
  async renderList(mc) {
    this._destroySurface()
    mc.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading canvases…</div>'
    try {
      await this._allCanvases(true)
    } catch (e) {
      console.error(e)
      mc.innerHTML = '<div class="empty-state" style="padding-top:60px">Could not load canvases.</div>'
      return
    }
    const list = (this._canvases ?? []).filter(c => !c.parent_id)

    if (!list.length) {
      mc.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:45vh;gap:14px;text-align:center">
          <div style="font-size:36px">🖼</div>
          <div style="font-size:16px;font-weight:500">No canvases yet</div>
          <div style="font-size:13px;color:var(--text-tertiary);max-width:360px;line-height:1.6">A canvas is an infinite space for planning and storyboarding — notes, checklists, images, links and colour swatches, connected with lines and organised into boards within boards.</div>
          ${this.canEdit ? '<button class="btn-primary" id="cv-empty-new" style="margin-top:4px">+ Create first canvas</button>' : ''}
        </div>`
      mc.querySelector('#cv-empty-new')?.addEventListener('click', () => this.openNewCanvasModal())
      return
    }

    mc.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;max-width:680px">
        ${list.map(c => {
          const proj = c.project_id ? (this.app.projects ?? []).find((/** @type {any} */ p) => p.id === c.project_id) : null
          const nested = this._descendantCount(c.id)
          return `
          <div class="bd-list-row" data-canvas-id="${esc(c.id)}">
            <span style="font-size:15px;flex-shrink:0">🖼</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:550;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px">${proj ? `Linked to ${esc(proj.name)}` : 'Standalone'}${nested ? ` · ${nested} board${nested === 1 ? '' : 's'} inside` : ''}</div>
            </div>
            <span style="font-size:11px;color:var(--text-tertiary);flex-shrink:0">${c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
          </div>`
        }).join('')}
      </div>`
    mc.querySelectorAll('[data-canvas-id]').forEach(row => {
      row.addEventListener('click', () => this.openCanvas(/** @type {HTMLElement} */ (row).dataset.canvasId || ''))
    })
  }

  /** @param {string} id */
  openCanvas(id) {
    this.currentId = id
    this.app.boardsView.currentId = null
    this.app._pushAppState(`#planning/canvas/${id}`, { view: 'planning', canvasId: id })
    this.app.render()
  }

  /** @param {string | null} [projectId] */
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
            ${(this.app.projects ?? []).map((/** @type {any} */ p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
          </select>`}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button class="btn-cancel" id="cv-new-cancel">Cancel</button>
          <button class="btn-primary" id="cv-new-save">Create canvas</button>
        </div>
      </div>`
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    const nameEl = /** @type {HTMLInputElement | null} */ (overlay.querySelector('#cv-new-name'))
    setTimeout(() => nameEl?.focus(), 10)
    const save = async () => {
      const name = nameEl?.value.trim()
      if (!name) { nameEl?.focus(); return }
      const project_id = projectId || /** @type {HTMLSelectElement | null} */ (overlay.querySelector('#cv-new-project'))?.value || null
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

  /** @param {CanvasRow[]} chain @param {boolean} embedded */
  _breadcrumbsHtml(chain, embedded) {
    const crumbs = chain.slice(0, -1).map(c =>
      `<button class="cv-crumb" data-crumb="${esc(c.id)}">${esc(c.name)}</button><span class="cv-crumb-sep">›</span>`).join('')
    return `
      <nav class="cv-crumbs" aria-label="Board path">
        ${embedded ? '' : '<button class="cv-crumb" data-crumb="">All canvases</button><span class="cv-crumb-sep">›</span>'}
        ${crumbs}
      </nav>`
  }

  // ── Canvas (standalone) ──────────────────────────────────────────────────────

  /** @param {HTMLElement} mc */
  async render(mc) {
    this._destroySurface()
    this._embedded = null
    mc.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading canvas…</div>'
    const id = this.currentId
    let surface
    try {
      let all = await this._allCanvases()
      if (!all.some(c => c.id === id)) all = await this._allCanvases(true)
      this.canvas = all.find(c => c.id === id) ?? null
      if (!this.canvas) {
        mc.innerHTML = '<div class="empty-state" style="padding-top:60px">Canvas not found.</div>'
        return
      }
      surface = this._makeSurface(this.canvas, /** @type {string} */ (id) => this.openCanvas(id))
      await surface.load()
      this.app.updateTitle()
    } catch (e) {
      console.error(e)
      mc.innerHTML = '<div class="empty-state" style="padding-top:60px">Could not load canvas.</div>'
      return
    }
    // A newer navigation happened while this one was loading.
    if (this.currentId !== id) { surface.destroy(); return }

    const canvas = this.canvas
    const chain = this._chain(canvas.id)
    const isRoot = !canvas.parent_id
    const parent = chain.length > 1 ? chain[chain.length - 2] : null
    const proj = canvas.project_id ? (this.app.projects ?? []).find((/** @type {any} */ p) => p.id === canvas.project_id) : null
    mc.innerHTML = `
      <div class="cv-header">
        <button class="btn-cancel" id="cv-back" style="font-size:12px" title="${parent ? `Back to ${esc(parent.name)}` : 'All canvases'}">←</button>
        ${this._breadcrumbsHtml(chain, false)}
        <input id="cv-name" class="cv-title-input" value="${esc(canvas.name)}" maxlength="120" ${this.canEdit ? '' : 'disabled'} aria-label="Canvas name">
        ${this.canEdit && isRoot ? `
          <select id="cv-project" title="Link to project" style="${inputStyle};max-width:180px">
            <option value="">Standalone</option>
            ${(this.app.projects ?? []).map((/** @type {any} */ p) => `<option value="${esc(p.id)}"${canvas.project_id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
          <button class="btn-cancel" id="cv-delete" style="font-size:12px;color:var(--danger)">Delete</button>
        ` : (proj ? `<span style="font-size:11px;color:var(--text-tertiary)">Linked to ${esc(proj.name)}</span>` : '')}
      </div>
      <div id="cv-host"></div>`

    const goUp = () => {
      if (parent) { this.openCanvas(parent.id); return }
      this.currentId = null; this.canvas = null
      this.app._pushAppState('#planning', { view: 'planning' })
      this.app.render()
    }
    mc.querySelector('#cv-back')?.addEventListener('click', goUp)
    mc.querySelectorAll('[data-crumb]').forEach(b => b.addEventListener('click', () => {
      const cid = /** @type {HTMLElement} */ (b).dataset.crumb
      if (cid) this.openCanvas(cid)
      else { this.currentId = null; this.canvas = null; this.app._pushAppState('#planning', { view: 'planning' }); this.app.render() }
    }))
    this._bindNameInput(/** @type {HTMLInputElement | null} */ (mc.querySelector('#cv-name')), canvas)
    mc.querySelector('#cv-project')?.addEventListener('change', async e => {
      const value = /** @type {HTMLSelectElement} */ (e.target).value || null
      try {
        await updateCanvas(this.app.userId, canvas.id, { project_id: value })
        canvas.project_id = value
        if (this.surface) this.surface.projectId = value
        this.app.toast(value ? 'Canvas linked to project' : 'Canvas unlinked')
      } catch (err) { console.error(err); this.app.toast('Error linking canvas') }
    })
    mc.querySelector('#cv-delete')?.addEventListener('click', async () => {
      const nested = this._descendantCount(canvas.id)
      const ok = await this.app.confirm({
        title: 'Delete this canvas?',
        message: `Everything on it${nested ? ` — including ${nested} nested board${nested === 1 ? '' : 's'}` : ''} — will be deleted.`,
        confirmLabel: 'Delete canvas',
      })
      if (!ok) return
      try {
        this._destroySurface()
        await deleteCanvas(this.app.userId, canvas.id)
        this._canvases = null; this.currentId = null; this.canvas = null
        this.app.toast('Canvas deleted')
        this.app._pushAppState('#planning', { view: 'planning' })
        this.app.render()
      } catch (e) { console.error(e); this.app.toast('Error deleting canvas') }
    })

    this.surface = surface
    surface.mount(/** @type {HTMLElement} */ (mc.querySelector('#cv-host')), 'calc(100vh - 170px)')
  }

  /** @param {HTMLInputElement | null} input @param {CanvasRow} canvas */
  _bindNameInput(input, canvas) {
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); else if (e.key === 'Escape') { input.value = canvas.name; input.blur() } })
    input?.addEventListener('change', async () => {
      const name = input.value.trim()
      if (!name) { input.value = canvas.name; return }
      if (name === canvas.name) return
      try {
        await updateCanvas(this.app.userId, canvas.id, { name })
        if (canvas.parent_id) await syncBoardCardName(canvas.id, name)
        canvas.name = name
        this.app.updateTitle?.()
      } catch (err) { console.error(err); this.app.toast('Could not rename canvas') }
    })
  }

  /** @param {CanvasRow} canvas @param {(id: string) => void} onOpenBoard */
  _makeSurface(canvas, onOpenBoard) {
    const root = this._chain(canvas.id)[0] ?? canvas
    return new CanvasSurface(this.app, {
      canvas,
      canvases: () => (this._canvases ??= []),
      canEdit: this.canEdit,
      projectId: root.project_id ?? null,
      onOpenBoard,
    })
  }

  // ── Canvas (embedded in a project's Planning tab) ────────────────────────────

  // `canvas` is the specific root canvas to show (a tab in the project's
  // Planning strip); without it the project's first canvas is used.
  /** @param {HTMLElement} container @param {any} project @param {CanvasRow | null} [canvas] */
  async renderEmbedded(container, project, canvas = null) {
    this._destroySurface()
    container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading canvas…</div>'
    /** @type {CanvasRow | null} */ let root = canvas
    try {
      root ??= /** @type {CanvasRow | null} */ (await getCanvasForProject(this.app.userId, project.id))
    } catch (e) {
      console.error(e)
      container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Could not load canvas.</div>'
      return
    }

    if (!root) {
      this._embedded = null
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 0;text-align:center">
          <div style="font-size:32px">🖼</div>
          <div style="font-size:14px;font-weight:500">No canvas for this project yet</div>
          <div style="font-size:12px;color:var(--text-tertiary);max-width:340px;line-height:1.6">An infinite space for planning and storyboarding — notes, checklists, images, colour swatches and boards within boards.</div>
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

    // Stay on the nested board the user was on when this canvas re-renders.
    if (!this._embedded || this._embedded.projectId !== project.id || this._embedded.rootId !== root.id) {
      this._embedded = { projectId: project.id, rootId: root.id, currentId: this._embeddedPos.get(root.id) ?? root.id }
    }
    await this._renderEmbeddedCanvas(container, project)
  }

  /** @param {HTMLElement} container @param {any} project */
  async _renderEmbeddedCanvas(container, project) {
    const state = this._embedded
    if (!state) return
    this._destroySurface()
    let surface
    /** @type {CanvasRow | undefined} */ let canvas
    try {
      let all = await this._allCanvases()
      if (!all.some(c => c.id === state.currentId)) all = await this._allCanvases(true)
      canvas = all.find(c => c.id === state.currentId)
      if (!canvas) { state.currentId = state.rootId; canvas = all.find(c => c.id === state.rootId) }
      if (!canvas) throw new Error('Canvas missing')
      const go = (/** @type {string} */ id) => { state.currentId = id; this._renderEmbeddedCanvas(container, project) }
      surface = this._makeSurface(canvas, go)
      await surface.load()
    } catch (e) {
      console.error(e)
      container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Could not load canvas.</div>'
      return
    }
    if (this._embedded !== state || state.currentId !== canvas.id || !document.contains(container)) { surface.destroy(); return }

    this.canvas = canvas
    this.currentId = canvas.id
    this._embeddedPos.set(state.rootId, canvas.id)
    const chain = this._chain(canvas.id)
    const nested = chain.length > 1
    container.innerHTML = `
      <div class="cv-header cv-header--embedded">
        ${nested ? `
          <button class="btn-cancel" id="cv-emb-up" style="font-size:12px" title="Back to ${esc(chain[chain.length - 2].name)}">←</button>
          ${this._breadcrumbsHtml(chain, true)}
          <input id="cv-name" class="cv-title-input" value="${esc(canvas.name)}" maxlength="120" ${this.canEdit ? '' : 'disabled'} aria-label="Board name">
        ` : '<span style="flex:1"></span>'}
        <button class="btn-cancel" id="cv-open-standalone" style="font-size:12px">Open full view</button>
      </div>
      <div id="cv-host"></div>`
    const go = (/** @type {string} */ id) => { state.currentId = id; this._renderEmbeddedCanvas(container, project) }
    container.querySelector('#cv-emb-up')?.addEventListener('click', () => go(chain[chain.length - 2].id))
    container.querySelectorAll('[data-crumb]').forEach(b => b.addEventListener('click', () => go(/** @type {HTMLElement} */ (b).dataset.crumb || state.rootId)))
    this._bindNameInput(/** @type {HTMLInputElement | null} */ (container.querySelector('#cv-name')), canvas)
    container.querySelector('#cv-open-standalone')?.addEventListener('click', () => {
      this.app.currentView = 'planning'
      this.app.boardsView.currentId = null
      this.currentId = canvas.id
      this.app._pushAppState(`#planning/canvas/${canvas.id}`, { view: 'planning', canvasId: canvas.id })
      this.app.render()
    })
    this.surface = surface
    surface.mount(/** @type {HTMLElement} */ (container.querySelector('#cv-host')), '66vh')
  }
}
