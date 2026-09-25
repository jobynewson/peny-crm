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
    client.js             # Query helpers the views call (moving behind /api/db)
    api.js                # callDb(): browser side of POST /api/db
    roles.js              # Role → permission presets, shared with the server
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
- `src/db/client.js` - the database helpers views call. Helpers that have
  moved to the server are thin `callDb()` stubs; their queries live in
  `api/_db-ops.js`
- `api/db.js` + `api/_db-ops.js` - `POST /api/db`, authenticated database
  access for the browser (see "Database access" below)
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
- Server code connects with `DATABASE_URL` through `getSql()` in `api/_db.js`.
  The browser is moving to `POST /api/db` — see "Database access" below.

### Routing
- Client-side only (no server routes needed)
- `vercel.json` rewrites all paths to `index.html` for SPA routing to work on refresh

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
- Current functions: `ai`, `blob`, `callsheet`, `db`, `generate-ra`, `google`,
  `invite`, `maps`, `packing`, `portal`, `quote`, `realtime`, `reminders`,
  `track`.
  All Google Calendar work lives behind the single `google` function: shared
  plumbing in `api/_gcal.js`, the Team Calendar entry push in
  `api/_gcal-entries.js` — see "External calendar sync" below.
- `npm run dev` serves `/api/*` from these files too (a dev-only middleware in
  `vite.config.js`), so `.env.local` needs the server-only variables the
  routes use (at least `DATABASE_URL` and `CLERK_SECRET_KEY`).

### Database access (`/api/db`)
- The browser is moving off its direct database connection. `POST /api/db`
  (`api/db.js`) runs named operations from the allow-list in `api/_db-ops.js`;
  `callDb(op, ...args)` in `src/db/api.js` is the browser side.
- The server decides everything from the verified Clerk session: the workspace
  (`workspace.owner_id`), the caller's `app_users` row and role, and whether
  that role grants the op's permission (`ROLE_PRESETS` in `src/db/roles.js`,
  shared with the UI). A `workspaceId` passed from the browser is ignored, and
  writes only take the columns each op allow-lists (`pickFields`).
- Moved so far: `runMigrations` (any signed-in user; runs once per server
  instance; the DDL lives in `api/_migrations.js`) and the password manager
  (`vault` permission).
- **Moving a helper:** copy its query into an op in `api/_db-ops.js` (same
  Drizzle code; `db`, `workspaceId` and `appUser` come from the context), give
  it the permission it needs and an allow-list for anything it writes, then
  replace the body in `src/db/client.js` with `return callDb('name', …)`,
  keeping the signature so views don't change. Test it in
  `api/_db-ops.test.js`.
- **When a table has no helpers left in the browser**, revoke it from the
  browser's restricted role in Neon: `REVOKE ALL ON <table> FROM slate_app;`.
  Ready to revoke: `credentials`. When nothing is left, delete
  `VITE_DATABASE_URL`, drop the role, and remove the fallback in `api/_db.js`.

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
- `CLERK_SECRET_KEY` - Clerk secret key (server-only); the API routes use it
  to verify session tokens.
- `DATABASE_URL` - Neon PostgreSQL connection string (use pooled connection).
  Server-only: every `api/*.js` route connects through `getSql()` in
  `api/_db.js`, and it runs the migrations, so it must be the role that owns
  the tables. Never give it a `VITE_` prefix — Vite inlines every `VITE_*`
  variable into the browser bundle.
- `VITE_DATABASE_URL` - Transitional: the browser's direct connection for the
  helpers in `src/db/client.js` that haven't moved behind `/api/db` yet. Point
  it at the restricted `slate_app` role (reads and writes rows; no DDL, no
  roles). Delete it once every helper has moved (see "Database access").
  Server code falls back to it only while `DATABASE_URL` is unset.
- `DASHBOARD_TOKEN` - Fixed secret token gating the public office-display
  dashboard at `/dashboard/<token>` (served by `public/dashboard.html`, data
  from `/api/portal?view=dashboard`). Unset = the dashboard returns 503.
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
  - The ticker appears on BOTH the office dashboard and the in-app Dashboard,
    sharing the `settings.youtube_ticker` row. They reach the count by
    different routes: the office display via `/api/portal?view=dashboard`
    (gated by DASHBOARD_TOKEN), the app via `GET /api/blob?action=youtube&id=`
    (gated by Clerk). The app cannot call YouTube directly — YOUTUBE_API_KEY is
    server-side only and must never be given a VITE_ prefix, which would ship
    it to the browser. `?debug=1` surfaces the reason on both.

## Common Tasks

### Adding a new database table
1. Add schema to `src/db/schema.js` (Drizzle)
2. Add idempotent DDL (`CREATE TABLE IF NOT EXISTS …`) to `api/_migrations.js`
3. Add its queries as ops in `api/_db-ops.js` and same-named `callDb()` stubs
   in `src/db/client.js` (see "Database access"), not as direct queries

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
- `team-calendar.js` - Team calendar. Entries also push one-way to each user's
  own Google Calendar — see "External calendar sync" below.
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
- `planning-tabs.js` - A project's Planning tab: one tab strip holding ALL of
  the project's kanban boards and canvases (any number of each). See
  "Project planning tabs" below.
- `canvas.js` + `canvas-surface.js` - Planning canvas, a Milanote-style
  infinite planning/storyboarding surface — standalone via the Planning nav
  item's Canvases tab AND embedded in each project's Planning tab. See
  "Planning canvas" below.
- `post-production.js` - Post-production workflow
- `marketing.js` - Marketing. Its kanban (by status: Ideas → Planning → In
  Progress → Scheduled/Sent → Done) is one of three separate kanban
  implementations — see "Kanban boards" below.
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
  from elsewhere (e.g. the Planning nav item) needs no order bookkeeping. The
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
  user, because the Team Calendar is shared and anyone can already move
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
