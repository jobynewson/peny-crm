// api/_me.js
// The signed-in person's Slate user — their app_users row — created on their
// first sign-in. The server does this, not the browser: the browser's
// database connection (/api/db) is open only to Slate users, so it can't make
// its own row, and the rule for who becomes one has to hold whatever the
// browser does.
//
// The rule:
//   - already a Slate user → their row, whatever orgs they're in (staff added
//     to a client's org to see what the client sees keep the app);
//   - a member of any Clerk organization → a client: never a row (403
//     portal_account, and the app sends them to /portal);
//   - invited → a new 'user' row. A superadmin's Team invite (api/invite.js)
//     records a staff invitation for an email address; the first sign-in by
//     an account with that address verified uses it up;
//   - the very first Slate user → 'superadmin', no invitation needed;
//   - anyone else → nothing (403 not_invited).
// An invitation works once, so removing someone from Slate keeps them out
// until they're invited again, and signing up to Clerk is never enough.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

// What the browser gets: the row without the Google OAuth tokens or the Slate
// calendar id, the same shape getAllAppUsers() gives everyone else.
export function publicUser({ google_tokens, gcal_calendar_id, ...rest }) {
  return { ...rest, google_calendar_connected: !!google_tokens?.refresh_token }
}

// Only addresses Clerk has verified: nobody can claim an invitation by adding
// an address they don't own.
export const verifiedEmails = account => (account.emailAddresses ?? [])
  .filter(e => e.verification?.status === 'verified')
  .map(e => e.emailAddress.trim().toLowerCase())

// → { user } or { error: { status, code, message } }. `clerk` is a Clerk
// backend client; it is only asked when there's no row yet.
export async function slateUserFor({ sql, clerkUserId, clerk }) {
  const [existing] = await sql`SELECT * FROM app_users WHERE clerk_id = ${clerkUserId} LIMIT 1`
  if (existing) return { user: publicUser(existing) }

  let account, memberships
  try {
    [account, memberships] = await Promise.all([
      clerk.users.getUser(clerkUserId),
      clerk.users.getOrganizationMembershipList({ userId: clerkUserId, limit: 1 }),
    ])
  } catch (err) {
    console.error('[me] Clerk lookup failed:', err)
    return { error: { status: 502, code: 'clerk_unavailable', message: 'Couldn’t check your account. Try again in a moment.' } }
  }
  if ((memberships.totalCount ?? memberships.data?.length ?? 0) > 0) {
    return { error: { status: 403, code: 'portal_account', message: 'This account is for the client portal' } }
  }

  // One statement: the row is created only with an open invitation (or for
  // the very first user), and the invitation is used up with it.
  const email = account.primaryEmailAddress?.emailAddress ?? ''
  const [created] = await sql`
    WITH invite AS (
      SELECT id, invited_by FROM staff_invitations
      WHERE used_at IS NULL AND lower(email) = ANY(${verifiedEmails(account)}::text[])
      ORDER BY created_at
      LIMIT 1
    ), created AS (
      INSERT INTO app_users (clerk_id, email, name, role, invited_by)
      SELECT ${clerkUserId}, ${email}, ${account.fullName ?? account.username ?? ''},
             CASE WHEN EXISTS (SELECT 1 FROM app_users) THEN 'user' ELSE 'superadmin' END,
             (SELECT invited_by FROM invite)
      WHERE EXISTS (SELECT 1 FROM invite) OR NOT EXISTS (SELECT 1 FROM app_users)
      ON CONFLICT (clerk_id) DO NOTHING
      RETURNING *
    ), spent AS (
      UPDATE staff_invitations SET used_at = NOW(), used_by = ${clerkUserId}
      WHERE id IN (SELECT id FROM invite) AND EXISTS (SELECT 1 FROM created)
    )
    SELECT * FROM created
  `
  if (created) return { user: publicUser(created) }

  // A second tab signing in at the same moment made it first.
  const [row] = await sql`SELECT * FROM app_users WHERE clerk_id = ${clerkUserId} LIMIT 1`
  if (row) return { user: publicUser(row) }

  return {
    error: {
      status: 403, code: 'not_invited',
      message: email
        ? `${email} hasn’t been invited to Slate. Ask a Slate admin to invite that address.`
        : 'This account hasn’t been invited to Slate. Ask a Slate admin for an invitation.',
    },
  }
}
