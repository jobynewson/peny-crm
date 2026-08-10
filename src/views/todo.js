// src/views/todo.js
// The Dashboard's personal to-do list. One list, two kinds of row:
//
//   • manual   — typed straight into the list. Stored in user_todos, keyed by
//                Clerk ID, so it is private to one person.
//   • assigned — outstanding tasks allocated to this user elsewhere in the app
//                (deliverables, marketing sub-tasks, canvas checklists, board
//                cards, post-production and calendar deadlines). Gathered on
//                each render by collectAssignedTasks() and never copied into
//                user_todos — the source feature stays the owner of the data.
//
// Ticking an assigned row writes the completion straight back to its source.
// Board cards and calendar deadlines have no completion flag of their own, so
// those rows render read-only with a link out to where the task lives.

import { collectAssignedTasks, describeDue } from '../utils/assigned-tasks.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

// Label shown on an assigned row's chip when the source has no better name.
const SOURCE_NAMES = {
  deliverable: 'Deliverable',
  marketing:   'Marketing',
  canvas:      'Canvas',
  board:       'Board',
  pps:         'Post',
  calendar:    'Calendar',
}

export class TodoView {
  constructor(app) {
    this.app = app
    this._todos = null            // manual rows, null until first load
    this._assigned = []
    this._canvasChecklists = []
    this._expanded = localStorage.getItem('todo_open') !== 'false'
  }

  // ── Dashboard section ───────────────────────────────────────────────────────

  renderDashboardSection(container) {
    let section = container.querySelector('#todo-section')
    if (!section) {
      section = document.createElement('div')
      section.id = 'todo-section'
      section.style.cssText = 'margin-bottom:28px'
      // Sits under the team calendar, above the project lists.
      const tc = container.querySelector('#tc-section')
      if (tc) tc.insertAdjacentElement('afterend', section)
      else container.prepend(section)
    }
    this._render(section)
    this._load(section)
  }

  async _load(section) {
    const app = this.app
    const { getUserTodos, getAssignedBoardCards, getCanvasChecklists, getPpsPhasesForCalendar } =
      await import('../db/client.js')

    const safe = (p, fallback) => p.catch(e => { console.error('To-do list source failed:', e); return fallback })

    // The PPS phases cache is shared with the team calendar — whichever section
    // renders first pays for the query.
    let ppsPhases = app.teamCalendarView?._ppsPhasesCache
    const [todos, boardCards, canvasChecklists, phases] = await Promise.all([
      safe(getUserTodos(app.clerkUserId), []),
      safe(getAssignedBoardCards(app.userId, app.appUser?.id), []),
      safe(getCanvasChecklists(app.userId), []),
      ppsPhases ? Promise.resolve(ppsPhases) : safe(getPpsPhasesForCalendar(app.userId), []),
    ])
    if (!ppsPhases && app.teamCalendarView) app.teamCalendarView._ppsPhasesCache = phases

    this._todos = todos
    this._canvasChecklists = canvasChecklists
    this._assigned = collectAssignedTasks({
      projects:            app.projects,
      marketingCards:      app.marketingCards,
      teamCalendarEntries: app.teamCalendarEntries,
      canvasChecklists,
      boardCards,
      ppsPhases:           phases,
      clerkId:             app.clerkUserId,
      appUserId:           app.appUser?.id,
    })

    // The dashboard may have been navigated away from while we were loading.
    if (!section.isConnected) return
    this._render(section)
  }

  _render(section) {
    // A background refresh must never eat something half-typed into the add box.
    const prevText = section.querySelector('#todo-new-text')
    const draft    = prevText?.value || ''
    const draftDue = section.querySelector('#todo-new-due')?.value || ''
    const hadFocus = prevText && document.activeElement === prevText

    const loading = this._todos === null
    const todos = this._todos ?? []
    const outstanding = todos.filter(t => !t.done).length + this._assigned.filter(t => !t._done).length
    const hasDone = todos.some(t => t.done)

    section.innerHTML = `
      <div class="db-section-head" id="todo-toggle" style="cursor:pointer">
        <span class="db-section-dot" style="background:#4a90d9"></span>
        My To-Do List
        ${outstanding ? `<span class="db-section-count">${outstanding}</span>` : ''}
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          ${hasDone ? `<button class="db-action-link" id="todo-clear-done" style="margin-top:0" title="Delete your ticked-off to-dos" onclick="event.stopPropagation()">Clear done</button>` : ''}
          <span class="db-chevron${this._expanded ? ' db-chevron--open' : ''}">▶</span>
        </div>
      </div>
      <div id="todo-body" style="display:${this._expanded ? 'block' : 'none'}">
        <div class="todo-list">
          <div class="todo-add">
            <input id="todo-new-text" class="todo-new-text" type="text" placeholder="Add a to-do…" maxlength="500" />
            <input id="todo-new-due" class="todo-due todo-due--empty" type="date" title="Due date (optional)" />
            <button class="btn-secondary todo-add-btn" id="todo-add-btn">Add</button>
          </div>
          ${loading
            ? `<div class="todo-empty">Loading…</div>`
            : this._rowsHtml(todos)}
        </div>
      </div>`

    if (draft) section.querySelector('#todo-new-text').value = draft
    if (draftDue) {
      const dueEl = section.querySelector('#todo-new-due')
      dueEl.value = draftDue
      dueEl.classList.remove('todo-due--empty')
    }

    this._bind(section)
    if (hadFocus) section.querySelector('#todo-new-text')?.focus()
  }

  // Manual and assigned rows interleave into one date-ordered list, so an
  // overdue deliverable can't hide underneath an undated note you typed:
  //   ticked rows sink → soonest due first → undated last → newest first.
  // The newest-first tie-break matches the order getUserTodos() hands back, so
  // a row you just added sits where a page reload would put it.
  _rowsHtml(todos) {
    const ts = v => { const t = new Date(v ?? 0).getTime(); return isNaN(t) ? 0 : t }
    const rows = [
      ...todos.map(t => ({ due: t.due_date || '', done: !!t.done, added: ts(t.created_at), html: () => this._manualRow(t) })),
      // Assigned rows have no "added" time of their own; 0 keeps them just
      // below your own rows when they share a due date.
      ...this._assigned.map(t => ({ due: t.due || '', done: !!t._done, added: 0, html: () => this._assignedRow(t) })),
    ]
    if (!rows.length) {
      return `<div class="todo-empty">Nothing on your list. Add one above — anything assigned to you elsewhere shows up here too.</div>`
    }
    rows.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      if (a.due !== b.due) { if (!a.due) return 1; if (!b.due) return -1; return a.due < b.due ? -1 : 1 }
      return b.added - a.added
    })
    return rows.map(r => r.html()).join('')
  }

  _manualRow(t) {
    return `
      <div class="todo-row${t.done ? ' todo-row--done' : ''}" data-todo-id="${esc(t.id)}">
        <input type="checkbox" class="todo-check" ${t.done ? 'checked' : ''} title="Mark done" />
        <input type="text" class="todo-text" value="${esc(t.title)}" maxlength="500" placeholder="To-do…" />
        <input type="date" class="todo-due${t.due_date ? '' : ' todo-due--empty'}" value="${esc(t.due_date || '')}" title="Due date" />
        <button class="todo-del" title="Delete">×</button>
      </div>`
  }

  _assignedRow(t) {
    const due = describeDue(t.due)
    const toneClass = due.tone === 'overdue' ? ' db-due-pill--overdue' : due.tone === 'today' ? ' db-due-pill--today' : ''
    const chip = t.sourceLabel || SOURCE_NAMES[t.source] || 'Slate'
    return `
      <div class="todo-row todo-row--assigned${t._done ? ' todo-row--done' : ''}" data-assigned-key="${esc(t.key)}">
        ${t.completable
          ? `<input type="checkbox" class="todo-check todo-check--assigned" ${t._done ? 'checked' : ''} title="Mark done" />`
          : `<span class="todo-bullet" title="Tick this one where it lives"></span>`}
        <span class="todo-text-static">${esc(t.text)}</span>
        <span class="todo-chip" title="${esc(SOURCE_NAMES[t.source] || '')} — ${esc(chip)}">${esc(chip)}</span>
        <span class="todo-due-slot">${due.label ? `<span class="db-due-pill${toneClass}">${esc(due.label)}</span>` : ''}</span>
        <button class="todo-open" title="Open where this lives">↗</button>
      </div>`
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  _bind(section) {
    section.querySelector('#todo-toggle')?.addEventListener('click', () => {
      this._expanded = !this._expanded
      localStorage.setItem('todo_open', String(this._expanded))
      this._render(section)
    })

    section.querySelector('#todo-clear-done')?.addEventListener('click', () => this._clearDone(section))

    // ── Add ──
    const textEl = section.querySelector('#todo-new-text')
    const dueEl  = section.querySelector('#todo-new-due')
    const add = () => this._add(section, textEl, dueEl)
    dueEl?.addEventListener('change', () => dueEl.classList.toggle('todo-due--empty', !dueEl.value))
    section.querySelector('#todo-add-btn')?.addEventListener('click', add)
    textEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add() } })
    dueEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add() } })

    // ── Manual rows ──
    section.querySelectorAll('[data-todo-id]').forEach(row => {
      const id = row.dataset.todoId
      const todo = (this._todos ?? []).find(t => t.id === id)
      if (!todo) return

      row.querySelector('.todo-check')?.addEventListener('change', async e => {
        todo.done = e.target.checked
        row.classList.toggle('todo-row--done', todo.done)
        await this._save(id, { done: todo.done })
        this._render(section)   // re-sort so ticked rows drop to the bottom
      })

      // Typed edits save on a debounce, and again on blur so a quick tab-away
      // can't lose the last keystrokes. `saved` keeps blur from re-writing text
      // that already went to the database.
      const text = row.querySelector('.todo-text')
      let saved = todo.title
      const flush = () => {
        clearTimeout(this._textTimer)
        if (!text || text.value === saved) return
        saved = text.value
        this._save(id, { title: saved })
      }
      text?.addEventListener('input', () => {
        todo.title = text.value
        clearTimeout(this._textTimer)
        this._textTimer = setTimeout(flush, 600)
      })
      text?.addEventListener('blur', flush)
      text?.addEventListener('keydown', e => { if (e.key === 'Enter') text.blur() })

      row.querySelector('.todo-due')?.addEventListener('change', async e => {
        todo.due_date = e.target.value || null
        await this._save(id, { due_date: todo.due_date })
        this._render(section)
      })

      row.querySelector('.todo-del')?.addEventListener('click', () => this._delete(section, id))
    })

    // ── Assigned rows ──
    section.querySelectorAll('[data-assigned-key]').forEach(row => {
      const task = this._assigned.find(t => t.key === row.dataset.assignedKey)
      if (!task) return

      row.querySelector('.todo-check--assigned')?.addEventListener('change', async e => {
        const checked = e.target.checked
        row.classList.toggle('todo-row--done', checked)
        const ok = await this._completeAssigned(task, checked)
        if (ok) {
          task._done = checked
          this.app.toast?.(checked ? '✓ Done' : 'Unmarked')
          this._render(section)   // re-sort so ticked rows drop to the bottom
        } else {
          e.target.checked = !checked
          row.classList.toggle('todo-row--done', !checked)
          this.app.toast?.("Couldn't save that — try it where the task lives")
        }
      })

      row.querySelector('.todo-open')?.addEventListener('click', () => this._openAssigned(task))
    })
  }

  // ── Manual row persistence ──────────────────────────────────────────────────

  async _add(section, textEl, dueEl) {
    const title = (textEl?.value || '').trim()
    if (!title) { textEl?.focus(); return }
    const due_date = dueEl?.value || null
    textEl.value = ''
    if (dueEl) dueEl.value = ''
    try {
      const { createUserTodo } = await import('../db/client.js')
      const row = await createUserTodo(this.app.clerkUserId, { title, due_date })
      this._todos = [...(this._todos ?? []), row]
      this._render(section)
      section.querySelector('#todo-new-text')?.focus()
    } catch (e) {
      console.error('Could not add to-do:', e)
      this.app.toast?.('Could not add that to-do')
      if (textEl) textEl.value = title
    }
  }

  async _save(id, data) {
    try {
      const { updateUserTodo } = await import('../db/client.js')
      await updateUserTodo(this.app.clerkUserId, id, data)
      return true
    } catch (e) {
      console.error('Could not save to-do:', e)
      this.app.toast?.('Could not save that to-do')
      return false
    }
  }

  async _delete(section, id) {
    const before = this._todos ?? []
    this._todos = before.filter(t => t.id !== id)
    this._render(section)
    try {
      const { deleteUserTodo } = await import('../db/client.js')
      await deleteUserTodo(this.app.clerkUserId, id)
    } catch (e) {
      console.error('Could not delete to-do:', e)
      this._todos = before
      this._render(section)
      this.app.toast?.('Could not delete that to-do')
    }
  }

  async _clearDone(section) {
    const before = this._todos ?? []
    this._todos = before.filter(t => !t.done)
    this._render(section)
    try {
      const { deleteDoneUserTodos } = await import('../db/client.js')
      await deleteDoneUserTodos(this.app.clerkUserId)
    } catch (e) {
      console.error('Could not clear done to-dos:', e)
      this._todos = before
      this._render(section)
      this.app.toast?.('Could not clear those to-dos')
    }
  }

  // ── Assigned rows: write the tick back to the source ────────────────────────

  async _completeAssigned(task, checked) {
    const app = this.app
    const { ref } = task
    try {
      const client = await import('../db/client.js')
      if (task.source === 'deliverable') {
        const project = (app.projects || []).find(p => p.id === ref.projectId)
        const arr = project?.[ref.field]
        if (!Array.isArray(arr) || !arr[ref.index]) return false
        arr[ref.index].done = checked
        await client.updateProject(app.userId, project.id, { [ref.field]: arr })
        return true
      }
      if (task.source === 'marketing') {
        const card = (app.marketingCards || []).find(c => c.id === ref.cardId)
        const subTasks = Array.isArray(card?.sub_tasks) ? card.sub_tasks : null
        const st = subTasks?.find(s => (ref.taskId ? s.id === ref.taskId : s.text === ref.text))
        if (!st) return false
        st.done = checked
        await client.updateMarketingCard(app.userId, card.id, { sub_tasks: subTasks })
        return true
      }
      if (task.source === 'canvas') {
        const item = this._canvasChecklists.find(i => i.id === ref.itemId)
        const subTasks = Array.isArray(item?.sub_tasks) ? item.sub_tasks : null
        const st = subTasks?.find(s => (ref.taskId ? s.id === ref.taskId : s.text === ref.text))
        if (!st) return false
        st.done = checked
        await client.updateCanvasItem(item.id, { sub_tasks: subTasks })
        return true
      }
      if (task.source === 'pps') {
        const phases = app.teamCalendarView?._ppsPhasesCache || []
        const phase = phases.find(p => p.id === ref.phaseId)
        const block = Array.isArray(phase?.blocks) ? phase.blocks.find(b => b.id === ref.blockId) : null
        if (!block) return false
        block.is_complete = checked
        await client.updatePpsPhase(phase.id, { blocks: phase.blocks })
        return true
      }
      return false
    } catch (e) {
      console.error('Could not save that task:', e)
      return false
    }
  }

  // ── Assigned rows: jump to where the task actually lives ────────────────────

  _openAssigned(task) {
    const app = this.app
    const { ref } = task
    switch (task.source) {
      case 'deliverable':
        app.openProject(ref.projectId, 'overview')
        break
      case 'pps':
        if (ref.projectId) app.openProject(ref.projectId, 'post-production')
        break
      case 'marketing':
        app.marketingView.pendingOpenCardId = ref.cardId
        app.navigate('marketing')
        break
      case 'canvas':
        app.currentView = 'planning'
        app.canvasView.openCanvas(ref.canvasId)
        break
      case 'board':
        app.currentView = 'planning'
        app.boardsView.openBoard(ref.boardId)
        break
      case 'calendar':
        app.navigate('calendar')
        break
    }
  }
}
