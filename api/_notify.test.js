import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const sendMail = vi.fn(async ({ to }) => ({ messageId: `id-${to}` }))
const createTransport = vi.fn(() => ({ sendMail }))
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }))

const { KINDS, switchableKinds, wantsEmail, notify } = await import('./_notify.js')

const API = path.dirname(new URL(import.meta.url).pathname)

// Stored settings, as notification_settings rows keyed by Clerk id.
let rows = []
const sql = async (strings) => (strings.join('').includes('notification_settings') ? rows : [])

const ana = { email: 'ana@peny.com', clerk_id: 'user_ana', name: 'Ana' }
const ben = { email: 'ben@peny.com', clerk_id: 'user_ben', name: 'Ben' }

beforeEach(() => {
  rows = []
  sendMail.mockClear()
  process.env.GMAIL_USER = 'slate@peny.com'
  process.env.GMAIL_APP_PASSWORD = 'secret'
})

describe('one sender', () => {
  it('nothing but _notify.js imports nodemailer', () => {
    const offenders = fs.readdirSync(API)
      .filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && f !== '_notify.js')
      .filter(f => /from ['"]nodemailer['"]|require\(['"]nodemailer['"]\)/.test(fs.readFileSync(path.join(API, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('kinds', () => {
  it('every switchable kind explains itself and has a default', () => {
    for (const kind of switchableKinds({ superadmin: true })) {
      expect(KINDS[kind].description).toBeTruthy()
      expect(typeof KINDS[kind].default).toBe('boolean')
    }
  })
  it('offers the roundup to superadmins only', () => {
    expect(switchableKinds({ superadmin: true })).toContain('reminder_roundup')
    expect(switchableKinds({ superadmin: false })).not.toContain('reminder_roundup')
  })
  it('keeps workflow emails out of anyone\'s hands', () => {
    for (const kind of ['leave', 'expense_digest', 'expense_submitted', 'task_nudge']) {
      expect(switchableKinds({ superadmin: true })).not.toContain(kind)
      expect(wantsEmail(kind, false)).toBe(true)
    }
  })
  it('uses the default until someone changes it', () => {
    expect(wantsEmail('due_digest', undefined)).toBe(true)
    expect(wantsEmail('due_digest', false)).toBe(false)
    expect(wantsEmail('reminder_roundup', undefined)).toBe(false)
    expect(wantsEmail('reminder_roundup', true)).toBe(true)
    expect(() => wantsEmail('nope')).toThrow()
  })
})

describe('notify', () => {
  it('sends to everyone who wants it and skips who switched it off', async () => {
    rows = [{ clerk_user_id: 'user_ben', email: false }]
    const out = await notify(sql, { kind: 'due_digest', to: [ana, ben], subject: 'Due', html: '<p>x</p>' })
    expect(out).toEqual([
      { to: 'ana@peny.com', sent: true, messageId: 'id-ana@peny.com' },
      { to: 'ben@peny.com', skipped: 'setting' },
    ])
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: 'slate@peny.com', to: 'ana@peny.com', subject: 'Due' })
  })
  it('sends an opt-in kind only to those who opted in', async () => {
    rows = [{ clerk_user_id: 'user_ana', email: true }]
    const out = await notify(sql, { kind: 'reminder_roundup', to: [ana, ben], subject: 'Roundup', html: '' })
    expect(out.map(o => o.sent ? 'sent' : o.skipped)).toEqual(['sent', 'setting'])
  })
  it('always sends workflow emails', async () => {
    rows = [{ clerk_user_id: 'user_ana', email: false }]
    const out = await notify(sql, { kind: 'leave', to: ana, subject: 'Leave', html: '' })
    expect(out[0].sent).toBe(true)
  })
  it('reports a failed send and carries on', async () => {
    sendMail.mockImplementationOnce(async () => { throw new Error('Gmail said no') })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await notify(sql, { kind: 'leave', to: [ana, ben], subject: 'Leave', html: '' })
    expect(out[0]).toEqual({ to: 'ana@peny.com', error: 'Gmail said no' })
    expect(out[1].sent).toBe(true)
    spy.mockRestore()
  })
  it('does nothing when mail is not set up', async () => {
    delete process.env.GMAIL_APP_PASSWORD
    const out = await notify(sql, { kind: 'due_digest', to: [ana, { name: 'no email' }], subject: 'x', html: '' })
    expect(out).toEqual([{ to: 'ana@peny.com', skipped: 'not_configured' }, { to: null, skipped: 'no_email' }])
    expect(sendMail).not.toHaveBeenCalled()
  })
  it('refuses a kind it does not know', async () => {
    await expect(notify(sql, { kind: 'spam', to: ana, subject: 'x', html: '' })).rejects.toThrow()
  })
})
