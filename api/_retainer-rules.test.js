import { describe, it, expect } from 'vitest'
import {
  DELIVERABLE_STATUSES, clientStatus, statusPatch, statusAfterResponse, statusAfterUnsend, STATUS_AFTER_DELIVERY,
  validateResponse, normaliseDeliveryUrl, isFrameIoUrl, normaliseDue, dueDisplay, isOverdue,
  validateWorkstreamInput, validateDeliverableInput, touchesDue,
  requestLabel, validateRequestInput, validateDecline, validateReply, MAX_OPEN_REQUESTS,
  requestSourceLabel, worklistLink, validateSenderName, COMPANY_TYPES, companyTypeLabel, validateCompanyType, normalisePortalEmails,
  boardColumn, boardChip, isWithClient, statusAfterBoardDrag, DRAG_REFUSALS, BOARD_COLUMNS, validateAccept,
  boardShows, boardCard, compareBoardCards, BOARD_HORIZON_DAYS, owedList,
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
    expect(statusPatch({ from: 'waiting_on_client', to: 'in_progress', now })).toEqual({
      status: 'in_progress', waiting_since: null, waiting_note: null, client_reply: null, client_replied_at: null,
    })
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

describe('client requests', () => {
  it('reads as Submitted, Accepted or Declined, never "new"', () => {
    expect(['new', 'accepted', 'declined'].map(requestLabel)).toEqual(['Submitted', 'Accepted', 'Declined'])
  })
  it('needs a title; detail and date are optional', () => {
    expect(validateRequestInput({ title: '  ' })).toMatchObject({ field: 'title' })
    expect(validateRequestInput({ title: 'Cut-down of the launch film' })).toBeNull()
    expect(validateRequestInput({ title: 'x', wanted_by: '2026-13-01' })).toMatchObject({ field: 'wanted_by' })
    expect(validateRequestInput({ title: 'x', wanted_by: '2026-10-30', detail: 'https://example.com/brief' })).toBeNull()
    expect(validateRequestInput({ title: 'x', detail: 'y'.repeat(6000) })).toMatchObject({ field: 'detail' })
    expect(MAX_OPEN_REQUESTS).toBeGreaterThan(0)
  })
  it('a decline needs a note, because the client reads it', () => {
    expect(validateDecline({})).toMatchObject({ field: 'note' })
    expect(validateDecline({ note: 'Outside this retainer — we will quote separately.' })).toBeNull()
  })
  it('a reply is short and not empty', () => {
    expect(validateReply({ reply: ' ' })).toMatchObject({ field: 'reply' })
    expect(validateReply({ reply: 'The product shipped on Friday.' })).toBeNull()
    expect(validateReply({ reply: 'x'.repeat(1001) })).toMatchObject({ field: 'reply' })
  })
})

describe('the task board mapping', () => {
  it('puts every status in a column', () => {
    expect(Object.fromEntries(DELIVERABLE_STATUSES.map(s => [s, boardColumn(s)]))).toEqual({
      planned: 'todo', in_progress: 'doing', waiting_on_client: 'doing',
      in_review: 'doing', changes_requested: 'doing', approved: 'done',
    })
  })
  it('mutes the cards that are with the client', () => {
    expect(DELIVERABLE_STATUSES.filter(isWithClient)).toEqual(['waiting_on_client', 'in_review'])
  })
  it('chips say where a card in Doing really is', () => {
    const now = new Date('2026-09-28T12:00:00Z')
    expect(boardChip({ status: 'planned' }, now)).toBeNull()
    expect(boardChip({ status: 'in_progress' }, now)).toBeNull()
    expect(boardChip({ status: 'changes_requested' }, now).label).toBe('Changes requested')
    expect(boardChip({ status: 'waiting_on_client', waiting_since: '2026-09-25T09:00:00Z' }, now).label).toBe('Waiting on client · 3d')
    expect(boardChip({ status: 'in_review', round: 2 }, now).label).toBe('With client · round 2')
  })
  it('a drag moves planned <-> in_progress and nothing else', () => {
    expect(statusAfterBoardDrag({ from: 'planned', column: 'doing' })).toEqual({ status: 'in_progress' })
    expect(statusAfterBoardDrag({ from: 'in_progress', column: 'todo' })).toEqual({ status: 'planned' })
    // dropped where it already is: nothing to do, and no complaint
    for (const s of DELIVERABLE_STATUSES) expect(statusAfterBoardDrag({ from: s, column: boardColumn(s) })).toEqual({ status: s })
  })
  it('refuses every other move, saying what to do instead', () => {
    const cases = [
      ['planned', 'done', 'approve'], ['in_progress', 'done', 'approve'], ['in_review', 'done', 'approve'],
      ['waiting_on_client', 'done', 'approve'], ['changes_requested', 'done', 'approve'],
      ['in_review', 'todo', 'with_client'], ['waiting_on_client', 'todo', 'with_client'],
      ['changes_requested', 'todo', 'changes'],
      ['approved', 'todo', 'approved'], ['approved', 'doing', 'approved'],
    ]
    for (const [from, column, code] of cases) {
      const r = statusAfterBoardDrag({ from, column })
      expect(r.status, `${from} → ${column}`).toBeUndefined()
      expect(r.refused).toBe(DRAG_REFUSALS[code])
    }
  })
  it('the refusals point at the project’s Worklist tab, and are one phone-sized line', () => {
    for (const msg of Object.values(DRAG_REFUSALS)) {
      expect(msg).toMatch(/Worklist tab|until they answer|until you send/)
      expect(msg.length).toBeLessThan(120)
    }
  })
  it('an unknown column is refused, not written', () => {
    expect(statusAfterBoardDrag({ from: 'planned', column: 'nope' }).status).toBeUndefined()
    expect(BOARD_COLUMNS).toEqual(['todo', 'doing', 'done'])
  })
})

describe('accepting a request', () => {
  const users = ['11111111-1111-4111-8111-111111111111']
  const ws = '22222222-2222-4222-8222-222222222222'
  const ok = { workstream_id: ws, owner_id: users[0], due_date: '2026-10-09' }

  it('takes an existing workstream or a new one, an owner and a date', () => {
    expect(validateAccept(ok, { userIds: users })).toBeNull()
    expect(validateAccept({ ...ok, workstream_id: undefined, new_workstream_title: 'Launch extras' }, { userIds: users })).toBeNull()
    expect(validateAccept({ ...ok, title: 'A better title' }, { userIds: users })).toBeNull()
  })
  it('never lets one sit ownerless or undated', () => {
    expect(validateAccept({ ...ok, owner_id: null }, { userIds: users })).toMatchObject({ field: 'owner_id' })
    expect(validateAccept({ ...ok, owner_id: '33333333-3333-4333-8333-333333333333' }, { userIds: users })).toMatchObject({ field: 'owner_id' })
    expect(validateAccept({ ...ok, due_date: null }, { userIds: users })).toMatchObject({ field: 'due_date' })
    expect(validateAccept({ ...ok, due_date: '2026-02-30' }, { userIds: users })).toMatchObject({ field: 'due_date' })
  })
  it('needs somewhere to put it, and not two places', () => {
    expect(validateAccept({ ...ok, workstream_id: null }, { userIds: users })).toMatchObject({ field: 'workstream_id' })
    expect(validateAccept({ ...ok, workstream_id: 'nope' }, { userIds: users })).toMatchObject({ field: 'workstream_id' })
    expect(validateAccept({ ...ok, new_workstream_title: 'Both' }, { userIds: users })).toMatchObject({ field: 'workstream_id' })
    expect(validateAccept({ ...ok, workstream_id: null, new_workstream_title: '   ' }, { userIds: users })).toMatchObject({ field: 'workstream_id' })
  })
})

describe('which deliverables have a board card', () => {
  const today = '2026-09-29'
  const d = over => ({ id: 'd', title: 'Reel', status: 'planned', owner_id: 'u1', due_kind: 'exact', due_date: '2026-10-05', company: 'DMM', company_id: 'c1', workstream: 'Monthly', ...over })

  it('shows everything that is started', () => {
    for (const status of ['in_progress', 'waiting_on_client', 'in_review', 'changes_requested']) {
      expect(boardShows(d({ status, due_date: '2027-01-01' }), today), status).toBe(true)
    }
  })
  it('shows an owned, planned deliverable once it is within the window, or has no date at all', () => {
    expect(boardShows(d({ due_date: '2026-10-29' }), today)).toBe(true)     // day 30
    expect(boardShows(d({ due_date: '2026-10-30' }), today)).toBe(false)    // day 31: a dated plan
    expect(boardShows(d({ due_date: '2026-10-06' }), today, 7)).toBe(true)  // day 7
    expect(boardShows(d({ due_date: '2026-10-07' }), today, 7)).toBe(false)
    expect(boardShows(d({ due_date: '2026-11-27' }), today, 60)).toBe(true) // day 59
    expect(boardShows(d({ due_date: null }), today)).toBe(true)             // nothing else would show it
    expect(boardShows(d({ due_date: '2026-09-01' }), today)).toBe(true)     // late
    expect(BOARD_HORIZON_DAYS).toBe(30)
  })
  it('puts every unowned open deliverable in the tray, whatever its date or status', () => {
    for (const due_date of [null, '2026-10-05', '2028-01-01']) {
      for (const status of ['planned', 'in_progress', 'in_review', 'waiting_on_client', 'changes_requested']) {
        expect(boardShows(d({ owner_id: null, due_date, status }), today), `${status} ${due_date}`).toBe(true)
        expect(boardCard(d({ owner_id: null, due_date, status }), today).in_tray).toBe(true)
      }
    }
  })
  it('an unowned one in a paused or complete workstream is still in the tray; an owned one is parked', () => {
    for (const workstream_status of ['paused', 'complete']) {
      expect(boardShows(d({ owner_id: null, workstream_status }), today)).toBe(true)
      expect(boardCard(d({ owner_id: null, workstream_status }), today).in_tray).toBe(true)
      expect(boardShows(d({ workstream_status, status: 'in_progress' }), today)).toBe(false)
    }
  })
  it('an approved one is a card only if someone owns it, and is not in the tray', () => {
    expect(boardShows(d({ status: 'approved' }), today)).toBe(true)
    expect(boardShows(d({ status: 'approved', owner_id: null }), today)).toBe(false)
    expect(boardCard(d({ status: 'approved' }), today).in_tray).toBe(false)
  })
  it('nothing is invisible: every open deliverable is on the board, or dated, owned and further out than four weeks', () => {
    const rows = []
    for (const owner_id of [null, 'u1']) for (const status of DELIVERABLE_STATUSES.filter(s => s !== 'approved')) {
      for (const due_date of [null, '2026-09-01', '2026-10-05', '2026-11-30']) rows.push(d({ owner_id, status, due_date }))
    }
    for (const r of rows.filter(r => !boardShows(r, today))) {
      expect([r.owner_id, r.status, !!r.due_date, r.due_date > '2026-10-29']).toEqual(['u1', 'planned', true, true])
    }
  })
  it('the card carries the column, muting, chip, due text and a link to the deliverable on its project’s Worklist tab', () => {
    const c = boardCard(d({ status: 'in_review', round: 2, due_date: '2026-09-27' }), today)
    expect(c).toMatchObject({
      kind: 'deliverable', column: 'doing', muted: true, chip: { label: 'With client · round 2' },
      overdue: true, days_late: 2, link: '#retainers/c1', company: 'DMM', workstream: 'Monthly', in_tray: false,
    })
    expect(boardCard(d({ project_id: 'p1', project: 'Retainer' }), today)).toMatchObject({ link: '#projects/p1/worklist/d', project: 'Retainer', project_id: 'p1' })
    expect(boardCard(d({ due_date: null }), today)).toMatchObject({ undated: true, due_display: 'No date', overdue: false, days_late: null })
  })
  it('sorts by deadline with undated last', () => {
    const cards = [d({ id: 'c', title: 'C', due_date: null }), d({ id: 'b', title: 'B', due_date: '2026-10-05' }), d({ id: 'a', title: 'A', due_date: '2026-09-01' })]
      .map(x => boardCard(x, today)).sort(compareBoardCards)
    expect(cards.map(c => c.id)).toEqual(['a', 'b', 'c'])
  })
})


describe('request sources', () => {
  it('names where a request came from', () => {
    expect(requestSourceLabel('link')).toBe('Sent via project link')
    expect(requestSourceLabel('login')).toBe('Signed in')
    expect(requestSourceLabel('nonsense')).toBe('Signed in')
  })
  it('needs a name from someone using a project link', () => {
    expect(validateSenderName({})).toMatchObject({ field: 'name' })
    expect(validateSenderName({ name: '   ' })).toMatchObject({ field: 'name' })
    expect(validateSenderName({ name: 'x'.repeat(101) })).toMatchObject({ field: 'name' })
    expect(validateSenderName({ name: ' Sam  Lee ' })).toBeNull()
  })
})

describe('company types', () => {
  it('offers the agreed list', () => {
    expect(COMPANY_TYPES).toEqual(['client', 'prospect', 'subcontractor', 'supplier', 'other'])
    expect(companyTypeLabel('subcontractor')).toBe('Subcontractor')
    expect(companyTypeLabel('x')).toBe('Other')
  })
  it('refuses a type outside the list and an over-long sector', () => {
    expect(validateCompanyType({ type: 'brand' })).toMatchObject({ field: 'type' })
    expect(validateCompanyType({ type: 'client', sector: 'x'.repeat(61) })).toMatchObject({ field: 'sector' })
    expect(validateCompanyType({ type: 'client', sector: 'Sport' })).toBeNull()
    expect(validateCompanyType({ type: 'supplier' })).toBeNull()
  })
})

describe('portal emails', () => {
  it('lower-cases, trims, drops blanks and duplicates', () => {
    expect(normalisePortalEmails([' A@x.com ', 'a@X.com', '', 'b@y.org'])).toEqual({ emails: ['a@x.com', 'b@y.org'] })
  })
  it('refuses a non-list, a bad address and too many', () => {
    expect(normalisePortalEmails('a@x.com').error.field).toBe('portal_emails')
    expect(normalisePortalEmails(['nope']).error.message).toContain('nope')
    expect(normalisePortalEmails(Array.from({ length: 11 }, (_, i) => `p${i}@x.com`)).error.message).toContain('Up to 10')
  })
})

describe('where a deliverable lives', () => {
  it('is its project\'s Worklist tab with the deliverable open', () => {
    expect(worklistLink({ project_id: 'p1', company_id: 'c1', id: 'd9' })).toBe('#projects/p1/worklist/d9')
    expect(worklistLink({ project_id: 'p1' })).toBe('#projects/p1/worklist')
  })
  it('falls back to the company\'s old address (the app redirects it), then to Projects', () => {
    expect(worklistLink({ company_id: 'c1', id: 'd9' })).toBe('#retainers/c1')
    expect(worklistLink({})).toBe('#projects')
  })
})

describe('a project\'s Owed list', () => {
  const today = '2026-09-30'
  const row = over => ({ id: 'x', title: 'Reel', status: 'planned', owner_id: 'u1', owner_name: 'Ana', due_kind: 'exact', due_date: '2026-10-05', workstream: 'Edits', project_id: 'p1', ...over })

  it('puts overdue first, then by date, undated last, and stops at five', () => {
    const rows = [
      row({ id: 'a', title: 'Undated', due_date: null }),
      row({ id: 'b', title: 'Later', due_date: '2026-10-20' }),
      row({ id: 'c', title: 'Late', due_date: '2026-09-20' }),
      row({ id: 'd', title: 'Soon', due_date: '2026-10-02' }),
      row({ id: 'e', title: 'Also soon', due_date: '2026-10-03' }),
      row({ id: 'f', title: 'Sixth', due_date: '2026-10-25' }),
    ]
    const o = owedList(rows, today)
    expect(o.items.map(i => i.title)).toEqual(['Late', 'Soon', 'Also soon', 'Later', 'Sixth'])
    expect(o).toMatchObject({ total: 6, later: 0, overdue: 1 })
    expect(owedList(rows, today, 30, { limit: 10 }).items.at(-1).title).toBe('Undated')
  })
  it('leaves out dated work beyond the window but counts it, and always keeps overdue and undated', () => {
    const rows = [row({ id: 'a', due_date: '2026-12-01' }), row({ id: 'b', due_date: null }), row({ id: 'c', due_date: '2026-08-01' })]
    const o = owedList(rows, today, 7)
    expect(o.items.map(i => i.id)).toEqual(['c', 'b'])
    expect(o).toMatchObject({ total: 3, later: 1, days: 7 })
    expect(owedList(rows, today, 60).later).toBe(1)   // 2 Dec is day 62
    expect(owedList([row({ due_date: '2026-11-29' })], today, 60).later).toBe(0)
  })
  it('keeps waiting-on-client work in, muted and with its chip, and drops approved', () => {
    const o = owedList([row({ id: 'w', status: 'waiting_on_client' }), row({ id: 'r', status: 'in_review', round: 2 }), row({ id: 'ok', status: 'approved' })], today)
    expect(o.items.map(i => i.id).sort()).toEqual(['r', 'w'])
    expect(o.items.find(i => i.id === 'w')).toMatchObject({ muted: true, chip: { key: 'waiting_on_client' } })
    expect(o).toMatchObject({ total: 2, waiting: 1 })
  })
  it('links each row to its deliverable on the project\'s Worklist tab', () => {
    expect(owedList([row({ id: 'd9' })], today).items[0].link).toBe('#projects/p1/worklist/d9')
  })
})
