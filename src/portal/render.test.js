import { describe, it, expect } from 'vitest'
import { renderView } from './render.js'

const view = (over = {}) => ({
  scope: { kind: 'company', can_respond: true },
  today: '2026-09-29',
  title: 'DMM',
  studio: { name: 'Peny', website: null },
  workstreams: [],
  requests: [],
  ...over,
})
const html = v => renderView(v, { signedIn: true, canSwitch: false })

describe('the portal: requests', () => {
  it('offers to ask for something, and shows an empty list kindly', () => {
    const out = html(view())
    expect(out).toContain('data-new-request')
    expect(out).toContain('data-request-form')
    expect(out).toContain('Ask here instead of emailing')
  })

  it('shows Submitted, Accepted (with the date and a way to the worklist) and Declined (with our note)', () => {
    const out = html(view({
      requests: [
        { id: 'q1', title: 'Cut-down', detail: 'See https://x.test/brief.', wanted_by: '2026-10-30', status: 'submitted', status_label: 'Submitted', sent_at: '2026-09-28T10:00:00Z', sent_by: 'Sam', note: null, accepted: null },
        { id: 'q2', title: 'Stills', detail: null, wanted_by: null, status: 'accepted', status_label: 'Accepted', sent_at: '2026-09-20T10:00:00Z', sent_by: null, note: null, accepted: { deliverable_id: 'd9', due: 'Fri 9 Oct', status_label: 'In progress' } },
        { id: 'q3', title: 'Reshoot', detail: null, wanted_by: null, status: 'declined', status_label: 'Declined', sent_at: '2026-09-10T10:00:00Z', sent_by: null, note: 'Outside this retainer.', accepted: null },
      ],
    }))
    expect(out).toContain('pt-chip--request-submitted')
    expect(out).toContain('Wanted by 30 Oct 2026')
    expect(out).toContain('<a href="https://x.test/brief"')
    expect(out).toContain('due Fri 9 Oct')
    expect(out).toContain('href="#d-d9"')
    expect(out).toContain('Our note:</strong> Outside this retainer.')
  })

  it('escapes everything a client typed', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const out = html(view({ requests: [{ id: 'q1', title: evil, detail: evil, wanted_by: null, status: 'submitted', status_label: 'Submitted', sent_at: '2026-09-28T10:00:00Z', sent_by: evil, note: null, accepted: null }] }))
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('&lt;img')
  })

  it('folds older requests away', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, title: `Ask ${i}`, detail: null, wanted_by: null, status: 'submitted', status_label: 'Submitted', sent_at: '2026-09-28T10:00:00Z', sent_by: null, note: null, accepted: null }))
    const out = html(view({ requests: many }))
    expect(out).toContain('Earlier requests (2)')
  })

  it('can\'t ask while viewing as the client, and a portal link has no requests at all', () => {
    expect(html(view({ scope: { kind: 'company', can_respond: false } }))).not.toContain('data-new-request')
    const project = renderView({
      scope: { kind: 'project', can_respond: false }, today: '2026-09-29', title: 'Film', studio: {}, project: { name: 'Film' },
      client: null, workstreams: null, deliverables: [], work_log: [], schedule: null,
    }, { signedIn: false, canSwitch: false })
    expect(project).not.toContain('Requests')
    expect(project).not.toContain('data-request-form')
  })
})

describe('the portal: waiting on you', () => {
  const stills = over => ({
    id: 'd2', title: 'Stills', format: null, due: 'No date', status: 'waiting_on_you', status_label: 'Waiting on you',
    waiting_for: 'Ship date for the new product', reply: null, can_reply: true, rounds: [], ...over,
  })
  const withStills = d => view({ workstreams: [{ id: 'w1', title: 'Launch', brief: null, status: 'active', status_label: 'Active', deliverables: [d] }] })

  it('says what we need, under its own heading, and offers a reply', () => {
    const out = html(withStills(stills()))
    expect(out).toContain('What we need from you</h4>')
    expect(out).toContain('Ship date for the new product')
    expect(out).toContain('data-reply-open="d2"')
    expect(out).toContain('data-reply-form="d2"')
    expect(out).toContain('Reply to us')
  })
  it('shows the note they sent last and offers another', () => {
    const out = html(withStills(stills({ reply: { text: 'It shipped on Friday', at: '2026-09-25T09:00:00Z' } })))
    expect(out).toContain('“It shipped on Friday”')
    expect(out).toContain('Your note, 25 Sep')
    expect(out).toContain('Send another note')
  })
  it('still asks, without a form, when viewing as the client', () => {
    const out = html(withStills(stills({ can_reply: false })))
    expect(out).toContain('What we need from you')
    expect(out).not.toContain('data-reply-form')
  })
  it('says something useful when we never wrote down what we need', () => {
    expect(html(withStills(stills({ waiting_for: null })))).toContain('We’re waiting on something from you')
  })
  it('escapes what was written on either side', () => {
    const evil = '<script>alert(1)</script>'
    const out = html(withStills(stills({ waiting_for: evil, reply: { text: evil, at: null } })))
    expect(out).not.toContain('<script>')
  })
  it('shows nothing of the kind for an item that is not waiting', () => {
    const out = html(withStills(stills({ status: 'in_progress', status_label: 'In progress', waiting_for: null, can_reply: false })))
    expect(out).not.toContain('What we need from you')
  })
})
