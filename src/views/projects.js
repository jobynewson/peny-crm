import { createProject, updateProject, deleteProject, linkBudgetToProject, unlinkBudgetFromProject, logActivity, getActivityLog } from '../db/client.js'

const STAGES = ['Enquiry','Pre-production','In Production','Post','Delivered']
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
    const { projects, contacts, budgets } = this.app
    mc.innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${projects.length}</div><div class="stat-sub">projects</div></div>
        ${STAGES.slice(0,3).map(s=>`<div class="stat-card"><div class="stat-label">${s}</div><div class="stat-value">${projects.filter(p=>p.status===s).length}</div><div class="stat-sub">projects</div></div>`).join('')}
      </div>
      <div class="kanban-wrap">
        ${STAGES.map(stage => {
          const col = projects.filter(p => p.status === stage)
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
      </div>
      ${this.newModalHTML()}
    `
    mc.querySelectorAll('.kanban-card[data-open]').forEach(el => {
      el.addEventListener('click', () => { this.currentId = el.dataset.open; this.render(mc); this.app.updateTitle() })
    })
    mc.querySelectorAll('.kanban-add[data-stage]').forEach(btn => {
      btn.addEventListener('click', () => this.openNewModal(null, btn.dataset.stage, mc))
    })
    mc.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => mc.querySelector(`#${btn.dataset.close}`)?.classList.remove('open'))
    })
    mc.querySelectorAll('.modal-backdrop').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open') })
    })
    mc.querySelector('#proj-save-btn')?.addEventListener('click', () => this.saveNew(mc))
  }

  newModalHTML() {
    const { contacts } = this.app
    return `
      <div class="modal-backdrop" id="proj-new-modal">
        <div class="modal" style="width:420px">
          <div class="modal-header"><span class="modal-title">New project</span><button class="modal-close" data-close="proj-new-modal">×</button></div>
          <div class="modal-body">
            <div class="field"><div class="field-label">Project title</div><input id="pf-name" type="text" placeholder="e.g. Brand Film — Kinetic Q2" /></div>
            <div class="field"><div class="field-label">Client</div>
              <select id="pf-client">
                <option value="">— no client —</option>
                ${contacts.map(c=>`<option value="${c.id}">${esc(c.first_name)} ${esc(c.last_name)} — ${esc(c.company)}</option>`).join('')}
              </select>
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

  openNewModal(clientId, stage, mc) {
    const el = (mc || document.getElementById('main-content'))
    el.querySelector('#pf-name').value   = ''
    el.querySelector('#pf-status').value = stage || 'Enquiry'
    if (clientId) el.querySelector('#pf-client').value = clientId
    el.querySelector('#proj-new-modal')?.classList.add('open')
  }

  async saveNew(mc) {
    const name = mc.querySelector('#pf-name')?.value.trim()
    if (!name) { this.app.toast('Please enter a project title'); return }
    const data = {
      name,
      client_id:    mc.querySelector('#pf-client')?.value  || null,
      status:       mc.querySelector('#pf-status')?.value  || 'Enquiry',
      brief:        '',
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
        <h2 style="flex:1;font-size:15px;font-weight:500">${esc(p.name)}</h2>
        <span class="tag" style="background:var(--bg-secondary);color:var(--text-secondary);font-size:12px;padding:4px 10px">${p.status}</span>
        ${this.app.permissions?.projects_edit ? `<button class="btn-primary" id="enter-edit">Edit project</button>` : ''}
        <button class="row-btn" id="pv-delete" style="color:#b03020;border-color:rgba(180,50,30,0.2)">Delete</button>
      </div>
      <div class="proj-layout">
        <div class="proj-main">

          <div class="proj-panel">
            <div class="proj-panel-head">Brief &amp; overview</div>
            <div class="proj-panel-body">
              ${field('Client', cl ? esc(cl.first_name)+' '+esc(cl.last_name)+' — '+esc(cl.company) : '')}
              ${field('Creative brief', esc(p.brief))}
              ${field('Location', esc(p.location))}
              ${(p.shoot_start||p.shoot_end) ? field('Shoot dates', [p.shoot_start, p.shoot_end].filter(Boolean).join(' → ')) : ''}
              ${!p.brief && !p.location && !p.shoot_start && !cl ? '<div style="font-size:13px;color:var(--text-tertiary)">No details yet — click Edit project to add.</div>' : ''}
            </div>
          </div>

          ${delivs.length ? `
          <div class="proj-panel">
            <div class="proj-panel-head">
              Deliverables
              <span style="margin-left:auto;font-size:11px;color:var(--text-tertiary);font-weight:400;text-transform:none;letter-spacing:0">${doneCount}/${delivs.length} done</span>
            </div>
            <div style="padding:0 16px" id="pv-delivs">
              ${delivs.map((d, di) => `
                <div class="deliverable-row" id="pvd-${p.id}-${di}">
                  <input type="checkbox" class="deliverable-check" ${d.done?'checked':''} data-pv-deliv="${p.id}" data-pv-idx="${di}" />
                  <span style="font-size:13px;${d.done?'text-decoration:line-through;color:var(--text-tertiary)':'color:var(--text-primary)'}">${esc(d.text)}</span>
                </div>`).join('')}
            </div>
          </div>` : ''}

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

          ${crew.length ? `
          <div class="proj-panel">
            <div class="proj-panel-head">Crew &amp; team</div>
            <div style="padding:0 16px">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--border-light)">
                <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Name</div>
                <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Role</div>
              </div>
              ${crew.map(c => `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:7px 0;border-bottom:0.5px solid var(--border-light);font-size:13px">
                  <div>${esc(c.name)}</div>
                  <div style="color:var(--text-secondary)">${esc(c.role)}</div>
                </div>`).join('')}
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

          ${linked.length ? `
          <div class="proj-panel">
            <div class="proj-panel-head">Linked budgets</div>
            <div style="padding:10px 14px;display:flex;flex-direction:column;gap:6px">
              ${linked.map(b => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);font-size:12px;cursor:pointer" data-open-budget="${b.id}">
                  <span style="font-weight:500">${esc(b.name)}</span>
                </div>`).join('')}
            </div>
          </div>` : ''}

          ${p.notes ? `
          <div class="proj-panel">
            <div class="proj-panel-head">Notes</div>
            <div style="padding:12px 14px;font-size:13px;color:var(--text-secondary);line-height:1.6">${esc(p.notes)}</div>
          </div>` : ''}

          <div class="proj-panel">
            <div class="proj-panel-head">Activity log</div>
            <div id="pv-activity" style="padding:0 14px">
              <div style="font-size:11px;color:var(--text-tertiary);padding:10px 0">Loading…</div>
            </div>
          </div>

        </div>
      </div>`

    mc.querySelector('#back-to-kanban')?.addEventListener('click', () => {
      this.currentId = null; this.editingId = null; this.render(mc); this.app.updateTitle()
    })
    mc.querySelector('#enter-edit')?.addEventListener('click', () => {
      this.editingId = this.currentId; this.render(mc)
    })
    mc.querySelector('#pv-delete')?.addEventListener('click', () => this.deleteProject(p.id, mc))

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
        try { await updateProject(this.app.userId, p.id, { deliverables: p.deliverables }) }
        catch(e) { console.error(e) }
      })
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

    // Load activity log
    this._loadProjectActivity(mc, p.id)
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
        <select class="status-select" id="pe-status">
          ${STAGES.map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join('')}
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
                  ${contacts.map(c=>`<option value="${c.id}" ${p.client_id===c.id?'selected':''}>${esc(c.first_name)} ${esc(c.last_name)} — ${esc(c.company)}</option>`).join('')}
                </select>
              </div>
              <div>
                <div class="proj-field-label">Creative brief</div>
                <textarea class="proj-textarea" id="pe-brief" style="min-height:120px" placeholder="Objectives, audience, tone, key messages...">${esc(p.brief)}</textarea>
              </div>
              <div>
                <div class="proj-field-label">Location</div>
                <input type="text" class="proj-input" id="pe-location" value="${esc(p.location)}" placeholder="e.g. Snowdonia, North Wales" />
              </div>
              <div class="proj-date-row">
                <div><div class="proj-field-label">Shoot start</div><input type="date" class="proj-input" id="pe-start" value="${p.shoot_start??''}" /></div>
                <div><div class="proj-field-label">Shoot end</div><input type="date" class="proj-input" id="pe-end" value="${p.shoot_end??''}" /></div>
              </div>
            </div>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">Deliverables</div>
            <div style="padding:0 16px" id="pe-delivs">
              ${delivs.map((d,i) => this.delivHTML(p.id, d, i)).join('')}
            </div>
            <button class="add-line" id="pe-add-deliv">+ add deliverable</button>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">Shot list / run of show</div>
            <div style="padding:0 16px" id="pe-shots">
              ${shots.map((s,i) => this.shotHTML(p.id, s, i)).join('')}
            </div>
            <button class="add-line" id="pe-add-shot">+ add shot</button>
          </div>

          <div class="proj-panel">
            <div class="proj-panel-head">Crew &amp; team</div>
            <div style="padding:0 16px">
              <div style="display:grid;grid-template-columns:1fr 1fr 40px;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--border-light)">
                <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Name</div>
                <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">Role</div>
                <div></div>
              </div>
              <div id="pe-crew">${crew.map((c,i) => this.crewHTML(p.id, c, i)).join('')}</div>
            </div>
            <button class="add-line" id="pe-add-crew">+ add crew member</button>
          </div>

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

        </div>
      </div>`

    this.bindEditor(mc, p)
  }

  delivHTML(pid, d, i) {
    return `<div class="deliverable-row" data-di="${i}">
      <input type="checkbox" class="deliverable-check" ${d.done?'checked':''} data-deliv-done="${i}" />
      <input type="text" class="deliverable-text" value="${esc(d.text)}" placeholder="e.g. 90s hero film, 3x social cutdowns..." data-deliv-text="${i}" />
      <button class="row-btn" style="color:#b03020;flex-shrink:0" data-deliv-rem="${i}">×</button>
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
    return `<div class="crew-row" data-ci="${i}">
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
    mc.querySelector('#pe-start')?.addEventListener('change',   e => { p.shoot_start = e.target.value || null; save() })
    mc.querySelector('#pe-end')?.addEventListener('change',     e => { p.shoot_end   = e.target.value || null; save() })
    mc.querySelector('#pe-notes')?.addEventListener('change',   e => { p.notes   = e.target.value; save() })

    // Deliverables
    mc.querySelectorAll('[data-deliv-done]').forEach(el => {
      el.addEventListener('change', () => { p.deliverables[+el.dataset.delivDone].done = el.checked; save() })
    })
    mc.querySelectorAll('[data-deliv-text]').forEach(el => {
      el.addEventListener('change', () => { p.deliverables[+el.dataset.delivText].text = el.value; save() })
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
    mc.querySelector('#pe-add-crew')?.addEventListener('click', () => {
      p.crew.push({ name: '', role: '' }); save(); this.renderEditor(mc)
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

  async saveField(p, prevSnapshot) {
    try {
      const data = {
        name: p.name, status: p.status, client_id: p.client_id,
        brief: p.brief, location: p.location,
        shoot_start: p.shoot_start || null, shoot_end: p.shoot_end || null,
        deliverables: p.deliverables, crew: p.crew, shots: p.shots,
        approvals: p.approvals, notes: p.notes,
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
