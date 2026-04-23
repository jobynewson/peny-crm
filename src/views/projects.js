import { createProject, updateProject, deleteProject, linkBudgetToProject, unlinkBudgetFromProject, logActivity, getActivityLog, getTimeEntries, setTrackToken, deleteTimeEntry, getWorkLog, addWorkLogEntry, deleteWorkLogEntry } from '../db/client.js'

const STAGES = ['Enquiry','Pre-production','In Production','Post','Delivered']
const RETAINER_STAGE = 'Retainer'
const ALL_STAGES = [...STAGES, RETAINER_STAGE]
const STAGE_DOT = { Enquiry:'#b5d4f4', 'Pre-production':'#dddaf7', 'In Production':'#d0e8b0', Post:'#fce2b0', Delivered:'#ebebeb' }
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
const moy = () => { const d = new Date(); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear() }

export class ProjectsView {
  constructor(app) {
    this.app = app
    this.currentId = null
    this.editingId = null  // which project is in edit mode (null = view mode)
  }

  render(mc) {
    if (this.currentId) {
      if (this.editingId === this.currentId) {
        this.renderEditor(mc)
      } else {
        this.renderViewer(mc)
      }
    } else {
      this.renderKanban(mc)
    }
  }

  // ── Kanban ──────────────────────────────────────────────────────────────────

  renderKanban(mc) {
    const { projects, contacts } = this.app
    const regularProjects  = projects.filter(p => !p.is_retainer)
    const retainerProjects = projects.filter(p => p.is_retainer)
    mc.innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${regularProjects.length}</div><div class="stat-sub">projects</div></div>
        ${STAGES.slice(0,3).map(s=>`<div class="stat-card"><div class="stat-label">${s}</div><div class="stat-value">${regularProjects.filter(p=>p.status===s).length}</div><div class="stat-sub">projects</div></div>`).join('')}
        <div class="stat-card"><div class="stat-label">Retainers</div><div class="stat-value">${retainerProjects.length}</div><div class="stat-sub">active</div></div>
      </div>
      <div class="kanban-wrap" style="grid-template-columns:repeat(6,1fr)">
        ${STAGES.map(stage => {
          const col = regularProjects.filter(p => p.status === stage)
          return `<div class="kanban-col">
            <div class="kanban-col-head">
              <span style="width:8px;height:8px;border-radius:50%;background:${STAGE_DOT[stage]};border:1px solid rgba(0,0,0,0.15);display:inline-block;flex-shrink:0"></span>
              ${stage} <span class="kanban-count">${col.length}</span>
            </div>
            ${col.map(p => {
              const cl = contacts.find(c => c.id === p.client_id)
              const delivs = Array.isArray(p.deliverables) ? p.deliverables : []
              const done = delivs.filter(d => d.done && d.text).length
              const total = delivs.filter(d => d.text).length
              const linked = Array.isArray(p.budget_ids) ? p.budget_ids.length : 0
              return `<div class="kanban-card" data-open="${p.id}">
                <div class="kanban-card-title">${esc(p.name)}</div>
                <div class="kanban-card-client">${cl ? esc(cl.first_name)+' '+esc(cl.last_name)+' · '+esc(cl.company) : 'No client'}</div>
                <div class="kanban-card-meta">
                  ${p.shoot_start ? `<span class="kanban-card-date">${p.shoot_start}</span>` : ''}
                  ${total ? `<span class="tag" style="background:var(--bg-secondary);color:var(--text-secondary)">${done}/${total} done</span>` : ''}
                  ${linked ? `<span class="tag" style="background:#daeeff;color:#0d4a8a">${linked} budget${linked>1?'s':''}</span>` : ''}
                </div>
              </div>`
            }).join('')}
            <button class="kanban-add" data-stage="${stage}">+ add</button>
          </div>`
        }).join('')}
        <div class="kanban-col">
          <div class="kanban-col-head">
            <span style="width:8px;height:8px;border-radius:50%;background:#a78bfa;border:1px solid rgba(0,0,0,0.15);display:inline-block;flex-shrink:0"></span>
            Retainer <span class="kanban-count">${retainerProjects.length}</span>
          </div>
          ${retainerProjects.map(p => {
            const cl = contacts.find(c => c.id === p.client_id)
            const isEnquiry = p.status === 'Enquiry'
            const calcFee = (p.retainer_items||[]).reduce((s,i) => {
              const mult = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}[i.period||'month']||1
              return s + (parseFloat(i.rate)||0)*(parseFloat(i.qty)||0)*mult
            }, 0)
            const fee = p.retainer_fee_mode === 'calculated' ? calcFee : (parseFloat(p.retainer_fee)||0)
            return `<div class="kanban-card" data-open="${p.id}" style="border-left:3px solid ${isEnquiry?'#c4a8fb':'#a78bfa'}">
              <div class="kanban-card-title">${esc(p.name)}</div>
              <div class="kanban-card-client">${cl ? esc(cl.first_name)+' '+esc(cl.last_name)+' · '+esc(cl.company) : 'No client'}</div>
              <div class="kanban-card-meta">
                ${fee ? `<span class="tag" style="background:rgba(167,139,250,0.15);color:#a78bfa">£${Math.round(fee).toLocaleString('en-GB')}/mo</span>` : ''}
                ${isEnquiry ? `<span class="tag" style="background:rgba(167,139,250,0.1);color:#c4a8fb;border:0.5px solid rgba(167,139,250,0.3)">Enquiry</span>` : ''}
              </div>
            </div>`
          }).join('')}
          <button class="kanban-add" data-stage="${RETAINER_STAGE}" data-is-retainer="1">+ add retainer</button>
        </div>
      </div>
      ${this.newModalHTML()}
    `
    mc.querySelectorAll('.kanban-card[data-open]').forEach(el => {
      el.addEventListener('click', () => { this.currentId = el.dataset.open; this.render(mc); this.app.updateTitle() })
    })
    mc.querySelectorAll('.kanban-add[data-stage]').forEach(btn => {
      btn.addEventListener('click', () => this.openNewModal(null, btn.dataset.stage, mc, !!btn.dataset.isRetainer))
    })
    mc.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => mc.querySelector(`#${btn.dataset.close}`)?.classList.remove('open'))
    })
    mc.querySelectorAll('.modal-backdrop').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open') })
    })
    mc.querySelector('#proj-save-btn')?.addEventListener('click', () => this.saveNew(mc))
    mc.querySelector('#pf-new-contact-toggle')?.addEventListener('click', () => {
      const panel  = mc.querySelector('#pf-new-contact-panel')
      const client = mc.querySelector('#pf-client')
      const toggle = mc.querySelector('#pf-new-contact-toggle span')
      const isOpen = panel.style.display !== 'none'
      panel.style.display = isOpen ? 'none' : 'block'
      if (client) { client.disabled = !isOpen; client.style.opacity = isOpen ? '' : '0.4' }
      if (toggle) toggle.textContent = isOpen ? '+ Add new contact instead' : '− Use existing contact instead'
    })

    // AI import
    mc.querySelector('#pf-ai-toggle')?.addEventListener('click', () => {
      const panel = mc.querySelector('#pf-ai-panel')
      const btn   = mc.querySelector('#pf-ai-toggle')
      const open  = panel.style.display === 'none'
      panel.style.display = open ? 'block' : 'none'
      btn.textContent = open ? 'Hide' : 'Paste text'
    })

    mc.querySelector('#pf-ai-extract')?.addEventListener('click', async () => {
      const text = mc.querySelector('#pf-ai-text')?.value.trim()
      if (!text) { this.app.toast('Paste some text first'); return }

      const statusEl = mc.querySelector('#pf-ai-status')
      const extractBtn = mc.querySelector('#pf-ai-extract')
      statusEl.style.display = 'block'
      statusEl.textContent = '✨ Extracting project details…'
      extractBtn.disabled = true

      try {
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()

        // Fill project fields
        if (data.project_name) {
          const nameEl = mc.querySelector('#pf-name')
          if (nameEl) nameEl.value = data.project_name
        }

        // Fill brief
        if (data.brief) {
          mc.querySelector('#pf-brief-field').style.display = 'block'
          const briefEl = mc.querySelector('#pf-brief')
          if (briefEl) briefEl.value = data.brief
        }

        // Client matching — fuzzy match against existing contacts
        if (data.client) {
          const { first_name, last_name, company } = data.client
          const searchName = `${first_name||''} ${last_name||''}`.toLowerCase().trim()
          const searchCo   = (company||'').toLowerCase().trim()

          const match = this.app.contacts.find(c => {
            const cName = `${c.first_name||''} ${c.last_name||''}`.toLowerCase().trim()
            const cCo   = (c.company||'').toLowerCase().trim()
            return (searchName && cName.includes(searchName)) ||
                   (searchName && searchName.includes(cName) && cName.length > 2) ||
                   (searchCo   && cCo.length > 2 && (cCo.includes(searchCo) || searchCo.includes(cCo)))
          })

          if (match) {
            const clientEl = mc.querySelector('#pf-client')
            if (clientEl) clientEl.value = match.id
            statusEl.textContent = `✓ Matched client: ${match.first_name} ${match.last_name}${match.company ? ' — ' + match.company : ''}`
            statusEl.style.color = 'var(--green, #5a9a5a)'
          } else {
            // No match — show new contact panel pre-filled
            const panel  = mc.querySelector('#pf-new-contact-panel')
            const client = mc.querySelector('#pf-client')
            const toggle = mc.querySelector('#pf-new-contact-toggle span')
            panel.style.display = 'block'
            if (client) { client.disabled = true; client.style.opacity = '0.4' }
            if (toggle) toggle.textContent = '− Use existing contact instead'
            const set = (id, val) => { const el = mc.querySelector(id); if (el && val) el.value = val }
            set('#pf-nc-first',   data.client.first_name)
            set('#pf-nc-last',    data.client.last_name)
            set('#pf-nc-company', data.client.company)
            set('#pf-nc-email',   data.client.email)
            set('#pf-nc-phone',   data.client.phone)
            statusEl.textContent = `New contact pre-filled — review details below`
            statusEl.style.color = 'var(--accent)'
          }
        } else {
          statusEl.textContent = '✓ Details extracted — no client identified'
          statusEl.style.color = 'var(--text-tertiary)'
        }

        // Collapse the textarea
        mc.querySelector('#pf-ai-panel').style.display = 'none'
        mc.querySelector('#pf-ai-toggle').textContent = 'Paste text'

      } catch(e) {
        console.error(e)
        statusEl.textContent = '⚠ Extraction failed — check your API key or try again'
        statusEl.style.color = '#e07070'
      } finally {
        extractBtn.disabled = false
      }
    })
  }

  newModalHTML() {
    const { contacts } = this.app
    return `
      <div class="modal-backdrop" id="proj-new-modal">
        <div class="modal" style="width:500px">
          <div class="modal-header"><span class="modal-title">New project</span><button class="modal-close" data-close="proj-new-modal">×</button></div>
          <div class="modal-body">

            <!-- AI import panel -->
            <div style="background:linear-gradient(135deg,rgba(167,139,250,0.08),rgba(74,144,217,0.08));border:0.5px solid rgba(167,139,250,0.3);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:12px;font-weight:500;color:var(--purple)">✨ Import from email / brief</span>
                <button id="pf-ai-toggle" class="btn-cancel" style="font-size:11px;padding:3px 8px">Paste text</button>
              </div>
              <div id="pf-ai-panel" style="display:none">
                <textarea id="pf-ai-text" placeholder="Paste your email thread, brief, or any project info here…" style="width:100%;min-height:100px;padding:8px 10px;font-size:12px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.5;margin-bottom:8px"></textarea>
                <button id="pf-ai-extract" class="btn-primary" style="font-size:12px;width:100%">✨ Extract project details</button>
              </div>
              <div id="pf-ai-status" style="font-size:11px;color:var(--text-tertiary);display:none"></div>
            </div>

            <div class="field"><div class="field-label">Project title</div><input id="pf-name" type="text" placeholder="e.g. Brand Film — Kinetic Q2" /></div>

            <div class="field">
              <div class="field-label">Client</div>
              <select id="pf-client">
                <option value="">— no client —</option>
                ${contacts.filter(c=>c.type!=='subcontractor').map(c=>`<option value="${c.id}">${esc(c.first_name)} ${esc(c.last_name)} — ${esc(c.company)}</option>`).join('')}
              </select>
            </div>

            <div id="pf-new-contact-toggle" style="margin:-4px 0 10px;cursor:pointer;width:fit-content">
              <span style="font-size:11px;color:var(--accent)">+ Add new contact instead</span>
            </div>

            <div id="pf-new-contact-panel" style="display:none;border:0.5px solid var(--border-med);border-radius:var(--radius-md);padding:14px;background:var(--bg-secondary);margin-bottom:4px">
              <div style="font-size:11px;font-weight:500;color:var(--text-secondary);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.4px">New contact details</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
                <div class="field" style="margin:0"><div class="field-label">First name</div><input type="text" id="pf-nc-first" placeholder="First name" /></div>
                <div class="field" style="margin:0"><div class="field-label">Last name</div><input type="text" id="pf-nc-last" placeholder="Last name" /></div>
              </div>
              <div class="field" style="margin-bottom:8px"><div class="field-label">Company</div><input type="text" id="pf-nc-company" placeholder="Company name" /></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <div class="field" style="margin:0"><div class="field-label">Email</div><input type="email" id="pf-nc-email" placeholder="email@example.com" /></div>
                <div class="field" style="margin:0"><div class="field-label">Phone</div><input type="text" id="pf-nc-phone" placeholder="+44..." /></div>
              </div>
            </div>

            <div id="pf-brief-field" style="display:none">
              <div class="field"><div class="field-label">Brief</div><textarea id="pf-brief" style="width:100%;min-height:70px;padding:8px 10px;font-size:13px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.5"></textarea></div>
            </div>

            <div class="field"><div class="field-label">Status</div>
              <select id="pf-status">
                ${STAGES.map(s=>`<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" data-close="proj-new-modal">Cancel</button>
            <button class="btn-primary" id="proj-save-btn">Create project</button>
          </div>
        </div>
      </div>`
  }

  openNewModal(clientId, stage, mc, isRetainer = false) {
    const el = (mc || document.getElementById('main-content'))
    el.querySelector('#pf-name').value   = ''
    el.querySelector('#pf-status').value = stage || 'Enquiry'
    if (clientId) el.querySelector('#pf-client').value = clientId
    // Reset accordion
    const panel = el.querySelector('#pf-new-contact-panel')
    const client = el.querySelector('#pf-client')
    const toggle = el.querySelector('#pf-new-contact-toggle span')
    if (panel)  panel.style.display = 'none'
    if (client) { client.disabled = false; client.style.opacity = '' }
    if (toggle) toggle.textContent = '+ Add new contact instead'
    ;['#pf-nc-first','#pf-nc-last','#pf-nc-company','#pf-nc-email','#pf-nc-phone'].forEach(id => {
      const inp = el.querySelector(id); if (inp) inp.value = ''
    })
    // Reset AI panel
    const aiPanel = el.querySelector('#pf-ai-panel')
    if (aiPanel) aiPanel.style.display = 'none'
    const aiStatus = el.querySelector('#pf-ai-status')
    if (aiStatus) { aiStatus.style.display = 'none'; aiStatus.textContent = '' }
    const aiText = el.querySelector('#pf-ai-text')
    if (aiText) aiText.value = ''
    const briefField = el.querySelector('#pf-brief-field')
    if (briefField) briefField.style.display = 'none'
    const aiToggle = el.querySelector('#pf-ai-toggle')
    if (aiToggle) aiToggle.textContent = 'Paste text'
    // Store retainer flag on the modal for saveNew to read
    const modal = el.querySelector('#proj-new-modal')
    if (modal) modal.dataset.isRetainer = isRetainer ? '1' : ''
    modal?.classList.add('open')
  }

  async saveNew(mc) {
    const name = mc.querySelector('#pf-name')?.value.trim()
    if (!name) { this.app.toast('Please enter a project title'); return }
    const isRetainer = mc.querySelector('#proj-new-modal')?.dataset.isRetainer === '1'
    const today = new Date().toISOString().split('T')[0]

    // If new contact accordion is open, create the contact first
    let clientId = mc.querySelector('#pf-client')?.value || null
    const contactPanel = mc.querySelector('#pf-new-contact-panel')
    if (contactPanel?.style.display !== 'none') {
      const firstName = mc.querySelector('#pf-nc-first')?.value.trim()
      const lastName  = mc.querySelector('#pf-nc-last')?.value.trim()
      const company   = mc.querySelector('#pf-nc-company')?.value.trim()
      const email     = mc.querySelector('#pf-nc-email')?.value.trim()
      const phone     = mc.querySelector('#pf-nc-phone')?.value.trim()
      if (!firstName && !lastName && !company) {
        this.app.toast('Please enter at least a name or company for the new contact')
        return
      }
      try {
        const { createContact } = await import('../db/client.js')
        const [newContact] = await createContact(this.app.userId, {
          first_name: firstName || 'Unknown',
          last_name:  lastName  || '',
          company:    company   || null,
          email:      email     || null,
          phone:      phone     || null,
          location:   null,
          type:       'brand',
          status:     'Active',
        })
        this.app.contacts.unshift(newContact)
        clientId = newContact.id
      } catch(e) { console.error(e); this.app.toast('Error creating contact'); return }
    }

    const data = {
      name,
      client_id:    clientId,
      status:       isRetainer ? 'Enquiry' : (mc.querySelector('#pf-status')?.value || 'Enquiry'),
      brief:        mc.querySelector('#pf-brief')?.value.trim() || '',
      location:     '',
      shoot_start:  null,
      shoot_end:    null,
      deliverables: [{ text: '', done: false }],
      crew:         [{ name: '', role: '' }],
      shots:        [{ text: '' }],
      approvals:    [
        { label: 'Brief sign-off',    status: 'Pending' },
        { label: 'Budget approved',   status: 'Pending' },
        { label: 'Creative approved', status: 'Pending' },
        { label: 'Final delivery',    status: 'Pending' },
      ],
      budget_ids: [],
      notes: '',
      is_retainer:    isRetainer,
      retainer_fee:   null,
      retainer_hours: null,
      retainer_alert: 80,
      retainer_start: isRetainer ? today : null,
      retainer_fee_mode: 'fixed',
      retainer_items: isRetainer ? [
        { label:'Shoot days', qty:1, unit:'days', rate:null, period:'month' },
        { label:'Edit days',  qty:1, unit:'days', rate:null, period:'month' },
      ] : [],
    }
    try {
      const [created] = await createProject(this.app.userId, data)
      this.app.projects.unshift(created)
      mc.querySelector('#proj-new-modal')?.classList.remove('open')
      this.currentId = created.id
      this.editingId = created.id  // open straight into edit mode
      this.render(mc)
      this.app.updateTitle()
      this.app.toast('Project created')
      logActivity(this.app.userId, 'project', created.id, created.name, 'Project created').catch(console.error)
    } catch (e) {
      console.error(e)
      this.app.toast('Error creating project')
    }
  }

  // ── View mode (read-only, deliverables interactive) ──────────────────────────

  renderViewer(mc) {
    const p = this.app.projects.find(x => x.id === this.currentId)
    if (!p) { this.currentId = null; this.renderKanban(mc); return }

    // Auto-reset monthly deliverables if period has rolled over
    if (p.is_retainer && p.retainer_start) this._checkRetainerReset(p)
    const { contacts, budgets } = this.app
    const cl = contacts.find(c => c.id === p.client_id)
    const delivs = (p.deliverables||[]).filter(d => d.text)
    const crew = (p.crew||[]).filter(c => c.name || c.role)
    const shots = (p.shots||[]).filter(s => s.text)
    const budgetIds = Array.isArray(p.budget_ids) ? p.budget_ids : []
    const linked = budgetIds.map(id => budgets.find(b => b.id === id)).filter(Boolean)
    const doneCount = delivs.filter(d => d.done).length

    const field = (label, value) => value ? `
      <div style="margin-bottom:10px">
        <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">${label}</div>
        <div style="font-size:13px;color:var(--text-primary);line-height:1.6">${value}</div>
      </div>` : ''

    mc.innerHTML = `
      <div class="bh-row">
        <button class="btn-secondary" id="back-to-kanban">← All projects</button>
        <input id="pv-name" value="${esc(p.name)}" style="flex:1;font-size:15px;font-weight:500;background:transparent;border:none;outline:none;border-bottom:1.5px solid transparent;padding:2px 4px;color:var(--text-primary);font-family:var(--font);transition:border-color 0.15s;min-width:0" onfocus="this.style.borderBottomColor='var(--border-strong)'" onblur="this.style.borderBottomColor='transparent'" placeholder="Project name" />
        <select id="pv-status" class="status-select" style="font-size:12px">
          ${p.is_retainer
            ? `<option value="Enquiry" ${p.status==='Enquiry'?'selected':''}>Enquiry</option>
               <option value="Active"  ${(p.status!=='Enquiry')?'selected':''}>Active</option>`
            : STAGES.map(s => `<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        ${this.app.permissions?.projects_edit ? `<button class="btn-secondary" id="pv-duplicate">Duplicate</button>` : ''}
        <button class="btn-secondary" id="pv-callsheets">Call sheets</button>
        ${this.app.permissions?.projects_edit ? `<button class="btn-primary" id="enter-edit">Edit project</button>` : ''}
        <button class="row-btn" id="pv-delete" style="color:#b03020;border-color:rgba(180,50,30,0.2)">Delete</button>
      </div>
      <div class="proj-layout">
        <div class="proj-main">

          <div class="proj-panel">
            <div class="proj-panel-head">Brief &amp; overview</div>
            <div class="proj-panel-body">
              ${cl ? `
              <div>
                <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">Client</div>
                <div style="font-size:13px;color:var(--accent);cursor:pointer;text-decoration:underline;text-underline-offset:2px;text-decoration-color:rgba(74,144,217,0.4)" data-open-contact="${cl.id}">${esc(cl.first_name)} ${esc(cl.last_name)} — ${esc(cl.company)}</div>
              </div>` : ''}
              ${field('Creative brief', esc(p.brief))}
              ${field('Location', esc(p.location))}
              ${(p.shoot_start||p.shoot_end) ? field('Shoot dates', [p.shoot_start, p.shoot_end].filter(Boolean).join(' → ')) : ''}
              ${!p.brief && !p.location && !p.shoot_start && !cl ? '<div style="font-size:13px;color:var(--text-tertiary)">No details yet — click Edit project to add.</div>' : ''}
            </div>
          </div>

          ${p.is_retainer ? `
          <div class="proj-panel">
            <div class="proj-panel-head">
              Retainer
              <button class="btn-secondary" id="pv-ret-pdf" style="margin-left:auto;font-size:11px;padding:4px 10px">Export PDF</button>
            </div>
            <div class="proj-panel-body">
              ${(() => {
                const items = p.retainer_items||[]
                const calcFee = items.reduce((s,i)=>{
                  const r=parseFloat(i.rate)||0, q=parseFloat(i.qty)||0
                  const mult = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}[i.period||'month']||1
                  return s + r*q*mult
                }, 0)
                const displayFee = p.retainer_fee_mode==='calculated' ? calcFee : (parseFloat(p.retainer_fee)||0)
                const periodLabel = {week:'week',month:'month',quarter:'quarter',half:'half year',year:'year'}
                return `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                  <div>
                    <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">Monthly fee</div>
                    <div style="font-size:16px;font-weight:600">£${Math.round(displayFee).toLocaleString('en-GB')}</div>
                    ${p.retainer_fee_mode==='calculated'?'<div style="font-size:10px;color:var(--text-tertiary)">calculated from items</div>':''}
                  </div>
                  ${p.retainer_start ? `<div><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">Period</div><div style="font-size:13px">Resets day ${new Date(p.retainer_start).getUTCDate()} · Alert ${p.retainer_alert??80}%</div></div>` : ''}
                </div>
                ${items.length ? `
                <table style="width:100%;border-collapse:collapse;font-size:12px">
                  <thead><tr style="border-bottom:0.5px solid var(--border-light)">
                    <th style="text-align:left;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;font-weight:400;padding:4px 0">Item</th>
                    <th style="text-align:right;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;font-weight:400;padding:4px 8px">Qty</th>
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;font-weight:400;padding:4px 0">Unit</th>
                    <th style="text-align:right;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;font-weight:400;padding:4px 0">Rate</th>
                    <th style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;font-weight:400;padding:4px 0">Per</th>
                    <th style="text-align:right;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;font-weight:400;padding:4px 0">/mo equiv</th>
                  </tr></thead>
                  <tbody>
                  ${items.map(item => {
                    const r=parseFloat(item.rate)||0, q=parseFloat(item.qty)||0
                    const mult = {week:4.33,month:1,quarter:1/3,half:1/6,year:1/12}[item.period||'month']||1
                    const monthly = r*q*mult
                    const pl = periodLabel[item.period||'month']
                    return `<tr style="border-bottom:0.5px solid var(--border-light)">
                      <td style="padding:6px 0;font-weight:500">${esc(item.label)}</td>
                      <td style="padding:6px 8px;text-align:right;color:var(--text-secondary)">${q}</td>
                      <td style="padding:6px 0;color:var(--text-secondary)">${item.unit||'days'}</td>
                      <td style="padding:6px 0;text-align:right;color:var(--text-secondary)">${r?'£'+r.toLocaleString('en-GB'):'—'}</td>
                      <td style="padding:6px 0;color:var(--text-secondary)">per ${pl}</td>
                      <td style="padding:6px 0;text-align:right;font-weight:500">${monthly?'£'+Math.round(monthly).toLocaleString('en-GB'):'—'}</td>
                    </tr>`
                  }).join('')}
                  </tbody>
                </table>` : '<div style="font-size:12px;color:var(--text-tertiary)">No items — click Edit project to add.</div>'}
                `
              })()}
            </div>
          </div>` : ''}

          ${delivs.length ? `
          <div class="proj-panel">
            <div class="proj-panel-head">
              ${p.is_retainer ? 'Fixed monthly deliverables' : 'Deliverables'}
              <div style="margin-left:auto;display:flex;gap:6px;font-weight:400;text-transform:none;letter-spacing:0">
                <button class="row-btn" id="pv-delivs-all" style="font-size:10px">All done</button>
                <button class="row-btn" id="pv-delivs-clear" style="font-size:10px">Clear</button>
                <span style="font-size:11px;color:var(--text-tertiary)">${doneCount}/${delivs.length}</span>
              </div>
            </div>
            <div style="padding:0 16px" id="pv-delivs">
              ${delivs.map((d, di) => {
                const today = new Date(); today.setHours(0,0,0,0)
                const due = d.due ? new Date(d.due) : null
                const daysUntil = due ? Math.round((due - today) / 86400000) : null
                const overdue = !d.done && due && daysUntil < 0
                const dueSoon = !d.done && due && daysUntil >= 0 && daysUntil <= 3
                const dueColour = overdue ? '#ef4444' : dueSoon ? '#f59e0b' : 'var(--text-tertiary)'
                const dueLabel = due && !d.done ? (overdue ? `⚠ ${Math.abs(daysUntil)}d overdue` : daysUntil === 0 ? '⏰ due today' : dueSoon ? `⏰ ${daysUntil}d left` : new Date(d.due).toLocaleDateString('en-GB',{day:'numeric',month:'short'})) : ''
                return `<div class="deliverable-row" id="pvd-${p.id}-${di}" style="${overdue?'background:rgba(239,68,68,0.05);border-radius:6px;margin:1px 0':''}">
                  <input type="checkbox" class="deliverable-check" ${d.done?'checked':''} data-pv-deliv="${p.id}" data-pv-idx="${di}" />
                  <span style="font-size:13px;flex:1;${d.done?'text-decoration:line-through;color:var(--text-tertiary)':'color:var(--text-primary)'}">${esc(d.text)}</span>
                  ${dueLabel ? `<span style="font-size:10px;color:${dueColour};white-space:nowrap;flex-shrink:0;font-weight:${overdue||dueSoon?'500':'400'}">${dueLabel}</span>` : ''}
                </div>`
              }).join('')}
            </div>
          </div>` : ''}

          ${p.is_retainer ? (() => {
            const mDelivs = (p.monthly_deliverables||[]).filter(d => d.text)
            const mDone = mDelivs.filter(d => d.done).length
            return `<div class="proj-panel">
              <div class="proj-panel-head">
                This month's deliverables
                <span style="margin-left:auto;font-size:11px;color:var(--text-tertiary);font-weight:400;text-transform:none;letter-spacing:0">${mDone}/${mDelivs.length} done</span>
              </div>
              <div style="padding:0 16px" id="pv-monthly-delivs">
                ${mDelivs.map((d, di) => `
                  <div class="deliverable-row" id="pvmd-${p.id}-${di}">
                    <input type="checkbox" class="deliverable-check" ${d.done?'checked':''} data-pv-monthly-deliv="${p.id}" data-pv-monthly-idx="${di}" />
                    <span style="font-size:13px;${d.done?'text-decoration:line-through;color:var(--text-tertiary)':'color:var(--text-primary)'}">${esc(d.text)}</span>
                  </div>`).join('')}
                ${this.app.permissions?.projects_edit ? `
                <div style="padding:8px 0" id="pv-add-monthly-form">
                  <div style="display:flex;gap:6px;margin-top:4px">
                    <input type="text" id="pv-new-monthly-text" placeholder="Add this month's deliverable…"
                      style="flex:1;font-size:12px;padding:6px 8px;border:0.5px solid var(--border-light);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
                    <button class="btn-secondary" id="pv-add-monthly-btn" style="font-size:12px;white-space:nowrap">Add</button>
                  </div>
                </div>` : ''}
              </div>
            </div>`
          })() : ''}

          ${shots.length ? `
          <div class="proj-panel">
            <div class="proj-panel-head">Shot list / run of show</div>
            <div style="padding:0 16px">
              ${shots.map((s,i) => `
                <div class="shot-row">
                  <span class="shot-num">${i+1}.</span>
                  <span style="font-size:13px;color:var(--text-primary);line-height:1.5;padding:6px 0;display:block">${esc(s.text)}</span>
                </div>`).join('')}
            </div>
          </div>` : ''}

          ${crew.length || (this.app.contacts||[]).some(c => c.type==='subcontractor' && c.status!=='Retired') ? `
          <div class="proj-panel">
            <div class="proj-panel-head" style="display:flex;align-items:center;gap:0">
              <div style="display:flex;gap:0;background:var(--bg-secondary);border-radius:20px;padding:3px">
                ${[['crew','Crew'],['on_camera','On Camera'],['client','Client']].map(([type,label]) =>
                  `<button class="filter-pill ${(this._pvCrewTab||'crew')===type?'active':''}" data-pv-crew-tab="${type}" style="border-radius:16px;font-size:11px">${label}</button>`
                ).join('')}
              </div>
            </div>
            <div style="padding:0 16px">
              ${(() => {
                const tab = this._pvCrewTab||'crew'
                const subbies = (this.app.contacts||[]).filter(c => c.type==='subcontractor' && c.status!=='Retired' && !crew.some(cr => cr.name===(c.first_name+' '+c.last_name).trim()))
                const tabCrew = crew.filter(c => (c.crew_type||'crew') === tab)
                return (tab==='crew' && subbies.length ? `
                <div style="padding:8px 0;border-bottom:0.5px solid var(--border-light);display:flex;gap:8px;align-items:center">
                  <select id="pv-add-sub-select" style="flex:1;font-size:12px;padding:5px 8px;border:0.5px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none">
                    <option value="">+ Add subcontractor…</option>
                    ${subbies.map(c => {
                      const name = (c.first_name+' '+c.last_name).trim()
                      return `<option value="${esc(name)}" data-role="${esc(c.role||'')}">${esc(name)}${c.role?' — '+esc(c.role):''}</option>`
                    }).join('')}
                  </select>
                </div>` : '') +
                (tabCrew.length ? `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--border-light)">
                  <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Name</div>
                  <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Role</div>
                </div>
                ${tabCrew.map(c => `
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:7px 0;border-bottom:0.5px solid var(--border-light);font-size:13px">
                    <div>${esc(c.name)}</div>
                    <div style="color:var(--text-secondary)">${esc(c.role)}</div>
                  </div>`).join('')}` :
                `<div style="padding:10px 0;font-size:12px;color:var(--text-tertiary)">No ${tab==='on_camera'?'on camera people':tab==='client'?'clients':'crew'} added yet</div>`)
              })()}
            </div>
          </div>` : ''}

        </div>
        <div class="proj-sidebar">

          <div class="proj-panel">
            <div class="proj-panel-head">Approvals</div>
            <div style="padding:0 14px" id="pv-approvals">
              ${(p.approvals||[]).map((a,ai) => {
                const cls = a.status==='Approved'?'apv-approved':a.status==='Changes requested'?'apv-changes':'apv-pending'
                return `<div class="approval-row">
                  <span class="approval-label">${esc(a.label)}</span>
                  <button class="approval-status ${cls}" data-pv-cycle="${p.id},${ai}">${esc(a.status)}</button>
                </div>`
              }).join('')}
            </div>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">Linked budgets</div>
            <div style="padding:10px 14px;display:flex;flex-direction:column;gap:6px">
              ${linked.map(b => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);font-size:12px;cursor:pointer" data-open-budget="${b.id}">
                  <span style="font-weight:500">${esc(b.name)}</span>
                  ${b.signed_off ? `<span style="font-size:10px;color:#6ec96e">✓ Signed off</span>` : ''}
                </div>`).join('')}
              ${this.app.permissions?.budgets_edit ? `<button class="dashed-btn" id="pv-new-budget" style="font-size:12px">+ create new budget</button>` : ''}
            </div>
          </div>

          ${p.notes ? `
          <div class="proj-panel">
            <div class="proj-panel-head">Notes</div>
            <div style="padding:12px 14px;font-size:13px;color:var(--text-secondary);line-height:1.6">${esc(p.notes)}</div>
          </div>` : ''}

          <div class="proj-panel">
            <div class="proj-panel-head">Time tracking</div>
            <div id="pv-time" style="padding:0 14px 14px">
              <div style="font-size:11px;color:var(--text-tertiary);padding:10px 0">Loading…</div>
            </div>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">Activity log</div>
            <div id="pv-activity" style="padding:0 14px">
              <div style="font-size:11px;color:var(--text-tertiary);padding:10px 0">Loading…</div>
            </div>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">
              Work log
              ${p.portal_token ? `<a href="/portal/${p.portal_token}" target="_blank" style="margin-left:auto;font-size:11px;color:var(--accent);text-decoration:none">View portal ↗</a>` : ''}
            </div>
            <div id="pv-worklog" style="padding:0 14px">
              <div style="font-size:11px;color:var(--text-tertiary);padding:10px 0">Loading…</div>
            </div>
            <div style="padding:10px 14px;border-top:0.5px solid var(--border-light)">
              <div style="display:flex;flex-direction:column;gap:6px">
                <textarea id="wl-note" placeholder="What did you work on today?" style="width:100%;min-height:72px;padding:8px 10px;font-size:12px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;resize:vertical;line-height:1.5"></textarea>
                <div style="display:flex;gap:6px">
                  <input type="date" id="wl-date" value="${new Date().toISOString().split('T')[0]}" style="flex:1;padding:7px 10px;font-size:12px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none" />
                  <button class="btn-primary" id="wl-submit" style="font-size:12px;padding:7px 14px;white-space:nowrap">Add entry</button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>`

    mc.querySelector('#back-to-kanban')?.addEventListener('click', () => {
      this.currentId = null; this.editingId = null; this.render(mc); this.app.updateTitle()
    })
    mc.querySelector('#pv-name')?.addEventListener('change', async e => {
      const val = e.target.value.trim()
      if (!val) { e.target.value = p.name; return }
      const prev = p.name
      p.name = val
      const idx = this.app.projects.findIndex(x => x.id === p.id)
      if (idx >= 0) this.app.projects[idx].name = val
      this.app.updateTitle()
      try {
        await updateProject(this.app.userId, p.id, { name: val })
        logActivity(this.app.userId, 'project', p.id, val, `Renamed from "${prev}"`).catch(console.error)
        this.app.toast(`Renamed to "${val}"`)
      } catch(e) { console.error(e) }
    })

    mc.querySelector('#pv-status')?.addEventListener('change', async e => {
      p.status = e.target.value
      const idx = this.app.projects.findIndex(x => x.id === p.id)
      if (idx >= 0) this.app.projects[idx].status = p.status
      try { await updateProject(this.app.userId, p.id, { status: p.status }); this.app.toast(`Status → ${p.status}`) }
      catch(err) { console.error(err) }
    })

    mc.querySelector('#pv-ret-pdf')?.addEventListener('click', () => this._exportRetainerPDF(p))

    mc.querySelector('#pv-callsheets')?.addEventListener('click', () => {
      this.app.callSheetsView.currentProjectId = p.id
      this.app.currentView = 'callsheets'
      this.app.render()
    })

    mc.querySelector('#enter-edit')?.addEventListener('click', () => {
      this.editingId = this.currentId; this.render(mc)
    })
    mc.querySelector('#pv-duplicate')?.addEventListener('click', async () => {
      const copy = {
        name: p.name + ' (copy)', status: 'Enquiry', client_id: p.client_id,
        brief: p.brief, location: p.location,
        project_type: p.project_type || 'full_service',
        location_address: p.location_address||null,
        location_map_link: p.location_map_link||null,
        parking_notes: p.parking_notes||null,
        nearest_transport: p.nearest_transport||null,
        nearest_hospital_name: p.nearest_hospital_name||null,
        nearest_hospital_address: p.nearest_hospital_address||null,
        nearest_police_name: p.nearest_police_name||null,
        nearest_police_address: p.nearest_police_address||null,
        nearest_fire_name: p.nearest_fire_name||null,
        nearest_fire_address: p.nearest_fire_address||null,
        shoot_start: null, shoot_end: null,
        deliverables: JSON.parse(JSON.stringify(p.deliverables||[])).map(d=>({...d,done:false})),
        crew: JSON.parse(JSON.stringify(p.crew||[])),
        shots: JSON.parse(JSON.stringify(p.shots||[])),
        approvals: (p.approvals||[]).map(a=>({...a,status:'Pending'})),
        notes: p.notes, is_retainer: p.is_retainer,
        retainer_fee: p.retainer_fee, retainer_hours: p.retainer_hours,
        retainer_alert: p.retainer_alert, retainer_start: p.retainer_start,
        monthly_deliverables: [],
      }
      try {
        const [created] = await createProject(this.app.userId, copy)
        this.app.projects.unshift({...created, budget_ids:[]})
        this.currentId = created.id; this.editingId = created.id
        this.render(mc); this.app.updateTitle()
        this.app.toast('Project duplicated — now editing copy')
      } catch(e) { console.error(e); this.app.toast('Error duplicating project') }
    })
    mc.querySelectorAll('[data-pv-crew-tab]').forEach(btn => {
      btn.addEventListener('click', () => { this._pvCrewTab = btn.dataset.pvCrewTab; this.renderViewer(mc) })
    })

    mc.querySelector('#pv-add-sub-select')?.addEventListener('change', async e => {
      const opt = e.target.selectedOptions[0]
      if (!opt?.value) return
      const name = opt.value, role = opt.dataset.role || ''
      if (!p.crew) p.crew = []
      if (!p.crew.some(c => c.name === name)) {
        p.crew.push({ name, role, crew_type: 'crew' })
        const idx = this.app.projects.findIndex(x => x.id === p.id)
        if (idx >= 0) this.app.projects[idx].crew = p.crew
        try {
          const { updateProject } = await import('../db/client.js')
          await updateProject(this.app.userId, p.id, { crew: p.crew })
          this.renderViewer(mc)
        } catch(err) { console.error(err); this.app.toast('Error adding subcontractor') }
      }
      e.target.value = ''
    })

    mc.querySelector('#pv-delete')?.addEventListener('click', () => this.deleteProject(p.id, mc))

    // Clickable client link
    mc.querySelector('[data-open-contact]')?.addEventListener('click', () => {
      const cid = mc.querySelector('[data-open-contact]').dataset.openContact
      this.app.navigate('contacts')
      setTimeout(() => this.app.contactsView.showDetail(cid), 50)
    })

    mc.querySelector('#pv-delivs-all')?.addEventListener('click', async () => {
      p.deliverables.forEach(d => { if (d.text) d.done = true })
      try { await updateProject(this.app.userId, p.id, { deliverables: p.deliverables }); this.renderViewer(mc); this.app.toast('All deliverables marked done') } catch(e) { console.error(e) }
    })
    mc.querySelector('#pv-delivs-clear')?.addEventListener('click', async () => {
      p.deliverables.forEach(d => d.done = false)
      try { await updateProject(this.app.userId, p.id, { deliverables: p.deliverables }); this.renderViewer(mc) } catch(e) { console.error(e) }
    })

    // Deliverable tickboxes — interactive in view mode
    mc.querySelectorAll('[data-pv-deliv]').forEach(el => {
      el.addEventListener('change', async () => {
        const idx = +el.dataset.pvIdx
        p.deliverables[idx].done = el.checked
        const row = mc.querySelector(`#pvd-${p.id}-${idx}`)
        if (row) {
          const span = row.querySelector('span')
          if (span) { span.style.textDecoration = el.checked ? 'line-through' : ''; span.style.color = el.checked ? 'var(--text-tertiary)' : 'var(--text-primary)' }
        }
        // Update done count
        const done = (p.deliverables||[]).filter(d=>d.done&&d.text).length
        const total = (p.deliverables||[]).filter(d=>d.text).length
        const head = mc.querySelector('.proj-panel-head span[style*="text-tertiary"]')
        if (head) head.textContent = `${done}/${total} done`
        try { await updateProject(this.app.userId, p.id, { deliverables: p.deliverables }); this.app.toast(el.checked ? '✓ Done' : 'Unmarked') }
        catch(e) { console.error(e) }
      })
    })

    // Monthly deliverable tickboxes (retainer viewer)
    mc.querySelectorAll('[data-pv-monthly-deliv]').forEach(el => {
      el.addEventListener('change', async () => {
        if (!Array.isArray(p.monthly_deliverables)) p.monthly_deliverables = []
        const idx = +el.dataset.pvMonthlyIdx
        p.monthly_deliverables[idx].done = el.checked
        const row = mc.querySelector(`#pvmd-${p.id}-${idx}`)
        if (row) {
          const span = row.querySelector('span')
          if (span) { span.style.textDecoration = el.checked ? 'line-through' : ''; span.style.color = el.checked ? 'var(--text-tertiary)' : 'var(--text-primary)' }
        }
        const mDone = p.monthly_deliverables.filter(d=>d.done&&d.text).length
        const mTotal = p.monthly_deliverables.filter(d=>d.text).length
        const heads = mc.querySelectorAll('.proj-panel-head')
        heads.forEach(h => { if (h.textContent.includes("This month")) { const sp = h.querySelector('span'); if (sp) sp.textContent = `${mDone}/${mTotal} done` } })
        try { await updateProject(this.app.userId, p.id, { monthly_deliverables: p.monthly_deliverables }) }
        catch(e) { console.error(e) }
      })
    })

    // Inline add monthly deliverable
    mc.querySelector('#pv-add-monthly-btn')?.addEventListener('click', async () => {
      const inp = mc.querySelector('#pv-new-monthly-text')
      const text = inp?.value.trim()
      if (!text) return
      if (!Array.isArray(p.monthly_deliverables)) p.monthly_deliverables = []
      p.monthly_deliverables.push({ text, done: false })
      inp.value = ''
      try {
        await updateProject(this.app.userId, p.id, { monthly_deliverables: p.monthly_deliverables })
        this.renderViewer(mc)
      } catch(e) { console.error(e) }
    })
    mc.querySelector('#pv-new-monthly-text')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') mc.querySelector('#pv-add-monthly-btn')?.click()
    })

    // Approval cycle in view mode
    mc.querySelectorAll('[data-pv-cycle]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const [pid, ai] = btn.dataset.pvCycle.split(',')
        const cycle = ['Pending','Approved','Changes requested']
        p.approvals[+ai].status = cycle[(cycle.indexOf(p.approvals[+ai].status)+1)%cycle.length]
        const cls = p.approvals[+ai].status==='Approved'?'apv-approved':p.approvals[+ai].status==='Changes requested'?'apv-changes':'apv-pending'
        btn.className = `approval-status ${cls}`; btn.textContent = p.approvals[+ai].status
        try { await updateProject(this.app.userId, p.id, { approvals: p.approvals }) }
        catch(e) { console.error(e) }
      })
    })

    mc.querySelectorAll('[data-open-budget]').forEach(el => {
      el.addEventListener('click', () => this.app.openBudget(el.dataset.openBudget))
    })
    mc.querySelector('#pv-new-budget')?.addEventListener('click', () => {
      this.app.budgetsView.openNewModalFromProject(p)
    })

    // Load activity log
    this._loadProjectActivity(mc, p.id)
    this._loadWorkLog(mc, p)
    // Load time tracking panel
    this._loadTimePanel(mc, p)
  }

  async _loadTimePanel(mc, p) {
    const el = mc.querySelector('#pv-time')
    if (!el) return

    // Gather trackable lines — for retainers use retainer_items, otherwise linked budgets
    const budgets = this.app.budgets
    const budgetIds = Array.isArray(p.budget_ids) ? p.budget_ids : []
    const trackableLines = []
    if (p.is_retainer && (p.retainer_items||[]).length) {
      const periodMult = { week:4.33, month:1, quarter:1/3, half:1/6, year:1/12 }
      for (const item of p.retainer_items) {
        const qty  = parseFloat(item.qty) || 0
        const mult = periodMult[item.period||'month'] || 1
        const allocHours = item.unit === 'hours'
          ? Math.round(qty * mult)
          : Math.round(qty * 8 * mult)  // days → hours
        trackableLines.push({ label: item.label, allocHours })
      }
    } else {
      for (const bid of budgetIds) {
        const b = budgets.find(x => x.id === bid)
        if (!b) continue
        for (const s of (b.sections || [])) {
          if (!s.enabled) continue
          for (const l of (s.lines || [])) {
            if (!l.track_time || !l.item) continue
            const days = parseFloat(l.days) || 0
            const qty = isNaN(parseFloat(l.qty)) ? 1 : parseFloat(l.qty)
            const allocHours = days > 0 ? Math.round(days * qty * 8) : Math.round(qty * 8)
            trackableLines.push({ label: l.item, allocHours })
          }
        }
      }
    }

    if (!trackableLines.length && !p.is_retainer) {
      el.innerHTML = `<div style="font-size:11px;color:var(--text-tertiary);padding:10px 0">No trackable lines. In the linked budget, tick ⏱ on any daily-rate line to enable time tracking.</div>`
      this._renderTrackingLink(mc, p, el)
      return
    }

    try {
      const allEntries = await getTimeEntries(p.id)

      // For retainers: filter to current period only for "this month" stats, keep all for history
      let entries = allEntries
      let periodLabel = 'All time'
      if (p.is_retainer && p.retainer_start) {
        const [periodStart, periodEnd] = this.app._retainerPeriod(p.retainer_start)
        if (periodStart) {
          entries = allEntries.filter(e => {
            const d = new Date(e.entry_date)
            return d >= periodStart && d < periodEnd
          })
          periodLabel = periodStart.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) + ' — ' + new Date(periodEnd - 1).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
        }
      }

      const allocHours = trackableLines.length
        ? trackableLines.reduce((s, l) => s + l.allocHours, 0)
        : (parseFloat(p.retainer_hours) || 0)
      const totalLogged = entries.reduce((s, e) => s + parseFloat(e.hours), 0)
      const pct = allocHours > 0 ? Math.min(100, Math.round(totalLogged / allocHours * 100)) : 0
      const alertPct = p.is_retainer ? (parseFloat(p.retainer_alert)||80) : 100
      const barColour = pct >= 100 ? (p.is_retainer ? '#ef4444' : '#6ec96e') : pct >= alertPct ? '#f59e0b' : '#4a90d9'

      // Per-line breakdown
      const byLine = {}
      entries.forEach(e => {
        byLine[e.line_label] = (byLine[e.line_label] || 0) + parseFloat(e.hours)
      })

      el.innerHTML = `
        <div style="margin-top:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
            <span style="color:var(--text-secondary)">${p.is_retainer ? 'This period' : 'Overall progress'}</span>
            <span style="font-weight:500;color:${pct>=alertPct?barColour:''}">${totalLogged.toFixed(1)} / ${allocHours}h</span>
          </div>
          <div style="height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barColour};border-radius:3px;transition:width 0.3s"></div>
          </div>
          ${p.is_retainer ? `<div style="font-size:10px;color:var(--text-tertiary);margin-top:4px">${periodLabel}</div>` : ''}
          ${pct >= alertPct && pct < 100 ? `<div style="font-size:11px;color:${barColour};margin-top:4px">⚠ ${pct}% used — ${(allocHours - totalLogged).toFixed(1)}h remaining</div>` : ''}
          ${pct >= 100 && p.is_retainer ? `<div style="font-size:11px;color:${barColour};margin-top:4px">⚠ Over by ${(totalLogged - allocHours).toFixed(1)}h</div>` : ''}
        </div>
        ${!p.is_retainer ? trackableLines.map(l => {
          const logged = byLine[l.label] || 0
          const lPct = l.allocHours > 0 ? Math.min(100, Math.round(logged / l.allocHours * 100)) : 0
          return `<div style="margin-top:10px">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
              <span style="color:var(--text-tertiary)">${l.label}</span>
              <span style="color:var(--text-secondary)">${logged.toFixed(1)} / ${l.allocHours}h</span>
            </div>
            <div style="height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${lPct}%;background:${lPct>=100?'#6ec96e':'#4a90d9'};border-radius:2px"></div>
            </div>
          </div>`
        }).join('') : ''}
        ${allEntries.length > 0 ? `
        <div style="margin-top:14px">
          <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Recent entries</div>
          ${allEntries.slice(0,8).map(e => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid var(--border-light);font-size:12px" data-eid="${e.id}">
              <div>
                <span style="color:var(--text-primary)">${e.crew_name}</span>
                <span style="color:var(--text-tertiary)"> · ${e.line_label}</span>
                ${e.note ? `<div style="font-size:10px;color:var(--text-tertiary)">${e.note}</div>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-weight:500;color:#4a90d9">${parseFloat(e.hours)}h</span>
                <button class="row-btn" data-del-entry="${e.id}" style="font-size:10px;color:#b03020;flex-shrink:0">×</button>
              </div>
            </div>`).join('')}
        </div>` : ''}
      `

      el.querySelectorAll('[data-del-entry]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this time entry?')) return
          await deleteTimeEntry(btn.dataset.delEntry)
          this._loadTimePanel(mc, p)
        })
      })

    } catch(e) { console.error(e); el.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary)">Could not load time entries</div>' }

    this._renderTrackingLink(mc, p, el)
  }

  _renderTrackingLink(mc, p, el) {
    const linkDiv = document.createElement('div')
    linkDiv.style.cssText = 'margin-top:14px;padding-top:12px;border-top:0.5px solid var(--border-light)'
    const appUrl = import.meta.env.VITE_APP_URL || window.location.origin

    // Quick log form for logged-in users
    const crew = (p.crew||[]).filter(c=>c.name)
    const budgets = this.app.budgets
    const budgetIds = Array.isArray(p.budget_ids) ? p.budget_ids : []
    const trackableLines = []
    if (p.is_retainer && (p.retainer_items||[]).length) {
      for (const item of p.retainer_items) {
        trackableLines.push({ label: item.label, budgetId: null })
      }
    } else {
      for (const bid of budgetIds) {
        const b = budgets.find(x => x.id === bid)
        if (!b) continue
        for (const s of (b.sections||[])) {
          if (!s.enabled) continue
          for (const l of (s.lines||[])) {
            if (!l.track_time || !l.item) continue
            trackableLines.push({ label: l.item, budgetId: bid, budgetName: b.name })
          }
        }
      }
    }
    if (trackableLines.length === 0 && p.is_retainer) trackableLines.push({ label: 'Retainer work', budgetId: null })
    if (trackableLines.length === 0) trackableLines.push({ label: 'General / production work', budgetId: null })

    // Find the current user in crew to pre-select
    const myName = this.app.appUser?.name || ''
    const subbies = (this.app.contacts||[]).filter(c => c.type === 'subcontractor' && c.status !== 'Retired')
    const subNames = subbies.map(c => (c.first_name+' '+c.last_name).trim()).filter(n => n && !crew.some(cr => cr.name === n))
    const allCrew = [...crew.map(c => c.name), ...subNames]
    const crewOptions = allCrew.length
      ? allCrew.map(name => `<option value="${name}" ${name===myName?'selected':''}>${name}</option>`).join('')
      : `<option value="${myName||'Me'}">${myName||'Me'}</option>`

    linkDiv.innerHTML = `
      <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Quick log time</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;gap:6px">
          <select id="ql-crew" style="flex:1;font-size:12px;padding:5px 8px;border:0.5px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none">
            ${crewOptions}
          </select>
          <input type="number" id="ql-hours" placeholder="Hours" min="0.5" max="24" step="0.5"
            style="width:70px;font-size:12px;padding:5px 8px;border:0.5px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none;text-align:right" />
        </div>
        <select id="ql-task" style="font-size:12px;padding:5px 8px;border:0.5px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none">
          ${trackableLines.map(l => `<option value="${l.label}" data-bid="${l.budgetId||''}">${l.label}${l.budgetName?' ('+l.budgetName+')':''}</option>`).join('')}
        </select>
        <div style="display:flex;gap:6px">
          <input type="date" id="ql-date" value="${new Date().toISOString().split('T')[0]}" max="${new Date().toISOString().split('T')[0]}"
            style="flex:1;font-size:12px;padding:5px 8px;border:0.5px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none" />
          <button class="btn-primary" id="ql-submit" style="font-size:12px;padding:5px 14px;white-space:nowrap">Log</button>
        </div>
        <div id="ql-msg" style="font-size:11px;display:none"></div>
      </div>

      <div style="margin-top:12px;padding-top:10px;border-top:0.5px solid var(--border-light)">`

    el.appendChild(linkDiv)

    // Quick log submission
    linkDiv.querySelector('#ql-submit')?.addEventListener('click', async () => {
      const crewName = linkDiv.querySelector('#ql-crew')?.value
      const hours = parseFloat(linkDiv.querySelector('#ql-hours')?.value)
      const taskEl = linkDiv.querySelector('#ql-task')
      const lineLabel = taskEl?.value
      const budgetId = taskEl?.selectedOptions[0]?.dataset.bid || null
      const date = linkDiv.querySelector('#ql-date')?.value
      const msgEl = linkDiv.querySelector('#ql-msg')

      if (!crewName || !hours || hours <= 0 || !lineLabel) {
        if (msgEl) { msgEl.style.display='block'; msgEl.style.color='#e07070'; msgEl.textContent='Please fill in name, task and hours' }
        return
      }
      try {
        const { addTimeEntry } = await import('../db/client.js')
        await addTimeEntry({ project_id: p.id, budget_id: budgetId||null, line_label: lineLabel, crew_name: crewName, hours, entry_date: date, note: null })
        if (msgEl) { msgEl.style.display='block'; msgEl.style.color='#6ec96e'; msgEl.textContent=`✓ ${hours}h logged` }
        linkDiv.querySelector('#ql-hours').value = ''
        setTimeout(() => { if (msgEl) msgEl.style.display='none' }, 3000)
        this._loadTimePanel(mc, p)
      } catch(e) { console.error(e); if (msgEl) { msgEl.style.display='block'; msgEl.style.color='#e07070'; msgEl.textContent='Error logging time' } }
    })

    // Public link section
    const linkSection = document.createElement('div')
    if (p.track_token) {
      const url = `${appUrl}/track/${p.track_token}`
      linkSection.innerHTML = `
        <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Public tracking link</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="text" value="${url}" readonly style="flex:1;font-size:10px;padding:5px 7px;background:var(--bg-secondary);border:0.5px solid var(--border-light);border-radius:6px;color:var(--text-secondary);font-family:monospace;cursor:pointer" onclick="this.select()" />
          <button class="row-btn" id="copy-track-link" style="font-size:10px;white-space:nowrap">Copy</button>
          <button class="row-btn" id="revoke-track-link" style="font-size:10px;color:#b03020;white-space:nowrap">Revoke</button>
        </div>`
    } else {
      linkSection.innerHTML = `
        <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Public tracking link</div>
        <button class="dashed-btn" id="gen-track-link" style="width:100%;font-size:12px">Generate link for external editors</button>`
    }
    linkDiv.appendChild(linkSection)

    mc.querySelector('#copy-track-link')?.addEventListener('click', () => {
      navigator.clipboard.writeText(`${appUrl}/track/${p.track_token}`).then(() => this.app.toast('Link copied'))
    })
    mc.querySelector('#revoke-track-link')?.addEventListener('click', async () => {
      if (!confirm('Revoke this link? Anyone with it will no longer be able to log time.')) return
      await setTrackToken(this.app.userId, p.id, null)
      p.track_token = null
      const idx = this.app.projects.findIndex(x => x.id === p.id)
      if (idx >= 0) this.app.projects[idx].track_token = null
      this.app.toast('Tracking link revoked')
      this._loadTimePanel(mc, p)
    })
    mc.querySelector('#gen-track-link')?.addEventListener('click', async () => {
      const token = crypto.randomUUID().replace(/-/g,'').slice(0,12)
      const [updated] = await setTrackToken(this.app.userId, p.id, token)
      p.track_token = token
      const idx = this.app.projects.findIndex(x => x.id === p.id)
      if (idx >= 0) this.app.projects[idx].track_token = token
      this.app.toast('Tracking link generated')
      this._loadTimePanel(mc, p)
    })
  }

  async _loadWorkLog(mc, p) {
    const el = mc.querySelector('#pv-worklog')
    if (!el) return
    const fmtDate = s => new Date(s).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
    const renderEntries = (entries) => {
      if (!entries.length) {
        el.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary);padding:8px 0">No entries yet</div>'
        return
      }
      el.innerHTML = entries.map(e => `
        <div style="padding:10px 0;border-bottom:0.5px solid var(--border-light)">
          <div style="font-size:13px;line-height:1.6;white-space:pre-line;color:var(--text-primary)">${esc(e.note)}</div>
          <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px;display:flex;justify-content:space-between">
            <span>${fmtDate(e.entry_date)}${e.created_by?' · '+esc(e.created_by):''}</span>
            <button data-del-wl="${e.id}" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:12px;padding:0" title="Delete">×</button>
          </div>
        </div>`).join('')
      el.querySelectorAll('[data-del-wl]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this work log entry?')) return
          try {
            const { deleteWorkLogEntry } = await import('../db/client.js')
            await deleteWorkLogEntry(btn.dataset.delWl)
            this._loadWorkLog(mc, p)
          } catch(err) { console.error(err); this.app.toast('Error deleting entry') }
        })
      })
    }

    try {
      const { getWorkLog } = await import('../db/client.js')
      const entries = await getWorkLog(p.id)
      renderEntries(entries)
    } catch(e) {
      el.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary);padding:8px 0">Could not load work log</div>'
    }

    // Wire submit button
    const submitBtn = mc.querySelector('#wl-submit')
    if (submitBtn && !submitBtn.dataset.bound) {
      submitBtn.dataset.bound = '1'
      submitBtn.addEventListener('click', async () => {
        const note = mc.querySelector('#wl-note')?.value.trim()
        const date = mc.querySelector('#wl-date')?.value
        if (!note) { this.app.toast('Please enter a note'); return }
        submitBtn.disabled = true; submitBtn.textContent = 'Adding…'
        try {
          const { addWorkLogEntry, getWorkLog } = await import('../db/client.js')
          const createdBy = this.app.appUser?.name || ''
          await addWorkLogEntry(p.id, note, date, createdBy)
          mc.querySelector('#wl-note').value = ''
          const entries = await getWorkLog(p.id)
          renderEntries(entries)
          this.app.toast('Work log entry added')
        } catch(err) { console.error(err); this.app.toast('Error adding entry') }
        finally { submitBtn.disabled = false; submitBtn.textContent = 'Add entry' }
      })
    }
  }

  async _loadProjectActivity(mc, projectId) {
    const el = mc.querySelector('#pv-activity')
    if (!el) return
    try {
      const log = await getActivityLog(projectId, 50)
      if (!log.length) {
        el.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary);padding:10px 0">No activity yet</div>'
        return
      }
      const fmt = ts => {
        const d = new Date(ts)
        return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
      }
      el.innerHTML = log.map(entry => `
        <div style="padding:8px 0;border-bottom:0.5px solid var(--border-light);display:flex;gap:8px;align-items:flex-start">
          <div style="width:6px;height:6px;border-radius:50%;background:var(--border-strong);flex-shrink:0;margin-top:5px"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;color:var(--text-primary);line-height:1.5">${entry.summary}</div>
            <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">${fmt(entry.created_at)}</div>
          </div>
        </div>`).join('')
    } catch(e) {
      el.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary);padding:10px 0">Could not load activity</div>'
    }
  }

  // ── Editor ──────────────────────────────────────────────────────────────────

  renderEditor(mc) {
    const p = this.app.projects.find(x => x.id === this.currentId)
    if (!p) { this.currentId = null; this.renderKanban(mc); return }

    // Auto-reset monthly deliverables if period has rolled over
    if (p.is_retainer && p.retainer_start && Array.isArray(p.monthly_deliverables)) {
      this._checkRetainerReset(p)
    }
    const { contacts, budgets } = this.app
    const delivs   = Array.isArray(p.deliverables) ? p.deliverables : []
    const crew     = Array.isArray(p.crew)          ? p.crew         : []
    const shots    = Array.isArray(p.shots)         ? p.shots        : []
    const approvals = Array.isArray(p.approvals)    ? p.approvals    : []
    const budgetIds = Array.isArray(p.budget_ids)   ? p.budget_ids   : []
    const linked   = budgetIds.map(id => budgets.find(b => b.id === id)).filter(Boolean)
    const unlinked = budgets.filter(b => !budgetIds.includes(b.id))

    mc.innerHTML = `
      <div class="bh-row">
        <button class="btn-secondary" id="back-to-kanban">← All projects</button>
        <h2 style="flex:1;font-size:15px;font-weight:500">${esc(p.name)}</h2>
        <div style="display:flex;gap:4px;background:var(--bg-secondary);border-radius:20px;padding:3px">
          <button class="filter-pill ${(p.project_type||'full_service')==='full_service'?'active':''}" data-proj-type="full_service" style="border-radius:16px;font-size:11px">Full service</button>
          <button class="filter-pill ${(p.project_type||'full_service')==='post_production'?'active':''}" data-proj-type="post_production" style="border-radius:16px;font-size:11px">Post production</button>
        </div>
        <select class="status-select" id="pe-status">
          ${p.is_retainer
            ? `<option value="Enquiry" ${p.status==='Enquiry'?'selected':''}>Enquiry</option>
               <option value="Active"  ${p.status!=='Enquiry'?'selected':''}>Active</option>`
            : STAGES.map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <button class="btn-primary" id="pe-save-close">Save &amp; close</button>
        <button class="row-btn" id="pe-delete" style="color:#b03020;border-color:rgba(180,50,30,0.2)">Delete</button>
      </div>
      <div class="proj-layout">
        <div class="proj-main">

          <div class="proj-panel">
            <div class="proj-panel-head">Brief &amp; overview</div>
            <div class="proj-panel-body">
              <div>
                <div class="proj-field-label">Client</div>
                <select class="proj-input" id="pe-client">
                  <option value="">— no client —</option>
                  ${contacts.filter(c=>c.type!=='subcontractor').map(c=>`<option value="${c.id}" ${p.client_id===c.id?'selected':''}>${esc(c.first_name)} ${esc(c.last_name)} — ${esc(c.company)}</option>`).join('')}
                </select>
              </div>
              <div>
                <div class="proj-field-label">Creative brief</div>
                <textarea class="proj-textarea" id="pe-brief" style="min-height:120px" placeholder="Objectives, audience, tone, key messages...">${esc(p.brief)}</textarea>
              </div>
            </div>
          </div>

          ${(p.project_type||'full_service') === 'full_service' ? `
          <div class="proj-panel" id="pe-shoot-specifics">
            <div class="proj-panel-head">Shoot specifics</div>
            <div class="proj-panel-body">
              <div class="proj-date-row">
                <div><div class="proj-field-label">Shoot start</div><input type="date" class="proj-input" id="pe-start" value="${p.shoot_start??''}" /></div>
                <div><div class="proj-field-label">Shoot end</div><input type="date" class="proj-input" id="pe-end" value="${p.shoot_end??''}" /></div>
              </div>
              <div>
                <div class="proj-field-label">Location name</div>
                <input type="text" class="proj-input" id="pe-location" value="${esc(p.location||'')}" placeholder="e.g. Eastnor Castle, Snowdonia" />
              </div>
              <div>
                <div class="proj-field-label">Address or Maps link <span style="font-weight:400;color:var(--text-tertiary)">— paste a full address or a Google Maps URL</span></div>
                <input type="text" class="proj-input" id="pe-location-addr" value="${esc(p.location_address||p.location_map_link||'')}" placeholder="Full address or paste a Google Maps URL" />
              </div>
              <div class="proj-date-row">
                <div>
                  <div class="proj-field-label">Parking</div>
                  <input type="text" class="proj-input" id="pe-parking" value="${esc(p.parking_notes||'')}" placeholder="e.g. On-site car park, enter via main gate" />
                </div>
                <div>
                  <div class="proj-field-label">Nearest transport</div>
                  <input type="text" class="proj-input" id="pe-transport" value="${esc(p.nearest_transport||'')}" placeholder="e.g. Ledbury station, 2 miles" />
                </div>
              </div>
              <div style="display:flex;justify-content:flex-end">
                <button class="btn-secondary" id="pe-find-nearby" style="font-size:12px">📍 Find nearby services</button>
              </div>
              ${[['Hospital','pe-hosp','nearest_hospital'],['Police station','pe-police','nearest_police'],['Fire station','pe-fire','nearest_fire']].map(([label,id,key]) => `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <div>
                  <div class="proj-field-label">${label} name</div>
                  <input type="text" class="proj-input" id="${id}-name" value="${esc(p[key+'_name']||'')}" placeholder="${label} name" />
                </div>
                <div>
                  <div class="proj-field-label">${label} address</div>
                  <input type="text" class="proj-input" id="${id}-addr" value="${esc(p[key+'_address']||'')}" placeholder="Address" />
                </div>
              </div>`).join('')}
            </div>
          </div>` : ''}

          <div class="proj-panel">
            <div class="proj-panel-head">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
                <input type="checkbox" id="pe-is-retainer" ${p.is_retainer?'checked':''} style="cursor:pointer;width:14px;height:14px" />
                Retainer
              </label>
              ${p.is_retainer ? `<span style="font-size:11px;color:var(--text-tertiary);font-weight:400;text-transform:none;letter-spacing:0;margin-left:4px">— recurring monthly engagement</span>` : ''}
            </div>
            ${p.is_retainer ? `<div class="proj-panel-body">

              <div style="display:flex;gap:8px;margin-bottom:14px;background:var(--bg-secondary);border-radius:var(--radius-md);padding:4px">
                <button id="pe-ret-mode-fixed" class="${(p.retainer_fee_mode??'fixed')==='fixed'?'btn-primary':'btn-cancel'}" style="flex:1;font-size:12px;padding:6px">Fixed amount</button>
                <button id="pe-ret-mode-calc"  class="${p.retainer_fee_mode==='calculated'?'btn-primary':'btn-cancel'}" style="flex:1;font-size:12px;padding:6px">Total from items</button>
              </div>

              ${(p.retainer_fee_mode??'fixed')==='fixed' ? `
              <div style="margin-bottom:14px">
                <div class="proj-field-label">Monthly fee £</div>
                <input type="number" class="proj-input" id="pe-ret-fee" value="${p.retainer_fee??''}" placeholder="0" min="0" step="100" />
              </div>` : `
              <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:14px;padding:8px 10px;background:var(--bg-secondary);border-radius:var(--radius-md)">
                Monthly fee calculated from items below
                ${(() => { const items = p.retainer_items||[]; const total = items.reduce((s,i)=>s+(parseFloat(i.rate)||0)*(parseFloat(i.qty)||0),0); return total>0?` — <strong style="color:var(--text-primary)">£${total.toLocaleString('en-GB')}/mo</strong>`:''; })()}
              </div>`}

              <div style="margin-bottom:10px">
                <div style="display:grid;grid-template-columns:1fr 60px 80px 90px 110px 28px;gap:6px;padding:5px 0;border-bottom:0.5px solid var(--border-light);margin-bottom:4px">
                  <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px">Item</div>
                  <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;text-align:right">Qty</div>
                  <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px">Unit</div>
                  <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;text-align:right">Rate £</div>
                  <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px">Per</div>
                  <div></div>
                </div>
                <div id="pe-ret-items">
                  ${(p.retainer_items||[]).map((item, i) => `
                  <div style="display:grid;grid-template-columns:1fr 60px 80px 90px 110px 28px;gap:6px;align-items:center;padding:3px 0">
                    <input type="text" class="proj-input" value="${esc(item.label)}" placeholder="Item name" data-ri-label="${i}" style="font-size:12px;padding:5px 8px" />
                    <input type="number" class="proj-input" value="${item.qty??''}" placeholder="0" min="0" step="0.5" data-ri-qty="${i}" style="font-size:12px;padding:5px 8px;text-align:right" />
                    <select class="proj-input" data-ri-unit="${i}" style="font-size:12px;padding:5px 6px">
                      <option value="days"  ${item.unit==='days'?'selected':''}>days</option>
                      <option value="hours" ${item.unit==='hours'?'selected':''}>hours</option>
                      <option value="unit"  ${item.unit==='unit'?'selected':''}>unit</option>
                    </select>
                    <input type="number" class="proj-input" value="${item.rate??''}" placeholder="—" min="0" step="50" data-ri-rate="${i}" style="font-size:12px;padding:5px 8px;text-align:right" />
                    <select class="proj-input" data-ri-period="${i}" style="font-size:12px;padding:5px 6px">
                      <option value="month"   ${(item.period??'month')==='month'?'selected':''}>Per month</option>
                      <option value="week"    ${item.period==='week'?'selected':''}>Per week</option>
                      <option value="quarter" ${item.period==='quarter'?'selected':''}>Per quarter</option>
                      <option value="half"    ${item.period==='half'?'selected':''}>Per half year</option>
                      <option value="year"    ${item.period==='year'?'selected':''}>Per year</option>
                    </select>
                    <button class="row-btn" data-ri-rem="${i}" style="color:#b03020;font-size:14px;padding:0;text-align:center">×</button>
                  </div>`).join('')}
                </div>
                <button class="add-line" id="pe-add-ret-item" style="margin-top:4px">+ add retainer item</button>
              </div>

              <div class="proj-date-row" style="margin-top:4px">
                <div>
                  <div class="proj-field-label">Period start date</div>
                  <input type="date" class="proj-input" id="pe-ret-start" value="${p.retainer_start??''}" title="Day-of-month used for period reset" />
                </div>
                <div>
                  <div class="proj-field-label">Alert threshold %</div>
                  <input type="number" class="proj-input" id="pe-ret-alert" value="${p.retainer_alert??80}" min="1" max="100" step="5" />
                </div>
              </div>
              <div style="font-size:11px;color:var(--text-tertiary);line-height:1.5;margin-top:8px">
                Period resets on day <strong>${p.retainer_start ? new Date(p.retainer_start).getUTCDate() : '—'}</strong> of each month.
                Alert fires at <strong>${p.retainer_alert??80}%</strong> of monthly hours.
              </div>
            </div>` : ''}
          </div>
          <div class="proj-panel">
            <div class="proj-panel-head">
              ${p.is_retainer ? 'Fixed monthly deliverables' : 'Deliverables'}
              <div style="margin-left:auto;display:flex;gap:6px">
                <button class="row-btn" id="pe-delivs-all" style="font-size:10px">Mark all done</button>
                <button class="row-btn" id="pe-delivs-clear" style="font-size:10px">Clear all</button>
              </div>
            </div>
            <div style="padding:0 16px" id="pe-delivs">
              ${delivs.map((d,i) => this.delivHTML(p.id, d, i)).join('')}
            </div>
            <button class="add-line" id="pe-add-deliv">+ add ${p.is_retainer ? 'fixed deliverable' : 'deliverable'}</button>
          </div>

          ${p.is_retainer ? `
          <div class="proj-panel">
            <div class="proj-panel-head">
              This month's deliverables
              <span style="margin-left:auto;font-size:11px;color:var(--text-tertiary);font-weight:400;text-transform:none;letter-spacing:0">resets with period</span>
            </div>
            <div style="padding:0 16px" id="pe-monthly-delivs">
              ${(p.monthly_deliverables||[]).map((d,i) => this.delivHTML(p.id, d, i, true)).join('')}
            </div>
            <button class="add-line" id="pe-add-monthly-deliv">+ add this month's deliverable</button>
          </div>` : ''}

          ${(p.project_type||'full_service') === 'full_service' ? `
          <div class="proj-panel">
            <div class="proj-panel-head">Shot list / run of show</div>
            <div style="padding:0 16px" id="pe-shots">
              ${shots.map((s,i) => this.shotHTML(p.id, s, i)).join('')}
            </div>
            <button class="add-line" id="pe-add-shot">+ add shot</button>
          </div>` : ''}

          ${(p.project_type||'full_service') === 'full_service' ? `
          <div class="proj-panel">
            <div class="proj-panel-head" style="display:flex;align-items:center;gap:6px">
              <div style="display:flex;gap:0;background:var(--bg-secondary);border-radius:20px;padding:3px">
                ${[['crew','Crew'],['on_camera','On Camera'],['client','Client']].map(([type,label]) =>
                  `<button class="filter-pill ${(this._peCrewTab||'crew')===type?'active':''}" data-pe-crew-tab="${type}" style="border-radius:16px;font-size:11px">${label}</button>`
                ).join('')}
              </div>
            </div>
            <div style="padding:0 16px">
              ${(this._peCrewTab||'crew')==='crew' && this.app.allUsers?.length > 0 ? `
              <div style="padding:10px 0;border-bottom:0.5px solid var(--border-light);display:flex;gap:8px;align-items:center">
                <select id="pe-add-user-select" style="flex:1;font-size:12px;padding:5px 8px;border:0.5px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none">
                  <option value="">+ Add team member…</option>
                  ${this.app.allUsers.filter(u => !crew.some(c => c.name === u.name)).map(u =>
                    `<option value="${esc(u.clerk_id)}" data-name="${esc(u.name)}" data-role="${esc(u.default_role||'')}">
                      ${esc(u.name||u.email)}${u.default_role ? ' — '+esc(u.default_role) : ''}
                    </option>`
                  ).join('')}
                </select>
              </div>` : ''}
              ${(this._peCrewTab||'crew')==='crew' ? (() => {
                const subbies = (this.app.contacts||[]).filter(c => c.type === 'subcontractor' && c.status !== 'Retired' && !crew.some(cr => cr.name === (c.first_name+' '+c.last_name).trim()))
                return subbies.length ? `
                <div style="padding:10px 0;border-bottom:0.5px solid var(--border-light);display:flex;gap:8px;align-items:center">
                  <select id="pe-add-sub-select" style="flex:1;font-size:12px;padding:5px 8px;border:0.5px solid var(--border-med);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);outline:none">
                    <option value="">+ Add subcontractor…</option>
                    ${subbies.map(c => {
                      const name = (c.first_name+' '+c.last_name).trim()
                      const role = c.role || ''
                      return `<option value="${esc(name)}" data-role="${esc(role)}">${esc(name)}${role?' — '+esc(role):''}</option>`
                    }).join('')}
                  </select>
                </div>` : ''
              })() : ''}
              <div style="display:grid;grid-template-columns:1fr 1fr 40px;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--border-light)">
                <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Name</div>
                <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Role</div>
                <div></div>
              </div>
              <div id="pe-crew">${crew.filter(c=>(c.crew_type||'crew')===(this._peCrewTab||'crew')).map((c,i) => this.crewHTML(p.id, c, crew.indexOf(c))).join('')}</div>
            </div>
            <button class="add-line" id="pe-add-crew">+ add ${(this._peCrewTab||'crew')==='on_camera'?'on camera person':(this._peCrewTab||'crew')==='client'?'client':'crew member'}</button>
          </div>` : ''}

        </div>
        <div class="proj-sidebar">

          <div class="proj-panel">
            <div class="proj-panel-head">Approvals</div>
            <div style="padding:0 14px" id="pe-approvals">
              ${approvals.map((a,i) => this.approvalHTML(p.id, a, i)).join('')}
            </div>
            <button class="add-line" id="pe-add-approval">+ add stage</button>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">Linked budgets</div>
            <div style="padding:10px 14px;display:flex;flex-direction:column;gap:6px">
              ${linked.map(b=>`
                <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);font-size:12px">
                  <span style="font-weight:500;cursor:pointer" data-open-budget="${b.id}">${esc(b.name)}</span>
                  <button class="row-btn" style="font-size:10px;color:#b03020" data-unlink="${b.id}">×</button>
                </div>`).join('')}
              ${linked.length === 0 ? '<div style="font-size:12px;color:var(--text-tertiary)">No budgets linked yet</div>' : ''}
              ${unlinked.length ? `
                <select id="pe-link-budget" style="font-size:12px;padding:5px 8px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);font-family:var(--font);background:var(--bg-primary);color:var(--text-primary);outline:none;margin-top:4px">
                  <option value="">+ link a budget…</option>
                  ${unlinked.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}
                </select>` : ''}
              <button class="dashed-btn" id="pe-new-budget" style="margin-top:2px">+ create new budget</button>
            </div>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">Notes</div>
            <div style="padding:12px 14px">
              <textarea class="proj-textarea" id="pe-notes" style="min-height:90px" placeholder="Internal notes...">${esc(p.notes)}</textarea>
            </div>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">Client portal</div>
            <div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px">
              <div>
                <div class="proj-field-label">Frame.io review link</div>
                <input type="url" class="proj-input" id="pe-frameio" value="${esc(p.frame_io_link||'')}" placeholder="https://app.frame.io/..." />
              </div>
              <div>
                ${p.portal_token
                  ? `<div class="proj-field-label">Portal link</div>
                     <div style="display:flex;gap:6px;align-items:center">
                       <input type="text" class="proj-input" readonly value="${location.origin}/portal/${p.portal_token}" style="font-size:11px;color:var(--text-secondary)" />
                       <button class="btn-secondary" id="pe-copy-portal" style="white-space:nowrap;font-size:11px">Copy</button>
                     </div>
                     <button class="btn-cancel" id="pe-regen-portal" style="font-size:11px;margin-top:6px;width:100%">Regenerate link</button>`
                  : `<button class="btn-primary" id="pe-gen-portal" style="font-size:12px;width:100%">Generate portal link</button>
                     <div style="font-size:11px;color:var(--text-tertiary);margin-top:6px">Share with your client to give them a read-only view of deliverables and work log.</div>`}
              </div>
            </div>
          </div>

        </div>
      </div>`

    this.bindEditor(mc, p)
  }

  // Check if the retainer period has rolled over and reset monthly deliverable done states
  _exportRetainerPDF(p) {
    const s   = this.app.settings || {}
    const cl  = this.app.contacts.find(c => c.id === p.client_id)
    const today = new Date()
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const dateStr = today.getDate()+' '+months[today.getMonth()]+' '+today.getFullYear()
    const LOGO_WHITE = '/peny-logo-white.png'
    const LOGO_BLACK = '/peny-logo.png'
    const periodLabel = { week:'week', month:'month', quarter:'quarter', half:'half year', year:'year' }
    const periodMult  = { week:4.33, month:1, quarter:1/3, half:1/6, year:1/12 }
    const gbpA = n => '£'+n.toLocaleString('en-GB',{minimumFractionDigits:0,maximumFractionDigits:2})

    const items = p.retainer_items || []
    const calcFee = items.reduce((s,i) => {
      const mult = periodMult[i.period||'month'] || 1
      return s + (parseFloat(i.rate)||0) * (parseFloat(i.qty)||0) * mult
    }, 0)
    const monthlyFee = p.retainer_fee_mode === 'calculated' ? calcFee : (parseFloat(p.retainer_fee)||0)

    const itemRows = items.map(item => {
      const r = parseFloat(item.rate)||0, q = parseFloat(item.qty)||0
      const mult = periodMult[item.period||'month'] || 1
      const monthlyEquiv = r * q * mult
      return `<tr style="border-bottom:0.5px solid #f0efe9">
        <td style="padding:8px 0;font-size:12px;font-weight:500">${item.label}</td>
        <td style="padding:8px 0;font-size:12px;text-align:right;color:#6b6b66">${q}</td>
        <td style="padding:8px 0;font-size:12px;color:#6b6b66">${item.unit||'days'}</td>
        <td style="padding:8px 0;font-size:12px;text-align:right;color:#6b6b66">${r ? gbpA(r) : '—'}</td>
        <td style="padding:8px 0;font-size:12px;color:#6b6b66">per ${periodLabel[item.period||'month']||'month'}</td>
        <td style="padding:8px 0;font-size:12px;text-align:right;font-weight:500">${monthlyEquiv ? gbpA(monthlyEquiv) : '—'}</td>
      </tr>`
    }).join('')

    const html = `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a1a18;background:#fff">

        <!-- Cover -->
        <div style="background:#1a1a18;min-height:100vh;padding:60px;display:flex;flex-direction:column;page-break-after:always;box-sizing:border-box">
          <img src="${LOGO_WHITE}" alt="Peny" style="height:28px;width:auto;object-fit:contain;object-position:left;margin-bottom:auto" />
          <div style="margin-top:auto;padding-top:80px">
            <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px">Retainer Proposal</div>
            <div style="font-size:36px;font-weight:600;color:#fff;line-height:1.15;margin-bottom:12px">${p.name}</div>
            ${cl ? `<div style="font-size:16px;color:rgba(255,255,255,0.55);margin-bottom:32px">Prepared for ${cl.first_name} ${cl.last_name}${cl.company?', '+cl.company:''}</div>` : ''}
            <div style="border-top:0.5px solid rgba(255,255,255,0.15);padding-top:28px;margin-top:28px;display:flex;gap:48px">
              <div>
                <div style="font-size:10px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">Monthly fee</div>
                <div style="font-size:28px;font-weight:600;color:#fff">£${Math.round(monthlyFee).toLocaleString('en-GB')}</div>
                ${p.retainer_fee_mode==='calculated'?'<div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:3px">calculated from items</div>':''}
              </div>
              ${p.retainer_start ? `<div>
                <div style="font-size:10px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">Period resets</div>
                <div style="font-size:16px;color:rgba(255,255,255,0.7)">Day ${new Date(p.retainer_start).getUTCDate()} of each month</div>
              </div>` : ''}
            </div>
          </div>
          <div style="margin-top:48px;display:flex;justify-content:space-between;align-items:flex-end">
            <div style="font-size:11px;color:rgba(255,255,255,0.25);line-height:1.8">
              ${dateStr}<br>
              ${s.address||''}${s.address?'<br>':''}
              ${s.email?`<a href="mailto:${s.email}" style="color:rgba(255,255,255,0.25);text-decoration:none">${s.email}</a>`:''}
            </div>
            ${s.prepared_by ? `<div style="font-size:11px;color:rgba(255,255,255,0.25)">Prepared by ${s.prepared_by}</div>` : ''}
          </div>
        </div>

        <!-- Detail page -->
        <div style="padding:60px;min-height:100vh;box-sizing:border-box;background:#fff;color:#1a1a18">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:20px;border-bottom:1px solid #1a1a18">
            <div>
              <div style="font-size:10px;color:#a8a8a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Retainer — Scope of work</div>
              <div style="font-size:20px;font-weight:600">${p.name}</div>
            </div>
            <img src="${LOGO_BLACK}" alt="Peny" style="height:20px;width:auto;object-fit:contain" />
          </div>

          ${p.brief ? `<div style="font-size:13px;color:#4a4a44;line-height:1.7;margin-bottom:32px;padding:16px 18px;background:#f7f7f5;border-radius:6px">${p.brief}</div>` : ''}

          ${items.length ? `
          <table style="width:100%;border-collapse:collapse;margin-bottom:32px">
            <thead>
              <tr style="border-bottom:1px solid #1a1a18">
                <th style="text-align:left;font-size:9px;color:#a8a8a0;text-transform:uppercase;letter-spacing:0.6px;font-weight:400;padding:0 0 8px">Item</th>
                <th style="text-align:right;font-size:9px;color:#a8a8a0;text-transform:uppercase;letter-spacing:0.6px;font-weight:400;padding:0 8px 8px">Qty</th>
                <th style="font-size:9px;color:#a8a8a0;text-transform:uppercase;letter-spacing:0.6px;font-weight:400;padding:0 0 8px">Unit</th>
                <th style="text-align:right;font-size:9px;color:#a8a8a0;text-transform:uppercase;letter-spacing:0.6px;font-weight:400;padding:0 0 8px">Rate</th>
                <th style="font-size:9px;color:#a8a8a0;text-transform:uppercase;letter-spacing:0.6px;font-weight:400;padding:0 0 8px">Period</th>
                <th style="text-align:right;font-size:9px;color:#a8a8a0;text-transform:uppercase;letter-spacing:0.6px;font-weight:400;padding:0 0 8px">/ month</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>` : ''}

          <div style="border-top:1px solid #1a1a18;padding-top:20px;display:flex;justify-content:flex-end">
            <div style="min-width:240px">
              ${p.retainer_fee_mode==='calculated' ? items.map(item => {
                const r = parseFloat(item.rate)||0, q = parseFloat(item.qty)||0
                const mult = periodMult[item.period||'month']||1
                const mo = r*q*mult
                return mo>0?`<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;color:#6b6b66"><span>${item.label}</span><span>${gbpA(mo)}</span></div>`:''
              }).join('') : ''}
              <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:600;padding:12px 0;border-top:0.5px solid #e0dfda;margin-top:8px">
                <span>Monthly total</span>
                <span>£${Math.round(monthlyFee).toLocaleString('en-GB')}</span>
              </div>
            </div>
          </div>

          <div style="margin-top:60px;border-top:0.5px solid #e0dfda;padding-top:16px;display:flex;justify-content:space-between;font-size:9px;color:#c0c0b8">
            <span>${[s.email, s.website].filter(Boolean).join(' · ')}</span>
            <span>${dateStr}${s.vat_number?' · VAT: '+s.vat_number:''}</span>
          </div>
        </div>
      </div>`

    let ts = document.getElementById('pdf-topsheet')
    if (!ts) { ts = document.createElement('div'); ts.id = 'pdf-topsheet'; document.body.appendChild(ts) }
    ts.innerHTML = html
    setTimeout(() => window.print(), 150)
    this.app.toast('Opening print dialog…')
  }

  async _createBudgetFromRetainer(p, mc) {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999'
    const defaultName = `${p.name} — ${new Date().toLocaleDateString('en-GB',{month:'short',year:'numeric'})}`
    overlay.innerHTML = `
      <div style="background:var(--bg-primary);border:0.5px solid var(--border-med);border-radius:var(--radius-lg);padding:24px;width:400px" onclick="event.stopPropagation()">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Create budget from retainer</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">Retainer items will be mapped to budget line items.</div>
        <div class="field" style="margin-bottom:12px">
          <div class="field-label">Budget name</div>
          <input id="rb-name" type="text" value="${esc(defaultName)}" style="width:100%" />
        </div>
        <div id="rb-msg" style="font-size:12px;color:#e07070;margin-bottom:8px;display:none"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn-cancel" id="rb-cancel">Cancel</button>
          <button class="btn-primary" id="rb-create">Create budget</button>
        </div>
      </div>`
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#rb-name')?.select(), 50)

    overlay.querySelector('#rb-cancel')?.addEventListener('click', () => overlay.remove())
    overlay.querySelector('#rb-create')?.addEventListener('click', async () => {
      const name = overlay.querySelector('#rb-name')?.value.trim()
      const msgEl = overlay.querySelector('#rb-msg')
      if (!name) { msgEl.style.display='block'; msgEl.textContent='Please enter a budget name'; return }

      const periodMultiplier = { week: 4.33, month: 1, quarter: 1/3, half: 1/6, year: 1/12 }
      let retainerLines = []

      if (p.retainer_fee_mode === 'fixed' || !(p.retainer_items||[]).length) {
        // Fixed fee mode — single line with the agreed monthly amount
        const fee = parseFloat(p.retainer_fee) || 0
        retainerLines.push({
          item: 'Monthly retainer fee',
          days: 0, qty: 1, rate: fee || null,
          notes: p.name, discount: 0, travelDays: 0, track_time: false,
        })
      } else {
        // Calculated mode — map each item, converting to monthly-equivalent rate
        retainerLines = (p.retainer_items||[]).map(item => {
          const qty      = parseFloat(item.qty) || 0
          const rate     = parseFloat(item.rate) || 0
          const mult     = periodMultiplier[item.period||'month'] || 1
          const isDay    = item.unit === 'days'
          const isHour   = item.unit === 'hours'
          const periodLabel = item.period && item.period !== 'month' ? ` · billed per ${item.period}` : ''

          // For day-rate items: preserve days × rate structure so budget maths works
          // Convert non-monthly periods by adjusting the rate to monthly equivalent
          const monthlyRate = rate * mult
          return {
            item:  item.label,
            days:  isDay ? qty : 0,
            qty:   isDay ? 1 : (isHour ? qty : qty),
            rate:  isDay ? monthlyRate : (rate * mult),
            notes: `${qty} ${item.unit} @ £${rate.toLocaleString('en-GB')}${periodLabel}`,
            discount: 0, travelDays: 0, track_time: false,
          }
        })
      }
      const sections = [
        { code:'R', label:'Retainer', enabled: true, open: true, crew: false, lines: retainerLines }
      ]

      try {
        const btn = overlay.querySelector('#rb-create')
        btn.disabled = true; btn.textContent = 'Creating…'
        const { createBudget, linkBudgetToProject } = await import('../db/client.js')
        const [budget] = await createBudget(this.app.userId, {
          name, client_id: p.client_id ?? null,
          markup: 0, custom_pct: 0, travel_rate: 50, discount: 0,
          vat: false,
          signed_off: false,
          sections, prepared_by: this.app.settings?.prepared_by || null,
          quote_email: null, notes: `Created from retainer: ${p.name}`,
          include_in_pipeline: false,
        })
        this.app.budgets.unshift(budget)
        await linkBudgetToProject(p.id, budget.id)
        if (!Array.isArray(p.budget_ids)) p.budget_ids = []
        p.budget_ids.push(budget.id)
        overlay.remove()
        this.app.toast('Budget created — add rates to complete it')
        // Open directly in editor so line items are visible and editable
        this.app.currentView = 'budgets'
        this.app.budgetsView.currentId  = budget.id
        this.app.budgetsView.editingId  = budget.id
        this.app.render()
      } catch(e) { console.error(e); msgEl.style.display='block'; msgEl.textContent='Error creating budget' }
    })
  }

  _checkRetainerReset(p) {
    if (!p.retainer_start || !p.monthly_deliverables?.length) return
    const anchor = new Date(p.retainer_start)
    const day = anchor.getUTCDate()
    const now = new Date()
    const y = now.getUTCFullYear(), m = now.getUTCMonth()
    let periodStart = new Date(Date.UTC(y, m, day))
    if (periodStart > now) periodStart = new Date(Date.UTC(y, m - 1, day))

    const lastReset = p._lastRetainerReset ? new Date(p._lastRetainerReset) : null
    if (!lastReset || lastReset < periodStart) {
      // Reset done states on all monthly deliverables
      const anyDone = p.monthly_deliverables.some(d => d.done)
      if (anyDone) {
        p.monthly_deliverables = p.monthly_deliverables.map(d => ({ ...d, done: false }))
        p._lastRetainerReset = periodStart.toISOString()
        // Save silently
        updateProject(this.app.userId, p.id, {
          monthly_deliverables: p.monthly_deliverables,
        }).catch(console.error)
      }
    }
  }

  delivHTML(pid, d, i, isMonthly = false) {
    const pfx = isMonthly ? 'monthly-' : ''
    const today = new Date(); today.setHours(0,0,0,0)
    const due = d.due ? new Date(d.due) : null
    const daysUntil = due ? Math.round((due - today) / 86400000) : null
    const overdue  = !d.done && due && daysUntil < 0
    const dueSoon  = !d.done && due && daysUntil >= 0 && daysUntil <= 3
    const dueColour = overdue ? '#ef4444' : dueSoon ? '#f59e0b' : 'var(--text-tertiary)'
    const dueLabel  = due && !d.done
      ? overdue
        ? `${Math.abs(daysUntil)}d overdue`
        : daysUntil === 0 ? 'due today' : `${daysUntil}d left`
      : ''
    return `<div class="deliverable-row" data-di="${i}" style="${overdue?'background:rgba(239,68,68,0.04);border-radius:6px;margin:1px 0':''}">
      <input type="checkbox" class="deliverable-check" ${d.done?'checked':''} data-${pfx}deliv-done="${i}" />
      <input type="text" class="deliverable-text" value="${esc(d.text)}" placeholder="${isMonthly ? 'e.g. Monthly edit, Social content...' : 'e.g. 90s hero film, 3x social cutdowns...'}" data-${pfx}deliv-text="${i}" />
      <input type="date" class="deliverable-date" value="${d.due||''}" data-${pfx}deliv-due="${i}"
        title="Due date" style="width:120px;font-size:11px;padding:3px 6px;border:0.5px solid var(--border-light);border-radius:5px;background:transparent;color:var(--text-tertiary);font-family:var(--font);outline:none;flex-shrink:0" />
      ${dueLabel ? `<span style="font-size:10px;color:${dueColour};white-space:nowrap;flex-shrink:0;font-weight:${overdue||dueSoon?'500':'400'}">${overdue?'⚠ ':dueSoon?'⏰ ':''}${dueLabel}</span>` : ''}
      <button class="row-btn" style="color:#b03020;flex-shrink:0" data-${pfx}deliv-rem="${i}">×</button>
    </div>`
  }

  shotHTML(pid, s, i) {
    return `<div class="shot-row" data-si="${i}">
      <span class="shot-num">${i+1}.</span>
      <textarea class="shot-text" rows="1" placeholder="Describe the shot..." data-shot-text="${i}">${esc(s.text)}</textarea>
      <button class="row-btn" style="color:#b03020;flex-shrink:0" data-shot-rem="${i}">×</button>
    </div>`
  }

  crewHTML(pid, c, i) {
    return `<div class="crew-row" data-ci="${i}" data-crew-type="${esc(c.crew_type||'crew')}">
      <input type="text" class="bl-in w" value="${esc(c.name)}" placeholder="Name" data-crew-name="${i}" style="font-size:12px" />
      <input type="text" class="bl-in w" value="${esc(c.role)}" placeholder="Role" data-crew-role="${i}" style="font-size:12px" />
      <button class="row-btn" style="color:#b03020" data-crew-rem="${i}">×</button>
    </div>`
  }

  approvalHTML(pid, a, i) {
    const cls = a.status==='Approved'?'apv-approved':a.status==='Changes requested'?'apv-changes':'apv-pending'
    return `<div class="approval-row" data-ai="${i}">
      <span class="approval-label">${esc(a.label)}</span>
      <button class="approval-status ${cls}" data-cycle="${i}">${esc(a.status)}</button>
    </div>`
  }

  bindEditor(mc, p) {
    // Capture snapshot of p at the point editing begins, for diffing
    const snap = () => ({
      name: p.name, status: p.status, location: p.location,
      shoot_start: p.shoot_start, shoot_end: p.shoot_end,
      deliverables: JSON.parse(JSON.stringify(p.deliverables||[])),
      approvals: JSON.parse(JSON.stringify(p.approvals||[])),
    })
    let prevSnap = snap()
    const save = () => { this.saveField(p, prevSnap); prevSnap = snap() }
    const exitEdit = () => {
      this.editingId = null; this.render(mc); this.app.updateTitle()
    }

    mc.querySelector('#back-to-kanban')?.addEventListener('click', () => {
      this.currentId = null; this.editingId = null; this.render(mc); this.app.updateTitle()
    })
    mc.querySelector('#pe-save-close')?.addEventListener('click', exitEdit)
    mc.querySelector('#pe-delete')?.addEventListener('click', () => this.deleteProject(p.id, mc))
    mc.querySelector('#pe-status')?.addEventListener('change', e => { p.status = e.target.value; save() })
    mc.querySelector('#pe-client')?.addEventListener('change', e => { p.client_id = e.target.value || null; save() })
    mc.querySelector('#pe-brief')?.addEventListener('change',   e => { p.brief    = e.target.value; save() })
    mc.querySelector('#pe-location')?.addEventListener('change',e => { p.location = e.target.value; save() })
    mc.querySelector('#pe-location-addr')?.addEventListener('change',e => {
      const v = e.target.value.trim()
      p.location_address = v && !v.startsWith('http') ? v : null
      p.location_map_link = v && v.startsWith('http') ? v : null
      save()
    })
    mc.querySelector('#pe-parking')?.addEventListener('change',e => { p.parking_notes = e.target.value.trim()||null; save() })
    mc.querySelector('#pe-transport')?.addEventListener('change',e => { p.nearest_transport = e.target.value.trim()||null; save() })
    mc.querySelector('#pe-hosp-name')?.addEventListener('change',e => { p.nearest_hospital_name = e.target.value.trim()||null; save() })
    mc.querySelector('#pe-hosp-addr')?.addEventListener('change',e => { p.nearest_hospital_address = e.target.value.trim()||null; save() })
    mc.querySelector('#pe-police-name')?.addEventListener('change',e => { p.nearest_police_name = e.target.value.trim()||null; save() })
    mc.querySelector('#pe-police-addr')?.addEventListener('change',e => { p.nearest_police_address = e.target.value.trim()||null; save() })
    mc.querySelector('#pe-fire-name')?.addEventListener('change',e => { p.nearest_fire_name = e.target.value.trim()||null; save() })
    mc.querySelector('#pe-fire-addr')?.addEventListener('change',e => { p.nearest_fire_address = e.target.value.trim()||null; save() })

    mc.querySelector('#pe-find-nearby')?.addEventListener('click', async () => {
      const addrVal = mc.querySelector('#pe-location-addr')?.value.trim()
      const locName = mc.querySelector('#pe-location')?.value.trim()
      const btn = mc.querySelector('#pe-find-nearby')
      const result = await this._findNearbyServices(addrVal, locName, btn)
      if (!result) return
      const setField = (id, val) => { const el = mc.querySelector(id); if (el && val) el.value = val }
      if (result.transport) { setField('#pe-transport', result.transport.name); p.nearest_transport = result.transport.name }
      if (result.hospital) { setField('#pe-hosp-name', result.hospital.name); setField('#pe-hosp-addr', result.hospital.address); p.nearest_hospital_name = result.hospital.name; p.nearest_hospital_address = result.hospital.address }
      if (result.police) { setField('#pe-police-name', result.police.name); setField('#pe-police-addr', result.police.address); p.nearest_police_name = result.police.name; p.nearest_police_address = result.police.address }
      if (result.fire) { setField('#pe-fire-name', result.fire.name); setField('#pe-fire-addr', result.fire.address); p.nearest_fire_name = result.fire.name; p.nearest_fire_address = result.fire.address }
      save()
      this.app.toast('Nearby services found ✓')
    })
    mc.querySelector('#pe-start')?.addEventListener('change',   e => { p.shoot_start = e.target.value || null; save() })
    mc.querySelector('#pe-end')?.addEventListener('change',     e => { p.shoot_end   = e.target.value || null; save() })
    mc.querySelector('#pe-notes')?.addEventListener('change',   e => { p.notes   = e.target.value; save() })
    mc.querySelector('#pe-frameio')?.addEventListener('change', e => { p.frame_io_link = e.target.value.trim() || null; save() })

    // Portal token generation
    mc.querySelector('#pe-gen-portal')?.addEventListener('click', async () => {
      const token = crypto.randomUUID().replace(/-/g,'').slice(0,24)
      p.portal_token = token
      const idx = this.app.projects.findIndex(x => x.id === p.id)
      if (idx >= 0) this.app.projects[idx].portal_token = token
      try { await updateProject(this.app.userId, p.id, { portal_token: token }) } catch(e) { console.error(e) }
      this.renderEditor(mc)
    })
    mc.querySelector('#pe-regen-portal')?.addEventListener('click', async () => {
      if (!confirm('Regenerate portal link? The old link will stop working.')) return
      const token = crypto.randomUUID().replace(/-/g,'').slice(0,24)
      p.portal_token = token
      const idx = this.app.projects.findIndex(x => x.id === p.id)
      if (idx >= 0) this.app.projects[idx].portal_token = token
      try { await updateProject(this.app.userId, p.id, { portal_token: token }) } catch(e) { console.error(e) }
      this.renderEditor(mc)
    })
    mc.querySelector('#pe-copy-portal')?.addEventListener('click', async e => {
      const url = `${location.origin}/portal/${p.portal_token}`
      await navigator.clipboard.writeText(url)
      const btn = e.target; btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = 'Copy', 1500)
    })

    // Project type toggle
    mc.querySelectorAll('[data-proj-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        p.project_type = btn.dataset.projType
        save(); this.renderEditor(mc)
      })
    })

    // Retainer fields
    mc.querySelector('#pe-is-retainer')?.addEventListener('change', e => {
      p.is_retainer = e.target.checked
      if (e.target.checked) {
        if (!p.retainer_start) p.retainer_start = new Date().toISOString().split('T')[0]
        if (!p.retainer_alert) p.retainer_alert = 80
        if (!p.retainer_fee_mode) p.retainer_fee_mode = 'fixed'
        if (!Array.isArray(p.retainer_items) || p.retainer_items.length === 0) {
          p.retainer_items = [
            { label:'Shoot days', qty:1, unit:'days', rate:null, period:'month' },
            { label:'Edit days',  qty:1, unit:'days', rate:null, period:'month' },
          ]
        }
      }
      save(); this.renderEditor(mc)
    })

    // Fee mode toggle
    mc.querySelector('#pe-ret-mode-fixed')?.addEventListener('click', () => {
      p.retainer_fee_mode = 'fixed'; save(); this.renderEditor(mc)
    })
    mc.querySelector('#pe-ret-mode-calc')?.addEventListener('click', () => {
      p.retainer_fee_mode = 'calculated'; save(); this.renderEditor(mc)
    })

    mc.querySelector('#pe-ret-fee')?.addEventListener('change',   e => { p.retainer_fee   = parseFloat(e.target.value)||null; save() })
    mc.querySelector('#pe-ret-start')?.addEventListener('change', e => { p.retainer_start = e.target.value||null; save(); this.renderEditor(mc) })
    mc.querySelector('#pe-ret-alert')?.addEventListener('change', e => { p.retainer_alert = parseFloat(e.target.value)||80; save() })

    // Retainer items
    if (!Array.isArray(p.retainer_items)) p.retainer_items = []
    mc.querySelectorAll('[data-ri-label]').forEach(el => {
      el.addEventListener('change', () => { p.retainer_items[+el.dataset.riLabel].label = el.value; save() })
    })
    mc.querySelectorAll('[data-ri-qty]').forEach(el => {
      el.addEventListener('change', () => { p.retainer_items[+el.dataset.riQty].qty = parseFloat(el.value)||0; save(); if (p.retainer_fee_mode==='calculated') this.renderEditor(mc) })
    })
    mc.querySelectorAll('[data-ri-unit]').forEach(el => {
      el.addEventListener('change', () => { p.retainer_items[+el.dataset.riUnit].unit = el.value; save() })
    })
    mc.querySelectorAll('[data-ri-rate]').forEach(el => {
      el.addEventListener('change', () => { p.retainer_items[+el.dataset.riRate].rate = parseFloat(el.value)||null; save(); if (p.retainer_fee_mode==='calculated') this.renderEditor(mc) })
    })
    mc.querySelectorAll('[data-ri-period]').forEach(el => {
      el.addEventListener('change', () => { p.retainer_items[+el.dataset.riPeriod].period = el.value; save() })
    })
    mc.querySelectorAll('[data-ri-rem]').forEach(el => {
      el.addEventListener('click', () => { p.retainer_items.splice(+el.dataset.riRem, 1); save(); this.renderEditor(mc) })
    })
    mc.querySelector('#pe-add-ret-item')?.addEventListener('click', () => {
      p.retainer_items.push({ label:'', qty:1, unit:'days', rate:null, period:'month' })
      save(); this.renderEditor(mc)
    })

    mc.querySelector('#pe-delivs-all')?.addEventListener('click', () => {
      p.deliverables.forEach(d => { if (d.text) d.done = true }); save(); this.renderEditor(mc)
    })
    mc.querySelector('#pe-delivs-clear')?.addEventListener('click', () => {
      p.deliverables.forEach(d => d.done = false); save(); this.renderEditor(mc)
    })

    // Deliverables
    mc.querySelectorAll('[data-deliv-done]').forEach(el => {
      el.addEventListener('change', () => { p.deliverables[+el.dataset.delivDone].done = el.checked; save() })
    })
    mc.querySelectorAll('[data-deliv-text]').forEach(el => {
      el.addEventListener('change', () => { p.deliverables[+el.dataset.delivText].text = el.value; save() })
    })
    mc.querySelectorAll('[data-deliv-due]').forEach(el => {
      el.addEventListener('change', () => { p.deliverables[+el.dataset.delivDue].due = el.value || null; save(); this.renderEditor(mc) })
    })
    mc.querySelectorAll('[data-deliv-rem]').forEach(el => {
      el.addEventListener('click', () => {
        if (p.deliverables.length <= 1) return
        p.deliverables.splice(+el.dataset.delivRem, 1)
        save(); this.renderEditor(mc)
      })
    })
    mc.querySelector('#pe-add-deliv')?.addEventListener('click', () => {
      p.deliverables.push({ text: '', done: false }); save(); this.renderEditor(mc)
    })

    // Monthly deliverables (retainer only)
    if (!Array.isArray(p.monthly_deliverables)) p.monthly_deliverables = []
    mc.querySelectorAll('[data-monthly-deliv-done]').forEach(el => {
      el.addEventListener('change', () => { p.monthly_deliverables[+el.dataset.monthlyDelivDone].done = el.checked; save() })
    })
    mc.querySelectorAll('[data-monthly-deliv-text]').forEach(el => {
      el.addEventListener('change', () => { p.monthly_deliverables[+el.dataset.monthlyDelivText].text = el.value; save() })
    })
    mc.querySelectorAll('[data-monthly-deliv-rem]').forEach(el => {
      el.addEventListener('click', () => {
        p.monthly_deliverables.splice(+el.dataset.monthlyDelivRem, 1)
        save(); this.renderEditor(mc)
      })
    })
    mc.querySelector('#pe-add-monthly-deliv')?.addEventListener('click', () => {
      p.monthly_deliverables.push({ text: '', done: false }); save(); this.renderEditor(mc)
    })

    // Shots
    mc.querySelectorAll('[data-shot-text]').forEach(el => {
      el.addEventListener('change', () => { p.shots[+el.dataset.shotText].text = el.value; save() })
    })
    mc.querySelectorAll('[data-shot-rem]').forEach(el => {
      el.addEventListener('click', () => {
        if (p.shots.length <= 1) return
        p.shots.splice(+el.dataset.shotRem, 1); save(); this.renderEditor(mc)
      })
    })
    mc.querySelector('#pe-add-shot')?.addEventListener('click', () => {
      p.shots.push({ text: '' }); save(); this.renderEditor(mc)
    })

    // Crew
    mc.querySelector('#pe-add-user-select')?.addEventListener('change', e => {
      const opt = e.target.selectedOptions[0]
      if (!opt?.value) return
      const name = opt.dataset.name || opt.text
      const role = opt.dataset.role || ''
      if (!p.crew.some(c => c.name === name)) {
        p.crew.push({ name, role, crew_type: this._peCrewTab||'crew' }); save(); this.renderEditor(mc)
      }
      e.target.value = ''
    })
    mc.querySelector('#pe-add-sub-select')?.addEventListener('change', e => {
      const opt = e.target.selectedOptions[0]
      if (!opt?.value) return
      const name = opt.value
      const role = opt.dataset.role || ''
      if (!p.crew.some(c => c.name === name)) {
        p.crew.push({ name, role, crew_type: this._peCrewTab||'crew' }); save(); this.renderEditor(mc)
      }
      e.target.value = ''
    })
    mc.querySelectorAll('[data-crew-name]').forEach(el => {
      el.addEventListener('change', () => { p.crew[+el.dataset.crewName].name = el.value; save() })
    })
    mc.querySelectorAll('[data-crew-role]').forEach(el => {
      el.addEventListener('change', () => { p.crew[+el.dataset.crewRole].role = el.value; save() })
    })
    mc.querySelectorAll('[data-crew-rem]').forEach(el => {
      el.addEventListener('click', () => {
        if (p.crew.length <= 1) return
        p.crew.splice(+el.dataset.crewRem, 1); save(); this.renderEditor(mc)
      })
    })
    mc.querySelectorAll('[data-pe-crew-tab]').forEach(btn => {
      btn.addEventListener('click', () => { this._peCrewTab = btn.dataset.peCsCrewTab || btn.dataset.peCrewTab; this.renderEditor(mc) })
    })

    mc.querySelector('#pe-add-crew')?.addEventListener('click', () => {
      p.crew.push({ name: '', role: '', crew_type: this._peCrewTab||'crew' }); save(); this.renderEditor(mc)
    })

    // Approvals
    mc.querySelectorAll('[data-cycle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cycle = ['Pending','Approved','Changes requested']
        const i = +btn.dataset.cycle
        p.approvals[i].status = cycle[(cycle.indexOf(p.approvals[i].status) + 1) % cycle.length]
        save()
        const cls = p.approvals[i].status==='Approved'?'apv-approved':p.approvals[i].status==='Changes requested'?'apv-changes':'apv-pending'
        btn.className = `approval-status ${cls}`
        btn.textContent = p.approvals[i].status
      })
    })
    mc.querySelector('#pe-add-approval')?.addEventListener('click', () => {
      const label = prompt('Approval stage name:')
      if (!label) return
      p.approvals.push({ label, status: 'Pending' }); save(); this.renderEditor(mc)
    })

    // Budget linking
    mc.querySelector('#pe-link-budget')?.addEventListener('change', async e => {
      const bid = e.target.value
      if (!bid) return
      if (!Array.isArray(p.budget_ids)) p.budget_ids = []
      if (!p.budget_ids.includes(bid)) {
        p.budget_ids.push(bid)
        try { await linkBudgetToProject(p.id, bid); save() } catch(err) { console.error(err) }
        this.renderEditor(mc)
      }
      e.target.value = ''
    })
    mc.querySelectorAll('[data-unlink]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const bid = btn.dataset.unlink
        p.budget_ids = (p.budget_ids || []).filter(id => id !== bid)
        try { await unlinkBudgetFromProject(p.id, bid); save() } catch(err) { console.error(err) }
        this.renderEditor(mc)
      })
    })
    mc.querySelectorAll('[data-open-budget]').forEach(el => {
      el.addEventListener('click', () => this.app.openBudget(el.dataset.openBudget))
    })
    mc.querySelector('#pe-new-budget')?.addEventListener('click', () => {
      this.app.budgetsView.openNewModalFromProject(p)
    })
  }

  async _findNearbyServices(addrVal, locName, btn) {
    if (!addrVal && !locName) { this.app.toast('Enter a location first'); return null }
    const orig = btn.textContent
    btn.disabled = true; btn.textContent = 'Searching…'
    try {
      // Resolve short URLs (maps.app.goo.gl etc) server-side first
      let resolvedAddr = addrVal
      if (addrVal?.startsWith('http') && (addrVal.includes('goo.gl') || addrVal.includes('maps.app'))) {
        try {
          const r = await fetch(`/api/resolve?url=${encodeURIComponent(addrVal)}`)
          const d = await r.json()
          if (d.url) resolvedAddr = d.url
        } catch(e) { /* fall through with original */ }
      }


      // Extract coordinates from a Google Maps URL (handles all common formats)
      const extractCoords = url => {
        if (!url) return null
        const patterns = [
          /@(-?\d+\.\d+),(-?\d+\.\d+)/,           // @lat,lng
          /\/search\/(-?\d+\.\d+),\+?(-?\d+\.\d+)/, // /search/lat,+lng
          /[?&]q=(-?\d+\.\d+),\+?(-?\d+\.\d+)/,  // ?q=lat,lng
          /ll=(-?\d+\.\d+),(-?\d+\.\d+)/,          // ll=lat,lng
          /3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,         // 3d...!4d... (embedded)
        ]
        for (const p of patterns) {
          const m = url.match(p)
          if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
        }
        return null
      }

      // Get coordinates — from URL or geocoding
      let lat = null, lng = null
      if (resolvedAddr?.startsWith('http')) {
        const coords = extractCoords(resolvedAddr)
        if (coords) { lat = coords.lat; lng = coords.lng }
      }
      if (!lat) {
        const stripPostcode = s => s.replace(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/gi,'').trim()
        const terms = []
        if (addrVal && !addrVal.startsWith('http')) addrVal.split(',').map(s=>stripPostcode(s.trim())).filter(s=>s.length>1).reverse().forEach(t=>terms.push(t))
        if (locName) locName.split(',').map(s=>s.trim()).filter(Boolean).reverse().forEach(t=>terms.push(t))
        for (const term of terms) {
          const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=1&language=en&format=json`)
          const d = await r.json()
          if (d.results?.[0]) { lat = d.results[0].latitude; lng = d.results[0].longitude; break }
        }
      }
      if (!lat) { this.app.toast('Could not find location — try pasting a Google Maps URL'); return null }

      // Query our proxy (avoids CORS issues with direct Overpass requests)
      const res = await fetch(`/api/nearby?lat=${lat}&lng=${lng}`)
      if (!res.ok) throw new Error('Nearby API error')
      const data = await res.json()

      const dist = (a, b, c, d) => Math.sqrt((a-c)**2+(b-d)**2)
      const nearest = (type, subtype) => data.elements
        .filter(e => e.tags?.[type] === subtype)
        .sort((a,b) => dist(lat,lng,a.lat??a.center?.lat,a.lon??a.center?.lon) - dist(lat,lng,b.lat??b.center?.lat,b.lon??b.center?.lon))[0]

      const toResult = el => {
        if (!el) return null
        const name = el.tags?.name || el.tags?.['name:en'] || ''
        const road = el.tags?.['addr:street'] || ''
        const city = el.tags?.['addr:city'] || el.tags?.['addr:town'] || ''
        const postcode = el.tags?.['addr:postcode'] || ''
        const address = [road, city, postcode].filter(Boolean).join(', ')
        return { name, address: address || null }
      }

      const toTransport = el => {
        if (!el) return null
        const name = el.tags?.name || 'Railway station'
        const elLat = el.lat ?? el.center?.lat
        const elLng = el.lon ?? el.center?.lon
        // Rough km distance (1 degree ≈ 111km)
        const km = Math.round(Math.sqrt(((lat-elLat)*111)**2 + ((lng-elLng)*111*Math.cos(lat*Math.PI/180))**2) * 10) / 10
        return { name: `${name} railway station, ${km}km` }
      }

      const hospital  = toResult(nearest('amenity','hospital'))
      const police    = toResult(nearest('amenity','police'))
      const fire      = toResult(nearest('amenity','fire_station'))
      const transport = toTransport(nearest('railway','station'))

      if (!hospital && !police && !fire && !transport) {
        this.app.toast('No results found — try a more specific location'); return null
      }
      return { hospital, police, fire, transport }
    } catch(e) {
      console.error(e); this.app.toast('Error fetching nearby services'); return null
    } finally {
      btn.disabled = false; btn.textContent = orig
    }
  }

  async saveField(p, prevSnapshot) {
    try {
      const data = {
        name: p.name, status: p.status, client_id: p.client_id,
        brief: p.brief, location: p.location,
        project_type: p.project_type || 'full_service',
        location_address: p.location_address||null,
        location_map_link: p.location_map_link||null,
        parking_notes: p.parking_notes||null,
        nearest_transport: p.nearest_transport||null,
        nearest_hospital_name:    p.nearest_hospital_name||null,
        nearest_hospital_address: p.nearest_hospital_address||null,
        nearest_police_name:      p.nearest_police_name||null,
        nearest_police_address:   p.nearest_police_address||null,
        nearest_fire_name:        p.nearest_fire_name||null,
        nearest_fire_address:     p.nearest_fire_address||null,
        shoot_start: p.shoot_start || null, shoot_end: p.shoot_end || null,
        deliverables: p.deliverables, crew: p.crew, shots: p.shots,
        approvals: p.approvals, notes: p.notes,
        is_retainer:      p.is_retainer    ?? false,
        retainer_fee:      p.retainer_fee   ?? null,
        retainer_hours:    p.retainer_hours ?? null,
        retainer_alert:    p.retainer_alert ?? 80,
        retainer_start:    p.retainer_start || null,
        retainer_items:    p.retainer_items    ?? [],
        retainer_fee_mode: p.retainer_fee_mode ?? 'fixed',
        monthly_deliverables: p.monthly_deliverables ?? [],
        portal_token:  p.portal_token  || null,
        frame_io_link: p.frame_io_link || null,
      }
      const [updated] = await updateProject(this.app.userId, p.id, data)
      const idx = this.app.projects.findIndex(x => x.id === p.id)
      if (idx >= 0) this.app.projects[idx] = { ...updated, budget_ids: p.budget_ids ?? [] }

      // Log meaningful changes
      if (prevSnapshot) {
        const changes = []
        if (prevSnapshot.status !== p.status) changes.push(`Status → ${p.status}`)
        if (prevSnapshot.name !== p.name) changes.push(`Renamed to "${p.name}"`)
        if (prevSnapshot.location !== p.location && p.location) changes.push(`Location set to ${p.location}`)
        if (prevSnapshot.shoot_start !== p.shoot_start && p.shoot_start) changes.push(`Shoot start: ${p.shoot_start}`)
        if (prevSnapshot.shoot_end !== p.shoot_end && p.shoot_end) changes.push(`Shoot end: ${p.shoot_end}`)
        const prevDone = (prevSnapshot.deliverables||[]).filter(d=>d.done).length
        const nowDone = (p.deliverables||[]).filter(d=>d.done).length
        if (nowDone !== prevDone) changes.push(`Deliverables: ${nowDone}/${(p.deliverables||[]).filter(d=>d.text).length} done`)
        const prevAppr = (prevSnapshot.approvals||[]).map(a=>a.status).join(',')
        const nowAppr  = (p.approvals||[]).map(a=>a.status).join(',')
        if (prevAppr !== nowAppr) {
          const changed = (p.approvals||[]).filter((a,i)=>(prevSnapshot.approvals||[])[i]?.status !== a.status)
          changed.forEach(a => changes.push(`"${a.label}" → ${a.status}`))
        }
        if (changes.length) {
          logActivity(this.app.userId, 'project', p.id, p.name, changes.join(' · ')).catch(console.error)
        }
      }
    } catch (e) { console.error('Project save failed:', e) }
  }

  async deleteProject(id, mc) {
    if (!confirm('Delete this project? This cannot be undone.')) return
    try {
      await deleteProject(this.app.userId, id)
      this.app.projects = this.app.projects.filter(p => p.id !== id)
      this.currentId = null
      this.render(mc)
      this.app.updateTitle()
      this.app.toast('Project deleted')
    } catch (e) { console.error(e); this.app.toast('Error deleting project') }
  }
}
