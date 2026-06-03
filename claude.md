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

### Views
- Each feature (contacts, projects, etc.) has a view module in `src/views/`
- View modules export a `render()` function that returns HTML
- `app.js` mounts the active view into the DOM

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
