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

    const token = req.headers.authorization?.replace('Bearer ', '').trim()
    if (!token) return res.status(401).json({ error: 'Unauthorised' })

    // Decode the JWT to extract the user ID (sub claim)
    // The token is a Clerk-issued JWT — we verify admin status against our own DB
    let callerUserId
    try {
      const parts = token.split('.')
      if (parts.length !== 3) throw new Error('Bad token shape')
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      callerUserId = payload.sub
      if (!callerUserId) throw new Error('No sub claim')
      // Check token hasn't expired
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return res.status(401).json({ error: 'Session expired — please refresh and try again' })
      }
    } catch {
      return res.status(401).json({ error: 'Invalid session token' })
    }

    // Verify the caller is an admin in our DB
    const sql = neon(process.env.VITE_DATABASE_URL)
    const rows = await sql`
      SELECT role FROM app_users WHERE clerk_id = ${callerUserId} LIMIT 1
    `
    if (!rows[0] || rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    // Send the Clerk invitation
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
    await clerk.invitations.createInvitation({
      emailAddress: email,
      redirectUrl:  process.env.VITE_APP_URL || 'https://your-app.vercel.app',
      publicMetadata: { invitedBy: callerUserId },
    })

    return res.status(200).json({ ok: true, message: `Invitation sent to ${email}` })

  } catch (err) {
    console.error('Invite error:', err)
    if (err.message?.toLowerCase().includes('already')) {
      return res.status(409).json({ error: 'This email has already been invited or has an account' })
    }
    return res.status(500).json({ error: err.message || 'Failed to send invitation' })
  }
}
