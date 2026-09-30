-- 0039_action_link_name.sql
-- A one-time Approve link can now go to someone with no login (the project's
-- client contact, or an address added on the project). action_links.clerk_user_id
-- was already made optional (0037); this adds the name to put on the approval
-- ("Approved by Dana Client") when there is no Clerk account to ask. Null falls
-- back to the address. Also applied by runMigrations() in src/db/client.js.

ALTER TABLE action_links ADD COLUMN IF NOT EXISTS name TEXT;
