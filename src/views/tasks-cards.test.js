import { describe, it, expect } from 'vitest'

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
import { vi } from 'vitest'
vi.mock('../api/http.js', () => ({ request: async () => ({}), qs: () => '' }))
const { TasksView, unassignedLabel } = await import('./tasks.js')

const app = { appUser: { id: 'me' }, allUsers: [{ id: 'me', name: 'Ana Lee' }, { id: 'u2', name: 'Ben' }], projects: [{ id: 'p1', name: 'Film' }] }
const card = over => ({
  id: 'd1', kind: 'deliverable', title: 'October reel', company: 'DMM', company_id: 'c1', workstream: 'Monthly', project_id: null,
  owner_id: 'me', unassigned: false, unassigned_since: null, status: 'in_progress', column: 'doing', muted: false, chip: null, due_date: '2026-10-05',
  due_display: 'Mon 5 Oct', undated: false, overdue: false, days_late: null, link: '#retainers/c1', ...over,
})
const view = cards => { const v = new TasksView(app); v.cards = cards; return v }

describe('deliverable cards on the board', () => {
  it('sit in their column above tasks, unowned ones too, and count in the header numbers', () => {
    const v = view([card(), card({ id: 'd2', column: 'todo', status: 'planned' }), card({ id: 'd3', owner_id: null, unassigned: true, column: 'todo', status: 'planned' })])
    expect(v.columnCards('doing').map(c => c.id)).toEqual(['d1'])
    expect(v.columnCards('todo').map(c => c.id)).toEqual(['d2', 'd3'])
  })
  it('say Unassigned, for how long, with Assign to me, when nobody owns one', () => {
    const v = view([])
    const html = v._deliverableCardHtml(card({ owner_id: null, unassigned: true, unassigned_since: new Date(Date.now() - 3 * 86400000).toISOString() }))
    expect(html).toContain('tk-card--unassigned')
    expect(html).toContain('Unassigned · 3d')
    expect(html).toContain('data-take-card="d1"')
    expect(v._deliverableCardHtml(card())).not.toContain('data-take-card')
  })
  it('obey the filters by owner and project', () => {
    const v = view([card(), card({ id: 'd2', owner_id: 'u2', project_id: 'p1' })])
    v.filters = { mine: true, person: '', project: '' }
    expect(v.visibleCards().map(c => c.id)).toEqual(['d1'])
    v.filters = { mine: false, person: 'u2', project: '' }
    expect(v.visibleCards().map(c => c.id)).toEqual(['d2'])
    v.filters = { mine: false, person: '', project: 'p1' }
    expect(v.visibleCards().map(c => c.id)).toEqual(['d2'])
  })
  it('draw the client, the chip, the date and a link to the Retainers page — and escape it all', () => {
    const v = view([])
    const html = v._deliverableCardHtml(card({ muted: true, chip: { key: 'in_review', label: 'With client · round 2' }, title: '<b>x</b>' }))
    expect(html).toContain('DMM · Monthly')
    expect(html).toContain('With client · round 2')
    expect(html).toContain('tk-card--muted')
    expect(html).toContain('data-card-link="#retainers/c1"')
    expect(html).toContain('data-card-id="d1"')
    expect(html).not.toContain('data-task-id')
    expect(html).toContain('&lt;b>x&lt;/b>')
    expect(html).toContain('>AL<')
  })
  it('say so when there is no date, and how late when late', () => {
    const v = view([])
    expect(v._deliverableCardHtml(card({ undated: true, due_date: null }))).toContain('No date')
    expect(v._deliverableCardHtml(card({ overdue: true, days_late: 3 }))).toContain('3d overdue')
  })
  it('the phone list carries my deliverables above my tasks, and unassigned ones, but not other people’s', () => {
    const v = view([card(), card({ id: 'd2', owner_id: 'u2' }), card({ id: 'd3', column: 'done', status: 'approved' }), card({ id: 'd4', owner_id: null, unassigned: true, column: 'todo', status: 'planned' })])
    v.tasks = []
    const groups = Object.fromEntries(v._mobileGroups().map(g => [g.id, g.items.map(i => i.id)]))
    expect(groups).toMatchObject({ doing: ['d1'], todo: ['d4'], done: ['d3'] })
    expect(v._mobileCardHtml(card({ owner_id: null, unassigned: true }))).toContain('data-take-card="d1"')
    expect(v._mobileCardHtml(card({ chip: { key: 'changes_requested', label: 'Changes requested' } }))).toContain('DMM · Changes requested · Mon 5 Oct')
  })
})

const request = over => ({
  id: 'q1', kind: 'request', title: 'Cut-down of the film', detail: 'See https://x.test/brief', company: 'DMM', company_id: 'c1',
  project: null, project_id: null, source: 'login', source_label: 'Signed in', sent_by: 'Dana', sent_at: '2026-09-28T10:00:00Z',
  wanted_by: '2026-10-30', wanted_by_display: 'Fri 30 Oct', ...over,
})

describe('client requests in New requests', () => {
  const mk = requests => { const v = new TasksView({ ...app, permissions: { projects_edit: true } }); v.requests = requests; return v }

  it('are never hidden by "Just mine" or the assignee filter, only by the project filter', () => {
    const v = mk([request(), request({ id: 'q2', project_id: 'p1' }), request({ id: 'q3', project_id: 'p2' })])
    v.filters = { mine: true, person: 'u2', project: '' }
    expect(v.visibleRequests().map(r => r.id)).toEqual(['q1', 'q2', 'q3'])
    v.filters = { mine: false, person: '', project: 'p1' }
    expect(v.visibleRequests().map(r => r.id)).toEqual(['q1', 'q2'])      // one with no project still shows
  })

  it('sit above the columns, counted, with Accept on the card; unassigned work is in its column, not up there', () => {
    const v = mk([request()])
    v.cards = [card({ id: 'd3', owner_id: null, unassigned: true, column: 'todo', status: 'planned' })]
    v._mc = { innerHTML: '' }
    const box = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null, isConnected: true }
    v._renderDesktop(box)
    expect(box.innerHTML).toContain('New requests · 1')
    expect(box.innerHTML).toContain('data-request-accept="q1"')
    const strip = box.innerHTML.slice(box.innerHTML.indexOf('tk-requests'), box.innerHTML.indexOf('tk-cols'))
    expect(strip).toContain('data-request-id="q1"')
    expect(strip).not.toContain('data-card-id="d3"')
    const todo = box.innerHTML.slice(box.innerHTML.indexOf('data-drop-col="todo"'), box.innerHTML.indexOf('data-drop-col="doing"'))
    expect(todo).toContain('data-card-id="d3"')
  })

  it('leave no strip at all when there are none', () => {
    const v = mk([])
    const box = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null }
    v._renderDesktop(box)
    expect(box.innerHTML).not.toContain('tk-requests')
    expect(box.innerHTML).not.toContain('Unassigned ·')
  })

  it('are not draggable, and are not tasks or deliverables', () => {
    const v = mk([request()])
    const box = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null }
    v._renderDesktop(box)
    const card = /<div class="tk-card tk-card--request"[^>]*>/.exec(box.innerHTML)[0]
    expect(card).not.toContain('draggable')
    expect(card).not.toContain('data-task-id')
    expect(card).not.toContain('data-card-id')
  })

  it('lead the phone list as "New requests"', () => {
    const v = mk([request()])
    const groups = v._mobileGroups()
    expect(groups[0]).toMatchObject({ id: 'requests', label: 'New requests' })
    expect(groups[0].items).toHaveLength(1)
    expect(v._mobileItemHtml(groups[0].items[0])).toContain('data-request-accept="q1"')
  })
})


const task = over => ({
  id: 't1', title: 'Book the edit suite', body: null, status: 'todo', assignee_id: null, created_by: 'u2', due_at: null,
  acknowledged_at: null, project_id: null, position: 1024, archived_at: null, comment_count: 0,
  created_at: new Date(Date.now() - 2 * 86400000).toISOString(), ...over,
})

describe('unassigned tasks', () => {
  const mk = tasks => { const v = new TasksView(app); v.tasks = tasks; v.filters = { mine: false, person: '', project: '' }; return v }

  it('sit in To do with everyone else’s, not in a tray', () => {
    const v = mk([task(), task({ id: 't2', assignee_id: 'me', position: 2048 })])
    expect(v.columnTasks('todo').map(t => t.id)).toEqual(['t1', 't2'])
  })

  it('say Unassigned and how long, with Assign to me; owned or finished ones don’t', () => {
    const v = mk([])
    const html = v._cardHtml(task())
    expect(html).toContain('tk-card--unassigned')
    expect(html).toContain('Unassigned · 2d')
    expect(html).toContain('data-take-task="t1"')
    expect(v._cardHtml(task({ assignee_id: 'me' }))).not.toContain('Unassigned')
    expect(v._cardHtml(task({ status: 'done' }))).not.toContain('data-take-task')
  })

  it('show on the phone list in their column, after mine, with Assign to me', () => {
    const v = mk([task(), task({ id: 't2', assignee_id: 'me', acknowledged_at: '2026-10-01T00:00:00Z' }), task({ id: 't3', assignee_id: 'u2' })])
    v.cards = []
    const groups = Object.fromEntries(v._mobileGroups().map(g => [g.id, g.items.map(i => i.id)]))
    expect(groups.todo).toEqual(['t2', 't1'])
    expect(v._mobileRowHtml(task())).toContain('data-take-task="t1"')
  })

  it('label the wait in whole days, and say nothing extra on the first day', () => {
    const now = Date.parse('2026-10-07T12:00:00Z')
    expect(unassignedLabel('2026-10-07T09:00:00Z', now)).toBe('Unassigned')
    expect(unassignedLabel('2026-10-06T09:00:00Z', now)).toBe('Unassigned · 1d')
    expect(unassignedLabel(null, now)).toBe('Unassigned')
  })

  it('the quick add says Add a task, and the owner is optional', () => {
    const html = mk([])._quickAddHtml()
    expect(html).toContain('Add a task')
    expect(html).not.toContain('Raise a request')
    expect(html).toContain('title="Owner (optional)"')
  })
})
