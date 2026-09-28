// api/_dates.js
// Calendar dates as 'YYYY-MM-DD' strings (Postgres DATE), and "today" in the
// studio's time zone rather than the server's (Vercel runs in UTC, so near
// midnight in BST the two disagree about which day it is). Pure, so the rules
// built on it can be unit-tested.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

export const TIME_ZONE = 'Europe/London'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

// A real calendar date in 'YYYY-MM-DD' form (so not 2026-02-30).
export function isDateString(v) {
  if (typeof v !== 'string') return false
  const m = DATE_RE.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

// The London calendar date of an instant — today by default.
export function londonDate(instant = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(instant))
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// Whole days from `from` to `to`; negative when `to` is earlier.
export function daysBetween(from, to) {
  const utc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((utc(to) - utc(from)) / 86400000)
}

// 'YYYY-MM' → that month's last day.
export function lastDayOfMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

// A DATE column as 'YYYY-MM-DD'. The pg / Neon parsers hand DATE values over
// as a Date at local midnight, so read it back with the local getters.
export function toDateString(v) {
  if (!v) return null
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  return String(v).slice(0, 10)
}

// Display helpers, assembled from parts so punctuation can't vary between ICU
// versions (Node and browsers disagree on "Fri, 8 Jan 2027"). The year is only
// shown when it isn't `today`'s.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const parts = date => {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}
const yearSuffix = (date, today) => (date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : '')

export const formatDay = (date, today) => {           // "Fri 3 Oct"
  const { m, d, wd } = parts(date)
  return `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}${yearSuffix(date, today)}`
}
export const formatShortDay = (date, today) => {      // "3 Oct"
  const { m, d } = parts(date)
  return `${d} ${MONTHS[m - 1]}${yearSuffix(date, today)}`
}
export const formatMonth = (date, today) =>           // "October"
  `${MONTHS_LONG[parts(date).m - 1]}${yearSuffix(date, today)}`
