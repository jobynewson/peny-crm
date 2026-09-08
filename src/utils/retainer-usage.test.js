import { describe, it, expect } from 'vitest'
import {
  PERIOD_MULT, HOURS_PER_DAY,
  parseDateUTC, monthKey, monthLabel, monthRange,
  itemMonthlyHours, monthlyAllocationHours,
  sumHours, hoursByMonth, monthlyUsage, overallUsage, windowUsage,
  usagePct, usageColour, hasAmortisedItems,
} from './retainer-usage.js'

const entry = (entry_date, hours, line_label = 'Editing') => ({ entry_date, hours, line_label })
const at = (iso) => new Date(iso + 'T12:00:00Z')

describe('parseDateUTC', () => {
  it('parses YYYY-MM-DD strings', () => {
    expect(parseDateUTC('2025-03-15').toISOString()).toBe('2025-03-15T00:00:00.000Z')
  })
  it('parses full ISO strings by taking the date part', () => {
    expect(parseDateUTC('2025-03-15T00:00:00.000Z').toISOString()).toBe('2025-03-15T00:00:00.000Z')
  })
  it('normalises Date objects to UTC midnight', () => {
    expect(parseDateUTC(new Date(Date.UTC(2025, 2, 15, 9, 30))).toISOString()).toBe('2025-03-15T00:00:00.000Z')
  })
  it('returns null for junk', () => {
    expect(parseDateUTC(null)).toBe(null)
    expect(parseDateUTC('')).toBe(null)
    expect(parseDateUTC('not a date')).toBe(null)
    expect(parseDateUTC(new Date('nope'))).toBe(null)
  })
})

describe('monthKey / monthLabel', () => {
  it('buckets by calendar month', () => {
    expect(monthKey('2025-03-01')).toBe('2025-03')
    expect(monthKey('2025-03-31')).toBe('2025-03')
    expect(monthKey('2025-04-01')).toBe('2025-04')
  })
  it('labels compactly', () => {
    expect(monthLabel('2025-03')).toBe('Mar 25')
    expect(monthLabel('2026-12')).toBe('Dec 26')
  })
})

describe('monthRange', () => {
  it('is inclusive of both the start month and the current month', () => {
    expect(monthRange('2025-03-15', at('2025-05-02'))).toEqual(['2025-03', '2025-04', '2025-05'])
  })
  it('returns a single month when start and now share one', () => {
    expect(monthRange('2025-03-01', at('2025-03-28'))).toEqual(['2025-03'])
  })
  it('crosses year boundaries', () => {
    expect(monthRange('2024-11-01', at('2025-02-10'))).toEqual(['2024-11', '2024-12', '2025-01', '2025-02'])
  })
  it('counts the start month in full even when the retainer began mid-month', () => {
    // Deliberate: this view is calendar-month based, unlike the dashboard's
    // anniversary periods.
    expect(monthRange('2025-03-28', at('2025-04-01'))).toEqual(['2025-03', '2025-04'])
  })
  it('is empty when now precedes the start', () => {
    expect(monthRange('2025-06-01', at('2025-01-01'))).toEqual([])
  })
  it('is empty without a start date', () => {
    expect(monthRange(null, at('2025-01-01'))).toEqual([])
  })
})

describe('itemMonthlyHours', () => {
  it('takes hourly items at face value', () => {
    expect(itemMonthlyHours({ qty: 4, unit: 'hours', period: 'month' })).toBe(4)
  })
  it('converts days to hours', () => {
    expect(itemMonthlyHours({ qty: 2, unit: 'days', period: 'month' })).toBe(2 * HOURS_PER_DAY)
  })
  it('amortises a quarterly item across the months in the quarter', () => {
    expect(itemMonthlyHours({ qty: 6, unit: 'hours', period: 'quarter' })).toBeCloseTo(2, 10)
  })
  it('amortises half-yearly and yearly items', () => {
    expect(itemMonthlyHours({ qty: 12, unit: 'hours', period: 'half' })).toBeCloseTo(2, 10)
    expect(itemMonthlyHours({ qty: 24, unit: 'hours', period: 'year' })).toBeCloseTo(2, 10)
  })
  it('scales weekly items up', () => {
    expect(itemMonthlyHours({ qty: 1, unit: 'hours', period: 'week' })).toBeCloseTo(PERIOD_MULT.week, 10)
  })
  it('defaults a missing period to monthly and handles junk qty', () => {
    expect(itemMonthlyHours({ qty: 3, unit: 'hours' })).toBe(3)
    expect(itemMonthlyHours({ qty: 'abc', unit: 'hours' })).toBe(0)
    expect(itemMonthlyHours(null)).toBe(0)
  })
})

describe('monthlyAllocationHours', () => {
  it('sums the itemised breakdown', () => {
    const p = { retainer_items: [
      { qty: 4, unit: 'hours', period: 'month' },
      { qty: 6, unit: 'hours', period: 'quarter' },
    ] }
    expect(monthlyAllocationHours(p)).toBeCloseTo(6, 10)
  })
  it('falls back to legacy retainer_hours when there are no items', () => {
    expect(monthlyAllocationHours({ retainer_items: [], retainer_hours: '10' })).toBe(10)
  })
  it('prefers items over the legacy field', () => {
    const p = { retainer_items: [{ qty: 4, unit: 'hours', period: 'month' }], retainer_hours: '99' }
    expect(monthlyAllocationHours(p)).toBe(4)
  })
  it('is zero when nothing is configured', () => {
    expect(monthlyAllocationHours({})).toBe(0)
  })
})

describe('hoursByMonth / sumHours', () => {
  it('groups and sums, tolerating string hours from the pg driver', () => {
    const entries = [entry('2025-03-04', '1.5'), entry('2025-03-20', 2), entry('2025-04-02', '0.5')]
    expect(sumHours(entries)).toBeCloseTo(4, 10)
    const by = hoursByMonth(entries)
    expect(by.get('2025-03')).toBeCloseTo(3.5, 10)
    expect(by.get('2025-04')).toBeCloseTo(0.5, 10)
  })
  it('skips entries with unusable dates', () => {
    expect(hoursByMonth([entry(null, 3), entry('junk', 2)]).size).toBe(0)
  })
})

describe('monthlyUsage', () => {
  const project = { retainer_start: '2025-03-01', retainer_items: [{ qty: 1, unit: 'hours', period: 'month' }] }

  it('produces one block per calendar month, including empty ones', () => {
    const blocks = monthlyUsage(project, [entry('2025-03-10', 1), entry('2025-05-02', 1)], at('2025-05-20'))
    expect(blocks.map(b => b.key)).toEqual(['2025-03', '2025-04', '2025-05'])
    expect(blocks.map(b => b.logged)).toEqual([1, 0, 1])
    expect(blocks.every(b => b.allocated === 1)).toBe(true)
  })
  it('flags the month in progress', () => {
    const blocks = monthlyUsage(project, [], at('2025-05-20'))
    expect(blocks.filter(b => b.isCurrent).map(b => b.key)).toEqual(['2025-05'])
  })
})

describe('overallUsage', () => {
  // The example from the brief: three months elapsed, 1h/month budgeted, an
  // hour logged in two of them -> 2 / 3.
  it('matches the worked example', () => {
    const project = { retainer_start: '2025-03-01', retainer_items: [{ qty: 1, unit: 'hours', period: 'month' }] }
    const entries = [entry('2025-03-10', 1), entry('2025-04-14', 1)]
    const u = overallUsage(project, entries, at('2025-05-20'))
    expect(u.months).toBe(3)
    expect(u.logged).toBe(2)
    expect(u.allocated).toBe(3)
  })

  it('counts the month in progress as a full month in the denominator', () => {
    const project = { retainer_start: '2025-03-01', retainer_items: [{ qty: 2, unit: 'hours', period: 'month' }] }
    // One day into May: May still contributes its full 2h to the target.
    const u = overallUsage(project, [], at('2025-05-01'))
    expect(u.months).toBe(3)
    expect(u.allocated).toBe(6)
  })

  it('separates time logged before the retainer went live', () => {
    const project = { retainer_start: '2025-03-01', retainer_items: [{ qty: 1, unit: 'hours', period: 'month' }] }
    const entries = [entry('2025-01-09', 5), entry('2025-03-10', 1)]
    const u = overallUsage(project, entries, at('2025-04-10'))
    expect(u.logged).toBe(1)
    expect(u.priorLogged).toBe(5)
    expect(u.allocated).toBe(2)
  })

  it('handles a quarterly-only retainer', () => {
    const project = { retainer_start: '2025-01-01', retainer_items: [{ qty: 6, unit: 'hours', period: 'quarter' }] }
    const u = overallUsage(project, [entry('2025-02-01', 3)], at('2025-03-15'))
    expect(u.months).toBe(3)
    expect(u.allocated).toBeCloseTo(6, 10)  // 3 months x 2h = one full quarter
    expect(u.logged).toBe(3)
  })

  it('is empty and safe with no retainer start', () => {
    const u = overallUsage({ retainer_items: [] }, [entry('2025-03-01', 2)], at('2025-04-01'))
    expect(u).toEqual({ months: 0, logged: 0, allocated: 0, priorLogged: 0 })
  })
})

describe('windowUsage', () => {
  const project = { retainer_start: '2025-03-15', retainer_items: [{ qty: 4, unit: 'hours', period: 'month' }] }

  it('runs 12 months from the retainer start by default', () => {
    const u = windowUsage(project, [], null, at('2025-06-01'))
    expect(u.start.toISOString().slice(0, 10)).toBe('2025-03-15')
    expect(u.end.toISOString().slice(0, 10)).toBe('2026-03-15')
    expect(u.allocated).toBe(48)
  })

  it('counts only entries inside the window', () => {
    const entries = [
      entry('2025-03-14', 10),  // day before the window opens
      entry('2025-03-15', 1),   // first day, inclusive
      entry('2026-03-14', 2),   // last day, inclusive
      entry('2026-03-15', 10),  // day the window closes, exclusive
    ]
    expect(windowUsage(project, entries, null, at('2026-01-01')).logged).toBe(3)
  })

  it('honours an adjusted window start', () => {
    const u = windowUsage(project, [entry('2025-03-20', 5), entry('2025-07-04', 2)], '2025-06-01', at('2025-08-01'))
    expect(u.start.toISOString().slice(0, 10)).toBe('2025-06-01')
    expect(u.end.toISOString().slice(0, 10)).toBe('2026-06-01')
    expect(u.logged).toBe(2)
  })

  it('multiplies a quarterly item out to four quarters over the year', () => {
    const quarterly = { retainer_start: '2025-01-01', retainer_items: [{ qty: 6, unit: 'hours', period: 'quarter' }] }
    expect(windowUsage(quarterly, [], null, at('2025-06-01')).allocated).toBeCloseTo(24, 10)
  })

  it('tracks how far into the window we are, capped at 12', () => {
    expect(windowUsage(project, [], null, at('2025-03-16')).monthsElapsed).toBe(1)
    expect(windowUsage(project, [], null, at('2025-04-14')).monthsElapsed).toBe(1)
    expect(windowUsage(project, [], null, at('2025-04-15')).monthsElapsed).toBe(2)
    expect(windowUsage(project, [], null, at('2027-01-01')).monthsElapsed).toBe(12)
    expect(windowUsage(project, [], null, at('2024-01-01')).monthsElapsed).toBe(0)
  })
})

describe('usagePct / usageColour', () => {
  it('clamps to 0-100', () => {
    expect(usagePct(2, 4)).toBe(50)
    expect(usagePct(9, 4)).toBe(100)
    expect(usagePct(-1, 4)).toBe(0)
  })
  it('treats a zero allocation as 0% rather than dividing by zero', () => {
    expect(usagePct(3, 0)).toBe(0)
    expect(Number.isFinite(usagePct(3, 0))).toBe(true)
  })
  it('colours by the alert threshold, matching the dashboard bars', () => {
    expect(usageColour(1, 4, 80)).toBe('#a78bfa')
    expect(usageColour(3.2, 4, 80)).toBe('#f59e0b')
    expect(usageColour(4, 4, 80)).toBe('#ef4444')
    expect(usageColour(5, 4, 80)).toBe('#ef4444')
  })
  it('honours a custom alert threshold', () => {
    expect(usageColour(2, 4, 50)).toBe('#f59e0b')
    expect(usageColour(1.9, 4, 50)).toBe('#a78bfa')
  })
})

describe('hasAmortisedItems', () => {
  it('is true when an item is priced over anything but a month', () => {
    expect(hasAmortisedItems({ retainer_items: [{ qty: 6, period: 'quarter' }] })).toBe(true)
  })
  it('is false for a purely monthly retainer', () => {
    expect(hasAmortisedItems({ retainer_items: [{ qty: 4, period: 'month' }, { qty: 2 }] })).toBe(false)
  })
  it('ignores empty items', () => {
    expect(hasAmortisedItems({ retainer_items: [{ qty: 0, period: 'quarter' }] })).toBe(false)
    expect(hasAmortisedItems({})).toBe(false)
  })
})

describe('windowUsage completeness', () => {
  const project = { retainer_start: '2025-03-15', retainer_items: [{ qty: 4, unit: 'hours', period: 'month' }] }
  it('is incomplete while the window is still running', () => {
    expect(windowUsage(project, [], null, at('2026-03-14')).complete).toBe(false)
  })
  it('is complete once the end date has passed, rather than sitting at month 12 forever', () => {
    const u = windowUsage(project, [], null, at('2026-09-08'))
    expect(u.complete).toBe(true)
    expect(u.monthsElapsed).toBe(12)
  })
})
