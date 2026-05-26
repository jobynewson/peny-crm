ALTER TABLE projects ADD COLUMN IF NOT EXISTS portal_show_budget boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS portal_show_shoots boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS portal_show_planning boolean NOT NULL DEFAULT false;
