// A client portal account is a real Clerk session with no app_users row. Every
// endpoint that works for Slate staff must refuse it — and a bare Clerk session
// must never be enough anywhere, which is only structurally true while
// _auth.js is the one place that verifies a token.

import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fakeRes } from './_test-db.js'

const API = path.dirname(new URL(import.meta.url).pathname)

// The caller is signed in to Clerk (a client) but is not a Slate user.
const CLIENT_CLAIMS = { sub: 'user_client', v: 2, o: { id: 'org_client', rol: 'member' } }
vi.mock('./_auth.js', () => ({
  verifyClerkSession: async () => ({ claims: CLIENT_CLAIMS }),
  verifyClerkUser: async () => ({ error: { status: 403, code: 'not_provisioned', message: 'This account is not a Slate user' } }),
}))
// No handler may reach the database before refusing — except realtime, whose
// membership check is itself a query: the workspace row, then no app_users row.
vi.mock('@neondatabase/serverless', () => ({
  neon: () => (strings) => Promise.resolve(strings.join('').includes('FROM workspace') ? [{ owner_id: 'user_owner' }] : []),
}))

beforeAll(() => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test'
  process.env.ABLY_API_KEY = 'app.key:secret'
  process.env.ANTHROPIC_API_KEY = 'test'
})

const call = async (file, req) => {
  const { default: handler } = await import(/* @vite-ignore */ `./${file}`)
  const res = fakeRes()
  await handler({ headers: { authorization: 'Bearer client-session' }, query: {}, body: {}, url: '/', ...req }, res)
  return res
}

describe('only _auth.js verifies Clerk tokens', () => {
  it('no other api file calls verifyToken', () => {
    const offenders = fs.readdirSync(API)
      .filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && f !== '_auth.js')
      .filter(f => /\bverifyToken\b/.test(fs.readFileSync(path.join(API, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('staff endpoints refuse a client portal account', () => {
  const cases = [
    ['ai.js',          { method: 'POST', body: { text: 'hello' } }],
    ['blob.js',        { method: 'POST', body: { base64: 'eA==', filename: 'a.png', contentType: 'image/png' } }],
    ['blob.js',        { method: 'DELETE', query: { url: 'https://x.blob.vercel-storage.com/a' } }],
    ['blob.js',        { method: 'GET', query: { action: 'preview', url: 'https://example.com' } }],
    ['blob.js',        { method: 'GET', query: { action: 'youtube', id: 'abc' } }],
    ['generate-ra.js', { method: 'POST', body: { shoot_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' } }],
    ['reminders.js',   { method: 'POST', query: { type: 'leave-notify' }, body: { action: 'request', requestId: 'x' } }],
    ['reminders.js',   { method: 'POST', query: { type: 'expense-submit' }, body: { monthKey: '2026-09' } }],
    ['google.js',      { method: 'POST', body: { action: 'entry-sync', entryId: 'x' } }],
    ['invite.js',      { method: 'POST', body: { email: 'someone@example.com' } }],
    ['companies.js',   { method: 'GET', url: '/api/companies' }],
    ['due.js',         { method: 'GET', url: '/api/due' }],
    ['notification-settings.js', { method: 'GET', url: '/api/notification-settings' }],
    ['retainers.js',   { method: 'GET', query: { route: 'retainers/companies' } }],
    ['retainers.js',   { method: 'POST', query: { route: 'retainers/deliveries/3f2504e0-4f89-11d3-9a0c-0305e82c3301/response' }, body: { response: 'approved' } }],
    ['portal.js',      { method: 'GET', query: { view: 'tasks', route: 'tasks' } }],
    ['realtime.js',    { method: 'GET' }],
  ]
  for (const [file, req] of cases) {
    it(`${file} ${req.method} ${req.query?.type || req.query?.action || req.body?.action || ''}`.trim(), async () => {
      const res = await call(file, req)
      expect(res.statusCode).toBe(403)
    })
  }
})
