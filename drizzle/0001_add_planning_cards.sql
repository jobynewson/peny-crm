ALTER TABLE projects ADD COLUMN IF NOT EXISTS planning_cards jsonb NOT NULL DEFAULT '[]'::jsonb;
