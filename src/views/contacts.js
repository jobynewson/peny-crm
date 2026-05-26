import {
  createContact, updateContact, deleteContact, logActivity, getActivityLog,
} from '../db/client.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVC = ['av-blue','av-teal','av-coral','av-purple','av-amber','av-green','av-pink']
const TL  = { brand:'Brand', agency:'Agency', ngo:'NGO', sport:'Sports', corp:'Corporate', subcontractor:'Subcontractor' }
const TC  = { brand:'tag-brand', agency:'tag-agency', ngo:'tag-ngo', sport:'tag-sport', corp:'tag-corp', subcontractor:'tag-sub' }

const ini = c => ((c.first_name?.[0] ?? '') + (c.last_name?.[0] ?? '')).toUpperCase()
const avc = c => AVC[Math.abs(hashCode(c.id)) % AVC.length]
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
const moy = () => { const d = new Date(); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear() }

function hashCode(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  return h
}

// ── Contacts view ─────────────────────────────────────────────────────────────

export class ContactsView {
  constructor(app) {
    this.app = app
    this.filter = 'all'
    this.view   = 'clients'  // 'clients' | 'subbies'
    this.search = ''
    this.selectedId = null
    this.editingId = null
    this.noteTargetId = null
  }

  render(mc) {
    mc.innerHTML = this.html()
    this.bind(mc)
  }

  html() {
    const { contacts } = this.app
    return `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Total contacts</div><div class="stat-value">${contacts.filter(c=>c.type!=='subcontractor').length}</div><div class="stat-sub">clients</div></div>
        <div class="stat-card"><div class="stat-label">Active clients</div><div class="stat-value">${contacts.filter(c=>c.type!=='subcontractor'&&c.status==='Active').length}</div><div class="stat-sub">in live projects</div></div>
        <div class="stat-card"><div class="stat-label">Subcontractors</div><div class="stat-value">${contacts.filter(c=>c.type==='subcontractor'&&c.status!=='Retired').length}</div><div class="stat-sub">active</div></div>
        <div class="stat-card"><div class="stat-label">Warm leads</div><div class="stat-value">${contacts.filter(c=>c.type!=='subcontractor'&&c.status==='Warm').length}</div><div class="stat-sub">needs follow-up</div></div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.view==='subbies'?'Subcontractors':'Clients'}</span>
          <div style="display:flex;gap:4px;margin-right:8px;background:var(--bg-secondary);border-radius:var(--radius-pill);padding:3px">
            <button class="filter-pill ${this.view==='clients'?'active':''}" data-view="clients" style="border-radius:16px">Clients</button>
            <button class="filter-pill ${this.view==='subbies'?'active':''}" data-view="subbies" style="border-radius:16px">Subbies</button>
          </div>
          <button class="filter-pill ${this.filter==='all'?'active':''}" data-filter="all">All</button>
          <button class="filter-pill ${this.filter==='Active'?'active':''}" data-filter="Active">Active</button>
          ${this.view==='clients' ? `<button class="filter-pill ${this.filter==='Warm'?'active':''}" data-filter="Warm">Warm leads</button>
          <button class="filter-pill ${this.filter==='Cold'?'active':''}" data-filter="Cold">Cold</button>` :
          `<button class="filter-pill ${this.filter==='Retired'?'active':''}" data-filter="Retired">Retired</button>`}
        </div>
        <div class="col-header" style="grid-template-columns:2fr 1.4fr 1fr 1fr 90px">
          <div>Name</div><div>Company</div><div>Type</div><div>Status</div><div></div>
        </div>
        <div id="contact-list">${this.listHTML()}</div>
      </div>
      ${this.modalHTML()}
      ${this.noteModalHTML()}
    `
  }

  listHTML() {
    const filtered = this.app.contacts.filter(c => {
      const q = this.search.toLowerCase()
      const matchQ = !q || (c.first_name+' '+c.last_name).toLowerCase().includes(q) || (c.company??'').toLowerCase().includes(q)
      const matchF = this.filter === 'all' || c.status === this.filter
      const matchV = this.view === 'subbies' ? c.type === 'subcontractor' : c.type !== 'subcontractor'
      return matchQ && matchF && matchV
    })
    if (!filtered.length) return '<div class="empty-state">No contacts found</div>'
    return filtered.map(c => `
      <div class="contact-row ${this.selectedId===c.id?'selected':''}" style="grid-template-columns:2fr 1.4fr 1fr 1fr 90px" data-cid="${c.id}">
        <div class="contact-name">
          <div class="avatar ${avc(c)}">${ini(c)}</div>
          <div><div class="name-main">${esc(c.first_name)} ${esc(c.last_name)}</div><div class="name-sub">${esc(c.role)}</div></div>
        </div>
        <div style="font-size:13px;color:var(--text-secondary)">${esc(c.company)}</div>
        <div><span class="tag ${TC[c.type]??'tag-corp'}">${TL[c.type]??c.type}</span></div>
        <div class="status-cell">
          <span class="dot dot-${c.status==='Active'?'active':c.status==='Warm'?'warm':c.status==='Retired'?'cold':'cold'}"></span>${c.status}
        </div>
        <div class="actions-cell">
          <button class="row-btn" data-edit="${c.id}">Edit</button>
          <button class="row-btn" data-note="${c.id}">+ Note</button>
        </div>
      </div>`).join('')
  }

  modalHTML(c) {
    return `
      <div class="modal-backdrop" id="contact-modal">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title" id="contact-modal-title">${c?'Edit contact':'Add contact'}</span>
            <button class="modal-close" data-close="contact-modal">×</button>
          </div>
          <div class="modal-body">
            <div class="field-row">
              <div class="field"><div class="field-label">First name</div><input id="cf-first" type="text" value="${esc(c?.first_name)}" placeholder="Sarah" /></div>
              <div class="field"><div class="field-label">Last name</div><input id="cf-last" type="text" value="${esc(c?.last_name)}" placeholder="Renfrew" /></div>
            </div>
            <div class="field"><div class="field-label">Role / title</div><input id="cf-role" type="text" value="${esc(c?.role)}" placeholder="Marketing Director" /></div>
            <div class="field"><div class="field-label">Company</div><input id="cf-company" type="text" value="${esc(c?.company)}" placeholder="Kinetic Brand Co." /></div>
            <div class="field-row">
              <div class="field"><div class="field-label">Email</div><input id="cf-email" type="email" value="${esc(c?.email)}" /></div>
              <div class="field"><div class="field-label">Phone</div><input id="cf-phone" type="text" value="${esc(c?.phone)}" /></div>
            </div>
            <div class="field-row">
              <div class="field"><div class="field-label">Location</div><input id="cf-location" type="text" value="${esc(c?.location)}" /></div>
              <div class="field"><div class="field-label">Type</div>
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
            <div class="field"><div class="field-label">Note</div><textarea id="nf-text" style="min-height:100px" placeholder="Write your note here..."></textarea></div>
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
    return `
      <div class="detail-header">
        <div class="detail-avatar ${avc(c)}">${ini(c)}</div>
        <div class="detail-name">${esc(c.first_name)} ${esc(c.last_name)}</div>
        <div class="detail-role">${esc(c.role)} · ${esc(c.company)}</div>
        <div class="detail-tags">
          <span class="tag ${TC[c.type]??'tag-corp'}">${TL[c.type]??c.type}</span>
          <span class="tag" style="background:var(--bg-secondary);color:var(--text-secondary)">${c.status}</span>
        </div>
      </div>
      <div class="detail-section">
        <div class="section-title">Contact info</div>
        <div class="info-row"><span class="info-key">Email</span><span class="info-val" style="color:#0d4a8a">${esc(c.email)||'—'}</span></div>
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
        <button class="row-btn" style="width:100%;padding:8px;text-align:center;color:#b03020;border-color:rgba(180,50,30,0.25)" data-delete="${c.id}">Delete contact</button>
      </div>`
  }

  bind(mc) {
    // Search (in topbar)
    const searchEl = document.getElementById('contact-search')
    if (searchEl) {
      searchEl.value = this.search
      searchEl.addEventListener('input', e => { this.search = e.target.value; this.refreshList() })
    }

    // Filter pills
    mc.querySelectorAll('.filter-pill[data-view]').forEach(btn => {
      btn.addEventListener('click', () => { this.view = btn.dataset.view; this.filter = 'all'; this.render(mc) })
    })
    mc.querySelectorAll('.filter-pill[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => { this.filter = btn.dataset.filter; this.render(mc) })
    })

    // Row clicks → select contact
    mc.querySelectorAll('.contact-row[data-cid]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('button')) return
        this.selectedId = row.dataset.cid
        this.showDetail(row.dataset.cid)
        this.refreshList()
      })
    })

    // Edit buttons
    mc.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.openEdit(btn.dataset.edit, mc) })
    })

    // Note buttons
    mc.querySelectorAll('[data-note]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.openNoteModal(btn.dataset.note, mc) })
    })

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

  refreshList() {
    const list = document.getElementById('contact-list')
    if (list) list.innerHTML = this.listHTML()
    // Re-bind row events
    list?.querySelectorAll('.contact-row[data-cid]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('button')) return
        this.selectedId = row.dataset.cid
        this.showDetail(row.dataset.cid)
        this.refreshList()
      })
    })
    list?.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.openEdit(btn.dataset.edit, document.getElementById('main-content')) })
    })
    list?.querySelectorAll('[data-note]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.openNoteModal(btn.dataset.note, document.getElementById('main-content')) })
    })
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

  openAdd(mc) {
    this.editingId = null
    mc.querySelector('#contact-modal-title').textContent = 'Add contact'
    ;['first','last','role','company','email','phone','location'].forEach(f => {
      const el = mc.querySelector(`#cf-${f}`)
      if (el) el.value = ''
    })
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
    mc.querySelector('#cf-company').value = c.company   ?? ''
    mc.querySelector('#cf-email').value  = c.email      ?? ''
    mc.querySelector('#cf-phone').value  = c.phone      ?? ''
    mc.querySelector('#cf-location').value = c.location ?? ''
    mc.querySelector('#cf-type').value   = c.type       ?? 'brand'
    mc.querySelector('#cf-status').value = c.status     ?? 'Active'
    mc.querySelector('#contact-modal')?.classList.add('open')
  }

  async saveContact(mc) {
    const first = mc.querySelector('#cf-first')?.value.trim()
    const last  = mc.querySelector('#cf-last')?.value.trim()
    if (!first || !last) { this.app.toast('Please enter a name'); return }
    const data = {
      first_name: first,
      last_name:  last,
      role:     mc.querySelector('#cf-role')?.value.trim()     || null,
      company:  mc.querySelector('#cf-company')?.value.trim()  || null,
      email:    mc.querySelector('#cf-email')?.value.trim()    || null,
      phone:    mc.querySelector('#cf-phone')?.value.trim()    || null,
      location: mc.querySelector('#cf-location')?.value.trim() || null,
      type:     mc.querySelector('#cf-type')?.value   ?? 'brand',
      status:   mc.querySelector('#cf-status')?.value ?? 'Active',
    }
    try {
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
      this.app.toast('Error saving contact')
    }
  }

  openNoteModal(id, mc) {
    this.noteTargetId = id
    mc.querySelector('#nf-text').value = ''
    mc.querySelector('#note-modal')?.classList.add('open')
  }

  async saveNote(mc) {
    const text = mc.querySelector('#nf-text')?.value.trim()
    if (!text) { this.app.toast('Note cannot be empty'); return }
    const c = this.app.contacts.find(x => x.id === this.noteTargetId)
    if (!c) return
    const d = new Date()
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const date = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
    const notes = Array.isArray(c.notes) ? [{ text, date }, ...c.notes] : [{ text, date }]
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
      this.app.toast('Error saving note')
    }
  }

  async deleteContact(id) {
    if (!confirm('Delete this contact? This cannot be undone.')) return
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
      this.app.toast('Error deleting contact')
    }
  }
}
