import { getCurrentUserId } from './auth/clerk.js'
import { getContacts, getProjects, getBudgets, upsertSettings } from './db/client.js'
import { ContactsView } from './views/contacts.js'
import { ProjectsView } from './views/projects.js'
import { BudgetsView, budTotal } from './views/budgets.js'

export class App {
  constructor({ userId, user, appUser, permissions, contacts, projects, budgets, settings, onSignOut }) {
    this.userId      = userId
    this.user        = user
    this.appUser     = appUser
    this.permissions = permissions  // resolved effective permissions
    this.contacts = contacts ?? []
    this.projects = projects ?? []
    this.budgets  = budgets  ?? []
    this.settings = settings ?? {}
    this.onSignOut = onSignOut
    this.currentView = 'dashboard'
    this.contactsView = new ContactsView(this)
    this.projectsView = new ProjectsView(this)
    this.budgetsView  = new BudgetsView(this)
    window.app = this
  }

  mount(container) {
    this.container = container
    // Restore saved theme before first render
    const saved = localStorage.getItem('peny-theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
    this.injectGlobalStyles()
    this.render()
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
          <div id="topbar-actions" style="display:flex;gap:8px;align-items:center">${this.topbarSearch()}${this.topbarButton()}</div>
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

  renderDashboard(mc) {
    const stages = ['Enquiry','Pre-production','In Production','Post','Delivered']
    mc.innerHTML = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px">${stages.map(st => {
      const col = this.projects.filter(p => p.status === st)
      return `<div>
        <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px">${st} <span style="font-weight:500;color:var(--text-secondary)">${col.length}</span></div>
        ${col.map(p => {
          const cl = this.contacts.find(c => c.id === p.client_id)
          const pipelineBudgets = (p.budget_ids || [])
            .map(id => this.budgets.find(b => b.id === id))
            .filter(b => b && b.include_in_pipeline)
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
          return `<div class="kanban-card" data-pid="${p.id}">
            <div class="kanban-card-title" style="cursor:pointer" data-open-pid="${p.id}">${p.name}</div>
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
        } catch(e) { console.error('Deliverable save failed:', e) }
      })
    })

    // Load hours bars asynchronously
    const projectsWithHours = this.projects.filter(p =>
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
    mc.innerHTML = `<div style="max-width:680px;display:flex;flex-direction:column;gap:16px">
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
    </div>`

    mc.querySelector('#settings-save-btn')?.addEventListener('click', () => this.saveSettings(mc))
    mc.querySelector('#signout-settings')?.addEventListener('click', () => this.onSignOut())

    if (isAdmin) {
      this._loadUsersPanel(mc)
      mc.querySelector('#invite-btn')?.addEventListener('click', () => this._sendInvite(mc))
    }
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
        const isSelf = u.clerk_id === this.userId
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
            await updateAppUser(uid, { role, permissions: perms })
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
    const data = { company_name:mc.querySelector('#s-name')?.value.trim()||'Peny', email:mc.querySelector('#s-email')?.value.trim()||null, phone:mc.querySelector('#s-phone')?.value.trim()||null, website:mc.querySelector('#s-website')?.value.trim()||null, address:mc.querySelector('#s-address')?.value.trim()||null, vat_number:mc.querySelector('#s-vat')?.value.trim()||null, prepared_by:mc.querySelector('#s-preparedby')?.value.trim()||null }
    try { const [updated] = await upsertSettings(this.userId, data); this.settings = updated; this.toast('Settings saved') }
    catch (e) { console.error(e); this.toast('Error saving settings') }
  }

  toast(msg) {
    let el = document.getElementById('app-toast')
    if (!el) { el = document.createElement('div'); el.id = 'app-toast'; el.className = 'toast'; document.body.appendChild(el) }
    el.textContent = msg; el.classList.add('show')
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2400)
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
      .tag-brand{background:#daeeff;color:#0d4a8a}.tag-agency{background:#dddaf7;color:#3a2f9e}.tag-ngo{background:#d8efc4;color:#2a5008}.tag-sport{background:#fce2b0;color:#5a3206}.tag-corp{background:#ebebeb;color:#4a4a46}
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
      .bsec-body{display:none;border-top:0.5px solid var(--border-light)}.bsec-body.open{display:block}
      .bl-table{width:100%;border-collapse:collapse}
      .bl-table th{font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;padding:7px 8px;text-align:left;border-bottom:0.5px solid var(--border-light);font-weight:400}
      .bl-table th.r{text-align:right}.bl-table td{padding:5px 8px;vertical-align:middle;border-bottom:0.5px solid var(--border-light)}
      .bl-table tr:last-child td{border-bottom:none}.bl-table tr.sub td{background:var(--bg-secondary);font-size:12px;font-weight:500}
      .bl-in{font-size:12px;padding:4px 6px;border:0.5px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;transition:border 0.12s}
      .bl-in:focus{border-color:var(--border-strong)}.bl-in.w{width:100%}.bl-in.n{width:54px;text-align:right;font-variant-numeric:tabular-nums}
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
