-- 0043_test_mode.sql
-- A testing switch: while settings.test_mode is on, the emails about the
-- worklist and portal work (a delivery for review, the alerts, tasks assigned,
-- the due digest) go to test_emails instead of the people they are for. Off by
-- default. Also applied by runMigrations() in src/db/client.js.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS test_mode   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS test_emails JSONB   NOT NULL DEFAULT '[]'::jsonb;
