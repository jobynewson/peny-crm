import { describe, it, expect, vi } from 'vitest'

vi.mock('@clerk/backend', () => ({ createClerkClient: () => ({}) }))
vi.mock('./_notify.js', async orig => ({ ...(await orig()), notify: vi.fn() }))

const { hashToken, newToken, deliveryEmail, approveUrl, changesUrl, changesLinkUrl, deliveryRecipients, notifiedMessage, LINK_DAYS } = await import('./_delivery-mail.js')

describe('the tokens', () => {
  it('are 256 random bits in URL-safe form, never the same twice', () => {
    const seen = new Set()
    for (let i = 0; i < 200; i++) {
      const t = newToken()
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)   // what api/_client.js accepts
      seen.add(t)
    }
    expect(seen.size).toBe(200)
  })
  it('are stored as a hash, which is not the token and is stable', () => {
    const t = newToken()
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(t)).toBe(hashToken(t))
    expect(hashToken(t)).not.toContain(t)
    expect(hashToken(t)).not.toBe(hashToken(newToken()))
  })
  it('ride in the fragment, so they never reach a server log', () => {
    const url = approveUrl('abc')
    expect(new URL(url).pathname).toBe('/portal/approve')
    expect(new URL(url).search).toBe('')
    expect(new URL(url).hash).toBe('#abc')
  })
  it('request-changes goes to the portal, with no token in it', () => {
    expect(changesUrl('11111111-1111-4111-8111-111111111111')).toMatch(/\/portal#d-11111111-1111-4111-8111-111111111111$/)
  })
})

describe('the delivery email', () => {
  const base = {
    studio: 'Peny', company: 'DMM', title: 'October reel', round: 2, note: 'Colour fixed', url: 'https://f.io/abc',
    first: 'Dana', approve: 'https://slate.test/portal/approve#TOKEN', changes: 'https://slate.test/portal#d-x',
    expires: new Date('2026-10-13T10:00:00Z'),
  }
  it('says what it is, offers Watch, Approve and Request changes, and says the button works once', () => {
    const { subject, html } = deliveryEmail(base)
    expect(subject).toBe('Ready for your review: October reel')
    expect(html).toContain('Hi Dana')
    expect(html).toContain('round 2 of <strong>October reel</strong>')
    expect(html).toContain('Colour fixed')
    expect(html).toContain('href="https://f.io/abc"')
    expect(html).toContain('href="https://slate.test/portal/approve#TOKEN"')
    expect(html).toContain('>Approve<')
    expect(html).toContain('href="https://slate.test/portal#d-x"')
    expect(html).toContain('>Request changes<')
    expect(html).toContain('works once')
    expect(html).toContain('13 October')
  })
  it('the request-changes button carries no token', () => {
    const { html } = deliveryEmail(base)
    const changes = html.match(/<a href="([^"]*)"[^>]*>Request changes<\/a>/)[1]
    expect(changes).not.toContain('TOKEN')
    expect(changes).not.toContain('approve')
  })
  it('escapes what a person typed', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const { html } = deliveryEmail({ ...base, title: evil, note: evil, company: evil, first: evil })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
  it('copes without a note, a name or a studio', () => {
    const { html } = deliveryEmail({ ...base, note: null, first: null, studio: null })
    expect(html).toContain('Hi there')
    expect(html).not.toContain('border-left:3px solid #ddd')
  })
  it('links last two weeks', () => {
    expect(LINK_DAYS).toBe(14)
  })
})

describe('telling the sender who was emailed', () => {
  it('names the number, or why nobody', () => {
    expect(notifiedMessage({ sent: 1 }, 'DMM')).toBe('emailed 1 person at DMM')
    expect(notifiedMessage({ sent: 3 }, 'DMM')).toBe('emailed 3 people at DMM')
    for (const reason of ['hidden', 'no_one', 'no_members', 'not_sent']) {
      const m = notifiedMessage({ sent: 0, reason }, 'DMM')
      expect(m).not.toMatch(/emailed \d/)
      expect(m.length).toBeGreaterThan(10)
    }
    expect(notifiedMessage({ sent: 0, reason: 'never-heard-of-it' })).toBe('no one was emailed')
  })
})

describe('the changes link for someone with no login', () => {
  it('is the same confirm page with the box open, and the token in the fragment only', () => {
    const url = new URL(changesLinkUrl('abc'))
    expect(url.pathname).toBe('/portal/approve')
    expect(url.search).toBe('?changes=1')
    expect(url.hash).toBe('#abc')
  })
  it('replaces the sign-in wording in the email', () => {
    const base = { company: 'DMM', title: 'Reel', round: 1, url: 'https://f.io/x', approve: 'https://s/approve#t', changes: 'https://s/portal' }
    expect(deliveryEmail({ ...base }).html).toContain('where you sign in and say what needs to change')
    const noLogin = deliveryEmail({ ...base, noLogin: true, changes: changesLinkUrl('t') }).html
    expect(noLogin).toContain('nothing to sign in to')
    expect(noLogin).not.toContain('where you sign in')
    expect(noLogin).toContain('portal/approve?changes=1#t')
  })
})

describe('who gets a round\'s email', () => {
  const dana = { clerk_id: 'u_dana', email: 'Dana@DMM.test', name: 'Dana Client', first: 'Dana' }
  const none = { clerkIds: new Set(), emails: new Set() }
  it('is the login people, then the client contact, then the extra addresses', () => {
    const out = deliveryRecipients({
      members: [dana], contact: { email: 'sam@x.test', name: 'Sam Lee', first: 'Sam' }, extras: ['ops@x.test'], staff: none,
    })
    expect(out.map(p => [p.email, p.source, p.clerk_id])).toEqual([['Dana@DMM.test', 'login', 'u_dana'], ['sam@x.test', 'contact', null], ['ops@x.test', 'extra', null]])
    expect(out[1]).toMatchObject({ name: 'Sam Lee', first: 'Sam' })
  })
  it('gives one person one email, the login winning over a bare address, whatever the case', () => {
    const out = deliveryRecipients({ members: [dana], contact: { email: 'dana@dmm.test' }, extras: ['DANA@dmm.test', 'ops@x.test', 'Ops@x.test'], staff: none })
    expect(out.map(p => [p.email, p.source])).toEqual([['Dana@DMM.test', 'login'], ['ops@x.test', 'extra']])
  })
  it('never includes Slate staff, by login or by address', () => {
    const staff = { clerkIds: new Set(['u_dana']), emails: new Set(['ops@x.test', 'sam@x.test']) }
    const out = deliveryRecipients({ members: [dana], contact: { email: 'sam@x.test' }, extras: ['ops@x.test', 'ok@x.test'], staff })
    expect(out.map(p => p.email)).toEqual(['ok@x.test'])
  })
  it('skips anything that is not an address, and copes with nothing at all', () => {
    expect(deliveryRecipients({ members: [{ clerk_id: 'u', email: null }], contact: { email: 'nope' }, extras: ['also nope', 7, null], staff: none })).toEqual([])
    expect(deliveryRecipients({})).toEqual([])
  })
})
