// @ts-check
// src/views/canvas-surface.js
// The interactive infinite canvas behind the Planning → Canvases feature.
//
// Architecture (see also src/utils/canvas-math.js, which holds every piece of
// geometry and is unit-tested):
//   • Items live in CANVAS space. One CSS transform on .cv-world maps them to
//     the screen, so panning/zooming never touches individual cards.
//   • Rendering is keyed: one element per item, kept in `_els`. A change to
//     one card re-renders that card only (compared by a content signature);
//     moving a card only rewrites its transform.
//   • Every DOM write that happens during a gesture is batched into a single
//     requestAnimationFrame (`_frame`). A card and the connectors attached to it
//     are updated in the same frame, so a line can never visibly lag behind or
//     detach from the card it belongs to, however fast the drag.
//   • All pointer/keyboard/clipboard handling is delegated from the wrapper, so
//     hundreds of cards cost no per-card listeners.

import {
  getCanvasData, createCanvas, updateCanvas, deleteCanvas,
  createCanvasItems, updateCanvasItem, deleteCanvasItems, updateCanvasItemGeometry,
  createCanvasArrow, updateCanvasArrow, deleteCanvasArrow,
  moveCanvasItems, getCanvasPreviews, duplicateCanvasTree,
} from '../db/client.js'
import {
  clampZoom, screenToCanvas, canvasToScreen, zoomAtPoint, fitToItems,
  normalizeWheel, wheelIntent, wheelZoomFactor, panBy, gridSpacing,
  boundsOf, rectFromPoints, rectsIntersect, rectContains, marqueeHits,
  connectorBetween, connectorToPoint, connectorPath, bezierPoint, magnetTarget,
  computeSnap, normalizeHex, readableOn, hexToRgb,
} from '../utils/canvas-math.js'

/**
 * @typedef {{
 *   id: string, canvas_id?: string, kind: string,
 *   x: number, y: number, w: number, h: number, z: number,
 *   content?: string | null, color?: string | null, image_url?: string | null, url?: string | null,
 *   links?: any[], sub_tasks?: any[], child_canvas_id?: string | null, created_at?: any,
 * }} Item
 * @typedef {{ id: string, canvas_id?: string, from_item_id: string, to_item_id: string, label?: string | null }} Arrow
 * @typedef {{ x: number, y: number, w: number, h: number, z: number }} Geo
 * @typedef {{ label: string, undo: () => Promise<void>, redo: () => Promise<void> }} HistoryEntry
 * @typedef {{ id: string, name: string, parent_id?: string | null, project_id?: string | null }} CanvasRow
 */

const POLL_MS = 4000
const HISTORY_LIMIT = 100
const DRAG_THRESHOLD = 3
const SNAP_PX = 6          // alignment-snap distance, in screen px
const MAGNET_PX = 28       // connector magnet reach, in screen px
const CLIP_MIME = 'application/x-slate-canvas'

export const NOTE_COLORS = ['#FFF8C5', '#DCEBFE', '#DCFCE7', '#FCE7F3', '#F3E8FF', '#FFEAD5', '#FFFFFF']
const BOARD_COLORS = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#475569']
const SWATCH_PRESETS = ['#1A1D23', '#F7F8FA', '#4F46E5', '#0EA5E9', '#10B981', '#84CC16', '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#8B5CF6', '#A16207']

/** @type {Record<string, [number, number]>} */
const MIN_SIZE = { note: [120, 60], image: [60, 40], link: [180, 90], todo: [200, 100], swatch: [100, 110], board: [150, 120] }
/** @type {Record<string, [number, number]>} */
const DEFAULT_SIZE = { note: [220, 140], image: [280, 200], link: [280, 120], todo: [280, 170], swatch: [160, 190], board: [200, 170] }

const TOOLS = [
  { kind: 'note',   icon: '✏️', label: 'Note',      key: 'N' },
  { kind: 'todo',   icon: '☑️', label: 'Checklist', key: 'C' },
  { kind: 'image',  icon: '🖼', label: 'Image',     key: 'I' },
  { kind: 'link',   icon: '🔗', label: 'Link',      key: 'K' },
  { kind: 'swatch', icon: '🎨', label: 'Colour',    key: 'S' },
  { kind: 'board',  icon: '▦',  label: 'Board',     key: 'B' },
]

const LINK_TYPES = [
  { id: 'client',  label: 'Client',  icon: '👤', color: '#a78bfa' },
  { id: 'project', label: 'Project', icon: '🎬', color: '#4a90d9' },
  { id: 'budget',  label: 'Budget',  icon: '£',  color: '#6ec96e' },
]

const inputStyle = 'font-size:13px;padding:6px 9px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none'

/** @param {any} s */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** @param {string | null | undefined} url */
function imgSrc(url) {
  if (!url) return ''
  if (url.includes('.private.blob.vercel-storage.com')) return `/api/blob?url=${encodeURIComponent(url)}`
  return esc(url)
}

// Only web URLs (or our own blob proxy) are ever opened in a new tab — never
// javascript:/data: URLs that could arrive via pasted canvas JSON.
/** @param {string | null | undefined} url @returns {string | null} */
function safeOpenUrl(url) {
  if (!url) return null
  if (url.includes('.private.blob.vercel-storage.com')) return `/api/blob?url=${encodeURIComponent(url)}`
  return /^https?:\/\//i.test(url) ? url : null
}

/** @param {string | null | undefined} url */
const displayUrl = url => String(url ?? '').replace(/^https?:\/\//i, '').replace(/\/$/, '')

/** @param {string | null | undefined} c @param {string} fallback */
const safeColor = (c, fallback) => normalizeHex(c) ?? fallback

/** @param {EventTarget | null} t @returns {HTMLElement | null} */
const asEl = t => (t instanceof Element ? /** @type {HTMLElement} */ (t) : null)

/** @param {Element | null} el */
const isTypingTarget = el => !!el && (
  el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
  /** @type {HTMLElement} */ (el).isContentEditable)

const blankTodoRow = () => ({ id: crypto.randomUUID(), text: '', owner_id: '', due_date: '', done: false })

let surfaceSeq = 0

export class CanvasSurface {
  /**
   * @param {any} app
   * @param {{
   *   canvas: CanvasRow,
   *   canvases: () => CanvasRow[],
   *   canEdit: boolean,
   *   projectId: string | null,
   *   onOpenBoard: (canvasId: string) => void,
   *   onCanvasesChanged?: () => void,
   * }} opts
   */
  constructor(app, opts) {
    this.app = app
    this.canvas = opts.canvas
    this.canvasId = opts.canvas.id
    this.canEdit = opts.canEdit
    this.projectId = opts.projectId
    this.getCanvases = opts.canvases
    this.onOpenBoard = opts.onOpenBoard
    this.onCanvasesChanged = opts.onCanvasesChanged ?? (() => {})
    this.uid = `cv${++surfaceSeq}`

    /** @type {Item[]} */ this.items = []
    /** @type {Map<string, Item>} */ this.byId = new Map()
    /** @type {Arrow[]} */ this.arrows = []
    /** @type {Map<string, Set<string>>} */ this._adj = new Map()
    /** @type {Map<string, HTMLElement>} */ this._els = new Map()
    /** @type {Map<string, string>} */ this._sigs = new Map()
    /** @type {Map<string, { g: SVGGElement, line: SVGPathElement, hit: SVGPathElement, label: HTMLElement }>} */
    this._arrowEls = new Map()
    /** @type {Map<string, { kind: string, x: number, y: number, w: number, h: number, color: string | null }[]>} */
    this._previews = new Map()

    this.viewport = { panX: 40, panY: 40, zoom: 1 }
    /** @type {Set<string>} */ this.sel = new Set()
    /** @type {string | null} */ this.selArrow = null
    this.tool = 'select'            // select | connect | hand
    /** @type {string | null} */ this._editingId = null
    /** @type {Set<string>} */ this._uploading = new Set()

    // Frame batching
    this._raf = 0
    this._vpDirty = false
    /** @type {Set<string>} */ this._dirty = new Set()
    /** @type {Set<string>} */ this._dirtyArrows = new Set()
    this._selbarDirty = false
    this._selbarContentDirty = false
    /** @type {import('../utils/canvas-math.js').Guide[]} */ this._guides = []
    this._guidesDirty = false
    /** @type {import('../utils/canvas-math.js').Connector | null} */ this._draft = null
    this._draftDirty = false

    // Gesture / input state
    /** @type {(() => void) | null} */ this._endGesture = null
    this._gesture = ''
    this._spaceDown = false
    this._active = false            // last pointerdown landed on this canvas
    this._hover = false             // pointer is over the canvas
    /** @type {{ x: number, y: number } | null} */ this._pointer = null
    this._trackpadUntil = 0
    /** @type {Map<number, { x: number, y: number }>} */ this._touches = new Map()

    // History
    /** @type {HistoryEntry[]} */ this._undo = []
    /** @type {HistoryEntry[]} */ this._redo = []
    this._historyBusy = false

    // Sync
    this._writes = 0
    /** @type {string | null} */ this._snapshot = null
    /** @type {ReturnType<typeof setInterval> | null} */ this._pollTimer = null
    this._pollCount = 0
    /** @type {Record<string, ReturnType<typeof setTimeout>>} */ this._saveTimers = {}
    /** @type {Array<[EventTarget, string, EventListener, any?]>} */ this._docListeners = []
    this._destroyed = false

    // Populated on mount / during use
    /** @type {HTMLElement | null} */ this._wrap = null
    /** @type {HTMLElement | null} */ this._world = null
    /** @type {HTMLElement | null} */ this._itemsEl = null
    /** @type {SVGGElement | null} */ this._linkLayer = null
    /** @type {HTMLElement | null} */ this._labelLayer = null
    /** @type {SVGPathElement | null} */ this._draftPath = null
    /** @type {SVGGElement | null} */ this._guideLayer = null
    /** @type {HTMLElement | null} */ this._marquee = null
    /** @type {HTMLElement | null} */ this._selbar = null
    /** @type {HTMLElement | null} */ this._hintEl = null
    /** @type {HTMLInputElement | null} */ this._fileInput = null
    /** @type {HTMLElement | null} */ this._shieldEl = null
    this._fitOnMount = false
    /** @type {ReturnType<typeof setTimeout> | undefined} */ this._settleTimer = undefined
    /** @type {number | undefined} */ this._vpAnim = undefined
    /** @type {Record<string, () => void> | undefined} */ this._pendingSaves = undefined
    /** @type {Map<string, Geo> | null} */ this._nudgeBefore = null
    /** @type {ReturnType<typeof setTimeout> | undefined} */ this._nudgeTimer = undefined
    this._nudging = false
    /** @type {{ items: Item[], arrows: Arrow[] } | null} */ this._clip = null
    /** @type {string | null} */ this._fileTarget = null
    /** @type {HTMLElement | null} */ this._dropHi = null
    /** @type {(() => Promise<void>) | null} */ this._popoverClose = null
    this._invZoom = ''
    /** @type {number | null} */ this._zoomTarget = null
    /** @type {{ x: number, y: number } | null} */ this._zoomAt = null
    this._zoomRaf = 0
    this._suppressClick = false
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async load() {
    const { items, arrows } = await getCanvasData(this.canvasId)
    this._setData(/** @type {Item[]} */ (items), /** @type {Arrow[]} */ (arrows))
    this._snapshot = this._serialize()
    await this._loadPreviews()
    /** @type {any} */ let saved = null
    try { saved = JSON.parse(localStorage.getItem(`cv-vp-${this.canvasId}`) || 'null') } catch { saved = null }
    if (saved && isFinite(saved.zoom) && isFinite(saved.panX) && isFinite(saved.panY)) {
      this.viewport = { panX: saved.panX, panY: saved.panY, zoom: clampZoom(saved.zoom) }
      this._fitOnMount = false
    } else {
      this._fitOnMount = this.items.length > 0
    }
  }

  /** @param {HTMLElement} host @param {string} height */
  mount(host, height) {
    host.innerHTML = this._shellHtml(height)
    this._wrap = /** @type {HTMLElement} */ (host.querySelector('.cv-wrap'))
    this._world = /** @type {HTMLElement} */ (this._wrap.querySelector('.cv-world'))
    this._itemsEl = /** @type {HTMLElement} */ (this._wrap.querySelector('.cv-items'))
    this._linkLayer = /** @type {SVGGElement} */ (this._wrap.querySelector('.cv-link-layer'))
    this._labelLayer = /** @type {HTMLElement} */ (this._wrap.querySelector('.cv-labels'))
    this._draftPath = /** @type {SVGPathElement} */ (this._wrap.querySelector('.cv-link-draft'))
    this._guideLayer = /** @type {SVGGElement} */ (this._wrap.querySelector('.cv-guide-layer'))
    this._marquee = /** @type {HTMLElement} */ (this._wrap.querySelector('.cv-marquee'))
    this._selbar = /** @type {HTMLElement} */ (this._wrap.querySelector('.cv-selbar'))
    this._hintEl = /** @type {HTMLElement} */ (this._wrap.querySelector('.cv-hint'))
    this._fileInput = /** @type {HTMLInputElement} */ (this._wrap.querySelector('.cv-file'))
    this._shieldEl = /** @type {HTMLElement} */ (this._wrap.querySelector('.cv-shield'))

    if (this._fitOnMount) {
      // First visit: frame the content, but never start zoomed in past 100%.
      const fit = this._fitViewport(this.items)
      const o = this._origin()
      this.viewport = fit.zoom > 1 ? zoomAtPoint(fit, { x: o.width / 2, y: o.height / 2 }, 1) : fit
    }

    this._reconcile()
    this._syncArrows()
    this._vpDirty = true
    this._frame()
    this._applyInverseZoom()
    this._world?.addEventListener('animationend', () => this._wrap?.classList.remove('cv-wrap--enter'), { once: true })
    this._bindEvents()
    this._startPolling()
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this._endGesture?.()
    // Anything still debounced (typing, a nudge burst) is written now, not dropped.
    this._flushAllSaves()
    if (this._pollTimer) clearInterval(this._pollTimer)
    this._pollTimer = null
    if (this._raf) cancelAnimationFrame(this._raf)
    if (this._zoomRaf) cancelAnimationFrame(this._zoomRaf)
    cancelAnimationFrame(this._vpAnim || 0)
    for (const [target, type, fn, o] of this._docListeners) target.removeEventListener(type, fn, o)
    this._docListeners = []
    for (const t of Object.values(this._saveTimers)) clearTimeout(t)
    document.querySelectorAll(`[data-cv-owner="${this.uid}"]`).forEach(el => el.remove())
  }

  // The user is working on this canvas: pointer over it, or it was the last
  // thing clicked.
  get _engaged() { return this._active || this._hover }

  get _mounted() {
    return !this._destroyed && !!this._wrap && document.contains(this._wrap)
  }

  // ── Data helpers ─────────────────────────────────────────────────────────────

  /** @param {Item[]} items @param {Arrow[]} arrows */
  _setData(items, arrows) {
    this.items = items
    this.byId = new Map(items.map(i => [i.id, i]))
    this.arrows = arrows
  }

  _serialize() {
    const its = [...this.items]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(i => [i.id, i.kind, i.x, i.y, i.w, i.h, i.z, i.content, i.color, i.image_url, i.url,
        JSON.stringify(i.links), JSON.stringify(i.sub_tasks), i.child_canvas_id])
    const ars = [...this.arrows]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(a => [a.id, a.from_item_id, a.to_item_id, a.label])
    return JSON.stringify([its, ars])
  }

  /** Wrap a persistence call: pauses polling while in flight and refreshes the snapshot after. @param {() => Promise<any>} fn @param {string} [errMsg] */
  async _write(fn, errMsg) {
    this._writes++
    try {
      const r = await fn()
      this._snapshot = this._serialize()
      return r
    } catch (e) {
      console.error(e)
      if (errMsg) this.app.toast(errMsg)
      return undefined
    } finally {
      this._writes--
    }
  }

  _maxZ() { let m = 0; for (const i of this.items) if ((i.z || 0) > m) m = i.z || 0; return m }
  _minZ() { let m = 0; for (const i of this.items) if ((i.z || 0) < m) m = i.z || 0; return m }

  /** @param {Item} it @returns {Geo} */
  _geo(it) { return { x: it.x, y: it.y, w: it.w, h: it.h, z: it.z || 0 } }

  _selectedItems() {
    /** @type {Item[]} */ const out = []
    for (const id of this.sel) { const it = this.byId.get(id); if (it) out.push(it) }
    return out
  }

  _viewCenter() {
    if (!this._wrap) return { x: 0, y: 0 }
    const o = this._origin()
    const inset = this._leftInset()
    return screenToCanvas({ x: inset + (o.width - inset) / 2, y: o.height / 2 }, this.viewport)
  }

  // The world is positioned inside the wrapper's border, so screen maths is
  // measured from the padding box — not getBoundingClientRect's border box —
  // or zoom-at-cursor and drops drift by the border width.
  _origin() {
    const w = /** @type {HTMLElement} */ (this._wrap)
    const r = w.getBoundingClientRect()
    return { left: r.left + w.clientLeft, top: r.top + w.clientTop, width: w.clientWidth, height: w.clientHeight }
  }

  /** @param {number} clientX @param {number} clientY */
  _toLocal(clientX, clientY) {
    const o = this._origin()
    return { x: clientX - o.left, y: clientY - o.top }
  }

  /** @param {number} clientX @param {number} clientY */
  _clientToCanvas(clientX, clientY) {
    return screenToCanvas(this._toLocal(clientX, clientY), this.viewport)
  }

  // Room taken by the floating palette on the left, so "fit" never tucks
  // cards underneath it.
  _leftInset() { return this.canEdit ? (this._wrap?.querySelector('.cv-palette')?.getBoundingClientRect().width ?? 0) + 12 : 0 }

  /** @param {import('../utils/canvas-math.js').Rect[]} rects */
  _fitViewport(rects) {
    const o = this._origin()
    const inset = o.width > 640 ? this._leftInset() : 0
    const fit = fitToItems(rects, { width: o.width - inset, height: o.height }, 60)
    return { ...fit, panX: fit.panX + inset }
  }

  // Canvas-space rect currently visible (plus a margin) — limits per-frame
  // work such as snapping to what the user can actually see.
  _visibleRect(margin = 200) {
    const o = this._origin()
    const a = screenToCanvas({ x: -margin, y: -margin }, this.viewport)
    const b = screenToCanvas({ x: o.width + margin, y: o.height + margin }, this.viewport)
    return rectFromPoints(a, b)
  }

  // ── Shell ────────────────────────────────────────────────────────────────────

  /** @param {string} height */
  _shellHtml(height) {
    const palette = !this.canEdit ? '' : `
      <div class="cv-palette cv-ui" role="toolbar" aria-label="Add to canvas">
        ${TOOLS.map(t => `
          <button class="cv-pal-btn" data-tool="${t.kind}" title="${t.label} (${t.key}) — click, or drag onto the canvas">
            <span class="cv-pal-icon">${t.icon}</span><span class="cv-pal-label">${t.label}</span>
          </button>`).join('')}
        <div class="cv-pal-sep"></div>
        <button class="cv-pal-btn" data-mode="connect" title="Connect (L) — drag from one card to another">
          <span class="cv-pal-icon">↗</span><span class="cv-pal-label">Line</span>
        </button>
        <button class="cv-pal-btn" data-mode="hand" title="Hand (H) — drag to pan. Or hold Space">
          <span class="cv-pal-icon">✋</span><span class="cv-pal-label">Pan</span>
        </button>
      </div>`
    return `
      <div class="cv-wrap cv-wrap--enter${this.canEdit ? '' : ' cv-wrap--readonly'}" tabindex="-1" style="height:${height}">
        <div class="cv-world">
          <svg class="cv-links" aria-hidden="true">
            <defs>
              <marker id="${this.uid}-head" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="13" markerHeight="13" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                <path d="M1,1.5 L11,6 L1,10.5 L3.2,6 z" class="cv-head"></path>
              </marker>
              <marker id="${this.uid}-head-sel" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="13" markerHeight="13" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                <path d="M1,1.5 L11,6 L1,10.5 L3.2,6 z" class="cv-head cv-head--sel"></path>
              </marker>
            </defs>
            <g class="cv-link-layer"></g>
          </svg>
          <div class="cv-items"></div>
          <div class="cv-labels"></div>
          <svg class="cv-overlay" aria-hidden="true">
            <g class="cv-guide-layer"></g>
            <path class="cv-link-draft" marker-end="url(#${this.uid}-head-sel)" d=""></path>
          </svg>
        </div>
        <div class="cv-marquee" hidden></div>
        <div class="cv-shield"></div>
        ${palette}
        <div class="cv-selbar cv-ui" hidden></div>
        <div class="cv-hint" aria-live="polite"></div>
        <div class="cv-zoom cv-ui">
          <button data-zoom="out" title="Zoom out (⌘−)">−</button>
          <button data-zoom="reset" title="Reset to 100% (⌘0)"><span class="cv-zoom-pct">100%</span></button>
          <button data-zoom="in" title="Zoom in (⌘+)">+</button>
          <button data-zoom="fit" title="Fit to content (⇧1)">⊡</button>
          <button data-zoom="full" title="Focus mode">⤢</button>
          <button data-zoom="help" title="Shortcuts">?</button>
        </div>
        <input type="file" class="cv-file" accept="image/*" multiple hidden>
      </div>`
  }

  // ── Rendering: items (keyed) ─────────────────────────────────────────────────

  /** @param {Item} it */
  _sig(it) {
    const up = this._uploading.has(it.id) ? 1 : 0
    const extra = it.kind === 'board' ? JSON.stringify(this._previews.get(it.child_canvas_id || '') ?? null) : ''
    return JSON.stringify([it.kind, it.content, it.color, it.image_url, it.url, it.links, it.sub_tasks, it.child_canvas_id, up, extra])
  }

  _reconcile() {
    const layer = this._itemsEl
    if (!layer) return
    const seen = new Set()
    for (const it of this.items) {
      seen.add(it.id)
      let el = this._els.get(it.id)
      const sig = this._sig(it)
      if (!el) {
        el = document.createElement('div')
        el.dataset.item = it.id
        this._els.set(it.id, el)
        layer.appendChild(el)
        this._paintItem(el, it)
        this._sigs.set(it.id, sig)
      } else if (this._sigs.get(it.id) !== sig) {
        // Never repaint under the user's caret — their local copy is newer.
        if (!(el.contains(document.activeElement) && isTypingTarget(document.activeElement))) {
          this._paintItem(el, it)
          this._sigs.set(it.id, sig)
        }
      }
      this._place(el, it)
      el.classList.toggle('cv-item--selected', this.sel.has(it.id))
    }
    for (const [id, el] of this._els) {
      if (!seen.has(id)) { el.remove(); this._els.delete(id); this._sigs.delete(id) }
    }
    for (const id of [...this.sel]) if (!this.byId.has(id)) this.sel.delete(id)
    this._selbarContentDirty = true
    this._requestFrame()
  }

  /** @param {HTMLElement} el @param {Item} it */
  _place(el, it) {
    el.style.transform = `translate(${it.x}px, ${it.y}px)`
    el.style.width = `${it.w}px`
    el.style.height = `${it.h}px`
    el.style.zIndex = String(it.z || 0)
  }

  /** @param {HTMLElement} el @param {Item} it */
  _paintItem(el, it) {
    el.className = `cv-item cv-item--${it.kind}${this.sel.has(it.id) ? ' cv-item--selected' : ''}${this._uploading.has(it.id) ? ' cv-item--uploading' : ''}`
    const chips = this._chipsHtml(it)
    const ports = this.canEdit ? '<span class="cv-port" data-port="top"></span><span class="cv-port" data-port="right"></span><span class="cv-port" data-port="bottom"></span><span class="cv-port" data-port="left"></span>' : ''
    const resize = this.canEdit ? '<span class="cv-resize" data-resize title="Resize"></span>' : ''
    el.innerHTML = `${this._bodyHtml(it)}${chips ? `<div class="cv-item-chips">${chips}</div>` : ''}${ports}${resize}`
    if (it.id === this._editingId) {
      const ta = /** @type {HTMLTextAreaElement | null} */ (el.querySelector('.cv-note-text'))
      if (ta) { ta.readOnly = false; ta.classList.add('cv-note-text--editing') }
    }
  }

  /** @param {Item} it */
  _bodyHtml(it) {
    const dis = this.canEdit ? '' : 'disabled'
    if (it.kind === 'image') {
      if (it.image_url) return `<img class="cv-img" src="${imgSrc(it.image_url)}" alt="" draggable="false" loading="lazy" decoding="async">`
      const up = this._uploading.has(it.id)
      return `
        <div class="cv-drop">
          <div class="cv-drop-icon">${up ? '<span class="cv-spinner"></span>' : '🖼'}</div>
          <div class="cv-drop-title">${up ? 'Uploading…' : 'Drop an image here'}</div>
          ${this.canEdit && !up ? `
          <div class="cv-drop-actions">
            <button class="cv-mini-btn" data-card-act="upload">Upload</button>
            <button class="cv-mini-btn" data-card-act="image-url">Paste URL</button>
          </div>` : ''}
        </div>`
    }
    if (it.kind === 'link') {
      return `
        <div class="cv-link-body">
          ${it.image_url
            ? `<div class="cv-link-thumb"><img src="${imgSrc(it.image_url)}" alt="" draggable="false" loading="lazy"></div>`
            : `<div class="cv-link-thumb cv-link-thumb--none"><span class="cv-link-glyph">${esc(displayUrl(it.url).charAt(0).toUpperCase() || '🔗')}</span></div>`}
          <div class="cv-link-meta">
            <div class="cv-link-title">${esc(it.content || displayUrl(it.url))}</div>
            <a class="cv-link-url" href="${esc(/^https?:\/\//i.test(it.url || '') ? it.url : '#')}" target="_blank" rel="noopener noreferrer">${esc(displayUrl(it.url))}</a>
          </div>
        </div>`
    }
    if (it.kind === 'todo') {
      const rows = Array.isArray(it.sub_tasks) ? it.sub_tasks : []
      const done = rows.filter(r => r.done).length
      return `
        <div class="cv-todo">
          <div class="cv-todo-head">
            <input class="cv-todo-title" value="${esc(it.content || '')}" placeholder="Checklist" ${dis}>
            <span class="cv-todo-count">${rows.length ? `${done}/${rows.length}` : ''}</span>
          </div>
          ${rows.length ? `<div class="cv-todo-bar"><span style="width:${Math.round(done / rows.length * 100)}%"></span></div>` : ''}
          <div class="cv-todo-rows">${rows.map(st => this._todoRowHtml(st)).join('')}</div>
          ${this.canEdit ? '<button class="cv-todo-add" data-card-act="todo-add">+ Add item</button>' : ''}
        </div>`
    }
    if (it.kind === 'swatch') {
      const hex = safeColor(it.color, '#4F46E5')
      const rgb = hexToRgb(hex)
      return `
        <div class="cv-swatch-chip" style="background:${hex};color:${readableOn(hex)}"><span class="cv-swatch-hex">${hex}</span></div>
        <div class="cv-swatch-meta">
          <div class="cv-swatch-name">${esc(it.content || 'Untitled colour')}</div>
          <div class="cv-swatch-rgb">${rgb ? `RGB ${rgb.r} ${rgb.g} ${rgb.b}` : ''}</div>
        </div>`
    }
    if (it.kind === 'board') {
      const color = safeColor(it.color, BOARD_COLORS[0])
      const rects = this._previews.get(it.child_canvas_id || '') ?? []
      const count = rects.length
      return `
        <div class="cv-board">
          <div class="cv-board-tile" style="background:${color}">${this._boardPreviewSvg(rects)}</div>
          <div class="cv-board-meta">
            <div class="cv-board-name">${esc(this._boardName(it))}</div>
            <div class="cv-board-sub">${count ? `${count} card${count === 1 ? '' : 's'}` : 'Empty board'} · <span class="cv-board-open" data-card-act="open-board">Open ›</span></div>
          </div>
        </div>`
    }
    const bg = safeColor(it.color, NOTE_COLORS[0])
    return `<div class="cv-note" style="background:${bg}"><textarea class="cv-note-text" spellcheck="true" placeholder="${this.canEdit ? 'Type something…' : ''}" readonly>${esc(it.content || '')}</textarea></div>`
  }

  /** @param {{ kind: string, x: number, y: number, w: number, h: number, color: string | null }[]} rects */
  _boardPreviewSvg(rects) {
    if (!rects.length) return '<span class="cv-board-glyph">▦</span>'
    const shown = rects.slice(0, 80)
    const b = boundsOf(shown)
    const span = Math.max(b.w, b.h, 1)
    const pad = span * 0.08
    const rx = span * 0.012
    return `<svg class="cv-board-preview" viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}" preserveAspectRatio="xMidYMid meet">
      ${shown.map(r => {
        const fill = (r.kind === 'note' || r.kind === 'swatch') ? safeColor(r.color, '#FFFFFF') : r.kind === 'board' ? 'rgba(255,255,255,0.55)' : '#FFFFFF'
        return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${rx}" fill="${fill}" opacity="0.92"></rect>`
      }).join('')}
    </svg>`
  }

  /** @param {Item} it */
  _boardName(it) {
    if (it.content) return it.content
    const c = this.getCanvases().find(x => x.id === it.child_canvas_id)
    return c?.name || 'Untitled board'
  }

  /** @param {any} st */
  _todoRowHtml(st) {
    const users = this.app.allUsers ?? []
    const dis = this.canEdit ? '' : 'disabled'
    return `
      <div class="cv-todo-row${st.done ? ' cv-todo-row--done' : ''}" data-st-id="${esc(st.id || '')}">
        <input type="checkbox" class="cv-todo-done" ${st.done ? 'checked' : ''} ${dis}>
        <input class="cv-todo-text" value="${esc(st.text || '')}" placeholder="Item…" ${dis}>
        <select class="cv-todo-owner${st.owner_id ? ' is-set' : ''}" ${dis} title="Owner">
          <option value="">Owner</option>
          ${users.map((/** @type {any} */ u) => `<option value="${esc(u.clerk_id)}"${st.owner_id === u.clerk_id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
        </select>
        <input type="date" class="cv-todo-due${st.due_date ? ' is-set' : ''}" value="${esc(st.due_date || '')}" ${dis} title="Due date">
        ${this.canEdit ? '<button class="cv-todo-del" data-card-act="todo-del" title="Remove">×</button>' : ''}
      </div>`
  }

  /** @param {Item} it */
  _chipsHtml(it) {
    const links = Array.isArray(it.links) ? it.links : []
    return links.map(l => {
      const t = LINK_TYPES.find(x => x.id === l.type)
      const name = this._entityName(l.type, l.id)
      if (!t || !name) return ''
      return `<span class="bd-chip" data-chip-type="${esc(l.type)}" data-chip-id="${esc(l.id)}" style="color:${t.color};background:${t.color}26">${t.icon} ${esc(name)}</span>`
    }).join('')
  }

  /** @param {string} type @param {string} id */
  _entityName(type, id) {
    if (type === 'client') {
      const c = (this.app.contacts ?? []).find((/** @type {any} */ x) => x.id === id)
      return c ? `${c.first_name} ${c.last_name}`.trim() : null
    }
    if (type === 'project') return (this.app.projects ?? []).find((/** @type {any} */ x) => x.id === id)?.name ?? null
    if (type === 'budget') return (this.app.budgets ?? []).find((/** @type {any} */ x) => x.id === id)?.name ?? null
    return null
  }

  /** Repaint one card now (after a local edit that changes its face). @param {string} id */
  _repaint(id) {
    const it = this.byId.get(id), el = this._els.get(id)
    if (!it || !el) return
    this._paintItem(el, it)
    this._sigs.set(id, this._sig(it))
    this._place(el, it)
    this._markItem(id)
  }

  // ── Rendering: connectors ────────────────────────────────────────────────────

  _syncArrows() {
    const layer = this._linkLayer, labels = this._labelLayer
    if (!layer || !labels) return
    const svgNS = 'http://www.w3.org/2000/svg'
    this._adj = new Map()
    const seen = new Set()
    for (const a of this.arrows) {
      if (!this.byId.has(a.from_item_id) || !this.byId.has(a.to_item_id)) continue
      seen.add(a.id)
      for (const end of [a.from_item_id, a.to_item_id]) {
        let s = this._adj.get(end)
        if (!s) { s = new Set(); this._adj.set(end, s) }
        s.add(a.id)
      }
      let rec = this._arrowEls.get(a.id)
      if (!rec) {
        const g = /** @type {SVGGElement} */ (document.createElementNS(svgNS, 'g'))
        g.setAttribute('class', 'cv-link')
        g.dataset.arrow = a.id
        const hit = /** @type {SVGPathElement} */ (document.createElementNS(svgNS, 'path'))
        hit.setAttribute('class', 'cv-link-hit')
        const line = /** @type {SVGPathElement} */ (document.createElementNS(svgNS, 'path'))
        line.setAttribute('class', 'cv-link-line')
        line.setAttribute('marker-end', `url(#${this.uid}-head)`)
        g.append(hit, line)
        layer.appendChild(g)
        const label = document.createElement('div')
        label.className = 'cv-link-label'
        label.dataset.arrow = a.id
        labels.appendChild(label)
        rec = { g, line, hit, label }
        this._arrowEls.set(a.id, rec)
      }
      const text = a.label || ''
      if (rec.label.textContent !== text) rec.label.textContent = text
      rec.label.hidden = !text
      const selected = this.selArrow === a.id
      rec.g.classList.toggle('cv-link--selected', selected)
      rec.label.classList.toggle('cv-link-label--selected', selected)
      rec.line.setAttribute('marker-end', `url(#${this.uid}-head${selected ? '-sel' : ''})`)
      this._dirtyArrows.add(a.id)
    }
    for (const [id, rec] of this._arrowEls) {
      if (!seen.has(id)) { rec.g.remove(); rec.label.remove(); this._arrowEls.delete(id) }
    }
    if (this.selArrow && !seen.has(this.selArrow)) this.selArrow = null
    this._requestFrame()
  }

  /** @param {string} id */
  _drawArrow(id) {
    const rec = this._arrowEls.get(id)
    const a = this.arrows.find(x => x.id === id)
    if (!rec || !a) return
    const from = this.byId.get(a.from_item_id), to = this.byId.get(a.to_item_id)
    if (!from || !to) return
    const c = connectorBetween(from, to)
    const d = connectorPath(c)
    rec.line.setAttribute('d', d)
    rec.hit.setAttribute('d', d)
    if (a.label) {
      const m = bezierPoint(c, 0.5)
      rec.label.style.transform = `translate(${m.x}px, ${m.y}px) translate(-50%, -50%)`
    }
  }

  // ── Frame loop ───────────────────────────────────────────────────────────────

  _requestFrame() {
    if (this._raf || this._destroyed) return
    this._raf = requestAnimationFrame(() => this._frame())
  }

  _frame() {
    this._raf = 0
    if (!this._wrap) return
    if (this._vpDirty) {
      this._vpDirty = false
      const { panX, panY, zoom } = this.viewport
      if (this._world) this._world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`
      const g = gridSpacing(zoom)
      this._wrap.style.backgroundSize = `${g}px ${g}px`
      this._wrap.style.backgroundPosition = `${panX}px ${panY}px`
      const pct = this._wrap.querySelector('.cv-zoom-pct')
      if (pct) pct.textContent = `${Math.round(zoom * 100)}%`
      this._selbarDirty = true
    }
    if (this._dirty.size) {
      for (const id of this._dirty) {
        const el = this._els.get(id), it = this.byId.get(id)
        if (el && it) this._place(el, it)
        const adj = this._adj.get(id)
        if (adj) for (const a of adj) this._dirtyArrows.add(a)
      }
      this._dirty.clear()
      this._selbarDirty = true
    }
    if (this._dirtyArrows.size) {
      for (const id of this._dirtyArrows) this._drawArrow(id)
      this._dirtyArrows.clear()
    }
    if (this._draftDirty && this._draftPath) {
      this._draftDirty = false
      this._draftPath.setAttribute('d', this._draft ? connectorPath(this._draft) : '')
    }
    if (this._guidesDirty && this._guideLayer) {
      this._guidesDirty = false
      this._guideLayer.innerHTML = this._guides.map(g => g.axis === 'x'
        ? `<line x1="${g.x}" y1="${g.y1}" x2="${g.x}" y2="${g.y2}"></line>`
        : `<line x1="${g.x1}" y1="${g.y}" x2="${g.x2}" y2="${g.y}"></line>`).join('')
    }
    if (this._selbarContentDirty) { this._selbarContentDirty = false; this._renderSelbar(); this._selbarDirty = true }
    if (this._selbarDirty) { this._selbarDirty = false; this._positionSelbar() }
  }

  /** @param {string} id */
  _markItem(id) { this._dirty.add(id); this._requestFrame() }

  // ── Viewport ─────────────────────────────────────────────────────────────────

  /** @param {{ panX: number, panY: number, zoom: number }} vp */
  _setViewport(vp) {
    this.viewport = vp
    this._vpDirty = true
    this._requestFrame()
    // `will-change` only while moving: permanent promotion would leave text
    // blurry after a zoom, so it's dropped once the viewport settles and the
    // browser re-rasterises crisply at the new scale.
    this._wrap?.classList.add('cv-wrap--moving')
    clearTimeout(this._settleTimer)
    this._settleTimer = setTimeout(() => {
      this._wrap?.classList.remove('cv-wrap--moving')
      this._applyInverseZoom()
      this._saveViewport()
    }, 180)
  }

  // Handles, ports and hit areas keep a constant on-screen size via
  // --cv-inv-zoom. Every element that inherits it restyles when it changes,
  // so it is written once the view settles, never per zoom frame.
  _applyInverseZoom() {
    const v = String(1 / this.viewport.zoom)
    if (this._invZoom === v) return
    this._invZoom = v
    this._wrap?.style.setProperty('--cv-inv-zoom', v)
  }

  _saveViewport() {
    try { localStorage.setItem(`cv-vp-${this.canvasId}`, JSON.stringify(this.viewport)) } catch { /* storage unavailable */ }
  }

  /** @param {number} factor @param {{ x: number, y: number } | null} [at] */
  _zoomBy(factor, at = null) {
    const o = this._origin()
    const p = at ?? { x: o.width / 2, y: o.height / 2 }
    this._animateViewport(zoomAtPoint(this.viewport, p, this.viewport.zoom * factor))
  }

  _fit() {
    const target = this.sel.size ? this._selectedItems() : this.items
    if (!target.length) { this._animateViewport({ panX: this._leftInset() + 40, panY: 40, zoom: 1 }); return }
    this._animateViewport(this._fitViewport(target))
  }

  // Short eased transition for button/keyboard zooms (wheel and pinch are
  // already continuous, so they apply directly).
  /** @param {{ panX: number, panY: number, zoom: number }} to */
  _animateViewport(to) {
    cancelAnimationFrame(this._vpAnim || 0)
    this._zoomTarget = null
    const from = { ...this.viewport }
    const t0 = performance.now()
    const dur = 180
    const step = (/** @type {number} */ now) => {
      const t = Math.min(1, (now - t0) / dur)
      const e = 1 - Math.pow(1 - t, 3)
      // Interpolate zoom geometrically so the motion feels uniform.
      const zoom = from.zoom * Math.pow(to.zoom / from.zoom, e)
      this._setViewport({ zoom, panX: from.panX + (to.panX - from.panX) * e, panY: from.panY + (to.panY - from.panY) * e })
      if (t < 1) this._vpAnim = requestAnimationFrame(step)
    }
    this._vpAnim = requestAnimationFrame(step)
  }

  /** @param {WheelEvent} e */
  _onWheel(e) {
    // Let scrollable card contents (a long checklist, a note being edited) scroll.
    const t = asEl(e.target)
    const scroller = t?.closest('.cv-todo, .cv-note-text--editing')
    if (scroller && !e.ctrlKey && !e.metaKey && scroller.scrollHeight > scroller.clientHeight) return
    e.preventDefault()
    cancelAnimationFrame(this._vpAnim || 0)
    const now = performance.now()
    if (this._zoomTarget != null && (e.ctrlKey || wheelIntent(e, now < this._trackpadUntil) === 'pan')) this._zoomTarget = null
    const intent = wheelIntent(e, now < this._trackpadUntil)
    const d = normalizeWheel(e)
    if (intent === 'pan') {
      this._trackpadUntil = now + 220
      // Shift+wheel on a mouse scrolls sideways.
      const dx = e.shiftKey && !d.x ? d.y : d.x
      const dy = e.shiftKey && !d.x ? 0 : d.y
      this._setViewport(panBy(this.viewport, dx, dy))
    } else {
      const pinch = e.ctrlKey && (!Number.isInteger(e.deltaY) || Math.abs(d.y) < 50)
      const f = wheelZoomFactor(d.y, pinch)
      const at = this._toLocal(e.clientX, e.clientY)
      if (pinch) {
        // Pinch deltas already arrive as a smooth stream — apply directly.
        this._zoomTarget = null
        this._setViewport(zoomAtPoint(this.viewport, at, this.viewport.zoom * f))
      } else {
        // A mouse notch is a big discrete step: ease towards it (and keep
        // accumulating notches) instead of jumping.
        this._zoomAt = at
        this._zoomTarget = clampZoom((this._zoomTarget ?? this.viewport.zoom) * f)
        if (!this._zoomRaf) this._zoomRaf = requestAnimationFrame(() => this._zoomStep())
      }
    }
  }

  _zoomStep() {
    this._zoomRaf = 0
    const target = this._zoomTarget
    if (target == null || !this._zoomAt || this._destroyed) return
    const cur = this.viewport.zoom
    const ratio = target / cur
    const next = Math.abs(Math.log(ratio)) < 0.003 ? target : cur * Math.pow(ratio, 0.38)
    this._setViewport(zoomAtPoint(this.viewport, this._zoomAt, next))
    if (next === target) this._zoomTarget = null
    else this._zoomRaf = requestAnimationFrame(() => this._zoomStep())
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  /** @param {EventTarget} target @param {string} type @param {any} fn @param {any} [opts] */
  _listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts)
    this._docListeners.push([target, type, fn, opts])
  }

  _bindEvents() {
    const wrap = /** @type {HTMLElement} */ (this._wrap)
    wrap.addEventListener('pointerdown', e => this._onPointerDown(e))
    // Hovering the canvas is enough for its keyboard shortcuts to apply.
    wrap.addEventListener('pointermove', e => { this._pointer = this._toLocal(e.clientX, e.clientY); this._hover = true })
    wrap.addEventListener('pointerleave', () => { this._pointer = null; this._hover = false })
    wrap.addEventListener('wheel', e => this._onWheel(e), { passive: false })
    wrap.addEventListener('dblclick', e => this._onDblClick(e))
    wrap.addEventListener('click', e => this._onClick(e))
    wrap.addEventListener('input', e => this._onInput(e))
    wrap.addEventListener('change', e => this._onChange(e))
    wrap.addEventListener('keydown', e => this._onCardKeyDown(e))
    wrap.addEventListener('focusout', e => this._onFocusOut(e))
    wrap.addEventListener('contextmenu', e => { if (this._gesture) e.preventDefault() })
    wrap.addEventListener('dragstart', e => { if (!asEl(e.target)?.closest('input, textarea')) e.preventDefault() })

    // Safari trackpad pinch arrives as proprietary gesture events, not ctrl+wheel.
    /** @type {number} */ let gestureZoom = 1
    wrap.addEventListener('gesturestart', (/** @type {any} */ e) => { e.preventDefault(); gestureZoom = this.viewport.zoom })
    wrap.addEventListener('gesturechange', (/** @type {any} */ e) => {
      e.preventDefault()
      this._setViewport(zoomAtPoint(this.viewport, this._toLocal(e.clientX, e.clientY), gestureZoom * e.scale))
    })
    wrap.addEventListener('gestureend', (/** @type {any} */ e) => e.preventDefault())

    this._fileInput?.addEventListener('change', () => this._onFilesChosen())

    if (this.canEdit) {
      wrap.addEventListener('dragover', e => this._onDragOver(e))
      wrap.addEventListener('dragleave', e => { if (!wrap.contains(/** @type {Node} */ (e.relatedTarget))) this._setDropHighlight(null) })
      wrap.addEventListener('drop', e => this._onDrop(e))
    }

    this._listen(document, 'pointerdown', (/** @type {PointerEvent} */ e) => {
      if (!this._mounted) return this.destroy()
      const t = /** @type {Node} */ (e.target)
      this._active = wrap.contains(t) || !!asEl(e.target)?.closest(`[data-cv-owner="${this.uid}"]`)
    }, true)
    this._listen(document, 'keydown', (/** @type {KeyboardEvent} */ e) => this._onKeyDown(e))
    this._listen(document, 'keyup', (/** @type {KeyboardEvent} */ e) => {
      if (e.key === ' ' && this._spaceDown) { this._spaceDown = false; wrap.classList.remove('cv-wrap--space') }
    })
    this._listen(window, 'blur', () => { this._spaceDown = false; wrap.classList.remove('cv-wrap--space') })
    this._listen(window, 'pagehide', () => this._flushAllSaves())
    const lift = (/** @type {PointerEvent} */ e) => { if (e.pointerType === 'touch') this._touches.delete(e.pointerId) }
    this._listen(window, 'pointerup', lift, true)
    this._listen(window, 'pointercancel', lift, true)
    this._listen(document, 'copy', (/** @type {ClipboardEvent} */ e) => this._onCopy(e, false))
    this._listen(document, 'cut', (/** @type {ClipboardEvent} */ e) => this._onCopy(e, true))
    this._listen(document, 'paste', (/** @type {ClipboardEvent} */ e) => this._onPaste(e))

    // Palette, zoom cluster and selection bar
    wrap.querySelectorAll('.cv-zoom [data-zoom]').forEach(b => b.addEventListener('click', () => {
      const z = /** @type {HTMLElement} */ (b).dataset.zoom
      if (z === 'in') this._zoomBy(1.25)
      else if (z === 'out') this._zoomBy(1 / 1.25)
      else if (z === 'reset') this._zoomBy(1 / this.viewport.zoom)
      else if (z === 'fit') this._fit()
      else if (z === 'full') this._toggleFullscreen()
      else if (z === 'help') this._toggleHelp()
    }))
    wrap.querySelectorAll('.cv-palette [data-tool]').forEach(b => {
      b.addEventListener('pointerdown', e => this._startPaletteDrag(/** @type {PointerEvent} */ (e), /** @type {HTMLElement} */ (b).dataset.tool || 'note'))
    })
    wrap.querySelectorAll('.cv-palette [data-mode]').forEach(b => b.addEventListener('click', () => {
      const m = /** @type {HTMLElement} */ (b).dataset.mode || 'select'
      this._setTool(this.tool === m ? 'select' : m)
    }))
    this._selbar?.addEventListener('pointerdown', e => e.stopPropagation())
    this._selbar?.addEventListener('click', e => this._onSelbarClick(e))
  }

  /** @param {string} tool */
  _setTool(tool) {
    this.tool = tool
    const wrap = this._wrap
    if (!wrap) return
    wrap.classList.toggle('cv-wrap--connect', tool === 'connect')
    wrap.classList.toggle('cv-wrap--hand', tool === 'hand')
    wrap.querySelectorAll('.cv-palette [data-mode]').forEach(b => b.classList.toggle('cv-pal-btn--on', /** @type {HTMLElement} */ (b).dataset.mode === tool))
    this._hint(tool === 'connect' ? 'Drag from one card to another to connect them · Esc to finish'
      : tool === 'hand' ? 'Drag to pan · Esc to finish' : '')
  }

  /** @param {string} text */
  _hint(text) {
    if (!this._hintEl) return
    this._hintEl.textContent = text
    this._hintEl.classList.toggle('cv-hint--on', !!text)
  }

  /** Show the gesture shield with a cursor, or hide it. @param {string | null} cursor */
  _shield(cursor) {
    const el = this._shieldEl
    if (!el) return
    if (cursor) { el.style.cursor = cursor; el.classList.add('cv-shield--on') }
    else el.classList.remove('cv-shield--on')
  }

  // Run a pointer gesture: window-level move/up listeners that are always
  // cleaned up, including when the gesture is cancelled with Esc or the
  // surface is torn down mid-drag.
  /**
   * @param {string} name
   * @param {(e: PointerEvent) => void} onMove
   * @param {(e: PointerEvent | null) => void} onUp
   * @param {{ autoPan?: { x: number, y: number } }} [opts] autoPan: the gesture's
   *   start point (client px). Once the pointer has left it, holding the pointer
   *   near an edge of the canvas scrolls the view, re-running onMove each frame
   *   so whatever is being dragged keeps up.
   */
  _track(name, onMove, onUp, opts = {}) {
    this._endGesture?.()
    this._gesture = name
    /** @type {PointerEvent | null} */ let last = null
    let armed = false
    let edgeRaf = 0
    const edge = () => {
      edgeRaf = 0
      if (this._gesture !== name || !last || !this._wrap) return
      const o = this._origin()
      const x = last.clientX - o.left, y = last.clientY - o.top
      const M = 40, MAX = 16
      // 0 inside the margin's inner edge → 1 at the canvas edge → 2 well outside
      const push = (/** @type {number} */ d) => (d >= M ? 0 : Math.min(2, (M - d) / M))
      const vx = (push(o.width - x) - push(x)) * MAX
      const vy = (push(o.height - y) - push(y)) * MAX
      if (vx || vy) {
        this._setViewport(panBy(this.viewport, vx, vy))
        onMove(last)
        edgeRaf = requestAnimationFrame(edge)
      }
    }
    const move = (/** @type {PointerEvent} */ e) => {
      last = e
      onMove(e)
      if (opts.autoPan && !armed && Math.abs(e.clientX - opts.autoPan.x) + Math.abs(e.clientY - opts.autoPan.y) > DRAG_THRESHOLD) armed = true
      if (armed && !edgeRaf) edgeRaf = requestAnimationFrame(edge)
    }
    const end = (/** @type {PointerEvent | null} */ e) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      if (edgeRaf) cancelAnimationFrame(edgeRaf)
      this._endGesture = null
      this._gesture = ''
      this._shield(null)
      onUp(e)
    }
    const up = (/** @type {PointerEvent} */ e) => end(e)
    const cancel = () => end(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    this._endGesture = () => end(null)
  }

  /** @param {PointerEvent} e */
  _onPointerDown(e) {
    this._suppressClick = false
    const t = asEl(e.target)
    if (!t || t.closest('.cv-ui')) return

    if (e.pointerType === 'touch') {
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this._touches.size === 2) { this._endGesture?.(); this._startPinch(); return }
      if (this._touches.size > 2) return
    }

    const panRequest = e.button === 1 || (e.button === 0 && (this._spaceDown || this.tool === 'hand'))
    if (panRequest) { e.preventDefault(); this._startPan(e); return }
    if (e.button !== 0) return

    if (t.closest('.bd-chip')) return
    const itemEl = /** @type {HTMLElement | null} */ (t.closest('[data-item]'))
    // A checklist's text fields drag the card like any other surface of it; a
    // click without movement then puts the caret in the field.
    const field = /** @type {HTMLInputElement | null} */ (t.closest('input.cv-todo-title, input.cv-todo-text'))
    if (itemEl && field && this.canEdit && this.tool === 'select' && document.activeElement !== field) {
      this._startMove(e, itemEl.dataset.item || '', field)
      return
    }
    // Other native controls inside a card keep working (and never start a drag).
    if (itemEl && t.closest('input, select, button, a, .cv-note-text--editing, .cv-inline-edit')) return

    const arrowEl = /** @type {HTMLElement | null} */ (t.closest('[data-arrow]'))
    if (arrowEl && !itemEl) {
      e.preventDefault()
      this._blurEditing()
      this._selectArrow(arrowEl.dataset.arrow || null)
      return
    }

    if (itemEl) {
      const id = itemEl.dataset.item || ''
      if (!this.canEdit) { e.preventDefault(); this._startPan(e); return }
      if (t.closest('[data-port]') || this.tool === 'connect') { e.preventDefault(); this._startConnect(e, id); return }
      if (t.closest('[data-resize]')) { e.preventDefault(); this._startResize(e, id); return }
      this._startMove(e, id)
      return
    }

    // Empty canvas
    e.preventDefault()
    this._blurEditing()
    if (!this.canEdit || e.pointerType === 'touch') this._startPan(e)
    else this._startMarquee(e)
  }

  _blurEditing() {
    const ae = /** @type {HTMLElement | null} */ (document.activeElement)
    if (ae && this._wrap?.contains(ae) && isTypingTarget(ae)) ae.blur()
  }

  // ── Gestures ─────────────────────────────────────────────────────────────────

  /** @param {PointerEvent} e */
  _startPan(e) {
    this._zoomTarget = null
    cancelAnimationFrame(this._vpAnim || 0)
    const start = { x: e.clientX, y: e.clientY }
    const orig = { ...this.viewport }
    let moved = false
    this._wrap?.classList.add('cv-wrap--panning')
    this._track('pan', ev => {
      if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > DRAG_THRESHOLD) { moved = true; this._shield('grabbing') }
      this._setViewport({ zoom: orig.zoom, panX: orig.panX + ev.clientX - start.x, panY: orig.panY + ev.clientY - start.y })
    }, () => {
      this._wrap?.classList.remove('cv-wrap--panning')
      if (!moved && !this.canEdit) this._setSelection([])
    })
  }

  _startPinch() {
    const pts = () => [...this._touches.values()]
    const [a0, b0] = pts()
    const r = this._origin()
    const mid0 = { x: (a0.x + b0.x) / 2 - r.left, y: (a0.y + b0.y) / 2 - r.top }
    const d0 = Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y))
    const vp0 = { ...this.viewport }
    const anchor = screenToCanvas(mid0, vp0)
    this._track('pinch', ev => {
      if (!this._touches.has(ev.pointerId)) return
      this._touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      const [a, b] = pts()
      if (!a || !b) return
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }
      const zoom = clampZoom(vp0.zoom * Math.hypot(a.x - b.x, a.y - b.y) / d0)
      this._setViewport({ zoom, panX: mid.x - anchor.x * zoom, panY: mid.y - anchor.y * zoom })
    }, () => { this._touches.clear() })
  }

  /** @param {PointerEvent} e */
  _startMarquee(e) {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const base = additive ? new Set(this.sel) : new Set()
    if (!additive) { this._setSelection([]); this._selectArrow(null) }
    const startClient = { x: e.clientX, y: e.clientY }
    // Anchored in canvas space so the band stretches correctly while the view
    // auto-pans under it.
    const startC = this._clientToCanvas(e.clientX, e.clientY)
    let moved = false
    const box = /** @type {HTMLElement} */ (this._marquee)
    this._track('marquee', ev => {
      if (!moved && Math.abs(ev.clientX - startClient.x) + Math.abs(ev.clientY - startClient.y) <= DRAG_THRESHOLD) return
      if (!moved) this._shield('crosshair')
      moved = true
      const curC = this._clientToCanvas(ev.clientX, ev.clientY)
      const sr = rectFromPoints(canvasToScreen(startC, this.viewport), canvasToScreen(curC, this.viewport))
      box.hidden = false
      box.style.transform = `translate(${sr.x}px, ${sr.y}px)`
      box.style.width = `${sr.w}px`
      box.style.height = `${sr.h}px`
      const hits = marqueeHits(rectFromPoints(startC, curC), this.items)
      this._setSelection([...new Set([...base, ...hits])])
    }, () => {
      box.hidden = true
      if (!moved) this._wrap?.focus({ preventScroll: true })
    }, { autoPan: startClient })
  }

  /** @param {PointerEvent} e @param {string} id @param {HTMLInputElement | null} [focusOnClick] */
  _startMove(e, id, focusOnClick = null) {
    const item = this.byId.get(id)
    if (!item) return
    e.preventDefault()
    this._wrap?.focus({ preventScroll: true })
    if (this._editingId && this._editingId !== id) this._blurEditing()
    this._selectArrow(null)

    const wasSelected = this.sel.has(id)
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = new Set(this.sel)
      if (next.has(id)) next.delete(id); else next.add(id)
      this._setSelection([...next])
      if (!next.has(id)) return
    } else if (!wasSelected) {
      this._setSelection([id])
    }

    const movers = this._selectedItems()
    const moverIds = new Set(movers.map(m => m.id))
    /** @type {Map<string, Geo>} */ const before = new Map(movers.map(m => [m.id, this._geo(m)]))
    const box0 = boundsOf(movers)
    const start = { x: e.clientX, y: e.clientY }
    // Deltas are measured in canvas space from where the drag began, so the
    // cards stay under the cursor even if the view pans or zooms mid-drag.
    const startC = this._clientToCanvas(e.clientX, e.clientY)
    let moved = false
    /** @type {Item[]} */ let others = []
    /** @type {Item | null} */ let dropTarget = null

    this._track('move', ev => {
      if (!moved) {
        if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) <= DRAG_THRESHOLD) return
        moved = true
        // Raise the dragged cards above everything, keeping their own order.
        let z = this._maxZ()
        for (const m of [...movers].sort((a, b) => (a.z || 0) - (b.z || 0))) { m.z = ++z; this._markItem(m.id) }
        const vis = this._visibleRect()
        others = movers.length > 80 ? [] : this.items.filter(i => !moverIds.has(i.id) && rectsIntersect(i, vis))
        this._wrap?.classList.add('cv-wrap--dragging')
        this._shield('grabbing')
      }
      const z = this.viewport.zoom
      const pc = this._clientToCanvas(ev.clientX, ev.clientY)
      let dx = pc.x - startC.x, dy = pc.y - startC.y
      if (!ev.altKey && others.length) {
        const s = computeSnap({ x: box0.x + dx, y: box0.y + dy, w: box0.w, h: box0.h }, others, SNAP_PX / z)
        dx += s.dx; dy += s.dy
        this._guides = s.guides
      } else this._guides = []
      this._guidesDirty = true
      for (const m of movers) {
        const o = /** @type {Geo} */ (before.get(m.id))
        m.x = o.x + dx; m.y = o.y + dy
        this._markItem(m.id)
      }
      // Dropping onto a board moves the selection inside it.
      const p = this._clientToCanvas(ev.clientX, ev.clientY)
      /** @type {Item | null} */ let target = null
      for (const it of this.items) {
        if (it.kind !== 'board' || moverIds.has(it.id) || !rectContains(it, p)) continue
        if (!target || (it.z || 0) > (target.z || 0)) target = it
      }
      if (target !== dropTarget) {
        if (dropTarget) this._els.get(dropTarget.id)?.classList.remove('cv-item--drop-target')
        dropTarget = target
        if (dropTarget) this._els.get(dropTarget.id)?.classList.add('cv-item--drop-target')
        this._wrap?.classList.toggle('cv-wrap--dropping', !!dropTarget)
        this._hint(dropTarget ? `Release to move ${movers.length === 1 ? 'this card' : `${movers.length} cards`} into “${this._boardName(dropTarget)}”` : '')
      }
    }, ev => {
      this._wrap?.classList.remove('cv-wrap--dragging', 'cv-wrap--dropping')
      this._guides = []; this._guidesDirty = true
      this._requestFrame()
      this._hint('')
      if (!moved) {
        if (focusOnClick && ev && !(ev.shiftKey || ev.metaKey || ev.ctrlKey)) {
          if (this.sel.size > 1) this._setSelection([id])
          focusOnClick.focus()
          const end = focusOnClick.value.length
          focusOnClick.setSelectionRange(end, end)
          return
        }
        // Plain click: collapse a multi-selection to this card; a second
        // click on an already-selected note starts editing it.
        if (ev && !(ev.shiftKey || ev.metaKey || ev.ctrlKey)) {
          if (this.sel.size > 1) this._setSelection([id])
          else if (wasSelected && item.kind === 'note') this._startEditing(id)
        }
        return
      }
      this._suppressClick = true
      if (dropTarget) this._els.get(dropTarget.id)?.classList.remove('cv-item--drop-target')
      if (!ev) { this._restoreGeometry(before); return }   // Esc / cancelled: snap back
      if (dropTarget) { this._moveIntoBoard(dropTarget, movers, before); return }
      this._commitGeometry('Move', before, movers)
    }, { autoPan: start })
  }

  /** @param {PointerEvent} e @param {string} id */
  _startResize(e, id) {
    const item = this.byId.get(id)
    if (!item) return
    if (!this.sel.has(id) || this.sel.size > 1) this._setSelection([id])
    const before = new Map([[id, this._geo(item)]])
    const o = this._geo(item)
    const [minW, minH] = MIN_SIZE[item.kind] ?? [80, 50]
    const aspect = o.w / Math.max(1, o.h)
    const keepAspect = item.kind === 'image' && !!item.image_url
    const start = { x: e.clientX, y: e.clientY }
    const startC = this._clientToCanvas(e.clientX, e.clientY)
    let moved = false
    this._wrap?.classList.add('cv-wrap--resizing')
    this._shield('nwse-resize')
    this._track('resize', ev => {
      moved = true
      const pc = this._clientToCanvas(ev.clientX, ev.clientY)
      let w = Math.max(minW, o.w + pc.x - startC.x)
      let h = Math.max(minH, o.h + pc.y - startC.y)
      if (keepAspect !== ev.shiftKey) {
        h = w / aspect
        if (h < minH) { h = minH; w = h * aspect }
      }
      item.w = Math.round(w); item.h = Math.round(h)
      this._markItem(id)
    }, ev => {
      this._wrap?.classList.remove('cv-wrap--resizing')
      if (!moved) return
      if (!ev) { this._restoreGeometry(before); return }
      this._commitGeometry('Resize', before, [item])
    }, { autoPan: start })
  }

  /** @param {PointerEvent} e @param {string} fromId */
  _startConnect(e, fromId) {
    const from = this.byId.get(fromId)
    if (!from) return
    this._setSelection([])
    /** @type {Item | null} */ let target = null
    this._wrap?.classList.add('cv-wrap--linking')
    this._els.get(fromId)?.classList.add('cv-item--link-source')
    const update = (/** @type {PointerEvent} */ ev) => {
      const p = this._clientToCanvas(ev.clientX, ev.clientY)
      const t = magnetTarget(p, this.items, MAGNET_PX / this.viewport.zoom, fromId)
      if (t !== target) {
        if (target) this._els.get(target.id)?.classList.remove('cv-item--link-target')
        target = t
        if (target) this._els.get(target.id)?.classList.add('cv-item--link-target')
      }
      this._draft = target ? connectorBetween(from, target) : connectorToPoint(from, p)
      this._draftDirty = true
      this._requestFrame()
      this._shield('crosshair')
    }
    update(e)
    this._hint('Release on a card to connect — or on empty canvas for a new note · Esc to cancel')
    this._track('connect', update, async ev => {
      this._wrap?.classList.remove('cv-wrap--linking')
      this._els.get(fromId)?.classList.remove('cv-item--link-source')
      if (target) this._els.get(target.id)?.classList.remove('cv-item--link-target')
      this._draft = null; this._draftDirty = true
      this._requestFrame()
      this._hint(this.tool === 'connect' ? 'Drag from one card to another to connect them · Esc to finish' : '')
      if (!ev) return
      if (!target) {
        // Dropped on empty canvas far enough from the card: sprout a new
        // note there, already connected — the quickest way to storyboard.
        const p = this._clientToCanvas(ev.clientX, ev.clientY)
        const far = !rectContains({ x: from.x - 40, y: from.y - 40, w: from.w + 80, h: from.h + 80 }, p)
        if (far) await this._sproutNote(fromId, p)
        return
      }
      const toId = target.id
      if (this.arrows.some(a => (a.from_item_id === fromId && a.to_item_id === toId))) return
      /** @type {Arrow} */ const arrow = { id: crypto.randomUUID(), from_item_id: fromId, to_item_id: toId, label: null }
      await this._insertRecords([], [arrow])
      this._pushHistory(this._createEntry('Connect', [], [arrow]))
      this._selectArrow(arrow.id)
    }, { autoPan: { x: e.clientX, y: e.clientY } })
  }

  // A new note at `p`, connected from `fromId`, in edit mode.
  /** @param {string} fromId @param {{ x: number, y: number }} p */
  async _sproutNote(fromId, p) {
    const [w, h] = DEFAULT_SIZE.note
    const from = this.byId.get(fromId)
    /** @type {Item} */
    const note = /** @type {Item} */ ({
      id: crypto.randomUUID(), kind: 'note', content: '', color: from?.kind === 'note' ? from.color : NOTE_COLORS[0],
      x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h, z: this._maxZ() + 1,
      image_url: null, url: null, links: [], sub_tasks: [], child_canvas_id: null,
    })
    /** @type {Arrow} */ const arrow = { id: crypto.randomUUID(), from_item_id: fromId, to_item_id: note.id, label: null }
    if (!await this._insertRecords([note], [arrow])) return
    this._pushHistory(this._createEntry('Add connected note', [note], [arrow]))
    this._startEditing(note.id)
  }

  // Drag a tool out of the palette and drop it where it should go; a plain
  // click drops it in the middle of the view instead.
  /** @param {PointerEvent} e @param {string} kind */
  _startPaletteDrag(e, kind) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY }
    /** @type {HTMLElement | null} */ let ghost = null
    const [w, h] = DEFAULT_SIZE[kind] ?? [220, 140]
    this._track('palette', ev => {
      if (!ghost) {
        if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) <= DRAG_THRESHOLD) return
        ghost = document.createElement('div')
        ghost.className = `cv-ghost cv-ghost--${kind}`
        ghost.dataset.cvOwner = this.uid
        ghost.textContent = TOOLS.find(t => t.kind === kind)?.label ?? ''
        document.body.appendChild(ghost)
      }
      const z = this.viewport.zoom
      ghost.style.width = `${w * z}px`
      ghost.style.height = `${h * z}px`
      ghost.style.transform = `translate(${ev.clientX - (w * z) / 2}px, ${ev.clientY - (h * z) / 2}px)`
    }, ev => {
      const dragged = !!ghost
      ghost?.remove()
      if (!ev) return
      if (!dragged) { this._addFromTool(kind, null); return }
      const r = /** @type {HTMLElement} */ (this._wrap).getBoundingClientRect()
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      if (inside) this._addFromTool(kind, this._clientToCanvas(ev.clientX, ev.clientY))
    })
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  /** Diff-apply a new selection: only cards whose state changes are touched. @param {string[]} ids */
  _setSelection(ids) {
    const next = new Set(ids)
    let changed = next.size !== this.sel.size
    for (const id of this.sel) if (!next.has(id)) { this._els.get(id)?.classList.remove('cv-item--selected'); changed = true }
    for (const id of next) if (!this.sel.has(id)) { this._els.get(id)?.classList.add('cv-item--selected'); changed = true }
    this.sel = next
    if (next.size && this.selArrow) this._selectArrow(null)
    if (changed) { this._selbarContentDirty = true; this._requestFrame() }
  }

  /** @param {string | null} id */
  _selectArrow(id) {
    if (this.selArrow === id) return
    const prev = this.selArrow
    this.selArrow = id
    for (const aid of [prev, id]) {
      if (!aid) continue
      const rec = this._arrowEls.get(aid)
      if (!rec) continue
      const on = aid === id
      rec.g.classList.toggle('cv-link--selected', on)
      rec.label.classList.toggle('cv-link-label--selected', on)
      rec.line.setAttribute('marker-end', `url(#${this.uid}-head${on ? '-sel' : ''})`)
    }
    if (id && this.sel.size) this._setSelection([])
    this._selbarContentDirty = true
    this._requestFrame()
  }

  _renderSelbar() {
    const bar = this._selbar
    if (!bar) return
    if (!this.canEdit) { bar.hidden = true; return }
    if (this.selArrow) {
      bar.innerHTML = `
        <button data-act="arrow-label" title="Label">Aa Label</button>
        <button data-act="arrow-reverse" title="Reverse direction">⇄</button>
        <span class="cv-sb-sep"></span>
        <button data-act="delete" class="cv-sb-danger" title="Delete (⌫)">Delete</button>`
      bar.hidden = false
      return
    }
    const items = this._selectedItems()
    if (!items.length || this._editingId) { bar.hidden = true; return }
    const one = items.length === 1 ? items[0] : null
    const kinds = new Set(items.map(i => i.kind))
    const onlyKind = kinds.size === 1 ? items[0].kind : null
    /** @type {string[]} */ const parts = []
    if (onlyKind === 'note') parts.push(NOTE_COLORS.map(c => `<button class="cv-sb-dot" data-act="color" data-color="${c}" style="background:${c}" title="${c}"></button>`).join(''))
    if (onlyKind === 'board') {
      if (one) parts.push('<button data-act="open-board">Open</button><button data-act="rename-board">Rename</button>')
      parts.push(BOARD_COLORS.map(c => `<button class="cv-sb-dot" data-act="color" data-color="${c}" style="background:${c}" title="${c}"></button>`).join(''))
    }
    if (one?.kind === 'swatch') parts.push('<button data-act="edit-swatch">Edit colour</button><button data-act="copy-hex">Copy hex</button>')
    if (one?.kind === 'note') parts.push('<button data-act="edit-note">Edit</button>')
    if (one?.kind === 'image') parts.push(`<button data-act="upload">${one.image_url ? 'Replace' : 'Upload'}</button>${one.image_url ? '<button data-act="open-image">View</button>' : ''}`)
    if (one?.kind === 'link' && one.url) parts.push('<button data-act="open-link">Open link</button>')
    if (one) parts.push('<button data-act="links" title="Link to a client, project or budget">Links</button>')
    parts.push(`<span class="cv-sb-sep"></span>
      <button data-act="front" title="Bring to front (])">⤒</button>
      <button data-act="back" title="Send to back ([)">⤓</button>
      <button data-act="duplicate" title="Duplicate (⌘D)">⧉</button>
      <button data-act="delete" class="cv-sb-danger" title="Delete (⌫)">Delete</button>`)
    if (items.length > 1) parts.unshift(`<span class="cv-sb-count">${items.length} selected</span>`)
    bar.innerHTML = parts.join('<span class="cv-sb-sep"></span>')
    bar.hidden = false
  }

  _positionSelbar() {
    const bar = this._selbar, wrap = this._wrap
    if (!bar || !wrap || bar.hidden) return
    const r = this._origin()
    /** @type {{ x: number, y: number, w: number, h: number } | null} */ let box = null
    if (this.selArrow) {
      const a = this.arrows.find(x => x.id === this.selArrow)
      const from = a && this.byId.get(a.from_item_id), to = a && this.byId.get(a.to_item_id)
      if (from && to) { const m = bezierPoint(connectorBetween(from, to), 0.5); box = { x: m.x, y: m.y, w: 0, h: 0 } }
    } else {
      const items = this._selectedItems()
      if (items.length) box = boundsOf(items)
    }
    if (!box) { bar.hidden = true; return }
    const tl = canvasToScreen({ x: box.x, y: box.y }, this.viewport)
    const br = canvasToScreen({ x: box.x + box.w, y: box.y + box.h }, this.viewport)
    const bw = bar.offsetWidth, bh = bar.offsetHeight
    let left = (tl.x + br.x) / 2 - bw / 2
    let top = tl.y - bh - 12
    if (top < 8) top = Math.min(r.height - bh - 8, br.y + 12)
    left = Math.max(8, Math.min(r.width - bw - 8, left))
    top = Math.max(8, top)
    bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  /** @param {MouseEvent} e */
  async _onSelbarClick(e) {
    const btn = /** @type {HTMLElement | null} */ (asEl(e.target)?.closest('[data-act]'))
    if (!btn) return
    const act = btn.dataset.act
    const items = this._selectedItems()
    const one = items.length === 1 ? items[0] : null
    if (act === 'color') return this._setColor(items, btn.dataset.color || '')
    if (act === 'delete') return this._deleteSelection()
    if (act === 'duplicate') return this._duplicateSelection()
    if (act === 'front') return this._reorder('front')
    if (act === 'back') return this._reorder('back')
    if (act === 'arrow-label') return this._editArrowLabel(this.selArrow)
    if (act === 'arrow-reverse') return this._reverseArrow(this.selArrow)
    if (!one) return
    if (act === 'open-board') return this._openBoard(one)
    if (act === 'rename-board') return this._renameBoard(one)
    if (act === 'edit-swatch') return this._openSwatchEditor(one)
    if (act === 'edit-note') return this._startEditing(one.id)
    if (act === 'copy-hex') {
      try { await navigator.clipboard.writeText(safeColor(one.color, '')); this.app.toast('Hex copied') } catch { this.app.toast('Could not copy') }
      return
    }
    if (act === 'upload') return this._pickFilesFor(one.id)
    if (act === 'open-image' || act === 'open-link') {
      const url = safeOpenUrl(act === 'open-image' ? one.image_url : one.url)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      else this.app.toast('That link can’t be opened')
      return
    }
    if (act === 'links') return this._openLinksModal(one)
  }

  // ── Card-level delegated events ──────────────────────────────────────────────

  /** @param {MouseEvent} e */
  _onClick(e) {
    // The click that ends a drag is not a click on whatever was under it.
    if (this._suppressClick) { this._suppressClick = false; return }
    const t = asEl(e.target)
    if (!t) return
    const chip = /** @type {HTMLElement | null} */ (t.closest('.bd-chip'))
    if (chip && t.closest('[data-item]')) {
      e.stopPropagation()
      const type = chip.dataset.chipType, cid = chip.dataset.chipId
      if (type === 'project') this.app.openProject(cid)
      else if (type === 'budget') this.app.openBudget(cid)
      else if (type === 'client') { this.app.navigate('contacts'); setTimeout(() => this.app.contactsView.selectContact(cid), 50) }
      return
    }
    const act = /** @type {HTMLElement | null} */ (t.closest('[data-card-act]'))
    const itemEl = /** @type {HTMLElement | null} */ (t.closest('[data-item]'))
    if (!act || !itemEl) return
    const id = itemEl.dataset.item || ''
    const item = this.byId.get(id)
    if (!item) return
    const a = act.dataset.cardAct
    if (a === 'open-board') { this._openBoard(item); return }
    if (!this.canEdit) return
    if (a === 'upload') this._pickFilesFor(id)
    else if (a === 'image-url') this._promptImageUrl(id)
    else if (a === 'todo-add') this._addTodoRow(id, null)
    else if (a === 'todo-del') {
      const row = /** @type {HTMLElement | null} */ (t.closest('.cv-todo-row'))
      const prev = /** @type {HTMLElement | null} */ (row?.previousElementSibling ?? null)
      row?.remove()
      this._saveTodo(id, false)
      const prevInput = /** @type {HTMLInputElement | null} */ (prev?.querySelector('.cv-todo-text') ?? null)
      prevInput?.focus()
    }
  }

  /** @param {MouseEvent} e */
  _onDblClick(e) {
    const t = asEl(e.target)
    if (!t || t.closest('.cv-ui')) return
    const label = /** @type {HTMLElement | null} */ (t.closest('.cv-link-label'))
    const arrowEl = /** @type {HTMLElement | null} */ (t.closest('[data-arrow]'))
    if ((label || arrowEl) && !t.closest('[data-item]')) {
      if (this.canEdit) this._editArrowLabel((label || arrowEl)?.dataset.arrow || null)
      return
    }
    const itemEl = /** @type {HTMLElement | null} */ (t.closest('[data-item]'))
    if (itemEl) {
      const it = this.byId.get(itemEl.dataset.item || '')
      if (!it) return
      if (it.kind === 'board') { this._openBoard(it); return }
      if (!this.canEdit) return
      if (it.kind === 'note') this._startEditing(it.id)
      else if (it.kind === 'swatch') this._openSwatchEditor(it)
      else if (it.kind === 'image' && !it.image_url) this._pickFilesFor(it.id)
      return
    }
    // Double-click on empty canvas drops a note right there.
    if (this.canEdit && !this.sel.size) {
      this._addFromTool('note', this._clientToCanvas(e.clientX, e.clientY))
    }
  }

  /** @param {Event} e */
  _onInput(e) {
    const t = asEl(e.target)
    const itemEl = /** @type {HTMLElement | null} */ (t?.closest('[data-item]') ?? null)
    if (!t || !itemEl || !this.canEdit) return
    const id = itemEl.dataset.item || ''
    const item = this.byId.get(id)
    if (!item) return
    if (t.classList.contains('cv-note-text')) {
      const ta = /** @type {HTMLTextAreaElement} */ (t)
      item.content = ta.value
      this._sigs.set(id, this._sig(item))
      this._autoGrow(item, ta)
      this._debounce(`note-${id}`, 600, () => this._saveNote(id))
    } else if (t.classList.contains('cv-todo-text') || t.classList.contains('cv-todo-title')) {
      this._saveTodo(id, true)
    }
  }

  /** @param {Event} e */
  _onChange(e) {
    const t = asEl(e.target)
    const itemEl = /** @type {HTMLElement | null} */ (t?.closest('[data-item]') ?? null)
    if (!t || !itemEl || !this.canEdit) return
    const id = itemEl.dataset.item || ''
    if (t.classList.contains('cv-todo-done')) {
      t.closest('.cv-todo-row')?.classList.toggle('cv-todo-row--done', /** @type {HTMLInputElement} */ (t).checked)
      this._saveTodo(id, false)
    } else if (t.classList.contains('cv-todo-owner') || t.classList.contains('cv-todo-due')) {
      t.classList.toggle('is-set', !!(/** @type {HTMLInputElement} */ (t).value))
      this._saveTodo(id, false)
    }
  }

  /** @param {KeyboardEvent} e */
  _onCardKeyDown(e) {
    const t = asEl(e.target)
    const itemEl = /** @type {HTMLElement | null} */ (t?.closest('[data-item]') ?? null)
    if (!t || !itemEl) return
    const id = itemEl.dataset.item || ''
    if (e.key === 'Escape' && isTypingTarget(t)) {
      e.preventDefault(); e.stopPropagation()
      t.blur()
      this._setSelection([id])
      return
    }
    if (t.classList.contains('cv-todo-text')) {
      const row = /** @type {HTMLElement | null} */ (t.closest('.cv-todo-row'))
      if (e.key === 'Enter') { e.preventDefault(); this._addTodoRow(id, row) }
      else if (e.key === 'Backspace' && !(/** @type {HTMLInputElement} */ (t).value) && row) {
        const prev = /** @type {HTMLElement | null} */ (row.previousElementSibling)
        if (!prev) return
        e.preventDefault()
        row.remove()
        this._saveTodo(id, false)
        const input = /** @type {HTMLInputElement | null} */ (prev.querySelector('.cv-todo-text'))
        input?.focus()
        input?.setSelectionRange(input.value.length, input.value.length)
      }
    } else if (t.classList.contains('cv-todo-title') && e.key === 'Enter') {
      e.preventDefault()
      const first = /** @type {HTMLInputElement | null} */ (itemEl.querySelector('.cv-todo-text'))
      first?.focus()
    }
  }

  /** @param {FocusEvent} e */
  _onFocusOut(e) {
    const t = asEl(e.target)
    if (!t) return
    const itemEl = /** @type {HTMLElement | null} */ (t.closest('[data-item]'))
    const id = itemEl?.dataset.item || ''
    if (t.classList.contains('cv-note-text')) {
      const ta = /** @type {HTMLTextAreaElement} */ (t)
      ta.readOnly = true
      ta.classList.remove('cv-note-text--editing')
      ta.scrollTop = 0
      if (this._editingId === id) this._editingId = null
      this._flushDebounce(`note-${id}`)
      this._selbarContentDirty = true
      this._requestFrame()
    } else if (t.classList.contains('cv-todo-text') || t.classList.contains('cv-todo-title')) {
      this._flushDebounce(`todo-${id}`)
    }
  }

  // ── Debounced saves ──────────────────────────────────────────────────────────

  /** @param {string} key @param {number} ms @param {() => void} fn */
  _debounce(key, ms, fn) {
    clearTimeout(this._saveTimers[key])
    this._pendingSaves ??= {}
    this._pendingSaves[key] = fn
    this._saveTimers[key] = setTimeout(() => { delete this._pendingSaves?.[key]; fn() }, ms)
  }

  /** @param {string} key */
  _flushDebounce(key) {
    const fn = this._pendingSaves?.[key]
    if (!fn) return
    clearTimeout(this._saveTimers[key])
    delete this._pendingSaves?.[key]
    fn()
  }

  /** @param {string} id */
  _saveNote(id) {
    const it = this.byId.get(id)
    if (!it) return
    this._write(() => updateCanvasItem(id, { content: it.content ?? '', h: it.h }))
  }

  /** @param {Item} item @param {HTMLElement} scroller */
  _autoGrow(item, scroller) {
    const over = scroller.scrollHeight - scroller.clientHeight
    if (over > 1) {
      item.h = Math.round(item.h + over)
      this._markItem(item.id)
    }
  }

  // ── Notes ────────────────────────────────────────────────────────────────────

  /** @param {string} id */
  _startEditing(id) {
    const el = this._els.get(id)
    const ta = /** @type {HTMLTextAreaElement | null} */ (el?.querySelector('.cv-note-text') ?? null)
    if (!ta || !this.canEdit) return
    this._editingId = id
    this._setSelection([id])
    ta.readOnly = false
    ta.classList.add('cv-note-text--editing')
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(ta.value.length, ta.value.length)
    this._selbarContentDirty = true
    this._requestFrame()
  }

  // ── Checklists ───────────────────────────────────────────────────────────────

  /** @param {HTMLElement} el */
  _collectTodo(el) {
    return [...el.querySelectorAll('.cv-todo-row')].map(row => {
      const r = /** @type {HTMLElement} */ (row)
      return {
        id: r.dataset.stId || crypto.randomUUID(),
        text: /** @type {HTMLInputElement | null} */ (r.querySelector('.cv-todo-text'))?.value.trim() || '',
        owner_id: /** @type {HTMLSelectElement | null} */ (r.querySelector('.cv-todo-owner'))?.value || '',
        due_date: /** @type {HTMLInputElement | null} */ (r.querySelector('.cv-todo-due'))?.value || '',
        done: /** @type {HTMLInputElement | null} */ (r.querySelector('.cv-todo-done'))?.checked || false,
      }
    })
  }

  // Text edits debounce; structural changes (tick, owner, due, add/remove)
  // save immediately. The card's signature is updated in place so the
  // reconciler doesn't repaint it under the user's caret.
  /** @param {string} id @param {boolean} debounce */
  _saveTodo(id, debounce) {
    const item = this.byId.get(id), el = this._els.get(id)
    if (!item || !el) return
    item.sub_tasks = this._collectTodo(el)
    item.content = /** @type {HTMLInputElement | null} */ (el.querySelector('.cv-todo-title'))?.value ?? item.content
    this._sigs.set(id, this._sig(item))
    const rows = item.sub_tasks
    const done = rows.filter(r => r.done).length
    const count = el.querySelector('.cv-todo-count')
    if (count) count.textContent = rows.length ? `${done}/${rows.length}` : ''
    const bar = /** @type {HTMLElement | null} */ (el.querySelector('.cv-todo-bar span'))
    if (bar) bar.style.width = `${rows.length ? Math.round(done / rows.length * 100) : 0}%`
    const write = () => this._write(() => updateCanvasItem(id, { sub_tasks: item.sub_tasks, content: item.content ?? '', h: item.h }))
    if (debounce) this._debounce(`todo-${id}`, 600, write)
    else { clearTimeout(this._saveTimers[`todo-${id}`]); delete this._pendingSaves?.[`todo-${id}`]; write() }
  }

  /** @param {string} id @param {HTMLElement | null} after */
  _addTodoRow(id, after) {
    const el = this._els.get(id), item = this.byId.get(id)
    const rows = el?.querySelector('.cv-todo-rows')
    if (!el || !rows || !item) return
    const tmp = document.createElement('div')
    tmp.innerHTML = this._todoRowHtml(blankTodoRow())
    const row = /** @type {HTMLElement} */ (tmp.firstElementChild)
    if (after) after.after(row); else rows.appendChild(row)
    if (!el.querySelector('.cv-todo-bar')) this._repaintKeepingFocus(id)
    const scroller = /** @type {HTMLElement | null} */ (el.querySelector('.cv-todo'))
    if (scroller) this._autoGrow(item, scroller)
    this._saveTodo(id, false)
    const input = /** @type {HTMLInputElement | null} */ (this._els.get(id)?.querySelector(`[data-st-id="${row.dataset.stId}"] .cv-todo-text`) ?? null)
    input?.focus()
  }

  /** @param {string} id */
  _repaintKeepingFocus(id) {
    const el = this._els.get(id), item = this.byId.get(id)
    if (!el || !item) return
    item.sub_tasks = this._collectTodo(el)
    this._repaint(id)
  }

  // ── Creating things ──────────────────────────────────────────────────────────

  // A free spot near `p` so repeated clicks on a tool don't stack cards
  // exactly on top of each other.
  /** @param {{ x: number, y: number }} p @param {number} w @param {number} h */
  _freeSpot(p, w, h) {
    let x = Math.round(p.x - w / 2), y = Math.round(p.y - h / 2)
    for (let i = 0; i < 40 && this.items.some(it => Math.abs(it.x - x) < 12 && Math.abs(it.y - y) < 12); i++) { x += 24; y += 24 }
    return { x, y }
  }

  /** @param {string} kind @param {{ x: number, y: number } | null} at */
  async _addFromTool(kind, at) {
    if (!this.canEdit) return
    const [w, h] = DEFAULT_SIZE[kind] ?? [220, 140]
    const pos = at ? { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) } : this._freeSpot(this._viewCenter(), w, h)
    /** @type {Partial<Item>} */ const base = { kind, x: pos.x, y: pos.y, w, h }
    if (kind === 'note') {
      const it = await this._createOne({ ...base, content: '', color: NOTE_COLORS[0] })
      if (it) this._startEditing(it.id)
    } else if (kind === 'todo') {
      const it = await this._createOne({ ...base, content: '', sub_tasks: [blankTodoRow()] })
      if (it) /** @type {HTMLInputElement | null} */ (this._els.get(it.id)?.querySelector('.cv-todo-title') ?? null)?.focus()
    } else if (kind === 'image') {
      const it = await this._createOne(base)
      if (it) this._pickFilesFor(it.id)
    } else if (kind === 'swatch') {
      const used = new Set(this.items.filter(i => i.kind === 'swatch').map(i => safeColor(i.color, '')))
      const color = SWATCH_PRESETS.find(c => !used.has(c)) ?? SWATCH_PRESETS[2]
      const it = await this._createOne({ ...base, color, content: '' })
      if (it) this._openSwatchEditor(it)
    } else if (kind === 'link') {
      const raw = await this._prompt({ title: 'Add a link', placeholder: 'Paste a web page, YouTube or Vimeo link…', confirm: 'Add link' })
      if (raw) this._addLink(raw, { x: pos.x + w / 2, y: pos.y + h / 2 })
    } else if (kind === 'board') {
      await this._addBoard(pos)
    }
  }

  /** @param {Partial<Item>} data @returns {Promise<Item | null>} */
  async _createOne(data) {
    /** @type {Item} */
    const item = /** @type {Item} */ ({
      id: crypto.randomUUID(), content: null, color: null, image_url: null, url: null,
      links: [], sub_tasks: [], child_canvas_id: null, ...data, z: this._maxZ() + 1,
    })
    const ok = await this._insertRecords([item], [])
    if (!ok) return null
    if (item.kind !== 'board') this._pushHistory(this._createEntry('Add', [item], []))
    this._setSelection([item.id])
    return item
  }

  // Insert items + arrows locally at once (optimistic) and persist them; rolls
  // the local copy back if the database refuses.
  /** @param {Item[]} items @param {Arrow[]} arrows */
  async _insertRecords(items, arrows) {
    for (const it of items) { this.items.push(it); this.byId.set(it.id, it) }
    this.arrows.push(...arrows)
    this._reconcile()
    this._syncArrows()
    const ok = await this._write(async () => {
      await createCanvasItems(this.canvasId, items.map(it => ({
        id: it.id, kind: it.kind, x: it.x, y: it.y, w: it.w, h: it.h, z: Math.round(it.z || 0),
        content: it.content ?? null, color: it.color ?? null, image_url: it.image_url ?? null, url: it.url ?? null,
        links: it.links ?? [], sub_tasks: it.sub_tasks ?? [], child_canvas_id: it.child_canvas_id ?? null,
      })))
      await Promise.all(arrows.map(a => createCanvasArrow(this.canvasId, a.from_item_id, a.to_item_id, { id: a.id, label: a.label ?? null })))
      return true
    }, 'Could not save to the canvas')
    if (!ok) {
      const ids = new Set(items.map(i => i.id)), aids = new Set(arrows.map(a => a.id))
      this._removeLocal(ids, aids)
      return false
    }
    return true
  }

  /** @param {Set<string>} ids @param {Set<string>} [arrowIds] */
  _removeLocal(ids, arrowIds = new Set()) {
    this.items = this.items.filter(i => !ids.has(i.id))
    for (const id of ids) this.byId.delete(id)
    this.arrows = this.arrows.filter(a => !arrowIds.has(a.id) && !ids.has(a.from_item_id) && !ids.has(a.to_item_id))
    this._reconcile()
    this._syncArrows()
  }

  /** @param {string} raw @param {{ x: number, y: number }} center */
  async _addLink(raw, center) {
    const trimmed = raw.trim()
    if (!trimmed) return
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const [w, h] = DEFAULT_SIZE.link
    const it = await this._createOne({ kind: 'link', url, content: '', x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h })
    if (!it) return
    try {
      const preview = await this._fetchPreview(url)
      const live = this.byId.get(it.id)
      if (!live || (!preview?.title && !preview?.image)) return
      live.content = preview.title || ''
      live.image_url = preview.image || null
      if (live.image_url && live.h < 220) { live.h = 240; this._markItem(live.id) }
      this._repaint(live.id)
      await this._write(() => updateCanvasItem(live.id, { content: live.content, image_url: live.image_url, h: live.h }))
    } catch (e) { console.warn('Link preview failed:', e) }
  }

  /** @param {string} url */
  async _fetchPreview(url) {
    const { getAuthToken } = await import('../auth/clerk.js')
    const authToken = await getAuthToken()
    const res = await fetch(`/api/blob?action=preview&url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${authToken}` } })
    if (!res.ok) throw new Error('Preview failed')
    return res.json()
  }

  /** @param {{ x: number, y: number }} pos */
  async _addBoard(pos) {
    const [w, h] = DEFAULT_SIZE.board
    const used = new Set(this.items.filter(i => i.kind === 'board').map(i => safeColor(i.color, '')))
    const color = BOARD_COLORS.find(c => !used.has(c)) ?? BOARD_COLORS[0]
    const child = await this._write(() => createCanvas(this.app.userId, { name: 'Untitled board', parent_id: this.canvasId }), 'Could not create board')
    if (!child) return
    this.getCanvases().push(child)
    this.onCanvasesChanged()
    const it = await this._createOne({ kind: 'board', child_canvas_id: child.id, content: 'Untitled board', color, x: pos.x, y: pos.y, w, h })
    if (it) this._renameBoard(it)
    else await deleteCanvas(this.app.userId, child.id).catch(console.error)
  }

  // ── Boards (nesting) ─────────────────────────────────────────────────────────

  /** @param {Item} it */
  async _openBoard(it) {
    this._flushAllSaves()
    let childId = it.child_canvas_id
    if (!childId) {
      // Its nested canvas was removed elsewhere — give it a fresh one.
      if (!this.canEdit) return
      const child = await this._write(() => createCanvas(this.app.userId, { name: this._boardName(it), parent_id: this.canvasId }))
      if (!child) return
      childId = child.id
      this.getCanvases().push(child)
      it.child_canvas_id = childId
      await this._write(() => updateCanvasItem(it.id, { child_canvas_id: childId }))
    }
    if (childId) this.onOpenBoard(childId)
  }

  /** @param {Item} it */
  _renameBoard(it) {
    const el = this._els.get(it.id)
    const nameEl = /** @type {HTMLElement | null} */ (el?.querySelector('.cv-board-name') ?? null)
    if (!nameEl || !this.canEdit) return
    const input = document.createElement('input')
    input.className = 'cv-inline-edit'
    input.value = this._boardName(it)
    input.maxLength = 120
    nameEl.replaceWith(input)
    input.focus()
    input.select()
    let done = false
    const finish = async (/** @type {boolean} */ save) => {
      if (done) return
      done = true
      const name = input.value.trim()
      const changed = save && name && name !== this._boardName(it)
      if (changed) it.content = name
      this._repaint(it.id)
      if (!changed) return
      const c = this.getCanvases().find(x => x.id === it.child_canvas_id)
      if (c) c.name = name
      this.onCanvasesChanged()
      await this._write(async () => {
        await updateCanvasItem(it.id, { content: name })
        if (it.child_canvas_id) await updateCanvas(this.app.userId, it.child_canvas_id, { name })
      }, 'Could not rename board')
    }
    input.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); finish(true) }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
    })
    input.addEventListener('blur', () => finish(true))
  }

  /** @param {Item} board @param {Item[]} movers @param {Map<string, Geo>} before */
  async _moveIntoBoard(board, movers, before) {
    let childId = board.child_canvas_id
    if (!childId) {
      const child = await this._write(() => createCanvas(this.app.userId, { name: this._boardName(board), parent_id: this.canvasId }))
      if (!child) { this._restoreGeometry(before); return }
      childId = child.id
      this.getCanvases().push(child)
      board.child_canvas_id = childId
      await this._write(() => updateCanvasItem(board.id, { child_canvas_id: childId }))
    }
    const dest = /** @type {string} */ (childId)
    // Keep the group's own layout; land it to the right of whatever the board
    // already holds (or near the origin when it's empty).
    const existing = this._previews.get(dest) ?? []
    const eb = existing.length ? boundsOf(existing) : null
    const origin = boundsOf([...before.values()])
    const baseX = eb ? eb.x + eb.w + 60 : 40
    const baseY = eb ? eb.y : 40
    const moves = movers.map(m => {
      const o = /** @type {Geo} */ (before.get(m.id))
      return { id: m.id, x: Math.round(baseX + o.x - origin.x), y: Math.round(baseY + o.y - origin.y), child_canvas_id: m.child_canvas_id ?? null }
    })
    const ids = new Set(movers.map(m => m.id))
    const dangling = this.arrows.filter(a => ids.has(a.from_item_id) !== ids.has(a.to_item_id))
    const snapshot = movers.map(m => ({ ...m, ...(/** @type {Geo} */ (before.get(m.id))) }))

    // Fly the cards into the board, then drop them from this canvas.
    for (const m of movers) this._els.get(m.id)?.classList.add('cv-item--absorbed')
    const bc = { x: board.x + board.w / 2, y: board.y + board.h / 2 }
    for (const m of movers) { m.x = bc.x - m.w / 2; m.y = bc.y - m.h / 2; this._markItem(m.id) }

    const ok = await this._write(() => moveCanvasItems(this.canvasId, dest, moves).then(() => true), 'Could not move cards into the board')
    if (!ok) {
      for (const m of movers) this._els.get(m.id)?.classList.remove('cv-item--absorbed')
      this._restoreGeometry(before)
      return
    }
    await new Promise(r => setTimeout(r, 160))
    this._removeLocal(ids, new Set(dangling.map(a => a.id)))
    this._previews.set(dest, [...existing, ...moves.map((m, i) => ({ kind: movers[i].kind, x: m.x, y: m.y, w: movers[i].w, h: movers[i].h, color: movers[i].color ?? null }))])
    this._repaint(board.id)
    this._setSelection([board.id])
    this.app.toast(`Moved ${movers.length === 1 ? '1 card' : `${movers.length} cards`} into “${this._boardName(board)}”`)
    this._pushHistory({
      label: 'Move into board',
      undo: async () => {
        await this._write(() => moveCanvasItems(dest, this.canvasId, snapshot.map(s => ({ id: s.id, x: s.x, y: s.y, child_canvas_id: s.child_canvas_id ?? null }))))
        await Promise.all(dangling.map(a => this._write(() => createCanvasArrow(this.canvasId, a.from_item_id, a.to_item_id, { id: a.id, label: a.label ?? null }))))
        await this._reload()
        this._setSelection(snapshot.map(s => s.id))
      },
      redo: async () => {
        await this._write(() => moveCanvasItems(this.canvasId, dest, moves))
        await this._reload()
      },
    })
  }

  async _loadPreviews() {
    const childIds = this.items.filter(i => i.kind === 'board' && i.child_canvas_id).map(i => /** @type {string} */ (i.child_canvas_id))
    if (!childIds.length) { this._previews = new Map(); return }
    try {
      const rows = await getCanvasPreviews(childIds)
      /** @type {Map<string, any[]>} */ const map = new Map(childIds.map(id => [id, []]))
      for (const r of rows) map.get(r.canvas_id)?.push({ kind: r.kind, x: r.x, y: r.y, w: r.w, h: r.h, color: r.color })
      this._previews = map
    } catch (e) { console.warn('Board previews failed:', e) }
  }

  // ── Editing actions on the selection ─────────────────────────────────────────

  /** @param {Item[]} items @param {string} color */
  async _setColor(items, color) {
    const hex = normalizeHex(color)
    if (!hex || !items.length) return
    /** @type {Map<string, Partial<Item>>} */ const before = new Map(items.map(i => [i.id, { color: i.color }]))
    /** @type {Map<string, Partial<Item>>} */ const after = new Map(items.map(i => [i.id, { color: hex }]))
    await this._applyProps(after)
    this._pushHistory(this._propsEntry('Colour', before, after))
  }

  /** @param {Map<string, Partial<Item>>} patches */
  async _applyProps(patches) {
    for (const [id, p] of patches) {
      const it = this.byId.get(id)
      if (!it) continue
      Object.assign(it, p)
      this._repaint(id)
    }
    await this._write(() => Promise.all([...patches].filter(([id]) => this.byId.has(id)).map(([id, p]) => updateCanvasItem(id, p))), 'Could not save change')
  }

  /** @param {'front' | 'back'} dir */
  async _reorder(dir) {
    const items = this._selectedItems().sort((a, b) => (a.z || 0) - (b.z || 0))
    if (!items.length) return
    const before = new Map(items.map(i => [i.id, this._geo(i)]))
    if (dir === 'front') { let z = this._maxZ(); for (const i of items) i.z = ++z }
    else { let z = this._minZ() - items.length; for (const i of items) i.z = z++ }
    for (const i of items) this._markItem(i.id)
    await this._commitGeometry(dir === 'front' ? 'Bring to front' : 'Send to back', before, items)
  }

  async _deleteSelection() {
    if (!this.canEdit) return
    if (this.selArrow) {
      const a = this.arrows.find(x => x.id === this.selArrow)
      if (!a) return
      this._selectArrow(null)
      await this._deleteRecords([], [a])
      this._pushHistory(this._deleteEntry('Delete line', [], [a]))
      return
    }
    const items = this._selectedItems()
    if (!items.length) return
    const boards = items.filter(i => i.kind === 'board')
    if (boards.length) {
      const ok = await this.app.confirm({
        title: boards.length === 1 && items.length === 1 ? `Delete “${this._boardName(boards[0])}”?` : `Delete ${items.length} items?`,
        message: `${boards.length === 1 ? 'This board and everything inside it' : `${boards.length} boards and everything inside them`} will be permanently deleted. This can't be undone.`,
        confirmLabel: 'Delete',
      })
      if (!ok) return
    }
    const ids = new Set(items.map(i => i.id))
    const arrows = this.arrows.filter(a => ids.has(a.from_item_id) || ids.has(a.to_item_id))
    this._setSelection([])
    const ok = await this._deleteRecords(items, arrows)
    if (!ok) return
    if (boards.length) {
      await this._write(() => Promise.all(boards.filter(b => b.child_canvas_id).map(b => deleteCanvas(this.app.userId, /** @type {string} */ (b.child_canvas_id)))))
      const gone = new Set(boards.map(b => b.child_canvas_id))
      const list = this.getCanvases()
      for (let i = list.length - 1; i >= 0; i--) if (gone.has(list[i].id)) list.splice(i, 1)
      this.onCanvasesChanged()
    } else {
      this._pushHistory(this._deleteEntry('Delete', items, arrows))
    }
  }

  /** @param {Item[]} items @param {Arrow[]} arrows */
  async _deleteRecords(items, arrows) {
    const ids = new Set(items.map(i => i.id)), aids = new Set(arrows.map(a => a.id))
    const snapItems = items.map(i => ({ ...i })), snapArrows = arrows.map(a => ({ ...a }))
    this._removeLocal(ids, aids)
    const ok = await this._write(async () => {
      // Connectors attached to a deleted card go with it (ON DELETE CASCADE).
      await Promise.all(arrows.filter(a => !ids.has(a.from_item_id) && !ids.has(a.to_item_id)).map(a => deleteCanvasArrow(a.id)))
      await deleteCanvasItems([...ids])
      return true
    }, 'Could not delete')
    if (!ok) {
      for (const it of snapItems) { this.items.push(it); this.byId.set(it.id, it) }
      this.arrows.push(...snapArrows)
      this._reconcile(); this._syncArrows()
      return false
    }
    return true
  }

  _snapshotSelection() {
    const items = this._selectedItems().map(i => ({ ...i }))
    const ids = new Set(items.map(i => i.id))
    const arrows = this.arrows.filter(a => ids.has(a.from_item_id) && ids.has(a.to_item_id)).map(a => ({ ...a }))
    return { items, arrows }
  }

  async _duplicateSelection() {
    const snap = this._snapshotSelection()
    if (snap.items.length) await this._insertSnapshot(snap, { dx: 24, dy: 24 })
  }

  // Paste / duplicate: fresh ids, relative layout preserved, boards deep-copied.
  /** @param {{ items: Item[], arrows: Arrow[] }} snap @param {{ dx: number, dy: number } | { at: { x: number, y: number } }} place */
  async _insertSnapshot(snap, place) {
    if (!this.canEdit || !snap.items.length) return
    const b = boundsOf(snap.items)
    const dx = 'at' in place ? Math.round(place.at.x - (b.x + b.w / 2)) : place.dx
    const dy = 'at' in place ? Math.round(place.at.y - (b.y + b.h / 2)) : place.dy
    /** @type {Map<string, string>} */ const idMap = new Map()
    let z = this._maxZ()
    /** @type {Item[]} */ const items = []
    for (const src of [...snap.items].sort((a, c) => (a.z || 0) - (c.z || 0))) {
      const id = crypto.randomUUID()
      idMap.set(src.id, id)
      let child = null
      if (src.kind === 'board' && src.child_canvas_id) {
        const copy = await this._write(() => duplicateCanvasTree(this.app.userId, /** @type {string} */ (src.child_canvas_id), this.canvasId))
        if (copy) { child = copy.id; this.getCanvases().push(copy) }
      }
      items.push({ ...src, id, canvas_id: this.canvasId, x: src.x + dx, y: src.y + dy, z: ++z, child_canvas_id: child, created_at: undefined })
    }
    const arrows = snap.arrows
      .filter(a => idMap.has(a.from_item_id) && idMap.has(a.to_item_id))
      .map(a => ({ id: crypto.randomUUID(), from_item_id: /** @type {string} */ (idMap.get(a.from_item_id)), to_item_id: /** @type {string} */ (idMap.get(a.to_item_id)), label: a.label ?? null }))
    const ok = await this._insertRecords(items, arrows)
    if (!ok) return
    if (items.some(i => i.kind === 'board')) { this.onCanvasesChanged(); await this._loadPreviews(); for (const i of items) if (i.kind === 'board') this._repaint(i.id) }
    else this._pushHistory(this._createEntry('Paste', items, arrows))
    this._setSelection(items.map(i => i.id))
  }

  // ── Keyboard nudge ───────────────────────────────────────────────────────────

  /** @param {number} dx @param {number} dy */
  _nudge(dx, dy) {
    const items = this._selectedItems()
    if (!items.length) return
    // One history entry and one write per burst of key presses.
    if (!this._nudgeBefore) this._nudgeBefore = new Map(items.map(i => [i.id, this._geo(i)]))
    for (const it of items) { it.x += dx; it.y += dy; this._markItem(it.id) }
    this._nudging = true
    clearTimeout(this._nudgeTimer)
    this._nudgeTimer = setTimeout(() => this._flushNudge(), 450)
  }

  _flushNudge() {
    clearTimeout(this._nudgeTimer)
    const before = this._nudgeBefore
    this._nudgeBefore = null
    this._nudging = false
    if (!before) return
    const items = [...before.keys()].map(id => this.byId.get(id)).filter(Boolean)
    this._commitGeometry('Nudge', before, /** @type {Item[]} */ (items))
  }

  // ── Geometry persistence + history ───────────────────────────────────────────

  /** @param {string} label @param {Map<string, Geo>} before @param {Item[]} items */
  async _commitGeometry(label, before, items) {
    const after = new Map(items.map(i => [i.id, this._geo(i)]))
    let changed = false
    for (const [id, g] of after) {
      const b = before.get(id)
      if (!b || b.x !== g.x || b.y !== g.y || b.w !== g.w || b.h !== g.h || b.z !== g.z) { changed = true; break }
    }
    if (!changed) return
    this._pushHistory({
      label,
      undo: () => this._applyGeometry(before),
      redo: () => this._applyGeometry(after),
    })
    await this._write(() => updateCanvasItemGeometry(items.map(i => ({ id: i.id, ...this._geo(i) }))), 'Could not save move')
  }

  /** @param {Map<string, Geo>} geo */
  async _applyGeometry(geo) {
    /** @type {Item[]} */ const touched = []
    for (const [id, g] of geo) {
      const it = this.byId.get(id)
      if (!it) continue
      Object.assign(it, g)
      this._markItem(id)
      touched.push(it)
    }
    if (touched.length) await this._write(() => updateCanvasItemGeometry(touched.map(i => ({ id: i.id, ...this._geo(i) }))))
  }

  /** @param {Map<string, Geo>} geo */
  _restoreGeometry(geo) {
    for (const [id, g] of geo) { const it = this.byId.get(id); if (it) { Object.assign(it, g); this._markItem(id) } }
  }

  /** @param {HistoryEntry} entry */
  _pushHistory(entry) {
    this._undo.push(entry)
    if (this._undo.length > HISTORY_LIMIT) this._undo.shift()
    this._redo = []
  }

  /** @param {'undo' | 'redo'} which */
  async _history(which) {
    if (this._historyBusy) return
    const from = which === 'undo' ? this._undo : this._redo
    const to = which === 'undo' ? this._redo : this._undo
    const entry = from.pop()
    if (!entry) { this._hint(which === 'undo' ? 'Nothing to undo' : 'Nothing to redo'); setTimeout(() => this._hint(''), 900); return }
    this._historyBusy = true
    try {
      await entry[which]()
      to.push(entry)
      this._hint(`${which === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`)
      setTimeout(() => this._hint(''), 1100)
    } catch (e) {
      console.error(e)
      this.app.toast(`Could not ${which}`)
    } finally {
      this._historyBusy = false
    }
  }

  // Items/arrows re-created by undo keep their original ids, so later history
  // entries that refer to them still resolve.
  /** @param {string} label @param {Item[]} items @param {Arrow[]} arrows @returns {HistoryEntry} */
  _createEntry(label, items, arrows) {
    let snapI = items.map(i => ({ ...i })), snapA = arrows.map(a => ({ ...a }))
    return {
      label,
      undo: async () => {
        // Re-snapshot what is live now, so a redo brings back later edits
        // (typed text, moves) and not the card as it was first created.
        const live = /** @type {Item[]} */ (snapI.map(s => this.byId.get(s.id)).filter(Boolean))
        const liveA = this.arrows.filter(a => snapA.some(s => s.id === a.id))
        snapI = live.map(i => ({ ...i }))
        snapA = liveA.map(a => ({ ...a }))
        await this._deleteRecords(live, liveA)
      },
      redo: async () => { await this._insertRecords(snapI.map(s => ({ ...s })), snapA.map(s => ({ ...s }))) },
    }
  }

  /** @param {string} label @param {Item[]} items @param {Arrow[]} arrows @returns {HistoryEntry} */
  _deleteEntry(label, items, arrows) {
    const inverse = this._createEntry(label, items, arrows)
    return { label, undo: inverse.redo, redo: inverse.undo }
  }

  /** @param {string} label @param {Map<string, Partial<Item>>} before @param {Map<string, Partial<Item>>} after @returns {HistoryEntry} */
  _propsEntry(label, before, after) {
    return { label, undo: () => this._applyProps(before), redo: () => this._applyProps(after) }
  }

  // ── Connectors: label / reverse ──────────────────────────────────────────────

  /** @param {string | null} id */
  async _editArrowLabel(id) {
    const a = this.arrows.find(x => x.id === id)
    if (!a) return
    const next = await this._prompt({ title: 'Line label', placeholder: 'e.g. “leads to”, “needs approval”', value: a.label || '', confirm: 'Save', allowEmpty: true })
    if (next === null) return
    const before = a.label ?? null
    const after = next.trim() || null
    if (before === after) return
    const apply = async (/** @type {string | null} */ v) => {
      const live = this.arrows.find(x => x.id === a.id)
      if (!live) return
      live.label = v
      this._syncArrows()
      await this._write(() => updateCanvasArrow(a.id, { label: v }))
    }
    await apply(after)
    this._pushHistory({ label: 'Label', undo: () => apply(before), redo: () => apply(after) })
  }

  /** @param {string | null} id */
  async _reverseArrow(id) {
    const a = this.arrows.find(x => x.id === id)
    if (!a) return
    const flip = async () => {
      const live = this.arrows.find(x => x.id === a.id)
      if (!live) return
      const f = live.from_item_id
      live.from_item_id = live.to_item_id
      live.to_item_id = f
      this._syncArrows()
      await this._write(() => updateCanvasArrow(live.id, { from_item_id: live.from_item_id, to_item_id: live.to_item_id }))
    }
    await flip()
    this._pushHistory({ label: 'Reverse line', undo: flip, redo: flip })
  }

  // ── Swatches ─────────────────────────────────────────────────────────────────

  /** @param {Item} it */
  _openSwatchEditor(it) {
    if (!this.canEdit) return
    this._closePopover()
    const wrap = /** @type {HTMLElement} */ (this._wrap)
    const pop = document.createElement('div')
    pop.className = 'cv-popover cv-ui'
    pop.dataset.cvOwner = this.uid
    const start = { color: it.color ?? null, content: it.content ?? null }
    const hex0 = safeColor(it.color, '#4F46E5')
    pop.innerHTML = `
      <div class="cv-pop-title">Colour swatch</div>
      <div class="cv-pop-row">
        <input type="color" class="cv-pop-picker" value="${hex0.toLowerCase()}">
        <input class="cv-pop-hex" value="${hex0}" maxlength="7" spellcheck="false" style="${inputStyle};width:96px;font-family:ui-monospace,monospace">
      </div>
      <input class="cv-pop-name" value="${esc(it.content || '')}" placeholder="Name (e.g. Brand indigo)" maxlength="80" style="${inputStyle};width:100%;box-sizing:border-box">
      <div class="cv-pop-presets">${SWATCH_PRESETS.map(c => `<button class="cv-sb-dot" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
      <div class="cv-pop-actions"><button class="btn-primary cv-pop-done" style="font-size:12px">Done</button></div>`
    wrap.appendChild(pop)
    const place = () => {
      const el = this._els.get(it.id)
      if (!el) return
      const wr = this._origin(), er = el.getBoundingClientRect()
      let left = er.right - wr.left + 12, top = er.top - wr.top
      if (left + pop.offsetWidth > wr.width - 8) left = er.left - wr.left - pop.offsetWidth - 12
      left = Math.max(8, left)
      top = Math.max(8, Math.min(wr.height - pop.offsetHeight - 8, top))
      pop.style.transform = `translate(${left}px, ${top}px)`
    }
    place()
    const picker = /** @type {HTMLInputElement} */ (pop.querySelector('.cv-pop-picker'))
    const hexIn = /** @type {HTMLInputElement} */ (pop.querySelector('.cv-pop-hex'))
    const nameIn = /** @type {HTMLInputElement} */ (pop.querySelector('.cv-pop-name'))
    const setHex = (/** @type {string} */ v, /** @type {boolean} */ fromText) => {
      const hex = normalizeHex(v)
      if (!hex) return
      it.color = hex
      if (!fromText) hexIn.value = hex
      picker.value = hex.toLowerCase()
      this._repaint(it.id)
    }
    picker.addEventListener('input', () => setHex(picker.value, false))
    hexIn.addEventListener('input', () => setHex(hexIn.value, true))
    nameIn.addEventListener('input', () => { it.content = nameIn.value; this._repaint(it.id) })
    pop.querySelectorAll('.cv-pop-presets [data-color]').forEach(b => b.addEventListener('click', () => setHex(/** @type {HTMLElement} */ (b).dataset.color || '', false)))
    const close = async () => {
      pop.remove()
      this._popoverClose = null
      const after = { color: it.color ?? null, content: (it.content || '').trim() || null }
      it.content = after.content
      this._repaint(it.id)
      if (after.color === start.color && after.content === start.content) return
      await this._write(() => updateCanvasItem(it.id, after), 'Could not save colour')
      this._pushHistory(this._propsEntry('Swatch', new Map([[it.id, start]]), new Map([[it.id, after]])))
    }
    this._popoverClose = close
    pop.querySelector('.cv-pop-done')?.addEventListener('click', () => close())
    pop.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); close() } })
    pop.addEventListener('pointerdown', e => e.stopPropagation())
    const outside = (/** @type {PointerEvent} */ e) => {
      if (!pop.isConnected) { document.removeEventListener('pointerdown', outside, true); return }
      if (!pop.contains(/** @type {Node} */ (e.target))) { document.removeEventListener('pointerdown', outside, true); close() }
    }
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0)
    nameIn.focus()
  }

  _closePopover() { this._popoverClose?.() }

  // ── Images ───────────────────────────────────────────────────────────────────

  /** @param {string} id */
  _pickFilesFor(id) {
    if (!this._fileInput) return
    this._fileTarget = id
    this._fileInput.multiple = false
    this._fileInput.click()
  }

  async _onFilesChosen() {
    const input = this._fileInput
    if (!input) return
    const files = [...(input.files || [])].filter(f => f.type?.startsWith('image/'))
    input.value = ''
    const target = this._fileTarget
    this._fileTarget = null
    if (!files.length) return
    if (target && this.byId.has(target)) this._uploadInto(target, files[0])
    else this._dropFiles(files, this._viewCenter())
  }

  /** @param {string} id */
  async _promptImageUrl(id) {
    const url = await this._prompt({ title: 'Image from a URL', placeholder: 'https://…', confirm: 'Add image' })
    if (!url) return
    const it = this.byId.get(id)
    if (!it) return
    const dims = await new Promise(resolve => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = url
    })
    await this._setImage(it, url.trim(), /** @type {any} */ (dims))
  }

  /** @param {File[]} files @param {{ x: number, y: number }} at */
  async _dropFiles(files, at) {
    const [w, h] = DEFAULT_SIZE.image
    let i = 0
    for (const file of files.slice(0, 20)) {
      const it = await this._createOne({ kind: 'image', x: Math.round(at.x - w / 2 + i * 28), y: Math.round(at.y - h / 2 + i * 28), w, h })
      i++
      if (it) this._uploadInto(it.id, file)
    }
  }

  /** @param {string} id @param {File} file */
  async _uploadInto(id, file) {
    if (file.size > 20 * 1024 * 1024) { this.app.toast('Image is too large — use a file under 20 MB'); return }
    this._uploading.add(id)
    this._repaint(id)
    try {
      const res = await this._upload(file)
      const it = this.byId.get(id)
      if (it) await this._setImage(it, res.url, res)
    } catch (e) {
      console.error(e)
      this.app.toast('Image upload failed')
    } finally {
      this._uploading.delete(id)
      this._repaint(id)
    }
  }

  // Image cards take the picture's aspect ratio, keeping their current width.
  /** @param {Item} it @param {string} url @param {{ width: number, height: number } | null} dims */
  async _setImage(it, url, dims) {
    const before = new Map([[it.id, { image_url: it.image_url ?? null, w: it.w, h: it.h }]])
    it.image_url = url
    if (dims && dims.width > 0 && dims.height > 0) {
      const w = Math.min(Math.max(it.w, 160), 480)
      it.w = Math.round(w)
      it.h = Math.round(w * dims.height / dims.width)
    }
    this._repaint(it.id)
    this._markItem(it.id)
    const after = new Map([[it.id, { image_url: url, w: it.w, h: it.h }]])
    await this._write(() => updateCanvasItem(it.id, { image_url: url, w: it.w, h: it.h }), 'Could not save image')
    this._pushHistory(this._propsEntry('Image', before, after))
  }

  // Compress (max 2000px, JPEG 85%) → upload to Blob. Returns the stored URL
  // and the compressed dimensions.
  /** @param {File} file @returns {Promise<{ url: string, width: number, height: number }>} */
  async _upload(file) {
    const { base64, width, height } = await new Promise((resolve, reject) => {
      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        const MAX = 2000
        let { width: w, height: h } = img
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX } else { w = Math.round(w * MAX / h); h = MAX }
        }
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) { reject(new Error('Canvas unavailable')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve({ base64: c.toDataURL('image/jpeg', 0.85).split(',')[1], width: w, height: h })
      }
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Unreadable image')) }
      img.src = objectUrl
    })
    const { getAuthToken } = await import('../auth/clerk.js')
    const authToken = await getAuthToken()
    const res = await fetch('/api/blob', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        base64,
        filename: (file.name || 'pasted.png').replace(/\.[^.]+$/, '.jpg'),
        contentType: 'image/jpeg',
        projectId: this.projectId || undefined,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Upload failed')
    }
    const { url } = await res.json()
    return { url, width, height }
  }

  /** @param {DragEvent} e */
  _onDragOver(e) {
    const types = [...(e.dataTransfer?.types || [])]
    if (!types.includes('Files') && !types.includes('text/uri-list') && !types.includes('text/plain')) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    const t = asEl(e.target)
    const itemEl = /** @type {HTMLElement | null} */ (t?.closest('.cv-item--image') ?? null)
    this._setDropHighlight(types.includes('Files') ? itemEl : null)
  }

  /** @param {HTMLElement | null} el */
  _setDropHighlight(el) {
    if (this._dropHi === el) return
    this._dropHi?.classList.remove('cv-item--file-over')
    this._dropHi = el
    el?.classList.add('cv-item--file-over')
  }

  /** @param {DragEvent} e */
  _onDrop(e) {
    e.preventDefault()
    const target = this._dropHi
    this._setDropHighlight(null)
    const dt = e.dataTransfer
    if (!dt) return
    const at = this._clientToCanvas(e.clientX, e.clientY)
    const files = [...(dt.files || [])].filter(f => f.type?.startsWith('image/'))
    if (files.length) {
      const id = target?.dataset.item
      if (id && files.length === 1) this._uploadInto(id, files[0])
      else this._dropFiles(files, at)
      return
    }
    const uri = (dt.getData('text/uri-list') || '').split('\n').find(l => l && !l.startsWith('#'))
    const text = uri || dt.getData('text/plain')
    if (text) this._pasteText(text, at)
  }

  /** @param {string} text @param {{ x: number, y: number }} at */
  async _pasteText(text, at) {
    const trimmed = text.trim()
    if (!trimmed) return
    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      if (/\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(trimmed)) {
        const [w, h] = DEFAULT_SIZE.image
        const it = await this._createOne({ kind: 'image', x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h })
        if (it) {
          const dims = await new Promise(resolve => { const img = new Image(); img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight }); img.onerror = () => resolve(null); img.src = trimmed })
          await this._setImage(it, trimmed, /** @type {any} */ (dims))
        }
        return
      }
      this._addLink(trimmed, at)
      return
    }
    const [w] = DEFAULT_SIZE.note
    const lines = trimmed.split('\n').length
    const h = Math.min(600, Math.max(DEFAULT_SIZE.note[1], 28 + lines * 20))
    await this._createOne({ kind: 'note', content: trimmed.slice(0, 20000), color: NOTE_COLORS[0], x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h })
  }

  // ── Clipboard ────────────────────────────────────────────────────────────────

  _pastePoint() {
    if (this._pointer) return screenToCanvas(this._pointer, this.viewport)
    return this._viewCenter()
  }

  /** @param {ClipboardEvent} e @param {boolean} cut */
  _onCopy(e, cut) {
    if (!this._mounted || !this._engaged || isTypingTarget(document.activeElement)) return
    const snap = this._snapshotSelection()
    if (!snap.items.length) return
    e.preventDefault()
    const text = snap.items.map(i => i.kind === 'link' ? i.url : i.kind === 'swatch' ? safeColor(i.color, '') : i.kind === 'board' ? this._boardName(i) : (i.content || '')).filter(Boolean).join('\n\n')
    e.clipboardData?.setData('text/plain', text)
    e.clipboardData?.setData(CLIP_MIME, JSON.stringify({ v: 1, ...snap }))
    this._clip = snap
    if (cut && this.canEdit) this._deleteSelection()
  }

  /** @param {ClipboardEvent} e */
  _onPaste(e) {
    if (!this._mounted || !this._engaged || !this.canEdit || isTypingTarget(document.activeElement)) return
    const cd = e.clipboardData
    if (!cd) return
    const at = this._pastePoint()
    const raw = cd.getData(CLIP_MIME)
    if (raw) {
      e.preventDefault()
      try {
        const snap = JSON.parse(raw)
        if (Array.isArray(snap.items)) this._insertSnapshot({ items: snap.items, arrows: snap.arrows || [] }, { at })
      } catch (err) { console.error(err) }
      return
    }
    const files = [...(cd.files || [])].filter(f => f.type?.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      const sel = this._selectedItems()
      if (sel.length === 1 && sel[0].kind === 'image' && !sel[0].image_url) this._uploadInto(sel[0].id, files[0])
      else this._dropFiles(files, at)
      return
    }
    const text = cd.getData('text/plain')
    if (text) { e.preventDefault(); this._pasteText(text, at) }
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────────

  /** @param {KeyboardEvent} e */
  _onKeyDown(e) {
    if (!this._mounted) { this.destroy(); return }
    if (!this._engaged) return
    if (document.querySelector('.modal-overlay, #cv-item-modal, .cv-modal')) return
    const typing = isTypingTarget(document.activeElement)
    const mod = e.metaKey || e.ctrlKey
    const k = e.key

    if (k === 'Escape') {
      if (typing) return
      if (this._gesture) { this._endGesture?.(); e.preventDefault(); return }
      if (this.tool !== 'select') { this._setTool('select'); return }
      if (this.sel.size || this.selArrow) { this._setSelection([]); this._selectArrow(null); return }
      if (this._wrap?.classList.contains('cv-wrap--full')) this._toggleFullscreen()
      return
    }
    if (typing) return

    if (k === ' ' && !mod) {
      e.preventDefault()
      if (!this._spaceDown) { this._spaceDown = true; this._wrap?.classList.add('cv-wrap--space') }
      return
    }

    // Zoom works for everyone, including read-only viewers.
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); this._zoomBy(1.25); return }
    if (mod && k === '-') { e.preventDefault(); this._zoomBy(1 / 1.25); return }
    if (mod && k === '0') { e.preventDefault(); this._zoomBy(1 / this.viewport.zoom); return }
    if (e.shiftKey && (k === '!' || e.code === 'Digit1')) { e.preventDefault(); this._fit(); return }
    if (mod && (k === 'a' || k === 'A')) { e.preventDefault(); this._setSelection(this.items.map(i => i.id)); return }

    if (!this.canEdit) return

    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); this._history(e.shiftKey ? 'redo' : 'undo'); return }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); this._history('redo'); return }
    if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); this._duplicateSelection(); return }
    if (k === 'Delete' || k === 'Backspace') {
      if (this.sel.size || this.selArrow) { e.preventDefault(); this._deleteSelection() }
      return
    }
    if (k.startsWith('Arrow') && this.sel.size) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      this._nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0)
      return
    }
    if (k === 'Enter' && this.sel.size === 1) {
      const it = this._selectedItems()[0]
      e.preventDefault()
      if (it.kind === 'note') this._startEditing(it.id)
      else if (it.kind === 'board') this._openBoard(it)
      else if (it.kind === 'swatch') this._openSwatchEditor(it)
      return
    }
    if (mod || e.altKey) return
    if (k === ']') { this._reorder('front'); return }
    if (k === '[') { this._reorder('back'); return }
    const lower = k.toLowerCase()
    const tool = TOOLS.find(t => t.key.toLowerCase() === lower)
    if (tool) { e.preventDefault(); this._addFromTool(tool.kind, this._pointer ? screenToCanvas(this._pointer, this.viewport) : null); return }
    if (lower === 'l') this._setTool(this.tool === 'connect' ? 'select' : 'connect')
    else if (lower === 'h') this._setTool(this.tool === 'hand' ? 'select' : 'hand')
    else if (lower === 'v') this._setTool('select')
  }

  // ── Chrome: fullscreen + help ────────────────────────────────────────────────

  _toggleFullscreen() {
    const wrap = this._wrap
    if (!wrap) return
    const r0 = this._origin()
    wrap.classList.toggle('cv-wrap--full')
    document.body.classList.toggle('cv-body-lock', wrap.classList.contains('cv-wrap--full'))
    // Keep the same canvas point in the middle of the view across the resize.
    const r1 = this._origin()
    this._setViewport({ ...this.viewport, panX: this.viewport.panX + (r1.width - r0.width) / 2, panY: this.viewport.panY + (r1.height - r0.height) / 2 })
    this._selbarDirty = true
  }

  _toggleHelp() {
    const existing = this._wrap?.querySelector('.cv-help')
    if (existing) { existing.remove(); return }
    const help = document.createElement('div')
    help.className = 'cv-help cv-ui'
    const row = (/** @type {string} */ k, /** @type {string} */ v) => `<div class="cv-help-row"><span>${v}</span><kbd>${k}</kbd></div>`
    help.innerHTML = `
      <div class="cv-pop-title">Canvas shortcuts</div>
      ${row('Scroll / two fingers', 'Pan')}
      ${row('Pinch · ⌘/Ctrl + scroll · mouse wheel', 'Zoom')}
      ${row('Space + drag · middle-drag · H', 'Grab to pan')}
      ${row('Drag on empty canvas', 'Select an area')}
      ${row('⇧ + click', 'Add to selection')}
      ${row('Drag a card’s edge dot · L', 'Connect cards')}
      ${row('Drop cards onto a board', 'Move them inside')}
      ${row('N · C · I · K · S · B', 'Note · Checklist · Image · Link · Colour · Board')}
      ${row('Double-click canvas', 'New note')}
      ${row('⌘Z · ⇧⌘Z', 'Undo · Redo')}
      ${row('⌘C · ⌘V · ⌘D', 'Copy · Paste · Duplicate')}
      ${row('[ · ]', 'Send back · Bring forward')}
      ${row('Arrows · ⇧ + Arrows', 'Nudge')}
      ${row('⇧1 · ⌘0', 'Fit · 100%')}
      ${row('Alt while dragging', 'Disable snapping')}`
    help.addEventListener('pointerdown', e => e.stopPropagation())
    help.addEventListener('click', () => help.remove())
    this._wrap?.appendChild(help)
  }

  // ── Modals ───────────────────────────────────────────────────────────────────

  /**
   * Small in-app prompt (replaces window.prompt so it matches the app's look).
   * @param {{ title: string, placeholder?: string, value?: string, confirm?: string, allowEmpty?: boolean }} o
   * @returns {Promise<string | null>}
   */
  _prompt(o) {
    return new Promise(resolve => {
      const overlay = document.createElement('div')
      overlay.className = 'cv-modal'
      overlay.dataset.cvOwner = this.uid
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'
      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:400px;padding:20px;box-shadow:var(--shadow-lg)">
          <div style="font-size:14px;font-weight:600;margin-bottom:12px">${esc(o.title)}</div>
          <input class="cv-modal-input" value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}" style="${inputStyle};width:100%;box-sizing:border-box">
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
            <button class="btn-cancel cv-modal-cancel">Cancel</button>
            <button class="btn-primary cv-modal-ok">${esc(o.confirm || 'OK')}</button>
          </div>
        </div>`
      const input = /** @type {HTMLInputElement} */ (overlay.querySelector('.cv-modal-input'))
      const done = (/** @type {string | null} */ v) => { overlay.remove(); this._wrap?.focus({ preventScroll: true }); resolve(v) }
      const ok = () => { const v = input.value; if (!v.trim() && !o.allowEmpty) { input.focus(); return } done(v) }
      overlay.addEventListener('pointerdown', e => { if (e.target === overlay) done(null) })
      overlay.querySelector('.cv-modal-cancel')?.addEventListener('click', () => done(null))
      overlay.querySelector('.cv-modal-ok')?.addEventListener('click', ok)
      input.addEventListener('keydown', e => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); ok() } else if (e.key === 'Escape') { e.preventDefault(); done(null) }
      })
      document.body.appendChild(overlay)
      setTimeout(() => { input.focus(); input.select() }, 10)
    })
  }

  /** @param {Item} item */
  _openLinksModal(item) {
    document.getElementById('cv-item-modal')?.remove()
    let links = Array.isArray(item.links) ? item.links.map(l => ({ ...l })) : []
    const overlay = document.createElement('div')
    overlay.id = 'cv-item-modal'
    overlay.dataset.cvOwner = this.uid
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'
    const linkOptions = (/** @type {string} */ type) => {
      if (type === 'client') return (this.app.contacts ?? []).map((/** @type {any} */ c) => `<option value="${esc(c.id)}">${esc(`${c.first_name} ${c.last_name}`.trim())}</option>`).join('')
      if (type === 'project') return (this.app.projects ?? []).map((/** @type {any} */ p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
      return (this.app.budgets ?? []).map((/** @type {any} */ b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')
    }
    const kindLabel = /** @type {Record<string, string>} */ ({ image: 'Image', link: 'Link', todo: 'Checklist', swatch: 'Swatch', board: 'Board' })[item.kind] || 'Note'
    const render = () => {
      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:400px;padding:20px" onclick="event.stopPropagation()">
          <div style="font-size:14px;font-weight:600;margin-bottom:12px">${kindLabel} links</div>
          ${links.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
            ${links.map((l, i) => {
              const t = LINK_TYPES.find(x => x.id === l.type)
              return `<span class="bd-chip" style="color:${t?.color};background:${t?.color}1a">${t?.icon} ${esc(this._entityName(l.type, l.id) || 'Missing record')}
                <button class="cvm-link-del" data-idx="${i}" style="background:none;border:none;cursor:pointer;color:inherit;font-size:12px;padding:0 0 0 4px;line-height:1">×</button></span>`
            }).join('')}
          </div>` : '<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">No links yet — link this card to a client, project or budget.</div>'}
          <div style="display:flex;gap:8px;margin-bottom:16px">
            <select id="cvm-link-type" style="${inputStyle};font-size:12px">${LINK_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}</select>
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
        if (sel) sel.innerHTML = linkOptions(/** @type {HTMLSelectElement} */ (e.target).value)
      })
      overlay.querySelector('#cvm-link-add')?.addEventListener('click', () => {
        const type = /** @type {HTMLSelectElement | null} */ (overlay.querySelector('#cvm-link-type'))?.value
        const id = /** @type {HTMLSelectElement | null} */ (overlay.querySelector('#cvm-link-entity'))?.value
        if (!type || !id || links.some(l => l.type === type && l.id === id)) return
        links.push({ type, id })
        render()
      })
      overlay.querySelectorAll('.cvm-link-del').forEach(btn => btn.addEventListener('click', () => {
        links.splice(parseInt(/** @type {HTMLElement} */ (btn).dataset.idx || '0', 10), 1)
        render()
      }))
      overlay.querySelector('#cvm-save')?.addEventListener('click', async () => {
        const before = new Map([[item.id, { links: item.links ?? [] }]])
        const after = new Map([[item.id, { links }]])
        overlay.remove()
        await this._applyProps(after)
        this._pushHistory(this._propsEntry('Links', before, after))
      })
    }
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    render()
  }

  // ── Polling sync ─────────────────────────────────────────────────────────────

  _flushAllSaves() {
    for (const key of Object.keys(this._pendingSaves ?? {})) this._flushDebounce(key)
    this._flushNudge()
  }

  async _reload() {
    const { items, arrows } = await getCanvasData(this.canvasId)
    this._setData(/** @type {Item[]} */ (items), /** @type {Arrow[]} */ (arrows))
    this._snapshot = this._serialize()
    await this._loadPreviews()
    this._reconcile()
    this._syncArrows()
  }

  _busy() {
    if (this._gesture || this._editingId || this._writes > 0 || this._nudging || this._historyBusy || this._uploading.size) return true
    if (this._pendingSaves && Object.keys(this._pendingSaves).length) return true
    if (document.querySelector(`[data-cv-owner="${this.uid}"]`) || document.getElementById('cv-item-modal')) return true
    const ae = document.activeElement
    return !!(ae && this._wrap?.contains(ae) && isTypingTarget(ae))
  }

  _startPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer)
    this._pollTimer = setInterval(async () => {
      if (!this._mounted) { this.destroy(); return }
      if (document.hidden || this._busy()) return
      try {
        const { items, arrows } = await getCanvasData(this.canvasId)
        if (this._busy() || this._destroyed) return
        const prev = this._snapshot
        const prevItems = this.items, prevArrows = this.arrows
        this._setData(/** @type {Item[]} */ (items), /** @type {Arrow[]} */ (arrows))
        const snap = this._serialize()
        if (snap !== prev) {
          this._snapshot = snap
          this._reconcile()
          this._syncArrows()
        } else {
          // Keep object identity stable when nothing changed.
          this._setData(prevItems, prevArrows)
        }
        if (++this._pollCount % 3 === 0 && this.items.some(i => i.kind === 'board')) {
          const before = JSON.stringify([...this._previews])
          await this._loadPreviews()
          if (JSON.stringify([...this._previews]) !== before) this._reconcile()
        }
      } catch (e) { console.warn('Canvas sync failed:', e) }
    }, POLL_MS)
  }
}

