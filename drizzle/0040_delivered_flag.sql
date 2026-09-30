-- 0040_delivered_flag.sql
-- "Delivered" (the staff tick) and "approved" (the client's answer) are two
-- separate things. delivered_at is the staff tick: set, the client sees the
-- deliverable as Delivered with Approve and Request changes; cleared, it is
-- not delivered. Status keeps its meaning. The client's answer to a delivered
-- deliverable that has no round is stored here too: approved_at/approved_by_name
-- (and status becomes approved), or changes_note/changes_at (status becomes
-- changes_requested and the tick is cleared, so it is ticked again once fixed).
-- A round's own approve/changes still lives on deliveries. Also applied by
-- runMigrations() in src/db/client.js.

ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS delivered_at      TIMESTAMPTZ;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMPTZ;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS approved_by_name  TEXT;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS changes_note      TEXT;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS changes_at        TIMESTAMPTZ;
