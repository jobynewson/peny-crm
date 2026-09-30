-- 0042_approved_comment.sql
-- Approve can carry a comment, as Request changes always has. A round's comment
-- already lives on deliveries.client_comment; this is the same for a delivered
-- deliverable approved with no round. Also applied by runMigrations() in
-- src/db/client.js.

ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS approved_comment TEXT;
