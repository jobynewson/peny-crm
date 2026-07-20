-- Brand context (Peny / Loop Creative). Every client-facing pipeline entity
-- carries a brand. NOT NULL DEFAULT 'peny' backfills all existing rows to Peny
-- automatically. CHECK constraint enforces the two-value enum; brand index
-- supports the switcher's scoped queries.
ALTER TABLE contacts        ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'peny';
ALTER TABLE projects        ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'peny';
ALTER TABLE budgets         ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'peny';
ALTER TABLE marketing_cards ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'peny';

ALTER TABLE contacts        DROP CONSTRAINT IF EXISTS contacts_brand_check;
ALTER TABLE projects        DROP CONSTRAINT IF EXISTS projects_brand_check;
ALTER TABLE budgets         DROP CONSTRAINT IF EXISTS budgets_brand_check;
ALTER TABLE marketing_cards DROP CONSTRAINT IF EXISTS marketing_cards_brand_check;
ALTER TABLE contacts        ADD CONSTRAINT contacts_brand_check        CHECK (brand IN ('peny','loop'));
ALTER TABLE projects        ADD CONSTRAINT projects_brand_check        CHECK (brand IN ('peny','loop'));
ALTER TABLE budgets         ADD CONSTRAINT budgets_brand_check         CHECK (brand IN ('peny','loop'));
ALTER TABLE marketing_cards ADD CONSTRAINT marketing_cards_brand_check CHECK (brand IN ('peny','loop'));

CREATE INDEX IF NOT EXISTS idx_contacts_brand        ON contacts(brand);
CREATE INDEX IF NOT EXISTS idx_projects_brand        ON projects(brand);
CREATE INDEX IF NOT EXISTS idx_budgets_brand         ON budgets(brand);
CREATE INDEX IF NOT EXISTS idx_marketing_cards_brand ON marketing_cards(brand);
