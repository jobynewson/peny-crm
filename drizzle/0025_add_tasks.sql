-- Slate task board (Phase 1). One table behind the desktop board and the
-- mobile list; task_events is the single choke point that notifications are
-- generated from. Mirrors runMigrations() in src/db/client.js, which is what
-- actually applies schema changes at app boot.

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('todo', 'doing', 'done');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tasks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  status          task_status NOT NULL DEFAULT 'todo',
  assignee_id     UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_by      UUID NOT NULL REFERENCES app_users(id),
  due_at          TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  nudged_at       TIMESTAMPTZ,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  parent_type     TEXT,
  parent_id       UUID,
  position        DOUBLE PRECISION NOT NULL DEFAULT 0,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_comments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES app_users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id   UUID REFERENCES app_users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_id     UUID NOT NULL REFERENCES task_events(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_status_archived_idx ON tasks (status, archived_at);
CREATE INDEX IF NOT EXISTS tasks_assignee_status_idx ON tasks (assignee_id, status);
CREATE INDEX IF NOT EXISTS tasks_project_idx         ON tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_updated_idx         ON tasks (updated_at);
CREATE INDEX IF NOT EXISTS tasks_unacknowledged_idx  ON tasks (assignee_id)
  WHERE acknowledged_at IS NULL AND assignee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments (task_id, created_at);
CREATE INDEX IF NOT EXISTS task_events_task_idx    ON task_events (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_inbox_idx ON notifications (recipient_id, read_at, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uidx ON notifications (recipient_id, event_id);
