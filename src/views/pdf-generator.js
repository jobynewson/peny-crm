// src/views/pdf-generator.js
// Tools › PDF Generator (#pdf-generator, #pdf-generator/<id>): the team's shared
// library of one-page documents in the quote PDF's look. Pick one to change it,
// or start a new one; the form on the left drives a live A4 preview and
// "Download PDF" opens the browser's print dialog (Save as PDF), the same way a
// quote does. Saved documents live on the server (api/pdf-documents.js) and
// everyone on staff sees the same library; viewers can open and print them.

import * as api from '../api/pdf-documents.js'
import { BLOCK_LABELS, FLAGS, LIMITS, blankDocument, blocksFromEditor, blocksToEditor } from '../pdf/onepager.js'
import { paginate } from '../pdf/paginate.js'
import { formatState, mountRichBox, toggleFormat } from '../pdf/richbox.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
    return { id: d.id, title: d.title, theme: d.theme, content: this._metaOf(d.content), blocks: blocksToEditor(d.content.blocks) }
  }

  // The document's fields apart from its blocks. Older saves lack the newer
  // ones, so every one has a default.
  _metaOf(c) {
    return {
      label: c.label ?? '', subtitle: c.subtitle ?? '', date: c.date ?? '', preparedBy: c.preparedBy ?? '', emails: c.emails ?? '', scale: Number.isInteger(c.scale) ? c.scale : 100,
      ...Object.fromEntries(FLAGS.map(k => [k, c[k] === true])),
    }
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
      this.draft = { title: b.title, theme: b.theme, content: this._metaOf(b.content), blocks: blocksToEditor(b.content.blocks) }
      this.dirty = true
      history.pushState({}, '', '#pdf-generator')
    } else {
      history.pushState({}, '', `#pdf-generator/${id}`)
      this.draft = null
    }
    await this.render(this.mc)
    this.app.updateTitle()
  }

  _unwatchSelection() {
    if (this._onSelection) document.removeEventListener('selectionchange', this._onSelection)
    this._onSelection = null
  }

  async _close() {
    if (this.dirty && !this.readOnly && !await this.app.confirm({ title: 'Leave without saving?', message: 'Your changes to this document have not been saved.', confirmLabel: 'Leave', danger: false })) return
    this._unwatchSelection()
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
        ? `<input type="text" data-f="text" data-i="${i}" value="${esc(b.text)}" maxlength="${LIMITS.text}" aria-label="Heading text" spellcheck="true" lang="en-GB" />`
        : `<div class="pg-rich" data-rich data-i="${i}" role="textbox" aria-multiline="true" aria-label="${BLOCK_LABELS[b.type]}" spellcheck="true" lang="en-GB" data-placeholder="${b.type === 'bullets' ? 'One item per line' : b.type === 'table' ? 'One row per line: Label | Value' : ''}"></div>`
      const fmt = b.type === 'heading' ? '' : `<button type="button" class="pg-block-btn pg-fmt" data-fmt="bold" data-i="${i}" aria-label="Bold" aria-pressed="false" title="Bold (Ctrl+B)">B</button><button type="button" class="pg-block-btn pg-fmt pg-fmt-i" data-fmt="italic" data-i="${i}" aria-label="Italic" aria-pressed="false" title="Italic (Ctrl+I)">I</button>`
      return `<div class="pg-block">
        <div class="pg-block-head">
          <span class="pg-block-type">${BLOCK_LABELS[b.type]}</span>
          ${fmt}
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
          <div class="field"><div class="field-label">Title</div><input type="text" data-k="title" spellcheck="true" lang="en-GB" value="${esc(d.title)}" maxlength="${LIMITS.title}" placeholder="Document title" /></div>
          <div class="field"><div class="field-label">Label <span class="tr-muted">(small text above the title)</span></div><input type="text" data-k="label" spellcheck="true" lang="en-GB" value="${esc(d.content.label)}" maxlength="${LIMITS.label}" placeholder="e.g. Proposal" /></div>
          <div class="field"><div class="field-label">Subtitle</div><input type="text" data-k="subtitle" spellcheck="true" lang="en-GB" value="${esc(d.content.subtitle)}" maxlength="${LIMITS.subtitle}" /></div>
          <div class="field"><div class="field-label">Date</div><input type="text" data-k="date" spellcheck="false" value="${esc(d.content.date)}" maxlength="${LIMITS.date}" /></div>
          <div class="field"><div class="field-label">Prepared by</div><input type="text" data-k="preparedBy" spellcheck="true" lang="en-GB" value="${esc(d.content.preparedBy)}" maxlength="${LIMITS.preparedBy}" placeholder="Leave blank to leave it out" /></div>
          <div class="field"><div class="field-label">Email addresses <span class="tr-muted">(separate with commas)</span></div><input type="text" data-k="emails" spellcheck="false" value="${esc(d.content.emails)}" maxlength="${LIMITS.emails}" /></div>
          <div class="field"><div class="field-label">Look</div>
            <div class="seg" role="group" aria-label="Look">
              <button type="button" class="seg-btn" data-theme="dark" aria-pressed="${d.theme !== 'light'}">Dark</button>
              <button type="button" class="seg-btn" data-theme="light" aria-pressed="${d.theme === 'light'}">Light</button>
            </div>
          </div>
          <div class="field"><div class="field-label"><label for="pg-scale">Scale</label></div>
            <div class="pg-scale">
              <input type="range" id="pg-scale" min="${LIMITS.scaleMin}" max="${LIMITS.scaleMax}" step="1" value="${d.content.scale}" aria-describedby="pg-scale-hint" />
              <output id="pg-scale-out" for="pg-scale">${d.content.scale}%</output>
              <button type="button" class="btn-secondary" id="pg-scale-reset"${d.content.scale === 100 ? ' disabled' : ''}>Reset</button>
            </div>
            <p class="pg-hint" id="pg-scale-hint">Shrinks or grows everything on the page together. Pull it down to fit a document onto one page.</p>
          </div>
          <div class="field"><div class="field-label">Layout</div>
            <div class="pg-checks">
              <label class="pg-check"><input type="checkbox" data-flag="condensedHeader"${d.content.condensedPage || d.content.condensedHeader ? ' checked' : ''}${d.content.condensedPage ? ' disabled' : ''} /><span>Condensed header</span></label>
              <label class="pg-check"><input type="checkbox" data-flag="condensedFooter"${d.content.condensedPage || d.content.condensedFooter ? ' checked' : ''}${d.content.condensedPage ? ' disabled' : ''} /><span>Condensed footer</span></label>
              <label class="pg-check"><input type="checkbox" data-flag="condensedPage"${d.content.condensedPage ? ' checked' : ''} /><span>Condense the whole page <span class="tr-muted">(smaller type and margins, to fit more)</span></span></label>
            </div>
          </div>
          <div class="field"><div class="field-label">Content</div>
            <p class="pg-hint">Select text and use B and I (or Ctrl+B and Ctrl+I) for bold and italic. Enter starts a new line. Anything that doesn't fit flows onto the next page, starting a new page at a heading where it can.</p>
          </div>
          ${blocksHtml}
          <div class="pg-add" role="group" aria-label="Add a block">
            ${Object.entries(BLOCK_LABELS).map(([t, l]) => `<button type="button" class="btn-secondary" data-add="${t}"${blockCount >= LIMITS.blocks ? ' disabled' : ''}>+ ${l}</button>`).join('')}
          </div>
          <p class="pg-hint">The logo, address, website and VAT number come from Settings. Prepared by and the email addresses are only what you type here.</p>
        </fieldset></div>
        <div class="pg-preview-wrap">
          <p class="pg-hint pg-pages-note" id="pg-pages-note" hidden></p>
          <div class="pg-preview-frame" id="pg-frame" aria-label="Preview"></div>
        </div>
      </div>`
    this._bindEditor()
    this._renderPreview()
  }

  _bindEditor() {
    const mc = this.mc, d = this.draft
    mc.querySelector('#pg-back').addEventListener('click', e => { e.preventDefault(); this._close() })
    mc.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', () => {
      const k = el.dataset.k
      if (k === 'title') d.title = el.value; else d.content[k] = el.value
      this._changed()
    }))
    // Headings are plain single-line fields; the other blocks are rich text boxes.
    mc.querySelectorAll('input[data-f]').forEach(el => el.addEventListener('input', () => { d.blocks[Number(el.dataset.i)].text = el.value; this._changed() }))
    mc.querySelectorAll('[data-rich]').forEach(el => {
      const i = Number(el.dataset.i)
      mountRichBox(el, d.blocks[i].text, { editable: !this.readOnly, onInput: markup => { d.blocks[i].text = markup.slice(0, LIMITS.text); this._changed() } })
    })
    mc.querySelectorAll('[data-fmt]').forEach(btn => {
      // The button must not take the selection from the box.
      btn.addEventListener('mousedown', e => e.preventDefault())
      btn.addEventListener('click', () => {
        const box = mc.querySelector(`[data-rich][data-i="${btn.dataset.i}"]`)
        if (!box || this.readOnly) return
        toggleFormat(box, btn.dataset.fmt)
        this._syncFormatButtons()
      })
    })
    this._watchSelection()

    const range = mc.querySelector('#pg-scale'), out = mc.querySelector('#pg-scale-out'), reset = mc.querySelector('#pg-scale-reset')
    const setScale = v => {
      d.content.scale = v
      range.value = String(v); out.textContent = `${v}%`; reset.disabled = v === 100
      this._changed()
    }
    range.addEventListener('input', () => setScale(Number(range.value)))
    reset.addEventListener('click', () => setScale(100))
    mc.querySelectorAll('[data-flag]').forEach(el => el.addEventListener('change', () => {
      d.content[el.dataset.flag] = el.checked
      this._changed()
      if (el.dataset.flag === 'condensedPage') this._drawEditor()
    }))
    mc.querySelectorAll('[data-theme]').forEach(btn => btn.addEventListener('click', () => {
      d.theme = btn.dataset.theme
      mc.querySelectorAll('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)))
      this._changed()
    }))
    mc.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
      d.blocks.push({ type: btn.dataset.add, text: '' })
      this._changed(); this._drawEditor()
      mc.querySelector(`[data-i="${d.blocks.length - 1}"][data-rich], input[data-f][data-i="${d.blocks.length - 1}"]`)?.focus()
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

  // B and I show as pressed while the caret or selection is in bold or italic text.
  _watchSelection() {
    if (this._onSelection) document.removeEventListener('selectionchange', this._onSelection)
    this._onSelection = () => this._syncFormatButtons()
    document.addEventListener('selectionchange', this._onSelection)
  }

  _syncFormatButtons() {
    const mc = this.mc
    if (!mc) return
    const box = document.activeElement?.closest?.('[data-rich]')
    mc.querySelectorAll('[data-fmt]').forEach(btn => btn.setAttribute('aria-pressed', 'false'))
    if (!box || !mc.contains(box)) return
    const st = formatState()
    mc.querySelector(`[data-fmt="bold"][data-i="${box.dataset.i}"]`)?.setAttribute('aria-pressed', String(!!st.bold))
    mc.querySelector(`[data-fmt="italic"][data-i="${box.dataset.i}"]`)?.setAttribute('aria-pressed', String(!!st.italic))
  }

  _changed() {
    if (this.readOnly) return
    const was = this.dirty
    this.dirty = true
    this._drawPreview()
    if (!was) this.app.updateTitle()
  }

  // The pages are laid out with the browser's own layout, so redrawing waits for
  // a pause in typing.
  _drawPreview() {
    clearTimeout(this._previewTimer)
    this._previewTimer = setTimeout(() => this._renderPreview(), 120)
  }

  _renderPreview() {
    const frame = this.mc?.querySelector('#pg-frame')
    if (!frame || !this.draft) return
    const { html, total } = paginate(this._toDoc(), this.app.settings || {})
    frame.innerHTML = html
    const note = this.mc.querySelector('#pg-pages-note')
    if (note) { note.hidden = total < 2; note.textContent = `This document runs to ${total} pages.` }
    this._fitPreview()
  }

  // The pages are A4 at 96dpi; scale them down to the width on offer and size
  // the frame to match.
  _fitPreview() {
    const frame = this.mc?.querySelector('#pg-frame')
    const pages = frame?.querySelector('.pdf-one-pages')
    if (!pages) return
    const scale = Math.min(1, frame.clientWidth / A4_W_PX) || 1
    pages.style.transform = `scale(${scale})`
    frame.style.height = `${Math.ceil(pages.offsetHeight * scale)}px`
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
    ts.innerHTML = paginate(this._toDoc(), this.app.settings || {}).html
    const before = document.title
    document.title = d.title.trim() || 'Document'
    window.addEventListener('afterprint', () => { document.title = before }, { once: true })
    setTimeout(() => window.print(), 150)
    this.app.toast('Opening print dialog…')
  }
}
