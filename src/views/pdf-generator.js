// src/views/pdf-generator.js
// Tools › PDF Generator (#pdf-generator, #pdf-generator/<id>): the team's shared
// library of one-page documents in the quote PDF's look. Pick one to change it,
// or start a new one; the form on the left drives a live A4 preview and
// "Download PDF" opens the browser's print dialog (Save as PDF), the same way a
// quote does. Saved documents live on the server (api/pdf-documents.js) and
// everyone on staff sees the same library; viewers can open and print them.

import * as api from '../api/pdf-documents.js'
import { BLOCK_LABELS, LIMITS, blankDocument, blocksFromEditor, blocksToEditor, renderOnePager } from '../pdf/onepager.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const A4_PX = 297 * 96 / 25.4
const A4_W_PX = 210 * 96 / 25.4
const fmtDate = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }

export class PdfGeneratorView {
  constructor(app) {
    this.app = app
    this.mc = null
    this.docs = null        // the library list; null until loaded
    this.draft = null       // the open document: { id?, title, theme, content: { label, subtitle, date }, blocks (editor shape) }
    this.dirty = false
    this.saving = false
    this.loadError = null
    this._ro = null
  }

  get readOnly() { return this.app.appUser?.role === 'viewer' }
  _hashId() { return location.hash.slice(1).split('/')[1] || null }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  toolbar() {
    if (this.readOnly) return this.draft ? { actions: '<button type="button" class="btn-primary" id="pg-print">Download PDF</button>' } : {}
    if (!this.draft) return { actions: '<button type="button" class="btn-primary" id="pg-new">New document</button>' }
    return {
      actions: `${this.draft.id ? '<button type="button" class="btn-secondary" id="pg-copy">Save as copy</button><button type="button" class="btn-danger" id="pg-delete">Delete</button>' : ''}
        <button type="button" class="btn-secondary" id="pg-save"${this.saving ? ' disabled' : ''}>${this.saving ? 'Saving…' : this.dirty || !this.draft.id ? 'Save' : 'Saved'}</button>
        <button type="button" class="btn-primary" id="pg-print">Download PDF</button>`,
    }
  }

  bindToolbar(bar) {
    bar?.querySelector('#pg-new')?.addEventListener('click', () => this._open(null))
    bar?.querySelector('#pg-save')?.addEventListener('click', () => this._save())
    bar?.querySelector('#pg-print')?.addEventListener('click', () => this._print())
    bar?.querySelector('#pg-copy')?.addEventListener('click', () => this._saveCopy())
    bar?.querySelector('#pg-delete')?.addEventListener('click', () => this._delete())
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  async render(mc) {
    this.mc = mc
    const id = this._hashId()
    if (this.draft && (this.draft.id ?? null) !== id) this.draft = null
    if (!this.draft && id) {
      mc.innerHTML = '<div class="empty-state">Loading…</div>'
      try {
        const { document } = await api.getPdfDocument(id)
        this.draft = this._toDraft(document)
        this.dirty = false
      } catch (e) {
        this.app.toast(e.status === 404 ? 'That document no longer exists' : 'Could not open that document')
        history.replaceState(null, '', '#pdf-generator')
      }
      this.app.updateTitle()
    }
    if (this.draft) return this._drawEditor()
    this._drawList()
    if (this.docs === null) await this._loadList()
  }

  async _loadList() {
    try {
      this.docs = (await api.listPdfDocuments()).documents
      this.loadError = null
    } catch (e) {
      this.loadError = e.message
    }
    if (!this.draft) this._drawList()
  }

  _toDraft(d) {
    return { id: d.id, title: d.title, theme: d.theme, content: { label: d.content.label ?? '', subtitle: d.content.subtitle ?? '', date: d.content.date ?? '' }, blocks: blocksToEditor(d.content.blocks) }
  }

  _toDoc() {
    const d = this.draft
    return { title: d.title.trim(), theme: d.theme, content: { ...d.content, blocks: blocksFromEditor(d.blocks) } }
  }

  // ── Library ────────────────────────────────────────────────────────────────
  _drawList() {
    const mc = this.mc
    if (!mc) return
    let body
    if (this.docs === null) body = this.loadError ? `<div class="empty-state">${esc(this.loadError)}</div>` : '<div class="empty-state">Loading…</div>'
    else if (!this.docs.length) {
      body = `<div class="empty-state">No documents yet.${this.readOnly ? '' : '<br>Create the first one-pager with <strong>New document</strong>.'}</div>`
    } else {
      body = `<div class="card-grid">${this.docs.map(d => `
        <a class="panel pt-card" href="#pdf-generator/${esc(d.id)}" data-doc="${esc(d.id)}">
          <span class="pt-card-body">
            <span class="pt-card-title">${esc(d.title)}<span class="pg-theme-tag">${d.theme === 'light' ? 'Light' : 'Dark'}</span></span>
            <span class="pg-list-meta">Updated ${esc(fmtDate(d.updated_at))}${d.updated_by_name ? ` by ${esc(d.updated_by_name)}` : ''}</span>
          </span>
        </a>`).join('')}</div>`
    }
    mc.innerHTML = `<p class="tr-muted" style="margin:0 0 16px">One-page documents in the same look as our quotes. Everyone on the team sees the same library.</p>${body}`
    mc.querySelectorAll('[data-doc]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); this._open(a.dataset.doc) }))
  }

  async _open(id) {
    if (id === null) {
      const b = blankDocument()
      this.draft = { title: b.title, theme: b.theme, content: { label: b.content.label, subtitle: b.content.subtitle, date: b.content.date }, blocks: blocksToEditor(b.content.blocks) }
      this.dirty = true
      history.pushState({}, '', '#pdf-generator')
    } else {
      history.pushState({}, '', `#pdf-generator/${id}`)
      this.draft = null
    }
    await this.render(this.mc)
    this.app.updateTitle()
  }

  async _close() {
    if (this.dirty && !this.readOnly && !await this.app.confirm({ title: 'Leave without saving?', message: 'Your changes to this document have not been saved.', confirmLabel: 'Leave', danger: false })) return
    this.draft = null
    this.dirty = false
    history.pushState({}, '', '#pdf-generator')
    this._drawList()
    this.app.updateTitle()
    this._loadList()
  }

  // ── Editor ─────────────────────────────────────────────────────────────────
  _drawEditor() {
    const d = this.draft, mc = this.mc
    if (!mc) return
    const ro = this.readOnly
    const blockCount = d.blocks.length
    const blocksHtml = d.blocks.map((b, i) => {
      const field = b.type === 'heading'
        ? `<input type="text" data-f="text" data-i="${i}" value="${esc(b.text)}" maxlength="${LIMITS.text}" aria-label="Heading text" />`
        : `<textarea data-f="text" data-i="${i}" rows="${b.type === 'text' ? 4 : 5}" maxlength="${LIMITS.text}" aria-label="${BLOCK_LABELS[b.type]}" placeholder="${b.type === 'bullets' ? 'One item per line' : b.type === 'table' ? 'One row per line: Label | Value' : ''}">${esc(b.text)}</textarea>`
      return `<div class="pg-block">
        <div class="pg-block-head">
          <span class="pg-block-type">${BLOCK_LABELS[b.type]}</span>
          <button type="button" class="pg-block-btn" data-act="up" data-i="${i}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="pg-block-btn" data-act="down" data-i="${i}" aria-label="Move down"${i === blockCount - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" class="pg-block-btn" data-act="remove" data-i="${i}" aria-label="Remove block">Remove</button>
        </div>
        ${field}
      </div>`
    }).join('')

    mc.innerHTML = `
      <p style="margin:0 0 14px"><a href="#pdf-generator" id="pg-back" class="tr-muted">← All documents</a></p>
      <div class="pg-layout">
        <div class="panel pg-form"><fieldset${ro ? ' disabled' : ''}>
          <div class="field"><div class="field-label">Title</div><input type="text" data-k="title" value="${esc(d.title)}" maxlength="${LIMITS.title}" placeholder="Document title" /></div>
          <div class="field"><div class="field-label">Label <span class="tr-muted">(small text above the title)</span></div><input type="text" data-k="label" value="${esc(d.content.label)}" maxlength="${LIMITS.label}" placeholder="e.g. Proposal" /></div>
          <div class="field"><div class="field-label">Subtitle</div><input type="text" data-k="subtitle" value="${esc(d.content.subtitle)}" maxlength="${LIMITS.subtitle}" /></div>
          <div class="field"><div class="field-label">Date</div><input type="text" data-k="date" value="${esc(d.content.date)}" maxlength="${LIMITS.date}" /></div>
          <div class="field"><div class="field-label">Look</div>
            <div class="seg" role="group" aria-label="Look">
              <button type="button" class="seg-btn" data-theme="dark" aria-pressed="${d.theme !== 'light'}">Dark</button>
              <button type="button" class="seg-btn" data-theme="light" aria-pressed="${d.theme === 'light'}">Light</button>
            </div>
          </div>
          <div class="field"><div class="field-label">Content</div></div>
          ${blocksHtml}
          <div class="pg-add" role="group" aria-label="Add a block">
            ${Object.entries(BLOCK_LABELS).map(([t, l]) => `<button type="button" class="btn-secondary" data-add="${t}"${blockCount >= LIMITS.blocks ? ' disabled' : ''}>+ ${l}</button>`).join('')}
          </div>
          <p class="pg-hint">The logo and your studio details come from Settings, so every document carries the same branding.</p>
        </fieldset></div>
        <div class="pg-preview-wrap">
          <p class="pg-overflow" id="pg-overflow" hidden>This runs onto a second page. Shorten it to keep a true one-pager.</p>
          <div class="pg-preview-frame" id="pg-frame" aria-label="Preview"></div>
        </div>
      </div>`
    this._bindEditor()
    this._drawPreview()
  }

  _bindEditor() {
    const mc = this.mc, d = this.draft
    mc.querySelector('#pg-back').addEventListener('click', e => { e.preventDefault(); this._close() })
    mc.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', () => {
      const k = el.dataset.k
      if (k === 'title') d.title = el.value; else d.content[k] = el.value
      this._changed()
    }))
    mc.querySelectorAll('[data-f]').forEach(el => el.addEventListener('input', () => { d.blocks[Number(el.dataset.i)].text = el.value; this._changed() }))
    mc.querySelectorAll('[data-theme]').forEach(btn => btn.addEventListener('click', () => {
      d.theme = btn.dataset.theme
      mc.querySelectorAll('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)))
      this._changed()
    }))
    mc.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
      d.blocks.push({ type: btn.dataset.add, text: '' })
      this._changed(); this._drawEditor()
      mc.querySelectorAll('[data-f]')[d.blocks.length - 1]?.focus()
    }))
    mc.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i), act = btn.dataset.act
      if (act === 'remove') d.blocks.splice(i, 1)
      else { const j = act === 'up' ? i - 1 : i + 1; [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]] }
      this._changed(); this._drawEditor()
    }))
    this._ro?.disconnect()
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._fitPreview())
      this._ro.observe(mc.querySelector('#pg-frame'))
    }
  }

  _changed() {
    if (this.readOnly) return
    const was = this.dirty
    this.dirty = true
    this._drawPreview()
    if (!was) this.app.updateTitle()
  }

  _drawPreview() {
    const frame = this.mc?.querySelector('#pg-frame')
    if (!frame) return
    frame.innerHTML = renderOnePager(this._toDoc(), this.app.settings || {})
    this._fitPreview()
  }

  // The page is A4 at 96dpi; scale it down to the width on offer and size the
  // frame to match, and say so if the content spills onto a second page.
  _fitPreview() {
    const frame = this.mc?.querySelector('#pg-frame')
    const page = frame?.querySelector('.pdf-one')
    if (!page) return
    const scale = Math.min(1, frame.clientWidth / A4_W_PX) || 1
    page.style.transform = `scale(${scale})`
    frame.style.height = `${Math.ceil(page.offsetHeight * scale)}px`
    const over = this.mc.querySelector('#pg-overflow')
    if (over) over.hidden = page.offsetHeight <= A4_PX + 2
  }

  // ── Save / copy / delete ───────────────────────────────────────────────────
  async _save() {
    const d = this.draft
    if (!d || this.saving) return false
    if (!d.title.trim()) { this.app.toast('Give the document a title first'); this.mc.querySelector('[data-k="title"]')?.focus(); return false }
    this.saving = true; this.app.updateTitle()
    try {
      const { document } = d.id ? await api.updatePdfDocument(d.id, this._toDoc()) : await api.createPdfDocument(this._toDoc())
      if (!d.id) { d.id = document.id; history.replaceState({}, '', `#pdf-generator/${document.id}`) }
      this.dirty = false
      this.docs = null
      this.app.toast('Saved')
      return true
    } catch (e) {
      this.app.toastError(e.message || 'Could not save', () => this._save())
      return false
    } finally {
      this.saving = false
      this.app.updateTitle()
    }
  }

  async _saveCopy() {
    const d = this.draft
    if (!d?.id || this.saving) return
    this.saving = true; this.app.updateTitle()
    try {
      const { document } = await api.createPdfDocument({ ...this._toDoc(), title: `${d.title.trim()} (copy)`.slice(0, LIMITS.title) })
      this.draft = this._toDraft(document)
      this.dirty = false
      this.docs = null
      history.pushState({}, '', `#pdf-generator/${document.id}`)
      this.app.toast('Saved as a copy')
    } catch (e) {
      this.app.toastError(e.message || 'Could not save a copy')
    } finally {
      this.saving = false
      this._drawEditor()
      this.app.updateTitle()
    }
  }

  async _delete() {
    const d = this.draft
    if (!d?.id) return
    if (!await this.app.confirm({ title: `Delete '${d.title}'?`, message: 'It is removed for everyone on the team. This cannot be undone.', confirmLabel: 'Delete' })) return
    try {
      await api.deletePdfDocument(d.id)
    } catch (e) {
      if (e.status !== 404) { this.app.toastError(e.message || 'Could not delete'); return }
    }
    this.draft = null; this.dirty = false; this.docs = null
    history.pushState({}, '', '#pdf-generator')
    this.app.toast('Document deleted')
    this._drawList()
    this.app.updateTitle()
    this._loadList()
  }

  // ── Print ──────────────────────────────────────────────────────────────────
  // The same route as a quote: the page goes into #pdf-topsheet, the only thing
  // the print stylesheet shows. The tab's title becomes the file name that
  // "Save as PDF" suggests.
  _print() {
    const d = this.draft
    if (!d) return
    let ts = document.getElementById('pdf-topsheet')
    if (!ts) { ts = document.createElement('div'); ts.id = 'pdf-topsheet'; document.body.appendChild(ts) }
    ts.innerHTML = renderOnePager(this._toDoc(), this.app.settings || {})
    const before = document.title
    document.title = d.title.trim() || 'Document'
    window.addEventListener('afterprint', () => { document.title = before }, { once: true })
    setTimeout(() => window.print(), 150)
    this.app.toast('Opening print dialog…')
  }
}
