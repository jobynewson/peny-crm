import { describe, it, expect, vi, beforeEach } from 'vitest'

const notify = vi.fn()
vi.mock('./_notify.js', async orig => ({ ...(await orig()), notify }))

const { deadlineSentence, requestReceivedEmail, requestAcceptedEmail, requestDeclinedEmail, emailRequestUpdate } = await import('./_request-mail.js')
const { KINDS, switchableKinds, wantsEmail } = await import('./_notify.js')

const TODAY = '2026-10-01'

describe('what the deadline sentence says', () => {
  it('confirms the date they asked for', () => {
    const s = deadlineSentence({ wanted: '2026-10-30', due: '2026-10-30', today: TODAY })
    expect(s).toContain('confirmed your deadline of Fri 30 Oct')
    expect(s).toContain('capacity')
  })
  it('gives our date, and the one they asked for, when they differ', () => {
    const s = deadlineSentence({ wanted: '2026-10-30', due: '2026-11-04', today: TODAY })
    expect(s).toContain('by Wed 4 Nov')
    expect(s).toContain('You asked for Fri 30 Oct')
  })
  it('gives our date when they asked for none', () => {
    expect(deadlineSentence({ wanted: null, due: '2026-11-04', today: TODAY })).toBe('We have the capacity for this and can deliver it by Wed 4 Nov.')
  })
  it('promises a date when there is none yet', () => {
    expect(deadlineSentence({ wanted: null, due: null, today: TODAY })).toContain('confirm a delivery date')
  })
})

describe('the wording', () => {
  const request = { title: 'Cut-down', wanted_by: '2026-10-30' }
  it('received: says we have it and are checking capacity, not that we will take a look', () => {
    const e = requestReceivedEmail({ request, company: 'DMM', studio: 'Peny', today: TODAY })
    expect(e.subject).toBe('We’ve got your request: Cut-down')
    expect(e.sentence).toContain('your deadline of Fri 30 Oct')
    expect(e.sentence).toContain('capacity')
    expect(e.sentence).not.toMatch(/take a look/i)
    expect(e.href).toMatch(/\/portal$/)
  })
  it('accepted: confirms the deadline and links to the item', () => {
    const e = requestAcceptedEmail({ request, company: 'DMM', deliverableId: 'abc', due: '2026-10-30', today: TODAY })
    expect(e.subject).toBe('Confirmed: Cut-down')
    expect(e.sentence).toContain('booked in')
    expect(e.sentence).toContain('confirmed your deadline')
    expect(e.href).toMatch(/\/portal#d-abc$/)
  })
  it('declined: carries our note', () => {
    const e = requestDeclinedEmail({ request, company: 'DMM', note: 'Outside this retainer.' })
    expect(e.body).toContain('Outside this retainer.')
  })
  it('escapes what a client typed', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const e = requestReceivedEmail({ request: { title: evil, wanted_by: null }, company: evil, today: TODAY })
    // subject is plain text and the subtitle is escaped by the wrapper; the HTML parts must be safe here
    expect(e.body + e.sentence).not.toContain('<img src=x')
    expect(e.body).toContain('&lt;img')
  })
})

describe('the kinds', () => {
  it('always send to a client', () => {
    for (const kind of ['request_received', 'request_accepted', 'request_declined']) {
      expect(KINDS[kind].testable).toBe(true)
      expect(switchableKinds({ superadmin: true })).not.toContain(kind)
      expect(wantsEmail(kind, false)).toBe(true)
    }
  })
})

describe('emailRequestUpdate', () => {
  const row = over => ({
    id: 'r1', title: 'Cut-down', wanted_by: '2026-10-30', status: 'new', decline_note: null,
    submitted_by: 'user_dana', submitted_via: 'login', deliverable_id: null, due_date: null, client_visible: null,
    company: 'DMM', studio: 'Peny', ...over,
  })
  const sqlOf = r => async () => (r ? [r] : [])
  const lookup = vi.fn(async () => ({ email: 'dana@dmm.test', first: 'Dana', name: 'Dana Client' }))
  beforeEach(() => { notify.mockReset(); notify.mockResolvedValue([{ sent: true }]); lookup.mockClear() })

  it('emails the person who sent it when it arrives', async () => {
    expect(await emailRequestUpdate(sqlOf(row()), { requestId: 'r1', stage: 'received', lookup })).toEqual({ sent: true })
    const [, args] = notify.mock.calls[0]
    expect(args.kind).toBe('request_received')
    expect(args.to).toEqual({ email: 'dana@dmm.test', name: 'Dana Client' })
    expect(args.html).toContain('Hi Dana,')
  })
  it('quotes the date and links to the item when accepted', async () => {
    const r = row({ status: 'accepted', deliverable_id: 'd9', due_date: '2026-10-30', client_visible: true })
    await emailRequestUpdate(sqlOf(r), { requestId: 'r1', stage: 'accepted', lookup })
    const [, args] = notify.mock.calls[0]
    expect(args.kind).toBe('request_accepted')
    expect(args.html).toContain('confirmed your deadline')
    expect(args.html).toContain('/portal#d-d9')
  })
  it('does not quote a date from an item the client cannot see', async () => {
    const r = row({ status: 'accepted', deliverable_id: 'd9', due_date: '2026-10-30', client_visible: false })
    await emailRequestUpdate(sqlOf(r), { requestId: 'r1', stage: 'accepted', lookup })
    const [, args] = notify.mock.calls[0]
    expect(args.html).not.toContain('#d-d9')
    expect(args.html).toContain('confirm a delivery date')
  })
  it('sends our note when declined', async () => {
    await emailRequestUpdate(sqlOf(row({ status: 'declined', decline_note: 'Outside this retainer.' })), { requestId: 'r1', stage: 'declined', lookup })
    expect(notify.mock.calls[0][1].html).toContain('Outside this retainer.')
  })
  it('writes to no one for a project-link request', async () => {
    expect(await emailRequestUpdate(sqlOf(row({ submitted_via: 'link', submitted_by: null })), { requestId: 'r1', stage: 'received', lookup })).toEqual({ skipped: 'link' })
    expect(notify).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
  })
  it('sends nothing when the stage does not match the request', async () => {
    expect(await emailRequestUpdate(sqlOf(row({ status: 'declined' })), { requestId: 'r1', stage: 'accepted', lookup })).toEqual({ skipped: 'stage' })
    expect(notify).not.toHaveBeenCalled()
  })
  it('sends nothing when the person has no address', async () => {
    expect(await emailRequestUpdate(sqlOf(row()), { requestId: 'r1', stage: 'received', lookup: async () => ({ email: null }) })).toEqual({ skipped: 'no_address' })
  })
  it('never throws, whatever fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await emailRequestUpdate(sqlOf(row()), { requestId: 'r1', stage: 'received', lookup: async () => { throw new Error('clerk down') } })).toEqual({ skipped: 'error' })
    notify.mockRejectedValue(new Error('smtp'))
    expect(await emailRequestUpdate(sqlOf(row()), { requestId: 'r1', stage: 'received', lookup })).toEqual({ skipped: 'error' })
    err.mockRestore()
  })
  it('says so when the mail did not go', async () => {
    notify.mockResolvedValue([{ skipped: 'not_configured' }])
    expect(await emailRequestUpdate(sqlOf(row()), { requestId: 'r1', stage: 'received', lookup })).toEqual({ skipped: 'not_sent' })
  })
})
