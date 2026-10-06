# Peny CRM - Project Overview

## What is this?
Peny CRM is a web-based CRM system for managing contacts, projects, budgets, timesheets, and more. It's a SPA (Single Page Application) built with vanilla JavaScript and Vite.

## Tech Stack
- **Frontend:** Vanilla JavaScript (ES modules) + Vite
- **Auth:** Clerk (identity provider; `app_users` is the DB-side user table)
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
                          # plus the shell's header, menus and shared forms
  app.js                  # Main app shell and router
  main.js                 # Entry point — auth → data load → app mount
  portal/                 # The client portal page (its own bundle)
  tokens.css              # Theme tokens (Warm Paper / Darkroom)
  theme.js                # System / Light / Dark choice
  style.css               # Global styles
index.html                # App HTML shell
portal.html               # Client portal HTML shell (/portal, /portal/<token>)
```

## Key Files
- `src/app.js` - Router and main app component. Maps routes to view modules,
  renders the shell (header, page toolbar, Notes panel, phone tab bar)
- `src/views/header.js` - The header: top tabs, search, Log time, New, Notes
  and the account menu (see "App shell" below)
- `src/main.js` - Bootstrap: initializes Clerk auth, loads data, mounts app
- `src/db/client.js` - ALL database queries defined here as helper methods
- `src/db/schema.js` - Drizzle ORM table definitions
- `drizzle.config.js` - Drizzle Kit config (migrations)
- `schema.sql` - Raw SQL schema (run once in Neon console)

## Important Architecture Details

### Authentication
- Clerk handles signup, signin and session management.
- There IS a user table: `app_users` (`id` UUID pk, `clerk_id TEXT` unique,
  email, name, role). Clerk is the identity provider; `app_users` is the row
  the rest of the schema points at.
- **Two identity conventions exist — know which one a column uses:**
  - `app_users.id` (UUID): `board_cards.assignee_id`, `tasks.assignee_id`,
    `projects.deliverables[].assignee_id`, `leave_requests.*`, and all the
    `task_*` tables.
  - Clerk ID (TEXT): `marketing_cards.lead_owner_id`,
    `canvas_items.sub_tasks[].owner_id`, `user_notes.user_id`.
- **Clients and staff share one Clerk instance.** A client portal user is a
  member of their company's Clerk organization and never gets an `app_users`
  row. So a valid Clerk session proves who someone is, not that they work at
  Peny:
  - `api/_auth.js` is the only file that verifies a Clerk token
    (`verifyClerkSession` for the raw claims, `verifyClerkUser` for a Slate
    user). Every staff endpoint uses `verifyClerkUser`, which answers 403
    `not_provisioned` when there's no `app_users` row.
    `api/_staff-only.test.js` fails if another file calls `verifyToken`, and
    checks every staff endpoint refuses a client session.
  - `app_users` rows are created by the server only: `POST /api/me`
    (`api/_me.js`), which the app calls first at boot, before migrations or
    any workspace data. It returns your row, creating it on your first
    sign-in **only if you were invited**: Settings › Users › Send invite
    (`POST /api/invite`, superadmins) records a staff invitation
    (`staff_invitations`, `drizzle/0035`), and the first sign-in by an
    account with that address *verified* uses it up and gets a 'user' row.
    The very first Slate user needs no invitation ('superadmin').
    - A member of any Clerk org is a client: no row, invited or not, and
      the 403 `portal_account` sends the browser to `/portal`. Staff who are
      added to a client's org keep the app (they already have a row).
      `/api/invite` refuses a client's address up front.
    - Anyone else gets 403 `not_invited` and a sign-out screen. Signing up to
      Clerk is never enough.
    - An invitation works once, so removing someone from Slate (deleting
      their row) keeps them out until they're invited again.
    - Someone who already has a Clerk account is invited the same way; Clerk
      just doesn't email them (they sign in as they are).
- `user_id TEXT` on a table means the **workspace owner's Clerk ID**, not the
  row's author. There is one shared workspace (`getOrCreateWorkspace` returns
  the first user's Clerk ID and every query scopes by it) — this is shared-team
  scoping, not per-user multi-tenant isolation.

### Database access
- **The browser has no database credential.** `src/db/client.js` runs the
  Neon driver and drizzle as before, but every query goes to `POST /api/db`
  (`api/db.js`), which checks the caller is a Slate user (`verifyClerkUser`
  with `remember: true`: the answer is kept for a minute per warm instance)
  and forwards the query to Neon with `DATABASE_URL`. Neon's answer is
  streamed back untouched, so the driver can't tell the difference. A
  client's session or a stranger's gets 403 / 401. The driver starts from a
  placeholder connection string (`…@database.invalid/…`) that is never sent.
- **The proxy checks who, not what.** Any Slate user can run any query, as
  they always could: the app builds its queries in the browser. So the rules
  in server-owned APIs (the task board, companies, the retainer worklist)
  hold against clients and the public, not against staff.
- **New data still goes through its own `/api` routes**, never through
  `src/db/client.js`: companies, the retainer worklist, notification
  settings. The rules stay in one place, and it's the path the rest would
  take if staff queries ever move server-side too.
- **The build keeps the credential out** (`scripts/_credential-guard.js`, a
  Vite plugin in `vite.config.js`). It fails when a `VITE_` variable holds a
  connection string (Vite builds every `VITE_` variable into the public
  JavaScript), when a Vercel build has no `DATABASE_URL`, or when any built
  file contains `DATABASE_URL`, its password or a Neon connection string. A
  failed build leaves the last good deployment serving.
- **What the hop costs.** Every browser query is a function invocation, and
  its latency is browser → Vercel function → Neon, so the function region
  should be the Neon database's region. Vercel refuses a request body over
  4.5 MB; the answer is streamed rather than buffered, which is how Vercel
  lets a response go past that size.
- Your own `app_users` row comes from the server too (`POST /api/me`, above).
- **Rotating the credential**: reset the role's password in Neon, put the new
  connection string in Vercel's `DATABASE_URL`, then redeploy (an env change
  only reaches new deployments). Queries fail between the reset and the
  redeploy, so do it at a quiet moment.
- The browser calls Slate's own APIs through `request()` in `src/api/http.js`
  (Bearer Clerk token, errors thrown with `code` / `field` / `status`).

### Migrations
- **`drizzle/*.sql` files are a hand-written record, not a tool output.** There
  is no `drizzle/meta/` and no `drizzle-kit generate` step in this repo.
- The path that actually runs is `runMigrations()` in `src/db/client.js`:
  idempotent `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` /
  `CREATE INDEX IF NOT EXISTS`, executed **from the browser on every app boot**
  (`src/main.js`). Anything added there must be safe to re-run every time.
- Use `uuid_generate_v4()`, not `gen_random_uuid()` — it is what every existing
  table uses.
- **Boot runs them only when the database is behind.** `runMigrations()` reads
  one row (`schema_version`, created by the first run) and
  returns if it's at or past `SCHEMA_VERSION`; otherwise it runs
  `applyMigrations()` and records the version last. Every statement is a
  browser → function → Neon round trip, so running ~155 of them on every load
  made the first open slow. **When you add a statement to `applyMigrations()`,
  bump `SCHEMA_VERSION`**: `src/db/migrations-version.test.js` pins a hash of
  the statements and tells you the new one to paste in.
- `main.js` awaits `runMigrations()` without a catch, so a statement that
  throws stops the app loading for everyone.
- Changing an existing column or constraint (not just adding one) needs a
  guarded `DO $$` block that checks the catalog first and only alters what
  still needs it, so later boots don't take a table lock and several browsers
  booting at once can't trip over each other. Catch failures inside the block
  and `RAISE WARNING` instead. The 0031 block (making `tasks.created_by`
  nullable) is the pattern.

### Database
- Neon PostgreSQL with `@neondatabase/serverless` driver (supports edge runtimes)
- Drizzle ORM for type-safe queries
- Schemas defined in both `schema.js` (Drizzle) and `schema.sql` (raw SQL) — keep in sync

### Routing
- Client-side only (no server routes needed)
- `vercel.json` rewrites all paths to `index.html` for SPA routing to work on refresh
- Routes are hashes: `#view`, `#view/<id>`, `#projects/<id>/<tab>`. `/` (no
  hash, or `#dashboard`) is the dashboard, the home page, and `#tasks` the
  task board; an unknown hash lands on the dashboard. `VIEWS` in `src/app.js` lists every route
  the app has used; keep old ones there so bookmarks never break.
  `_parseHash()` reads a URL and `navigate(view)` moves between views.
- `app.openLink(hash)` opens an in-app link (the What's due feed's links) as
  though it had been typed in the address bar. Tasks and marketing cards have
  no address of their own, so `#tasks/<id>` and `#marketing/<cardId>` go to
  their page and open the task or card there.
- An unknown project tab (e.g. an old `#projects/<id>/files` link) falls back
  to Overview.

### App shell
There is no sidebar. The shell is a header over the page:
- **Header** (`src/views/header.js`, 64px): the Slate logo (links home),
  five top tabs and, on the right, search (⌘K / Ctrl K), Log time, New,
  Notes, the notification bell and the avatar. The tabs are real links.
  `TABS` sets which routes light each one: Dashboard = `dashboard`; Tasks =
  `tasks`; Calendar = `calendar`; Projects = `projects`, `budgets`,
  `planning` and `retainers`; Contacts = `contacts`. Pages opened from the account menu light
  no tab.
- **Logo**: `public/slate-logo.png`, a black lockup on a transparent ground,
  turned white in Darkroom by `--logo-filter` (the sign-in screen does the
  same). 28px tall, smaller on narrow screens.
- **Narrower screens** (769–1360px) fold the header so the tabs keep their
  room: at 1360px and below the search box becomes an icon, at 1140px and
  below Log time and New lose their labels, and at 900px and below the logo,
  tabs and gaps tighten. The labels stay as each button's accessible name
  and tooltip. If you add to the header, re-check it at 769px.
- **Account menu** (avatar): Tools (Marketing, Offload Log, Story Planner, Personal Tools),
  Workspace (Team & roles, Leave with the approvals badge, Expenses,
  Passwords for vault users, Dev request), Theme (System | Light | Dark), then
  Settings, Keyboard shortcuts and Sign out. Tools is where new productivity
  tools go if they don't fit the tabs. **New** opens a small menu (Task,
  Project, Contact, Budget, Note).
- **Bell**: task notifications, with the unread count. It opens the list
  under the button (a bottom sheet on phones). See "Tasks system".
- **Floating panels** go through `openFloating()` in `src/views/popover.js`.
  One open at a time; each closes on Escape, an outside click or
  navigation, and hands focus back to its button. Menus use `role="menu"`
  with arrow keys; Log time is a `role="dialog"`. On phones the same call
  opens a bottom sheet instead (see "Phones" below).
- **Page toolbar**: the first row of each list page (`toolbarHtml()` in
  `src/app.js`): the view switcher (All projects · Budgets · Planning
  under the Projects tab) or the page's own tabs, then filters,
  then primary actions on the right. Pages don't repeat their title. Detail
  pages (a project, budget, board, plan) hide it and use
  their own header row. A
  project's row starts with a "Projects / <name>" breadcrumb.
- **A page can fill in the toolbar itself**: implement `toolbar()` returning
  `{ tabs, filters, actions }` (HTML, any of them optional) and
  `bindToolbar(bar)`, and list the view in `_toolbarOwner()` in
  `src/app.js`. `src/views/toolbar.js` has the pieces: `segTabs()` for tabs
  within a page (Leave, Settings, Marketing, Planning's Boards · Canvases),
  `toolbarSearch()` for a search box. When a page's own state changes what
  the toolbar shows (a tab, a count), call `app.updateTitle()` to redraw it.
  Keep search boxes in the toolbar, not in the page body: a page that
  redraws its body on each keystroke would otherwise rebuild the box and
  lose the cursor.
- **Page layout**: every page starts at the same left edge as the header and
  uses the full width. No `max-width` columns and no centring. Figures go in
  `.stats-row` / `.stat-card`, content in `.panel`s. For a form next to what
  it adds to, use `.page-split` (Expenses, the old time tracker). For panels
  side by side as space allows, use `.panel-grid`, with `.panel-grid-wide`
  for one that spans the row (Settings). For sets of cards, use `.card-grid`
  (Story Planner, Planning). All of these stack on narrow screens.
- **Notes** (the header's Notes button) docks as a panel on the right of the
  page on desktop and remembers being open (`slate-notes-open`). On phones
  it's a full-screen sheet that closes when you navigate.
- Icons are inline SVGs from `icon(name, size)` in `src/views/icons.js`.
- **Search** (⌘K, or the header's search box; `_openSearch()` in
  `src/app.js`) finds records (contacts, projects, budgets, marketing cards,
  shoots, notes) and Slate's own pages and actions: "expenses" goes to
  Expenses, "holiday" to Leave, "new project" opens the new project form,
  "dark" switches the theme. Pages and actions are listed in
  `src/views/search-commands.js` with the words people might use for them,
  filtered by the same permissions as the menus; `src/utils/command-search.js`
  matches them (every word must start a word in the label or keywords) and is
  unit-tested. Add a new page or action to that list, with keywords. Arrow
  keys move through the results and Enter opens the highlighted one.

### Phones (≤768px)
- 56px header (logo, Log time, search, Notes, bell, avatar; no hamburger) and
  a bottom tab bar with the same five tabs. `--header-h`, `--tabbar-h` and
  `--chrome-h` in `tokens.css` hold the chrome's height for views that fill
  the screen (e.g. the canvas).
- The account menu and Log time open as bottom sheets: a dimmed backdrop, a
  grab handle and a close button. Focus stays inside and the page behind is
  `inert`. The New menu is desktop-only; on phones each page's toolbar has
  its own "+ New …" button.
- The Projects, Marketing and Planning kanbans show one column at a time,
  picked with a segmented status control (`mountStatusSwitch()` in
  `src/views/board-status.js`; the control is hidden on desktop).
- Touch targets are at least 44px and fields 16px (so iOS doesn't zoom);
  those rules live in the `max-width: 768px` block near the end of
  `style.css`. `viewport-fit=cover` is set, so pad fixed chrome with
  `env(safe-area-inset-*)`. Use `dvh` with a `vh` fallback for full heights.

### Personal Tools and Training
- **Personal Tools** (`#personal-tools`, `src/views/personal-tools.js`) is a page
  of cards for tools that belong to the signed-in person. To add a tool: add an
  entry to `TOOLS` in that file, a route in `app.js` (`VIEWS` + `render`) and a
  search command.
- **Training** (`#training`) is a home strength app: an 8-week plan (A/B/C
  sessions, Foundation / Strength / Power), Build a session, an exercise
  library and a guided timer. Staff only, like every Slate page.
  - `src/training/data.js`: all content (exercises, how-to details, per-sport
    programs, stretches, sports, cool-down areas, "why it matters" lines).
    `WHY` is the general line; `SPORT_WHY[sport][id]` overrides it (the MTB
    lines are the original text). Edit here, not in the views.
  - `src/training/engine.js`: prescriptions, time estimates, the cool-down
    builder, session generation, the timer's step list (no DOM; unit-tested).
  - `src/training/player.js` (timer), `wakelock.js` (Screen Wake Lock, with the
    silent-video fallback only when the API is missing or refused),
    `store.js` (instant saves, offline queue in localStorage per person),
    `src/views/training.js` (UI).
  - The cool-down is **built from the person's chosen areas**, not fixed per
    session: one stretch per area, about 5 minutes; more areas than fit rotate
    across A, B and C (`coolDown()`).
  - Progress is per sport (`training_sessions.sport`), so changing sport starts
    that sport's plan fresh and keeps the other's history.
- **Data**: `training_profiles` and `training_sessions` (`drizzle/0046`, keyed by
  Clerk id like `notification_settings`), read and written only through
  `/api/training` (`api/training.js` + `api/_training.js`, the shared
  `dispatch()` router). Every query is filtered by the verified session's
  Clerk id, never an id from the browser. `api/db.js` refuses any statement
  naming these tables (apart from the boot `CREATE … IF NOT EXISTS`), so the
  browser's query proxy can't read them. That is an application-level guard: a
  determined staff member who can run arbitrary SQL through `/api/db` could
  still get round it (for example with dynamic SQL), so true isolation needs a
  separate database role.
- Viewers can use Training: it only touches their own rows.

### PDF Generator
- **PDF Generator** (`#pdf-generator`, `#pdf-generator/<id>`; avatar menu ›
  Tools) makes documents in the quote PDF's look and keeps them in a
  **shared** library: everyone on staff sees and edits the same documents
  (rows are scoped to the workspace owner, `created_by` / `updated_by` record
  who saved). Viewers can open and print but not change.
  - `src/pdf/onepager.js`: the pure part. `buildModel()` works out what a page
    needs, `pageHtml()` is one page, `inline()` turns `**bold**` / `*italic*`
    into tags (escaped first). Dark follows the quote cover, light the detail
    pages. The logo, address, website and VAT number always come from
    Settings; "prepared by" (blank by default) and the email addresses (a new
    document starts with `hello@wearepeny.com`) are fields on the document and
    show only what is typed there.
  - `src/pdf/paginate.js`: lays the content across A4 pages with the browser's
    layout (it measures real pages, so it only runs in the browser). A page
    break falls before a heading's group (a heading and what follows it up to
    the next heading) when the group won't fit; a group longer than a page is
    split between blocks. With more than one page there are page numbers and a
    running header; the studio footer closes the last page.
  - Layout tick boxes: condensed header, condensed footer, and condensed page
    (smaller type and margins; it implies the other two). A scale slider
    (40–120%, `content.scale`) shrinks or grows everything on a page, padding
    included, via the `--pdf-s` variable and `zoom`, to fit more on one page.
  - Styles are the `.pdf-one-*` block in `style.css`, **not** the quote's
    `.pdf-*` classes, which are marked "do not restyle".
  - `src/views/pdf-generator.js`: library list, form + live scaled preview,
    save / save as copy / delete. "Download PDF" is the quote's route: the
    pages go into `#pdf-topsheet` and the browser's print dialog does the rest.
  - A document is `{ title, theme, content: { label, subtitle, date,
    preparedBy, emails, scale, condensedHeader, condensedFooter, condensedPage,
    blocks } }`; blocks are `heading`, `text`, `bullets` or `table` (two
    columns). The server keeps only these keys and enforces the limits in
    `api/_pdf-documents.js` (`src/pdf/onepager.js` repeats them; a test checks).
- **Data**: `pdf_documents` (`drizzle/0047`), read and written only through
  `/api/pdf-documents` (`api/pdf-documents.js` + `api/_pdf-documents.js`).

### Logging time
- The header's **Log time** button opens a 340px popover (a sheet on phones)
  with Project, Role, Date (today), Hours and optional Notes. On a project
  page it starts on that project.
- Each project has a **Time** tab with two panels. **Time tracking** shows
  the totals, the by-role / by-person breakdown and a table of entries
  (Date, Who, Role, Hours, Notes), read with `getTimeEntries(projectId)`. On a
  retainer it also has the usage view (see "Retainer time tracking").
  **Log time** is the log form without the project picker. It sits beside
  the Time tracking panel on desktop and above it on phones.
- Both use `src/views/time-log.js`: `trackableLines()` (budget lines ticked
  ⏱, or a retainer's items), `timeLogFormHtml()` and `bindTimeLogForm()`,
  which saves with `addTimeEntry()` and calls `app.refreshTimeViews(pid)`.
  "Role" is stored as `time_entries.line_label`.
- A timer (start/stop) mode would add a "Log hours | Timer" switch to the
  popover. There's a comment marking the spot in `header.js`.

### Serverless Functions (Vercel)
- We're on the **Vercel Pro plan**, so the Hobby-plan cap of 12 Serverless
  Functions no longer applies. It's fine to add a new `/api/*.js` file when a
  feature is a distinct endpoint. There's no need to squeeze it into an existing
  function.
- Every non-underscore `*.js` file in `/api` becomes its own Vercel Serverless
  Function. Files prefixed with `_` (e.g. `api/_ratelimit.js`,
  `api/_dashboard.js`) are ignored by Vercel's function detection and hold
  shared logic / helper modules.
- Some endpoints still route within one function on a query param, a pattern
  left over from the Hobby limit. These routes work as they are, so only split
  them out if there's a real reason to:
  - The public office dashboard lives in `api/_dashboard.js` and is invoked by
    `api/portal.js` when `?view=dashboard`.
  - The Offload Log ingest lives in `api/_offloads.js` and is invoked by
    `api/portal.js` when `?view=offloads`. `POST /api/offloads` is a
    `vercel.json` rewrite onto `/api/portal?view=offloads`, which gives Fence
    a clean URL.
- Current functions: `ai`, `blob`, `callsheet`, `client`, `companies`, `due`,
  `generate-ra`, `google`, `invite`, `maps`, `notification-settings`,
  `packing`, `portal`, `quote`, `realtime`, `reminders`, `pdf-documents`, `retainers`, `track`, `training`.
- **JSON API routers** share `api/_api.js`: a route table matched on
  `${method} ${path}` (`:id` segments must be uuids), 404 / 405 + `Allow`,
  errors always `{ error: { code, message, field? } }`, and `dispatch()`,
  which resolves the route before checking the session, requires an
  `app_users` row (`verifyClerkUser`) and then the route's `access`
  (none = any Slate user, `editor` = not a viewer, `superadmin`). The task
  board, `/api/companies` and every router since use it — add routes to a
  table, don't hand-roll a handler.
- **Integration tests** (`api/*.integration.test.js`, and
  `scripts/_worklist-apply.integration.test.js`) run the real handlers
  against a real Postgres and skip unless `SLATE_TEST_DATABASE_URL` is set
  (the older tasks suite uses `TASKS_TEST_DATABASE_URL`). Setup is in
  `api/_test-db.js`. Run them one file at a time (`--no-file-parallelism`):
  they share the database and clear tables.
  All Google Calendar work lives behind the single `google` function: shared
  plumbing in `api/_gcal.js`, the Team Calendar entry push in
  `api/_gcal-entries.js` — see "External calendar sync" below.

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
- Design tokens (CSS variables) live in `src/tokens.css`. Everything else
  global is in `src/style.css`: the shell (header, tabs, toolbar, Notes panel,
  popovers and sheets), shared components (panels, modals, kanban, forms,
  toasts), the phone layout and PDF print styles. There is no injected
  stylesheet in JS.
- Views style themselves with inline styles that reference the variables
  (`var(--surface)`, `var(--text-muted)`, `var(--accent)`, `var(--radius-md)`,
  …). Always use the variables — never hardcode colours — so both themes
  work. Older names (`--bg-primary`, `--text-secondary`, …) are aliases of the
  new tokens and still work.
- **Themes.** Warm Paper (light) and Darkroom (dark). With no choice saved,
  Slate follows the device (`prefers-color-scheme`). System / Light / Dark in
  the account menu is stored in `localStorage` under `slate-theme`. Light and
  Dark set `data-theme` on `<html>` (applied before first paint by the inline
  script in `index.html`); System removes it. `src/theme.js` handles the
  choice and keeps `<meta name="theme-color">` matching the header.
- The dark values appear twice in `tokens.css`: under `html[data-theme="dark"]`
  and inside the `prefers-color-scheme: dark` media query. Change both.
  `src/tokens.test.js` fails if they drift or if a theme is missing a token.
- **Colour for categories** (statuses, tags, chart series): use
  `var(--cat-<name>)` for text and dots and `var(--cat-<name>-soft)` for
  fills. Don't build colours by appending alpha to a hex (`${colour}22`).
- **Deliberate exceptions** keep literal colours: colours stored in the
  database or picked by users (board columns, canvas notes, team calendar
  types, post-production phases), realtime cursor colours, and the
  print/PDF templates, which always print on white.
- **Type.** IBM Plex Sans (400/500/600) for UI, IBM Plex Mono (400/500) for
  numbers, dates and section labels (11px, uppercase, 0.08em tracking). Both
  are self-hosted through `@fontsource` packages, imported at the top of
  `style.css`. The header uses the logo image, not a typeset wordmark.
- Radii: 10px cards and controls, 8px segmented controls, 12px popovers,
  18px sheet tops. Cards have no shadow; popovers use `--shadow-popover`.

## Development Workflow

```bash
npm install          # Install dependencies
npm run dev          # Vite alone: the front end with no /api, so the app can't load.
                     # Use `vercel dev` (with DATABASE_URL etc. in .env.local) for the app.
npm run build        # Build for production
npm run preview      # Preview production build
```

## Environment Variables
Required (set in `.env.local` for local development, Vercel dashboard for production):
- `VITE_CLERK_PUBLISHABLE_KEY` - Public Clerk API key
- `DATABASE_URL` - Neon PostgreSQL connection string (use pooled connection).
  Server-only: every `/api/*` function (the browser's queries included, via
  `/api/db`) and `scripts/*` read it. Never give it a `VITE_` name — Vite
  builds those into the public JavaScript, and the build refuses to run.
- `DASHBOARD_TOKEN` - Fixed secret token gating the public office-display
  dashboard at `/dashboard/<token>` (served by `public/dashboard.html`, data
  from `/api/portal?view=dashboard`). Unset = the dashboard returns 503.
- `CRON_SECRET` - Bearer token Vercel Cron sends to `/api/reminders`. Four
  scheduled jobs run: deliverables (09:00 — the What's due email, see "What's
  due"), notes (21:00), expense-digest (09:00) and task-nudge (14:00). The nudge dispatches BEFORE the weekday-only
  guard, so it fires at weekends too — an unacknowledged request should not wait
  until Monday.
- The task nudge runs once a day, though its rule ("4 hours after
  assignment") would suit an hourly run. It was capped at daily while the
  project was on Vercel Hobby, which allows one run per day per job (a more
  frequent expression fails the deployment). That cap doesn't apply on the
  Pro plan (see "Serverless Functions"), so the schedule can be tightened.
- `PORTAL_INVITES_ENABLED` - `true` lets superadmins invite client users to
  the portal (Portal access on a project's Worklist tab). Unset = invitations
  are refused. Leave it unset until the query proxy is live **and** the
  database password has been reset: the old one was in the public
  JavaScript, and no client may have a login before both.
- `FENCE_API_KEY` - Shared secret for the Offload Log ingest endpoint
  (`POST /api/offloads`). Fence sends it as `Authorization: Bearer <key>`.
  Unset = the endpoint returns 500 (so it fails closed rather than open).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - OAuth client for the per-user
  Google Calendar connection (server-side, used by `api/google.js`).
- `VITE_GOOGLE_CLIENT_ID` - the same client id, exposed to the browser so it
  can start the OAuth redirect. Unset = the Connect button just toasts.
- `ABLY_API_KEY` - Ably API key (server-side only, never `VITE_`-prefixed) for
  live collaboration on planning canvases, kanban boards and project Planning
  tabs: instant updates, presence avatars, live cursors. `/api/realtime` turns
  it into short-lived tokens for signed-in workspace members, scoped to
  `slate:<workspace owner id>:*` channels. Unset = realtime is simply off and
  everything falls back to polling (no errors, no presence). See
  "Live collaboration" below.
- `YOUTUBE_API_KEY` - Google API key with the YouTube Data API v3 enabled,
  used by the office dashboard's view-count ticker (`api/_youtube.js`). No
  OAuth, so it only reads public/unlisted videos. Unset = the ticker just
  doesn't render; the rest of the dashboard is unaffected.
  - **Debugging a ticker that won't appear:** open the office dashboard with
    `?debug=1` (e.g. `/dashboard/<token>?debug=1`) and the pill is replaced by
    the reason — unset key, key restricted to HTTP referrers, API not enabled
    on the Google project, quota exhausted, private/deleted video, or nothing
    configured in Settings. The same string is always in the JSON as
    `timers.youtubeError`, so `curl`ing the endpoint works too. It is never
    shown without `?debug=1`, so an office screen stays clean, and it never
    contains the API key.
  - The ticker appears on BOTH the office dashboard and the in-app Dashboard
    (the Dashboard tab),
    sharing the `settings.youtube_ticker` row. They reach the count by
    different routes: the office display via `/api/portal?view=dashboard`
    (gated by DASHBOARD_TOKEN), the app via `GET /api/blob?action=youtube&id=`
    (gated by Clerk). The app cannot call YouTube directly — YOUTUBE_API_KEY is
    server-side only and must never be given a VITE_ prefix, which would ship
    it to the browser. `?debug=1` surfaces the reason on both.

## Common Tasks

### Adding a new database table
1. Add schema to `src/db/schema.js` (Drizzle)
2. Add the SQL as the next `drizzle/00NN_*.sql` record and, idempotently, to
   `runMigrations()` in `src/db/client.js` (see "Migrations"). There is no
   `schema.sql` any more, whatever older notes say.
3. New tables are read and written through an `/api/*` router (see
   "Database access"), not through `src/db/client.js`.

### Adding a new view
1. Create `src/views/myview.js` with a `render()` function
2. Import and map in `src/app.js` router, and add the route to `VIEWS`
3. Give it a way in: a top tab (`TABS` in `src/views/header.js`), the
   Projects view switcher (`_viewSwitcherHtml()` in `src/app.js`), or the
   account menu's Tools / Workspace groups (`header.js`). Also list it in
   search (`src/views/search-commands.js`) with a few keywords
4. Call `this.app.navigate('myview')` to navigate, or link with
   `<a href="#myview" data-nav="myview">`

### Deploying
- Push to GitHub
- Vercel auto-deploys (configure env vars in dashboard first)

## Available Views/Modules
- `contacts.js` - Contacts, by company (see "Companies" below)
- `projects.js` - Project management. Its kanban (pipeline by stage, plus a
  Retainer lane) is one of three separate kanban implementations — see
  "Kanban boards" below. Project tabs: Overview, Shoots, Post Production,
  Budget, Planning, Story, Time, Notes. The Time tab holds the entries table
  and a log form (see "Logging time"). On a retainer it also shows a
  long-term usage view (calendar-month blocks, a cumulative total and an
  adjustable 12-month window) — see "Retainer time tracking" below.
- `budgets.js` - Budget tracking
- `expenses.js` - Expense tracking
- `timetrack.js` - The older full-page time tracker. It's only reached by its
  old `#timetrack` URL; logging now happens in the header's Log time popover
  and on each project's Time tab.
- Shell modules: `header.js` (header, tabs, account and New menus, Log time
  popover), `popover.js` (popovers / bottom sheets), `icons.js`,
  `time-log.js` (the shared log form), `board-status.js` (phone status
  switch for kanbans)
- `callsheets.js` / `callsheet.js` - Call sheet management
- `team-calendar.js` - Team calendar. Entries also push one-way to each user's
  own Google Calendar — see "External calendar sync" below.
- `leave.js` - Leave/absence management
- `story-planner.js` - Story planning
- `tasks.js` - Task board (Phase 1): the Tasks tab's home page (`/`). Desktop
  column board + mobile list over the `/api/tasks` API — the only view that
  does NOT query the DB directly. See "Tasks system" at the end of this file.
- `boards.js` - Planning boards (kanban) — standalone under Projects › Planning
  AND embedded in each project's Planning tab. Granular rows (`boards`,
  `board_columns`, `board_cards`, `board_recurrences`); card order uses
  fractional `position` (DOUBLE PRECISION) so a move writes one row. Near-
  realtime sync via 4s polling of `getBoardData()` while a board is open
  (merges pause during drag/typing/open modals). Recurring cards spawn
  client-side on load via `spawnDueBoardRecurrences()` — an atomic
  `next_due` advance stops two browsers double-spawning. One of three
  separate kanban implementations — see "Kanban boards" below.
- `planning-tabs.js` - A project's Planning tab: one tab strip holding ALL of
  the project's kanban boards and canvases (any number of each). See
  "Project planning tabs" below.
- `canvas.js` + `canvas-surface.js` - Planning canvas, a Milanote-style
  infinite planning/storyboarding surface — standalone under Projects ›
  Planning (its Canvases tab) AND embedded in each project's Planning tab. See
  "Planning canvas" below.
- `post-production.js` - Post-production workflow
- `marketing.js` - Marketing. Its kanban (by status: Ideas → Planning → In
  Progress → Scheduled/Sent → Done) is one of three separate kanban
  implementations — see "Kanban boards" below.
- `worklist.js` - the Worklist tab on a project's page: its workstreams,
  deliverables and rounds (`#projects/<id>/worklist`, and
  `#projects/<id>/worklist/<deliverableId>` opens that deliverable) over
  `/api/retainers` — see "Retainer worklists" below. Client requests are
  cards in the task board's tray (`request-cards.js`); there is no Requests view
  or tab (`#requests` redirects to `#tasks`).
- `password-manager.js` - Password management
- `offload-log.js` - Offload Log (read-only table of backup reports from Fence)

### Live collaboration (canvases, boards, planning tabs)
- **Transport.** Ably, behind a tiny room API in `src/realtime/realtime.js`
  (`joinRoom(app, 'canvas:<id>' | 'board:<id>' | 'project:<id>')` →
  `on / send / setPresence / onPeers / onResync / close`). Only
  `src/realtime/transport.js` imports Ably (lazily, its own chunk). Rooms are
  best-effort: with no `ABLY_API_KEY`, no network, or before the socket is up
  they do nothing and views keep polling. Never make a feature *depend* on a
  message arriving — the database is the source of truth and polling (4s, or
  20s while realtime is connected) always reconciles.
- **Canvas messages** (`canvas-surface.js`, "Collaboration" sections), sent
  after the database write succeeds: `items` (full rows), `arrows`, `del`,
  `adel`, `geo` (final positions), `reload` (big or structural changes — a
  paste over ~48 KB, move-into-board, and a poke to the destination board's
  room). Ephemeral: `drag` (~12 Hz while dragging, capped at 60 cards) and
  `cur` (cursor, canvas coordinates, ~12 Hz, only while moving). After a
  reconnect, `onResync` re-reads the canvas.
- **Merging** goes through `_absorb()`: a card with unsaved/in-flight local
  edits, an open conflict, or the caret in it keeps its local content and
  version (it still takes remote geometry). Everything else takes the server
  row. Typing therefore no longer pauses sync.
- **Conflicts.** Card *content* (text, colour, image, url, links, checklist
  rows) is saved with `updateCanvasItemContent(id, patch, expectedVersion,
  clerkId)` — an optimistic-concurrency UPDATE on `canvas_items.content_version`
  (`drizzle/0030`). Geometry never bumps the version, so moving a card can't
  conflict with typing in it. On a conflict the card gets a "<name> changed this
  card while you were editing — Keep mine / Use theirs" prompt; nothing is
  written until the user picks. Saves for one card are serialised
  (`_saveChains`) so a user never conflicts with their own debounced saves.
  System updates (link previews) use `{ quiet: true }` and simply yield.
  Connector labels and positions are last-write-wins.
- **Undo is teammate-safe.** Each history step checks the card still matches
  what this user left it as (position, or the changed properties) and skips it
  otherwise ("skipped 1 card a teammate changed since"). Undoing a create
  doesn't delete a card a teammate has since written in.
- **Presence.** Canvas: avatar stack (click → jump to what they're doing),
  named live cursors, and an outline + name tag on cards others have selected
  or are typing in. Planning tabs: small avatars on the tab each person is on;
  tab create/rename/link/reorder refreshes everyone's strip (`tabs` message).
  Kanban boards: every committed write (`_committed()` in `boards.js`) pokes
  others on the board to re-read immediately.
- **Message budget.** Cursors and drags dominate. Roughly: one person moving
  their mouse over a canvas with 3 others watching ≈ 12 msg/s published +
  36 delivered. Ably's free tier (6M/month) covers a small studio comfortably;
  if usage grows, lower the throttle in `_bindCursorBroadcast` first.
- **Testing locally.** The browser harness swaps `transport.js` for a
  BroadcastChannel stand-in so two iframes act as two users (see the scratch
  harness used when this was built; production code has no test hooks).

### Project planning tabs
- A project's Planning tab (`PlanningTabsView`, `src/views/planning-tabs.js`)
  shows one strip of tabs mixing its kanban boards (`boards.project_id`) and
  root canvases (`canvases.project_id`, `parent_id IS NULL`). The active tab is
  rendered by the existing embeds — `BoardsView.renderEmbedded(container,
  project, board)` / `CanvasView.renderEmbedded(container, project, canvas)`;
  called without the third argument they still fall back to the project's
  first board/canvas.
- Tab order is shared and stored on the project as
  `projects.planning_tab_order` (`['board:<id>' | 'canvas:<id>', …]`,
  `drizzle/0029_add_planning_tab_order.sql`). Unlisted boards/canvases append
  oldest-first, and keys for deleted ones are skipped — so creating or deleting
  from elsewhere (e.g. Projects › Planning) needs no order bookkeeping. The
  ordering maths is pure and unit-tested in `src/utils/planning-tabs.js`.
- The last tab used is remembered per browser in `localStorage`
  (`slate-plan-tab-<projectId>`); each embedded canvas also remembers which
  nested board it was showing, so switching tabs and back lands in the same
  place.
- Tabs: click or ←/→ to switch, double-click to rename inline, drag to reorder.
  `+` creates a kanban board or canvas (named inline) or links an existing
  standalone one (`getLinkablePlanning` — only boards/canvases with no project).
  There is deliberately no unlink/delete in the strip: do that from the
  item's full view.
- Every tab switch renders into a fresh element, and the embeds bail out if
  their container was detached while loading, so a slow tab can never paint
  over the one the user switched to.

### Planning canvas
- **Split.** `src/views/canvas.js` owns navigation: the Canvases list (root
  canvases only), the standalone page with breadcrumbs, the project-embedded
  view, and moving in/out of nested boards. `src/views/canvas-surface.js`
  (`CanvasSurface`) is the canvas itself: rendering, gestures, persistence,
  undo, polling. All geometry (zoom/pan maths, wheel intent, connector
  routing, magnet, alignment snapping, marquee hit-testing, colour helpers) is
  pure and unit-tested in `src/utils/canvas-math.js` — extend it, don't do
  maths in the view.
- **Rendering.** Items are stored in canvas space; one CSS transform on
  `.cv-world` maps them to the screen, so pan/zoom never touches cards.
  Rendering is keyed (`_els`, one element per item, repainted only when its
  content signature changes) and every event is delegated from the wrapper.
  All DOM writes during a gesture are batched into one rAF (`_frame`), and a
  card and its connectors are updated in the same frame — that is what keeps
  lines attached during fast drags. Keep new per-frame work inside `_frame`.
- **Performance rules learned the hard way:** don't write CSS variables on the
  wrapper per zoom frame (`--cv-inv-zoom` is applied only when the view
  settles — writing it per frame restyled ~2,400 port elements, ~100ms/frame
  at 400 cards); don't use `.cv-wrap--x *` selectors (toggling them restyles
  every node — gesture cursors live on the single `.cv-shield` element);
  `will-change` on `.cv-world` only while moving, or zoomed text stays blurry.
- **Gesture model (Milanote):** drag empty canvas = marquee select (Shift adds);
  trackpad two-finger scroll = pan; pinch / Ctrl-or-Cmd+wheel / mouse-wheel
  notch = zoom at the cursor (notches ease, pinch is direct); Space-drag,
  middle-drag and the Pan tool = grab-to-pan; touch = one-finger pan, two-finger
  pinch. Read-only users: any drag pans. Gestures measure in canvas space and
  auto-pan near the edges, so dragged cards stay under the cursor. Esc cancels
  a drag. Keyboard shortcuts apply while the pointer is over the canvas or it
  was the last thing clicked (`_engaged`); `?` in the zoom cluster lists them.
- **Card kinds** (`canvas_items.kind`): `note`, `todo` (checklist), `image`
  (empty = dropzone; drop/paste/upload; aspect-locked resize), `link`,
  `swatch` (colour; `color` + name in `content`), `board`
  (`child_canvas_id` → nested canvas; `content` caches its name for the face).
  Tools can be clicked (centre of view) or dragged out of the palette.
- **Connectors** (`canvas_arrows`, optional `label`): drag from a card's edge
  port (or use the Line tool); the end snaps magnetically to the nearest card
  within 28px; release on empty canvas sprouts a connected note. Routes are
  Béziers between facing side midpoints, re-picked every frame.
- **Nesting.** `canvases.parent_id` nests a canvas under another; only roots are
  listed or linked to a project, and deleting a canvas cascades through its
  sub-tree. Dropping cards onto a board moves them inside (`moveCanvasItems`:
  arrows between moved cards go too, dangling ones are removed, carried boards
  re-parent, and moving a board into its own sub-tree is refused). Duplicating
  or pasting a board deep-copies its sub-tree (`duplicateCanvasTree`); renaming
  a nested canvas from inside updates its card (`syncBoardCardName`).
- **Persistence.** Optimistic local change → write; `_write()` pauses polling
  while writes are in flight. Group moves/resizes/z-order go through
  `updateCanvasItemGeometry` (one `UPDATE … FROM (VALUES …)` for any number of
  cards); paste/undo insert with `createCanvasItems` using client-generated ids
  so undo/redo can recreate records under their original ids. Debounced text
  saves flush on teardown and `pagehide`. Near-realtime sync is the same 4s
  polling as boards; it pauses during gestures, typing, uploads and popovers.
- **Undo/redo** (⌘Z / ⇧⌘Z, per canvas, 100 steps): moves, resizes, nudges,
  z-order, colour, create/delete/paste, connectors and labels, image changes,
  move-into-board. Deleting a board is confirmed and is NOT undoable (its
  nested canvases are gone).
- Schema: `drizzle/0028_add_canvas_nesting.sql` (also applied idempotently by
  `runMigrations`).

### External calendar sync (Team Calendar → Google)
Each user can connect their own Google account in Settings → Users, and Slate
then pushes **their own** Team Calendar entries to it. One-way only: Slate is
always the source of truth and nothing is ever read back from Google.
- **Events go to a dedicated "Slate" calendar**, a secondary calendar created
  in the user's account on connect (`app_users.gcal_calendar_id`). Slate never
  writes to their primary calendar here, so it cannot touch their own events
  and they can hide or delete the whole thing in one click. The one exception
  is the older **leave** sync, which still writes to `primary` — see below.
- **Scope.** Connecting asks for `https://www.googleapis.com/auth/calendar`.
  The narrower `calendar.events` this used to request cannot create a
  secondary calendar, so **anyone connected before this feature has to
  reconnect**; until they do, a sync returns `code: 'reconnect_required'` and
  the UI says so rather than failing silently.
- **What is pushed:** `shoot`, `post_production` and `other` entries where the
  user is the assignee. All-day events (entries hold dates, not times); a
  deadline entry lands on its final day only and is marked `transparent` so it
  doesn't look like booked time.
- **`leave` entries are deliberately NOT pushed from here.** Approved leave
  already reaches the requester's *primary* calendar via
  `syncLeaveRequestGoogle()` (`api/google.js`, also driven by the email
  approval flow in `reminders.js`); pushing the mirrored Team Calendar row as
  well would double it up. `PUSHABLE_TYPES` in `api/_gcal-entries.js` is the
  single guard.
- **Wiring.** Every mutation site in `src/views/team-calendar.js` (modal save,
  drag-move, resize, paste, delete) calls `_pushEntry()` / `_unpushEntry()`
  fire-and-forget, the same pattern as `leave.js`'s `_syncGoogleCalendar` — a
  slow or disconnected calendar never holds up the grid. The push response
  carries the event id, which is written back onto the in-memory row so a
  later delete knows what to remove.
- **Bookkeeping.** `team_calendar_entries.gcal_event_id` +
  `gcal_user_id` record the event and *whose* calendar it is on. They are kept
  separate from `assignee_id` so reassigning an entry can delete the event
  from the old person's calendar before creating it on the new one. Both
  columns are server-owned — `createTeamCalendarEntry`/`updateTeamCalendarEntry`
  strip them so copy/paste can't clone someone else's event id.
- **Turning it off.** The per-user checkbox (`app_users.gcal_push_entries`)
  removes the already-pushed events when switched off, so a stale rota can't
  linger. Disconnecting leaves events in Google (that's what the dialog
  promises) but forgets the tokens, the calendar id and every event id, so a
  reconnect starts clean. "Sync now" / connecting backfills entries from 30
  days ago onwards.
- **Permissions.** `entry-sync` and `entry-delete` are open to any signed-in
  Slate user, because the Team Calendar is shared and anyone can already move
  anyone's entry. `disconnect`, `entry-sync-all` and `entry-purge` act on one
  person's own connection, so they check the caller's Clerk id against
  `app_users.clerk_id` (`assertOwnAccount`).
- **Known gap:** the Team Calendar also shows dashed "auto" chips derived from
  shoot plans and post-production phases. Those are not
  `team_calendar_entries` rows (they're read live from `shoots` /
  post-production schedules), so they are NOT pushed — only real entries are.

### Retainer period labelling on dashboards
- Retainer periods are anchored on `retainer_start`'s day-of-month, so they are
  usually NOT calendar months. Both dashboards therefore state the period's
  actual dates ("15 Aug – 14 Sep") rather than a vague label:
  - App Dashboard retainer cards (`src/app.js`, `_retainerPeriodLabel()`) show
    the range under the client name.
  - Office dashboard cards (`public/dashboard.html`) show it in place of the
    old "This period"; `api/_dashboard.js` sends `periodStart` + `periodEnd`.
- On the app Dashboard's per-item rows, the suffix used to read `/ qtr` beside
  a figure that was the item's MONTHLY share, so it looked like a quarterly
  total. It now shows the contracted amount instead (`6h/qtr`), and only when
  the item isn't already billed monthly.
- Known gap, not yet addressed: the office dashboard's allocation comes from
  the legacy `retainer_hours` column only, so a retainer configured with
  `retainer_items` shows hours used but no target or bar there.

### Retainer time tracking
- A retainer's Time tracking panel (project Time tab, `#pv-timetrack` in
  `projects.js`) shows a long-term usage view above the existing breakdown: one
  block per calendar month, an "Overall" cumulative figure, and a 12-month
  window. Below them the entry log concertinas away (state remembered in
  `localStorage` under `slate-tt-log-open`).
- **Every block breaks down by retainer line item — there is no combined
  total anywhere in this section.** Each item gets its own logged/allocated
  figure and bar, so you can see which item is running hot rather than a sum
  that hides it. Lines with neither allocation nor logged time are omitted, so
  a fee-only item with no hours stays out of the way until time lands on it.
- **Per-unit items are excluded entirely.** A retainer item's unit is `hours`,
  `days` or `unit`; a `unit` item counts deliverables ("4 social posts a
  month"), carries no hours, and so gets no line, no allocation and no display
  in this section. Only that explicit value is excluded — an older row with no
  `unit` at all is read as days, as it always was, so legacy data never
  silently loses hours. `isTimeItem()` is the single guard, mirrored as
  `_isTimeItem()` in `src/app.js`.
  - This was a live bug: every hours calculation used
    `unit === 'hours' ? qty : qty * 8`, so a per-unit item counted as 8 hours
    each and inflated allocations. Fixed in the five sites in `src/app.js`
    (dashboard retainer cards and bars) as well as here. `projects.js`'s
    "create budget from retainer" mapping handles units correctly and is
    untouched — it deals in fees, not hours.
- A "Contracted" strip at the top of the section lists each time-based item
  over its OWN period — `Editing 4h/month`, `Social 6h/quarter`,
  `Strategy 1h/week` — so the contract shape is readable at a glance. The
  blocks below show amortised monthly shares, so without this strip a weekly
  item just reads as an odd `4.3h` a month.
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

### Companies
- `companies` (`drizzle/0032_add_companies.sql`): id, workspace `user_id`,
  `name` (unique ignoring case: `companies_name_uidx` on `lower(name)`) and
  `clerk_org_id` (the client portal's Clerk organization, unique). Contacts
  and projects point at one with `company_id` (`ON DELETE SET NULL`). The
  retainer worklist, the client portal and its Clerk org hang off a company;
  a project's `client_id` is still the person.
- **No guessing.** Existing contacts and projects were left unlinked on
  purpose and are linked by hand. Nothing ever derives a company from the old
  free text: a new record always resolves its company field, but an existing
  one only once someone types in the field or presses **Link** (shown under
  the field while the old text isn't linked). Saving a contact for any other
  reason leaves its link alone.
- `contacts.company` (free text) stays until every contact is linked. When a
  company is set, the form copies its name into that column, so its ~35
  readers (call sheets, budget and quote PDFs, the office screen, search, the
  portal) keep working unchanged. Drop the column only after moving those
  readers to `company_id`.
- The field (`src/views/company-field.js`) is a text box with a native
  `<datalist>` of every company, like the password manager's categories. On
  save, `resolveCompanyField()` sends the text to `POST /api/companies`, which
  returns the existing company with that name (ignoring case and spacing) or
  creates one, in one race-free statement. It's used by the contact form, the
  new-project form (its own Company field and the inline new contact), the
  project editor and the AI email import. Choosing a client fills an empty
  project Company from that contact's *linked* company, never from its text.
- `app.companies` is loaded at boot from `GET /api/companies`; the field
  keeps it current as companies are created. There is no merge screen.
- **Edit and delete** (Contacts, in each company's row; `api/_companies.js`):
  `PATCH /api/companies/:id { name, type, sector }` renames (409 `name_taken`
  against another company, ignoring case) and copies the new name onto its
  people's `contacts.company`. `GET .../impact` counts people, projects and
  what blocks a delete; `DELETE` keeps people and projects (company removed, the
  typed `contacts.company` cleared so the link suggestions don't offer it
  back), is refused (409 `company_in_use`) while company-level workstreams or
  requests still point at it, and deletes the portal's Clerk organisation after
  the database delete (a superadmin only, when it has one; a Clerk failure
  leaves the organisation and says so: `portal_left`).
- **Dragging a person onto a company** (`ContactsView.bindDrag`, `movePerson`):
  company rows are the drop targets in the Companies view; in Everyone a tray of
  companies appears while dragging. Touch screens mostly can't drag, so every
  person also has a **Move** button (and "Move to company…" in the detail panel)
  that opens `openCompanyPicker`. Both write `company_id` and the typed name.
- **Companies have a type** (`drizzle/0037`): client, prospect, subcontractor,
  supplier, other, plus an optional `sector` ("Sport"). It was worked out once,
  on migration, from the company's linked contacts (all subcontractors =>
  subcontractor, else client) and stays `type_reviewed = false` until a person
  confirms or changes it (`PATCH /api/companies/:id { type, sector }`; "Looks
  right" on the Contacts page). A company made with a type chosen
  (`POST { name, type }`) is confirmed. The list is in `api/_retainer-rules.js`
  and mirrored in `src/utils/contact-kind.js` (a test compares the two).
- **Contacts are organised by company** (`src/views/contacts.js`; logic in
  `src/utils/contact-kind.js`, unit-tested). Default view: companies, each
  closed to its people, filterable by type; "Everyone" is the flat, searchable
  list. People with no company are listed under **No company**, never hidden
  (most existing contacts start there). A person's **kind** is their company's
  type when they have one, else their own `type` (subcontractor or the client
  side): `kindOf()` / `isSubcontractor()`, which the project client picker and
  the subcontractor crew picker use. The person's own Type still exists for
  people with no company; a new subcontractor typed with a new company makes it
  a subcontractor company.
- **Link suggestions** turn old free-text company names into links, only on
  confirmation: people whose `company` text matches an existing company (ignoring
  case and spacing), or would make a new one, grouped by name with each person
  ticked; "Link the ticked people" does it, "Not now" sets it aside for the
  visit. Nothing is linked by anyone but a person pressing that.
- Company-level controls live on the company's row in Contacts, open on phones
  too (the side panel isn't): type and sector, "+ Person", **Portal access**
  (superadmins) and the lead (only while leads are on), via
  `src/views/company-panels.js`, which the project's Worklist tab shares for
  Portal access.

### Email: one notification path
- **Every email goes through `notify()` in `api/_notify.js`** — reminders,
  the 09:00 and 21:00 runs, the roundup, task mail, the nudge, leave and
  expenses, and stage 2's alerts. It owns the only mail transport (Gmail via
  `GMAIL_USER` / `GMAIL_APP_PASSWORD`; unset = everything is skipped, nothing
  throws). `_notify.test.js` fails if any other file imports nodemailer. Add
  a new email by adding a kind to `KINDS` and calling `notify()`, never a
  transport of its own.
- `notify(sql, { kind, to, subject, html })` takes recipients as
  `{ email, clerk_id?, name? }` and returns one result per recipient (`sent`,
  `skipped: 'setting' | 'not_configured' | 'no_email'`, or `error`); a failed
  send is reported, never thrown.
- **Per-person settings.** `KINDS` lists every kind. A `switchable` one
  (what's due, tasks assigned, mentions, note reminders; the roundup, which is
  superadmin-only and off by default) can be turned off or on by each person
  in Settings › My account › Email notifications. The rest (the unacknowledged
  task nudge, leave, expenses) are workflows someone is waiting on and always
  send. Stored in `notification_settings` (`drizzle/0034`: one row per person
  per kind they've changed, keyed by Clerk id so client users can have
  settings in stage 2; no row = the kind's default), read and written through
  `/api/notification-settings` — your own settings only.
- The reminder roundup used to be one workspace-wide switch
  (`settings.reminder_roundup`) that only ever reached the settings row's
  owner, although every user saw the toggle. It is now a personal opt-in for
  superadmins, carried over for the owner by the migration. The old column is
  no longer written.
- Viewers don't get Settings (the account menu hides it), so their emails stay
  at the defaults.

### Delivered and approved are separate (`drizzle/0040`)
- **Two things, two owners.** The staff tick is `deliverables.delivered_at`
  (set by `PATCH retainers/deliverables/:id { delivered: true|false }`, from the
  Worklist row's Delivered box and the dashboard tick). It changes nothing else:
  status stays as it was. **Approved is the client's answer** (status
  `approved`); staff can still set it from the status menu to record one that
  came another way. An approved row's tick is checked and locked.
- **What the client sees** (`clientFace`, `canAnswerDelivered` in the rules): a
  delivered, unapproved deliverable reads **Delivered** with **Approve** and
  **Request changes**, and no round is needed. If a round is out it reads "Ready
  for review" and the round's own buttons are the ones that answer. Both paths
  stay (`POST client/deliveries/:id/response` for a round,
  `POST client/deliverables/:id/response` for a delivered deliverable).
  Signed-in clients only; a project link or a viewer can look but not answer.
- **The answer** (`respondToDeliverable` in `api/_worklist.js`, one statement
  with its conditions inside): approve sets `status = approved`, `approved_at`,
  `approved_by_name` and keeps the tick; changes (a comment is needed) sets
  `changes_requested`, stores `changes_note`/`changes_at`, **clears the tick**
  (staff tick again once fixed, which clears the note) and tells the owner
  straight away like a round does. Approvals with no round reach the digest
  through `loadApprovals` (round is null there).
- Board and lists: a delivered deliverable is always on the board (muted, chip
  "Delivered · awaiting approval") and counts as open in Owed and What's due
  until it is approved. The dashboard's "to do" badge counts a tick as done.
- Old ticks are not migrated: the change applies from now.

### "Comments are in" — a third answer to a round (`drizzle/0041`)
- **Three answers to a round:** Approve (this stage is done), Request changes
  (a comment in Slate), and **Comments are in** (feedback finished in
  Frame.io, over to us; no words are stored). `delivery_response` and
  `deliverable_status` both gain `comments_in`. It is not `changes_requested`:
  the useful fact is that feedback is *complete*. The deliverable reads
  **Comments in** (board: Doing, chip "Comments in · 2d"; dragging it back is
  refused like changes); the client sees "Comments received". Sending the next
  round moves it to In review.
- **Who hears:** the owner straight away (`alertCommentsIn`, switch
  `alert_comments_in`), and again if the client takes it back.
- **Undo** (`undoCommentsIn` in `api/_worklist.js`): the client can take it back
  while the round is still the latest, still answered that way and the
  deliverable still reads Comments in; staff moving it on or sending a newer
  round ends the chance (409 `cannot_undo`). Portal:
  `POST client/deliveries/:id/undo`; link: `POST client/link/undo`. The round
  reopens and the deliverable goes back to In review.
- **The email** has a third button; it opens `/portal/approve?comments=1#token`,
  the confirm page, for everyone (login or not). `POST client/link/comments`
  answers without using the link up (the round is answered either way).
  Staff can record it too (the answer form on the deliverable sheet).
- Not on the delivered-tick path (no round): there, Approve / Request changes
  only, because that tick means final.

### Quick send (`src/views/quick-send.js`)
- A **Quick send** button in the project header (every tab, phones get a bottom
  sheet): paste the Frame.io link, press Send. "What is it?" starts on the
  deliverable sent most recently (most sends are its next revision); typing
  another of the project's deliverables sends that one's next round; typing a
  new name **makes the deliverable and sends round 1 in one step**. Everything
  stays on the worklist: there is deliberately no stand-alone send, because
  rounds, the portal and the Approve links are all keyed to a deliverable.
- Routes: `GET retainers/projects/:id/send-targets` (open deliverables, last sent
  first; workstreams; the default workstream) and
  `POST retainers/projects/:id/quick-send { url, note?, deliverable_id | title,
  workstream_id? }`. A new deliverable is the sender's, In progress and shown to
  the client; it goes in the workstream of the one sent last (else the first
  active one, else a new "Reviews"). Sending reuses `sendRound` (also behind
  the Worklist tab's send form), so the round, the email and its buttons are
  identical. If the send fails the deliverable just made is removed.

### Testing mode (`drizzle/0043`, Settings › Company › Testing)
- A superadmin switch (`settings.test_mode`, default off) and a list of addresses
  (`settings.test_emails`: ticked team members, plus any other address). While it
  is on, `notify()` (`api/_notify.js`, the one place email is sent) sends the
  **testable** kinds to those addresses instead of the people they are for:
  `delivery_ready` (with its real Approve links), every `alert_*`,
  `task_assigned` and `due_digest`. One copy per intended recipient, subject
  `[TEST → who@it.was.for]`, a yellow banner at the top of the body. Leave,
  expenses, mentions, reminders and the rest are untouched.
- Their notification switches still apply (a person who muted a kind does not
  cause a test copy). **With testing on and nobody chosen the emails are held back
  (`skipped: 'test_mode_no_recipients'`), never sent to the real people.** A
  database that has not had `0043` reads as off.
- A yellow "Testing mode" chip sits in the header on every page while it is on,
  linking to Settings, so it is not left on. Guarded in the UI only, like the
  leads setting (the query proxy checks who, not what).

### How far ahead dated work shows (7 / 14 / 30 / 60 days)
- One choice, four values (`WINDOW_DAYS` in `api/_retainer-rules.js`, mirrored in
  `src/utils/window-days.js`; a test compares them). Each screen has its own
  toggle and remembers its own value in this browser: the task board
  (`slate-tasks-window`, default 30), What's due (`slate-due-window`, default 14)
  and a project's Overview "Owed" list (`slate-owed-window`, default 30). The
  server takes `?days=` on `GET /api/due`, `GET retainers/board` and
  `GET retainers/projects/:id/owed`; anything else means that screen's default.
- On the board the window only hides **owned, planned, dated** deliverables that
  are further out (`boardShows(d, today, days)`); tasks, started work, undated and
  unowned work are never hidden by it. An unowned open deliverable shows in the
  tray whatever its workstream's status; an owned one in a paused or complete
  workstream is parked on purpose and has no card.
- The Overview's **Owed** list (`owedList` in the rules, `src/views/owed.js`):
  open deliverables from active workstreams, overdue first, undated last, five
  shown, waiting-on-client kept in (muted), "See all N" into the Worklist tab.
- The 09:00 email and the office screen are fixed windows (nobody is there to
  click), so they don't have the toggle.

### What's due (one feed)
- **Everything dated is read from one feed**: `dueFeed(sql, { ws, days,
  ownerId })` in `api/_due-feed.js` — one list sorted by date, each item with
  `type`, `title`, `context` (where it lives, or null when the type says it
  all), `date`, `due_label` (only when the date alone doesn't say it: a window,
  a month, a cadence or the client's own words), `owner` and `link` (an in-app
  `#hash`). The Dashboard's What's due list (`src/views/whats-due.js`, via
  `GET /api/due?days=&owner=me`), the office screen (`api/_dashboard.js`) and
  the 09:00 email (`api/reminders.js`) all read it, and stage 2's alerts
  should too. **Don't work out what's due anywhere else** — add a source to
  the feed. `fetchDueSources()` is the SQL, `collectDue()` the pure part
  (unit-tested; `_due-feed.integration.test.js` runs the SQL).
- Sources, and what counts as finished:
  - worklist deliverables in **active** workstreams, until approved (a paused
    or complete workstream drops out);
  - (the deliverables that used to be stored as JSON on projects are no
    longer read — see "Worklists belong to projects");
  - marketing card due dates and sub-tasks, except cards in Done;
  - canvas checklists (the `sub_tasks` of `todo` items);
  - planning-board cards, except in a column named Done, Complete(d),
    Finished, Delivered, Approved or Archived (columns are named by people);
  - edit deadlines: post-production blocks marked as deadlines and not
    complete, and Team Calendar deadlines from today on (those can't be
    ticked off, so a passed one is history, not overdue);
  - tasks with a due date that aren't done or archived, dated by their
    London day.
- Undated work isn't in the feed. Overdue work of any age is, plus the next
  `days` (14 on the Dashboard and the office screen, 3 in the email).
- Owners: tasks, boards, deliverables, post-production and the Team Calendar
  store `app_users` ids; marketing and canvas checklists store Clerk ids.
  `collectDue()` maps both, and `?owner=me` comes from the session.
- **Dashboard**: the What's due list sits above Live Projects (after the
  calendar and Tasks sections): Everyone or Mine (remembered per browser in
  `slate-due-owner`), grouped by day, no tick boxes — a row opens the item
  through `app.openLink()`. It replaced the Marketing Tasks, Deliverables and
  Edit Deadlines lists; retainers have their own row.
- **09:00 email** (`?type=deliverables`, kind `due_digest`): one "What's due"
  email per person — their overdue work and the next three days, with
  unacknowledged tasks on top. It replaced two emails (project deliverables,
  and marketing sub-tasks from the removed `api/_sub-tasks.js`) and now also
  covers board cards, checklists, edit deadlines and dated tasks.
- **Office screen**: the feed under the `deliverables` key it always read,
  everyone's, with no owners. Undated deliverables no longer show there.

### Retainer worklists (data and rules)
- Tables (`drizzle/0033_add_retainer_worklists.sql`), all read and written
  through the server only:
  - `workstreams`: a company's workstreams, optionally tied to a project
    (`project_id`, which a portal token link for that project uses).
  - `deliverables`: title, format, owner (`app_users.id`), due fields, status,
    `waiting_since` / `waiting_note`, `client_visible` (**off by default**) and
    `internal_notes` (never leaves Slate).
  - `deliveries`: the rounds sent for review — url, note, round, sender, and the
    client's response with who gave it (`responded_by` is a Clerk id, since
    clients have no `app_users` row) — plus the link preview.
  - `requests`: client requests, empty until stage 2. Accepting one will
    create a task on the task board (`task_id`), which then carries the work;
    there is no second inbox.
- Statuses are Postgres enums (`workstream_status`, `deliverable_status`,
  `deliverable_due_kind`, `delivery_response`, `request_status`), like
  `task_status`.
- The rules are pure functions in `api/_retainer-rules.js` (tested in
  `_retainer-rules.test.js`); nothing else decides them:
  - **Due dates.** `due_date` is always the deadline, so sorting and
    "overdue" are the same for every `due_kind`: `exact` = that day, `month` =
    its last day, `window` = the window's last day with the words in
    `due_label` ("1st week of November"), `recurring` = the next one if known,
    with `cadence` (weekly | fortnightly | monthly | quarterly).
    `dueDisplay()` shows `due_label` if set, else derives it ("Fri 3 Oct",
    "October", "By 7 Nov", "Monthly · next 5 Oct").
  - **Client labels.** `clientStatus()` maps the six statuses onto the five
    the client sees (Planned, In progress, Waiting on you, Ready for review,
    Approved); `changes_requested` reads as In progress. Mapped on the server,
    so internal status names never reach the portal.
  - **Waiting.** Entering `waiting_on_client` sets `waiting_since`; leaving it
    clears `waiting_since` and `waiting_note`.
  - **Rounds.** Sending a delivery makes round = previous + 1 (unique per
    deliverable) and the deliverable `in_review`. A response is only taken on
    the latest round: approved → `approved`, changes requested (comment
    required) → `changes_requested`. The same rule serves the client and a Peny
    user recording an emailed approval.
  - **URLs.** Only http(s), checked in the rules and by a CHECK constraint,
    because the URL becomes a link in the portal.
- Dates are 'YYYY-MM-DD' strings and "today" is London time
  (`api/_dates.js`: `londonDate()`, `addDays()`, …), not the server's UTC.
- **Peny API** (`api/retainers.js` → routes in `api/_retainers.js`; vercel.json
  rewrites `/api/retainers/*` with `?route=`). Staff only; reads for anyone on
  the team, writes for non-viewers:
  - `GET projects/:id` (a project's whole worklist: workstreams →
    deliverables → rounds, who it is for, whether it has a link, and any
    older project-less workstreams its company has that can be attached),
    `GET project-counts` (open / overdue / waiting per project, for the
    tab's number) and `POST projects/:id/attach` (brings those older
    workstreams in).
  - `POST workstreams` (`{ project_id, title }`: a worklist belongs to a
    project), `PATCH|DELETE workstreams/:id`, `POST deliverables`,
    `PATCH|DELETE deliverables/:id`. A PATCH writes only the fields sent;
    due fields are normalised as a set (changing the kind drops the old
    words); a status change is refused with 409 if the status moved on
    meanwhile. `waiting_note` only while waiting on the client.
  - `POST deliverables/:id/deliveries { url, note }` sends the next round in
    one statement; simultaneous sends retry on the unique round.
    `POST deliveries/:id/preview` fills the link preview afterwards, so
    sending never waits on Frame.io; no preview is not an error.
  - `DELETE deliveries/:id` takes back a round sent by mistake — the latest,
    unanswered one — and `statusAfterUnsend()` puts the status back.
  - `POST deliveries/:id/response` records an answer that came another way.
  - **Nothing with rounds sent can be deleted** (409 `has_rounds`), so a
    client's approvals can't vanish by accident: mark it approved/complete.
- **The old JSON deliverables are retired** (commit 7 of the project-first
  change). `projects.deliverables` and `projects.monthly_deliverables` stay in
  the database, untouched and unread — nothing migrates them, there is no
  monthly reset or rollover of deliverables (a retainer is retained *time*, not
  a fixed list), and `api/_no-json-deliverables.test.js` fails if anything
  reads or writes them. Where each thing went: the project Overview points at
  the Worklist tab (open / overdue / waiting counts); the editor has no
  deliverable lists; a Projects-board card shows its open count; the
  dashboard's project rows list worklist deliverables
  (`GET retainers/dashboard-deliverables`: open ones and ones approved in the
  last week) and **a tick means delivered, not approved** (it sets
  `deliverables.delivered_at`; see "Delivered and approved are separate"
  below); the AI brief import adds its deliverables
  to a "Deliverables" workstream (planned, hidden from the client); a new
  budget from a project reads its worklist for the notes; **Duplicate** copies
  the worklist as a fresh plan (`POST retainers/projects/:id/copy-worklist`:
  planned, hidden, no owner, dates, rounds or answers; a recurring one keeps its
  cadence) and now keeps a retainer's contract terms (items, hours, fee mode,
  alert, rollover; its period starts today), which it used to lose. Project
  *approvals* (the internal Brief sign-off / Budget approved checklist) are a
  different thing and are unchanged.
- **Worklists belong to projects.** Any project can have workstreams and
  deliverables, retainer or not; a retainer is a project that also has
  contract terms (hours, fee, period — unchanged, on the project). The
  company is read from the project **now**, through the `workstream_company`
  view (drizzle/0038): the project's company, else the company stored on an
  older workstream. Every query that needs a workstream's company joins that
  view with LEFT JOINs, so a project with no company still has a worklist and
  a link (no company login). Never join `workstreams.company_id` directly.
  `workstreams.project_id` is ON DELETE RESTRICT: a project with a worklist
  can't be deleted until the worklist is (`deleteProject()` says so). A
  deliverable links to `#projects/<id>/worklist/<deliverableId>`
  (`worklistLink()` in `_retainer-rules.js`); `#retainers/<companyId>` (in
  emails already sent) redirects to that company's project
  (`src/utils/worklist-route.js`).
- **Peny UI** (`src/views/worklist.js`, the Worklist tab on the project page).
  Workstreams (active first, complete ones folded), each with its
  deliverable rows. Built phone-first: one column, 44px targets, and every
  form opens through `openFloating()` (popover on desktop, bottom sheet on
  phones).
  - One tap: the status chip opens a menu (showing what the client will see)
    and saves on pick; the eye shows/hides a deliverable from the client
    (new ones start hidden).
  - Send: paste the link, Send. If the deliverable is hidden, the form
    offers to show it first. The preview is filled afterwards.
  - Tapping a title opens its sheet: the rounds (take back the latest
    unanswered one; record an answer that came by email), then the details
    form (title, format, owner, due, visibility, what we're waiting for,
    internal notes). A viewer gets the same page read-only.
  - "Portal access" (superadmins, when the project has a company) and, for
    editors, an "Attach" banner for a company's older workstreams with no
    project. Companies are made in Contacts and on the project form; there
    is no "Add client".
  - **The page holds no copy of the rules.** The project payload carries
    `vocab` (statuses with the client's label, workstream statuses, due
    kinds, cadences) and computed fields (`status_label`, `due_display`,
    `overdue`, `days_late`, `waiting_days`), all from
    `_retainer-rules.js`. Nothing in `src/` imports from `api/` — `/api/*`
    URLs belong to functions, so a module there can't be served to the
    browser under `vercel dev`.
- **Portal access** (superadmins; `api/_portal-access.js`, routes under
  `/api/companies/:id/portal…` — vercel.json rewrites `/api/companies/*`
  with `?route=`). A company's client users are the members of its Clerk
  organisation, `companies.clerk_org_id`, which is what the portal scopes by.
  "Set up the portal" creates the organisation with nobody in it (the caller
  is not made a member); invitations are `org:member`, land on `/portal`,
  refuse any email that belongs to a Slate user, and are refused altogether
  unless `PORTAL_INVITES_ENABLED` is `true`. The organisation used is always
  the company's own, never one from the request. The panel is the "Portal
  access" button on a project's Worklist tab (shown when the project has a company).
- **Responses have one writer**: `respondToDelivery(sql, scope, …)` in
  `api/_worklist.js`, shared by the Peny API and the portal. A scope is made
  only by that module's constructors (`staffScope(ws)`; the portal's comes
  from the Clerk session) — a WeakSet brands the exact objects, so copies and
  look-alikes are refused — and each kind of scope has its own complete SQL
  with the scope inside the statement that writes.

### Importing a client's worklist (`scripts/import-worklist.js`)
- `DATABASE_URL=… node scripts/import-worklist.js Worklists.xlsx --company "DMM"`
  prints the plan and every assumption and writes nothing; add `--apply` to
  write. `--year` (default: this year) dates written without one;
  `--visible` shows the imported deliverables to the client (default hidden);
  `--approved "<product>"` (repeatable) imports a product's items as approved
  and its workstream complete.
- One workstream per product. How the sheet's columns (Products · Brief ·
  Deliverables · Deadlines) become deliverables is in
  `scripts/_worklist-sheet.js` (pure, tested with DMM's sheet in
  `_worklist-sheet.test.js`): "Name – date" deadlines are one deliverable
  each; a numbered product list is one per product (duplicates once);
  "N per week" is recurring; other lines each take the product's deadline; a
  product with none gets one named from its brief; lines ending "?" are the
  client's notes and join the brief.
- `scripts/_worklist-apply.js` checks the whole plan with the worklist rules,
  finds or creates the company, and inserts the workstreams and deliverables
  in one statement (all or nothing). A workstream the company already has
  (same title) is skipped, so re-running is safe. `exceljs` (a dev
  dependency) reads the file.

### Client portal API (`/api/client`)
- The only endpoints serving people outside Peny (`api/client.js` → routes in
  `api/_client.js`; vercel.json rewrites `/api/client/*` with `?route=`):
  `GET /api/client/view` (everything the visitor may see) and
  `POST /api/client/deliveries/:id/response` (approve / request changes).
- **Scope first, once.** `dispatchClient()` resolves the route, then
  `resolveScope(req, sql)` — the only place a portal scope is built from a
  request — then runs the handler with the scope and nothing else about the
  visitor:
  - `X-Portal-Token` header (a project's portal link) → that project. It can
    look and **send requests** (below), never answer or reply. A token beats a
    session if both come (the lesser view).
  - Otherwise a Clerk session: the active organisation from the verified token
    (`o.id`, v1 `org_id`) → the company with that `clerk_org_id`. Never an id
    from the body, query or path. Anyone with an `app_users` row is refused
    (403 `staff`); no organisation → 403 `no_organisation`; an organisation
    with no company → 403 `no_portal`. An impersonation (`act` claim) can
    view but not answer.
  - Stage 2 adds a signed one-time link (POST only) as another scope kind.
- **Reads**: `readClientView(sql, scope)` in `api/_client-view.js` is the
  only code reading data for a client. Every query carries the scope itself
  (`scope.companyId`/`scope.projectId` and `scope.ws`), explicit columns only
  (never `internal_notes`, `owner_id`, `sent_by`, …), deliverables only if
  `client_visible`, workstreams only if they have one. Statuses leave as the
  client's labels; who at Peny sent or recorded something isn't said.
  `_client-view.test.js` checks those query rules by reading the file, and
  `_worklist.test.js` does the same for the client's write.
- **Writes**: answers go through `respondToDelivery()` (`_worklist.js`), whose
  client branch repeats the company and visibility conditions inside the
  UPDATE. Another company's round, or a hidden one, reads as 404.
- **What each scope sees.** Company: its workstreams → visible deliverables →
  rounds (links, notes, answers, previews), `can_respond` on the latest
  unanswered round. Project link: the project (name, status, brief, shoot
  dates, Frame.io link), client, work log and post-production schedule as
  the old portal did, plus its worklist (client-visible deliverables) and what
  was asked for through the link.
- **Where it isn't structural** (read before relying on it):
  - Any Slate user can run any query through `/api/db` ("Database
    access"), so all of the above holds against clients and the public, not
    against staff.
  - Who is staff is decided at first sign-in (`api/_me.js`): an open staff
    invitation for one of the account's verified addresses. So an invitation
    is a grant to whoever controls that address, and it doesn't expire until
    it's used.
  - A project link is a bearer secret with no expiry: whoever has it sees
    that project, and can send requests through it. It can be forwarded, so it
    can be replaced (the old one stops working) or turned off from the
    project's "Client link" control (`POST retainers/projects/:id/link`,
    token made on the server), and what it can do is limited: requests only,
    each needing a typed name (never verified), marked "Sent via project
    link" on its card, capped at ten unanswered per project, and refused once
    the project is Delivered. Link requests don't count toward a company's
    signed-in cap, so a forwarded link can't block its clients.
  - Organisation membership is trusted from Clerk's signed session token;
    removing someone takes effect when their token refreshes (about a
    minute).
  - Slate is single-workspace (`workspaceId()`); the `user_id = ws`
    conditions are belt and braces, not multi-tenancy.
  - The static checks read query text: they catch a missing condition or a
    forbidden column, not a wrong join. The integration suite
    (`_client.integration.test.js`) covers behaviour.
- The old token endpoint (`GET /api/portal?token=`) and page
  (`public/portal.html`) are gone; `api/portal.js` answers 404 for anything
  but its `?view=` routes.

### Client portal page (`portal.html`, `src/portal/`)
- One page for both ways in, reading one endpoint (`GET /api/client/view`):
  `/portal/<token>` (a project's link: that project, read-only) and `/portal`
  (a client signed in with Clerk: their company's worklist). vercel.json
  sends both to `portal.html`. The page only decides which credential to send
  (the `X-Portal-Token` header or the Clerk session); what it draws comes
  from the view.
- Its own Vite entry (`vite.config.js` builds `index.html` and
  `portal.html`), so the bundle holds no `db/client.js`, no database URL and
  no app code; Clerk is only loaded for the signed-in way in.
  `<meta name="referrer" content="no-referrer">` keeps a link's token out of
  Referer headers when a client opens Frame.io.
- Signing in: Clerk's prebuilt sign-in (email code, set in the Clerk
  dashboard); an invitation link (`__clerk_status=sign_up`) mounts sign-up
  so the ticket is used. Then the page makes the client's organisation the
  active one (asking which, if they're in more than one) — the API scopes by
  it. No organisation → "isn't linked to a client portal"; Slate staff →
  "you're signed in as Peny". A client who opens Slate (`/`) is sent here.
- **The board** (`boardHtml`, `portalColumns` in `render.js`; both views use it):
  three columns. **Requests** on the left (submitted requests, not-started
  client-visible deliverables as "Up next", and answered requests folded),
  **In progress** in the middle and widest, **Approved** on the right, narrower
  and quieter, **grouped by project** (one fold per project, A–Z, work outside a
  project last as "Other work"; no headings when there is only one project; the
  whole column is closed by default on a phone). Workstreams carry `project` /
  `project_id` in the client view for this.
  The left column never folds anything (answered requests sit under an
  "Answered" heading) and scrolls on its own on a desktop once it is taller than
  the screen. An approved item keeps its link (Open in Frame.io) and the comment
  that came with the approval.
  Ready for review, waiting on you and delivered-to-approve sit at the top of the
  middle column under "Needs you", marked with an amber edge and what to do. A
  summary line and jump links lead the page. On a phone the columns stack in
  the order Needs you, In progress, Requests, Approved (CSS `order`, no
  duplicated markup). Grouping is by status, not workstream: each card carries
  its workstream's name and workstream briefs are no longer shown. Every
  `#d-<id>` anchor still exists.
- **Close to live** (`src/portal/live.js`): every 30 s while the page is showing
  (and when it comes back into view) the portal asks for the view again and
  redraws only if it changed. It never redraws over someone typing or with a form
  or confirm open (it waits a tick), and keeps the scroll, the open folds and the
  left column's scroll. 30 s keeps an office of clients well under the API's
  60-requests-a-minute-per-IP limit.
- **Approve can carry a comment** (optional, on a round, on a delivered deliverable
  and on the emailed Approve page): stored on the round's `client_comment`, or
  `deliverables.approved_comment` (`drizzle/0042`) when there is no round; shown
  to the client and on the Worklist, and quoted in the digest's approvals.
- **The client says which project a request is for** (`projects` in the company
  view; the form shows a picker when there are several, sends the only one
  silently, and nothing when there are none). `POST client/requests` takes
  `project_id`, which must be one of the company's own projects and not
  Delivered (422 otherwise). The request is then filed under it, so Accept never
  asks; with none named, staff still get the old rule (the one project, or the one
  retainer, else a question).
- `main.js` boots and handles errors, `render.js` draws the two views and
  the approve / comments-are-in / request-changes flow (approve is two taps;
  changes need words), `schedule.js` is the post-production grid ported from the old page,
  `util.js` holds helpers, `portal.css` the styles (Slate's tokens and fonts,
  so both themes; phone first, 44px targets).

### Stage 2: client requests, triage, alerts, Approve links, board cards

Migration `drizzle/0036` (also in `runMigrations()`): `companies.lead_id`
(ON DELETE RESTRICT: staff are removed through the query proxy, so the database
is the guard), `requests` decision columns, `deliverables.client_reply`,
`alert_log`, `action_links`. All server-only.

- **Requests** (`POST /api/client/requests`, `submitRequest` in `_worklist.js`;
  a signed-in client's, or a project link's — see Scope above):
  a signed-in client's gets the company from the session, ten unanswered per
  company (the cap is in the writing statement). The client sees the company's requests
  as Submitted / Accepted (date read live from the deliverable, with a link to it
  in their worklist) / Declined (our note). Nothing about who decided leaves.
- **Requests on the task board** (`api/_requests.js`, `src/views/request-cards.js`;
  the **Tasks** tab's bubble, from `GET retainers/request-count` → `{ new, feedback }`: new requests, plus
  feedback waiting to be acted on — `changes_requested` or `comments_in` deliverables that are yours or nobody's; it clears when the next round goes out).
  There is no separate inbox: `GET retainers/board` returns `requests` (the new
  ones, oldest first) beside `cards`, and each is a card in the **Unassigned**
  tray (and "New requests" first on the phone list), marked "Sent via project
  link" when it was. They ignore "Just mine" and the assignee filter; only the
  project filter hides one. Not draggable (a request isn't work yet).
  **Accept** is on the card: one popover with the date (filled with the one they
  asked for, optional); the body is optional all round, the server supplies the
  rest: owner = whoever accepts, project = the request's own / the company's only
  project / its one retainer (409 `needs_project` with the list when it can't tell,
  and the popover asks; 422 when the company has no project), workstream = the
  project's "Requests" one (made on first use); a named `workstream_id` still
  works (also an older company-level one). It creates the deliverable (client-visible,
  planned) and marks the request accepted in ONE statement. **Decline** asks for
  the note the client reads. Clicking a card shows their full words with both.
  After accepting, the deliverable is the only record; Planned to Doing on the
  board already sets In progress for the client. The new owner gets the "Tasks
  assigned to you" email (not when it is you). The new-request alert email still
  goes to the lead / superadmins, and opens the board.
- **Waiting on you**: `POST /api/client/deliverables/:id/reply` keeps the latest
  note (cleared with `waiting_note` by `statusPatch`), never shown on a project
  link, alerts the owner every time.
- **Alerts** (`api/_alerts.js`), all through `notify()`: kinds `alert_*`, each
  mutable, independent of the digest. Routing: deliverable owner, else the
  company lead — only while `settings.show_leads` is on (off by default; it
  hides the lead in the UI, stops new companies getting one, and lets a lead be
  removed; `api/_leads.js`) — else every superadmin (logged). Immediate: new request, changes
  requested, client reply. Hourly (`/api/reminders?type=alerts`, needs
  `CRON_SECRET`, runs every day, sends 07:00–20:00 London only): due within 48 h
  and not in review; client input older than `CLIENT_INPUT_ALERT_DAYS` (7). Once
  per item via `alert_log` (cycle = due date / `waiting_since`); a claim is given
  back if nothing could be sent. Approvals go in the 09:00 digest ("Approved since
  your last digest", Monday covers the weekend).
- **Delivery email + Approve link** (`api/_delivery-mail.js`): sending a round
  emails, each with their own link: everyone in the company's Clerk org, the
  project's client contact (`projects.client_id`), and any extra addresses on
  the project (`projects.portal_emails`, edited in the project's Client link
  panel via `PUT retainers/projects/:id/portal-emails`). One address = one
  email (a login wins over a bare address); Slate staff never get one
  (`deliveryRecipients`). So a client with **no login** can approve and ask
  for changes; a Clerk failure doesn't stop them being emailed. The sender is
  told who, or why no one. Link = 32 random bytes, stored hashed, carried in
  the URL fragment of `/portal/approve`, 14 days. It resolves to a `delivery`
  scope (`X-Action-Token`; one round; never consults a session). Opening the
  page only reads (`GET /api/client/link`); the buttons POST. **Approve**
  (`/api/client/link/approve`) uses the link up in the same statement that
  approves. **Ask for changes** (`/api/client/link/changes { comment }`, the
  comment required) answers the round the same way but leaves the link unused
  (the answered round is what stops it), and alerts the owner. The email's
  "Request changes" goes to the portal for someone with a login, and to the
  same confirm page with the box open (`?changes=1`) for someone without one.
  The record says who: `responded_by` is a Clerk id, or `email:<address>` for
  someone without a login, with `action_links.name` (or the address) as the
  name. A link dies when its round is answered, superseded or taken back, when
  its person is removed from the portal, or when its address is taken off the
  project's list. (An address changed on the contact itself isn't caught: its
  links expire in 14 days.) Routes declare which scope kinds they serve (`kinds`).
- **Task board cards** (`api/_board.js`): deliverables are cards read from the
  deliverables table. The column mapping, which cards appear, and every drag
  refusal are in `_retainer-rules.js` (`boardColumn`, `boardShows`,
  `statusAfterBoardDrag`); the browser holds no copy. A drag only moves planned
  <-> in progress; anything else is refused with a sentence (shown in a notice
  that stays until dismissed). Unowned open deliverables sit in the tray; dragging
  one out claims it. No acknowledgement, bell notifications or comments for cards.
  Not on the Dashboard task widget (What's due already lists them).

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

On phones all three share one behaviour: `mountStatusSwitch()`
(`src/views/board-status.js`) adds a segmented status control above the board
and shows one column at a time. It's called at the end of each board's
render; give each column element the attribute you pass as `colAttr`
(`data-col` or `data-status-col`).

## Tasks system
- Tasks live in one `tasks` table. The board, the mobile list and (later)
  canvas checklists are all views over it. Do not create a second task store.
- Notifications are generated from `task_events` only. If you add a mutation,
  write the event; do not create notifications directly from a handler. The
  single choke point is `recordEvent()` in `api/_tasks.js` — immediate email
  rides on it too.
- Task API routes live in the `ROUTES` table in `api/_tasks.js`. The router is
  reached via `vercel.json` rewrites onto `/api/portal?view=tasks` (the same
  delegation pattern as `_dashboard.js` and `_offloads.js`), so `/api/tasks/*`
  and `/api/notifications/*` are clean URLs without a function of their own.
  It was built this way while the project was capped at 12 functions on
  Vercel Hobby; see "Serverless Functions" for the current position.
- Desktop and mobile are separate shells over a shared API and shared card
  detail component (`src/views/tasks.js`). Do not attempt to make the column
  board responsive.
- Where it sits in the app: the board is the Tasks tab (`#tasks`). The
  Dashboard tab (`/`) carries its own compact Tasks section, whose "View
  board" goes to the board. The desktop board's filters and + New task live
  in the page toolbar
  (`toolbarFiltersHtml()` / `bindToolbarFilters()`; + New task, the header's
  New › Task and the N key all call `openQuickAdd()`).
- The notification bell is in the app header on every page. TasksView owns
  the count (`setUnread()` refreshes the header). The board's poll reports it
  while the board or the dashboard section is on screen; elsewhere
  `watchUnread()` checks `/api/notifications?unread=true` once a minute (every
  5 minutes after repeated failures). `openNotifications()` shows the list,
  and clicking one calls `showTask()`, which goes to the board first when
  needed because the detail stays in step through the board's poll.
- The task detail is redrawn on every poll that changes something.
  `_renderDetail()` carries over focus, the caret and a half-written comment,
  so keep that if you change how it renders.
- Due dates and project links are always optional. Nothing may block task
  creation except a non-empty title.
- Deleting: only whoever raised the task (`canDeleteTask()` in
  `api/_task-rules.js`; `DELETE /api/tasks/:id` answers 403 to anyone else,
  and the detail only shows them the button). It is a hard delete: comments,
  events and notifications cascade. It is the one mutation that writes no
  event, because the event would be deleted with the task. Other boards find
  out through `live_ids`, which every `updated_since` poll carries (the ids of
  all unarchived tasks): the client drops any card that isn't listed, and
  treats a 404 from any task call the same way (`_goneIfMissing()`).
- Archiving: the daily `task-nudge` cron (`api/reminders.js`) first runs
  `archiveDoneTasks()`, which sets `archived_at` on tasks that have sat
  untouched (`updated_at`) in Done for `ARCHIVE_AFTER_DAYS` (30), and writes an
  actor-less `archived` event for each. Archived tasks drop out of every list
  and the unread count but stay readable by id. There is no unarchive UI yet.
- Removing a user (Settings › Users) keeps their work. `tasks.created_by` and
  `task_comments.author_id` are nullable with `ON DELETE SET NULL` (0031), as
  the assignee and event actor already were. The UI calls a missing person "a
  former member", while events Slate made itself (the nudge, the auto-archive)
  read as "Slate". Nobody can delete a task whose creator has gone; it leaves
  the board by being finished and archived. `deleteAppUser()` touches the
  affected tasks' `updated_at`, since a foreign key's SET NULL doesn't, so
  polling boards pick the change up.
- A poll drops its result if any write started while it was in flight
  (`_writeSeq`) and the next one retries from the same `updated_since`.
  Otherwise a stale snapshot could undo that write on screen, or prune a task
  that was created mid-poll.
- `tasks.parent_type` / `parent_id` are reserved for Phase 3 (absorbing canvas
  checklist items). Columns only — no logic reads them.
- Behaviour rules (ordering, mentions, notification fan-out, acknowledgement,
  validation) are pure functions in `api/_task-rules.js` and unit-tested there.
  Put new rules in that file rather than inline in a handler.
- `api/_tasks.integration.test.js` exercises the handlers against a real
  Postgres. It skips unless `TASKS_TEST_DATABASE_URL` is set and needs
  `npm i -D pg` (the app's Neon HTTP driver cannot reach localhost). Build the
  test database from `drizzle/0025_add_tasks.sql` then
  `0031_keep_tasks_when_user_removed.sql`.
