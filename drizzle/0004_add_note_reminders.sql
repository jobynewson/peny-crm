ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS reminder boolean NOT NULL DEFAULT false;
