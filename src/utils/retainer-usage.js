// src/utils/retainer-usage.js
// Pure maths for the retainer long-term time-tracking view: how many hours a
// retainer allocates per month, and how much has actually been logged against
// that allocation month by month, cumulatively, and across a 12-month window.
// Everything here is a pure function — unit-tested in retainer-usage.test.js.
//
// TWO CONVENTIONS WORTH KNOWING, because they differ from each other:
//
// 1. CALENDAR MONTHS. This view buckets by calendar month (Mar, Apr, May),
//    NOT by the retainer's anniversary period. The dashboard's current-period
//    bar, monthly-deliverable resets and rollover all use periods anchored on
//    retainer_start's day-of-month (see _retainerPeriod in src/app.js), so for
//    a retainer that started mid-month the "this month" figure here will not
//    match the dashboard's "this period" figure. That is deliberate: the long
//    view is for reading usage against months and invoices, the dashboard bar
//    is for policing the live period.
//
// 2. AMORTISED ITEMS. A retainer item priced per quarter/half/year contributes
//    an evenly amortised share to every month (a 6h quarterly item is 2h in
//    each month), using the same multipliers the dashboard already applies. So
//    a 12-month target is exactly 12x the monthly figure, and a quarterly item
//    lands as 4 quarters' worth over the year rather than lumping into one
//    month.
//
// Rollover (projects.retainer_rollover) is intentionally NOT applied here. It
// shifts unused hours from one period into the next; the cumulative "overall"
// figure already measures total logged against total allocated, so applying
// rollover on top would count the same slack twice.

// Per-month share of an item priced over a given period. Must stay identical
// to the multipliers in src/app.js so the two views never disagree.
export const PERIOD_MULT = { week: 4.33, month: 1, quarter: 1 / 3, half: 1 / 6, year: 1 / 12 }

// Hours in a day, for retainer items measured in days rather than hours.
export const HOURS_PER_DAY = 8

// Guard against a nonsense retainer_start (or a clock skew) producing a
// runaway month list.
const MAX_MONTHS = 600

// Accepts a 'YYYY-MM-DD' string or a Date (the pg driver returns Date objects
// for `date` columns) and returns a UTC Date at midnight, or null.
export function parseDateUTC(value) {
  if (!value) return null
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  }
  const m = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return isNaN(d.getTime()) ? null : d
}

// 'YYYY-MM' bucket key for a date, or null.
export function monthKey(value) {
  const d = parseDateUTC(value)
  if (!d) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Human label for a 'YYYY-MM' key, e.g. "Mar 25".
export function monthLabel(key) {
  const [y, m] = String(key).split('-').map(Number)
  if (!y || !m) return String(key)
  const name = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]
  return `${name} ${String(y).slice(2)}`
}

// Monthly hours contributed by one retainer item, amortised over its period.
export function itemMonthlyHours(item) {
  if (!item) return 0
  const mult = PERIOD_MULT[item.period || 'month'] ?? 1
  const qty = parseFloat(item.qty) || 0
  const hours = item.unit === 'hours' ? qty : qty * HOURS_PER_DAY
  return hours * mult
}

// Total hours a retainer allocates per month. Prefers the itemised breakdown
// and falls back to the legacy flat retainer_hours field, matching the
// precedence used by the dashboard bars in src/app.js.
export function monthlyAllocationHours(project) {
  const items = Array.isArray(project?.retainer_items) ? project.retainer_items : []
  const fromItems = items.reduce((sum, i) => sum + itemMonthlyHours(i), 0)
  if (fromItems > 0) return fromItems
  return parseFloat(project?.retainer_hours) || 0
}

// Every calendar month from `start` through `now`, inclusive, as 'YYYY-MM'.
export function monthRange(start, now = new Date()) {
  const s = parseDateUTC(start)
  const n = parseDateUTC(now) || parseDateUTC(new Date())
  if (!s || !n) return []
  let y = s.getUTCFullYear(), m = s.getUTCMonth()
  const endY = n.getUTCFullYear(), endM = n.getUTCMonth()
  const keys = []
  while ((y < endY || (y === endY && m <= endM)) && keys.length < MAX_MONTHS) {
    keys.push(`${y}-${String(m + 1).padStart(2, '0')}`)
    if (++m > 11) { m = 0; y++ }
  }
  return keys
}

// Sum the `hours` on a list of time entries.
export function sumHours(entries) {
  return (entries || []).reduce((sum, e) => sum + (parseFloat(e?.hours) || 0), 0)
}

// Group entry hours into 'YYYY-MM' buckets.
export function hoursByMonth(entries) {
  const out = new Map()
  for (const e of entries || []) {
    const key = monthKey(e?.entry_date)
    if (!key) continue
    out.set(key, (out.get(key) || 0) + (parseFloat(e?.hours) || 0))
  }
  return out
}

// One block per calendar month from the retainer start to today, each with the
// hours logged in that month and the hours allocated to it.
export function monthlyUsage(project, entries, now = new Date()) {
  const allocated = monthlyAllocationHours(project)
  const logged = hoursByMonth(entries)
  const currentKey = monthKey(now)
  return monthRange(project?.retainer_start, now).map(key => ({
    key,
    label: monthLabel(key),
    logged: logged.get(key) || 0,
    allocated,
    isCurrent: key === currentKey,
  }))
}

// Cumulative usage since the retainer went live. The month in progress counts
// as a full month in the denominator, so this reads as the total commitment
// taken on to date rather than a pro-rata figure.
export function overallUsage(project, entries, now = new Date()) {
  const months = monthRange(project?.retainer_start, now)
  const perMonth = monthlyAllocationHours(project)
  const byMonth = hoursByMonth(entries)
  const inRange = new Set(months)
  let logged = 0, priorLogged = 0
  for (const [key, hours] of byMonth) {
    if (inRange.has(key)) logged += hours
    // Time logged against the project before it became a retainer. Counted
    // nowhere in this view's denominators, but surfaced so the numbers here
    // can be reconciled against the panel's overall "Total tracked".
    else if (months.length && key < months[0]) priorLogged += hours
  }
  return { months: months.length, logged, allocated: months.length * perMonth, priorLogged }
}

// The 12-month window starting at `windowStart` (defaulting to the retainer
// start). Allocation is 12x the monthly figure, which — because items are
// amortised — correctly counts a quarterly item as four quarters over the year.
export function windowUsage(project, entries, windowStart, now = new Date()) {
  const start = parseDateUTC(windowStart) || parseDateUTC(project?.retainer_start)
  const perMonth = monthlyAllocationHours(project)
  if (!start) return { start: null, end: null, logged: 0, allocated: 12 * perMonth, monthsElapsed: 0, complete: false }

  const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()))
  const logged = sumHours((entries || []).filter(e => {
    const d = parseDateUTC(e?.entry_date)
    return d && d >= start && d < end
  }))

  // How far into the window we are, in whole months, capped at 12.
  const n = parseDateUTC(now) || new Date()
  let monthsElapsed = 0
  if (n >= start) {
    monthsElapsed = (n.getUTCFullYear() - start.getUTCFullYear()) * 12 + (n.getUTCMonth() - start.getUTCMonth())
    if (n.getUTCDate() < start.getUTCDate()) monthsElapsed -= 1
    monthsElapsed = Math.max(0, Math.min(12, monthsElapsed + 1))
  }
  // A window whose end has passed is finished, not "month 12 of 12" forever —
  // the caller words it differently so a stale window is obvious.
  return { start, end, logged, allocated: 12 * perMonth, monthsElapsed, complete: n >= end }
}

// Percentage of an allocation used, clamped to 0-100 for bar widths. An
// allocation of zero reads as 0% rather than dividing by zero.
export function usagePct(logged, allocated) {
  if (!(allocated > 0)) return 0
  return Math.min(100, Math.max(0, Math.round((logged / allocated) * 100)))
}

// Bar colour for a usage level, matching the retainer bars in src/app.js:
// purple under the alert threshold, amber at it, red at or over allocation.
export function usageColour(logged, allocated, alertPct = 80) {
  if (!(allocated > 0)) return '#a78bfa'
  const pct = (logged / allocated) * 100
  if (pct >= 100) return '#ef4444'
  if (pct >= (parseFloat(alertPct) || 80)) return '#f59e0b'
  return '#a78bfa'
}

// True if any retainer item is priced over something other than a month, i.e.
// the monthly figures shown are amortised and worth footnoting.
export function hasAmortisedItems(project) {
  const items = Array.isArray(project?.retainer_items) ? project.retainer_items : []
  return items.some(i => (i?.period || 'month') !== 'month' && (parseFloat(i?.qty) || 0) > 0)
}
