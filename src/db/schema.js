import { pgTable, uuid, text, boolean, numeric, jsonb, date, timestamp, integer } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const timestamps = {
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

// ── Workspace ─────────────────────────────────────────────────────────────────
export const workspace = pgTable('workspace', {
  id:         uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  owner_id:   text('owner_id').notNull().unique(),
  name:       text('name').notNull().default('Peny'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Settings ──────────────────────────────────────────────────────────────────
export const settings = pgTable('settings', {
  id:              uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  user_id:         text('user_id').notNull().unique(),
  company_name:    text('company_name').notNull().default('Peny'),
  email:           text('email'),
  phone:           text('phone'),
  website:         text('website'),
  address:         text('address'),
  vat_number:      text('vat_number'),
  prepared_by:     text('prepared_by'),
  budget_template:      jsonb('budget_template'),
  financial_year_start: integer('financial_year_start').notNull().default(4),
  // Default insurance details (used as fallback for projects/shoots)
  default_insurer_name:    text('default_insurer_name'),
  default_insurer_address: text('default_insurer_address'),
  default_insurer_email:   text('default_insurer_email'),
  default_insurer_contact: text('default_insurer_contact'),
  // Invoicing boilerplate (shown on call sheets)
  invoicing_email:        text('invoicing_email'),
  invoicing_boilerplate:  text('invoicing_boilerplate'),
  ...timestamps,
})

// ── Contacts ──────────────────────────────────────────────────────────────────
export const contacts = pgTable('contacts', {
  id:         uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  user_id:    text('user_id').notNull(),
  first_name: text('first_name').notNull(),
  last_name:  text('last_name').notNull(),
  role:       text('role'),
  company:    text('company'),
  email:      text('email'),
  phone:      text('phone'),
  location:   text('location'),
  type:       text('type').notNull().default('brand'),
  status:     text('status').notNull().default('Active'),
  since:      text('since'),
  notes:      jsonb('notes').notNull().default([]),
  ...timestamps,
})

// ── Projects ──────────────────────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id:          uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  user_id:     text('user_id').notNull(),
  client_id:   uuid('client_id').references(() => contacts.id, { onDelete: 'set null' }),
  name:        text('name').notNull(),
  status:      text('status').notNull().default('Enquiry'),
  brief:       text('brief'),
  location:    text('location'),
  project_type: text('project_type').notNull().default('full_service'),
  shoot_start: date('shoot_start'),
  shoot_end:   date('shoot_end'),
  deliverables: jsonb('deliverables').notNull().default([]),
  crew:        jsonb('crew').notNull().default([]),
  shots:       jsonb('shots').notNull().default([]),
  approvals:   jsonb('approvals').notNull().default([]),
  notes:       text('notes'),
  track_token:  text('track_token'),
  portal_token: text('portal_token'),
  frame_io_link: text('frame_io_link'),
  is_retainer:      boolean('is_retainer').notNull().default(false),
  retainer_fee:     numeric('retainer_fee',   { precision: 10, scale: 2 }),
  retainer_hours:   numeric('retainer_hours', { precision: 6,  scale: 2 }),
  retainer_alert:   numeric('retainer_alert', { precision: 5,  scale: 2 }).notNull().default('80'),
  retainer_start:   date('retainer_start'),
  retainer_items:   jsonb('retainer_items').notNull().default([]),
  retainer_fee_mode: text('retainer_fee_mode').notNull().default('fixed'),
  monthly_deliverables: jsonb('monthly_deliverables').notNull().default([]),
  location_address:  text('location_address'),
  location_map_link: text('location_map_link'),
  parking_notes:     text('parking_notes'),
  nearest_transport: text('nearest_transport'),
  nearest_hospital_name:    text('nearest_hospital_name'),
  nearest_hospital_address: text('nearest_hospital_address'),
  nearest_police_name:      text('nearest_police_name'),
  nearest_police_address:   text('nearest_police_address'),
  nearest_fire_name:        text('nearest_fire_name'),
  nearest_fire_address:     text('nearest_fire_address'),
  hotels:            jsonb('hotels').notNull().default([]),
  // Per-project insurance override (falls back to settings.default_insurer_*)
  insurer_name:    text('insurer_name'),
  insurer_address: text('insurer_address'),
  insurer_email:   text('insurer_email'),
  insurer_contact: text('insurer_contact'),
  ...timestamps,
})

// ── Budgets ───────────────────────────────────────────────────────────────────
export const budgets = pgTable('budgets', {
  id:          uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  user_id:     text('user_id').notNull(),
  client_id:   uuid('client_id').references(() => contacts.id, { onDelete: 'set null' }),
  name:        text('name').notNull(),
  notes:       text('notes'),
  prepared_by: text('prepared_by'),
  quote_email: text('quote_email'),
  quote_token: text('quote_token'),
  markup:      numeric('markup', { precision: 5, scale: 2 }).notNull().default('10'),
  custom_pct:  numeric('custom_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  vat:         boolean('vat').notNull().default(false),
  insurance:   boolean('insurance').notNull().default(false),
  include_in_pipeline: boolean('include_in_pipeline').notNull().default(false),
  signed_off:    boolean('signed_off').notNull().default(false),
  signed_off_at: timestamp('signed_off_at', { withTimezone: true }),
  signed_off_by: text('signed_off_by'),
  invoiced:      boolean('invoiced').notNull().default(false),
  invoiced_at:   timestamp('invoiced_at', { withTimezone: true }),
  invoiced_by:   text('invoiced_by'),
  travel_rate: numeric('travel_rate', { precision: 5, scale: 2 }).notNull().default('50'),
  prep_rate:   numeric('prep_rate',   { precision: 5, scale: 2 }).notNull().default('100'),
  discount:    numeric('discount', { precision: 5, scale: 2 }).notNull().default('0'),
  sections:    jsonb('sections').notNull().default([]),
  ...timestamps,
})

// ── Project ↔ Budget ──────────────────────────────────────────────────────────
export const project_budgets = pgTable('project_budgets', {
  project_id: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  budget_id:  uuid('budget_id').notNull().references(() => budgets.id,  { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Time entries ──────────────────────────────────────────────────────────────
export const time_entries = pgTable('time_entries', {
  id:          uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  project_id:  uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  budget_id:   uuid('budget_id').references(() => budgets.id, { onDelete: 'set null' }),
  line_label:  text('line_label').notNull(),
  crew_name:   text('crew_name').notNull(),
  hours:       numeric('hours', { precision: 5, scale: 2 }).notNull(),
  entry_date:  date('entry_date').notNull(),
  note:        text('note'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── App users & permissions ───────────────────────────────────────────────────
export const app_users = pgTable('app_users', {
  id:           uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  clerk_id:     text('clerk_id').notNull().unique(),
  email:        text('email').notNull(),
  name:         text('name'),
  role:         text('role').notNull().default('member'),
  permissions:  jsonb('permissions').notNull().default({}),
  default_role: text('default_role'),   // e.g. "Camera Operator" — used when adding to crew
  invited_by:   text('invited_by'),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Budget versions ───────────────────────────────────────────────────────────
export const budget_versions = pgTable('budget_versions', {
  id:         uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  budget_id:  uuid('budget_id').notNull().references(() => budgets.id, { onDelete: 'cascade' }),
  user_id:    text('user_id').notNull(),
  name:       text('name').notNull().default('Auto-save'),
  is_auto:    boolean('is_auto').notNull().default(true),
  snapshot:   jsonb('snapshot').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Activity log (projects + contacts) ───────────────────────────────────────
export const activity_log = pgTable('activity_log', {
  id:          uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  user_id:     text('user_id').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id:   uuid('entity_id').notNull(),
  entity_name: text('entity_name').notNull(),
  summary:     text('summary').notNull(),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Dev requests ──────────────────────────────────────────────────────────────
export const dev_requests = pgTable('dev_requests', {
  id:         uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  user_id:    text('user_id').notNull(),
  user_name:  text('user_name').notNull().default(''),
  message:    text('message').notNull(),
  done:       boolean('done').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Work log ──────────────────────────────────────────────────────────────────
export const work_log = pgTable('work_log', {
  id:         uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  project_id: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  note:       text('note').notNull(),
  entry_date: date('entry_date').notNull(),
  created_by: text('created_by').notNull().default(''),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Call sheets ───────────────────────────────────────────────────────────────
export const call_sheets = pgTable('call_sheets', {
  id:                uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  project_id:        uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  user_id:           text('user_id').notNull(),
  sheet_date:        date('sheet_date').notNull(),
  status:            text('status').notNull().default('draft'),
  general_call:      text('general_call'),
  location_name:     text('location_name'),
  location_address:  text('location_address'),
  location_map_link: text('location_map_link'),
  weather_text:      text('weather_text'),
  weather_fetched_at: timestamp('weather_fetched_at', { withTimezone: true }),
  notes:             text('notes'),
  sheet_token:       text('sheet_token'),
  parking_notes:     text('parking_notes'),
  nearest_transport: text('nearest_transport'),
  nearest_hospital_name:    text('nearest_hospital_name'),
  nearest_hospital_address: text('nearest_hospital_address'),
  nearest_hospital_phone:   text('nearest_hospital_phone'),
  nearest_police_name:    text('nearest_police_name'),
  nearest_police_address: text('nearest_police_address'),
  nearest_police_phone:   text('nearest_police_phone'),
  nearest_fire_name:    text('nearest_fire_name'),
  nearest_fire_address: text('nearest_fire_address'),
  nearest_fire_phone:   text('nearest_fire_phone'),
  hs_notes:          text('hs_notes'),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const call_sheet_locations = pgTable('call_sheet_locations', {
  id:            uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  call_sheet_id: uuid('call_sheet_id').notNull().references(() => call_sheets.id, { onDelete: 'cascade' }),
  name:          text('name').notNull().default(''),
  address:       text('address'),
  map_link:      text('map_link'),
  move_time:     text('move_time'),
  notes:         text('notes'),
  sort_order:    integer('sort_order').notNull().default(0),
})

export const call_sheet_crew = pgTable('call_sheet_crew', {
  id:            uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  call_sheet_id: uuid('call_sheet_id').notNull().references(() => call_sheets.id, { onDelete: 'cascade' }),
  name:          text('name').notNull().default(''),
  crew_type:     text('crew_type').notNull().default('crew'),
  role:          text('role'),
  department:    text('department'),
  phone:         text('phone'),
  call_time:     text('call_time'),
  crew_token:    text('crew_token'),
  sort_order:    integer('sort_order').notNull().default(0),
})

export const call_sheet_schedule = pgTable('call_sheet_schedule', {
  id:            uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  call_sheet_id: uuid('call_sheet_id').notNull().references(() => call_sheets.id, { onDelete: 'cascade' }),
  time:          text('time').notNull().default(''),
  description:   text('description').notNull().default(''),
  sort_order:    integer('sort_order').notNull().default(0),
})

// ── Shoots ────────────────────────────────────────────────────────────────────
// Replaces call_sheets — everything about a shoot day in one row
export const shoots = pgTable('shoots', {
  id:                uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  project_id:        uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  user_id:           text('user_id').notNull(),
  name:              text('name'),
  shoot_date:        date('shoot_date'),
  shoot_dates:       jsonb('shoot_dates').notNull().default([]),
  status:            text('status').notNull().default('draft'),
  shoot_token:       text('shoot_token'),
  general_call:      text('general_call'),
  location_name:     text('location_name'),
  location_address:  text('location_address'),
  location_map_link: text('location_map_link'),
  parking_notes:     text('parking_notes'),
  nearest_transport: text('nearest_transport'),
  nearest_hospital_name:    text('nearest_hospital_name'),
  nearest_hospital_address: text('nearest_hospital_address'),
  nearest_police_name:      text('nearest_police_name'),
  nearest_police_address:   text('nearest_police_address'),
  nearest_fire_name:        text('nearest_fire_name'),
  nearest_fire_address:     text('nearest_fire_address'),
  weather_text:      text('weather_text'),
  weather_fetched_at: timestamp('weather_fetched_at', { withTimezone: true }),
  hs_notes:          text('hs_notes'),
  notes:             text('notes'),
  hotels:            jsonb('hotels').notNull().default([]),
  crew:              jsonb('crew').notNull().default([]),
  schedule:          jsonb('schedule').notNull().default([]),
  locations:         jsonb('locations').notNull().default([]),
  equipment:         jsonb('equipment').notNull().default([]),
  risk_assessment:   jsonb('risk_assessment').notNull().default({}),
  // Display-only client override (defaults from project's client.company)
  client_display:    text('client_display'),
  // Per-shoot insurance override (falls back to project, then settings)
  insurer_name:      text('insurer_name'),
  insurer_address:   text('insurer_address'),
  insurer_email:     text('insurer_email'),
  insurer_contact:   text('insurer_contact'),
  // Per-shoot invoicing (falls back to settings)
  invoicing_email:   text('invoicing_email'),
  invoicing_job_ref: text('invoicing_job_ref'),
  sort_order:        integer('sort_order').notNull().default(0),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
