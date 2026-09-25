// src/db/roles.js
// Role → permission presets. Shared by the browser (to show or hide UI) and
// the server (api/_db-ops.js, to enforce), so this module must stay free of
// imports and browser-only code.
//
// Three tiers:
//   superadmin — full access, manages the workspace and can edit people's
//                names/email addresses
//   user       — can do most things (view/edit contacts, projects, budgets,
//                export) and set their own job title in settings
//   viewer     — read-only, can't change anything
export const ROLE_PRESETS = {
  superadmin: {
    contacts_view: true, contacts_edit: true,
    projects_view: true, projects_edit: true,
    budgets_view:  true, budgets_edit:  true,
    export:        true, settings:      true, manage_users: true,
    vault:         true,
  },
  user: {
    contacts_view: true, contacts_edit: true,
    projects_view: true, projects_edit: true,
    budgets_view:  true, budgets_edit:  true,
    export:        true, settings:      true, manage_users: false,
    vault:         false,
  },
  viewer: {
    contacts_view: true, contacts_edit: false,
    projects_view: true, projects_edit: false,
    budgets_view:  true, budgets_edit:  false,
    export:        false, settings:     false, manage_users: false,
    vault:         false,
  },
}

export const ROLE_LABELS = {
  superadmin: 'Superadmin',
  user:       'User',
  viewer:     'Viewer',
}

// Permissions are derived purely from the role — there are no per-permission
// overrides any more.
export function resolvePermissions(user) {
  return ROLE_PRESETS[user.role] ?? ROLE_PRESETS.user
}
