// api/invite.js
// Vercel serverless function — runs server-side, safe to use secret key
//
// POST /api/invite
// Body: { email: string }
// Headers: Authorization: Bearer <clerk_session_token>
//
// Verifies the caller is an admin, then sends a Clerk invitation email.

import { createClerkClient } from '@clerk/backend'
import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email } = req.body
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' })
    }

    // Verify the caller is authenticated and is an admin
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      return res.status(401).json({ error: 'Unauthorised' })
    }

    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

    // Verify the session token and get the user
    let callerUserId
    try {
      const payload = await clerk.verifyToken(token)
      callerUserId = payload.sub
    } catch {
      return res.status(401).json({ error: 'Invalid session token' })
    }

    // Check the caller is an admin in our app_users table
    const sql = neon(process.env.VITE_DATABASE_URL)
    const rows = await sql`
      SELECT role FROM app_users WHERE clerk_id = ${callerUserId} LIMIT 1
    `
    if (!rows[0] || rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    // Send the Clerk invitation
    await clerk.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: process.env.VITE_APP_URL || 'https://your-app.vercel.app',
      publicMetadata: { invitedBy: callerUserId },
    })

    return res.status(200).json({ ok: true, message: `Invitation sent to ${email}` })

  } catch (err) {
    console.error('Invite error:', err)
    // Clerk throws if email already invited or already a user
    if (err.message?.includes('already')) {
      return res.status(409).json({ error: 'This email has already been invited or has an account' })
    }
    return res.status(500).json({ error: 'Failed to send invitation' })
  }
}
