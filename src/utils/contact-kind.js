// src/utils/contact-kind.js
// Contacts are organised by company. A company has a type; a person inherits it.
// People with no company keep the kind they were given themselves (most of the
// existing contacts are unlinked, and freelancers often have no company at all).
// Pure functions, unit-tested in contact-kind.test.js.
//
// COMPANY_TYPES mirrors the list in api/_retainer-rules.js (the server checks
// it). src/ can't import from api/, so contact-kind.test.js compares the two.

export const COMPANY_TYPES = [
  { key: 'client',        label: 'Client' },
  { key: 'prospect',      label: 'Prospect' },
  { key: 'subcontractor', label: 'Subcontractor' },
  { key: 'supplier',      label: 'Supplier' },
  { key: 'other',         label: 'Other' },
]
export const typeLabel = key => COMPANY_TYPES.find(t => t.key === key)?.label ?? 'Other'

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const fullName = c => `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()

// What a person is, for filing and for the pickers that ask "is this a
// subcontractor?": their company's type when they have one, else their own
// (a person typed subcontractor is one; anything else is on the client side).
export function kindOf(contact, companies = []) {
  const company = contact.company_id ? companies.find(c => c.id === contact.company_id) : null
  if (company) return company.type || 'client'
  return contact.type === 'subcontractor' ? 'subcontractor' : 'client'
}
export const isSubcontractor = (contact, companies) => kindOf(contact, companies) === 'subcontractor'

// Whether someone matches the search box: their name, role, email or company.
export function personMatches(contact, q, companyName = '') {
  if (!q) return true
  return [fullName(contact), contact.role, contact.email, contact.company, companyName].some(v => norm(v).includes(q))
}

// The Companies view, as data. → { groups, none }
//   groups: [{ company, people, kind, open }] — companies with at least one
//           matching person or a matching name (alphabetical), each with the
//           people that match; `open` is true when the search matched a person
//           rather than just the company (so the row can show why).
//   none:   people with no company that match (alphabetical), shown last.
// `type` filters by kind ('all' for none); `search` is the box; `status` filters
// people by their own status ('all' for none — only the Everyone view offers it).
export function groupContacts({ contacts, companies, type = 'all', search = '', status = 'all' }) {
  const q = norm(search)
  const byCompany = new Map(companies.map(c => [c.id, []]))
  const none = []
  for (const person of contacts) {
    if (status !== 'all' && person.status !== status) continue
    if (person.company_id && byCompany.has(person.company_id)) byCompany.get(person.company_id).push(person)
    else none.push(person)
  }
  const byName = (a, b) => fullName(a).localeCompare(fullName(b), 'en', { sensitivity: 'base' })
  const groups = []
  for (const company of companies) {
    const kind = company.type || 'client'
    if (type !== 'all' && kind !== type) continue
    const everyone = byCompany.get(company.id).sort(byName)
    const nameMatches = !q || norm(company.name).includes(q)
    const people = everyone.filter(p => personMatches(p, q, company.name))
    if (!nameMatches && !people.length) continue
    groups.push({ company, kind, people: nameMatches ? everyone : people, open: !!q && !nameMatches })
  }
  groups.sort((a, b) => a.company.name.localeCompare(b.company.name, 'en', { sensitivity: 'base' }))
  const unlinked = none
    .filter(p => (type === 'all' || kindOf(p, companies) === type) && personMatches(p, q))
    .sort(byName)
  return { groups, none: unlinked }
}

// People who have a company typed in the old free-text field but aren't linked:
// the matches to offer, for a person to confirm one at a time. Nothing is ever
// linked without that. → [{ key, name, company | null, people, suggestedType }]
//   company: the existing company with that name (ignoring case and spacing),
//            or null when it would have to be created.
//   suggestedType: for a company that would be created — subcontractor when
//            everyone with that name is one, else client.
export function linkSuggestions(contacts, companies) {
  const byName = new Map(companies.map(c => [norm(c.name), c]))
  const groups = new Map()
  for (const person of contacts) {
    if (person.company_id) continue
    const key = norm(person.company)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, { key, name: String(person.company).replace(/\s+/g, ' ').trim(), people: [] })
    groups.get(key).people.push(person)
  }
  return [...groups.values()]
    .map(g => ({
      ...g,
      company: byName.get(g.key) ?? null,
      suggestedType: g.people.every(p => p.type === 'subcontractor') ? 'subcontractor' : 'client',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}
