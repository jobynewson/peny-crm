import { describe, it, expect } from 'vitest'
import { COMPANY_TYPES, typeLabel, kindOf, isSubcontractor, groupContacts, linkSuggestions, personMatches } from './contact-kind.js'
import { COMPANY_TYPES as SERVER_TYPES, COMPANY_TYPE_LABELS } from '../../api/_retainer-rules.js'

const co = (id, name, type = 'client', extra = {}) => ({ id, name, type, ...extra })
const person = (id, first, last, over = {}) => ({ id, first_name: first, last_name: last, company_id: null, company: null, type: 'brand', status: 'Active', role: null, email: null, ...over })

const companies = [co('c1', 'DMM'), co('c2', 'Kit Hire', 'supplier'), co('c3', 'Crew Co', 'subcontractor'), co('c4', 'Acme', 'prospect')]

describe('the company types', () => {
  it('are the list the server checks, with its labels', () => {
    expect(COMPANY_TYPES.map(t => t.key)).toEqual(SERVER_TYPES)
    for (const t of COMPANY_TYPES) expect(t.label).toBe(COMPANY_TYPE_LABELS[t.key])
    expect(typeLabel('supplier')).toBe('Supplier')
    expect(typeLabel('nonsense')).toBe('Other')
  })
})

describe('what a person is', () => {
  it('their company\'s type when they have one, whatever they were typed themselves', () => {
    expect(kindOf(person('p', 'A', 'B', { company_id: 'c3', type: 'brand' }), companies)).toBe('subcontractor')
    expect(kindOf(person('p', 'A', 'B', { company_id: 'c1', type: 'subcontractor' }), companies)).toBe('client')
    expect(kindOf(person('p', 'A', 'B', { company_id: 'c2' }), companies)).toBe('supplier')
  })
  it('their own type when they have no company: subcontractor, or else the client side', () => {
    expect(kindOf(person('p', 'A', 'B', { type: 'subcontractor' }), companies)).toBe('subcontractor')
    for (const type of ['brand', 'agency', 'ngo', 'sport', 'corp', undefined]) expect(kindOf(person('p', 'A', 'B', { type }), companies)).toBe('client')
  })
  it('treats a link to a company we do not know about as no company', () => {
    expect(kindOf(person('p', 'A', 'B', { company_id: 'gone', type: 'subcontractor' }), companies)).toBe('subcontractor')
    expect(isSubcontractor(person('p', 'A', 'B', { company_id: 'c3' }), companies)).toBe(true)
    expect(isSubcontractor(person('p', 'A', 'B', { company_id: 'c1' }), companies)).toBe(false)
  })
})

describe('the Companies view', () => {
  const people = [
    person('p1', 'Sam', 'Lee', { company_id: 'c1', email: 'sam@dmm.test' }),
    person('p2', 'Ana', 'Ruiz', { company_id: 'c1', role: 'Producer' }),
    person('p3', 'Kit', 'Person', { company_id: 'c2' }),
    person('p4', 'Free', 'Lancer', { type: 'subcontractor' }),
    person('p5', 'Loose', 'Client'),
    person('p6', 'Old', 'Hand', { company_id: 'c3', status: 'Retired' }),
  ]
  const names = g => g.groups.map(x => x.company.name)

  it('lists companies alphabetically with their people, and people with no company apart', () => {
    const g = groupContacts({ contacts: people, companies })
    expect(names(g)).toEqual(['Acme', 'Crew Co', 'DMM', 'Kit Hire'])
    expect(g.groups.find(x => x.company.name === 'DMM').people.map(p => p.first_name)).toEqual(['Ana', 'Sam'])
    expect(g.groups.find(x => x.company.name === 'Acme').people).toEqual([])   // a company with nobody yet still shows
    expect(g.none.map(p => p.first_name)).toEqual(['Free', 'Loose'])
  })

  it('filters by type, and files unlinked people by their own kind', () => {
    expect(names(groupContacts({ contacts: people, companies, type: 'subcontractor' }))).toEqual(['Crew Co'])
    expect(groupContacts({ contacts: people, companies, type: 'subcontractor' }).none.map(p => p.first_name)).toEqual(['Free'])
    expect(names(groupContacts({ contacts: people, companies, type: 'client' }))).toEqual(['DMM'])
    expect(groupContacts({ contacts: people, companies, type: 'client' }).none.map(p => p.first_name)).toEqual(['Loose'])
    expect(groupContacts({ contacts: people, companies, type: 'supplier' }).none).toEqual([])
  })

  it('searches company names and people, showing only the people that match unless the company name did', () => {
    const byName = groupContacts({ contacts: people, companies, search: 'dmm' })
    expect(names(byName)).toEqual(['DMM'])
    expect(byName.groups[0].people).toHaveLength(2)        // the company matched: all its people
    expect(byName.groups[0].open).toBe(false)
    const byPerson = groupContacts({ contacts: people, companies, search: 'ana' })
    expect(names(byPerson)).toEqual(['DMM'])
    expect(byPerson.groups[0].people.map(p => p.first_name)).toEqual(['Ana'])
    expect(byPerson.groups[0].open).toBe(true)              // opened because a person matched
    expect(groupContacts({ contacts: people, companies, search: 'lancer' }).none.map(p => p.first_name)).toEqual(['Free'])
    expect(groupContacts({ contacts: people, companies, search: 'producer' }).groups[0].people[0].first_name).toBe('Ana')
    expect(groupContacts({ contacts: people, companies, search: 'SAM@DMM' }).groups[0].people[0].first_name).toBe('Sam')
    const none = groupContacts({ contacts: people, companies, search: 'zzz' })
    expect([none.groups, none.none]).toEqual([[], []])
  })

  it('leaves nobody out: every person is in a company or in the no-company list', () => {
    const g = groupContacts({ contacts: people, companies })
    const shown = [...g.groups.flatMap(x => x.people), ...g.none]
    expect(shown.map(p => p.id).sort()).toEqual(people.map(p => p.id).sort())
  })

  it('files a person linked to a company we do not have under no company', () => {
    const g = groupContacts({ contacts: [person('x', 'Lost', 'Link', { company_id: 'gone' })], companies })
    expect(g.none.map(p => p.id)).toEqual(['x'])
  })

  it('can filter people by their own status', () => {
    const g = groupContacts({ contacts: people, companies, status: 'Retired' })
    expect(g.groups.find(x => x.company.name === 'Crew Co').people.map(p => p.first_name)).toEqual(['Old'])
    expect(g.none).toEqual([])
  })
})

describe('matching a search', () => {
  it('reads name, role, email, the old free-text company and the company\'s name', () => {
    const p = person('p', 'Sam', 'Lee', { role: 'Director', email: 's@x.test', company: 'Old Text Ltd' })
    for (const q of ['sam lee', 'director', 's@x', 'old text', 'kit hire']) expect(personMatches(p, q, 'Kit Hire')).toBe(true)
    expect(personMatches(p, 'nope')).toBe(false)
    expect(personMatches(p, '')).toBe(true)
  })
})

describe('link suggestions', () => {
  it('match a typed company to an existing one, ignoring case and spacing, and never link anyone themselves', () => {
    const s = linkSuggestions([
      person('p1', 'Sam', 'Lee', { company: 'dmm' }),
      person('p2', 'Ana', 'Ruiz', { company: '  DMM  ' }),
    ], companies)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ name: 'dmm', company: companies[0] })
    expect(s[0].people.map(p => p.id)).toEqual(['p1', 'p2'])
  })
  it('offer to create a company that does not exist, typed from who is in it', () => {
    const s = linkSuggestions([
      person('p1', 'A', 'One', { company: 'Freelance Ltd', type: 'subcontractor' }),
      person('p2', 'B', 'Two', { company: 'Freelance Ltd', type: 'subcontractor' }),
      person('p3', 'C', 'Three', { company: 'Mixed Co', type: 'subcontractor' }),
      person('p4', 'D', 'Four', { company: 'Mixed Co', type: 'brand' }),
    ], companies)
    const by = Object.fromEntries(s.map(x => [x.name, x]))
    expect(by['Freelance Ltd']).toMatchObject({ company: null, suggestedType: 'subcontractor' })
    expect(by['Mixed Co']).toMatchObject({ company: null, suggestedType: 'client' })
  })
  it('skip people who are linked, and people with no company text', () => {
    const s = linkSuggestions([
      person('p1', 'A', 'One', { company: 'DMM', company_id: 'c1' }),
      person('p2', 'B', 'Two', { company: '   ' }),
      person('p3', 'C', 'Three', { company: null }),
    ], companies)
    expect(s).toEqual([])
  })
  it('come out alphabetically', () => {
    const s = linkSuggestions([person('p1', 'A', 'One', { company: 'Zed' }), person('p2', 'B', 'Two', { company: 'Alpha' })], [])
    expect(s.map(x => x.name)).toEqual(['Alpha', 'Zed'])
  })
})
