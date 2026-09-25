// Pieces for the page toolbar, the first row of every list page (see
// App.toolbarHtml). A page that wants its own tabs, filters or main action
// there implements toolbar() → { tabs, filters, actions } (HTML strings, any
// of them optional) and bindToolbar(bar).

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Sub-view tabs within one page (Leave, Settings, Marketing): the same
 * segmented control as the Projects switcher. They're buttons rather than
 * links because they don't change the URL.
 * @param {string} label  accessible name for the group
 * @param {{ id: string, label: string, count?: number }[]} tabs
 * @param {string} current
 */
export function segTabs(label, tabs, current) {
  return `<div class="seg view-switch" role="group" aria-label="${esc(label)}">${tabs.map(t =>
    `<button type="button" class="seg-btn" data-seg-tab="${esc(t.id)}"${t.id === current ? ' aria-current="true"' : ''}>${esc(t.label)}${t.count ? ` <span class="seg-count">${t.count}</span>` : ''}</button>`).join('')}</div>`
}

export function bindSegTabs(bar, onPick) {
  bar?.querySelectorAll('[data-seg-tab]').forEach(btn => btn.addEventListener('click', () => onPick(btn.dataset.segTab)))
}

/** A search field for the toolbar's filters slot (same look as Contacts). */
export function toolbarSearch({ id, label, placeholder, value = '', wide = false }) {
  return `<div class="search-wrap${wide ? ' search-wrap--wide' : ''}"><label for="${id}" class="visually-hidden">${esc(label)}</label><span class="search-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg></span><input type="text" id="${id}" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off" /></div>`
}
