-- 0051_add_push_log.sql
-- The last 30 push notifications Slate tried to send each person, and what
-- happened to each (sent, failed, or skipped and why), so "why didn't I get
-- that?" can be answered in Settings › Notifications. api/_push.js writes it
-- and prunes it. Read only through /api/push/status; the table is on the
-- personal-tables list in api/db.js.
--
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

CREATE TABLE IF NOT EXISTS push_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id  TEXT NOT NULL,
  kind           TEXT,
  title          TEXT,
  outcome        TEXT NOT NULL,
  detail         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_log_user_idx ON push_log (clerk_user_id, created_at DESC);
