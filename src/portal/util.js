// src/portal/util.js
// Small helpers shared by the portal's modules.

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONDON = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })

// "28 Sep" for a moment (the day in London).
export const dayMonth = iso => { const [, m, d] = LONDON.format(new Date(iso)).split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }
// "2 Oct 2026" for a 'YYYY-MM-DD' day.
export const fullDate = ymd => { if (!ymd) return ''; const [y, m, d] = ymd.slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
