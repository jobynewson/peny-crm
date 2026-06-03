import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { eq, and, desc, inArray } from 'drizzle-orm'
import * as schema from './schema.js'
import {
  contacts, projects, budgets, settings, workspace,
  project_budgets, budget_versions, activity_log,
  app_users, time_entries, user_notes, social_posts, marketing_cards,
  story_plans, credentials, team_calendar_entries,
  post_production_schedules, pps_phases,
  expense_entries, expense_submissions,
  leave_requests, public_holidays,
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
  await sql`
    CREATE TABLE IF NOT EXISTS credentials (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    TEXT NOT NULL,
      program    TEXT NOT NULL,
      login      TEXT,
      password   TEXT,
      url        TEXT,
      notes      TEXT,
      category   TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS team_calendar_entries (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id       TEXT NOT NULL,
      assignee_id   UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      entry_date    DATE NOT NULL,
      entry_type    TEXT NOT NULL DEFAULT 'other',
      label         TEXT NOT NULL,
      color         TEXT,
      project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
      shoot_id      UUID REFERENCES shoots(id) ON DELETE SET NULL,
      pps_phase_id  UUID,
      budget_id     UUID REFERENCES budgets(id) ON DELETE SET NULL,
      line_label    TEXT,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE team_calendar_entries ADD COLUMN IF NOT EXISTS end_date DATE`
  await sql`ALTER TABLE team_calendar_entries ADD COLUMN IF NOT EXISTS is_deadline BOOLEAN NOT NULL DEFAULT false`
  // ── Leave planner ──────────────────────────────────────────────────────────
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_year_start_month INTEGER NOT NULL DEFAULT 4`
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_year_start_day   INTEGER NOT NULL DEFAULT 1`
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS annual_allowance NUMERIC(5,1) NOT NULL DEFAULT 25`
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS approver_id UUID`
  await sql`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id           TEXT NOT NULL,
      requester_id      UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      approver_id       UUID REFERENCES app_users(id) ON DELETE SET NULL,
      leave_type        TEXT NOT NULL DEFAULT 'holiday',
      start_date        DATE NOT NULL,
      end_date          DATE NOT NULL,
      start_half        BOOLEAN NOT NULL DEFAULT false,
      end_half          BOOLEAN NOT NULL DEFAULT false,
      total_days        NUMERIC(5,1) NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'pending',
      reason            TEXT,
      decision_note     TEXT,
      decided_by        UUID,
      decided_at        TIMESTAMPTZ,
      calendar_entry_id UUID,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS public_holidays (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id      TEXT NOT NULL,
      holiday_date DATE NOT NULL,
      name         TEXT NOT NULL DEFAULT 'Holiday',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_tokens JSONB`
  await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS gcal_event_id TEXT`
  await sql`ALTER TABLE post_production_schedules ADD COLUMN IF NOT EXISTS lead_assignee_id UUID`
  await sql`
    CREATE TABLE IF NOT EXISTS post_production_schedules (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    TEXT NOT NULL,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      start_date DATE,
      end_date   DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE post_production_schedules ADD COLUMN IF NOT EXISTS start_date DATE`
  await sql`ALTER TABLE post_production_schedules ADD COLUMN IF NOT EXISTS end_date DATE`
  await sql`
    CREATE TABLE IF NOT EXISTS pps_phases (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      schedule_id     UUID NOT NULL REFERENCES post_production_schedules(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      start_date      DATE,
      end_date        DATE,
      color           TEXT NOT NULL DEFAULT '#C47E3A',
      show_in_portal  BOOLEAN NOT NULL DEFAULT false,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE pps_phases ADD COLUMN IF NOT EXISTS assignee_id UUID`
  await sql`ALTER TABLE pps_phases ADD COLUMN IF NOT EXISTS blocks JSONB NOT NULL DEFAULT '[]'::jsonb`
  // One-time backfill: convert each legacy single-block phase (its own dates) into a block
  await sql`
    UPDATE pps_phases
    SET blocks = jsonb_build_array(jsonb_build_object(
      'id',          uuid_generate_v4()::text,
      'title',       '',
      'notes',       '',
      'start_date',  start_date::text,
      'end_date',    end_date::text,
      'color',       color,
      'assignee_id', assignee_id
    ))
    WHERE (blocks IS NULL OR blocks = '[]'::jsonb)
      AND start_date IS NOT NULL
      AND end_date   IS NOT NULL
  `
  await sql`
    CREATE TABLE IF NOT EXISTS expense_entries (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      workspace_id  TEXT NOT NULL,
      clerk_user_id TEXT NOT NULL,
      entry_date    DATE NOT NULL,
      type          TEXT NOT NULL,
      miles         NUMERIC(8,2),
      amount        NUMERIC(10,2),
      overnights    INTEGER,
      description   TEXT,
      project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
      other_title   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS expense_submissions (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      workspace_id  TEXT NOT NULL,
      clerk_user_id TEXT NOT NULL,
      month_key     TEXT NOT NULL,
      submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(clerk_user_id, month_key)
    )
  `
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS expense_recipients JSONB NOT NULL DEFAULT '[]'::jsonb`
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS mileage_rate NUMERIC(6,2) NOT NULL DEFAULT 45`

  // Migrate the legacy role tiers to the three-tier model and drop the old
  // per-permission overrides (permissions are now derived purely from role).
  // The old CHECK constraint only allowed admin/member/readonly, so it must be
  // replaced before remapping the values (and before any new user is inserted).
  await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`
  await sql`UPDATE app_users SET role = 'superadmin' WHERE role = 'admin'`
  await sql`UPDATE app_users SET role = 'user'       WHERE role = 'member'`
  await sql`UPDATE app_users SET role = 'viewer'     WHERE role = 'readonly'`
  await sql`UPDATE app_users SET permissions = '{}'::jsonb WHERE permissions <> '{}'::jsonb`
  await sql`ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('superadmin','user','viewer'))`
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
  },
  user: {
    contacts_view: true, contacts_edit: true,
    projects_view: true, projects_edit: true,
    budgets_view:  true, budgets_edit:  true,
    export:        true, settings:      true, manage_users: false,
  },
  viewer: {
    contacts_view: true, contacts_edit: false,
    projects_view: true, projects_edit: false,
    budgets_view:  true, budgets_edit:  false,
    export:        false, settings:     false, manage_users: false,
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

export async function getOrCreateAppUser(clerkUser) {
  const existing = await db.select().from(app_users)
    .where(eq(app_users.clerk_id, clerkUser.id))
  if (existing[0]) return existing[0]

  const allUsers = await db.select({ id: app_users.id }).from(app_users)
  const role = allUsers.length === 0 ? 'superadmin' : 'user'

  const [created] = await db.insert(app_users).values({
    clerk_id: clerkUser.id,
    email:    clerkUser.primaryEmailAddress?.emailAddress ?? '',
    name:     clerkUser.fullName ?? clerkUser.username ?? '',
    role,
  }).returning()
  return created
}

export async function getAllAppUsers() {
  const rows = await db.select().from(app_users).orderBy(app_users.created_at)
  // Strip raw OAuth tokens — never expose refresh_token to the browser
  return rows.map(({ google_tokens, ...rest }) => ({
    ...rest,
    google_calendar_connected: !!(google_tokens?.refresh_token),
  }))
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
      nearest_hospital_name, nearest_hospital_address, nearest_hospital_phone,
      nearest_police_name, nearest_police_address, nearest_police_phone,
      nearest_fire_name, nearest_fire_address, nearest_fire_phone,
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
      ${data.nearest_hospital_name||null}, ${data.nearest_hospital_address||null}, ${data.nearest_hospital_phone||null},
      ${data.nearest_police_name||null}, ${data.nearest_police_address||null}, ${data.nearest_police_phone||null},
      ${data.nearest_fire_name||null}, ${data.nearest_fire_address||null}, ${data.nearest_fire_phone||null},
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
      nearest_hospital_phone = ${data.nearest_hospital_phone||null},
      nearest_police_name = ${data.nearest_police_name||null},
      nearest_police_address = ${data.nearest_police_address||null},
      nearest_police_phone = ${data.nearest_police_phone||null},
      nearest_fire_name = ${data.nearest_fire_name||null},
      nearest_fire_address = ${data.nearest_fire_address||null},
      nearest_fire_phone = ${data.nearest_fire_phone||null},
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


// ── Credentials (password manager) ───────────────────────────────────────────
export async function getCredentials(workspaceId) {
  return db.select().from(credentials)
    .where(eq(credentials.user_id, workspaceId))
    .orderBy(credentials.sort_order, credentials.program)
}
export async function createCredential(workspaceId, data) {
  const [row] = await db.insert(credentials)
    .values({ user_id: workspaceId, ...data })
    .returning()
  return row
}
export async function updateCredential(workspaceId, id, data) {
  const [row] = await db.update(credentials)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(credentials.id, id), eq(credentials.user_id, workspaceId)))
    .returning()
  return row
}
export async function deleteCredential(workspaceId, id) {
  return db.delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.user_id, workspaceId)))
}

// ── Team Calendar Entries ─────────────────────────────────────────────────────
export async function getTeamCalendarEntries(workspaceId) {
  return db.select().from(team_calendar_entries)
    .where(eq(team_calendar_entries.user_id, workspaceId))
    .orderBy(team_calendar_entries.entry_date)
}
export async function createTeamCalendarEntry(workspaceId, data) {
  const [row] = await db.insert(team_calendar_entries)
    .values({ user_id: workspaceId, ...data })
    .returning()
  return row
}
export async function updateTeamCalendarEntry(workspaceId, id, data) {
  const [row] = await db.update(team_calendar_entries)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(team_calendar_entries.id, id), eq(team_calendar_entries.user_id, workspaceId)))
    .returning()
  return row
}
export async function deleteTeamCalendarEntry(workspaceId, id) {
  return db.delete(team_calendar_entries)
    .where(and(eq(team_calendar_entries.id, id), eq(team_calendar_entries.user_id, workspaceId)))
}

// ── Leave planner ─────────────────────────────────────────────────────────────
export async function getLeaveRequests(workspaceId) {
  return db.select().from(leave_requests)
    .where(eq(leave_requests.user_id, workspaceId))
    .orderBy(desc(leave_requests.start_date))
}
export async function createLeaveRequest(workspaceId, data) {
  const [row] = await db.insert(leave_requests)
    .values({ user_id: workspaceId, ...data })
    .returning()
  return row
}
export async function updateLeaveRequest(workspaceId, id, data) {
  const [row] = await db.update(leave_requests)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(leave_requests.id, id), eq(leave_requests.user_id, workspaceId)))
    .returning()
  return row
}
export async function deleteLeaveRequest(workspaceId, id) {
  return db.delete(leave_requests)
    .where(and(eq(leave_requests.id, id), eq(leave_requests.user_id, workspaceId)))
}

export async function getPublicHolidays(workspaceId) {
  return db.select().from(public_holidays)
    .where(eq(public_holidays.user_id, workspaceId))
    .orderBy(public_holidays.holiday_date)
}
export async function createPublicHoliday(workspaceId, data) {
  const [row] = await db.insert(public_holidays)
    .values({ user_id: workspaceId, ...data })
    .returning()
  return row
}
export async function deletePublicHoliday(workspaceId, id) {
  return db.delete(public_holidays)
    .where(and(eq(public_holidays.id, id), eq(public_holidays.user_id, workspaceId)))
}

// ── Post Production Schedule ──────────────────────────────────────────────────
const PPS_DEFAULT_PHASES = [
  { name: 'Shoot Blocks',    color: '#4CAF50' },
  { name: 'V1 Edits',        color: '#C47E3A' },
  { name: 'V2 Edits',        color: '#C47E3A' },
  { name: 'V3 Edits',        color: '#C47E3A' },
  { name: 'V4 Edits',        color: '#C47E3A' },
  { name: 'Client Feedback', color: '#d9534f' },
  { name: 'Final Version',   color: '#4a90d9' },
]
export async function getPpsForProject(workspaceId, projectId) {
  const schedules = await db.select().from(post_production_schedules)
    .where(and(
      eq(post_production_schedules.user_id, workspaceId),
      eq(post_production_schedules.project_id, projectId)
    ))
    .limit(1)
  if (!schedules[0]) return null
  const schedule = schedules[0]
  const phases = await db.select().from(pps_phases)
    .where(eq(pps_phases.schedule_id, schedule.id))
    .orderBy(pps_phases.sort_order, pps_phases.created_at)
  return { ...schedule, phases }
}
export async function createPpsWithDefaults(workspaceId, projectId) {
  const [schedule] = await db.insert(post_production_schedules)
    .values({ user_id: workspaceId, project_id: projectId })
    .returning()
  for (let i = 0; i < PPS_DEFAULT_PHASES.length; i++) {
    await db.insert(pps_phases).values({
      schedule_id: schedule.id,
      name:        PPS_DEFAULT_PHASES[i].name,
      color:       PPS_DEFAULT_PHASES[i].color,
      sort_order:  i,
    })
  }
  return getPpsForProject(workspaceId, projectId)
}
export async function createPpsPhase(scheduleId, data) {
  const [row] = await db.insert(pps_phases)
    .values({ schedule_id: scheduleId, ...data })
    .returning()
  return row
}
export async function updatePpsPhase(id, data) {
  const [row] = await db.update(pps_phases)
    .set({ ...data, updated_at: new Date() })
    .where(eq(pps_phases.id, id))
    .returning()
  return row
}
export async function deletePpsPhase(id) {
  return db.delete(pps_phases).where(eq(pps_phases.id, id))
}
export async function updatePpsScheduleDates(id, data) {
  const [row] = await db.update(post_production_schedules)
    .set({ ...data, updated_at: new Date() })
    .where(eq(post_production_schedules.id, id))
    .returning()
  return row
}

// ── Shoots (lightweight — for calendar auto-populate) ─────────────────────────
export async function getShootsForCalendar(workspaceId) {
  const { sql: sq } = await import('drizzle-orm')
  return db.execute(sq`
    SELECT s.id, s.project_id, s.name, s.shoot_date, s.shoot_dates, s.crew,
           p.name AS project_name
    FROM shoots s
    JOIN projects p ON p.id = s.project_id
    WHERE s.user_id = ${workspaceId}
    ORDER BY s.shoot_date NULLS LAST
  `).then(r => r.rows ?? r)
}

// ── PPS phases (lightweight — for team calendar auto-populate) ────────────────
// Returns one row per phase with its blocks JSON; the caller expands blocks that
// have a team member + dates into calendar entries.
export async function getPpsPhasesForCalendar(workspaceId) {
  const { sql: sq } = await import('drizzle-orm')
  return db.execute(sq`
    SELECT ph.id, ph.name, ph.color, ph.blocks,
           s.project_id, p.name AS project_name
    FROM pps_phases ph
    JOIN post_production_schedules s ON s.id = ph.schedule_id
    JOIN projects p ON p.id = s.project_id
    WHERE s.user_id = ${workspaceId}
    ORDER BY ph.sort_order
  `).then(r => r.rows ?? r)
}

// ── Expense entries ───────────────────────────────────────────────────────────
export async function getExpenseEntries(workspaceId, clerkUserId) {
  return db.select().from(expense_entries)
    .where(and(eq(expense_entries.workspace_id, workspaceId), eq(expense_entries.clerk_user_id, clerkUserId)))
    .orderBy(desc(expense_entries.entry_date))
}
export async function getAllExpenseEntriesForMonth(workspaceId, monthKey) {
  const { sql: dsql } = await import('drizzle-orm')
  return db.select().from(expense_entries)
    .where(and(
      eq(expense_entries.workspace_id, workspaceId),
      dsql`to_char(${expense_entries.entry_date}, 'YYYY-MM') = ${monthKey}`,
    ))
    .orderBy(expense_entries.clerk_user_id, expense_entries.entry_date)
}
export async function createExpenseEntry(data) {
  return db.insert(expense_entries).values(data).returning()
}
export async function deleteExpenseEntry(id) {
  return db.delete(expense_entries).where(eq(expense_entries.id, id))
}

// ── Expense submissions ───────────────────────────────────────────────────────
export async function getExpenseSubmissions(workspaceId, clerkUserId) {
  return db.select().from(expense_submissions)
    .where(and(eq(expense_submissions.workspace_id, workspaceId), eq(expense_submissions.clerk_user_id, clerkUserId)))
    .orderBy(desc(expense_submissions.submitted_at))
}
export async function createExpenseSubmission(data) {
  const [row] = await db.insert(expense_submissions)
    .values(data)
    .onConflictDoUpdate({ target: [expense_submissions.clerk_user_id, expense_submissions.month_key], set: { submitted_at: new Date() } })
    .returning()
  return row
}
