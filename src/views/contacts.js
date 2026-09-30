import {
  createContact, updateContact, deleteContact, logActivity, getActivityLog,
} from '../db/client.js'
import { companyFieldHtml, bindCompanyField, resolveCompanyField, companyById, rememberCompany } from './company-field.js'
import { findOrCreateCompany, setCompanyType } from '../api/companies.js'
import { openPortalPanel, leadLine, openLeadForm } from './company-panels.js'
import { COMPANY_TYPES, typeLabel, kindOf, groupContacts, linkSuggestions } from '../utils/contact-kind.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVC = ['av-blue','av-teal','av-coral','av-purple','av-amber','av-green','av-pink']
// A person's own type, used for someone with no company (the old list).
const TL  = { brand:'Brand', agency:'Agency', ngo:'NGO', sport:'Sports', corp:'Corporate', subcontractor:'Subcontractor' }
// Colours for the kind of company (and so of the people in it).
const KC  = { client:'tag-brand', prospect:'tag-agency', subcontractor:'tag-sub', supplier:'tag-sport', other:'tag-corp' }

const ini = c => ((c.first_name?.[0] ?? '') + (c.last_name?.[0] ?? '')).toUpperCase()
const avc = c => AVC[Math.abs(hashCode(c.id)) % AVC.length]
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
const moy = () => { const d = new Date(); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear() }
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function hashCode(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  return h
}

// ── Contacts view ─────────────────────────────────────────────────────────────
// Organised by company. The default view is a list of companies, each with a
// type (client, prospect, subcontractor, supplier, other); a row opens to show
// its people. "Everyone" is the flat list, for when you know the name but not
// the company. People with no company are listed under "No company" — and most
// existing contacts start there — with suggestions to link them that only happen
// when you say so.

export class ContactsView {
  constructor(app) {
    this.app = app
    this.view   = 'companies'   // 'companies' | 'everyone'
    this.type   = 'all'         // 'all' | a company type
    this.filter = 'all'         // a person's status, in Everyone
    this.search = ''
    this.expanded = new Set()   // company ids opened in the list
    this.reviewOpen = false     // the link suggestions
    this._dismissed = new Set() // suggestions set aside this visit
    this.selectedId = null
    this.editingId = null
    this.noteTargetId = null
    this.addCompanyName = ''
  }

  get canEdit() { return this.app.permissions?.contacts_edit !== false }
  get isSuperadmin() { return this.app.appUser?.role === 'superadmin' }

  render(mc) {
    mc.innerHTML = this.html()
    this.bind(mc)
  }

  // The four numbers at the top, each a way into the list below.
  counts() {
    const { contacts, companies } = this.app
    const all = companies || []
    return {
      companies: all.length,
      clients: all.filter(c => c.type === 'client').length,
      subs: all.filter(c => c.type === 'subcontractor').length,
      none: contacts.filter(p => !p.company_id || !all.some(c => c.id === p.company_id)).length,
    }
  }

  html() {
    const n = this.counts()
    const pill = (attr, key, label, active) => `<button class="filter-pill ${active ? 'active' : ''}" data-${attr}="${key}">${label}</button>`
    return `
      <div class="stats-row">
        <div class="stat-card stat-card--link" role="button" tabindex="0" data-stat="all" title="Show every company"><div class="stat-label">Companies</div><div class="stat-value">${n.companies}</div><div class="stat-sub">of every kind</div></div>
        <div class="stat-card stat-card--link" role="button" tabindex="0" data-stat="client" title="Show clients"><div class="stat-label">Clients</div><div class="stat-value">${n.clients}</div><div class="stat-sub">companies</div></div>
        <div class="stat-card stat-card--link" role="button" tabindex="0" data-stat="subcontractor" title="Show subcontractors"><div class="stat-label">Subcontractors</div><div class="stat-value">${n.subs}</div><div class="stat-sub">companies</div></div>
        <div class="stat-card stat-card--link" role="button" tabindex="0" data-stat="none" title="Show people with no company"><div class="stat-label">No company</div><div class="stat-value">${n.none}</div><div class="stat-sub">people</div></div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.view === 'everyone' ? 'Everyone' : 'Companies'}</span>
          <div class="co-switch" role="group" aria-label="View">
            <button class="filter-pill ${this.view === 'companies' ? 'active' : ''}" data-view="companies" style="border-radius:16px">Companies</button>
            <button class="filter-pill ${this.view === 'everyone' ? 'active' : ''}" data-view="everyone" style="border-radius:16px">Everyone</button>
          </div>
          ${pill('type', 'all', 'All', this.type === 'all')}
          ${COMPANY_TYPES.map(t => pill('type', t.key, `${t.label}s`.replace('Otherss', 'Other'), this.type === t.key)).join('')}
        </div>
        ${this.view === 'everyone' ? `
        <div class="panel-header co-sub">
          ${['all', 'Active', 'Warm', 'Cold', 'Retired'].map(s => pill('filter', s, s === 'all' ? 'Any status' : s === 'Warm' ? 'Warm leads' : s, this.filter === s)).join('')}
        </div>` : ''}
        <div id="contact-list">${this.listHTML()}</div>
      </div>
      ${this.modalHTML()}
      ${this.noteModalHTML()}
    `
  }

  // A person's row. `showCompany` adds their company (the Everyone view).
  personRowHTML(c, { showCompany = false } = {}) {
    const kind = kindOf(c, this.app.companies)
    return `
      <div class="contact-row ${this.selectedId === c.id ? 'selected' : ''}" style="grid-template-columns:2fr 1.4fr 1fr 1fr 90px" data-cid="${c.id}">
        <div class="contact-name">
          <div class="avatar ${avc(c)}">${ini(c)}</div>
          <div><div class="name-main">${esc(c.first_name)} ${esc(c.last_name)}</div><div class="name-sub">${esc(c.role)}</div></div>
        </div>
        <div style="font-size:13px;color:var(--text-secondary)">${showCompany ? (companyById(this.app, c.company_id)?.name ? esc(companyById(this.app, c.company_id).name) : (c.company ? `${esc(c.company)} <span class="co-unlinked">(not linked)</span>` : '')) : esc(c.email)}</div>
        <div><span class="tag ${KC[kind] ?? 'tag-corp'}">${typeLabel(kind)}</span></div>
        <div class="status-cell">
          <span class="dot dot-${c.status === 'Active' ? 'active' : c.status === 'Warm' ? 'warm' : 'cold'}"></span>${esc(c.status)}
        </div>
        <div class="actions-cell">
          ${this.canEdit ? `<button class="row-btn" data-edit="${c.id}">Edit</button><button class="row-btn" data-note="${c.id}">+ Note</button>` : ''}
        </div>
      </div>`
  }

  listHTML() {
    return this.view === 'everyone' ? this.everyoneHTML() : this.companiesHTML()
  }

  // Everyone: the flat list, searchable by name, role, email or company.
  everyoneHTML() {
    const { contacts, companies } = this.app
    const { groups, none } = groupContacts({ contacts, companies, type: this.type, search: this.search, status: this.filter })
    const people = [...groups.flatMap(g => g.people), ...none]
      .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, 'en', { sensitivity: 'base' }))
    if (!people.length) return '<div class="empty-state">No one found</div>'
    return `
      <div class="col-header" style="grid-template-columns:2fr 1.4fr 1fr 1fr 90px"><div>Name</div><div>Company</div><div>Kind</div><div>Status</div><div></div></div>
      ${people.map(c => this.personRowHTML(c, { showCompany: true })).join('')}`
  }

  companiesHTML() {
    const { contacts, companies } = this.app
    const { groups, none } = groupContacts({ contacts, companies, type: this.type, search: this.search })
    const suggestions = this.search ? [] : linkSuggestions(contacts, companies).filter(s => !this._dismissed.has(s.key))
    const banner = suggestions.length && this.canEdit ? `
      <div class="co-banner" role="status">
        <span>${count(suggestions.length, 'company name')} typed on people aren’t linked to a company yet.</span>
        <button type="button" class="btn-secondary" data-review>${this.reviewOpen ? 'Hide suggestions' : 'Review them'}</button>
      </div>
      ${this.reviewOpen ? this.suggestionsHTML(suggestions) : ''}` : ''
    if (!groups.length && !none.length) return `${banner}<div class="empty-state">${this.search ? 'Nothing matches' : 'No companies yet. Add a contact and type a company, and it appears here.'}</div>`
    return `
      ${banner}
      ${groups.map(g => this.companyHTML(g)).join('')}
      ${none.length ? `
        <div class="co-group co-group--none">
          <div class="co-row co-row--static"><span class="co-name">No company</span><span class="co-meta">${count(none.length, 'person', 'people')}</span></div>
          <div class="co-body">${none.map(c => this.personRowHTML(c)).join('')}</div>
        </div>` : ''}`
  }

  companyHTML({ company, people, kind, open }) {
    const isOpen = this.expanded.has(company.id) || open
    const projects = (this.app.projects || []).filter(p => p.company_id === company.id).length
    return `
      <div class="co-group" data-co="${company.id}">
        <div class="co-row" role="button" tabindex="0" aria-expanded="${isOpen}" data-co-toggle="${company.id}">
          <span class="co-chevron${isOpen ? ' co-chevron--open' : ''}" aria-hidden="true">▶</span>
          <span class="co-name">${esc(company.name)}${company.sector ? ` <span class="co-sector">${esc(company.sector)}</span>` : ''}</span>
          <span class="tag ${KC[kind] ?? 'tag-corp'}">${typeLabel(kind)}</span>
          ${company.type_reviewed ? '' : '<span class="co-check" title="The type was worked out from its people. Open it to confirm.">check type</span>'}
          <span class="co-meta">${count(people.length, 'person', 'people')}${projects ? ` · ${count(projects, 'project')}` : ''}</span>
        </div>
        ${isOpen ? this.companyBodyHTML(company, people) : ''}
      </div>`
  }

  companyBodyHTML(company, people) {
    return `
      <div class="co-body">
        <div class="co-controls">
          <label class="co-field">Type
            <select data-co-type="${company.id}" ${this.canEdit ? '' : 'disabled'}>
              ${COMPANY_TYPES.map(t => `<option value="${t.key}"${t.key === company.type ? ' selected' : ''}>${t.label}</option>`).join('')}
            </select></label>
          <label class="co-field">Sector <span class="tl-optional">(optional)</span>
            <input data-co-sector="${company.id}" maxlength="60" value="${esc(company.sector)}" placeholder="e.g. Sport" ${this.canEdit ? '' : 'disabled'} /></label>
          ${this.canEdit && !company.type_reviewed ? `<button type="button" class="btn-secondary" data-co-confirm="${company.id}">Looks right</button>` : ''}
          ${this.canEdit ? `<button type="button" class="btn-secondary" data-co-add="${company.id}">+ Person</button>` : ''}
          ${this.isSuperadmin ? `<button type="button" class="btn-secondary" data-co-portal="${company.id}">Portal access</button>` : ''}
          ${leadLine(this.app, { ...company, lead_name: company.lead_name ?? (this.app.allUsers || []).find(u => u.id === company.lead_id)?.name }, { canEdit: this.canEdit }).replace('data-co-lead', `data-co-lead="${company.id}"`)}
        </div>
        ${people.length ? people.map(c => this.personRowHTML(c)).join('') : '<div class="co-empty">No one here yet.</div>'}
      </div>`
  }

  // The matches to confirm: one company name at a time, each person ticked by
  // default. Nothing links until "Link" is pressed.
  suggestionsHTML(suggestions) {
    return `<div class="co-suggest">${suggestions.map(s => `
      <div class="co-suggest-row" data-suggest="${esc(s.key)}">
        <div class="co-suggest-head">
          <strong>“${esc(s.name)}”</strong>
          ${s.company
            ? `<span class="co-meta">→ link to <strong>${esc(s.company.name)}</strong></span>`
            : `<span class="co-meta">→ make a new company, type
                <select data-suggest-type>${COMPANY_TYPES.map(t => `<option value="${t.key}"${t.key === s.suggestedType ? ' selected' : ''}>${t.label}</option>`).join('')}</select></span>`}
        </div>
        <div class="co-suggest-people">${s.people.map(p => `
          <label><input type="checkbox" data-suggest-person="${p.id}" checked /> ${esc(p.first_name)} ${esc(p.last_name)}</label>`).join('')}</div>
        <div class="co-suggest-actions">
          <button type="button" class="btn-primary" data-suggest-link>${s.company ? 'Link the ticked people' : 'Make it and link the ticked people'}</button>
          <button type="button" class="btn-cancel" data-suggest-skip>Not now</button>
        </div>
      </div>`).join('')}</div>`
  }

  modalHTML(c) {
    return `
      <div class="modal-backdrop" id="contact-modal">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title" id="contact-modal-title">${c?'Edit contact':'New contact'}</span>
            <button class="modal-close" data-close="contact-modal">×</button>
          </div>
          <div class="modal-body">
            <div class="field-row">
              <div class="field"><div class="field-label">First name<span class="req">*</span></div><input id="cf-first" type="text" value="${esc(c?.first_name)}" placeholder="Sarah" /></div>
              <div class="field"><div class="field-label">Last name</div><input id="cf-last" type="text" value="${esc(c?.last_name)}" placeholder="Renfrew" /></div>
            </div>
            <div class="field"><div class="field-label">Role / title</div><input id="cf-role" type="text" value="${esc(c?.role)}" placeholder="Marketing Director" /></div>
            <div class="field"><div class="field-label">Company<span style="color:var(--text-tertiary);font-weight:400"> — or last name required</span></div>${companyFieldHtml({ id: 'cf-company', placeholder: 'Kinetic Brand Co.' })}</div>
            <div class="field-row">
              <div class="field"><div class="field-label">Email</div><input id="cf-email" type="email" value="${esc(c?.email)}" /></div>
              <div class="field"><div class="field-label">Phone</div><input id="cf-phone" type="text" value="${esc(c?.phone)}" /></div>
            </div>
            <div class="field-row">
              <div class="field"><div class="field-label">Location</div><input id="cf-location" type="text" value="${esc(c?.location)}" /></div>
              <div class="field" id="cf-type-field"><div class="field-label">Type <span style="color:var(--text-tertiary);font-weight:400">— a company’s own type decides once they have one</span></div>
                <select id="cf-type">
                  ${Object.entries(TL).map(([v,l])=>`<option value="${v}" ${c?.type===v?'selected':''}>${l}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field"><div class="field-label">Status</div>
              <select id="cf-status">
                ${['Active','Warm','Cold','Retired'].map(s=>`<option value="${s}" ${c?.status===s?'selected':''}>${s==='Warm'?'Warm lead':s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" data-close="contact-modal">Cancel</button>
            <button class="btn-primary" id="contact-save-btn">Save contact</button>
          </div>
        </div>
      </div>`
  }

  noteModalHTML() {
    return `
      <div class="modal-backdrop" id="note-modal">
        <div class="modal" style="width:380px">
          <div class="modal-header"><span class="modal-title">Add note</span><button class="modal-close" data-close="note-modal">×</button></div>
          <div class="modal-body">
            <div class="field"><div class="field-label">Note<span class="req">*</span></div><textarea id="nf-text" style="min-height:100px" placeholder="Write your note here..."></textarea></div>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" data-close="note-modal">Cancel</button>
            <button class="btn-primary" id="note-save-btn">Save note</button>
          </div>
        </div>
      </div>`
  }

  detailHTML(c) {
    const clientProjects = this.app.projects.filter(p => p.client_id === c.id)
    const clientBudgets  = this.app.budgets.filter(b => b.client_id === c.id)
    const notes = Array.isArray(c.notes) ? c.notes : []
    const linked = companyById(this.app, c.company_id)
    const companyLine = linked
      ? esc(linked.name)
      : c.company ? `${esc(c.company)} <span style="color:var(--text-tertiary)">(not linked)</span>` : ''
    return `
      <div class="detail-header">
        <div class="detail-avatar ${avc(c)}">${ini(c)}</div>
        <div class="detail-name">${esc(c.first_name)} ${esc(c.last_name)}</div>
        <div class="detail-role">${esc(c.role)} · ${companyLine}</div>
        <div class="detail-tags">
          <span class="tag ${KC[kindOf(c, this.app.companies)] ?? 'tag-corp'}">${typeLabel(kindOf(c, this.app.companies))}</span>
          <span class="tag" style="background:var(--bg-secondary);color:var(--text-secondary)">${c.status}</span>
        </div>
      </div>
      <div class="detail-section">
        <div class="section-title">Contact info</div>
        <div class="info-row"><span class="info-key">Email</span><span class="info-val" style="color:var(--accent-text)">${esc(c.email)||'—'}</span></div>
        <div class="info-row"><span class="info-key">Phone</span><span class="info-val">${esc(c.phone)||'—'}</span></div>
        <div class="info-row"><span class="info-key">Location</span><span class="info-val">${esc(c.location)||'—'}</span></div>
        <div class="info-row"><span class="info-key">Client since</span><span class="info-val">${esc(c.since)||'—'}</span></div>
      </div>
      <div class="detail-section">
        <div class="section-title">Projects</div>
        ${clientProjects.length ? clientProjects.map(p=>`
          <div class="project-chip" data-open-project="${p.id}">
            <span class="project-chip-name">${esc(p.name)}</span>
            <span class="project-chip-badge">${esc(p.status)}</span>
          </div>`).join('') : '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">No projects yet</div>'}
        <button class="dashed-btn" data-new-project="${c.id}">+ new project</button>
      </div>
      <div class="detail-section">
        <div class="section-title">Budgets</div>
        ${clientBudgets.length ? clientBudgets.map(b=>`
          <div class="project-chip" data-open-budget="${b.id}">
            <span class="project-chip-name">${esc(b.name)}</span>
            <span class="project-chip-badge">£${Math.round(parseFloat(b.markup)||0)>0?'···':'—'}</span>
          </div>`).join('') : '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">No budgets yet</div>'}
        <button class="dashed-btn" data-new-budget="${c.id}">+ new budget</button>
      </div>
      <div class="detail-section">
        <div class="section-title">Notes</div>
        ${notes.length ? notes.map(n=>`
          <div class="note-item">
            <div class="note-text">${esc(n.text)}</div>
            <div class="note-date">${esc(n.date)}</div>
          </div>`).join('') : '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">No notes yet</div>'}
        <button class="dashed-btn" data-note="${c.id}">+ add note</button>
      </div>
      <div class="detail-section">
        <div class="section-title">Activity</div>
        <div id="contact-activity-${c.id}" style="font-size:11px;color:var(--text-tertiary)">Loading…</div>
      </div>
      <div class="detail-section">
        <button class="row-btn" style="width:100%;padding:8px;text-align:center;color:var(--danger);border-color:var(--danger-border)" data-delete="${c.id}">Delete contact</button>
      </div>`
  }

  bind(mc) {
    // Search (in topbar)
    const searchEl = document.getElementById('contact-search')
    if (searchEl) {
      searchEl.value = this.search
      searchEl.addEventListener('input', e => { this.search = e.target.value; this.refreshList() })
    }

    // Companies | Everyone
    mc.querySelectorAll('.filter-pill[data-view]').forEach(btn => {
      btn.addEventListener('click', () => { this.view = btn.dataset.view; this.filter = 'all'; this.render(mc) })
    })
    // Kind filter and (Everyone) status filter
    mc.querySelectorAll('.filter-pill[data-type]').forEach(btn => {
      btn.addEventListener('click', () => { this.type = btn.dataset.type; this.render(mc) })
    })
    mc.querySelectorAll('.filter-pill[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => { this.filter = btn.dataset.filter; this.render(mc) })
    })

    // The four numbers are ways into the list.
    mc.querySelectorAll('.stat-card[data-stat]').forEach(card => {
      const apply = () => {
        this.search = ''
        const topSearch = document.getElementById('contact-search')
        if (topSearch) topSearch.value = ''
        const what = card.dataset.stat
        this.view = 'companies'
        this.type = what === 'none' ? 'all' : what
        this.render(mc)
        if (what === 'none') document.querySelector('.co-group--none')?.scrollIntoView({ block: 'start' })
      }
      card.addEventListener('click', apply)
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply() } })
    })

    this.bindList(mc)

    // Modal close
    mc.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => { mc.querySelector(`#${btn.dataset.close}`)?.classList.remove('open') })
    })
    mc.querySelectorAll('.modal-backdrop').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open') })
    })

    // Save contact
    mc.querySelector('#contact-save-btn')?.addEventListener('click', () => this.saveContact(mc))

    // Save note
    mc.querySelector('#note-save-btn')?.addEventListener('click', () => this.saveNote(mc))
  }

  // Everything inside the list, bound again each time the list is redrawn.
  bindList(root) {
    const mc = document.getElementById('main-content') ?? root
    // A person: select; edit; add a note.
    root.querySelectorAll('.contact-row[data-cid]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('button')) return
        this.selectContact(row.dataset.cid)
      })
    })
    root.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); this.openEdit(btn.dataset.edit, mc) }))
    root.querySelectorAll('[data-note]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); this.openNoteModal(btn.dataset.note, mc) }))

    // A company: open or close its people.
    const toggle = el => {
      const id = el.dataset.coToggle
      if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id)
      this.refreshList()
    }
    root.querySelectorAll('[data-co-toggle]').forEach(el => {
      el.addEventListener('click', () => toggle(el))
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(el) } })
    })
    const company = id => (this.app.companies || []).find(c => c.id === id)

    // Its type and sector save as they are changed; "Looks right" confirms the
    // type that was worked out.
    const saveType = async (id, { quiet = false } = {}) => {
      const c = company(id)
      const list = document.getElementById('contact-list')
      const type = list.querySelector(`[data-co-type="${id}"]`).value
      const sector = list.querySelector(`[data-co-sector="${id}"]`).value
      try {
        const updated = await setCompanyType(id, type, sector)
        Object.assign(c, updated)
        if (!quiet) this.app.toast(`${c.name}: ${typeLabel(type)}`)
        this.refreshList()
      } catch (err) { this.app.toast(err.message || 'Could not save that') }
    }
    root.querySelectorAll('[data-co-type]').forEach(el => el.addEventListener('change', () => saveType(el.dataset.coType)))
    root.querySelectorAll('[data-co-sector]').forEach(el => el.addEventListener('change', () => saveType(el.dataset.coSector, { quiet: true })))
    root.querySelectorAll('[data-co-confirm]').forEach(el => el.addEventListener('click', () => saveType(el.dataset.coConfirm)))
    root.querySelectorAll('[data-co-add]').forEach(el => el.addEventListener('click', () => this.openAdd(mc, { company: company(el.dataset.coAdd)?.name })))
    root.querySelectorAll('[data-co-portal]').forEach(el => el.addEventListener('click', () => openPortalPanel(this.app, el, company(el.dataset.coPortal), { onChange: () => this.refreshList() })))
    root.querySelectorAll('[data-co-lead]').forEach(el => el.addEventListener('click', () => openLeadForm(this.app, el, company(el.dataset.coLead), { onSaved: () => this.refreshList() })))

    // Suggestions: show them, set one aside, or link the ticked people.
    root.querySelector('[data-review]')?.addEventListener('click', () => { this.reviewOpen = !this.reviewOpen; this.refreshList() })
    root.querySelectorAll('[data-suggest]').forEach(row => {
      const key = row.dataset.suggest
      row.querySelector('[data-suggest-skip]')?.addEventListener('click', () => { this._dismissed.add(key); this.refreshList() })
      row.querySelector('[data-suggest-link]')?.addEventListener('click', e => this.applySuggestion(key, row, e.currentTarget))
    })
  }

  // One confirmed suggestion: link the ticked people to the company, making it
  // first if it doesn't exist. Nobody is linked that wasn't ticked.
  async applySuggestion(key, row, button) {
    const s = linkSuggestions(this.app.contacts, this.app.companies).find(x => x.key === key)
    const ids = [...row.querySelectorAll('[data-suggest-person]:checked')].map(el => el.dataset.suggestPerson)
    if (!s || !ids.length) { this.app.toast('Tick at least one person'); return }
    button.disabled = true
    try {
      const type = row.querySelector('[data-suggest-type]')?.value
      const target = s.company ?? await findOrCreateCompany(s.name, type)
      rememberCompany(this.app, target)
      for (const id of ids) {
        const [updated] = await updateContact(this.app.userId, id, { company_id: target.id, company: target.name })
        const i = this.app.contacts.findIndex(c => c.id === id)
        if (i >= 0) this.app.contacts[i] = updated
        logActivity(this.app.userId, 'contact', id, `${updated.first_name} ${updated.last_name}`, `Company: ${target.name}`).catch(console.error)
      }
      this.expanded.add(target.id)
      this.app.toast(`Linked ${count(ids.length, 'person', 'people')} to ${target.name}`)
      this.render(document.getElementById('main-content'))
    } catch (err) {
      console.error(err)
      button.disabled = false
      this.app.toast(err.message || 'Could not link them')
    }
  }

  // Select a person and show their detail, opening their company in the list.
  selectContact(cid) {
    const c = this.app.contacts.find(x => x.id === cid)
    this.selectedId = cid
    if (c?.company_id && this.view === 'companies' && !this.expanded.has(c.company_id)) {
      this.expanded.add(c.company_id)
      this.render(document.getElementById('main-content'))
      this.showDetail(cid)
      return
    }
    this.showDetail(cid)
    this.refreshList()
  }

  refreshList() {
    const list = document.getElementById('contact-list')
    if (!list) return
    list.innerHTML = this.listHTML()
    this.bindList(list)
  }

  showDetail(id) {
    const c = this.app.contacts.find(x => x.id === id)
    if (!c) return
    const dp = this.app.container.querySelector('#detail-panel')
    if (!dp) return
    dp.innerHTML = this.detailHTML(c)
    dp.querySelectorAll('[data-open-project]').forEach(el => {
      el.addEventListener('click', () => this.app.openProject(el.dataset.openProject))
    })
    dp.querySelectorAll('[data-open-budget]').forEach(el => {
      el.addEventListener('click', () => this.app.openBudget(el.dataset.openBudget))
    })
    dp.querySelectorAll('[data-new-project]').forEach(el => {
      el.addEventListener('click', () => {
        const clientId = el.dataset.newProject
        this.app.navigate('projects')
        setTimeout(() => {
          const mc = document.getElementById('main-content')
          this.app.projectsView.openNewModal(clientId, null, mc)
        }, 50)
      })
    })
    dp.querySelectorAll('[data-new-budget]').forEach(el => {
      el.addEventListener('click', () => {
        const clientId = el.dataset.newBudget
        this.app.navigate('budgets')
        setTimeout(() => this.app.budgetsView.openNewModal(clientId), 50)
      })
    })
    dp.querySelectorAll('[data-note]').forEach(btn => {
      btn.addEventListener('click', () => this.openNoteModal(btn.dataset.note, document.getElementById('main-content')))
    })
    dp.querySelector('[data-delete]')?.addEventListener('click', () => this.deleteContact(id))

    // Load activity log asynchronously
    getActivityLog(id, 20).then(log => {
      const el = dp.querySelector(`#contact-activity-${id}`)
      if (!el) return
      if (!log.length) { el.textContent = 'No activity yet'; return }
      const fmt = ts => {
        const d = new Date(ts)
        return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
      }
      el.innerHTML = log.map(entry => `
        <div style="padding:5px 0;border-bottom:0.5px solid var(--border-light);display:flex;gap:6px">
          <div style="width:5px;height:5px;border-radius:50%;background:var(--border-strong);flex-shrink:0;margin-top:4px"></div>
          <div>
            <div style="color:var(--text-secondary)">${entry.summary}</div>
            <div style="font-size:10px;color:var(--text-tertiary);margin-top:1px">${fmt(entry.created_at)}</div>
          </div>
        </div>`).join('')
    }).catch(() => {
      const el = dp.querySelector(`#contact-activity-${id}`)
      if (el) el.textContent = 'Could not load activity'
    })
  }

  // `company` (a name) pre-fills the company, from a company's "+ Person".
  openAdd(mc, { company = '' } = {}) {
    this.editingId = null
    mc.querySelector('#contact-modal-title').textContent = 'New contact'
    ;['first','last','role','company','email','phone','location'].forEach(f => {
      const el = mc.querySelector(`#cf-${f}`)
      if (el) el.value = ''
    })
    const companyInput = mc.querySelector('#cf-company')
    if (companyInput) { companyInput.dataset.linked = ''; companyInput.value = company }
    bindCompanyField(companyInput, this.app.companies)
    if (company && companyInput) companyInput.dataset.touched = '1'
    mc.querySelector('#cf-type').value = 'brand'
    mc.querySelector('#cf-status').value = 'Active'
    mc.querySelector('#contact-modal')?.classList.add('open')
  }

  openEdit(id, mc) {
    const c = this.app.contacts.find(x => x.id === id)
    if (!c) return
    this.editingId = id
    mc.querySelector('#contact-modal-title').textContent = 'Edit contact'
    mc.querySelector('#cf-first').value  = c.first_name ?? ''
    mc.querySelector('#cf-last').value   = c.last_name  ?? ''
    mc.querySelector('#cf-role').value   = c.role       ?? ''
    const companyInput = mc.querySelector('#cf-company')
    const linked = companyById(this.app, c.company_id)
    companyInput.value = linked?.name ?? c.company ?? ''
    companyInput.dataset.linked = linked ? '1' : ''
    bindCompanyField(companyInput, this.app.companies, { offerLink: true })
    mc.querySelector('#cf-email').value  = c.email      ?? ''
    mc.querySelector('#cf-phone').value  = c.phone      ?? ''
    mc.querySelector('#cf-location').value = c.location ?? ''
    mc.querySelector('#cf-type').value   = c.type       ?? 'brand'
    mc.querySelector('#cf-status').value = c.status     ?? 'Active'
    mc.querySelector('#contact-modal')?.classList.add('open')
  }

  async saveContact(mc) {
    const first   = mc.querySelector('#cf-first')?.value.trim()
    const last    = mc.querySelector('#cf-last')?.value.trim()
    const company = mc.querySelector('#cf-company')?.value.trim()
    this.app.clearFieldErrors(mc.querySelector('#contact-modal'))
    if (!first) { this.app.fieldError(mc.querySelector('#cf-first'), 'First name is required'); return }
    // A contact needs at least a last name or a company to identify it.
    if (!last && !company) {
      this.app.fieldError(mc.querySelector('#cf-last'), 'Add a last name or a company')
      this.app.fieldError(mc.querySelector('#cf-company'), 'Add a last name or a company')
      return
    }
    // Warn on a case-insensitive first+last duplicate (excluding the one being edited).
    if (last) {
      const dupe = this.app.contacts.find(c =>
        c.id !== this.editingId &&
        (c.first_name || '').trim().toLowerCase() === first.toLowerCase() &&
        (c.last_name || '').trim().toLowerCase() === last.toLowerCase())
      if (dupe) {
        const ok = await this.app.confirm({
          title: `A contact named '${first} ${last}' already exists`,
          message: dupe.company ? `Existing: ${dupe.company}. Add this as a separate contact?` : 'Add this as a separate contact?',
          confirmLabel: 'Add anyway', cancelLabel: 'Cancel', danger: false,
        })
        if (!ok) return
      }
    }
    const data = {
      first_name: first,
      last_name:  last || '',
      role:     mc.querySelector('#cf-role')?.value.trim()     || null,
      company:  company  || null,
      email:    mc.querySelector('#cf-email')?.value.trim()    || null,
      phone:    mc.querySelector('#cf-phone')?.value.trim()    || null,
      location: mc.querySelector('#cf-location')?.value.trim() || null,
      type:     mc.querySelector('#cf-type')?.value   ?? 'brand',
      status:   mc.querySelector('#cf-status')?.value ?? 'Active',
    }
    await this.app.withBusy(mc.querySelector('#contact-save-btn'), async () => {
    try {
      // undefined = leave the link alone; null = no company; else link to it.
      // The old text column keeps the linked company's name for its readers.
      const companyInput = mc.querySelector('#cf-company')
      // A subcontractor added with a new company makes it a subcontractor company.
      const linked = await resolveCompanyField(this.app, companyInput, { isNew: !this.editingId, type: data.type === 'subcontractor' ? 'subcontractor' : undefined })
      if (linked !== undefined) {
        data.company_id = linked?.id ?? null
        data.company    = linked?.name ?? null
      }
      if (this.editingId) {
        const existing = this.app.contacts.find(c => c.id === this.editingId)
        const [updated] = await updateContact(this.app.userId, this.editingId, data)
        const idx = this.app.contacts.findIndex(c => c.id === this.editingId)
        if (idx >= 0) this.app.contacts[idx] = updated
        this.app.toast('Contact updated')
        // Log meaningful changes
        const changes = []
        if (existing?.status !== data.status) changes.push(`Status → ${data.status}`)
        if (existing?.company !== data.company && data.company) changes.push(`Company: ${data.company}`)
        if (existing?.role !== data.role && data.role) changes.push(`Role: ${data.role}`)
        if (changes.length) logActivity(this.app.userId, 'contact', this.editingId, `${first} ${last}`, changes.join(' · ')).catch(console.error)
      } else {
        data.since = moy()
        const [created] = await createContact(this.app.userId, data)
        this.app.contacts.unshift(created)
        this.app.toast('Contact added')
        logActivity(this.app.userId, 'contact', created.id, `${first} ${last}`, 'Contact created').catch(console.error)
      }
      mc.querySelector('#contact-modal')?.classList.remove('open')
      this.render(mc)
    } catch (e) {
      console.error(e)
      this.app.toastError('Error saving contact', () => this.saveContact(mc))
    }
    })
  }

  openNoteModal(id, mc) {
    this.noteTargetId = id
    mc.querySelector('#nf-text').value = ''
    mc.querySelector('#note-modal')?.classList.add('open')
  }

  async saveNote(mc) {
    const text = mc.querySelector('#nf-text')?.value.trim()
    this.app.clearFieldErrors(mc.querySelector('#note-modal'))
    if (!text) { this.app.fieldError(mc.querySelector('#nf-text'), 'Note cannot be empty'); return }
    const c = this.app.contacts.find(x => x.id === this.noteTargetId)
    if (!c) return
    const d = new Date()
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const date = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
    const notes = Array.isArray(c.notes) ? [{ text, date }, ...c.notes] : [{ text, date }]
    await this.app.withBusy(mc.querySelector('#note-save-btn'), async () => {
    try {
      const [updated] = await updateContact(this.app.userId, c.id, { notes })
      const idx = this.app.contacts.findIndex(x => x.id === c.id)
      if (idx >= 0) this.app.contacts[idx] = updated
      mc.querySelector('#note-modal')?.classList.remove('open')
      if (this.selectedId === c.id) this.showDetail(c.id)
      this.app.toast('Note saved')
      logActivity(this.app.userId, 'contact', c.id, `${c.first_name} ${c.last_name}`, `Note added: "${text.slice(0,60)}${text.length>60?'…':''}"` ).catch(console.error)
    } catch (e) {
      console.error(e)
      this.app.toastError('Error saving note', () => this.saveNote(mc))
    }
    })
  }

  async deleteContact(id) {
    const c = this.app.contacts.find(x => x.id === id)
    const cname = c ? `${c.first_name||''} ${c.last_name||''}`.trim() || c.company : ''
    if (!await this.app.confirm({ title: cname ? `Delete contact '${cname}'?` : 'Delete contact?', message: 'This cannot be undone.', confirmLabel: 'Delete' })) return
    try {
      await deleteContact(this.app.userId, id)
      this.app.contacts = this.app.contacts.filter(c => c.id !== id)
      this.selectedId = null
      const dp = this.app.container.querySelector('#detail-panel')
      if (dp) dp.innerHTML = '<div class="detail-empty">Select a contact<br>to view details</div>'
      this.render(document.getElementById('main-content'))
      this.app.toast('Contact deleted')
    } catch (e) {
      console.error(e)
      this.app.toastError('Error deleting contact', () => this.deleteContact(id))
    }
  }
}
