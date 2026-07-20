# Peny CRM - Project Overview

## What is this?
Peny CRM is a web-based CRM system for managing contacts, projects, budgets, timesheets, and more. It's a SPA (Single Page Application) built with vanilla JavaScript and Vite.

## Tech Stack
- **Frontend:** Vanilla JavaScript (ES modules) + Vite
- **Auth:** Clerk (handles all auth, no user table in DB)
- **Database:** PostgreSQL (Neon) via Drizzle ORM
- **File Storage:** Vercel Blob
- **Email:** Nodemailer
- **Deployment:** Vercel

## Project Structure

```
src/
  auth/clerk.js           # Clerk initialization and auth helpers
  db/
    client.js             # Database connection and query helpers
    schema.js             # Drizzle ORM schema definitions
  views/                  # Feature modules (contacts, projects, budgets, etc.)
    app.js                # Main app shell and router
    main.js               # Entry point — auth → data load → app mount
  style.css               # Global styles
index.html                # App HTML shell
```

## Key Files
- `src/app.js` - Router and main app component. Maps routes to view modules
- `src/main.js` - Bootstrap: initializes Clerk auth, loads data, mounts app
- `src/db/client.js` - ALL database queries defined here as helper methods
- `src/db/schema.js` - Drizzle ORM table definitions
- `drizzle.config.js` - Drizzle Kit config (migrations)
- `schema.sql` - Raw SQL schema (run once in Neon console)

## Important Architecture Details

### Authentication
- Clerk handles 100% of auth (signup, signin, session management)
- No user table in database — Clerk user IDs stored as `user_id TEXT` on every table
- All queries are scoped by `user_id` to isolate multi-tenant data

### Database
- Neon PostgreSQL with `@neondatabase/serverless` driver (supports edge runtimes)
- Drizzle ORM for type-safe queries
- Schemas defined in both `schema.js` (Drizzle) and `schema.sql` (raw SQL) — keep in sync

### Routing
- Client-side only (no server routes needed)
- `vercel.json` rewrites all paths to `index.html` for SPA routing to work on refresh

### Serverless Functions (Vercel) — HARD LIMIT OF 12
- Every non-underscore `*.js` file in `/api` becomes its own Vercel Serverless
  Function. **The Hobby (free) plan deploys a maximum of 12 functions — at 13
  the deployment fails.** We must ALWAYS stay at or below 12.
- **Before adding any new `/api/*.js` file, count the existing ones**
  (`ls api/*.js | grep -v '/_' | wc -l`). If we're already at 12, do NOT add a
  new file — extend an existing function instead.
- **How to add an endpoint without adding a function:**
  - Files prefixed with `_` (e.g. `api/_ratelimit.js`, `api/_dashboard.js`) are
    ignored by Vercel's function detection. Put shared logic / extra handlers in
    a `_`-prefixed module and have an existing function delegate to it.
  - Route within an existing function on a query param. Example: the public
    office dashboard lives in `api/_dashboard.js` and is invoked by
    `api/portal.js` when `?view=dashboard` — it is NOT a separate function.
    Likewise the Offload Log ingest lives in `api/_offloads.js` and is invoked
    by `api/portal.js` when `?view=offloads`. `POST /api/offloads` is a
    `vercel.json` rewrite onto `/api/portal?view=offloads`, so Fence keeps a
    clean URL without adding a function.
- Current functions (12): `ai`, `blob`, `callsheet`, `generate-ra`, `google`,
  `invite`, `maps`, `packing`, `portal`, `quote`, `reminders`, `track`.

### Brand context (Peny / Loop Creative)
Slate serves two sister brands that share crew, kit and pipeline process but keep
separate pipelines and reporting: **Peny** and **Loop Creative** (Loop targets
Shrewsbury and the surrounding area; its identity references the River Severn
loop — a teal/river accent).
- A `brand` column (`'peny' | 'loop'`, `NOT NULL DEFAULT 'peny'`, CHECK-constrained,
  indexed) lives on the **client-facing pipeline entities only**: `contacts`,
  `projects`, `budgets`, `marketing_cards`. Shared operational tools (planning
  boards, canvases, story planner, team calendar, leave, expenses, passwords,
  offload log) are deliberately **brand-agnostic** — the crew and kit are shared.
- A persistent **Peny / Loop / All** switcher sits in the topbar action cluster
  (`app.brandSwitcherHTML()` / `_bindBrandSwitcher()` / `setBrand()`), persisted
  to `localStorage['slate-brand']` and applied pre-paint via `data-brand` on
  `<html>` (see `index.html`). `[data-brand="loop"]` in `style.css` repaints the
  accent tokens teal so the whole chrome follows.
- **Scoping is done in the SQL query, not the browser.** The loaders
  `getContacts/getProjects/getBudgets/getMarketingCards` take an optional brand
  and push `brand = $1` into the Neon WHERE clause (`brandCond()` in
  `client.js`; `'all'` = no filter). Switching brand re-queries these four via
  `app._reloadBrandScoped()` and re-renders. Initial boot load in `main.js` is
  scoped by the persisted brand.
- **Subcontractors are the exception on `contacts`:** they are shared crew, so
  `getContacts` keeps `type='subcontractor'` rows visible under either brand
  (`brand = X OR type = 'subcontractor'`). Only *clients* are brand-scoped.
- **Stamping on create:** with a single brand active, new records are stamped
  that brand automatically; while **All** is active the create form shows a
  Peny/Loop picker (`app.brandForCreate()` returns the active brand or `null`).
  Records derived from a parent (budget-from-project, project duplicate,
  crew→contact) inherit the parent's brand.

### Prospecting & Outbound
Businesses we're *trying* to win live in the **same `contacts` table** as clients —
a prospect is just a contact whose `lifecycle_stage` isn't `won` yet, so
converting one to a client is a status change, not a record migration (there is
deliberately **no** separate `prospects` table).
- Prospecting columns on `contacts`: `lifecycle_stage`
  (`prospect|contacted|engaged|proposal|won|lost|nurture`, `NOT NULL DEFAULT 'won'`
  so existing clients backfill to `won`), `sector`, `tier` (`A|B|C`), `priority`
  (int, work-queue ordering), `fit_note`, `pitch_angle`, `area`, `website`,
  `source_rating`/`source_review_count` (point-in-time Google Places, nullable),
  `owner` (Clerk ID), `last_contacted_at`, `next_action_at`, `next_action`.
  `first_name` is **nullable** so a Places-sourced org with no known person is
  valid (its name lives in `company`).
- `outreach_activity` — lightweight per-org timeline (`contact_id`, `user_id`,
  `type` call|email|meeting|note, `body`). `addOutreachActivity()` bumps the
  parent's `last_contacted_at`.
- `sector_angles` — brand-scoped reusable playbook (sector, tier, why_video,
  opening_hook, offer, best_time, proof), surfaced next to a prospect when its
  sector matches.
- UI is `src/views/prospects.js` (`ProspectsView`), a new brand-scoped nav item:
  **Pipeline board** (kanban by `lifecycle_stage`, drag to move — mirrors the
  Marketing kanban using the shared `.kanban-*` styles), **List** (fast
  filter/sort + inline-edit table), **Work queue** (my overdue/due-today by
  priority — the daily driver), a **detail slide-over** (record + matching sector
  angle + outreach timeline + quick-log), and a **dashboard widget** (counts by
  stage + overdue, mounted from `renderDashboard`). The board/list exclude
  `type='subcontractor'` (shared crew).
- Prospect sectors are finer-grained than the 9 sector-angle categories, so
  `matchingAngle()` bridges them via `sectorKey()` (exact match first, then a
  canonical-key fallback) — keep that map in step if you add sectors/angles.
- **Seed:** `scripts/seed-loop-prospects.js` is a one-off, idempotent loader for
  `Loop_Creative_outbound_tracker.xlsx` (repo root). Dry-run by default,
  `--apply` to write; keyed on (brand='loop', lower(company)) / (brand,
  lower(sector)) so re-runs never duplicate. Priority is inverted from the
  sheet's 1=top scale to the app's higher=more-important int. Needs
  `VITE_DATABASE_URL`. `xlsx` (SheetJS) is a devDependency used only by this
  script — it is not imported anywhere under `src/` and never ships to Vercel.

### Views
- Each feature (contacts, projects, etc.) has a view module in `src/views/`
- View modules export a `render()` function that returns HTML
- `app.js` mounts the active view into the DOM

### Cross-feature consistency
- The app has several places where the *same kind* of UI or behaviour is
  reimplemented per-feature rather than shared via one component (this is a
  vanilla-JS app with no component framework, so duplication like this is
  normal — see "Kanban boards" below for a concrete example).
- When you change the **style or functionality of one instance of a repeated
  pattern, apply the equivalent change to every other instance**, unless
  there's a specific functional reason one of them should differ (call that
  reason out explicitly if so). Example: a style tweak to the Marketing
  kanban's card should be mirrored on the Projects kanban and Planning
  boards' kanban — don't leave one looking/behaving different from the
  others by accident.
- Before changing one, grep for the others first (e.g. `kanban`, `modal-`,
  `draggable`) so you know the full set you're keeping in sync.

### Styling / design system
- ALL global styles live in `src/style.css` — design tokens (CSS variables),
  shell (sidebar/topbar), shared components (panels, modals, kanban, forms,
  toasts), and PDF print styles. There is no injected stylesheet in JS.
- Views style themselves with inline styles that reference the CSS variables
  (`var(--bg-primary)`, `var(--accent)`, `var(--radius-md)`, …). Always use
  the variables — never hardcode colours — so light/dark themes both work.
- Light + dark themes are driven by `data-theme` on `<html>` (set before
  first paint by an inline script in `index.html`; toggled in the topbar).
- The sidebar is always dark in both themes; it uses the `--sb-*` tokens.
- Typeface is Inter (loaded in `index.html`), falling back to system fonts.

## Development Workflow

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Build for production
npm run preview      # Preview production build
```

## Environment Variables
Required (set in `.env.local` for local development, Vercel dashboard for production):
- `VITE_CLERK_PUBLISHABLE_KEY` - Public Clerk API key
- `VITE_DATABASE_URL` - Neon PostgreSQL connection string (use pooled connection)
- `DASHBOARD_TOKEN` - Fixed secret token gating the public office-display
  dashboard at `/dashboard/<token>` (served by `public/dashboard.html`, data
  from `/api/portal?view=dashboard`). Unset = the dashboard returns 503.
- `FENCE_API_KEY` - Shared secret for the Offload Log ingest endpoint
  (`POST /api/offloads`). Fence sends it as `Authorization: Bearer <key>`.
  Unset = the endpoint returns 500 (so it fails closed rather than open).

## Common Tasks

### Adding a new database table
1. Add schema to `src/db/schema.js` (Drizzle)
2. Add raw SQL to `schema.sql`
3. Add query helpers to `src/db/client.js`

### Adding a new view
1. Create `src/views/myview.js` with a `render()` function
2. Import and map in `src/app.js` router
3. Call `this.app.goTo('myview')` to navigate

### Deploying
- Push to GitHub
- Vercel auto-deploys (configure env vars in dashboard first)

## Available Views/Modules
- `contacts.js` - Contact management
- `prospects.js` - Prospecting & Outbound (brand-scoped pipeline over `contacts`)
  — board / list / work-queue / detail slide-over. See "Prospecting & Outbound".
- `projects.js` - Project management. Its kanban (pipeline by stage, plus a
  Retainer lane) is one of three separate kanban implementations — see
  "Kanban boards" below.
- `budgets.js` - Budget tracking
- `expenses.js` - Expense tracking
- `timetrack.js` - Time tracking
- `callsheets.js` / `callsheet.js` - Call sheet management
- `team-calendar.js` - Team calendar
- `leave.js` - Leave/absence management
- `story-planner.js` - Story planning
- `boards.js` - Planning boards (kanban) — standalone via the Planning nav item
  AND embedded in each project's Planning tab. Granular rows (`boards`,
  `board_columns`, `board_cards`, `board_recurrences`); card order uses
  fractional `position` (DOUBLE PRECISION) so a move writes one row. Near-
  realtime sync via 4s polling of `getBoardData()` while a board is open
  (merges pause during drag/typing/open modals). Recurring cards spawn
  client-side on load via `spawnDueBoardRecurrences()` — an atomic
  `next_due` advance stops two browsers double-spawning. One of three
  separate kanban implementations — see "Kanban boards" below.
- `canvas.js` - Planning canvas (sticky notes, images, arrows) — standalone via
  the Planning nav item's Canvases tab AND embedded in each project's Planning
  tab. Item positions are stored in canvas space; the viewport applies a single
  CSS transform. Coordinate maths is pure and unit-tested in
  `src/utils/canvas-math.js` (+ `canvas-math.test.js`, run with `npm test` /
  vitest). Same 4s polling sync pattern as boards.
- `post-production.js` - Post-production workflow
- `marketing.js` - Marketing. Its kanban (by status: Ideas → Planning → In
  Progress → Scheduled/Sent → Done) is one of three separate kanban
  implementations — see "Kanban boards" below.
- `password-manager.js` - Password management
- `offload-log.js` - Offload Log (read-only table of backup reports from Fence)

### Kanban boards
There is no shared kanban component — three independent implementations, each
with its own card drag-and-drop wiring. Per the cross-feature consistency rule
above, a style or UX change to one should normally be ported to the other two:
- `boards.js` (Planning boards) — user-defined columns (`board_columns`),
  cards ordered by fractional `board_cards.position`. Supports dragging cards
  between/within columns AND dragging to reorder columns themselves.
- `projects.js` (Projects pipeline) — fixed stage columns (`STAGES` +
  Retainer lane), cards ordered by fractional `projects.kanban_position`.
  Dragging a card between columns updates `status` (or `is_retainer` for the
  Retainer lane); columns themselves are not reorderable (they're fixed).
- `marketing.js` (Marketing kanban) — fixed status columns (`COLUMNS`), cards
  ordered by integer `marketing_cards.sort_order`. Same drag behaviour as
  Projects; columns are fixed.

All three use the same "insert between neighbours, renumber the column when
gaps run out" pattern for persisting drag order — see `_moveCard` /
`_moveProjectCard` in the respective view files.
