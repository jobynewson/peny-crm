-- Personal to-do list shown on the Dashboard.
-- Private to one person (keyed by Clerk ID, same pattern as user_notes) — no
-- other member of the workspace ever reads these rows.
--
-- Only hand-typed to-dos live here. Tasks allocated to the user elsewhere in
-- the app (project deliverables, marketing sub-tasks, canvas checklist rows,
-- planning board cards, post-production deadlines, calendar deadlines) are
-- gathered at read time and are deliberately NOT copied into this table — the
-- source stays the single owner of that data.
CREATE TABLE IF NOT EXISTS user_todos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_id   TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  due_date   DATE,
  done       BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_todos_clerk_idx ON user_todos (clerk_id);
