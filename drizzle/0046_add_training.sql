-- 0046_add_training.sql
-- Personal Tools › Training: one profile per person and one row per completed
-- session. Keyed by Clerk id (like notification_settings). Read and written
-- only through /api/training; /api/db refuses statements that touch them.
--
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

CREATE TABLE IF NOT EXISTS training_profiles (
  clerk_user_id TEXT PRIMARY KEY,
  sport         TEXT NOT NULL,
  areas         JSONB NOT NULL DEFAULT '[]'::jsonb,
  kit           JSONB NOT NULL DEFAULT '[]'::jsonb,
  gen           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id    TEXT NOT NULL,
  sport            TEXT NOT NULL,
  kind             TEXT NOT NULL,
  week             INTEGER,
  session_key      TEXT,
  items            JSONB,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER
);

-- A program session (sport, week, A/B/C) is done once per person.
CREATE UNIQUE INDEX IF NOT EXISTS training_sessions_program_uq
  ON training_sessions (clerk_user_id, sport, week, session_key) WHERE kind = 'program';
CREATE INDEX IF NOT EXISTS training_sessions_user_idx
  ON training_sessions (clerk_user_id, completed_at DESC);
