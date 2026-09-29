-- 0035_add_staff_invitations.sql
-- Who may become a Slate user. A superadmin's Team invite (POST /api/invite)
-- records one here; the invitee's first sign-in (POST /api/me, api/_me.js)
-- uses it up. Without an open invitation for one of their verified email
-- addresses, a signed-in account gets no app_users row — the very first user
-- apart. Because it is used up, removing someone from Slate keeps them out
-- until they're invited again.
--
-- Read and written ONLY through the server, never from src/db/client.js.
-- Applied idempotently on every boot by runMigrations() in src/db/client.js.

CREATE TABLE IF NOT EXISTS staff_invitations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT NOT NULL,
  invited_by TEXT NOT NULL,              -- the superadmin's Clerk ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at    TIMESTAMPTZ,                -- set when it lets someone in
  used_by    TEXT                        -- that account's Clerk ID
);

-- One open invitation per address, ignoring case.
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitations_open_uidx
  ON staff_invitations (lower(email)) WHERE used_at IS NULL;
