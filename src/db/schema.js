import { pgTable, uuid, text, boolean, numeric, jsonb, date, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const timestamps = {
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

// ── Settings ──────────────────────────────────────────────────────────────────
export const settings = pgTable('settings', {
  id:           uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  user_id:      text('user_id').notNull().unique(),
  company_name: text('company_name').notNull().default('Peny'),
  email:        text('email'),
  phone:        text('phone'),
  website:      text('website'),
  address:      text('address'),
  vat_number:   text('vat_number'),
  prepared_by:  text('prepared_by'),
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
  shoot_start: date('shoot_start'),
  shoot_end:   date('shoot_end'),
  deliverables: jsonb('deliverables').notNull().default([]),
  crew:        jsonb('crew').notNull().default([]),
  shots:       jsonb('shots').notNull().default([]),
  approvals:   jsonb('approvals').notNull().default([]),
  notes:       text('notes'),
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
  markup:      numeric('markup', { precision: 5, scale: 2 }).notNull().default('10'),
  custom_pct:  numeric('custom_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  vat:         boolean('vat').notNull().default(false),
  include_in_pipeline: boolean('include_in_pipeline').notNull().default(false),
  sections:    jsonb('sections').notNull().default([]),
  ...timestamps,
})

// ── Project ↔ Budget ──────────────────────────────────────────────────────────
export const project_budgets = pgTable('project_budgets', {
  project_id: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  budget_id:  uuid('budget_id').notNull().references(() => budgets.id,  { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
