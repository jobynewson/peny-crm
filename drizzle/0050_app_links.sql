-- 0050_app_links.sql
-- Links to the team's other apps (Peny Fence and the like). Shown under Apps in
-- the account menu for every signed-in member; superadmins edit them in
-- Settings > Company. Each entry is { name, url }, http(s) only.
-- Also applied by runMigrations() in src/db/client.js.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS app_links JSONB NOT NULL DEFAULT '[]'::jsonb;
