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

// ── Dev requests ──────────────────────────────────────────────────────────────
export async function getDevRequests() {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    SELECT * FROM dev_requests ORDER BY created_at DESC LIMIT 200
  `).then(r => r.rows ?? r)
}

export async function addDevRequest(userId, userName, message) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    INSERT INTO dev_requests (user_id, user_name, message)
    VALUES (${userId}, ${userName}, ${message})
    RETURNING *
  `).then(r => (r.rows ?? r)[0])
}

export async function toggleDevRequest(id, done) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    UPDATE dev_requests SET done = ${done} WHERE id = ${id} RETURNING *
  `).then(r => (r.rows ?? r)[0])
}

export async function deleteDevRequest(id) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    DELETE FROM dev_requests WHERE id = ${id}
  `)
}

// ── Work log ──────────────────────────────────────────────────────────────────
export async function getWorkLog(projectId) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    SELECT * FROM work_log WHERE project_id = ${projectId}
    ORDER BY entry_date DESC, created_at DESC
  `).then(r => r.rows ?? r)
}
export async function addWorkLogEntry(projectId, note, entryDate, createdBy) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    INSERT INTO work_log (project_id, note, entry_date, created_by)
    VALUES (${projectId}, ${note}, ${entryDate}, ${createdBy})
    RETURNING *
  `).then(r => (r.rows ?? r)[0])
}
export async function deleteWorkLogEntry(id) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`DELETE FROM work_log WHERE id = ${id}`)
}

// ── Call sheets ───────────────────────────────────────────────────────────────
export async function getCallSheetsForProject(projectId) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    SELECT * FROM call_sheets WHERE project_id = ${projectId}
    ORDER BY sheet_date ASC, created_at ASC
  `).then(r => r.rows ?? r)
}
export async function getCallSheet(id) {
  const { sql } = await import('drizzle-orm')
  const [sheet] = await db.execute(sql`SELECT * FROM call_sheets WHERE id = ${id}`).then(r => r.rows ?? r)
  if (!sheet) return null
  const [crew, schedule, locations] = await Promise.all([
    db.execute(sql`SELECT * FROM call_sheet_crew WHERE call_sheet_id = ${id} ORDER BY sort_order, id`).then(r => r.rows ?? r),
    db.execute(sql`SELECT * FROM call_sheet_schedule WHERE call_sheet_id = ${id} ORDER BY sort_order, id`).then(r => r.rows ?? r),
    db.execute(sql`SELECT * FROM call_sheet_locations WHERE call_sheet_id = ${id} ORDER BY sort_order, id`).then(r => r.rows ?? r),
  ])
  return { ...sheet, crew, schedule, locations }
}
export async function createCallSheet(userId, projectId, data) {
  const { sql } = await import('drizzle-orm')
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const [sheet] = await db.execute(sql`
    INSERT INTO call_sheets (project_id, user_id, sheet_date, status, general_call,
      location_name, location_address, location_map_link, weather_text, notes, sheet_token, hotels)
    VALUES (${projectId}, ${userId}, ${data.sheet_date}, 'draft', ${data.general_call||null},
      ${data.location_name||null}, ${data.location_address||null}, ${data.location_map_link||null},
      ${data.weather_text||null}, ${data.notes||null}, ${token},
      ${JSON.stringify(data.hotels||[])}::jsonb)
    RETURNING *
  `).then(r => r.rows ?? r)
  return sheet
}
export async function updateCallSheet(id, data) {
  const { sql } = await import('drizzle-orm')
  const [sheet] = await db.execute(sql`
    UPDATE call_sheets SET
      sheet_date = ${data.sheet_date}, status = ${data.status||'draft'},
      general_call = ${data.general_call||null},
      location_name = ${data.location_name||null}, location_address = ${data.location_address||null},
      location_map_link = ${data.location_map_link||null},
      weather_text = ${data.weather_text||null},
      weather_fetched_at = ${data.weather_fetched_at||null},
      notes = ${data.notes||null},
      parking_notes = ${data.parking_notes||null},
      nearest_transport = ${data.nearest_transport||null},
      nearest_hospital_name = ${data.nearest_hospital_name||null},
      nearest_hospital_address = ${data.nearest_hospital_address||null},
      nearest_hospital_phone = ${data.nearest_hospital_phone||null},
      nearest_police_name = ${data.nearest_police_name||null},
      nearest_police_address = ${data.nearest_police_address||null},
      nearest_police_phone = ${data.nearest_police_phone||null},
      nearest_fire_name = ${data.nearest_fire_name||null},
      nearest_fire_address = ${data.nearest_fire_address||null},
      nearest_fire_phone = ${data.nearest_fire_phone||null},
      hs_notes = ${data.hs_notes||null},
      hotels = ${JSON.stringify(data.hotels||[])}::jsonb,
      updated_at = NOW()
    WHERE id = ${id} RETURNING *
  `).then(r => r.rows ?? r)
  return sheet
}
export async function deleteCallSheet(id) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`DELETE FROM call_sheets WHERE id = ${id}`)
}
export async function saveCallSheetCrew(callSheetId, crewRows) {
  const { sql } = await import('drizzle-orm')
  await db.execute(sql`DELETE FROM call_sheet_crew WHERE call_sheet_id = ${callSheetId}`)
  for (let i = 0; i < crewRows.length; i++) {
    const c = crewRows[i]
    const token = c.crew_token || (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))
    await db.execute(sql`
      INSERT INTO call_sheet_crew (call_sheet_id, name, crew_type, role, department, phone, call_time, crew_token, sort_order)
      VALUES (${callSheetId}, ${c.name||''}, ${c.crew_type||'crew'}, ${c.role||null}, ${c.department||null}, ${c.phone||null}, ${c.call_time||null}, ${token}, ${i})
    `)
  }
  return db.execute(sql`SELECT * FROM call_sheet_crew WHERE call_sheet_id = ${callSheetId} ORDER BY sort_order`).then(r => r.rows ?? r)
}
export async function saveCallSheetSchedule(callSheetId, rows) {
  const { sql } = await import('drizzle-orm')
  await db.execute(sql`DELETE FROM call_sheet_schedule WHERE call_sheet_id = ${callSheetId}`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    await db.execute(sql`
      INSERT INTO call_sheet_schedule (call_sheet_id, time, description, sort_order)
      VALUES (${callSheetId}, ${r.time||''}, ${r.description||''}, ${i})
    `)
  }
}
export async function saveCallSheetLocations(callSheetId, rows) {
  const { sql } = await import('drizzle-orm')
  await db.execute(sql`DELETE FROM call_sheet_locations WHERE call_sheet_id = ${callSheetId}`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    await db.execute(sql`
      INSERT INTO call_sheet_locations (call_sheet_id, name, address, map_link, move_time, notes, sort_order)
      VALUES (${callSheetId}, ${r.name||''}, ${r.address||null}, ${r.map_link||null}, ${r.move_time||null}, ${r.notes||null}, ${i})
    `)
  }
}

// ── Quote (client budget link) ────────────────────────────────────────────────
export async function getBudgetByQuoteToken(token) {
  const { sql } = await import('drizzle-orm')
  const rows = await db.execute(sql`
    SELECT b.*, c.first_name, c.last_name, c.company,
           s.company_name, s.address, s.email, s.phone, s.website, s.vat_number
    FROM budgets b
    LEFT JOIN contacts c ON c.id = b.client_id
    LEFT JOIN settings s ON s.user_id = b.user_id
    WHERE b.quote_token = ${token}
    LIMIT 1
  `).then(r => r.rows ?? r)
  return rows[0] || null
}
export async function setQuoteToken(userId, budgetId, token) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    UPDATE budgets SET quote_token = ${token} WHERE id = ${budgetId} AND user_id = ${userId} RETURNING *
  `).then(r => (r.rows ?? r)[0])
}
