// src/views/boards.js
// Planning boards — kanban with draggable cards/columns, recurring cards,
// entity link chips, and near-realtime sync (short-interval polling of
// granular rows; remote merges pause while you drag or type).

import {
  getBoards, createBoard, updateBoard, deleteBoard, getBoardData, getBoardForProject,
  createBoardColumn, updateBoardColumn, deleteBoardColumn,
  createBoardCard, updateBoardCard, deleteBoardCard, renumberBoardColumn,
  getBoardRecurrences, createBoardRecurrence, updateBoardRecurrence, deleteBoardRecurrence,
  spawnDueBoardRecurrences, getBoardsDashboard,
} from '../db/client.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
const dateKey = d => (d instanceof Date) ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10)

const LABEL_COLORS = ['#4a90d9', '#6ec96e', '#f59e0b', '#ef4444', '#a78bfa', '#06b6d4', '#ec4899']
const COLUMN_COLORS = ['#8590A2', '#4a90d9', '#6ec96e', '#f59e0b', '#ef4444', '#a78bfa', '#06b6d4', '#ec4899']
const POS_GAP = 1024
const POLL_MS = 4000

const LINK_TYPES = [
  { id: 'client',  label: 'Client',  icon: '👤', color: '#a78bfa' },
  { id: 'project', label: 'Project', icon: '🎬', color: '#4a90d9' },
  { id: 'budget',  label: 'Budget',  icon: '£',  color: '#6ec96e' },
]

const inputStyle = 'font-size:13px;padding:6px 9px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none'
const labelStyle = 'font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px'

export class BoardsView {
  constructor(app) {
    this.app = app
    this.currentId = null
    this.board = null
    this.columns = []
    this.cards = []
    this._boards = null          // standalone list cache
    this._pollTimer = null
    this._snapshot = null        // last known board state (server-stable fields only)
    this._dragCardId = null
    this._dragColId = null
    this._writes = 0             // in-flight write count — polling pauses while > 0
  }

  get canEdit() { return this.app.permissions?.projects_edit !== false }

  // ── Standalone entry ─────────────────────────────────────────────────────────

  render(mc) {
    this._stopPolling()
    if (this.currentId) this._loadAndRenderBoard(mc)
    else this._renderList(mc)
  }

  // ── Boards list ──────────────────────────────────────────────────────────────

  async _renderList(mc) {
    mc.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading boards…</div>'
    try {
      // Spawn any due recurring cards first so counts/lists are fresh
      spawnDueBoardRecurrences(this.app.userId).catch(e => console.warn('Recurrence spawn failed:', e))
      this._boards = await getBoards(this.app.userId)
    } catch (e) {
      console.error(e)
      mc.innerHTML = '<div class="empty-state" style="padding-top:60px">Could not load boards.</div>'
      return
    }
    const boards = this._boards

    if (!boards.length) {
      mc.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:50vh;gap:14px;text-align:center">
          <div style="font-size:36px">🗂</div>
          <div style="font-size:16px;font-weight:500">No boards yet</div>
          <div style="font-size:13px;color:var(--text-tertiary);max-width:340px;line-height:1.6">Boards organise work into columns of cards — use them standalone or linked to a project's Planning tab.</div>
          ${this.canEdit ? '<button class="btn-primary" id="bd-empty-new" style="margin-top:4px">+ Create first board</button>' : ''}
        </div>`
      mc.querySelector('#bd-empty-new')?.addEventListener('click', () => this.openNewBoardModal())
      return
    }

    mc.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;max-width:680px">
        ${boards.map(b => {
          const proj = b.project_id ? this.app.projects.find(p => p.id === b.project_id) : null
          return `
          <div class="bd-list-row" data-board-id="${b.id}">
            <span style="font-size:15px;flex-shrink:0">🗂</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:550;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.name)}</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px">
                ${proj ? `Linked to ${esc(proj.name)}` : 'Standalone'}
              </div>
            </div>
            <span style="font-size:11px;color:var(--text-tertiary);flex-shrink:0">${new Date(b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>`
        }).join('')}
      </div>`

    mc.querySelectorAll('[data-board-id]').forEach(row => {
      row.addEventListener('click', () => this.openBoard(row.dataset.boardId))
    })
  }

  openBoard(id) {
    this.currentId = id
    this.app._pushAppState(`#planning/${id}`, { view: 'planning', id })
    this.app.render()
  }

  openNewBoardModal(projectId = null) {
    document.getElementById('bd-new-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'bd-new-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'
    overlay.innerHTML = `
      <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:380px;padding:20px" onclick="event.stopPropagation()">
        <div style="font-size:14px;font-weight:600;margin-bottom:14px">New board</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input id="bd-new-name" placeholder="Board name…" maxlength="120" style="${inputStyle}">
          ${projectId ? '' : `
          <select id="bd-new-project" style="${inputStyle}">
            <option value="">Standalone (no project)</option>
            ${this.app.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select>`}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button class="btn-cancel" id="bd-new-cancel">Cancel</button>
          <button class="btn-primary" id="bd-new-save">Create board</button>
        </div>
      </div>`
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    const nameEl = overlay.querySelector('#bd-new-name')
    setTimeout(() => nameEl?.focus(), 10)

    const save = async () => {
      const name = nameEl?.value.trim()
      if (!name) { nameEl?.focus(); return }
      const project_id = projectId || overlay.querySelector('#bd-new-project')?.value || null
      try {
        const board = await createBoard(this.app.userId, { name, project_id })
        this._boards = null   // list cache is stale now
        overlay.remove()
        this.app.toast('Board created')
        if (this.app.currentView === 'planning') this.openBoard(board.id)
        else this.app.render()   // refresh embedded contexts
      } catch (e) { console.error(e); this.app.toast('Error creating board') }
    }
    overlay.querySelector('#bd-new-cancel')?.addEventListener('click', () => overlay.remove())
    overlay.querySelector('#bd-new-save')?.addEventListener('click', save)
    nameEl?.addEventListener('keydown', e => { if (e.key === 'Enter') save() })
  }

  // ── Board (standalone) ───────────────────────────────────────────────────────

  async _loadAndRenderBoard(mc) {
    mc.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading board…</div>'
    try {
      spawnDueBoardRecurrences(this.app.userId).catch(e => console.warn('Recurrence spawn failed:', e))
      const all = this._boards ?? await getBoards(this.app.userId)
      this._boards = all
      this.board = all.find(b => b.id === this.currentId) ?? null
      if (!this.board) {
        mc.innerHTML = '<div class="empty-state" style="padding-top:60px">Board not found.</div>'
        return
      }
      const { columns, cards } = await getBoardData(this.currentId)
      this.columns = columns
      this.cards = cards
      this._snapshot = this._serialize(columns, cards)
      this.app.updateTitle()   // board name arrives after first paint
    } catch (e) {
      console.error(e)
      mc.innerHTML = '<div class="empty-state" style="padding-top:60px">Could not load board.</div>'
      return
    }

    const proj = this.board.project_id ? this.app.projects.find(p => p.id === this.board.project_id) : null
    mc.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn-cancel" id="bd-back" style="font-size:12px">← All boards</button>
        <input id="bd-board-name" value="${esc(this.board.name)}" maxlength="120" ${this.canEdit ? '' : 'disabled'}
          style="flex:1;min-width:140px;font-size:15px;font-weight:600;background:transparent;border:none;outline:none;color:var(--text-primary);font-family:var(--font)">
        ${this.canEdit ? `
          <select id="bd-board-project" title="Link to project" style="${inputStyle};max-width:180px">
            <option value="">Standalone</option>
            ${this.app.projects.map(p => `<option value="${p.id}"${this.board.project_id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
          <button class="btn-cancel" id="bd-recurring" style="font-size:12px">↻ Recurring</button>
          <button class="btn-cancel" id="bd-delete-board" style="font-size:12px;color:#e07070">Delete</button>
        ` : (proj ? `<span style="font-size:11px;color:var(--text-tertiary)">Linked to ${esc(proj.name)}</span>` : '')}
      </div>
      <div id="bd-board-wrap"></div>`

    mc.querySelector('#bd-back')?.addEventListener('click', () => {
      this.currentId = null; this.board = null
      this.app._pushAppState('#planning', { view: 'planning' })
      this.app.render()
    })
    mc.querySelector('#bd-board-name')?.addEventListener('change', async e => {
      const name = e.target.value.trim()
      if (!name) { e.target.value = this.board.name; return }
      try { await updateBoard(this.app.userId, this.board.id, { name }); this.board.name = name } catch (err) { console.error(err) }
    })
    mc.querySelector('#bd-board-project')?.addEventListener('change', async e => {
      try {
        await updateBoard(this.app.userId, this.board.id, { project_id: e.target.value || null })
        this.board.project_id = e.target.value || null
        this.app.toast(this.board.project_id ? 'Board linked to project' : 'Board unlinked')
      } catch (err) { console.error(err); this.app.toast('Error linking board') }
    })
    mc.querySelector('#bd-recurring')?.addEventListener('click', () => this.openRecurrencesModal())
    mc.querySelector('#bd-delete-board')?.addEventListener('click', async () => {
      const ok = await this.app.confirm({ title: 'Delete this board?', message: 'All columns, cards and recurring schedules on it will be deleted.', confirmLabel: 'Delete board' })
      if (!ok) return
      try {
        await deleteBoard(this.app.userId, this.board.id)
        this._boards = null; this.currentId = null; this.board = null
        this.app.toast('Board deleted')
        this.app._pushAppState('#planning', { view: 'planning' })
        this.app.render()
      } catch (e) { console.error(e); this.app.toast('Error deleting board') }
    })

    const wrap = mc.querySelector('#bd-board-wrap')
    this._renderBoardBody(wrap)
    this._startPolling(wrap)
  }

  // ── Board (embedded in a project's Planning tab) ─────────────────────────────

  async renderEmbedded(container, project) {
    this._stopPolling()
    container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Loading board…</div>'
    let board
    try {
      spawnDueBoardRecurrences(this.app.userId).catch(e => console.warn('Recurrence spawn failed:', e))
      board = await getBoardForProject(this.app.userId, project.id)
    } catch (e) {
      console.error(e)
      container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Could not load board.</div>'
      return
    }

    if (!board) {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 0;text-align:center">
          <div style="font-size:32px">🗂</div>
          <div style="font-size:14px;font-weight:500">No board for this project yet</div>
          <div style="font-size:12px;color:var(--text-tertiary);max-width:320px;line-height:1.6">A board organises this project's work into columns of cards everyone can see and move.</div>
          ${this.canEdit ? '<button class="btn-primary" id="bd-emb-create" style="margin-top:2px">+ Create board</button>' : ''}
        </div>`
      container.querySelector('#bd-emb-create')?.addEventListener('click', async () => {
        try {
          await createBoard(this.app.userId, { name: project.name, project_id: project.id })
          this._boards = null
          this.renderEmbedded(container, project)
        } catch (e) { console.error(e); this.app.toast('Error creating board') }
      })
      return
    }

    this.board = board
    this.currentId = board.id
    try {
      const { columns, cards } = await getBoardData(board.id)
      this.columns = columns
      this.cards = cards
      this._snapshot = this._serialize(columns, cards)
    } catch (e) {
      console.error(e)
      container.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">Could not load board.</div>'
      return
    }

    container.innerHTML = `
      ${this.canEdit ? `
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px">
        <button class="btn-cancel" id="bd-recurring" style="font-size:12px">↻ Recurring</button>
        <button class="btn-cancel" id="bd-open-standalone" style="font-size:12px">Open full view</button>
      </div>` : ''}
      <div id="bd-board-wrap"></div>`
    container.querySelector('#bd-recurring')?.addEventListener('click', () => this.openRecurrencesModal())
    container.querySelector('#bd-open-standalone')?.addEventListener('click', () => {
      this.app.currentView = 'planning'
      this.app._pushAppState(`#planning/${board.id}`, { view: 'planning', id: board.id })
      this.app.render()
    })

    const wrap = container.querySelector('#bd-board-wrap')
    this._renderBoardBody(wrap)
    this._startPolling(wrap)
  }

  // ── Board body (shared) ──────────────────────────────────────────────────────

  _cardsFor(colId) {
    return this.cards
      .filter(c => c.column_id === colId)
      .sort((a, b) => (a.position - b.position) || (new Date(a.created_at) - new Date(b.created_at)))
  }

  _renderBoardBody(wrap) {
    if (!wrap) return
    const cols = [...this.columns].sort((a, b) => (a.sort_order - b.sort_order) || (new Date(a.created_at) - new Date(b.created_at)))
    wrap.innerHTML = `
      <div class="bd-board" id="bd-board">
        ${cols.map(col => {
          const colCards = this._cardsFor(col.id)
          return `
          <div class="bd-col" data-col="${col.id}">
            <div class="bd-col-head" data-col-head="${col.id}" ${this.canEdit ? 'draggable="true"' : ''}>
              <span class="bd-col-dot" style="background:${esc(col.color)}"></span>
              <span class="bd-col-name">${esc(col.name)}</span>
              <span class="bd-col-count">${colCards.length || ''}</span>
              ${this.canEdit ? `<button class="bd-col-edit" data-col-edit="${col.id}" title="Edit column">⋯</button>` : ''}
            </div>
            <div class="bd-col-cards" data-col-cards="${col.id}">
              ${colCards.map(c => this._renderCard(c)).join('')}
            </div>
            ${this.canEdit ? `<button class="bd-add-card" data-add-card="${col.id}">+ Add card</button>` : ''}
          </div>`
        }).join('')}
        ${this.canEdit ? '<button class="bd-add-col" id="bd-add-col">+ Column</button>' : ''}
      </div>`
    this._bindBoardBody(wrap)
  }

  _renderCard(card) {
    const labels = Array.isArray(card.labels) ? card.labels : []
    const links = Array.isArray(card.links) ? card.links : []
    const assignee = card.assignee_id ? this.app.allUsers.find(u => u.id === card.assignee_id) : null
    const initials = name => (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

    let duePill = ''
    if (card.due_date) {
      const days = Math.round((new Date(dateKey(card.due_date) + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 86400000)
      const color = days < 0 ? '#ef4444' : days === 0 ? '#f59e0b' : 'var(--text-tertiary)'
      const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : fmtDate(card.due_date)
      duePill = `<span style="font-size:10px;font-weight:500;color:${color}">${label}</span>`
    }

    return `
    <div class="bd-card" data-card="${card.id}" ${this.canEdit ? 'draggable="true"' : ''}>
      ${labels.length ? `<div class="bd-card-labels">${labels.map(l => `<span class="bd-label-pill" style="background:${esc(l.color)}" title="${esc(l.name || '')}">${l.name ? esc(l.name) : ''}</span>`).join('')}</div>` : ''}
      <div class="bd-card-title">${esc(card.title)}</div>
      ${links.length ? `<div class="bd-card-chips">${links.map(l => this._renderChip(l)).join('')}</div>` : ''}
      ${(assignee || duePill || card.spawned_from || card.description) ? `
      <div class="bd-card-meta">
        ${assignee ? `<span class="bd-avatar" title="${esc(assignee.name || assignee.email)}">${initials(assignee.name || assignee.email)}</span>` : ''}
        ${duePill}
        ${card.spawned_from ? '<span title="Created by a recurring schedule" style="font-size:10px;color:var(--text-tertiary)">↻</span>' : ''}
        ${card.description ? '<span title="Has description" style="font-size:10px;color:var(--text-tertiary);margin-left:auto">≡</span>' : ''}
      </div>` : ''}
    </div>`
  }

  _renderChip(link) {
    const t = LINK_TYPES.find(x => x.id === link.type)
    if (!t) return ''
    const name = this._entityName(link.type, link.id)
    if (!name) return ''
    return `<span class="bd-chip" data-chip-type="${link.type}" data-chip-id="${link.id}" style="color:${t.color};background:${t.color}1a">${t.icon} ${esc(name)}</span>`
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

  _navigateChip(type, id) {
    if (type === 'project') this.app.openProject(id)
    else if (type === 'budget') this.app.openBudget(id)
    else if (type === 'client') {
      this.app.navigate('contacts')
      setTimeout(() => this.app.contactsView.selectContact(id), 50)
    }
  }

  // ── Bindings (clicks + drag-and-drop) ────────────────────────────────────────

  _bindBoardBody(wrap) {
    // Card open
    wrap.querySelectorAll('.bd-card').forEach(el => {
      el.addEventListener('click', () => {
        const card = this.cards.find(c => c.id === el.dataset.card)
        if (card) this.openCardModal(wrap, card)
      })
    })
    // Entity chips navigate
    wrap.querySelectorAll('.bd-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        e.stopPropagation()
        this._navigateChip(chip.dataset.chipType, chip.dataset.chipId)
      })
    })
    // Add card / column / edit column
    wrap.querySelectorAll('[data-add-card]').forEach(btn => {
      btn.addEventListener('click', () => this.openCardModal(wrap, null, btn.dataset.addCard))
    })
    wrap.querySelector('#bd-add-col')?.addEventListener('click', () => this.openColumnModal(wrap, null))
    wrap.querySelectorAll('[data-col-edit]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const col = this.columns.find(c => c.id === btn.dataset.colEdit)
        if (col) this.openColumnModal(wrap, col)
      })
    })

    if (!this.canEdit) return

    // ── Card drag-and-drop (story-planner pattern) ──
    const clearIndicators = () => {
      wrap.querySelectorAll('.bd-card').forEach(c => c.classList.remove('bd-card--over'))
      wrap.querySelectorAll('.bd-col-cards').forEach(z => z.classList.remove('bd-col-cards--over'))
      wrap.querySelectorAll('.bd-col-head').forEach(h => h.classList.remove('bd-col-head--over'))
    }

    wrap.querySelectorAll('.bd-card').forEach(cardEl => {
      cardEl.addEventListener('dragstart', e => {
        e.stopPropagation()
        this._dragCardId = cardEl.dataset.card
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', cardEl.dataset.card)
        setTimeout(() => cardEl.classList.add('bd-card--dragging'), 0)
      })
      cardEl.addEventListener('dragend', () => {
        cardEl.classList.remove('bd-card--dragging')
        clearIndicators()
        this._dragCardId = null
      })
      cardEl.addEventListener('dragover', e => {
        if (!this._dragCardId || cardEl.dataset.card === this._dragCardId) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        clearIndicators()
        cardEl.classList.add('bd-card--over')
      })
      cardEl.addEventListener('dragleave', () => cardEl.classList.remove('bd-card--over'))
      cardEl.addEventListener('drop', e => {
        e.preventDefault()
        e.stopPropagation()
        clearIndicators()
        if (!this._dragCardId || cardEl.dataset.card === this._dragCardId) return
        const destColId = cardEl.closest('.bd-col-cards')?.dataset.colCards
        if (destColId) this._moveCard(wrap, this._dragCardId, destColId, cardEl.dataset.card)
      })
    })

    // Drop on a column's card area (empty space / end of list)
    wrap.querySelectorAll('.bd-col-cards').forEach(zone => {
      zone.addEventListener('dragover', e => {
        if (!this._dragCardId) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        clearIndicators()
        zone.classList.add('bd-col-cards--over')
      })
      zone.addEventListener('dragleave', () => zone.classList.remove('bd-col-cards--over'))
      zone.addEventListener('drop', e => {
        e.preventDefault()
        clearIndicators()
        if (!this._dragCardId) return
        this._moveCard(wrap, this._dragCardId, zone.dataset.colCards, null)
      })
    })

    // ── Column reorder (drag the column header) ──
    wrap.querySelectorAll('.bd-col-head').forEach(head => {
      head.addEventListener('dragstart', e => {
        this._dragColId = head.dataset.colHead
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', head.dataset.colHead)
      })
      head.addEventListener('dragend', () => { this._dragColId = null; clearIndicators() })
      head.addEventListener('dragover', e => {
        if (!this._dragColId || this._dragColId === head.dataset.colHead) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        clearIndicators()
        head.classList.add('bd-col-head--over')
      })
      head.addEventListener('dragleave', () => head.classList.remove('bd-col-head--over'))
      head.addEventListener('drop', e => {
        e.preventDefault()
        clearIndicators()
        if (!this._dragColId || this._dragColId === head.dataset.colHead) return
        this._moveColumn(wrap, this._dragColId, head.dataset.colHead)
      })
    })
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  // Move a card into destColId, before card `beforeId` (or to the end if null).
  async _moveCard(wrap, cardId, destColId, beforeId) {
    const card = this.cards.find(c => c.id === cardId)
    if (!card) return
    const dest = this._cardsFor(destColId).filter(c => c.id !== cardId)
    let index = beforeId ? dest.findIndex(c => c.id === beforeId) : dest.length
    if (index < 0) index = dest.length

    const prev = dest[index - 1], next = dest[index]
    let position
    if (!prev && !next) position = POS_GAP
    else if (!prev) position = next.position - POS_GAP
    else if (!next) position = prev.position + POS_GAP
    else if (next.position - prev.position > 1e-6) position = (prev.position + next.position) / 2
    else {
      // Gaps exhausted — renumber the whole destination column
      const ordered = [...dest]
      ordered.splice(index, 0, card)
      const ids = ordered.map(c => c.id)
      ordered.forEach((c, i) => { c.position = (i + 1) * 1024 })
      card.column_id = destColId
      this._renderBoardBody(wrap)
      this._writes++
      try {
        await updateBoardCard(card.id, { column_id: destColId, position: card.position })
        await renumberBoardColumn(destColId, ids)
        this._snapshot = this._serialize(this.columns, this.cards)
      } catch (e) { console.error(e); this.app.toast('Error moving card') }
      finally { this._writes-- }
      return
    }

    // Optimistic local move, then persist the single row
    card.column_id = destColId
    card.position = position
    this._renderBoardBody(wrap)
    this._writes++
    try {
      await updateBoardCard(card.id, { column_id: destColId, position })
      this._snapshot = this._serialize(this.columns, this.cards)
    } catch (e) { console.error(e); this.app.toast('Error moving card') }
    finally { this._writes-- }
  }

  async _moveColumn(wrap, colId, beforeColId) {
    const ordered = [...this.columns].sort((a, b) => (a.sort_order - b.sort_order) || (new Date(a.created_at) - new Date(b.created_at)))
    const fromIdx = ordered.findIndex(c => c.id === colId)
    let toIdx = ordered.findIndex(c => c.id === beforeColId)
    if (fromIdx === -1 || toIdx === -1) return
    const [moved] = ordered.splice(fromIdx, 1)
    ordered.splice(toIdx, 0, moved)
    ordered.forEach((c, i) => { c.sort_order = i })
    this._renderBoardBody(wrap)
    this._writes++
    try {
      for (let i = 0; i < ordered.length; i++) await updateBoardColumn(ordered[i].id, { sort_order: i })
      this._snapshot = this._serialize(this.columns, this.cards)
    } catch (e) { console.error(e); this.app.toast('Error reordering columns') }
    finally { this._writes-- }
  }

  // ── Card modal ───────────────────────────────────────────────────────────────

  openCardModal(wrap, card, defaultColId = null) {
    document.getElementById('bd-card-modal')?.remove()
    const isNew = !card
    const readonly = !this.canEdit
    let labels = card ? (Array.isArray(card.labels) ? card.labels.map(l => ({ ...l })) : []) : []
    let links = card ? (Array.isArray(card.links) ? card.links.map(l => ({ ...l })) : []) : []

    const overlay = document.createElement('div')
    overlay.id = 'bd-card-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto'

    const cols = [...this.columns].sort((a, b) => a.sort_order - b.sort_order)
    const allUsers = this.app.allUsers || []
    const dis = readonly ? 'disabled' : ''

    const linkOptions = type => {
      if (type === 'client') return this.app.contacts.map(c => `<option value="${c.id}">${esc(`${c.first_name} ${c.last_name}`.trim())}</option>`).join('')
      if (type === 'project') return this.app.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')
      return this.app.budgets.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')
    }

    const renderModal = () => {
      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:560px;box-shadow:var(--shadow-lg);display:flex;flex-direction:column" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--border-light)">
            <input id="bdm-title" value="${esc(card?.title || '')}" placeholder="Card title…" maxlength="200" ${dis}
              style="flex:1;border:none;outline:none;font-size:15px;font-weight:600;color:var(--text-primary);background:transparent;font-family:var(--font);min-width:0">
            <button id="bdm-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary);line-height:1;padding:4px 6px">×</button>
          </div>

          <div style="display:flex;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border-light);flex-wrap:wrap">
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:130px">
              <label style="${labelStyle}">Column</label>
              <select id="bdm-column" ${dis} style="${inputStyle}">
                ${cols.map(c => `<option value="${c.id}"${(card?.column_id || defaultColId) === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:130px">
              <label style="${labelStyle}">Assignee</label>
              <select id="bdm-assignee" ${dis} style="${inputStyle}">
                <option value="">— Unassigned —</option>
                ${allUsers.map(u => `<option value="${u.id}"${card?.assignee_id === u.id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px">
              <label style="${labelStyle}">Due date</label>
              <input id="bdm-due" type="date" value="${card?.due_date ? dateKey(card.due_date) : ''}" ${dis} style="${inputStyle}">
            </div>
          </div>

          <div style="padding:14px 20px;border-bottom:1px solid var(--border-light)">
            <label style="${labelStyle};display:block;margin-bottom:6px">Labels</label>
            <div style="display:flex;gap:6px;margin-bottom:8px">
              ${LABEL_COLORS.map(c => `
                <button class="bdm-swatch" data-swatch="${c}" ${dis} title="Toggle label"
                  style="width:22px;height:22px;border-radius:6px;cursor:pointer;background:${c};border:2px solid ${labels.some(l => l.color === c) ? 'var(--text-primary)' : 'transparent'};opacity:${labels.some(l => l.color === c) ? 1 : 0.45}"></button>`).join('')}
            </div>
            ${labels.map((l, i) => `
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
                <span style="width:14px;height:14px;border-radius:4px;background:${esc(l.color)};flex-shrink:0"></span>
                <input class="bdm-label-name" data-idx="${i}" value="${esc(l.name || '')}" placeholder="Label text (optional)…" maxlength="40" ${dis}
                  style="flex:1;${inputStyle};padding:4px 8px;font-size:12px">
              </div>`).join('')}
          </div>

          <div style="padding:14px 20px;border-bottom:1px solid var(--border-light)">
            <label style="${labelStyle};display:block;margin-bottom:6px">Links</label>
            ${links.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
              ${links.map((l, i) => {
                const t = LINK_TYPES.find(x => x.id === l.type)
                const name = this._entityName(l.type, l.id)
                return `<span class="bd-chip" style="color:${t?.color};background:${t?.color}1a">${t?.icon} ${esc(name || 'Missing record')}
                  ${readonly ? '' : `<button class="bdm-link-del" data-idx="${i}" style="background:none;border:none;cursor:pointer;color:inherit;font-size:12px;padding:0 0 0 4px;line-height:1">×</button>`}</span>`
              }).join('')}
            </div>` : ''}
            ${readonly ? '' : `
            <div style="display:flex;gap:8px">
              <select id="bdm-link-type" style="${inputStyle};font-size:12px">
                ${LINK_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}
              </select>
              <select id="bdm-link-entity" style="${inputStyle};font-size:12px;flex:1;min-width:0">${linkOptions('client')}</select>
              <button class="btn-cancel" id="bdm-link-add" style="font-size:12px">+ Add</button>
            </div>`}
          </div>

          <div style="padding:14px 20px">
            <label style="${labelStyle};display:block;margin-bottom:6px">Description</label>
            <textarea id="bdm-desc" rows="4" placeholder="Add a description…" ${dis}
              style="width:100%;box-sizing:border-box;${inputStyle};resize:vertical;line-height:1.5">${esc(card?.description || '')}</textarea>
          </div>

          <div style="display:flex;align-items:center;gap:8px;padding:14px 20px;border-top:1px solid var(--border-light)">
            ${!isNew && !readonly ? '<button id="bdm-delete" style="background:none;border:none;cursor:pointer;color:#e07070;font-size:12px;font-family:var(--font);padding:0">Delete card</button>' : ''}
            <div style="margin-left:auto;display:flex;gap:8px">
              <button class="btn-cancel" id="bdm-cancel">Close</button>
              ${readonly ? '' : `<button class="btn-primary" id="bdm-save">${isNew ? 'Create card' : 'Save'}</button>`}
            </div>
          </div>
        </div>`

      overlay.querySelector('#bdm-close')?.addEventListener('click', () => overlay.remove())
      overlay.querySelector('#bdm-cancel')?.addEventListener('click', () => overlay.remove())

      // Label swatch toggles (preserve typed names through the re-render)
      overlay.querySelectorAll('.bdm-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          if (readonly) return
          this._collectModalLabels(overlay, labels)
          const color = btn.dataset.swatch
          const idx = labels.findIndex(l => l.color === color)
          if (idx >= 0) labels.splice(idx, 1)
          else labels.push({ color, name: '' })
          renderModal()
        })
      })

      // Link add/remove
      overlay.querySelector('#bdm-link-type')?.addEventListener('change', e => {
        const entitySel = overlay.querySelector('#bdm-link-entity')
        if (entitySel) entitySel.innerHTML = linkOptions(e.target.value)
      })
      overlay.querySelector('#bdm-link-add')?.addEventListener('click', () => {
        const type = overlay.querySelector('#bdm-link-type')?.value
        const id = overlay.querySelector('#bdm-link-entity')?.value
        if (!type || !id || links.some(l => l.type === type && l.id === id)) return
        this._collectModalLabels(overlay, labels)
        links.push({ type, id })
        renderModal()
      })
      overlay.querySelectorAll('.bdm-link-del').forEach(btn => {
        btn.addEventListener('click', () => {
          this._collectModalLabels(overlay, labels)
          links.splice(parseInt(btn.dataset.idx), 1)
          renderModal()
        })
      })

      // Delete
      overlay.querySelector('#bdm-delete')?.addEventListener('click', async () => {
        const ok = await this.app.confirm({ title: 'Delete this card?', confirmLabel: 'Delete card' })
        if (!ok) return
        try {
          await deleteBoardCard(card.id)
          this.cards = this.cards.filter(c => c.id !== card.id)
          this._snapshot = this._serialize(this.columns, this.cards)
          overlay.remove()
          this._renderBoardBody(wrap)
          this.app.toast('Card deleted')
        } catch (e) { console.error(e); this.app.toast('Error deleting card') }
      })

      // Save
      overlay.querySelector('#bdm-save')?.addEventListener('click', async () => {
        const title = overlay.querySelector('#bdm-title')?.value.trim()
        if (!title) { overlay.querySelector('#bdm-title')?.focus(); return }
        this._collectModalLabels(overlay, labels)
        const column_id = overlay.querySelector('#bdm-column')?.value
        const data = {
          title,
          column_id,
          description: overlay.querySelector('#bdm-desc')?.value.trim() || null,
          assignee_id: overlay.querySelector('#bdm-assignee')?.value || null,
          due_date:    overlay.querySelector('#bdm-due')?.value || null,
          labels, links,
        }
        try {
          if (isNew) {
            const last = this._cardsFor(column_id).at(-1)
            data.position = (last ? last.position : 0) + POS_GAP
            const created = await createBoardCard(this.board.id, data)
            this.cards.push(created)
          } else {
            const updated = await updateBoardCard(card.id, data)
            const idx = this.cards.findIndex(c => c.id === card.id)
            if (idx !== -1) this.cards[idx] = updated
          }
          this._snapshot = this._serialize(this.columns, this.cards)
          overlay.remove()
          this._renderBoardBody(wrap)
          this.app.toast(isNew ? 'Card created' : 'Card saved')
        } catch (e) { console.error(e); this.app.toast('Error saving card') }
      })
    }

    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    renderModal()
    if (isNew) setTimeout(() => overlay.querySelector('#bdm-title')?.focus(), 10)
  }

  _collectModalLabels(overlay, labels) {
    overlay.querySelectorAll('.bdm-label-name').forEach(input => {
      const l = labels[parseInt(input.dataset.idx)]
      if (l) l.name = input.value.trim()
    })
  }

  // ── Column modal ─────────────────────────────────────────────────────────────

  openColumnModal(wrap, col) {
    document.getElementById('bd-col-modal')?.remove()
    const isNew = !col
    let color = col?.color || COLUMN_COLORS[0]

    const overlay = document.createElement('div')
    overlay.id = 'bd-col-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'

    const renderModal = () => {
      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:340px;padding:20px" onclick="event.stopPropagation()">
          <div style="font-size:14px;font-weight:600;margin-bottom:14px">${isNew ? 'New column' : 'Edit column'}</div>
          <input id="bdc-name" value="${esc(col?.name || '')}" placeholder="Column name…" maxlength="60" style="width:100%;box-sizing:border-box;${inputStyle};margin-bottom:12px">
          <div style="display:flex;gap:6px;margin-bottom:16px">
            ${COLUMN_COLORS.map(c => `
              <button class="bdc-swatch" data-color="${c}"
                style="width:22px;height:22px;border-radius:50%;cursor:pointer;background:${c};border:2px solid ${color === c ? 'var(--text-primary)' : 'transparent'}"></button>`).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            ${!isNew ? '<button id="bdc-delete" style="background:none;border:none;cursor:pointer;color:#e07070;font-size:12px;font-family:var(--font);padding:0">Delete column</button>' : ''}
            <div style="margin-left:auto;display:flex;gap:8px">
              <button class="btn-cancel" id="bdc-cancel">Cancel</button>
              <button class="btn-primary" id="bdc-save">${isNew ? 'Add column' : 'Save'}</button>
            </div>
          </div>
        </div>`

      overlay.querySelector('#bdc-cancel')?.addEventListener('click', () => overlay.remove())
      overlay.querySelectorAll('.bdc-swatch').forEach(btn => {
        btn.addEventListener('click', () => { color = btn.dataset.color; const name = overlay.querySelector('#bdc-name')?.value; renderModal(); overlay.querySelector('#bdc-name').value = name })
      })
      overlay.querySelector('#bdc-delete')?.addEventListener('click', async () => {
        const count = this._cardsFor(col.id).length
        const ok = await this.app.confirm({
          title: 'Delete this column?',
          message: count ? `${count} card${count !== 1 ? 's' : ''} on it will be deleted too.` : '',
          confirmLabel: 'Delete column',
        })
        if (!ok) return
        try {
          await deleteBoardColumn(col.id)
          this.columns = this.columns.filter(c => c.id !== col.id)
          this.cards = this.cards.filter(c => c.column_id !== col.id)
          this._snapshot = this._serialize(this.columns, this.cards)
          overlay.remove()
          this._renderBoardBody(wrap)
          this.app.toast('Column deleted')
        } catch (e) { console.error(e); this.app.toast('Error deleting column') }
      })
      overlay.querySelector('#bdc-save')?.addEventListener('click', async () => {
        const name = overlay.querySelector('#bdc-name')?.value.trim()
        if (!name) { overlay.querySelector('#bdc-name')?.focus(); return }
        try {
          if (isNew) {
            const created = await createBoardColumn(this.board.id, { name, color, sort_order: this.columns.length })
            this.columns.push(created)
          } else {
            const updated = await updateBoardColumn(col.id, { name, color })
            const idx = this.columns.findIndex(c => c.id === col.id)
            if (idx !== -1) this.columns[idx] = updated
          }
          this._snapshot = this._serialize(this.columns, this.cards)
          overlay.remove()
          this._renderBoardBody(wrap)
        } catch (e) { console.error(e); this.app.toast('Error saving column') }
      })
      overlay.querySelector('#bdc-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') overlay.querySelector('#bdc-save')?.click() })
    }

    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    renderModal()
    setTimeout(() => overlay.querySelector('#bdc-name')?.focus(), 10)
  }

  // ── Recurrences modal ────────────────────────────────────────────────────────

  async openRecurrencesModal() {
    document.getElementById('bd-rec-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'bd-rec-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:flex-start;justify-content:center;z-index:9999;padding:32px 16px;overflow-y:auto'
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)

    const scheduleLabel = r => {
      const n = Math.max(1, parseInt(r.interval) || 1)
      const unit = r.freq === 'monthly' ? 'month' : 'week'
      return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`
    }

    const renderModal = async () => {
      let recs = []
      try { recs = await getBoardRecurrences(this.board.id) } catch (e) { console.error(e) }
      const allUsers = this.app.allUsers || []

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:520px;display:flex;flex-direction:column;max-height:85vh;overflow:hidden" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light)">
            <div>
              <div style="font-size:14px;font-weight:600">↻ Recurring cards</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px">Re-spawn in the first column on a schedule — journal send-outs, social posts, mailers</div>
            </div>
            <button id="bdr-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary);line-height:1;padding:4px">×</button>
          </div>

          <div style="overflow-y:auto;flex:1;min-height:0">
            ${recs.length === 0 ? '<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-tertiary)">No recurring cards yet</div>' : ''}
            ${recs.map(r => `
              <div style="display:flex;align-items:center;gap:10px;padding:10px 20px;border-bottom:1px solid var(--border-light);${r.active ? '' : 'opacity:0.45'}">
                <input type="checkbox" data-rec-active="${r.id}" ${r.active ? 'checked' : ''} title="Active" style="cursor:pointer;accent-color:var(--accent);flex-shrink:0">
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.template?.title || 'Untitled')}</div>
                  <div style="font-size:11px;color:var(--text-tertiary)">${scheduleLabel(r)} · next ${fmtDate(r.next_due)}</div>
                </div>
                ${this.canEdit ? `<button data-rec-del="${r.id}" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:14px;padding:0 2px;flex-shrink:0" title="Delete">×</button>` : ''}
              </div>`).join('')}
          </div>

          ${this.canEdit ? `
          <div style="padding:16px 20px;border-top:1px solid var(--border-light);display:flex;flex-direction:column;gap:8px">
            <div style="${labelStyle}">New recurring card</div>
            <input id="bdr-title" placeholder="Card title…" maxlength="200" style="${inputStyle}">
            <textarea id="bdr-desc" rows="2" placeholder="Description (optional)…" style="${inputStyle};resize:vertical;line-height:1.5"></textarea>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <select id="bdr-assignee" style="${inputStyle};flex:1;min-width:120px">
                <option value="">— Unassigned —</option>
                ${allUsers.map(u => `<option value="${u.id}">${esc(u.name || u.email)}</option>`).join('')}
              </select>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:12px;color:var(--text-secondary)">Every</span>
                <input id="bdr-interval" type="number" min="1" max="52" value="1" style="${inputStyle};width:52px">
                <select id="bdr-freq" style="${inputStyle}">
                  <option value="weekly">week(s)</option>
                  <option value="monthly">month(s)</option>
                </select>
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:12px;color:var(--text-secondary)">First due</span>
                <input id="bdr-first" type="date" value="${new Date().toISOString().slice(0, 10)}" style="${inputStyle}">
              </div>
            </div>
            <div style="display:flex;justify-content:flex-end">
              <button class="btn-primary" id="bdr-save" style="font-size:12px">Add recurring card</button>
            </div>
          </div>` : ''}
        </div>`

      overlay.querySelector('#bdr-close')?.addEventListener('click', () => overlay.remove())

      overlay.querySelectorAll('[data-rec-active]').forEach(cb => {
        cb.addEventListener('change', async () => {
          try { await updateBoardRecurrence(cb.dataset.recActive, { active: cb.checked }); renderModal() }
          catch (e) { console.error(e) }
        })
      })
      overlay.querySelectorAll('[data-rec-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const ok = await this.app.confirm({ title: 'Delete this recurring card?', message: 'Cards it already spawned are kept.', confirmLabel: 'Delete' })
          if (!ok) return
          try { await deleteBoardRecurrence(btn.dataset.recDel); renderModal() }
          catch (e) { console.error(e) }
        })
      })
      overlay.querySelector('#bdr-save')?.addEventListener('click', async () => {
        const title = overlay.querySelector('#bdr-title')?.value.trim()
        if (!title) { overlay.querySelector('#bdr-title')?.focus(); return }
        const first = overlay.querySelector('#bdr-first')?.value
        if (!first) { overlay.querySelector('#bdr-first')?.focus(); return }
        try {
          await createBoardRecurrence(this.app.userId, this.board.id, {
            template: {
              title,
              description: overlay.querySelector('#bdr-desc')?.value.trim() || null,
              assignee_id: overlay.querySelector('#bdr-assignee')?.value || null,
            },
            freq:     overlay.querySelector('#bdr-freq')?.value || 'weekly',
            interval: Math.max(1, parseInt(overlay.querySelector('#bdr-interval')?.value) || 1),
            next_due: first,
          })
          this.app.toast('Recurring card added')
          renderModal()
        } catch (e) { console.error(e); this.app.toast('Error adding recurring card') }
      })
    }

    await renderModal()
  }

  // ── Polling sync ─────────────────────────────────────────────────────────────

  // Serialise only fields that change when content changes (no timestamps), so
  // a local optimistic update produces the same snapshot the server will and
  // re-renders only happen for genuinely remote changes.
  _serialize(columns, cards) {
    const cols = [...columns]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(c => [c.id, c.name, c.color, c.sort_order])
    const crds = [...cards]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(c => [c.id, c.column_id, c.title, c.description, c.assignee_id, dateKey(c.due_date || ''), JSON.stringify(c.labels), JSON.stringify(c.links), c.position, c.spawned_from])
    return JSON.stringify([cols, crds])
  }

  _stopPolling() {
    clearInterval(this._pollTimer)
    this._pollTimer = null
  }

  _startPolling(wrap) {
    this._stopPolling()
    const boardId = this.currentId
    this._pollTimer = setInterval(async () => {
      // Board no longer on screen → stop for good
      if (!wrap || !document.contains(wrap) || this.currentId !== boardId) { this._stopPolling(); return }
      // Don't merge under the user's feet (or race an in-flight write)
      if (document.hidden || this._dragCardId || this._dragColId || this._writes > 0) return
      if (document.getElementById('bd-card-modal') || document.getElementById('bd-col-modal') || document.getElementById('bd-rec-modal') || document.getElementById('bd-new-modal')) return
      const ae = document.activeElement
      if (ae && wrap.contains(ae) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return

      try {
        const { columns, cards } = await getBoardData(boardId)
        const snap = this._serialize(columns, cards)
        if (snap !== this._snapshot) {
          this.columns = columns
          this.cards = cards
          this._snapshot = snap
          this._renderBoardBody(wrap)
        }
      } catch (e) { console.warn('Board sync failed:', e) }
    }, POLL_MS)
  }

  // ── Dashboard section ────────────────────────────────────────────────────────

  renderDashboardSection(container) {
    let section = container.querySelector('#bd-section')
    if (!section) {
      section = document.createElement('div')
      section.id = 'bd-section'
      section.style.cssText = 'margin-bottom:20px'
      const tc = container.querySelector('#tc-section')
      if (tc) tc.insertAdjacentElement('afterend', section)
      else container.prepend(section)
    }
    if (this._dbExpanded === undefined) this._dbExpanded = localStorage.getItem('bd-db-open') !== '0'
    this._renderDashboardSection(section)
  }

  async _renderDashboardSection(section) {
    const head = (count, overdue) => `
      <div class="db-section-head" style="cursor:pointer;user-select:none" id="bd-db-toggle">
        <span class="db-section-dot" style="background:#a78bfa"></span>
        Boards
        ${count ? `<span class="db-section-count">${count}</span>` : ''}
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          ${overdue ? `<span style="font-size:11px;color:#ef4444;font-weight:500">${overdue} overdue</span>` : ''}
          <span class="db-chevron${this._dbExpanded ? ' db-chevron--open' : ''}">▶</span>
        </div>
      </div>`

    section.innerHTML = head(0, 0) + (this._dbExpanded ? '<div style="font-size:12px;color:var(--text-tertiary);padding:8px 0 0">Loading…</div>' : '')

    let boards = []
    try {
      await spawnDueBoardRecurrences(this.app.userId).catch(() => {})
      boards = await getBoardsDashboard(this.app.userId)
    } catch (e) { console.error(e) }
    if (!document.contains(section)) return

    const totalOverdue = boards.reduce((s, b) => s + b.columns.reduce((x, c) => x + (c.overdue_count || 0), 0), 0)
    const body = !this._dbExpanded ? '' : `
      <div style="display:flex;flex-direction:column;gap:6px;padding-top:8px">
        ${boards.length === 0 ? `<div style="font-size:12px;color:var(--text-tertiary)">No boards yet${this.app.permissions?.projects_edit !== false ? ' — create one in Planning' : ''}.</div>` : ''}
        ${boards.map(b => {
          const overdue = b.columns.reduce((s, c) => s + (c.overdue_count || 0), 0)
          return `
          <div class="bd-db-row" data-db-board="${b.id}">
            <span style="font-size:13px;flex-shrink:0">🗂</span>
            <span style="font-size:12.5px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${esc(b.name)}</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:0">
              ${b.columns.map(c => `
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:var(--text-secondary);background:var(--bg-secondary);border:0.5px solid var(--border-light);border-radius:var(--radius-pill);padding:2px 8px;white-space:nowrap">
                  <span style="width:6px;height:6px;border-radius:50%;background:${esc(c.color)}"></span>${esc(c.name)} ${c.card_count}
                </span>`).join('')}
            </div>
            ${overdue ? `<span style="font-size:10.5px;color:#ef4444;font-weight:600;flex-shrink:0">${overdue} overdue</span>` : ''}
          </div>`
        }).join('')}
      </div>`

    section.innerHTML = head(boards.length, totalOverdue) + body

    section.querySelector('#bd-db-toggle')?.addEventListener('click', () => {
      this._dbExpanded = !this._dbExpanded
      localStorage.setItem('bd-db-open', this._dbExpanded ? '1' : '0')
      this._renderDashboardSection(section)
    })
    section.querySelectorAll('[data-db-board]').forEach(row => {
      row.addEventListener('click', () => {
        this.app.currentView = 'planning'
        this.currentId = row.dataset.dbBoard
        this.app._pushAppState(`#planning/${this.currentId}`, { view: 'planning', id: this.currentId })
        this.app.render()
      })
    })
  }
}
