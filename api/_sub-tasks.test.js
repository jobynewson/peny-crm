import { describe, it, expect } from 'vitest'
import { daysUntilDue, groupDueSubTasks } from './_sub-tasks.js'

const today = new Date('2026-06-29T09:00:00')

describe('daysUntilDue', () => {
  it('is 0 for today, negative when overdue, positive when ahead', () => {
    expect(daysUntilDue('2026-06-29', today)).toBe(0)
    expect(daysUntilDue('2026-06-26', today)).toBe(-3)
    expect(daysUntilDue('2026-07-02', today)).toBe(3)
  })
  it('ignores the time of day on either side', () => {
    expect(daysUntilDue('2026-06-30T23:30:00', new Date('2026-06-29T00:05:00'))).toBe(1)
  })
})

describe('groupDueSubTasks', () => {
  const src = (title, subs) => ({ title, sub_tasks: subs })
  const st = (over) => ({ id: '1', text: 't', owner_id: 'u', due_date: '2026-06-29', done: false, ...over })

  it('keeps only rows with text, owner, due date, and not done', () => {
    const sources = [src('Card', [
      st({ text: '' }),                 // no text
      st({ owner_id: '' }),             // no owner
      st({ due_date: '' }),             // no due date
      st({ done: true }),               // done
      st({ id: 'keep', text: 'real' }), // ✓
    ])]
    const out = groupDueSubTasks(sources, today, 3)
    expect(out.u).toHaveLength(1)
    expect(out.u[0].text).toBe('real')
  })

  it('includes overdue but excludes rows beyond the window', () => {
    const sources = [src('Card', [
      st({ owner_id: 'a', due_date: '2026-06-20' }), // overdue → in
      st({ owner_id: 'b', due_date: '2026-07-01' }), // 2 days → in
      st({ owner_id: 'c', due_date: '2026-07-10' }), // 11 days → out
    ])]
    const out = groupDueSubTasks(sources, today, 3)
    expect(out.a).toHaveLength(1)
    expect(out.a[0].daysUntil).toBe(-9)
    expect(out.b).toHaveLength(1)
    expect(out.c).toBeUndefined()
  })

  it('groups by owner across multiple sources and carries the source title', () => {
    const sources = [
      src('Marketing card', [st({ owner_id: 'u', text: 'm' })]),
      src('Canvas checklist', [st({ owner_id: 'u', text: 'c' }), st({ owner_id: 'v', text: 'x' })]),
    ]
    const out = groupDueSubTasks(sources, today, 3)
    expect(out.u.map(i => i.text).sort()).toEqual(['c', 'm'])
    expect(out.u.find(i => i.text === 'c').title).toBe('Canvas checklist')
    expect(out.v).toHaveLength(1)
  })

  it('tolerates empty/missing sub_tasks', () => {
    expect(groupDueSubTasks([{ title: 'x' }, { title: 'y', sub_tasks: [] }], today, 3)).toEqual({})
    expect(groupDueSubTasks(null, today, 3)).toEqual({})
  })
})
