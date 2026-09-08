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
- `YOUTUBE_API_KEY` - Google API key with the YouTube Data API v3 enabled,
  used by the office dashboard's view-count ticker (`api/_youtube.js`). No
  OAuth, so it only reads public/unlisted videos. Unset = the ticker just
  doesn't render; the rest of the dashboard is unaffected.

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
- `projects.js` - Project management. Its kanban (pipeline by stage, plus a
  Retainer lane) is one of three separate kanban implementations — see
  "Kanban boards" below. A retainer project's Time tracking panel also
  carries a long-term usage view (calendar-month blocks, a cumulative total
  and an adjustable 12-month window) — see "Retainer time tracking" below.
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

### Retainer time tracking
- A retainer's Time tracking panel (project Overview tab, `#pv-timetrack` in
  `projects.js`) shows a long-term usage view above the existing breakdown: one
  block per calendar month, an "Overall" cumulative figure, and a 12-month
  window. Below them the entry log concertinas away (state remembered in
  `localStorage` under `slate-tt-log-open`).
- **Every block breaks down by retainer line item — there is no combined
  total anywhere in this section.** Each item gets its own logged/allocated
  figure and bar, so you can see which item is running hot rather than a sum
  that hides it. Lines with neither allocation nor logged time are omitted, so
  a fee-only item with no hours stays out of the way until time lands on it.
- Entries are matched to items by `time_entries.line_label` against
  `retainer_items[].label`, the same way the dashboard bars do it. Anything
  that matches no current item (a renamed item, or hours logged against a
  budget line before the project became a retainer) is collected into an
  "Other" line with no allocation, rather than being silently dropped. A
  retainer with no items at all runs on the legacy `retainer_hours` field as a
  single line, and every logged hour counts toward it.
- The maths is pure and unit-tested in `src/utils/retainer-usage.js`
  (+ `retainer-usage.test.js`, run with `npm test` / vitest). Nothing in the
  view does its own arithmetic — extend the module, not the template.
- **Two conventions that look like bugs but aren't:**
  - **Calendar months, not anniversary periods.** This view buckets by calendar
    month. The dashboard's retainer bar, rollover and monthly-deliverable
    resets all use periods anchored on `retainer_start`'s day-of-month
    (`_retainerPeriod` in `src/app.js`), so for a retainer that began mid-month
    the "this month" figure here will NOT match the dashboard's "this period"
    figure. Deliberate: the long view reads against months and invoices, the
    dashboard bar polices the live period.
  - **Amortised items.** A `retainer_items` entry priced per quarter/half/year
    contributes an evenly amortised share to every month (a 6h quarterly item
    is 2h/month), using the same `PERIOD_MULT` multipliers `app.js` applies. So
    a 12-month target is exactly 12x the monthly figure and a quarterly item
    lands as four quarters over the year.
- Rollover (`retainer_rollover`) is deliberately NOT applied here — the
  cumulative figure already measures total logged against total allocated, so
  applying rollover on top would count the same slack twice.
- The current month counts as a full month in the "Overall" denominator, so it
  reads as the total commitment taken on to date rather than a pro-rata figure.
- The 12-month window starts at `projects.retainer_year_start`, falling back to
  `retainer_start` when unset. Clearing the date input resets it to that
  fallback.

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
