import { getCurrentUserId } from './auth/clerk.js'
import { getContacts, getProjects, getBudgets, upsertSettings } from './db/client.js'
import { ContactsView } from './views/contacts.js'
import { ProjectsView } from './views/projects.js'
import { BudgetsView, budTotal } from './views/budgets.js'
import { CallSheetsView } from './views/callsheets.js'

export class App {
  constructor({ userId, clerkUserId, user, appUser, permissions, contacts, projects, budgets, settings, allUsers, socialPosts, onSignOut }) {
    this.userId      = userId
    this.clerkUserId = clerkUserId
    this.user        = user
    this.appUser     = appUser
    this.permissions = permissions
    this.contacts    = contacts ?? []
    this.projects    = projects ?? []
    this.budgets     = budgets  ?? []
    this.settings    = settings ?? {}
    this.allUsers    = allUsers ?? []
    this.socialPosts = socialPosts ?? []
    this.onSignOut   = onSignOut
    this.currentView = 'dashboard'
    this.contactsView    = new ContactsView(this)
    this.projectsView    = new ProjectsView(this)
    this.budgetsView     = new BudgetsView(this)
    this.callSheetsView  = new CallSheetsView(this)
    window.app = this
  }

  mount(container) {
    this.container = container
    const saved = localStorage.getItem('slate-theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
    this.injectGlobalStyles()
    this._restoreFromHash()   // parse URL before first render
    this.render()
    this._bindKeyboard()
    // Handle browser back/forward
    window.addEventListener('popstate', (e) => this._handlePopState(e))
  }

  async _openDevRequest() {
    const isAdmin = this.appUser?.role === 'admin'
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

      // Enter to submit (Shift+Enter for newline)
      overlay.querySelector('#dev-req-text')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); overlay.querySelector('#dev-req-submit')?.click() }
      })

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
      }

      const typeIcon = { contact:'👤', project:'🎬', budget:'£' }
      const typeColour = { contact:'#a78bfa', project:'#4a90d9', budget:'#6ec96e' }

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:520px;overflow:hidden;cursor:default;box-shadow:0 20px 60px rgba(0,0,0,0.4)" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border-light)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            <input id="search-input" placeholder="Search contacts, projects, budgets…" value="${esc(query)}"
              style="flex:1;background:transparent;border:none;outline:none;font-size:15px;color:var(--text-primary);font-family:var(--font)" autofocus />
            <kbd style="font-size:11px;color:var(--text-tertiary);background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:4px;padding:2px 6px">Esc</kbd>
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
                <span style="font-size:10px;color:${typeColour[r.type]};background:${typeColour[r.type]}22;border-radius:4px;padding:2px 7px;flex-shrink:0;text-transform:capitalize">${r.type}</span>
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
          if (r.type === 'contact') { this.navigate('contacts'); setTimeout(() => this.contactsView.showDetail(r.id), 50) }
          else if (r.type === 'project') { this.openProject(r.id) }
          else if (r.type === 'budget') { this.openBudget(r.id) }
        })
      })
    }

    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    render()
  }

  _bindKeyboard() {
    document.addEventListener('keydown', e => {
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
          document.querySelector('#settings-save-btn')?.click()
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
    this.container.innerHTML = `
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <div class="sidebar" id="app-sidebar">
        <div class="logo"><img src="/slate-logo.png" alt="Slate" /></div>
        <div class="nav-label">Main</div>
        ${[['dashboard','Dashboard',this.iconPipeline()],['contacts','Contacts',this.iconContacts()],['projects','Projects',this.iconProjects()],['budgets','Budgets',this.iconBudgets()]].map(([id,label,icon])=>`
          <div class="nav-item ${this.currentView===id?'active':''}" data-view="${id}">${icon} ${label}</div>`).join('')}
        <div class="sidebar-notes">
          <div class="sidebar-notes-header">
            <span class="sidebar-notes-title">Notes</span>
            <button id="notes-new-btn" class="sidebar-notes-new-btn">+ New</button>
          </div>
          <div class="notes-list" id="notes-list"><div class="notes-empty">No notes yet.<br>Hit + New to get started.</div></div>
        </div>
        <div class="nav-bottom">
          ${this.permissions.settings ? `<div class="nav-item" data-view="settings">${this.iconSettings()} Settings</div>` : ''}
          <div class="nav-item" id="dev-request-btn" style="color:#596773;font-size:13px">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5"/><path d="M8 5v4M8 11v.5"/></svg>
            Dev request
          </div>
          <div class="nav-item" id="sign-out-btn" style="color:#596773;font-size:13px">${this.iconSignOut()} Sign out</div>
        </div>
      </div>
      <div class="main">
        <div class="topbar">
          <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Toggle navigation">${this.iconHamburger()}</button>
          <div class="topbar-title" id="view-title">${this.viewTitle()}</div>
          <div id="topbar-actions" style="display:flex;gap:8px;align-items:center;flex-shrink:0">${this.topbarSearch()}${this.topbarButton()}
            <button class="theme-toggle" id="theme-toggle-btn" title="Toggle dark mode">${this.iconTheme()}</button>
            <button id="shortcut-hint" title="Keyboard shortcuts" style="width:32px;height:32px;border-radius:var(--radius-md);border:1px solid var(--border-light);background:transparent;color:var(--text-tertiary);font-size:13px;cursor:pointer;font-family:var(--font);display:flex;align-items:center;justify-content:center;flex-shrink:0">?</button>
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
      return p.contacts_edit ? `<button class="btn-primary" id="topbar-btn">+ Add contact</button>` : ''
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
    return ''
  }

  _closeMobileSidebar() {
    document.getElementById('app-sidebar')?.classList.remove('open')
    document.getElementById('sidebar-overlay')?.classList.remove('open')
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
    })
  }

  navigate(view) {
    this.currentView = view
    this.projectsView.currentId = null
    this.projectsView.editingId = null
    this.budgetsView.currentId  = null
    this.budgetsView.editingId  = null
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
    const validViews = ['contacts','projects','budgets','settings','dashboard']
    if (!validViews.includes(view)) return
    this.currentView = view
    if (view === 'projects' && id) {
      this.projectsView.currentId = id
      if (tab) this.projectsView._pvTab = tab
    }
    if (view === 'budgets' && id) this.budgetsView.currentId = id
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
    const validViews = ['contacts','projects','budgets','settings','dashboard']
    if (!validViews.includes(view)) { this.currentView = 'dashboard'; this.render(); return }

    this.currentView = view
    this.projectsView.currentId = (view === 'projects' && id) ? id : null
    this.projectsView._pvTab = tab || 'overview'
    this.projectsView.editingId = null
    this.budgetsView.currentId  = (view === 'budgets' && id) ? id : null
    this.budgetsView.editingId  = null
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
    } else if (this.currentView === 'dashboard') {
      this.renderDashboard(mc)
    } else {
      this.renderSettings(mc)
    }
  }

  viewTitle() {
    if (this.currentView === 'projects' && this.projectsView?.currentId) return this.projects.find(p=>p.id===this.projectsView.currentId)?.name ?? 'Project'
    if (this.currentView === 'budgets'  && this.budgetsView?.currentId)  return this.budgets.find(b=>b.id===this.budgetsView.currentId)?.name  ?? 'Budget'
    return {contacts:'Contacts',projects:'Projects',budgets:'Budgets',dashboard:'Dashboard',settings:'Settings'}[this.currentView] ?? ''
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

  openProject(id) { this.currentView = 'projects'; this.projectsView.currentId = id; this.render() }
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

  async renderDashboard(mc) {
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
    if (this._dbUpcomingOpen === undefined) {
      this._dbUpcomingOpen = localStorage.getItem('db_upcoming_open') !== 'false'
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
      <div class="stat-card stat-card--sm"><div class="stat-label">Pipeline</div><div class="stat-value stat-value--sm">${gbp(pipelineValue + retainerPipelineVal)}</div><div class="stat-sub">${regularProjects.length} project${regularProjects.length!==1?'s':''}${retainerPipelineVal>0?' + '+retainers.filter(p=>p.status==='Enquiry').length+' retainer enquir'+(retainers.filter(p=>p.status==='Enquiry').length===1?'y':'ies'):''}</div></div>
      <div class="stat-card stat-card--sm"><div class="stat-label">Awaiting invoice</div><div class="stat-value stat-value--sm" style="color:#6ec96e">${gbp(awaitingVal)}</div><div class="stat-sub">${awaitingInvoice.length} budget${awaitingInvoice.length!==1?'s':''}</div></div>
      <div class="stat-card stat-card--sm"><div class="stat-label">Invoiced this month</div><div class="stat-value stat-value--sm" style="color:#4a90d9">${gbp(invoicedMonthVal)}</div><div class="stat-sub">${invoicedThisMonth.length} budget${invoicedThisMonth.length!==1?'s':''}</div></div>
      <div class="stat-card stat-card--sm"><div class="stat-label">Invoiced this quarter</div><div class="stat-value stat-value--sm" style="color:#4a90d9">${gbp(invoicedQtrVal)}</div><div class="stat-sub">${invoicedThisQtr.length} budget${invoicedThisQtr.length!==1?'s':''}</div></div>
      <div class="stat-card stat-card--sm"><div class="stat-label">Invoiced this FY</div><div class="stat-value stat-value--sm" style="color:#4a90d9">${gbp(invoicedFYVal)}</div><div class="stat-sub">${fyLabel}</div></div>
      <div class="stat-card stat-card--sm"><div class="stat-label">Retainer MRR</div><div class="stat-value stat-value--sm" style="color:#a78bfa">${gbp(retainerMRR)}</div><div class="stat-sub">per month</div></div>`

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

      <!-- Upcoming Deliverables -->
      ${upcomingDeliverables.length ? `
      <div style="margin-bottom:28px">
        <div class="db-section-head db-upcoming-toggle" id="db-upcoming-toggle" style="cursor:pointer;user-select:none">
          <span class="db-section-dot" style="background:#ef4444"></span>
          Upcoming Deliverables
          <span class="db-section-count">${upcomingDeliverables.length}</span>
          <span class="db-chevron${this._dbUpcomingOpen ? ' db-chevron--open' : ''}" style="margin-left:auto" id="db-upcoming-chevron">▶</span>
        </div>
        <div id="db-upcoming-body" style="display:${this._dbUpcomingOpen ? 'block' : 'none'}">
          <div class="db-proj-list">
            ${upcomingDeliverables.map(({ d, p, due, idx, src }) => {
              const daysUntil = Math.round((due - today) / 86400000)
              const overdue = daysUntil < 0
              const dueToday = daysUntil === 0
              const duePill = overdue
                ? `<span class="db-due-pill db-due-pill--overdue">${Math.abs(daysUntil)}d overdue</span>`
                : dueToday
                  ? `<span class="db-due-pill db-due-pill--today">Today</span>`
                  : `<span class="db-due-pill">${daysUntil}d</span>`
              const dueDateStr = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              return `<div class="db-proj-row db-upcoming-row" style="cursor:default">
                <div class="db-proj-header" style="cursor:default;gap:10px">
                  <input type="checkbox" class="db-deliv-check" data-deliv-pid="${p.id}" data-deliv-idx="${idx}" data-deliv-src="${src}" style="cursor:pointer;flex-shrink:0;width:15px;height:15px" />
                  ${duePill}
                  <span style="font-size:11px;color:var(--text-tertiary);white-space:nowrap;flex-shrink:0">${dueDateStr}</span>
                  <span class="db-proj-name-label" style="flex:2">${esc(d.text)}</span>
                  <span class="db-proj-client-label" style="font-size:11px">${esc(p.name)}</span>
                  <button class="db-action-link" style="font-size:11px;padding:3px 8px;flex-shrink:0" data-open-pid="${p.id}">Open ↗</button>
                </div>
              </div>`
            }).join('')}
          </div>
        </div>
      </div>` : ''}

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
            ${enquiryProjects.map(p => {
              const cl = this.contacts.find(c => c.id === p.client_id)
              return `<div class="db-enq-row" data-open-pid="${p.id}">
                <span class="db-proj-name-label">${esc(p.name)}</span>
                ${cl ? `<span class="db-proj-client-label">${esc(cl.first_name+' '+cl.last_name)}</span>` : ''}
                ${p.brief ? `<span class="db-enq-brief">${esc(p.brief.slice(0,90))}${p.brief.length>90?'…':''}</span>` : ''}
              </div>`
            }).join('')}
          </div>` : `<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">No enquiries.</div>`}
        </div>
      </div>

      <!-- Retainers + Social Calendar row -->
      <div style="display:flex;gap:20px;margin-bottom:28px;align-items:flex-start">

        <!-- Retainers -->
        ${retainers.length ? `
        <div style="flex:1;min-width:0">
          <div class="db-section-head">
            <span class="db-section-dot" style="background:#a78bfa"></span>
            Retainers
            <span class="db-section-count">${retainers.length}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px" id="retainer-cards">
            ${retainers.map(p => {
              const cl = this.contacts.find(c => c.id === p.client_id)
              const periodMult = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}
              const calcHours = (p.retainer_items||[]).reduce((s,i) => {
                const mult = periodMult[i.period||'month']||1
                return s + (i.unit==='hours' ? (parseFloat(i.qty)||0)*mult : (parseFloat(i.qty)||0)*8*mult)
              }, 0)
              const hours = calcHours || (parseFloat(p.retainer_hours)||0)
              const calcFee = (p.retainer_items||[]).reduce((s,i) => {
                const mult = periodMult[i.period||'month']||1
                return s + (parseFloat(i.rate)||0)*(parseFloat(i.qty)||0)*mult
              }, 0)
              const fee = p.retainer_fee_mode==='calculated' ? calcFee : (parseFloat(p.retainer_fee)||0)
              return `<div class="kanban-card" style="border-left:3px solid #a78bfa;cursor:default" data-retainer="${p.id}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
                  <div class="kanban-card-title" style="cursor:pointer" data-open-pid="${p.id}">${p.name}</div>
                  ${fee ? `<div style="font-size:12px;font-weight:600;color:#a78bfa;white-space:nowrap;margin-left:8px">£${fee.toLocaleString('en-GB')}/mo</div>` : ''}
                </div>
                <div class="kanban-card-client">${cl ? cl.first_name+' '+cl.last_name : 'No client'}</div>
                ${(p.retainer_items||[]).length ? `
                  <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px" data-ret-items="${p.id}">
                    ${(p.retainer_items||[]).map((item,ii) => {
                      const mult = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}[item.period||'month']||1
                      const allocH = item.unit==='hours' ? Math.round((parseFloat(item.qty)||0)*mult) : Math.round((parseFloat(item.qty)||0)*8*mult)
                      return allocH ? `
                      <div>
                        <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">
                          <span style="color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">${esc(item.label)}</span>
                          <span data-ret-item-label="${p.id}-${ii}" style="color:var(--text-secondary);white-space:nowrap">— / ${allocH}h</span>
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
                    <div style="height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden">
                      <div style="height:100%;width:0%;border-radius:3px;transition:width 0.3s" data-ret-bar="${p.id}"></div>
                    </div>
                    <div data-ret-alert="${p.id}" style="font-size:10px;margin-top:4px;display:none"></div>
                  </div>` : ''}
              </div>`
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Social Calendar -->
        <div style="flex:1;min-width:0;max-width:420px">
          <div class="db-section-head" style="justify-content:space-between">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="db-section-dot" style="background:#34d399"></span>
              Social calendar
              ${this.socialPosts.filter(p => !p.completed).length ? `<span class="db-section-count">${this.socialPosts.filter(p => !p.completed).length}</span>` : ''}
            </div>
            <button class="db-action-link" id="social-add-btn" style="font-size:11px;padding:2px 8px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-secondary)">+ add</button>
          </div>

          <!-- Add form (hidden by default) -->
          <div id="social-add-form" style="display:none;background:var(--bg-secondary);border:0.5px solid var(--border-med);border-radius:var(--radius-md);padding:12px;margin-bottom:10px">
            <input id="social-new-title" type="text" placeholder="Project / topic name" maxlength="200"
              style="width:100%;padding:6px 10px;font-size:13px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;margin-bottom:8px;box-sizing:border-box">
            <textarea id="social-new-notes" placeholder="Notes (optional)" rows="2"
              style="width:100%;padding:6px 10px;font-size:12px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.4;margin-bottom:8px;box-sizing:border-box"></textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn-cancel" id="social-add-cancel" style="font-size:12px">Cancel</button>
              <button class="btn-primary" id="social-add-save" style="font-size:12px">Add</button>
            </div>
          </div>

          <!-- Post list -->
          <div id="social-post-list" style="display:flex;flex-direction:column;gap:6px">
            ${(() => {
              if (!this.expandedSocialPosts) this.expandedSocialPosts = new Set()
              const active = this.socialPosts.filter(p => !p.completed)
              const done   = this.socialPosts.filter(p => p.completed)
              const renderPost = (p) => {
                const isOpen = this.expandedSocialPosts.has(p.id)
                return `
                <div class="social-post-row" data-social-id="${p.id}" style="background:var(--bg-secondary);border:0.5px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden;${p.completed ? 'opacity:0.45;' : ''}">
                  <div class="social-post-header" style="display:flex;align-items:center;gap:8px;padding:8px 10px">
                    <input type="checkbox" class="social-check" data-social-id="${p.id}" ${p.completed ? 'checked' : ''}
                      style="flex-shrink:0;cursor:pointer;accent-color:#34d399">
                    <input class="social-title-input" data-social-id="${p.id}" value="${esc(p.title)}" placeholder="Title"
                      style="flex:1;min-width:0;background:transparent;border:none;outline:none;font-size:13px;font-weight:500;font-family:var(--font);padding:0;line-height:1.3;${p.completed ? 'text-decoration:line-through;color:var(--text-tertiary)' : 'color:var(--text-primary)'}">
                    <button class="social-toggle-btn" data-social-id="${p.id}"
                      style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:13px;line-height:1;padding:0 2px;opacity:0.55">${isOpen ? '▾' : '▸'}</button>
                  </div>
                  <div class="social-post-body" data-social-id="${p.id}" style="display:${isOpen ? 'block' : 'none'};padding:0 10px 10px 28px">
                    <textarea class="social-notes-input" data-social-id="${p.id}" placeholder="Add notes…" rows="2"
                      style="width:100%;background:transparent;border:none;outline:none;font-size:11px;color:var(--text-tertiary);font-family:var(--font);resize:none;padding:0;line-height:1.4;overflow:hidden;box-sizing:border-box;margin-bottom:6px">${esc(p.notes||'')}</textarea>
                    <div style="display:flex;justify-content:flex-end">
                      <button class="social-delete-btn" data-social-id="${p.id}" title="Delete"
                        style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:11px;line-height:1;padding:0;opacity:0.5">Delete</button>
                    </div>
                  </div>
                </div>`
              }
              if (!active.length && !done.length) {
                return `<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">No post ideas yet. Hit + add to get started.</div>`
              }
              return active.map(renderPost).join('') + done.map(renderPost).join('')
            })()}
          </div>
        </div>

      </div>

      <!-- Financial Summary -->
      <div style="padding-top:20px;border-top:1px solid var(--border-light)">
        <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px">Financial overview</div>
        <div class="stats-row">${statCards}</div>
      </div>`

    // --- Social calendar ---
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
      const { createSocialPost } = await import('./db/client.js')
      const post = await createSocialPost(this.userId, { title, notes: notesEl.value.trim() || null })
      this.socialPosts = [post, ...this.socialPosts]
      this.renderDashboard(mc)
    })
    mc.querySelectorAll('.social-check').forEach(cb => {
      cb.addEventListener('change', async () => {
        const id = cb.dataset.socialId
        const { updateSocialPost } = await import('./db/client.js')
        await updateSocialPost(this.userId, id, { completed: cb.checked })
        const post = this.socialPosts.find(p => p.id === id)
        if (post) post.completed = cb.checked
        this.renderDashboard(mc)
      })
    })
    mc.querySelectorAll('.social-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.socialId
        if (!confirm('Delete this post idea?')) return
        const { deleteSocialPost } = await import('./db/client.js')
        await deleteSocialPost(this.userId, id)
        this.socialPosts = this.socialPosts.filter(p => p.id !== id)
        this.renderDashboard(mc)
      })
    })
    mc.querySelectorAll('.social-title-input').forEach(input => {
      input.addEventListener('blur', async () => {
        const id = input.dataset.socialId
        const title = input.value.trim()
        const post = this.socialPosts.find(p => p.id === id)
        if (!title) { input.value = post?.title || ''; return }
        if (title === post?.title) return
        const { updateSocialPost } = await import('./db/client.js')
        await updateSocialPost(this.userId, id, { title })
        if (post) post.title = title
      })
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur() } })
    })
    mc.querySelectorAll('.social-notes-input').forEach(ta => {
      ta.addEventListener('blur', async () => {
        const id = ta.dataset.socialId
        const notes = ta.value.trim() || null
        const post = this.socialPosts.find(p => p.id === id)
        if (notes === (post?.notes || null)) return
        const { updateSocialPost } = await import('./db/client.js')
        await updateSocialPost(this.userId, id, { notes })
        if (post) post.notes = notes
      })
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' })
      // only auto-size if the body is currently visible
      if (ta.closest('.social-post-body')?.style.display !== 'none') {
        ta.dispatchEvent(new Event('input'))
      }
    })
    mc.querySelectorAll('.social-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.socialId
        const body = mc.querySelector(`.social-post-body[data-social-id="${id}"]`)
        if (!body) return
        const isOpen = this.expandedSocialPosts.has(id)
        if (isOpen) {
          this.expandedSocialPosts.delete(id)
          body.style.display = 'none'
          btn.textContent = '▸'
        } else {
          this.expandedSocialPosts.add(id)
          body.style.display = 'block'
          btn.textContent = '▾'
          const ta = body.querySelector('.social-notes-input')
          if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }
        }
      })
    })

    // --- Open project links ---
    mc.querySelectorAll('[data-open-pid]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); this.openProject(el.dataset.openPid) })
    })

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
        if (!opening && this._dbPinned.has(pid)) {
          this._dbPinned.delete(pid)
          el.querySelector(`[data-pin-pid="${pid}"]`)?.classList.remove('db-pin-btn--on')
          localStorage.setItem('db_pinned', JSON.stringify([...this._dbPinned]))
        }
      })
    })

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

    // --- Upcoming deliverables collapse ---
    mc.querySelector('#db-upcoming-toggle')?.addEventListener('click', () => {
      const body = mc.querySelector('#db-upcoming-body')
      const chevron = mc.querySelector('#db-upcoming-chevron')
      if (!body) return
      this._dbUpcomingOpen = body.style.display === 'none'
      body.style.display = this._dbUpcomingOpen ? 'block' : 'none'
      if (chevron) chevron.classList.toggle('db-chevron--open', this._dbUpcomingOpen)
      localStorage.setItem('db_upcoming_open', String(this._dbUpcomingOpen))
    })

    // --- Upcoming deliverable completion checkboxes ---
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
          const hours = allocH
          const pct = Math.min(100, Math.round(logged / hours * 100))
          const alertPctVal = parseFloat(p.retainer_alert) || 80
          const alertEl = mc.querySelector(`[data-ret-alert="${p.id}"]`)
          const items = p.retainer_items || []
          if (items.length) {
            const pm3 = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}
            items.forEach((item, ii) => {
              const mult = pm3[item.period||'month'] || 1
              const aH = item.unit==='hours' ? Math.round((parseFloat(item.qty)||0)*mult) : Math.round((parseFloat(item.qty)||0)*8*mult)
              if (!aH) return
              const iL = entries.filter(e => e.line_label === item.label).reduce((s,e) => s + parseFloat(e.hours), 0)
              const iPct = Math.min(100, Math.round(iL / aH * 100))
              const iCol = iPct >= 100 ? '#ef4444' : iPct >= alertPctVal ? '#f59e0b' : '#a78bfa'
              const bar = mc.querySelector(`[data-ret-item-bar="${p.id}-${ii}"]`)
              const lbl = mc.querySelector(`[data-ret-item-label="${p.id}-${ii}"]`)
              if (bar) { bar.style.width = iPct + '%'; bar.style.background = iCol }
              if (lbl) { lbl.textContent = `${iL.toFixed(1)} / ${aH}h`; lbl.style.color = iPct >= alertPctVal ? iCol : '' }
            })
            const colour = pct >= 100 ? '#ef4444' : pct >= alertPctVal ? '#f59e0b' : '#a78bfa'
            if (alertEl && pct >= alertPctVal && pct < 100) { alertEl.style.display='block'; alertEl.style.color=colour; alertEl.textContent=`⚠ ${pct}% used overall` }
            if (alertEl && pct >= 100) { alertEl.style.display='block'; alertEl.style.color=colour; alertEl.textContent=`⚠ Over allocation by ${(logged-hours).toFixed(1)}h` }
          } else {
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
      const { getUserNotes } = await import('./db/client.js')
      this._notes = await getUserNotes(this.clerkUserId)
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
    list.innerHTML = this._notes.map(n => {
      const isOpen = this._openNoteIds.has(n.id)
      return `
      <div class="notes-card${isOpen?' open':''}" data-note-id="${n.id}">
        <div class="notes-card-header" data-toggle-id="${n.id}">
          <input class="notes-title-input" data-note-id="${n.id}" value="${(n.title||'').replace(/"/g,'&quot;')}" placeholder="Untitled" />
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
            <button class="notes-delete-btn" data-delete-id="${n.id}" title="Delete note">Delete</button>
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
    list.querySelectorAll('.notes-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this._deleteNote(btn.dataset.deleteId))
    })
  }

  async _newNote() {
    try {
      const { createUserNote } = await import('./db/client.js')
      const note = await createUserNote(this.clerkUserId, { sort_order: 0 })
      if (!this._notes) this._notes = []
      if (!this._openNoteIds) this._openNoteIds = new Set()
      this._openNoteIds.add(note.id)
      this._notes.unshift(note)
      this._renderNotesList()
      const firstTitle = document.querySelector('.notes-title-input')
      firstTitle?.focus()
    } catch(e) { console.error('Failed to create note:', e) }
  }

  async _saveNote(id, data) {
    try {
      const { updateUserNote } = await import('./db/client.js')
      const updated = await updateUserNote(this.clerkUserId, id, data)
      if (updated && this._notes) {
        const idx = this._notes.findIndex(n => n.id === id)
        if (idx !== -1) this._notes[idx] = { ...this._notes[idx], ...updated }
        const ts = document.querySelector(`.notes-card[data-note-id="${id}"] .notes-timestamp`)
        if (ts) ts.textContent = 'just now'
      }
    } catch(e) { console.error('Failed to save note:', e) }
  }

  async _deleteNote(id) {
    if (!confirm('Delete this note?')) return
    try {
      const { deleteUserNote } = await import('./db/client.js')
      await deleteUserNote(this.clerkUserId, id)
      this._notes = (this._notes || []).filter(n => n.id !== id)
      this._renderNotesList()
    } catch(e) { console.error('Failed to delete note:', e) }
  }

  renderSettings(mc) {
    const s = this.settings ?? {}
    const isAdmin = this.appUser?.role === 'admin'
    const PERM_LABELS = {
      contacts_view:'View contacts', contacts_edit:'Edit contacts',
      projects_view:'View projects', projects_edit:'Edit projects',
      budgets_view:'View budgets',   budgets_edit:'Edit budgets',
      settings:'Access settings',
    }
    mc.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;max-width:1100px">
      <div style="display:flex;flex-direction:column;gap:16px">
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
            <div><button class="btn-primary" id="settings-save-btn">Save settings</button></div>
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
            <div><button class="btn-primary" id="settings-save-btn-2">Save settings</button></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><span class="panel-title">Invoicing defaults (for crew call sheets)</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">The email and boilerplate shown to crew on call sheets so they know where to send invoices and what to include.</div>
            <div class="field"><div class="field-label">Default invoicing email</div><input type="email" id="s-inv-email" value="${s.invoicing_email??''}" placeholder="e.g. finance@yourstudio.com" /></div>
            <div class="field">
              <div class="field-label">Invoicing boilerplate</div>
              <textarea id="s-inv-boilerplate" style="width:100%;min-height:140px;padding:8px 11px;font-size:12px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.6" placeholder="In order to comply with HMRC regulations and for us to pay your invoice, please include the following:&#10;1. Correct Banking Information&#10;2. Dates worked and service provided&#10;3. Full name as registered with HMRC…">${s.invoicing_boilerplate??''}</textarea>
            </div>
            <div><button class="btn-primary" id="settings-save-btn-3">Save settings</button></div>
          </div>
        </div>

        ${isAdmin ? `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Users</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Invite-only. New users receive an email invitation from Clerk and are assigned Member role by default.</div>
            <div style="display:flex;gap:8px">
              <input type="email" id="invite-email" placeholder="colleague@email.com" style="flex:1;padding:8px 11px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
              <button class="btn-primary" id="invite-btn">Send invite</button>
            </div>
            <div id="users-list"><div style="font-size:12px;color:var(--text-tertiary)">Loading users…</div></div>
          </div>
        </div>` : ''}

        <div class="panel">
          <div class="panel-header"><span class="panel-title">Account</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:10px">
            <div style="font-size:13px;color:var(--text-secondary)">
              Signed in as <strong>${this.user.primaryEmailAddress?.emailAddress??''}</strong>
              <span class="tag" style="background:var(--bg-secondary);color:var(--text-secondary);margin-left:8px;text-transform:capitalize">${this.appUser?.role??'member'}</span>
            </div>
            <button class="btn-cancel" style="width:fit-content" id="signout-settings">Sign out</button>
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">
        ${isAdmin ? `
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
        </div>` : '<div></div>'}
      </div>
    </div>`

    mc.querySelector('#settings-save-btn')?.addEventListener('click', () => this.saveSettings(mc))
    mc.querySelector('#settings-save-btn-2')?.addEventListener('click', () => this.saveSettings(mc))
    mc.querySelector('#settings-save-btn-3')?.addEventListener('click', () => this.saveSettings(mc))
    mc.querySelector('#signout-settings')?.addEventListener('click', () => this.onSignOut())

    if (isAdmin) {
      this._loadUsersPanel(mc)
      mc.querySelector('#invite-btn')?.addEventListener('click', () => this._sendInvite(mc))
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
          <button class="btn-primary" id="tpl-save">Save template</button>
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
        btn.addEventListener('click', () => {
          if (!confirm('Remove this section from the template?')) return
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
      el.querySelector('#tpl-reset')?.addEventListener('click', () => {
        if (!confirm('Reset to built-in defaults? Your custom template will be lost.')) return
        template = JSON.parse(JSON.stringify(SECTIONS))
        render()
      })
    }

    render()
  }

  async _loadUsersPanel(mc) {
    const el = mc.querySelector('#users-list')
    if (!el) return
    try {
      const { getAllAppUsers, updateAppUser, ROLE_PRESETS } = await import('./db/client.js')
      const users = await getAllAppUsers()
      const PERM_KEYS = ['contacts_view','contacts_edit','projects_view','projects_edit','budgets_view','budgets_edit','settings']
      const PERM_LABELS = {
        contacts_view:'View contacts', contacts_edit:'Edit contacts',
        projects_view:'View projects', projects_edit:'Edit projects',
        budgets_view:'View budgets',   budgets_edit:'Edit budgets',
        settings:'Settings access',
      }

      el.innerHTML = users.map(u => {
        const preset = ROLE_PRESETS[u.role] ?? ROLE_PRESETS.member
        const overrides = u.permissions ?? {}
        const isSelf = u.clerk_id === this.clerkUserId
        return `<div style="border:1px solid var(--border-light);border-radius:var(--radius-md);padding:14px;margin-bottom:10px" data-uid="${u.id}">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="flex:1">
              <div style="font-size:13px;font-weight:500">${u.name||'—'} ${isSelf?'<span style="font-size:10px;color:var(--text-tertiary)">(you)</span>':''}</div>
              <div style="font-size:12px;color:var(--text-secondary)">${u.email}</div>
            </div>
            <select class="status-select" data-role-uid="${u.id}" ${isSelf?'disabled':''} style="width:120px">
              ${['admin','member','readonly'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${r.charAt(0).toUpperCase()+r.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            ${PERM_KEYS.map(k => {
              const fromRole = preset[k]
              const override = overrides[k]
              const effective = override !== undefined ? override : fromRole
              return `<label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-secondary);cursor:${isSelf?'default':'pointer'}">
                <input type="checkbox" ${effective?'checked':''} data-perm="${u.id}:${k}" ${isSelf?'disabled':''} style="cursor:${isSelf?'default':'pointer'}" />
                ${PERM_LABELS[k]}
                ${override!==undefined?`<span style="font-size:10px;color:#d48c10" title="Overrides role preset">✱</span>`:''}
              </label>`
            }).join('')}
          </div>
          <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
            <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap">Default crew role:</div>
            <input type="text" value="${u.default_role||''}" placeholder="e.g. Camera Operator" data-default-role="${u.id}"
              style="flex:1;font-size:12px;padding:4px 8px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
          </div>
          ${!isSelf ? `<div style="margin-top:10px;text-align:right"><button class="row-btn" data-save-user="${u.id}" style="font-size:11px">Save changes</button></div>` : ''}
        </div>`
      }).join('')

      // Role change — update preset display immediately
      el.querySelectorAll('[data-role-uid]').forEach(sel => {
        sel.addEventListener('change', () => {
          const uid = sel.dataset.roleUid
          const newRole = sel.value
          const newPreset = ROLE_PRESETS[newRole] ?? ROLE_PRESETS.member
          PERM_KEYS.forEach(k => {
            const cb = el.querySelector(`[data-perm="${uid}:${k}"]`)
            if (cb && !cb.disabled) cb.checked = newPreset[k]
          })
        })
      })

      // Save user
      el.querySelectorAll('[data-save-user]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = btn.dataset.saveUser
          const role = el.querySelector(`[data-role-uid="${uid}"]`)?.value ?? 'member'
          const default_role = el.querySelector(`[data-default-role="${uid}"]`)?.value.trim() || null
          const preset = ROLE_PRESETS[role] ?? ROLE_PRESETS.member
          const perms = {}
          PERM_KEYS.forEach(k => {
            const cb = el.querySelector(`[data-perm="${uid}:${k}"]`)
            if (cb) {
              const val = cb.checked
              // Only store if it differs from preset (override)
              if (val !== preset[k]) perms[k] = val
            }
          })
          try {
            await updateAppUser(uid, { role, permissions: perms, default_role })
            // Update in-memory allUsers so crew dropdown reflects changes immediately
            const u = this.allUsers?.find(x => x.id === uid)
            if (u) { u.role = role; u.permissions = perms; u.default_role = default_role }
            this.toast('User updated')
            this._loadUsersPanel(mc)
          } catch(e) { console.error(e); this.toast('Error saving user') }
        })
      })
    } catch(e) { console.error(e); el.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary)">Could not load users</div>' }
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

  async saveSettings(mc) {
    const data = {
      company_name: mc.querySelector('#s-name')?.value.trim()||'Slate',
      email:        mc.querySelector('#s-email')?.value.trim()||null,
      phone:        mc.querySelector('#s-phone')?.value.trim()||null,
      website:      mc.querySelector('#s-website')?.value.trim()||null,
      address:      mc.querySelector('#s-address')?.value.trim()||null,
      vat_number:          mc.querySelector('#s-vat')?.value.trim()||null,
      prepared_by:         mc.querySelector('#s-preparedby')?.value.trim()||null,
      hs_boilerplate:      mc.querySelector('#s-hs')?.value.trim()||null,
      financial_year_start: parseInt(mc.querySelector('#s-fy-start')?.value||'4'),
      budget_template:     this.settings?.budget_template ?? null,
      default_insurer_name:    mc.querySelector('#s-ins-name')?.value.trim()||null,
      default_insurer_address: mc.querySelector('#s-ins-addr')?.value.trim()||null,
      default_insurer_email:   mc.querySelector('#s-ins-email')?.value.trim()||null,
      default_insurer_contact: mc.querySelector('#s-ins-contact')?.value.trim()||null,
      invoicing_email:         mc.querySelector('#s-inv-email')?.value.trim()||null,
      invoicing_boilerplate:   mc.querySelector('#s-inv-boilerplate')?.value.trim()||null,
    }
    try { const [updated] = await upsertSettings(this.userId, data); this.settings = updated; this.toast('Settings saved') }
    catch (e) { console.error(e); this.toast('Error saving settings') }
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

  injectGlobalStyles() {
    if (document.getElementById('app-styles')) return
    const style = document.createElement('style')
    style.id = 'app-styles'
    style.textContent = `
      .sidebar{width:260px;flex-shrink:0;background:#1D2125;display:flex;flex-direction:column;overflow:hidden}
      .logo{padding:14px 16px 14px;display:flex;align-items:center;border-bottom:1px solid rgba(255,255,255,0.06)}
      .logo img{height:28px;width:auto;display:block;filter:brightness(0) invert(1)}
      .nav-label{font-size:11px;color:#596773;text-transform:uppercase;letter-spacing:0.8px;padding:16px 16px 4px}
      .nav-item{display:flex;align-items:center;gap:10px;padding:8px 16px;font-size:14px;color:#B6C2CF;cursor:pointer;border-radius:3px;margin:1px 8px;transition:background 0.12s,color 0.12s;user-select:none}
      .nav-item:hover{background:#2C333A;color:#C7D1DB}
      .nav-item.active{background:#1868DB;color:#ffffff;font-weight:500}
      .nav-item svg{opacity:0.75;flex-shrink:0}.nav-item.active svg{opacity:1}
      .nav-bottom{margin-top:auto;border-top:1px solid rgba(255,255,255,0.08);padding:8px 0}
      .main{flex:1;display:flex;flex-direction:column;min-width:0}
      .topbar{background:var(--bg-primary);border-bottom:1px solid var(--border-light);padding:0 24px;height:52px;display:flex;align-items:center;gap:12px;flex-shrink:0}
      .topbar-title{font-size:15px;font-weight:600;color:var(--text-primary);flex:1;letter-spacing:-0.1px}
      .search-wrap{position:relative}
      .search-wrap input{padding:7px 12px 7px 34px;font-size:13px;border-radius:var(--radius-md);width:220px;background:var(--bg-secondary);border:1px solid var(--border-light);color:var(--text-primary);font-family:var(--font);outline:none;transition:border 0.15s}
      .search-wrap input:focus{border-color:var(--accent)}
      .search-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--text-tertiary);pointer-events:none}
      .content{flex:1;overflow-y:auto;padding:24px}
      .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
      .stat-card{background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:16px;box-shadow:0 1px 2px rgba(9,30,66,0.06)}
      .stat-label{font-size:11px;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500}
      .stat-value{font-size:26px;font-weight:600;letter-spacing:-0.5px;color:var(--text-primary)}
      .stat-sub{font-size:11px;color:var(--text-tertiary);margin-top:3px}
      .panel{background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-lg);overflow:hidden;box-shadow:0 1px 3px rgba(9,30,66,0.06)}
      .panel-header{display:flex;align-items:center;padding:12px 20px;border-bottom:1px solid var(--border-light);gap:8px;flex-wrap:wrap}
      .panel-title{font-size:13px;font-weight:600;flex:1;color:var(--text-primary)}
      .filter-pill{font-size:13px;padding:4px 12px;border-radius:3px;border:none;color:var(--text-secondary);cursor:pointer;background:transparent;font-family:var(--font);font-weight:400;transition:background 0.12s,color 0.12s}
      .filter-pill:hover{background:var(--bg-tertiary);color:var(--text-primary)}.filter-pill.active{background:var(--accent-subtle);color:var(--accent);font-weight:500}
      .col-header{display:grid;padding:9px 20px;border-bottom:1px solid var(--border-light);font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px}
      .contact-row{display:grid;align-items:center;padding:12px 20px;border-bottom:1px solid var(--border-light);cursor:pointer;transition:background 0.1s}
      .contact-row:last-child{border-bottom:none}.contact-row:hover{background:var(--bg-secondary)}.contact-row.selected{background:var(--accent-subtle)}
      .contact-name{display:flex;align-items:center;gap:10px}
      .avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}
      .name-main{font-size:13px;font-weight:500}.name-sub{font-size:12px;color:var(--text-secondary);margin-top:1px}
      .tag{display:inline-flex;font-size:11px;padding:3px 8px;border-radius:3px;font-weight:500}
      .status-cell{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)}
      .dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
      .dot-active{background:#22A06B}.dot-warm{background:#E2812D}.dot-cold{background:#8590A2}
      .actions-cell{display:flex;justify-content:flex-end;gap:6px}
      .row-btn{font-size:11px;padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-light);background:transparent;color:var(--text-secondary);cursor:pointer;font-family:var(--font);transition:background 0.1s,color 0.1s}
      .row-btn:hover{background:var(--bg-tertiary);color:var(--text-primary)}
      .empty-state{padding:48px 20px;text-align:center;color:var(--text-tertiary);font-size:13px}
      .detail-panel{width:300px;flex-shrink:0;background:var(--bg-primary);border-left:1px solid var(--border-light);display:flex;flex-direction:column;overflow-y:auto}
      .detail-empty{display:flex;align-items:center;justify-content:center;flex:1;font-size:13px;color:var(--text-tertiary);text-align:center;line-height:1.6}
      .detail-header{padding:20px;border-bottom:1px solid var(--border-light)}
      .detail-avatar{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;margin-bottom:12px}
      .detail-name{font-size:15px;font-weight:600}.detail-role{font-size:12px;color:var(--text-secondary);margin-top:3px}
      .detail-tags{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
      .detail-section{padding:16px 20px;border-bottom:1px solid var(--border-light)}.detail-section:last-child{border-bottom:none}
      .section-title{font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px;font-weight:600}
      .info-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;gap:8px}
      .info-key{font-size:12px;color:var(--text-secondary);flex-shrink:0}.info-val{font-size:12px;color:var(--text-primary);text-align:right;word-break:break-all}
      .note-item{background:var(--bg-secondary);border-radius:var(--radius-md);padding:9px 11px;margin-bottom:8px}
      .note-text{font-size:12px;color:var(--text-primary);line-height:1.5}.note-date{font-size:11px;color:var(--text-tertiary);margin-top:5px}
      .project-chip{display:flex;justify-content:space-between;align-items:center;background:var(--bg-secondary);border-radius:var(--radius-md);padding:8px 11px;margin-bottom:6px;cursor:pointer;transition:background 0.1s}
      .project-chip:hover{background:var(--bg-tertiary)}.project-chip-name{font-size:12px;font-weight:500}.project-chip-badge{font-size:11px;color:var(--text-secondary)}
      .dashed-btn{width:100%;padding:8px;border:1px dashed var(--border-med);border-radius:var(--radius-md);background:transparent;color:var(--text-tertiary);font-size:12px;cursor:pointer;font-family:var(--font);transition:background 0.1s,color 0.1s;margin-top:6px}
      .dashed-btn:hover{background:var(--bg-secondary);color:var(--text-primary)}
      .modal-backdrop{display:none;position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:100;align-items:center;justify-content:center}
      .modal-backdrop.open{display:flex}
      .modal{background:var(--bg-primary);border-radius:var(--radius-lg);border:none;box-shadow:0 8px 32px rgba(9,30,66,0.22);width:480px;max-width:96vw;overflow:hidden;max-height:90vh;display:flex;flex-direction:column}
      .modal-header{padding:18px 20px 14px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;flex-shrink:0}
      .modal-title{font-size:15px;font-weight:600;flex:1;color:var(--text-primary)}.modal-close{background:none;border:none;font-size:18px;color:var(--text-tertiary);cursor:pointer;line-height:1;padding:2px 4px}
      .modal-body{padding:20px;display:flex;flex-direction:column;gap:14px;overflow-y:auto}
      .modal-footer{padding:14px 20px;border-top:1px solid var(--border-light);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0}
      .field-label{font-size:12px;color:var(--text-secondary);margin-bottom:5px;font-weight:500}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .field input,.field select,.field textarea{width:100%;padding:8px 11px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;transition:border 0.15s,box-shadow 0.15s}
      .field input:focus,.field select:focus,.field textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(0,82,204,0.12)}.field textarea{resize:vertical;min-height:70px}
      .btn-cancel{background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-light);padding:8px 14px;border-radius:var(--radius-md);font-size:13px;cursor:pointer;font-family:var(--font)}
      .btn-cancel:hover{background:var(--bg-tertiary)}
      .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(8px);background:#172B4D;color:#fff;padding:10px 18px;border-radius:var(--radius-md);font-size:13px;opacity:0;transition:opacity 0.2s,transform 0.2s;pointer-events:none;z-index:200;white-space:nowrap;box-shadow:0 4px 12px rgba(9,30,66,0.3)}
      .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
      .av-blue{background:#DEEBFF;color:#0747A6}.av-teal{background:#E3FCEF;color:#006644}.av-coral{background:#FFEBE6;color:#BF2600}.av-purple{background:#EAE6FF;color:#403294}.av-amber{background:#FFFAE6;color:#172B4D}.av-green{background:#E3FCEF;color:#006644}.av-pink{background:#FFECF8;color:#6E2B83}
      .tag-brand{background:#DEEBFF;color:#0747A6}.tag-agency{background:#EAE6FF;color:#403294}.tag-ngo{background:#E3FCEF;color:#006644}.tag-sport{background:#FFFAE6;color:#5A3A00}.tag-corp{background:#F4F5F7;color:#42526E}.tag-sub{background:#FFEBE6;color:#BF2600}
      .budget-layout{display:flex;gap:20px;align-items:flex-start}.budget-main{flex:1;min-width:0}.budget-sidebar-panel{width:210px;flex-shrink:0}
      .bsum-card{background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:12px;box-shadow:0 1px 2px rgba(9,30,66,0.06)}
      .bsum-head{padding:11px 15px;border-bottom:1px solid var(--border-light);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary)}
      .bsum-row{display:flex;justify-content:space-between;padding:7px 15px;font-size:12px;border-bottom:1px solid var(--border-light)}.bsum-row:last-child{border-bottom:none}
      .bsum-row.grand{font-weight:600;font-size:13px;padding:11px 15px;background:var(--bg-secondary)}
      .bsum-row .sk{color:var(--text-secondary)}.bsum-row .sv{color:var(--text-primary);font-variant-numeric:tabular-nums}
      .bsec-wrap{background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-md);margin-bottom:8px;overflow:hidden}
      .bsec-head{display:flex;align-items:center;padding:10px 14px;cursor:pointer;gap:8px;user-select:none;transition:background 0.1s}
      .bsec-head:hover,.bsec-head.enabled{background:var(--bg-secondary)}
      .bsec-code{font-size:10px;font-weight:700;color:var(--text-tertiary);width:22px;letter-spacing:0.3px}.bsec-name{font-size:13px;flex:1}
      .bsec-amt{font-size:12px;color:var(--text-secondary);font-variant-numeric:tabular-nums;min-width:60px;text-align:right}
      .bsec-tog{font-size:11px;color:var(--text-secondary);padding:2px 9px;border:1px solid var(--border-light);border-radius:3px;background:transparent;cursor:pointer;font-family:var(--font);flex-shrink:0}
      .bsec-tog.on{background:var(--accent);color:#fff;border-color:var(--accent)}
      .bsec-chev{color:var(--text-tertiary);font-size:9px;transition:transform 0.18s;flex-shrink:0}.bsec-chev.open{transform:rotate(90deg)}
      .cs-panel-head{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);padding:11px 16px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
      .cs-panel-head:hover{background:var(--bg-secondary)}
      .cs-panel-body{}.cs-panel-body.cs-collapsed{display:none}
      .bsec-body{display:none;border-top:1px solid var(--border-light)}.bsec-body.open{display:block;overflow-x:auto}
      .bl-table{width:100%;border-collapse:collapse;min-width:880px}
      .bl-table th{font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;padding:8px 6px;text-align:left;border-bottom:1px solid var(--border-light);font-weight:600}
      .bl-table th.r{text-align:right}.bl-table td{padding:4px 4px;vertical-align:middle;border-bottom:1px solid var(--border-light)}
      .bl-table tr:last-child td{border-bottom:none}.bl-table tr.sub td{background:var(--bg-secondary);font-size:12px;font-weight:500}
      .bl-in{font-size:13px;padding:6px 8px;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;transition:border 0.12s,box-shadow 0.12s;min-height:32px}
      .bl-in:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(0,82,204,0.1)}.bl-in.w{width:100%}.bl-in.n{width:80px;text-align:right;font-variant-numeric:tabular-nums}
      .bl-tot{font-size:12px;font-variant-numeric:tabular-nums;color:var(--text-tertiary);text-align:right;white-space:nowrap}.bl-tot.nz{color:var(--text-primary);font-weight:500}
      .add-line{display:flex;align-items:center;gap:6px;padding:8px 10px;font-size:12px;color:var(--text-tertiary);cursor:pointer;border:none;border-top:1px solid var(--border-light);background:transparent;width:100%;text-align:left;font-family:var(--font);transition:background 0.1s,color 0.1s}
      .add-line:hover{background:var(--bg-secondary);color:var(--text-secondary)}
      .bh-row{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}
      .mu-row{display:flex;gap:20px;margin-bottom:18px;align-items:center;flex-wrap:wrap}
      .mu-field{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)}
      .mu-field input{width:58px;padding:5px 8px;font-size:12px;border:1px solid var(--border-med);border-radius:var(--radius-sm);font-family:var(--font);outline:none;text-align:right;color:var(--text-primary);background:var(--bg-primary)}
      .kanban-wrap{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
      .kanban-col{display:flex;flex-direction:column;gap:8px}
      .kanban-col-head{font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;padding:0 4px 10px;display:flex;align-items:center;gap:8px}
      .kanban-count{font-size:11px;font-weight:600;color:var(--text-secondary);background:var(--bg-tertiary);border-radius:3px;padding:1px 6px}
      .kanban-card{background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:12px;cursor:pointer;box-shadow:0 1px 2px rgba(9,30,66,0.06);transition:box-shadow 0.15s,border-color 0.15s}
      .kanban-card:hover{box-shadow:0 4px 12px rgba(9,30,66,0.12);border-color:var(--accent)}
      .kanban-card-title{font-size:14px;font-weight:500;margin-bottom:4px;line-height:1.4;color:var(--text-primary)}.kanban-card-client{font-size:12px;color:var(--text-secondary);margin-bottom:6px}
      .kanban-card-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.kanban-card-date{font-size:11px;color:var(--text-tertiary)}
      .kanban-add{border:1px dashed var(--border-med);border-radius:var(--radius-md);padding:9px 12px;font-size:12px;color:var(--text-tertiary);cursor:pointer;text-align:center;background:transparent;width:100%;font-family:var(--font);transition:background 0.1s,color 0.1s}
      .kanban-add:hover{background:var(--bg-secondary);color:var(--text-secondary)}
      .proj-layout{display:flex;gap:20px;align-items:flex-start}
      .proj-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}.proj-sidebar{width:240px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;transition:width 0.2s,opacity 0.2s}
      .proj-sidebar.collapsed{width:0;overflow:hidden;opacity:0;pointer-events:none}
      .proj-tab-bar{display:flex;gap:0;border-bottom:1px solid var(--border-light);margin-bottom:20px;overflow-x:auto;scrollbar-width:none}
      .proj-tab-bar::-webkit-scrollbar{display:none}
      .proj-tab{padding:10px 16px;font-size:13px;font-weight:500;color:var(--text-tertiary);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;background:none;border-left:none;border-right:none;border-top:none;font-family:var(--font);transition:color 0.1s}
      .proj-tab:hover{color:var(--text-primary)}
      .proj-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
      .proj-sidebar-toggle{background:none;border:1px solid var(--border-light);border-radius:var(--radius-sm);padding:4px 8px;font-size:12px;color:var(--text-tertiary);cursor:pointer;flex-shrink:0}
      .proj-sidebar-toggle:hover{color:var(--text-primary);border-color:var(--border-strong)}
      .proj-panel{background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-lg);overflow:hidden;box-shadow:0 1px 3px rgba(9,30,66,0.06)}
      .proj-panel-head{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);padding:10px 14px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:8px}
      .proj-panel-body{padding:14px;display:flex;flex-direction:column;gap:12px}
      .proj-field-label{font-size:11px;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600}
      .proj-input{width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;transition:border 0.12s,box-shadow 0.12s}
      .proj-input:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(0,82,204,0.1)}
      .proj-textarea{width:100%;padding:8px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;min-height:80px;line-height:1.6;transition:border 0.12s,box-shadow 0.12s}
      .proj-textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(0,82,204,0.1)}.proj-date-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .deliverable-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-light)}.deliverable-row:last-child{border-bottom:none}
      .deliverable-check{width:16px;height:16px;flex-shrink:0;cursor:pointer}
      .deliverable-text{flex:1;font-size:13px;background:transparent;border:none;outline:none;font-family:var(--font);color:var(--text-primary)}
      .shot-row{display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-light)}.shot-row:last-child{border-bottom:none}
      .shot-num{font-size:11px;color:var(--text-tertiary);width:20px;flex-shrink:0;padding-top:2px}
      .shot-text{flex:1;font-size:13px;background:transparent;border:none;outline:none;font-family:var(--font);color:var(--text-primary);resize:none;line-height:1.5}
      .crew-row{display:grid;grid-template-columns:1fr 1fr 40px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-light)}.crew-row:last-child{border-bottom:none}
      .approval-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-light);font-size:13px}.approval-row:last-child{border-bottom:none}
      .approval-label{color:var(--text-secondary)}
      .approval-status{font-size:11px;padding:3px 9px;border-radius:3px;cursor:pointer;font-family:var(--font);border:none;font-weight:500}
      .apv-pending{background:var(--bg-secondary);color:var(--text-tertiary)}.apv-approved{background:#E3FCEF;color:#006644}.apv-changes{background:#FFFAE6;color:#5A3A00}
      .status-select{font-size:12px;padding:5px 8px;border:1px solid var(--border-med);border-radius:var(--radius-md);font-family:var(--font);background:var(--bg-primary);color:var(--text-primary);outline:none}
      #pdf-topsheet{display:none}
      @media print{body>*{display:none!important}#pdf-topsheet{display:block!important}@page{margin:0;size:A4}}
      .pdf-cover{background:#1a1a18;color:#fff;width:210mm;min-height:297mm;display:flex;flex-direction:column;padding:52px 56px 44px;page-break-after:always}
      .pdf-logo{margin-bottom:auto}.pdf-logo img{height:48px;width:auto;filter:brightness(0) invert(1)}
      .pdf-quote-label{font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:rgba(255,255,255,0.4);margin-bottom:14px}
      .pdf-budget-title{font-size:38px;font-weight:500;letter-spacing:-1px;line-height:1.1;margin-bottom:10px}
      .pdf-client-name{font-size:16px;color:rgba(255,255,255,0.55);margin-bottom:52px}
      .pdf-cover-divider{border:none;border-top:0.5px solid rgba(255,255,255,0.15);margin-bottom:32px}
      .pdf-cover-summary{width:100%;border-collapse:collapse;margin-bottom:36px}
      .pdf-cover-summary tr{border-bottom:0.5px solid rgba(255,255,255,0.1)}.pdf-cover-summary tr:last-child{border-bottom:none}
      .pdf-cover-summary td{padding:9px 0;font-size:14px}
      .sec-code{font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:0.5px;width:36px;font-weight:600;vertical-align:middle}
      .sec-name{color:rgba(255,255,255,0.8);vertical-align:middle}.sec-total{text-align:right;font-variant-numeric:tabular-nums;font-weight:500;vertical-align:middle}
      .pdf-cover-totals{border-top:0.5px solid rgba(255,255,255,0.25);padding-top:20px}
      .pdf-cover-total-row{display:flex;justify-content:space-between;padding:5px 0;font-size:14px}
      .pdf-cover-total-row .tk{color:rgba(255,255,255,0.5)}.pdf-cover-total-row .tv{font-variant-numeric:tabular-nums}
      .pdf-cover-total-row.grand{font-size:22px;font-weight:500;padding:14px 0 0}
      .pdf-cover-footer{margin-top:32px;display:flex;justify-content:space-between;align-items:flex-end}
      .pdf-cover-meta{font-size:11px;color:rgba(255,255,255,0.3);line-height:1.8}.pdf-valid{font-size:11px;color:rgba(255,255,255,0.35);text-align:right;line-height:1.8}
      .pdf-detail-page{width:210mm;min-height:297mm;padding:44px 56px;page-break-before:always}
      .pdf-detail-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:36px;padding-bottom:20px;border-bottom:0.5px solid #e0dfda}
      .pdf-detail-header-left{display:flex;flex-direction:column;gap:4px}
      .pdf-detail-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#a8a8a0}.pdf-detail-title{font-size:18px;font-weight:500;letter-spacing:-0.3px}
      .pdf-detail-header img{height:32px;width:auto}
      .pdf-section{margin-bottom:28px}
      .pdf-section-header{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid #1a1a18}
      .pdf-section-code{font-size:10px;font-weight:700;color:#a8a8a0;letter-spacing:0.5px}.pdf-section-name{font-size:13px;font-weight:500;flex:1}.pdf-section-total{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
      .pdf-col-heads{display:grid;grid-template-columns:1fr 44px 36px 44px 72px;gap:6px;padding:4px 0 5px}
      .pdf-col-head{font-size:9px;text-transform:uppercase;letter-spacing:0.6px;color:#a8a8a0;text-align:right}.pdf-col-head:first-child{text-align:left}
      .pdf-line{display:grid;grid-template-columns:1fr 44px 36px 44px 72px;gap:6px;padding:6px 0;border-bottom:0.5px solid #f0efe9;align-items:baseline}.pdf-line:last-child{border-bottom:none}
      .pdf-line-item{font-size:12px}.pdf-line-sub{font-size:10px;color:#a8a8a0;margin-top:2px}
      .pdf-line-num{font-size:12px;color:#6b6b66;text-align:right;font-variant-numeric:tabular-nums}.pdf-line-total{font-size:12px;font-weight:500;text-align:right;font-variant-numeric:tabular-nums}
      .pdf-detail-totals{margin-top:36px;border-top:1px solid #1a1a18;padding-top:16px}
      .pdf-detail-total-row{display:flex;justify-content:space-between;padding:5px 0;font-size:12px;border-bottom:0.5px solid #f0efe9}.pdf-detail-total-row:last-child{border-bottom:none}
      .pdf-detail-total-row.grand{font-size:16px;font-weight:500;padding-top:12px}.pdf-detail-total-row .dk{color:#6b6b66}
      .pdf-detail-footer{margin-top:40px;display:flex;justify-content:space-between;font-size:9px;color:#c0c0b8;border-top:0.5px solid #e0dfda;padding-top:10px}

      /* ── Mobile sidebar overlay ── */
      .sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:150;cursor:pointer}
      .sidebar-overlay.open{display:block}
      .mobile-menu-btn{display:none;width:36px;height:36px;border:none;background:transparent;color:var(--text-secondary);cursor:pointer;border-radius:var(--radius-md);align-items:center;justify-content:center;flex-shrink:0;padding:0;transition:background 0.12s,color 0.12s}
      .mobile-menu-btn:hover{background:var(--bg-secondary);color:var(--text-primary)}

      /* ── Responsive: ≤900px (tablet) ── */
      @media(max-width:900px){
        .stats-row{grid-template-columns:repeat(2,1fr)!important}
        .kanban-wrap{grid-template-columns:repeat(3,minmax(200px,1fr))!important}
        .sidebar{width:220px}
      }

      /* ── Responsive: ≤768px (mobile) ── */
      @media(max-width:768px){
        .mobile-menu-btn{display:flex}
        .sidebar{
          position:fixed;left:0;top:0;bottom:0;
          z-index:200;
          transform:translateX(-100%);
          transition:transform 0.25s cubic-bezier(0.4,0,0.2,1);
          width:260px!important;
          box-shadow:none
        }
        .sidebar.open{transform:translateX(0);box-shadow:4px 0 24px rgba(0,0,0,0.3)}
        .detail-panel{display:none!important}
        .topbar{padding:0 12px!important;gap:6px}
        .content{padding:16px!important}
        .stats-row{grid-template-columns:repeat(2,1fr)!important}
        .kanban-wrap{
          display:flex!important;
          overflow-x:auto;
          gap:12px;
          padding-bottom:12px;
          scrollbar-width:thin;
          -webkit-overflow-scrolling:touch
        }
        .kanban-col{min-width:210px;flex-shrink:0}
        .field-row{grid-template-columns:1fr!important}
        .budget-layout{flex-direction:column!important}
        .budget-sidebar-panel{width:100%!important}
        .proj-layout{flex-direction:column!important}
        .proj-sidebar{width:100%!important}
        .search-wrap input{width:130px!important}
        .topbar-title{font-size:14px!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        /* Contact table: show only Name + Actions columns */
        .col-header{grid-template-columns:1fr 80px!important}
        .col-header>*:nth-child(2),.col-header>*:nth-child(3),.col-header>*:nth-child(4){display:none!important}
        .contact-row{grid-template-columns:1fr 80px!important}
        .contact-row>*:nth-child(2),.contact-row>*:nth-child(3),.contact-row>*:nth-child(4){display:none!important}
      }

      /* ── Responsive: ≤480px (small mobile) ── */
      @media(max-width:480px){
        .stats-row{grid-template-columns:1fr!important}
        .content{padding:12px!important}
        .topbar{padding:0 10px!important;gap:4px}
        .search-wrap{display:none}
        #topbar-actions{gap:4px}
        .topbar-title{font-size:13px!important}
        .panel-header{padding:10px 14px!important;gap:4px}
        .filter-pill{font-size:12px;padding:4px 8px}
        .kanban-col{min-width:185px}
      }

      /* ── Dashboard redesign ── */
      .db-section-head{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;user-select:none}
      .db-section-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .db-section-count{font-size:11px;font-weight:600;color:var(--text-secondary);background:var(--bg-tertiary);border-radius:3px;padding:1px 7px}
      .db-proj-list{display:flex;flex-direction:column;gap:0;border:1px solid var(--border-light);border-radius:var(--radius-lg);overflow:hidden;background:var(--bg-primary);box-shadow:0 1px 3px rgba(9,30,66,0.06)}
      .db-proj-row{border-bottom:1px solid var(--border-light)}.db-proj-row:last-child{border-bottom:none}
      .db-proj-header{display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;user-select:none;transition:background 0.12s;min-height:44px}
      .db-proj-header:hover{background:var(--bg-secondary)}
      .db-chevron{font-size:9px;color:var(--text-tertiary);transition:transform 0.18s;flex-shrink:0;line-height:1;display:inline-block}
      .db-chevron--open{transform:rotate(90deg)}
      .db-status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
      .db-proj-name-label{font-size:13px;font-weight:500;color:var(--text-primary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .db-proj-client-label{font-size:12px;color:var(--text-secondary);white-space:nowrap;flex-shrink:0}
      .db-badge{font-size:10px;color:var(--text-tertiary);white-space:nowrap;flex-shrink:0}
      .db-due-pill{font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0;background:var(--bg-tertiary);color:var(--text-secondary)}
      .db-due-pill--today{background:#f59e0b22;color:#f59e0b}
      .db-due-pill--overdue{background:#ef444420;color:#ef4444}
      .db-status-pill{font-size:10px;font-weight:500;padding:2px 7px;border-radius:3px;border:1px solid;white-space:nowrap;flex-shrink:0;letter-spacing:0.2px}
      .db-pin-btn{background:none;border:1px solid transparent;border-radius:var(--radius-sm);padding:3px 6px;font-size:13px;color:var(--text-tertiary);cursor:pointer;flex-shrink:0;line-height:1;transition:color 0.12s,border-color 0.12s,background 0.12s}
      .db-pin-btn:hover{color:var(--text-secondary);border-color:var(--border-med);background:var(--bg-secondary)}
      .db-pin-btn--on{color:var(--accent)!important;border-color:var(--accent)!important;background:var(--accent-subtle)!important}
      .db-proj-body{border-top:1px solid var(--border-light);background:var(--bg-secondary)}
      .db-thread{display:flex;flex-direction:column;gap:0;padding:4px 0}
      .db-no-comments{padding:16px 20px;font-size:12px;color:var(--text-tertiary);font-style:italic}
      .db-comment{display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border-light);transition:background 0.1s}
      .db-comment:last-child{border-bottom:none}
      .db-comment--resolved{opacity:0.55}
      .db-avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;color:#fff;letter-spacing:0.3px}
      .db-avatar--sm{width:22px;height:22px;font-size:9px}
      .db-comment-body{flex:1;min-width:0}
      .db-comment-meta{display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap}
      .db-comment-author{font-size:12px;font-weight:600;color:var(--text-primary)}
      .db-comment-time{font-size:11px;color:var(--text-tertiary)}
      .db-resolve-label{display:inline-flex;align-items:center;gap:3px;cursor:pointer;margin-left:auto;flex-shrink:0}
      .db-resolve-label input[type=checkbox]{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
      .db-resolve-icon{width:20px;height:20px;border:1.5px solid var(--border-med);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:transparent;transition:background 0.15s,border-color 0.15s,color 0.15s;flex-shrink:0}
      .db-resolve-icon--done{background:#6ec96e;border-color:#6ec96e;color:#fff}
      .db-resolve-label:hover .db-resolve-icon:not(.db-resolve-icon--done){border-color:var(--accent);color:var(--text-tertiary)}
      .db-comment-text{font-size:13px;color:var(--text-primary);line-height:1.55;word-break:break-word}
      .db-comment-text--resolved{color:var(--text-tertiary)}
      .db-action-link{background:none;border:none;color:var(--text-tertiary);font-size:11px;cursor:pointer;padding:3px 0;font-family:var(--font);transition:color 0.1s;margin-top:4px;display:inline-block}
      .db-action-link:hover{color:var(--accent)}
      .db-replies{display:flex;flex-direction:column;gap:0;margin-top:8px;padding-left:2px;border-left:2px solid var(--border-light)}
      .db-reply{display:flex;gap:8px;padding:7px 0 7px 10px;border-bottom:1px solid var(--border-light)}.db-reply:last-child{border-bottom:none}
      .db-reply-form{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:8px;background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-md)}
      .db-reply-input{width:100%;font-size:12px;padding:6px 9px;border:1px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:none;transition:border 0.12s}
      .db-reply-input:focus{border-color:var(--accent)}
      .db-add-comment{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--border-light);background:var(--bg-primary)}
      .db-comment-input{flex:1;font-size:12px;padding:7px 10px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;resize:none;transition:border 0.12s,background 0.12s}
      .db-comment-input:focus{border-color:var(--accent);background:var(--bg-primary)}
      .db-enq-list{display:flex;flex-direction:column;gap:0;border:1px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden;background:var(--bg-primary)}
      .db-enq-row{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border-light);cursor:pointer;transition:background 0.1s;flex-wrap:wrap}
      .db-enq-row:last-child{border-bottom:none}.db-enq-row:hover{background:var(--bg-secondary)}
      .db-enq-brief{font-size:11px;color:var(--text-tertiary);flex:1;min-width:100%;margin-top:2px}
      .stat-card--sm{padding:11px 14px}
      .stat-value--sm{font-size:18px;font-weight:600;letter-spacing:-0.3px}

      /* ── Sidebar notes ── */
      .sidebar-notes{flex:1;display:flex;flex-direction:column;min-height:0;border-top:1px solid rgba(255,255,255,0.08);margin-top:8px}
      .sidebar-notes-header{display:flex;align-items:center;padding:10px 16px 6px;flex-shrink:0}
      .sidebar-notes-title{font-size:11px;color:#596773;text-transform:uppercase;letter-spacing:0.8px;flex:1}
      .sidebar-notes-new-btn{font-size:11px;color:#B6C2CF;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 8px;cursor:pointer;font-family:var(--font);transition:background 0.12s,color 0.12s}
      .sidebar-notes-new-btn:hover{background:rgba(255,255,255,0.12);color:#fff}
      .notes-list{flex:1;min-height:0;overflow-y:auto;padding:6px 8px 8px;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.16) transparent}
      .notes-list::-webkit-scrollbar{width:8px}
      .notes-list::-webkit-scrollbar-track{background:transparent}
      .notes-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:4px;border:2px solid transparent;background-clip:padding-box}
      .notes-list::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.24);border:2px solid transparent;background-clip:padding-box}
      .notes-empty{padding:24px 8px;text-align:center;color:#596773;font-size:12px;line-height:1.7}
      .notes-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:var(--radius-md);overflow:hidden;flex-shrink:0;transition:box-shadow 0.15s,border-color 0.15s,background 0.12s}
      .notes-card:hover{background:rgba(255,255,255,0.06)}
      .notes-card:focus-within{border-color:rgba(255,255,255,0.18);box-shadow:0 2px 8px rgba(0,0,0,0.2)}
      .notes-card-header{display:flex;align-items:center;gap:4px;cursor:pointer;padding-right:6px}
      .notes-card-toggle{display:flex;align-items:center;justify-content:center;width:22px;height:22px;background:transparent;border:none;color:#596773;cursor:pointer;border-radius:4px;flex-shrink:0;padding:0;transition:color 0.12s,background 0.12s}
      .notes-card-toggle:hover{color:#B6C2CF;background:rgba(255,255,255,0.06)}
      .notes-card-toggle svg{transition:transform 0.18s ease}
      .notes-card.open .notes-card-toggle svg{transform:rotate(180deg)}
      .notes-card-body{display:none}
      .notes-card.open .notes-card-body{display:block;border-top:1px solid rgba(255,255,255,0.06)}
      .notes-title-input{flex:1;min-width:0;width:100%;padding:8px 4px 8px 10px;font-size:12px;font-weight:600;color:#C7D1DB;background:transparent;border:none;outline:none;font-family:var(--font);text-overflow:ellipsis;cursor:text}
      .notes-title-input::placeholder{color:#596773;font-weight:400}
      .notes-body-input{width:100%;padding:8px 10px 8px;font-size:12px;color:#B6C2CF;background:transparent;border:none;outline:none;resize:none;font-family:var(--font);line-height:1.5;min-height:52px;overflow:hidden}
      .notes-body-input::placeholder{color:#596773}
      .notes-card-meta{padding:4px 10px 2px;flex-wrap:wrap;gap:6px}
      .notes-due-input{font-size:11px;padding:2px 6px;border:1px solid rgba(255,255,255,0.1)!important;border-radius:4px;background:transparent;color:#596773!important;font-family:var(--font);outline:none}
      .notes-card-footer{display:flex;align-items:center;justify-content:space-between;padding:5px 10px 7px;border-top:1px solid rgba(255,255,255,0.06)}
      .notes-timestamp{font-size:11px;color:#596773}
      .notes-delete-btn{background:none;border:none;font-size:11px;color:#596773;cursor:pointer;padding:2px 6px;border-radius:var(--radius-sm);font-family:var(--font);transition:background 0.1s,color 0.1s}
      .notes-delete-btn:hover{background:rgba(239,68,68,0.15);color:#ef4444}
    `
    document.head.appendChild(style)
  }

  iconHamburger() { return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4.5h14M2 9h14M2 13.5h14"/></svg>` }
  iconContacts() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="5" r="2.5"/><path d="M1 14c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5"/><path d="M11 3.5a2 2 0 0 1 0 4M15 14c0-2.4-1.5-3.8-4-4"/></svg>` }
  iconProjects() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 6h6M5 9h4"/></svg>` }
  iconBudgets()  { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3h12v2H2zM2 7h9M2 11h7"/><circle cx="13" cy="11" r="2.2"/><path d="M13 9.8v1l.7.7"/></svg>` }
  iconPipeline() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="4" width="4" height="9" rx="1"/><rect x="6" y="6" width="4" height="7" rx="1"/><rect x="11" y="8" width="4" height="5" rx="1"/></svg>` }
  iconSettings() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M11.4 4.6l-1.4 1.4M4.6 11.4l-1.4 1.4"/></svg>` }
  iconSignOut()  { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M10 11l4-4-4-4M14 8H6"/></svg>` }
  iconTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    return isDark
      ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M11.4 4.6l-1.4 1.4M4.6 11.4l-1.4 1.4"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M13.5 10A5.5 5.5 0 0 1 6 2.5a5.5 5.5 0 1 0 7.5 7.5z"/></svg>`
  }
}
