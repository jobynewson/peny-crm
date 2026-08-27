// src/views/tasks.js
// The task board — one front-page route with two shells over a shared API and a
// shared card detail component.
//
// Desktop and mobile are deliberately SEPARATE shells, not one responsive
// layout: the column board does not become a good phone screen by narrowing
// (see claude.md). They share the API client, the card detail, and the polling
// loop; everything else is per-shell.
//
// Unlike the other views, data comes from /api rather than src/db/client.js —
// acknowledgement, event writing and notification fan-out are server-owned.

import * as api from '../api/tasks.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const POLL_MS         = 20000
const POLL_BACKOFF_MS = 60000
const FAIL_THRESHOLD  = 3
const DESKTOP_QUERY   = '(min-width: 900px)'

const LS_SHELL   = 'slate-tasks-shell'     // '', 'desktop' or 'mobile' (manual override)
const LS_FILTERS = 'slate-tasks-filters'

const COLUMNS = [
  { id: 'todo',  label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done',  label: 'Done' },
]

const POSITION_GAP = 1024

// ── Small helpers ────────────────────────────────────────────────────────────

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

// `status` matters: finished work cannot be overdue, so a done task shows its
// date plainly rather than in alarm colours.
function dueLabel(due, status) {
  if (!due) return null
  const settled = status === 'done'
  if (settled) return { text: new Date(due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), overdue: false }
  const days = Math.round((startOfDay(due) - startOfDay(new Date())) / 86400000)
  if (days < 0)  return { text: `${Math.abs(days)}d overdue`, overdue: true }
  if (days === 0) return { text: 'Due today', overdue: false, soon: true }
  if (days === 1) return { text: 'Due tomorrow', overdue: false, soon: true }
  return { text: new Date(due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), overdue: false }
}

function initials(user) {
  if (!user) return '?'
  const source = user.name || user.email || ''
  const parts = source.replace(/@.*/, '').trim().split(/[\s._-]+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

const timeAgo = (ts) => {
  const mins = Math.round((Date.now() - new Date(ts)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const EVENT_TEXT = {
  created:        () => 'created this task',
  assigned:       (e, name) => `assigned this to ${name}`,
  unassigned:     () => 'removed the assignee',
  acknowledged:   () => 'acknowledged this',
  status_changed: (e) => `moved this to ${COLUMNS.find(c => c.id === e.payload?.to)?.label ?? e.payload?.to}`,
  commented:      () => 'commented',
  due_changed:    (e) => e.payload?.to ? 'changed the due date' : 'cleared the due date',
  archived:       () => 'archived this',
  nudged:         () => 'was reminded this is unacknowledged',
}

export class TasksView {
  constructor(app) {
    this.app = app
    this.tasks       = []
    this.serverTime  = null
    this.loaded      = false
    this.error       = null
    this.detailId    = null
    this.detail      = null
    this.unread      = 0
    this.notifications = []
    this.notifOpen   = false
    this.doneOpen    = false

    this._pollTimer = null
    this._failures  = 0
    this._writes    = 0        // merges pause while a write is in flight
    this._dragId    = null
    this._mq        = null

    this.filters = this._loadFilters()
  }

  // ── Shell selection ────────────────────────────────────────────────────────
  // matchMedia decides by default; a manual override is remembered so anyone can
  // force either view (a tablet user, or someone who wants the board on a phone).
  shell() {
    const override = localStorage.getItem(LS_SHELL)
    if (override === 'desktop' || override === 'mobile') return override
    return window.matchMedia(DESKTOP_QUERY).matches ? 'desktop' : 'mobile'
  }

  setShell(value) {
    if (value) localStorage.setItem(LS_SHELL, value)
    else localStorage.removeItem(LS_SHELL)
    this.render(this._mc)
  }

  _loadFilters() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_FILTERS) || '{}')
      return { mine: !!raw.mine, person: raw.person || '', project: raw.project || '' }
    } catch { return { mine: false, person: '', project: '' } }
  }

  _saveFilters() {
    localStorage.setItem(LS_FILTERS, JSON.stringify(this.filters))
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  me() { return this.app.appUser?.id ?? null }

  userById(id) { return (this.app.allUsers || []).find(u => u.id === id) ?? null }

  async load() {
    try {
      const data = await api.listTasks({ scope: 'board' })
      this.tasks = data.tasks
      this.serverTime = data.server_time
      this.unread = data.unread_notifications
      this.error = null
    } catch (err) {
      console.error('Tasks load failed:', err)
      this.error = err.message
    }
    this.loaded = true
  }

  // Merge by id — never wholesale-replace, or an in-flight drag gets clobbered.
  _merge(incoming, archivedIds) {
    const byId = new Map(this.tasks.map(t => [t.id, t]))
    for (const task of incoming) byId.set(task.id, task)
    for (const id of archivedIds || []) byId.delete(id)
    this.tasks = [...byId.values()]
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  startPolling() {
    this.stopPolling()
    this._pollTimer = setInterval(() => this.poll(), this._interval())
    if (!this._visibilityBound) {
      this._onVisibility = () => {
        if (document.visibilityState === 'hidden') return
        this.poll()                      // catch up immediately on return
        this.startPolling()
      }
      this._onFocus = () => this.poll()
      document.addEventListener('visibilitychange', this._onVisibility)
      window.addEventListener('focus', this._onFocus)
      this._visibilityBound = true
    }
  }

  stopPolling() {
    clearInterval(this._pollTimer)
    this._pollTimer = null
  }

  destroy() {
    this.stopPolling()
    if (this._visibilityBound) {
      document.removeEventListener('visibilitychange', this._onVisibility)
      window.removeEventListener('focus', this._onFocus)
      this._visibilityBound = false
    }
  }

  _interval() {
    return this._failures >= FAIL_THRESHOLD ? POLL_BACKOFF_MS : POLL_MS
  }

  async poll() {
    // Self-terminating, like the boards poll: once the board is off-screen the
    // interval stops itself rather than relying on the router to tear it down.
    if (!this._mc || !document.contains(this._mc)) { this.stopPolling(); return }
    // Nothing to poll for while the tab is hidden or a write is settling.
    if (document.visibilityState === 'hidden') return
    if (this._writes > 0) return
    if (!this.serverTime) return

    try {
      const data = await api.listTasks({ scope: 'board', updated_since: this.serverTime })
      // The server's own clock, echoed back next time — the browser's may drift.
      this.serverTime = data.server_time
      this.unread = data.unread_notifications

      const changed = data.tasks.length || (data.archived_ids || []).length
      if (changed) {
        this._merge(data.tasks, data.archived_ids)
        this._refreshBoard()
      }
      this._updateBell()

      if (this._failures >= FAIL_THRESHOLD) { this._failures = 0; this.startPolling() }
      else this._failures = 0
    } catch (err) {
      console.warn('Task poll failed:', err.message)
      this._failures++
      // Back off once, at the threshold, rather than re-arming every failure.
      if (this._failures === FAIL_THRESHOLD) this.startPolling()
    }
  }

  // Wrap a write so polling does not merge a stale snapshot over it mid-flight.
  async _write(fn) {
    this._writes++
    try { return await fn() }
    finally { this._writes-- }
  }

  // ── Filtering / grouping ───────────────────────────────────────────────────

  visibleTasks() {
    const me = this.me()
    return this.tasks.filter(t => {
      if (t.archived_at) return false
      if (this.filters.mine && t.assignee_id !== me) return false
      if (this.filters.person && t.assignee_id !== this.filters.person) return false
      if (this.filters.project && t.project_id !== this.filters.project) return false
      return true
    })
  }

  isUnacknowledged(task) {
    return !!task.assignee_id && !task.acknowledged_at
  }

  columnTasks(status) {
    return this.visibleTasks()
      .filter(t => t.status === status)
      .filter(t => !(status === 'todo' && !t.assignee_id))   // unassigned live in the tray
      .sort((a, b) => (a.position - b.position) || (new Date(a.created_at) - new Date(b.created_at)))
  }

  unassignedTasks() {
    return this.visibleTasks()
      .filter(t => !t.assignee_id && t.status !== 'done')
      .sort((a, b) => a.position - b.position)
  }

  // ── Entry point ────────────────────────────────────────────────────────────

  async render(mc) {
    this._mc = mc
    if (!this.loaded) {
      mc.innerHTML = `<div class="empty-state" style="padding-top:80px">Loading tasks…</div>`
      await this.load()
    }
    this._renderShell(mc)
    this.startPolling()

    // Re-pick the shell when the viewport crosses the breakpoint (rotation, or a
    // resized desktop window), unless the user has forced one.
    if (!this._mq) {
      this._mq = window.matchMedia(DESKTOP_QUERY)
      this._mq.addEventListener('change', () => {
        if (!localStorage.getItem(LS_SHELL) && this._mc) this._renderShell(this._mc)
      })
    }
  }

  _renderShell(mc) {
    if (this.error) {
      mc.innerHTML = `
        <div class="empty-state" style="padding-top:80px">
          <div>Couldn't load tasks.</div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px">${esc(this.error)}</div>
          <button class="btn-secondary" id="tasks-retry" style="margin-top:14px">Retry</button>
        </div>`
      mc.querySelector('#tasks-retry')?.addEventListener('click', async () => {
        this.loaded = false; await this.render(mc)
      })
      return
    }
    if (this.shell() === 'desktop') this._renderDesktop(mc)
    else this._renderMobile(mc)
  }

  _refreshBoard() {
    if (this._mc && !document.contains(this._mc)) { this.closeDetail(); return }
    if (this._mc) this._renderShell(this._mc)
    if (this.detailId) this._refreshDetailTask()
  }

  // ── Quick add ──────────────────────────────────────────────────────────────
  // One text field is the primary path: type, press Enter, done. Everything else
  // is optional and must never block that.

  _quickAddHtml() {
    const users = this.app.allUsers || []
    const projects = this.app.projects || []
    return `
      <div class="tk-quickadd">
        <input type="text" id="tk-qa-title" class="tk-qa-input"
               placeholder="Raise a request…  (press Enter)" autocomplete="off" maxlength="500" />
        <div class="tk-qa-opts">
          <select id="tk-qa-assignee" class="tk-qa-select" title="Assignee (optional)">
            <option value="">Unassigned</option>
            ${users.map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email)}</option>`).join('')}
          </select>
          <input type="date" id="tk-qa-due" class="tk-qa-select" title="Due date (optional)" />
          <select id="tk-qa-project" class="tk-qa-select" title="Project (optional)">
            <option value="">No project</option>
            ${projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
          </select>
          <button class="btn-primary tk-qa-btn" id="tk-qa-add">Add</button>
        </div>
      </div>`
  }

  _bindQuickAdd(root) {
    const input = root.querySelector('#tk-qa-title')
    if (!input) return
    const submit = async () => {
      const title = input.value.trim()
      if (!title) return
      const payload = { title }
      const assignee = root.querySelector('#tk-qa-assignee')?.value
      const due      = root.querySelector('#tk-qa-due')?.value
      const project  = root.querySelector('#tk-qa-project')?.value
      if (assignee) payload.assignee_id = assignee
      if (due)      payload.due_at = new Date(due + 'T09:00:00').toISOString()
      // Creating from inside a project prefills it; from the board it stays null.
      if (project)  payload.project_id = project
      else if (this.prefillProjectId) payload.project_id = this.prefillProjectId

      input.value = ''
      try {
        await this._write(async () => {
          const { task } = await api.createTask(payload)
          this.tasks.push(task)
        })
        this._refreshBoard()
        this.app.toast('Task added')
      } catch (err) {
        input.value = title                       // give them their text back
        this.app.toast(err.message || 'Could not add task')
      }
    }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit() }
    })
    root.querySelector('#tk-qa-add')?.addEventListener('click', submit)
  }

  // ── Desktop shell ──────────────────────────────────────────────────────────

  _renderDesktop(mc) {
    const unassigned = this.unassignedTasks()
    mc.innerHTML = `
      <div class="tk-wrap">
        ${this._bellHtml()}
        ${this._quickAddHtml()}
        ${this._filterBarHtml()}
        <div class="tk-tray ${unassigned.length ? '' : 'tk-tray--empty'}" data-tray="1">
          <div class="tk-tray-label">Unassigned${unassigned.length ? ` · ${unassigned.length}` : ''}</div>
          <div class="tk-tray-body" data-drop-tray="1">
            ${unassigned.length
              ? unassigned.map(t => this._cardHtml(t, true)).join('')
              : `<div class="tk-tray-empty">Nothing waiting to be picked up.</div>`}
          </div>
        </div>
        <div class="tk-cols">
          ${COLUMNS.map(col => {
            const items = this.columnTasks(col.id)
            return `
              <div class="tk-col">
                <div class="tk-col-head">
                  <span>${col.label}</span>
                  <span class="kanban-count">${items.length}</span>
                </div>
                <div class="tk-col-body" data-drop-col="${col.id}">
                  ${items.map(t => this._cardHtml(t)).join('')}
                </div>
              </div>`
          }).join('')}
        </div>
      </div>`

    this._bindQuickAdd(mc)
    this._bindFilterBar(mc)
    this._bindBell(mc)
    this._bindCards(mc)
    this._bindDnD(mc)
    if (this.detailId) this._renderDetail()
  }

  _filterBarHtml() {
    const users = this.app.allUsers || []
    const projects = this.app.projects || []
    return `
      <div class="tk-filters">
        <button class="tk-chip ${this.filters.mine ? 'tk-chip--on' : ''}" id="tk-f-mine">Just mine</button>
        <select class="tk-qa-select" id="tk-f-person">
          <option value="">Anyone</option>
          ${users.map(u => `<option value="${esc(u.id)}" ${this.filters.person === u.id ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
        </select>
        <select class="tk-qa-select" id="tk-f-project">
          <option value="">Any project</option>
          ${projects.map(p => `<option value="${esc(p.id)}" ${this.filters.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        <div style="flex:1"></div>
        <button class="tk-chip" id="tk-shell-toggle" title="Switch to the mobile list">Mobile view</button>
      </div>`
  }

  _bindFilterBar(mc) {
    const update = (patch) => {
      Object.assign(this.filters, patch)
      this._saveFilters()
      this._renderShell(mc)
    }
    mc.querySelector('#tk-f-mine')?.addEventListener('click', () => update({ mine: !this.filters.mine }))
    mc.querySelector('#tk-f-person')?.addEventListener('change', e => update({ person: e.target.value }))
    mc.querySelector('#tk-f-project')?.addEventListener('change', e => update({ project: e.target.value }))
    mc.querySelector('#tk-shell-toggle')?.addEventListener('click', () => this.setShell('mobile'))
  }

  // Card face: title, assignee initials, due date if set, comment count if > 0,
  // and the unacknowledged accent + New pill.
  _cardHtml(task, inTray = false) {
    const assignee = this.userById(task.assignee_id)
    const due = dueLabel(task.due_at, task.status)
    const unack = this.isUnacknowledged(task)
    const project = (this.app.projects || []).find(p => p.id === task.project_id)
    return `
      <div class="tk-card ${unack ? 'tk-card--unack' : ''}" data-task-id="${esc(task.id)}" data-in-tray="${inTray ? '1' : ''}" draggable="true">
        <div class="tk-card-title">${esc(task.title)}</div>
        ${project ? `<div class="tk-card-project">${esc(project.name)}</div>` : ''}
        <div class="tk-card-meta">
          ${unack ? `<span class="tk-pill">New</span>` : ''}
          ${due ? `<span class="tk-due ${due.overdue ? 'tk-due--over' : due.soon ? 'tk-due--soon' : ''}">${esc(due.text)}</span>` : ''}
          ${task.comment_count > 0 ? `<span class="tk-count" title="${task.comment_count} comment${task.comment_count > 1 ? 's' : ''}">💬 ${task.comment_count}</span>` : ''}
          <div style="flex:1"></div>
          ${assignee ? `<span class="tk-avatar" title="${esc(assignee.name || assignee.email)}">${esc(initials(assignee))}</span>` : ''}
        </div>
      </div>`
  }

  _bindCards(mc) {
    mc.querySelectorAll('[data-task-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('button')) return
        this.openDetail(el.dataset.taskId)
      })
    })
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────
  // Between columns changes status; within a column changes position. Dragging
  // out of the unassigned tray also claims the task for whoever dragged it.

  _bindDnD(mc) {
    const clear = () => {
      mc.querySelectorAll('.tk-card').forEach(c => c.classList.remove('tk-card--over'))
      mc.querySelectorAll('.tk-col-body, .tk-tray-body').forEach(z => z.classList.remove('tk-drop--over'))
    }

    mc.querySelectorAll('.tk-card[data-task-id]').forEach(card => {
      card.addEventListener('dragstart', e => {
        this._dragId = card.dataset.taskId
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', card.dataset.taskId)
        setTimeout(() => card.classList.add('tk-card--dragging'), 0)
      })
      card.addEventListener('dragend', () => {
        card.classList.remove('tk-card--dragging'); clear(); this._dragId = null
      })
      card.addEventListener('dragover', e => {
        if (!this._dragId || card.dataset.taskId === this._dragId) return
        e.preventDefault(); e.stopPropagation()
        clear(); card.classList.add('tk-card--over')
      })
      card.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation(); clear()
        if (!this._dragId || card.dataset.taskId === this._dragId) return
        const col = card.closest('[data-drop-col]')
        if (col) this._moveTask(this._dragId, col.dataset.dropCol, card.dataset.taskId)
      })
    })

    mc.querySelectorAll('[data-drop-col]').forEach(zone => {
      zone.addEventListener('dragover', e => {
        if (!this._dragId) return
        e.preventDefault(); clear(); zone.classList.add('tk-drop--over')
      })
      zone.addEventListener('drop', e => {
        e.preventDefault(); clear()
        if (this._dragId) this._moveTask(this._dragId, zone.dataset.dropCol, null)
      })
    })
  }

  async _moveTask(taskId, destStatus, beforeId) {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) return

    const snapshot = { ...task }
    const siblings = this.columnTasks(destStatus).filter(t => t.id !== taskId)
    let index = beforeId ? siblings.findIndex(t => t.id === beforeId) : siblings.length
    if (index < 0) index = siblings.length

    const prev = siblings[index - 1], next = siblings[index]
    let position
    if (!prev && !next)  position = POSITION_GAP
    else if (!prev)      position = next.position - POSITION_GAP
    else if (!next)      position = prev.position + POSITION_GAP
    else                 position = (prev.position + next.position) / 2

    const patch = { status: destStatus, position }
    // Dragging out of the unassigned tray claims it.
    const claiming = !task.assignee_id && this.me()
    if (claiming) patch.assignee_id = this.me()

    // Optimistic — the board must feel immediate.
    Object.assign(task, patch)
    this._refreshBoard()

    try {
      await this._write(async () => {
        const { task: saved } = await api.patchTask(taskId, patch)
        Object.assign(task, saved)
      })
      this._refreshBoard()
    } catch (err) {
      Object.assign(task, snapshot)      // roll back and say so
      this._refreshBoard()
      this.app.toast(err.message || 'Could not move that task')
    }
  }

  // ── Mobile shell ───────────────────────────────────────────────────────────
  // No columns, no horizontal scroll. One vertical list of MY tasks, grouped so
  // the thing that needs a reply is unmissable at the top.

  _mobileGroups() {
    const me = this.me()
    const mine = this.tasks.filter(t => !t.archived_at && t.assignee_id === me)

    const needsReply = mine.filter(t => this.isUnacknowledged(t))
    const acked = mine.filter(t => !this.isUnacknowledged(t))

    // Manual position is ignored on mobile — due date is the only order that
    // makes sense on a phone, with undated tasks last.
    const byDue = (a, b) => {
      if (!a.due_at && !b.due_at) return new Date(a.created_at) - new Date(b.created_at)
      if (!a.due_at) return 1
      if (!b.due_at) return -1
      return new Date(a.due_at) - new Date(b.due_at)
    }

    return [
      { id: 'needs', label: 'Needs a reply', items: needsReply.sort(byDue) },
      { id: 'doing', label: 'Doing',         items: acked.filter(t => t.status === 'doing').sort(byDue) },
      { id: 'todo',  label: 'To do',         items: acked.filter(t => t.status === 'todo').sort(byDue) },
      { id: 'done',  label: 'Done',          items: acked.filter(t => t.status === 'done').sort(byDue), collapsed: true },
    ]
  }

  _renderMobile(mc) {
    const groups = this._mobileGroups()
    const open = groups.filter(g => !g.collapsed)
    const done = groups.find(g => g.id === 'done')
    const anything = groups.some(g => g.items.length)

    mc.innerHTML = `
      <div class="tk-m-wrap">
        ${this._bellHtml(true)}
        ${!anything ? `<div class="empty-state" style="padding:60px 20px">Nothing assigned to you.</div>` : ''}
        ${open.filter(g => g.items.length).map(g => `
          <div class="tk-m-group">
            <div class="tk-m-group-head ${g.id === 'needs' ? 'tk-m-group-head--alert' : ''}">
              ${esc(g.label)} <span class="kanban-count">${g.items.length}</span>
            </div>
            ${g.items.map(t => this._mobileRowHtml(t)).join('')}
          </div>`).join('')}
        ${done.items.length ? `
          <div class="tk-m-group">
            <button class="tk-m-disclosure" id="tk-m-done-toggle" aria-expanded="${this.doneOpen}">
              ${this.doneOpen ? '▾' : '▸'} Done <span class="kanban-count">${done.items.length}</span>
            </button>
            ${this.doneOpen ? done.items.map(t => this._mobileRowHtml(t)).join('') : ''}
          </div>` : ''}
        <div style="height:88px"></div>
        <button class="tk-fab" id="tk-fab" aria-label="Add a task">+</button>
        <button class="tk-m-shell-toggle" id="tk-shell-toggle">Desktop board</button>
      </div>`

    mc.querySelector('#tk-m-done-toggle')?.addEventListener('click', () => {
      this.doneOpen = !this.doneOpen; this._renderShell(mc)
    })
    mc.querySelector('#tk-shell-toggle')?.addEventListener('click', () => this.setShell('desktop'))
    mc.querySelector('#tk-fab')?.addEventListener('click', () => this._openQuickAddSheet())
    this._bindBell(mc)

    mc.querySelectorAll('[data-task-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('button')) return
        this.openDetail(el.dataset.taskId)
      })
    })
    // "Got it" is inline on the row — one tap, no navigation.
    mc.querySelectorAll('[data-ack-id]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        await this._acknowledge(btn.dataset.ackId)
      })
    })
  }

  _mobileRowHtml(task) {
    const due = dueLabel(task.due_at, task.status)
    const unack = this.isUnacknowledged(task)
    const project = (this.app.projects || []).find(p => p.id === task.project_id)
    const meta = [
      project ? esc(project.name) : null,
      due ? esc(due.text) : null,
      task.comment_count > 0 ? `💬 ${task.comment_count}` : null,
    ].filter(Boolean).join(' · ')

    return `
      <div class="tk-m-row ${unack ? 'tk-m-row--unack' : ''}" data-task-id="${esc(task.id)}">
        <div class="tk-m-row-main">
          <div class="tk-m-row-title">${esc(task.title)}</div>
          ${meta ? `<div class="tk-m-row-meta ${due?.overdue ? 'tk-m-row-meta--over' : ''}">${meta}</div>` : ''}
        </div>
        ${unack ? `<button class="tk-got-it" data-ack-id="${esc(task.id)}">Got it</button>` : ''}
      </div>`
  }

  _openQuickAddSheet() {
    const host = document.createElement('div')
    host.className = 'tk-sheet-backdrop'
    host.innerHTML = `
      <div class="tk-sheet tk-sheet--add">
        <div class="tk-sheet-head">
          <span>New task</span>
          <button class="tk-x" data-close="1" aria-label="Close">✕</button>
        </div>
        <div class="tk-sheet-body">${this._quickAddHtml()}</div>
      </div>`
    document.body.appendChild(host)
    const close = () => host.remove()
    host.addEventListener('click', e => { if (e.target === host || e.target.dataset.close) close() })
    this._bindQuickAdd(host)
    // Enter submits and closes — the whole point of the fast path.
    host.querySelector('#tk-qa-title')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') setTimeout(close, 0)
    })
    host.querySelector('#tk-qa-add')?.addEventListener('click', () => setTimeout(close, 0))
    setTimeout(() => host.querySelector('#tk-qa-title')?.focus(), 30)
  }

  async _acknowledge(id) {
    const task = this.tasks.find(t => t.id === id)
    if (!task) return
    const snapshot = { ...task }
    task.acknowledged_at = new Date().toISOString()   // optimistic
    this._refreshBoard()
    try {
      await this._write(async () => {
        const { task: saved } = await api.acknowledgeTask(id)
        Object.assign(task, saved)
      })
      this._refreshBoard()
      this.app.toast('Got it — the requester has been told')
    } catch (err) {
      Object.assign(task, snapshot)
      this._refreshBoard()
      this.app.toast(err.message || 'Could not acknowledge')
    }
  }

  // ── Card detail ────────────────────────────────────────────────────────────
  // One component, two chromes: a modal on desktop, a full-screen sheet on
  // mobile. Same markup and bindings either way.

  async openDetail(id) {
    this.detailId = id
    this.detail = null
    this._renderDetail()
    try {
      this.detail = await api.getTask(id)
    } catch (err) {
      this.app.toast(err.message || 'Could not open that task')
      this.closeDetail()
      return
    }
    this._renderDetail()
  }

  closeDetail() {
    this.detailId = null
    this.detail = null
    document.getElementById('tk-detail-host')?.remove()
  }

  async _refreshDetailTask() {
    if (!this.detailId) return
    try {
      this.detail = await api.getTask(this.detailId)
      this._renderDetail()
    } catch { /* the poll will try again */ }
  }

  _renderDetail() {
    if (!this.detailId) return
    let host = document.getElementById('tk-detail-host')
    if (!host) {
      host = document.createElement('div')
      host.id = 'tk-detail-host'
      host.className = 'tk-sheet-backdrop'
      document.body.appendChild(host)
      host.addEventListener('click', e => {
        if (e.target === host || e.target.dataset.close) this.closeDetail()
      })
      if (!this._escBound) {
        this._escHandler = e => { if (e.key === 'Escape' && this.detailId) this.closeDetail() }
        document.addEventListener('keydown', this._escHandler)
        this._escBound = true
      }
    }

    const mobile = this.shell() === 'mobile'
    if (!this.detail) {
      host.innerHTML = `<div class="tk-sheet ${mobile ? 'tk-sheet--full' : 'tk-sheet--modal'}">
        <div class="tk-sheet-body"><div class="empty-state" style="padding:40px">Loading…</div></div></div>`
      return
    }

    const { task, comments, events } = this.detail
    const users = this.app.allUsers || []
    const projects = this.app.projects || []
    const canAck = this.isUnacknowledged(task) && task.assignee_id === this.me()
    const creator = this.userById(task.created_by)

    host.innerHTML = `
      <div class="tk-sheet ${mobile ? 'tk-sheet--full' : 'tk-sheet--modal'}">
        <div class="tk-sheet-head">
          <span class="tk-sheet-sub">Raised by ${esc(creator?.name || creator?.email || 'someone')} · ${esc(timeAgo(task.created_at))}</span>
          <button class="tk-x" data-close="1" aria-label="Close">✕</button>
        </div>

        <div class="tk-sheet-body">
          ${canAck ? `<button class="tk-got-it tk-got-it--wide" id="tk-detail-ack">Got it</button>` : ''}

          <input class="tk-title-input" id="tk-d-title" value="${esc(task.title)}" maxlength="500" />

          <div class="tk-d-grid">
            <label class="tk-d-label">Status</label>
            <select class="tk-qa-select" id="tk-d-status">
              ${COLUMNS.map(c => `<option value="${c.id}" ${task.status === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select>

            <label class="tk-d-label">Assignee</label>
            <select class="tk-qa-select" id="tk-d-assignee">
              <option value="">Unassigned</option>
              ${users.map(u => `<option value="${esc(u.id)}" ${task.assignee_id === u.id ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
            </select>

            <label class="tk-d-label">Due</label>
            <input type="date" class="tk-qa-select" id="tk-d-due" value="${task.due_at ? new Date(task.due_at).toISOString().slice(0, 10) : ''}" />

            <label class="tk-d-label">Project</label>
            <select class="tk-qa-select" id="tk-d-project">
              <option value="">No project</option>
              ${projects.map(p => `<option value="${esc(p.id)}" ${task.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </div>

          <textarea class="tk-body-input" id="tk-d-body" rows="4" placeholder="Add detail (markdown)…">${esc(task.body || '')}</textarea>

          <div class="tk-d-section">Comments${comments.length ? ` · ${comments.length}` : ''}</div>
          <div class="tk-comments">
            ${comments.length ? comments.map(c => `
              <div class="tk-comment">
                <div class="tk-comment-head">
                  <span class="tk-avatar">${esc(initials({ name: c.author_name, email: c.author_email }))}</span>
                  <strong>${esc(c.author_name || c.author_email || 'Someone')}</strong>
                  <span class="tk-comment-time">${esc(timeAgo(c.created_at))}</span>
                </div>
                <div class="tk-comment-body">${this._renderMentions(c.body)}</div>
              </div>`).join('')
              : `<div class="tk-comment-empty">No comments yet.</div>`}
          </div>

          <div class="tk-composer">
            <textarea id="tk-d-comment" rows="2" placeholder="Comment… use @ to mention someone"></textarea>
            <div class="tk-mention-menu" id="tk-mention-menu" hidden></div>
            <button class="btn-primary" id="tk-d-comment-send">Send</button>
          </div>

          <details class="tk-activity">
            <summary>Activity${events.length ? ` · ${events.length}` : ''}</summary>
            ${events.map(e => {
              const who = e.actor_name || e.actor_email || 'Someone'
              const target = this.userById(e.payload?.to || e.payload?.assignee_id)
              const text = (EVENT_TEXT[e.type] || (() => e.type))(e, target?.name || target?.email || 'someone')
              return `<div class="tk-event"><strong>${esc(who)}</strong> ${esc(text)} <span class="tk-comment-time">${esc(timeAgo(e.created_at))}</span></div>`
            }).join('')}
          </details>
        </div>
      </div>`

    this._bindDetail(host, task)
  }

  // Highlight resolved @handles in a stored comment. Unresolved ones stay as
  // plain text, which is exactly what the server decided at write time.
  _renderMentions(body) {
    const users = this.app.allUsers || []
    return esc(body).replace(/(^|[^\w.@&-])@([\w.-]+)/g, (whole, pre, token) => {
      const clean = token.replace(/[.\-]+$/, '').toLowerCase()
      const hit = users.find(u => {
        const handles = new Set()
        if (u.email) handles.add(u.email.split('@')[0].toLowerCase())
        if (u.name) {
          const parts = u.name.trim().toLowerCase().split(/\s+/)
          handles.add(parts[0]); handles.add(parts.join('')); handles.add(parts.join('.'))
        }
        return handles.has(clean)
      })
      return hit ? `${pre}<span class="tk-mention">@${esc(token)}</span>` : whole
    })
  }

  _bindDetail(host, task) {
    const save = async (patch) => {
      try {
        await this._write(async () => {
          const { task: saved } = await api.patchTask(task.id, patch)
          const local = this.tasks.find(t => t.id === task.id)
          if (local) Object.assign(local, saved)
          if (this.detail) this.detail.task = saved
        })
        this._refreshBoard()
        await this._refreshDetailTask()
      } catch (err) {
        this.app.toast(err.message || 'Could not save')
        await this._refreshDetailTask()
      }
    }

    host.querySelector('#tk-detail-ack')?.addEventListener('click', async () => {
      await this._acknowledge(task.id)
      await this._refreshDetailTask()
    })

    const title = host.querySelector('#tk-d-title')
    title?.addEventListener('blur', () => {
      const value = title.value.trim()
      if (value && value !== task.title) save({ title: value })
      else if (!value) title.value = task.title          // never allow it to be emptied
    })

    const body = host.querySelector('#tk-d-body')
    body?.addEventListener('blur', () => {
      if (body.value !== (task.body || '')) save({ body: body.value || null })
    })

    host.querySelector('#tk-d-status')?.addEventListener('change', e => save({ status: e.target.value }))
    host.querySelector('#tk-d-assignee')?.addEventListener('change', e => save({ assignee_id: e.target.value || null }))
    host.querySelector('#tk-d-project')?.addEventListener('change', e => save({ project_id: e.target.value || null }))
    host.querySelector('#tk-d-due')?.addEventListener('change', e => {
      save({ due_at: e.target.value ? new Date(e.target.value + 'T09:00:00').toISOString() : null })
    })

    const composer = host.querySelector('#tk-d-comment')
    const send = async () => {
      const text = composer.value.trim()
      if (!text) return
      composer.value = ''
      try {
        await this._write(() => api.addComment(task.id, text))
        await this._refreshDetailTask()
        const local = this.tasks.find(t => t.id === task.id)
        if (local) local.comment_count = (local.comment_count || 0) + 1
        this._refreshBoard()
      } catch (err) {
        composer.value = text
        this.app.toast(err.message || 'Could not post that comment')
      }
    }
    host.querySelector('#tk-d-comment-send')?.addEventListener('click', send)
    composer?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
    })
    this._bindMentionAutocomplete(host, composer)
  }

  // Mention autocomplete is client-side against the user list already in memory
  // — no endpoint for it.
  _bindMentionAutocomplete(host, composer) {
    const menu = host.querySelector('#tk-mention-menu')
    if (!composer || !menu) return
    const users = this.app.allUsers || []
    let active = []

    const hide = () => { menu.hidden = true; menu.innerHTML = ''; active = [] }

    const insert = (user) => {
      const handle = (user.email || '').split('@')[0] || (user.name || '').split(/\s+/)[0].toLowerCase()
      const upto = composer.value.slice(0, composer.selectionStart)
      const start = upto.lastIndexOf('@')
      composer.value = composer.value.slice(0, start) + '@' + handle + ' ' + composer.value.slice(composer.selectionStart)
      composer.focus()
      hide()
    }

    composer.addEventListener('input', () => {
      const upto = composer.value.slice(0, composer.selectionStart)
      const match = upto.match(/(^|\s)@([\w.-]*)$/)
      if (!match) return hide()
      const term = match[2].toLowerCase()
      active = users
        .filter(u => !term || (u.name || '').toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term))
        .slice(0, 6)
      if (!active.length) return hide()
      menu.innerHTML = active.map((u, i) => `
        <button class="tk-mention-opt" data-idx="${i}">
          <span class="tk-avatar">${esc(initials(u))}</span> ${esc(u.name || u.email)}
        </button>`).join('')
      menu.hidden = false
      menu.querySelectorAll('.tk-mention-opt').forEach(btn => {
        btn.addEventListener('mousedown', e => { e.preventDefault(); insert(active[+btn.dataset.idx]) })
      })
    })
    composer.addEventListener('blur', () => setTimeout(hide, 120))
  }

  // ── Notification bell ──────────────────────────────────────────────────────

  _bellHtml(mobile = false) {
    return `
      <div class="tk-bell-row ${mobile ? 'tk-bell-row--m' : ''}">
        <button class="tk-bell" id="tk-bell" aria-label="Notifications">
          🔔${this.unread > 0 ? `<span class="tk-bell-dot">${this.unread > 9 ? '9+' : this.unread}</span>` : ''}
        </button>
      </div>
      ${this.notifOpen ? this._notifListHtml() : ''}`
  }

  _notifListHtml() {
    const items = this.notifications
    const LABEL = {
      assigned: 'assigned you', mentioned: 'mentioned you', commented: 'commented on',
      acknowledged: 'acknowledged', completed: 'completed', unacknowledged_nudge: 'still waiting on you',
    }
    return `
      <div class="tk-notifs">
        <div class="tk-notifs-head">
          <span>Notifications</span>
          <button class="tk-chip" id="tk-notif-readall">Mark all read</button>
        </div>
        ${items.length ? items.map(n => `
          <button class="tk-notif ${n.read_at ? '' : 'tk-notif--unread'}" data-notif-id="${esc(n.id)}" data-notif-task="${esc(n.task_id)}">
            <span class="tk-notif-text">
              <strong>${esc(n.actor_name || n.actor_email || 'Someone')}</strong>
              ${esc(LABEL[n.type] || n.type)} — ${esc(n.task_title)}
            </span>
            <span class="tk-comment-time">${esc(timeAgo(n.created_at))}</span>
          </button>`).join('')
          : `<div class="tk-comment-empty">Nothing new.</div>`}
      </div>`
  }

  _updateBell() {
    const bell = document.getElementById('tk-bell')
    if (!bell) return
    bell.innerHTML = `🔔${this.unread > 0 ? `<span class="tk-bell-dot">${this.unread > 9 ? '9+' : this.unread}</span>` : ''}`
  }

  _bindBell(mc) {
    mc.querySelector('#tk-bell')?.addEventListener('click', async () => {
      this.notifOpen = !this.notifOpen
      if (this.notifOpen) {
        try {
          const data = await api.listNotifications(false)
          this.notifications = data.notifications
          this.unread = data.unread_notifications
        } catch (err) { this.app.toast(err.message || 'Could not load notifications') }
      }
      this._renderShell(mc)
    })

    mc.querySelector('#tk-notif-readall')?.addEventListener('click', async () => {
      try {
        await api.markRead({ all: true })
        this.notifications = this.notifications.map(n => ({ ...n, read_at: new Date().toISOString() }))
        this.unread = 0
        this._renderShell(mc)
      } catch (err) { this.app.toast(err.message || 'Could not update notifications') }
    })

    // Clicking an item opens the card and marks that one read.
    mc.querySelectorAll('[data-notif-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { notifId, notifTask } = btn.dataset
        this.notifOpen = false
        this.openDetail(notifTask)
        try {
          await api.markRead({ ids: [notifId] })
          const hit = this.notifications.find(n => n.id === notifId)
          if (hit && !hit.read_at) { hit.read_at = new Date().toISOString(); this.unread = Math.max(0, this.unread - 1) }
          this._updateBell()
        } catch { /* not worth a toast */ }
      })
    })
  }
}
