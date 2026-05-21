import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { eq, and, desc, inArray } from 'drizzle-orm'
import * as schema from './schema.js'
import {
  contacts, projects, budgets, settings, workspace,
  project_budgets, budget_versions, activity_log,
  app_users, time_entries, user_notes, social_posts, marketing_cards,
  story_plans,
} from './schema.js'

const sql = neon(import.meta.env.VITE_DATABASE_URL)
export const db = drizzle(sql, { schema })

// ── Schema migrations ─────────────────────────────────────────────────────────
export async function runMigrations() {
  await sql`
    CREATE TABLE IF NOT EXISTS marketing_cards (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id       TEXT NOT NULL,
      title         TEXT NOT NULL,
      card_type     TEXT NOT NULL DEFAULT 'ad-hoc',
      status        TEXT NOT NULL DEFAULT 'ideas',
      lead_owner_id TEXT,
      due_date      DATE,
      notes         TEXT,
      sub_tasks     JSONB NOT NULL DEFAULT '[]'::jsonb,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS story_plans (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    TEXT NOT NULL,
      title      TEXT NOT NULL,
      blocks     JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    ALTER TABLE story_plans ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL
  `
}

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

export async function deleteAppUser(id) {
  return db.delete(app_users).where(eq(app_users.id, id))
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

// ── Social calendar ───────────────────────────────────────────────────────────
export async function getSocialPosts(workspaceId) {
  return db.select().from(social_posts)
    .where(eq(social_posts.user_id, workspaceId))
    .orderBy(social_posts.sort_order, social_posts.created_at)
}
export async function createSocialPost(workspaceId, data) {
  const [post] = await db.insert(social_posts)
    .values({ user_id: workspaceId, ...data })
    .returning()
  return post
}
export async function updateSocialPost(workspaceId, id, data) {
  const [post] = await db.update(social_posts)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(social_posts.id, id), eq(social_posts.user_id, workspaceId)))
    .returning()
  return post
}
export async function deleteSocialPost(workspaceId, id) {
  return db.delete(social_posts)
    .where(and(eq(social_posts.id, id), eq(social_posts.user_id, workspaceId)))
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
  const token = crypto.randomUUID().replace(/-/g, '')
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
    const token = c.crew_token || crypto.randomUUID().replace(/-/g, '')
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

// ── Shoots ────────────────────────────────────────────────────────────────────
export async function getShoots(userId, projectId) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    SELECT * FROM shoots
    WHERE user_id = ${userId} AND project_id = ${projectId}
    ORDER BY shoot_date NULLS LAST, sort_order, created_at
  `).then(r => r.rows ?? r)
}
export async function getShoot(id) {
  const { sql } = await import('drizzle-orm')
  const [shoot] = await db.execute(sql`SELECT * FROM shoots WHERE id = ${id}`).then(r => r.rows ?? r)
  return shoot || null
}
export async function createShoot(userId, projectId, data) {
  const { sql } = await import('drizzle-orm')
  const token = crypto.randomUUID().replace(/-/g, '')
  const [shoot] = await db.execute(sql`
    INSERT INTO shoots (
      project_id, user_id, name, shoot_date, status, shoot_token,
      general_call, location_name, location_address, location_map_link,
      parking_notes, nearest_transport,
      nearest_hospital_name, nearest_hospital_address,
      nearest_police_name, nearest_police_address,
      nearest_fire_name, nearest_fire_address,
      weather_text, hs_notes, notes,
      hotels, crew, schedule, locations, shoot_dates,
      equipment, client_display,
      insurer_name, insurer_address, insurer_email, insurer_contact,
      invoicing_email, invoicing_job_ref,
      crew_section_notes, catering
    ) VALUES (
      ${projectId}, ${userId}, ${data.name||null}, ${data.shoot_date||null}, 'draft', ${token},
      ${data.general_call||null}, ${data.location_name||null}, ${data.location_address||null}, ${data.location_map_link||null},
      ${data.parking_notes||null}, ${data.nearest_transport||null},
      ${data.nearest_hospital_name||null}, ${data.nearest_hospital_address||null},
      ${data.nearest_police_name||null}, ${data.nearest_police_address||null},
      ${data.nearest_fire_name||null}, ${data.nearest_fire_address||null},
      ${data.weather_text||null}, ${data.hs_notes||null}, ${data.notes||null},
      ${JSON.stringify(data.hotels||[])}::jsonb,
      ${JSON.stringify(data.crew||[])}::jsonb,
      ${JSON.stringify(data.schedule||[])}::jsonb,
      ${JSON.stringify(data.locations||[])}::jsonb,
      ${JSON.stringify(data.shoot_dates||[])}::jsonb,
      ${JSON.stringify(data.equipment||[])}::jsonb,
      ${data.client_display||null},
      ${data.insurer_name||null}, ${data.insurer_address||null},
      ${data.insurer_email||null}, ${data.insurer_contact||null},
      ${data.invoicing_email||null}, ${data.invoicing_job_ref||null},
      ${JSON.stringify(data.crew_section_notes||{})}::jsonb,
      ${JSON.stringify(data.catering||{})}::jsonb
    ) RETURNING *
  `).then(r => r.rows ?? r)
  return shoot
}
export async function updateShoot(id, data) {
  const { sql } = await import('drizzle-orm')
  const [shoot] = await db.execute(sql`
    UPDATE shoots SET
      name = ${data.name||null},
      shoot_date = ${data.shoot_date||null},
      status = ${data.status||'draft'},
      general_call = ${data.general_call||null},
      location_name = ${data.location_name||null},
      location_address = ${data.location_address||null},
      location_map_link = ${data.location_map_link||null},
      parking_notes = ${data.parking_notes||null},
      nearest_transport = ${data.nearest_transport||null},
      nearest_hospital_name = ${data.nearest_hospital_name||null},
      nearest_hospital_address = ${data.nearest_hospital_address||null},
      nearest_police_name = ${data.nearest_police_name||null},
      nearest_police_address = ${data.nearest_police_address||null},
      nearest_fire_name = ${data.nearest_fire_name||null},
      nearest_fire_address = ${data.nearest_fire_address||null},
      weather_text = ${data.weather_text||null},
      weather_fetched_at = ${data.weather_fetched_at||null},
      hs_notes = ${data.hs_notes||null},
      notes = ${data.notes||null},
      hotels = ${JSON.stringify(data.hotels||[])}::jsonb,
      crew = ${JSON.stringify(data.crew||[])}::jsonb,
      schedule = ${JSON.stringify(data.schedule||[])}::jsonb,
      locations = ${JSON.stringify(data.locations||[])}::jsonb,
      shoot_dates = ${JSON.stringify(data.shoot_dates||[])}::jsonb,
      equipment = ${JSON.stringify(data.equipment||[])}::jsonb,
      risk_assessment = ${JSON.stringify(data.risk_assessment||{})}::jsonb,
      client_display    = ${data.client_display||null},
      insurer_name      = ${data.insurer_name||null},
      insurer_address   = ${data.insurer_address||null},
      insurer_email     = ${data.insurer_email||null},
      insurer_contact   = ${data.insurer_contact||null},
      invoicing_email   = ${data.invoicing_email||null},
      invoicing_job_ref = ${data.invoicing_job_ref||null},
      crew_section_notes = ${JSON.stringify(data.crew_section_notes||{})}::jsonb,
      catering = ${JSON.stringify(data.catering||{})}::jsonb,
      shoot_camera_setups = ${JSON.stringify(data.shoot_camera_setups||[])}::jsonb,
      updated_at = NOW()
    WHERE id = ${id} RETURNING *
  `).then(r => r.rows ?? r)
  return shoot
}
export async function deleteShoot(id) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`DELETE FROM shoots WHERE id = ${id}`)
}

// Find all shoots that have a risk assessment (for the "copy from" picker)
export async function getShootsWithRA(userId) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    SELECT sh.id, sh.name, sh.shoot_date, sh.location_name, sh.risk_assessment,
           p.name AS project_name
    FROM shoots sh
    JOIN projects p ON p.id = sh.project_id
    WHERE sh.user_id = ${userId}
      AND sh.risk_assessment IS NOT NULL
      AND sh.risk_assessment != '{}'::jsonb
      AND sh.risk_assessment->'hazards' IS NOT NULL
      AND jsonb_array_length(sh.risk_assessment->'hazards') > 0
    ORDER BY sh.shoot_date DESC NULLS LAST, sh.created_at DESC
    LIMIT 50
  `).then(r => r.rows ?? r)
}

// ── Camera setup library ──────────────────────────────────────────────────────
export async function getCameraSetups(userId) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`
    SELECT * FROM camera_setups WHERE user_id = ${userId} ORDER BY name
  `).then(r => r.rows ?? r)
}
export async function createCameraSetup(userId, data) {
  const { sql } = await import('drizzle-orm')
  const [row] = await db.execute(sql`
    INSERT INTO camera_setups (user_id, name, notes, custom_items)
    VALUES (${userId}, ${data.name}, ${data.notes||null}, ${JSON.stringify(data.custom_items||[])}::jsonb)
    RETURNING *
  `).then(r => r.rows ?? r)
  return row
}
export async function updateCameraSetup(id, userId, data) {
  const { sql } = await import('drizzle-orm')
  const [row] = await db.execute(sql`
    UPDATE camera_setups SET
      name = ${data.name}, notes = ${data.notes||null},
      custom_items = ${JSON.stringify(data.custom_items||[])}::jsonb,
      updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId} RETURNING *
  `).then(r => r.rows ?? r)
  return row
}
export async function deleteCameraSetup(id, userId) {
  const { sql } = await import('drizzle-orm')
  return db.execute(sql`DELETE FROM camera_setups WHERE id = ${id} AND user_id = ${userId}`)
}

// ── User notes ────────────────────────────────────────────────────────────────
export async function getUserNotes(clerkId) {
  return db.select().from(user_notes)
    .where(eq(user_notes.clerk_id, clerkId))
    .orderBy(user_notes.sort_order, desc(user_notes.created_at))
}
export async function createUserNote(clerkId, data = {}) {
  const [row] = await db.insert(user_notes)
    .values({ clerk_id: clerkId, title: data.title ?? '', content: data.content ?? '', sort_order: data.sort_order ?? 0 })
    .returning()
  return row
}
export async function updateUserNote(clerkId, id, data) {
  const [row] = await db.update(user_notes)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(user_notes.id, id), eq(user_notes.clerk_id, clerkId)))
    .returning()
  return row
}
export async function deleteUserNote(clerkId, id) {
  return db.delete(user_notes)
    .where(and(eq(user_notes.id, id), eq(user_notes.clerk_id, clerkId)))
}

// ── Marketing cards ───────────────────────────────────────────────────────────
export async function getMarketingCards(workspaceId) {
  return db.select().from(marketing_cards)
    .where(eq(marketing_cards.user_id, workspaceId))
    .orderBy(marketing_cards.sort_order, desc(marketing_cards.created_at))
}
export async function createMarketingCard(workspaceId, data) {
  const [card] = await db.insert(marketing_cards)
    .values({ user_id: workspaceId, ...data })
    .returning()
  return card
}
export async function updateMarketingCard(workspaceId, id, data) {
  const [card] = await db.update(marketing_cards)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(marketing_cards.id, id), eq(marketing_cards.user_id, workspaceId)))
    .returning()
  return card
}
export async function deleteMarketingCard(workspaceId, id) {
  return db.delete(marketing_cards)
    .where(and(eq(marketing_cards.id, id), eq(marketing_cards.user_id, workspaceId)))
}

// ── Story Planner ─────────────────────────────────────────────────────────────
export async function getStoryPlans(workspaceId) {
  return db.select().from(story_plans)
    .where(eq(story_plans.user_id, workspaceId))
    .orderBy(desc(story_plans.created_at))
}
export async function createStoryPlan(workspaceId, data) {
  const [plan] = await db.insert(story_plans)
    .values({ user_id: workspaceId, title: data.title, blocks: data.blocks ?? [] })
    .returning()
  return plan
}
export async function updateStoryPlan(workspaceId, id, data) {
  const [plan] = await db.update(story_plans)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(story_plans.id, id), eq(story_plans.user_id, workspaceId)))
    .returning()
  return plan
}
export async function deleteStoryPlan(workspaceId, id) {
  return db.delete(story_plans)
    .where(and(eq(story_plans.id, id), eq(story_plans.user_id, workspaceId)))
}
