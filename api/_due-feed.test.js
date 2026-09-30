import { describe, it, expect } from 'vitest'
import { collectDue, dueMeta, isFinishedColumn, TYPE_LABELS } from './_due-feed.js'

const today = '2026-09-28'
const to = '2026-10-12'
const ANA = { id: 'u-ana', clerk_id: 'user_ana', name: 'Ana Silva', email: 'ana@peny.com' }
const BEN = { id: 'u-ben', clerk_id: 'user_ben', name: null, email: 'ben@peny.com' }
const users = [ANA, BEN]

const base = () => ({
  users, worklist: [], marketing: [], checklists: [], boardCards: [], ppsPhases: [], calendar: [], tasks: [],
})
const keys = items => items.map(i => i.key)

describe('collectDue', () => {
  it('turns every source into one sorted list with a type, title, date, owner and link', () => {
    const src = base()
    src.worklist = [{ id: 'w1', title: 'Hero film', due_kind: 'exact', due_date: '2026-10-02', due_label: null, status: 'in_progress', owner_id: 'u-ana', workstream: 'Launch', company_id: 'co1', company: 'DMM' }]
    // A project's old JSON deliverables are no longer a source, even if handed in.
    src.projects = [{ id: 'p1', name: 'Brand film', is_retainer: true, deliverables: [{ text: 'Master', due: '2026-10-01', assignee_id: 'u-ben', done: false }], monthly_deliverables: [{ text: 'Monthly', due: '2026-10-01' }] }]
    src.marketing = [{ id: 'm1', title: 'Newsletter', due_date: '2026-10-05', lead_owner_id: 'user_ana', sub_tasks: [{ id: 's1', text: 'Write intro', due_date: '2026-09-30', owner_id: 'user_ben', done: false }] }]
    src.checklists = [{ id: 'ci1', canvas_id: 'cv1', canvas_name: 'Shoot plan', sub_tasks: [{ id: 'x', text: 'Book van', due_date: '2026-10-03', owner_id: 'user_ana', done: false }] }]
    src.boardCards = [{ id: 'b1', title: 'Script', due_date: '2026-10-04', assignee_id: 'u-ben', board_id: 'bd1', board_name: 'Autumn', column_name: 'In progress' }]
    src.ppsPhases = [{ id: 'ph1', name: 'Edit', project_id: 'p1', project_name: 'Brand film', blocks: [{ id: 'bk1', title: 'Picture lock', end_date: '2026-10-06', is_deadline: true, assignee_id: 'u-ana' }] }]
    src.calendar = [{ id: 'tc1', label: 'Online deadline', entry_date: '2026-10-07', end_date: null, assignee_id: 'u-ben', project_name: null }]
    src.tasks = [{ id: 't1', title: 'Send invoice', due_at: '2026-10-08T10:00:00Z', assignee_id: 'u-ana', project_name: null }]

    const items = collectDue(src, { today, to })
    expect(items.map(i => [i.date, i.type])).toEqual([
      ['2026-09-30', 'marketing_task'], ['2026-10-02', 'deliverable'],
      ['2026-10-03', 'checklist'], ['2026-10-04', 'board_card'], ['2026-10-05', 'marketing_card'],
      ['2026-10-06', 'edit_deadline'], ['2026-10-07', 'edit_deadline'], ['2026-10-08', 'task'],
    ])
    const hero = items.find(i => i.type === 'deliverable')
    expect(hero).toMatchObject({
      title: 'Hero film', context: 'DMM · Launch', link: '#retainers/co1', due_label: null,
      type_label: 'Deliverable', owner: { id: 'u-ana', name: 'Ana Silva' }, days: 4, overdue: false,
    })
    expect(items.find(i => i.type === 'marketing_task')).toMatchObject({ link: '#marketing/m1', owner: { id: 'u-ben', name: 'ben@peny.com' } })
    expect(items.find(i => i.type === 'checklist').link).toBe('#planning/canvas/cv1')
    expect(items.find(i => i.type === 'board_card').link).toBe('#planning/bd1')
    expect(items.find(i => i.key === 'pp:ph1:bk1').link).toBe('#projects/p1/post-production')
    expect(items.find(i => i.type === 'task').link).toBe('#tasks/t1')
    for (const i of items) expect(TYPE_LABELS[i.type]).toBe(i.type_label)
  })

  it('keeps overdue work and drops anything past the window', () => {
    const src = base()
    src.tasks = [
      { id: 'late', title: 'Late', due_at: '2026-09-01T09:00:00Z', assignee_id: null },
      { id: 'far', title: 'Far', due_at: '2026-11-01T09:00:00Z', assignee_id: null },
    ]
    const items = collectDue(src, { today, to })
    expect(keys(items)).toEqual(['tk:late'])
    expect(items[0]).toMatchObject({ overdue: true, days: -27, owner: null })
  })

  it('narrows to one person, whoever the source keyed them by', () => {
    const src = base()
    src.marketing = [{ id: 'm1', title: 'Card', due_date: null, sub_tasks: [
      { id: 'a', text: 'Ana (Clerk id)', due_date: '2026-10-01', owner_id: 'user_ana' },
      { id: 'b', text: 'Ben (Clerk id)', due_date: '2026-10-01', owner_id: 'user_ben' },
    ] }]
    src.tasks = [{ id: 't', title: 'Ana (app user id)', due_at: '2026-10-02T09:00:00Z', assignee_id: 'u-ana' }]
    expect(collectDue(src, { today, to, ownerId: 'u-ana' }).map(i => i.title)).toEqual(['Ana (Clerk id)', 'Ana (app user id)'])
  })

  it('dates a task by its London day', () => {
    const src = base()
    // 23:30 UTC on 1 Oct is 00:30 on 2 Oct in London.
    src.tasks = [{ id: 't', title: 'Late night', due_at: '2026-10-01T23:30:00Z', assignee_id: null }]
    expect(collectDue(src, { today, to })[0].date).toBe('2026-10-02')
  })

  it('leaves out finished work', () => {
    const src = base()
    src.marketing = [{ id: 'm', title: 'M', due_date: null, sub_tasks: [{ text: 'Ticked', due_date: '2026-10-01', done: true }] }]
    src.boardCards = [{ id: 'b', title: 'Shipped', due_date: '2026-10-01', board_id: 'bd', board_name: 'B', column_name: ' done ' }]
    src.ppsPhases = [{ id: 'ph', name: 'Edit', project_id: 'p', project_name: 'P', blocks: [
      { id: 'k1', end_date: '2026-10-01', is_deadline: true, is_complete: true },
      { id: 'k2', end_date: '2026-10-01', is_deadline: false },
    ] }]
    expect(collectDue(src, { today, to })).toEqual([])
  })

  it('links a deliverable to its project\'s Worklist tab, with it open, and to the company\'s old address only when it has no project', () => {
    const src = base()
    const item = (id, extra) => ({ id, title: id, due_kind: 'exact', due_date: '2026-10-02', due_label: null, status: 'planned', owner_id: null, workstream: 'W', company: 'DMM', company_id: 'co1', project_id: null, ...extra })
    src.worklist = [item('a', { project_id: 'p1' }), item('b', {}), item('c', { company_id: null, company: 'A project' , project_id: 'p2' })]
    const links = Object.fromEntries(collectDue(src, { today, to }).map(i => [i.title, i.link]))
    expect(links).toEqual({ a: '#projects/p1/worklist/a', b: '#retainers/co1', c: '#projects/p2/worklist/c' })
  })

  it('says when a worklist item is due only when the date alone doesn\'t', () => {
    const src = base()
    const item = (id, due) => ({ id, title: id, due_date: '2026-10-07', status: 'planned', owner_id: null, workstream: 'Winter', company_id: 'c', company: 'DMM', due_label: null, ...due })
    src.worklist = [
      item('a', { due_kind: 'window', due_label: '1st week of October' }),
      item('b', { due_kind: 'window' }),
      item('c', { due_kind: 'month' }),
      item('d', { due_kind: 'exact' }),
      item('e', { due_kind: 'exact', due_label: 'Wk 41' }),
    ]
    expect(collectDue(src, { today, to }).map(i => [i.title, i.due_label])).toEqual([
      ['a', '1st week of October'], ['b', 'By 7 Oct'], ['c', 'October'], ['d', null], ['e', 'Wk 41'],
    ])
  })

  it('describes an item in one line, leaving out what the type already says', () => {
    const src = base()
    src.marketing = [{ id: 'm', title: 'Newsletter', due_date: '2026-10-01', sub_tasks: [] }]
    src.tasks = [
      { id: 't1', title: 'Loose task', due_at: '2026-10-01T09:00:00Z', assignee_id: null, project_name: null },
      { id: 't2', title: 'Project task', due_at: '2026-10-01T09:00:00Z', assignee_id: null, project_name: 'Brand film' },
    ]
    src.worklist = [{ id: 'w', title: 'Axe', due_kind: 'month', due_date: '2026-10-31', due_label: null, status: 'planned', owner_id: null, workstream: 'Winter', company_id: 'c', company: 'DMM' }]
    expect(collectDue(src, { today, to: '2026-10-31' }).map(i => [i.title, dueMeta(i)])).toEqual([
      ['Newsletter', 'Marketing'], ['Loose task', 'Task'], ['Project task', 'Task · Brand film'],
      ['Axe', 'Deliverable · DMM · Winter · October'],
    ])
  })

  it('recognises finished board columns by name', () => {
    for (const n of ['Done', 'done', 'Complete', 'Delivered', 'Approved', 'Archived']) expect(isFinishedColumn(n)).toBe(true)
    for (const n of ['To do', 'In progress', 'Done-ish', '', null]) expect(isFinishedColumn(n)).toBe(false)
  })
})
