import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendNotification = vi.fn(async () => ({ statusCode: 201 }))
const setVapidDetails = vi.fn()
vi.mock('web-push', () => ({ default: { sendNotification, setVapidDetails }, sendNotification, setVapidDetails }))
const sendMail = vi.fn(async ({ to }) => ({ messageId: `id-${to}` }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))

const { sendPush, payloadFor, safeUrl, pushConfigured, MAX_FAILURES } = await import('./_push.js')
const { notify, wantsPush, KINDS } = await import('./_notify.js')
const { pushFor } = await import('./_alerts.js')
const { ROUTES, endpointHash } = await import('./_push-routes.js')

// A fake database: the subscriptions on file, the stored settings, every write.
let subs, settings, writes, testMode
const sql = async (strings, ...values) => {
  const text = strings.join('?')
  if (text.includes('FROM push_subscriptions WHERE clerk_user_id')) return subs.filter(s => s.clerk_user_id === values[0])
  if (text.includes('FROM notification_settings')) return settings
  if (text.includes('FROM settings WHERE test_mode')) return testMode ? [{ test_mode: true, test_emails: [] }] : []
  writes.push({ text: text.replace(/\s+/g, ' ').trim(), values })
  return []
}
// neon's query promise has .catch; so does an async function's result.

const ana = { email: 'ana@peny.com', clerk_id: 'user_ana', name: 'Ana' }
const sub = (id, extra = {}) => ({ id, clerk_user_id: 'user_ana', endpoint: `https://push.example/${id}`, p256dh: 'k'.repeat(10), auth: 'a'.repeat(10), ...extra })

beforeEach(() => {
  subs = [sub('d1')]
  settings = []
  writes = []
  testMode = false
  sendNotification.mockReset()
  sendNotification.mockResolvedValue({ statusCode: 201 })
  sendMail.mockClear()
  process.env.VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  process.env.GMAIL_USER = 'slate@peny.com'
  process.env.GMAIL_APP_PASSWORD = 'secret'
})

describe('what is sent', () => {
  it('clips long text and never sets a tag', () => {
    const p = JSON.parse(payloadFor({ title: 'T'.repeat(200), body: 'b'.repeat(500), url: '/#tasks/1' }))
    expect(p.title.length).toBeLessThanOrEqual(80)
    expect(p.body.length).toBeLessThanOrEqual(160)
    expect(p.tag).toBeUndefined()
    expect(p.url).toBe('/#tasks/1')
  })
  it('only ever opens a page on this app', () => {
    expect(safeUrl('/#tasks')).toBe('/#tasks')
    expect(safeUrl('https://evil.example')).toBe('/')
    expect(safeUrl('//evil.example')).toBe('/')
    expect(safeUrl(undefined)).toBe('/')
  })
  it('turns an alert email into a push with its link as a path', () => {
    const p = pushFor({ subject: 'New request: A &amp; B', sentence: 'Sam at <b>Acme</b> sent a request.', href: 'https://slate.example.com/#tasks' })
    expect(p).toEqual({ title: 'New request: A &amp; B', body: 'Sam at Acme sent a request.', url: '/#tasks' })
  })
})

describe('sendPush', () => {
  it('does nothing, quietly, without keys', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    expect(pushConfigured()).toBe(false)
    expect(await sendPush(sql, { clerkId: 'user_ana', title: 't', body: 'b', url: '/' })).toEqual({ skipped: 'not_configured' })
    expect(sendNotification).not.toHaveBeenCalled()
  })
  it('says when a person has no devices', async () => {
    subs = []
    expect(await sendPush(sql, { clerkId: 'user_ana', title: 't', body: 'b', url: '/' })).toEqual({ skipped: 'no_devices' })
  })
  it('sends to every device and records the success', async () => {
    subs = [sub('d1'), sub('d2')]
    const out = await sendPush(sql, { clerkId: 'user_ana', kind: 'task_assigned', title: 'New task', body: 'Edit reel', url: '/#tasks/9' })
    expect(out).toMatchObject({ sent: 2, failed: 0, removed: 0 })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    const [subscription, payload, options] = sendNotification.mock.calls[0]
    expect(subscription.endpoint).toBe('https://push.example/d1')
    expect(JSON.parse(payload)).toMatchObject({ title: 'New task', url: '/#tasks/9' })
    expect(options.urgency).toBe('high')
    expect(writes.filter(w => w.text.includes('last_ok_at = NOW()'))).toHaveLength(2)
  })
  it('removes a device the browser says is gone', async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
    const out = await sendPush(sql, { clerkId: 'user_ana', title: 't', body: 'b', url: '/' })
    expect(out).toMatchObject({ sent: 0, removed: 1 })
    expect(writes.some(w => w.text.startsWith('DELETE FROM push_subscriptions WHERE id'))).toBe(true)
  })
  it('keeps a device that failed for another reason, with why', async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500, body: 'upstream down' }))
    const out = await sendPush(sql, { clerkId: 'user_ana', title: 't', body: 'b', url: '/' })
    expect(out.failed).toBe(1)
    expect(out.devices[0]).toMatchObject({ ok: false, status: 500, error: 'upstream down' })
    const update = writes.find(w => w.text.includes('failures = failures + 1'))
    expect(update.values).toContain('upstream down')
    expect(MAX_FAILURES).toBeGreaterThan(1)
  })
  it('one dead device does not stop the others', async () => {
    subs = [sub('d1'), sub('d2')]
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('x'), { statusCode: 500 }))
    const out = await sendPush(sql, { clerkId: 'user_ana', title: 't', body: 'b', url: '/' })
    expect(out).toMatchObject({ sent: 1, failed: 1 })
  })
})

describe('notify with push', () => {
  const alert = { title: 'New task for you', body: 'Edit reel', url: '/#tasks/9' }

  it('sends the email and the push, independently', async () => {
    const [out] = await notify(sql, { kind: 'task_assigned', to: ana, subject: 's', html: 'h', push: alert })
    expect(out.sent).toBe(true)
    expect(out.push).toMatchObject({ sent: 1 })
  })
  it('pushes even when email is switched off, and emails even when push is', async () => {
    settings = [{ clerk_user_id: 'user_ana', email: false, push: undefined }]
    let [out] = await notify(sql, { kind: 'task_assigned', to: ana, subject: 's', html: 'h', push: alert })
    expect(out.skipped).toBe('setting')
    expect(out.push).toMatchObject({ sent: 1 })

    settings = [{ clerk_user_id: 'user_ana', email: null, push: false }]
    ;[out] = await notify(sql, { kind: 'task_assigned', to: ana, subject: 's', html: 'h', push: alert })
    expect(out.sent).toBe(true)
    expect(out.push).toEqual({ skipped: 'setting' })
  })
  it('pushes when mail is not set up (a preview deployment)', async () => {
    delete process.env.GMAIL_APP_PASSWORD
    const [out] = await notify(sql, { kind: 'task_assigned', to: ana, subject: 's', html: 'h', push: alert })
    expect(out.skipped).toBe('not_configured')
    expect(out.push).toMatchObject({ sent: 1 })
  })
  it('a push failure never turns into an email failure', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('x'), { statusCode: 500 }))
    const [out] = await notify(sql, { kind: 'task_assigned', to: ana, subject: 's', html: 'h', push: alert })
    expect(out.sent).toBe(true)
    expect(out.push.failed).toBe(1)
  })
  it('does not push in testing mode, where the real person must hear nothing', async () => {
    testMode = true
    const [out] = await notify(sql, { kind: 'task_assigned', to: ana, subject: 's', html: 'h', push: alert })
    expect(out.push).toEqual({ skipped: 'test_mode' })
    expect(sendNotification).not.toHaveBeenCalled()
  })
  it('has no push for someone without an account id', async () => {
    const [out] = await notify(sql, { kind: 'task_assigned', to: { email: 'x@y.com' }, subject: 's', html: 'h', push: alert })
    expect(out.push).toEqual({ skipped: 'no_account' })
  })
  it('ignores push for kinds that are email only, and adds nothing when none is asked for', async () => {
    const [a] = await notify(sql, { kind: 'leave', to: ana, subject: 's', html: 'h', push: alert })
    expect(a.push).toBeUndefined()
    const [b] = await notify(sql, { kind: 'task_assigned', to: ana, subject: 's', html: 'h' })
    expect(b.push).toBeUndefined()
    expect(sendNotification).not.toHaveBeenCalled()
  })
})

describe('which kinds push', () => {
  it('is exactly the task and attention alerts', () => {
    const kinds = Object.entries(KINDS).filter(([, k]) => k.push).map(([k]) => k).sort()
    expect(kinds).toEqual([
      'alert_changes_requested', 'alert_client_reply', 'alert_comments_in', 'alert_due_soon', 'alert_input_overdue',
      'alert_new_request', 'alert_unassigned', 'task_assigned', 'task_mentioned',
    ])
  })
  it('defaults on, and never for a kind that is not a push kind', () => {
    expect(wantsPush('task_assigned', undefined)).toBe(true)
    expect(wantsPush('task_assigned', false)).toBe(false)
    expect(wantsPush('note_reminder', true)).toBe(false)
  })
})

describe('/api/push routes', () => {
  const res = () => { const r = { statusCode: 0, body: null, status(c) { r.statusCode = c; return r }, json(b) { r.body = b; return r } }; return r }
  const route = (method, p) => ROUTES.find(r => r.method === method && r.pattern.test(p))
  const user = { clerk_id: 'user_ana' }

  it('refuses a subscription that is not an https address or has no keys', async () => {
    for (const body of [
      { endpoint: 'http://push.example/x', keys: { p256dh: 'abcdefgh', auth: 'abcdefgh' } },
      { endpoint: 'https://push.example/x', keys: { p256dh: 'abcdefgh' } },
      { endpoint: 'https://push.example/x' },
    ]) {
      const r = res()
      await route('POST', 'push/subscribe').handler({ body, headers: {} }, r, { sql, user })
      expect(r.statusCode).toBe(422)
    }
    expect(writes).toEqual([])
  })
  it('saves a good subscription for the caller only', async () => {
    const r = res()
    await route('POST', 'push/subscribe').handler({ body: { endpoint: 'https://push.example/x', keys: { p256dh: 'abcdefgh', auth: 'abcdefgh' } }, headers: { 'user-agent': 'iPhone' } }, r, { sql, user })
    expect(r.statusCode).toBe(200)
    const insert = writes.find(w => w.text.startsWith('INSERT INTO push_subscriptions'))
    expect(insert.values[0]).toBe('user_ana')
    expect(insert.text).toContain('ON CONFLICT (endpoint) DO UPDATE')
  })
  it('only removes your own devices, and never reveals an address', async () => {
    const r = res()
    await route('DELETE', 'push/devices/3f2504e0-4f89-11d3-9a0c-0305e82c3301').handler({}, r, { sql, user, params: { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' } })
    expect(writes[0].text).toContain('AND clerk_user_id =')
    const s = res()
    await route('GET', 'push/status').handler({}, s, { sql, user })
    expect(s.body.devices[0].endpoint).toBeUndefined()
    expect(s.body.devices[0].endpoint_hash).toBe(endpointHash('https://push.example/d1'))
  })
})

describe('device addresses stay off the browser query proxy', () => {
  it('refuses reading them, and still allows the migration that makes the table', async () => {
    const { touchesPersonalTables } = await import('./db.js')
    expect(touchesPersonalTables('SELECT endpoint, auth FROM push_subscriptions')).toBe(true)
    expect(touchesPersonalTables('DELETE FROM push_subscriptions')).toBe(true)
    expect(touchesPersonalTables('CREATE TABLE IF NOT EXISTS push_subscriptions (id UUID PRIMARY KEY)')).toBe(false)
    expect(touchesPersonalTables('CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (clerk_user_id)')).toBe(false)
  })
})
