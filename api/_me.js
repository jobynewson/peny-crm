// api/_me.js
// The signed-in person's Slate user — their app_users row — created on their
// first sign-in. The server does this, not the browser: the browser's
// database connection (/api/db) is open only to Slate users, so it can't make
// its own row, and the rule for who becomes one has to hold whatever the
// browser does.
//
// The rule is the one the browser used to apply (getOrCreateAppUser):
//   - already a Slate user → their row, whatever orgs they're in (staff added
//     to a client's org to see what the client sees keep the app);
//   - a member of any Clerk organization → a client: never a row (403
//     portal_account, and the app sends them to /portal);
//   - anyone else who is signed in → a new row: 'superadmin' if they're the
//     first Slate user, otherwise 'user'.
// So who can become a Slate user comes down to who can sign in to Clerk.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

// What the browser gets: the row without the Google OAuth tokens or the Slate
// calendar id, the same shape getAllAppUsers() gives everyone else.
export function publicUser({ google_tokens, gcal_calendar_id, ...rest }) {
  return { ...rest, google_calendar_connected: !!google_tokens?.refresh_token }
}

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

  const [created] = await sql`
    INSERT INTO app_users (clerk_id, email, name, role)
    VALUES (
      ${clerkUserId},
      ${account.primaryEmailAddress?.emailAddress ?? ''},
      ${account.fullName ?? account.username ?? ''},
      CASE WHEN EXISTS (SELECT 1 FROM app_users) THEN 'user' ELSE 'superadmin' END
    )
    ON CONFLICT (clerk_id) DO NOTHING
    RETURNING *
  `
  if (created) return { user: publicUser(created) }
  // A second tab signing in at the same moment made it first.
  const [row] = await sql`SELECT * FROM app_users WHERE clerk_id = ${clerkUserId} LIMIT 1`
  return { user: publicUser(row) }
}
