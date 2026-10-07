import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const sendMail = vi.fn(async ({ to }) => ({ messageId: `id-${to}` }))
const createTransport = vi.fn(() => ({ sendMail }))
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }))

const { KINDS, switchableKinds, wantsEmail, notify, TESTABLE_KINDS, testBanner, testSubject } = await import('./_notify.js')

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

describe('testing mode', () => {
  // The settings row, as the testing query would read it.
  let testRow = null
  const testSql = async strings => {
    const text = strings.join('')
    if (text.includes('test_mode')) return testRow ? [testRow] : []
    return text.includes('notification_settings') ? rows : []
  }
  beforeEach(() => { testRow = null })
  const sent = () => sendMail.mock.calls.map(([m]) => ({ to: m.to, subject: m.subject, html: m.html }))

  it('redirects only the emails about the worklist and portal work', () => {
    expect(TESTABLE_KINDS.sort()).toEqual([
      'alert_changes_requested', 'alert_client_reply', 'alert_comments_in', 'alert_due_soon', 'alert_input_overdue',
      'alert_new_request', 'alert_unassigned', 'delivery_ready', 'due_digest', 'task_assigned',
    ])
    for (const kind of ['leave', 'expense_digest', 'expense_submitted', 'note_reminder', 'task_mentioned']) expect(TESTABLE_KINDS).not.toContain(kind)
  })

  it('sends nothing different while it is off', async () => {
    const out = await notify(testSql, { kind: 'delivery_ready', to: ana, subject: 'Ready', html: '<p>x</p>' })
    expect(sent()).toEqual([{ to: 'ana@peny.com', subject: 'Ready', html: '<p>x</p>' }])
    expect(out[0].redirected_to).toBeUndefined()
  })

  it('sends one copy per intended person to the testers, saying who it was for', async () => {
    testRow = { test_mode: true, test_emails: ['joby@peny.com'] }
    const out = await notify(testSql, { kind: 'delivery_ready', to: [ana, ben], subject: 'Ready for your review', html: '<html><body><p>Hi</p></body></html>' })
    expect(sent().map(m => [m.to, m.subject])).toEqual([
      ['joby@peny.com', '[TEST → ana@peny.com] Ready for your review'],
      ['joby@peny.com', '[TEST → ben@peny.com] Ready for your review'],
    ])
    expect(sent()[0].html).toContain('<body><div')
    expect(sent()[0].html).toContain('would have gone to <strong>ana@peny.com</strong>')
    expect(sent()[0].html).toContain('<p>Hi</p>')
    expect(out).toEqual([
      { to: 'ana@peny.com', sent: true, messageId: 'id-joby@peny.com', redirected_to: ['joby@peny.com'] },
      { to: 'ben@peny.com', sent: true, messageId: 'id-joby@peny.com', redirected_to: ['joby@peny.com'] },
    ])
  })

  it('can send to several testers', async () => {
    testRow = { test_mode: true, test_emails: ['joby@peny.com', 'sam@peny.com', 'joby@peny.com', 'not an address'] }
    await notify(testSql, { kind: 'alert_new_request', to: ana, subject: 'New', html: '<p>x</p>' })
    expect(sent().map(m => m.to)).toEqual(['joby@peny.com', 'sam@peny.com'])
  })

  it('holds the email back, rather than sending it to the real person, when nobody is chosen', async () => {
    testRow = { test_mode: true, test_emails: [] }
    const out = await notify(testSql, { kind: 'delivery_ready', to: [ana], subject: 'Ready', html: '' })
    expect(sendMail).not.toHaveBeenCalled()
    expect(out).toEqual([{ to: 'ana@peny.com', skipped: 'test_mode_no_recipients' }])
  })

  it('still respects a person who has switched that email off', async () => {
    testRow = { test_mode: true, test_emails: ['joby@peny.com'] }
    rows = [{ clerk_user_id: 'user_ben', email: false }]
    const out = await notify(testSql, { kind: 'task_assigned', to: [ana, ben], subject: 'Task', html: '' })
    expect(sent().map(m => m.subject)).toEqual(['[TEST → ana@peny.com] Task'])
    expect(out[1]).toEqual({ to: 'ben@peny.com', skipped: 'setting' })
  })

  it('leaves every other kind of email alone', async () => {
    testRow = { test_mode: true, test_emails: ['joby@peny.com'] }
    await notify(testSql, { kind: 'leave', to: ana, subject: 'Leave', html: '' })
    await notify(testSql, { kind: 'expense_digest', to: ben, subject: 'Expenses', html: '' })
    expect(sent().map(m => m.to)).toEqual(['ana@peny.com', 'ben@peny.com'])
  })

  it('reads as off if the database cannot say (not migrated yet)', async () => {
    const broken = async strings => { if (strings.join('').includes('test_mode')) throw new Error('no such column'); return [] }
    await notify(broken, { kind: 'delivery_ready', to: ana, subject: 'Ready', html: '' })
    expect(sent().map(m => m.to)).toEqual(['ana@peny.com'])
  })

  it('puts the banner at the top when there is no body tag, and escapes the address', () => {
    expect(testBanner('<p>x</p>', 'a@b.test').startsWith('<div')).toBe(true)
    expect(testBanner('<p>x</p>', '<i>@b.test')).toContain('&lt;i>@b.test')
    expect(testSubject('S', 'a@b.test')).toBe('[TEST → a@b.test] S')
  })
})
