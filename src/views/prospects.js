// Prospecting & Outbound — brand-scoped by the global switcher.
//
// A prospect is just a contact whose lifecycle_stage isn't 'won' yet, so this
// view works over the same `contacts` data as Contacts (minus subcontractors,
// who are shared crew). Three tabs — Board (kanban by stage, drag to move),
// List (fast filterable/inline-editable table), Work queue (my overdue/due-today)
// — plus a slide-over detail with the matching sector angle and outreach timeline.
//
// The kanban mirrors the Marketing implementation (shared .kanban-* styles + the
// same drag wiring) rather than introducing a new one.

import {
  updateContact, createContact, logActivity,
  getOutreachActivity, addOutreachActivity, deleteOutreachActivity,
} from '../db/client.js'

// ── Reference data ────────────────────────────────────────────────────────────
export const STAGES = [
  { id: 'prospect',  label: 'Prospect',  color: '#8590A2' },
  { id: 'contacted', label: 'Contacted', color: '#4a90d9' },
  { id: 'engaged',   label: 'Engaged',   color: '#a78bfa' },
  { id: 'proposal',  label: 'Proposal',  color: '#f59e0b' },
  { id: 'won',       label: 'Won',       color: '#34d399' },
  { id: 'nurture',   label: 'Nurture',   color: '#14b8a6' },
  { id: 'lost',      label: 'Lost',      color: '#ef4444' },
]
const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.id, s.label]))
const STAGE_COLOR = Object.fromEntries(STAGES.map(s => [s.id, s.color]))

const TIERS = {
  A: { label: 'A', color: '#8b5cf6', hint: 'Retainer-shaped / recurring need' },
  B: { label: 'B', color: '#4a90d9', hint: 'High-value one-off' },
  C: { label: 'C', color: '#8590A2', hint: 'Volume / warm-up' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
const initials = name => (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

// Days until a YYYY-MM-DD date (negative = overdue). null if no date.
function daysUntil(d) {
  if (!d) return null
  return Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000)
}

export class ProspectsView {
  constructor(app) {
    this.app = app
    this.activeTab = 'board'          // 'board' | 'list' | 'queue'
    this.selectedId = null
    this._dragId = null
    this._activity = {}               // contactId -> loaded outreach rows
    this.filters = { tier: '', sector: '', owner: '', stage: '', priority: '' }
    this.sort = { key: 'priority', dir: 'desc' }
  }

  // Non-subcontractor contacts under the active brand are the pipeline.
  _prospects() {
    return (this.app.contacts || []).filter(c => c.type !== 'subcontractor')
  }

  orgName(p) {
    return p.company?.trim() || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Untitled'
  }

  ownerUser(id) {
    return id ? (this.app.allUsers || []).find(u => u.clerk_id === id) : null
  }

  // The reusable sector playbook whose sector matches this org (brand already scoped).
  matchingAngle(p) {
    if (!p.sector) return null
    const s = p.sector.trim().toLowerCase()
    return (this.app.sectorAngles || []).find(a => (a.sector || '').trim().toLowerCase() === s) || null
  }

  // ── Shell ────────────────────────────────────────────────────────────────────
  render(mc) {
    const tabs = [
      { id: 'board', label: 'Pipeline board' },
      { id: 'list',  label: 'List' },
      { id: 'queue', label: 'Work queue' },
    ]
    const overdueMine = this._prospects().filter(p => this._isMine(p) && daysUntil(p.next_action_at) !== null && daysUntil(p.next_action_at) <= 0).length
    mc.innerHTML = `
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border-light);margin-bottom:20px">
        ${tabs.map(t => `
          <button class="prs-tab" data-tab="${t.id}"
            style="padding:8px 16px;font-size:13px;font-family:var(--font);cursor:pointer;background:none;border:none;border-bottom:2px solid ${this.activeTab === t.id ? 'var(--accent)' : 'transparent'};color:${this.activeTab === t.id ? 'var(--accent)' : 'var(--text-secondary)'};font-weight:${this.activeTab === t.id ? '600' : '400'};margin-bottom:-1px">
            ${t.label}${t.id === 'queue' && overdueMine ? ` <span style="background:#ef4444;color:#fff;border-radius:var(--radius-pill);font-size:10px;padding:1px 6px;margin-left:2px">${overdueMine}</span>` : ''}
          </button>`).join('')}
      </div>
      <div id="prs-content"></div>
      <div id="prs-detail"></div>`

    mc.querySelectorAll('.prs-tab').forEach(btn => {
      btn.addEventListener('click', () => { this.activeTab = btn.dataset.tab; this.render(mc) })
    })

    const content = mc.querySelector('#prs-content')
    if (this.activeTab === 'board') this.renderBoard(content)
    else if (this.activeTab === 'list') this.renderList(content)
    else this.renderQueue(content)

    if (this.selectedId) this.showDetail(this.selectedId)
  }

  _isMine(p) {
    return p.owner && p.owner === this.app.clerkUserId
  }

  // ── Board (kanban by lifecycle stage) ─────────────────────────────────────────
  _cardsFor(stageId) {
    return this._prospects()
      .filter(p => (p.lifecycle_stage || 'prospect') === stageId)
      .sort((a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        this._dueRank(a) - this._dueRank(b) ||
        this.orgName(a).localeCompare(this.orgName(b)))
  }

  // Overdue/soonest next actions first; no date sorts last.
  _dueRank(p) {
    const d = daysUntil(p.next_action_at)
    return d === null ? Infinity : d
  }

  renderBoard(mc) {
    mc.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(${STAGES.length},minmax(220px,1fr));gap:14px;align-items:start;overflow-x:auto;padding-bottom:24px">
        ${STAGES.map(col => {
          const cards = this._cardsFor(col.id)
          return `
          <div class="kanban-col" data-col="${col.id}" style="min-width:0">
            <div class="kanban-col-head">
              <span style="width:8px;height:8px;border-radius:50%;background:${col.color};flex-shrink:0"></span>
              <span style="flex:1">${col.label}</span>
              <span class="kanban-count">${cards.length || ''}</span>
            </div>
            <div class="kanban-col-body" data-col-body="${col.id}">
              ${cards.map(p => this.renderCard(p)).join('')}
            </div>
          </div>`
        }).join('')}
      </div>`

    mc.querySelectorAll('.kanban-card[data-id]').forEach(el => {
      el.addEventListener('click', e => { if (!e.target.closest('[data-noopen]')) this.select(el.dataset.id) })
    })
    this._bindBoardDnD(mc)
  }

  renderCard(p) {
    const tier = p.tier ? TIERS[p.tier] : null
    const owner = this.ownerUser(p.owner)
    const d = daysUntil(p.next_action_at)
    const dueColor = d === null ? '' : d < 0 ? '#ef4444' : d === 0 ? '#f59e0b' : 'var(--text-tertiary)'
    const dueLabel = d === null ? '' : d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'Today' : fmtDate(p.next_action_at)
    return `
      <div class="kanban-card" data-id="${p.id}" draggable="true">
        <div class="kanban-card-title">${esc(this.orgName(p))}</div>
        ${p.sector ? `<div class="kanban-card-client">${esc(p.sector)}${p.area ? ` · ${esc(p.area)}` : ''}</div>` : (p.area ? `<div class="kanban-card-client">${esc(p.area)}</div>` : '')}
        <div class="kanban-card-meta">
          ${tier ? `<span title="${esc(tier.hint)}" style="font-size:10px;font-weight:700;color:#fff;background:${tier.color};border-radius:var(--radius-sm);padding:1px 6px">${tier.label}</span>` : ''}
          ${owner ? `<span title="${esc(owner.name || owner.email)}" style="width:19px;height:19px;border-radius:50%;background:#4a90d9;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">${initials(owner.name || owner.email)}</span>` : ''}
          ${dueLabel ? `<span class="kanban-card-date" style="color:${dueColor};margin-left:auto">${dueLabel}</span>` : ''}
        </div>
      </div>`
  }

  _bindBoardDnD(mc) {
    const clear = () => {
      mc.querySelectorAll('.kanban-card').forEach(c => c.classList.remove('kanban-card--over'))
      mc.querySelectorAll('.kanban-col-body').forEach(z => z.classList.remove('kanban-col-body--over'))
    }
    mc.querySelectorAll('.kanban-card[data-id]').forEach(card => {
      card.addEventListener('dragstart', e => {
        this._dragId = card.dataset.id
        e.dataTransfer.effectAllowed = 'move'
        setTimeout(() => card.classList.add('kanban-card--dragging'), 0)
      })
      card.addEventListener('dragend', () => { card.classList.remove('kanban-card--dragging'); clear(); this._dragId = null })
    })
    mc.querySelectorAll('.kanban-col-body').forEach(zone => {
      zone.addEventListener('dragover', e => {
        if (!this._dragId) return
        e.preventDefault(); e.dataTransfer.dropEffect = 'move'
        clear(); zone.classList.add('kanban-col-body--over')
      })
      zone.addEventListener('dragleave', () => zone.classList.remove('kanban-col-body--over'))
      zone.addEventListener('drop', e => {
        e.preventDefault(); clear()
        if (!this._dragId) return
        this._moveToStage(this._dragId, zone.dataset.colBody)
      })
    })
  }

  async _moveToStage(id, stage) {
    const p = this._prospects().find(x => x.id === id)
    if (!p || p.lifecycle_stage === stage) return
    const prev = p.lifecycle_stage
    p.lifecycle_stage = stage
    this.renderBoard(document.getElementById('prs-content'))
    try {
      await updateContact(this.app.userId, id, { lifecycle_stage: stage })
      logActivity(this.app.userId, 'contact', id, this.orgName(p), `Stage → ${STAGE_LABEL[stage]}`).catch(() => {})
      if (stage === 'won') this.app.toast(`${this.orgName(p)} marked Won — now a client`)
    } catch (e) {
      console.error(e); p.lifecycle_stage = prev
      this.app.toast('Could not move prospect'); this.renderBoard(document.getElementById('prs-content'))
    }
  }

  // ── List (fast, filterable, inline-editable) ──────────────────────────────────
  _filtered() {
    const f = this.filters
    let rows = this._prospects().filter(p =>
      (!f.stage    || (p.lifecycle_stage || 'prospect') === f.stage) &&
      (!f.tier     || p.tier === f.tier) &&
      (!f.owner    || p.owner === f.owner) &&
      (!f.priority || String(p.priority ?? 0) === f.priority) &&
      (!f.sector   || (p.sector || '').toLowerCase().includes(f.sector.toLowerCase())))
    const { key, dir } = this.sort
    const val = p => key === 'name' ? this.orgName(p).toLowerCase()
      : key === 'priority' ? (p.priority ?? 0)
      : key === 'next' ? this._dueRank(p)
      : key === 'tier' ? (p.tier || 'Z')
      : key === 'stage' ? STAGES.findIndex(s => s.id === (p.lifecycle_stage || 'prospect'))
      : (p[key] || '')
    rows.sort((a, b) => { const av = val(a), bv = val(b); return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === 'asc' ? 1 : -1) })
    return rows
  }

  renderList(mc) {
    const users = this.app.allUsers || []
    const sectors = [...new Set(this._prospects().map(p => p.sector).filter(Boolean))].sort()
    const f = this.filters
    const sel = (val, cur) => val === cur ? ' selected' : ''
    mc.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
        <select class="prs-f" data-f="stage" style="${this._fStyle}">
          <option value="">All stages</option>${STAGES.map(s => `<option value="${s.id}"${sel(s.id, f.stage)}>${s.label}</option>`).join('')}
        </select>
        <select class="prs-f" data-f="tier" style="${this._fStyle}">
          <option value="">All tiers</option>${['A', 'B', 'C'].map(t => `<option value="${t}"${sel(t, f.tier)}>Tier ${t}</option>`).join('')}
        </select>
        <select class="prs-f" data-f="owner" style="${this._fStyle}">
          <option value="">All owners</option>${users.map(u => `<option value="${u.clerk_id}"${sel(u.clerk_id, f.owner)}>${esc(u.name || u.email)}</option>`).join('')}
        </select>
        <select class="prs-f" data-f="sector" style="${this._fStyle}">
          <option value="">All sectors</option>${sectors.map(s => `<option value="${esc(s)}"${sel(s, f.sector)}>${esc(s)}</option>`).join('')}
        </select>
        <input class="prs-f" data-f="priority" type="number" min="0" placeholder="Priority" value="${esc(f.priority)}" style="${this._fStyle};width:90px">
        <span style="font-size:12px;color:var(--text-tertiary);margin-left:auto">${this._filtered().length} of ${this._prospects().length}</span>
      </div>
      <div class="panel" style="overflow-x:auto">
        <div class="col-header" style="grid-template-columns:2.2fr 1.3fr 60px 70px 1.2fr 1.1fr 1.4fr">
          ${this._th('name', 'Organisation')}${this._th('sector', 'Sector')}${this._th('tier', 'Tier')}${this._th('priority', 'Prio')}
          ${this._th('stage', 'Stage')}${this._th('next', 'Next action')}<div>Owner</div>
        </div>
        <div id="prs-rows">${this._filtered().map(p => this._row(p, users)).join('') || '<div class="empty-state">No prospects match</div>'}</div>
      </div>`

    mc.querySelectorAll('.prs-f').forEach(el => {
      const ev = el.tagName === 'INPUT' ? 'input' : 'change'
      el.addEventListener(ev, () => { this.filters[el.dataset.f] = el.value; this._refreshRows() })
    })
    mc.querySelectorAll('[data-sort]').forEach(el => {
      el.addEventListener('click', () => {
        const k = el.dataset.sort
        if (this.sort.key === k) this.sort.dir = this.sort.dir === 'asc' ? 'desc' : 'asc'
        else this.sort = { key: k, dir: k === 'name' || k === 'sector' ? 'asc' : 'desc' }
        this.renderList(mc)
      })
    })
    this._bindRows(mc)
  }

  get _fStyle() {
    return 'font-size:12px;padding:5px 8px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none'
  }

  _th(key, label) {
    const arrow = this.sort.key === key ? (this.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
    return `<div data-sort="${key}" style="cursor:pointer;user-select:none">${label}${arrow}</div>`
  }

  _row(p, users) {
    const d = daysUntil(p.next_action_at)
    const dueColor = d === null ? 'var(--text-tertiary)' : d < 0 ? '#ef4444' : d === 0 ? '#f59e0b' : 'var(--text-secondary)'
    const iStyle = 'font-size:12px;padding:3px 5px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--text-primary);font-family:var(--font);outline:none;width:100%'
    return `
      <div class="contact-row prs-row" data-id="${p.id}" style="grid-template-columns:2.2fr 1.3fr 60px 70px 1.2fr 1.1fr 1.4fr;align-items:center">
        <div class="prs-open" data-id="${p.id}" style="cursor:pointer;font-weight:550;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this.orgName(p))}</div>
        <input class="prs-i" data-id="${p.id}" data-k="sector" value="${esc(p.sector)}" placeholder="—" style="${iStyle}">
        <select class="prs-i" data-id="${p.id}" data-k="tier" style="${iStyle}"><option value="">–</option>${['A', 'B', 'C'].map(t => `<option value="${t}"${p.tier === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <input class="prs-i" data-id="${p.id}" data-k="priority" type="number" min="0" value="${p.priority ?? 0}" style="${iStyle};text-align:center">
        <select class="prs-i" data-id="${p.id}" data-k="lifecycle_stage" style="${iStyle}">${STAGES.map(s => `<option value="${s.id}"${(p.lifecycle_stage || 'prospect') === s.id ? ' selected' : ''}>${s.label}</option>`).join('')}</select>
        <input class="prs-i" data-id="${p.id}" data-k="next_action_at" type="date" value="${p.next_action_at || ''}" style="${iStyle};color:${dueColor}">
        <select class="prs-i" data-id="${p.id}" data-k="owner" style="${iStyle}"><option value="">— none —</option>${users.map(u => `<option value="${u.clerk_id}"${p.owner === u.clerk_id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select>
      </div>`
  }

  _bindRows(mc) {
    mc.querySelectorAll('.prs-open').forEach(el => el.addEventListener('click', () => this.select(el.dataset.id)))
    mc.querySelectorAll('.prs-i').forEach(el => {
      const ev = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'blur'
      el.addEventListener(ev, () => this._saveField(el.dataset.id, el.dataset.k, el.value))
      if (el.tagName === 'INPUT' && el.type !== 'date') el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur() })
    })
  }

  _refreshRows() {
    const wrap = document.getElementById('prs-rows')
    if (!wrap) return
    wrap.innerHTML = this._filtered().map(p => this._row(p, this.app.allUsers || [])).join('') || '<div class="empty-state">No prospects match</div>'
    this._bindRows(document.getElementById('prs-content'))
  }

  // Persist a single inline field edit.
  async _saveField(id, key, raw) {
    const p = (this.app.contacts || []).find(c => c.id === id)
    if (!p) return
    let value = raw
    if (key === 'priority') value = parseInt(raw) || 0
    if (['sector', 'next_action_at', 'tier', 'owner'].includes(key)) value = raw || null
    if (p[key] === value) return
    p[key] = value
    try {
      await updateContact(this.app.userId, id, { [key]: value })
      if (key === 'lifecycle_stage' && value === 'won') this.app.toast(`${this.orgName(p)} marked Won — now a client`)
    } catch (e) { console.error(e); this.app.toast('Could not save change') }
  }

  // ── Work queue (my overdue / due-today, by priority) ──────────────────────────
  renderQueue(mc) {
    const mine = this._prospects()
      .filter(p => this._isMine(p) && !['won', 'lost'].includes(p.lifecycle_stage) && daysUntil(p.next_action_at) !== null && daysUntil(p.next_action_at) <= 0)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || this._dueRank(a) - this._dueRank(b))
    const soon = this._prospects()
      .filter(p => this._isMine(p) && !['won', 'lost'].includes(p.lifecycle_stage) && daysUntil(p.next_action_at) !== null && daysUntil(p.next_action_at) > 0 && daysUntil(p.next_action_at) <= 7)
      .sort((a, b) => this._dueRank(a) - this._dueRank(b) || (b.priority ?? 0) - (a.priority ?? 0))

    const rowHtml = (p) => {
      const d = daysUntil(p.next_action_at)
      const color = d < 0 ? '#ef4444' : d === 0 ? '#f59e0b' : 'var(--text-tertiary)'
      const label = d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'Today' : `in ${d}d`
      const tier = p.tier ? TIERS[p.tier] : null
      return `
        <div class="prs-q" data-id="${p.id}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-light);border-radius:var(--radius-md);background:var(--bg-primary);cursor:pointer">
          <span style="font-size:11px;font-weight:700;color:${color};min-width:64px">${label}</span>
          ${tier ? `<span style="font-size:10px;font-weight:700;color:#fff;background:${tier.color};border-radius:var(--radius-sm);padding:1px 6px">${tier.label}</span>` : ''}
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this.orgName(p))}</div>
            <div style="font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.next_action) || `<span style="color:var(--text-tertiary)">No action noted · ${STAGE_LABEL[p.lifecycle_stage] || ''}</span>`}</div>
          </div>
          <button class="btn-secondary prs-q-log" data-id="${p.id}" data-noopen style="font-size:11px;padding:4px 10px">Log</button>
        </div>`
    }

    mc.innerHTML = `
      <div style="max-width:720px">
        <div style="font-size:12px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Needs contacting${mine.length ? ` · ${mine.length}` : ''}</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:22px">
          ${mine.length ? mine.map(rowHtml).join('') : `<div class="empty-state" style="padding:24px">Nothing overdue or due today. ${this._prospects().some(p => this._isMine(p)) ? 'Nice.' : 'You have no prospects assigned to you yet.'}</div>`}
        </div>
        ${soon.length ? `
          <div style="font-size:12px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Coming up (7 days)</div>
          <div style="display:flex;flex-direction:column;gap:8px">${soon.map(rowHtml).join('')}</div>` : ''}
      </div>`

    mc.querySelectorAll('.prs-q').forEach(el => el.addEventListener('click', e => { if (!e.target.closest('[data-noopen]')) this.select(el.dataset.id) }))
    mc.querySelectorAll('.prs-q-log').forEach(el => el.addEventListener('click', () => this.select(el.dataset.id, true)))
  }

  // ── Detail slide-over ─────────────────────────────────────────────────────────
  select(id, focusLog = false) {
    this.selectedId = id
    this.showDetail(id, focusLog)
  }

  closeDetail() {
    this.selectedId = null
    const host = document.getElementById('prs-detail')
    if (host) host.innerHTML = ''
  }

  async showDetail(id, focusLog = false) {
    const p = (this.app.contacts || []).find(c => c.id === id)
    const host = document.getElementById('prs-detail')
    if (!p || !host) return
    const angle = this.matchingAngle(p)
    const owner = this.ownerUser(p.owner)
    const users = this.app.allUsers || []
    const info = (k, v) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:12px"><span style="color:var(--text-tertiary)">${k}</span><span style="color:var(--text-secondary);text-align:right">${v || '—'}</span></div>`
    const link = (url, text) => url ? `<a href="${/^https?:\/\//.test(url) ? url : 'https://' + url}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(text || url)}</a>` : '—'
    const rating = p.source_rating != null ? `★ ${p.source_rating}${p.source_review_count != null ? ` (${p.source_review_count})` : ''}` : '—'

    host.innerHTML = `
      <div class="prs-detail-backdrop" style="position:fixed;inset:0;background:rgba(9,30,66,0.35);z-index:120"></div>
      <aside style="position:fixed;top:0;right:0;bottom:0;width:min(460px,100%);background:var(--bg-primary);border-left:1px solid var(--border-med);box-shadow:var(--shadow-lg);z-index:121;display:flex;flex-direction:column">
        <div style="display:flex;align-items:flex-start;gap:10px;padding:16px 18px;border-bottom:1px solid var(--border-light)">
          <div style="flex:1;min-width:0">
            <input id="prs-d-name" value="${esc(this.orgName(p))}" style="width:100%;border:none;outline:none;background:transparent;font-size:16px;font-weight:600;color:var(--text-primary);font-family:var(--font)">
            <div style="display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap">
              <span style="width:8px;height:8px;border-radius:50%;background:${STAGE_COLOR[p.lifecycle_stage] || '#8590A2'}"></span>
              <select id="prs-d-stage" style="font-size:12px;border:none;background:transparent;color:var(--text-secondary);font-family:var(--font);outline:none;cursor:pointer">
                ${STAGES.map(s => `<option value="${s.id}"${(p.lifecycle_stage || 'prospect') === s.id ? ' selected' : ''}>${s.label}</option>`).join('')}
              </select>
              ${p.tier ? `<span style="font-size:10px;font-weight:700;color:#fff;background:${TIERS[p.tier].color};border-radius:var(--radius-sm);padding:1px 6px">Tier ${p.tier}</span>` : ''}
            </div>
          </div>
          <button id="prs-d-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);line-height:1;padding:2px 6px">×</button>
        </div>

        <div style="flex:1;overflow-y:auto;padding:16px 18px">
          <div style="margin-bottom:18px">
            ${info('Sector', esc(p.sector))}
            ${info('Area', esc(p.area))}
            ${info('Website', link(p.website))}
            ${info('Phone', esc(p.phone))}
            ${info('Email', p.email ? `<a href="mailto:${esc(p.email)}" style="color:var(--accent)">${esc(p.email)}</a>` : '—')}
            ${info('Google rating', rating)}
            ${info('Owner', owner ? esc(owner.name || owner.email) : '—')}
            ${info('Next action', `${esc(p.next_action) || '—'}${p.next_action_at ? ` · <span style="color:${daysUntil(p.next_action_at) < 0 ? '#ef4444' : 'var(--text-secondary)'}">${fmtDate(p.next_action_at)}</span>` : ''}`)}
            ${info('Last contacted', p.last_contacted_at ? new Date(p.last_contacted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')}
          </div>

          ${p.fit_note || p.pitch_angle ? `
            <div style="background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:16px">
              ${p.fit_note ? `<div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Why they fit</div><div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:${p.pitch_angle ? '10px' : '0'};line-height:1.5">${esc(p.fit_note)}</div>` : ''}
              ${p.pitch_angle ? `<div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Pitch angle</div><div style="font-size:12.5px;color:var(--text-secondary);line-height:1.5">${esc(p.pitch_angle)}</div>` : ''}
            </div>` : ''}

          ${angle ? `
            <div style="border:1px solid var(--accent);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:16px;background:var(--accent-subtle)">
              <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Sector angle · ${esc(angle.sector)}${angle.tier ? ` (Tier ${esc(angle.tier)})` : ''}</div>
              ${[['Why video', angle.why_video], ['Opening hook', angle.opening_hook], ['Offer', angle.offer], ['Best time', angle.best_time], ['Proof', angle.proof]].filter(([, v]) => v).map(([k, v]) => `<div style="font-size:12px;margin-bottom:5px"><span style="color:var(--text-tertiary)">${k}:</span> <span style="color:var(--text-secondary)">${esc(v)}</span></div>`).join('')}
            </div>` : (p.sector ? `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:16px">No sector angle for “${esc(p.sector)}” yet.</div>` : '')}

          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Outreach</div>
            <button id="prs-d-edit" style="font-size:11px;background:none;border:1px solid var(--border-med);border-radius:var(--radius-sm);padding:3px 10px;cursor:pointer;color:var(--text-secondary);font-family:var(--font)">Edit fields</button>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:10px">
            <select id="prs-log-type" style="${this._fStyle}">
              <option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="note" selected>Note</option>
            </select>
            <input id="prs-log-body" placeholder="Log a call, email, meeting or note…" style="${this._fStyle};flex:1">
            <button class="btn-primary" id="prs-log-save" style="font-size:12px;padding:5px 12px">Log</button>
          </div>
          <div id="prs-timeline" style="font-size:12px;color:var(--text-tertiary)">Loading…</div>
        </div>

        <div style="border-top:1px solid var(--border-light);padding:10px 18px;display:flex;gap:8px;justify-content:space-between">
          <select id="prs-d-owner" style="${this._fStyle}">
            <option value="">— No owner —</option>${users.map(u => `<option value="${u.clerk_id}"${p.owner === u.clerk_id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
          </select>
          <button class="btn-primary" id="prs-d-open-edit" style="font-size:12px">Edit full record</button>
        </div>
      </aside>`

    host.querySelector('.prs-detail-backdrop').addEventListener('click', () => this.closeDetail())
    host.querySelector('#prs-d-close').addEventListener('click', () => this.closeDetail())
    host.querySelector('#prs-d-name').addEventListener('blur', e => this._saveField(id, 'company', e.target.value.trim()))
    host.querySelector('#prs-d-stage').addEventListener('change', e => { this._saveField(id, 'lifecycle_stage', e.target.value); this._refreshActive() })
    host.querySelector('#prs-d-owner').addEventListener('change', e => this._saveField(id, 'owner', e.target.value || null))
    host.querySelector('#prs-d-open-edit').addEventListener('click', () => this.openEditModal(id))
    host.querySelector('#prs-d-edit').addEventListener('click', () => this.openEditModal(id))
    host.querySelector('#prs-log-save').addEventListener('click', () => this._logActivity(id))
    host.querySelector('#prs-log-body').addEventListener('keydown', e => { if (e.key === 'Enter') this._logActivity(id) })

    if (focusLog) setTimeout(() => host.querySelector('#prs-log-body')?.focus(), 50)
    // Render the timeline from cache if we already have it (avoids a "Loading…"
    // flash when the panel rebuilds after logging or editing); else fetch once.
    if (this._activity[id]) this._renderTimeline(id)
    else this._loadTimeline(id)
  }

  // Re-render whichever tab is showing so a stage/owner change reflects immediately.
  _refreshActive() {
    const content = document.getElementById('prs-content')
    if (!content) return
    if (this.activeTab === 'board') this.renderBoard(content)
    else if (this.activeTab === 'list') this._refreshRows()
    else this.renderQueue(content)
  }

  async _loadTimeline(id) {
    const el = () => document.getElementById('prs-timeline')
    try {
      const rows = await getOutreachActivity(id)
      this._activity[id] = rows
      this._renderTimeline(id)
    } catch (e) { const t = el(); if (t) t.textContent = 'Could not load outreach' }
  }

  _renderTimeline(id) {
    const t = document.getElementById('prs-timeline')
    if (!t) return
    const rows = this._activity[id] || []
    if (!rows.length) { t.innerHTML = '<div style="padding:6px 0">No outreach logged yet.</div>'; return }
    const icon = { call: '📞', email: '✉️', meeting: '🤝', note: '📝' }
    const fmt = ts => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    t.innerHTML = rows.map(r => {
      const u = this.ownerUser(r.user_id)
      return `
        <div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-light)">
          <span style="flex-shrink:0">${icon[r.type] || '📝'}</span>
          <div style="flex:1;min-width:0">
            <div style="color:var(--text-secondary);white-space:pre-wrap;line-height:1.45">${esc(r.body) || `<em style="color:var(--text-tertiary)">${r.type}</em>`}</div>
            <div style="font-size:10px;color:var(--text-tertiary);margin-top:1px">${fmt(r.created_at)}${u ? ` · ${esc(u.name || u.email)}` : ''}</div>
          </div>
          <button class="prs-act-del" data-aid="${r.id}" title="Delete" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);opacity:0.5;font-size:12px">×</button>
        </div>`
    }).join('')
    t.querySelectorAll('.prs-act-del').forEach(b => b.addEventListener('click', () => this._deleteActivity(id, b.dataset.aid)))
  }

  async _logActivity(id) {
    const host = document.getElementById('prs-detail')
    const type = host.querySelector('#prs-log-type')?.value || 'note'
    const bodyEl = host.querySelector('#prs-log-body')
    const body = bodyEl?.value.trim()
    if (!body) { bodyEl?.focus(); return }
    try {
      const { activity, contact } = await addOutreachActivity(this.app.userId, id, this.app.clerkUserId, { type, body })
      this._activity[id] = [activity, ...(this._activity[id] || [])]
      const p = (this.app.contacts || []).find(c => c.id === id)
      if (p && contact) p.last_contacted_at = contact.last_contacted_at
      bodyEl.value = ''
      // Reflect the new last-contacted date + fresh timeline (cache is current).
      this.showDetail(id)
      this.app.toast('Logged')
    } catch (e) { console.error(e); this.app.toast('Could not log outreach') }
  }

  async _deleteActivity(id, aid) {
    try {
      await deleteOutreachActivity(aid)
      this._activity[id] = (this._activity[id] || []).filter(r => r.id !== aid)
      this._renderTimeline(id)
    } catch (e) { console.error(e); this.app.toast('Could not delete') }
  }

  // ── Create / edit modal ───────────────────────────────────────────────────────
  openNewModal(stage = 'prospect') { this._openModal(null, stage) }
  openEditModal(id) { this._openModal((this.app.contacts || []).find(c => c.id === id), null) }

  _openModal(p, defaultStage) {
    const isNew = !p
    const users = this.app.allUsers || []
    const showBrand = this.app.brand === 'all' || !isNew
    const cardBrand = p?.brand || this.app.brandForCreate() || 'peny'
    const fld = 'font-size:13px;padding:6px 9px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;width:100%;box-sizing:border-box'
    const lbl = 'font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px'
    const overlay = document.createElement('div')
    overlay.id = 'prs-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto'
    const field = (label, inner) => `<div><label style="${lbl}">${label}</label>${inner}</div>`
    overlay.innerHTML = `
      <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:560px;box-shadow:var(--shadow-lg)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light)">
          <span style="font-size:15px;font-weight:600">${isNew ? 'New prospect' : 'Edit prospect'}</span>
          <button id="prs-m-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary)">×</button>
        </div>
        <div style="padding:16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${field('Organisation name *', `<input id="m-company" value="${esc(p?.company)}" placeholder="e.g. Severn Valley Joinery" style="${fld}">`)}
          ${field('Sector', `<input id="m-sector" value="${esc(p?.sector)}" placeholder="e.g. Construction" style="${fld}" list="prs-sector-list">`)}
          ${field('Contact first name', `<input id="m-first" value="${esc(p?.first_name)}" style="${fld}">`)}
          ${field('Contact last name', `<input id="m-last" value="${esc(p?.last_name)}" style="${fld}">`)}
          ${field('Tier', `<select id="m-tier" style="${fld}"><option value="">–</option>${['A', 'B', 'C'].map(t => `<option value="${t}"${p?.tier === t ? ' selected' : ''}>${t} — ${TIERS[t].hint}</option>`).join('')}</select>`)}
          ${field('Priority', `<input id="m-priority" type="number" min="0" value="${p?.priority ?? 0}" style="${fld}">`)}
          ${field('Stage', `<select id="m-stage" style="${fld}">${STAGES.map(s => `<option value="${s.id}"${(p?.lifecycle_stage || defaultStage || 'prospect') === s.id ? ' selected' : ''}>${s.label}</option>`).join('')}</select>`)}
          ${field('Owner', `<select id="m-owner" style="${fld}"><option value="">— none —</option>${users.map(u => `<option value="${u.clerk_id}"${p?.owner === u.clerk_id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select>`)}
          ${field('Area / town', `<input id="m-area" value="${esc(p?.area)}" placeholder="e.g. Shrewsbury" style="${fld}">`)}
          ${field('Website', `<input id="m-website" value="${esc(p?.website)}" style="${fld}">`)}
          ${field('Phone', `<input id="m-phone" value="${esc(p?.phone)}" style="${fld}">`)}
          ${field('Email', `<input id="m-email" value="${esc(p?.email)}" style="${fld}">`)}
          ${field('Next action', `<input id="m-next" value="${esc(p?.next_action)}" placeholder="e.g. Intro email" style="${fld}">`)}
          ${field('Next action date', `<input id="m-next-at" type="date" value="${p?.next_action_at || ''}" style="${fld}">`)}
          <div style="grid-column:1/3">${field('Why they fit', `<textarea id="m-fit" rows="2" style="${fld};resize:vertical">${esc(p?.fit_note)}</textarea>`)}</div>
          <div style="grid-column:1/3">${field('Pitch angle', `<textarea id="m-pitch" rows="2" style="${fld};resize:vertical">${esc(p?.pitch_angle)}</textarea>`)}</div>
          <div id="m-brand-field" style="grid-column:1/3;display:${showBrand ? 'block' : 'none'}">${field('Brand *', `<select id="m-brand" style="${fld}"><option value="peny"${cardBrand === 'peny' ? ' selected' : ''}>Peny</option><option value="loop"${cardBrand === 'loop' ? ' selected' : ''}>Loop</option></select>`)}</div>
        </div>
        <div style="display:flex;justify-content:${isNew ? 'flex-end' : 'space-between'};gap:8px;padding:12px 20px;border-top:1px solid var(--border-light)">
          ${isNew ? '' : `<button id="prs-m-delete" style="font-size:12px;color:#ef4444;background:none;border:1px solid #ef444430;border-radius:var(--radius-sm);padding:6px 14px;cursor:pointer;font-family:var(--font)">Delete</button>`}
          <div style="display:flex;gap:8px">
            <button class="btn-cancel" id="prs-m-cancel">Cancel</button>
            <button class="btn-primary" id="prs-m-save">${isNew ? 'Create prospect' : 'Save'}</button>
          </div>
        </div>
      </div>
      <datalist id="prs-sector-list">${[...new Set((this.app.sectorAngles || []).map(a => a.sector).concat(this._prospects().map(p2 => p2.sector)).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>`

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
    overlay.querySelector('#prs-m-close').addEventListener('click', () => overlay.remove())
    overlay.querySelector('#prs-m-cancel').addEventListener('click', () => overlay.remove())
    overlay.querySelector('#prs-m-save').addEventListener('click', () => this._saveModal(overlay, p))
    overlay.querySelector('#prs-m-delete')?.addEventListener('click', () => this._deleteProspect(overlay, p))
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#m-company')?.focus(), 30)
  }

  async _saveModal(overlay, existing) {
    const g = id => overlay.querySelector('#' + id)
    const company = g('m-company').value.trim()
    if (!company) { g('m-company').focus(); this.app.toast('Organisation name is required'); return }
    const data = {
      company,
      first_name: g('m-first').value.trim() || null,
      last_name:  g('m-last').value.trim() || null,
      sector:     g('m-sector').value.trim() || null,
      tier:       g('m-tier').value || null,
      priority:   parseInt(g('m-priority').value) || 0,
      lifecycle_stage: g('m-stage').value || 'prospect',
      owner:      g('m-owner').value || null,
      area:       g('m-area').value.trim() || null,
      website:    g('m-website').value.trim() || null,
      phone:      g('m-phone').value.trim() || null,
      email:      g('m-email').value.trim() || null,
      next_action: g('m-next').value.trim() || null,
      next_action_at: g('m-next-at').value || null,
      fit_note:   g('m-fit').value.trim() || null,
      pitch_angle: g('m-pitch').value.trim() || null,
      brand:      g('m-brand')?.value || this.app.brandForCreate() || 'peny',
    }
    try {
      if (existing) {
        const [updated] = await updateContact(this.app.userId, existing.id, data)
        const idx = this.app.contacts.findIndex(c => c.id === existing.id)
        if (idx >= 0) this.app.contacts[idx] = updated
        this.app.toast('Prospect saved')
      } else {
        const [created] = await createContact(this.app.userId, { ...data, type: 'brand', status: 'Warm' })
        this.app.contacts.unshift(created)
        logActivity(this.app.userId, 'contact', created.id, company, 'Prospect created').catch(() => {})
        this.app.toast('Prospect added')
      }
      overlay.remove()
      // render() reopens the detail panel if a prospect is still selected.
      this.render(document.getElementById('main-content'))
    } catch (e) { console.error(e); this.app.toast('Could not save prospect') }
  }

  async _deleteProspect(overlay, p) {
    if (!await this.app.confirm({ title: `Delete '${this.orgName(p)}'?`, message: 'This removes the record and its outreach log. This cannot be undone.', confirmLabel: 'Delete' })) return
    try {
      const { deleteContact } = await import('../db/client.js')
      await deleteContact(this.app.userId, p.id)
      this.app.contacts = this.app.contacts.filter(c => c.id !== p.id)
      overlay.remove()
      this.closeDetail()
      this.render(document.getElementById('main-content'))
      this.app.toast('Prospect deleted')
    } catch (e) { console.error(e); this.app.toast('Could not delete') }
  }

  // ── Dashboard widget (counts by stage + overdue) ──────────────────────────────
  renderDashboardWidget(host) {
    const active = this._prospects().filter(p => !['won', 'lost'].includes(p.lifecycle_stage))
    if (!active.length && !this._prospects().some(p => p.lifecycle_stage === 'prospect')) return  // nothing to show
    const counts = {}
    STAGES.forEach(s => { counts[s.id] = 0 })
    this._prospects().forEach(p => { counts[p.lifecycle_stage] = (counts[p.lifecycle_stage] || 0) + 1 })
    const overdue = this._prospects().filter(p => !['won', 'lost'].includes(p.lifecycle_stage) && daysUntil(p.next_action_at) !== null && daysUntil(p.next_action_at) <= 0)
    const mineOverdue = overdue.filter(p => this._isMine(p)).length

    const el = document.createElement('div')
    el.className = 'panel'
    el.style.cssText = 'padding:14px 16px;margin-top:16px'
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600">Prospecting pipeline</div>
        <button id="prs-widget-open" style="font-size:11px;background:none;border:1px solid var(--border-med);border-radius:var(--radius-sm);padding:3px 10px;cursor:pointer;color:var(--text-secondary);font-family:var(--font)">Open →</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:${overdue.length ? '12px' : '0'}">
        ${STAGES.filter(s => s.id !== 'lost').map(s => `
          <button class="prs-widget-stage" data-stage="${s.id}" style="flex:1;min-width:76px;text-align:left;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:8px 10px;cursor:pointer;font-family:var(--font)">
            <div style="font-size:20px;font-weight:650;color:var(--text-primary)">${counts[s.id] || 0}</div>
            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;display:flex;align-items:center;gap:4px"><span style="width:6px;height:6px;border-radius:50%;background:${s.color}"></span>${s.label}</div>
          </button>`).join('')}
      </div>
      ${overdue.length ? `
        <button id="prs-widget-overdue" style="width:100%;text-align:left;background:${mineOverdue ? 'var(--danger-subtle)' : 'var(--bg-secondary)'};border:1px solid ${mineOverdue ? 'var(--danger-border)' : 'var(--border-light)'};border-radius:var(--radius-md);padding:8px 12px;cursor:pointer;font-family:var(--font);font-size:12px;color:var(--text-secondary)">
          <span style="font-weight:650;color:${mineOverdue ? 'var(--danger)' : 'var(--text-primary)'}">${overdue.length}</span> next action${overdue.length > 1 ? 's' : ''} overdue or due today${mineOverdue ? ` · <span style="color:var(--danger);font-weight:600">${mineOverdue} yours</span>` : ''}
        </button>` : ''}`

    host.appendChild(el)
    el.querySelector('#prs-widget-open')?.addEventListener('click', () => this.app.navigate('prospects'))
    el.querySelector('#prs-widget-overdue')?.addEventListener('click', () => { this.activeTab = 'queue'; this.app.navigate('prospects') })
    el.querySelectorAll('.prs-widget-stage').forEach(b => b.addEventListener('click', () => {
      this.activeTab = 'list'; this.filters = { tier: '', sector: '', owner: '', stage: b.dataset.stage, priority: '' }
      this.app.navigate('prospects')
    }))
  }
}
