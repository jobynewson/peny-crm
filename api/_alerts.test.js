import { describe, it, expect, vi } from 'vitest'

vi.mock('./_notify.js', async orig => ({ ...(await orig()), notify: vi.fn() }))

const {
  resolveRecipients, inAlertWindow, inputAlertDays, claimStands, DEFAULT_INPUT_DAYS,
  newRequestEmail, changesRequestedEmail, clientReplyEmail, dueSoonEmail, inputOverdueEmail,
} = await import('./_alerts.js')
const { KINDS, switchableKinds, wantsEmail } = await import('./_notify.js')

const ana = { id: 'a', email: 'ana@peny.com', name: 'Ana' }
const lee = { id: 'l', email: 'lee@peny.com', name: 'Lee' }
const boss = { id: 'b', email: 'boss@peny.com', name: 'Boss' }

describe('who hears', () => {
  it('the owner, when there is one', () => {
    expect(resolveRecipients({ owner: ana, lead: lee, superadmins: [boss] })).toEqual({ via: 'owner', to: [ana] })
  })
  it('the lead when the deliverable has no owner', () => {
    expect(resolveRecipients({ owner: null, lead: lee, superadmins: [boss] })).toEqual({ via: 'lead', to: [lee] })
  })
  it('every superadmin when there is neither — never no one', () => {
    expect(resolveRecipients({ owner: null, lead: null, superadmins: [boss, ana] })).toEqual({ via: 'superadmins', to: [boss, ana] })
  })
  it('someone with no email address does not count', () => {
    expect(resolveRecipients({ owner: { id: 'x', email: null }, lead: lee }).via).toBe('lead')
    expect(resolveRecipients({ owner: { id: 'x', email: '' }, lead: { id: 'y' }, superadmins: [boss] }).via).toBe('superadmins')
  })
})

describe('quiet hours (London, 07:00 up to 20:00)', () => {
  const at = iso => inAlertWindow(new Date(iso))
  it('in summer time', () => {
    expect(at('2026-09-29T05:59:00Z')).toBe(false)   // 06:59 BST
    expect(at('2026-09-29T06:00:00Z')).toBe(true)    // 07:00 BST
    expect(at('2026-09-29T18:59:00Z')).toBe(true)    // 19:59 BST
    expect(at('2026-09-29T19:00:00Z')).toBe(false)   // 20:00 BST
    expect(at('2026-09-29T23:30:00Z')).toBe(false)
  })
  it('in winter time', () => {
    expect(at('2026-12-01T06:59:00Z')).toBe(false)
    expect(at('2026-12-01T07:00:00Z')).toBe(true)
    expect(at('2026-12-01T19:59:00Z')).toBe(true)
    expect(at('2026-12-01T20:00:00Z')).toBe(false)
  })
  it('midnight is quiet, not 24:00', () => {
    expect(at('2026-12-01T00:00:00Z')).toBe(false)
  })
})

describe('the client-input threshold', () => {
  it('is seven days unless CLIENT_INPUT_ALERT_DAYS says otherwise', () => {
    expect(inputAlertDays({})).toBe(DEFAULT_INPUT_DAYS)
    expect(inputAlertDays({ CLIENT_INPUT_ALERT_DAYS: '10' })).toBe(10)
    for (const bad of ['0', '-3', 'soon', '2.5', '']) expect(inputAlertDays({ CLIENT_INPUT_ALERT_DAYS: bad })).toBe(7)
  })
})

describe('once per item', () => {
  it('a claim stands if someone was told, or chose not to be', () => {
    expect(claimStands([{ sent: true }])).toBe(true)
    expect(claimStands([{ skipped: 'setting' }])).toBe(true)
    expect(claimStands([{ error: 'Gmail said no' }, { sent: true }])).toBe(true)
  })
  it('is given back when nothing could be sent, so the next run tries again', () => {
    expect(claimStands([])).toBe(false)
    expect(claimStands([{ error: 'Gmail said no' }])).toBe(false)
    expect(claimStands([{ skipped: 'not_configured' }])).toBe(false)
    expect(claimStands([{ skipped: 'no_email' }])).toBe(false)
  })
})

describe('the kinds', () => {
  const alerts = ['alert_new_request', 'alert_changes_requested', 'alert_client_reply', 'alert_due_soon', 'alert_input_overdue']
  it('each urgent alert can be muted on its own, defaults on, and does not depend on the digest', () => {
    for (const kind of alerts) {
      expect(switchableKinds({ superadmin: false })).toContain(kind)
      expect(KINDS[kind].default).toBe(true)
      expect(KINDS[kind].description).toBeTruthy()
      // muting the digest changes nothing here
      expect(wantsEmail(kind, undefined)).toBe(true)
    }
    expect(wantsEmail('alert_due_soon', false)).toBe(false)
    expect(wantsEmail('due_digest', false)).toBe(false)
    expect(wantsEmail('alert_due_soon', undefined)).toBe(true)
  })
  it('the delivery email to a client always sends', () => {
    expect(switchableKinds({ superadmin: true })).not.toContain('delivery_ready')
    expect(wantsEmail('delivery_ready', false)).toBe(true)
  })
})

describe('the wording', () => {
  const d = {
    id: 'd1', title: 'October reel', company: 'DMM', workstream: 'Monthly content', company_id: 'c1',
    due_date: '2026-10-01', status_label: 'In progress', waiting_note: 'Ship date for the new product',
  }
  it('a new request says who, what and by when, and links to triage', () => {
    const e = newRequestEmail({
      company: 'DMM',
      request: { id: 'r1', title: 'Cut-down', detail: 'See https://x.test/brief', wanted_by: '2026-10-30', submitted_by_name: 'Sam' },
    })
    expect(e.subject).toBe('New request from DMM: Cut-down')
    expect(e.sentence).toContain('Sam at DMM')
    expect(e.body).toContain('https://x.test/brief')
    expect(e.href).toMatch(/#requests\/r1$/)
  })
  it('everything a client wrote is escaped', () => {
    const evil = '<img src=x onerror=alert(1)>'
    for (const e of [
      newRequestEmail({ company: 'DMM', request: { id: 'r', title: evil, detail: evil, submitted_by_name: evil } }),
      changesRequestedEmail({ d, comment: evil, by: evil }),
      clientReplyEmail({ d, reply: evil, by: evil }),
    ]) {
      expect(e.body + e.sentence).not.toContain('<img')
      expect(e.body + e.sentence).toContain('&lt;img')
    }
  })
  it('changes requested carries the comment', () => {
    const e = changesRequestedEmail({ d, comment: 'Logo is too small', by: 'Sam' })
    expect(e.subject).toBe('DMM asked for changes: October reel')
    expect(e.body).toContain('Logo is too small')
    expect(e.href).toMatch(/#retainers\/c1$/)
  })
  it('a reply shows what we asked for and what they said', () => {
    const e = clientReplyEmail({ d, reply: 'Shipped on Friday', by: 'Sam' })
    expect(e.body).toContain('Ship date for the new product')
    expect(e.body).toContain('Shipped on Friday')
  })
  it('due soon and input overdue name the item and the client', () => {
    expect(dueSoonEmail({ d, now: '2026-09-29' }).subject).toContain('October reel')
    const o = inputOverdueEmail({ d, days: 7 })
    expect(o.subject).toBe('DMM still owes us input: October reel')
    expect(o.sentence).toContain('7 days')
  })
})

const { digestApprovalWindow, routeApprovals, approvalsSectionHtml } = await import('./_alerts.js')

describe('the approvals window for the digest', () => {
  const win = iso => { const w = digestApprovalWindow(new Date(iso)); return [w.from.toISOString(), w.to.toISOString()] }
  it('is the previous 09:00 UTC to this one on Tuesday to Friday', () => {
    expect(win('2026-09-29T09:00:05Z')).toEqual(['2026-09-28T09:00:00.000Z', '2026-09-29T09:00:00.000Z'])   // Tuesday
    expect(win('2026-10-02T09:30:00Z')).toEqual(['2026-10-01T09:00:00.000Z', '2026-10-02T09:00:00.000Z'])   // Friday
  })
  it('covers the weekend on a Monday', () => {
    expect(win('2026-09-28T09:00:05Z')).toEqual(['2026-09-25T09:00:00.000Z', '2026-09-28T09:00:00.000Z'])
  })
  it('leaves no gap and no overlap between one digest and the next', () => {
    const fri = digestApprovalWindow(new Date('2026-10-02T09:00:30Z'))
    const mon = digestApprovalWindow(new Date('2026-10-05T09:00:03Z'))
    expect(mon.from.getTime()).toBe(fri.to.getTime())
  })
  it('a run before 09:00 reports the last full window, not one that has not ended', () => {
    expect(win('2026-09-29T06:00:00Z')).toEqual(['2026-09-25T09:00:00.000Z', '2026-09-28T09:00:00.000Z'])
  })
})

describe('who reads about an approval', () => {
  const users = [
    { id: 'ana', email: 'ana@x.test', role: 'user' }, { id: 'lee', email: 'lee@x.test', role: 'user' },
    { id: 'boss', email: 'boss@x.test', role: 'superadmin' },
  ]
  const approval = over => ({ id: 'a', title: 'Reel', company: 'DMM', company_id: 'c', round: 1, responded_at: '2026-09-28T12:00:00Z', ...over })
  it('the owner, else the company lead, else the superadmins', () => {
    const out = routeApprovals([
      approval({ id: '1', owner_id: 'ana', lead_id: 'lee' }),
      approval({ id: '2', owner_id: null, lead_id: 'lee' }),
      approval({ id: '3', owner_id: null, lead_id: null }),
    ], users)
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.map(a => a.id)]))).toEqual({ ana: ['1'], lee: ['2'], boss: ['3'] })
  })
  it('an approval nobody can be told about is not lost silently for want of a superadmin — there is just no one', () => {
    expect(routeApprovals([approval({})], [{ id: 'ana', email: 'ana@x.test', role: 'user' }])).toEqual({})
  })
})

describe('the digest section', () => {
  it('is empty when there is nothing to say', () => {
    expect(approvalsSectionHtml([], 'https://slate.test')).toBe('')
  })
  it('names what was approved, for whom, and by whom, and links to the client', () => {
    const html = approvalsSectionHtml([
      { title: 'October reel', company: 'DMM', company_id: 'c1', round: 2, responded_at: '2026-09-27T12:00:00Z', responded_by_name: 'Dana Client', recorded: false },
      { title: 'Stills', company: 'DMM', company_id: 'c1', round: 1, responded_at: '2026-09-28T08:00:00Z', responded_by_name: 'Ana', recorded: true },
    ], 'https://slate.test')
    expect(html).toContain('Approved since your last digest')
    expect(html).toContain('October reel')
    expect(html).toContain('round 2 · Dana Client')
    expect(html).toContain('recorded by the team')
    expect(html).not.toContain('Ana')     // whoever on the team recorded it is not named
    expect(html).toContain('href="https://slate.test/#retainers/c1"')
    expect(html).toContain('Approved Sun 27 Sep')
  })
  it('escapes what clients typed', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const html = approvalsSectionHtml([{ title: evil, company: evil, company_id: 'c', round: 1, responded_at: '2026-09-27T12:00:00Z', responded_by_name: evil, recorded: false }], 'https://slate.test')
    expect(html).not.toContain('<img')
  })
})
