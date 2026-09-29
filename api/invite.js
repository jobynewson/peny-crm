// api/invite.js
// POST /api/invite { email } — a superadmin invites someone to Slate. It
// records a staff invitation, which is what lets them in: their first sign-in
// uses it up (api/_me.js). If they have no Clerk account yet, Clerk also
// emails them an invitation to make one; if they have one, they just sign in.
// A client portal account can never become a Slate user, so it's refused here
// rather than at their sign-in.
import { createClerkClient } from '@clerk/backend'
import { neon } from '@neondatabase/serverless'
import { verifyClerkUser } from './_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const email = String(req.body?.email ?? '').trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' })
    }

    // Verify the caller is a Slate superadmin
    const sql = neon(process.env.DATABASE_URL)
    const { user, error } = await verifyClerkUser(req, sql)
    if (error) return res.status(error.status).json({ error: error.message })
    if (user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required' })
    }
    const callerUserId = user.clerk_id

    const [member] = await sql`SELECT 1 FROM app_users WHERE lower(email) = lower(${email}) LIMIT 1`
    if (member) return res.status(409).json({ error: `${email} is already a Slate user` })

    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
    const { data: [account] = [] } = await clerk.users.getUserList({ emailAddress: [email], limit: 1 })

    if (account) {
      const { totalCount } = await clerk.users.getOrganizationMembershipList({ userId: account.id, limit: 1 })
      if (totalCount > 0) {
        return res.status(409).json({ error: `${email} is a client portal account, so it can’t join Slate. Invite a different address.` })
      }
    } else {
      // No account yet: Clerk emails them an invitation to make one.
      const inviteParams = {
        emailAddress: email,
        publicMetadata: { invitedBy: callerUserId },
      }
      // Only set redirectUrl if VITE_APP_URL is configured and not the placeholder
      const appUrl = process.env.VITE_APP_URL
      if (appUrl && !appUrl.includes('your-app.vercel.app')) {
        inviteParams.redirectUrl = appUrl
      }

      try {
        await clerk.invitations.createInvitation(inviteParams)
      } catch (clerkErr) {
        console.error('Clerk invitation error:', JSON.stringify(clerkErr, null, 2))
        const msg = clerkErr.errors?.[0]?.longMessage
              || clerkErr.errors?.[0]?.message
              || clerkErr.message
              || 'Clerk error'
        // A Clerk invitation still waiting to be accepted: it goes on working,
        // and the staff invitation below is refreshed.
        if (!msg.toLowerCase().includes('already')) return res.status(500).json({ error: msg })
      }
    }

    // What lets them in: their first sign-in uses it up (_me.js).
    await sql`
      INSERT INTO staff_invitations (email, invited_by) VALUES (${email.toLowerCase()}, ${callerUserId})
      ON CONFLICT (lower(email)) WHERE used_at IS NULL
      DO UPDATE SET invited_by = EXCLUDED.invited_by, created_at = NOW()
    `

    return res.status(200).json({
      ok: true,
      message: account ? `${email} already has an account: they can sign in to Slate now` : `Invitation sent to ${email}`,
    })

  } catch (err) {
    console.error('Invite error:', err)
    return res.status(500).json({ error: err.message || 'Failed to send invitation' })
  }
}
