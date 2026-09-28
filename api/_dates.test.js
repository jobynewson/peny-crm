import { describe, it, expect } from 'vitest'
import {
  isDateString, londonDate, addDays, daysBetween, lastDayOfMonth, toDateString,
  formatDay, formatShortDay, formatMonth,
} from './_dates.js'

describe('isDateString', () => {
  it('accepts real dates only', () => {
    expect(isDateString('2026-10-03')).toBe(true)
    expect(isDateString('2028-02-29')).toBe(true)
    expect(isDateString('2026-02-29')).toBe(false)
    expect(isDateString('2026-13-01')).toBe(false)
    expect(isDateString('3 Oct')).toBe(false)
    expect(isDateString(null)).toBe(false)
  })
})

describe('londonDate', () => {
  it('uses London time, not the server clock', () => {
    // 23:30 UTC on 28 Sep is 00:30 BST on 29 Sep.
    expect(londonDate(new Date('2026-09-28T23:30:00Z'))).toBe('2026-09-29')
    // In winter London is on UTC.
    expect(londonDate(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01')
  })
})

describe('date arithmetic', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('counts days either way', () => {
    expect(daysBetween('2026-10-01', '2026-10-04')).toBe(3)
    expect(daysBetween('2026-10-04', '2026-10-01')).toBe(-3)
    // Across the clocks going back (25 Oct 2026) it is still whole days.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })
  it('finds the last day of a month', () => {
    expect(lastDayOfMonth('2026-10')).toBe('2026-10-31')
    expect(lastDayOfMonth('2026-11')).toBe('2026-11-30')
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29')
  })
  it('reads a DATE column whichever way it arrives', () => {
    expect(toDateString('2026-10-03')).toBe('2026-10-03')
    expect(toDateString(new Date(2026, 9, 3))).toBe('2026-10-03')
    expect(toDateString(null)).toBe(null)
  })
})

describe('display', () => {
  const today = '2026-09-28'
  it('shows the year only when it differs', () => {
    expect(formatDay('2026-10-02', today)).toBe('Fri 2 Oct')
    expect(formatDay('2027-01-08', today)).toBe('Fri 8 Jan 2027')
    expect(formatShortDay('2026-11-07', today)).toBe('7 Nov')
    expect(formatMonth('2026-10-31', today)).toBe('October')
    expect(formatMonth('2027-01-31', today)).toBe('January 2027')
  })
})
