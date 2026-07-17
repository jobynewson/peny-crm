import { getCurrentUserId } from './auth/clerk.js'
import { getContacts, getProjects, getBudgets, upsertSettings } from './db/client.js'
import { ContactsView } from './views/contacts.js'
import { ProjectsView } from './views/projects.js'
import { BudgetsView, budTotal } from './views/budgets.js'
import { CallSheetsView } from './views/callsheets.js'
import { StoryPlannerView } from './views/story-planner.js'
import { MarketingView } from './views/marketing.js'
import { TimeTrackView } from './views/timetrack.js'
import { PasswordManagerView } from './views/password-manager.js'
import { TeamCalendarView } from './views/team-calendar.js'
import { LeaveView, pendingApprovalsFor } from './views/leave.js'
import { ExpensesView } from './views/expenses.js'
import { OffloadLogView } from './views/offload-log.js'
import { BoardsView } from './views/boards.js'
import { CanvasView } from './views/canvas.js'

export class App {
  constructor({ userId, clerkUserId, user, appUser, permissions, contacts, projects, budgets, settings, allUsers, socialPosts, marketingCards, teamCalendarEntries, leaveRequests, publicHolidays, onSignOut }) {
    this.userId         = userId
    this.clerkUserId    = clerkUserId
    this.user           = user
    this.appUser        = appUser
    this.permissions    = permissions
    this.contacts       = contacts ?? []
    this.projects       = projects ?? []
    this.budgets        = budgets  ?? []
    this.settings       = settings ?? {}
    this.allUsers       = allUsers ?? []
    this.socialPosts    = socialPosts ?? []
    this.marketingCards = marketingCards ?? []
    this.teamCalendarEntries = teamCalendarEntries ?? []
    this.leaveRequests  = leaveRequests ?? []
    this.publicHolidays = publicHolidays ?? []
    this.onSignOut      = onSignOut
    this.currentView    = 'dashboard'
    this.contactsView    = new ContactsView(this)
    this.projectsView    = new ProjectsView(this)
    this.budgetsView     = new BudgetsView(this)
    this.callSheetsView  = new CallSheetsView(this)
    this.storyPlannerView = new StoryPlannerView(this)
    this.marketingView   = new MarketingView(this)
    this.timeTrackView        = new TimeTrackView(this)
    this.passwordManagerView  = new PasswordManagerView(this)
    this.teamCalendarView     = new TeamCalendarView(this)
    this.expensesView         = new ExpensesView(this)
    this.leaveView            = new LeaveView(this)
    this.offloadLogView       = new OffloadLogView(this)
    this.boardsView           = new BoardsView(this)
    this.canvasView           = new CanvasView(this)
    window.app = this
  }

  mount(container) {
    this.container = container
    const saved = localStorage.getItem('slate-theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
    this._restoreFromHash()   // parse URL before first render
    this.render()
    this._bindKeyboard()
    this._bindDateRangeLinks()
    // Handle browser back/forward
    window.addEventListener('popstate', (e) => this._handlePopState(e))
    // Handle post-Google-OAuth redirect (?gc_connected=1 or ?gc_error=...)
    const urlParams = new URLSearchParams(location.search)
    if (urlParams.has('gc_connected')) {
      setTimeout(() => this.toast('Google Calendar connected!'), 400)
      history.replaceState(null, '', location.pathname + location.hash)
    } else if (urlParams.has('gc_error')) {
      const msg = urlParams.get('gc_error')
      setTimeout(() => this.toast(`Google Calendar error: ${msg || 'unknown'}`), 400)
      history.replaceState(null, '', location.pathname + location.hash)
    }
  }

  // When a start date in a range changes, keep its paired end date in step so the
  // end picker always opens on the start's month (no accidental May-vs-June slips).
  // An end input opts in via data-range-start="<start-input-id>".
  _bindDateRangeLinks() {
    document.addEventListener('change', e => {
      const start = e.target
      if (!(start instanceof HTMLInputElement) || start.type !== 'date' || !start.id || !start.value) return
      const end = document.querySelector(`input[type="date"][data-range-start="${CSS.escape(start.id)}"]`)
      if (!end) return
      end.min = start.value
      if (!end.value || end.value < start.value) end.value = start.value
    })
  }

  async _openDevRequest() {
    const isAdmin = this.appUser?.role === 'superadmin'
    const existing = document.getElementById('dev-req-overlay')
    if (existing) { existing.remove(); return }

    const overlay = document.createElement('div')
    overlay.id = 'dev-req-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'

    const { getDevRequests, addDevRequest, toggleDevRequest, deleteDevRequest } = await import('./db/client.js')
    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')

    const renderModal = async () => {
      let requests = []
      try {
        requests = isAdmin ? await getDevRequests() : []
      } catch(e) {
        console.error('Dev requests table may not exist yet:', e)
        // Continue with empty requests rather than crashing
      }
      const pending  = requests.filter(r => !r.done)
      const done     = requests.filter(r => r.done)

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:${isAdmin?'620px':'440px'};max-height:85vh;display:flex;flex-direction:column;overflow:hidden" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light);flex-shrink:0">
            <div>
              <div style="font-size:14px;font-weight:600">Dev request</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px">Suggest a feature or report an issue</div>
            </div>
            <button id="dev-req-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary);line-height:1;padding:4px">×</button>
          </div>

          <div style="padding:20px;display:flex;flex-direction:column;gap:10px;flex-shrink:0;border-bottom:1px solid var(--border-light)">
            <textarea id="dev-req-text" placeholder="Describe what you'd like added or changed…"
              style="width:100%;min-height:90px;padding:10px 12px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.5"></textarea>
            <div style="display:flex;justify-content:flex-end;gap:8px">
              <button class="btn-cancel" id="dev-req-cancel">Cancel</button>
              <button class="btn-primary" id="dev-req-submit">Submit request</button>
            </div>
            <div id="dev-req-msg" style="font-size:12px;display:none"></div>
          </div>

          ${isAdmin ? `
          <div style="overflow-y:auto;flex:1;min-height:0">
            ${pending.length === 0 && done.length === 0 ? `
              <div style="padding:24px;text-align:center;font-size:13px;color:var(--text-tertiary)">No requests yet</div>` : ''}

            ${pending.length > 0 ? `
            <div style="padding:12px 20px 4px;display:flex;align-items:center;justify-content:space-between">
              <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Pending · ${pending.length}</div>
              <button id="dev-req-copy" style="font-size:11px;color:var(--text-tertiary);background:none;border:1px solid var(--border-light);border-radius:5px;padding:3px 8px;cursor:pointer;font-family:var(--font)">Copy all</button>
            </div>
            ${pending.map(r => `
              <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 20px;border-bottom:1px solid var(--border-light)" data-rid="${r.id}">
                <input type="checkbox" data-done-req="${r.id}" style="margin-top:2px;cursor:pointer;flex-shrink:0" />
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;line-height:1.5">${esc(r.message)}</div>
                  <div style="font-size:10px;color:var(--text-tertiary);margin-top:3px">${r.user_name||r.user_id} · ${new Date(r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
                </div>
                <button data-del-req="${r.id}" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:14px;flex-shrink:0;padding:0 2px" title="Delete">×</button>
              </div>`).join('')}` : ''}

            ${done.length > 0 ? `
            <div style="padding:12px 20px 4px;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Done · ${done.length}</div>
            ${done.map(r => `
              <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 20px;border-bottom:1px solid var(--border-light);opacity:0.5" data-rid="${r.id}">
                <input type="checkbox" checked data-done-req="${r.id}" style="margin-top:2px;cursor:pointer;flex-shrink:0" />
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;line-height:1.5;text-decoration:line-through">${esc(r.message)}</div>
                  <div style="font-size:10px;color:var(--text-tertiary);margin-top:3px">${r.user_name||r.user_id} · ${new Date(r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
                </div>
                <button data-del-req="${r.id}" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:14px;flex-shrink:0;padding:0 2px" title="Delete">×</button>
              </div>`).join('')}` : ''}
          </div>` : ''}
        </div>`

      // Close
      overlay.querySelector('#dev-req-close')?.addEventListener('click', () => overlay.remove())
      overlay.querySelector('#dev-req-cancel')?.addEventListener('click', () => overlay.remove())

      // Submit
      overlay.querySelector('#dev-req-submit')?.addEventListener('click', async () => {
        const msg = overlay.querySelector('#dev-req-text')?.value.trim()
        const msgEl = overlay.querySelector('#dev-req-msg')
        if (!msg) { if (msgEl) { msgEl.style.display='block'; msgEl.style.color='var(--text-tertiary)'; msgEl.textContent='Please enter a message' } return }
        try {
          const name = this.appUser?.name || this.user?.primaryEmailAddress?.emailAddress || this.clerkUserId
          await addDevRequest(this.clerkUserId, name, msg)
          overlay.querySelector('#dev-req-text').value = ''
          if (msgEl) { msgEl.style.display='block'; msgEl.style.color='#6ec96e'; msgEl.textContent='✓ Request submitted' }
          setTimeout(() => { if (msgEl) msgEl.style.display='none' }, 2500)
          if (isAdmin) renderModal()
        } catch(e) { console.error(e); if (msgEl) { msgEl.style.display='block'; msgEl.style.color='#e07070'; msgEl.textContent='Error submitting' } }
      })

      // Submit only via the button — Enter inserts a newline as normal.

      // Admin: copy all to clipboard
      overlay.querySelector('#dev-req-copy')?.addEventListener('click', async () => {
        const text = requests.map(r => {
          const status = r.done ? '[done]' : '[pending]'
          const date = new Date(r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
          return `${status} ${r.message}  —  ${r.user_name||r.user_id}, ${date}`
        }).join('\n')
        await navigator.clipboard.writeText(text)
        const btn = overlay.querySelector('#dev-req-copy')
        if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = 'Copy all' }, 1500) }
      })

      // Admin: mark done toggle
      overlay.querySelectorAll('[data-done-req]').forEach(cb => {
        cb.addEventListener('change', async () => {
          await toggleDevRequest(cb.dataset.doneReq, cb.checked)
          renderModal()
        })
      })

      // Admin: delete
      overlay.querySelectorAll('[data-del-req]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await deleteDevRequest(btn.dataset.delReq)
          renderModal()
        })
      })
    }

    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    try { await renderModal() } catch(e) { console.error(e); overlay.remove() }
  }

  _openSearch() {
    // Remove existing if open (toggle)
    const existing = document.getElementById('search-overlay')
    if (existing) { existing.remove(); return }

    const overlay = document.createElement('div')
    overlay.id = 'search-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:flex-start;justify-content:center;padding-top:15vh;z-index:9999;cursor:pointer'

    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')

    const render = (query = '') => {
      const q = query.toLowerCase().trim()
      const results = []

      if (q.length > 0) {
        // Contacts
        this.contacts.forEach(c => {
          const text = `${c.first_name} ${c.last_name} ${c.company||''} ${c.email||''}`.toLowerCase()
          if (text.includes(q)) results.push({ type:'contact', label:`${c.first_name} ${c.last_name}`, sub: c.company||c.email||'', id: c.id })
        })
        // Projects
        this.projects.forEach(p => {
          const cl = this.contacts.find(c => c.id === p.client_id)
          const text = `${p.name} ${cl?.company||''} ${cl?.first_name||''} ${cl?.last_name||''}`.toLowerCase()
          if (text.includes(q)) results.push({ type:'project', label: p.name, sub: cl ? `${cl.first_name} ${cl.last_name}` : p.status, id: p.id })
        })
        // Budgets
        this.budgets.forEach(b => {
          const cl = this.contacts.find(c => c.id === b.client_id)
          const text = `${b.name} ${cl?.company||''} ${cl?.first_name||''} ${cl?.last_name||''}`.toLowerCase()
          if (text.includes(q)) results.push({ type:'budget', label: b.name, sub: cl ? `${cl.first_name} ${cl.last_name}` : '', id: b.id })
        })
        // Marketing cards
        ;(this.marketingCards || []).forEach(card => {
          const text = `${card.title||''} ${card.notes||''} ${card.card_type||''}`.toLowerCase()
          if (text.includes(q)) results.push({ type:'marketing', label: card.title || 'Untitled card', sub: (card.card_type||'').replace(/-/g,' '), card })
        })
        // Shoots (lazily loaded — see below)
        ;(this._searchShootsCache || []).forEach(sh => {
          const text = `${sh.name||''} ${sh.project_name||''}`.toLowerCase()
          if (text.includes(q)) results.push({ type:'shoot', label: sh.name || 'Untitled shoot', sub: sh.project_name || '', projectId: sh.project_id })
        })
        // Notes
        ;(this._notes || []).forEach(n => {
          const title = (n.title||'').trim(), content = (n.content||'').trim()
          if (!title && !content) return
          const text = `${title} ${content}`.toLowerCase()
          if (text.includes(q)) results.push({ type:'note', label: title || 'Untitled note', sub: content ? content.replace(/\s+/g,' ').slice(0,60) : '', id: n.id })
        })
      }

      const typeIcon   = { contact:'👤', project:'🎬', budget:'£', marketing:'📣', shoot:'🎥', note:'📝' }
      const typeColour = { contact:'#a78bfa', project:'#4a90d9', budget:'#6ec96e', marketing:'#f59e0b', shoot:'#ef4444', note:'#8590A2' }
      const typeLabel  = { contact:'Contact', project:'Project', budget:'Budget', marketing:'Card', shoot:'Shoot', note:'Note' }

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:520px;overflow:hidden;cursor:default;box-shadow:0 20px 60px rgba(0,0,0,0.4)" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border-light)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            <input id="search-input" placeholder="Search contacts, projects, budgets, cards, shoots, notes…" value="${esc(query)}"
              style="flex:1;background:transparent;border:none;outline:none;font-size:15px;color:var(--text-primary);font-family:var(--font)" autofocus />
            <kbd style="font-size:11px;color:var(--text-tertiary);background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:2px 6px">Esc</kbd>
          </div>
          <div id="search-results" style="max-height:360px;overflow-y:auto">
            ${q.length === 0 ? `<div style="padding:24px;text-align:center;font-size:13px;color:var(--text-tertiary)">Start typing to search across all records</div>`
            : results.length === 0 ? `<div style="padding:24px;text-align:center;font-size:13px;color:var(--text-tertiary)">No results for "${esc(query)}"</div>`
            : results.map((r,i) => `
              <div data-result="${i}" style="display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;border-bottom:1px solid var(--border-light);transition:background 0.1s"
                onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
                <span style="font-size:16px;flex-shrink:0">${typeIcon[r.type]}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.label)}</div>
                  ${r.sub ? `<div style="font-size:11px;color:var(--text-tertiary)">${esc(r.sub)}</div>` : ''}
                </div>
                <span style="font-size:10px;color:${typeColour[r.type]};background:${typeColour[r.type]}22;border-radius:var(--radius-md);padding:2px 7px;flex-shrink:0">${typeLabel[r.type] ?? r.type}</span>
              </div>`).join('')}
          </div>
          ${q.length > 0 && results.length > 0 ? `<div style="padding:8px 16px;font-size:11px;color:var(--text-tertiary);border-top:1px solid var(--border-light)">${results.length} result${results.length!==1?'s':''}</div>` : ''}
        </div>`

      // Input handler
      const input = overlay.querySelector('#search-input')
      input?.addEventListener('input', e => render(e.target.value))
      input?.addEventListener('keydown', e => {
        if (e.key === 'Escape') { overlay.remove() }
        if (e.key === 'Enter' && results.length > 0) {
          overlay.querySelector('[data-result="0"]')?.click()
        }
      })
      setTimeout(() => input?.focus(), 10)

      // Click result
      overlay.querySelectorAll('[data-result]').forEach(el => {
        el.addEventListener('click', () => {
          const r = results[+el.dataset.result]
          overlay.remove()
          if (r.type === 'contact') { this.navigate('contacts'); setTimeout(() => this.contactsView.selectContact(r.id), 50) }
          else if (r.type === 'project') { this.openProject(r.id) }
          else if (r.type === 'budget') { this.openBudget(r.id) }
          else if (r.type === 'marketing') { this.navigate('marketing'); setTimeout(() => this.marketingView.openCardModal(r.card, r.card.status), 60) }
          else if (r.type === 'shoot') {
            // The Shoots tab is hidden on post-production projects — land on a
            // visible tab in that case so the project view isn't left blank.
            const proj = this.projects.find(p => p.id === r.projectId)
            const tab = (proj?.project_type === 'post_production') ? 'overview' : 'shoots'
            this.currentView = 'projects'
            this.projectsView.currentId = r.projectId
            this.projectsView._pvTab = tab
            this.projectsView.editingId = null
            history.pushState({ view:'projects' }, '', `#projects/${r.projectId}/${tab}`)
            this.render()
          }
          else if (r.type === 'note') { this._openNoteFromSearch(r.id) }
        })
      })
    }

    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    render()

    // Shoots aren't held in memory globally — lazily load them once, then
    // re-render so they join the index without blocking the palette opening.
    if (this._searchShootsCache == null && !this._searchShootsLoading) {
      this._searchShootsLoading = true
      import('./db/client.js')
        .then(({ getShootsForCalendar }) => getShootsForCalendar(this.userId))
        .then(rows => {
          this._searchShootsCache = rows || []
          this._searchShootsLoading = false
          const input = document.querySelector('#search-overlay #search-input')
          if (input && input.value.trim()) render(input.value)
        })
        .catch(e => { console.error('Search shoots load failed:', e); this._searchShootsCache = []; this._searchShootsLoading = false })
    }
  }

  // Open and focus a note from a global-search result (notes live in the sidebar).
  _openNoteFromSearch(id) {
    if (!this._openNoteIds) this._openNoteIds = new Set()
    this._openNoteIds.add(id)
    this._renderNotesList()
    const card = document.querySelector(`.notes-card[data-note-id="${id}"]`)
    if (card) {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' })
      card.querySelector('.notes-title-input')?.focus()
    }
  }

  _bindKeyboard() {
    document.addEventListener('keydown', e => {
      // Escape closes any open floating modal/dialog first — even while a field
      // inside it is focused — so it never falls through to "go back".
      if (e.key === 'Escape') {
        const floatingModal = document.querySelector('#tc-modal, #pps-block-modal, #pps-col-modal, #dev-req-overlay, #shortcut-overlay, #bd-card-modal, #bd-col-modal, #bd-rec-modal, #bd-new-modal, #cv-item-modal, #cv-new-modal, #cv-image-modal')
        if (floatingModal) { floatingModal.remove(); return }
      }

      // Don't fire shortcuts when typing in an input/textarea/select
      const tag = document.activeElement?.tagName
      if (['INPUT','TEXTAREA','SELECT'].includes(tag)) {
        // Only handle Escape from inputs
        if (e.key === 'Escape') document.activeElement.blur()
        return
      }

      const meta = e.metaKey || e.ctrlKey

      // Cmd/Ctrl+K — global search
      if (meta && e.key === 'k') {
        e.preventDefault()
        this._openSearch()
        return
      }

      // Cmd/Ctrl+S — save (exit edit mode)
      if (meta && e.key === 's') {
        e.preventDefault()
        if (this.currentView === 'projects' && this.projectsView.editingId) {
          document.querySelector('#pe-save-close')?.click()
        } else if (this.currentView === 'budgets' && this.budgetsView.editingId) {
          document.querySelector('#be-save-close')?.click()
        } else if (this.currentView === 'settings') {
          document.querySelector('[data-settings-primary-save]')?.click()
        }
        return
      }

      // Escape — close modals, exit edit mode, go back
      if (e.key === 'Escape') {
        // Close search overlay first
        const searchOverlay = document.getElementById('search-overlay')
        if (searchOverlay) { searchOverlay.remove(); return }
        // Close any open modal first
        const openModal = document.querySelector('.modal-backdrop.open')
        if (openModal) { openModal.classList.remove('open'); return }
        // Exit edit mode → viewer
        if (this.currentView === 'projects' && this.projectsView.editingId) {
          document.querySelector('#pe-save-close')?.click(); return
        }
        if (this.currentView === 'budgets' && this.budgetsView.editingId) {
          document.querySelector('#be-save-close')?.click(); return
        }
        // Back from viewer → list
        if (this.currentView === 'projects' && this.projectsView.currentId) {
          document.querySelector('#back-to-kanban')?.click(); return
        }
        if (this.currentView === 'budgets' && this.budgetsView.currentId) {
          document.querySelector('#bv-back')?.click(); return
        }
        return
      }

      // N — new item (only on list views, not when viewing a record)
      if (e.key === 'n' && !meta) {
        if (this.currentView === 'contacts' && this.permissions?.contacts_edit) {
          document.querySelector('#topbar-btn')?.click()
        } else if (this.currentView === 'projects' && !this.projectsView.currentId && this.permissions?.projects_edit) {
          document.querySelector('#topbar-btn')?.click()
        } else if (this.currentView === 'budgets' && !this.budgetsView.currentId && this.permissions?.budgets_edit) {
          document.querySelector('#topbar-btn')?.click()
        }
      }
    })
  }

  render() {
    const showDetail = this.currentView === 'contacts'
    const collapsed = this._sidebarCollapsed()
    this.container.innerHTML = `
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <div class="sidebar${collapsed ? ' collapsed' : ''}" id="app-sidebar">
        <div class="logo">
          <img src="/slate-logo.png" alt="Slate" />
          <button class="sidebar-collapse-btn" id="sidebar-collapse-btn" aria-label="Toggle sidebar" title="${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}">${this.iconCollapse()}</button>
        </div>
        <div class="nav-label">Main</div>
        ${[['dashboard','Dashboard',this.iconPipeline()],['calendar','Calendar',this.iconCalendar()],['contacts','Contacts',this.iconContacts()],['projects','Projects',this.iconProjects()],['budgets','Budgets',this.iconBudgets()],['planning','Planning',this.iconPlanning()],['marketing','Marketing',this.iconMarketing()],['story-planner','Story Planner',this.iconStoryPlanner()]].map(([id,label,icon])=>`
          <div class="nav-item ${this.currentView===id?'active':''}" data-view="${id}" title="${label}">${icon}<span class="nav-text">${label}</span></div>`).join('')}
        <div class="sidebar-notes">
          <div class="sidebar-notes-header">
            <span class="sidebar-notes-title">Notes</span>
            <button id="notes-new-btn" class="sidebar-notes-new-btn">+ New</button>
          </div>
          <div class="notes-list" id="notes-list"><div class="notes-empty">No notes yet.<br>Hit + New to get started.</div></div>
        </div>
        <div class="nav-bottom">
          <div class="sidebar-tt" id="sidebar-tt">${this._renderSidebarTT()}</div>
          <div class="nav-item ${this.currentView==='leave'?'active':''}" data-view="leave" title="Leave">${this.iconLeave()}<span class="nav-text">Leave</span>${this._leaveBadgeHtml()}</div>
          <div class="nav-item ${this.currentView==='expenses'?'active':''}" data-view="expenses" title="Expenses">${this.iconExpenses()}<span class="nav-text">Expenses</span></div>
          ${(this.permissions?.vault || this.appUser?.role === 'superadmin') ? `<div class="nav-item ${this.currentView==='password-manager'?'active':''}" data-view="password-manager" title="Passwords">${this.iconPasswordManager()}<span class="nav-text">Passwords</span></div>` : ''}
          <div class="nav-item nav-item--dim ${this.currentView==='offload-log'?'active':''}" data-view="offload-log" title="Offload Log">${this.iconOffloads()}<span class="nav-text">Offload Log</span></div>
          ${this.permissions.settings ? `<div class="nav-item" data-view="settings" title="Settings">${this.iconSettings()}<span class="nav-text">Settings</span></div>` : ''}
          <div class="nav-item nav-item--dim" id="dev-request-btn" title="Dev request">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5"/><path d="M8 5v4M8 11v.5"/></svg>
            <span class="nav-text">Dev request</span>
          </div>
          <div class="nav-item nav-item--dim" id="sign-out-btn" title="Sign out">${this.iconSignOut()}<span class="nav-text">Sign out</span></div>
        </div>
      </div>
      <div class="main">
        <div class="topbar">
          <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Toggle navigation">${this.iconHamburger()}</button>
          <div class="topbar-title" id="view-title">${this.viewTitle()}</div>
          <div id="topbar-actions" style="display:flex;gap:8px;align-items:center;flex-shrink:0">${this.topbarSearch()}${this.topbarButton()}
            <button class="theme-toggle" id="theme-toggle-btn" title="Toggle dark mode">${this.iconTheme()}</button>
            <button id="shortcut-hint" class="theme-toggle" title="Keyboard shortcuts">?</button>
          </div>
        </div>
        <div class="content" id="main-content"></div>
      </div>
      ${showDetail ? `<div class="detail-panel" id="detail-panel"><div class="detail-empty">Select a contact<br>to view details</div></div>` : ''}
    `
    this.bindNav()
    this.renderCurrentView()
    if (this._notesLoaded) this._renderNotesList()
    else this._loadNotes()
  }

  topbarSearch() {
    if (this.currentView !== 'contacts') return ''
    return `<div class="search-wrap"><span class="search-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg></span><input type="text" id="contact-search" placeholder="Search contacts…" /></div>`
  }

  topbarButton() {
    const p = this.permissions ?? {}
    if (this.currentView === 'contacts') {
      return p.contacts_edit ? `<button class="btn-primary" id="topbar-btn">+ New contact</button>` : ''
    }
    if (this.currentView === 'budgets') {
      if (!this.budgetsView.currentId) return p.budgets_edit ? `<button class="btn-primary" id="topbar-btn">+ New budget</button>` : ''
      if (this.budgetsView.editingId) return `<button class="btn-secondary" id="topbar-btn">← All budgets</button>`
      return ''
    }
    if (this.currentView === 'projects') {
      if (!this.projectsView.currentId) return p.projects_edit ? `<button class="btn-primary" id="topbar-btn">+ New project</button>` : ''
      if (this.projectsView.editingId) return `<button class="btn-secondary" id="topbar-btn">← All projects</button>`
      return ''
    }
    if (this.currentView === 'marketing') {
      return `<button class="btn-primary" id="topbar-btn">+ New card</button>`
    }
    if (this.currentView === 'planning') {
      if (this.boardsView.currentId || this.canvasView.currentId) return ''
      if (!p.projects_edit) return ''
      const label = this.boardsView.activeTab === 'canvases' ? '+ New canvas' : '+ New board'
      return `<button class="btn-primary" id="topbar-btn">${label}</button>`
    }
    if (this.currentView === 'story-planner' && !this.storyPlannerView?.currentPlanId) {
      return `<button class="btn-primary" id="topbar-btn">+ New plan</button>`
    }
    return ''
  }


  _closeMobileSidebar() {
    document.getElementById('app-sidebar')?.classList.remove('open')
    document.getElementById('sidebar-overlay')?.classList.remove('open')
  }

  // Whether the desktop sidebar is collapsed to an icon-only rail (persisted).
  _sidebarCollapsed() {
    return localStorage.getItem('slate-sidebar-collapsed') === '1'
  }

  _toggleSidebarCollapsed() {
    const sidebar = document.getElementById('app-sidebar')
    if (!sidebar) return
    const collapsed = sidebar.classList.toggle('collapsed')
    localStorage.setItem('slate-sidebar-collapsed', collapsed ? '1' : '0')
    const btn = document.getElementById('sidebar-collapse-btn')
    if (btn) btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  }

  bindNav() {
    // Mobile sidebar toggle
    const menuBtn  = this.container.querySelector('#mobile-menu-btn')
    const sidebar  = this.container.querySelector('#app-sidebar')
    const overlay  = this.container.querySelector('#sidebar-overlay')
    if (menuBtn && sidebar && overlay) {
      menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open')
        overlay.classList.toggle('open')
      })
      overlay.addEventListener('click', () => this._closeMobileSidebar())
    }

    // Desktop sidebar collapse/expand toggle
    this.container.querySelector('#sidebar-collapse-btn')?.addEventListener('click', () => this._toggleSidebarCollapsed())

    this.container.querySelectorAll('.nav-item[data-view]').forEach(el => {
      el.addEventListener('click', () => { this._closeMobileSidebar(); this.navigate(el.dataset.view) })
    })
    this.container.querySelector('#sign-out-btn')?.addEventListener('click', () => { this._closeMobileSidebar(); this.onSignOut() })
    this.container.querySelector('#dev-request-btn')?.addEventListener('click', () => { this._closeMobileSidebar(); this._openDevRequest() })

    // Dark mode toggle
    const toggleBtn = this.container.querySelector('#theme-toggle-btn')
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
        const next = isDark ? 'light' : 'dark'
        document.documentElement.setAttribute('data-theme', next)
        localStorage.setItem('slate-theme', next)
        toggleBtn.innerHTML = this.iconTheme()
      })
    }

    this.bindTopbarBtn()
    this._bindSidebarTT()
    const search = this.container.querySelector('#contact-search')
    if (search) {
      search.value = this.contactsView.search
      search.addEventListener('input', e => { this.contactsView.search = e.target.value; this.contactsView.refreshList() })
    }

    // Notes new button
    this.container.querySelector('#notes-new-btn')?.addEventListener('click', () => this._newNote())

    // Keyboard shortcut hint
    this.container.querySelector('#shortcut-hint')?.addEventListener('click', () => {
      let overlay = document.getElementById('shortcut-overlay')
      if (overlay) { overlay.remove(); return }
      overlay = document.createElement('div')
      overlay.id = 'shortcut-overlay'
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer'
      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);padding:28px 32px;width:320px;cursor:default" onclick="event.stopPropagation()">
          <div style="font-size:13px;font-weight:600;margin-bottom:16px">Keyboard shortcuts</div>
          ${[
            ['⌘K', 'Search everything'],
            ['N', 'New project / budget / contact'],
            ['Esc', 'Close modal / exit edit / go back'],
            ['⌘S', 'Save & close current editor'],
          ].map(([key,desc]) => `
            <div style="display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--border-light)">
              <kbd style="font-size:11px;font-family:monospace;background:var(--bg-secondary);border:1px solid var(--border-med);border-radius:5px;padding:3px 8px;color:var(--text-secondary);white-space:nowrap">${key}</kbd>
              <span style="font-size:13px;color:var(--text-secondary)">${desc}</span>
            </div>`).join('')}
          <div style="margin-top:14px;font-size:11px;color:var(--text-tertiary);text-align:center">Click anywhere to close</div>
        </div>`
      overlay.addEventListener('click', () => overlay.remove())
      document.body.appendChild(overlay)
    })
  }

  bindTopbarBtn() {
    const btn = this.container.querySelector('#topbar-btn')
    if (!btn) return
    btn.addEventListener('click', () => {
      const mc = document.getElementById('main-content')
      if (this.currentView === 'contacts') { this.contactsView.openAdd(mc) }
      else if (this.currentView === 'budgets') {
        if (this.budgetsView.editingId) { this.budgetsView.editingId = null; this.render() }
        else if (!this.budgetsView.currentId) this.budgetsView.openNewModal()
      }
      else if (this.currentView === 'projects') {
        if (this.projectsView.editingId) { this.projectsView.editingId = null; this.render() }
        else if (!this.projectsView.currentId) this.projectsView.openNewModal(null, null, mc)
      }
      else if (this.currentView === 'marketing') {
        this.marketingView.openCardModal(null, this.marketingView.activeTab === 'kanban' ? 'ideas' : 'ideas')
      }
      else if (this.currentView === 'planning') {
        if (this.boardsView.currentId || this.canvasView.currentId) return
        if (this.boardsView.activeTab === 'canvases') this.canvasView.openNewCanvasModal()
        else this.boardsView.openNewBoardModal()
      }
      else if (this.currentView === 'story-planner') {
        this.storyPlannerView.openNewPlanModal(document.getElementById('main-content'))
      }
    })
  }

  navigate(view) {
    if (view !== 'dashboard') { clearInterval(this._cdInterval); this._cdInterval = null; document.getElementById('cd-confetti-layer')?.remove() }
    this.currentView = view
    this.projectsView.currentId = null
    this.projectsView.editingId = null
    this.budgetsView.currentId  = null
    this.budgetsView.editingId  = null
    this.storyPlannerView.currentPlanId = null
    this.storyPlannerView.plan = null
    this.boardsView.currentId = null
    this.boardsView.board = null
    this.canvasView.currentId = null
    this.canvasView.canvas = null
    history.pushState({ view }, '', `#${view}`)
    this.render()
  }

  // Push a URL state for a specific sub-location (called by views)
  _pushAppState(hash, state = {}) {
    history.pushState(state, '', hash)
  }

  // Parse the URL hash and restore view state before first render
  _restoreFromHash() {
    const hash = location.hash.slice(1)
    if (!hash) return
    const parts = hash.split('/')
    const view = parts[0], id = parts[1], tab = parts[2]
    const validViews = ['contacts','projects','budgets','settings','dashboard','calendar','marketing','timetrack','story-planner','password-manager','expenses','leave','offload-log','planning']
    if (!validViews.includes(view)) return
    this.currentView = view
    if (view === 'projects' && id) {
      this.projectsView.currentId = id
      if (tab) this.projectsView._pvTab = tab
    }
    if (view === 'budgets' && id) this.budgetsView.currentId = id
    if (view === 'planning' && id) {
      // #planning/<boardId> or #planning/canvas/<canvasId>
      if (id === 'canvas' && tab) this.canvasView.currentId = tab
      else this.boardsView.currentId = id
    }
  }

  // Handle browser back / forward button
  _handlePopState(e) {
    const shootOverlay = document.getElementById('shoot-editor-overlay')
    if (shootOverlay) { shootOverlay.remove(); return }
    const modal = document.querySelector('.modal-overlay, #ra-copy-picker, #rig-lib-picker')
    if (modal) { modal.remove(); return }

    const hash = location.hash.slice(1)
    const parts = (hash || 'dashboard').split('/')
    const view = parts[0], id = parts[1], tab = parts[2]
    const validViews = ['contacts','projects','budgets','settings','dashboard','calendar','marketing','timetrack','story-planner','password-manager','expenses','leave','offload-log','planning']
    if (!validViews.includes(view)) { this.currentView = 'dashboard'; this.render(); return }

    this.currentView = view
    this.projectsView.currentId = (view === 'projects' && id) ? id : null
    this.projectsView._pvTab = tab || 'overview'
    this.projectsView.editingId = null
    this.budgetsView.currentId  = (view === 'budgets' && id) ? id : null
    this.budgetsView.editingId  = null
    this.boardsView.currentId   = (view === 'planning' && id && id !== 'canvas') ? id : null
    this.canvasView.currentId   = (view === 'planning' && id === 'canvas' && tab) ? tab : null
    this.render()
  }

  renderCurrentView() {
    const mc = document.getElementById('main-content')
    if (!mc) return
    const p = this.permissions ?? {}
    const locked = (msg) => { mc.innerHTML = `<div class="empty-state" style="padding-top:80px">🔒 ${msg}</div>` }
    if (this.currentView === 'contacts') {
      if (!p.contacts_view) return locked("You don't have access to Contacts.")
      this.contactsView.render(mc)
    } else if (this.currentView === 'projects') {
      if (!p.projects_view) return locked("You don't have access to Projects.")
      this.projectsView.render(mc)
    } else if (this.currentView === 'budgets') {
      if (!p.budgets_view) return locked("You don't have access to Budgets.")
      this.budgetsView.render(mc)
    } else if (this.currentView === 'callsheets') {
      this.callSheetsView.renderList(mc, this.callSheetsView.currentProjectId)
    } else if (this.currentView === 'story-planner') {
      this.storyPlannerView.render(mc)
    } else if (this.currentView === 'marketing') {
      this.marketingView.render(mc)
    } else if (this.currentView === 'planning') {
      if (!p.projects_view) return locked("You don't have access to Planning.")
      if (this.canvasView.currentId) this.canvasView.render(mc)
      else this.boardsView.render(mc)
    } else if (this.currentView === 'timetrack') {
      this.timeTrackView.render(mc)
    } else if (this.currentView === 'password-manager') {
      if (!(p.vault || this.appUser?.role === 'superadmin')) return locked("You don't have access to Passwords.")
      this.passwordManagerView.render(mc)
    } else if (this.currentView === 'expenses') {
      this.expensesView.render(mc)
    } else if (this.currentView === 'offload-log') {
      this.offloadLogView.render(mc)
    } else if (this.currentView === 'leave') {
      this.leaveView.render(mc)
    } else if (this.currentView === 'calendar') {
      this.teamCalendarView.renderFullPage(mc)
    } else if (this.currentView === 'dashboard') {
      this.renderDashboard(mc)
    } else {
      this.renderSettings(mc)
    }
  }

  viewTitle() {
    if (this.currentView === 'projects' && this.projectsView?.currentId) return this.projects.find(p=>p.id===this.projectsView.currentId)?.name ?? 'Project'
    if (this.currentView === 'budgets'  && this.budgetsView?.currentId)  return this.budgets.find(b=>b.id===this.budgetsView.currentId)?.name  ?? 'Budget'
    if (this.currentView === 'planning' && this.canvasView?.currentId)   return this.canvasView.canvas?.name ?? 'Planning'
    if (this.currentView === 'planning' && this.boardsView?.currentId)   return this.boardsView.board?.name ?? 'Planning'
    return {contacts:'Contacts',projects:'Projects',budgets:'Budgets',dashboard:'Dashboard',calendar:'Team Calendar',settings:'Settings',marketing:'Marketing',planning:'Planning',timetrack:'Time tracker','story-planner':'Story Planner','password-manager':'Passwords',expenses:'Expenses',leave:'Leave','offload-log':'Offload Log'}[this.currentView] ?? ''
  }

  updateTitle() {
    const el = document.getElementById('view-title')
    if (el) el.textContent = this.viewTitle()
    const actions = document.getElementById('topbar-actions')
    if (actions) actions.innerHTML = this.topbarSearch() + this.topbarButton()
    const search = document.getElementById('contact-search')
    if (search) search.addEventListener('input', e => { this.contactsView.search = e.target.value; this.contactsView.refreshList() })
    this.bindTopbarBtn()
  }

  openProject(id, tab) {
    this.currentView = 'projects'
    this.projectsView.currentId = id
    if (tab) {
      this.projectsView._pvTab = tab
      this._pushAppState(`#projects/${id}/${tab}`, { view: 'projects', id, tab })
    }
    this.render()
  }
  openBudget(id)  { this.currentView = 'budgets';  this.budgetsView.currentId  = id; this.render() }

  // Returns [periodStart, periodEnd] Date objects for the current retainer period
  _retainerPeriod(retainerStart) {
    if (!retainerStart) return [null, null]
    const anchor = new Date(retainerStart)
    const day = anchor.getUTCDate()
    const now = new Date()
    const y = now.getUTCFullYear(), m = now.getUTCMonth()
    // Current period starts on `day` of this month (or last month if we haven't hit it yet)
    let start = new Date(Date.UTC(y, m, day))
    if (start > now) start = new Date(Date.UTC(y, m - 1, day))
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day))
    return [start, end]
  }

  _retainerPreviousPeriod(retainerStart) {
    const [currentStart] = this._retainerPeriod(retainerStart)
    if (!currentStart) return [null, null]
    const prevStart = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - 1, currentStart.getUTCDate()))
    return [prevStart, currentStart]
  }

  // ── Sidebar quick-log widget ─────────────────────────────────────────────────

  _sttTrackableLines(project) {
    if (!project) return []
    const lines = []
    if (project.is_retainer && (project.retainer_items || []).length) {
      for (const item of project.retainer_items) {
        if (item.label) lines.push({ label: item.label, budgetId: null })
      }
    } else {
      for (const bid of (project.budget_ids || [])) {
        const b = this.budgets.find(x => x.id === bid)
        if (!b) continue
        for (const s of (b.sections || [])) {
          if (!s.enabled) continue
          for (const l of (s.lines || [])) {
            if (!l.track_time || !l.item) continue
            lines.push({ label: l.item, budgetId: b.id })
          }
        }
      }
    }
    return lines
  }

  _renderSidebarTT() {
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    const savedPid  = localStorage.getItem('tt-project-id') || ''
    const savedTask = localStorage.getItem('tt-task-label') || ''
    const projects  = (this.projects || []).filter(p => p.status !== 'Delivered')
    const project   = projects.find(p => p.id === savedPid) || null
    const lines     = this._sttTrackableLines(project)

    return `
      <div class="stt-label">
        ${this.iconTimeTrack()} Time
      </div>
      <select id="stt-project" class="stt-select">
        <option value="">Project…</option>
        ${projects.map(p => `<option value="${p.id}"${p.id === savedPid ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <select id="stt-task" class="stt-select" ${!lines.length ? 'disabled' : ''}>
        ${!project
          ? '<option value="">Task…</option>'
          : lines.length
            ? lines.map(l => `<option value="${esc(l.label)}"${l.label === savedTask ? ' selected' : ''}>${esc(l.label)}</option>`).join('')
            : '<option value="">No tracked lines</option>'
        }
      </select>
      <input id="stt-date" type="date" class="stt-select" style="margin-top:5px;color-scheme:dark"
        value="${new Date().toISOString().slice(0, 10)}" max="${new Date().toISOString().slice(0, 10)}" title="Date" />
      <div style="display:flex;gap:5px;margin-top:5px">
        <input id="stt-hours" type="number" min="0.5" max="24" step="0.5" placeholder="hrs"
          class="stt-hours" />
        <button id="stt-log" class="stt-btn">Log</button>
      </div>
      <input id="stt-note" type="text" placeholder="Notes (optional)" maxlength="300"
        class="stt-select" style="margin-top:5px" />
      <div id="stt-msg" style="font-size:10px;min-height:14px;margin-top:4px;color:#596773"></div>`
  }

  _bindSidebarTT() {
    const wrap = document.getElementById('sidebar-tt')
    if (!wrap) return

    const projectSel = wrap.querySelector('#stt-project')
    const taskSel    = wrap.querySelector('#stt-task')
    const hoursInput = wrap.querySelector('#stt-hours')
    const logBtn     = wrap.querySelector('#stt-log')
    const msgEl      = wrap.querySelector('#stt-msg')

    const showMsg = (text, color = '#596773', ms = 2500) => {
      if (!msgEl) return
      msgEl.style.color = color
      msgEl.textContent = text
      clearTimeout(this._sttMsgTimer)
      this._sttMsgTimer = setTimeout(() => { if (msgEl) msgEl.textContent = '' }, ms)
    }

    const updateTasks = (project) => {
      if (!taskSel) return
      const lines = this._sttTrackableLines(project)
      const saved = localStorage.getItem('tt-task-label') || ''
      if (!project) {
        taskSel.innerHTML = '<option value="">Task…</option>'
        taskSel.disabled = true
      } else if (!lines.length) {
        taskSel.innerHTML = '<option value="">No tracked lines</option>'
        taskSel.disabled = true
      } else {
        taskSel.innerHTML = lines.map(l => {
          const v = String(l.label ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
          return `<option value="${v}"${l.label === saved ? ' selected' : ''}>${v}</option>`
        }).join('')
        taskSel.disabled = false
      }
    }

    projectSel?.addEventListener('change', () => {
      const pid = projectSel.value
      localStorage.setItem('tt-project-id', pid)
      if (!pid) localStorage.removeItem('tt-task-label')
      const proj = this.projects.find(p => p.id === pid) || null
      updateTasks(proj)
    })

    taskSel?.addEventListener('change', () => {
      localStorage.setItem('tt-task-label', taskSel.value)
    })

    logBtn?.addEventListener('click', async () => {
      const pid   = projectSel?.value
      const task  = taskSel?.value
      const hours = parseFloat(hoursInput?.value)
      const note  = wrap.querySelector('#stt-note')?.value?.trim() || null

      if (!pid)               return showMsg('Select a project', '#f59e0b')
      if (!task)              return showMsg('Select a task', '#f59e0b')
      if (!hours || hours <= 0 || hours > 24) return showMsg('Enter valid hours', '#f59e0b')

      const project  = this.projects.find(p => p.id === pid)
      const budgetId = project ? (this._sttTrackableLines(project).find(l => l.label === task)?.budgetId ?? null) : null
      const name     = this.appUser?.name || this.user?.primaryEmailAddress?.emailAddress || 'Unknown'
      const date     = wrap.querySelector('#stt-date')?.value || new Date().toISOString().slice(0, 10)

      logBtn.disabled = true
      logBtn.textContent = '…'
      try {
        const { addTimeEntry } = await import('./db/client.js')
        await addTimeEntry({ project_id: pid, budget_id: budgetId, line_label: task, crew_name: name, hours, entry_date: date, note })
        hoursInput.value = ''
        const noteInput = wrap.querySelector('#stt-note')
        if (noteInput) noteInput.value = ''
        logBtn.textContent = '✓'
        showMsg(`${hours}h logged`, '#6ec96e')
        setTimeout(() => { if (logBtn) logBtn.textContent = 'Log' }, 1200)
        this.toast(`${hours}h logged`)

        // Refresh the dashboard time section if it's visible
        const timeEl = document.getElementById(`db-time-${pid}`)
        if (timeEl && project) {
          const mc = document.getElementById('main-content')
          if (mc) this._loadDbTimeSection(mc, project)
        }
      } catch(e) {
        console.error(e)
        logBtn.textContent = 'Log'
        showMsg('Error logging', '#ef4444')
      } finally {
        logBtn.disabled = false
        if (logBtn.textContent === '…') logBtn.textContent = 'Log'
      }
    })

    // Enter on hours → log
    hoursInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); logBtn?.click() }
    })
  }

  // Fetch shoots / planning / story-plan counts for the Live Projects tab-nav
  // rows and patch them in once loaded. Cached so re-renders show instantly.
  async _loadDbNavCounts(mc) {
    try {
      const { getProjectTabCounts, spawnDueBoardRecurrences } = await import('./db/client.js')
      // Dashboard loads have always spawned due recurring board cards (the old
      // Boards section did this); keep that so recurrences don't stall.
      spawnDueBoardRecurrences(this.userId).catch(() => {})
      const rows = await getProjectTabCounts(this.userId)
      this._dbNavCounts = Object.fromEntries(rows.map(r => [r.project_id, r]))
    } catch (e) { console.error(e); return }
    if (!document.contains(mc)) return
    mc.querySelectorAll('[data-nav-count]').forEach(el => {
      const [pid, key] = el.dataset.navCount.split(':')
      const n = this._dbNavCounts[pid]?.[key] || 0
      el.textContent = n > 0 ? `(${n})` : ''
    })
  }

  async _loadDbTimeSection(mc, project) {
    const el = mc.querySelector(`#db-time-${project.id}`)
    if (!el) return

    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')

    // Build trackable lines from linked budgets
    const trackableLines = []
    const budgetIds = Array.isArray(project.budget_ids) ? project.budget_ids : []
    for (const bid of budgetIds) {
      const b = this.budgets.find(x => x.id === bid)
      if (!b) continue
      for (const s of (b.sections || [])) {
        if (!s.enabled) continue
        for (const l of (s.lines || [])) {
          if (!l.track_time || !l.item) continue
          const days = parseFloat(l.days) || 0
          const qty  = isNaN(parseFloat(l.qty)) ? 1 : parseFloat(l.qty)
          const allocHours = days > 0 ? Math.round(days * qty * 8) : Math.round(qty * 8)
          trackableLines.push({ label: l.item, allocHours })
        }
      }
    }

    if (!trackableLines.length) {
      el.style.display = 'none'
      return
    }

    try {
      const { getTimeEntries } = await import('./db/client.js')
      const entries = await getTimeEntries(project.id)

      const totalLogged = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)
      const totalAlloc  = trackableLines.reduce((s, l) => s + l.allocHours, 0)
      const pct = totalAlloc > 0 ? Math.min(100, Math.round(totalLogged / totalAlloc * 100)) : 0
      const barColour = pct >= 100 ? '#6ec96e' : pct >= 80 ? '#f59e0b' : '#4a90d9'

      const byLine = {}
      entries.forEach(e => { byLine[e.line_label] = (byLine[e.line_label] || 0) + parseFloat(e.hours || 0) })

      el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
          <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Time tracked</div>
          <div style="font-size:11px;font-weight:500;color:${pct >= 80 ? barColour : 'var(--text-tertiary)'}">
            ${totalLogged.toFixed(1)} / ${totalAlloc}h
          </div>
        </div>
        <div style="height:5px;background:var(--bg-tertiary);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:8px">
          <div style="height:100%;width:${pct}%;background:${barColour};border-radius:var(--radius-sm);transition:width 0.3s"></div>
        </div>
        ${trackableLines.length > 1 ? trackableLines.map(l => {
          const logged = byLine[l.label] || 0
          const lPct = l.allocHours > 0 ? Math.min(100, Math.round(logged / l.allocHours * 100)) : 0
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:11px;color:var(--text-secondary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.label)}</span>
            <div style="width:80px;height:3px;background:var(--bg-tertiary);border-radius:2px;flex-shrink:0">
              <div style="height:100%;width:${lPct}%;background:${lPct>=100?'#6ec96e':'#4a90d9'};border-radius:2px"></div>
            </div>
            <span style="font-size:10px;color:var(--text-tertiary);flex-shrink:0;width:52px;text-align:right">${logged.toFixed(1)}/${l.allocHours}h</span>
          </div>`
        }).join('') : ''}`

    } catch(e) {
      console.error(e)
      el.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary)">Could not load time data</div>'
    }
  }

  async renderDashboard(mc) {
    clearInterval(this._cdInterval)
    this._cdInterval = null
    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    const retainers = this.projects.filter(p => p.is_retainer)
    const regularProjects = this.projects.filter(p => !p.is_retainer)
    const liveProjects = regularProjects.filter(p => ['Pre-production','In Production','Post'].includes(p.status))
    const enquiryProjects = regularProjects.filter(p => p.status === 'Enquiry')

    if (!this.projects.length) {
      mc.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:50vh;gap:16px;text-align:center">
          <div style="font-size:40px">🎬</div>
          <div style="font-size:18px;font-weight:500">No projects yet</div>
          <div style="font-size:14px;color:var(--text-tertiary);max-width:320px;line-height:1.6">Create your first project to start tracking work, budgets and deliverables.</div>
          ${this.permissions?.projects_edit ? `<button class="btn-primary" id="empty-new-project" style="margin-top:4px">+ Create first project</button>` : ''}
        </div>`
      mc.querySelector('#empty-new-project')?.addEventListener('click', () => {
        this.navigate('projects')
        setTimeout(() => document.querySelector('#topbar-btn')?.click(), 50)
      })
      this.teamCalendarView.renderDashboardSection(mc)
      this._mountCountdownWidget(mc)
      this._mountDaysSinceWidget(mc)
      return
    }

    // Compute financial summary
    const now = new Date()
    const fyStart = parseInt(this.settings?.financial_year_start ?? 4)  // 1=Jan, 4=Apr

    // Period helpers
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    // Quarter: current calendar quarter start
    const qMo = Math.floor(now.getMonth() / 3) * 3
    const quarterStart = new Date(now.getFullYear(), qMo, 1)
    const quarterEnd   = new Date(now.getFullYear(), qMo + 3, 0, 23, 59, 59)

    // Financial year: starts fyStart month (1-indexed), may cross Jan
    let fyYear = now.getFullYear()
    if (now.getMonth() + 1 < fyStart) fyYear--   // we're before the FY start month, so FY started last year
    const fyStartDate = new Date(fyYear, fyStart - 1, 1)
    const fyEndDate   = new Date(fyYear + 1, fyStart - 1, 0, 23, 59, 59)

    const inRange = (dateStr, start, end) => {
      if (!dateStr) return false
      const d = new Date(dateStr)
      return d >= start && d <= end
    }

    const invoicedBudgets   = this.budgets.filter(b => b.invoiced)
    const awaitingInvoice   = this.budgets.filter(b => b.signed_off && !b.invoiced)
    const invoicedThisMonth = invoicedBudgets.filter(b => inRange(b.invoiced_at, monthStart, monthEnd))
    const invoicedThisQtr   = invoicedBudgets.filter(b => inRange(b.invoiced_at, quarterStart, quarterEnd))
    const invoicedThisFY    = invoicedBudgets.filter(b => inRange(b.invoiced_at, fyStartDate, fyEndDate))

    const sumBudgets = arr => arr.reduce((s, b) => { const n = budTotal(b); return s + (isNaN(n) ? 0 : n) }, 0)

    const awaitingVal      = sumBudgets(awaitingInvoice)
    const invoicedMonthVal = sumBudgets(invoicedThisMonth)
    const invoicedQtrVal   = sumBudgets(invoicedThisQtr)
    const invoicedFYVal    = sumBudgets(invoicedThisFY)

    const retainerMRR = retainers.filter(p => p.status !== 'Enquiry').reduce((s, p) => {
      if (p.retainer_fee_mode === 'calculated') {
        return s + (p.retainer_items||[]).reduce((rs,i) => {
          const mult = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}[i.period||'month']||1
          return rs + (parseFloat(i.rate)||0)*(parseFloat(i.qty)||0)*mult
        }, 0)
      }
      return s + (parseFloat(p.retainer_fee)||0)
    }, 0)

    // Enquiry retainers count toward pipeline
    const retainerPipelineVal = retainers.filter(p => p.status === 'Enquiry').reduce((s, p) => {
      if (p.retainer_fee_mode === 'calculated') {
        return s + (p.retainer_items||[]).reduce((rs,i) => {
          const mult = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}[i.period||'month']||1
          return rs + (parseFloat(i.rate)||0)*(parseFloat(i.qty)||0)*mult
        }, 0)
      }
      return s + (parseFloat(p.retainer_fee)||0)
    }, 0)

    const pipelineValue = regularProjects.reduce((sum, p) => {
      const pBudgets = (p.budget_ids||[]).map(id => this.budgets.find(b => b.id === id)).filter(Boolean)
      return sum + pBudgets.reduce((s, b) => s + (budTotal(b)||0), 0)
    }, 0)

    const gbp = n => '£' + Math.round(n).toLocaleString('en-GB')
    const fyMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const fyLabel = `${fyMonths[fyStart-1]} ${fyYear}–${fyMonths[fyStart-1]} ${fyYear+1}`

    // --- Helpers for comments UI ---
    const relTime = ts => {
      const diff = Date.now() - new Date(ts).getTime()
      const m = Math.floor(diff / 60000)
      if (m < 1) return 'just now'
      if (m < 60) return `${m}m ago`
      const h = Math.floor(m / 60)
      if (h < 24) return `${h}h ago`
      const d = Math.floor(h / 24)
      if (d < 7) return `${d}d ago`
      return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    }
    const initials = name => (name||'?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    const avatarColors = ['#4a90d9','#6ec96e','#f59e0b','#a78bfa','#ef4444','#06b6d4','#ec4899']
    const avatarColor = id => {
      if (!id) return avatarColors[0]
      let h = 0
      for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff
      return avatarColors[h % avatarColors.length]
    }
    const statusColor = s => ({ 'Pre-production': '#4a90d9', 'In Production': '#6ec96e', 'Post': '#f59e0b' }[s] || '#8590A2')

    // --- Init persisted open/pin state ---
    if (!this._dbPinned) {
      try { this._dbPinned = new Set(JSON.parse(localStorage.getItem('db_pinned') || '[]')) }
      catch { this._dbPinned = new Set() }
    }
    if (this._dbEnqOpen === undefined) {
      this._dbEnqOpen = localStorage.getItem('db_enq_open') !== 'false'
    }
    // --- Compute upcoming deliverables (due within 7 days, not done) ---
    const today = new Date(); today.setHours(0,0,0,0)
    const sevenDaysLater = new Date(today); sevenDaysLater.setDate(sevenDaysLater.getDate() + 7); sevenDaysLater.setHours(23,59,59,999)
    const upcomingDeliverables = []
    for (const p of this.projects) {
      const delivsArr = Array.isArray(p.deliverables) ? p.deliverables : []
      const monthlyArr = p.is_retainer && Array.isArray(p.monthly_deliverables) ? p.monthly_deliverables : []
      for (let i = 0; i < delivsArr.length; i++) {
        const d = delivsArr[i]
        if (!d.text || d.done || !d.due) continue
        const due = new Date(d.due)
        if (due <= sevenDaysLater) upcomingDeliverables.push({ d, p, due, idx: i, src: 'deliverables' })
      }
      for (let i = 0; i < monthlyArr.length; i++) {
        const d = monthlyArr[i]
        if (!d.text || d.done || !d.due) continue
        const due = new Date(d.due)
        if (due <= sevenDaysLater) upcomingDeliverables.push({ d, p, due, idx: i, src: 'monthly_deliverables' })
      }
    }
    upcomingDeliverables.sort((a, b) => a.due - b.due)

    // --- Compute edit deadlines coming due (within 14 days) from TC entries + PPS blocks ---
    const dStr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const fourteenDaysLater = new Date(today); fourteenDaysLater.setDate(today.getDate() + 14)
    // PPS phases (shared cache with the team calendar view) surface block-level deadlines
    let ppsPhasesForDash = this.teamCalendarView?._ppsPhasesCache
    if (!ppsPhasesForDash) {
      try {
        const { getPpsPhasesForCalendar } = await import('./db/client.js')
        ppsPhasesForDash = await getPpsPhasesForCalendar(this.userId)
        if (this.teamCalendarView) this.teamCalendarView._ppsPhasesCache = ppsPhasesForDash
      } catch (e) { console.error(e); ppsPhasesForDash = [] }
    }
    // Per-project post-production phase counts for the tab-nav row
    const ppsCountByProject = {}
    for (const ph of (ppsPhasesForDash || [])) {
      if (ph.project_id) ppsCountByProject[ph.project_id] = (ppsCountByProject[ph.project_id] || 0) + 1
    }
    const ppsDeadlines = []
    for (const ph of (ppsPhasesForDash || [])) {
      for (const b of (Array.isArray(ph.blocks) ? ph.blocks : [])) {
        if (b.is_deadline && b.end_date) {
          ppsDeadlines.push({ date: b.end_date, label: `${ph.project_name ? ph.project_name + ' — ' : ''}${b.title || ph.name}`, assignee_id: b.assignee_id, phase_id: ph.id, block_id: b.id, is_complete: !!b.is_complete })
        }
      }
    }
    const editDeadlines = [
      ...(this.teamCalendarEntries || []).filter(e => e.is_deadline).map(e => ({ date: e.end_date || e.entry_date, label: e.label, assignee_id: e.assignee_id, is_complete: !!e.is_complete })),
      ...ppsDeadlines,
    ].filter(e => e.date && e.date <= dStr(fourteenDaysLater))
     .sort((a, b) => a.date.localeCompare(b.date))

    const renderComment = (c, pid) => {
      const ini = initials(c.author_name || 'Unknown')
      const col = avatarColor(c.author_id)
      return `<div class="db-comment${c.resolved ? ' db-comment--resolved' : ''}" data-cid="${c.id}" data-pid="${pid}">
        <div class="db-avatar" style="background:${col}">${ini}</div>
        <div class="db-comment-body">
          <div class="db-comment-meta">
            <span class="db-comment-author">${esc(c.author_name || 'Unknown')}</span>
            <span class="db-comment-time">${relTime(c.timestamp)}</span>
            <label class="db-resolve-label" title="${c.resolved ? 'Mark unresolved' : 'Mark resolved'}">
              <input type="checkbox" class="db-resolve-cb" data-resolve-pid="${pid}" data-resolve-cid="${c.id}" ${c.resolved ? 'checked' : ''}>
              <span class="db-resolve-icon${c.resolved ? ' db-resolve-icon--done' : ''}">✓</span>
            </label>
          </div>
          <div class="db-comment-text${c.resolved ? ' db-comment-text--resolved' : ''}">${esc(c.text)}</div>
          <button class="db-action-link db-reply-btn" data-reply-pid="${pid}" data-reply-cid="${c.id}">Reply</button>
          ${(c.replies||[]).length ? `<div class="db-replies">${(c.replies||[]).map(r => `
            <div class="db-reply">
              <div class="db-avatar db-avatar--sm" style="background:${avatarColor(r.author_id)}">${initials(r.author_name||'?')}</div>
              <div>
                <div class="db-comment-meta">
                  <span class="db-comment-author">${esc(r.author_name||'Unknown')}</span>
                  <span class="db-comment-time">${relTime(r.timestamp)}</span>
                </div>
                <div class="db-comment-text">${esc(r.text)}</div>
              </div>
            </div>`).join('')}</div>` : ''}
          <div class="db-reply-form" id="db-rf-${pid}-${c.id}" style="display:none">
            <textarea class="db-reply-input" placeholder="Reply…" rows="2"></textarea>
            <button class="btn-secondary" style="font-size:11px;padding:4px 12px;align-self:flex-end" data-post-reply-pid="${pid}" data-post-reply-cid="${c.id}">Reply</button>
          </div>
        </div>
      </div>`
    }

    const renderProjectRow = p => {
      const cl = this.contacts.find(c => c.id === p.client_id)
      const clientName = cl ? `${cl.first_name} ${cl.last_name}` : ''
      const comments = (p.dashboard_comments || [])
      const isOpen = this._dbPinned.has(p.id)
      const col = statusColor(p.status)
      const delivs = (p.deliverables||[]).filter(d => d.text)
      const doneCount = delivs.filter(d => d.done).length
      const unresolvedCount = comments.filter(c => !c.resolved).length

      // Mirror the Project page tab bar — each item deep-links to that tab.
      // shoots/planning/story_plans counts load async (see _loadDbNavCounts).
      const cached = this._dbNavCounts?.[p.id]
      const navTabs = [
        { id: 'overview',        label: 'Overview' },
        { id: 'shoots',          label: 'Shoots', key: 'shoots', hide: (p.project_type||'full_service') === 'post_production' },
        { id: 'post-production', label: 'Post Production', count: ppsCountByProject[p.id] || 0 },
        { id: 'budget',          label: 'Budgets', count: (p.budget_ids||[]).length },
        { id: 'planning',        label: 'Planning', key: 'planning' },
        { id: 'notes',           label: 'Notes', count: comments.length },
        { id: 'story-plans',     label: 'Story Plans', key: 'story_plans' },
      ].filter(t => !t.hide)
      const navRow = `<div class="db-proj-nav">${navTabs.map((t, i) => {
        const n = t.key ? (cached?.[t.key] ?? 0) : t.count
        const countSpan = `<span class="db-nav-count"${t.key ? ` data-nav-count="${p.id}:${t.key}"` : ''}>${n > 0 ? `(${n})` : ''}</span>`
        return `${i ? '<span class="db-nav-sep">|</span>' : ''}<button class="db-nav-link" data-nav-pid="${p.id}" data-nav-tab="${t.id}">${t.label} ${countSpan}</button>`
      }).join('')}</div>`

      return `<div class="db-proj-row" data-pid="${p.id}">
        <div class="db-proj-header" data-toggle-pid="${p.id}">
          <span class="db-chevron${isOpen ? ' db-chevron--open' : ''}" data-chevron="${p.id}">▶</span>
          <span class="db-status-dot" style="background:${col}"></span>
          <span class="db-proj-name-label">${esc(p.name)}</span>
          ${clientName ? `<span class="db-proj-client-label">${esc(clientName)}</span>` : ''}
          ${delivs.length ? `<span class="db-badge" style="color:${doneCount===delivs.length?'#6ec96e':'var(--text-tertiary)'}">${doneCount}/${delivs.length} done</span>` : ''}
          ${unresolvedCount ? `<span class="db-badge" style="color:#f59e0b">${unresolvedCount} open</span>` : ''}
          <span class="db-status-pill" style="color:${col};background:${col}18;border-color:${col}30">${p.status}</span>
          <button class="db-pin-btn${this._dbPinned.has(p.id) ? ' db-pin-btn--on' : ''}" data-pin-pid="${p.id}" title="${this._dbPinned.has(p.id) ? 'Unpin (panel stays open)' : 'Pin open'}">⊙</button>
          <button class="db-action-link" style="font-size:11px;padding:3px 8px" data-open-pid="${p.id}">Open ↗</button>
        </div>
        <div class="db-proj-body" id="db-body-${p.id}" style="display:${isOpen ? 'block' : 'none'}">
          ${navRow}

          ${(() => {
            if (!delivs.length) return ''
            const sorted = [...delivs.map((d,i)=>({...d,_i:i}))].sort((a,b) => {
              if (a.done !== b.done) return a.done ? 1 : -1
              if (a.due && b.due) return new Date(a.due) - new Date(b.due)
              return a.due ? -1 : 1
            })
            const todayMs = new Date().setHours(0,0,0,0)
            return `<div style="padding:10px 16px 10px;border-bottom:1px solid var(--border-light)">
              <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:7px">Deliverables · ${doneCount}/${delivs.length}</div>
              ${sorted.map(d => {
                const daysUntil = d.due ? Math.round((new Date(d.due + 'T00:00:00') - todayMs) / 86400000) : null
                const duePill = daysUntil === null ? ''
                  : daysUntil < 0 && !d.done ? `<span class="db-due-pill db-due-pill--overdue" style="font-size:9px;padding:1px 5px">${Math.abs(daysUntil)}d late</span>`
                  : daysUntil === 0 ? `<span class="db-due-pill db-due-pill--today" style="font-size:9px;padding:1px 5px">Today</span>`
                  : `<span class="db-due-pill" style="font-size:9px;padding:1px 5px">${new Date(d.due + 'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>`
                const assignee = d.assignee_id ? this.allUsers.find(u => u.id === d.assignee_id) : null
                return `<div style="display:flex;align-items:center;gap:7px;padding:3px 0;${d.done ? 'opacity:0.45;' : ''}">
                  <input type="checkbox" class="db-inline-deliv-check" data-deliv-pid="${p.id}" data-deliv-idx="${d._i}" data-deliv-src="deliverables"
                    ${d.done ? 'checked' : ''} style="cursor:pointer;flex-shrink:0;width:13px;height:13px;accent-color:var(--accent)">
                  <span style="flex:1;font-size:12px;color:var(--text-primary);line-height:1.3;${d.done ? 'text-decoration:line-through;' : ''}">${esc(d.text)}</span>
                  ${duePill}
                  ${assignee ? `<span style="font-size:10px;color:var(--text-tertiary);flex-shrink:0">${esc(assignee.name || assignee.email)}</span>` : ''}
                </div>`
              }).join('')}
            </div>`
          })()}

          <div id="db-time-${p.id}" style="padding:10px 16px;border-bottom:1px solid var(--border-light)">
            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Time tracked — loading…</div>
          </div>

          <div class="db-thread" id="db-thread-${p.id}">
            ${comments.length
              ? comments.map(c => renderComment(c, p.id)).join('')
              : `<div class="db-no-comments">No comments yet — start the thread below</div>`}
          </div>
          <div class="db-add-comment">
            <textarea class="db-comment-input" id="db-ci-${p.id}" placeholder="Add a comment…" rows="2"></textarea>
            <button class="btn-primary" style="font-size:12px;padding:5px 14px;align-self:flex-end;flex-shrink:0" data-post-comment="${p.id}">Post</button>
          </div>
        </div>
      </div>`
    }

    const statCards = `
      <div class="stat-card stat-card--sm stat-card--link" data-db-nav="projects" role="button" tabindex="0" title="View projects"><div class="stat-label">Pipeline</div><div class="stat-value stat-value--sm">${gbp(pipelineValue + retainerPipelineVal)}</div><div class="stat-sub">${regularProjects.length} project${regularProjects.length!==1?'s':''}${retainerPipelineVal>0?' + '+retainers.filter(p=>p.status==='Enquiry').length+' retainer enquir'+(retainers.filter(p=>p.status==='Enquiry').length===1?'y':'ies'):''}</div></div>
      <div class="stat-card stat-card--sm stat-card--link" data-db-nav="budgets" role="button" tabindex="0" title="View budgets"><div class="stat-label">Awaiting invoice</div><div class="stat-value stat-value--sm" style="color:#6ec96e">${gbp(awaitingVal)}</div><div class="stat-sub">${awaitingInvoice.length} budget${awaitingInvoice.length!==1?'s':''}</div></div>
      <div class="stat-card stat-card--sm stat-card--link" data-db-nav="budgets" role="button" tabindex="0" title="View budgets"><div class="stat-label">Invoiced this month</div><div class="stat-value stat-value--sm" style="color:var(--accent)">${gbp(invoicedMonthVal)}</div><div class="stat-sub">${invoicedThisMonth.length} budget${invoicedThisMonth.length!==1?'s':''}</div></div>
      <div class="stat-card stat-card--sm stat-card--link" data-db-nav="budgets" role="button" tabindex="0" title="View budgets"><div class="stat-label">Invoiced this quarter</div><div class="stat-value stat-value--sm" style="color:var(--accent)">${gbp(invoicedQtrVal)}</div><div class="stat-sub">${invoicedThisQtr.length} budget${invoicedThisQtr.length!==1?'s':''}</div></div>
      <div class="stat-card stat-card--sm stat-card--link" data-db-nav="budgets" role="button" tabindex="0" title="View budgets"><div class="stat-label">Invoiced this FY</div><div class="stat-value stat-value--sm" style="color:var(--accent)">${gbp(invoicedFYVal)}</div><div class="stat-sub">${fyLabel}</div></div>
      <div class="stat-card stat-card--sm stat-card--link" data-db-nav="projects" role="button" tabindex="0" title="View projects"><div class="stat-label">Retainer MRR</div><div class="stat-value stat-value--sm" style="color:#a78bfa">${gbp(retainerMRR)}</div><div class="stat-sub">per month</div></div>`

    mc.innerHTML = `
      <!-- Live Projects -->
      <div style="margin-bottom:28px">
        <div class="db-section-head">
          <span class="db-section-dot" style="background:#6ec96e"></span>
          Live Projects
          <span class="db-section-count">${liveProjects.length}</span>
        </div>
        ${liveProjects.length
          ? `<div class="db-proj-list">${liveProjects.map(renderProjectRow).join('')}</div>`
          : `<div style="color:var(--text-tertiary);font-size:13px;padding:12px 0 4px">No live projects yet.</div>`}
      </div>

      <!-- Enquiries -->
      <div style="margin-bottom:28px">
        <div class="db-section-head db-enq-toggle" id="db-enq-toggle" style="cursor:pointer;user-select:none">
          <span class="db-section-dot" style="background:#f59e0b"></span>
          Enquiries
          <span class="db-section-count">${enquiryProjects.length}</span>
          <span class="db-chevron${this._dbEnqOpen ? ' db-chevron--open' : ''}" style="margin-left:auto" id="db-enq-chevron">▶</span>
        </div>
        <div id="db-enq-body" style="display:${this._dbEnqOpen ? 'block' : 'none'}">
          ${enquiryProjects.length ? `<div class="db-enq-list">
            ${(() => {
              if (!this.expandedEnquiries) this.expandedEnquiries = new Set()
              return enquiryProjects.map(p => {
                const cl = this.contacts.find(c => c.id === p.client_id)
                const isOpen = this.expandedEnquiries.has(p.id)
                return `<div class="db-enq-item" data-enq-id="${p.id}">
                  <div class="db-enq-row" data-open-pid="${p.id}">
                    <span class="db-proj-name-label">${esc(p.name)}</span>
                    ${cl ? `<span class="db-proj-client-label">${esc(cl.first_name+' '+cl.last_name)}</span>` : ''}
                    ${p.brief ? `<span class="db-enq-brief">${esc(p.brief.slice(0,90))}${p.brief.length>90?'…':''}</span>` : ''}
                    <button class="db-enq-toggle-btn" data-enq-id="${p.id}" title="Notes"
                      style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:13px;line-height:1;padding:0 2px;opacity:0.55;margin-left:auto">${isOpen ? '▾' : '▸'}</button>
                  </div>
                  <div class="db-enq-body" data-enq-id="${p.id}" style="display:${isOpen ? 'block' : 'none'};padding:0 14px 10px">
                    <textarea class="db-enq-notes-input" data-enq-id="${p.id}" placeholder="Add notes…" rows="2"
                      style="width:100%;background:transparent;border:none;outline:none;font-size:11px;color:var(--text-tertiary);font-family:var(--font);resize:none;padding:0;line-height:1.4;overflow:hidden;box-sizing:border-box">${esc(p.notes||'')}</textarea>
                  </div>
                </div>`
              }).join('')
            })()}
          </div>` : `<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">No enquiries.</div>`}
        </div>
      </div>

      <!-- 4-column row: Marketing Tasks | Deliverables | Edit Deadlines | Retainers -->
      ${(() => {
        const todayMs = today.getTime()
        const sevenDaysMs = sevenDaysLater.getTime()
        const myTasks = []
        for (const card of (this.marketingCards || [])) {
          for (const st of (card.sub_tasks || [])) {
            if (st.done || !st.due_date || st.owner_id !== this.clerkUserId) continue
            const dueMs = new Date(st.due_date + 'T00:00:00').getTime()
            if (dueMs <= sevenDaysMs) myTasks.push({ st, card, dueMs })
          }
        }
        myTasks.sort((a, b) => a.dueMs - b.dueMs)

        const duePillClass = ms => { const d = Math.round((ms - todayMs) / 86400000); return d < 0 ? 'db-due-pill--overdue' : d === 0 ? 'db-due-pill--today' : '' }
        const dueLabel     = ms => { const d = Math.round((ms - todayMs) / 86400000); return d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'Today' : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }

        const delivDuePill = due => {
          const d = Math.round((due - today) / 86400000)
          return d < 0 ? `<span class="db-due-pill db-due-pill--overdue">${Math.abs(d)}d overdue</span>`
               : d === 0 ? `<span class="db-due-pill db-due-pill--today">Today</span>`
               : `<span class="db-due-pill">${d}d</span>`
        }

        const deadlineDuePill = entry => {
          const d = Math.round((new Date(entry.date + 'T00:00:00').getTime() - todayMs) / 86400000)
          return d < 0 && !entry.is_complete ? `<span class="db-due-pill db-due-pill--overdue">${Math.abs(d)}d overdue</span>`
               : d === 0 ? `<span class="db-due-pill db-due-pill--today">Today</span>`
               : `<span class="db-due-pill">${new Date(entry.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>`
        }

        const retainerCards = retainers.map(p => {
          const cl = this.contacts.find(c => c.id === p.client_id)
          const periodMult = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}
          const calcHours = (p.retainer_items||[]).reduce((s,i) => { const mult = periodMult[i.period||'month']||1; return s + (i.unit==='hours' ? (parseFloat(i.qty)||0)*mult : (parseFloat(i.qty)||0)*8*mult) }, 0)
          const hours = calcHours || (parseFloat(p.retainer_hours)||0)
          const calcFee = (p.retainer_items||[]).reduce((s,i) => { const mult = periodMult[i.period||'month']||1; return s + (parseFloat(i.rate)||0)*(parseFloat(i.qty)||0)*mult }, 0)
          const fee = p.retainer_fee_mode==='calculated' ? calcFee : (parseFloat(p.retainer_fee)||0)
          return `<div class="kanban-card" style="border-left:3px solid #a78bfa;cursor:default" data-retainer="${p.id}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
              <div class="kanban-card-title" style="cursor:pointer" data-open-pid="${p.id}">${esc(p.name)}</div>
              ${fee ? `<div style="font-size:12px;font-weight:600;color:#a78bfa;white-space:nowrap;margin-left:8px">£${fee.toLocaleString('en-GB')}/mo</div>` : ''}
            </div>
            <div class="kanban-card-client">${cl ? esc(cl.first_name+' '+cl.last_name) : 'No client'}</div>
            ${(p.retainer_items||[]).length ? `
              <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px" data-ret-items="${p.id}">
                ${(p.retainer_items||[]).map((item,ii) => {
                  const mult = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}[item.period||'month']||1
                  const allocH = item.unit==='hours' ? Math.round((parseFloat(item.qty)||0)*mult) : Math.round((parseFloat(item.qty)||0)*8*mult)
                  const periodLabel = {week:'/ wk',month:'/ mo',quarter:'/ qtr',half:'/ 6mo',year:'/ yr'}[item.period||'month']||'/ mo'
                  return allocH ? `<div>
                    <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">
                      <span style="color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">${esc(item.label)}</span>
                      <span style="display:flex;align-items:center;gap:4px;flex-shrink:0"><span data-ret-item-label="${p.id}-${ii}" style="color:var(--text-secondary);white-space:nowrap">— / ${allocH}h</span><span style="color:var(--text-tertiary);opacity:0.6;font-size:9px">${periodLabel}</span></span>
                    </div>
                    <div style="height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden">
                      <div style="height:100%;width:0%;border-radius:2px;transition:width 0.3s" data-ret-item-bar="${p.id}-${ii}"></div>
                    </div>
                  </div>` : ''
                }).join('')}
                <div data-ret-alert="${p.id}" style="font-size:10px;margin-top:2px;display:none"></div>
              </div>` : hours ? `
              <div style="margin-top:8px">
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
                  <span style="color:var(--text-tertiary)">This month</span>
                  <span style="color:var(--text-secondary)" data-ret-label="${p.id}">— / ${hours}h</span>
                </div>
                <div style="height:6px;background:var(--bg-secondary);border-radius:var(--radius-sm);overflow:hidden">
                  <div style="height:100%;width:0%;border-radius:var(--radius-sm);transition:width 0.3s" data-ret-bar="${p.id}"></div>
                </div>
                <div data-ret-alert="${p.id}" style="font-size:10px;margin-top:4px;display:none"></div>
              </div>` : ''}
          </div>`
        }).join('')

        return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:20px;margin-bottom:28px;align-items:flex-start">

          <!-- Marketing Tasks -->
          <div>
            <div class="db-section-head" style="justify-content:space-between">
              <div style="display:flex;align-items:center;gap:6px">
                <span class="db-section-dot" style="background:#a78bfa"></span>
                Marketing Tasks
                ${myTasks.length ? `<span class="db-section-count">${myTasks.length}</span>` : ''}
              </div>
              <button class="db-action-link" id="db-mkt-view-all" style="font-size:11px;padding:2px 8px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary)">All ↗</button>
            </div>
            ${myTasks.length ? `
            <div class="db-proj-list" style="border-radius:var(--radius-md)">
              ${myTasks.map(({ st, card, dueMs }) => `
              <div class="db-proj-row" style="display:flex;align-items:center;gap:8px;padding:8px 12px;min-height:unset">
                <span class="db-due-pill ${duePillClass(dueMs)}">${dueLabel(dueMs)}</span>
                <span class="db-proj-name-label" style="flex:1;font-size:12px">${esc(st.text)}</span>
                <button class="db-action-link db-mkt-open-card" data-card-id="${card.id}" style="font-size:11px;padding:2px 6px;flex-shrink:0">↗</button>
              </div>`).join('')}
            </div>` : `<div style="color:var(--text-tertiary);font-size:12px;padding:8px 0">No tasks due this week.</div>`}
          </div>

          <!-- Upcoming Deliverables -->
          <div>
            <div class="db-section-head">
              <span class="db-section-dot" style="background:#ef4444"></span>
              Deliverables
              ${upcomingDeliverables.length ? `<span class="db-section-count">${upcomingDeliverables.length}</span>` : ''}
            </div>
            ${upcomingDeliverables.length ? `
            <div class="db-proj-list" style="border-radius:var(--radius-md)">
              ${upcomingDeliverables.map(({ d, p, due, idx, src }) => `
              <div class="db-proj-row db-upcoming-row" style="cursor:default">
                <div class="db-proj-header" style="cursor:default;gap:8px;padding:8px 12px">
                  <input type="checkbox" class="db-deliv-check" data-deliv-pid="${p.id}" data-deliv-idx="${idx}" data-deliv-src="${src}" style="cursor:pointer;flex-shrink:0;width:13px;height:13px" />
                  ${delivDuePill(due)}
                  <span class="db-proj-name-label" style="flex:1;font-size:12px">${esc(d.text)}</span>
                  <button class="db-action-link" style="font-size:11px;padding:2px 6px;flex-shrink:0" data-open-pid="${p.id}">↗</button>
                </div>
              </div>`).join('')}
            </div>` : `<div style="color:var(--text-tertiary);font-size:12px;padding:8px 0">No deliverables due this week.</div>`}
          </div>

          <!-- Edit Deadlines Coming Due -->
          <div>
            <div class="db-section-head">
              <span class="db-section-dot" style="background:#f59e0b"></span>
              Edit Deadlines
              ${editDeadlines.length ? `<span class="db-section-count">${editDeadlines.length}</span>` : ''}
            </div>
            ${editDeadlines.length ? `
            <div class="db-proj-list" style="border-radius:var(--radius-md)">
              ${editDeadlines.map(e => {
                const assignee = this.allUsers.find(u => u.id === e.assignee_id)
                return `<div class="db-proj-row db-deadline-row" style="display:flex;align-items:center;gap:8px;padding:8px 12px;min-height:unset;${e.is_complete ? 'opacity:0.45;' : ''}">
                  ${e.phase_id ? `<input type="checkbox" class="db-deadline-check" data-phase-id="${e.phase_id}" data-block-id="${e.block_id}" ${e.is_complete ? 'checked' : ''} style="cursor:pointer;flex-shrink:0;width:13px;height:13px;accent-color:#6ec96e" />` : ''}
                  ${deadlineDuePill(e)}
                  <span class="db-proj-name-label" style="flex:1;font-size:12px;${e.is_complete ? 'text-decoration:line-through;' : ''}">${esc(e.label)}</span>
                  ${assignee ? `<span style="font-size:10px;color:var(--text-tertiary);flex-shrink:0">${esc(assignee.name || assignee.email.split('@')[0])}</span>` : ''}
                </div>`
              }).join('')}
            </div>` : `<div style="color:var(--text-tertiary);font-size:12px;padding:8px 0">No edit deadlines in the next 14 days.</div>`}
          </div>

          <!-- Retainers -->
          <div>
            <div class="db-section-head">
              <span class="db-section-dot" style="background:#a78bfa"></span>
              Retainers
              ${retainers.length ? `<span class="db-section-count">${retainers.length}</span>` : ''}
            </div>
            ${retainers.length ? `
            <div style="display:flex;flex-direction:column;gap:10px" id="retainer-cards">${retainerCards}</div>
            ` : `<div style="color:var(--text-tertiary);font-size:12px;padding:8px 0">No retainers yet.</div>`}
          </div>

        </div>`
      })()}

      <!-- Financial Summary -->
      <div style="padding-top:20px;border-top:1px solid var(--border-light)">
        <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px">Financial overview</div>
        <div class="stats-row">${statCards}</div>
      </div>`

    this.teamCalendarView.renderDashboardSection(mc)
    this._mountCountdownWidget(mc)
    this._mountDaysSinceWidget(mc)

    // --- Stat cards navigate to their underlying list ---
    mc.querySelectorAll('[data-db-nav]').forEach(card => {
      const go = () => this.navigate(card.dataset.dbNav)
      card.addEventListener('click', go)
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } })
    })

    // --- Marketing tasks coming due ---
    mc.querySelector('#db-mkt-view-all')?.addEventListener('click', () => this.navigate('marketing'))
    mc.querySelectorAll('.db-mkt-open-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const cardId = btn.dataset.cardId
        this.marketingView.pendingOpenCardId = cardId
        this.navigate('marketing')
      })
    })

    // --- Open project links ---
    mc.querySelectorAll('[data-open-pid]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); this.openProject(el.dataset.openPid) })
    })

    // --- Tab-nav links (deep-link into a project tab) ---
    mc.querySelectorAll('[data-nav-tab]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); this.openProject(el.dataset.navPid, el.dataset.navTab) })
    })
    this._loadDbNavCounts(mc)

    // --- Accordion toggle ---
    mc.querySelectorAll('[data-toggle-pid]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-pin-pid]') || e.target.closest('[data-open-pid]')) return
        const pid = el.dataset.togglePid
        const body = mc.querySelector(`#db-body-${pid}`)
        const chevron = mc.querySelector(`[data-chevron="${pid}"]`)
        if (!body) return
        const opening = body.style.display === 'none'
        body.style.display = opening ? 'block' : 'none'
        if (chevron) chevron.classList.toggle('db-chevron--open', opening)
        if (opening) {
          const proj = this.projects.find(p => p.id === pid)
          if (proj) this._loadDbTimeSection(mc, proj)
        }
        if (!opening && this._dbPinned.has(pid)) {
          this._dbPinned.delete(pid)
          el.querySelector(`[data-pin-pid="${pid}"]`)?.classList.remove('db-pin-btn--on')
          localStorage.setItem('db_pinned', JSON.stringify([...this._dbPinned]))
        }
      })
    })

    // Load time sections for already-open (pinned) projects
    for (const pid of this._dbPinned) {
      const proj = this.projects.find(p => p.id === pid)
      if (proj) this._loadDbTimeSection(mc, proj)
    }

    // --- Pin open ---
    mc.querySelectorAll('[data-pin-pid]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const pid = btn.dataset.pinPid
        const body = mc.querySelector(`#db-body-${pid}`)
        const chevron = mc.querySelector(`[data-chevron="${pid}"]`)
        if (this._dbPinned.has(pid)) {
          this._dbPinned.delete(pid)
          btn.classList.remove('db-pin-btn--on')
          btn.title = 'Pin open'
        } else {
          this._dbPinned.add(pid)
          btn.classList.add('db-pin-btn--on')
          btn.title = 'Unpin (panel stays open)'
          if (body) { body.style.display = 'block' }
          if (chevron) chevron.classList.add('db-chevron--open')
        }
        localStorage.setItem('db_pinned', JSON.stringify([...this._dbPinned]))
      })
    })

    // --- Upcoming deliverable completion checkboxes ---
    // Inline deliverable checkboxes inside the project accordion
    mc.querySelectorAll('.db-inline-deliv-check').forEach(cb => {
      cb.addEventListener('click', e => e.stopPropagation())
      cb.addEventListener('change', async () => {
        const p = this.projects.find(x => x.id === cb.dataset.delivPid)
        if (!p) return
        const arr = p[cb.dataset.delivSrc]
        const idx = +cb.dataset.delivIdx
        if (!arr?.[idx]) return
        arr[idx].done = cb.checked
        const row = cb.closest('[style*="display:flex"]')
        if (row) {
          row.style.opacity = cb.checked ? '0.45' : ''
          const span = row.querySelector('span[style*="flex:1"]')
          if (span) span.style.textDecoration = cb.checked ? 'line-through' : ''
        }
        // Update the header badge
        const allDelivs = (p.deliverables || []).filter(d => d.text)
        const nowDone = allDelivs.filter(d => d.done).length
        const badge = mc.querySelector(`[data-pid="${p.id}"] .db-badge`)
        if (badge) badge.textContent = `${nowDone}/${allDelivs.length} done`
        try {
          const { updateProject } = await import('./db/client.js')
          await updateProject(this.userId, p.id, { [cb.dataset.delivSrc]: arr })
          this.toast(cb.checked ? '✓ Done' : 'Unmarked')
        } catch(e) { console.error(e) }
      })
    })

    mc.querySelectorAll('.db-deliv-check').forEach(cb => {
      cb.addEventListener('click', e => e.stopPropagation())
      cb.addEventListener('change', async () => {
        const p = this.projects.find(x => x.id === cb.dataset.delivPid)
        if (!p) return
        const idx = +cb.dataset.delivIdx
        const src = cb.dataset.delivSrc
        const arr = p[src]
        if (!arr || !arr[idx]) return
        arr[idx].done = cb.checked
        const row = cb.closest('.db-upcoming-row')
        if (row) {
          row.style.opacity = cb.checked ? '0.45' : ''
          const nameLabel = row.querySelector('.db-proj-name-label')
          if (nameLabel) nameLabel.style.textDecoration = cb.checked ? 'line-through' : ''
        }
        try {
          const { updateProject } = await import('./db/client.js')
          await updateProject(this.userId, p.id, { [src]: arr })
          this.toast(cb.checked ? '✓ Deliverable marked done' : 'Deliverable unmarked')
        } catch(e) { console.error('Deliverable save failed:', e) }
      })
    })

    // --- Edit deadline completion checkboxes ---
    mc.querySelectorAll('.db-deadline-check').forEach(cb => {
      cb.addEventListener('click', e => e.stopPropagation())
      cb.addEventListener('change', async () => {
        const phaseId = cb.dataset.phaseId
        const blockId = cb.dataset.blockId
        const row = cb.closest('.db-deadline-row')
        if (row) {
          row.style.opacity = cb.checked ? '0.45' : ''
          const label = row.querySelector('.db-proj-name-label')
          if (label) label.style.textDecoration = cb.checked ? 'line-through' : ''
        }
        try {
          const { updatePpsPhase } = await import('./db/client.js')
          const phases = this.teamCalendarView?._ppsPhasesCache || []
          const phase = phases.find(p => p.id === phaseId)
          if (phase && Array.isArray(phase.blocks)) {
            const block = phase.blocks.find(b => b.id === blockId)
            if (block) {
              block.is_complete = cb.checked
              await updatePpsPhase(phaseId, { blocks: phase.blocks })
              this.toast(cb.checked ? '✓ Deadline marked complete' : 'Deadline unmarked')
            }
          }
        } catch(e) { console.error('Deadline save failed:', e) }
      })
    })

    // --- Enquiries collapse ---
    mc.querySelector('#db-enq-toggle')?.addEventListener('click', () => {
      const body = mc.querySelector('#db-enq-body')
      const chevron = mc.querySelector('#db-enq-chevron')
      if (!body) return
      this._dbEnqOpen = body.style.display === 'none'
      body.style.display = this._dbEnqOpen ? 'block' : 'none'
      if (chevron) chevron.classList.toggle('db-chevron--open', this._dbEnqOpen)
      localStorage.setItem('db_enq_open', String(this._dbEnqOpen))
    })

    // --- Enquiry notes toggle ---
    if (!this.expandedEnquiries) this.expandedEnquiries = new Set()
    mc.querySelectorAll('.db-enq-toggle-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const id = btn.dataset.enqId
        const body = mc.querySelector(`.db-enq-body[data-enq-id="${id}"]`)
        if (!body) return
        const isOpen = this.expandedEnquiries.has(id)
        if (isOpen) {
          this.expandedEnquiries.delete(id)
          body.style.display = 'none'
          btn.textContent = '▸'
        } else {
          this.expandedEnquiries.add(id)
          body.style.display = 'block'
          btn.textContent = '▾'
          const ta = body.querySelector('.db-enq-notes-input')
          if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; ta.focus() }
        }
      })
    })
    mc.querySelectorAll('.db-enq-notes-input').forEach(ta => {
      ta.addEventListener('click', e => e.stopPropagation())
      ta.addEventListener('blur', async () => {
        const id = ta.dataset.enqId
        const notes = ta.value.trim() || null
        const project = this.projects.find(x => x.id === id)
        if (notes === (project?.notes || null)) return
        const { updateProject } = await import('./db/client.js')
        await updateProject(this.userId, id, { notes })
        if (project) project.notes = notes
      })
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' })
      if (ta.closest('.db-enq-body')?.style.display !== 'none') {
        ta.dispatchEvent(new Event('input'))
      }
    })

    // --- Resolve comment ---
    mc.querySelectorAll('.db-resolve-cb').forEach(cb => {
      cb.addEventListener('change', async e => {
        e.stopPropagation()
        const pid = cb.dataset.resolvePid
        const cid = cb.dataset.resolveCid
        const p = this.projects.find(x => x.id === pid)
        if (!p) return
        const comments = (p.dashboard_comments || []).map(c =>
          c.id === cid ? { ...c, resolved: cb.checked } : c
        )
        p.dashboard_comments = comments
        const commentEl = cb.closest('.db-comment')
        if (commentEl) {
          commentEl.classList.toggle('db-comment--resolved', cb.checked)
          const icon = commentEl.querySelector('.db-resolve-icon')
          if (icon) icon.classList.toggle('db-resolve-icon--done', cb.checked)
          const txt = commentEl.querySelector('.db-comment-text')
          if (txt) txt.classList.toggle('db-comment-text--resolved', cb.checked)
        }
        try {
          const { updateProject } = await import('./db/client.js')
          await updateProject(this.userId, pid, { dashboard_comments: comments })
        } catch(err) { console.error('Comment resolve failed:', err) }
      })
    })

    // --- Reply toggle ---
    mc.querySelectorAll('.db-reply-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const form = mc.querySelector(`#db-rf-${btn.dataset.replyPid}-${btn.dataset.replyCid}`)
        if (!form) return
        const isOpen = form.style.display !== 'none'
        form.style.display = isOpen ? 'none' : 'flex'
        if (!isOpen) form.querySelector('textarea')?.focus()
      })
    })

    // --- Post reply ---
    mc.querySelectorAll('[data-post-reply-pid]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        const pid = btn.dataset.postReplyPid
        const cid = btn.dataset.postReplyCid
        const form = mc.querySelector(`#db-rf-${pid}-${cid}`)
        const ta = form?.querySelector('textarea')
        const text = ta?.value?.trim()
        if (!text) return
        const p = this.projects.find(x => x.id === pid)
        if (!p) return
        const authorName = this.appUser?.name || this.user?.primaryEmailAddress?.emailAddress || 'You'
        const reply = { id: crypto.randomUUID(), text, author_id: this.userId, author_name: authorName, timestamp: new Date().toISOString() }
        const comments = (p.dashboard_comments || []).map(c =>
          c.id === cid ? { ...c, replies: [...(c.replies||[]), reply] } : c
        )
        p.dashboard_comments = comments
        ta.value = ''
        form.style.display = 'none'
        const thread = mc.querySelector(`#db-thread-${pid}`)
        if (thread) {
          const commentEl = thread.querySelector(`[data-cid="${cid}"]`)
          let repliesEl = commentEl?.querySelector('.db-replies')
          if (!repliesEl) {
            repliesEl = document.createElement('div')
            repliesEl.className = 'db-replies'
            commentEl.querySelector('.db-comment-body')?.insertBefore(repliesEl, commentEl.querySelector('.db-reply-form'))
          }
          const replyDiv = document.createElement('div')
          replyDiv.className = 'db-reply'
          replyDiv.innerHTML = `
            <div class="db-avatar db-avatar--sm" style="background:${avatarColor(reply.author_id)}">${initials(reply.author_name)}</div>
            <div>
              <div class="db-comment-meta">
                <span class="db-comment-author">${esc(reply.author_name)}</span>
                <span class="db-comment-time">just now</span>
              </div>
              <div class="db-comment-text">${esc(reply.text)}</div>
            </div>`
          repliesEl.appendChild(replyDiv)
        }
        try {
          const { updateProject } = await import('./db/client.js')
          await updateProject(this.userId, pid, { dashboard_comments: comments })
        } catch(err) { console.error('Reply save failed:', err) }
      })
    })

    // --- Post comment ---
    mc.querySelectorAll('[data-post-comment]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        const pid = btn.dataset.postComment
        const ta = mc.querySelector(`#db-ci-${pid}`)
        const text = ta?.value?.trim()
        if (!text) return
        const p = this.projects.find(x => x.id === pid)
        if (!p) return
        const authorName = this.appUser?.name || this.user?.primaryEmailAddress?.emailAddress || 'You'
        const comment = { id: crypto.randomUUID(), text, author_id: this.userId, author_name: authorName, timestamp: new Date().toISOString(), resolved: false, replies: [] }
        if (!p.dashboard_comments) p.dashboard_comments = []
        p.dashboard_comments.push(comment)
        ta.value = ''
        const thread = mc.querySelector(`#db-thread-${pid}`)
        if (thread) {
          const noComments = thread.querySelector('.db-no-comments')
          if (noComments) noComments.remove()
          thread.insertAdjacentHTML('beforeend', renderComment(comment, pid))
          // Re-attach listeners for the new comment's controls
          thread.querySelectorAll('.db-resolve-cb').forEach(cb2 => {
            if (cb2._bound) return
            cb2._bound = true
            cb2.addEventListener('change', async ev => {
              ev.stopPropagation()
              const p2 = this.projects.find(x => x.id === cb2.dataset.resolvePid)
              if (!p2) return
              const comments2 = (p2.dashboard_comments||[]).map(c =>
                c.id === cb2.dataset.resolveCid ? { ...c, resolved: cb2.checked } : c
              )
              p2.dashboard_comments = comments2
              cb2.closest('.db-comment')?.classList.toggle('db-comment--resolved', cb2.checked)
              cb2.closest('.db-comment')?.querySelector('.db-resolve-icon')?.classList.toggle('db-resolve-icon--done', cb2.checked)
              cb2.closest('.db-comment')?.querySelector('.db-comment-text')?.classList.toggle('db-comment-text--resolved', cb2.checked)
              try {
                const { updateProject } = await import('./db/client.js')
                await updateProject(this.userId, cb2.dataset.resolvePid, { dashboard_comments: comments2 })
              } catch {}
            })
          })
          thread.querySelectorAll('.db-reply-btn:not([_bound])').forEach(rb => {
            rb.setAttribute('_bound', '1')
            rb.addEventListener('click', ev => {
              ev.stopPropagation()
              const form = mc.querySelector(`#db-rf-${rb.dataset.replyPid}-${rb.dataset.replyCid}`)
              if (form) { const open = form.style.display !== 'none'; form.style.display = open ? 'none' : 'flex'; if (!open) form.querySelector('textarea')?.focus() }
            })
          })
        }
        try {
          const { updateProject } = await import('./db/client.js')
          await updateProject(this.userId, pid, { dashboard_comments: p.dashboard_comments })
        } catch(err) { console.error('Comment save failed:', err) }
      })
    })

    // --- Retainer hours bars (async) ---
    if (retainers.length > 0) {
      const { getTimeEntries } = await import('./db/client.js')
      for (const p of retainers) {
        const periodMult2 = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}
        const calcH = (p.retainer_items||[]).reduce((s,i) => {
          const mult = periodMult2[i.period||'month']||1
          return s + (i.unit==='hours' ? (parseFloat(i.qty)||0)*mult : (parseFloat(i.qty)||0)*8*mult)
        }, 0)
        const allocH = calcH || (parseFloat(p.retainer_hours)||0)
        if (!allocH) continue
        try {
          const [periodStart, periodEnd] = this._retainerPeriod(p.retainer_start)
          const allEntries = await getTimeEntries(p.id)
          const entries = periodStart
            ? allEntries.filter(e => { const d = new Date(e.entry_date); return d >= periodStart && d < periodEnd })
            : allEntries
          const logged = entries.reduce((s, e) => s + parseFloat(e.hours), 0)
          const alertPctVal = parseFloat(p.retainer_alert) || 80
          const alertEl = mc.querySelector(`[data-ret-alert="${p.id}"]`)
          const items = p.retainer_items || []

          // Compute per-item rollover deltas from previous period
          const rolloverDeltas = {}
          if (p.retainer_rollover && periodStart) {
            const [prevStart, prevEnd] = this._retainerPreviousPeriod(p.retainer_start)
            if (prevStart) {
              const prevEntries = allEntries.filter(e => { const d = new Date(e.entry_date); return d >= prevStart && d < prevEnd })
              const pm4 = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}
              for (const item of items) {
                const mult = pm4[item.period||'month'] || 1
                const prevAllocH = item.unit==='hours' ? Math.round((parseFloat(item.qty)||0)*mult) : Math.round((parseFloat(item.qty)||0)*8*mult)
                const prevLogged = prevEntries.filter(e => e.line_label === item.label).reduce((s,e) => s + parseFloat(e.hours), 0)
                rolloverDeltas[item.label] = prevAllocH - prevLogged
              }
            }
          }

          if (items.length) {
            const pm3 = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}
            let totalEffective = 0
            items.forEach((item, ii) => {
              const mult = pm3[item.period||'month'] || 1
              const baseH = item.unit==='hours' ? Math.round((parseFloat(item.qty)||0)*mult) : Math.round((parseFloat(item.qty)||0)*8*mult)
              if (!baseH) return
              const delta = rolloverDeltas[item.label] ?? 0
              const aH = Math.max(0, baseH + delta)
              totalEffective += aH
              const iL = entries.filter(e => e.line_label === item.label).reduce((s,e) => s + parseFloat(e.hours), 0)
              const iPct = aH > 0 ? Math.min(100, Math.round(iL / aH * 100)) : 100
              const iCol = iPct >= 100 ? '#ef4444' : iPct >= alertPctVal ? '#f59e0b' : '#a78bfa'
              const bar = mc.querySelector(`[data-ret-item-bar="${p.id}-${ii}"]`)
              const lbl = mc.querySelector(`[data-ret-item-label="${p.id}-${ii}"]`)
              if (bar) { bar.style.width = iPct + '%'; bar.style.background = iCol }
              const rolloverNote = delta !== 0 ? ` (${delta > 0 ? '+' : ''}${Math.round(delta)}h)` : ''
              if (lbl) { lbl.textContent = `${iL.toFixed(1)} / ${aH}h${rolloverNote}`; lbl.style.color = iPct >= alertPctVal ? iCol : '' }
            })
            const hours = totalEffective || allocH
            const pct = hours > 0 ? Math.min(100, Math.round(logged / hours * 100)) : 0
            const colour = pct >= 100 ? '#ef4444' : pct >= alertPctVal ? '#f59e0b' : '#a78bfa'
            if (alertEl && pct >= alertPctVal && pct < 100) { alertEl.style.display='block'; alertEl.style.color=colour; alertEl.textContent=`⚠ ${pct}% used overall` }
            if (alertEl && pct >= 100) { alertEl.style.display='block'; alertEl.style.color=colour; alertEl.textContent=`⚠ Over allocation by ${(logged-hours).toFixed(1)}h` }
          } else {
            // Legacy retainer_hours path — apply rollover on total
            let hours = allocH
            if (p.retainer_rollover && periodStart) {
              const [prevStart, prevEnd] = this._retainerPreviousPeriod(p.retainer_start)
              if (prevStart) {
                const prevEntries = allEntries.filter(e => { const d = new Date(e.entry_date); return d >= prevStart && d < prevEnd })
                const prevLogged = prevEntries.reduce((s,e) => s + parseFloat(e.hours), 0)
                hours = Math.max(0, hours + (hours - prevLogged))
              }
            }
            const pct = Math.min(100, Math.round(logged / hours * 100))
            const bar = mc.querySelector(`[data-ret-bar="${p.id}"]`)
            const label = mc.querySelector(`[data-ret-label="${p.id}"]`)
            const colour = pct >= 100 ? '#ef4444' : pct >= alertPctVal ? '#f59e0b' : '#a78bfa'
            if (bar) { bar.style.width = pct + '%'; bar.style.background = colour }
            if (label) { label.textContent = `${logged.toFixed(1)} / ${hours}h`; label.style.color = pct >= alertPctVal ? colour : '' }
            if (alertEl && pct >= alertPctVal && pct < 100) { alertEl.style.display='block'; alertEl.style.color=colour; alertEl.textContent=`⚠ ${pct}% used — ${(hours-logged).toFixed(1)}h remaining` }
            if (alertEl && pct >= 100) { alertEl.style.display='block'; alertEl.style.color=colour; alertEl.textContent=`⚠ Over allocation by ${(logged-hours).toFixed(1)}h` }
          }
        } catch(e) { /* silent */ }
      }
    }
  }

  // ── Notes sidebar ────────────────────────────────────────────────────────────

  async _loadNotes() {
    const list = document.getElementById('notes-list')
    if (list) list.innerHTML = `<div class="notes-empty" style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:13px">Loading…</div>`
    try {
      const { getUserNotes, deleteUserNote } = await import('./db/client.js')
      const all = await getUserNotes(this.clerkUserId)
      // Purge any pre-existing empty "Untitled" notes (no title and no body).
      const empties = all.filter(n => !(n.title || '').trim() && !(n.content || '').trim())
      if (empties.length) {
        await Promise.all(empties.map(n => deleteUserNote(this.clerkUserId, n.id).catch(e => console.error('Failed to purge empty note:', e))))
      }
      this._notes = all.filter(n => (n.title || '').trim() || (n.content || '').trim())
      this._notesLoaded = true
      this._renderNotesList()
    } catch(e) {
      console.error('Failed to load notes:', e)
      if (list) list.innerHTML = `<div class="notes-empty">Failed to load notes.</div>`
    }
  }

  _renderNotesList() {
    const list = document.getElementById('notes-list')
    if (!list) return
    if (!this._notes?.length) {
      list.innerHTML = `<div class="notes-empty">No notes yet.<br>Hit + New to get started.</div>`
      return
    }
    const relTime = ts => {
      if (!ts) return ''
      const diff = Date.now() - new Date(ts).getTime()
      const m = Math.floor(diff / 60000)
      if (m < 1) return 'just now'
      if (m < 60) return `${m}m ago`
      const h = Math.floor(m / 60)
      if (h < 24) return `${h}h ago`
      return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    }
    if (!this._openNoteIds) this._openNoteIds = new Set()
    const chevron = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5l3 3 3-3"/></svg>`
    const trashIcon = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M5 4l.5 9h5l.5-9"/></svg>`
    list.innerHTML = this._notes.map(n => {
      const isOpen = this._openNoteIds.has(n.id)
      return `
      <div class="notes-card${isOpen?' open':''}" data-note-id="${n.id}">
        <div class="notes-card-header" data-toggle-id="${n.id}">
          <input class="notes-title-input" data-note-id="${n.id}" value="${(n.title||'').replace(/"/g,'&quot;')}" placeholder="Untitled" />
          <button class="notes-delete-hover" data-delete-id="${n.id}" aria-label="Delete note" title="Delete note">${trashIcon}</button>
          <button class="notes-card-toggle" data-toggle-id="${n.id}" aria-label="Toggle note" aria-expanded="${isOpen}">${chevron}</button>
        </div>
        <div class="notes-card-body">
          <textarea class="notes-body-input" data-note-id="${n.id}" placeholder="Write something…" rows="4">${n.content||''}</textarea>
          <div class="notes-card-meta" style="display:flex;align-items:center;gap:6px;padding:4px 10px 2px;flex-wrap:wrap">
            <input type="date" class="notes-due-input" data-note-id="${n.id}" value="${n.due_date||''}" title="Due date" />
            <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:#596773;cursor:pointer;user-select:none">
              <input type="checkbox" class="notes-reminder-input" data-note-id="${n.id}" ${n.reminder?'checked':''} style="width:12px;height:12px;cursor:pointer" />
              Remind 36h before
            </label>
          </div>
          <div class="notes-card-footer">
            <span class="notes-timestamp">${relTime(n.updated_at)}</span>
            <button class="notes-delete-btn" data-delete-id="${n.id}" title="Delete note">${trashIcon}<span>Delete</span></button>
          </div>
        </div>
      </div>`
    }).join('')

    const toggleNote = (id) => {
      const card = list.querySelector(`.notes-card[data-note-id="${id}"]`)
      if (!card) return
      const isOpen = this._openNoteIds.has(id)
      if (isOpen) { this._openNoteIds.delete(id); card.classList.remove('open') }
      else { this._openNoteIds.add(id); card.classList.add('open') }
      const btn = card.querySelector('.notes-card-toggle')
      if (btn) btn.setAttribute('aria-expanded', String(!isOpen))
      if (!isOpen) {
        const ta = card.querySelector('.notes-body-input')
        if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }
      }
    }
    list.querySelectorAll('.notes-card-header').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('.notes-title-input')) return
        if (e.target.closest('.notes-delete-hover')) return
        toggleNote(header.dataset.toggleId)
      })
    })

    list.querySelectorAll('.notes-title-input').forEach(input => {
      input.addEventListener('blur', () => this._saveNote(input.dataset.noteId, { title: input.value }))
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const id = input.dataset.noteId
          if (!this._openNoteIds.has(id)) toggleNote(id)
          input.closest('.notes-card')?.querySelector('.notes-body-input')?.focus()
        }
      })
    })
    list.querySelectorAll('.notes-body-input').forEach(ta => {
      ta.addEventListener('blur', () => this._saveNote(ta.dataset.noteId, { content: ta.value }))
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' })
      ta.dispatchEvent(new Event('input'))
    })
    list.querySelectorAll('.notes-due-input').forEach(input => {
      input.addEventListener('change', () => this._saveNote(input.dataset.noteId, { due_date: input.value || null }))
    })
    list.querySelectorAll('.notes-reminder-input').forEach(cb => {
      cb.addEventListener('change', () => this._saveNote(cb.dataset.noteId, { reminder: cb.checked }))
    })
    list.querySelectorAll('.notes-delete-btn, .notes-delete-hover').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this._deleteNote(btn.dataset.deleteId) })
    })

    // Discard an empty draft once focus leaves its card without any content.
    list.querySelectorAll('.notes-card').forEach(card => {
      card.addEventListener('focusout', () => {
        setTimeout(() => {
          if (card.contains(document.activeElement)) return
          const id = card.dataset.noteId
          const note = (this._notes || []).find(n => n.id === id)
          if (note && note._draft && !note._dbId &&
              !(note.title || '').trim() && !(note.content || '').trim() && !note.due_date && !note.reminder) {
            this._notes = this._notes.filter(n => n.id !== id)
            this._openNoteIds.delete(id)
            this._renderNotesList()
          }
        }, 0)
      })
    })
  }

  // Create a client-only draft. It isn't written to the DB until it gains a
  // title or body (see _saveNote), and is discarded on blur if left empty.
  _newNote() {
    if (!this._notes) this._notes = []
    if (!this._openNoteIds) this._openNoteIds = new Set()
    // Don't stack multiple empty drafts — focus the existing one instead.
    const existingDraft = this._notes.find(n => n._draft && !n._dbId)
    if (existingDraft) {
      this._openNoteIds.add(existingDraft.id)
      this._renderNotesList()
      document.querySelector(`.notes-card[data-note-id="${existingDraft.id}"] .notes-title-input`)?.focus()
      return
    }
    const draft = {
      id: 'draft-' + Date.now(),
      title: '', content: '', due_date: null, reminder: false,
      updated_at: new Date().toISOString(),
      _draft: true, _dbId: null,
    }
    this._openNoteIds.add(draft.id)
    this._notes.unshift(draft)
    this._renderNotesList()
    document.querySelector(`.notes-card[data-note-id="${draft.id}"] .notes-title-input`)?.focus()
  }

  async _saveNote(id, data) {
    const note = (this._notes || []).find(n => n.id === id)
    if (!note) return
    Object.assign(note, data)

    // Draft: persist only once it has a title or body. Keep the temp id as the
    // stable DOM key and store the DB id separately so concurrent title/body
    // blurs don't race or double-create.
    if (note._draft && !note._dbId) {
      // Persist once there's anything worth keeping — a title, a body, or a
      // due date / reminder the user deliberately set.
      const hasContent = (note.title || '').trim() || (note.content || '').trim() || note.due_date || note.reminder
      if (!hasContent) return
      if (!note._createPromise) {
        note._createPromise = (async () => {
          const { createUserNote } = await import('./db/client.js')
          return createUserNote(this.clerkUserId, {
            title: note.title || '', content: note.content || '',
            due_date: note.due_date || null, reminder: note.reminder || false,
            sort_order: 0,
          })
        })()
      }
      try {
        const created = await note._createPromise
        if (!note._dbId) {
          note._dbId = created.id
          note._draft = false
          note.created_at = created.created_at
          note.updated_at = created.updated_at
          const ts = document.querySelector(`.notes-card[data-note-id="${id}"] .notes-timestamp`)
          if (ts) ts.textContent = 'just now'
        }
      } catch(e) { console.error('Failed to create note:', e); note._createPromise = null; return }
      // Fall through to push the latest field value (covers edits made while the
      // create was still in flight).
    }

    const dbId = note._dbId ?? note.id
    try {
      const { updateUserNote } = await import('./db/client.js')
      const updated = await updateUserNote(this.clerkUserId, dbId, data)
      if (updated) {
        // Only sync metadata — keep the locally-typed fields as source of truth
        // so an out-of-order response can't overwrite a newer edit.
        note._dbId = dbId
        note.updated_at = updated.updated_at
        const ts = document.querySelector(`.notes-card[data-note-id="${id}"] .notes-timestamp`)
        if (ts) ts.textContent = 'just now'
      }
    } catch(e) { console.error('Failed to save note:', e) }
  }

  async _deleteNote(id) {
    const note = (this._notes || []).find(n => n.id === id)
    if (!note) return
    // A never-persisted draft has no DB row — just drop it locally, no prompt.
    if (note._draft && !note._dbId) {
      this._notes = this._notes.filter(n => n.id !== id)
      this._openNoteIds?.delete(id)
      this._renderNotesList()
      return
    }
    const title = (note.title || '').trim()
    if (!await this.confirm({ title: title ? `Delete note '${title}'?` : 'Delete this note?', confirmLabel: 'Delete' })) return
    try {
      const { deleteUserNote } = await import('./db/client.js')
      await deleteUserNote(this.clerkUserId, note._dbId ?? id)
      this._notes = (this._notes || []).filter(n => n.id !== id)
      this._openNoteIds?.delete(id)
      this._renderNotesList()
      this.toast('Note deleted')
    } catch(e) { console.error('Failed to delete note:', e); this.toast('Error deleting note') }
  }

  renderSettings(mc) {
    const s = this.settings ?? {}
    const isAdmin = this.appUser?.role === 'superadmin'

    // Workspace is split into sub-tabs for admins; non-admins only have the
    // (non-admin) leave settings, so they keep a single Workspace tab.
    const tabs = isAdmin
      ? [
          { id: 'account',   label: 'My account' },
          { id: 'company',   label: 'Company' },
          { id: 'invoicing', label: 'Invoicing' },
          { id: 'budget',    label: 'Budget template' },
          { id: 'users',     label: 'Users' },
        ]
      : [
          { id: 'account',   label: 'My account' },
          { id: 'workspace', label: 'Workspace' },
        ]
    // Fall back to the first tab if the remembered one isn't valid for this role.
    let tab = this._settingsTab ?? 'account'
    if (!tabs.some(t => t.id === tab)) tab = 'account'

    // ── User-level panels ───────────────────────────────────────────────
    const accountPanel = `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Account</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:13px;color:var(--text-secondary)">
              Signed in as <strong>${this.user.primaryEmailAddress?.emailAddress??''}</strong>
              <span class="tag" style="background:var(--bg-secondary);color:var(--text-secondary);margin-left:8px;text-transform:capitalize">${this.appUser?.role??'user'}</span>
            </div>
            <div class="field">
              <div class="field-label">Your role / job title</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px">Shown when you're added to call sheets and crew lists.</div>
              <div style="display:flex;gap:8px">
                <input type="text" id="account-job-title" value="${(this.appUser?.default_role??'').replace(/"/g,'&quot;')}" placeholder="e.g. Camera Operator" style="flex:1;padding:8px 11px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
                <button class="btn-primary" id="account-job-title-save">Save</button>
              </div>
            </div>
            <button class="btn-cancel" style="width:fit-content" id="signout-settings">Sign out</button>
          </div>
        </div>`

    const roundupPanel = `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Reminder roundup</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Receive a daily email listing all the reminder emails sent to your team that day. Not sent at weekends.</div>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--text-primary)">
              <input type="checkbox" id="s-reminder-roundup" ${s.reminder_roundup ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" />
              Send me a reminder roundup email each day
            </label>
            <div><button class="btn-primary" id="settings-save-roundup-btn">Save</button></div>
          </div>
        </div>`

    // ── Workspace-level panels ──────────────────────────────────────────
    const companyDetailsPanel = isAdmin ? `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Company details</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">These details appear in quote PDFs and exports.</div>
            <div class="field"><div class="field-label">Company name</div><input type="text" id="s-name" value="${s.company_name??''}" placeholder="Slate" /></div>
            <div class="field-row">
              <div class="field"><div class="field-label">Email address</div><input type="email" id="s-email" value="${s.email??''}" /></div>
              <div class="field"><div class="field-label">Phone</div><input type="text" id="s-phone" value="${s.phone??''}" /></div>
            </div>
            <div class="field"><div class="field-label">Website</div><input type="text" id="s-website" value="${s.website??''}" /></div>
            <div class="field"><div class="field-label">Address (optional)</div><input type="text" id="s-address" value="${s.address??''}" /></div>
            <div class="field-row">
              <div class="field"><div class="field-label">VAT number</div><input type="text" id="s-vat" value="${s.vat_number??''}" placeholder="GB 000 0000 00" /></div>
              <div class="field"><div class="field-label">Default prepared by</div><input type="text" id="s-preparedby" value="${s.prepared_by??''}" placeholder="e.g. Robbie Meade" /></div>
              ${isAdmin ? `<div class="field"><div class="field-label">Financial year start month</div>
                <select id="s-fy-start">
                  ${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i) =>
                    `<option value="${i+1}" ${(s.financial_year_start??4)===(i+1)?'selected':''}>${m}</option>`
                  ).join('')}
                </select>
              </div>` : ''}
              <div class="field">
                <div class="field-label">Default H&amp;S boilerplate (used on call sheets)</div>
                <textarea id="s-hs" style="width:100%;min-height:100px;padding:8px 11px;font-size:12px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.6" placeholder="e.g. No alcohol or non-prescription drugs during the working day. Only qualified personnel to handle hazardous equipment…">${s.hs_boilerplate??''}</textarea>
              </div>
            </div>
            <div><button class="btn-primary" id="settings-save-btn" data-settings-primary-save>Save settings</button></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><span class="panel-title">Default insurance</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Used as the default insurer on all call sheets. Can be overridden per-project or per-shoot.</div>
            <div class="field-row">
              <div class="field"><div class="field-label">Insurer name</div><input type="text" id="s-ins-name" value="${s.default_insurer_name??''}" placeholder="e.g. TYSERS" /></div>
              <div class="field"><div class="field-label">Contact name</div><input type="text" id="s-ins-contact" value="${s.default_insurer_contact??''}" placeholder="e.g. Amy Volino" /></div>
            </div>
            <div class="field"><div class="field-label">Address</div><input type="text" id="s-ins-addr" value="${s.default_insurer_address??''}" placeholder="71 Fenchurch Street, London, EC3M 4BS" /></div>
            <div class="field"><div class="field-label">Email</div><input type="email" id="s-ins-email" value="${s.default_insurer_email??''}" placeholder="contact@insurer.com" /></div>
            <div><button class="btn-primary" id="settings-save-btn-2" data-settings-primary-save>Save settings</button></div>
          </div>
        </div>` : ''

    const invoicingDefaultsPanel = isAdmin ? `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Invoicing defaults (for crew call sheets)</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">The email and boilerplate shown to crew on call sheets so they know where to send invoices and what to include.</div>
            <div class="field"><div class="field-label">Default invoicing email</div><input type="email" id="s-inv-email" value="${s.invoicing_email??''}" placeholder="e.g. finance@yourstudio.com" /></div>
            <div class="field">
              <div class="field-label">Invoicing boilerplate</div>
              <textarea id="s-inv-boilerplate" style="width:100%;min-height:140px;padding:8px 11px;font-size:12px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.6" placeholder="In order to comply with HMRC regulations and for us to pay your invoice, please include the following:&#10;1. Correct Banking Information&#10;2. Dates worked and service provided&#10;3. Full name as registered with HMRC…">${s.invoicing_boilerplate??''}</textarea>
            </div>
            <div><button class="btn-primary" id="settings-save-btn-3" data-settings-primary-save>Save settings</button></div>
          </div>
        </div>` : ''

    const usersPanel = isAdmin ? `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Users</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Invite-only. New users receive an email invitation from Clerk and are assigned the User role by default. Only superadmins can edit names, email addresses and roles.</div>
            <div style="display:flex;gap:8px">
              <input type="email" id="invite-email" placeholder="colleague@email.com" style="flex:1;padding:8px 11px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
              <button class="btn-primary" id="invite-btn">Send invite</button>
            </div>
            <div id="users-list"><div style="font-size:12px;color:var(--text-tertiary)">Loading users…</div></div>
          </div>
        </div>` : ''

    const holidaysPanel = isAdmin ? `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Public holidays</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Public holidays are skipped when calculating how many days a leave request costs. Weekends are always excluded automatically.</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input type="date" id="hol-date" style="font-size:13px;padding:7px 10px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;color-scheme:var(--color-scheme,light)" />
              <input type="text" id="hol-name" placeholder="e.g. Christmas Day" style="flex:1;min-width:140px;font-size:13px;padding:7px 10px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
              <button class="btn-primary" id="hol-add-btn">Add</button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;padding-top:4px;border-top:1px solid var(--border-light)">
              <span style="font-size:12px;color:var(--text-tertiary)">Or import from GOV.UK:</span>
              <select id="hol-sync-year" style="font-size:12px;padding:5px 8px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                ${[-1, 0, 1].map(offset => { const y = new Date().getFullYear() + offset; return `<option value="${y}" ${offset===0?'selected':''}>${y}</option>` }).join('')}
              </select>
              <button class="row-btn" id="hol-sync-btn" style="font-size:12px">Sync England &amp; Wales bank holidays</button>
            </div>
            <div id="holidays-list"><div style="font-size:12px;color:var(--text-tertiary)">Loading…</div></div>
          </div>
        </div>` : ''

    const leavePanel = `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Leave settings</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Set the date each year when leave allowances reset. Default is 1st April to match the UK financial year.</div>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <div class="field" style="margin:0">
                <div class="field-label">Leave year starts on</div>
                <div style="display:flex;align-items:center;gap:8px">
                  <input type="number" id="s-leave-day" value="${s.leave_year_start_day??1}" min="1" max="31" style="width:64px;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none" />
                  <select id="s-leave-month" style="padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                    ${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i) =>
                      `<option value="${i+1}" ${(s.leave_year_start_month??4)===(i+1)?'selected':''}>${m}</option>`
                    ).join('')}
                  </select>
                </div>
              </div>
            </div>
            <div><button class="btn-primary" id="settings-save-leave-btn" data-settings-primary-save>Save</button></div>
          </div>
        </div>`

    const timersPanel = isAdmin ? `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Dashboard days-since timer</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Show a compact days-since counter at the top of the Dashboard — useful for tracking how long something has been running.</div>
            <div class="field"><div class="field-label">Timer label</div><input type="text" id="s-ds-name" value="${s.days_since_timer?.name??''}" placeholder="e.g. Studio opening" /></div>
            <div class="field"><div class="field-label">Start date</div><input type="date" id="s-ds-since" value="${s.days_since_timer?.since??''}" style="color-scheme:var(--color-scheme,light)" /></div>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn-primary" id="settings-save-ds-btn">Save timer</button>
              ${s.days_since_timer ? `<button class="btn-cancel" id="settings-clear-ds-btn">Remove timer</button>` : ''}
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><span class="panel-title">Dashboard countdown timer</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Pin a countdown to the top of the Dashboard — great for project wrap dates or big deadlines. For 24 hours after the deadline, a celebration kicks off.</div>
            <div class="field"><div class="field-label">Timer label</div><input type="text" id="s-cd-name" value="${s.countdown_timer?.name??''}" placeholder="e.g. Project Falcon wrap" /></div>
            <div class="field"><div class="field-label">Target date &amp; time</div><input type="datetime-local" id="s-cd-target" value="${s.countdown_timer?.target??''}" style="color-scheme:var(--color-scheme,light)" /></div>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn-primary" id="settings-save-cd-btn">Save timer</button>
              ${s.countdown_timer ? `<button class="btn-cancel" id="settings-clear-cd-btn">Remove timer</button>` : ''}
            </div>
          </div>
        </div>` : ''

    const expenseFxPanels = isAdmin ? `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Expense tracker</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">On the second-to-last working day of each month, a summary of all team expenses is automatically emailed to the recipients below.</div>
            <div class="field">
              <div class="field-label">Mileage rate (pence per mile)</div>
              <input type="number" id="s-mileage-rate" value="${s.mileage_rate ?? 45}" min="0" step="0.1" style="width:100px" />
            </div>
            <div class="field">
              <div class="field-label">Per diem rate (£ per day)</div>
              <input type="number" id="s-per-diem-rate" value="${s.per_diem_rate ?? 0}" min="0" step="0.01" style="width:100px" />
            </div>
            <div class="field">
              <div class="field-label">Expense email recipients</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px">Select team members who should receive the monthly expense report.</div>
              <div id="exp-recipients-list" style="display:flex;flex-direction:column;gap:6px">
                ${(this.allUsers ?? []).map(u => {
                  const checked = (s.expense_recipients ?? []).includes(u.clerk_id)
                  return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-primary)">
                    <input type="checkbox" class="exp-recipient-check" data-clerk-id="${u.clerk_id}" ${checked ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)" />
                    ${u.name ? `<span>${u.name}</span><span style="font-size:11px;color:var(--text-tertiary)">${u.email}</span>` : `<span>${u.email}</span>`}
                  </label>`
                }).join('')}
              </div>
            </div>
            <div><button class="btn-primary" id="settings-save-expenses-btn">Save</button></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><span class="panel-title">Currency &amp; exchange rates</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Budgets are held in GBP. When a budget is shown or exported in USD or EUR, this margin is added on top of the live exchange rate to cover currency fluctuation and conversion costs.</div>
            <div class="field">
              <div class="field-label">FX margin (%)</div>
              <input type="number" id="s-fx-markup" value="${s.fx_markup_pct ?? 3}" min="0" max="100" step="0.1" style="width:100px" />
            </div>
            <div><button class="btn-primary" id="settings-save-fx-btn">Save</button></div>
          </div>
        </div>` : ''

    const budgetPanel = isAdmin ? `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Budget template</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:12px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">
              Define the default sections and line items that appear when creating a new budget.
              Changes here affect new budgets only — existing budgets are not modified.
            </div>
            <div id="budget-template-editor">
              <div style="font-size:12px;color:var(--text-tertiary)">Loading template…</div>
            </div>
          </div>
        </div>` : '<div></div>'

    // ── Assemble tabs ───────────────────────────────────────────────────
    const tabBar = `<div style="display:flex;gap:0;border-bottom:1px solid var(--border-light);margin-bottom:20px">
      ${tabs.map(t => `
        <button class="settings-tab" data-tab="${t.id}"
          style="padding:8px 16px;font-size:13px;font-family:var(--font);cursor:pointer;background:none;border:none;border-bottom:2px solid ${tab===t.id?'var(--accent)':'transparent'};color:${tab===t.id?'var(--accent)':'var(--text-secondary)'};font-weight:${tab===t.id?'600':'400'};transition:all 0.15s;margin-bottom:-1px">
          ${t.label}
        </button>`).join('')}
    </div>`

    const wrap = inner => `<div style="display:flex;flex-direction:column;gap:16px;max-width:760px">${inner}</div>`
    if (tab === 'account') {
      mc.innerHTML = tabBar + wrap(`${accountPanel}${roundupPanel}`)
    } else if (tab === 'company') {
      mc.innerHTML = tabBar + wrap(`${companyDetailsPanel}${timersPanel}`)
    } else if (tab === 'invoicing') {
      mc.innerHTML = tabBar + wrap(`${invoicingDefaultsPanel}${expenseFxPanels}`)
    } else if (tab === 'budget') {
      mc.innerHTML = tabBar + wrap(budgetPanel)
    } else if (tab === 'users') {
      mc.innerHTML = tabBar + wrap(`${usersPanel}${holidaysPanel}${leavePanel}`)
    } else {
      // Non-admin "Workspace" tab — leave settings only.
      mc.innerHTML = tabBar + wrap(leavePanel)
    }

    mc.querySelectorAll('.settings-tab').forEach(btn => btn.addEventListener('click', () => {
      this._settingsTab = btn.dataset.tab
      this.renderSettings(mc)
    }))

    mc.querySelector('#settings-save-btn')?.addEventListener('click', () => this.saveSettings(mc))
    mc.querySelector('#settings-save-btn-2')?.addEventListener('click', () => this.saveSettings(mc))
    mc.querySelector('#settings-save-btn-3')?.addEventListener('click', () => this.saveSettings(mc))
    mc.querySelector('#signout-settings')?.addEventListener('click', () => this.onSignOut())
    mc.querySelector('#account-job-title-save')?.addEventListener('click', () => this._saveJobTitle(mc))
    mc.querySelector('#settings-save-ds-btn')?.addEventListener('click', () => this._saveDaysSinceTimer(mc))
    mc.querySelector('#settings-clear-ds-btn')?.addEventListener('click', () => this._clearDaysSinceTimer(mc))
    mc.querySelector('#settings-save-cd-btn')?.addEventListener('click', () => this._saveCountdownTimer(mc))
    mc.querySelector('#settings-clear-cd-btn')?.addEventListener('click', () => this._clearCountdownTimer(mc))
    mc.querySelector('#settings-save-roundup-btn')?.addEventListener('click', () => this._saveReminderRoundup(mc))
    mc.querySelector('#settings-save-expenses-btn')?.addEventListener('click', () => this._saveExpenseSettings(mc))
    mc.querySelector('#settings-save-fx-btn')?.addEventListener('click', () => this._saveFxSettings(mc))
    mc.querySelector('#settings-save-leave-btn')?.addEventListener('click', () => this._saveLeaveSettings(mc))

    if (isAdmin && tab === 'users') {
      this._loadUsersPanel(mc)
      mc.querySelector('#invite-btn')?.addEventListener('click', () => this._sendInvite(mc))
      this._renderHolidaysPanel(mc)
      mc.querySelector('#hol-add-btn')?.addEventListener('click', () => this._addHoliday(mc))
      mc.querySelector('#hol-sync-btn')?.addEventListener('click', () => this._syncUKHolidays(mc))
    }
    if (isAdmin && tab === 'budget') {
      this._mountTemplateEditor(mc)
    }
  }

  async _mountTemplateEditor(mc) {
    const { SECTIONS } = await import('./views/budgets.js')
    const el = mc.querySelector('#budget-template-editor')
    if (!el) return

    // Deep clone the template — use saved or fall back to built-in SECTIONS
    let template = JSON.parse(JSON.stringify(
      this.settings?.budget_template ?? SECTIONS
    ))

    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')

    const render = () => {
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px" id="tpl-sections">
          ${template.map((s, si) => `
            <div style="border:1px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden" data-tsi="${si}">
              <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--bg-secondary);border-bottom:1px solid var(--border-light)">
                <input type="text" value="${esc(s.code)}" data-tpl-code="${si}"
                  style="width:48px;font-size:12px;font-weight:600;padding:4px 6px;border:1px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
                <input type="text" value="${esc(s.label)}" data-tpl-label="${si}"
                  style="flex:1;font-size:13px;padding:4px 8px;border:1px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
                <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-tertiary);cursor:pointer;white-space:nowrap">
                  <input type="checkbox" ${s.crew?'checked':''} data-tpl-crew="${si}" style="cursor:pointer" /> Crew section
                </label>
                <button class="row-btn" data-tpl-del-sec="${si}" style="color:#b03020;flex-shrink:0">× Remove section</button>
              </div>
              <table style="width:100%;border-collapse:collapse">
                <thead>
                  <tr style="background:var(--bg-secondary)">
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;padding:6px 8px;text-align:left;font-weight:400;border-bottom:1px solid var(--border-light)">Item name</th>
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;padding:6px 8px;text-align:right;font-weight:400;border-bottom:1px solid var(--border-light)">Default rate £</th>
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;padding:6px 4px;text-align:center;font-weight:400;border-bottom:1px solid var(--border-light)" title="Daily rate">Daily</th>
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;padding:6px 4px;text-align:center;font-weight:400;border-bottom:1px solid var(--border-light)" title="Track time">⏱</th>
                    <th style="border-bottom:1px solid var(--border-light);width:28px"></th>
                  </tr>
                </thead>
                <tbody>
                  ${(s.lines||[]).map((l, li) => `
                    <tr style="border-bottom:1px solid var(--border-light)">
                      <td style="padding:5px 8px">
                        <input type="text" value="${esc(l.item)}" data-tpl-item="${si},${li}"
                          style="width:100%;font-size:13px;padding:5px 7px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
                      </td>
                      <td style="padding:5px 8px">
                        <input type="number" value="${l.rate??''}" placeholder="0" min="0"
                          data-tpl-rate="${si},${li}"
                          style="width:80px;font-size:13px;padding:5px 7px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;text-align:right;display:block;margin-left:auto" />
                      </td>
                      <td style="padding:5px 4px;text-align:center">
                        <input type="checkbox" ${l.useDays?'checked':''} data-tpl-usedays="${si},${li}" style="cursor:pointer" />
                      </td>
                      <td style="padding:5px 4px;text-align:center">
                        <input type="checkbox" ${l.track_time?'checked':''} data-tpl-track="${si},${li}" style="cursor:pointer" ${!l.useDays?'disabled title="Enable daily rate first"':''} />
                      </td>
                      <td style="padding:5px 4px;text-align:center">
                        <button class="row-btn" data-tpl-del-line="${si},${li}" style="color:#b03020;font-size:11px;padding:2px 6px">×</button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
              <button data-tpl-add-line="${si}"
                style="display:flex;align-items:center;gap:6px;padding:8px 12px;font-size:12px;color:var(--text-tertiary);cursor:pointer;border:none;border-top:1px solid var(--border-light);background:transparent;width:100%;text-align:left;font-family:var(--font);transition:background 0.1s,color 0.1s"
                onmouseover="this.style.background='var(--bg-secondary)';this.style.color='var(--text-secondary)'"
                onmouseout="this.style.background='transparent';this.style.color='var(--text-tertiary)'">
                + add line item
              </button>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="dashed-btn" id="tpl-add-section" style="flex:1">+ add section</button>
          <button class="btn-secondary" id="tpl-reset">Reset to defaults</button>
          <button class="btn-primary" id="tpl-save" data-settings-primary-save>Save template</button>
        </div>`

      // ── Bindings ──────────────────────────────────────────────────────────

      // Section code / label / crew
      el.querySelectorAll('[data-tpl-code]').forEach(inp => {
        inp.addEventListener('change', () => { template[+inp.dataset.tplCode].code = inp.value.trim().toUpperCase() })
      })
      el.querySelectorAll('[data-tpl-label]').forEach(inp => {
        inp.addEventListener('change', () => { template[+inp.dataset.tplLabel].label = inp.value.trim() })
      })
      el.querySelectorAll('[data-tpl-crew]').forEach(cb => {
        cb.addEventListener('change', () => { template[+cb.dataset.tplCrew].crew = cb.checked })
      })
      el.querySelector('#tpl-add-section')?.addEventListener('click', () => {
        template.push({ code: 'X', label: 'New section', crew: false, lines: [{ item: '', rate: null, useDays: false, track_time: false }] })
        render()
      })
      el.querySelectorAll('[data-tpl-del-sec]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!await this.confirm({ title: 'Remove section?', message: 'Remove this section from the template?', confirmLabel: 'Remove' })) return
          template.splice(+btn.dataset.tplDelSec, 1); render()
        })
      })

      // Line item / rate / useDays / track_time / delete
      el.querySelectorAll('[data-tpl-item]').forEach(inp => {
        inp.addEventListener('change', () => {
          const [si,li] = inp.dataset.tplItem.split(',').map(Number)
          template[si].lines[li].item = inp.value
        })
      })
      el.querySelectorAll('[data-tpl-rate]').forEach(inp => {
        inp.addEventListener('change', () => {
          const [si,li] = inp.dataset.tplRate.split(',').map(Number)
          template[si].lines[li].rate = parseFloat(inp.value) || null
        })
      })
      el.querySelectorAll('[data-tpl-usedays]').forEach(cb => {
        cb.addEventListener('change', () => {
          const [si,li] = cb.dataset.tplUsedays.split(',').map(Number)
          template[si].lines[li].useDays = cb.checked
          if (!cb.checked) template[si].lines[li].track_time = false
          render()  // re-render to enable/disable track checkbox
        })
      })
      el.querySelectorAll('[data-tpl-track]').forEach(cb => {
        cb.addEventListener('change', () => {
          const [si,li] = cb.dataset.tplTrack.split(',').map(Number)
          template[si].lines[li].track_time = cb.checked
        })
      })
      el.querySelectorAll('[data-tpl-del-line]').forEach(btn => {
        btn.addEventListener('click', () => {
          const [si,li] = btn.dataset.tplDelLine.split(',').map(Number)
          template[si].lines.splice(li, 1); render()
        })
      })
      el.querySelectorAll('[data-tpl-add-line]').forEach(btn => {
        btn.addEventListener('click', () => {
          const si = +btn.dataset.tplAddLine
          const isCrew = !!template[si].crew
          template[si].lines.push({ item: '', rate: null, qty: 0, useDays: isCrew, track_time: false })
          render()
        })
      })

      // Save / reset
      el.querySelector('#tpl-save')?.addEventListener('click', () => this._saveBudgetTemplate(template))
      el.querySelector('#tpl-reset')?.addEventListener('click', async () => {
        if (!await this.confirm({ title: 'Reset to defaults?', message: 'Your custom template will be lost.', confirmLabel: 'Reset', danger: false })) return
        template = JSON.parse(JSON.stringify(SECTIONS))
        render()
      })
    }

    render()
  }

  async _saveJobTitle(mc) {
    const title = mc.querySelector('#account-job-title')?.value.trim() || null
    if (!this.appUser?.id) return
    try {
      const { updateAppUser } = await import('./db/client.js')
      await updateAppUser(this.appUser.id, { default_role: title })
      this.appUser.default_role = title
      // Keep the in-memory user list in sync so crew dropdowns reflect the change
      const u = this.allUsers?.find(x => x.id === this.appUser.id)
      if (u) u.default_role = title
      this.toast('Saved')
    } catch (e) { console.error(e); this.toast('Error saving') }
  }

  async _loadUsersPanel(mc) {
    const el = mc.querySelector('#users-list')
    if (!el) return
    try {
      const { getAllAppUsers, updateAppUser, deleteAppUser, ROLE_LABELS } = await import('./db/client.js')
      const users = await getAllAppUsers()
      const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
      const ROLES = ['superadmin','user','viewer']

      el.innerHTML = users.map(u => {
        const isSelf = u.clerk_id === this.clerkUserId
        return `<div style="border:1px solid var(--border-light);border-radius:var(--radius-md);padding:14px;margin-bottom:10px" data-uid="${u.id}">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="font-size:13px;font-weight:500;flex:1">${esc(u.name)||'—'} ${isSelf?'<span style="font-size:10px;color:var(--text-tertiary)">(you)</span>':''}</div>
            <select class="status-select" data-role-uid="${u.id}" ${isSelf?'disabled':''} style="width:130px" title="${isSelf?'You cannot change your own role':''}">
              ${ROLES.map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABELS[r]}</option>`).join('')}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="field" style="margin:0">
              <div class="field-label">Name</div>
              <input type="text" value="${esc(u.name)}" placeholder="Full name" data-name="${u.id}"
                style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
            </div>
            <div class="field" style="margin:0">
              <div class="field-label">Email address</div>
              <input type="email" value="${esc(u.email)}" placeholder="name@email.com" data-email="${u.id}"
                style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
            </div>
          </div>
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap">Job title / crew role:</div>
            <input type="text" value="${esc(u.default_role)}" placeholder="e.g. Camera Operator" data-default-role="${u.id}"
              style="flex:1;font-size:12px;padding:4px 8px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
          </div>
          <div style="margin-top:8px;display:grid;grid-template-columns:auto 90px 1fr;gap:8px;align-items:center">
            <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap">Leave allowance / approver:</div>
            <input type="number" value="${esc(u.annual_allowance ?? 25)}" min="0" step="0.5" data-allowance="${u.id}" title="Annual leave allowance (days)"
              style="font-size:12px;padding:4px 8px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
            <select data-approver="${u.id}" title="Who approves this person's leave"
              style="font-size:12px;padding:4px 8px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none">
              <option value="">— No approver (superadmins) —</option>
              ${users.filter(x => x.id !== u.id).map(x => `<option value="${x.id}" ${u.approver_id === x.id ? 'selected' : ''}>${esc(x.name || x.email)}</option>`).join('')}
            </select>
          </div>
          <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
            <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap">Google Calendar:</div>
            ${isSelf
              ? u.google_calendar_connected
                ? `<span style="font-size:12px;color:#16a34a;font-weight:500">✓ Connected</span>
                   <button class="row-btn" data-gcal-disconnect="${u.id}" style="font-size:11px;color:var(--red,#e05252);border-color:var(--red,#e05252)">Disconnect</button>`
                : `<button class="row-btn" data-gcal-connect="${u.id}" style="font-size:11px">Connect Google Calendar</button>
                   <span style="font-size:11px;color:var(--text-tertiary)">Approved leave will appear on your personal calendar</span>`
              : u.google_calendar_connected
                ? `<span style="font-size:12px;color:#16a34a">✓ Connected</span>`
                : `<span style="font-size:12px;color:var(--text-tertiary)">Not connected</span>`}
          </div>
          <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center">
            ${!isSelf ? `<button class="row-btn" data-remove-user="${u.id}" data-remove-name="${esc(u.name)||esc(u.email)}" style="font-size:11px;color:var(--red,#e05252);border-color:var(--red,#e05252)">Remove user</button>` : '<span></span>'}
            <button class="row-btn" data-save-user="${u.id}" style="font-size:11px">Save changes</button>
          </div>
        </div>`
      }).join('')

      // Save user
      el.querySelectorAll('[data-save-user]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = btn.dataset.saveUser
          const roleSel = el.querySelector(`[data-role-uid="${uid}"]`)
          const name = el.querySelector(`[data-name="${uid}"]`)?.value.trim() || null
          const email = el.querySelector(`[data-email="${uid}"]`)?.value.trim() || ''
          const default_role = el.querySelector(`[data-default-role="${uid}"]`)?.value.trim() || null
          const annual_allowance = el.querySelector(`[data-allowance="${uid}"]`)?.value || '25'
          const approver_id = el.querySelector(`[data-approver="${uid}"]`)?.value || null
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.toast('Please enter a valid email address'); return }
          // Role select is disabled for self, so fall back to the existing role
          const role = (roleSel && !roleSel.disabled) ? roleSel.value : (this.allUsers?.find(x => x.id === uid)?.role ?? 'user')
          try {
            await updateAppUser(uid, { name, email, role, default_role, annual_allowance, approver_id })
            // Update in-memory allUsers so crew dropdowns reflect changes immediately
            const u = this.allUsers?.find(x => x.id === uid)
            if (u) { u.name = name; u.email = email; u.role = role; u.default_role = default_role; u.annual_allowance = annual_allowance; u.approver_id = approver_id }
            if (this.appUser?.id === uid) { this.appUser.name = name; this.appUser.email = email; this.appUser.default_role = default_role }
            this.toast('User updated')
            this._loadUsersPanel(mc)
          } catch(e) { console.error(e); this.toast('Error saving user') }
        })
      })
      // Remove user
      el.querySelectorAll('[data-remove-user]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = btn.dataset.removeUser
          const name = btn.dataset.removeName
          if (!await this.confirm({ title: 'Remove user?', message: `${name} will lose access to the workspace immediately.`, confirmLabel: 'Remove' })) return
          try {
            await deleteAppUser(uid)
            this.allUsers = (this.allUsers ?? []).filter(x => x.id !== uid)
            this.toast('User removed')
            this._loadUsersPanel(mc)
          } catch(e) { console.error(e); this.toast('Error removing user') }
        })
      })
      // Google Calendar — connect
      el.querySelectorAll('[data-gcal-connect]').forEach(btn => {
        btn.addEventListener('click', () => this._startGoogleOAuth())
      })
      // Google Calendar — disconnect
      el.querySelectorAll('[data-gcal-disconnect]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = btn.dataset.gcalDisconnect
          if (!await this.confirm({ title: 'Disconnect Google Calendar?', message: 'Existing calendar events will not be deleted.', confirmLabel: 'Disconnect' })) return
          try {
            const { getAuthToken } = await import('./auth/clerk.js')
            const token = await getAuthToken()
            const r = await fetch('/api/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ action: 'disconnect', appUserId: uid }),
            })
            if (!r.ok) throw new Error(await r.text())
            const u = this.allUsers?.find(x => x.id === uid)
            if (u) u.google_calendar_connected = false
            this.toast('Google Calendar disconnected')
            this._loadUsersPanel(mc)
          } catch(e) { console.error(e); this.toast('Error disconnecting Google Calendar') }
        })
      })
    } catch(e) { console.error(e); el.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary)">Could not load users</div>' }
  }

  _startGoogleOAuth() {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) { this.toast('VITE_GOOGLE_CLIENT_ID is not configured'); return }
    const state = btoa(JSON.stringify({ appUserId: this.appUser?.id }))
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  `${location.origin}/api/google`,
      response_type: 'code',
      scope:         'https://www.googleapis.com/auth/calendar.events',
      access_type:   'offline',
      prompt:        'consent',
      state,
    })
    location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  _renderHolidaysPanel(mc) {
    const el = mc.querySelector('#holidays-list')
    if (!el) return
    const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
    const hols = [...(this.publicHolidays ?? [])].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
    if (!hols.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary)">No public holidays added yet.</div>'; return }
    el.innerHTML = hols.map(h => `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border-light)">
        <div style="font-size:13px;color:var(--text-primary);width:120px">${new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
        <div style="flex:1;font-size:13px;color:var(--text-secondary)">${esc(h.name)}</div>
        <button class="row-btn" data-del-hol="${h.id}" style="font-size:11px;color:var(--red,#e05252);border-color:var(--red,#e05252)">Remove</button>
      </div>`).join('')
    el.querySelectorAll('[data-del-hol]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const { deletePublicHoliday } = await import('./db/client.js')
        await deletePublicHoliday(this.userId, btn.dataset.delHol)
        this.publicHolidays = (this.publicHolidays ?? []).filter(x => x.id !== btn.dataset.delHol)
        this._renderHolidaysPanel(mc)
      } catch(e) { console.error(e); this.toast('Could not remove holiday') }
    }))
  }

  async _addHoliday(mc) {
    const date = mc.querySelector('#hol-date')?.value
    const name = mc.querySelector('#hol-name')?.value.trim() || 'Holiday'
    if (!date) { this.toast('Pick a date'); return }
    try {
      const { createPublicHoliday } = await import('./db/client.js')
      const created = await createPublicHoliday(this.userId, { holiday_date: date, name })
      if (!this.publicHolidays) this.publicHolidays = []
      this.publicHolidays.push(created)
      mc.querySelector('#hol-date').value = ''
      mc.querySelector('#hol-name').value = ''
      this._renderHolidaysPanel(mc)
      this.toast('Public holiday added')
    } catch(e) { console.error(e); this.toast('Could not add holiday') }
  }

  async _syncUKHolidays(mc) {
    const year = parseInt(mc.querySelector('#hol-sync-year')?.value) || new Date().getFullYear()
    const btn  = mc.querySelector('#hol-sync-btn')
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing…' }
    try {
      const resp = await fetch('https://www.gov.uk/bank-holidays.json')
      if (!resp.ok) throw new Error(`GOV.UK API returned ${resp.status}`)
      const data = await resp.json()
      const events = (data['england-and-wales']?.events ?? [])
        .filter(e => e.date?.startsWith(String(year)))
      if (!events.length) { this.toast(`No holidays found for ${year}`); return }

      const { createPublicHoliday } = await import('./db/client.js')
      const existing = new Set((this.publicHolidays ?? []).map(h => h.holiday_date))
      let added = 0
      for (const ev of events) {
        if (existing.has(ev.date)) continue
        const created = await createPublicHoliday(this.userId, { holiday_date: ev.date, name: ev.title })
        if (!this.publicHolidays) this.publicHolidays = []
        this.publicHolidays.push(created)
        added++
      }
      this._renderHolidaysPanel(mc)
      this.toast(added ? `Added ${added} bank holiday${added === 1 ? '' : 's'} for ${year}` : `All ${year} holidays already added`)
    } catch(e) {
      console.error(e); this.toast('Could not sync bank holidays — check network')
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Sync England & Wales bank holidays' }
    }
  }

  async _sendInvite(mc) {
    const emailEl = mc.querySelector('#invite-email')
    const email = emailEl?.value.trim()
    if (!email) { this.toast('Please enter an email address'); return }

    const btn = mc.querySelector('#invite-btn')
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…' }

    try {
      // Get the current Clerk session token to authenticate the API call
      const { clerk } = await import('./auth/clerk.js')
      const token = await clerk.session?.getToken()
      if (!token) throw new Error('No session token')

      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invite failed')

      if (emailEl) emailEl.value = ''
      this.toast(`Invitation sent to ${email}`)
    } catch (e) {
      console.error(e)
      this.toast(e.message || 'Error sending invite')
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send invite' }
    }
  }

  // Tab-safe save: only persists the flat settings fields actually present in
  // the DOM right now. Because the Workspace settings are split across sub-tabs
  // (Company / Invoicing / …), reading absent fields would clobber them — so we
  // include a key only when its input is rendered. upsertSettings does a partial
  // update, leaving untouched columns intact.
  async saveSettings(mc) {
    const data = {}
    const setText = (key, sel, fallback = null) => {
      const el = mc.querySelector(sel)
      if (el) data[key] = el.value.trim() || fallback
    }
    setText('company_name', '#s-name', 'Slate')
    setText('email', '#s-email')
    setText('phone', '#s-phone')
    setText('website', '#s-website')
    setText('address', '#s-address')
    setText('vat_number', '#s-vat')
    setText('prepared_by', '#s-preparedby')
    setText('hs_boilerplate', '#s-hs')
    if (mc.querySelector('#s-fy-start')) data.financial_year_start = parseInt(mc.querySelector('#s-fy-start').value || '4')
    setText('default_insurer_name', '#s-ins-name')
    setText('default_insurer_address', '#s-ins-addr')
    setText('default_insurer_email', '#s-ins-email')
    setText('default_insurer_contact', '#s-ins-contact')
    setText('invoicing_email', '#s-inv-email')
    setText('invoicing_boilerplate', '#s-inv-boilerplate')
    if (!Object.keys(data).length) return
    try { const [updated] = await upsertSettings(this.userId, data); this.settings = updated; this.toast('Settings saved') }
    catch (e) { console.error(e); this.toast('Error saving settings') }
  }

  async _saveReminderRoundup(mc) {
    const enabled = mc.querySelector('#s-reminder-roundup')?.checked ?? false
    const data = { ...this.settings, reminder_roundup: enabled }
    try {
      const [updated] = await upsertSettings(this.userId, data)
      this.settings = updated
      this.toast(enabled ? 'Roundup emails enabled' : 'Roundup emails disabled')
    } catch (e) { console.error(e); this.toast('Error saving preference') }
  }

  async _saveExpenseSettings(mc) {
    const rate = parseFloat(mc.querySelector('#s-mileage-rate')?.value || '45')
    const perDiemRate = parseFloat(mc.querySelector('#s-per-diem-rate')?.value || '0')
    const recipients = [...mc.querySelectorAll('.exp-recipient-check:checked')].map(el => el.dataset.clerkId)
    const data = { ...this.settings, mileage_rate: rate, per_diem_rate: perDiemRate, expense_recipients: recipients }
    try {
      const [updated] = await upsertSettings(this.userId, data)
      this.settings = updated
      this.toast('Expense settings saved')
    } catch (e) { console.error(e); this.toast('Error saving expense settings') }
  }

  async _saveFxSettings(mc) {
    const pct = parseFloat(mc.querySelector('#s-fx-markup')?.value)
    if (!isFinite(pct) || pct < 0 || pct > 100) { this.toast('Enter an FX margin between 0 and 100'); return }
    const data = { ...this.settings, fx_markup_pct: pct }
    try {
      const [updated] = await upsertSettings(this.userId, data)
      this.settings = updated
      this.toast('Currency settings saved')
    } catch (e) { console.error(e); this.toast('Error saving currency settings') }
  }

  async _saveLeaveSettings(mc) {
    const month = parseInt(mc.querySelector('#s-leave-month')?.value || '4')
    const day   = parseInt(mc.querySelector('#s-leave-day')?.value   || '1')
    if (!month || month < 1 || month > 12) { this.toast('Invalid month'); return }
    if (!day || day < 1 || day > 31) { this.toast('Invalid day'); return }
    const data = { ...this.settings, leave_year_start_month: month, leave_year_start_day: day }
    try {
      const [updated] = await upsertSettings(this.userId, data)
      this.settings = updated
      this.toast('Leave year start saved')
    } catch (e) { console.error(e); this.toast('Error saving leave settings') }
  }

  async _saveDaysSinceTimer(mc) {
    const name  = mc.querySelector('#s-ds-name')?.value.trim()
    const since = mc.querySelector('#s-ds-since')?.value
    if (!name || !since) { this.toast('Please fill in both fields'); return }
    const data = { ...this.settings, days_since_timer: { name, since } }
    try {
      const [updated] = await upsertSettings(this.userId, data)
      this.settings = updated
      this.toast('Timer saved')
      this.renderSettings(mc)
    } catch (e) { console.error(e); this.toast('Error saving timer') }
  }

  async _clearDaysSinceTimer(mc) {
    const data = { ...this.settings, days_since_timer: null }
    try {
      const [updated] = await upsertSettings(this.userId, data)
      this.settings = updated
      document.getElementById('ds-widget-wrap')?.remove()
      this.toast('Timer removed')
      this.renderSettings(mc)
    } catch (e) { console.error(e); this.toast('Error removing timer') }
  }

  _mountDaysSinceWidget(mc) {
    document.getElementById('ds-widget-wrap')?.remove()

    const ds = this.settings?.days_since_timer
    if (!ds?.name || !ds?.since) return

    const since = new Date(ds.since + 'T00:00:00')
    if (isNaN(since.getTime())) return

    // Dismissal is persisted per timer (name + start date) so editing the timer
    // brings the banner back, but a dismissed one stays hidden across sessions.
    const dismissKey = `${ds.name}|${ds.since}`
    if (localStorage.getItem('slate-ds-dismissed') === dismissKey) return

    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    const todayMs = new Date().setHours(0, 0, 0, 0)
    const days = Math.floor((todayMs - since.getTime()) / 86400000)

    const wrapper = document.createElement('div')
    wrapper.id = 'ds-widget-wrap'
    wrapper.innerHTML = `
      <div class="ds-widget">
        <div class="ds-days">${days}</div>
        <div class="ds-label">days since <span class="ds-name">${esc(ds.name)}</span></div>
        <button class="ds-dismiss" title="Dismiss" aria-label="Dismiss">×</button>
      </div>`
    wrapper.querySelector('.ds-dismiss')?.addEventListener('click', () => {
      try { localStorage.setItem('slate-ds-dismissed', dismissKey) } catch {}
      wrapper.remove()
    })
    mc.prepend(wrapper)
  }

  async _saveCountdownTimer(mc) {
    const name   = mc.querySelector('#s-cd-name')?.value.trim()
    const target = mc.querySelector('#s-cd-target')?.value
    if (!name || !target) { this.toast('Please fill in both fields'); return }
    const data = { ...this.settings, countdown_timer: { name, target } }
    try {
      const [updated] = await upsertSettings(this.userId, data)
      this.settings = updated
      this.toast('Timer saved')
      this.renderSettings(mc)
    } catch (e) { console.error(e); this.toast('Error saving timer') }
  }

  async _clearCountdownTimer(mc) {
    const data = { ...this.settings, countdown_timer: null }
    try {
      const [updated] = await upsertSettings(this.userId, data)
      this.settings = updated
      this.toast('Timer removed')
      this.renderSettings(mc)
    } catch (e) { console.error(e); this.toast('Error removing timer') }
  }

  _mountCountdownWidget(mc) {
    clearInterval(this._cdInterval)
    this._cdInterval = null

    const ct = this.settings?.countdown_timer
    if (!ct?.name || !ct?.target) return

    const target = new Date(ct.target)
    if (isNaN(target.getTime())) return

    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    const wrapper = document.createElement('div')
    wrapper.id = 'cd-widget-wrap'
    mc.prepend(wrapper)

    const update = () => {
      const now = Date.now()
      const diff = target.getTime() - now
      const sinceEnd = now - target.getTime()

      if (diff > 0) {
        const totalSecs = Math.floor(diff / 1000)
        const days  = Math.floor(totalSecs / 86400)
        const hours = Math.floor((totalSecs % 86400) / 3600)
        const mins  = Math.floor((totalSecs % 3600) / 60)
        const secs  = totalSecs % 60
        const pad = n => String(n).padStart(2, '0')
        wrapper.innerHTML = `
          <div class="cd-widget">
            <div class="cd-name">${esc(ct.name)}</div>
            <div class="cd-units">
              <div class="cd-unit"><div class="cd-num">${days}</div><div class="cd-lbl">days</div></div>
              <div class="cd-sep">:</div>
              <div class="cd-unit"><div class="cd-num">${pad(hours)}</div><div class="cd-lbl">hours</div></div>
              <div class="cd-sep">:</div>
              <div class="cd-unit"><div class="cd-num">${pad(mins)}</div><div class="cd-lbl">min</div></div>
              <div class="cd-sep">:</div>
              <div class="cd-unit"><div class="cd-num">${pad(secs)}</div><div class="cd-lbl">sec</div></div>
            </div>
          </div>`
      } else if (sinceEnd < 86400000) {
        if (!wrapper.querySelector('.cd-widget--celebrate')) {
          wrapper.innerHTML = `
            <div class="cd-widget cd-widget--celebrate" style="animation:cd-bg-shift 4s ease infinite alternate">
              <div class="cd-name">${esc(ct.name)}</div>
              <div class="cd-celebrate-body">
                <div class="cd-done-msg">🎉 It's a wrap! 🎉</div>
                <div class="cd-done-sub">The deadline has passed — nice work, everyone.</div>
              </div>
            </div>`
          this._startConfetti()
        }
      } else {
        clearInterval(this._cdInterval)
        this._cdInterval = null
        wrapper.remove()
      }
    }

    update()
    this._cdInterval = setInterval(update, 1000)
  }

  _startConfetti() {
    document.getElementById('cd-confetti-layer')?.remove()
    const layer = document.createElement('div')
    layer.id = 'cd-confetti-layer'
    layer.className = 'cd-confetti-layer'
    document.body.appendChild(layer)

    const COLORS = ['#f59e0b','#ef4444','#10b981','#3b82f6','#8b5cf6','#ec4899','#f97316','#06b6d4','#fbbf24','#a3e635']
    const spawn = () => {
      if (!document.contains(layer)) { clearInterval(confettiTimer); return }
      for (let i = 0; i < 8; i++) {
        const el = document.createElement('div')
        el.className = 'cd-confetti-piece'
        const size = 7 + Math.random() * 10
        const dur  = 2.5 + Math.random() * 2
        el.style.cssText = `left:${Math.random()*100}%;width:${size}px;height:${size*(0.4+Math.random()*0.8)}px;background:${COLORS[Math.floor(Math.random()*COLORS.length)]};animation-duration:${dur}s`
        layer.appendChild(el)
        setTimeout(() => el.remove(), dur * 1000 + 100)
      }
    }
    spawn()
    const confettiTimer = setInterval(spawn, 220)
    setTimeout(() => { clearInterval(confettiTimer); setTimeout(() => layer.remove(), 3000) }, 30000)
  }

  async _saveBudgetTemplate(template) {
    try {
      const [updated] = await upsertSettings(this.userId, {
        ...this.settings,
        budget_template: template,
      })
      this.settings = updated
      this.toast('Budget template saved')
    } catch(e) { console.error(e); this.toast('Error saving template') }
  }

  toast(msg, duration = 2400) {
    let el = document.getElementById('app-toast')
    if (!el) { el = document.createElement('div'); el.id = 'app-toast'; el.className = 'toast'; document.body.appendChild(el) }
    el.textContent = msg; el.classList.add('show')
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => el.classList.remove('show'), duration)
  }

  // Toast with an inline action button (e.g. "Retry"). Stays up longer than a
  // plain toast so the user has time to act. Clicking the action dismisses it.
  toastAction(msg, actionLabel, onAction, duration = 7000) {
    let el = document.getElementById('app-toast')
    if (!el) { el = document.createElement('div'); el.id = 'app-toast'; el.className = 'toast'; document.body.appendChild(el) }
    el.textContent = ''
    const span = document.createElement('span'); span.textContent = msg
    const btn = document.createElement('button'); btn.className = 'toast-action'; btn.textContent = actionLabel
    el.append(span, btn)
    el.classList.add('show')
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => el.classList.remove('show'), duration)
    btn.addEventListener('click', () => { clearTimeout(this._toastTimer); el.classList.remove('show'); onAction?.() })
  }

  // Surface a failed operation. When a retry callback is supplied, the toast
  // offers a "Retry" button so a transient network failure isn't a dead end.
  toastError(msg, retryFn) {
    if (retryFn) this.toastAction(msg, 'Retry', retryFn)
    else this.toast(msg)
  }

  // Themed replacement for the native confirm() dialog. Returns a Promise that
  // resolves true (confirmed) or false (cancelled). Accepts a plain string or
  // an options object { title, message, confirmLabel, cancelLabel, danger }.
  // Esc / backdrop click cancels; Enter confirms.
  confirm(opts = {}) {
    if (typeof opts === 'string') opts = { message: opts }
    const {
      title = 'Are you sure?', message = '',
      confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true,
    } = opts
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    return new Promise(resolve => {
      const backdrop = document.createElement('div')
      backdrop.className = 'confirm-backdrop'
      backdrop.id = 'app-confirm-overlay'
      backdrop.innerHTML = `
        <div class="confirm-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="confirm-body">
            <div class="confirm-title">${esc(title)}</div>
            ${message ? `<div class="confirm-msg">${esc(message)}</div>` : ''}
          </div>
          <div class="confirm-actions">
            <button class="btn-cancel" data-confirm="cancel">${esc(cancelLabel)}</button>
            <button class="${danger ? 'btn-danger' : 'btn-primary'}" data-confirm="ok">${esc(confirmLabel)}</button>
          </div>
        </div>`
      let done = false
      const close = val => {
        if (done) return
        done = true
        document.removeEventListener('keydown', onKey, true)
        backdrop.remove()
        resolve(val)
      }
      // Capture phase + stopPropagation so the global Esc handler doesn't also fire.
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false) }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true) }
      }
      backdrop.addEventListener('click', e => { if (e.target === backdrop) close(false) })
      backdrop.querySelector('[data-confirm="cancel"]').addEventListener('click', () => close(false))
      backdrop.querySelector('[data-confirm="ok"]').addEventListener('click', () => close(true))
      document.addEventListener('keydown', onKey, true)
      document.body.appendChild(backdrop)
      setTimeout(() => backdrop.querySelector('[data-confirm="ok"]')?.focus(), 10)
    })
  }

  // Lightweight overflow (⋯) popover menu anchored to a trigger element.
  // `items` is an array of { label, danger, onClick } or { divider:true }.
  // Closes on outside click / Esc / selection. Returns a close() fn.
  openMenu(anchor, items) {
    document.getElementById('app-menu-pop')?.remove()
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const pop = document.createElement('div')
    pop.id = 'app-menu-pop'
    pop.className = 'menu-pop'
    pop.innerHTML = items.map((it, i) =>
      it.divider ? '<div class="menu-pop-divider"></div>'
        : `<button class="menu-pop-item${it.danger ? ' danger' : ''}" data-mi="${i}">${esc(it.label)}</button>`
    ).join('')
    document.body.appendChild(pop)
    const rect = anchor.getBoundingClientRect()
    let left = rect.right - pop.offsetWidth
    if (left < 8) left = 8
    let top = rect.bottom + 4
    if (top + pop.offsetHeight > window.innerHeight - 8) top = rect.top - pop.offsetHeight - 4
    pop.style.top = `${Math.max(8, top)}px`
    pop.style.left = `${left}px`
    let done = false
    const close = () => {
      if (done) return
      done = true
      pop.remove()
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDoc, true)
    }
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
    const onDoc = e => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close() }
    pop.querySelectorAll('[data-mi]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const it = items[+btn.dataset.mi]
        close()
        it.onClick?.()
      })
    })
    setTimeout(() => {
      document.addEventListener('keydown', onKey, true)
      document.addEventListener('mousedown', onDoc, true)
    }, 0)
    return close
  }

  // Generic popover anchored to a trigger element, showing arbitrary HTML
  // (e.g. a legend / help panel). Closes on outside click / Esc.
  openPopover(anchor, html, { width = 260 } = {}) {
    document.getElementById('app-popover')?.remove()
    const pop = document.createElement('div')
    pop.id = 'app-popover'
    pop.className = 'app-popover'
    pop.style.maxWidth = width + 'px'
    pop.innerHTML = html
    document.body.appendChild(pop)
    const rect = anchor.getBoundingClientRect()
    let left = rect.right - pop.offsetWidth
    if (left < 8) left = 8
    if (left + pop.offsetWidth > window.innerWidth - 8) left = window.innerWidth - pop.offsetWidth - 8
    let top = rect.bottom + 6
    if (top + pop.offsetHeight > window.innerHeight - 8) top = rect.top - pop.offsetHeight - 6
    pop.style.top = `${Math.max(8, top)}px`
    pop.style.left = `${Math.max(8, left)}px`
    let done = false
    const close = () => {
      if (done) return
      done = true
      pop.remove()
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDoc, true)
    }
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
    const onDoc = e => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close() }
    setTimeout(() => {
      document.addEventListener('keydown', onKey, true)
      document.addEventListener('mousedown', onDoc, true)
    }, 0)
    return close
  }

  // ── Inline form validation ──────────────────────────────────────────────────
  // Mark a field invalid with a message shown directly beneath it, instead of a
  // transient toast that doesn't say which field is wrong. The error clears as
  // soon as the user edits the field. The first invalid field in a form is focused.
  fieldError(el, msg) {
    if (!el) return
    const scope = el.closest('.modal-backdrop, .confirm-box, .modal-content') || document
    const isFirst = !scope.querySelector('.is-invalid')
    el.classList.add('is-invalid')
    const field = el.closest('.field') || el.parentElement
    if (field) {
      field.querySelector(':scope > .field-err')?.remove()
      const err = document.createElement('div')
      err.className = 'field-err'
      err.textContent = msg
      field.appendChild(err)
    }
    const clear = () => {
      el.classList.remove('is-invalid')
      ;(el.closest('.field') || el.parentElement)?.querySelector(':scope > .field-err')?.remove()
      el.removeEventListener('input', clear)
      el.removeEventListener('change', clear)
    }
    el.addEventListener('input', clear)
    el.addEventListener('change', clear)
    if (isFirst) el.focus()
  }

  // Clear all inline validation state within a scope (defaults to whole document).
  clearFieldErrors(scope) {
    scope = scope || document
    scope.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'))
    scope.querySelectorAll('.field-err').forEach(el => el.remove())
  }

  // Run an async action while showing a busy state on the triggering button:
  // disables it and swaps its label to `label`, then restores the original
  // label and disabled state when done. Gives the user feedback during DB
  // writes and prevents accidental double-submits. Safe with a missing button.
  async withBusy(btn, fn, label = 'Saving…') {
    if (!btn) return fn()
    const prevHtml     = btn.innerHTML
    const prevDisabled = btn.disabled
    btn.disabled = true
    btn.setAttribute('data-busy', '1')
    btn.textContent = label
    try {
      return await fn()
    } finally {
      btn.removeAttribute('data-busy')
      btn.disabled = prevDisabled
      btn.innerHTML = prevHtml
    }
  }

  iconHamburger() { return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4.5h14M2 9h14M2 13.5h14"/></svg>` }
  iconContacts() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="5" r="2.5"/><path d="M1 14c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5"/><path d="M11 3.5a2 2 0 0 1 0 4M15 14c0-2.4-1.5-3.8-4-4"/></svg>` }
  iconMarketing()  { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1 8c0 0 2-5 7-5s7 5 7 5-2 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>` }
  iconTimeTrack()  { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="9" r="5.5"/><path d="M8 6v3.5l2 1.5"/><path d="M6 1h4M8 1v2.5"/></svg>` }
  iconProjects() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 6h6M5 9h4"/></svg>` }
  iconBudgets()  { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3h12v2H2zM2 7h9M2 11h7"/><circle cx="13" cy="11" r="2.2"/><path d="M13 9.8v1l.7.7"/></svg>` }
  iconPlanning() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="2" width="3.6" height="12" rx="0.8"/><rect x="6.2" y="2" width="3.6" height="8.5" rx="0.8"/><rect x="10.9" y="2" width="3.6" height="5.5" rx="0.8"/></svg>` }
  iconPipeline() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="4" width="4" height="9" rx="1"/><rect x="6" y="6" width="4" height="7" rx="1"/><rect x="11" y="8" width="4" height="5" rx="1"/></svg>` }
  iconCalendar() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="3" width="13" height="11.5" rx="1.5"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3"/></svg>` }
  iconStoryPlanner() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="2" width="13" height="3.5" rx="0.8"/><rect x="1.5" y="6.5" width="13" height="3.5" rx="0.8"/><rect x="1.5" y="11" width="8" height="3.5" rx="0.8"/></svg>` }
  iconSettings() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M11.4 4.6l-1.4 1.4M4.6 11.4l-1.4 1.4"/></svg>` }
  iconPasswordManager() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/><circle cx="8" cy="11" r="1" fill="currentColor" stroke="none"/></svg>` }
  iconExpenses()        { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="4" width="12" height="9" rx="1.5"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M8 7.5v3M6.5 9h3"/></svg>` }
  iconOffloads()        { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="4" rx="1"/><rect x="2" y="9" width="12" height="4" rx="1"/><circle cx="4.5" cy="5" r="0.6" fill="currentColor" stroke="none"/><circle cx="4.5" cy="11" r="0.6" fill="currentColor" stroke="none"/></svg>` }
  iconLeave()           { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2c2.5 1.5 3.5 4 2.5 7-.8 2.4-2.5 4-2.5 4s-1.7-1.6-2.5-4C4.5 6 5.5 3.5 8 2z"/><path d="M8 6v7"/></svg>` }
  _leaveBadgeHtml() {
    const n = pendingApprovalsFor(this.appUser, this.leaveRequests).length
    return n ? `<span class="leave-nav-badge">${n}</span>` : ''
  }
  updateLeaveBadge() {
    const item = document.querySelector('.nav-item[data-view="leave"]')
    if (!item) return
    item.querySelector('.leave-nav-badge')?.remove()
    const html = this._leaveBadgeHtml()
    if (html) item.insertAdjacentHTML('beforeend', html)
  }
  iconSignOut()  { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M10 11l4-4-4-4M14 8H6"/></svg>` }
  iconCollapse() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 4.5L6 8l3.5 3.5M13 4.5L9.5 8l3.5 3.5"/></svg>` }
  iconTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    return isDark
      ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M11.4 4.6l-1.4 1.4M4.6 11.4l-1.4 1.4"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M13.5 10A5.5 5.5 0 0 1 6 2.5a5.5 5.5 0 1 0 7.5 7.5z"/></svg>`
  }
}
