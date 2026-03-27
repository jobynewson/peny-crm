import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.js'

const sql = neon(import.meta.env.VITE_DATABASE_URL)
export const db = drizzle(sql, { schema })

// ── Scoped query helpers ───────────────────────────────────────────────────────
// Every query goes through these — they enforce user_id scoping automatically.
// Call them with the Clerk userId from useAuth().

import { eq, and, desc } from 'drizzle-orm'
import { contacts, projects, budgets, settings, project_budgets } from './schema.js'

// Settings
export async function getSettings(userId) {
  const rows = await db.select().from(settings).where(eq(settings.user_id, userId))
  return rows[0] ?? null
}
export async function upsertSettings(userId, data) {
  return db.insert(settings)
    .values({ user_id: userId, ...data })
    .onConflictDoUpdate({ target: settings.user_id, set: { ...data, updated_at: new Date() } })
    .returning()
}

// Contacts
export async function getContacts(userId) {
  return db.select().from(contacts)
    .where(eq(contacts.user_id, userId))
    .orderBy(desc(contacts.created_at))
}
export async function createContact(userId, data) {
  return db.insert(contacts).values({ user_id: userId, ...data }).returning()
}
export async function updateContact(userId, id, data) {
  return db.update(contacts)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(contacts.id, id), eq(contacts.user_id, userId)))
    .returning()
}
export async function deleteContact(userId, id) {
  return db.delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.user_id, userId)))
}

// Projects
export async function getProjects(userId) {
  return db.select().from(projects)
    .where(eq(projects.user_id, userId))
    .orderBy(desc(projects.created_at))
}
export async function createProject(userId, data) {
  return db.insert(projects).values({ user_id: userId, ...data }).returning()
}
export async function updateProject(userId, id, data) {
  return db.update(projects)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(projects.id, id), eq(projects.user_id, userId)))
    .returning()
}
export async function deleteProject(userId, id) {
  return db.delete(projects)
    .where(and(eq(projects.id, id), eq(projects.user_id, userId)))
}

// Project ↔ Budget links
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

// Budgets
export async function getBudgets(userId) {
  return db.select().from(budgets)
    .where(eq(budgets.user_id, userId))
    .orderBy(desc(budgets.created_at))
}
export async function createBudget(userId, data) {
  return db.insert(budgets).values({ user_id: userId, ...data }).returning()
}
export async function updateBudget(userId, id, data) {
  return db.update(budgets)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(budgets.id, id), eq(budgets.user_id, userId)))
    .returning()
}
export async function deleteBudget(userId, id) {
  return db.delete(budgets)
    .where(and(eq(budgets.id, id), eq(budgets.user_id, userId)))
}
