# Peny CRM

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
Copy `.env.local` and fill in your keys:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...   # Clerk → API Keys
VITE_DATABASE_URL=postgresql://...        # Neon → Connection Details (pooled)
```

### 3. Run the database schema
In the Neon console SQL editor, run the contents of `schema.sql`.
(Already done if you followed the setup steps.)

### 4. Run locally
```bash
npm run dev
```
Open http://localhost:5173 — you'll see the Clerk sign-in screen.
Sign up with your email, then you're in.

### 5. Deploy to Vercel
- Push this repo to GitHub
- Go to vercel.com → New Project → import your repo
- Add environment variables in Vercel dashboard:
  - `VITE_CLERK_PUBLISHABLE_KEY`
  - `VITE_DATABASE_URL`
- Deploy

## Project structure

```
src/
  auth/
    clerk.js        # Clerk initialisation and helpers
  db/
    schema.js       # Drizzle ORM schema (mirrors schema.sql)
    client.js       # DB connection + all query helpers
  app.js            # Top-level app shell and router
  main.js           # Entry point — auth → data load → app mount
  style.css         # Global styles
index.html          # App shell HTML
vercel.json         # Routing config for Vercel
drizzle.config.js   # Drizzle Kit config (for future migrations)
schema.sql          # Raw SQL schema (run once in Neon)
```

## Architecture notes

- **Auth:** Clerk handles everything. No user table in the DB — Clerk user IDs
  are stored as `user_id TEXT` on every table and used to scope all queries.

- **Database:** Neon (Postgres) via the `@neondatabase/serverless` driver,
  with Drizzle ORM for type-safe queries.

- **Routing:** Client-side only. `vercel.json` rewrites all paths to
  `index.html` so navigation works on refresh.

- **Views:** `app.js` renders placeholder views for each section. Replace each
  `renderXxxPlaceholder` method with a real view module as you build them out.
  The data (`this.contacts`, `this.projects`, `this.budgets`) is already loaded
  and available.
