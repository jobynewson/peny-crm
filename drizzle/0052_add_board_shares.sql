-- 0052_add_board_shares.sql
-- Which client companies can see a Planning canvas or kanban board in the
-- client portal (view only). Staff set it from the board's Share button
-- (/api/board-shares, api/_board-shares.js); the portal reads it through
-- api/_client-boards.js, which always starts from the signed-in company.
-- One row per (board or canvas, company). Deleting the board, canvas or
-- company removes the row. Only root canvases are shared directly; canvases
-- nested inside a shared one come with it.
--
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

CREATE TABLE IF NOT EXISTS board_shares (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     TEXT NOT NULL,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  board_id    UUID REFERENCES boards(id) ON DELETE CASCADE,
  canvas_id   UUID REFERENCES canvases(id) ON DELETE CASCADE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((board_id IS NOT NULL) <> (canvas_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS board_shares_board_uidx  ON board_shares (board_id, company_id)  WHERE board_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS board_shares_canvas_uidx ON board_shares (canvas_id, company_id) WHERE canvas_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS board_shares_company_idx ON board_shares (company_id);
