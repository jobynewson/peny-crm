import { describe, it, expect, vi } from 'vitest'
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
vi.mock('../api/retainers.js', () => ({ getProjectOwed: async () => ({}) }))
const { owedHtml, owedSummary } = await import('./owed.js')

const item = over => ({ id: 'd1', title: 'Hero film', workstream: 'Edits', owner_name: 'Joby', status: 'planned', status_label: 'Planned', chip: null, muted: false, due_date: '2026-11-01', due_display: 'Sun 1 Nov', undated: false, overdue: false, days_late: null, link: '#projects/p1/worklist/d1', ...over })

describe('Owed on the overview', () => {
  it('draws each row with status, due date and a link into the Worklist, and the window toggle', () => {
    const html = owedHtml({ total: 1, later: 0, overdue: 0, waiting: 0, items: [item()] }, 30)
    expect(html).toContain('Hero film')
    expect(html).toContain('Sun 1 Nov')
    expect(html).toContain('#projects/p1/worklist/d1')
    expect(html).toContain('data-owed-window="30" aria-pressed="true"')
    expect(html).toContain('Open the Worklist')
  })
  it('says when there is more than is shown, and how much sits beyond the window', () => {
    const html = owedHtml({ total: 9, later: 3, overdue: 1, waiting: 0, items: [item(), item({ id: 'd2' })] }, 14)
    expect(html).toContain('See all 9 in the Worklist')
    expect(html).toContain('3 more due later than 14 days')
  })
  it('marks late work and shows "No date" and the waiting chip', () => {
    const html = owedHtml({ total: 3, later: 0, overdue: 1, waiting: 1, items: [
      item({ overdue: true, days_late: 4 }), item({ id: 'u', undated: true, due_date: null }),
      item({ id: 'w', muted: true, chip: { key: 'waiting_on_client', label: 'Waiting on client · 2d' } })] }, 30)
    expect(html).toContain('4d overdue')
    expect(html).toContain('No date')
    expect(html).toContain('owed-row--muted')
    expect(html).toContain('Waiting on client · 2d')
  })
  it('has an honest empty state, and escapes titles', () => {
    expect(owedHtml({ total: 0, later: 0, overdue: 0, waiting: 0, items: [] }, 30)).toContain('Nothing open on this project.')
    expect(owedHtml({ total: 2, later: 2, overdue: 0, waiting: 0, items: [] }, 7)).toContain('Nothing due in the next 7 days.')
    expect(owedHtml({ total: 1, later: 0, overdue: 0, waiting: 0, items: [item({ title: '<img onerror=x>' })] }, 30)).not.toContain('<img')
    expect(owedSummary({ total: 4, overdue: 1, waiting: 2 })).toBe('4 open · 1 overdue · 2 waiting on the client')
  })
})
