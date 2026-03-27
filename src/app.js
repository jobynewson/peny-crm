import { getCurrentUserId } from './auth/clerk.js'
import {
  getContacts, createContact, updateContact, deleteContact,
  getProjects, createProject, updateProject, deleteProject,
  getBudgets,  createBudget,  updateBudget,  deleteBudget,
  upsertSettings, linkBudgetToProject, unlinkBudgetFromProject, getBudgetIdsForProject,
} from './db/client.js'

// ── App ───────────────────────────────────────────────────────────────────────
// This is a thin shell. The pattern is:
//   - App holds state (contacts, projects, budgets, settings, currentView)
//   - render() rebuilds the sidebar + calls the active view renderer
//   - Each view renderer returns an HTML string, mounted into #main-content
//   - Events use onclick="window.app.method()" for simplicity during early dev
//
// When you're ready to migrate to a component framework, each view becomes
// a component and this App class becomes your top-level store/router.

export class App {
  constructor({ userId, user, contacts, projects, budgets, settings, onSignOut }) {
    this.userId   = userId
    this.user     = user
    this.contacts = contacts  ?? []
    this.projects = projects  ?? []
    this.budgets  = budgets   ?? []
    this.settings = settings  ?? {}
    this.onSignOut = onSignOut

    this.currentView = 'contacts'
    this.currentProjectId = null
    this.currentBudgetId  = null

    // Expose globally so inline onclick handlers can reach app methods
    window.app = this
  }

  mount(container) {
    this.container = container
    this.render()
  }

  // ── Re-render ───────────────────────────────────────────────────────────────

  render() {
    this.container.innerHTML = this.shellHTML()
    this.bindNav()
    this.renderCurrentView()
  }

  shellHTML() {
    const nav = [
      { id: 'contacts', label: 'Contacts',  icon: this.iconContacts() },
      { id: 'projects', label: 'Projects',  icon: this.iconProjects() },
      { id: 'budgets',  label: 'Budgets',   icon: this.iconBudgets()  },
      { id: 'pipeline', label: 'Pipeline',  icon: this.iconPipeline() },
    ]
    return `
      <div class="sidebar">
        <div class="logo">
          <img src="/peny-logo.png" alt="Peny" />
        </div>
        <div class="nav-label">Main</div>
        ${nav.map(n => `
          <div class="nav-item ${this.currentView === n.id ? 'active' : ''}" data-view="${n.id}">
            ${n.icon} ${n.label}
          </div>`).join('')}
        <div class="nav-bottom">
          <div class="nav-item" data-view="settings">
            ${this.iconSettings()} Settings
          </div>
          <div class="nav-item" id="sign-out-btn">
            ${this.iconSignOut()} Sign out
          </div>
        </div>
      </div>
      <div class="main">
        <div class="topbar">
          <div class="topbar-title" id="view-title">${this.viewTitle()}</div>
          <div id="topbar-actions"></div>
        </div>
        <div class="content" id="main-content">
          <div class="loading">Loading…</div>
        </div>
      </div>
    `
  }

  bindNav() {
    this.container.querySelectorAll('.nav-item[data-view]').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.view))
    })
    const signOut = this.container.querySelector('#sign-out-btn')
    if (signOut) signOut.addEventListener('click', () => this.onSignOut())
  }

  navigate(view) {
    this.currentView = view
    this.currentProjectId = null
    this.currentBudgetId  = null
    this.render()
  }

  viewTitle() {
    if (this.currentView === 'projects' && this.currentProjectId) {
      return this.projects.find(p => p.id === this.currentProjectId)?.name ?? 'Project'
    }
    if (this.currentView === 'budgets' && this.currentBudgetId) {
      return this.budgets.find(b => b.id === this.currentBudgetId)?.name ?? 'Budget'
    }
    return { contacts: 'Contacts', projects: 'Projects', budgets: 'Budgets', pipeline: 'Pipeline', settings: 'Settings' }[this.currentView] ?? ''
  }

  renderCurrentView() {
    const mc = this.container.querySelector('#main-content')
    if (!mc) return
    // Each view is its own module, imported lazily
    // For now they render placeholder HTML — swap in real view modules as you build them
    const placeholders = {
      contacts: () => this.renderContactsPlaceholder(mc),
      projects: () => this.renderProjectsPlaceholder(mc),
      budgets:  () => this.renderBudgetsPlaceholder(mc),
      pipeline: () => this.renderPipelinePlaceholder(mc),
      settings: () => this.renderSettingsPlaceholder(mc),
    }
    placeholders[this.currentView]?.()
  }

  // ── Placeholder views (replace these with real view modules) ────────────────

  renderContactsPlaceholder(mc) {
    mc.innerHTML = `
      <div style="padding:32px;font-size:13px;color:var(--text-secondary);">
        <strong style="color:var(--text-primary);font-size:15px;">Contacts</strong><br><br>
        Connected to Neon. ${this.contacts.length} contact(s) loaded.<br><br>
        <em>Replace this with your contacts view module.</em>
      </div>`
  }
  renderProjectsPlaceholder(mc) {
    mc.innerHTML = `
      <div style="padding:32px;font-size:13px;color:var(--text-secondary);">
        <strong style="color:var(--text-primary);font-size:15px;">Projects</strong><br><br>
        ${this.projects.length} project(s) loaded.<br><br>
        <em>Replace this with your projects kanban module.</em>
      </div>`
  }
  renderBudgetsPlaceholder(mc) {
    mc.innerHTML = `
      <div style="padding:32px;font-size:13px;color:var(--text-secondary);">
        <strong style="color:var(--text-primary);font-size:15px;">Budgets</strong><br><br>
        ${this.budgets.length} budget(s) loaded.<br><br>
        <em>Replace this with your budgets module.</em>
      </div>`
  }
  renderPipelinePlaceholder(mc) {
    mc.innerHTML = `<div style="padding:32px;font-size:13px;color:var(--text-secondary);">Pipeline coming soon.</div>`
  }
  renderSettingsPlaceholder(mc) {
    const s = this.settings
    mc.innerHTML = `
      <div style="padding:32px;font-size:13px;color:var(--text-secondary);">
        <strong style="color:var(--text-primary);font-size:15px;">Settings</strong><br><br>
        Signed in as <strong>${this.user.primaryEmailAddress?.emailAddress}</strong><br><br>
        Company: ${s?.company_name ?? '—'}<br>
        Email: ${s?.email ?? '—'}<br><br>
        <em>Replace this with your settings module.</em>
      </div>`
  }

  // ── DB helpers (called by view modules) ──────────────────────────────────────

  async refreshAll() {
    const uid = this.userId
    const [c, p, b] = await Promise.all([getContacts(uid), getProjects(uid), getBudgets(uid)])
    this.contacts = c
    this.projects = p
    this.budgets  = b
  }

  // ── Icons ─────────────────────────────────────────────────────────────────────

  iconContacts() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="5" r="2.5"/><path d="M1 14c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5"/><path d="M11 3.5a2 2 0 0 1 0 4M15 14c0-2.4-1.5-3.8-4-4"/></svg>` }
  iconProjects() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 6h6M5 9h4"/></svg>` }
  iconBudgets()  { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3h12v2H2zM2 7h9M2 11h7"/><circle cx="13" cy="11" r="2.2"/><path d="M13 9.8v1l.7.7"/></svg>` }
  iconPipeline() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="4" width="4" height="9" rx="1"/><rect x="6" y="6" width="4" height="7" rx="1"/><rect x="11" y="8" width="4" height="5" rx="1"/></svg>` }
  iconSettings() { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M11.4 4.6l-1.4 1.4M4.6 11.4l-1.4 1.4"/></svg>` }
  iconSignOut()  { return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M10 11l4-4-4-4M14 8H6"/></svg>` }
}
