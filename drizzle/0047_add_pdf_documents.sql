-- 0047_add_pdf_documents.sql
-- Tools › PDF Generator: the team's shared library of saved one-page documents.
-- Scoped by the workspace owner's Clerk id like the rest of the shared data;
-- created_by / updated_by are the Clerk ids of whoever saved. Read and written
-- only through /api/pdf-documents.
--
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

CREATE TABLE IF NOT EXISTS pdf_documents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  theme       TEXT NOT NULL DEFAULT 'dark',
  content     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pdf_documents_user_idx
  ON pdf_documents (user_id, updated_at DESC);
