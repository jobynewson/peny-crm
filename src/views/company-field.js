// src/views/company-field.js
// The company field on the contact and project forms. It types like the old
// free-text box but suggests existing companies as you type (a native
// <datalist>, as the password manager's category field does), and on save
// whatever was typed resolves to one company: an existing one with that name,
// ignoring case and spacing, or a new one (POST /api/companies).
//
// No guessing: a new record always resolves its field, but an existing one is
// only linked once someone types in the field or presses Link. Saving it for
// any other reason leaves its link — or lack of one — alone.

import { findOrCreateCompany } from '../api/companies.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// value: what the box shows. linked: whether that's a linked company's name, so
// an unlinked leftover of the old free text can offer to link.
export function companyFieldHtml({ id, value = '', linked = false, placeholder = 'Company name', cls = '' }) {
  return `
    <input type="text" id="${id}"${cls ? ` class="${cls}"` : ''} list="${id}-options" autocomplete="off"
      value="${esc(value)}" placeholder="${esc(placeholder)}" data-linked="${linked ? '1' : ''}" />
    <datalist id="${id}-options"></datalist>
    <div class="company-hint" id="${id}-hint" hidden></div>`
}

// Put the current companies in the suggestions, and — for an existing record
// still carrying old free text — offer to link it.
export function bindCompanyField(input, companies, { offerLink = false } = {}) {
  if (!input) return
  const list = document.getElementById(`${input.id}-options`)
  if (list) list.innerHTML = (companies || []).map(c => `<option value="${esc(c.name)}"></option>`).join('')
  delete input.dataset.touched

  const hint = document.getElementById(`${input.id}-hint`)
  const showLinkOffer = offerLink && input.dataset.linked !== '1' && input.value.trim()
  if (hint) {
    hint.hidden = !showLinkOffer
    hint.innerHTML = showLinkOffer
      ? `Not linked to a company yet. <button type="button" class="company-hint-btn">Link</button>`
      : ''
    hint.querySelector('button')?.addEventListener('click', () => {
      input.dataset.touched = '1'
      hint.textContent = `Links to “${input.value.trim()}” when you save.`
    })
  }
  // Assigned rather than added: forms reuse one input for every record they
  // open, and each open re-binds it.
  input.oninput = () => {
    input.dataset.touched = '1'
    if (hint) hint.hidden = true
  }
}

// Set the field from code (e.g. the chosen contact's company) as if typed.
export function setCompanyField(input, name) {
  if (!input) return
  input.value = name || ''
  input.dataset.touched = '1'
  const hint = document.getElementById(`${input.id}-hint`)
  if (hint) hint.hidden = true
}

// Should saving resolve this field? New records always do; existing ones only
// once someone has typed in the field or pressed Link.
export const companyFieldTouched = (input, { isNew }) => isNew || input?.dataset?.touched === '1'

// Resolves the field for saving:
//   undefined — leave the record's company as it is (untouched existing record)
//   null      — no company (the field was cleared)
//   company   — link to this one ({ id, name, … })
//
// `type` is what a company made here should be (only when it doesn't exist yet);
// without it a new company starts as an unconfirmed Client.
export async function resolveCompanyField(app, input, { isNew, type }) {
  if (!input || !companyFieldTouched(input, { isNew })) return undefined
  const name = input.value.replace(/\s+/g, ' ').trim()
  if (!name) return null
  const company = await findOrCreateCompany(name, type)
  rememberCompany(app, company)
  return company
}

// Keep app.companies (the suggestions) in step with a company just resolved.
export function rememberCompany(app, company) {
  if (!company || !app) return
  app.companies = app.companies || []
  if (app.companies.some(c => c.id === company.id)) return
  app.companies.push(company)
  app.companies.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}

export const companyById = (app, id) => (id && (app.companies || []).find(c => c.id === id)) || null
