// Slate's own pages and actions, for the search palette (⌘K): typing
// "expenses" goes to Expenses, "holiday" to Leave, "new project" opens the
// new project form. Only what this person can already reach is listed, using
// the same checks as the header, account menu and pages.
//
// Each entry: { kind: 'page'|'action', label, hint, keywords, icon, run }.
// `icon` is a name from views/icons.js; matching is utils/command-search.js.

import { setThemeChoice } from '../theme.js'

export function searchCommands(app) {
  const p = app.permissions ?? {}
  const isAdmin = app.appUser?.role === 'superadmin'
  const go = view => () => app.navigate(view)
  const settings = tab => () => { app._settingsTab = tab; app.navigate('settings') }
  const anchor = id => document.getElementById(id)
  const theme = (value, label) => () => { setThemeChoice(value); app.toast(`Theme: ${label}`) }

  const pages = [
    { label: 'Dashboard', hint: 'Home', icon: 'dashboard', run: go('dashboard'),
      keywords: 'home overview today week live projects deadlines retainers countdown' },
    { label: 'Tasks', hint: 'Task board', icon: 'tasks', run: go('tasks'),
      keywords: 'task board todo to do requests assigned claim acknowledge' },
    { label: 'Calendar', hint: 'Team calendar', icon: 'calendar', run: go('calendar'),
      keywords: 'team calendar rota schedule diary availability bookings who is in' },
    p.projects_view && { label: 'Projects', hint: 'Pipeline', icon: 'folder', run: go('projects'),
      keywords: 'pipeline kanban jobs productions enquiries retainers' },
    p.budgets_view && { label: 'Budgets', hint: 'Projects › Budgets', icon: 'budget', run: go('budgets'),
      keywords: 'quotes estimates costs pricing invoices' },
    p.projects_view && { label: 'Planning', hint: 'Projects › Planning', icon: 'project', run: go('planning'),
      keywords: 'boards canvases kanban storyboard moodboard plans' },
    p.contacts_view && { label: 'Contacts', hint: 'Clients and crew', icon: 'person', run: go('contacts'),
      keywords: 'clients people crm subcontractors freelancers crew leads' },
    { label: 'Marketing', hint: 'Tools', icon: 'megaphone', run: go('marketing'),
      keywords: 'social posts content calendar campaigns cards' },
    { label: 'Offload Log', hint: 'Tools', icon: 'offload', run: go('offload-log'),
      keywords: 'offloads backups cards media fence copies' },
    { label: 'Story Planner', hint: 'Tools', icon: 'story', run: go('story-planner'),
      keywords: 'story script structure beats plans' },
    { label: 'Leave', hint: 'Workspace', icon: 'leave', run: go('leave'),
      keywords: 'holiday holidays time off annual leave absence vacation approvals sick' },
    { label: 'Expenses', hint: 'Workspace', icon: 'receipt', run: go('expenses'),
      keywords: 'expense receipts mileage claims per diem reimbursement' },
    (p.vault || isAdmin) && { label: 'Passwords', hint: 'Workspace', icon: 'lock', run: go('password-manager'),
      keywords: 'vault logins credentials accounts' },
    p.settings && { label: 'Settings', hint: 'My account', icon: 'settings', run: settings('account'),
      keywords: 'preferences account profile role job title reminders' },
    ...(isAdmin ? [
      { label: 'Team & roles', hint: 'Settings', icon: 'team', run: settings('users'),
        keywords: 'users people permissions invite members google calendar' },
      { label: 'Company settings', hint: 'Settings', icon: 'settings', run: settings('company'),
        keywords: 'company studio details logo address' },
      { label: 'Invoicing settings', hint: 'Settings', icon: 'receipt', run: settings('invoicing'),
        keywords: 'invoicing invoices bank vat payment terms' },
      { label: 'Budget template', hint: 'Settings', icon: 'budget', run: settings('budget'),
        keywords: 'template default sections line items rates' },
    ] : p.settings ? [
      { label: 'Workspace settings', hint: 'Settings', icon: 'settings', run: settings('workspace'),
        keywords: 'workspace leave settings' },
    ] : []),
  ]

  const actions = [
    { label: 'New task', hint: 'Tasks', icon: 'plus', run: () => app.createNew('task'),
      keywords: 'add create raise request' },
    p.projects_edit && { label: 'New project', hint: 'Projects', icon: 'plus', run: () => app.createNew('project'),
      keywords: 'add create job enquiry' },
    p.contacts_edit && { label: 'New contact', hint: 'Contacts', icon: 'plus', run: () => app.createNew('contact'),
      keywords: 'add create client person' },
    p.budgets_edit && { label: 'New budget', hint: 'Budgets', icon: 'plus', run: () => app.createNew('budget'),
      keywords: 'add create quote estimate' },
    { label: 'New note', hint: 'Notes', icon: 'notes', run: () => app.createNew('note'),
      keywords: 'add create jot write' },
    app.leaveView?.canBook && { label: 'Book leave', hint: 'Leave', icon: 'leave', run: () => { app.navigate('leave'); app.leaveView._openBookModal() },
      keywords: 'request holiday time off annual leave' },
    { label: 'Log time', hint: 'Timesheet', icon: 'stopwatch', run: () => app.header.openLogTime(anchor('hdr-logtime')),
      keywords: 'hours timesheet track time tracking' },
    { label: 'Notes', hint: 'Open the notes panel', icon: 'notes', run: () => app.toggleNotes(true),
      keywords: 'notepad scratch jottings' },
    { label: 'Notifications', hint: 'Task notifications', icon: 'bell', run: () => app.tasksView.openNotifications(anchor('hdr-bell')),
      keywords: 'alerts bell inbox mentions unread' },
    { label: 'Theme: Light', hint: 'Warm Paper', icon: 'settings', run: theme('light', 'Light'),
      keywords: 'appearance light mode day' },
    { label: 'Theme: Dark', hint: 'Darkroom', icon: 'settings', run: theme('dark', 'Dark'),
      keywords: 'appearance dark mode night' },
    { label: 'Theme: System', hint: 'Follow this device', icon: 'settings', run: theme('system', 'System'),
      keywords: 'appearance auto device default mode' },
    { label: 'Keyboard shortcuts', hint: 'Help', icon: 'keyboard', run: () => app._openShortcuts(),
      keywords: 'keys hotkeys help' },
    { label: 'Dev request', hint: 'Suggest a change to Slate', icon: 'message', run: () => app._openDevRequest(),
      keywords: 'feature request bug report feedback idea' },
    { label: 'Sign out', hint: 'Account', icon: 'signout', run: () => app.onSignOut(),
      keywords: 'log out logout sign off exit' },
  ]

  return [
    ...pages.filter(Boolean).map(c => ({ kind: 'page', ...c })),
    ...actions.filter(Boolean).map(c => ({ kind: 'action', ...c })),
  ]
}
