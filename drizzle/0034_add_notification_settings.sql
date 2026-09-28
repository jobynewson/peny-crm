-- 0034_add_notification_settings.sql
-- Per-person email settings for api/_notify.js, the one path every Slate email
-- takes. One row per person per kind they have changed; no row means the
-- kind's default (KINDS in api/_notify.js). Keyed by Clerk id (like
-- user_notes.clerk_id) so client portal users, who have no app_users row, can
-- have settings too when stage 2 starts emailing them.
--
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

CREATE TABLE IF NOT EXISTS notification_settings (
  clerk_user_id TEXT NOT NULL,
  kind          TEXT NOT NULL,
  email         BOOLEAN NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clerk_user_id, kind)
);

-- The reminder roundup used to be one workspace-wide switch
-- (settings.reminder_roundup) that reached whoever owned the settings row: the
-- workspace owner. Carry it over to them as a personal setting. Harmless on
-- every later boot (ON CONFLICT keeps whatever they've chosen since), and it
-- must never stop the app loading, hence the guard.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'settings' AND column_name = 'reminder_roundup') THEN
    INSERT INTO notification_settings (clerk_user_id, kind, email)
    SELECT user_id, 'reminder_roundup', true FROM settings WHERE reminder_roundup = true
    ON CONFLICT (clerk_user_id, kind) DO NOTHING;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'carrying over the reminder roundup failed: %', SQLERRM;
END $$;
