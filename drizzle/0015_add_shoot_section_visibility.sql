ALTER TABLE shoots ADD COLUMN IF NOT EXISTS section_visibility JSONB NOT NULL DEFAULT '{}'::jsonb;
