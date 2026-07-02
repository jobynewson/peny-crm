// Marketing view — Kanban board + Social Calendar

const COLUMNS = [
  { id: 'ideas',      label: 'Ideas',           color: '#a78bfa' },
  { id: 'planning',   label: 'Planning',         color: '#4a90d9' },
  { id: 'in-progress',label: 'In Progress',      color: '#f59e0b' },
  { id: 'scheduled',  label: 'Scheduled / Sent', color: '#34d399' },
  { id: 'done',       label: 'Done',             color: '#8590A2' },
]

const CARD_TYPES = [
  { id: 'linkedin',     label: 'LinkedIn',      color: '#0077b5' },
  { id: 'instagram',    label: 'Instagram',     color: '#c13584' },
  { id: 'mailer',       label: 'Mailer',        color: '#4a90d9' },
  { id: 'peny-journal', label: 'Peny Journal',  color: '#f59e0b' },
  { id: 'ad-hoc',       label: 'Ad-hoc',        color: '#8590A2' },
]

const DEFAULT_CHECKLISTS = {
  linkedin:      ['Write copy', 'Design asset', 'Schedule post'],
  instagram:     ['Write caption', 'Design asset', 'Schedule post', 'Add hashtags'],
  mailer:        ['Write copy', 'Design template', 'Segment list', 'Test send', 'Schedule send'],
  'peny-journal':['Write article', 'Source images', 'Review & edit', 'Layout', 'Publish'],
  'ad-hoc':      [],
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)
const MKT_POS_GAP = 1024

export class MarketingView {
  constructor(app) {
    this.app = app
    this.activeTab = 'kanban'
    this.expandedSocialPosts = new Set()
    this.pendingOpenCardId = null
    this._dragCardId = null
  }

  render(mc) {
    const tabs = [
      { id: 'kanban', label: 'Kanban board' },
      { id: 'social', label: 'Social calendar' },
    ]
    mc.innerHTML = `
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border-light);margin-bottom:20px">
        ${tabs.map(t => `
          <button class="mkt-tab${this.activeTab === t.id ? ' mkt-tab--active' : ''}" data-tab="${t.id}"
            style="padding:8px 16px;font-size:13px;font-family:var(--font);cursor:pointer;background:none;border:none;border-bottom:2px solid ${this.activeTab === t.id ? 'var(--accent)' : 'transparent'};color:${this.activeTab === t.id ? 'var(--accent)' : 'var(--text-secondary)'};font-weight:${this.activeTab === t.id ? '600' : '400'};transition:all 0.15s;margin-bottom:-1px">
            ${t.label}
          </button>`).join('')}
      </div>
      <div id="mkt-tab-content"></div>`

    mc.querySelectorAll('.mkt-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab
        this.render(mc)
      })
    })

    const content = mc.querySelector('#mkt-tab-content')
    if (this.activeTab === 'kanban') {
      this.renderKanban(content)
    } else {
      this.renderSocialCalendar(content)
    }

    if (this.pendingOpenCardId) {
      const id = this.pendingOpenCardId
      this.pendingOpenCardId = null
      const card = this.app.marketingCards.find(c => c.id === id)
      if (card) this.openCardModal(card, card.status)
    }
  }

  // ── Kanban board ─────────────────────────────────────────────────────────────

  _marketingCardsFor(colId) {
    return this.app.marketingCards
      .filter(c => c.status === colId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (new Date(b.created_at) - new Date(a.created_at)))
  }

  renderKanban(mc) {
    mc.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;align-items:start;overflow-x:auto;padding-bottom:24px">
        ${COLUMNS.map(col => {
          const colCards = this._marketingCardsFor(col.id)
          return `
          <div class="mkt-col" data-col="${col.id}" style="display:flex;flex-direction:column;gap:8px;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;padding:0 2px;margin-bottom:4px">
              <span style="width:8px;height:8px;border-radius:50%;background:${col.color};flex-shrink:0"></span>
              <span style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.6px;flex:1">${col.label}</span>
              <span style="font-size:11px;color:var(--text-tertiary)">${colCards.length || ''}</span>
            </div>
            <div class="mkt-col-body" data-col-body="${col.id}" style="display:flex;flex-direction:column;gap:8px;min-height:16px">
              ${colCards.map(card => this.renderCard(card)).join('')}
            </div>
            <button class="mkt-add-btn" data-add-col="${col.id}"
              style="width:100%;padding:8px;border:1px dashed var(--border-med);border-radius:var(--radius-md);background:transparent;color:var(--text-tertiary);font-size:12px;cursor:pointer;font-family:var(--font);transition:background 0.1s,color 0.1s;text-align:center">
              + New card
            </button>
          </div>`
        }).join('')}
      </div>`

    mc.querySelectorAll('.mkt-card').forEach(el => {
      el.addEventListener('click', () => {
        const card = this.app.marketingCards.find(c => c.id === el.dataset.cardId)
        if (card) this.openCardModal(card, card.status)
      })
    })

    mc.querySelectorAll('.mkt-add-btn').forEach(btn => {
      btn.addEventListener('click', () => this.openCardModal(null, btn.dataset.addCol))
    })

    this._bindKanbanDnD(mc)
  }

  _bindKanbanDnD(mc) {
    const clearIndicators = () => {
      mc.querySelectorAll('.mkt-card').forEach(c => c.classList.remove('mkt-card--over'))
      mc.querySelectorAll('.mkt-col-body').forEach(z => z.classList.remove('mkt-col-body--over'))
    }

    mc.querySelectorAll('.mkt-card[data-card-id]').forEach(cardEl => {
      cardEl.setAttribute('draggable', 'true')
      cardEl.addEventListener('dragstart', e => {
        e.stopPropagation()
        this._dragCardId = cardEl.dataset.cardId
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', cardEl.dataset.cardId)
        setTimeout(() => cardEl.classList.add('mkt-card--dragging'), 0)
      })
      cardEl.addEventListener('dragend', () => {
        cardEl.classList.remove('mkt-card--dragging')
        clearIndicators()
        this._dragCardId = null
      })
      cardEl.addEventListener('dragover', e => {
        if (!this._dragCardId || cardEl.dataset.cardId === this._dragCardId) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        clearIndicators()
        cardEl.classList.add('mkt-card--over')
      })
      cardEl.addEventListener('dragleave', () => cardEl.classList.remove('mkt-card--over'))
      cardEl.addEventListener('drop', e => {
        e.preventDefault()
        e.stopPropagation()
        clearIndicators()
        if (!this._dragCardId || cardEl.dataset.cardId === this._dragCardId) return
        const zone = cardEl.closest('.mkt-col-body')
        if (zone) this._moveCard(mc, this._dragCardId, zone.dataset.colBody, cardEl.dataset.cardId)
      })
    })

    mc.querySelectorAll('.mkt-col-body').forEach(zone => {
      zone.addEventListener('dragover', e => {
        if (!this._dragCardId) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        clearIndicators()
        zone.classList.add('mkt-col-body--over')
      })
      zone.addEventListener('dragleave', () => zone.classList.remove('mkt-col-body--over'))
      zone.addEventListener('drop', e => {
        e.preventDefault()
        clearIndicators()
        if (!this._dragCardId) return
        this._moveCard(mc, this._dragCardId, zone.dataset.colBody, null)
      })
    })
  }

  // Move a card into destColId, before card `beforeId` (or to the end if null).
  async _moveCard(mc, cardId, destColId, beforeId) {
    const card = this.app.marketingCards.find(c => c.id === cardId)
    if (!card) return
    const dest = this._marketingCardsFor(destColId).filter(c => c.id !== cardId)
    let index = beforeId ? dest.findIndex(c => c.id === beforeId) : dest.length
    if (index < 0) index = dest.length

    const { updateMarketingCard, renumberMarketingCards } = await import('../db/client.js')

    const prev = dest[index - 1], next = dest[index]
    let sort_order
    if (!prev && !next) sort_order = MKT_POS_GAP
    else if (!prev) sort_order = next.sort_order - MKT_POS_GAP
    else if (!next) sort_order = prev.sort_order + MKT_POS_GAP
    else if (next.sort_order - prev.sort_order > 1) sort_order = Math.round((prev.sort_order + next.sort_order) / 2)
    else {
      // Gaps exhausted — renumber the whole destination column
      const ordered = [...dest]
      ordered.splice(index, 0, card)
      const ids = ordered.map(c => c.id)
      ordered.forEach((c, i) => { c.sort_order = (i + 1) * MKT_POS_GAP })
      card.status = destColId
      this.renderKanban(mc)
      try {
        await updateMarketingCard(this.app.userId, card.id, { status: destColId, sort_order: card.sort_order })
        await renumberMarketingCards(this.app.userId, ids)
      } catch (e) { console.error(e); this.app.toast('Error moving card') }
      return
    }

    // Optimistic local move, then persist the single row
    card.status = destColId
    card.sort_order = sort_order
    this.renderKanban(mc)
    try {
      await updateMarketingCard(this.app.userId, card.id, { status: destColId, sort_order })
    } catch (e) { console.error(e); this.app.toast('Error moving card') }
  }

  renderCard(card) {
    const isMyCard = card.lead_owner_id === this.app.clerkUserId
    const typeInfo = CARD_TYPES.find(t => t.id === card.card_type) ?? CARD_TYPES[4]
    const subTasks = Array.isArray(card.sub_tasks) ? card.sub_tasks : []
    const doneCount = subTasks.filter(s => s.done).length
    const mySubTasks = subTasks.filter(s => s.owner_id === this.app.clerkUserId && !s.done)
    const daysUntil = card.due_date ? Math.round((new Date(card.due_date + 'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000) : null
    const duePillColor = daysUntil === null ? '' : daysUntil < 0 ? '#ef4444' : daysUntil === 0 ? '#f59e0b' : '#8590A2'
    const dueLabel = daysUntil === null ? '' : daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : daysUntil === 0 ? 'Today' : fmtDate(card.due_date)

    const leadUser = card.lead_owner_id ? this.app.allUsers.find(u => u.clerk_id === card.lead_owner_id) : null
    const initials = name => (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

    return `
    <div class="mkt-card" data-card-id="${card.id}"
      style="background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:10px 12px;cursor:pointer;transition:box-shadow 0.15s,border-color 0.15s;box-shadow:var(--shadow-sm);${isMyCard ? 'border-left:3px solid var(--accent);' : ''}position:relative">
      <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px">
        <span style="display:inline-flex;font-size:10px;font-weight:600;padding:2px 7px;border-radius:var(--radius-sm);background:${typeInfo.color}18;color:${typeInfo.color};flex-shrink:0;line-height:1.5">${typeInfo.label}</span>
      </div>
      <div style="font-size:13px;font-weight:500;color:var(--text-primary);line-height:1.4;margin-bottom:8px">${esc(card.title)}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${leadUser ? `<span title="${esc(leadUser.name || leadUser.email)}" style="width:20px;height:20px;border-radius:50%;background:#4a90d9;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0">${initials(leadUser.name || leadUser.email)}</span>` : ''}
        ${dueLabel ? `<span style="font-size:10px;color:${duePillColor || 'var(--text-tertiary)'};font-weight:500">${dueLabel}</span>` : ''}
        ${subTasks.length ? `<span style="font-size:10px;color:${doneCount === subTasks.length ? '#22a06b' : 'var(--text-tertiary)'};margin-left:auto">${doneCount}/${subTasks.length}</span>` : ''}
      </div>
      ${mySubTasks.length ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-light);font-size:10px;color:var(--accent)">↳ ${mySubTasks.length} task${mySubTasks.length > 1 ? 's' : ''} assigned to you</div>` : ''}
    </div>`
  }

  // ── Card modal ───────────────────────────────────────────────────────────────

  openCardModal(card, defaultStatus = 'ideas') {
    const existing = document.getElementById('mkt-card-modal')
    if (existing) existing.remove()

    const isNew = !card
    const subTasks = card ? [...(card.sub_tasks || [])] : []
    const cardType = card?.card_type || 'ad-hoc'

    const overlay = document.createElement('div')
    overlay.id = 'mkt-card-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto'

    const renderModal = (localTasks, localType) => {
      const typeInfo = CARD_TYPES.find(t => t.id === localType) ?? CARD_TYPES[4]
      const defaults = DEFAULT_CHECKLISTS[localType] || []
      const hasDefaults = defaults.length > 0
      const allUsers = this.app.allUsers

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:560px;box-shadow:var(--shadow-lg);display:flex;flex-direction:column" onclick="event.stopPropagation()">

          <!-- Header -->
          <div style="display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--border-light)">
            <span style="font-size:11px;font-weight:600;padding:3px 9px;border-radius:var(--radius-sm);background:${typeInfo.color}18;color:${typeInfo.color}">${typeInfo.label}</span>
            <input id="mkt-title" value="${esc(card?.title || '')}" placeholder="Card title…" maxlength="200"
              style="flex:1;border:none;outline:none;font-size:15px;font-weight:600;color:var(--text-primary);background:transparent;font-family:var(--font);min-width:0">
            <button id="mkt-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary);line-height:1;padding:4px 6px">×</button>
          </div>

          <!-- Meta row -->
          <div style="display:flex;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border-light);flex-wrap:wrap">
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px">
              <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Type</label>
              <select id="mkt-type" style="font-size:13px;padding:5px 8px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none">
                ${CARD_TYPES.map(t => `<option value="${t.id}"${(card?.card_type||'ad-hoc') === t.id ? ' selected' : ''}>${t.label}</option>`).join('')}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:140px">
              <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Status</label>
              <select id="mkt-status" style="font-size:13px;padding:5px 8px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none">
                ${COLUMNS.map(c => `<option value="${c.id}"${(card?.status || defaultStatus) === c.id ? ' selected' : ''}>${c.label}</option>`).join('')}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px">
              <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Lead</label>
              <select id="mkt-lead" style="font-size:13px;padding:5px 8px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none">
                <option value="">— No lead —</option>
                ${allUsers.map(u => `<option value="${u.clerk_id}"${card?.lead_owner_id === u.clerk_id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:110px">
              <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Due date</label>
              <input id="mkt-due" type="date" value="${card?.due_date || ''}"
                style="font-size:13px;padding:5px 8px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none">
            </div>
          </div>

          <!-- Notes -->
          <div style="padding:14px 20px;border-bottom:1px solid var(--border-light)">
            <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Notes / Brief</label>
            <textarea id="mkt-notes" rows="3" placeholder="Add notes, brief, or links…"
              style="width:100%;padding:8px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.5;box-sizing:border-box">${esc(card?.notes || '')}</textarea>
          </div>

          <!-- Sub-tasks -->
          <div style="padding:14px 20px;border-bottom:1px solid var(--border-light)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Sub-tasks</label>
              ${hasDefaults && localTasks.length === 0 ? `
                <button id="mkt-load-defaults" style="font-size:11px;color:var(--accent);background:none;border:1px solid var(--border-light);border-radius:var(--radius-sm);padding:3px 10px;cursor:pointer;font-family:var(--font)">Load default checklist</button>
              ` : ''}
            </div>
            <div id="mkt-subtasks-list" style="display:flex;flex-direction:column;gap:6px">
              ${localTasks.map((st, i) => this._renderSubTaskRow(st, i, allUsers)).join('')}
            </div>
            <button id="mkt-add-subtask" style="margin-top:8px;width:100%;padding:7px;border:1px dashed var(--border-med);border-radius:var(--radius-sm);background:transparent;color:var(--text-tertiary);font-size:12px;cursor:pointer;font-family:var(--font)">+ Add sub-task</button>
          </div>

          <!-- Footer -->
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px">
            ${!isNew ? `<button id="mkt-delete" style="font-size:12px;color:#ef4444;background:none;border:1px solid #ef444430;border-radius:var(--radius-sm);padding:6px 14px;cursor:pointer;font-family:var(--font)">Delete card</button>` : '<div></div>'}
            <div style="display:flex;gap:8px">
              <button class="btn-cancel" id="mkt-cancel">Cancel</button>
              <button class="btn-primary" id="mkt-save">Save</button>
            </div>
          </div>
        </div>`

      // Type change → re-render with new type context
      overlay.querySelector('#mkt-type')?.addEventListener('change', e => {
        const newType = e.target.value
        const currentTasks = this._collectSubTasks(overlay)
        renderModal(currentTasks, newType)
      })

      overlay.querySelector('#mkt-load-defaults')?.addEventListener('click', () => {
        const currentType = overlay.querySelector('#mkt-type')?.value || 'ad-hoc'
        const defaults = (DEFAULT_CHECKLISTS[currentType] || []).map(text => ({ id: uuid(), text, owner_id: '', due_date: '', done: false }))
        renderModal(defaults, currentType)
      })

      overlay.querySelector('#mkt-add-subtask')?.addEventListener('click', () => {
        const currentTasks = this._collectSubTasks(overlay)
        currentTasks.push({ id: uuid(), text: '', owner_id: '', due_date: '', done: false })
        const currentType = overlay.querySelector('#mkt-type')?.value || 'ad-hoc'
        renderModal(currentTasks, currentType)
        // Focus the new task text input
        setTimeout(() => {
          const rows = overlay.querySelectorAll('.mkt-st-text')
          rows[rows.length - 1]?.focus()
        }, 30)
      })

      overlay.querySelectorAll('.mkt-st-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx)
          const currentTasks = this._collectSubTasks(overlay)
          currentTasks.splice(idx, 1)
          const currentType = overlay.querySelector('#mkt-type')?.value || 'ad-hoc'
          renderModal(currentTasks, currentType)
        })
      })

      overlay.querySelector('#mkt-close')?.addEventListener('click', () => overlay.remove())
      overlay.querySelector('#mkt-cancel')?.addEventListener('click', () => overlay.remove())

      overlay.querySelector('#mkt-save')?.addEventListener('click', () => this._saveCard(overlay, card, defaultStatus))

      overlay.querySelector('#mkt-delete')?.addEventListener('click', async () => {
        if (!await this.app.confirm({ title: 'Delete this card?', confirmLabel: 'Delete' })) return
        try {
          const { deleteMarketingCard } = await import('../db/client.js')
          await deleteMarketingCard(this.app.userId, card.id)
          this.app.marketingCards = this.app.marketingCards.filter(c => c.id !== card.id)
          overlay.remove()
          this._rerenderKanban()
          this.app.toast('Card deleted')
        } catch (e) { console.error(e); this.app.toast('Error deleting card') }
      })

      // Enter key on title → focus notes
      overlay.querySelector('#mkt-title')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); overlay.querySelector('#mkt-notes')?.focus() }
      })
    }

    renderModal(subTasks, cardType)

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#mkt-title')?.focus(), 30)
  }

  _renderSubTaskRow(st, i, allUsers) {
    return `
    <div class="mkt-st-row" data-idx="${i}" style="display:flex;align-items:center;gap:6px">
      <input type="checkbox" class="mkt-st-done" data-idx="${i}" ${st.done ? 'checked' : ''}
        style="flex-shrink:0;cursor:pointer;accent-color:var(--accent)">
      <input class="mkt-st-text" data-idx="${i}" value="${esc(st.text)}" placeholder="Sub-task…"
        style="flex:1;min-width:0;font-size:13px;padding:5px 8px;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;${st.done ? 'text-decoration:line-through;opacity:0.5;' : ''}">
      <select class="mkt-st-owner" data-idx="${i}"
        style="font-size:11px;padding:4px 6px;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-secondary);font-family:var(--font);outline:none;max-width:110px">
        <option value="">Owner</option>
        ${allUsers.map(u => `<option value="${u.clerk_id}"${st.owner_id === u.clerk_id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
      </select>
      <input type="date" class="mkt-st-due" data-idx="${i}" value="${st.due_date || ''}"
        style="font-size:11px;padding:4px 6px;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-secondary);font-family:var(--font);outline:none;width:120px">
      <button class="mkt-st-del" data-idx="${i}"
        style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:14px;line-height:1;padding:2px 4px;opacity:0.6">×</button>
    </div>`
  }

  _collectSubTasks(overlay) {
    const rows = overlay.querySelectorAll('.mkt-st-row')
    return Array.from(rows).map((row, i) => {
      const idx = parseInt(row.dataset.idx)
      const text = row.querySelector('.mkt-st-text')?.value?.trim() || ''
      const owner_id = row.querySelector('.mkt-st-owner')?.value || ''
      const due_date = row.querySelector('.mkt-st-due')?.value || ''
      const done = row.querySelector('.mkt-st-done')?.checked || false
      // preserve existing id if possible
      return { id: uuid(), text, owner_id, due_date, done }
    })
  }

  async _saveCard(overlay, existingCard, defaultStatus) {
    const title = overlay.querySelector('#mkt-title')?.value?.trim()
    if (!title) { overlay.querySelector('#mkt-title')?.focus(); return }

    const data = {
      title,
      card_type:     overlay.querySelector('#mkt-type')?.value || 'ad-hoc',
      status:        overlay.querySelector('#mkt-status')?.value || defaultStatus,
      lead_owner_id: overlay.querySelector('#mkt-lead')?.value || null,
      due_date:      overlay.querySelector('#mkt-due')?.value || null,
      notes:         overlay.querySelector('#mkt-notes')?.value?.trim() || null,
      sub_tasks:     this._collectSubTasks(overlay).filter(s => s.text),
    }

    try {
      const { createMarketingCard, updateMarketingCard } = await import('../db/client.js')
      if (existingCard) {
        const updated = await updateMarketingCard(this.app.userId, existingCard.id, data)
        const idx = this.app.marketingCards.findIndex(c => c.id === existingCard.id)
        if (idx !== -1) this.app.marketingCards[idx] = updated
      } else {
        const created = await createMarketingCard(this.app.userId, data)
        this.app.marketingCards = [created, ...this.app.marketingCards]
      }
      overlay.remove()
      this._rerenderKanban()
      this.app.toast(existingCard ? 'Card saved' : 'Card created')
    } catch (e) { console.error(e); this.app.toast('Error saving card') }
  }

  _rerenderKanban() {
    const mc = document.getElementById('mkt-tab-content')
    if (mc && this.activeTab === 'kanban') this.renderKanban(mc)
  }

  // ── Social calendar (moved from dashboard) ───────────────────────────────────

  renderSocialCalendar(mc) {
    const esc2 = esc
    const posts = this.app.socialPosts || []
    if (!this.expandedSocialPosts) this.expandedSocialPosts = new Set()

    mc.innerHTML = `
      <div style="max-width:500px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:#34d399;flex-shrink:0"></span>
            <span style="font-size:13px;font-weight:600;color:var(--text-primary)">Social calendar</span>
            ${posts.filter(p => !p.completed).length ? `<span style="font-size:11px;background:var(--bg-secondary);border:0.5px solid var(--border-med);border-radius:10px;padding:1px 7px;color:var(--text-secondary)">${posts.filter(p => !p.completed).length}</span>` : ''}
          </div>
          <button id="social-add-btn" style="font-size:11px;padding:3px 10px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer;font-family:var(--font)">+ Add</button>
        </div>

        <div id="social-add-form" style="display:none;background:var(--bg-secondary);border:0.5px solid var(--border-med);border-radius:var(--radius-md);padding:12px;margin-bottom:12px">
          <input id="social-new-title" type="text" placeholder="Project / topic name" maxlength="200"
            style="width:100%;padding:7px 10px;font-size:13px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;margin-bottom:8px;box-sizing:border-box">
          <textarea id="social-new-notes" placeholder="Notes (optional)" rows="2"
            style="width:100%;padding:7px 10px;font-size:12px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.4;margin-bottom:8px;box-sizing:border-box"></textarea>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn-cancel" id="social-add-cancel" style="font-size:12px">Cancel</button>
            <button class="btn-primary" id="social-add-save" style="font-size:12px">Add</button>
          </div>
        </div>

        <div id="social-post-list" style="display:flex;flex-direction:column;gap:6px">
          ${(() => {
            const active = posts.filter(p => !p.completed)
            const done   = posts.filter(p => p.completed)
            const renderPost = (p) => {
              const isOpen = this.expandedSocialPosts.has(p.id)
              return `
              <div class="social-post-row" data-social-id="${p.id}" style="background:var(--bg-secondary);border:0.5px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden;${p.completed ? 'opacity:0.45;' : ''}">
                <div style="display:flex;align-items:center;gap:8px;padding:8px 10px">
                  <input type="checkbox" class="social-check" data-social-id="${p.id}" ${p.completed ? 'checked' : ''}
                    style="flex-shrink:0;cursor:pointer;accent-color:#34d399">
                  <input class="social-title-input" data-social-id="${p.id}" value="${esc2(p.title)}" placeholder="Title"
                    style="flex:1;min-width:0;background:transparent;border:none;outline:none;font-size:13px;font-weight:500;font-family:var(--font);padding:0;line-height:1.3;${p.completed ? 'text-decoration:line-through;color:var(--text-tertiary)' : 'color:var(--text-primary)'}">
                  <button class="social-toggle-btn" data-social-id="${p.id}"
                    style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:13px;line-height:1;padding:0 2px;opacity:0.55">${isOpen ? '▾' : '▸'}</button>
                </div>
                <div class="social-post-body" data-social-id="${p.id}" style="display:${isOpen ? 'block' : 'none'};padding:0 10px 10px 28px">
                  <textarea class="social-notes-input" data-social-id="${p.id}" placeholder="Add notes…" rows="2"
                    style="width:100%;background:transparent;border:none;outline:none;font-size:11px;color:var(--text-tertiary);font-family:var(--font);resize:none;padding:0;line-height:1.4;overflow:hidden;box-sizing:border-box;margin-bottom:6px">${esc2(p.notes || '')}</textarea>
                  <div style="display:flex;justify-content:flex-end">
                    <button class="social-delete-btn" data-social-id="${p.id}"
                      style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:11px;line-height:1;padding:0;opacity:0.5">Delete</button>
                  </div>
                </div>
              </div>`
            }
            if (!active.length && !done.length) {
              return `<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">No post ideas yet. Hit + Add to get started.</div>`
            }
            return active.map(renderPost).join('') + done.map(renderPost).join('')
          })()}
        </div>
      </div>`

    this._bindSocialCalendar(mc)
  }

  _bindSocialCalendar(mc) {
    mc.querySelector('#social-add-btn')?.addEventListener('click', () => {
      const form = mc.querySelector('#social-add-form')
      if (!form) return
      form.style.display = form.style.display === 'none' ? 'block' : 'none'
      if (form.style.display === 'block') mc.querySelector('#social-new-title')?.focus()
    })
    mc.querySelector('#social-add-cancel')?.addEventListener('click', () => {
      mc.querySelector('#social-add-form').style.display = 'none'
      mc.querySelector('#social-new-title').value = ''
      mc.querySelector('#social-new-notes').value = ''
    })
    mc.querySelector('#social-add-save')?.addEventListener('click', async () => {
      const titleEl = mc.querySelector('#social-new-title')
      const notesEl = mc.querySelector('#social-new-notes')
      const title = titleEl.value.trim()
      if (!title) { titleEl.focus(); return }
      try {
        const { createSocialPost } = await import('../db/client.js')
        const post = await createSocialPost(this.app.userId, { title, notes: notesEl.value.trim() || null })
        this.app.socialPosts = [post, ...this.app.socialPosts]
        this.renderSocialCalendar(mc)
      } catch (e) { console.error(e); this.app.toast('Error saving post') }
    })
    mc.querySelectorAll('.social-check').forEach(cb => {
      cb.addEventListener('change', async () => {
        const id = cb.dataset.socialId
        try {
          const { updateSocialPost } = await import('../db/client.js')
          await updateSocialPost(this.app.userId, id, { completed: cb.checked })
          const post = this.app.socialPosts.find(p => p.id === id)
          if (post) post.completed = cb.checked
          this.renderSocialCalendar(mc)
        } catch (e) { console.error(e) }
      })
    })
    mc.querySelectorAll('.social-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.socialId
        if (this.expandedSocialPosts.has(id)) this.expandedSocialPosts.delete(id)
        else this.expandedSocialPosts.add(id)
        this.renderSocialCalendar(mc)
      })
    })
    mc.querySelectorAll('.social-title-input').forEach(input => {
      input.addEventListener('blur', async () => {
        const id = input.dataset.socialId
        const title = input.value.trim()
        const post = this.app.socialPosts.find(p => p.id === id)
        if (!title) { input.value = post?.title || ''; return }
        if (title === post?.title) return
        try {
          const { updateSocialPost } = await import('../db/client.js')
          await updateSocialPost(this.app.userId, id, { title })
          if (post) post.title = title
        } catch (e) { console.error(e) }
      })
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur() } })
    })
    mc.querySelectorAll('.social-notes-input').forEach(ta => {
      ta.addEventListener('blur', async () => {
        const id = ta.dataset.socialId
        const notes = ta.value.trim() || null
        const post = this.app.socialPosts.find(p => p.id === id)
        if (notes === (post?.notes || null)) return
        try {
          const { updateSocialPost } = await import('../db/client.js')
          await updateSocialPost(this.app.userId, id, { notes })
          if (post) post.notes = notes
        } catch (e) { console.error(e) }
      })
    })
    mc.querySelectorAll('.social-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.socialId
        if (!await this.app.confirm({ title: 'Delete post idea?', confirmLabel: 'Delete' })) return
        try {
          const { deleteSocialPost } = await import('../db/client.js')
          await deleteSocialPost(this.app.userId, id)
          this.app.socialPosts = this.app.socialPosts.filter(p => p.id !== id)
          this.renderSocialCalendar(mc)
        } catch (e) { console.error(e); this.app.toast('Error deleting post') }
      })
    })
  }
}
