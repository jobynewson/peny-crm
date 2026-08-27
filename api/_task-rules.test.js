import { describe, it, expect } from 'vitest'
import {
  positionBetween, needsRebalance, rebalancedPositions,
  parseMentions, userHandles,
  notificationsFor, acknowledgementPatch,
  validateTaskInput, toTimestamp, isUuid,
  POSITION_GAP, TITLE_MAX,
} from './_task-rules.js'

const ana = { id: 'u-ana', name: 'Ana Silva',  email: 'ana@peny.com' }
const ben = { id: 'u-ben', name: 'Ben Torres', email: 'ben@peny.com' }
const USERS = [ana, ben]

describe('positionBetween', () => {
  it('starts a column at the gap size', () => {
    expect(positionBetween(null, null)).toBe(POSITION_GAP)
  })
  it('takes the midpoint between two cards', () => {
    expect(positionBetween(1024, 2048)).toBe(1536)
  })
  it('drops above the first card and below the last', () => {
    expect(positionBetween(null, 1024)).toBe(0)
    expect(positionBetween(2048, null)).toBe(3072)
  })
})

describe('needsRebalance', () => {
  it('is false for healthy gaps', () => {
    expect(needsRebalance(1024, 2048)).toBe(false)
    expect(needsRebalance(1024, 1024.01)).toBe(false)
  })
  it('is true once neighbours close to within MIN_GAP', () => {
    expect(needsRebalance(1024, 1024.0001)).toBe(true)
  })
  it('is false at the ends of a column', () => {
    expect(needsRebalance(null, 1024)).toBe(false)
    expect(needsRebalance(1024, null)).toBe(false)
  })
  // Repeatedly dropping into the same slot is what actually exhausts precision.
  it('trips after enough midpoint inserts', () => {
    let lo = 1024, hi = 2048
    let trips = 0
    for (let i = 0; i < 40 && !needsRebalance(lo, hi); i++) { hi = positionBetween(lo, hi); trips++ }
    expect(needsRebalance(lo, hi)).toBe(true)
    expect(trips).toBeLessThan(40)
  })
  it('rebalances to clean multiples', () => {
    expect(rebalancedPositions(3)).toEqual([1024, 2048, 3072])
    expect(rebalancedPositions(0)).toEqual([])
  })
})

describe('parseMentions', () => {
  it('resolves a first name', () => {
    expect(parseMentions('can @ana take this?', USERS)).toEqual(['u-ana'])
  })
  it('resolves the email local part and dotted forms', () => {
    expect(parseMentions('@ben please', USERS)).toEqual(['u-ben'])
    expect(parseMentions('@ana.silva please', USERS)).toEqual(['u-ana'])
    expect(parseMentions('@anasilva please', USERS)).toEqual(['u-ana'])
  })
  it('is case insensitive', () => {
    expect(parseMentions('@ANA @Ben', USERS)).toEqual(['u-ana', 'u-ben'])
  })
  it('resolves several, in order, without duplicates', () => {
    expect(parseMentions('@ben @ana and @ben again', USERS)).toEqual(['u-ben', 'u-ana'])
  })
  it('leaves an unresolved token as plain text, not an error', () => {
    expect(parseMentions('@nobody here', USERS)).toEqual([])
    expect(parseMentions('hello, no mentions', USERS)).toEqual([])
  })
  it('ignores an email address in the body', () => {
    expect(parseMentions('mail joby@wearepeny.com about it', USERS)).toEqual([])
  })
  it('strips trailing punctuation', () => {
    expect(parseMentions('over to @ana.', USERS)).toEqual(['u-ana'])
    expect(parseMentions('(@ben)', USERS)).toEqual(['u-ben'])
  })
  it('matches at the very start of the body', () => {
    expect(parseMentions('@ana', USERS)).toEqual(['u-ana'])
  })
  // Notifying the wrong Ana is worse than leaving the text plain.
  it('refuses an ambiguous handle', () => {
    const other = { id: 'u-ana2', name: 'Ana Woods', email: 'aw@peny.com' }
    expect(parseMentions('@ana', [ana, other])).toEqual([])
    expect(parseMentions('@ana.silva', [ana, other])).toEqual(['u-ana'])
  })
  it('handles empty and missing bodies', () => {
    expect(parseMentions('', USERS)).toEqual([])
    expect(parseMentions(null, USERS)).toEqual([])
  })
  it('builds handles without a name', () => {
    expect([...userHandles({ email: 'x@y.com' })]).toEqual(['x'])
  })
})

describe('notificationsFor', () => {
  const task = { created_by: 'u-ana', assignee_id: 'u-ben', status: 'todo' }

  it('notifies the new assignee', () => {
    expect(notificationsFor({ type: 'assigned', actorId: 'u-ana', task }))
      .toEqual([{ recipient_id: 'u-ben', type: 'assigned' }])
  })
  it('never notifies the actor about their own action', () => {
    expect(notificationsFor({ type: 'assigned', actorId: 'u-ben', task })).toEqual([])
    expect(notificationsFor({ type: 'acknowledged', actorId: 'u-ana', task })).toEqual([])
  })
  it('tells the creator when their task is acknowledged', () => {
    expect(notificationsFor({ type: 'acknowledged', actorId: 'u-ben', task }))
      .toEqual([{ recipient_id: 'u-ana', type: 'acknowledged' }])
  })
  it('notifies creator and assignee on a comment, minus the author', () => {
    const out = notificationsFor({ type: 'commented', actorId: 'u-cat', task })
    expect(out).toEqual([
      { recipient_id: 'u-ana', type: 'commented' },
      { recipient_id: 'u-ben', type: 'commented' },
    ])
  })
  it('prefers mentioned over commented for the same person', () => {
    const out = notificationsFor({ type: 'commented', actorId: 'u-cat', task, mentionedIds: ['u-ben'] })
    expect(out).toEqual([
      { recipient_id: 'u-ben', type: 'mentioned' },
      { recipient_id: 'u-ana', type: 'commented' },
    ])
  })
  it('does not notify an author who mentions themselves', () => {
    const out = notificationsFor({ type: 'commented', actorId: 'u-ben', task, mentionedIds: ['u-ben'] })
    expect(out).toEqual([{ recipient_id: 'u-ana', type: 'commented' }])
  })
  it('tells the creator when work is completed by someone else', () => {
    const done = { ...task, status: 'done' }
    expect(notificationsFor({ type: 'status_changed', actorId: 'u-ben', task: done }))
      .toEqual([{ recipient_id: 'u-ana', type: 'completed' }])
  })
  it('stays quiet for status moves that are not completion', () => {
    const doing = { ...task, status: 'doing' }
    expect(notificationsFor({ type: 'status_changed', actorId: 'u-ben', task: doing })).toEqual([])
  })
  it('does not notify a creator who completes their own task', () => {
    const done = { ...task, status: 'done' }
    expect(notificationsFor({ type: 'status_changed', actorId: 'u-ana', task: done })).toEqual([])
  })
  it('nudges the assignee with no actor', () => {
    expect(notificationsFor({ type: 'nudged', actorId: null, task }))
      .toEqual([{ recipient_id: 'u-ben', type: 'unacknowledged_nudge' }])
  })
  it('emits nothing for events nobody is notified about', () => {
    expect(notificationsFor({ type: 'created',    actorId: 'u-ana', task })).toEqual([])
    expect(notificationsFor({ type: 'due_changed', actorId: 'u-ana', task })).toEqual([])
    expect(notificationsFor({ type: 'archived',   actorId: 'u-ana', task })).toEqual([])
  })
  it('skips an unassigned task with no creator match', () => {
    const orphan = { created_by: 'u-ana', assignee_id: null, status: 'todo' }
    expect(notificationsFor({ type: 'assigned', actorId: 'u-ana', task: orphan })).toEqual([])
  })
})

describe('acknowledgementPatch', () => {
  const base = { assignee_id: 'u-ben', status: 'todo', acknowledged_at: null, nudged_at: null }

  it('leaves an untouched task alone', () => {
    expect(acknowledgementPatch({ task: base, patch: {}, actorId: 'u-ana' }))
      .toEqual({ acknowledged_at: null, nudged_at: null })
  })
  it('acknowledges implicitly when the assignee starts work', () => {
    const out = acknowledgementPatch({ task: base, patch: { status: 'doing' }, actorId: 'u-ben' })
    expect(out.acknowledged_at).toBeInstanceOf(Date)
  })
  it('acknowledges implicitly when the assignee completes work', () => {
    const out = acknowledgementPatch({ task: base, patch: { status: 'done' }, actorId: 'u-ben' })
    expect(out.acknowledged_at).toBeInstanceOf(Date)
  })
  // The assignee still has not seen it — someone else moved it for them.
  it('does not acknowledge on the assignee behalf', () => {
    const out = acknowledgementPatch({ task: base, patch: { status: 'doing' }, actorId: 'u-ana' })
    expect(out.acknowledged_at).toBeNull()
  })
  it('does not acknowledge when assigning and starting in one go', () => {
    const unassigned = { ...base, assignee_id: null }
    const out = acknowledgementPatch({
      task: unassigned, patch: { assignee_id: 'u-ben', status: 'doing' }, actorId: 'u-ana',
    })
    expect(out.acknowledged_at).toBeNull()
  })
  it('acknowledges when someone claims an unassigned task and starts it', () => {
    const unassigned = { ...base, assignee_id: null }
    const out = acknowledgementPatch({
      task: unassigned, patch: { assignee_id: 'u-ben', status: 'doing' }, actorId: 'u-ben',
    })
    expect(out.acknowledged_at).toBeInstanceOf(Date)
  })
  it('clears acknowledgement and the nudge on reassignment', () => {
    const acked = { ...base, acknowledged_at: new Date('2026-01-01'), nudged_at: new Date('2026-01-01') }
    expect(acknowledgementPatch({ task: acked, patch: { assignee_id: 'u-cat' }, actorId: 'u-ana' }))
      .toEqual({ acknowledged_at: null, nudged_at: null })
  })
  it('keeps acknowledgement when the assignee is re-set to the same person', () => {
    const acked = { ...base, acknowledged_at: new Date('2026-01-01') }
    const out = acknowledgementPatch({ task: acked, patch: { assignee_id: 'u-ben' }, actorId: 'u-ana' })
    expect(out.acknowledged_at).toEqual(new Date('2026-01-01'))
  })
  it('an unassigned task is never unacknowledged', () => {
    const acked = { ...base, acknowledged_at: new Date('2026-01-01'), nudged_at: new Date('2026-01-01') }
    expect(acknowledgementPatch({ task: acked, patch: { assignee_id: null }, actorId: 'u-ana' }))
      .toEqual({ acknowledged_at: null, nudged_at: null })
  })
  it('does not re-acknowledge an already acknowledged task', () => {
    const at = new Date('2026-01-01')
    const out = acknowledgementPatch({ task: { ...base, acknowledged_at: at }, patch: { status: 'done' }, actorId: 'u-ben' })
    expect(out.acknowledged_at).toEqual(at)
  })
})

describe('validateTaskInput', () => {
  const opts = { userIds: ['u-ana', 'u-ben'], projectIds: ['p-1'] }

  it('accepts a title-only task — the fast path must never be blocked', () => {
    expect(validateTaskInput({ title: 'Just this' }, opts)).toBeNull()
  })
  it('rejects a missing or blank title', () => {
    expect(validateTaskInput({}, opts).field).toBe('title')
    expect(validateTaskInput({ title: '   ' }, opts).field).toBe('title')
    expect(validateTaskInput({ title: 42 }, opts).field).toBe('title')
  })
  it('caps the title length', () => {
    expect(validateTaskInput({ title: 'x'.repeat(TITLE_MAX) }, opts)).toBeNull()
    expect(validateTaskInput({ title: 'x'.repeat(TITLE_MAX + 1) }, opts).field).toBe('title')
  })
  it('rejects a status outside the enum', () => {
    expect(validateTaskInput({ title: 'a', status: 'blocked' }, opts).field).toBe('status')
    expect(validateTaskInput({ title: 'a', status: 'doing' }, opts)).toBeNull()
  })
  it('rejects an unreadable due date but allows clearing it', () => {
    expect(validateTaskInput({ title: 'a', due_at: 'not a date' }, opts).field).toBe('due_at')
    expect(validateTaskInput({ title: 'a', due_at: null }, opts)).toBeNull()
    expect(validateTaskInput({ title: 'a', due_at: '' }, opts)).toBeNull()
    expect(validateTaskInput({ title: 'a', due_at: '2026-09-01T10:00:00Z' }, opts)).toBeNull()
  })
  it('rejects an assignee who is not a workspace member', () => {
    expect(validateTaskInput({ title: 'a', assignee_id: 'u-ghost' }, opts).field).toBe('assignee_id')
    expect(validateTaskInput({ title: 'a', assignee_id: null }, opts)).toBeNull()
  })
  it('rejects an unknown project', () => {
    expect(validateTaskInput({ title: 'a', project_id: 'p-ghost' }, opts).field).toBe('project_id')
    expect(validateTaskInput({ title: 'a', project_id: 'p-1' }, opts)).toBeNull()
  })
  it('rejects a non-numeric position', () => {
    expect(validateTaskInput({ title: 'a', position: 'top' }, opts).field).toBe('position')
    expect(validateTaskInput({ title: 'a', position: 1536.5 }, opts)).toBeNull()
  })
  it('in partial mode, only validates supplied fields', () => {
    expect(validateTaskInput({ status: 'done' }, { ...opts, partial: true })).toBeNull()
    expect(validateTaskInput({ title: '' },      { ...opts, partial: true }).field).toBe('title')
  })
})

describe('toTimestamp', () => {
  it('treats null and empty string as "clear it"', () => {
    expect(toTimestamp(null)).toBeNull()
    expect(toTimestamp('')).toBeNull()
  })
  it('parses an ISO string', () => {
    expect(toTimestamp('2026-09-01T10:00:00Z')).toEqual(new Date('2026-09-01T10:00:00Z'))
  })
})

describe('isUuid', () => {
  it('accepts a real uuid in either case', () => {
    expect(isUuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true)
    expect(isUuid('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe(true)
  })
  it('rejects anything Postgres would raise on', () => {
    for (const bad of ['', 'x', 'not-a-uuid', '123', null, undefined, 42, {},
                       '3f2504e0-4f89-11d3-9a0c-0305e82c330',      // too short
                       '3f2504e0-4f89-11d3-9a0c-0305e82c33011',    // too long
                       "'; DROP TABLE tasks;--"]) {
      expect(isUuid(bad)).toBe(false)
    }
  })
})
