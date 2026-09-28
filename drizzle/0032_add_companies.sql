-- 0032_add_companies.sql
-- Companies: the organisation a contact works for and a project is for. Until
-- now a contact's company was free text (contacts.company) and projects pointed
-- at a person. The retainer worklist, the client portal and the Clerk org link
-- all hang off a company.
--
-- Deliberately NO backfill: existing contacts stay unlinked (company_id NULL)
-- and are linked by hand, one at a time, from the contact form. Nothing is
-- guessed from the free text. contacts.company stays until that's done — the
-- form keeps it in step with the linked company's name so every reader of the
-- old column keeps working.
--
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

CREATE TABLE IF NOT EXISTS companies (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      TEXT NOT NULL,                 -- workspace owner's Clerk ID
  name         TEXT NOT NULL,
  clerk_org_id TEXT,                          -- the client portal's Clerk organization
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One company per name, ignoring case, so "DMM" typed twice is one company.
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_uidx ON companies (user_id, lower(name));
-- An org belongs to one company (NULLs don't collide).
CREATE UNIQUE INDEX IF NOT EXISTS companies_clerk_org_uidx ON companies (clerk_org_id);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS contacts_company_idx ON contacts (company_id);
CREATE INDEX IF NOT EXISTS projects_company_idx ON projects (company_id);
