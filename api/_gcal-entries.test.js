import { describe, it, expect } from 'vitest'
import { buildEntryEvent, isPushableEntry } from './_gcal-entries.js'

const entry = (over = {}) => ({
  id: 'e1', label: 'Brand film', entry_type: 'shoot',
  entry_date: '2026-06-01', end_date: null, is_deadline: false,
  notes: null, project_name: null, ...over,
})

describe('isPushableEntry', () => {
  it('pushes the three entry types the Team Calendar creates', () => {
    expect(isPushableEntry(entry({ entry_type: 'shoot' }))).toBe(true)
    expect(isPushableEntry(entry({ entry_type: 'post_production' }))).toBe(true)
    expect(isPushableEntry(entry({ entry_type: 'other' }))).toBe(true)
  })
  it('leaves `leave` to the leave planner’s own Google sync', () => {
    expect(isPushableEntry(entry({ entry_type: 'leave' }))).toBe(false)
  })
  it('is false for an unknown type or no entry at all', () => {
    expect(isPushableEntry(entry({ entry_type: 'mystery' }))).toBe(false)
    expect(isPushableEntry(null)).toBe(false)
  })
})

describe('buildEntryEvent', () => {
  it('makes a one-day all-day event with an exclusive end date', () => {
    const ev = buildEntryEvent(entry())
    expect(ev.start).toEqual({ date: '2026-06-01' })
    expect(ev.end).toEqual({ date: '2026-06-02' })
    expect(ev.summary).toBe('Brand film')
    expect(ev.transparency).toBe('opaque')
  })

  it('spans to the day after end_date for a multi-day entry', () => {
    const ev = buildEntryEvent(entry({ end_date: '2026-06-03' }))
    expect(ev.start).toEqual({ date: '2026-06-01' })
    expect(ev.end).toEqual({ date: '2026-06-04' })
  })

  it('crosses a month boundary without local-timezone drift', () => {
    const ev = buildEntryEvent(entry({ entry_date: '2026-06-29', end_date: '2026-07-01' }))
    expect(ev.end).toEqual({ date: '2026-07-02' })
  })

  it('accepts the Date / timestamp shapes Neon may hand back for a DATE', () => {
    const ev = buildEntryEvent(entry({
      entry_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date:   '2026-06-03T00:00:00.000Z',
    }))
    expect(ev.start).toEqual({ date: '2026-06-01' })
    expect(ev.end).toEqual({ date: '2026-06-04' })
  })

  it('puts a deadline on its final day only, and never blocks time', () => {
    const ev = buildEntryEvent(entry({ entry_date: '2026-06-01', end_date: '2026-06-05', is_deadline: true }))
    expect(ev.start).toEqual({ date: '2026-06-05' })
    expect(ev.end).toEqual({ date: '2026-06-06' })
    expect(ev.summary).toBe('⚑ Brand film')
    expect(ev.transparency).toBe('transparent')
  })

  it('survives an end_date that precedes the start date', () => {
    const ev = buildEntryEvent(entry({ entry_date: '2026-06-05', end_date: '2026-06-01' }))
    expect(ev.start).toEqual({ date: '2026-06-05' })
    expect(ev.end).toEqual({ date: '2026-06-06' })
  })

  it('describes the project, type and notes, and flags Slate as the source', () => {
    const ev = buildEntryEvent(entry({ project_name: 'Acme', entry_type: 'post_production', notes: 'Grade day' }))
    expect(ev.description).toContain('Project: Acme')
    expect(ev.description).toContain('Type: Post Production')
    expect(ev.description).toContain('Grade day')
    expect(ev.description).toContain('Synced from Slate')
  })

  it('tags the event with the entry id so it can be traced back', () => {
    expect(buildEntryEvent(entry()).extendedProperties.private.slateEntryId).toBe('e1')
  })

  it('colours by type, with deadlines overriding', () => {
    expect(buildEntryEvent(entry({ entry_type: 'shoot' })).colorId).toBe('10')
    expect(buildEntryEvent(entry({ entry_type: 'post_production' })).colorId).toBe('6')
    expect(buildEntryEvent(entry({ entry_type: 'other' })).colorId).toBe('3')
    expect(buildEntryEvent(entry({ entry_type: 'shoot', is_deadline: true })).colorId).toBe('11')
  })
})
