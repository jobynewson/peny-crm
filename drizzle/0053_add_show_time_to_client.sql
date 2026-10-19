-- 0053_add_show_time_to_client.sql
-- Per-project switch: signed-in clients see the project's logged time in the
-- portal (api/_client-time.js). Off by default.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS show_time_to_client BOOLEAN NOT NULL DEFAULT false;
