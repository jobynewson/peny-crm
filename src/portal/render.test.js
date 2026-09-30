import { describe, it, expect } from 'vitest'
import { renderView, approveHtml, portalColumns } from './render.js'

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

  it('keeps every request in view, waiting ones first and answered ones under their own heading, nothing folded', () => {
    const mk = (i, status = 'submitted') => ({ id: `q${i}`, title: `Ask ${i}`, detail: null, wanted_by: null, status, status_label: status, sent_at: '2026-09-28T10:00:00Z', sent_by: null, note: null, accepted: null })
    const out = html(view({ requests: [...Array.from({ length: 7 }, (_, i) => mk(i)), mk(8, 'declined'), mk(9, 'accepted')] }))
    expect(out).not.toContain('Earlier requests')
    expect(out).not.toContain('Answered requests')
    for (let i = 0; i < 10; i++) if (i !== 7) expect(out).toContain(`Ask ${i}`)
    expect(out).toContain('>Answered<')
    expect(out.indexOf('>Answered<')).toBeLessThan(out.indexOf('Ask 8'))
    expect(out.indexOf('Ask 6')).toBeLessThan(out.indexOf('>Answered<'))
    const left = out.slice(out.indexOf('id="pt-col-requests"'), out.indexOf('id="pt-col-progress"'))
    expect(left).not.toContain('<details')                       // the left column has no folds
  })

  it('can\'t ask while viewing as the client, nor on a link that says it is not taking requests', () => {
    expect(html(view({ scope: { kind: 'company', can_respond: false } }))).not.toContain('data-new-request')
    const project = renderView({
      scope: { kind: 'project', can_respond: false }, today: '2026-09-29', title: 'Film', studio: {}, project: { name: 'Film' },
      client: null, workstreams: [], work_log: [], schedule: null,
    }, { signedIn: false, canSwitch: false })
    expect(project).not.toContain('data-new-request')
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

import fs from 'node:fs'
import { approveHtml } from './render.js'

describe('the Approve link\'s confirm page', () => {
  const link = over => ({
    scope: { kind: 'delivery', can_respond: true, approve_only: true }, studio: { name: 'Peny' }, company: 'DMM',
    title: 'October reel', deliverable_id: '11111111-1111-4111-8111-111111111111', round: 2, url: 'https://f.io/abc',
    frame_io: true, note: 'Colour fixed', preview: null, state: 'open', can_approve: true, ...over,
  })

  it('asks first: an Approve button, and a way to ask for changes on the same page', () => {
    const out = approveHtml(link())
    expect(out).toContain('Approve this?')
    expect(out).toContain('data-approve-now')
    expect(out).toContain('Yes, approve round 2')
    expect(out).toContain('data-open-changes')
    expect(out).toContain('Ask for changes instead')
    expect(out).toContain('data-changes-now')
    expect(out).toContain('Nothing is approved until you press the button')
    expect(out).toContain('Watch it in Frame.io')
  })

  it('opens with the box for changes showing when the email\'s "Request changes" brought them here', () => {
    const out = approveHtml(link(), { openChanges: true })
    expect(out).toMatch(/data-approve-actions hidden/)
    expect(out).not.toMatch(/data-changes-now hidden/)
  })

  it('thanks them for their changes, and for someone with no login offers no portal to open', () => {
    const out = approveHtml(link({ can_sign_in: true }), { changed: true })
    expect(out).toContain('we’ve got your changes')
    expect(out).toContain('Open the portal')
    for (const page of [approveHtml(link({ can_sign_in: false }), { changed: true }), approveHtml(link({ can_sign_in: false }), { done: true }), approveHtml(link({ can_sign_in: false, state: 'answered', can_approve: false }))]) {
      expect(page).not.toContain('Open the portal')
    }
    expect(approveHtml(link({ can_sign_in: false }))).toContain('there is nothing to sign in to')
  })

  it('says how things stand when it can no longer be approved', () => {
    expect(approveHtml(link({ state: 'approved', can_approve: false }))).toContain('Already approved')
    expect(approveHtml(link({ state: 'superseded', can_approve: false }))).toContain('There’s a newer round')
    expect(approveHtml(link({ state: 'answered', can_approve: false }))).toContain('Already answered')
    for (const state of ['approved', 'superseded', 'answered']) {
      expect(approveHtml(link({ state, can_approve: false }))).not.toContain('data-approve-now')
    }
  })

  it('thanks them after approving, and says so on failure without offering the button', () => {
    expect(approveHtml(link({ state: 'approved' }), { done: true })).toContain('Approved — thank you')
    const failed = approveHtml(null, { failure: { title: 'This link has already been used', detail: 'It approves once.' } })
    expect(failed).toContain('This link has already been used')
    expect(failed).not.toContain('data-approve-now')
  })

  it('escapes what people typed', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const out = approveHtml(link({ title: evil, note: evil, company: evil }))
    expect(out).not.toContain('<img src=x')
  })

  it('never approves anything by opening the page: the only POST is inside the button\'s click handler', () => {
    const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8')
    const posts = [...source.matchAll(/api\('\/api\/client\/link\/approve'/g)]
    expect(posts).toHaveLength(1)
    const before = source.slice(0, posts[0].index)
    expect(before.lastIndexOf("addEventListener('click'")).toBeGreaterThan(before.lastIndexOf('async function showApprove'))
    // and the page's own load only reads
    const start = source.indexOf('async function showApprove')
    const load = source.slice(start, source.indexOf("addEventListener('click'", start))
    expect(load).toContain("api('/api/client/link')")
    expect(load).not.toContain("method: 'POST'")
  })
})

describe('the portal: requests through a project link', () => {
  const link = (over = {}) => ({
    scope: { kind: 'project', can_respond: false, can_request: true },
    today: '2026-09-29', title: 'Riverside shoot',
    project: { name: 'Riverside shoot', status: 'Post', brief: null, shoot_start: null, shoot_end: null, frame_io_link: null },
    client: null, studio: { name: 'Peny', website: null },
    workstreams: [], requests: [], work_log: [], schedule: null, ...over,
  })

  it('offers the form with a name field, because a link cannot say who is holding it', () => {
    const out = html(link())
    expect(out).toContain('data-new-request')
    expect(out).toContain('id="rq-name"')
    expect(out).toContain('Your name')
    expect(out).toContain('Ask here instead of emailing')
  })

  it('shows what has been sent through the link, with the name typed and our answer', () => {
    const out = html(link({ requests: [
      { id: 'q1', title: 'Cut-down', detail: null, wanted_by: null, status: 'submitted', status_label: 'Submitted', sent_at: '2026-09-28T10:00:00Z', sent_by: 'Sam <b>', note: null, accepted: null },
      { id: 'q2', title: 'Reshoot', detail: null, wanted_by: null, status: 'declined', status_label: 'Declined', sent_at: '2026-09-10T10:00:00Z', sent_by: 'Sam', note: 'Outside this project', accepted: null },
    ] }))
    expect(out).toContain('Cut-down')
    expect(out).toContain('Sam &lt;b&gt;')
    expect(out).toContain('Outside this project')
  })

  it('says so, without a form, once the project is delivered', () => {
    const out = html(link({ scope: { kind: 'project', can_respond: false, can_request: false } }))
    expect(out).not.toContain('data-request-form')
    expect(out).not.toContain('data-new-request')
    expect(out).toContain('has been delivered')
  })

  it('does not ask a signed-in client for a name', () => {
    expect(html(view())).not.toContain('id="rq-name"')
  })
})

describe('the portal: a deliverable marked delivered', () => {
  const d = over => ({ id: 'd1', title: 'Hero <film>', format: null, due: 'No date', status: 'delivered', status_label: 'Delivered', waiting_for: null, reply: null, can_reply: false, delivered: true, can_answer: true, rounds: [], ...over })
  const withD = x => html(view({ workstreams: [{ id: 'w1', title: 'Edits', brief: null, status: 'active', status_label: 'Active', deliverables: [x] }] }))

  it('shows Delivered with Approve and Request changes that act on the deliverable, no round needed', () => {
    const out = withD(d())
    expect(out).toContain('pt-chip--delivered')
    expect(out).toContain('data-approve="d1"')
    expect(out).toContain('data-changes="d1"')
    expect(out).toContain('data-kind="deliverable"')
    expect(out).toContain('Approve “Hero &lt;film&gt;”?')
  })
  it('shows no buttons when it cannot be answered (a round is out, it is approved, or someone is only looking)', () => {
    expect(withD(d({ can_answer: false }))).not.toContain('data-approve')
    expect(withD(d({ status: 'approved', status_label: 'Approved', can_answer: false }))).not.toContain('data-approve')
  })
})

describe('the portal: comments are in', () => {
  const round = over => ({ id: 'r1', round: 1, url: 'https://f.io/x', frame_io: true, note: null, sent_at: '2026-09-28T10:00:00Z', response: 'pending', response_label: 'Awaiting response', comment: null, answered_at: null, answered_by: null, recorded_by_studio: false, preview: null, latest: true, can_respond: true, can_undo: false, ...over })
  const withRound = r => html(view({ workstreams: [{ id: 'w1', title: 'Edits', brief: null, status: 'active', status_label: 'Active', deliverables: [{ id: 'd1', title: 'Reel', format: null, due: 'No date', status: 'ready_for_review', status_label: 'Ready for review', waiting_for: null, reply: null, can_reply: false, rounds: [r] }] }] }))

  it('offers three answers on a round, with a confirm before comments are sent', () => {
    const out = withRound(round())
    expect(out).toContain('data-comments="r1"')
    expect(out).toContain('data-approve="r1"')
    expect(out).toContain('data-changes="r1"')
    expect(out).toContain('data-comments-confirm="r1"')
    expect(out).toContain('data-comments-yes="r1"')
    expect(out).toContain('Frame.io')
  })
  it('after comments are in, says so and offers an undo only while it is allowed', () => {
    const done = round({ response: 'comments_in', response_label: 'Comments are in', can_respond: false, can_undo: true })
    const out = withRound(done)
    expect(out).toContain('Comments are in')
    expect(out).toContain('data-undo="r1"')
    expect(out).not.toContain('data-approve')
    expect(withRound({ ...done, can_undo: false })).not.toContain('data-undo')
  })
})

describe('the Approve link page: comments are in', () => {
  const link = over => ({
    scope: { kind: 'delivery', can_respond: true }, studio: { name: 'Peny' }, company: 'DMM', title: 'Reel', deliverable_id: 'd1', round: 2,
    url: 'https://f.io/x', frame_io: true, note: null, preview: null, state: 'open', can_approve: true, can_request_changes: true, can_say_comments_in: true, can_undo: false, can_sign_in: false, ...over,
  })
  it('has the three answers, and opens straight on the comments question from the email button', () => {
    const plain = approveHtml(link())
    expect(plain).toContain('data-approve-now')
    expect(plain).toContain('data-open-comments')
    expect(plain).toContain('data-open-changes')
    const direct = approveHtml(link(), { openComments: true })
    expect(direct).toContain('Are your comments in?')
    expect(direct).toMatch(/data-approve-actions hidden/)
    expect(direct).not.toMatch(/data-comments-now hidden/)
  })
  it('thanks them after, offers undo only when allowed, and never approves by itself', () => {
    expect(approveHtml(link({ state: 'comments_in', can_undo: true }), {})).toContain('data-undo-comments')
    expect(approveHtml(link({ state: 'comments_in', can_undo: false }), {})).not.toContain('data-undo-comments')
    const sent = approveHtml(link({ state: 'comments_in', can_undo: true }), { commentsSent: true })
    expect(sent).toContain('Thank you — we’ll take it from here')
    expect(sent).not.toContain('data-approve-now')
  })
})

describe('the portal board: Requests · In progress · Approved', () => {
  const d = (id, status, over = {}) => ({ id, title: `Item ${id}`, format: null, due: 'No date', status, status_label: status, waiting_for: null, reply: null, can_reply: false, rounds: [], ...over })
  const board = (ds, over = {}) => view({ workstreams: [{ id: 'w1', title: 'Launch <films>', brief: 'Brief text', status: 'active', status_label: 'Active', deliverables: ds }], ...over })

  it('places each status in its column, with the client\'s moves together', () => {
    const c = portalColumns(board([
      d('a', 'planned'), d('b', 'in_progress'), d('c', 'comments_received'), d('e', 'ready_for_review'),
      d('f', 'waiting_on_you'), d('g', 'delivered'), d('h', 'approved'),
    ]))
    expect(c.planned.map(x => x.id)).toEqual(['a'])
    expect(c.progress.map(x => x.id)).toEqual(['b', 'c'])
    expect(c.needs.map(x => x.id)).toEqual(['e', 'f', 'g'])
    expect(c.approved.map(x => x.id)).toEqual(['h'])
    expect(c.needs[0].workstream).toBe('Launch <films>')
  })
  it('splits requests into what is waiting and what has been answered', () => {
    const c = portalColumns(board([], { requests: [{ id: 'q1', status: 'submitted' }, { id: 'q2', status: 'accepted' }, { id: 'q3', status: 'declined' }] }))
    expect(c.asked.map(r => r.id)).toEqual(['q1'])
    expect(c.answered.map(r => r.id)).toEqual(['q2', 'q3'])
  })
  it('draws three columns with what needs the client at the top of the middle one, marked', () => {
    const out = html(board([d('b', 'in_progress'), d('e', 'ready_for_review'), d('f', 'waiting_on_you'), d('g', 'delivered', { can_answer: true }), d('a', 'planned'), d('h', 'approved')]))
    expect(out).toContain('id="pt-col-requests"')
    expect(out).toContain('id="pt-col-progress"')
    expect(out).toContain('id="pt-col-approved"')
    expect(out.indexOf('pt-col--requests')).toBeLessThan(out.indexOf('pt-col--progress'))
    expect(out.indexOf('pt-col--progress')).toBeLessThan(out.indexOf('pt-col--approved'))
    const middle = out.slice(out.indexOf('id="pt-col-progress"'), out.indexOf('id="pt-col-approved"'))
    expect(middle).toContain('Needs you · 3')
    expect(middle.indexOf('Needs you · 3')).toBeLessThan(middle.indexOf('Item b'))
    expect(middle).toContain('Ready for your review')
    expect(middle).toContain('Waiting on you')
    expect(middle).toContain('Delivered — over to you')
    expect(middle).not.toContain('Item a')                      // not started: on the left
    expect(out.slice(out.indexOf('id="pt-col-requests"'), out.indexOf('id="pt-col-progress"'))).toContain('Item a')
    expect(out.slice(out.indexOf('id="pt-col-approved"'))).toContain('Item h')
  })
  it('leads with a summary and jump links that say how many need them', () => {
    const out = html(board([d('e', 'ready_for_review'), d('f', 'waiting_on_you'), d('b', 'in_progress')]))
    expect(out).toContain('1 thing ready for your review · 1 waiting on you')
    expect(out).toContain('pt-jump-link pt-jump-link--alert')
    expect(html(board([d('b', 'in_progress')]))).toContain('Nothing needs you right now.')
  })
  it('keeps the approved column quiet: title, where and when, folded past six, and no buttons', () => {
    const ds = Array.from({ length: 8 }, (_, i) => d(`x${i}`, 'approved', { rounds: [{ response: 'approved', answered_at: '2026-09-20T10:00:00Z' }] }))
    const out = html(board(ds))
    const col = out.slice(out.indexOf('id="pt-col-approved"'))
    expect(col).toContain('Approved 20 Sep')
    expect(col).toContain('Earlier (2)')
    expect(col).not.toContain('data-approve')
    expect(col).toContain('data-collapse-mobile')
  })
  it('keeps every anchor an email can point at, and escapes the workstream name', () => {
    const out = html(board([d('e', 'ready_for_review'), d('h', 'approved'), d('a', 'planned')]))
    for (const id of ['e', 'h', 'a']) expect(out).toContain(`id="d-${id}"`)
    expect(out).toContain('Launch &lt;films&gt;')
    expect(out).not.toContain('Launch <films>')
  })
  it('uses the same board for a project link, with the log and schedule below it', () => {
    const out = renderView({
      scope: { kind: 'project', can_respond: false, can_request: true }, today: '2026-09-29', title: 'Film', studio: {}, project: { name: 'Film', status: 'Post' },
      client: null, workstreams: [{ id: 'w1', title: 'Edits', brief: null, status: 'active', status_label: 'Active', deliverables: [d('e', 'ready_for_review')] }],
      requests: [], work_log: [{ note: 'Graded', date: '2026-09-20', by: 'Ana' }], schedule: null,
    }, { signedIn: false, canSwitch: false })
    expect(out).toContain('pt-board')
    expect(out).toContain('Needs you · 1')
    expect(out.indexOf('pt-board')).toBeLessThan(out.indexOf('Work log'))
    expect(out).not.toContain('data-approve')                       // a link can look but not answer
  })
})

describe('the portal: round two', () => {
  const d = (id, status, over = {}) => ({ id, title: `Item ${id}`, format: null, due: 'No date', status, status_label: status, waiting_for: null, reply: null, can_reply: false, rounds: [], ...over })
  const wrap = (ds, over = {}) => view({ workstreams: [{ id: 'w1', title: 'Launch', brief: null, status: 'active', status_label: 'Active', deliverables: ds }], ...over })
  const round = over => ({ id: 'r1', round: 1, url: 'https://app.frame.io/reviews/abc', frame_io: true, note: null, sent_at: '2026-09-28T10:00:00Z', response: 'approved', response_label: 'Approved', comment: null, answered_at: '2026-09-29T10:00:00Z', answered_by: 'Dana', recorded_by_studio: false, preview: null, latest: true, can_respond: false, can_undo: false, ...over })

  it('keeps the link on an approved item, to the latest round, and the comment that came with the approval', () => {
    const out = html(wrap([d('h', 'approved', { rounds: [round({ url: 'https://f.io/old', response: 'changes_requested' }), round({ comment: 'Love it' })] })]))
    const col = out.slice(out.indexOf('id="pt-col-approved"'))
    expect(col).toContain('href="https://app.frame.io/reviews/abc"')
    expect(col).toContain('Open in Frame.io')
    expect(col).not.toContain('f.io/old')
    expect(col).toContain('“Love it”')
    expect(html(wrap([d('h', 'approved')]))).not.toContain('Open in Frame.io')                   // nothing to link to
    expect(html(wrap([d('h', 'approved', { rounds: [round({ frame_io: false })] })])).includes('Open the link')).toBe(true)
  })

  it('lets approval carry an optional comment, on a round and on a delivered deliverable', () => {
    const open = html(wrap([d('a', 'ready_for_review', { rounds: [round({ response: 'pending', response_label: 'Awaiting', can_respond: true, answered_at: null })] })]))
    expect(open).toContain('data-approve-comment="r1"')
    expect(open).toContain('maxlength="1000"')
    const delivered = html(wrap([d('g', 'delivered', { can_answer: true })]))
    expect(delivered).toContain('data-approve-comment="g"')
    expect(delivered).toContain('(optional)')
  })

  it('asks which project a request is for when there are several, and says nothing when there is one', () => {
    const several = html(view({ projects: [{ id: 'p1', name: 'Retainer' }, { id: 'p2', name: 'Shoot <b>' }] }))
    expect(several).toContain('id="rq-project"')
    expect(several).toContain('Which project is it for?')
    expect(several).toContain('Shoot &lt;b&gt;')
    expect(several.indexOf('value="p1"')).toBeLessThan(several.indexOf('value="p2"'))
    const one = html(view({ projects: [{ id: 'p1', name: 'Retainer' }] }))
    expect(one).toContain('type="hidden" id="rq-project" value="p1"')
    expect(one).not.toContain('Which project')
    const none = html(view({ projects: [] }))
    expect(none).not.toContain('rq-project')
  })

  it('names the project on a request that has one', () => {
    const out = html(view({ requests: [{ id: 'q1', title: 'Cut-down', detail: null, wanted_by: null, status: 'submitted', status_label: 'Submitted', sent_at: '2026-09-28T10:00:00Z', sent_by: 'Dana', project: 'Riverside', note: null, accepted: null }] }))
    expect(out).toContain('Sent 28 Sep by Dana · Riverside')
  })

  it('has the comment box on the emailed approve page too', () => {
    const link = { scope: { kind: 'delivery', can_respond: true }, studio: { name: 'Peny' }, company: 'DMM', title: 'Reel', deliverable_id: 'd1', round: 2, url: 'https://f.io/x', frame_io: true, note: null, preview: null, state: 'open', can_approve: true, can_sign_in: false }
    const out = approveHtml(link)
    expect(out).toContain('data-approve-comment')
    expect(out).toContain('data-approve-now')
  })
})
