import { describe, it, expect } from 'vitest'
import {
  DELIVERABLE_STATUSES, clientStatus, statusPatch, statusAfterResponse, statusAfterUnsend, STATUS_AFTER_DELIVERY,
  validateResponse, normaliseDeliveryUrl, isFrameIoUrl, normaliseDue, dueDisplay, isOverdue,
  validateWorkstreamInput, validateDeliverableInput, touchesDue,
} from './_retainer-rules.js'

const today = '2026-09-28'

describe('client-facing statuses', () => {
  it('maps every internal status onto the five client labels', () => {
    const labels = DELIVERABLE_STATUSES.map(s => clientStatus(s).label)
    expect(labels).toEqual(['Planned', 'In progress', 'Waiting on you', 'Ready for review', 'In progress', 'Approved'])
    expect(new Set(labels).size).toBe(5)
  })
  it('never exposes "changes requested" to the client', () => {
    expect(clientStatus('changes_requested')).toEqual({ key: 'in_progress', label: 'In progress' })
    for (const s of DELIVERABLE_STATUSES) expect(clientStatus(s).key).not.toMatch(/changes/)
  })
})

describe('statusPatch (the waiting clock)', () => {
  const now = new Date('2026-09-28T10:00:00Z')
  it('starts the clock on entering waiting_on_client', () => {
    expect(statusPatch({ from: 'in_progress', to: 'waiting_on_client', now })).toEqual({ status: 'waiting_on_client', waiting_since: now })
  })
  it('clears the clock and the note on leaving it', () => {
    expect(statusPatch({ from: 'waiting_on_client', to: 'in_progress', now })).toEqual({ status: 'in_progress', waiting_since: null, waiting_note: null })
  })
  it('leaves the clock alone when nothing changes', () => {
    expect(statusPatch({ from: 'waiting_on_client', to: 'waiting_on_client', now })).toEqual({ status: 'waiting_on_client' })
    expect(statusPatch({ from: 'planned', to: 'in_progress', now })).toEqual({ status: 'in_progress' })
  })
})

describe('deliveries and responses', () => {
  it('a new round puts the deliverable in review', () => {
    expect(STATUS_AFTER_DELIVERY).toBe('in_review')
  })
  it('taking back a round returns to where the previous round left it', () => {
    expect(statusAfterUnsend({ current: 'in_review' })).toBe('in_progress')
    expect(statusAfterUnsend({ current: 'in_review', previousResponse: 'changes_requested' })).toBe('changes_requested')
    expect(statusAfterUnsend({ current: 'in_review', previousResponse: 'approved' })).toBe('approved')
    expect(statusAfterUnsend({ current: 'in_review', previousResponse: 'pending' })).toBe('in_review')
    // someone moved it on since: that stands
    expect(statusAfterUnsend({ current: 'waiting_on_client', previousResponse: 'approved' })).toBe('waiting_on_client')
  })
  it('a response moves the deliverable', () => {
    expect(statusAfterResponse('approved')).toBe('approved')
    expect(statusAfterResponse('changes_requested')).toBe('changes_requested')
  })
  it('requesting changes needs a comment; approving does not', () => {
    expect(validateResponse({ response: 'approved' })).toBe(null)
    expect(validateResponse({ response: 'changes_requested', comment: '  ' }).field).toBe('comment')
    expect(validateResponse({ response: 'changes_requested', comment: 'Trim the intro' })).toBe(null)
    expect(validateResponse({ response: 'pending' }).field).toBe('response')
    expect(validateResponse(null).field).toBe('response')
  })
})

describe('delivery URLs', () => {
  it('accepts http(s) links and tidies them', () => {
    expect(normaliseDeliveryUrl('  https://f.io/AbC123 ')).toEqual({ url: 'https://f.io/AbC123' })
    expect(normaliseDeliveryUrl('https://next.frame.io/share/x/view/y').url).toBe('https://next.frame.io/share/x/view/y')
  })
  it('refuses anything that could run in the portal', () => {
    expect(normaliseDeliveryUrl('javascript:alert(1)').error.field).toBe('url')
    expect(normaliseDeliveryUrl('data:text/html,hi').error.field).toBe('url')
    expect(normaliseDeliveryUrl('not a link').error.field).toBe('url')
    expect(normaliseDeliveryUrl('').error.field).toBe('url')
  })
  it('recognises Frame.io hosts', () => {
    expect(isFrameIoUrl('https://f.io/abc')).toBe(true)
    expect(isFrameIoUrl('https://app.frame.io/reviews/x')).toBe(true)
    expect(isFrameIoUrl('https://notframe.io.example.com/x')).toBe(false)
    expect(isFrameIoUrl('https://vimeo.com/1')).toBe(false)
  })
})

describe('normaliseDue', () => {
  it('exact: the day, or no date yet', () => {
    expect(normaliseDue({ due_kind: 'exact', due_date: '2026-10-03' })).toEqual({ due_kind: 'exact', due_date: '2026-10-03', due_label: null, cadence: null })
    expect(normaliseDue({ due_kind: 'exact' }).due_date).toBe(null)
    expect(normaliseDue({ due_kind: 'exact', due_date: '2026-02-30' }).error.field).toBe('due_date')
  })
  it('month: stores the last day of the month', () => {
    expect(normaliseDue({ due_kind: 'month', due_month: '2026-11' }).due_date).toBe('2026-11-30')
    expect(normaliseDue({ due_kind: 'month', due_date: '2026-10-09' }).due_date).toBe('2026-10-31')
    expect(normaliseDue({ due_kind: 'month' }).error.field).toBe('due_month')
  })
  it('window: needs its last day and keeps the words', () => {
    expect(normaliseDue({ due_kind: 'window', due_date: '2026-11-07', due_label: '1st week of November' }))
      .toEqual({ due_kind: 'window', due_date: '2026-11-07', due_label: '1st week of November', cadence: null })
    expect(normaliseDue({ due_kind: 'window', due_label: 'early Nov' }).error.field).toBe('due_date')
  })
  it('recurring: needs a cadence; the next date is optional', () => {
    expect(normaliseDue({ due_kind: 'recurring', cadence: 'monthly' })).toEqual({ due_kind: 'recurring', due_date: null, due_label: null, cadence: 'monthly' })
    expect(normaliseDue({ due_kind: 'recurring' }).error.field).toBe('cadence')
    expect(normaliseDue({ due_kind: 'recurring', cadence: 'daily' }).error.field).toBe('cadence')
  })
  it('drops a cadence left over from another kind, and rejects unknown kinds', () => {
    expect(normaliseDue({ due_kind: 'exact', due_date: '2026-10-03', cadence: 'weekly' }).cadence).toBe(null)
    expect(normaliseDue({ due_kind: 'soon' }).error.field).toBe('due_kind')
  })
})

describe('dueDisplay', () => {
  const d = (o) => ({ due_kind: 'exact', due_date: null, due_label: null, cadence: null, ...o })
  it('reads each kind', () => {
    expect(dueDisplay(d({ due_date: '2026-10-02' }), today)).toBe('Fri 2 Oct')
    expect(dueDisplay(d({}), today)).toBe('No date')
    expect(dueDisplay(d({ due_kind: 'month', due_date: '2026-10-31' }), today)).toBe('October')
    expect(dueDisplay(d({ due_kind: 'window', due_date: '2026-11-07' }), today)).toBe('By 7 Nov')
    expect(dueDisplay(d({ due_kind: 'recurring', cadence: 'monthly' }), today)).toBe('Monthly')
    expect(dueDisplay(d({ due_kind: 'recurring', cadence: 'weekly', due_date: '2026-10-05' }), today)).toBe('Weekly · next 5 Oct')
  })
  it('prefers the words someone used', () => {
    expect(dueDisplay(d({ due_kind: 'window', due_date: '2026-11-07', due_label: '1st week of November' }), today)).toBe('1st week of November')
  })
})

describe('isOverdue', () => {
  it('is past the deadline and not approved', () => {
    expect(isOverdue({ status: 'in_progress', due_date: '2026-09-27' }, today)).toBe(true)
    expect(isOverdue({ status: 'in_progress', due_date: today }, today)).toBe(false)
    expect(isOverdue({ status: 'approved', due_date: '2026-09-01' }, today)).toBe(false)
    expect(isOverdue({ status: 'planned', due_date: null }, today)).toBe(false)
  })
  it('a month item is only overdue once the month is over', () => {
    expect(isOverdue({ status: 'planned', due_date: '2026-09-30' }, today)).toBe(false)
  })
})

describe('input validation', () => {
  const USER = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
  it('workstreams need a title', () => {
    expect(validateWorkstreamInput({ title: 'Launch films' })).toBe(null)
    expect(validateWorkstreamInput({ title: ' ' }).field).toBe('title')
    expect(validateWorkstreamInput({ status: 'active' }, { partial: true })).toBe(null)
    expect(validateWorkstreamInput({ status: 'done' }, { partial: true }).field).toBe('status')
  })
  it('deliverables check owner, status and visibility', () => {
    expect(validateDeliverableInput({ title: 'Hero film', owner_id: USER }, { userIds: [USER] })).toBe(null)
    expect(validateDeliverableInput({ title: 'Hero film', owner_id: 'nobody' }, { userIds: [USER] }).field).toBe('owner_id')
    expect(validateDeliverableInput({ status: 'shipped' }, { partial: true }).field).toBe('status')
    expect(validateDeliverableInput({ client_visible: 'yes' }, { partial: true }).field).toBe('client_visible')
    expect(validateDeliverableInput({ owner_id: null }, { partial: true })).toBe(null)
  })
  it('knows when a patch touches the due date', () => {
    expect(touchesDue({ status: 'approved' })).toBe(false)
    expect(touchesDue({ due_label: '' })).toBe(true)
  })
})
