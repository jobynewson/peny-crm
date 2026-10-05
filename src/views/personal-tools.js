// src/views/personal-tools.js
// Personal Tools (#personal-tools): a page of cards, one for each tool that is
// only for the signed-in person. To add a tool, add an entry to TOOLS, give it
// a route in app.js (VIEWS and render) and a search command.

import { icon } from './icons.js'

export const TOOLS = [
  { id: 'training', title: 'Training', description: 'An 8-week home strength plan, a session builder and a guided timer. Your sport, your kit, your progress.', icon: 'training', href: '#training' },
]

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export class PersonalToolsView {
  constructor(app) { this.app = app }

  render(mc) {
    mc.innerHTML = `
      <p class="tr-muted" style="margin:0 0 16px">Tools just for you. What you save here is private to your login.</p>
      <div class="card-grid">${TOOLS.map(t => `
        <a class="panel pt-card" href="${esc(t.href)}" data-nav="${esc(t.id)}">
          <span class="pt-card-icon" aria-hidden="true">${icon(t.icon, 22)}</span>
          <span class="pt-card-body"><span class="pt-card-title">${esc(t.title)}</span><span class="pt-card-desc">${esc(t.description)}</span></span>
        </a>`).join('')}</div>`
  }
}
