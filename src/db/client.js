import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { eq, and, desc, inArray } from 'drizzle-orm'
import * as schema from './schema.js'
import {
  contacts, projects, budgets, settings, workspace,
  project_budgets, budget_versions, activity_log,
  app_users, time_entries,
} from './schema.js'

const sql = neon(import.meta.env.VITE_DATABASE_URL)
export const db = drizzle(sql, { schema })

// ── Workspace ─────────────────────────────────────────────────────────────────
// Returns the workspace owner ID — all data is scoped to this single ID.
// If no workspace exists yet, the current user becomes the owner (first admin).
export async function getOrCreateWorkspace(clerkUserId) {
  const rows = await db.select().from(workspace).limit(1)
  if (rows[0]) return rows[0].owner_id

  // No workspace yet — this user is the first admin, create the workspace
  await db.insert(workspace).values({ owner_id: clerkUserId }).onConflictDoNothing()
  return clerkUserId
}

// ── Settings ──────────────────────────────────────────────────────────────────
export async function getSettings(workspaceId) {
  const rows = await db.select().from(settings).where(eq(settings.user_id, workspaceId))
  return rows[0] ?? null
}
export async function upsertSettings(workspaceId, data) {
  return db.insert(settings)
    .values({ user_id: workspaceId, ...data })
    .onConflictDoUpdate({ target: settings.user_id, set: { ...data, updated_at: new Date() } })
    .returning()
}

// ── Contacts ──────────────────────────────────────────────────────────────────
export async function getContacts(workspaceId) {
  return db.select().from(contacts)
    .where(eq(contacts.user_id, workspaceId))
    .orderBy(desc(contacts.created_at))
}
export async function createContact(workspaceId, data) {
  return db.insert(contacts).values({ user_id: workspaceId, ...data }).returning()
}
export async function updateContact(workspaceId, id, data) {
  return db.update(contacts)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(contacts.id, id), eq(contacts.user_id, workspaceId)))
    .returning()
}
export async function deleteContact(workspaceId, id) {
  return db.delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.user_id, workspaceId)))
}

// ── Projects ──────────────────────────────────────────────────────────────────
export async function getProjects(workspaceId) {
  const rows = await db.select().from(projects)
    .where(eq(projects.user_id, workspaceId))
    .orderBy(desc(projects.created_at))

  if (!rows.length) return []

  const projectIds = rows.map(r => r.id)
  const allLinks = await db.select().from(project_budgets)
    .where(inArray(project_budgets.project_id, projectIds))

  const linkMap = {}
  allLinks.forEach(l => {
    if (!linkMap[l.project_id]) linkMap[l.project_id] = []
    linkMap[l.project_id].push(l.budget_id)
  })

  return rows.map(r => ({ ...r, budget_ids: linkMap[r.id] ?? [] }))
}
export async function createProject(workspaceId, data) {
  return db.insert(projects).values({ user_id: workspaceId, ...data }).returning()
}
export async function updateProject(workspaceId, id, data) {
  return db.update(projects)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(projects.id, id), eq(projects.user_id, workspaceId)))
    .returning()
}
export async function deleteProject(workspaceId, id) {
  return db.delete(projects)
    .where(and(eq(projects.id, id), eq(projects.user_id, workspaceId)))
}

// ── Project ↔ Budget links ────────────────────────────────────────────────────
export async function linkBudgetToProject(projectId, budgetId) {
  return db.insert(project_budgets)
    .values({ project_id: projectId, budget_id: budgetId })
    .onConflictDoNothing()
}
export async function unlinkBudgetFromProject(projectId, budgetId) {
  return db.delete(project_budgets)
    .where(and(eq(project_budgets.project_id, projectId), eq(project_budgets.budget_id, budgetId)))
}
export async function getBudgetIdsForProject(projectId) {
  const rows = await db.select({ budget_id: project_budgets.budget_id })
    .from(project_budgets)
    .where(eq(project_budgets.project_id, projectId))
  return rows.map(r => r.budget_id)
}

// ── Budgets ───────────────────────────────────────────────────────────────────
export async function getBudgets(workspaceId) {
  return db.select().from(budgets)
    .where(eq(budgets.user_id, workspaceId))
    .orderBy(desc(budgets.created_at))
}
export async function createBudget(workspaceId, data) {
  return db.insert(budgets).values({ user_id: workspaceId, ...data }).returning()
}
export async function updateBudget(workspaceId, id, data) {
  return db.update(budgets)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(budgets.id, id), eq(budgets.user_id, workspaceId)))
    .returning()
}
export async function deleteBudget(workspaceId, id) {
  return db.delete(budgets)
    .where(and(eq(budgets.id, id), eq(budgets.user_id, workspaceId)))
}

// ── Budget versions ───────────────────────────────────────────────────────────
export async function saveBudgetVersion(workspaceId, budgetId, budgetData, name = 'Auto-save', isAuto = true) {
  return db.insert(budget_versions).values({
    budget_id: budgetId,
    user_id:   workspaceId,
    name,
    is_auto:   isAuto,
    snapshot:  budgetData,
  }).returning()
}
export async function getBudgetVersions(budgetId) {
  return db.select().from(budget_versions)
    .where(eq(budget_versions.budget_id, budgetId))
    .orderBy(desc(budget_versions.created_at))
}
export async function deleteBudgetVersion(id) {
  return db.delete(budget_versions).where(eq(budget_versions.id, id))
}

// ── Activity log ──────────────────────────────────────────────────────────────
export async function logActivity(workspaceId, entityType, entityId, entityName, summary) {
  return db.insert(activity_log).values({
    user_id:     workspaceId,
    entity_type: entityType,
    entity_id:   entityId,
    entity_name: entityName,
    summary,
  })
}
export async function getActivityLog(entityId, limit = 30) {
  return db.select().from(activity_log)
    .where(eq(activity_log.entity_id, entityId))
    .orderBy(desc(activity_log.created_at))
    .limit(limit)
}

// ── Users & permissions ───────────────────────────────────────────────────────
export const ROLE_PRESETS = {
  admin: {
    contacts_view: true, contacts_edit: true,
    projects_view: true, projects_edit: true,
    budgets_view:  true, budgets_edit:  true,
    export:        true, settings:      true,
  },
  member: {
    contacts_view: true, contacts_edit: true,
    projects_view: true, projects_edit: true,
    budgets_view:  true, budgets_edit:  true,
    export:        true, settings:      false,
  },
  readonly: {
    contacts_view: true, contacts_edit: false,
    projects_view: true, projects_edit: false,
    budgets_view:  true, budgets_edit:  false,
    export:        false, settings:     false,
  },
}

export function resolvePermissions(user) {
  const preset = ROLE_PRESETS[user.role] ?? ROLE_PRESETS.member
  return { ...preset, ...(user.permissions ?? {}) }
}

export async function getOrCreateAppUser(clerkUser) {
  const existing = await db.select().from(app_users)
    .where(eq(app_users.clerk_id, clerkUser.id))
  if (existing[0]) return existing[0]

  const allUsers = await db.select({ id: app_users.id }).from(app_users)
  const role = allUsers.length === 0 ? 'admin' : 'member'

  const [created] = await db.insert(app_users).values({
    clerk_id: clerkUser.id,
    email:    clerkUser.primaryEmailAddress?.emailAddress ?? '',
    name:     clerkUser.fullName ?? clerkUser.username ?? '',
    role,
  }).returning()
  return created
}

export async function getAllAppUsers() {
  return db.select().from(app_users).orderBy(app_users.created_at)
}

export async function updateAppUser(id, data) {
  return db.update(app_users)
    .set({ ...data, updated_at: new Date() })
    .where(eq(app_users.id, id))
    .returning()
}

// ── Time tracking ─────────────────────────────────────────────────────────────
export async function getTimeEntries(projectId) {
  return db.select().from(time_entries)
    .where(eq(time_entries.project_id, projectId))
    .orderBy(desc(time_entries.created_at))
}

export async function addTimeEntry(data) {
  const [entry] = await db.insert(time_entries).values(data).returning()
  return entry
}

export async function deleteTimeEntry(id) {
  return db.delete(time_entries).where(eq(time_entries.id, id))
}

export async function getProjectByToken(token) {
  const rows = await db.select().from(projects)
    .where(eq(projects.track_token, token))
  return rows[0] ?? null
}

export async function setTrackToken(workspaceId, projectId, token) {
  return db.update(projects)
    .set({ track_token: token, updated_at: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.user_id, workspaceId)))
    .returning()
}
