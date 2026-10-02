-- 0045_budget_lines_pre_discount.sql
-- Whether the client quote (PDF and /quote link) prices discounted line items
-- before or after their discount. Off (post-discount) by default. Also applied
-- by runMigrations() in src/db/client.js.

ALTER TABLE budgets ADD COLUMN IF NOT EXISTS lines_pre_discount BOOLEAN NOT NULL DEFAULT false;
