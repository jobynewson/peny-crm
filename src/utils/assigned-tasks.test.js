import { describe, it, expect } from 'vitest'
import { collectAssignedTasks, sortByDue, daysUntil, describeDue } from './assigned-tasks.js'

const ME_CLERK = 'user_clerk_me'
const ME_APP   = 'app-user-me'
const THEM_APP = 'app-user-them'

const who = { clerkId: ME_CLERK, appUserId: ME_APP }

describe('collectAssignedTasks — project deliverables', () => {
  const projects = [{
    id: 'p1',
    name: 'Brand film',
    deliverables: [
      { text: 'Grade master',  due: '2026-08-12', assignee_id: ME_APP },
      { text: 'Done already',  due: '2026-08-11', assignee_id: ME_APP, done: true },
      { text: 'Someone else',  due: '2026-08-10', assignee_id: THEM_APP },
      { text: '',              due: '2026-08-09', assignee_id: ME_APP },
    ],
    monthly_deliverables: [
      { text: 'Monthly reel', due: '2026-08-20', assignee_id: ME_APP },
    ],
  }]

  it('takes only my unfinished, non-empty deliverables', () => {
    const rows = collectAssignedTasks({ projects, ...who })
    expect(rows.map(r => r.text)).toEqual(['Grade master', 'Monthly reel'])
  })

  it('carries the array index so a tick can be written back', () => {
    const [first] = collectAssignedTasks({ projects, ...who })
    expect(first.ref).toEqual({ projectId: 'p1', field: 'deliverables', index: 0 })
    expect(first.completable).toBe(true)
    expect(first.sourceLabel).toBe('Brand film')
  })

  it('keeps the index of the original array, not of the filtered rows', () => {
    const rows = collectAssignedTasks({
      projects: [{ id: 'p1', name: 'P', deliverables: [
        { text: 'Theirs', assignee_id: THEM_APP },
        { text: 'Mine',   assignee_id: ME_APP },
      ] }],
      ...who,
    })
    expect(rows[0].ref.index).toBe(1)
  })

  it('ignores everything when the user has no app_users row', () => {
    expect(collectAssignedTasks({ projects, clerkId: ME_CLERK, appUserId: null })).toEqual([])
  })
})

describe('collectAssignedTasks — marketing and canvas sub-tasks', () => {
  const marketingCards = [{
    id: 'm1',
    title: 'Autumn campaign',
    sub_tasks: [
      { id: 's1', text: 'Write copy',  owner_id: ME_CLERK,   due_date: '2026-08-15' },
      { id: 's2', text: 'Ship it',     owner_id: ME_CLERK,   due_date: '2026-08-16', done: true },
      { id: 's3', text: 'Not mine',    owner_id: 'user_other' },
    ],
  }]
  const canvasChecklists = [{
    id: 'ci1', canvas_id: 'c1', canvas_name: 'Launch canvas',
    sub_tasks: [{ id: 't1', text: 'Pick stills', owner_id: ME_CLERK, due_date: '' }],
  }]

  it('matches sub-tasks on Clerk ID, not app_users ID', () => {
    const rows = collectAssignedTasks({ marketingCards, canvasChecklists, ...who })
    expect(rows.map(r => r.text).sort()).toEqual(['Pick stills', 'Write copy'])
  })

  it('treats an empty due_date as no due date', () => {
    const rows = collectAssignedTasks({ canvasChecklists, ...who })
    expect(rows[0].due).toBeNull()
  })

  it('finds nothing for sub-tasks when the Clerk ID is missing', () => {
    expect(collectAssignedTasks({ marketingCards, canvasChecklists, clerkId: null, appUserId: ME_APP })).toEqual([])
  })

  it('carries the ids needed to write the tick back', () => {
    const [row] = collectAssignedTasks({ marketingCards, ...who })
    expect(row.ref).toEqual({ cardId: 'm1', taskId: 's1', text: 'Write copy' })
  })
})

describe('collectAssignedTasks — planning board cards', () => {
  const boardCards = [
    { id: 'bc1', title: 'Cut trailer', due_date: '2026-08-14', board_id: 'b1', board_name: 'Studio', column_name: 'In progress' },
    { id: 'bc2', title: 'Old job',     due_date: '2026-08-01', board_id: 'b1', board_name: 'Studio', column_name: 'Done' },
    { id: 'bc3', title: 'Also done',   due_date: null,         board_id: 'b1', board_name: 'Studio', column_name: 'complete — Q3' },
    { id: 'bc4', title: 'Still open',  due_date: null,         board_id: 'b1', board_name: 'Studio', column_name: 'Doneness review' },
  ]

  it('drops cards sitting in a done-ish column, keeping look-alike names', () => {
    const rows = collectAssignedTasks({ boardCards, ...who })
    expect(rows.map(r => r.text)).toEqual(['Cut trailer', 'Still open'])
  })

  it('marks board cards read-only — a card has no done flag of its own', () => {
    const [row] = collectAssignedTasks({ boardCards, ...who })
    expect(row.completable).toBe(false)
    expect(row.ref).toEqual({ cardId: 'bc1', boardId: 'b1' })
  })
})

describe('collectAssignedTasks — post-production and calendar deadlines', () => {
  const ppsPhases = [{
    id: 'ph1', name: 'Offline', project_id: 'p9', project_name: 'Doc series',
    blocks: [
      { id: 'b1', title: 'Rough cut due', is_deadline: true,  end_date: '2026-08-13', assignee_id: ME_APP },
      { id: 'b2', title: 'Finished',      is_deadline: true,  end_date: '2026-08-13', assignee_id: ME_APP, is_complete: true },
      { id: 'b3', title: 'Not a deadline', is_deadline: false, end_date: '2026-08-13', assignee_id: ME_APP },
      { id: 'b4', title: 'Theirs',        is_deadline: true,  end_date: '2026-08-13', assignee_id: THEM_APP },
    ],
  }]
  const teamCalendarEntries = [
    { id: 'e1', label: 'Client review', is_deadline: true, entry_date: '2026-08-18', end_date: '2026-08-19', assignee_id: ME_APP },
    { id: 'e2', label: 'Shoot day',     is_deadline: false, entry_date: '2026-08-18', assignee_id: ME_APP },
  ]

  it('keeps only my outstanding deadline blocks', () => {
    const rows = collectAssignedTasks({ ppsPhases, ...who })
    expect(rows.map(r => r.text)).toEqual(['Rough cut due'])
    expect(rows[0].completable).toBe(true)
    expect(rows[0].ref).toEqual({ phaseId: 'ph1', blockId: 'b1', projectId: 'p9' })
  })

  it('keeps only calendar entries flagged as deadlines, and prefers the end date', () => {
    const rows = collectAssignedTasks({ teamCalendarEntries, ...who })
    expect(rows.map(r => r.text)).toEqual(['Client review'])
    expect(rows[0].due).toBe('2026-08-19')
    expect(rows[0].completable).toBe(false)
  })

  it('falls back to the start date when a deadline has no end date', () => {
    const rows = collectAssignedTasks({
      teamCalendarEntries: [{ id: 'e3', label: 'One-dayer', is_deadline: true, entry_date: '2026-08-20', assignee_id: ME_APP }],
      ...who,
    })
    expect(rows[0].due).toBe('2026-08-20')
  })
})

describe('collectAssignedTasks — combined output', () => {
  it('returns soonest first with undated rows last, and unique keys', () => {
    const rows = collectAssignedTasks({
      projects: [{ id: 'p1', name: 'P', deliverables: [{ text: 'Later', due: '2026-09-01', assignee_id: ME_APP }] }],
      marketingCards: [{ id: 'm1', title: 'M', sub_tasks: [{ id: 's1', text: 'Undated', owner_id: ME_CLERK }] }],
      boardCards: [{ id: 'bc1', title: 'Soonest', due_date: '2026-08-11', board_id: 'b1', board_name: 'B', column_name: 'To do' }],
      ...who,
    })
    expect(rows.map(r => r.text)).toEqual(['Soonest', 'Later', 'Undated'])
    expect(new Set(rows.map(r => r.key)).size).toBe(3)
  })

  it('survives empty input', () => {
    expect(collectAssignedTasks()).toEqual([])
    expect(collectAssignedTasks({ ...who })).toEqual([])
  })

  it('tolerates junk in the JSON columns', () => {
    const rows = collectAssignedTasks({
      projects: [{ id: 'p1', name: 'P', deliverables: null, monthly_deliverables: 'nope' }],
      marketingCards: [{ id: 'm1', title: 'M', sub_tasks: null }],
      canvasChecklists: [{ id: 'ci1', sub_tasks: undefined }],
      ppsPhases: [{ id: 'ph1', blocks: 'not an array' }],
      ...who,
    })
    expect(rows).toEqual([])
  })
})

describe('sortByDue', () => {
  it('does not mutate its input', () => {
    const input = [{ due: '2026-08-20', text: 'b' }, { due: '2026-08-10', text: 'a' }]
    const out = sortByDue(input)
    expect(input[0].text).toBe('b')
    expect(out[0].text).toBe('a')
  })

  it('breaks date ties alphabetically', () => {
    const out = sortByDue([
      { due: '2026-08-10', text: 'Zebra' },
      { due: '2026-08-10', text: 'Apple' },
    ])
    expect(out.map(r => r.text)).toEqual(['Apple', 'Zebra'])
  })
})

describe('daysUntil / describeDue', () => {
  const today = new Date('2026-08-10T09:30:00')

  it('counts whole days from local midnight', () => {
    expect(daysUntil('2026-08-10', today)).toBe(0)
    expect(daysUntil('2026-08-13', today)).toBe(3)
    expect(daysUntil('2026-08-07', today)).toBe(-3)
  })

  it('returns null for a missing or unparseable date', () => {
    expect(daysUntil(null, today)).toBeNull()
    expect(daysUntil('', today)).toBeNull()
    expect(daysUntil('not-a-date', today)).toBeNull()
  })

  it('labels overdue, today and future dates', () => {
    expect(describeDue('2026-08-07', today)).toEqual({ label: '3d overdue', tone: 'overdue' })
    expect(describeDue('2026-08-10', today)).toEqual({ label: 'Today', tone: 'today' })
    expect(describeDue('2026-08-13', today)).toEqual({ label: '13 Aug', tone: 'normal' })
    expect(describeDue(null, today)).toEqual({ label: '', tone: 'none' })
  })
})
