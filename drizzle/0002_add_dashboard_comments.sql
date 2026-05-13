ALTER TABLE projects ADD COLUMN IF NOT EXISTS dashboard_comments jsonb NOT NULL DEFAULT '[]'::jsonb;
