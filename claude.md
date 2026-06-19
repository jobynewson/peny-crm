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
- `projects.js` - Project management
- `budgets.js` - Budget tracking
- `expenses.js` - Expense tracking
- `timetrack.js` - Time tracking
- `callsheets.js` / `callsheet.js` - Call sheet management
- `team-calendar.js` - Team calendar
- `leave.js` - Leave/absence management
- `story-planner.js` - Story planning
- `planning-tab.js` - Planning
- `post-production.js` - Post-production workflow
- `marketing.js` - Marketing
- `password-manager.js` - Password management
- `offload-log.js` - Offload Log (read-only table of backup reports from Fence)
