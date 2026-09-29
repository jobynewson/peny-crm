import { describe, it, expect } from 'vitest'

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
import { vi } from 'vitest'
vi.mock('../api/http.js', () => ({ request: async () => ({}), qs: () => '' }))
const { TasksView } = await import('./tasks.js')

const app = { appUser: { id: 'me' }, allUsers: [{ id: 'me', name: 'Ana Lee' }, { id: 'u2', name: 'Ben' }], projects: [{ id: 'p1', name: 'Film' }] }
const card = over => ({
  id: 'd1', kind: 'deliverable', title: 'October reel', company: 'DMM', company_id: 'c1', workstream: 'Monthly', project_id: null,
  owner_id: 'me', in_tray: false, status: 'in_progress', column: 'doing', muted: false, chip: null, due_date: '2026-10-05',
  due_display: 'Mon 5 Oct', undated: false, overdue: false, days_late: null, link: '#retainers/c1', ...over,
})
const view = cards => { const v = new TasksView(app); v.cards = cards; return v }

describe('deliverable cards on the board', () => {
  it('sit in their column above tasks, in the tray when unowned, and count in the header numbers', () => {
    const v = view([card(), card({ id: 'd2', column: 'todo', status: 'planned' }), card({ id: 'd3', owner_id: null, in_tray: true })])
    expect(v.columnCards('doing').map(c => c.id)).toEqual(['d1'])
    expect(v.columnCards('todo').map(c => c.id)).toEqual(['d2'])
    expect(v.trayCards().map(c => c.id)).toEqual(['d3'])
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
  it('the phone list carries my deliverables above my tasks, and only mine', () => {
    const v = view([card(), card({ id: 'd2', owner_id: 'u2' }), card({ id: 'd3', column: 'done', status: 'approved' })])
    v.tasks = []
    const groups = Object.fromEntries(v._mobileGroups().map(g => [g.id, g.items.map(i => i.id)]))
    expect(groups).toMatchObject({ doing: ['d1'], todo: [], done: ['d3'] })
    expect(v._mobileCardHtml(card({ chip: { key: 'changes_requested', label: 'Changes requested' } }))).toContain('DMM · Changes requested · Mon 5 Oct')
  })
})
