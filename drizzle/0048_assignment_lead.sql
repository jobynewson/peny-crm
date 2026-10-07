-- 0048_assignment_lead.sql
-- Who looks after unassigned work. Tasks and deliverables with no owner sit in
-- To do on the task board; the person chosen here (Settings › Unassigned work)
-- gets one email when one has waited two working days, and the alerts about
-- unowned work when its company has no lead. NULL means the superadmins.
-- Also applied by runMigrations() in src/db/client.js.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS assignment_lead_id UUID REFERENCES app_users(id) ON DELETE SET NULL;
