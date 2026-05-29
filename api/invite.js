// api/invite.js
import { createClerkClient } from '@clerk/backend'
import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email } = req.body
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' })
    }

    const raw = req.headers.authorization?.replace('Bearer ', '').trim()
    if (!raw) return res.status(401).json({ error: 'Unauthorised' })

    let callerUserId
    try {
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
      const payload = await clerk.verifyToken(raw)
      callerUserId = payload.sub
    } catch {
      return res.status(401).json({ error: 'Invalid session token' })
    }

    // Verify the caller is a superadmin in our DB
    const sql = neon(process.env.VITE_DATABASE_URL)
    const rows = await sql`
      SELECT role FROM app_users WHERE clerk_id = ${callerUserId} LIMIT 1
    `
    if (!rows[0] || rows[0].role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    // Send the Clerk invitation
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

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
      if (msg.toLowerCase().includes('already')) {
        return res.status(409).json({ error: 'This email has already been invited or has an account' })
      }
      return res.status(500).json({ error: msg })
    }

    return res.status(200).json({ ok: true, message: `Invitation sent to ${email}` })

  } catch (err) {
    console.error('Invite error:', err)
    return res.status(500).json({ error: err.message || 'Failed to send invitation' })
  }
}
