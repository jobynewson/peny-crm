-- 0036_add_client_requests_and_alerts.sql
-- Stage 2: client requests, "waiting on you" replies, the alerts and the
-- one-time approve links.
--
--   companies.lead_id      who hears about a company's work when a deliverable
--                          has no owner. Nullable in the database (existing
--                          companies have none); a new company gets its
--                          creator, it can't be cleared, and the Retainers page
--                          flags a gap. RESTRICT, not SET NULL: staff are
--                          removed through the query proxy, so the database
--                          itself refuses to delete a lead.
--   requests               what triage records: who decided, when, the note a
--                          declined client is sent. task_id goes: accepting a
--                          request creates a DELIVERABLE (deliverable_id), and
--                          the task board shows that deliverable itself.
--   deliverables.client_*  the client's latest reply on a "waiting on you"
--                          item. Cleared with waiting_note when the item leaves
--                          waiting (statusPatch in api/_retainer-rules.js).
--   alert_log              once-per-item bookkeeping for the timed alerts.
--                          `cycle` re-arms an item: the due date for "due
--                          within 48 hours", waiting_since for "client input
--                          overdue".
--   action_links           one-time Approve links in the delivery email. Only
--                          the hash of the token is stored.
--
-- Read and written ONLY through the server, never from src/db/client.js.
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES app_users(id) ON DELETE RESTRICT;

ALTER TABLE requests ADD COLUMN IF NOT EXISTS submitted_by_name TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS decline_note      TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS decided_by        UUID REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS decided_at        TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS requests_inbox_idx ON requests (status, created_at);

-- Nothing wrote task_id (the table was unused until now). Guarded so a re-run,
-- or a failure, never stops the app loading.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'requests' AND column_name = 'task_id') THEN
    ALTER TABLE requests DROP COLUMN task_id;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'dropping requests.task_id failed: %', SQLERRM;
END $$;

ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS client_reply      TEXT;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS client_replied_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS alert_log (
  kind       TEXT NOT NULL,
  subject_id UUID NOT NULL,
  cycle      TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, subject_id, cycle)
);

CREATE TABLE IF NOT EXISTS action_links (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_id   UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,             -- the client the email went to
  email         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,      -- sha256 of the token, hex
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS action_links_delivery_idx ON action_links (delivery_id);
CREATE INDEX IF NOT EXISTS action_links_user_idx     ON action_links (clerk_user_id);
