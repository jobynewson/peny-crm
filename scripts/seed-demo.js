// Seeds a demo dataset into whatever database DATABASE_URL points at.
//
// USAGE:
//   DATABASE_URL="<demo-neon-connection-string>" DEMO_USER_ID="<demo-clerk-user-id>" node scripts/seed-demo.js
//
// Safe to re-run: it wipes any existing rows owned by DEMO_USER_ID (and their
// children) before inserting fresh demo data, so you can reset the demo
// before every call.
//
// DEMO_USER_ID must be the Clerk user ID of the account you'll log in with
// on the demo deployment (find it in the Clerk dashboard, or in the app's
// browser console via `window.Clerk.user.id` once logged in once).

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { eq } from 'drizzle-orm'
import * as schema from '../src/db/schema.js'

const DATABASE_URL = process.env.DATABASE_URL
const USER_ID = process.env.DEMO_USER_ID

if (!DATABASE_URL) throw new Error('Set DATABASE_URL to the demo database connection string')
if (!USER_ID) throw new Error('Set DEMO_USER_ID to the Clerk user id that will log into the demo')

const sql = neon(DATABASE_URL)
const db = drizzle(sql, { schema })

const {
  workspace, settings, contacts, projects, budgets, time_entries,
  app_users, marketing_cards, boards, board_columns, board_cards,
  canvases, canvas_items, social_posts, credentials,
} = schema

async function wipeExisting() {
  console.log('Wiping existing demo data for', USER_ID)
  const projectRows = await db.select({ id: projects.id }).from(projects).where(eq(projects.user_id, USER_ID))
  const boardRows = await db.select({ id: boards.id }).from(boards).where(eq(boards.user_id, USER_ID))
  const canvasRows = await db.select({ id: canvases.id }).from(canvases).where(eq(canvases.user_id, USER_ID))

  for (const b of boardRows) await db.delete(boards).where(eq(boards.id, b.id))
  for (const c of canvasRows) await db.delete(canvases).where(eq(canvases.id, c.id))
  for (const p of projectRows) await db.delete(projects).where(eq(projects.id, p.id))

  await db.delete(budgets).where(eq(budgets.user_id, USER_ID))
  await db.delete(contacts).where(eq(contacts.user_id, USER_ID))
  await db.delete(marketing_cards).where(eq(marketing_cards.user_id, USER_ID))
  await db.delete(social_posts).where(eq(social_posts.user_id, USER_ID))
  await db.delete(credentials).where(eq(credentials.user_id, USER_ID))
  // Cascades handle project_budgets, time_entries, board_columns/cards, canvas_items/arrows
}

function daysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

async function seed() {
  await db.insert(workspace).values({ owner_id: USER_ID, name: 'Peny Studio (Demo)' })
    .onConflictDoNothing()

  await db.insert(settings).values({
    user_id: USER_ID,
    company_name: 'Peny Studio',
    email: 'hello@penystudio.example',
    website: 'https://penystudio.example',
  }).onConflictDoNothing()

  // ── Contacts ────────────────────────────────────────────────────────────
  const [acme, northwind, globex] = await db.insert(contacts).values([
    { user_id: USER_ID, first_name: 'Ava', last_name: 'Chen', role: 'Marketing Director', company: 'Acme Co', email: 'ava@acme.example', phone: '+44 7700 900001', type: 'brand', status: 'Active', since: '2023' },
    { user_id: USER_ID, first_name: 'Ben', last_name: 'Okafor', role: 'Brand Manager', company: 'Northwind Ltd', email: 'ben@northwind.example', phone: '+44 7700 900002', type: 'brand', status: 'Active', since: '2024' },
    { user_id: USER_ID, first_name: 'Carla', last_name: 'Reyes', role: 'Head of Content', company: 'Globex Inc', email: 'carla@globex.example', phone: '+44 7700 900003', type: 'brand', status: 'Active', since: '2022' },
  ]).returning()

  await db.insert(contacts).values([
    { user_id: USER_ID, first_name: 'Dana', last_name: 'Price', role: 'Director of Photography', company: 'Freelance', email: 'dana@example.com', type: 'crew', status: 'Active' },
    { user_id: USER_ID, first_name: 'Eli', last_name: 'Novak', role: 'Editor', company: 'Freelance', email: 'eli@example.com', type: 'crew', status: 'Active' },
  ])

  // ── Projects (spread across pipeline stages) ───────────────────────────
  const [proj1, proj2, proj3, proj4] = await db.insert(projects).values([
    {
      user_id: USER_ID, client_id: acme.id, name: 'Acme — Summer Campaign', status: 'Enquiry',
      brief: 'Social-first summer product launch film, 3 x 30s cutdowns.', location: 'London',
      project_type: 'full_service', kanban_position: 1,
    },
    {
      user_id: USER_ID, client_id: northwind.id, name: 'Northwind — Brand Film', status: 'Confirmed',
      brief: '90s brand story film for website hero + socials.', location: 'Manchester',
      project_type: 'full_service', shoot_start: daysFromNow(14), shoot_end: daysFromNow(15), kanban_position: 1,
    },
    {
      user_id: USER_ID, client_id: globex.id, name: 'Globex — Product Shoot', status: 'In Production',
      brief: 'Studio product photography + BTS video, 40 SKUs.', location: 'Bristol studio',
      project_type: 'full_service', shoot_start: daysFromNow(-2), shoot_end: daysFromNow(1), kanban_position: 1,
    },
    {
      user_id: USER_ID, client_id: acme.id, name: 'Acme — Monthly Retainer', status: 'Confirmed',
      brief: 'Ongoing monthly social content retainer.', location: 'London',
      project_type: 'full_service', is_retainer: true, retainer_fee: '3500.00', retainer_hours: '20',
      retainer_start: daysFromNow(-60), kanban_position: 1,
    },
  ]).returning()

  // ── Budgets ─────────────────────────────────────────────────────────────
  await db.insert(budgets).values([
    {
      user_id: USER_ID, client_id: acme.id, name: 'Acme — Summer Campaign Budget',
      markup: '12', vat: true, sections: [
        { name: 'Pre-Production', lines: [{ label: 'Director prep', rate: 500, qty: 2 }] },
        { name: 'Production', lines: [{ label: 'Camera crew (2 days)', rate: 900, qty: 2 }] },
        { name: 'Post-Production', lines: [{ label: 'Edit + grade', rate: 700, qty: 3 }] },
      ],
    },
    {
      user_id: USER_ID, client_id: northwind.id, name: 'Northwind — Brand Film Budget',
      markup: '10', vat: true, signed_off: true, sections: [
        { name: 'Production', lines: [{ label: 'Full crew day rate', rate: 2200, qty: 2 }] },
      ],
    },
  ])

  // ── Time entries against the in-production job ──────────────────────────
  await db.insert(time_entries).values([
    { project_id: proj3.id, line_label: 'Shoot day 1', crew_name: 'Dana Price', hours: '10', entry_date: daysFromNow(-2) },
    { project_id: proj3.id, line_label: 'Studio setup', crew_name: 'Eli Novak', hours: '4', entry_date: daysFromNow(-2) },
  ])

  // ── Marketing kanban ──────────────────────────────────────────────────
  await db.insert(marketing_cards).values([
    { user_id: USER_ID, title: 'Instagram reel — Acme BTS', card_type: 'social', status: 'ideas', sort_order: 0 },
    { user_id: USER_ID, title: 'Case study — Northwind brand film', card_type: 'blog', status: 'planning', sort_order: 0 },
    { user_id: USER_ID, title: 'Showreel 2026 update', card_type: 'ad-hoc', status: 'in_progress', sort_order: 0 },
    { user_id: USER_ID, title: 'Newsletter — Q3 roundup', card_type: 'email', status: 'scheduled', due_date: daysFromNow(5), sort_order: 0 },
  ])

  // ── A planning board with a couple of columns/cards ────────────────────
  const [board] = await db.insert(boards).values({ user_id: USER_ID, name: 'Studio Ops' }).returning()
  const [todo, doing, done] = await db.insert(board_columns).values([
    { board_id: board.id, name: 'To Do', color: '#8590A2', sort_order: 0 },
    { board_id: board.id, name: 'Doing', color: '#5B9BD5', sort_order: 1 },
    { board_id: board.id, name: 'Done', color: '#70AD47', sort_order: 2 },
  ]).returning()
  await db.insert(board_cards).values([
    { board_id: board.id, column_id: todo.id, title: 'Book edit suite for Globex delivery', position: 1 },
    { board_id: board.id, column_id: doing.id, title: 'Colour grade — Northwind brand film', position: 1 },
    { board_id: board.id, column_id: done.id, title: 'Wrap Acme Q2 retainer content', position: 1 },
  ])

  // ── A moodboard canvas ──────────────────────────────────────────────────
  const [canvas] = await db.insert(canvases).values({ user_id: USER_ID, name: 'Acme Summer — Mood' }).returning()
  await db.insert(canvas_items).values([
    { canvas_id: canvas.id, kind: 'note', x: 40, y: 40, w: 240, h: 140, content: 'Warm, sun-bleached tones. Handheld energy.', color: '#F2C94C' },
    { canvas_id: canvas.id, kind: 'note', x: 320, y: 40, w: 240, h: 140, content: 'Reference: Aperol Spritz 2024 campaign', color: '#56CCF2' },
  ])

  console.log('Demo data seeded for user', USER_ID)
}

await wipeExisting()
await seed()
console.log('Done.')
