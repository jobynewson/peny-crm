import { describe, it, expect, vi } from 'vitest'

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.CSS ??= { escape: s => String(s) }
const getProjectPage = vi.fn()
vi.mock('../api/http.js', () => ({ request: async () => ({}), qs: () => '' }))
vi.mock('../api/retainers.js', () => ({ getProjectPage: (...a) => getProjectPage(...a), attachWorkstreams: async () => ({ attached: 1 }) }))
const { Worklist } = await import('./worklist.js')

const vocab = { statuses: [], workstream_statuses: [], due_kinds: ['exact'], cadences: [] }
const deliverable = over => ({
  id: 'd1', workstream_id: 'w1', title: 'October reel', format: '16:9', owner_id: 'u1', owner_name: 'Ana',
  due_kind: 'exact', due_date: '2026-10-05', due_display: 'Mon 5 Oct', overdue: false, days_late: 0, status: 'planned',
  status_label: 'Planned', client_status: 'Planned', client_visible: false, deliveries: [], sort_order: 0, created_at: '2026-09-01', ...over,
})
const page = over => ({
  today: '2026-09-30', vocab,
  project: { id: 'p1', name: 'Retainer', status: 'Active', is_retainer: true, has_link: true, portal_emails: [] },
  company: { id: 'c1', name: 'DMM', portal: true, lead_id: null, lead_name: null },
  workstreams: [{ id: 'w1', project_id: 'p1', title: 'Monthly content', brief: 'Videos', status: 'active', status_label: 'Active', deliverables: [deliverable()] }],
  unattached: [], ...over,
})
const fakeEl = () => ({ innerHTML: '', isConnected: true, querySelector: () => null, querySelectorAll: () => [] })
const app = (over = {}) => ({ permissions: { projects_edit: true }, appUser: { id: 'u1', role: 'superadmin' }, settings: {}, toast() {}, allUsers: [], projectsView: { setWorklistCount: vi.fn() }, ...over })

function painted(p, a = app()) {
  const w = new Worklist(a)
  w.el = fakeEl(); w.projectId = 'p1'; w.page = p
  w._paint()
  return { html: w.el.innerHTML, w }
}

describe('the Worklist tab', () => {
  it('draws the project\'s workstreams and deliverables, with no way back to a company page', () => {
    const { html } = painted(page())
    expect(html).toContain('Monthly content')
    expect(html).toContain('October reel')
    expect(html).toContain('1 open item')
    expect(html).not.toContain('Retainers')
    expect(html).not.toContain('#retainers')
  })

  it('says whether the client has a login and a link', () => {
    expect(painted(page()).html).toContain('Login on')
    expect(painted(page()).html).toContain('Link on')
    const bare = painted(page({ company: null, project: { id: 'p1', name: 'Shoot', has_link: false, portal_emails: [] } })).html
    expect(bare).not.toContain('Login on')
    expect(bare).not.toContain('Link on')
  })

  it('offers Portal access only to a superadmin, and only when the project has a company', () => {
    expect(painted(page()).html).toContain('data-rt-portal')
    expect(painted(page(), app({ appUser: { id: 'u1', role: 'user' } })).html).not.toContain('data-rt-portal')
    expect(painted(page({ company: null })).html).not.toContain('data-rt-portal')
  })

  it('does not show the lead here at all: it lives on the company, in Contacts', () => {
    expect(painted(page()).html).not.toContain('No lead')
    expect(painted(page(), app({ settings: { show_leads: true } })).html).not.toContain('No lead')
  })

  it('offers to attach a company\'s older workstreams, to editors only, and names them', () => {
    const p = page({ unattached: [{ id: 'w9', title: 'Older <b>one</b>' }] })
    const html = painted(p).html
    expect(html).toContain('data-rt-attach')
    expect(html).toContain('Older &lt;b&gt;one&lt;/b&gt;')
    expect(painted(p, app({ permissions: { projects_edit: false } })).html).not.toContain('data-rt-attach')
  })

  it('reads-only for someone who cannot edit: no add buttons', () => {
    const html = painted(page(), app({ permissions: { projects_edit: false } })).html
    expect(html).not.toContain('data-rt-add-ws')
    expect(html).not.toContain('data-rt-add-d')
  })

  it('shows an empty project an invitation to add a workstream', () => {
    const html = painted(page({ workstreams: [] })).html
    expect(html).toContain('No workstreams yet')
    expect(html).toContain('data-rt-add-ws')
  })
})

describe('loading it', () => {
  it('fetches the project\'s page, draws it and reports the open count for the tab', async () => {
    getProjectPage.mockResolvedValueOnce(page())
    const a = app()
    const w = new Worklist(a)
    const el = fakeEl()
    await w.mount(el, 'p1')
    expect(getProjectPage).toHaveBeenCalledWith('p1')
    expect(el.innerHTML).toContain('October reel')
    expect(a.projectsView.setWorklistCount).toHaveBeenCalledWith('p1', 1)
  })

  it('says so when the project is gone, and when it cannot load', async () => {
    const w = new Worklist(app())
    const gone = fakeEl()
    getProjectPage.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 404 }))
    await w.mount(gone, 'p1')
    expect(gone.innerHTML).toContain('isn’t in Slate any more')
    const broken = fakeEl()
    getProjectPage.mockRejectedValueOnce(new Error('offline'))
    await w.mount(broken, 'p2')
    expect(broken.innerHTML).toContain('Couldn\'t load the worklist. offline')
  })

  it('does not paint a response for a project that is no longer on show', async () => {
    const w = new Worklist(app())
    const first = fakeEl()
    let release
    getProjectPage.mockReturnValueOnce(new Promise(r => { release = () => r(page()) }))
    const slow = w.mount(first, 'p1')
    getProjectPage.mockResolvedValueOnce(page({ project: { id: 'p2', name: 'Other', has_link: false, portal_emails: [] }, workstreams: [] }))
    const second = fakeEl()
    await w.mount(second, 'p2')
    release(); await slow
    expect(first.innerHTML).toBe('<div class="rt-empty">Loading…</div>')
    expect(second.innerHTML).toContain('No workstreams yet')
  })
})
