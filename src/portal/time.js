// src/portal/time.js
// Logged time for the projects Peny has switched on (view.time, built by
// api/_client-time.js), laid out like the Time tab in Slate: a retainer gets its
// contracted terms, overall and 12-month totals and a row of month blocks;
// other projects get hours by role. Totals only: no names, notes or entries.

import { esc, fullDate } from './util.js'

const hours = n => `${(Math.round(n * 10) / 10).toLocaleString('en-GB')}`
const pct = (logged, allocated) => (allocated > 0 ? Math.min(100, Math.round((logged / allocated) * 100)) : 0)
const monthWord = n => `${n} month${n === 1 ? '' : 's'}`

function lineHtml(l, { small = false } = {}) {
  const has = l.allocated > 0
  return `
    <li class="pt-time-line${small ? ' pt-time-line--sm' : ''}">
      <span class="pt-time-label" title="${esc(l.label)}">${esc(l.label)}</span>
      <span class="pt-time-val">${has ? `${hours(l.logged)}<span class="pt-time-of"> / ${hours(l.allocated)}h</span>` : `${hours(l.logged)}h`}</span>
      ${has ? `<span class="pt-time-bar" aria-hidden="true"><span class="pt-time-fill pt-time-fill--${l.level || 'ok'}" style="width:${pct(l.logged, l.allocated)}%"></span></span>` : ''}
    </li>`
}

const linesHtml = (lines, small) => lines.length
  ? `<ul class="pt-time-lines">${lines.map(l => lineHtml(l, { small })).join('')}</ul>`
  : '<p class="pt-time-none">Nothing logged</p>'

function summaryHtml(label, lines, sub) {
  return `
    <div class="pt-time-sum">
      <div class="pt-time-eyebrow">${esc(label)}</div>
      ${linesHtml(lines)}
      ${sub ? `<div class="pt-time-sub">${esc(sub)}</div>` : ''}
    </div>`
}

function retainerHtml(r) {
  return `
    <div class="pt-time-eyebrow pt-time-eyebrow--lead">Retainer usage</div>
    ${r.contract.length ? `
      <div class="pt-time-contract">
        <span class="pt-time-eyebrow">Contracted</span>
        ${r.contract.map(c => `<span class="pt-time-pill">${esc(c.label)} <strong>${hours(c.hours)}h<span class="pt-time-of">/${esc(c.period)}</span></strong></span>`).join('')}
      </div>` : ''}
    <div class="pt-time-sums">
      ${summaryHtml('Overall', r.overall.lines, `${monthWord(r.overall.months)} since ${fullDate(r.overall.since)}`)}
      ${r.window ? summaryHtml('12-month total', r.window.lines,
        `${fullDate(r.window.start)} to ${fullDate(r.window.end)} · ${r.window.complete ? 'window complete' : `month ${r.window.month} of 12`}`) : ''}
    </div>
    <div class="pt-time-months" tabindex="0" role="group" aria-label="Month by month, scrolls sideways" data-time-months>
      ${r.months.map(m => `
        <div class="pt-time-month${m.current ? ' pt-time-month--now' : ''}">
          <div class="pt-time-eyebrow">${esc(m.label)}</div>
          ${linesHtml(m.lines, true)}
        </div>`).join('')}
    </div>
    ${r.notes.length ? `<p class="pt-time-notes">${r.notes.map(esc).join('<br>')}</p>` : ''}`
}

function projectTimeHtml(p) {
  return `
    <article class="pt-time-panel">
      <header class="pt-time-head">
        <h3 class="pt-time-name">${esc(p.name)}</h3>
        <div class="pt-time-total"><span class="pt-time-eyebrow">Total tracked</span> ${hours(p.total)}h</div>
      </header>
      ${p.retainer ? retainerHtml(p.retainer) : (p.roles.length
        ? `<div class="pt-time-eyebrow pt-time-eyebrow--lead">By role</div>${linesHtml(p.roles.map(x => ({ label: x.label, logged: x.hours, allocated: 0 })))}`
        : '<p class="pt-time-none">No time logged yet.</p>')}
    </article>`
}

export function timeHtml(view) {
  const time = view.time || []
  if (!time.length) return ''
  return `
    <section class="pt-time" aria-labelledby="pt-time-h">
      <h2 class="pt-boards-title" id="pt-time-h">Time <span class="pt-muted">logged by ${esc(view.studio?.name || 'Peny')}</span></h2>
      <p class="pt-time-note pt-muted">Time tracking may take a couple of days to update.</p>
      ${time.map(projectTimeHtml).join('')}
    </section>`
}

// Month blocks open scrolled to the latest month, as in Slate.
export function bindTime(root) {
  root.querySelectorAll('[data-time-months]').forEach(el => { el.scrollLeft = el.scrollWidth })
}
