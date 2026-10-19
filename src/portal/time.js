// src/portal/time.js
// Logged time for the projects Peny has switched on (view.time, built by
// api/_client-time.js): hours by role, and for a retainer its monthly usage
// against the allocation. Totals only: no names, notes or individual entries.

import { esc } from './util.js'

const hours = n => `${(Math.round(n * 10) / 10).toLocaleString('en-GB')}h`
const pct = (logged, allocated) => (allocated > 0 ? Math.min(100, Math.round((logged / allocated) * 100)) : 0)

function lineHtml(l) {
  const has = l.allocated > 0
  return `
    <li class="pt-time-line">
      <span class="pt-time-label">${esc(l.label)}</span>
      <span class="pt-time-val">${has ? `${hours(l.logged)} <span class="pt-muted">of ${hours(l.allocated)}</span>` : hours(l.logged)}</span>
      ${has ? `<span class="pt-time-bar${l.logged > l.allocated ? ' pt-time-bar--over' : ''}" aria-hidden="true"><span style="width:${pct(l.logged, l.allocated)}%"></span></span>` : ''}
    </li>`
}

function projectTimeHtml(p) {
  const r = p.retainer
  return `
    <article class="pt-card pt-time-card">
      <header class="pt-time-head">
        <h3 class="pt-time-name">${esc(p.name)}</h3>
        <div class="pt-time-total">${hours(p.total)} <span class="pt-muted">logged</span></div>
      </header>
      ${p.roles.length
        ? `<ul class="pt-time-lines">${p.roles.map(x => lineHtml({ label: x.label, logged: x.hours, allocated: 0 })).join('')}</ul>`
        : '<p class="pt-muted">No time logged yet.</p>'}
      ${r ? `
        <details class="pt-time-months">
          <summary>Monthly usage</summary>
          <div class="pt-time-scroll" tabindex="0" role="group" aria-label="Monthly usage, scrolls sideways">
          <div class="pt-time-month"><h4>Since the start (${r.overall.months} month${r.overall.months === 1 ? '' : 's'})</h4><ul class="pt-time-lines">${r.overall.lines.map(lineHtml).join('')}</ul></div>
          ${r.months.map(m => `
            <div class="pt-time-month"><h4>${esc(m.label)}${m.current ? ' <span class="pt-muted">this month</span>' : ''}</h4>
            <ul class="pt-time-lines">${m.lines.length ? m.lines.map(lineHtml).join('') : '<li class="pt-muted">Nothing logged</li>'}</ul></div>`).join('')}
          </div>
        </details>` : ''}
    </article>`
}

export function timeHtml(view) {
  const time = view.time || []
  if (!time.length) return ''
  return `
    <section class="pt-time" aria-labelledby="pt-time-h">
      <h2 class="pt-boards-title" id="pt-time-h">Time <span class="pt-muted">logged by ${esc(view.studio?.name || 'Peny')}</span></h2>
      <p class="pt-time-note pt-muted">Time tracking may take a couple of days to update.</p>
      <div class="pt-time-grid">${time.map(projectTimeHtml).join('')}</div>
    </section>`
}
