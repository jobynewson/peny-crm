-- 0037_project_first_worklists.sql
-- Worklists belong to a PROJECT, not only to a company. Any project can have
-- workstreams and deliverables; the company is read from the project when it
-- has one. A project with no company still gets a worklist and a portal link,
-- just no company login.
--
--   workstreams.company_id   now optional. Existing rows keep theirs. New rows
--                            are made with a project (the routes require it).
--   workstreams.project_id   ON DELETE RESTRICT (was SET NULL). With no
--                            company, a workstream whose project is deleted
--                            could never be reached again, so a project with a
--                            worklist can't be deleted until the worklist is.
--                            deleteProject() in src/db/client.js says so.
--   requests.company_id      now optional, and requests gain project_id and
--                            submitted_via ('login' = a signed-in client,
--                            'link' = someone holding a project link; shown in
--                            triage as "Sent via project link"). A request
--                            needs a company or a project to belong to.
--   companies.type           client | prospect | subcontractor | supplier |
--                            other. Backfilled ONCE from the company's linked
--                            contacts (all subcontractors => subcontractor,
--                            otherwise client). type_reviewed stays false until
--                            a person confirms it. sector is the old
--                            brand/agency/ngo/sport/corp flavour, optional.
--   settings.show_leads      superadmin toggle, default off. Off hides the lead
--                            and makes alerts ignore leads (api/_alerts.js).
--   projects.portal_emails   extra addresses, beyond the client contact, that
--                            get the delivery email with its Approve link.
--   action_links.clerk_user_id  now optional: a link sent to a client with no
--                            login stands for the address it was sent to.
--
-- Read and written ONLY through the server for the worklist tables, never from
-- src/db/client.js. Applied idempotently on every boot by runMigrations().

ALTER TABLE workstreams ALTER COLUMN company_id DROP NOT NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'workstreams_project_id_projects_id_fk' AND confdeltype <> 'r') THEN
    ALTER TABLE workstreams DROP CONSTRAINT workstreams_project_id_projects_id_fk;
    ALTER TABLE workstreams ADD CONSTRAINT workstreams_project_id_projects_id_fk
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- A workstream needs a company or a project to belong to.
DO $$ BEGIN
  ALTER TABLE workstreams ADD CONSTRAINT workstreams_owner_chk
    CHECK (company_id IS NOT NULL OR project_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE requests ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS project_id    UUID REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS submitted_via TEXT NOT NULL DEFAULT 'login';
DO $$ BEGIN
  ALTER TABLE requests ADD CONSTRAINT requests_source_chk CHECK (submitted_via IN ('login', 'link'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE requests ADD CONSTRAINT requests_owner_chk CHECK (company_id IS NOT NULL OR project_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS requests_project_status_idx ON requests (project_id, status);

-- Backfill once: only when the column is being added.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'companies' AND column_name = 'type') THEN
    ALTER TABLE companies ADD COLUMN type TEXT NOT NULL DEFAULT 'client';
    ALTER TABLE companies ADD COLUMN sector TEXT;
    ALTER TABLE companies ADD COLUMN type_reviewed BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE companies ADD CONSTRAINT companies_type_chk
      CHECK (type IN ('client', 'prospect', 'subcontractor', 'supplier', 'other'));
    UPDATE companies c SET type = 'subcontractor'
     WHERE EXISTS (SELECT 1 FROM contacts k WHERE k.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM contacts k WHERE k.company_id = c.id AND k.type <> 'subcontractor');
  END IF;
END $$;

ALTER TABLE settings ADD COLUMN IF NOT EXISTS show_leads BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS portal_emails JSONB NOT NULL DEFAULT '[]';

ALTER TABLE action_links ALTER COLUMN clerk_user_id DROP NOT NULL;
