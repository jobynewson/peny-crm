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
