-- 0044_budget_discount_note.sql
-- A free-text explainer for a budget's discount, printed under the discount row
-- in the PDF and on the client quote link. Also applied by runMigrations() in
-- src/db/client.js.

ALTER TABLE budgets ADD COLUMN IF NOT EXISTS discount_note TEXT;
