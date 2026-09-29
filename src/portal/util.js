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

// Text with its http(s) links made clickable. The text is escaped first, so
// nothing but the anchors it adds is ever markup. Trailing punctuation stays
// outside the link ("see https://x.test/brief." ends the sentence).
export function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, match => {
    const url = match.replace(/(?:[.,;:!?)]|&amp;)+$/, '')
    const rest = match.slice(url.length)
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${rest}`
  })
}
