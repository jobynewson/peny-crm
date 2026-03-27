import { createBudget, updateBudget, deleteBudget } from '../db/client.js'

const SECTIONS = [
  {code:'A1',label:'Pre-production — Scouting',lines:[{item:'Location Scout (Director)',days:0,qty:1,rate:501},{item:'Assistant Location Scout',days:0,qty:1,rate:369},{item:'Location Scout car / mileage',days:0,qty:1,rate:null},{item:'Congestion Charge',days:0,qty:1,rate:13},{item:'Unit Driver / Bus Hire',days:0,qty:1,rate:450},{item:'Subsistence',days:0,qty:1,rate:null},{item:'Flights',days:0,qty:1,rate:null},{item:'Accommodation',days:0,qty:1,rate:null}]},
  {code:'A2',label:'Pre-production — Expenses',lines:[{item:'Researcher',days:0,qty:1,rate:350},{item:'References / Materials / PPM Prep',days:0,qty:1,rate:150},{item:'Taxis',days:0,qty:1,rate:null},{item:'Couriers',days:0,qty:1,rate:null},{item:'Tel / Comms',days:0,qty:1,rate:null}]},
  {code:'C',label:'Cast',crew:true,lines:[{item:'Presenter / Talent',days:0,qty:1,rate:null,travelDays:0},{item:'Supporting Artists',days:0,qty:1,rate:null,travelDays:0},{item:'Stunt Performers',days:0,qty:1,rate:null,travelDays:0}]},
  {code:'D',label:'Production Crew',crew:true,lines:[{item:'Director',days:0,qty:1,rate:850,travelDays:0},{item:'Producer',days:0,qty:1,rate:650,travelDays:0},{item:'Production Manager',days:0,qty:1,rate:450,travelDays:0},{item:'Production Assistant',days:0,qty:1,rate:250,travelDays:0},{item:'Camera Operator',days:0,qty:1,rate:600,travelDays:0},{item:'1st AC / Focus Puller',days:0,qty:1,rate:450,travelDays:0},{item:'DIT',days:0,qty:1,rate:400,travelDays:0},{item:'Drone Pilot',days:0,qty:1,rate:550,travelDays:0},{item:'Sound Recordist',days:0,qty:1,rate:450,travelDays:0},{item:'Gaffer / Spark',days:0,qty:1,rate:400,travelDays:0},{item:'Grip',days:0,qty:1,rate:380,travelDays:0},{item:'Make-up / Hair',days:0,qty:1,rate:350,travelDays:0},{item:'Stylist',days:0,qty:1,rate:350,travelDays:0},{item:'Runner',days:0,qty:1,rate:150,travelDays:0}]},
  {code:'E',label:'Equipment',lines:[{item:'Camera Package',days:0,qty:1,rate:null},{item:'Lens Package',days:0,qty:1,rate:null},{item:'Lighting Package',days:0,qty:1,rate:null},{item:'Grip Package',days:0,qty:1,rate:null},{item:'Sound Package',days:0,qty:1,rate:null},{item:'Drone Package',days:0,qty:1,rate:null},{item:'Generator',days:0,qty:1,rate:null},{item:'Data / Media',days:0,qty:1,rate:null}]},
  {code:'F',label:'Art Department',lines:[{item:'Art Director',days:0,qty:1,rate:500},{item:'Props',days:0,qty:1,rate:null},{item:'Set Dressing / Hire',days:0,qty:1,rate:null},{item:'Wardrobe',days:0,qty:1,rate:null}]},
  {code:'G',label:'Studio / Location',lines:[{item:'Studio Hire (per day)',days:0,qty:1,rate:null},{item:'Location Fees / Permits',days:0,qty:1,rate:null},{item:'Security',days:0,qty:1,rate:null},{item:'Facilities / Portaloos',days:0,qty:1,rate:null}]},
  {code:'H',label:'Travel & Accommodation',lines:[{item:'Unit Vehicles / Transport',days:0,qty:1,rate:null},{item:'Flights',days:0,qty:1,rate:null},{item:'Accommodation',days:0,qty:1,rate:null},{item:'Subsistence / Catering',days:0,qty:1,rate:null},{item:'Mileage',days:0,qty:1,rate:0.45},{item:'Congestion / Parking',days:0,qty:1,rate:null}]},
  {code:'I',label:'Post-production',lines:[{item:'Editor (pre-production)',days:0,qty:1,rate:350},{item:'Assembly Editor',days:0,qty:1,rate:450},{item:'Assistant Editor',days:0,qty:1,rate:400},{item:'Finishing Editor (incl. suite)',days:0,qty:1,rate:500},{item:'Grade (all assets + suite)',days:0,qty:1,rate:650},{item:'Sound Design',days:0,qty:1,rate:750},{item:'Graphics / Motion',days:0,qty:1,rate:450},{item:'Versioning',days:0,qty:1,rate:null},{item:'Stock Track Licences',days:0,qty:1,rate:10},{item:'Composition',days:0,qty:1,rate:null},{item:'Hard Drives / Media',days:0,qty:1,rate:250},{item:'Library Footage / SFX',days:0,qty:1,rate:null}]},
  {code:'J',label:'Sundries',lines:[{item:'Legal Fees / Visas / Work Permits',days:0,qty:1,rate:null},{item:'Contingency',days:0,qty:1,rate:null},{item:'Miscellaneous',days:0,qty:1,rate:null}]},
  {code:'K',label:'Insurance',lines:[{item:'General Production Insurance',days:0,qty:1,rate:null},{item:'Specialist Travel Insurance',days:0,qty:1,rate:null},{item:'Equipment Insurance',days:0,qty:1,rate:null}]},
]

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
const gbpA = n => '£' + Math.round(n).toLocaleString('en-GB')
const moy = () => { const d = new Date(); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear() }

function lineTotal(l, isCrew) {
  const d = parseFloat(l.days)||0, q = parseFloat(l.qty)||1, r = parseFloat(l.rate)||0, td = parseFloat(l.travelDays)||0
  if (isCrew) return d*q*r + td*0.5*r
  return q*r
}
function secNet(s)  { return (s.lines||[]).reduce((t,l) => t + lineTotal(l, s.crew||s.hasDays), 0) }
function budNet(b)  { return (b.sections||[]).filter(s=>s.enabled).reduce((t,s) => t + secNet(s), 0) }
function budTotal(b) {
  const n = budNet(b)
  const afterFee = n + n * ((parseFloat(b.markup)||0)/100)
  const afterCustom = afterFee + afterFee * ((parseFloat(b.custom_pct)||0)/100)
  return afterCustom + (b.vat ? afterCustom*0.2 : 0)
}
const hasValue = (l, isCrew) => isCrew
  ? ((parseFloat(l.days)||0) > 0 || (parseFloat(l.travelDays)||0) > 0)
  : (parseFloat(l.qty)||0) > 0 && (parseFloat(l.rate)||0) > 0

export { budTotal, budNet }

export class BudgetsView {
  constructor(app) {
    this.app = app
    this.currentId = null
  }

  render(mc) {
    if (this.currentId) this.renderEditor(mc)
    else this.renderList(mc)
  }

  // ── List ────────────────────────────────────────────────────────────────────

  renderList(mc) {
    const { budgets, contacts, projects } = this.app
    const total = budgets.reduce((s,b) => s + budTotal(b), 0)
    mc.innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Total budgets</div><div class="stat-value">${budgets.length}</div><div class="stat-sub">created</div></div>
        <div class="stat-card"><div class="stat-label">Combined value</div><div class="stat-value">${gbpA(total)}</div><div class="stat-sub">all budgets</div></div>
        <div class="stat-card"><div class="stat-label">Clients with budgets</div><div class="stat-value">${[...new Set(budgets.map(b=>b.client_id).filter(Boolean))].length}</div><div class="stat-sub">unique clients</div></div>
        <div class="stat-card"><div class="stat-label">Avg. budget</div><div class="stat-value">${budgets.length ? gbpA(total/budgets.length) : '—'}</div><div class="stat-sub">per project</div></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">All budgets</span></div>
        <div class="col-header" style="grid-template-columns:2fr 1.2fr 1.2fr 1fr 1fr 80px">
          <div>Budget</div><div>Project</div><div>Client</div><div>Net</div><div>Total</div><div></div>
        </div>
        ${budgets.length ? budgets.map(b => {
          const cl = contacts.find(c => c.id === b.client_id)
          const proj = projects.find(p => Array.isArray(p.budget_ids) && p.budget_ids.includes(b.id))
          return `<div class="contact-row" style="grid-template-columns:2fr 1.2fr 1.2fr 1fr 1fr 80px" data-open="${b.id}">
            <div style="font-weight:500">${esc(b.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${proj ? esc(proj.name) : '—'}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${cl ? esc(cl.first_name)+' '+esc(cl.last_name) : '—'}</div>
            <div style="color:var(--text-secondary)">${gbpA(budNet(b))}</div>
            <div style="font-weight:500">${gbpA(budTotal(b))}</div>
            <div style="text-align:right"><button class="row-btn" style="color:#b03020" data-delete="${b.id}">Delete</button></div>
          </div>`
        }).join('') : '<div class="empty-state">No budgets yet</div>'}
      </div>
      ${this.newModalHTML()}
    `
    mc.querySelectorAll('.contact-row[data-open]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('[data-delete]')) return
        this.currentId = row.dataset.open
        this.render(mc)
        this.app.updateTitle()
      })
    })
    mc.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.deleteBudget(btn.dataset.delete, mc) })
    })
    this.bindNewModal(mc)
  }

  newModalHTML() {
    const { contacts, settings } = this.app
    return `
      <div class="modal-backdrop" id="budget-new-modal">
        <div class="modal" style="width:440px">
          <div class="modal-header"><span class="modal-title">New budget</span><button class="modal-close" data-close="budget-new-modal">×</button></div>
          <div class="modal-body">
            <div class="field"><div class="field-label">Budget title</div><input id="bf-name" type="text" placeholder="e.g. Brand Film — Q2 2025" /></div>
            <div class="field"><div class="field-label">Client (optional)</div>
              <select id="bf-client">
                <option value="">— no client —</option>
                ${contacts.map(c=>`<option value="${c.id}">${esc(c.first_name)} ${esc(c.last_name)} — ${esc(c.company)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><div class="field-label">Project notes (optional)</div><textarea id="bf-notes" style="min-height:80px" placeholder="Scope, deliverables, shoot dates..."></textarea></div>
            <div class="field-row">
              <div class="field"><div class="field-label">Quote prepared by</div><input id="bf-preparedby" type="text" value="${esc(settings?.prepared_by)}" placeholder="e.g. Robbie Meade" /></div>
              <div class="field"><div class="field-label">Reply-to email</div><input id="bf-email" type="email" placeholder="Leave blank for default" /></div>
            </div>
            <div class="field-row">
              <div class="field"><div class="field-label">Production fee %</div><input id="bf-markup" type="number" value="10" min="0" max="100" /></div>
              <div class="field"><div class="field-label">Custom add-on %</div><input id="bf-custom" type="number" value="0" min="0" /></div>
            </div>
            <div class="field" style="display:flex;align-items:center;gap:10px;padding-top:2px">
              <label style="font-size:13px;color:var(--text-secondary);display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="bf-vat" style="width:auto;cursor:pointer" /> Add VAT (20%)
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" data-close="budget-new-modal">Cancel</button>
            <button class="btn-primary" id="budget-save-btn">Create budget</button>
          </div>
        </div>
      </div>`
  }

  bindNewModal(mc) {
    mc.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => mc.querySelector(`#${btn.dataset.close}`)?.classList.remove('open'))
    })
    mc.querySelectorAll('.modal-backdrop').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open') })
    })
    mc.querySelector('#budget-save-btn')?.addEventListener('click', () => this.saveNew(mc))
  }

  openNewModal(clientId) {
    const mc = document.getElementById('main-content')
    if (!mc) return
    mc.querySelector('#bf-name').value       = ''
    mc.querySelector('#bf-notes').value      = ''
    mc.querySelector('#bf-markup').value     = '10'
    mc.querySelector('#bf-custom').value     = '0'
    mc.querySelector('#bf-vat').checked      = false
    mc.querySelector('#bf-preparedby').value = this.app.settings?.prepared_by ?? ''
    mc.querySelector('#bf-email').value      = ''
    if (clientId) mc.querySelector('#bf-client').value = clientId
    mc.querySelector('#budget-new-modal')?.classList.add('open')
  }

  openNewModalFromProject(p) {
    this.app.navigate('budgets')
    setTimeout(() => {
      const mc = document.getElementById('main-content')
      if (!mc) return
      const noteParts = []
      if (p.brief) noteParts.push(p.brief)
      if (p.location) noteParts.push('Location: ' + p.location)
      if (p.shoot_start) noteParts.push('Shoot: ' + p.shoot_start + (p.shoot_end && p.shoot_end !== p.shoot_start ? ' – ' + p.shoot_end : ''))
      const delivs = (p.deliverables||[]).filter(d=>d.text)
      if (delivs.length) noteParts.push('Deliverables: ' + delivs.map(d=>d.text).join(', '))

      mc.querySelector('#bf-name').value   = p.name ?? ''
      mc.querySelector('#bf-notes').value  = noteParts.join('\n\n')
      if (p.client_id) mc.querySelector('#bf-client').value = p.client_id
      mc.querySelector('#budget-new-modal')?.classList.add('open')

      // Stash project ID and crew for after creation
      this._pendingProjectId = p.id
      this._pendingCrew = (p.crew||[]).filter(c => c.name || c.role)
    }, 50)
  }

  async saveNew(mc) {
    const name = mc.querySelector('#bf-name')?.value.trim()
    if (!name) { this.app.toast('Please enter a budget title'); return }

    const sections = SECTIONS.map(def => ({
      code: def.code, label: def.label, enabled: false, open: false, crew: !!def.crew,
      lines: def.lines.map(l => ({ ...l, days: 0, qty: l.qty ?? 1, notes: '', travelDays: 'travelDays' in l ? 0 : undefined }))
    }))

    // Prefill crew from project if available
    if (this._pendingCrew?.length) {
      const roleMap = [['director','Director'],['producer','Producer'],['production manager','Production Manager'],['pa','Production Assistant'],['camera','Camera Operator'],['dop','Camera Operator'],['focus','1st AC / Focus Puller'],['dit','DIT'],['drone','Drone Pilot'],['sound','Sound Recordist'],['gaffer','Gaffer / Spark'],['spark','Gaffer / Spark'],['grip','Grip'],['makeup','Make-up / Hair'],['hair','Make-up / Hair'],['stylist','Stylist'],['runner','Runner']]
      const crewSec = sections.find(s => s.code === 'D')
      if (crewSec) {
        this._pendingCrew.forEach(cr => {
          const roleLC = (cr.role||'').toLowerCase(), nameLC = (cr.name||'').toLowerCase()
          const match = roleMap.find(([k]) => roleLC.includes(k) || nameLC.includes(k))
          if (match) { const line = crewSec.lines.find(l => l.item === match[1]); if (line) line.notes = cr.name }
        })
        if (crewSec.lines.some(l => l.notes)) { crewSec.enabled = true; crewSec.open = true }
      }
    }

    const data = {
      name,
      client_id:   mc.querySelector('#bf-client')?.value     || null,
      notes:       mc.querySelector('#bf-notes')?.value.trim() || null,
      prepared_by: mc.querySelector('#bf-preparedby')?.value.trim() || this.app.settings?.prepared_by || null,
      quote_email: mc.querySelector('#bf-email')?.value.trim() || this.app.settings?.email || null,
      markup:      parseFloat(mc.querySelector('#bf-markup')?.value) || 0,
      custom_pct:  parseFloat(mc.querySelector('#bf-custom')?.value) || 0,
      vat:         mc.querySelector('#bf-vat')?.checked ?? false,
      sections,
    }

    try {
      const [created] = await createBudget(this.app.userId, data)
      this.app.budgets.unshift(created)

      // Link to project if created from project editor
      if (this._pendingProjectId) {
        const proj = this.app.projects.find(p => p.id === this._pendingProjectId)
        if (proj) {
          if (!Array.isArray(proj.budget_ids)) proj.budget_ids = []
          proj.budget_ids.push(created.id)
          await import('../db/client.js').then(m => m.linkBudgetToProject(proj.id, created.id))
        }
        this._pendingProjectId = null
        this._pendingCrew = null
      }

      mc.querySelector('#budget-new-modal')?.classList.remove('open')
      this.currentId = created.id
      this.render(mc)
      this.app.updateTitle()
      this.app.toast('Budget created')
    } catch (e) { console.error(e); this.app.toast('Error creating budget') }
  }

  async deleteBudget(id, mc) {
    if (!confirm('Delete this budget?')) return
    try {
      await deleteBudget(this.app.userId, id)
      this.app.budgets = this.app.budgets.filter(b => b.id !== id)
      this.renderList(mc)
      this.app.toast('Budget deleted')
    } catch (e) { console.error(e); this.app.toast('Error deleting budget') }
  }

  // ── Editor ──────────────────────────────────────────────────────────────────

  renderEditor(mc) {
    const b = this.app.budgets.find(x => x.id === this.currentId)
    if (!b) { this.currentId = null; this.renderList(mc); return }
    const sections = Array.isArray(b.sections) ? b.sections : []
    const net = budNet(b), mu = net*((parseFloat(b.markup)||0)/100), afterFee = net+mu
    const customVal = afterFee*((parseFloat(b.custom_pct)||0)/100), afterCustom = afterFee+customVal
    const vatVal = b.vat ? afterCustom*0.2 : 0, tot = afterCustom+vatVal
    const activeSecs = sections.filter(s => s.enabled && secNet(s) > 0)

    mc.innerHTML = `
      <div class="bh-row">
        <button class="btn-secondary" id="back-to-list">← All budgets</button>
        <input type="text" id="be-name" value="${esc(b.name)}" style="flex:1;font-size:15px;font-weight:500;background:transparent;border:none;outline:none;border-bottom:1.5px solid transparent;padding:2px 4px;border-radius:0;color:var(--text-primary);font-family:var(--font);transition:border-color 0.15s" onfocus="this.style.borderBottomColor='var(--border-strong)'" onblur="this.style.borderBottomColor='transparent'" placeholder="Budget title" />
        <button class="btn-secondary" id="be-csv">Export CSV</button>
        <button class="btn-primary"   id="be-pdf">Export PDF</button>
      </div>
      ${b.notes ? `<div style="background:var(--bg-secondary);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--text-secondary);line-height:1.6">${esc(b.notes)}</div>` : ''}
      <div class="budget-layout">
        <div class="budget-main">
          <div class="mu-row">
            <div class="mu-field">Production fee <input type="number" id="be-markup" value="${b.markup}" min="0" max="100"> %</div>
            <div class="mu-field">Custom add-on <input type="number" id="be-custom" value="${b.custom_pct||0}" min="0"> %</div>
            <div class="mu-field"><label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="be-vat" ${b.vat?'checked':''} style="cursor:pointer" /> VAT (20%)</label></div>
            <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto">Enter days to auto-enable a section</span>
          </div>
          <div id="be-sections">
            ${sections.map((s,si) => this.sectionHTML(b, s, si)).join('')}
          </div>
          <button class="dashed-btn" id="be-add-section" style="margin-top:12px">+ add custom section</button>
        </div>
        <div class="budget-sidebar-panel">
          <div class="bsum-card">
            <div class="bsum-head">Summary</div>
            ${activeSecs.length ? activeSecs.map(s=>`<div class="bsum-row"><span class="sk">${s.code} ${s.label.split('—')[0].split(' ').slice(0,3).join(' ').trim()}</span><span class="sv">${gbpA(secNet(s))}</span></div>`).join('') : '<div style="padding:10px 15px;font-size:12px;color:var(--text-tertiary)">No sections active</div>'}
            <div class="bsum-row" style="border-top:0.5px solid var(--border-light)"><span class="sk">Net total</span><span class="sv">${gbpA(net)}</span></div>
            ${(parseFloat(b.markup)||0)>0 ? `<div class="bsum-row"><span class="sk">Production fee (${b.markup}%)</span><span class="sv">${gbpA(mu)}</span></div>` : ''}
            ${(parseFloat(b.custom_pct)||0)>0 ? `<div class="bsum-row"><span class="sk">Add-on (${b.custom_pct}%)</span><span class="sv">${gbpA(customVal)}</span></div>` : ''}
            ${b.vat ? `<div class="bsum-row"><span class="sk">VAT (20%)</span><span class="sv">${gbpA(vatVal)}</span></div>` : ''}
            <div class="bsum-row grand"><span class="sk">Grand total</span><span class="sv">${gbpA(tot)}</span></div>
          </div>
          <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">
            <label style="display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--bg-secondary);border-radius:var(--radius-md);cursor:pointer;font-size:13px;color:var(--text-secondary)">
              <input type="checkbox" id="be-pipeline" ${b.include_in_pipeline?'checked':''} style="cursor:pointer;width:15px;height:15px;flex-shrink:0" />
              Include in Pipeline
            </label>
            <div>
              <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Prepared by</div>
              <input class="bl-in w" type="text" id="be-preparedby" value="${esc(b.prepared_by||this.app.settings?.prepared_by)}" placeholder="e.g. Robbie Meade" style="font-size:12px;padding:5px 8px" />
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Reply-to email</div>
              <input class="bl-in w" type="email" id="be-email" value="${esc(b.quote_email||this.app.settings?.email)}" placeholder="${esc(this.app.settings?.email||'hello@yourcompany.com')}" style="font-size:12px;padding:5px 8px" />
            </div>
          </div>
        </div>
      </div>`

    this.bindEditor(mc, b)
  }

  sectionHTML(b, s, si) {
    const sn = secNet(s)
    const isCrew = !!(s.crew || s.hasDays)
    const isCustom = s.code === 'X'
    // Crew sections: Item | Notes | Days | Qty | Travel days | Rate | Total | ×
    // Non-crew:      Item | Notes | Qty  | Rate | Total | ×
    return `<div class="bsec-wrap" id="bsw-${si}">
      <div class="bsec-head ${s.enabled?'enabled':''}" data-toggle-open="${si}">
        <span class="bsec-code">${s.code}</span>
        <span class="bsec-name">${s.label}</span>
        ${isCustom ? `<label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-tertiary);cursor:pointer;margin-right:4px" onclick="event.stopPropagation()"><input type="checkbox" ${isCrew?'checked':''} data-toggle-days="${si}" style="cursor:pointer" /> days</label>` : ''}
        <span class="bsec-amt" id="bamt-${si}">${s.enabled&&sn>0?gbpA(sn):''}</span>
        <button class="bsec-tog ${s.enabled?'on':''}" data-toggle-sec="${si}">${s.enabled?'On':'Off'}</button>
        <span class="bsec-chev ${s.open?'open':''}">▶</span>
      </div>
      <div class="bsec-body ${s.open?'open':''}">
        <table class="bl-table" style="table-layout:fixed"><colgroup>
          ${isCrew
            ? `<col style="width:28%" /><col style="width:12%" /><col style="width:58px" /><col style="width:50px" /><col style="width:66px" /><col style="width:66px" /><col style="width:76px" /><col style="width:14%" />`
            : `<col style="width:38%" /><col style="width:16%" /><col style="width:60px" /><col style="width:80px" /><col style="width:80px" /><col style="width:18%" />`
          }
        </colgroup><thead><tr>
          <th>Item</th>
          <th>Notes</th>
          ${isCrew ? `<th class="r">Days</th><th class="r">Qty</th><th class="r">Travel days</th>` : `<th class="r">Qty</th>`}
          <th class="r">Rate £</th>
          <th class="r">Total</th>
          <th></th>
        </tr></thead><tbody>
          ${(s.lines||[]).map((l,li) => this.lineHTML(si, li, l, isCrew)).join('')}
          <tr class="sub">
            <td colspan="${isCrew?7:5}" style="text-align:right;color:var(--text-secondary);font-size:11px;padding-right:8px">Section total</td>
            <td style="text-align:right" id="bst-${si}">${gbpA(sn)}</td><td></td>
          </tr>
        </tbody></table>
        <button class="add-line" data-add-line="${si}">+ add line item</button>
      </div>
    </div>`
  }

  lineHTML(si, li, l, isCrew) {
    const t = lineTotal(l, isCrew)
    return `<tr id="bl-${si}-${li}">
      <td><input class="bl-in w" value="${esc(l.item)}" placeholder="Item" data-field="${si},${li},item" /></td>
      <td><input class="bl-in w" value="${esc(l.notes||'')}" placeholder="Notes" data-field="${si},${li},notes" /></td>
      ${isCrew
        ? `<td><input class="bl-in w" type="number" value="${l.days||''}" placeholder="0" min="0" step="0.5" data-num="${si},${li},days" style="text-align:right" /></td>
           <td><input class="bl-in w" type="number" value="${l.qty??1}" placeholder="1" min="0" data-num="${si},${li},qty" style="text-align:right" /></td>
           <td><input class="bl-in w" type="number" value="${l.travelDays||0}" placeholder="0" min="0" step="0.5" data-num="${si},${li},travelDays" style="text-align:right" /></td>`
        : `<td><input class="bl-in w" type="number" value="${l.qty??1}" placeholder="1" min="0" data-num="${si},${li},qty" style="text-align:right" /></td>`
      }
      <td><input class="bl-in w" type="number" value="${l.rate||''}" placeholder="0" min="0" data-num="${si},${li},rate" style="text-align:right" /></td>
      <td class="bl-tot ${t>0?'nz':''}" id="blt-${si}-${li}">${t>0?gbpA(t):'—'}</td>
      <td style="text-align:right"><button class="row-btn" style="color:#c03020" data-rem-line="${si},${li}">×</button></td>
    </tr>`
  }

  bindEditor(mc, b) {
    const sections = b.sections
    const save = () => this.saveField(b)
    const refreshSummary = () => {
      const net = budNet(b), mu = net*((parseFloat(b.markup)||0)/100), afterFee = net+mu
      const customVal = afterFee*((parseFloat(b.custom_pct)||0)/100), afterCustom = afterFee+customVal
      const vatVal = b.vat ? afterCustom*0.2 : 0, tot = afterCustom+vatVal
      const card = mc.querySelector('.bsum-card')
      if (!card) return
      const activeSecs = sections.filter(s => s.enabled && secNet(s) > 0)
      card.innerHTML = `
        <div class="bsum-head">Summary</div>
        ${activeSecs.length ? activeSecs.map(s=>`<div class="bsum-row"><span class="sk">${s.code} ${s.label.split('—')[0].split(' ').slice(0,3).join(' ').trim()}</span><span class="sv">${gbpA(secNet(s))}</span></div>`).join('') : '<div style="padding:10px 15px;font-size:12px;color:var(--text-tertiary)">No sections active</div>'}
        <div class="bsum-row" style="border-top:0.5px solid var(--border-light)"><span class="sk">Net total</span><span class="sv">${gbpA(net)}</span></div>
        ${(parseFloat(b.markup)||0)>0?`<div class="bsum-row"><span class="sk">Production fee (${b.markup}%)</span><span class="sv">${gbpA(mu)}</span></div>`:''}
        ${(parseFloat(b.custom_pct)||0)>0?`<div class="bsum-row"><span class="sk">Add-on (${b.custom_pct}%)</span><span class="sv">${gbpA(customVal)}</span></div>`:''}
        ${b.vat?`<div class="bsum-row"><span class="sk">VAT (20%)</span><span class="sv">${gbpA(vatVal)}</span></div>`:''}
        <div class="bsum-row grand"><span class="sk">Grand total</span><span class="sv">${gbpA(tot)}</span></div>`
    }

    mc.querySelector('#back-to-list')?.addEventListener('click', () => { this.currentId = null; this.renderList(mc); this.app.updateTitle() })
    mc.querySelector('#be-name')?.addEventListener('change', e => {
      const val = e.target.value.trim()
      if (!val) { e.target.value = b.name; return }
      b.name = val; save()
      this.app.updateTitle()
    })
    mc.querySelector('#be-markup')?.addEventListener('change', e => { b.markup = parseFloat(e.target.value)||0; save(); refreshSummary() })
    mc.querySelector('#be-custom')?.addEventListener('change', e => { b.custom_pct = parseFloat(e.target.value)||0; save(); refreshSummary() })
    mc.querySelector('#be-vat')?.addEventListener('change',    e => { b.vat = e.target.checked; save(); refreshSummary() })
    mc.querySelector('#be-pipeline')?.addEventListener('change', e => { b.include_in_pipeline = e.target.checked; save() })
    mc.querySelector('#be-preparedby')?.addEventListener('change', e => { b.prepared_by = e.target.value; save() })
    mc.querySelector('#be-email')?.addEventListener('change',      e => { b.quote_email = e.target.value; save() })
    mc.querySelector('#be-csv')?.addEventListener('click', () => this.exportCSV(b))
    mc.querySelector('#be-pdf')?.addEventListener('click', () => this.exportPDF(b))
    mc.querySelector('#be-add-section')?.addEventListener('click', () => {
      const label = prompt('Section name:')
      if (!label) return
      sections.push({ code: 'X', label, enabled: true, open: true, lines: [{ item: '', notes: '', days: 0, qty: 1, rate: null }] })
      save(); this.renderEditor(mc)
    })

    // Section toggle open
    mc.querySelectorAll('[data-toggle-open]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-toggle-sec]')) return
        const si = +el.dataset.toggleOpen
        sections[si].open = !sections[si].open
        const body = mc.querySelector(`#bsw-${si} .bsec-body`)
        const chev = mc.querySelector(`#bsw-${si} .bsec-chev`)
        body?.classList.toggle('open', sections[si].open)
        chev?.classList.toggle('open', sections[si].open)
        save()
      })
    })

    // hasDays toggle for custom sections
    mc.querySelectorAll('[data-toggle-days]').forEach(el => {
      el.addEventListener('change', () => {
        const si = +el.dataset.toggleDays
        sections[si].hasDays = el.checked
        save(); this.renderEditor(mc)
      })
    })

    // Section toggle on/off
    mc.querySelectorAll('[data-toggle-sec]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const si = +btn.dataset.toggleSec
        sections[si].enabled = !sections[si].enabled
        if (sections[si].enabled && !sections[si].open) sections[si].open = true
        save(); this.renderEditor(mc)
      })
    })

    // Field text inputs
    mc.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('change', () => {
        const [si,li,field] = el.dataset.field.split(',')
        sections[+si].lines[+li][field] = el.value
        save()
      })
    })

    // Numeric inputs
    mc.querySelectorAll('[data-num]').forEach(el => {
      el.addEventListener('change', () => {
        const [si,li,field] = el.dataset.num.split(',')
        const s = sections[+si]; const l = s.lines[+li]
        l[field] = parseFloat(el.value) || 0
        const isCrew = !!(s.crew || s.hasDays)
        // Auto-enable when a value is entered
        const triggers = isCrew ? field === 'days' && l.days > 0 : (field === 'qty' || field === 'rate') && l.qty > 0 && l.rate > 0
        if (triggers && !s.enabled) {
          s.enabled = true; s.open = true
          mc.querySelector(`#bsw-${si} .bsec-head`)?.classList.add('enabled')
          const tog = mc.querySelector(`#bsw-${si} .bsec-tog`)
          if (tog) { tog.classList.add('on'); tog.textContent = 'On' }
        }
        const t = lineTotal(l, isCrew)
        const ltEl = mc.querySelector(`#blt-${si}-${li}`)
        if (ltEl) { ltEl.textContent = t>0?gbpA(t):'—'; ltEl.className = 'bl-tot'+(t>0?' nz':'') }
        const stEl = mc.querySelector(`#bst-${si}`)
        if (stEl) stEl.textContent = gbpA(secNet(s))
        const amtEl = mc.querySelector(`#bamt-${si}`)
        if (amtEl) amtEl.textContent = s.enabled&&secNet(s)>0?gbpA(secNet(s)):''
        refreshSummary()
        save()
      })
    })

    // Add line
    mc.querySelectorAll('[data-add-line]').forEach(btn => {
      btn.addEventListener('click', () => {
        const si = +btn.dataset.addLine
        const isCrew = !!(sections[si].crew || sections[si].hasDays)
        sections[si].lines.push({ item:'', notes:'', qty:1, rate:null, ...(isCrew ? {days:0, travelDays:0} : {}) })
        save(); this.renderEditor(mc)
      })
    })

    // Remove line
    mc.querySelectorAll('[data-rem-line]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [si,li] = btn.dataset.remLine.split(',').map(Number)
        if (sections[si].lines.length <= 1) return
        sections[si].lines.splice(li, 1)
        save(); this.renderEditor(mc)
      })
    })
  }

  async saveField(b) {
    try {
      const [updated] = await updateBudget(this.app.userId, b.id, {
        name: b.name,
        markup: b.markup, custom_pct: b.custom_pct, vat: b.vat,
        sections: b.sections, prepared_by: b.prepared_by, quote_email: b.quote_email,
        notes: b.notes, include_in_pipeline: b.include_in_pipeline ?? false,
      })
      const idx = this.app.budgets.findIndex(x => x.id === b.id)
      if (idx >= 0) this.app.budgets[idx] = { ...this.app.budgets[idx], ...updated }
    } catch (e) { console.error('Budget save failed:', e) }
  }

  // ── CSV Export ──────────────────────────────────────────────────────────────

  exportCSV(b) {
    const cl = this.app.contacts.find(c => c.id === b.client_id)
    const net = budNet(b), mu = net*((parseFloat(b.markup)||0)/100), afterFee = net+mu
    const customVal = afterFee*((parseFloat(b.custom_pct)||0)/100), afterCustom = afterFee+customVal
    const vatVal = b.vat ? afterCustom*0.2 : 0
    let rows = [
      ['Budget',b.name],['Client',cl?cl.first_name+' '+cl.last_name:''],
      ['Production fee %',b.markup],['Custom add-on %',b.custom_pct||0],['VAT',b.vat?'Yes':'No'],[''],
      ['Section','Item','Notes','Days','Qty','Travel Days','Rate (£)','Total (£)']
    ]
    ;(b.sections||[]).filter(s=>s.enabled).forEach(s => {
      const al = (s.lines||[]).filter(l => hasValue(l))
      if (!al.length) return
      al.forEach(l => rows.push([s.code+' — '+s.label, l.item, l.notes||'', l.days||0, l.qty||1, l.travelDays!=null?l.travelDays||0:'N/A', l.rate||0, Math.round(lineTotal(l))]))
      rows.push([s.code+' SUBTOTAL','','','','','','',Math.round(secNet(s))]); rows.push([])
    })
    rows.push(['NET TOTAL','','','','','','',Math.round(net)])
    if ((parseFloat(b.markup)||0)>0)     rows.push(['PRODUCTION FEE ('+b.markup+'%)','','','','','','',Math.round(mu)])
    if ((parseFloat(b.custom_pct)||0)>0) rows.push(['CUSTOM ADD-ON ('+b.custom_pct+'%)','','','','','','',Math.round(customVal)])
    if (b.vat)                           rows.push(['VAT (20%)','','','','','','',Math.round(vatVal)])
    rows.push(['GRAND TOTAL','','','','','','',Math.round(afterCustom+vatVal)])
    const csv = rows.map(r => r.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = (b.name||'budget').replace(/[^a-z0-9]/gi,'_') + '.csv'
    a.click()
    this.app.toast('CSV exported')
  }

  // ── PDF Export ──────────────────────────────────────────────────────────────

  exportPDF(b) {
    const cl = this.app.contacts.find(c => c.id === b.client_id)
    const s  = this.app.settings || {}
    const net = budNet(b), mu = net*((parseFloat(b.markup)||0)/100), afterFee = net+mu
    const customVal = afterFee*((parseFloat(b.custom_pct)||0)/100), afterCustom = afterFee+customVal
    const vatVal = b.vat ? afterCustom*0.2 : 0, tot = afterCustom+vatVal
    const today = new Date()
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const dateStr = today.getDate()+' '+months[today.getMonth()]+' '+today.getFullYear()
    const validDate = new Date(today); validDate.setDate(validDate.getDate()+30)
    const validStr = validDate.getDate()+' '+months[validDate.getMonth()]+' '+validDate.getFullYear()
    const activeSecs = (b.sections||[]).filter(s => s.enabled && secNet(s) > 0)
    const LOGO_WHITE = '/peny-logo-white.png'
    const LOGO_BLACK = '/peny-logo.png'

    const coverHTML = `
      <div class="pdf-cover">
        <div class="pdf-logo"><img src="${LOGO_WHITE}" alt="Peny" /></div>
        <div class="pdf-cover-body">
          <div class="pdf-quote-label">Quote</div>
          <div class="pdf-budget-title">${esc(b.name)}</div>
          <div class="pdf-client-name">${cl?'Prepared for '+esc(cl.first_name)+' '+esc(cl.last_name)+', '+esc(cl.company):''}</div>
          ${b.notes?`<div style="font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:28px;line-height:1.6">${esc(b.notes)}</div>`:''}
          <hr class="pdf-cover-divider" />
          <table class="pdf-cover-summary"><tbody>
            ${activeSecs.map(sec=>`<tr><td class="sec-code">${sec.code}</td><td class="sec-name">${sec.label}</td><td class="sec-total">${gbpA(secNet(sec))}</td></tr>`).join('')}
          </tbody></table>
          <div class="pdf-cover-totals">
            <div class="pdf-cover-total-row"><span class="tk">Net total</span><span class="tv">${gbpA(net)}</span></div>
            ${(parseFloat(b.markup)||0)>0?`<div class="pdf-cover-total-row"><span class="tk">Production fee (${b.markup}%)</span><span class="tv">${gbpA(mu)}</span></div>`:''}
            ${(parseFloat(b.custom_pct)||0)>0?`<div class="pdf-cover-total-row"><span class="tk">Add-on (${b.custom_pct}%)</span><span class="tv">${gbpA(customVal)}</span></div>`:''}
            ${b.vat?`<div class="pdf-cover-total-row"><span class="tk">VAT (20%)</span><span class="tv">${gbpA(vatVal)}</span></div>`:''}
            <div class="pdf-cover-total-row grand"><span class="tk">Grand total</span><span class="tv">${gbpA(tot)}</span></div>
          </div>
        </div>
        <div class="pdf-cover-footer">
          <div class="pdf-cover-meta">
            ${dateStr}<br>
            ${s.address?s.address+'<br>':''}
            ${(b.quote_email||s.email)?`<a href="mailto:${b.quote_email||s.email}" style="color:rgba(255,255,255,0.3);text-decoration:none">${b.quote_email||s.email}</a>`:''}
            ${s.vat_number?'<br>VAT: '+s.vat_number:''}
          </div>
          <div class="pdf-valid">
            ${(b.prepared_by||s.prepared_by)?`Quote prepared by ${b.prepared_by||s.prepared_by}<br>`:''}
            Quote valid for 30 days<br>Valid until ${validStr}
          </div>
        </div>
      </div>`

    let detailSecHTML = ''
    activeSecs.forEach(sec => {
      const al = (sec.lines||[]).filter(l => hasValue(l))
      if (!al.length) return
      const isCrew = !!sec.crew
      detailSecHTML += `
        <div class="pdf-section">
          <div class="pdf-section-header">
            <span class="pdf-section-code">${sec.code}</span>
            <span class="pdf-section-name">${sec.label}</span>
            <span class="pdf-section-total">${gbpA(secNet(sec))}</span>
          </div>
          <div class="pdf-col-heads">
            <div class="pdf-col-head" style="text-align:left">Item</div>
            <div class="pdf-col-head">Days</div><div class="pdf-col-head">Qty</div>
            <div class="pdf-col-head">${isCrew?'Travel':'Rate'}</div>
            <div class="pdf-col-head">Total</div>
          </div>
          ${al.map(l => {
            const t=lineTotal(l),d=parseFloat(l.days)||0,q=parseFloat(l.qty)||1,r=parseFloat(l.rate)||0,td=parseFloat(l.travelDays)||0
            return `<div class="pdf-line">
              <div class="pdf-line-item">${esc(l.item)}${l.notes?`<div class="pdf-line-sub">${esc(l.notes)}</div>`:''}${isCrew&&td>0?`<div class="pdf-line-sub">+${td} travel day${td!==1?'s':''} @ 50%</div>`:''}</div>
              <div class="pdf-line-num">${d>0?d:''}</div>
              <div class="pdf-line-num">${d>0&&q!==1?q:''}</div>
              <div class="pdf-line-num">${isCrew?(td>0?gbpA(r*td*0.5):''):(r>0?gbpA(r):'')}</div>
              <div class="pdf-line-total">${gbpA(t)}</div>
            </div>`
          }).join('')}
        </div>`
    })

    const detailHTML = `
      <div class="pdf-detail-page">
        <div class="pdf-detail-header">
          <div class="pdf-detail-header-left">
            <div class="pdf-detail-label">Quote — Detailed breakdown</div>
            <div class="pdf-detail-title">${esc(b.name)}</div>
          </div>
          <img src="${LOGO_BLACK}" alt="Peny" />
        </div>
        ${detailSecHTML}
        <div class="pdf-detail-totals">
          <div class="pdf-detail-total-row"><span class="dk">Net total</span><span>${gbpA(net)}</span></div>
          ${(parseFloat(b.markup)||0)>0?`<div class="pdf-detail-total-row"><span class="dk">Production fee (${b.markup}%)</span><span>${gbpA(mu)}</span></div>`:''}
          ${(parseFloat(b.custom_pct)||0)>0?`<div class="pdf-detail-total-row"><span class="dk">Add-on (${b.custom_pct}%)</span><span>${gbpA(customVal)}</span></div>`:''}
          ${b.vat?`<div class="pdf-detail-total-row"><span class="dk">VAT (20%)</span><span>${gbpA(vatVal)}</span></div>`:''}
          <div class="pdf-detail-total-row grand"><span class="dk">Grand total</span><span>${gbpA(tot)}</span></div>
        </div>
        <div class="pdf-detail-footer">
          <span>${[(b.quote_email||s.email),s.website].filter(Boolean).join(' · ')}${(b.prepared_by||s.prepared_by)?' · Prepared by '+(b.prepared_by||s.prepared_by):''}</span>
          <span>Quote valid until ${validStr}</span>
        </div>
      </div>`

    let ts = document.getElementById('pdf-topsheet')
    if (!ts) { ts = document.createElement('div'); ts.id = 'pdf-topsheet'; document.body.appendChild(ts) }
    ts.innerHTML = coverHTML + detailHTML
    setTimeout(() => window.print(), 150)
    this.app.toast('Opening print dialog…')
  }
}
