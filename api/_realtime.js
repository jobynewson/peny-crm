// api/_realtime.js
// Token issuing for live collaboration (Ably). The browser never sees
// ABLY_API_KEY: it asks /api/realtime for a short-lived token request, which
// is only granted to a signed-in member of the workspace and only for this
// workspace's channels ('slate:<workspace owner id>:*').
import Ably from 'ably'

export const channelPrefix = workspaceId => `slate:${workspaceId}:`

export class RealtimeError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

// `sql` is a neon() tagged-template client (or a test double with the same shape).
export async function issueRealtimeToken({ clerkUserId, sql, apiKey }) {
  if (!apiKey) throw new RealtimeError('Realtime is not configured', 503)
  if (!clerkUserId) throw new RealtimeError('Unauthorised', 401)
  const [ws] = await sql`SELECT owner_id FROM workspace LIMIT 1`
  if (!ws) throw new RealtimeError('No workspace', 404)
  if (ws.owner_id !== clerkUserId) {
    const member = await sql`SELECT 1 FROM app_users WHERE clerk_id = ${clerkUserId} LIMIT 1`
    if (!member.length) throw new RealtimeError('Not a member of this workspace', 403)
  }
  const rest = new Ably.Rest({ key: apiKey })
  return rest.auth.createTokenRequest({
    clientId: clerkUserId,
    ttl: 60 * 60 * 1000,
    capability: JSON.stringify({ [`${channelPrefix(ws.owner_id)}*`]: ['publish', 'subscribe', 'presence'] }),
  })
}
