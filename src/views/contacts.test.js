import { describe, it, expect, vi } from 'vitest'

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
vi.mock('../db/client.js', () => ({ createContact: vi.fn(), updateContact: vi.fn(), deleteContact: vi.fn(), logActivity: vi.fn(), getActivityLog: vi.fn() }))
vi.mock('../api/http.js', () => ({ request: async () => ({}), qs: () => '' }))
const { ContactsView } = await import('./contacts.js')

const co = (id, name, type = 'client', over = {}) => ({ id, name, type, sector: null, type_reviewed: true, lead_id: null, ...over })
const person = (id, first, last, over = {}) => ({ id, first_name: first, last_name: last, company_id: null, company: null, type: 'brand', status: 'Active', role: null, email: null, ...over })
const app = (over = {}) => ({
  permissions: { contacts_edit: true }, appUser: { id: 'u1', role: 'superadmin' }, settings: {}, allUsers: [], projects: [],
  companies: [co('c1', 'DMM'), co('c2', 'Crew Co', 'subcontractor', { type_reviewed: false })],
  contacts: [
    person('p1', 'Sam', 'Lee', { company_id: 'c1', email: 'sam@dmm.test', role: 'Producer' }),
    person('p2', 'Kit', 'Hire', { company_id: 'c2' }),
    person('p3', 'Free', 'Lancer', { type: 'subcontractor' }),
    person('p4', 'Typed', 'Only', { company: 'DMM' }),
    person('p5', 'Evil', '<b>x</b>', { company: '<i>Acme</i>' }),
  ],
  ...over,
})
const view = (a = app(), set = {}) => Object.assign(new ContactsView(a), set)

describe('the Contacts page, by company', () => {
  it('opens on companies, with their type, and each one closed', () => {
    const html = view().listHTML()
    expect(html).toContain('DMM')
    expect(html).toContain('Crew Co')
    expect(html).toContain('Subcontractor')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Sam Lee')          // closed: people not shown
  })

  it('flags a type that was only worked out, and not one that has been confirmed', () => {
    const html = view().listHTML()
    expect(html.match(/check type/g)).toHaveLength(1)
    expect(html.indexOf('check type')).toBeGreaterThan(html.indexOf('Crew Co'))
  })

  it('opens a company to show its people, its type, and what can be done', () => {
    const v = view(app(), { expanded: new Set(['c1']) })
    const html = v.listHTML()
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Sam Lee')
    expect(html).toContain('data-co-type="c1"')
    expect(html).toContain('data-co-add="c1"')
    expect(html).toContain('data-co-portal="c1"')                         // a superadmin
    expect(view(app({ appUser: { role: 'user' } }), { expanded: new Set(['c1']) }).listHTML()).not.toContain('data-co-portal')
  })

  it('offers "Looks right" only while the type is unconfirmed', () => {
    const v = view(app(), { expanded: new Set(['c1', 'c2']) })
    const html = v.listHTML()
    expect(html).toContain('data-co-confirm="c2"')
    expect(html).not.toContain('data-co-confirm="c1"')
  })

  it('gives people with no company somewhere to live, not nowhere', () => {
    const html = view().listHTML()
    expect(html).toContain('No company')
    expect(html).toContain('Free Lancer')
    expect(html).toContain('Typed Only')
  })

  it('keeps read-only people from editing: no add, edit, note or type change', () => {
    const v = view(app({ permissions: { contacts_edit: false } }), { expanded: new Set(['c1']) })
    const html = v.listHTML()
    expect(html).not.toContain('data-co-add')
    expect(html).not.toContain('data-edit=')
    expect(html).not.toContain('data-suggest-link')
    expect(html).toMatch(/data-co-type="c1"[^>]*disabled/)
  })

  it('shows the lead only while leads are on', () => {
    const v = view(app(), { expanded: new Set(['c1']) })
    expect(v.listHTML()).not.toContain('data-co-lead')
    const on = view(app({ settings: { show_leads: true } }), { expanded: new Set(['c1']) })
    expect(on.listHTML()).toContain('data-co-lead="c1"')
    expect(on.listHTML()).toContain('No lead set')
  })

  it('filters by type, and keeps unlinked people by their own kind', () => {
    const html = view(app(), { type: 'subcontractor' }).listHTML()
    expect(html).toContain('Crew Co')
    expect(html).not.toContain('DMM')
    expect(html).toContain('Free Lancer')
    expect(html).not.toContain('Typed Only')
  })

  it('opens a company when the search matches one of its people', () => {
    const html = view(app(), { search: 'producer' }).listHTML()
    expect(html).toContain('DMM')
    expect(html).toContain('Sam Lee')
    expect(html).not.toContain('Crew Co')
  })

  it('says so when nothing matches, and escapes what people typed', () => {
    expect(view(app(), { search: 'zzz' }).listHTML()).toContain('Nothing matches')
    const html = view(app(), { view: 'everyone' }).listHTML()
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b>x&lt;/b>')
  })
})

describe('the suggestions to link people to a company', () => {
  it('say how many names are waiting, and show nothing to do until asked', () => {
    const html = view().listHTML()
    expect(html).toContain('company names typed on people')
    expect(html).toContain('data-review')
    expect(html).not.toContain('data-suggest-link')
  })

  it('list the people to tick for each name, and never link anyone on their own', () => {
    const html = view(app(), { reviewOpen: true }).listHTML()
    expect(html).toContain('data-suggest-link')
    expect(html).toContain('link to <strong>DMM</strong>')                // matches the existing company
    expect(html).toContain('make a new company')                          // "Acme" doesn't exist yet
    expect(html).toContain('data-suggest-person="p4" checked')
    expect(html).toContain('Not now')
  })

  it('go away when set aside, and while searching', () => {
    const v = view(app(), { reviewOpen: true })
    v._dismissed.add('dmm'); v._dismissed.add('<i>acme</i>')
    expect(v.listHTML()).not.toContain('company names typed')
    expect(view(app(), { search: 'dmm', reviewOpen: true }).listHTML()).not.toContain('data-suggest-link')
  })
})

describe('Everyone', () => {
  it('lists every person in one flat list, with their company and kind', () => {
    const html = view(app(), { view: 'everyone' }).listHTML()
    for (const name of ['Sam Lee', 'Kit Hire', 'Free Lancer', 'Typed Only']) expect(html).toContain(name)
    expect(html).toContain('(not linked)')                               // typed a company, never linked
    expect(html).not.toContain('data-co-toggle')
  })

  it('searches by name, email and company, and filters by status', () => {
    expect(view(app(), { view: 'everyone', search: 'sam@dmm' }).listHTML()).toContain('Sam Lee')
    expect(view(app(), { view: 'everyone', search: 'sam@dmm' }).listHTML()).not.toContain('Kit Hire')
    const a = app(); a.contacts[2].status = 'Warm'
    const html = view(a, { view: 'everyone', filter: 'Warm' }).listHTML()
    expect(html).toContain('Free Lancer')
    expect(html).not.toContain('Sam Lee')
  })
})

describe('the numbers at the top', () => {
  it('count companies, clients, subcontractors and people with no company', () => {
    expect(view().counts()).toEqual({ companies: 2, clients: 1, subs: 1, none: 3 })
  })
})
