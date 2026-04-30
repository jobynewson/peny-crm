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
      el.addEventListener('click', () => {
        this.currentId = el.dataset.open
        this.app._pushAppState(`#projects/${this.currentId}`, { view:'projects', id:this.currentId })
        this.render(mc)
        this.app.updateTitle()
      })
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

        // Fill shoot dates + location
        if (data.shoot_start || data.shoot_end || data.location) {
          mc.querySelector('#pf-shoot-fields').style.display = 'block'
          if (data.shoot_start) mc.querySelector('#pf-shoot-start').value = data.shoot_start
          if (data.shoot_end)   mc.querySelector('#pf-shoot-end').value   = data.shoot_end
          if (data.location)    mc.querySelector('#pf-location').value    = data.location
        }

        // Store full extraction for saveNew to use
        this._aiExtraction = data

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

            <div id="pf-shoot-fields" style="display:none">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
                <div class="field" style="margin:0"><div class="field-label">Shoot start</div><input type="date" id="pf-shoot-start" class="proj-input" /></div>
                <div class="field" style="margin:0"><div class="field-label">Shoot end</div><input type="date" id="pf-shoot-end" class="proj-input" /></div>
              </div>
              <div class="field"><div class="field-label">Location</div><input type="text" id="pf-location" placeholder="e.g. Brecon Beacons" /></div>
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
    const shootFields = el.querySelector('#pf-shoot-fields')
    if (shootFields) {
      shootFields.style.display = 'none'
      const ss = el.querySelector('#pf-shoot-start'); if (ss) ss.value = ''
      const se = el.querySelector('#pf-shoot-end');   if (se) se.value = ''
      const lo = el.querySelector('#pf-location');    if (lo) lo.value = ''
    }
    const briefEl = el.querySelector('#pf-brief')
    if (briefEl) briefEl.value = ''
    const aiToggle = el.querySelector('#pf-ai-toggle')
    if (aiToggle) aiToggle.textContent = 'Paste text'
    this._aiExtraction = null
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

    const ai = this._aiExtraction || {}
    const deliverables = ai.deliverables?.length
      ? ai.deliverables.map(d => ({ text: d, done: false }))
      : [{ text: '', done: false }]

    const data = {
      name,
      client_id:    clientId,
      status:       isRetainer ? 'Enquiry' : (mc.querySelector('#pf-status')?.value || 'Enquiry'),
      brief:        mc.querySelector('#pf-brief')?.value.trim() || '',
      location:     mc.querySelector('#pf-location')?.value.trim() || '',
      shoot_start:  mc.querySelector('#pf-shoot-start')?.value || null,
      shoot_end:    mc.querySelector('#pf-shoot-end')?.value   || null,
      deliverables,
      crew:         [{ name: '', role: '' }],
      shots:        [{ text: '' }],
      approvals:    [
        { label: 'Brief sign-off',    status: 'Pending' },
        { label: 'Budget approved',   status: 'Pending' },
        { label: 'Creative approved', status: 'Pending' },
        { label: 'Final delivery',    status: 'Pending' },
      ],
      budget_ids: [],
      notes: ai.notes || ai.budget_notes || '',
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
      this.app._pushAppState(`#projects/${created.id}`, { view:'projects', id:created.id })
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

          ${(p.project_type||'full_service') === 'full_service' ? `
          <div class="proj-panel">
            <div class="proj-panel-head" style="display:flex;justify-content:space-between;align-items:center">
              <span>Shoots</span>
              <button class="btn-primary" id="pv-add-shoot" style="font-size:11px;padding:4px 10px">+ Add shoot</button>
            </div>
            <div style="padding:10px 14px;display:flex;flex-direction:column;gap:6px" id="pv-shoots-list">
              ${(p._shoots||[]).length ? (p._shoots||[]).map(sh => {
                const d = sh.shoot_date ? new Date(sh.shoot_date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}) : 'No date'
                const label = sh.name || sh.location_name || 'Untitled shoot'
                const statusColor = sh.status === 'sent' ? '#6ec96e' : 'var(--text-tertiary)'
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--bg-secondary);border-radius:var(--radius-md);font-size:12px;cursor:pointer" data-open-shoot="${sh.id}">
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
                    <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${esc(d)}${sh.general_call?' · '+esc(sh.general_call):''}</div>
                  </div>
                  <span style="font-size:10px;color:${statusColor};text-transform:uppercase;letter-spacing:0.4px">${esc(sh.status||'draft')}</span>
                </div>`
              }).join('') : '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">No shoots yet</div>'}
            </div>
          </div>` : ''}

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

    // Shoots
    mc.querySelector('#pv-add-shoot')?.addEventListener('click', () => this._createShoot(mc, p))
    mc.querySelectorAll('[data-open-shoot]').forEach(el => {
      el.addEventListener('click', () => this._openShootEditor(mc, p, el.dataset.openShoot))
    })

    // Load activity log
    this._loadProjectActivity(mc, p.id)
    this._loadWorkLog(mc, p)
    // Load time tracking panel
    this._loadTimePanel(mc, p)
    // Load shoots list
    this._loadShoots(mc, p)
  }

  async _loadShoots(mc, p) {
    try {
      const { getShoots } = await import('../db/client.js')
      p._shoots = await getShoots(this.app.userId, p.id)
      // Re-render just the shoots list
      const listEl = mc.querySelector('#pv-shoots-list')
      if (!listEl) return
      listEl.innerHTML = (p._shoots||[]).length ? (p._shoots||[]).map(sh => {
        const d = sh.shoot_date ? new Date(sh.shoot_date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}) : 'No date'
        const label = sh.name || sh.location_name || 'Untitled shoot'
        const statusColor = sh.status === 'sent' ? '#6ec96e' : 'var(--text-tertiary)'
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--bg-secondary);border-radius:var(--radius-md);font-size:12px;cursor:pointer" data-open-shoot="${sh.id}">
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${esc(d)}${sh.general_call?' · '+esc(sh.general_call):''}</div>
          </div>
          <span style="font-size:10px;color:${statusColor};text-transform:uppercase;letter-spacing:0.4px">${esc(sh.status||'draft')}</span>
        </div>`
      }).join('') : '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">No shoots yet</div>'
      // Rebind
      listEl.querySelectorAll('[data-open-shoot]').forEach(el => {
        el.addEventListener('click', () => this._openShootEditor(mc, p, el.dataset.openShoot))
      })
    } catch(e) { console.error(e) }
  }

  async _createShoot(mc, p) {
    try {
      const { createShoot } = await import('../db/client.js')
      // Start with project defaults — pull phone from contacts where matched by name
      const contacts = this.app.contacts || []
      const findPhone = name => {
        const lower = (name||'').toLowerCase().trim()
        if (!lower) return ''
        const match = contacts.find(c => `${c.first_name||''} ${c.last_name||''}`.toLowerCase().trim() === lower)
        return match?.phone || ''
      }
      const crew = (p.crew||[]).filter(c => c.name).map(c => ({
        name: c.name, role: c.role||'',
        phone: c.phone || findPhone(c.name),
        crew_type: c.crew_type||'crew', call_times: {}, crew_token: null
      }))
      // Seed shoot_dates from project shoot_start/end if available
      const shoot_dates = []
      if (p.shoot_start) {
        const start = new Date(p.shoot_start)
        const end   = p.shoot_end ? new Date(p.shoot_end) : start
        for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
          shoot_dates.push({ date: d.toISOString().split('T')[0], general_call: '' })
        }
      }
      const shoot = await createShoot(this.app.userId, p.id, {
        name: '',
        shoot_date: p.shoot_start || null,
        shoot_dates,
        location_name: p.location || null,
        location_address: p.location_address || null,
        location_map_link: p.location_map_link || null,
        parking_notes: p.parking_notes || null,
        nearest_transport: p.nearest_transport || null,
        nearest_hospital_name: p.nearest_hospital_name || null,
        nearest_hospital_address: p.nearest_hospital_address || null,
        nearest_police_name: p.nearest_police_name || null,
        nearest_police_address: p.nearest_police_address || null,
        nearest_fire_name: p.nearest_fire_name || null,
        nearest_fire_address: p.nearest_fire_address || null,
        hotels: p.hotels || [],
        crew,
      })
      await this._loadShoots(mc, p)
      this._openShootEditor(mc, p, shoot.id)
    } catch(e) { console.error(e); this.app.toast('Error creating shoot') }
  }

  async _openShootEditor(mc, p, shootId) {
    try {
      const { getShoot } = await import('../db/client.js')
      const sh = await getShoot(shootId)
      if (!sh) return this.app.toast('Shoot not found')
      // Normalise JSONB arrays
      sh.crew      = Array.isArray(sh.crew)      ? sh.crew      : []
      sh.schedule  = Array.isArray(sh.schedule)  ? sh.schedule  : []
      sh.locations = Array.isArray(sh.locations) ? sh.locations : []
      sh.hotels    = Array.isArray(sh.hotels)    ? sh.hotels    : []
      sh.equipment = Array.isArray(sh.equipment) ? sh.equipment : []
      this._renderShootEditor(mc, p, sh)
    } catch(e) { console.error(e); this.app.toast('Error loading shoot') }
  }

  _renderShootEditor(mc, p, sh) {
    const origin = location.origin
    // Remove any existing overlay
    document.getElementById('shoot-editor-overlay')?.remove()

    const overlay = document.createElement('div')
    overlay.id = 'shoot-editor-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg-primary);z-index:1000;overflow-y:auto;display:flex;flex-direction:column'

    const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'long',year:'numeric'}) : 'No date'
    const shareUrl = sh.shoot_token ? `${origin}/call/${sh.shoot_token}` : ''

    overlay.innerHTML = `
      <div style="position:sticky;top:0;background:var(--bg-primary);border-bottom:0.5px solid var(--border-light);padding:10px 20px;display:flex;align-items:center;gap:12px;z-index:10">
        <button class="btn-secondary" id="se-close" style="flex-shrink:0">← Back to project</button>
        <div style="flex:1;min-width:0">
          <input id="se-name" value="${esc(sh.name||'')}" placeholder="Shoot name — e.g. Day 1 Peak District" style="width:100%;background:transparent;border:none;outline:none;font-size:15px;font-weight:500;color:var(--text-primary);font-family:var(--font);padding:3px 0" />
          <div style="font-size:11px;color:var(--text-tertiary)">${esc(p.name)}</div>
        </div>
        <span id="se-indicator" style="font-size:11px;color:var(--text-tertiary)"></span>
        <button class="btn-secondary" id="se-gen-pdf" style="flex-shrink:0;font-size:12px">📄 Generate call sheet PDF</button>
        <button class="row-btn" id="se-delete" style="color:#b03020;border-color:rgba(180,50,30,0.2);flex-shrink:0">Delete</button>
      </div>

      <div style="flex:1;padding:20px;max-width:1200px;margin:0 auto;width:100%">
        <div style="display:grid;grid-template-columns:1fr 320px;gap:20px">
          <div style="display:flex;flex-direction:column;gap:14px">

            <!-- Basics -->
            <div class="proj-panel">
              <div class="proj-panel-head" style="display:flex;justify-content:space-between;align-items:center">
                <span>Shoot dates &amp; general call times</span>
                <button class="btn-secondary" id="se-add-day" style="font-size:11px;padding:3px 10px">+ Add day</button>
              </div>
              <div class="proj-panel-body" id="se-dates-list">
                ${this._shootDatesHTML(sh)}
              </div>
            </div>

            <!-- Location -->
            <div class="proj-panel">
              <div class="proj-panel-head">Primary location</div>
              <div class="proj-panel-body">
                <div>
                  <div class="proj-field-label">Location name</div>
                  <input type="text" class="proj-input" id="se-loc-name" value="${esc(sh.location_name||'')}" placeholder="e.g. Eastnor Castle" />
                </div>
                <div style="margin-top:10px">
                  <div class="proj-field-label">Address or Maps link</div>
                  <input type="text" class="proj-input" id="se-loc-addr" value="${esc(sh.location_address||sh.location_map_link||'')}" placeholder="Full address or paste a Google Maps URL" />
                </div>
                <div class="proj-date-row" style="margin-top:10px">
                  <div>
                    <div class="proj-field-label">Parking</div>
                    <input type="text" class="proj-input" id="se-parking" value="${esc(sh.parking_notes||'')}" placeholder="e.g. On-site car park" />
                  </div>
                  <div>
                    <div class="proj-field-label">Nearest transport</div>
                    <input type="text" class="proj-input" id="se-transport" value="${esc(sh.nearest_transport||'')}" placeholder="e.g. Ledbury station, 2 miles" />
                  </div>
                </div>
                <div style="display:flex;gap:8px;align-items:flex-end;margin-top:10px">
                  <div style="flex:1">
                    <div class="proj-field-label">Weather</div>
                    <input type="text" class="proj-input" id="se-weather" value="${esc(sh.weather_text||'')}" placeholder="e.g. 12°C, partly cloudy" />
                  </div>
                  <button class="btn-secondary" id="se-fetch-weather" style="font-size:12px;white-space:nowrap">🌤 Fetch</button>
                </div>
              </div>
            </div>

            <!-- Emergency services -->
            <div class="proj-panel">
              <div class="proj-panel-head" style="display:flex;justify-content:space-between;align-items:center">
                <span>Emergency services</span>
                <button class="btn-secondary" id="se-find-nearby" style="font-size:11px;padding:3px 8px">📍 Find nearby</button>
              </div>
              <div class="proj-panel-body">
                ${[['Hospital','se-hosp','nearest_hospital'],['Police','se-police','nearest_police'],['Fire','se-fire','nearest_fire']].map(([label,id,key]) => `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
                  <div><div class="proj-field-label">${label} name</div><input type="text" class="proj-input" id="${id}-name" value="${esc(sh[key+'_name']||'')}" placeholder="${label} name" /></div>
                  <div><div class="proj-field-label">${label} address</div><input type="text" class="proj-input" id="${id}-addr" value="${esc(sh[key+'_address']||'')}" placeholder="Address" /></div>
                </div>`).join('')}
              </div>
            </div>

            <!-- Additional locations -->
            <div class="proj-panel">
              <div class="proj-panel-head" style="display:flex;justify-content:space-between;align-items:center">
                <span>Additional locations</span>
                <button class="btn-secondary" id="se-add-loc" style="font-size:11px;padding:3px 8px">+ Add</button>
              </div>
              <div class="proj-panel-body" id="se-locs-list">
                ${sh.locations.map((l,i) => this._shootLocHTML(l, i)).join('')}
                ${!sh.locations.length ? '<div style="font-size:12px;color:var(--text-tertiary)">No additional locations</div>' : ''}
              </div>
            </div>

            <!-- Schedule -->
            <div class="proj-panel">
              <div class="proj-panel-head" style="display:flex;justify-content:space-between;align-items:center">
                <span>Schedule / run of show</span>
                <button class="btn-secondary" id="se-add-sched" style="font-size:11px;padding:3px 8px">+ Add row</button>
              </div>
              <div class="proj-panel-body" id="se-sched-list">
                ${sh.schedule.map((r,i) => this._shootSchedHTML(r, i)).join('')}
                ${!sh.schedule.length ? '<div style="font-size:12px;color:var(--text-tertiary)">No schedule yet</div>' : ''}
              </div>
            </div>

            <!-- Crew (split by type) -->
            ${['crew','on_camera','client'].map(type => {
              const label = type==='on_camera' ? 'On Camera' : type==='client' ? 'Client' : 'Crew'
              return `<div class="proj-panel">
                <div class="proj-panel-head" style="display:flex;justify-content:space-between;align-items:center">
                  <span>${label}${type==='crew'?' &amp; call times':''}</span>
                  <div style="display:flex;gap:6px">
                    ${type==='crew'?`<button class="btn-secondary" id="se-fill-general" style="font-size:11px;padding:3px 8px">Fill blanks with general call</button>`:''}
                    <button class="btn-secondary" data-add-crew-type="${type}" style="font-size:11px;padding:3px 8px">+ Add</button>
                  </div>
                </div>
                <div class="proj-panel-body" id="se-crew-list-${type}">
                  ${this._shootCrewSectionHTML(sh, type)}
                </div>
              </div>`
            }).join('')}

            <!-- Hotels -->
            <div class="proj-panel">
              <div class="proj-panel-head" style="display:flex;justify-content:space-between;align-items:center">
                <span>Accommodation</span>
                <button class="btn-secondary" id="se-add-hotel" style="font-size:11px;padding:3px 8px">+ Add hotel</button>
              </div>
              <div class="proj-panel-body" id="se-hotels-list">
                ${sh.hotels.map((h,i) => this._shootHotelHTML(h, i, sh.crew)).join('')}
                ${!sh.hotels.length ? '<div style="font-size:12px;color:var(--text-tertiary)">No accommodation added</div>' : ''}
              </div>
            </div>

            <!-- Client display name -->
            <div class="proj-panel">
              <div class="proj-panel-head">Client (display)</div>
              <div class="proj-panel-body">
                ${(() => {
                  const clientContact = (this.app.contacts||[]).find(c => c.id === p.client_id)
                  const projectClient = clientContact?.company || (clientContact ? `${clientContact.first_name||''} ${clientContact.last_name||''}`.trim() : '')
                  return `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px">Defaults to project client (${esc(projectClient||'not set')}). Edit only if you need a different name on the call sheet.</div>
                  <input type="text" class="proj-input" id="se-client-display" value="${esc(sh.client_display||'')}" placeholder="${esc(projectClient || 'e.g. Red Bull UK')}" />`
                })()}
              </div>
            </div>

            <!-- Equipment -->
            <div class="proj-panel">
              <div class="proj-panel-head" style="display:flex;justify-content:space-between;align-items:center">
                <span>Equipment</span>
                <button class="btn-secondary" id="se-add-equip" style="font-size:11px;padding:3px 8px">+ Add category</button>
              </div>
              <div class="proj-panel-body" id="se-equip-list">
                ${this._shootEquipmentHTML(sh)}
              </div>
            </div>

            <!-- Insurance (per-shoot override) -->
            <div class="proj-panel">
              <div class="proj-panel-head">Insurance</div>
              <div class="proj-panel-body">
                ${(() => {
                  const s = this.app.settings || {}
                  const projHasIns = p.insurer_name || p.insurer_address
                  const settingsHasIns = s.default_insurer_name || s.default_insurer_address
                  if (projHasIns) return `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:10px">Leave blank to use project insurer: <strong style="color:var(--text-secondary)">${esc(p.insurer_name||'')}</strong></div>`
                  if (settingsHasIns) return `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:10px">Leave blank to use studio default: <strong style="color:var(--text-secondary)">${esc(s.default_insurer_name||'')}</strong></div>`
                  return `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:10px">No project or studio default — fill in here, or set defaults at project / settings level.</div>`
                })()}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                  <div><div class="proj-field-label">Insurer</div><input type="text" class="proj-input" id="se-ins-name" value="${esc(sh.insurer_name||'')}" placeholder="e.g. TYSERS" /></div>
                  <div><div class="proj-field-label">Contact</div><input type="text" class="proj-input" id="se-ins-contact" value="${esc(sh.insurer_contact||'')}" placeholder="Contact name" /></div>
                </div>
                <div style="margin-top:8px"><div class="proj-field-label">Address</div><input type="text" class="proj-input" id="se-ins-addr" value="${esc(sh.insurer_address||'')}" placeholder="Insurer address" /></div>
                <div style="margin-top:8px"><div class="proj-field-label">Email</div><input type="email" class="proj-input" id="se-ins-email" value="${esc(sh.insurer_email||'')}" placeholder="contact@insurer.com" /></div>
              </div>
            </div>

            <!-- Invoicing -->
            <div class="proj-panel">
              <div class="proj-panel-head">Invoicing (for crew)</div>
              <div class="proj-panel-body">
                <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:10px">Boilerplate text comes from Settings. The job ref is shown to crew on the call sheet so they know what to put on invoices.</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                  <div><div class="proj-field-label">Invoicing email</div><input type="email" class="proj-input" id="se-inv-email" value="${esc(sh.invoicing_email||'')}" placeholder="${esc((this.app.settings||{}).invoicing_email||'finance@yourcompany.com')}" /></div>
                  <div><div class="proj-field-label">Job reference</div><input type="text" class="proj-input" id="se-inv-ref" value="${esc(sh.invoicing_job_ref||'')}" placeholder="e.g. ProjectName_ShootName" /></div>
                </div>
              </div>
            </div>

            <!-- H&S + Notes -->
            <div class="proj-panel">
              <div class="proj-panel-head">Health &amp; safety notes</div>
              <div class="proj-panel-body">
                <textarea class="proj-textarea" id="se-hs" style="min-height:80px" placeholder="H&S notes, risks, PPE, emergency procedures...">${esc(sh.hs_notes||'')}</textarea>
              </div>
            </div>

            <!-- Risk Assessment -->
            <div class="proj-panel">
              <div class="proj-panel-head" style="display:flex;justify-content:space-between;align-items:center">
                <span>Risk Assessment</span>
                <div style="display:flex;gap:6px">
                  <button class="btn-secondary" id="se-ra-generate" style="font-size:11px;padding:3px 10px">✨ Generate with AI</button>
                  <button class="btn-cancel" id="se-ra-copy" style="font-size:11px;padding:3px 10px">Copy from shoot</button>
                  <button class="btn-cancel" id="se-ra-pdf" style="font-size:11px;padding:3px 10px">📄 Export PDF</button>
                </div>
              </div>
              <div class="proj-panel-body" id="se-ra-body">
                ${this._shootRAHTML(sh)}
              </div>
            </div>

            <div class="proj-panel">
              <div class="proj-panel-head">Notes</div>
              <div class="proj-panel-body">
                <textarea class="proj-textarea" id="se-notes" style="min-height:60px" placeholder="Any other notes for crew...">${esc(sh.notes||'')}</textarea>
              </div>
            </div>
          </div>

          <!-- Sidebar -->
          <div style="display:flex;flex-direction:column;gap:14px">
            <div class="proj-panel">
              <div class="proj-panel-head">Status &amp; share</div>
              <div class="proj-panel-body">
                <div style="margin-bottom:10px">
                  <div class="proj-field-label">Status</div>
                  <select class="proj-input" id="se-status">
                    <option value="draft" ${sh.status==='draft'?'selected':''}>Draft</option>
                    <option value="sent" ${sh.status==='sent'?'selected':''}>Sent</option>
                  </select>
                </div>
                <div class="proj-field-label">Full call sheet link</div>
                <div style="display:flex;gap:6px">
                  <input type="text" class="proj-input" readonly value="${esc(shareUrl)}" style="font-size:11px;flex:1" id="se-share-url" />
                  <button class="btn-secondary" id="se-copy-share" style="font-size:11px;padding:4px 10px">Copy</button>
                </div>
              </div>
            </div>
            <div class="proj-panel" id="se-crew-links-panel">
              <div class="proj-panel-head">Individual crew links</div>
              <div class="proj-panel-body" id="se-crew-links"></div>
            </div>
            <div class="proj-panel">
              <div class="proj-panel-head">Sync</div>
              <div class="proj-panel-body">
                <button class="btn-secondary" id="se-refresh-crew" style="font-size:11px;width:100%">↻ Refresh phones &amp; roles from contacts</button>
                <div style="font-size:11px;color:var(--text-tertiary);margin-top:6px;line-height:1.4">Pulls the latest phone numbers and roles from contacts for everyone on this shoot. Won't touch call times or anyone you've added directly to the shoot.</div>
              </div>
            </div>
          </div>
        </div>
      </div>`

    document.body.appendChild(overlay)
    // Push a history entry so the back button closes the overlay
    this.app._pushAppState(`#projects/${p.id}`, { view:'projects', id:p.id, overlay:'shoot' })
    this._bindShootEditor(overlay, mc, p, sh)
    this._renderShootCrewLinks(overlay, sh)
  }

  _shootLocHTML(l, i) {
    return `<div class="se-loc-row" style="border:0.5px solid var(--border-med);border-radius:var(--radius-md);padding:10px;margin-bottom:8px;background:var(--bg-secondary)" data-loc-idx="${i}">
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input type="text" class="bl-in w" value="${esc(l.name||'')}" placeholder="Location name" data-loc-field="${i},name" style="flex:1;font-size:12px;padding:5px 8px" />
        <input type="time" class="bl-in w" value="${esc(l.move_time||'')}" placeholder="Move time" data-loc-field="${i},move_time" style="width:90px;font-size:12px;padding:5px 8px" />
        <button class="row-btn" style="color:#c03020" data-loc-rem="${i}">×</button>
      </div>
      <input type="text" class="bl-in w" value="${esc(l.address||'')}" placeholder="Address" data-loc-field="${i},address" style="width:100%;font-size:12px;padding:5px 8px;margin-bottom:6px" />
      <input type="text" class="bl-in w" value="${esc(l.notes||'')}" placeholder="Notes" data-loc-field="${i},notes" style="width:100%;font-size:12px;padding:5px 8px" />
    </div>`
  }

  _shootSchedHTML(r, i) {
    return `<div style="display:grid;grid-template-columns:90px 1fr 28px;gap:6px;margin-bottom:6px" data-sched-idx="${i}">
      <input type="time" class="bl-in w" value="${esc(r.time||'')}" data-sched-field="${i},time" style="font-size:12px;padding:5px 8px" />
      <input type="text" class="bl-in w" value="${esc(r.description||'')}" placeholder="Description" data-sched-field="${i},description" style="font-size:12px;padding:5px 8px" />
      <button class="row-btn" style="color:#c03020" data-sched-rem="${i}">×</button>
    </div>`
  }

  // List of shoot dates with general call time per day
  _shootDatesHTML(sh) {
    const dates = Array.isArray(sh.shoot_dates) ? sh.shoot_dates : []
    if (!dates.length) {
      return `<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">No shoot dates yet — click <strong style="color:var(--text-primary)">+ Add day</strong> above</div>`
    }
    return dates.map((d, i) => `
      <div style="display:grid;grid-template-columns:140px 1fr 120px 28px;gap:8px;margin-bottom:6px;align-items:center" data-date-idx="${i}">
        <input type="date" class="proj-input" value="${d.date?String(d.date).split('T')[0]:''}" data-date-field="${i},date" style="font-size:12px;padding:5px 8px" />
        <div style="font-size:11px;color:var(--text-tertiary)">${d.date ? new Date(d.date).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}) : ''}</div>
        <input type="time" class="proj-input" value="${esc(d.general_call||'')}" placeholder="General call" data-date-field="${i},general_call" style="font-size:12px;padding:5px 8px" />
        <button class="row-btn" style="color:#c03020" data-date-rem="${i}">×</button>
      </div>`).join('')
  }

  // Render the Crew/On Camera/Client section as a grid: name | role | phone | one call-time column per shoot date
  _shootCrewSectionHTML(sh, type) {
    const dates = Array.isArray(sh.shoot_dates) ? sh.shoot_dates.filter(d => d.date) : []
    const filtered = (sh.crew || []).map((c, idx) => ({c, idx})).filter(({c}) => (c.crew_type||'crew') === type)
    if (!filtered.length) {
      return `<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">No ${type==='on_camera'?'on camera people':type==='client'?'clients':'crew'} added yet</div>`
    }
    if (!dates.length) {
      // No dates set yet — show name/role/phone/co only
      return filtered.map(({c, idx}) => `
        <div style="display:grid;grid-template-columns:1fr 1fr 130px 100px 28px;gap:6px;margin-bottom:6px" data-crew-idx="${idx}">
          <input type="text" class="bl-in w" value="${esc(c.name||'')}" placeholder="Name" data-crew-field="${idx},name" style="font-size:12px;padding:5px 8px" />
          <input type="text" class="bl-in w" value="${esc(c.role||'')}" placeholder="Role" data-crew-field="${idx},role" style="font-size:12px;padding:5px 8px" />
          <input type="tel" class="bl-in w" value="${esc(c.phone||'')}" placeholder="Phone" data-crew-field="${idx},phone" style="font-size:12px;padding:5px 8px" />
          <input type="text" class="bl-in w" value="${esc(c.co||'')}" placeholder="c/o" data-crew-field="${idx},co" style="font-size:12px;padding:5px 8px" title="e.g. Red Bull (booked through)" />
          <button class="row-btn" style="color:#c03020" data-crew-rem="${idx}">×</button>
        </div>`).join('')
    }
    // With dates — show as a table with one call-time column per date
    const dateHeaders = dates.map((d, di) => {
      const lbl = d.date ? new Date(d.date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}) : `Day ${di+1}`
      return `<th style="padding:5px 4px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);width:90px">${esc(lbl)}</th>`
    }).join('')
    const rows = filtered.map(({c, idx}) => {
      const callTimes = c.call_times && typeof c.call_times === 'object' ? c.call_times : {}
      const cells = dates.map(d => {
        const k = String(d.date).split('T')[0]
        return `<td style="padding:3px 2px"><input type="time" class="bl-in w" value="${esc(callTimes[k]||'')}" data-crew-call="${idx},${k}" style="font-size:12px;padding:5px 6px;width:100%" /></td>`
      }).join('')
      return `<tr data-crew-idx="${idx}">
        <td style="padding:3px 2px"><input type="text" class="bl-in w" value="${esc(c.name||'')}" placeholder="Name" data-crew-field="${idx},name" style="font-size:12px;padding:5px 6px;width:100%" /></td>
        <td style="padding:3px 2px"><input type="text" class="bl-in w" value="${esc(c.role||'')}" placeholder="Role" data-crew-field="${idx},role" style="font-size:12px;padding:5px 6px;width:100%" /></td>
        <td style="padding:3px 2px"><input type="tel" class="bl-in w" value="${esc(c.phone||'')}" placeholder="Phone" data-crew-field="${idx},phone" style="font-size:12px;padding:5px 6px;width:100%" /></td>
        <td style="padding:3px 2px"><input type="text" class="bl-in w" value="${esc(c.co||'')}" placeholder="c/o" data-crew-field="${idx},co" style="font-size:12px;padding:5px 6px;width:100%" title="e.g. Red Bull (booked through)" /></td>
        ${cells}
        <td style="padding:3px 2px;text-align:center"><button class="row-btn" style="color:#c03020" data-crew-rem="${idx}">×</button></td>
      </tr>`
    }).join('')
    return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:${600 + dates.length*100}px">
      <thead><tr>
        <th style="padding:5px 4px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary)">Name</th>
        <th style="padding:5px 4px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary)">Role</th>
        <th style="padding:5px 4px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);width:130px">Phone</th>
        <th style="padding:5px 4px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);width:100px" title="Booked through">c/o</th>
        ${dateHeaders}
        <th style="width:24px"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`
  }

  _shootHotelHTML(h, i, crew) {
    const allNames = (crew||[]).filter(c=>c.name).map(c=>c.name)
    const assigned = h.assigned_crew||[]
    const allAssigned = allNames.length > 0 && allNames.every(n => assigned.includes(n))
    return `<div class="se-hotel-card" style="border:0.5px solid var(--border-med);border-radius:var(--radius-md);padding:12px;margin-bottom:8px;background:var(--bg-secondary)" data-hotel-idx="${i}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <input type="text" class="proj-input" value="${esc(h.name||'')}" placeholder="Hotel name" data-hotel-field="${i},name" style="flex:1;margin-right:8px" />
        <button class="row-btn" style="color:#c03020;flex-shrink:0" data-hotel-rem="${i}">×</button>
      </div>
      <input type="text" class="proj-input" value="${esc(h.address||'')}" placeholder="Address or Maps URL" data-hotel-field="${i},address" style="margin-bottom:8px" />
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><div class="proj-field-label">Check-in</div><input type="datetime-local" class="proj-input" value="${h.check_in||''}" data-hotel-field="${i},check_in" /></div>
        <div><div class="proj-field-label">Check-out</div><input type="datetime-local" class="proj-input" value="${h.check_out||''}" data-hotel-field="${i},check_out" /></div>
      </div>
      <div class="proj-field-label">Accommodation notes</div>
      <textarea class="proj-textarea" placeholder="e.g. Check out before last shoot day. Breakfast included. Room list to follow." data-hotel-field="${i},notes" style="width:100%;min-height:48px;margin-bottom:10px;font-size:12px;font-family:inherit">${esc(h.notes||'')}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div class="proj-field-label" style="margin:0">Crew staying here</div>
        ${allNames.length ? `<button class="btn-cancel" style="font-size:11px;padding:2px 9px" data-hotel-everyone="${i}">${allAssigned ? 'Clear all' : 'Everyone'}</button>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px" id="se-hotel-crew-${i}">
        ${allNames.map(name => {
          const checked = assigned.includes(name)
          return `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;background:var(--bg-primary);border:0.5px solid var(--border-med);border-radius:20px;padding:3px 10px">
            <input type="checkbox" ${checked?'checked':''} data-hotel-crew="${i}" data-crew-name="${esc(name)}" style="cursor:pointer;width:12px;height:12px" />
            ${esc(name)}
          </label>`
        }).join('')}
        ${!allNames.length ? '<span style="font-size:12px;color:var(--text-tertiary)">Add crew first</span>' : ''}
      </div>
    </div>`
  }

  _shootEquipmentHTML(sh) {
    const eq = Array.isArray(sh.equipment) ? sh.equipment : []
    if (!eq.length) {
      return `<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0">No equipment categories added yet. Click <strong style="color:var(--text-primary)">+ Add category</strong> to start (e.g. Camera, Hard Drives, Misc, Catering).</div>`
    }
    return eq.map((e, i) => `
      <div class="se-equip-card" style="border:0.5px solid var(--border-med);border-radius:var(--radius-md);padding:10px;margin-bottom:8px;background:var(--bg-secondary)" data-equip-idx="${i}">
        <div style="display:grid;grid-template-columns:1fr 140px 28px;gap:6px;margin-bottom:6px">
          <input type="text" class="proj-input" value="${esc(e.category||'')}" placeholder="Category — e.g. Camera Equipment" data-equip-field="${i},category" style="font-size:13px;font-weight:500" />
          <input type="text" class="proj-input" value="${esc(e.supplier||'')}" placeholder="Supplied by — e.g. C/O Production" data-equip-field="${i},supplier" style="font-size:12px" />
          <button class="row-btn" style="color:#c03020" data-equip-rem="${i}">×</button>
        </div>
        <textarea class="proj-textarea" placeholder="Equipment list / notes — e.g. Mix of Reds, Sonys, Canons. 2x GoPro 13, FPV drone, Mavic" data-equip-field="${i},description" style="width:100%;min-height:50px;font-size:12px;font-family:inherit">${esc(e.description||'')}</textarea>
      </div>`).join('')
  }

  _shootRAHTML(sh) {
    const ra = (sh.risk_assessment && typeof sh.risk_assessment === 'object') ? sh.risk_assessment : {}
    const hazards = Array.isArray(ra.hazards) ? ra.hazards : []
    const riskCell = (l, s) => {
      const score = (parseInt(l)||0) * (parseInt(s)||0)
      const color = score >= 15 ? '#c03020' : score >= 8 ? '#d98020' : score >= 4 ? '#c0a030' : '#5a9a5a'
      return `<span style="display:inline-block;min-width:22px;text-align:center;padding:1px 4px;background:${color};color:white;border-radius:3px;font-size:11px;font-weight:500">${score||''}</span>`
    }
    if (!hazards.length) {
      return `<div style="font-size:12px;color:var(--text-tertiary);padding:6px 0">No risk assessment yet. Click <strong style="color:var(--text-primary)">✨ Generate with AI</strong> to create one based on this shoot's details, or <strong style="color:var(--text-primary)">Copy from shoot</strong> to duplicate one from another shoot.</div>`
    }
    return `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:800px">
          <thead>
            <tr style="background:var(--bg-secondary)">
              <th style="padding:8px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light);width:18%">Hazard</th>
              <th style="padding:8px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light);width:13%">Who at risk</th>
              <th style="padding:8px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light);width:18%">Existing controls</th>
              <th style="padding:8px;text-align:center;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light)" title="Likelihood">L</th>
              <th style="padding:8px;text-align:center;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light)" title="Severity">S</th>
              <th style="padding:8px;text-align:center;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light)">Risk</th>
              <th style="padding:8px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light);width:18%">Additional controls</th>
              <th style="padding:8px;text-align:center;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light)" title="Residual likelihood">rL</th>
              <th style="padding:8px;text-align:center;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light)" title="Residual severity">rS</th>
              <th style="padding:8px;text-align:center;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light)">Res.</th>
              <th style="padding:8px;text-align:left;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);border-bottom:0.5px solid var(--border-light);width:10%">Owner</th>
              <th style="padding:8px;border-bottom:0.5px solid var(--border-light);width:24px"></th>
            </tr>
          </thead>
          <tbody>
            ${hazards.map((h, i) => `
              <tr style="border-bottom:0.5px solid var(--border-light);vertical-align:top">
                <td style="padding:6px 4px"><textarea class="bl-in w" data-ra-field="${i},hazard" style="width:100%;min-height:60px;font-size:11px;padding:4px 6px;resize:vertical">${esc(h.hazard||'')}</textarea></td>
                <td style="padding:6px 4px"><textarea class="bl-in w" data-ra-field="${i},who_at_risk" style="width:100%;min-height:60px;font-size:11px;padding:4px 6px;resize:vertical">${esc(h.who_at_risk||'')}</textarea></td>
                <td style="padding:6px 4px"><textarea class="bl-in w" data-ra-field="${i},existing_controls" style="width:100%;min-height:60px;font-size:11px;padding:4px 6px;resize:vertical">${esc(h.existing_controls||'')}</textarea></td>
                <td style="padding:6px 4px;text-align:center"><input type="number" class="bl-in w" min="1" max="5" value="${h.likelihood||''}" data-ra-field="${i},likelihood" style="width:38px;font-size:11px;padding:4px;text-align:center" /></td>
                <td style="padding:6px 4px;text-align:center"><input type="number" class="bl-in w" min="1" max="5" value="${h.severity||''}" data-ra-field="${i},severity" style="width:38px;font-size:11px;padding:4px;text-align:center" /></td>
                <td style="padding:6px 4px;text-align:center">${riskCell(h.likelihood, h.severity)}</td>
                <td style="padding:6px 4px"><textarea class="bl-in w" data-ra-field="${i},additional_controls" style="width:100%;min-height:60px;font-size:11px;padding:4px 6px;resize:vertical">${esc(h.additional_controls||'')}</textarea></td>
                <td style="padding:6px 4px;text-align:center"><input type="number" class="bl-in w" min="1" max="5" value="${h.residual_likelihood||''}" data-ra-field="${i},residual_likelihood" style="width:38px;font-size:11px;padding:4px;text-align:center" /></td>
                <td style="padding:6px 4px;text-align:center"><input type="number" class="bl-in w" min="1" max="5" value="${h.residual_severity||''}" data-ra-field="${i},residual_severity" style="width:38px;font-size:11px;padding:4px;text-align:center" /></td>
                <td style="padding:6px 4px;text-align:center">${riskCell(h.residual_likelihood, h.residual_severity)}</td>
                <td style="padding:6px 4px"><input type="text" class="bl-in w" value="${esc(h.responsible||'')}" data-ra-field="${i},responsible" style="width:100%;font-size:11px;padding:4px 6px" /></td>
                <td style="padding:6px 2px;text-align:center"><button class="row-btn" style="color:#c03020;padding:2px 6px;font-size:11px" data-ra-rem="${i}">×</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <button class="add-line" id="se-ra-add" style="margin-top:10px">+ add hazard</button>

      <div style="margin-top:16px;padding-top:14px;border-top:0.5px solid var(--border-light)">
        <div class="proj-field-label" style="margin-bottom:6px">Assessment notes</div>
        <textarea class="proj-textarea" id="se-ra-notes" style="width:100%;min-height:50px;font-size:12px" placeholder="Overall assessment notes, contingencies, etc.">${esc(ra.notes||'')}</textarea>
      </div>

      <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr 140px;gap:10px">
        <div>
          <div class="proj-field-label">Assessed by</div>
          <input type="text" class="proj-input" id="se-ra-assessor" value="${esc(ra.assessor_name||'')}" placeholder="Name" />
        </div>
        <div>
          <div class="proj-field-label">Role</div>
          <input type="text" class="proj-input" id="se-ra-role" value="${esc(ra.assessor_role||'')}" placeholder="e.g. Producer" />
        </div>
        <div>
          <div class="proj-field-label">Date</div>
          <input type="date" class="proj-input" id="se-ra-date" value="${ra.assessed_date||''}" />
        </div>
      </div>

      <div style="margin-top:10px;font-size:10px;color:var(--text-tertiary);line-height:1.5">
        <strong>Scale:</strong> Likelihood 1 (rare) → 5 (almost certain). Severity 1 (minor) → 5 (catastrophic). Score = L × S.
        <span style="color:#5a9a5a">●</span> Low (1–3) ·
        <span style="color:#c0a030">●</span> Medium (4–7) ·
        <span style="color:#d98020">●</span> High (8–14) ·
        <span style="color:#c03020">●</span> Critical (15–25)
      </div>
    `
  }

  _renderShootCrewLinks(overlay, sh) {
    const el = overlay.querySelector('#se-crew-links')
    if (!el) return
    const origin = location.origin
    const namedCrew = (sh.crew||[]).filter(c => c.name && c.crew_token)
    if (!namedCrew.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);padding:6px 0">Crew links appear after saving</div>'
      return
    }
    el.innerHTML = namedCrew.map(c => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:12px">
        <span>${esc(c.name)}</span>
        <button class="btn-cancel" style="font-size:10px;padding:2px 7px" data-copy-crew="${origin}/call/${sh.shoot_token}?crew=${c.crew_token}">Copy</button>
      </div>`).join('')
    el.querySelectorAll('[data-copy-crew]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(btn.dataset.copyCrew)
        btn.textContent = '✓'; setTimeout(() => btn.textContent = 'Copy', 1500)
      })
    })
  }

  _bindShootEditor(overlay, mc, p, sh) {
    const indicator = overlay.querySelector('#se-indicator')
    const showSaving = () => { if (indicator) { indicator.textContent = 'Saving…'; indicator.style.color = 'var(--accent)' } }
    const showSaved  = () => { if (indicator) { indicator.textContent = '✓ Saved'; indicator.style.color = 'var(--text-tertiary)'; setTimeout(() => { if (indicator) indicator.textContent = '' }, 2000) } }

    const save = async () => {
      showSaving()
      // Gather location_address split
      const addrVal = overlay.querySelector('#se-loc-addr')?.value.trim()
      const isUrl = addrVal?.startsWith('http')
      // Take first date as primary shoot_date for backwards compat / sorting
      const dates = Array.isArray(sh.shoot_dates) ? sh.shoot_dates : []
      const firstDate = dates.find(d => d.date)
      const data = {
        name:              overlay.querySelector('#se-name')?.value.trim() || null,
        shoot_date:        firstDate?.date || null,
        shoot_dates:       dates,
        status:            overlay.querySelector('#se-status')?.value || 'draft',
        general_call:      firstDate?.general_call || null,
        location_name:     overlay.querySelector('#se-loc-name')?.value.trim() || null,
        location_address:  !isUrl ? (addrVal || null) : null,
        location_map_link: isUrl ? addrVal : null,
        parking_notes:     overlay.querySelector('#se-parking')?.value.trim() || null,
        nearest_transport: overlay.querySelector('#se-transport')?.value.trim() || null,
        nearest_hospital_name:    overlay.querySelector('#se-hosp-name')?.value.trim() || null,
        nearest_hospital_address: overlay.querySelector('#se-hosp-addr')?.value.trim() || null,
        nearest_police_name:      overlay.querySelector('#se-police-name')?.value.trim() || null,
        nearest_police_address:   overlay.querySelector('#se-police-addr')?.value.trim() || null,
        nearest_fire_name:        overlay.querySelector('#se-fire-name')?.value.trim() || null,
        nearest_fire_address:     overlay.querySelector('#se-fire-addr')?.value.trim() || null,
        weather_text:      overlay.querySelector('#se-weather')?.value.trim() || null,
        weather_fetched_at: sh.weather_fetched_at || null,
        hs_notes:          overlay.querySelector('#se-hs')?.value.trim() || null,
        notes:             overlay.querySelector('#se-notes')?.value.trim() || null,
        hotels:    sh.hotels    || [],
        crew:      sh.crew      || [],
        schedule:  sh.schedule  || [],
        locations: sh.locations || [],
        equipment: sh.equipment || [],
        risk_assessment: sh.risk_assessment || {},
        client_display:    overlay.querySelector('#se-client-display')?.value.trim() || null,
        insurer_name:      overlay.querySelector('#se-ins-name')?.value.trim()    || null,
        insurer_address:   overlay.querySelector('#se-ins-addr')?.value.trim()    || null,
        insurer_email:     overlay.querySelector('#se-ins-email')?.value.trim()   || null,
        insurer_contact:   overlay.querySelector('#se-ins-contact')?.value.trim() || null,
        invoicing_email:   overlay.querySelector('#se-inv-email')?.value.trim()   || null,
        invoicing_job_ref: overlay.querySelector('#se-inv-ref')?.value.trim()     || null,
      }
      try {
        const { updateShoot } = await import('../db/client.js')
        const updated = await updateShoot(sh.id, data)
        // Merge server state (crew tokens are generated on save)
        Object.assign(sh, updated)
        sh.crew      = Array.isArray(sh.crew)      ? sh.crew      : []
        sh.schedule  = Array.isArray(sh.schedule)  ? sh.schedule  : []
        sh.locations = Array.isArray(sh.locations) ? sh.locations : []
        sh.hotels    = Array.isArray(sh.hotels)    ? sh.hotels    : []
        sh.equipment = Array.isArray(sh.equipment) ? sh.equipment : []
        sh.shoot_dates = Array.isArray(sh.shoot_dates) ? sh.shoot_dates : []
        showSaved()
        // Refresh crew links sidebar (tokens may have been generated)
        this._renderShootCrewLinks(overlay, sh)
      } catch(e) { console.error(e); if (indicator) { indicator.textContent = '⚠ Save failed'; indicator.style.color = '#e07070' } }
    }

    // Close
    overlay.querySelector('#se-close')?.addEventListener('click', () => {
      overlay.remove()
      this._loadShoots(mc, p)
    })

    // Delete
    overlay.querySelector('#se-delete')?.addEventListener('click', async () => {
      if (!confirm('Delete this shoot? This cannot be undone.')) return
      try {
        const { deleteShoot } = await import('../db/client.js')
        await deleteShoot(sh.id)
        overlay.remove()
        await this._loadShoots(mc, p)
        this.app.toast('Shoot deleted')
      } catch(e) { console.error(e); this.app.toast('Error deleting shoot') }
    })

    // Top-level fields — autosave on change (no longer includes #se-date / #se-general-call)
    overlay.querySelectorAll('#se-name,#se-status,#se-loc-name,#se-loc-addr,#se-parking,#se-transport,#se-weather,#se-hs,#se-notes,#se-hosp-name,#se-hosp-addr,#se-police-name,#se-police-addr,#se-fire-name,#se-fire-addr,#se-client-display,#se-ins-name,#se-ins-addr,#se-ins-email,#se-ins-contact,#se-inv-email,#se-inv-ref').forEach(el => {
      el.addEventListener('change', save)
    })

    // Shoot dates list
    if (!Array.isArray(sh.shoot_dates)) sh.shoot_dates = []
    const refreshDates = () => {
      const list = overlay.querySelector('#se-dates-list')
      if (list) list.innerHTML = this._shootDatesHTML(sh)
      bindDateList()
      // Crew sections also need re-rendering since columns depend on dates
      this._refreshAllCrewSections(overlay, sh, save)
    }
    const bindDateList = () => {
      overlay.querySelectorAll('[data-date-field]').forEach(el => {
        el.addEventListener('change', () => {
          const [i, f] = el.dataset.dateField.split(',')
          if (!sh.shoot_dates[+i]) return
          const oldVal = sh.shoot_dates[+i][f]
          sh.shoot_dates[+i][f] = el.value
          // If editing a date and crew have call_times keyed to the old date, migrate
          if (f === 'date' && oldVal && oldVal !== el.value) {
            const oldKey = String(oldVal).split('T')[0]
            const newKey = String(el.value).split('T')[0]
            sh.crew.forEach(c => {
              if (c.call_times && c.call_times[oldKey] != null) {
                c.call_times[newKey] = c.call_times[oldKey]
                delete c.call_times[oldKey]
              }
            })
          }
          refreshDates()
          save()
        })
      })
      overlay.querySelectorAll('[data-date-rem]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = +btn.dataset.dateRem
          const removed = sh.shoot_dates[i]
          // Drop call_times for that date too
          if (removed?.date) {
            const k = String(removed.date).split('T')[0]
            sh.crew.forEach(c => { if (c.call_times) delete c.call_times[k] })
          }
          sh.shoot_dates.splice(i, 1)
          refreshDates()
          save()
        })
      })
    }
    overlay.querySelector('#se-add-day')?.addEventListener('click', () => {
      sh.shoot_dates.push({ date: '', general_call: '' })
      refreshDates()
      save()
    })
    bindDateList()

    // Fill blanks with general call (per-day, fills any blank crew call time for that day with that day's general call)
    overlay.querySelector('#se-fill-general')?.addEventListener('click', () => {
      const dates = sh.shoot_dates.filter(d => d.date && d.general_call)
      if (!dates.length) { this.app.toast('Set general call times on each day first'); return }
      sh.crew.forEach(c => {
        if (!c.call_times) c.call_times = {}
        dates.forEach(d => {
          const k = String(d.date).split('T')[0]
          if (!c.call_times[k]) c.call_times[k] = d.general_call
        })
      })
      this._refreshAllCrewSections(overlay, sh, save)
      save()
    })

    // Weather fetch
    overlay.querySelector('#se-fetch-weather')?.addEventListener('click', async () => {
      const btn = overlay.querySelector('#se-fetch-weather')
      const addrVal = overlay.querySelector('#se-loc-addr')?.value.trim()
      const locName = overlay.querySelector('#se-loc-name')?.value.trim()
      const firstDate = (sh.shoot_dates || []).find(d => d.date)
      const date = firstDate?.date ? String(firstDate.date).split('T')[0] : ''
      if (!date) { this.app.toast('Add a shoot date first'); return }
      if (!addrVal && !locName) { this.app.toast('Enter a location first'); return }
      btn.disabled = true; btn.textContent = 'Fetching…'
      try {
        let resolvedAddr = addrVal
        if (addrVal?.startsWith('http') && (addrVal.includes('goo.gl') || addrVal.includes('maps.app'))) {
          try {
            const r = await fetch(`/api/resolve?url=${encodeURIComponent(addrVal)}`)
            const d = await r.json()
            if (d.url) resolvedAddr = d.url
          } catch(e){}
        }
        const extractCoords = url => {
          if (!url) return null
          const patterns = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /\/search\/(-?\d+\.\d+),\+?(-?\d+\.\d+)/, /[?&]q=(-?\d+\.\d+),\+?(-?\d+\.\d+)/, /ll=(-?\d+\.\d+),(-?\d+\.\d+)/, /3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/]
          for (const p of patterns) { const m = url.match(p); if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } }
          return null
        }
        let lat=null, lng=null
        if (resolvedAddr?.startsWith('http')) { const c = extractCoords(resolvedAddr); if (c) { lat=c.lat; lng=c.lng } }
        if (!lat) {
          const term = (locName || addrVal || '').split(',')[0].trim()
          const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=1&language=en&format=json`)
          const d = await r.json()
          if (d.results?.[0]) { lat=d.results[0].latitude; lng=d.results[0].longitude }
        }
        if (!lat) { this.app.toast('Could not find location'); btn.disabled=false; btn.textContent='🌤 Fetch'; return }
        const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,weathercode&timezone=Europe%2FLondon&start_date=${date}&end_date=${date}`).then(r=>r.json())
        const d = wx.daily
        const codeDesc = { 0:'Clear', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast', 45:'Fog', 48:'Fog', 51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle', 61:'Light rain', 63:'Rain', 65:'Heavy rain', 71:'Light snow', 73:'Snow', 75:'Heavy snow', 80:'Rain showers', 81:'Rain showers', 82:'Heavy rain showers', 95:'Thunderstorm' }
        const txt = `${codeDesc[d.weathercode[0]]||'Mixed'} · ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])}°C · Wind ${Math.round(d.windspeed_10m_max[0])}km/h · Rain ${d.precipitation_probability_max[0]}%`
        overlay.querySelector('#se-weather').value = txt
        sh.weather_fetched_at = new Date().toISOString()
        save()
      } catch(e) { console.error(e); this.app.toast('Weather fetch failed') }
      finally { btn.disabled=false; btn.textContent='🌤 Fetch' }
    })

    // Find nearby services
    overlay.querySelector('#se-find-nearby')?.addEventListener('click', async () => {
      const btn = overlay.querySelector('#se-find-nearby')
      const addrVal = overlay.querySelector('#se-loc-addr')?.value.trim()
      const locName = overlay.querySelector('#se-loc-name')?.value.trim()
      const result = await this._findNearbyServices(addrVal, locName, btn)
      if (!result) return
      const setField = (id, val) => { const el = overlay.querySelector(id); if (el && val) el.value = val }
      if (result.transport) { setField('#se-transport', result.transport.name) }
      if (result.hospital)  { setField('#se-hosp-name',   result.hospital.name);  setField('#se-hosp-addr',   result.hospital.address) }
      if (result.police)    { setField('#se-police-name', result.police.name);    setField('#se-police-addr', result.police.address) }
      if (result.fire)      { setField('#se-fire-name',   result.fire.name);      setField('#se-fire-addr',   result.fire.address) }
      save()
      this.app.toast('Nearby services found ✓')
    })

    // Copy share link
    overlay.querySelector('#se-copy-share')?.addEventListener('click', async e => {
      const url = overlay.querySelector('#se-share-url')?.value
      if (!url) return
      await navigator.clipboard.writeText(url)
      e.target.textContent = '✓'; setTimeout(() => e.target.textContent = 'Copy', 1500)
    })

    // Generate PDF
    overlay.querySelector('#se-gen-pdf')?.addEventListener('click', () => {
      this._generateShootPDF(sh, p)
    })

    // Refresh phones & roles from contacts
    overlay.querySelector('#se-refresh-crew')?.addEventListener('click', () => {
      const contacts = this.app.contacts || []
      let updated = 0
      sh.crew.forEach(c => {
        if (!c.name) return
        const fullName = c.name.trim().toLowerCase()
        const match = contacts.find(ct =>
          `${ct.first_name||''} ${ct.last_name||''}`.toLowerCase().trim() === fullName
        )
        if (!match) return
        let changed = false
        if (match.phone && match.phone !== c.phone) { c.phone = match.phone; changed = true }
        if (match.role && match.role !== c.role)    { c.role  = match.role;  changed = true }
        if (changed) updated++
      })
      if (!updated) { this.app.toast('All crew already up to date'); return }
      this._refreshAllCrewSections(overlay, sh, save)
      save()
      this.app.toast(`Updated ${updated} crew member${updated>1?'s':''} ✓`)
    })

    // Locations
    overlay.querySelector('#se-add-loc')?.addEventListener('click', () => {
      sh.locations.push({ name:'', address:'', move_time:'', notes:'' })
      this._refreshShootLocs(overlay, sh, save)
      save()
    })
    this._bindShootLocs(overlay, sh, save)

    // Schedule
    overlay.querySelector('#se-add-sched')?.addEventListener('click', () => {
      sh.schedule.push({ time:'', description:'' })
      this._refreshShootSched(overlay, sh, save)
    })
    this._bindShootSched(overlay, sh, save)

    // Crew (split into 3 sections: crew / on_camera / client)
    overlay.querySelectorAll('[data-add-crew-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        sh.crew.push({ name:'', role:'', phone:'', call_times:{}, crew_type: btn.dataset.addCrewType })
        this._refreshAllCrewSections(overlay, sh, save)
      })
    })
    this._bindShootCrew(overlay, sh, save)

    // Hotels
    overlay.querySelector('#se-add-hotel')?.addEventListener('click', () => {
      sh.hotels.push({ name:'', address:'', check_in:'', check_out:'', notes:'', assigned_crew:[] })
      this._refreshShootHotels(overlay, sh, save)
    })
    this._bindShootHotels(overlay, sh, save)

    // Equipment
    if (!Array.isArray(sh.equipment)) sh.equipment = []
    overlay.querySelector('#se-add-equip')?.addEventListener('click', () => {
      sh.equipment.push({ category:'', supplier:'', description:'' })
      this._refreshShootEquipment(overlay, sh, save)
      save()
    })
    this._bindShootEquipment(overlay, sh, save)

    // Risk Assessment
    this._bindShootRA(overlay, sh, save)
    overlay.querySelector('#se-ra-generate')?.addEventListener('click', () => this._generateRA(overlay, sh, save))
    overlay.querySelector('#se-ra-copy')?.addEventListener('click', () => this._openRACopyPicker(overlay, sh, save))
    overlay.querySelector('#se-ra-pdf')?.addEventListener('click', () => this._generateRAPDF(sh, p))
  }

  _bindShootEquipment(overlay, sh, save) {
    overlay.querySelectorAll('#se-equip-list [data-equip-field]').forEach(el => {
      el.addEventListener('change', () => {
        const [i, f] = el.dataset.equipField.split(',')
        if (!sh.equipment[+i]) return
        sh.equipment[+i][f] = el.value
        save()
      })
    })
    overlay.querySelectorAll('#se-equip-list [data-equip-rem]').forEach(btn => {
      btn.addEventListener('click', () => {
        sh.equipment.splice(+btn.dataset.equipRem, 1)
        this._refreshShootEquipment(overlay, sh, save); save()
      })
    })
  }
  _refreshShootEquipment(overlay, sh, save) {
    const el = overlay.querySelector('#se-equip-list')
    if (!el) return
    el.innerHTML = this._shootEquipmentHTML(sh)
    this._bindShootEquipment(overlay, sh, save)
  }

  _bindShootRA(overlay, sh, save) {
    if (!sh.risk_assessment || typeof sh.risk_assessment !== 'object') sh.risk_assessment = { hazards: [] }
    if (!Array.isArray(sh.risk_assessment.hazards)) sh.risk_assessment.hazards = []

    overlay.querySelectorAll('#se-ra-body [data-ra-field]').forEach(el => {
      el.addEventListener('change', () => {
        const [i, f] = el.dataset.raField.split(',')
        const val = ['likelihood','severity','residual_likelihood','residual_severity'].includes(f)
          ? Math.max(1, Math.min(5, parseInt(el.value)||0)) || null
          : el.value
        if (!sh.risk_assessment.hazards[+i]) return
        sh.risk_assessment.hazards[+i][f] = val
        save()
        // Refresh just the risk cells without losing focus by re-rendering the whole panel after save
        if (['likelihood','severity','residual_likelihood','residual_severity'].includes(f)) {
          this._refreshShootRA(overlay, sh, save)
        }
      })
    })
    overlay.querySelectorAll('#se-ra-body [data-ra-rem]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Remove this hazard row?')) return
        sh.risk_assessment.hazards.splice(+btn.dataset.raRem, 1)
        this._refreshShootRA(overlay, sh, save); save()
      })
    })
    overlay.querySelector('#se-ra-add')?.addEventListener('click', () => {
      sh.risk_assessment.hazards.push({ hazard:'', who_at_risk:'', existing_controls:'', likelihood:null, severity:null, additional_controls:'', residual_likelihood:null, residual_severity:null, responsible:'' })
      this._refreshShootRA(overlay, sh, save); save()
    })
    overlay.querySelector('#se-ra-notes')?.addEventListener('change', e => {
      sh.risk_assessment.notes = e.target.value; save()
    })
    overlay.querySelector('#se-ra-assessor')?.addEventListener('change', e => {
      sh.risk_assessment.assessor_name = e.target.value; save()
    })
    overlay.querySelector('#se-ra-role')?.addEventListener('change', e => {
      sh.risk_assessment.assessor_role = e.target.value; save()
    })
    overlay.querySelector('#se-ra-date')?.addEventListener('change', e => {
      sh.risk_assessment.assessed_date = e.target.value; save()
    })
  }

  _refreshShootRA(overlay, sh, save) {
    const body = overlay.querySelector('#se-ra-body')
    if (!body) return
    body.innerHTML = this._shootRAHTML(sh)
    this._bindShootRA(overlay, sh, save)
  }

  async _generateRA(overlay, sh, save) {
    const btn = overlay.querySelector('#se-ra-generate')
    const hadOne = sh.risk_assessment?.hazards?.length > 0
    if (hadOne && !confirm('This will replace the existing risk assessment. Continue?')) return
    btn.disabled = true; btn.textContent = '✨ Generating…'
    try {
      const res = await fetch('/api/generate-ra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shoot_id: sh.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      // Preserve existing assessor info if set
      const existing = sh.risk_assessment || {}
      sh.risk_assessment = {
        hazards: data.hazards || [],
        notes: data.notes || existing.notes || '',
        assessor_name: existing.assessor_name || '',
        assessor_role: existing.assessor_role || '',
        assessed_date: existing.assessed_date || new Date().toISOString().split('T')[0],
      }
      this._refreshShootRA(overlay, sh, save)
      save()
      this.app.toast(`Generated ${data.hazards?.length||0} hazards ✓`)
    } catch(e) {
      console.error(e); this.app.toast('Generation failed — check your API key')
    } finally {
      btn.disabled = false; btn.textContent = '✨ Generate with AI'
    }
  }

  async _openRACopyPicker(overlay, sh, save) {
    try {
      const { getShootsWithRA } = await import('../db/client.js')
      const shoots = await getShootsWithRA(this.app.userId)
      const available = shoots.filter(s => s.id !== sh.id)
      if (!available.length) { this.app.toast('No other shoots with risk assessments yet'); return }

      // Build picker modal
      document.getElementById('ra-copy-picker')?.remove()
      const picker = document.createElement('div')
      picker.id = 'ra-copy-picker'
      picker.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px'
      const esc_ = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      picker.innerHTML = `
        <div style="background:var(--bg-primary);border-radius:var(--radius-lg);max-width:500px;width:100%;max-height:80vh;display:flex;flex-direction:column">
          <div style="padding:14px 18px;border-bottom:0.5px solid var(--border-light);display:flex;justify-content:space-between;align-items:center">
            <strong style="font-size:14px">Copy risk assessment from another shoot</strong>
            <button id="ra-pick-close" class="row-btn">×</button>
          </div>
          <div style="padding:14px 18px;overflow-y:auto;flex:1">
            <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:10px">Select a shoot to copy its hazards from. You can edit them afterwards.</div>
            ${available.map(s => {
              const hazardCount = Array.isArray(s.risk_assessment?.hazards) ? s.risk_assessment.hazards.length : 0
              const d = s.shoot_date ? new Date(s.shoot_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : ''
              return `<div class="ra-pick-item" data-pick-id="${s.id}" style="padding:10px 12px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);margin-bottom:6px;cursor:pointer" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
                <div style="font-size:13px;font-weight:500">${esc_(s.name || s.location_name || 'Untitled shoot')}</div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${esc_(s.project_name)} · ${esc_(d)} · ${hazardCount} hazards</div>
              </div>`
            }).join('')}
          </div>
        </div>`
      document.body.appendChild(picker)

      picker.querySelector('#ra-pick-close')?.addEventListener('click', () => picker.remove())
      picker.addEventListener('click', e => { if (e.target === picker) picker.remove() })
      picker.querySelectorAll('.ra-pick-item').forEach(el => {
        el.addEventListener('click', () => {
          const source = available.find(s => s.id === el.dataset.pickId)
          if (!source?.risk_assessment) return
          const hadOne = sh.risk_assessment?.hazards?.length > 0
          if (hadOne && !confirm('This will replace the existing risk assessment. Continue?')) return
          // Deep clone hazards; keep assessor info from target
          const existing = sh.risk_assessment || {}
          sh.risk_assessment = {
            hazards: JSON.parse(JSON.stringify(source.risk_assessment.hazards || [])),
            notes: source.risk_assessment.notes || '',
            assessor_name: existing.assessor_name || '',
            assessor_role: existing.assessor_role || '',
            assessed_date: existing.assessed_date || new Date().toISOString().split('T')[0],
          }
          picker.remove()
          this._refreshShootRA(overlay, sh, save)
          save()
          this.app.toast(`Copied ${sh.risk_assessment.hazards.length} hazards ✓`)
        })
      })
    } catch(e) { console.error(e); this.app.toast('Error loading shoots') }
  }

  _generateRAPDF(sh, p) {
    const ra = sh.risk_assessment || {}
    const hazards = Array.isArray(ra.hazards) ? ra.hazards : []
    if (!hazards.length) { this.app.toast('No hazards to export'); return }
    const w = window.open('', '_blank')
    const esc_ = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
    const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : ''
    const score = (l,s) => (parseInt(l)||0)*(parseInt(s)||0)
    const riskColor = n => n>=15?'#c03020':n>=8?'#d98020':n>=4?'#c0a030':n>=1?'#5a9a5a':'#ccc'
    const riskLabel = n => n>=15?'CRITICAL':n>=8?'HIGH':n>=4?'MEDIUM':n>=1?'LOW':''
    w.document.write(`<!DOCTYPE html><html><head><title>Risk Assessment — ${esc_(p.name)}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm }
        body{font-family:-apple-system,sans-serif;color:#222;font-size:10px;line-height:1.4;margin:0;padding:14px}
        h1{font-size:18px;margin:0 0 4px;padding-bottom:6px;border-bottom:2px solid #222}
        .sub{color:#666;margin-bottom:14px;font-size:11px}
        table{width:100%;border-collapse:collapse;margin-bottom:14px;table-layout:fixed}
        th,td{border:0.5px solid #aaa;padding:4px 5px;text-align:left;vertical-align:top;font-size:10px;word-wrap:break-word}
        th{background:#222;color:#fff;font-weight:500;text-transform:uppercase;letter-spacing:0.4px;font-size:9px}
        .r{text-align:center}
        .rcell{display:inline-block;min-width:22px;padding:2px 5px;color:#fff;border-radius:3px;font-weight:600;font-size:10px}
        .sig{margin-top:20px;padding:14px;border:0.5px solid #888;border-radius:4px;display:grid;grid-template-columns:2fr 2fr 1fr;gap:12px}
        .sig-label{font-size:9px;text-transform:uppercase;color:#888;letter-spacing:0.5px;margin-bottom:2px}
        .sig-val{font-size:13px;font-weight:500;padding-bottom:8px;border-bottom:1px solid #333}
        .scale{margin-top:10px;font-size:9px;color:#666;display:flex;gap:12px;flex-wrap:wrap}
        .scale span{display:inline-flex;align-items:center;gap:4px}
        .scale .dot{width:8px;height:8px;border-radius:2px;display:inline-block}
      </style></head><body>
      <h1>Risk Assessment — ${esc_(p.name)}${sh.name?' — '+esc_(sh.name):''}</h1>
      <div class="sub">${esc_(fmtDate(sh.shoot_date))}${sh.location_name?' · '+esc_(sh.location_name):''}</div>

      <table>
        <colgroup>
          <col style="width:15%"><col style="width:11%"><col style="width:15%">
          <col style="width:3.5%"><col style="width:3.5%"><col style="width:6%">
          <col style="width:15%">
          <col style="width:3.5%"><col style="width:3.5%"><col style="width:6%">
          <col style="width:10%"><col style="width:8%">
        </colgroup>
        <thead><tr>
          <th>Hazard</th><th>Who at risk</th><th>Existing controls</th>
          <th class="r">L</th><th class="r">S</th><th class="r">Risk</th>
          <th>Additional controls</th>
          <th class="r">rL</th><th class="r">rS</th><th class="r">Residual</th>
          <th>Owner</th><th>Rating</th>
        </tr></thead>
        <tbody>
          ${hazards.map(h => {
            const s1 = score(h.likelihood, h.severity)
            const s2 = score(h.residual_likelihood, h.residual_severity)
            return `<tr>
              <td>${esc_(h.hazard||'')}</td>
              <td>${esc_(h.who_at_risk||'')}</td>
              <td>${esc_(h.existing_controls||'')}</td>
              <td class="r">${h.likelihood||''}</td>
              <td class="r">${h.severity||''}</td>
              <td class="r"><span class="rcell" style="background:${riskColor(s1)}">${s1||''}</span></td>
              <td>${esc_(h.additional_controls||'')}</td>
              <td class="r">${h.residual_likelihood||''}</td>
              <td class="r">${h.residual_severity||''}</td>
              <td class="r"><span class="rcell" style="background:${riskColor(s2)}">${s2||''}</span></td>
              <td>${esc_(h.responsible||'')}</td>
              <td class="r" style="font-size:9px;color:${riskColor(s2)};font-weight:600">${riskLabel(s2)}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>

      ${ra.notes ? `<div style="padding:10px;background:#f5f5f3;border-radius:4px;font-size:11px;margin-bottom:14px"><strong>Assessment notes:</strong><br>${esc_(ra.notes)}</div>` : ''}

      <div class="sig">
        <div>
          <div class="sig-label">Assessed by</div>
          <div class="sig-val">${esc_(ra.assessor_name||'')}</div>
        </div>
        <div>
          <div class="sig-label">Role</div>
          <div class="sig-val">${esc_(ra.assessor_role||'')}</div>
        </div>
        <div>
          <div class="sig-label">Date</div>
          <div class="sig-val">${esc_(fmtDate(ra.assessed_date))}</div>
        </div>
      </div>

      <div class="scale">
        <span><span class="dot" style="background:#5a9a5a"></span>Low (1–3)</span>
        <span><span class="dot" style="background:#c0a030"></span>Medium (4–7)</span>
        <span><span class="dot" style="background:#d98020"></span>High (8–14)</span>
        <span><span class="dot" style="background:#c03020"></span>Critical (15–25)</span>
        <span style="color:#888">L=Likelihood (1=rare, 5=almost certain) · S=Severity (1=minor, 5=catastrophic)</span>
      </div>

      <script>window.onload=()=>window.print()</script>
      </body></html>`)
    w.document.close()
  }

  _bindShootLocs(overlay, sh, save) {
    overlay.querySelectorAll('#se-locs-list [data-loc-field]').forEach(el => {
      el.addEventListener('change', () => {
        const [i, f] = el.dataset.locField.split(',')
        sh.locations[+i][f] = el.value
        save()
      })
    })
    overlay.querySelectorAll('#se-locs-list [data-loc-rem]').forEach(btn => {
      btn.addEventListener('click', () => {
        sh.locations.splice(+btn.dataset.locRem, 1)
        this._refreshShootLocs(overlay, sh, save); save()
      })
    })
  }
  _refreshShootLocs(overlay, sh, save) {
    const el = overlay.querySelector('#se-locs-list')
    el.innerHTML = sh.locations.map((l,i) => this._shootLocHTML(l,i)).join('') || '<div style="font-size:12px;color:var(--text-tertiary)">No additional locations</div>'
    this._bindShootLocs(overlay, sh, save)
  }

  _bindShootSched(overlay, sh, save) {
    overlay.querySelectorAll('#se-sched-list [data-sched-field]').forEach(el => {
      el.addEventListener('change', () => {
        const [i, f] = el.dataset.schedField.split(',')
        sh.schedule[+i][f] = el.value; save()
      })
    })
    overlay.querySelectorAll('#se-sched-list [data-sched-rem]').forEach(btn => {
      btn.addEventListener('click', () => {
        sh.schedule.splice(+btn.dataset.schedRem, 1)
        this._refreshShootSched(overlay, sh, save); save()
      })
    })
  }
  _refreshShootSched(overlay, sh, save) {
    const el = overlay.querySelector('#se-sched-list')
    el.innerHTML = sh.schedule.map((r,i) => this._shootSchedHTML(r,i)).join('') || '<div style="font-size:12px;color:var(--text-tertiary)">No schedule yet</div>'
    this._bindShootSched(overlay, sh, save)
  }

  _bindShootCrew(overlay, sh, save) {
    overlay.querySelectorAll('[data-crew-field]').forEach(el => {
      el.addEventListener('change', async () => {
        const [i, f] = el.dataset.crewField.split(',')
        if (!sh.crew[+i]) return
        sh.crew[+i][f] = el.value
        save()
        // Sync phone/role/name changes back to the contact
        if (f === 'phone' || f === 'role' || f === 'name') {
          await this._syncCrewToContact(sh.crew[+i])
        }
      })
    })
    overlay.querySelectorAll('[data-crew-call]').forEach(el => {
      el.addEventListener('change', () => {
        const [i, dateKey] = el.dataset.crewCall.split(',')
        if (!sh.crew[+i]) return
        if (!sh.crew[+i].call_times) sh.crew[+i].call_times = {}
        sh.crew[+i].call_times[dateKey] = el.value
        save()
      })
    })
    overlay.querySelectorAll('[data-crew-rem]').forEach(btn => {
      btn.addEventListener('click', () => {
        sh.crew.splice(+btn.dataset.crewRem, 1)
        this._refreshAllCrewSections(overlay, sh, save); save()
      })
    })
  }
  _refreshAllCrewSections(overlay, sh, save) {
    ;['crew','on_camera','client'].forEach(type => {
      const el = overlay.querySelector(`#se-crew-list-${type}`)
      if (el) el.innerHTML = this._shootCrewSectionHTML(sh, type)
    })
    this._bindShootCrew(overlay, sh, save)
  }

  _bindShootHotels(overlay, sh, save) {
    overlay.querySelectorAll('#se-hotels-list [data-hotel-field]').forEach(el => {
      el.addEventListener('change', () => {
        const [i, f] = el.dataset.hotelField.split(',')
        sh.hotels[+i][f] = el.value; save()
      })
    })
    overlay.querySelectorAll('#se-hotels-list [data-hotel-rem]').forEach(btn => {
      btn.addEventListener('click', () => {
        sh.hotels.splice(+btn.dataset.hotelRem, 1)
        this._refreshShootHotels(overlay, sh, save); save()
      })
    })
    overlay.querySelectorAll('#se-hotels-list [data-hotel-everyone]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.hotelEveryone
        const allNames = (sh.crew||[]).filter(c=>c.name).map(c=>c.name)
        if (!sh.hotels[i].assigned_crew) sh.hotels[i].assigned_crew = []
        const allAssigned = allNames.every(n => sh.hotels[i].assigned_crew.includes(n))
        sh.hotels[i].assigned_crew = allAssigned ? [] : [...allNames]
        this._refreshShootHotels(overlay, sh, save); save()
      })
    })
    overlay.querySelectorAll('#se-hotels-list [data-hotel-crew]').forEach(cb => {
      cb.addEventListener('change', () => {
        const i = +cb.dataset.hotelCrew
        const name = cb.dataset.crewName
        if (!sh.hotels[i].assigned_crew) sh.hotels[i].assigned_crew = []
        if (cb.checked) { if (!sh.hotels[i].assigned_crew.includes(name)) sh.hotels[i].assigned_crew.push(name) }
        else sh.hotels[i].assigned_crew = sh.hotels[i].assigned_crew.filter(n => n !== name)
        save()
      })
    })
  }
  _refreshShootHotels(overlay, sh, save) {
    const el = overlay.querySelector('#se-hotels-list')
    el.innerHTML = sh.hotels.map((h,i) => this._shootHotelHTML(h,i,sh.crew)).join('') || '<div style="font-size:12px;color:var(--text-tertiary)">No accommodation added</div>'
    this._bindShootHotels(overlay, sh, save)
  }

  _generateShootPDF(sh, p) {
    const w = window.open('', '_blank')
    if (!w) { this.app.toast('Pop-up blocked — allow pop-ups and try again'); return }

    const esc_ = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const nl   = s => esc_(s).replace(/\n/g, '<br>')
    const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) } catch { return String(d) } }
    const fmtDT   = s => { try { return new Date(s).toLocaleString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) } catch { return String(s) } }

    const studio = this.app.settings || {}
    const logoUrl = studio.logo_url || '/peny-logo.png'

    // Cascade insurance: shoot → project → settings
    const insurer = {
      name:    sh.insurer_name    || p.insurer_name    || studio.default_insurer_name    || null,
      address: sh.insurer_address || p.insurer_address || studio.default_insurer_address || null,
      email:   sh.insurer_email   || p.insurer_email   || studio.default_insurer_email   || null,
      contact: sh.insurer_contact || p.insurer_contact || studio.default_insurer_contact || null,
    }

    // Cascade invoicing
    const invoicing = {
      email:       sh.invoicing_email   || studio.invoicing_email       || null,
      job_ref:     sh.invoicing_job_ref || null,
      boilerplate: studio.invoicing_boilerplate || null,
    }

    // Client display: shoot override → project client company → project client name
    const clientContact = (this.app.contacts||[]).find(c => c.id === p.client_id)
    const projectClientCompany = clientContact?.company
      || (clientContact ? `${clientContact.first_name||''} ${clientContact.last_name||''}`.trim() : '')
    const client_display = sh.client_display || projectClientCompany || null

    // Email lookup from contacts by full name
    const findEmail = name => {
      if (!name) return ''
      const lower = name.toLowerCase().trim()
      const match = (this.app.contacts||[]).find(c =>
        `${c.first_name||''} ${c.last_name||''}`.toLowerCase().trim() === lower
      )
      return match?.email || ''
    }

    const dates     = (Array.isArray(sh.shoot_dates) ? sh.shoot_dates : []).filter(d => d.date)
    const effDates  = dates.length ? dates : (sh.shoot_date ? [{date:sh.shoot_date, general_call:sh.general_call}] : [])
    const crew      = Array.isArray(sh.crew)      ? sh.crew      : []
    const schedule  = Array.isArray(sh.schedule)  ? sh.schedule  : []
    const hotels    = Array.isArray(sh.hotels)    ? sh.hotels.filter(h=>h.name) : []
    const equipment = Array.isArray(sh.equipment) ? sh.equipment.filter(e=>e.category) : []
    const clientCrew = crew.filter(c => c.name && (c.crew_type||'crew')==='client')
    const talentCrew = crew.filter(c => c.name && (c.crew_type||'crew')==='on_camera')
    const mainCrew   = crew.filter(c => c.name && (c.crew_type||'crew')==='crew')
    const allCrewNames = crew.filter(c=>c.name).map(c=>c.name)

    // ── Row builders ────────────────────────────────────────────────────────
    // Standard label | content row. Pass html=true to skip esc_ on content.
    const row = (label, content, html=false) => {
      if (!content && content !== 0) return ''
      const c = html ? content : esc_(content)
      return `<tr><td class="lbl">${label?esc_(label):''}</td><td class="val">${c}</td></tr>`
    }

    // Continuation row (blank label)
    const cont = (content, html=false) => row('', content, html)

    // Horizontal rule between major sections
    const hr = () => `<tr class="hr"><td colspan="2"></td></tr>`

    // Crew row: role in label col, name + email + phone/co in value col
    const crewRow = (c, showRole=true) => {
      const email = findEmail(c.name)
      const phone = c.phone ? `Mob: ${esc_(c.phone)}` : (c.co ? `℅ ${esc_(c.co)}` : '')
      const cols = [
        `<strong>${esc_(c.name)}</strong>`,
        email ? `<span class="dim">${esc_(email)}</span>` : '',
        phone ? `<span class="dim">${phone}</span>` : '',
      ].filter(Boolean).join('&emsp;')
      return `<tr><td class="lbl">${showRole?esc_(c.role||''):''}</td><td class="val">${cols}</td></tr>`
    }

    // ── Build sections ───────────────────────────────────────────────────────

    // JOB NAME
    const secJobName = [
      hr(),
      row('Job name', p.name + (sh.name ? ` — ${sh.name}` : '')),
    ].join('')

    // CLIENT
    const secClient = (client_display || clientCrew.length) ? [
      hr(),
      row('Client', client_display||'', false),
      ...clientCrew.map((c,i) => {
        const email = findEmail(c.name)
        const phone = c.phone ? `Mob: ${esc_(c.phone)}` : ''
        return `<tr>
          <td class="lbl">${i===0&&!client_display?'Client':''}</td>
          <td class="val">
            <span class="crew-name">${esc_(c.name)}</span>
            ${c.role?`<span class="crew-role">${esc_(c.role)}</span>`:''}
            ${phone?`<span class="dim">${phone}</span>`:''}
          </td>
        </tr>`
      }),
    ].join('') : ''

    // TALENT
    const secTalent = talentCrew.length ? [
      hr(),
      ...talentCrew.map((c,i) => {
        const phone = c.phone ? `Mob: ${esc_(c.phone)}` : (c.co ? `c/o ${esc_(c.co)}` : '')
        return `<tr>
          <td class="lbl">${i===0?'Talent':''}</td>
          <td class="val">
            <span class="crew-name">${esc_(c.name)}</span>
            ${c.role?`<span class="crew-role">${esc_(c.role)}</span>`:''}
            ${c.co?`<span class="dim">c/o ${esc_(c.co)}</span>`:(phone?`<span class="dim">${phone}</span>`:'')}
          </td>
        </tr>`
      }),
    ].join('') : ''

    // PRODUCTION COMPANY
    const studioAddr = studio.address || ''
    const secProduction = (studio.company_name||studioAddr) ? [
      hr(),
      row('Production company', studio.company_name||''),
      ...studioAddr.split(/[,\n]/).map(s=>s.trim()).filter(Boolean).map(s=>cont(s)),
    ].join('') : ''

    // SHOOT DATES
    const secDates = effDates.length ? [
      hr(),
      ...effDates.map((d,i) => {
        const label = i===0 ? 'Shoot dates' : ''
        const txt = fmtDate(d.date) + (d.general_call?` &emsp; General call: <strong>${esc_(d.general_call)}</strong>`:'')
        return `<tr><td class="lbl">${label}</td><td class="val">${txt}</td></tr>`
      }),
    ].join('') : ''

    // LOCATION
    const secLocation = (sh.location_name||sh.location_address||sh.location_map_link) ? [
      hr(),
      row('Location address', sh.location_name ? `<strong>${esc_(sh.location_name)}</strong>` : '', true),
      sh.location_address ? cont(sh.location_address) : '',
      sh.location_map_link && !sh.location_address ? cont(sh.location_map_link) : '',
      sh.parking_notes    ? `<tr><td class="lbl"></td><td class="val dim">Parking: ${esc_(sh.parking_notes)}</td></tr>` : '',
      sh.nearest_transport? `<tr><td class="lbl"></td><td class="val dim">Nearest transport: ${esc_(sh.nearest_transport)}</td></tr>` : '',
      sh.weather_text     ? `<tr><td class="lbl"></td><td class="val dim">Weather: ${esc_(sh.weather_text)}</td></tr>` : '',
    ].join('') : ''

    // HOTELS
    const secHotels = hotels.length ? [
      hr(),
      ...hotels.flatMap((h, hi) => {
        const isFirst = hi === 0
        const assigned = h.assigned_crew || []
        const allIn = allCrewNames.length && allCrewNames.every(n => assigned.includes(n))
        const guestLine = allIn
          ? 'All athletes, crew and client in hotel'
          : assigned.length ? assigned.join(', ') : ''
        return [
          `<tr><td class="lbl">${isFirst?'Hotel address':''}</td><td class="val"><strong>${esc_(h.name)}</strong></td></tr>`,
          h.address ? cont(h.address) : '',
          guestLine ? `<tr><td class="lbl"></td><td class="val">${esc_(guestLine)}</td></tr>` : '',
          (h.check_in||h.check_out) ? `<tr><td class="lbl"></td><td class="val dim">${h.check_in?'Check-in: '+fmtDT(h.check_in):''}${h.check_in&&h.check_out?' &ensp;|&ensp; ':''}${h.check_out?'Check-out: '+fmtDT(h.check_out):''}</td></tr>` : '',
          h.notes ? `<tr><td class="lbl"></td><td class="val dim">${nl(h.notes)}</td></tr>` : '',
        ].join('')
      }),
    ].join('') : ''

    // SCHEDULE
    const secSchedule = schedule.length ? [
      hr(),
      ...schedule.map((s,i) => `<tr>
        <td class="lbl">${i===0?'Schedule':''}</td>
        <td class="val"><span class="sched-time">${esc_(s.time||'')}</span>${s.time?'&emsp;':''}${esc_(s.description||'')}</td>
      </tr>`),
    ].join('') : ''

    // MAIN UNIT
    const secMainUnit = mainCrew.length ? [
      hr(),
      `<tr class="section-head"><td class="lbl">Main unit</td><td class="val"></td></tr>`,
      ...mainCrew.map(c => crewRow(c)),
    ].join('') : ''

    // EQUIPMENT
    const secEquipment = equipment.length ? [
      hr(),
      `<tr class="section-head"><td class="lbl">Equipment</td><td class="val"></td></tr>`,
      ...equipment.flatMap((e, ei) => [
        `<tr><td class="lbl cat-label">${esc_(e.category||'')}</td><td class="val">${e.supplier?`<span class="dim">C/O ${esc_(e.supplier)}</span>`:''}${e.description?`<br>${nl(e.description)}`:''}</td></tr>`,
      ]),
    ].join('') : ''

    // INSURANCE
    const secInsurance = insurer.name ? [
      hr(),
      `<tr><td class="lbl">Insurance</td><td class="val"><strong>${esc_(insurer.name)}</strong></td></tr>`,
      insurer.address ? `<tr><td class="lbl"></td><td class="val dim">${esc_(insurer.address)}</td></tr>` : '',
      (insurer.contact||insurer.email) ? `<tr><td class="lbl">Contact</td><td class="val">${insurer.contact?esc_(insurer.contact):''}${insurer.contact&&insurer.email?' &emsp; ':''}<span class="dim">${insurer.email?esc_(insurer.email):''}</span></td></tr>` : '',
      `<tr><td class="lbl"></td><td class="val dim" style="font-size:9px">The Producer / Production Manager must be notified of any potential Insurance claims on the day of the shoot.</td></tr>`,
    ].join('') : ''

    // HOSPITAL / EMERGENCY SERVICES
    const secEmergency = (sh.nearest_hospital_name||sh.nearest_police_name||sh.nearest_fire_name) ? [
      hr(),
      sh.nearest_hospital_name ? `<tr><td class="lbl">Hospital A&amp;E</td><td class="val"><strong>${esc_(sh.nearest_hospital_name)}</strong>${sh.nearest_hospital_address?`<br><span class="dim">${esc_(sh.nearest_hospital_address)}</span>`:''}</td></tr>` : '',
      sh.nearest_police_name   ? `<tr><td class="lbl">Police</td><td class="val"><strong>${esc_(sh.nearest_police_name)}</strong>${sh.nearest_police_address?`<br><span class="dim">${esc_(sh.nearest_police_address)}</span>`:''}</td></tr>` : '',
      sh.nearest_fire_name     ? `<tr><td class="lbl">Fire station</td><td class="val"><strong>${esc_(sh.nearest_fire_name)}</strong>${sh.nearest_fire_address?`<br><span class="dim">${esc_(sh.nearest_fire_address)}</span>`:''}</td></tr>` : '',
    ].join('') : ''

    // H&S NOTES
    const secHS = sh.hs_notes ? [
      hr(),
      `<tr><td class="lbl">H&amp;S notes</td><td class="val">${nl(sh.hs_notes)}</td></tr>`,
    ].join('') : ''

    // SHOOT NOTES
    const secNotes = sh.notes ? [
      hr(),
      `<tr><td class="lbl">Notes</td><td class="val" style="background:#fffdf0">${nl(sh.notes)}</td></tr>`,
    ].join('') : ''

    // INVOICING
    const secInvoicing = (invoicing.email||invoicing.job_ref||invoicing.boilerplate) ? [
      hr(),
      `<tr class="section-head"><td class="lbl">Invoicing</td><td class="val"></td></tr>`,
      invoicing.email   ? `<tr><td class="lbl">Email address</td><td class="val"><a href="mailto:${esc_(invoicing.email)}" style="color:#1a1a1a">${esc_(invoicing.email)}</a></td></tr>` : '',
      invoicing.job_ref ? `<tr><td class="lbl">Job reference</td><td class="val"><strong>${esc_(invoicing.job_ref)}</strong></td></tr>` : '',
      invoicing.boilerplate ? `<tr><td class="lbl"></td><td class="val dim" style="margin-top:6px">${nl(invoicing.boilerplate)}</td></tr>` : '',
    ].join('') : ''

    // ── Compose full document ────────────────────────────────────────────────
    w.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>Call Sheet — ${esc_(p.name)}</title>
      <style>
        @page { size: A4 portrait; margin: 14mm 16mm 14mm 16mm }
        * { box-sizing: border-box; margin: 0; padding: 0 }
        body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #1a1a1a; line-height: 1.55 }

        .pdf-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          padding-bottom: 12px; margin-bottom: 8px; border-bottom: 2px solid #1a1a1a
        }
        .pdf-header img { max-height: 46px; max-width: 130px; object-fit: contain }
        .pdf-title { font-size: 26px; font-weight: 700; letter-spacing: 3px }

        table.cs { width: 100%; border-collapse: collapse }

        td { padding: 4px 6px; vertical-align: top }
        td.lbl {
          width: 160px; min-width: 160px; font-size: 9px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.6px; color: #555;
          padding-right: 14px; padding-top: 6px; white-space: nowrap
        }
        td.val { font-size: 10.5px }

        tr.hr td { border-top: 0.5px solid #bbb; height: 0; padding: 4px 0 0 0 }
        tr.section-head td { padding-top: 8px; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.6px; color: #555; border-top: 0.5px solid #bbb }
        tr.section-head td.lbl { color: #1a1a1a }

        .crew-name { font-weight: 600 }
        .crew-role { margin-left: 1.5em; color: #444 }
        .dim { color: #666 }
        .sched-time { font-weight: 600; min-width: 40px; display: inline-block }
        .cat-label { font-weight: 700; font-size: 9.5px; text-transform: none; letter-spacing: 0; color: #1a1a1a }

        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact }
          tr { page-break-inside: avoid }
        }
      </style>
    </head><body>

    <div class="pdf-header">
      <img src="${logoUrl}" alt="${esc_(studio.company_name||'')}" onerror="this.style.display='none'" />
      <div class="pdf-title">CALLSHEET</div>
    </div>

    <table class="cs">
      ${secJobName}
      ${secClient}
      ${secTalent}
      ${secProduction}
      ${secDates}
      ${secLocation}
      ${secHotels}
      ${secSchedule}
      ${secMainUnit}
      ${secEquipment}
      ${secInsurance}
      ${secEmergency}
      ${secHS}
      ${secNotes}
      ${secInvoicing}
      ${hr()}
    </table>

    <script>window.onload = () => window.print()</script>
    </body></html>`)
    w.document.close()
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
          <div class="proj-panel">
            <div class="proj-panel-head">Shoot dates</div>
            <div class="proj-panel-body">
              <div class="proj-date-row">
                <div><div class="proj-field-label">Shoot start</div><input type="date" class="proj-input" id="pe-start" value="${p.shoot_start??''}" /></div>
                <div><div class="proj-field-label">Shoot end</div><input type="date" class="proj-input" id="pe-end" value="${p.shoot_end??''}" /></div>
              </div>
              <div style="margin-top:14px;padding:10px 12px;background:var(--bg-secondary);border-radius:var(--radius-md);font-size:12px;color:var(--text-secondary);line-height:1.5">
                <strong style="color:var(--text-primary)">Shoot-specific details</strong> — location, crew call times, hotels, schedule, emergency services and H&S are now managed per-shoot. Save the project, then add individual shoots from the project view.
              </div>
            </div>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">Insurance</div>
            <div class="proj-panel-body">
              ${(() => {
                const s = this.app.settings || {}
                const hasDefault = s.default_insurer_name || s.default_insurer_address
                return hasDefault ? `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:10px;line-height:1.5">Leave blank to use studio default: <strong style="color:var(--text-secondary)">${esc(s.default_insurer_name||'')}</strong></div>` : `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:10px;line-height:1.5">No studio default set — fill in here or set a default in Settings.</div>`
              })()}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <div><div class="proj-field-label">Insurer</div><input type="text" class="proj-input" id="pe-ins-name" value="${esc(p.insurer_name||'')}" placeholder="e.g. TYSERS" /></div>
                <div><div class="proj-field-label">Contact name</div><input type="text" class="proj-input" id="pe-ins-contact" value="${esc(p.insurer_contact||'')}" placeholder="e.g. Amy Volino" /></div>
              </div>
              <div style="margin-top:8px"><div class="proj-field-label">Address</div><input type="text" class="proj-input" id="pe-ins-addr" value="${esc(p.insurer_address||'')}" placeholder="71 Fenchurch Street, London, EC3M 4BS" /></div>
              <div style="margin-top:8px"><div class="proj-field-label">Email</div><input type="email" class="proj-input" id="pe-ins-email" value="${esc(p.insurer_email||'')}" placeholder="contact@insurer.com" /></div>
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
    return `<div class="crew-row" data-ci="${i}" data-crew-type="${esc(c.crew_type||'crew')}" style="display:grid;grid-template-columns:1fr 1fr 130px 28px;gap:6px;margin-bottom:4px">
      <input type="text" class="bl-in w" value="${esc(c.name)}" placeholder="Name" data-crew-name="${i}" style="font-size:12px" />
      <input type="text" class="bl-in w" value="${esc(c.role)}" placeholder="Role" data-crew-role="${i}" style="font-size:12px" />
      <input type="tel" class="bl-in w" value="${esc(c.phone||'')}" placeholder="Phone" data-crew-phone="${i}" style="font-size:12px" />
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

    // Hotels
    mc.querySelector('#pe-add-hotel')?.addEventListener('click', () => {
      if (!p.hotels) p.hotels = []
      p.hotels.push({ name:'', address:'', check_in:'', check_out:'', notes:'', assigned_crew:[] })
      save(); this.renderEditor(mc)
    })
    mc.querySelectorAll('[data-hotel-rem]').forEach(btn => {
      btn.addEventListener('click', () => {
        p.hotels.splice(+btn.dataset.hotelRem, 1); save(); this.renderEditor(mc)
      })
    })
    mc.querySelectorAll('[data-hotel-field]').forEach(el => {
      el.addEventListener('change', () => {
        const [hi, field] = el.dataset.hotelField.split(',')
        if (!p.hotels[+hi]) return
        p.hotels[+hi][field] = el.value
        save()
      })
    })
    mc.querySelectorAll('[data-hotel-crew]').forEach(el => {
      el.addEventListener('change', () => {
        const hi = +el.dataset.hotelCrew
        const name = el.dataset.crewName
        if (!p.hotels[hi]) return
        if (!p.hotels[hi].assigned_crew) p.hotels[hi].assigned_crew = []
        if (el.checked) { if (!p.hotels[hi].assigned_crew.includes(name)) p.hotels[hi].assigned_crew.push(name) }
        else { p.hotels[hi].assigned_crew = p.hotels[hi].assigned_crew.filter(n => n !== name) }
        save()
      })
    })

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
    mc.querySelector('#pe-ins-name')?.addEventListener('change', e => { p.insurer_name    = e.target.value.trim() || null; save() })
    mc.querySelector('#pe-ins-contact')?.addEventListener('change', e => { p.insurer_contact = e.target.value.trim() || null; save() })
    mc.querySelector('#pe-ins-addr')?.addEventListener('change', e => { p.insurer_address = e.target.value.trim() || null; save() })
    mc.querySelector('#pe-ins-email')?.addEventListener('change', e => { p.insurer_email   = e.target.value.trim() || null; save() })
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
      el.addEventListener('change', async () => {
        const i = +el.dataset.crewRole
        p.crew[i].role = el.value
        save()
        await this._syncCrewToContact(p.crew[i])
      })
    })
    mc.querySelectorAll('[data-crew-phone]').forEach(el => {
      el.addEventListener('change', async () => {
        const i = +el.dataset.crewPhone
        p.crew[i].phone = el.value
        save()
        await this._syncCrewToContact(p.crew[i])
      })
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
        hotels: p.hotels || [],
        insurer_name:    p.insurer_name    || null,
        insurer_address: p.insurer_address || null,
        insurer_email:   p.insurer_email   || null,
        insurer_contact: p.insurer_contact || null,
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
    // After save, ensure any Crew (type) members exist as subcontractor contacts
    this._ensureCrewContacts(p).catch(console.error)
  }

  async _ensureCrewContacts(p) {
    const contacts = this.app.contacts || []
    // Include all crew types now — map crew_type to contact type
    // crew → subcontractor, on_camera → subcontractor, client → brand
    const contactTypeFor = ct => ct === 'client' ? 'brand' : 'subcontractor'
    const crewMembers = (p.crew||[]).filter(c => c.name && c.name.trim())
    if (!crewMembers.length) return
    const existing = new Set(contacts.map(c => `${c.first_name||''} ${c.last_name||''}`.toLowerCase().trim()))
    const toAdd = []
    const seenInBatch = new Set()
    for (const cm of crewMembers) {
      const fullName = cm.name.trim()
      const lower = fullName.toLowerCase()
      if (existing.has(lower) || seenInBatch.has(lower)) continue
      const parts = fullName.split(' ')
      const first = parts[0]
      const last = parts.slice(1).join(' ')
      toAdd.push({
        first, last,
        role:    cm.role  || '',
        phone:   cm.phone || '',
        ctype:   contactTypeFor(cm.crew_type || 'crew'),
        crew_kind: cm.crew_type || 'crew',
      })
      seenInBatch.add(lower)
    }
    if (!toAdd.length) return
    try {
      const { createContact } = await import('../db/client.js')
      for (const c of toAdd) {
        const result = await createContact(this.app.userId, {
          first_name: c.first,
          last_name:  c.last,
          company:    '',
          email:      '',
          phone:      c.phone,
          role:       c.role,
          type:       c.ctype,
          status:     'Active',
          notes:      `Auto-added from project: ${p.name} (${c.crew_kind})`,
        })
        const created = Array.isArray(result) ? result[0] : result
        if (created) this.app.contacts.push(created)
      }
    } catch(e) { console.error('Auto-add contact failed:', e) }
  }

  // Sync a crew row's phone/role into the matching contact (source of truth)
  // If no matching contact exists, create one as a subcontractor.
  async _syncCrewToContact(crewMember) {
    if (!crewMember?.name) return
    const fullName = crewMember.name.trim()
    if (!fullName) return
    const lower = fullName.toLowerCase()
    const match = (this.app.contacts||[]).find(c =>
      `${c.first_name||''} ${c.last_name||''}`.toLowerCase().trim() === lower
    )
    const newPhone = crewMember.phone || ''
    const newRole  = crewMember.role  || ''
    if (match) {
      // Update existing contact only if a field actually changed
      if ((match.phone||'') === newPhone && (match.role||'') === newRole) return
      try {
        const { updateContact } = await import('../db/client.js')
        const result = await updateContact(this.app.userId, match.id, {
          phone: newPhone,
          role:  newRole,
        })
        const updated = Array.isArray(result) ? result[0] : result
        if (updated) {
          const idx = this.app.contacts.findIndex(c => c.id === match.id)
          if (idx >= 0) this.app.contacts[idx] = updated
        }
      } catch(e) { console.error('Crew → contact sync failed:', e) }
    } else {
      // No matching contact — create one. Map crew_type → contact type.
      const crewType = crewMember.crew_type || 'crew'
      const contactType = crewType === 'client' ? 'brand' : 'subcontractor'
      const parts = fullName.split(' ')
      const first = parts[0]
      const last = parts.slice(1).join(' ')
      try {
        const { createContact } = await import('../db/client.js')
        const result = await createContact(this.app.userId, {
          first_name: first,
          last_name:  last,
          company:    '',
          email:      '',
          phone:      newPhone,
          role:       newRole,
          type:       contactType,
          status:     'Active',
          notes:      `Auto-added from shoot crew (${crewType})`,
        })
        const created = Array.isArray(result) ? result[0] : result
        if (created) this.app.contacts.push(created)
      } catch(e) { console.error('Crew → contact create failed:', e) }
    }
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
