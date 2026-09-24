// @ts-check
// src/views/planning-tabs.js
// A project's Planning tab: one strip of tabs mixing the project's kanban
// boards and canvases, so a project can hold as many of each as it needs.
//   • click / ←→ switches (the last tab used is remembered per project)
//   • + adds a new kanban board or canvas (named inline straight away), or
//     links an existing standalone one from Planning
//   • double-click renames inline
//   • drag reorders — the order is saved on the project, shared by everyone
// The active tab is rendered by the existing embeds
// (BoardsView.renderEmbedded / CanvasView.renderEmbedded). Ordering maths is
// pure and unit-tested in src/utils/planning-tabs.js.

import {
  getProjectPlanning, getLinkablePlanning, setPlanningTabOrder,
  createBoard, updateBoard, createCanvas, updateCanvas,
} from '../db/client.js'
import { tabKey, orderTabs, moveTab, insertIndex, pickActive } from '../utils/planning-tabs.js'

/** @param {any} s */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** @typedef {'board' | 'canvas'} Kind */
/** @typedef {{ key: string, kind: Kind, id: string, name: string, created_at?: any, row: any }} Tab */

/** @type {Record<Kind, string>} */
const ICON = { board: '🗂', canvas: '🖼' }
/** @type {Record<Kind, string>} */
const KIND_LABEL = { board: 'Kanban board', canvas: 'Canvas' }
const inputStyle = 'font-size:13px;padding:6px 9px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none'

export class PlanningTabsView {
  /** @param {any} app */
  constructor(app) {
    this.app = app
    /** @type {any} */ this.project = null
    /** @type {Tab[]} */ this.tabs = []
    /** @type {string | null} */ this.active = null
    /** @type {HTMLElement | null} */ this._container = null
    /** @type {(() => void) | null} */ this._closeMenu = null
    this._seq = 0
  }

  get canEdit() { return this.app.permissions?.projects_edit !== false }

  /** @param {string} projectId */
  _rememberKey(projectId) { return `slate-plan-tab-${projectId}` }
  /** @param {string} projectId */
  _remembered(projectId) {
    try { return localStorage.getItem(this._rememberKey(projectId)) } catch { return null }
  }
  /** @param {string} key */
  _remember(key) {
    try { localStorage.setItem(this._rememberKey(this.project.id), key) } catch { /* storage unavailable */ }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  /** @param {HTMLElement} container @param {any} project */
  async render(container, project) {
    this._closeMenu?.()
    this._container = container
    this.project = project
    const seq = ++this._seq
    container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading…</div>'
    let data
    try {
      data = await getProjectPlanning(this.app.userId, project.id)
    } catch (e) {
      console.error(e)
      container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Could not load planning.</div>'
      return
    }
    if (seq !== this._seq || !document.contains(container)) return
    this.tabs = orderTabs(data.boards, data.canvases, project.planning_tab_order)
    this.active = pickActive(this.tabs, this._remembered(project.id))

    container.innerHTML = `
      <div class="pt">
        <div class="pt-bar">
          <div class="pt-tabs" role="tablist" aria-label="Project boards"></div>
          ${this.canEdit ? '<button class="pt-add" title="Add a kanban board or canvas" aria-label="Add a board or canvas">+</button>' : ''}
        </div>
        <div class="pt-body"></div>
      </div>`
    container.querySelector('.pt-add')?.addEventListener('click', e => this._openAddMenu(/** @type {HTMLElement} */ (e.currentTarget)))
    this._renderStrip()
    this._showActive()
  }

  _renderStrip() {
    const strip = this._container?.querySelector('.pt-tabs')
    if (!strip) return
    strip.innerHTML = this.tabs.map(t => `
      <button class="pt-tab${t.key === this.active ? ' pt-tab--active' : ''}" role="tab" data-key="${esc(t.key)}"
        aria-selected="${t.key === this.active}" tabindex="${t.key === this.active ? 0 : -1}"
        title="${esc(t.name)} — ${KIND_LABEL[t.kind]}${this.canEdit ? ' · double-click to rename, drag to reorder' : ''}">
        <span class="pt-tab-icon">${ICON[t.kind]}</span><span class="pt-tab-name">${esc(t.name)}</span>
      </button>`).join('')
    strip.querySelectorAll('.pt-tab').forEach(el => this._bindTab(/** @type {HTMLElement} */ (el)))
    strip.querySelector('.pt-tab--active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  /** @param {string | null | undefined} key */
  _setActive(key) {
    if (!key || key === this.active) return
    this.active = key
    this._remember(key)
    this._container?.querySelectorAll('.pt-tab').forEach(node => {
      const el = /** @type {HTMLElement} */ (node)
      const on = el.dataset.key === key
      el.classList.toggle('pt-tab--active', on)
      el.setAttribute('aria-selected', String(on))
      el.tabIndex = on ? 0 : -1
      if (on) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    this._showActive()
  }

  // Each switch renders into a fresh element, so a slow load for a tab the
  // user has already left lands in a detached node instead of on screen.
  _showActive() {
    const body = this._container?.querySelector('.pt-body')
    if (!body) return
    this.app.canvasView._destroySurface?.()
    this.app.boardsView._stopPolling?.()
    body.innerHTML = ''
    const host = document.createElement('div')
    body.appendChild(host)
    const tab = this.tabs.find(t => t.key === this.active)
    if (!tab) { this._renderEmpty(host); return }
    if (tab.kind === 'board') this.app.boardsView.renderEmbedded(host, this.project, tab.row)
    else this.app.canvasView.renderEmbedded(host, this.project, tab.row)
  }

  /** @param {HTMLElement} host */
  _renderEmpty(host) {
    host.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 0;text-align:center">
        <div style="font-size:32px">🗂 🖼</div>
        <div style="font-size:14px;font-weight:500">Nothing planned for this project yet</div>
        <div style="font-size:12px;color:var(--text-tertiary);max-width:380px;line-height:1.6">Add as many kanban boards and canvases as the project needs — each gets its own tab here.</div>
        ${this.canEdit ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:2px">
          <button class="btn-primary" data-new="board">+ Kanban board</button>
          <button class="btn-primary" data-new="canvas">+ Canvas</button>
          <button class="btn-cancel" data-link>Link existing…</button>
        </div>` : ''}
      </div>`
    host.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => this._create(/** @type {Kind} */ (/** @type {HTMLElement} */ (b).dataset.new))))
    host.querySelector('[data-link]')?.addEventListener('click', () => this._openLinkModal())
  }

  // ── Tab interactions ─────────────────────────────────────────────────────────

  /** @param {HTMLElement} el */
  _bindTab(el) {
    el.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
      if (el.querySelector('input')) return
      e.preventDefault()
      const i = this.tabs.findIndex(t => t.key === el.dataset.key)
      const n = this.tabs.length
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n
      this._setActive(this.tabs[j]?.key)
      const el_ = /** @type {HTMLElement | null} */ (this._container?.querySelector('.pt-tab--active'))
      el_?.focus()
    })
    el.addEventListener('dblclick', () => { if (this.canEdit) this._startRename(el.dataset.key) })
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || el.querySelector('input')) return
      if (!this.canEdit || this.tabs.length < 2) { this._setActive(el.dataset.key); return }
      this._startDrag(e, el)
    })
  }

  // Drag to reorder: the tab follows the pointer along the strip while the
  // others slide aside; on release the new order is saved on the project.
  /** @param {PointerEvent} e @param {HTMLElement} el */
  _startDrag(e, el) {
    const strip = /** @type {HTMLElement} */ (this._container?.querySelector('.pt-tabs'))
    const key = el.dataset.key || ''
    const startX = e.clientX
    const els = /** @type {HTMLElement[]} */ ([...strip.querySelectorAll('.pt-tab')])
    const from = els.indexOf(el)
    const boxes = els.map(t => t.getBoundingClientRect())
    const mine = boxes[from]
    const gap = boxes.length > 1 ? Math.max(0, boxes[1].left - boxes[0].right) : 0
    const others = els.filter(t => t !== el)
    const otherBoxes = boxes.filter((_, i) => i !== from)
    let dragging = false
    let to = from

    const move = (/** @type {PointerEvent} */ ev) => {
      const dx = ev.clientX - startX
      if (!dragging) {
        if (Math.abs(dx) < 5) return
        dragging = true
        el.classList.add('pt-tab--dragging')
        strip.classList.add('pt-tabs--dragging')
      }
      const minDx = boxes[0].left - mine.left
      const maxDx = boxes[boxes.length - 1].right - mine.right
      const clamped = Math.max(minDx, Math.min(maxDx, dx))
      el.style.transform = `translateX(${clamped}px)`
      to = insertIndex(mine.left + clamped + mine.width / 2, otherBoxes)
      // Slide the tabs between the old and new slot out of the way.
      others.forEach((t, i) => {
        const shift = i >= from && i < to ? -(mine.width + gap) : i < from && i >= to ? mine.width + gap : 0
        t.style.transform = shift ? `translateX(${shift}px)` : ''
      })
    }
    const up = async () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!dragging) { this._setActive(key); return }
      el.classList.remove('pt-tab--dragging')
      strip.classList.remove('pt-tabs--dragging')
      els.forEach(t => { t.style.transform = '' })
      if (to === from) return
      const keys = moveTab(this.tabs.map(t => t.key), key, to)
      const byKey = new Map(this.tabs.map(t => [t.key, t]))
      this.tabs = /** @type {Tab[]} */ (keys.map(k => byKey.get(k)).filter(Boolean))
      this._renderStrip()
      await this._saveOrder()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  async _saveOrder() {
    const order = this.tabs.map(t => t.key)
    this.project.planning_tab_order = order
    const cached = this.app.projects?.find((/** @type {any} */ p) => p.id === this.project.id)
    if (cached) cached.planning_tab_order = order
    try { await setPlanningTabOrder(this.app.userId, this.project.id, order) }
    catch (e) { console.error(e); this.app.toast('Could not save tab order') }
  }

  /** @param {string | undefined} key */
  _startRename(key) {
    if (!key) return
    const tab = this.tabs.find(t => t.key === key)
    const el = this._container?.querySelector(`.pt-tab[data-key="${CSS.escape(key)}"]`)
    const nameEl = el?.querySelector('.pt-tab-name')
    if (!tab || !nameEl) return
    const input = document.createElement('input')
    input.className = 'pt-tab-input'
    input.value = tab.name
    input.maxLength = 120
    input.size = Math.max(8, tab.name.length + 1)
    nameEl.replaceWith(input)
    input.focus()
    input.select()
    let done = false
    const finish = async (/** @type {boolean} */ save) => {
      if (done) return
      done = true
      const name = input.value.trim()
      if (save && name && name !== tab.name) {
        const prev = tab.name
        tab.name = name
        tab.row.name = name
        try {
          if (tab.kind === 'board') { await updateBoard(this.app.userId, tab.id, { name }); this.app.boardsView._boards = null }
          else { await updateCanvas(this.app.userId, tab.id, { name }); this.app.canvasView._canvases = null }
        } catch (e) {
          console.error(e)
          tab.name = prev; tab.row.name = prev
          this.app.toast('Could not rename')
        }
      }
      this._renderStrip()
      const el_ = /** @type {HTMLElement | null} */ (this._container?.querySelector('.pt-tab--active'))
      el_?.focus()
    }
    input.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); finish(true) }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
    })
    input.addEventListener('input', () => { input.size = Math.max(8, input.value.length + 1) })
    input.addEventListener('pointerdown', e => e.stopPropagation())
    input.addEventListener('blur', () => finish(true))
  }

  // ── Adding tabs ──────────────────────────────────────────────────────────────

  /** @param {HTMLElement} anchor */
  _openAddMenu(anchor) {
    // + toggles; closing always goes through close() so no listeners leak.
    if (this._closeMenu) { this._closeMenu(); return }
    const menu = document.createElement('div')
    menu.id = 'pt-add-menu'
    menu.className = 'pt-menu'
    menu.setAttribute('role', 'menu')
    menu.innerHTML = `
      <button role="menuitem" data-new="board"><span>${ICON.board}</span> New kanban board</button>
      <button role="menuitem" data-new="canvas"><span>${ICON.canvas}</span> New canvas</button>
      <div class="pt-menu-sep"></div>
      <button role="menuitem" data-link><span>🔗</span> Link existing…</button>`
    document.body.appendChild(menu)
    const r = anchor.getBoundingClientRect()
    const left = Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth)
    menu.style.left = `${Math.max(8, left)}px`
    menu.style.top = `${r.bottom + 6}px`
    const close = () => {
      menu.remove()
      document.removeEventListener('pointerdown', outside, true)
      if (this._closeMenu === close) this._closeMenu = null
    }
    this._closeMenu = close
    const outside = (/** @type {PointerEvent} */ e) => { if (!menu.contains(/** @type {Node} */ (e.target)) && e.target !== anchor) close() }
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus() }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [...menu.querySelectorAll('button')]
        const i = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement))
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
    }
    // Focus lives in the menu while it's open, so keys are handled there
    // (and stop before the app's global Esc = "go back").
    menu.addEventListener('keydown', onKey)
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0)
    menu.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => { close(); this._create(/** @type {Kind} */ (/** @type {HTMLElement} */ (b).dataset.new)) }))
    menu.querySelector('[data-link]')?.addEventListener('click', () => { close(); this._openLinkModal() })
    const el_ = /** @type {HTMLElement | null} */ (menu.querySelector('button'))
    el_?.focus()
  }

  /** @param {Kind} kind */
  async _create(kind) {
    const name = kind === 'board' ? 'Untitled board' : 'Untitled canvas'
    try {
      const row = kind === 'board'
        ? await createBoard(this.app.userId, { name, project_id: this.project.id })
        : await createCanvas(this.app.userId, { name, project_id: this.project.id })
      if (kind === 'board') this.app.boardsView._boards = null
      else this.app.canvasView._canvases = null
      await this._addTab(kind, row)
      this._startRename(tabKey(kind, row.id))
    } catch (e) {
      console.error(e)
      this.app.toast(`Could not create ${kind === 'board' ? 'board' : 'canvas'}`)
    }
  }

  // Append a tab (right after the current one would reshuffle tabs people
  // know by position — the end is predictable), save the order, switch to it.
  /** @param {Kind} kind @param {any} row */
  async _addTab(kind, row) {
    /** @type {Tab} */
    const tab = { key: tabKey(kind, row.id), kind, id: row.id, name: row.name, created_at: row.created_at, row }
    this.tabs = [...this.tabs.filter(t => t.key !== tab.key), tab]
    this.active = null
    this._renderStrip()
    this._setActive(tab.key)
    await this._saveOrder()
  }

  async _openLinkModal() {
    document.getElementById('pt-link-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'pt-link-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'
    overlay.innerHTML = `
      <div class="pt-link" onclick="event.stopPropagation()">
        <div style="font-size:14px;font-weight:600">Link a board or canvas</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">Standalone boards and canvases from Planning that aren't part of a project yet.</div>
        <input class="pt-link-search" placeholder="Search…" style="${inputStyle};width:100%;box-sizing:border-box;margin-top:12px">
        <div class="pt-link-list"><div class="pt-link-empty">Loading…</div></div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn-cancel pt-link-close">Close</button></div>
      </div>`
    const close = () => overlay.remove()
    overlay.addEventListener('click', close)
    overlay.querySelector('.pt-link-close')?.addEventListener('click', close)
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close() } })
    document.body.appendChild(overlay)
    const search = /** @type {HTMLInputElement} */ (overlay.querySelector('.pt-link-search'))
    const list = /** @type {HTMLElement} */ (overlay.querySelector('.pt-link-list'))
    setTimeout(() => search.focus(), 10)

    /** @type {{ kind: Kind, row: any }[]} */
    let rows = []
    try {
      const { boards, canvases } = await getLinkablePlanning(this.app.userId)
      rows = [
        ...boards.map((/** @type {any} */ r) => ({ kind: /** @type {Kind} */ ('board'), row: r })),
        ...canvases.map((/** @type {any} */ r) => ({ kind: /** @type {Kind} */ ('canvas'), row: r })),
      ].sort((a, b) => +new Date(b.row.created_at) - +new Date(a.row.created_at))
    } catch (e) {
      console.error(e)
      list.innerHTML = '<div class="pt-link-empty">Could not load boards.</div>'
      return
    }
    const draw = () => {
      const q = search.value.trim().toLowerCase()
      const shown = rows.filter(r => !q || r.row.name.toLowerCase().includes(q))
      list.innerHTML = shown.length ? shown.map(r => `
        <button class="pt-link-row" data-i="${rows.indexOf(r)}">
          <span class="pt-tab-icon">${ICON[r.kind]}</span>
          <span class="pt-link-name">${esc(r.row.name)}</span>
          <span class="pt-link-kind">${KIND_LABEL[r.kind]}</span>
        </button>`).join('')
        : `<div class="pt-link-empty">${rows.length ? 'No matches.' : 'Every board and canvas already belongs to a project. Create a new one from the + menu instead.'}</div>`
      list.querySelectorAll('.pt-link-row').forEach(btn => btn.addEventListener('click', async () => {
        const r = rows[Number(/** @type {HTMLElement} */ (btn).dataset.i)]
        const button = /** @type {HTMLButtonElement} */ (btn)
        button.disabled = true
        try {
          const updated = r.kind === 'board'
            ? await updateBoard(this.app.userId, r.row.id, { project_id: this.project.id })
            : await updateCanvas(this.app.userId, r.row.id, { project_id: this.project.id })
          if (r.kind === 'board') this.app.boardsView._boards = null
          else this.app.canvasView._canvases = null
          close()
          await this._addTab(r.kind, updated ?? { ...r.row, project_id: this.project.id })
          this.app.toast(`Linked “${r.row.name}”`)
        } catch (e) {
          console.error(e)
          button.disabled = false
          this.app.toast('Could not link')
        }
      }))
    }
    search.addEventListener('input', draw)
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') /** @type {HTMLElement | null} */ (list.querySelector('.pt-link-row'))?.click()
    })
    draw()
  }
}
