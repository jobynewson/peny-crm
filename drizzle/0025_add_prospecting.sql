-- Prospecting / outbound. Widen contacts into an organisation record with an
-- outbound lifecycle. A prospect is a contact whose lifecycle_stage isn't 'won'
-- yet — converting is a status change, not a record migration. Existing client
-- data survives untouched: lifecycle_stage NOT NULL DEFAULT 'won' backfills all
-- existing rows to 'won'. first_name is relaxed to nullable so a Places-sourced
-- org with no known contact person is valid (name lives in `company`).

ALTER TABLE contacts ALTER COLUMN first_name DROP NOT NULL;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifecycle_stage     TEXT NOT NULL DEFAULT 'won';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sector              TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tier                TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS priority            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fit_note            TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pitch_angle         TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS area                TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS website             TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_rating       NUMERIC(2,1);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_review_count INTEGER;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner               TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_contacted_at   TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS next_action_at      DATE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS next_action         TEXT;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_lifecycle_stage_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_lifecycle_stage_check
  CHECK (lifecycle_stage IN ('prospect','contacted','engaged','proposal','won','lost','nurture'));
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_tier_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_tier_check
  CHECK (tier IS NULL OR tier IN ('A','B','C'));

CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle       ON contacts(brand, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_owner           ON contacts(owner);
CREATE INDEX IF NOT EXISTS idx_contacts_next_action_at  ON contacts(next_action_at);

-- Outreach log — appending a row bumps the parent's last_contacted_at (done in app).
CREATE TABLE IF NOT EXISTS outreach_activity (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id    TEXT,
  type       TEXT NOT NULL DEFAULT 'note',
  body       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE outreach_activity DROP CONSTRAINT IF EXISTS outreach_activity_type_check;
ALTER TABLE outreach_activity ADD CONSTRAINT outreach_activity_type_check
  CHECK (type IN ('call','email','meeting','note'));
CREATE INDEX IF NOT EXISTS idx_outreach_activity_contact ON outreach_activity(contact_id);

-- Per-sector outbound playbook (brand-scoped reference content).
CREATE TABLE IF NOT EXISTS sector_angles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      TEXT NOT NULL,
  brand        TEXT NOT NULL DEFAULT 'peny',
  sector       TEXT NOT NULL,
  tier         TEXT,
  why_video    TEXT,
  opening_hook TEXT,
  offer        TEXT,
  best_time    TEXT,
  proof        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sector_angles DROP CONSTRAINT IF EXISTS sector_angles_brand_check;
ALTER TABLE sector_angles ADD CONSTRAINT sector_angles_brand_check CHECK (brand IN ('peny','loop'));
CREATE INDEX IF NOT EXISTS idx_sector_angles_brand_sector ON sector_angles(brand, sector);
