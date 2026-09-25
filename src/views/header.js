// App header: the Slate wordmark, the four top-level tabs, search, New,
// Notes and the account menu. The tabs are real links styled as tabs; the active one
// takes the page background so it joins the content below.

import { icon } from './icons.js'
import { openFloating } from './popover.js'
import { getThemeChoice, setThemeChoice } from '../theme.js'
import { pendingApprovalsFor } from './leave.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// `views` are the routes that light each tab up. Pages reached from the
// account menu (Marketing, Leave, Settings, ...) light up none.
export const TABS = [
  { id: 'tasks',    label: 'Tasks',    href: '/',         view: 'dashboard', icon: 'tasks',    views: ['dashboard'] },
  { id: 'calendar', label: 'Calendar', href: '#calendar', view: 'calendar',  icon: 'calendar', views: ['calendar'] },
  { id: 'projects', label: 'Projects', href: '#projects', view: 'projects',  icon: 'folder',   views: ['projects', 'budgets', 'planning'] },
  { id: 'contacts', label: 'Contacts', href: '#contacts', view: 'contacts',  icon: 'person',   views: ['contacts'] },
]

export const tabForView = view => TABS.find(t => t.views.includes(view)) ?? null

const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' }

export class HeaderView {
  constructor(app) {
    this.app = app
  }

  get name() {
    const a = this.app
    return a.appUser?.name || a.user?.fullName || a.user?.primaryEmailAddress?.emailAddress || 'You'
  }

  get initials() {
    return this.name.split(/[\s@.]+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  }

  get org() {
    return this.app.settings?.company_name || 'Peny'
  }

  pendingLeave() {
    return pendingApprovalsFor(this.app.appUser, this.app.leaveRequests).length
  }

  accountLabel() {
    const n = this.pendingLeave()
    return `Account menu, ${this.name}${n ? `, ${n} leave request${n === 1 ? '' : 's'} to approve` : ''}`
  }

  html() {
    const active = tabForView(this.app.currentView)?.id
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    return `
      <header class="app-header">
        <a class="app-wordmark" href="/" data-nav="dashboard">Slate</a>
        <nav class="app-tabs" aria-label="Main">
          ${TABS.map(t => `<a class="app-tab" href="${t.href}" data-nav="${t.view}"${t.id === active ? ' aria-current="page"' : ''}>${t.label}</a>`).join('')}
        </nav>
        <div class="app-header-actions">
          <button type="button" class="hdr-search" id="hdr-search" aria-keyshortcuts="${mac ? 'Meta+K' : 'Control+K'}">
            ${icon('search', 16)}<span class="hdr-search-text">Search or jump to…</span><kbd>${mac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <button type="button" class="hdr-btn hdr-btn--accent" id="hdr-new" aria-haspopup="menu" aria-expanded="false">${icon('plus', 16)}<span>New</span></button>
          <button type="button" class="hdr-icon-btn" id="hdr-notes" title="Notes" aria-label="Notes" aria-controls="notes-panel" aria-expanded="${this.app._notesOpen ? 'true' : 'false'}">${icon('notes', 20)}</button>
          <button type="button" class="hdr-account" id="hdr-account" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(this.accountLabel())}">
            <span class="hdr-avatar" aria-hidden="true">${esc(this.initials)}</span>${icon('chevron', 14)}
            <span class="hdr-account-dot"${this.pendingLeave() ? '' : ' hidden'}></span>
          </button>
        </div>
      </header>`
  }

  bind(root) {
    root.querySelector('#hdr-search')?.addEventListener('click', () => this.app._openSearch())
    root.querySelector('#hdr-new')?.addEventListener('click', e => this.openNewMenu(e.currentTarget))
    root.querySelector('#hdr-notes')?.addEventListener('click', () => this.app.toggleNotes())
    root.querySelector('#hdr-account')?.addEventListener('click', e => this.openAccountMenu(e.currentTarget))
  }

  // Keep the approvals dot and label in step when leave requests change.
  refreshLeaveBadge() {
    const n = this.pendingLeave()
    const btn = document.getElementById('hdr-account')
    btn?.setAttribute('aria-label', this.accountLabel())
    const dot = btn?.querySelector('.hdr-account-dot')
    if (dot) dot.hidden = !n
  }

  openAccountMenu(anchor) {
    const app = this.app
    const p = app.permissions ?? {}
    const isAdmin = app.appUser?.role === 'superadmin'
    const pending = this.pendingLeave()
    const theme = getThemeChoice()
    const nav = (ic, label, view, { badge = '', tab = '' } = {}) =>
      `<a class="dd-item" role="menuitem" href="#${view}" data-nav="${view}"${tab ? ` data-settings-tab="${tab}"` : ''}>${icon(ic, 18)}<span>${label}</span>${badge}</a>`
    const act = (ic, label, action) =>
      `<button type="button" class="dd-item" role="menuitem" data-action="${action}">${icon(ic, 18)}<span>${label}</span></button>`

    const html = `
      <div class="dd-head">
        <span class="hdr-avatar" aria-hidden="true">${esc(this.initials)}</span>
        <span class="dd-who"><span class="dd-name">${esc(this.name)}</span><span class="dd-org">${esc(this.org)}</span></span>
      </div>
      <div class="dd-sep" role="separator"></div>
      <div class="dd-label section-label" id="dd-tools">Tools</div>
      <div role="group" aria-labelledby="dd-tools">
        ${nav('megaphone', 'Marketing', 'marketing')}
        ${nav('offload', 'Offload Log', 'offload-log')}
        ${nav('story', 'Story Planner', 'story-planner')}
      </div>
      <div class="dd-sep" role="separator"></div>
      <div class="dd-label section-label" id="dd-workspace">Workspace</div>
      <div role="group" aria-labelledby="dd-workspace">
        ${isAdmin ? nav('team', 'Team &amp; roles', 'settings', { tab: 'users' }) : ''}
        ${nav('leave', 'Leave', 'leave', { badge: pending ? `<span class="dd-badge">${pending}<span class="visually-hidden"> to approve</span></span>` : '' })}
        ${nav('receipt', 'Expenses', 'expenses')}
        ${(p.vault || isAdmin) ? nav('lock', 'Passwords', 'password-manager') : ''}
        ${act('message', 'Dev request', 'dev-request')}
      </div>
      <div class="dd-sep" role="separator"></div>
      <div class="dd-theme">
        <span class="dd-label section-label" id="dd-theme">Theme</span>
        <div class="seg" role="group" aria-labelledby="dd-theme">
          ${Object.entries(THEME_LABELS).map(([value, label]) =>
            `<button type="button" class="seg-btn" role="menuitemradio" aria-checked="${value === theme}" data-theme-choice="${value}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="dd-sep" role="separator"></div>
      ${p.settings ? nav('settings', 'Settings', 'settings', { tab: 'account' }) : ''}
      ${act('keyboard', 'Keyboard shortcuts', 'shortcuts')}
      ${act('signout', 'Sign out', 'sign-out')}`

    openFloating({
      anchor, id: 'account-menu', role: 'menu', label: 'Account', className: 'dd dd--account', html,
      onReady: (el, close) => {
        el.querySelectorAll('[data-theme-choice]').forEach(btn => btn.addEventListener('click', () => {
          const chosen = setThemeChoice(btn.dataset.themeChoice)
          el.querySelectorAll('[data-theme-choice]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themeChoice === chosen)))
        }))
        el.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => {
          const action = btn.dataset.action
          close()
          if (action === 'dev-request') app._openDevRequest()
          else if (action === 'shortcuts') app._openShortcuts()
          else if (action === 'sign-out') app.onSignOut()
        }))
      },
    })
  }

  openNewMenu(anchor) {
    const p = this.app.permissions ?? {}
    const entries = [
      p.projects_edit && ['project', 'Project', 'project'],
      p.contacts_edit && ['person', 'Contact', 'contact'],
      p.budgets_edit && ['budget', 'Budget', 'budget'],
      ['notes', 'Note', 'note'],
    ].filter(Boolean)
    const html = entries.map(([ic, label, kind]) =>
      `<button type="button" class="dd-item" role="menuitem" data-new="${kind}">${icon(ic, 18)}<span>${label}</span></button>`).join('')

    openFloating({
      anchor, id: 'new-menu', role: 'menu', label: 'Create new', className: 'dd dd--new', html,
      onReady: (el, close) => {
        el.querySelectorAll('[data-new]').forEach(btn => btn.addEventListener('click', () => {
          close({ restoreFocus: false })
          this.app.createNew(btn.dataset.new)
        }))
      },
    })
  }
}
