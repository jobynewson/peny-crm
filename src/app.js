import { getCurrentUserId } from './auth/clerk.js'
import { getContacts, getProjects, getBudgets, upsertSettings } from './db/client.js'
import { ContactsView } from './views/contacts.js'
import { ProjectsView } from './views/projects.js'
import { BudgetsView, budTotal } from './views/budgets.js'
import { CallSheetsView } from './views/callsheets.js'

export class App {
  constructor({ userId, clerkUserId, user, appUser, permissions, contacts, projects, budgets, settings, allUsers, onSignOut }) {
    this.userId      = userId
    this.clerkUserId = clerkUserId
    this.user        = user
    this.appUser     = appUser
    this.permissions = permissions
    this.contacts = contacts ?? []
    this.projects = projects ?? []
    this.budgets  = budgets  ?? []
    this.settings = settings ?? {}
    this.allUsers = allUsers ?? []
    this.onSignOut = onSignOut
    this.currentView = 'dashboard'
    this.contactsView    = new ContactsView(this)
    this.projectsView    = new ProjectsView(this)
    this.budgetsView     = new BudgetsView(this)
    this.callSheetsView  = new CallSheetsView(this)
    window.app = this
  }

  mount(container) {
    this.container = container
    const saved = localStorage.getItem('peny-theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
    this.injectGlobalStyles()
    this.render()
    this._bindKeyboard()
    // Handle bookmarklet import — text passed via URL hash #import=...
    const hash = location.hash
    if (hash.startsWith('#import=')) {
      const importText = decodeURIComponent(hash.slice('#import='.length))
      history.replaceState({}, '', location.pathname)
      if (importText) {
        setTimeout(() => {
          this.switchView('projects')
          setTimeout(() => {
            const mc = document.getElementById('main-content')
            this.projectsView.openNewModal(null, null, mc)
            setTimeout(() => {
              const textEl = mc?.querySelector('#pf-ai-text')
              const panel  = mc?.querySelector('#pf-ai-panel')
              const toggle = mc?.querySelector('#pf-ai-toggle')
              if (textEl) textEl.value        = importText
              if (panel)  panel.style.display = 'block'
              if (toggle) toggle.textContent  = 'Hide'
              mc?.querySelector('#pf-ai-extract')?.click()
            }, 100)
          }, 200)
        }, 300)
      }
    }
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
        <div style="background:var(--bg-primary);border:0.5px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:${isAdmin?'620px':'440px'};max-height:85vh;display:flex;flex-direction:column;overflow:hidden" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:0.5px solid var(--border-light);flex-shrink:0">
            <div>
              <div style="font-size:14px;font-weight:600">Dev request</div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px">Suggest a feature or report an issue</div>
            </div>
            <button id="dev-req-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary);line-height:1;padding:4px">×</button>
          </div>

          <div style="padding:20px;display:flex;flex-direction:column;gap:10px;flex-shrink:0;border-bottom:0.5px solid var(--border-light)">
            <textarea id="dev-req-text" placeholder="Describe what you'd like added or changed…"
              style="width:100%;min-height:90px;padding:10px 12px;font-size:13px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.5"></textarea>
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
              <button id="dev-req-copy" style="font-size:11px;color:var(--text-tertiary);background:none;border:0.5px solid var(--border-light);border-radius:5px;padding:3px 8px;cursor:pointer;font-family:var(--font)">Copy all</button>
            </div>
            ${pending.map(r => `
              <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 20px;border-bottom:0.5px solid var(--border-light)" data-rid="${r.id}">
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
              <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 20px;border-bottom:0.5px solid var(--border-light);opacity:0.5" data-rid="${r.id}">
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
        <div style="background:var(--bg-primary);border:0.5px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:520px;overflow:hidden;cursor:default;box-shadow:0 20px 60px rgba(0,0,0,0.4)" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:0.5px solid var(--border-light)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            <input id="search-input" placeholder="Search contacts, projects, budgets…" value="${esc(query)}"
              style="flex:1;background:transparent;border:none;outline:none;font-size:15px;color:var(--text-primary);font-family:var(--font)" autofocus />
            <kbd style="font-size:11px;color:var(--text-tertiary);background:var(--bg-secondary);border:0.5px solid var(--border-light);border-radius:4px;padding:2px 6px">Esc</kbd>
          </div>
          <div id="search-results" style="max-height:360px;overflow-y:auto">
            ${q.length === 0 ? `<div style="padding:24px;text-align:center;font-size:13px;color:var(--text-tertiary)">Start typing to search across all records</div>`
            : results.length === 0 ? `<div style="padding:24px;text-align:center;font-size:13px;color:var(--text-tertiary)">No results for "${esc(query)}"</div>`
            : results.map((r,i) => `
              <div data-result="${i}" style="display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;border-bottom:0.5px solid var(--border-light);transition:background 0.1s"
                onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
                <span style="font-size:16px;flex-shrink:0">${typeIcon[r.type]}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.label)}</div>
                  ${r.sub ? `<div style="font-size:11px;color:var(--text-tertiary)">${esc(r.sub)}</div>` : ''}
                </div>
                <span style="font-size:10px;color:${typeColour[r.type]};background:${typeColour[r.type]}22;border-radius:4px;padding:2px 7px;flex-shrink:0;text-transform:capitalize">${r.type}</span>
              </div>`).join('')}
          </div>
          ${q.length > 0 && results.length > 0 ? `<div style="padding:8px 16px;font-size:11px;color:var(--text-tertiary);border-top:0.5px solid var(--border-light)">${results.length} result${results.length!==1?'s':''}</div>` : ''}
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
      <div class="sidebar">
        <div class="logo"><img src="/peny-logo.png" alt="Peny" /></div>
        <div class="nav-label">Main</div>
        ${[['dashboard','Dashboard',this.iconPipeline()],['contacts','Contacts',this.iconContacts()],['projects','Projects',this.iconProjects()],['budgets','Budgets',this.iconBudgets()]].map(([id,label,icon])=>`
          <div class="nav-item ${this.currentView===id?'active':''}" data-view="${id}">${icon} ${label}</div>`).join('')}
        <div class="nav-bottom">
          ${this.permissions.settings ? `<div class="nav-item" data-view="settings">${this.iconSettings()} Settings</div>` : ''}
          <div class="nav-item" id="dev-request-btn" style="color:var(--text-tertiary);font-size:12px">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5"/><path d="M8 5v4M8 11v.5"/></svg>
            Dev request
          </div>
          <div class="nav-item" id="sign-out-btn">${this.iconSignOut()} Sign out</div>
          <div style="padding:8px 12px">
            <button class="theme-toggle" id="theme-toggle-btn" title="Toggle dark mode">
              ${this.iconTheme()}
            </button>
          </div>
        </div>
      </div>
      <div class="main">
        <div class="topbar">
          <div class="topbar-title" id="view-title">${this.viewTitle()}</div>
          <div id="topbar-actions" style="display:flex;gap:8px;align-items:center">${this.topbarSearch()}${this.topbarButton()}
            <button id="shortcut-hint" title="Keyboard shortcuts" style="width:24px;height:24px;border-radius:50%;border:0.5px solid var(--border-med);background:transparent;color:var(--text-tertiary);font-size:12px;cursor:pointer;font-family:var(--font);display:flex;align-items:center;justify-content:center;flex-shrink:0">?</button>
          </div>
        </div>
        <div class="content" id="main-content"></div>
      </div>
      ${showDetail ? `<div class="detail-panel" id="detail-panel"><div class="detail-empty">Select a contact<br>to view details</div></div>` : ''}
    `
    this.bindNav()
    this.renderCurrentView()
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

  bindNav() {
    this.container.querySelectorAll('.nav-item[data-view]').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.view))
    })
    this.container.querySelector('#sign-out-btn')?.addEventListener('click', () => this.onSignOut())
    this.container.querySelector('#dev-request-btn')?.addEventListener('click', () => this._openDevRequest())

    // Dark mode toggle
    const toggleBtn = this.container.querySelector('#theme-toggle-btn')
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
        const next = isDark ? 'light' : 'dark'
        document.documentElement.setAttribute('data-theme', next)
        localStorage.setItem('peny-theme', next)
        toggleBtn.innerHTML = this.iconTheme()
      })
    }

    this.bindTopbarBtn()
    const search = this.container.querySelector('#contact-search')
    if (search) {
      search.value = this.contactsView.search
      search.addEventListener('input', e => { this.contactsView.search = e.target.value; this.contactsView.refreshList() })
    }

    // Keyboard shortcut hint
    this.container.querySelector('#shortcut-hint')?.addEventListener('click', () => {
      let overlay = document.getElementById('shortcut-overlay')
      if (overlay) { overlay.remove(); return }
      overlay = document.createElement('div')
      overlay.id = 'shortcut-overlay'
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer'
      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:0.5px solid var(--border-med);border-radius:var(--radius-lg);padding:28px 32px;width:320px;cursor:default" onclick="event.stopPropagation()">
          <div style="font-size:13px;font-weight:600;margin-bottom:16px">Keyboard shortcuts</div>
          ${[
            ['⌘K', 'Search everything'],
            ['N', 'New project / budget / contact'],
            ['Esc', 'Close modal / exit edit / go back'],
            ['⌘S', 'Save & close current editor'],
          ].map(([key,desc]) => `
            <div style="display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:0.5px solid var(--border-light)">
              <kbd style="font-size:11px;font-family:monospace;background:var(--bg-secondary);border:0.5px solid var(--border-med);border-radius:5px;padding:3px 8px;color:var(--text-secondary);white-space:nowrap">${key}</kbd>
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
    const stages = ['Enquiry','Pre-production','In Production','Post','Delivered']
    const retainers = this.projects.filter(p => p.is_retainer)
    const regularProjects = this.projects.filter(p => !p.is_retainer)
    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')

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

    mc.innerHTML = `
      <div class="stats-row" style="margin-bottom:20px">
        <div class="stat-card"><div class="stat-label">Pipeline</div><div class="stat-value">${gbp(pipelineValue + retainerPipelineVal)}</div><div class="stat-sub">${regularProjects.length} project${regularProjects.length!==1?'s':''}${retainerPipelineVal>0?' + '+retainers.filter(p=>p.status==='Enquiry').length+' retainer enquir'+(retainers.filter(p=>p.status==='Enquiry').length===1?'y':'ies'):''}</div></div>
        <div class="stat-card"><div class="stat-label">Awaiting invoice</div><div class="stat-value" style="color:#6ec96e">${gbp(awaitingVal)}</div><div class="stat-sub">${awaitingInvoice.length} budget${awaitingInvoice.length!==1?'s':''}</div></div>
        <div class="stat-card"><div class="stat-label">Invoiced this month</div><div class="stat-value" style="color:#4a90d9">${gbp(invoicedMonthVal)}</div><div class="stat-sub">${invoicedThisMonth.length} budget${invoicedThisMonth.length!==1?'s':''}</div></div>
        <div class="stat-card"><div class="stat-label">Invoiced this quarter</div><div class="stat-value" style="color:#4a90d9">${gbp(invoicedQtrVal)}</div><div class="stat-sub">${invoicedThisQtr.length} budget${invoicedThisQtr.length!==1?'s':''}</div></div>
        <div class="stat-card"><div class="stat-label">Invoiced this FY</div><div class="stat-value" style="color:#4a90d9">${gbp(invoicedFYVal)}</div><div class="stat-sub">${fyLabel}</div></div>
        <div class="stat-card"><div class="stat-label">Retainer MRR</div><div class="stat-value" style="color:#a78bfa">${gbp(retainerMRR)}</div><div class="stat-sub">per month</div></div>
      </div>
      ${retainers.length ? `
      <div style="margin-bottom:24px">
        <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a78bfa;flex-shrink:0"></span>
          Retainers <span style="font-weight:500;color:var(--text-secondary)">${retainers.length}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px" id="retainer-cards">
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

      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px">${stages.map(st => {
        const col = regularProjects.filter(p => p.status === st)
        return `<div>
          <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px">${st} <span style="font-weight:500;color:var(--text-secondary)">${col.length}</span></div>
          ${col.map(p => {
          const cl = this.contacts.find(c => c.id === p.client_id)
          const pipelineBudgets = (p.budget_ids || [])
            .map(id => this.budgets.find(b => b.id === id))
            .filter(b => b && b.signed_off)
          const combinedTotal = pipelineBudgets.reduce((sum, b) => {
            const tr = parseFloat(b.travel_rate)||50
            const n = b.sections ? b.sections.filter(s=>s.enabled).reduce((t,s)=>{
              return t + (s.lines||[]).reduce((lt,l)=>{
                const useDays=!!(l.useDays??(l.travelDays!==undefined))
                const d=parseFloat(l.days)||0,q=isNaN(parseFloat(l.qty))?1:parseFloat(l.qty),r=parseFloat(l.rate)||0,td=parseFloat(l.travelDays)||0
                const disc=Math.min(Math.max(parseFloat(l.discount)||0,0),100)
                const gross=useDays?d*q*r+td*(tr/100)*r:q*r
                return lt+gross*(1-disc/100)
              },0)
            },0) : 0
            const afterFee = n + n*((parseFloat(b.markup)||0)/100)
            const afterCustom = afterFee + afterFee*((parseFloat(b.custom_pct)||0)/100)
            return sum + afterCustom + (b.vat ? afterCustom*0.2 : 0)
          }, 0)
          const delivs = (p.deliverables||[]).filter(d=>d.text)
          // Compute allocated hours from linked budgets
          const allocHours = (p.budget_ids||[]).reduce((sum, bid) => {
            const b = this.budgets.find(x => x.id === bid)
            if (!b) return sum
            return sum + (b.sections||[]).filter(s=>s.enabled).reduce((ss, s) =>
              ss + (s.lines||[]).filter(l=>l.track_time&&l.item).reduce((ls, l) => {
                const d = parseFloat(l.days)||0, q = isNaN(parseFloat(l.qty))?1:parseFloat(l.qty)
                return ls + (l.useDays ? Math.round(d*q*8) : Math.round(q*8))
              }, 0), 0)
          }, 0)
          return `<div class="kanban-card" data-open-pid="${p.id}" style="cursor:pointer">
            <div class="kanban-card-title">${p.name}</div>
            <div class="kanban-card-client">${cl ? cl.first_name+' '+cl.last_name : 'No client'}</div>
            ${allocHours > 0 ? `<div style="margin-top:6px;display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:0%;background:#4a90d9;border-radius:2px" data-hours-bar="${p.id}"></div>
              </div>
              <span style="font-size:10px;color:var(--text-tertiary);white-space:nowrap" data-hours-label="${p.id}">— / ${allocHours}h</span>
            </div>` : ''}
            ${delivs.length ? `
              <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
                ${delivs.map((d,di) => `
                  <label style="display:flex;align-items:baseline;gap:6px;font-size:11px;cursor:pointer;color:${d.done?'var(--text-tertiary)':'var(--text-secondary)'}">
                    <input type="checkbox" ${d.done?'checked':''} data-deliv-pid="${p.id}" data-deliv-idx="${di}" style="cursor:pointer;flex-shrink:0;margin-top:1px" />
                    <span style="${d.done?'text-decoration:line-through':''}">${d.text}</span>
                  </label>`).join('')}
              </div>` : ''}
            ${pipelineBudgets.length ? `
              <div style="margin-top:8px;padding-top:8px;border-top:0.5px solid var(--border-light);display:flex;flex-direction:column;gap:3px">
                ${pipelineBudgets.map(b => {
                  const tr2=parseFloat(b.travel_rate)||50
                  const n2=b.sections?b.sections.filter(s=>s.enabled).reduce((t,s)=>t+(s.lines||[]).reduce((lt,l)=>{const useDays=!!(l.useDays??(l.travelDays!==undefined));const d=parseFloat(l.days)||0,q=isNaN(parseFloat(l.qty))?1:parseFloat(l.qty),r=parseFloat(l.rate)||0,td=parseFloat(l.travelDays)||0,disc=Math.min(Math.max(parseFloat(l.discount)||0,0),100),gross=useDays?d*q*r+td*(tr2/100)*r:q*r;return lt+gross*(1-disc/100)},0),0):0
                  const ae=n2+n2*((parseFloat(b.markup)||0)/100),ac=ae+ae*((parseFloat(b.custom_pct)||0)/100),t=ac+(b.vat?ac*0.2:0)
                  return `<div style="display:flex;justify-content:space-between;font-size:11px">
                    <span style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">${b.name}</span>
                    <span style="color:var(--text-primary);font-weight:500;font-variant-numeric:tabular-nums">£${Math.round(t).toLocaleString('en-GB')}</span>
                  </div>`
                }).join('')}
                ${pipelineBudgets.length > 1 ? `
                  <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:3px;padding-top:5px;border-top:0.5px solid var(--border-light)">
                    <span style="color:var(--text-tertiary)">Combined</span>
                    <span style="font-weight:600;font-variant-numeric:tabular-nums">£${Math.round(combinedTotal).toLocaleString('en-GB')}</span>
                  </div>` : ''}
              </div>` : ''}
          </div>`
        }).join('')}
        </div>`
      }).join('')}</div>`

    // Open project on title click
    mc.querySelectorAll('[data-open-pid]').forEach(el => {
      el.addEventListener('click', () => this.openProject(el.dataset.openPid))
    })
    // Deliverable tick without opening the project
    mc.querySelectorAll('[data-deliv-pid]').forEach(el => {
      el.addEventListener('click', e => e.stopPropagation())
      el.addEventListener('change', async () => {
        const p = this.projects.find(x => x.id === el.dataset.delivPid)
        if (!p) return
        const idx = +el.dataset.delivIdx
        p.deliverables[idx].done = el.checked
        const label = el.closest('label')
        if (label) {
          label.style.color = el.checked ? 'var(--text-tertiary)' : 'var(--text-secondary)'
          const span = label.querySelector('span')
          if (span) span.style.textDecoration = el.checked ? 'line-through' : ''
        }
        try {
          const { updateProject } = await import('./db/client.js')
          await updateProject(this.userId, p.id, { deliverables: p.deliverables })
          this.toast(el.checked ? '✓ Deliverable marked done' : 'Deliverable unmarked')
        } catch(e) { console.error('Deliverable save failed:', e) }
      })
    })

    // Load hours bars asynchronously
    const projectsWithHours = regularProjects.filter(p =>
      mc.querySelector(`[data-hours-bar="${p.id}"]`)
    )
    if (projectsWithHours.length > 0) {
      const { getTimeEntries } = await import('./db/client.js')
      for (const p of projectsWithHours) {
        try {
          const entries = await getTimeEntries(p.id)
          const logged = entries.reduce((s, e) => s + parseFloat(e.hours), 0)
          const allocHours = parseInt(mc.querySelector(`[data-hours-label="${p.id}"]`)?.textContent?.split('/')[1]) || 0
          const bar = mc.querySelector(`[data-hours-bar="${p.id}"]`)
          const label = mc.querySelector(`[data-hours-label="${p.id}"]`)
          if (bar && allocHours > 0) {
            const pct = Math.min(100, Math.round(logged / allocHours * 100))
            bar.style.width = pct + '%'
            bar.style.background = pct >= 100 ? '#6ec96e' : '#4a90d9'
          }
          if (label) label.textContent = `${logged.toFixed(1)} / ${allocHours}h`
        } catch(e) { /* silent */ }
      }
    }

    // Load retainer current-period hours
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
            ? allEntries.filter(e => {
                const d = new Date(e.entry_date)
                return d >= periodStart && d < periodEnd
              })
            : allEntries
          const logged = entries.reduce((s, e) => s + parseFloat(e.hours), 0)
          const hours = allocH
          const pct = Math.min(100, Math.round(logged / hours * 100))
          const alertPct = parseFloat(p.retainer_alert) || 80

          const alertEl = mc.querySelector(`[data-ret-alert="${p.id}"]`)
          const alertPctVal = parseFloat(p.retainer_alert) || 80

          // Per-item bars
          const items = p.retainer_items || []
          if (items.length) {
            const periodMult3 = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}
            items.forEach((item, ii) => {
              const mult = periodMult3[item.period||'month'] || 1
              const allocH = item.unit==='hours' ? Math.round((parseFloat(item.qty)||0)*mult) : Math.round((parseFloat(item.qty)||0)*8*mult)
              if (!allocH) return
              const itemLogged = entries.filter(e => e.line_label === item.label).reduce((s,e) => s + parseFloat(e.hours), 0)
              const iPct = Math.min(100, Math.round(itemLogged / allocH * 100))
              const iColour = iPct >= 100 ? '#ef4444' : iPct >= alertPctVal ? '#f59e0b' : '#a78bfa'
              const bar = mc.querySelector(`[data-ret-item-bar="${p.id}-${ii}"]`)
              const lbl = mc.querySelector(`[data-ret-item-label="${p.id}-${ii}"]`)
              if (bar) { bar.style.width = iPct + '%'; bar.style.background = iColour }
              if (lbl) { lbl.textContent = `${itemLogged.toFixed(1)} / ${allocH}h`; lbl.style.color = iPct >= alertPctVal ? iColour : '' }
            })
            // Overall alert
            const colour = pct >= 100 ? '#ef4444' : pct >= alertPctVal ? '#f59e0b' : '#a78bfa'
            if (alertEl && pct >= alertPctVal && pct < 100) {
              alertEl.style.display = 'block'; alertEl.style.color = colour
              alertEl.textContent = `⚠ ${pct}% used overall`
            }
            if (alertEl && pct >= 100) {
              alertEl.style.display = 'block'; alertEl.style.color = colour
              alertEl.textContent = `⚠ Over allocation by ${(logged - hours).toFixed(1)}h`
            }
          } else {
            // Fallback: single bar
            const bar = mc.querySelector(`[data-ret-bar="${p.id}"]`)
            const label = mc.querySelector(`[data-ret-label="${p.id}"]`)
            const colour = pct >= 100 ? '#ef4444' : pct >= alertPctVal ? '#f59e0b' : '#a78bfa'
            if (bar) { bar.style.width = pct + '%'; bar.style.background = colour }
            if (label) { label.textContent = `${logged.toFixed(1)} / ${hours}h`; label.style.color = pct >= alertPctVal ? colour : '' }
            if (alertEl && pct >= alertPctVal && pct < 100) {
              alertEl.style.display = 'block'; alertEl.style.color = colour
              alertEl.textContent = `⚠ ${pct}% used — ${(hours - logged).toFixed(1)}h remaining`
            }
            if (alertEl && pct >= 100) {
              alertEl.style.display = 'block'; alertEl.style.color = colour
              alertEl.textContent = `⚠ Over allocation by ${(logged - hours).toFixed(1)}h`
            }
          }
        } catch(e) { /* silent */ }
      }
    }
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
            <div class="field"><div class="field-label">Company name</div><input type="text" id="s-name" value="${s.company_name??''}" placeholder="Peny" /></div>
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
                <textarea id="s-hs" style="width:100%;min-height:100px;padding:8px 11px;font-size:12px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.6" placeholder="e.g. No alcohol or non-prescription drugs during the working day. Only qualified personnel to handle hazardous equipment…">${s.hs_boilerplate??''}</textarea>
              </div>
            </div>
            <div><button class="btn-primary" id="settings-save-btn">Save settings</button></div>
          </div>
        </div>

        ${isAdmin ? `
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Users</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">Invite-only. New users receive an email invitation from Clerk and are assigned Member role by default.</div>
            <div style="display:flex;gap:8px">
              <input type="email" id="invite-email" placeholder="colleague@email.com" style="flex:1;padding:8px 11px;font-size:13px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
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
            <div style="border:0.5px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden" data-tsi="${si}">
              <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--bg-secondary);border-bottom:0.5px solid var(--border-light)">
                <input type="text" value="${esc(s.code)}" data-tpl-code="${si}"
                  style="width:48px;font-size:12px;font-weight:600;padding:4px 6px;border:0.5px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
                <input type="text" value="${esc(s.label)}" data-tpl-label="${si}"
                  style="flex:1;font-size:13px;padding:4px 8px;border:0.5px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
                <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-tertiary);cursor:pointer;white-space:nowrap">
                  <input type="checkbox" ${s.crew?'checked':''} data-tpl-crew="${si}" style="cursor:pointer" /> Crew section
                </label>
                <button class="row-btn" data-tpl-del-sec="${si}" style="color:#b03020;flex-shrink:0">× Remove section</button>
              </div>
              <table style="width:100%;border-collapse:collapse">
                <thead>
                  <tr style="background:var(--bg-secondary)">
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;padding:6px 8px;text-align:left;font-weight:400;border-bottom:0.5px solid var(--border-light)">Item name</th>
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;padding:6px 8px;text-align:right;font-weight:400;border-bottom:0.5px solid var(--border-light)">Default rate £</th>
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;padding:6px 4px;text-align:center;font-weight:400;border-bottom:0.5px solid var(--border-light)" title="Daily rate">Daily</th>
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;padding:6px 4px;text-align:center;font-weight:400;border-bottom:0.5px solid var(--border-light)" title="Track time">⏱</th>
                    <th style="border-bottom:0.5px solid var(--border-light);width:28px"></th>
                  </tr>
                </thead>
                <tbody>
                  ${(s.lines||[]).map((l, li) => `
                    <tr style="border-bottom:0.5px solid var(--border-light)">
                      <td style="padding:5px 8px">
                        <input type="text" value="${esc(l.item)}" data-tpl-item="${si},${li}"
                          style="width:100%;font-size:13px;padding:5px 7px;border:0.5px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
                      </td>
                      <td style="padding:5px 8px">
                        <input type="number" value="${l.rate??''}" placeholder="0" min="0"
                          data-tpl-rate="${si},${li}"
                          style="width:80px;font-size:13px;padding:5px 7px;border:0.5px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;text-align:right;display:block;margin-left:auto" />
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
                style="display:flex;align-items:center;gap:6px;padding:8px 12px;font-size:12px;color:var(--text-tertiary);cursor:pointer;border:none;border-top:0.5px solid var(--border-light);background:transparent;width:100%;text-align:left;font-family:var(--font);transition:background 0.1s,color 0.1s"
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
        return `<div style="border:0.5px solid var(--border-light);border-radius:var(--radius-md);padding:14px;margin-bottom:10px" data-uid="${u.id}">
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
              style="flex:1;font-size:12px;padding:4px 8px;border:0.5px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
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
      company_name: mc.querySelector('#s-name')?.value.trim()||'Peny',
      email:        mc.querySelector('#s-email')?.value.trim()||null,
      phone:        mc.querySelector('#s-phone')?.value.trim()||null,
      website:      mc.querySelector('#s-website')?.value.trim()||null,
      address:      mc.querySelector('#s-address')?.value.trim()||null,
      vat_number:          mc.querySelector('#s-vat')?.value.trim()||null,
      prepared_by:         mc.querySelector('#s-preparedby')?.value.trim()||null,
      hs_boilerplate:      mc.querySelector('#s-hs')?.value.trim()||null,
      financial_year_start: parseInt(mc.querySelector('#s-fy-start')?.value||'4'),
      budget_template:     this.settings?.budget_template ?? null,
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
      .sidebar{width:220px;flex-shrink:0;background:var(--bg-primary);border-right:0.5px solid var(--border-light);display:flex;flex-direction:column}
      .logo{padding:16px 20px 18px;border-bottom:0.5px solid var(--border-light);display:flex;align-items:center}
      .logo img{height:36px;width:auto;display:block}
      .nav-label{font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.8px;padding:16px 20px 6px}
      .nav-item{display:flex;align-items:center;gap:10px;padding:9px 20px;font-size:13px;color:var(--text-secondary);cursor:pointer;transition:background 0.12s,color 0.12s;user-select:none}
      .nav-item:hover{background:var(--bg-secondary);color:var(--text-primary)}
      .nav-item.active{background:var(--bg-secondary);color:var(--text-primary);font-weight:500}
      .nav-item svg{opacity:0.55;flex-shrink:0}.nav-item.active svg{opacity:1}
      .nav-bottom{margin-top:auto;border-top:0.5px solid var(--border-light);padding:8px 0}
      .main{flex:1;display:flex;flex-direction:column;min-width:0}
      .topbar{background:var(--bg-primary);border-bottom:0.5px solid var(--border-light);padding:13px 24px;display:flex;align-items:center;gap:12px;flex-shrink:0}
      .topbar-title{font-size:15px;font-weight:500;flex:1}
      .search-wrap{position:relative}
      .search-wrap input{padding:7px 12px 7px 34px;font-size:13px;border-radius:var(--radius-md);width:220px;background:var(--bg-secondary);border:0.5px solid var(--border-light);color:var(--text-primary);font-family:var(--font);outline:none;transition:border 0.15s}
      .search-wrap input:focus{border-color:var(--border-strong)}
      .search-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--text-tertiary);pointer-events:none}
      .content{flex:1;overflow-y:auto;padding:24px}
      .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
      .stat-card{background:var(--bg-secondary);border-radius:var(--radius-md);padding:14px 16px}
      .stat-label{font-size:11px;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.4px}
      .stat-value{font-size:24px;font-weight:500;letter-spacing:-0.5px}
      .stat-sub{font-size:11px;color:var(--text-tertiary);margin-top:3px}
      .panel{background:var(--bg-primary);border:0.5px solid var(--border-light);border-radius:var(--radius-lg);overflow:hidden}
      .panel-header{display:flex;align-items:center;padding:13px 20px;border-bottom:0.5px solid var(--border-light);gap:8px;flex-wrap:wrap}
      .panel-title{font-size:13px;font-weight:500;flex:1}
      .filter-pill{font-size:12px;padding:4px 11px;border-radius:20px;border:0.5px solid var(--border-light);color:var(--text-secondary);cursor:pointer;background:transparent;font-family:var(--font);transition:background 0.12s,color 0.12s}
      .filter-pill:hover{background:var(--bg-secondary)}.filter-pill.active{background:var(--text-primary);color:var(--bg-primary);border-color:var(--text-primary)}
      .col-header{display:grid;padding:9px 20px;border-bottom:0.5px solid var(--border-light);font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px}
      .contact-row{display:grid;align-items:center;padding:12px 20px;border-bottom:0.5px solid var(--border-light);cursor:pointer;transition:background 0.1s}
      .contact-row:last-child{border-bottom:none}.contact-row:hover{background:var(--bg-secondary)}.contact-row.selected{background:var(--bg-secondary)}
      .contact-name{display:flex;align-items:center;gap:10px}
      .avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}
      .name-main{font-size:13px;font-weight:500}.name-sub{font-size:12px;color:var(--text-secondary);margin-top:1px}
      .tag{display:inline-flex;font-size:11px;padding:3px 8px;border-radius:20px;font-weight:500}
      .status-cell{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)}
      .dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
      .dot-active{background:#4a9c2a}.dot-warm{background:#d48c10}.dot-cold{background:#b0b0a8}
      .actions-cell{display:flex;justify-content:flex-end;gap:6px}
      .row-btn{font-size:11px;padding:4px 8px;border-radius:var(--radius-sm);border:0.5px solid var(--border-light);background:transparent;color:var(--text-secondary);cursor:pointer;font-family:var(--font);transition:background 0.1s,color 0.1s}
      .row-btn:hover{background:var(--bg-tertiary);color:var(--text-primary)}
      .empty-state{padding:48px 20px;text-align:center;color:var(--text-tertiary);font-size:13px}
      .detail-panel{width:300px;flex-shrink:0;background:var(--bg-primary);border-left:0.5px solid var(--border-light);display:flex;flex-direction:column;overflow-y:auto}
      .detail-empty{display:flex;align-items:center;justify-content:center;flex:1;font-size:13px;color:var(--text-tertiary);text-align:center;line-height:1.6}
      .detail-header{padding:20px;border-bottom:0.5px solid var(--border-light)}
      .detail-avatar{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;margin-bottom:12px}
      .detail-name{font-size:15px;font-weight:500}.detail-role{font-size:12px;color:var(--text-secondary);margin-top:3px}
      .detail-tags{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
      .detail-section{padding:16px 20px;border-bottom:0.5px solid var(--border-light)}.detail-section:last-child{border-bottom:none}
      .section-title{font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px}
      .info-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;gap:8px}
      .info-key{font-size:12px;color:var(--text-secondary);flex-shrink:0}.info-val{font-size:12px;color:var(--text-primary);text-align:right;word-break:break-all}
      .note-item{background:var(--bg-secondary);border-radius:var(--radius-md);padding:9px 11px;margin-bottom:8px}
      .note-text{font-size:12px;color:var(--text-primary);line-height:1.5}.note-date{font-size:11px;color:var(--text-tertiary);margin-top:5px}
      .project-chip{display:flex;justify-content:space-between;align-items:center;background:var(--bg-secondary);border-radius:var(--radius-md);padding:8px 11px;margin-bottom:6px;cursor:pointer;transition:background 0.1s}
      .project-chip:hover{background:var(--bg-tertiary)}.project-chip-name{font-size:12px;font-weight:500}.project-chip-badge{font-size:11px;color:var(--text-secondary)}
      .dashed-btn{width:100%;padding:8px;border:0.5px dashed var(--border-med);border-radius:var(--radius-md);background:transparent;color:var(--text-tertiary);font-size:12px;cursor:pointer;font-family:var(--font);transition:background 0.1s,color 0.1s;margin-top:6px}
      .dashed-btn:hover{background:var(--bg-secondary);color:var(--text-primary)}
      .modal-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:100;align-items:center;justify-content:center}
      .modal-backdrop.open{display:flex}
      .modal{background:var(--bg-primary);border-radius:var(--radius-lg);border:0.5px solid var(--border-med);width:460px;max-width:96vw;overflow:hidden;max-height:90vh;display:flex;flex-direction:column}
      .modal-header{padding:18px 20px 14px;border-bottom:0.5px solid var(--border-light);display:flex;align-items:center;flex-shrink:0}
      .modal-title{font-size:14px;font-weight:500;flex:1}.modal-close{background:none;border:none;font-size:18px;color:var(--text-tertiary);cursor:pointer;line-height:1;padding:2px 4px}
      .modal-body{padding:20px;display:flex;flex-direction:column;gap:14px;overflow-y:auto}
      .modal-footer{padding:14px 20px;border-top:0.5px solid var(--border-light);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0}
      .field-label{font-size:12px;color:var(--text-secondary);margin-bottom:5px}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .field input,.field select,.field textarea{width:100%;padding:8px 11px;font-size:13px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;transition:border 0.15s}
      .field input:focus,.field select:focus,.field textarea:focus{border-color:var(--border-strong)}.field textarea{resize:vertical;min-height:70px}
      .btn-cancel{background:var(--bg-secondary);color:var(--text-primary);border:0.5px solid var(--border-light);padding:8px 14px;border-radius:var(--radius-md);font-size:13px;cursor:pointer;font-family:var(--font)}
      .btn-cancel:hover{background:var(--bg-tertiary)}
      .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(8px);background:var(--text-primary);color:var(--bg-primary);padding:10px 18px;border-radius:var(--radius-md);font-size:13px;opacity:0;transition:opacity 0.2s,transform 0.2s;pointer-events:none;z-index:200;white-space:nowrap}
      .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
      .av-blue{background:#d4e8fa;color:#0d4a8a}.av-teal{background:#c2eada;color:#0a5038}.av-coral{background:#fad3c4;color:#6b2a16}.av-purple{background:#dddaf7;color:#3a2f9e}.av-amber{background:#fce2b0;color:#5a3206}.av-green{background:#d0e8b0;color:#2a5008}.av-pink{background:#f5d0df;color:#6e2040}
      .tag-brand{background:#daeeff;color:#0d4a8a}.tag-agency{background:#dddaf7;color:#3a2f9e}.tag-ngo{background:#d8efc4;color:#2a5008}.tag-sport{background:#fce2b0;color:#5a3206}.tag-corp{background:#ebebeb;color:#4a4a46}.tag-sub{background:#fde8d0;color:#7a3210}
      .budget-layout{display:flex;gap:20px;align-items:flex-start}.budget-main{flex:1;min-width:0}.budget-sidebar-panel{width:210px;flex-shrink:0}
      .bsum-card{background:var(--bg-primary);border:0.5px solid var(--border-light);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:12px}
      .bsum-head{padding:11px 15px;border-bottom:0.5px solid var(--border-light);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary)}
      .bsum-row{display:flex;justify-content:space-between;padding:7px 15px;font-size:12px;border-bottom:0.5px solid var(--border-light)}.bsum-row:last-child{border-bottom:none}
      .bsum-row.grand{font-weight:500;font-size:13px;padding:11px 15px;background:var(--bg-secondary)}
      .bsum-row .sk{color:var(--text-secondary)}.bsum-row .sv{color:var(--text-primary);font-variant-numeric:tabular-nums}
      .bsec-wrap{background:var(--bg-primary);border:0.5px solid var(--border-light);border-radius:var(--radius-md);margin-bottom:8px;overflow:hidden}
      .bsec-head{display:flex;align-items:center;padding:10px 14px;cursor:pointer;gap:8px;user-select:none;transition:background 0.1s}
      .bsec-head:hover,.bsec-head.enabled{background:var(--bg-secondary)}
      .bsec-code{font-size:10px;font-weight:600;color:var(--text-tertiary);width:22px;letter-spacing:0.3px}.bsec-name{font-size:13px;flex:1}
      .bsec-amt{font-size:12px;color:var(--text-secondary);font-variant-numeric:tabular-nums;min-width:60px;text-align:right}
      .bsec-tog{font-size:11px;color:var(--text-secondary);padding:2px 9px;border:0.5px solid var(--border-light);border-radius:20px;background:transparent;cursor:pointer;font-family:var(--font);flex-shrink:0}
      .bsec-tog.on{background:var(--text-primary);color:var(--bg-primary);border-color:var(--text-primary)}
      .bsec-chev{color:var(--text-tertiary);font-size:9px;transition:transform 0.18s;flex-shrink:0}.bsec-chev.open{transform:rotate(90deg)}
      .cs-panel-head{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);padding:11px 16px;border-bottom:0.5px solid var(--border-light);display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
      .cs-panel-head:hover{background:var(--bg-secondary)}
      .cs-panel-body{}.cs-panel-body.cs-collapsed{display:none}
      .bsec-body{display:none;border-top:0.5px solid var(--border-light)}.bsec-body.open{display:block;overflow-x:auto}
      .bl-table{width:100%;border-collapse:collapse;min-width:920px}
      .bl-table th{font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;padding:8px 6px;text-align:left;border-bottom:0.5px solid var(--border-light);font-weight:400}
      .bl-table th.r{text-align:right}.bl-table td{padding:4px 4px;vertical-align:middle;border-bottom:0.5px solid var(--border-light)}
      .bl-table tr:last-child td{border-bottom:none}.bl-table tr.sub td{background:var(--bg-secondary);font-size:12px;font-weight:500}
      .bl-in{font-size:13px;padding:6px 8px;border:0.5px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;transition:border 0.12s;min-height:32px}
      .bl-in:focus{border-color:var(--border-strong)}.bl-in.w{width:100%}.bl-in.n{width:80px;text-align:right;font-variant-numeric:tabular-nums}
      .bl-tot{font-size:12px;font-variant-numeric:tabular-nums;color:var(--text-tertiary);text-align:right;white-space:nowrap}.bl-tot.nz{color:var(--text-primary);font-weight:500}
      .add-line{display:flex;align-items:center;gap:6px;padding:8px 10px;font-size:12px;color:var(--text-tertiary);cursor:pointer;border:none;border-top:0.5px solid var(--border-light);background:transparent;width:100%;text-align:left;font-family:var(--font);transition:background 0.1s,color 0.1s}
      .add-line:hover{background:var(--bg-secondary);color:var(--text-secondary)}
      .bh-row{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}
      .mu-row{display:flex;gap:20px;margin-bottom:18px;align-items:center;flex-wrap:wrap}
      .mu-field{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)}
      .mu-field input{width:58px;padding:5px 8px;font-size:12px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);font-family:var(--font);outline:none;text-align:right;color:var(--text-primary);background:var(--bg-primary)}
      .kanban-wrap{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
      .kanban-col{display:flex;flex-direction:column;gap:8px}
      .kanban-col-head{font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;padding:0 2px 8px;display:flex;align-items:center;gap:6px}
      .kanban-count{font-size:11px;font-weight:500;color:var(--text-secondary);background:var(--bg-secondary);border-radius:20px;padding:1px 7px}
      .kanban-card{background:var(--bg-primary);border:0.5px solid var(--border-light);border-radius:var(--radius-md);padding:12px 13px;cursor:pointer;transition:border-color 0.12s}
      .kanban-card:hover{border-color:var(--border-med)}
      .kanban-card-title{font-size:13px;font-weight:500;margin-bottom:4px}.kanban-card-client{font-size:11px;color:var(--text-secondary);margin-bottom:8px}
      .kanban-card-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.kanban-card-date{font-size:11px;color:var(--text-tertiary)}
      .kanban-add{border:0.5px dashed var(--border-med);border-radius:var(--radius-md);padding:9px 12px;font-size:12px;color:var(--text-tertiary);cursor:pointer;text-align:center;background:transparent;width:100%;font-family:var(--font);transition:background 0.1s,color 0.1s}
      .kanban-add:hover{background:var(--bg-primary);color:var(--text-secondary)}
      .proj-layout{display:flex;gap:20px;align-items:flex-start}
      .proj-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px}.proj-sidebar{width:240px;flex-shrink:0;display:flex;flex-direction:column;gap:12px}
      .proj-panel{background:var(--bg-primary);border:0.5px solid var(--border-light);border-radius:var(--radius-lg);overflow:hidden}
      .proj-panel-head{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);padding:11px 16px;border-bottom:0.5px solid var(--border-light);display:flex;align-items:center;gap:8px}
      .proj-panel-body{padding:16px;display:flex;flex-direction:column;gap:12px}
      .proj-field-label{font-size:11px;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px}
      .proj-input{width:100%;padding:7px 10px;font-size:13px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;transition:border 0.12s}
      .proj-input:focus{border-color:var(--border-strong)}
      .proj-textarea{width:100%;padding:8px 10px;font-size:13px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;min-height:80px;line-height:1.6;transition:border 0.12s}
      .proj-textarea:focus{border-color:var(--border-strong)}.proj-date-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .deliverable-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:0.5px solid var(--border-light)}.deliverable-row:last-child{border-bottom:none}
      .deliverable-check{width:16px;height:16px;flex-shrink:0;cursor:pointer}
      .deliverable-text{flex:1;font-size:13px;background:transparent;border:none;outline:none;font-family:var(--font);color:var(--text-primary)}
      .shot-row{display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:0.5px solid var(--border-light)}.shot-row:last-child{border-bottom:none}
      .shot-num{font-size:11px;color:var(--text-tertiary);width:20px;flex-shrink:0;padding-top:2px}
      .shot-text{flex:1;font-size:13px;background:transparent;border:none;outline:none;font-family:var(--font);color:var(--text-primary);resize:none;line-height:1.5}
      .crew-row{display:grid;grid-template-columns:1fr 1fr 40px;gap:8px;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--border-light)}.crew-row:last-child{border-bottom:none}
      .approval-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--border-light);font-size:13px}.approval-row:last-child{border-bottom:none}
      .approval-label{color:var(--text-secondary)}
      .approval-status{font-size:11px;padding:3px 9px;border-radius:20px;cursor:pointer;font-family:var(--font);border:none}
      .apv-pending{background:var(--bg-secondary);color:var(--text-tertiary)}.apv-approved{background:#d8efc4;color:#2a5008}.apv-changes{background:#fce2b0;color:#5a3206}
      .status-select{font-size:12px;padding:5px 8px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);font-family:var(--font);background:var(--bg-primary);color:var(--text-primary);outline:none}
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
    `
    document.head.appendChild(style)
  }

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
