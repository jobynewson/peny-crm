-- 0054_add_client_board_control.sql
-- Staff control of the client portal's deliverables board.
--   - deliveries.hidden_at / hidden_by: a round staff have taken off the
--     client's board. It stays for staff (link, note, the client's answer) and
--     can be shown again; nothing client-facing reads a round while hidden_at
--     is set (api/_client-view.js, api/_worklist.js).
--   - client_board_log: who did what to the client's board and when. Staff
--     only; never read by the portal. Written by api/_client-board-control.js.
--
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS hidden_by UUID REFERENCES app_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS client_board_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deliverable_id UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  delivery_id    UUID,
  actor_id       UUID REFERENCES app_users(id) ON DELETE SET NULL,
  actor_name     TEXT,
  action         TEXT NOT NULL,
  detail         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS client_board_log_deliverable_idx ON client_board_log (deliverable_id, created_at DESC);
