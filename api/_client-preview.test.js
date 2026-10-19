// "View portal as client": a Slate user's preview of a company's portal.
// Stubbed Clerk and database, so it runs without a test database.
import { describe, it, expect, vi, beforeEach } from 'vitest'

let USER = null
vi.mock('./_auth.js', () => ({
  verifyClerkSession: async () => ({ error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
  verifyClerkUser: async () => (USER ? { user: USER } : { error: { status: 403, code: 'not_provisioned', message: 'This account is not a Slate user' } }),
}))
vi.mock('./_api.js', async orig => ({ ...(await orig()), workspaceId: async () => 'ws_1' }))

const { resolveScope } = await import('./_client.js')
const COMPANY = '11111111-1111-4111-8111-111111111111'
const sqlWith = rows => async () => rows
const asking = id => ({ headers: { 'x-preview-company': id, authorization: 'Bearer x' } })

describe('resolveScope with X-Preview-Company', () => {
  beforeEach(() => { USER = { id: 'u1', clerk_id: 'user_staff' } })

  it('gives a staff member a read-only view of the company', async () => {
    const { scope, error } = await resolveScope(asking(COMPANY), sqlWith([{ id: COMPANY }]))
    expect(error).toBeUndefined()
    expect(scope).toMatchObject({ kind: 'company', companyId: COMPANY, canRespond: false, preview: true })
  })

  it('refuses someone who is not a Slate user (a client cannot choose their company)', async () => {
    USER = null
    const { scope, error } = await resolveScope(asking(COMPANY), sqlWith([{ id: COMPANY }]))
    expect(scope).toBeUndefined()
    expect(error.status).toBe(403)
  })

  it('reads a company outside the workspace, or a malformed id, as not found', async () => {
    expect((await resolveScope(asking(COMPANY), sqlWith([]))).error.status).toBe(404)
    expect((await resolveScope(asking('not-a-uuid'), sqlWith([{ id: COMPANY }]))).error.status).toBe(404)
  })
})
