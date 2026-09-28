-- 0033_add_retainer_worklists.sql
-- The retainer worklist and client portal: a company's workstreams, the
-- deliverables in each, and the rounds (deliveries) sent for review. Plus the
-- requests table, which stage 2's client requests will fill; nothing uses it
-- yet.
--
-- Read and written ONLY through the server (/api/retainers, /api/client),
-- never from src/db/client.js. Behaviour rules (due kinds, statuses, rounds,
-- responses, the client-facing labels) live in api/_retainer-rules.js.
--
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

-- Enums, like task_status: the API validates against them and a bad value
-- should be impossible in the database too. CREATE TYPE has no IF NOT EXISTS.
DO $$ BEGIN
  CREATE TYPE workstream_status AS ENUM ('active', 'paused', 'complete');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE deliverable_status AS ENUM
    ('planned', 'in_progress', 'waiting_on_client', 'in_review', 'changes_requested', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE deliverable_due_kind AS ENUM ('exact', 'month', 'window', 'recurring');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE delivery_response AS ENUM ('pending', 'approved', 'changes_requested');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE request_status AS ENUM ('new', 'accepted', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS workstreams (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    TEXT NOT NULL,                        -- workspace owner's Clerk ID
  -- The client. A company with a worklist can't be deleted out from under it.
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  -- Optional: the project this workstream belongs to. A portal token link for
  -- that project shows its workstreams (and nothing else).
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  brief      TEXT,                                 -- shown to the client
  status     workstream_status NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workstreams_company_idx ON workstreams (company_id, sort_order);
CREATE INDEX IF NOT EXISTS workstreams_project_idx ON workstreams (project_id);

CREATE TABLE IF NOT EXISTS deliverables (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workstream_id  UUID NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  format         TEXT,
  owner_id       UUID REFERENCES app_users(id) ON DELETE SET NULL,
  -- due_date is always the DEADLINE, whatever the kind: exact = that day,
  -- month = its last day, window = the window's last day, recurring = the next
  -- one (if known). due_label keeps the words ("1st week of November").
  due_kind       deliverable_due_kind NOT NULL DEFAULT 'exact',
  due_date       DATE,
  due_label      TEXT,
  cadence        TEXT,                             -- recurring only: weekly | fortnightly | monthly | quarterly
  status         deliverable_status NOT NULL DEFAULT 'planned',
  waiting_since  TIMESTAMPTZ,                      -- set on entering waiting_on_client, cleared on leaving
  waiting_note   TEXT,                             -- shown to the client: what we need from them
  client_visible BOOLEAN NOT NULL DEFAULT false,   -- hidden until someone shows it
  internal_notes TEXT,                             -- never leaves Slate
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS deliverables_workstream_idx ON deliverables (workstream_id, sort_order);
CREATE INDEX IF NOT EXISTS deliverables_owner_idx ON deliverables (owner_id);
-- Drives the what's-due feed: open work by deadline.
CREATE INDEX IF NOT EXISTS deliverables_open_due_idx ON deliverables (due_date) WHERE status <> 'approved';

-- One row per round sent for review. round = previous + 1, made race-safe by
-- the unique (deliverable_id, round).
CREATE TABLE IF NOT EXISTS deliveries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deliverable_id    UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  url               TEXT NOT NULL CHECK (url ~* '^https?://'),   -- becomes a link in the portal
  note              TEXT,
  round             INTEGER NOT NULL CHECK (round > 0),
  sent_by           UUID REFERENCES app_users(id) ON DELETE SET NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_response   delivery_response NOT NULL DEFAULT 'pending',
  client_comment    TEXT,
  responded_at      TIMESTAMPTZ,
  -- Who gave the response: a client in the portal, or a Peny user recording an
  -- approval that came by email. A Clerk id, because clients have no app_users
  -- row; the name is kept so the record reads without a Clerk lookup.
  responded_by      TEXT,
  responded_by_name TEXT,
  preview_title     TEXT,                          -- link preview, fetched after sending
  preview_image     TEXT,
  UNIQUE (deliverable_id, round)
);

-- Client requests (stage 2). Triage accepts or declines; accepting creates a
-- task on the task board with its owner and date, recorded in task_id, and
-- from then on the board carries the work — no second inbox.
CREATE TABLE IF NOT EXISTS requests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        TEXT NOT NULL,                    -- workspace owner's Clerk ID
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  submitted_by   TEXT,                             -- Clerk id: clients have no app_users row
  title          TEXT NOT NULL,
  detail         TEXT,
  wanted_by      DATE,
  status         request_status NOT NULL DEFAULT 'new',
  task_id        UUID REFERENCES tasks(id) ON DELETE SET NULL,
  deliverable_id UUID REFERENCES deliverables(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS requests_company_status_idx ON requests (company_id, status);
