import { describe, it, expect } from 'vitest'
import { issueRealtimeToken, channelPrefix } from './_realtime.js'

// Minimal neon-style tagged template double.
const fakeSql = ({ owner = 'owner_1', members = [] } = {}) => (strings, ...vals) => {
  const q = strings.join('?')
  if (q.includes('FROM workspace')) return Promise.resolve(owner ? [{ owner_id: owner }] : [])
  if (q.includes('FROM app_users')) return Promise.resolve(members.includes(vals[0]) ? [{ '?column?': 1 }] : [])
  return Promise.reject(new Error('unexpected query ' + q))
}
const KEY = 'app.key:secret'

describe('issueRealtimeToken', () => {
  it('signs a token for a workspace member, scoped to this workspace only', async () => {
    const t = await issueRealtimeToken({ clerkUserId: 'user_2', sql: fakeSql({ members: ['user_2'] }), apiKey: KEY })
    expect(t.clientId).toBe('user_2')
    expect(t.keyName).toBe('app.key')
    expect(JSON.parse(t.capability)).toEqual({ 'slate:owner_1:*': ['presence', 'publish', 'subscribe'] })
    expect(t.mac).toBeTruthy()
  })
  it('lets the workspace owner in without an app_users row', async () => {
    const t = await issueRealtimeToken({ clerkUserId: 'owner_1', sql: fakeSql(), apiKey: KEY })
    expect(t.clientId).toBe('owner_1')
  })
  it('refuses non-members, anonymous callers and a missing key', async () => {
    await expect(issueRealtimeToken({ clerkUserId: 'stranger', sql: fakeSql({ members: ['user_2'] }), apiKey: KEY })).rejects.toMatchObject({ status: 403 })
    await expect(issueRealtimeToken({ clerkUserId: null, sql: fakeSql(), apiKey: KEY })).rejects.toMatchObject({ status: 401 })
    await expect(issueRealtimeToken({ clerkUserId: 'owner_1', sql: fakeSql(), apiKey: '' })).rejects.toMatchObject({ status: 503 })
  })
  it('channel prefix matches what the browser joins', () => {
    expect(channelPrefix('owner_1')).toBe('slate:owner_1:')
  })
})
