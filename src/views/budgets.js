import { createBudget, updateBudget, deleteBudget, saveBudgetVersion, getBudgetVersions, deleteBudgetVersion, setQuoteToken } from '../db/client.js'

export const SECTIONS = [
  {code:'A1',label:'Pre-production — Scouting',lines:[{item:'Location Scout (Director)',prepDays:0,days:0,qty:0,rate:501},{item:'Assistant Location Scout',prepDays:0,days:0,qty:0,rate:369},{item:'Location Scout car / mileage',prepDays:0,days:0,qty:0,rate:null},{item:'Congestion Charge',prepDays:0,days:0,qty:0,rate:13},{item:'Unit Driver / Bus Hire',prepDays:0,days:0,qty:0,rate:450},{item:'Subsistence',prepDays:0,days:0,qty:0,rate:null},{item:'Flights',prepDays:0,days:0,qty:0,rate:null},{item:'Accommodation',prepDays:0,days:0,qty:0,rate:null}]},
  {code:'A2',label:'Pre-production — Expenses',lines:[{item:'Researcher',prepDays:0,days:0,qty:0,rate:350},{item:'References / Materials / PPM Prep',prepDays:0,days:0,qty:0,rate:150},{item:'Taxis',prepDays:0,days:0,qty:0,rate:null},{item:'Couriers',prepDays:0,days:0,qty:0,rate:null},{item:'Tel / Comms',prepDays:0,days:0,qty:0,rate:null}]},
  {code:'C',label:'Cast',crew:true,lines:[{item:'Presenter / Talent',prepDays:0,days:0,qty:0,rate:null,travelDays:0},{item:'Supporting Artists',prepDays:0,days:0,qty:0,rate:null,travelDays:0},{item:'Stunt Performers',prepDays:0,days:0,qty:0,rate:null,travelDays:0}]},
  {code:'D',label:'Production Crew',crew:true,lines:[{item:'Director',prepDays:0,days:0,qty:0,rate:850,travelDays:0},{item:'Producer',prepDays:0,days:0,qty:0,rate:650,travelDays:0},{item:'Production Manager',prepDays:0,days:0,qty:0,rate:450,travelDays:0},{item:'Production Assistant',prepDays:0,days:0,qty:0,rate:250,travelDays:0},{item:'Camera Operator',prepDays:0,days:0,qty:0,rate:600,travelDays:0},{item:'1st AC / Focus Puller',prepDays:0,days:0,qty:0,rate:450,travelDays:0},{item:'DIT',prepDays:0,days:0,qty:0,rate:400,travelDays:0},{item:'Drone Pilot',prepDays:0,days:0,qty:0,rate:550,travelDays:0},{item:'Sound Recordist',prepDays:0,days:0,qty:0,rate:450,travelDays:0},{item:'Gaffer / Spark',prepDays:0,days:0,qty:0,rate:400,travelDays:0},{item:'Grip',prepDays:0,days:0,qty:0,rate:380,travelDays:0},{item:'Make-up / Hair',prepDays:0,days:0,qty:0,rate:350,travelDays:0},{item:'Stylist',prepDays:0,days:0,qty:0,rate:350,travelDays:0},{item:'Runner',prepDays:0,days:0,qty:0,rate:150,travelDays:0}]},
  {code:'E',label:'Equipment',lines:[{item:'Camera Package',prepDays:0,days:0,qty:0,rate:null},{item:'Lens Package',prepDays:0,days:0,qty:0,rate:null},{item:'Lighting Package',prepDays:0,days:0,qty:0,rate:null},{item:'Grip Package',prepDays:0,days:0,qty:0,rate:null},{item:'Sound Package',prepDays:0,days:0,qty:0,rate:null},{item:'Drone Package',prepDays:0,days:0,qty:0,rate:null},{item:'Generator',prepDays:0,days:0,qty:0,rate:null},{item:'Data / Media',prepDays:0,days:0,qty:0,rate:null}]},
  {code:'F',label:'Art Department',lines:[{item:'Art Director',prepDays:0,days:0,qty:0,rate:500},{item:'Props',prepDays:0,days:0,qty:0,rate:null},{item:'Set Dressing / Hire',prepDays:0,days:0,qty:0,rate:null},{item:'Wardrobe',prepDays:0,days:0,qty:0,rate:null}]},
  {code:'G',label:'Studio / Location',lines:[{item:'Studio Hire (per day)',prepDays:0,days:0,qty:0,rate:null},{item:'Location Fees / Permits',prepDays:0,days:0,qty:0,rate:null},{item:'Security',prepDays:0,days:0,qty:0,rate:null},{item:'Facilities / Portaloos',prepDays:0,days:0,qty:0,rate:null}]},
  {code:'H',label:'Travel & Accommodation',lines:[{item:'Unit Vehicles / Transport',prepDays:0,days:0,qty:0,rate:null},{item:'Flights',prepDays:0,days:0,qty:0,rate:null},{item:'Accommodation',prepDays:0,days:0,qty:0,rate:null},{item:'Subsistence / Catering',prepDays:0,days:0,qty:0,rate:null},{item:'Mileage',prepDays:0,days:0,qty:0,rate:0.45},{item:'Congestion / Parking',prepDays:0,days:0,qty:0,rate:null}]},
  {code:'I',label:'Post-production',lines:[{item:'Editor (pre-production)',prepDays:0,days:0,qty:0,rate:350},{item:'Assembly Editor',prepDays:0,days:0,qty:0,rate:450},{item:'Assistant Editor',prepDays:0,days:0,qty:0,rate:400},{item:'Finishing Editor (incl. suite)',prepDays:0,days:0,qty:0,rate:500},{item:'Grade (all assets + suite)',prepDays:0,days:0,qty:0,rate:650},{item:'Sound Design',prepDays:0,days:0,qty:0,rate:750},{item:'Graphics / Motion',prepDays:0,days:0,qty:0,rate:450},{item:'Versioning',prepDays:0,days:0,qty:0,rate:null},{item:'Stock Track Licences',prepDays:0,days:0,qty:0,rate:10},{item:'Composition',prepDays:0,days:0,qty:0,rate:null},{item:'Hard Drives / Media',prepDays:0,days:0,qty:0,rate:250},{item:'Library Footage / SFX',prepDays:0,days:0,qty:0,rate:null}]},
  {code:'J',label:'Sundries',lines:[{item:'Legal Fees / Visas / Work Permits',prepDays:0,days:0,qty:0,rate:null},{item:'Contingency',prepDays:0,days:0,qty:0,rate:null},{item:'Miscellaneous',prepDays:0,days:0,qty:0,rate:null}]},
  {code:'K',label:'Insurance',lines:[{item:'General Production Insurance',prepDays:0,days:0,qty:0,rate:null},{item:'Specialist Travel Insurance',prepDays:0,days:0,qty:0,rate:null},{item:'Equipment Insurance',prepDays:0,days:0,qty:0,rate:null}]},
]

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
const gbpA = n => '£' + Math.round(n).toLocaleString('en-GB')
const moy = () => { const d = new Date(); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear() }

function lineTotal(l, travelRate, prepRate) {
  const prep  = parseFloat(l.prepDays)  || 0
  const shoot = parseFloat(l.days)      || 0
  const td    = parseFloat(l.travelDays)|| 0
  const useDays = prep > 0 || shoot > 0 || td > 0
  const q   = parseFloat(l.qty)
  const qty = isNaN(q) ? 0 : q
  const r   = parseFloat(l.rate)  || 0
  const tr  = parseFloat(travelRate) || 50
  const pr  = parseFloat(prepRate)   || 100
  const disc = Math.min(Math.max(parseFloat(l.discount)||0, 0), 100)
  const gross = useDays
    ? prep*qty*r*(pr/100) + shoot*qty*r + td*(tr/100)*r
    : qty*r
  return gross * (1 - disc/100)
}
function secNet(s, travelRate, prepRate) { return (s.lines||[]).reduce((t,l) => t + lineTotal(l, travelRate, prepRate), 0) }
function budNet(b)  {
  const tr = parseFloat(b.travel_rate)||50
  const pr = parseFloat(b.prep_rate)||100   // || catches NaN unlike ??
  return (b.sections||[]).filter(s=>s.enabled).reduce((t,s) => t + secNet(s, tr, pr), 0)
}
function budTotal(b) {
  const n = budNet(b)
  const insVal      = b.insurance ? n * 0.025 : 0
  const afterFee    = n + insVal + n * ((parseFloat(b.markup)||0)/100)
  const afterCustom = afterFee + afterFee * ((parseFloat(b.custom_pct)||0)/100)
  return afterCustom + (b.vat ? afterCustom*0.2 : 0)
}
const hasValue = l => {
  const useDays = l.useDays || (parseFloat(l.prepDays)||0) > 0 || (parseFloat(l.days)||0) > 0 || (parseFloat(l.travelDays)||0) > 0
  const hasQty = (parseFloat(l.qty)||0) > 0 && (parseFloat(l.rate)||0) > 0
  return useDays ? true : hasQty
}
const hasVisibleValue = l => hasValue(l) || ((parseFloat(l.discount)||0) >= 100 && (parseFloat(l.rate)||0) > 0)

export { budTotal, budNet }

export class BudgetsView {
  constructor(app) {
    this.app = app
    this.currentId = null
    this.editingId = null
  }

  render(mc) {
    if (this.currentId) {
      if (this.editingId === this.currentId) this.renderEditor(mc)
      else this.renderViewer(mc)
    } else {
      this.renderList(mc)
    }
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
        <div class="col-header" style="grid-template-columns:2fr 1.2fr 1.2fr 1fr 1fr 1.2fr 80px">
          <div>Budget</div><div>Project</div><div>Client</div><div>Net</div><div>Total</div><div>Signed off</div><div></div>
        </div>
        ${budgets.length ? budgets.map(b => {
          const cl = contacts.find(c => c.id === b.client_id)
          const proj = projects.find(p => Array.isArray(p.budget_ids) && p.budget_ids.includes(b.id))
          const soDate = b.signed_off_at ? new Date(b.signed_off_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : null
          return `<div class="contact-row" style="grid-template-columns:2fr 1.2fr 1.2fr 1fr 1fr 1.2fr 80px" data-open="${b.id}">
            <div style="font-weight:500">${esc(b.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${proj ? esc(proj.name) : '—'}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${cl ? esc(cl.first_name)+' '+esc(cl.last_name) : '—'}</div>
            <div style="color:var(--text-secondary)">${gbpA(budNet(b))}</div>
            <div style="font-weight:500">${gbpA(budTotal(b))}</div>
            <div style="font-size:11px">
              ${b.signed_off
                ? `<span style="color:#6ec96e;font-weight:500">✓ ${soDate}</span>
                   ${b.signed_off_by ? `<div style="color:var(--text-tertiary);font-size:10px">${esc(b.signed_off_by)}</div>` : ''}`
                : `<span style="color:var(--text-tertiary)">—</span>`}
            </div>
            <div style="text-align:right;display:flex;gap:6px;justify-content:flex-end">
              <button class="row-btn" data-dup="${b.id}" style="font-size:10px">Copy</button>
              <button class="row-btn" style="color:#b03020" data-delete="${b.id}">Delete</button>
            </div>
          </div>`
        }).join('') : '<div class="empty-state">No budgets yet</div>'}
      </div>
      ${this.newModalHTML()}
    `
    mc.querySelectorAll('.contact-row[data-open]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('[data-delete]')) return
        this.currentId = row.dataset.open
        this.app._pushAppState(`#budgets/${this.currentId}`, { view:'budgets', id:this.currentId })
        this.render(mc)
        this.app.updateTitle()
      })
    })
    mc.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.deleteBudget(btn.dataset.delete, mc) })
    })
    mc.querySelectorAll('[data-dup]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.duplicateBudget(btn.dataset.dup, mc) })
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
      if (p.brief) noteParts.push('Brief: ' + p.brief)
      if (p.location) noteParts.push('Location: ' + p.location)
      if (p.shoot_start) noteParts.push('Shoot dates: ' + p.shoot_start + (p.shoot_end && p.shoot_end !== p.shoot_start ? ' – ' + p.shoot_end : ''))
      const delivs = (p.deliverables||[]).filter(d=>d.text)
      if (delivs.length) noteParts.push('Deliverables:\n' + delivs.map(d=>'  · '+d.text).join('\n'))

      mc.querySelector('#bf-name').value   = p.name ?? ''
      mc.querySelector('#bf-notes').value  = noteParts.join('\n')
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

    // Use workspace template if set, otherwise fall back to built-in SECTIONS
    const templateDefs = this.app.settings?.budget_template ?? SECTIONS
    const sections = templateDefs.map(def => ({
      code: def.code, label: def.label, enabled: def.enabled ?? false, open: false,
      crew: !!def.crew,
      lines: (def.lines || []).map(l => ({
        ...l,
        prepDays: 0,
        days: 0,
        qty: l.qty ?? 0,
        notes: '',
        travelDays: 0,
      }))
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
      this.editingId = created.id  // open straight into edit mode
      this.app._pushAppState(`#budgets/${created.id}`, { view:'budgets', id:created.id })
      this.render(mc)
      this.app.updateTitle()
      this.app.toast('Budget created')
    } catch (e) { console.error(e); this.app.toast('Error creating budget') }
  }

  async duplicateBudget(id, mc) {
    const b = this.app.budgets.find(x => x.id === id)
    if (!b) return
    try {
      const copy = {
        name: b.name + ' (copy)',
        client_id: b.client_id,
        markup: b.markup, custom_pct: b.custom_pct, vat: b.vat, insurance: b.insurance ?? false,
        travel_rate: b.travel_rate ?? 50, prep_rate: b.prep_rate ?? 100, discount: b.discount ?? 0,
        sections: JSON.parse(JSON.stringify(b.sections || [])),
        prepared_by: b.prepared_by, quote_email: b.quote_email,
        notes: b.notes,
        signed_off: false, signed_off_at: null, signed_off_by: null,
        include_in_pipeline: false,
      }
      const [created] = await createBudget(this.app.userId, copy)
      this.app.budgets.unshift(created)
      this.currentId = created.id
      this.editingId = created.id
      this.render(mc)
      this.app.updateTitle()
      this.app.toast('Budget duplicated — now editing copy')
    } catch(e) { console.error(e); this.app.toast('Error duplicating budget') }
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

  // ── Viewer (read-only) ───────────────────────────────────────────────────────

  renderViewer(mc) {
    const b = this.app.budgets.find(x => x.id === this.currentId)
    if (!b) { this.currentId = null; this.renderList(mc); return }
    const { contacts, projects } = this.app
    const cl = contacts.find(c => c.id === b.client_id)
    const proj = projects.find(p => Array.isArray(p.budget_ids) && p.budget_ids.includes(b.id))
    const edTr = parseFloat(b.travel_rate)||50
    const edPr = parseFloat(b.prep_rate)||100
    const net = budNet(b), mu = net*((parseFloat(b.markup)||0)/100)
    const insVal = b.insurance ? net*0.025 : 0, afterFee = net+insVal+mu
    const customVal = afterFee*((parseFloat(b.custom_pct)||0)/100), afterCustom = afterFee+customVal
    const vatVal = b.vat ? afterCustom*0.2 : 0, tot = afterCustom+vatVal
    const activeSecs = (b.sections||[]).filter(s => s.enabled && ((s.lines||[]).some(l => hasVisibleValue(l))))
    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')

    mc.innerHTML = `
      <div class="bh-row">
        <button class="btn-secondary" id="bv-back">← All budgets</button>
        <h2 style="flex:1;font-size:15px;font-weight:500">${esc(b.name)}</h2>
        <button class="btn-secondary" id="bv-history" style="font-size:12px">History</button>
        <button class="btn-secondary" id="bv-dup" style="font-size:12px">Duplicate</button>
        <button class="btn-secondary" id="bv-csv">Export CSV</button>
        <button class="btn-secondary" id="bv-pdf">Export PDF</button>
        ${this.app.permissions?.budgets_edit ? `<button class="btn-primary" id="bv-edit">Edit budget</button>` : ''}
      </div>
      <div id="bv-history-panel" style="display:none;background:var(--bg-secondary);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px"></div>
      ${b.notes ? `<div style="background:var(--bg-secondary);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--text-secondary);line-height:1.6;white-space:pre-line">${esc(b.notes)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        ${cl ? `<span class="tag" style="background:var(--bg-secondary);color:var(--text-secondary)">${esc(cl.first_name)} ${esc(cl.last_name)} — ${esc(cl.company)}</span>` : ''}
        ${proj ? `<span class="tag" style="background:#daeeff;color:#0d4a8a">${esc(proj.name)}</span>` : ''}
        ${b.vat ? `<span class="tag" style="background:var(--bg-secondary);color:var(--text-secondary)">VAT included</span>` : ''}
        ${b.signed_off
          ? `<button id="bv-signedoff-toggle" style="display:flex;align-items:center;gap:6px;padding:5px 12px;background:rgba(110,201,110,0.12);border:0.5px solid rgba(110,201,110,0.3);border-radius:20px;color:#6ec96e;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font)">
               ✓ Signed off${b.signed_off_at ? ' · '+new Date(b.signed_off_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : ''}
               <span style="font-size:10px;opacity:0.6">✕</span>
             </button>`
          : `<button id="bv-signedoff-toggle" style="display:flex;align-items:center;gap:6px;padding:5px 12px;background:var(--bg-secondary);border:0.5px solid var(--border-med);border-radius:20px;color:var(--text-tertiary);font-size:12px;cursor:pointer;font-family:var(--font)">
               Mark as signed off
             </button>`}
        ${b.signed_off
          ? b.invoiced
            ? `<button id="bv-invoiced-toggle" style="display:flex;align-items:center;gap:6px;padding:5px 12px;background:rgba(74,144,217,0.12);border:0.5px solid rgba(74,144,217,0.3);border-radius:20px;color:#4a90d9;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font)">
                 ✓ Invoiced${b.invoiced_at ? ' · '+new Date(b.invoiced_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : ''}
                 <span style="font-size:10px;opacity:0.6">✕</span>
               </button>`
            : `<button id="bv-invoiced-toggle" style="display:flex;align-items:center;gap:6px;padding:5px 12px;background:var(--bg-secondary);border:0.5px solid var(--border-med);border-radius:20px;color:var(--text-tertiary);font-size:12px;cursor:pointer;font-family:var(--font)">
                 Mark as invoiced
               </button>`
          : ''}
      </div>
      <div class="budget-layout">
        <div class="budget-main">
          ${activeSecs.length ? activeSecs.map(s => {
            const activeLines = (s.lines||[]).filter(l => hasVisibleValue(l))
            const isCrew = !!s.crew
            return `<div class="bsec-wrap" style="margin-bottom:8px">
              <div class="bsec-head enabled" style="cursor:default">
                <span class="bsec-code">${s.code}</span>
                <span class="bsec-name">${s.label}</span>
                <span class="bsec-amt">${gbpA(secNet(s,edTr))}</span>
              </div>
              <div class="bsec-body open">
                <table class="bl-table" style="table-layout:fixed"><colgroup>
                  <col style="width:35%"/><col style="width:15%"/><col style="width:10%"/><col style="width:10%"/><col style="width:10%"/><col style="width:10%"/><col/>
                </colgroup><thead><tr>
                  <th>Item</th><th>Notes</th><th class="r">Days/Qty</th><th class="r">Rate</th><th class="r">Disc%</th><th class="r">Total</th><th></th>
                </tr></thead><tbody>
                  ${activeLines.map(l => {
                    const prep = parseFloat(l.prepDays)||0, d = parseFloat(l.days)||0, q = isNaN(parseFloat(l.qty))?0:parseFloat(l.qty), r = parseFloat(l.rate)||0
                    const useDays = l.useDays || prep > 0 || d > 0 || (parseFloat(l.travelDays)||0) > 0
                    const t = lineTotal(l, edTr, edPr)
                    const td = parseFloat(l.travelDays)||0
                    const totalDays = prep + d
                    const dqStr = useDays ? `${totalDays}d × ${q}` : `×${q}`
                    return `<tr>
                      <td style="font-size:12px;padding:6px 8px">${esc(l.item)}${l.notes?`<div style="font-size:10px;color:var(--text-tertiary)">${esc(l.notes)}</div>`:''}</td>
                      <td style="font-size:12px;padding:6px 8px;color:var(--text-tertiary)"></td>
                      <td style="font-size:12px;padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums">${dqStr}</td>
                      <td style="font-size:12px;padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums">${r>0?gbpA(r):''}</td>
                      <td style="font-size:12px;padding:6px 8px;text-align:right;color:var(--text-tertiary)">${(parseFloat(l.discount)||0)>0?l.discount+'%':''}</td>
                      <td class="bl-tot ${t>0||(parseFloat(l.discount)||0)>=100?'nz':''}" style="padding:6px 8px">${t>0||(parseFloat(l.discount)||0)>=100?gbpA(t):'—'}</td>
                      <td></td>
                    </tr>`
                  }).join('')}
                </tbody></table>
              </div>
            </div>`
          }).join('') : '<div class="empty-state">No line items yet — click Edit budget to add sections.</div>'}
        </div>
        <div class="budget-sidebar-panel">
          <div class="bsum-card">
            <div class="bsum-head">Summary</div>
            ${activeSecs.map(s=>`<div class="bsum-row"><span class="sk">${s.code} ${s.label.split('—')[0].split(' ').slice(0,3).join(' ').trim()}</span><span class="sv">${gbpA(secNet(s,edTr))}</span></div>`).join('')}
            <div class="bsum-row" style="border-top:0.5px solid var(--border-light)"><span class="sk">Net total</span><span class="sv">${gbpA(net)}</span></div>
            ${(parseFloat(b.markup)||0)>0?`<div class="bsum-row"><span class="sk">Production fee (${b.markup}%)</span><span class="sv">${gbpA(mu)}</span></div>`:''}
            ${(parseFloat(b.custom_pct)||0)>0?`<div class="bsum-row"><span class="sk">Add-on (${b.custom_pct}%)</span><span class="sv">${gbpA(customVal)}</span></div>`:''}
            ${b.insurance&&insVal>0?`<div class="bsum-row"><span class="sk">Insurance (2.5%)</span><span class="sv">${gbpA(insVal)}</span></div>`:""}
            ${b.vat?`<div class="bsum-row"><span class="sk">VAT (20%)</span><span class="sv">${gbpA(vatVal)}</span></div>`:''}
            <div class="bsum-row grand"><span class="sk">Grand total</span><span class="sv">${gbpA(tot)}</span></div>
          </div>
          ${(b.prepared_by||this.app.settings?.prepared_by) ? `<div style="font-size:11px;color:var(--text-tertiary);padding:4px 2px">Prepared by ${esc(b.prepared_by||this.app.settings?.prepared_by)}</div>` : ''}
        </div>
      </div>`

    mc.querySelector('#bv-signedoff-toggle')?.addEventListener('click', async () => {
      b.signed_off = !b.signed_off
      b.signed_off_at = b.signed_off ? new Date().toISOString() : null
      b.signed_off_by = b.signed_off ? (this.app.appUser?.name || this.app.user?.primaryEmailAddress?.emailAddress || '') : null
      if (!b.signed_off) { b.invoiced = false; b.invoiced_at = null; b.invoiced_by = null }
      try {
        await updateBudget(this.app.userId, b.id, {
          signed_off:    b.signed_off,
          signed_off_at: b.signed_off_at,
          signed_off_by: b.signed_off_by,
          invoiced:      b.invoiced    ?? false,
          invoiced_at:   b.invoiced_at ?? null,
          invoiced_by:   b.invoiced_by ?? null,
          include_in_pipeline: b.signed_off,
        })
        const idx = this.app.budgets.findIndex(x => x.id === b.id)
        if (idx >= 0) Object.assign(this.app.budgets[idx], { signed_off: b.signed_off, signed_off_at: b.signed_off_at, signed_off_by: b.signed_off_by, invoiced: b.invoiced, invoiced_at: b.invoiced_at, invoiced_by: b.invoiced_by })
        this.app.toast(b.signed_off ? '✓ Budget signed off' : 'Sign-off removed')
        this.renderViewer(mc)
      } catch(e) { console.error(e); this.app.toast('Error updating sign-off') }
    })

    mc.querySelector('#bv-invoiced-toggle')?.addEventListener('click', async () => {
      b.invoiced = !b.invoiced
      b.invoiced_at = b.invoiced ? new Date().toISOString() : null
      b.invoiced_by = b.invoiced ? (this.app.appUser?.name || this.app.user?.primaryEmailAddress?.emailAddress || '') : null
      try {
        await updateBudget(this.app.userId, b.id, {
          invoiced:    b.invoiced    ?? false,
          invoiced_at: b.invoiced_at ?? null,
          invoiced_by: b.invoiced_by ?? null,
        })
        const idx = this.app.budgets.findIndex(x => x.id === b.id)
        if (idx >= 0) Object.assign(this.app.budgets[idx], { invoiced: b.invoiced, invoiced_at: b.invoiced_at, invoiced_by: b.invoiced_by })
        this.app.toast(b.invoiced ? '✓ Marked as invoiced' : 'Invoice status removed')
        this.renderViewer(mc)
      } catch(e) { console.error(e); this.app.toast('Error updating invoice status') }
    })

    mc.querySelector('#bv-back')?.addEventListener('click', () => {
      this.currentId = null; this.editingId = null; this.renderList(mc); this.app.updateTitle()
    })
    mc.querySelector('#bv-edit')?.addEventListener('click', () => {
      this.editingId = this.currentId; this.render(mc)
    })
    mc.querySelector('#bv-dup')?.addEventListener('click', () => this.duplicateBudget(b.id, mc))
    mc.querySelector('#bv-csv')?.addEventListener('click', () => this.exportCSV(b))
    mc.querySelector('#bv-pdf')?.addEventListener('click', () => this.exportPDF(b))
    mc.querySelector('#bv-history')?.addEventListener('click', async () => {
      const panel = mc.querySelector('#bv-history-panel')
      if (!panel) return
      if (panel.style.display !== 'none') { panel.style.display = 'none'; return }
      panel.style.display = 'block'
      panel.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary)">Loading versions…</div>'
      try {
        const versions = await getBudgetVersions(b.id)
        if (!versions.length) { panel.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary)">No versions saved yet. Open the editor and save a version.</div>'; return }
        const fmt = ts => new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) + ' ' + new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
        panel.innerHTML = `<div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Version history</div>` +
          versions.map(v => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--border-light)">
              <div style="flex:1">
                <div style="font-size:12px;font-weight:${v.is_auto?'400':'500'};color:${v.is_auto?'var(--text-tertiary)':'var(--text-primary)'}">${v.name}</div>
                <div style="font-size:10px;color:var(--text-tertiary)">${fmt(v.created_at)}</div>
              </div>
              <button class="row-btn" data-bv-restore="${v.id}" style="font-size:11px">Restore</button>
            </div>`).join('')
        panel.querySelectorAll('[data-bv-restore]').forEach(btn => {
          btn.addEventListener('click', () => this._restoreVersion(btn.dataset.bvRestore, versions, b, mc))
        })
      } catch(e) { panel.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary)">Could not load versions</div>' }
    })
  }

  // ── Editor ──────────────────────────────────────────────────────────────────

  renderEditor(mc) {
    const b = this.app.budgets.find(x => x.id === this.currentId)
    if (!b) { this.currentId = null; this.renderList(mc); return }
    const sections = Array.isArray(b.sections) ? b.sections : []
    const net = budNet(b), mu = net*((parseFloat(b.markup)||0)/100)
    const insVal = b.insurance ? net*0.025 : 0, afterFee = net+insVal+mu
    const customVal = afterFee*((parseFloat(b.custom_pct)||0)/100), afterCustom = afterFee+customVal
    const vatVal = b.vat ? afterCustom*0.2 : 0, tot = afterCustom+vatVal
    const edTr = parseFloat(b.travel_rate)||50
    const edPr = parseFloat(b.prep_rate)||100
    const activeSecs = sections.filter(s => s.enabled && secNet(s, edTr, edPr) > 0)

    mc.innerHTML = `
      <div class="bh-row">
        <button class="btn-secondary" id="back-to-list">← All budgets</button>
        <input type="text" id="be-name" value="${esc(b.name)}" style="flex:1;font-size:15px;font-weight:500;background:transparent;border:none;outline:none;border-bottom:1.5px solid transparent;padding:2px 4px;border-radius:0;color:var(--text-primary);font-family:var(--font);transition:border-color 0.15s" onfocus="this.style.borderBottomColor='var(--border-strong)'" onblur="this.style.borderBottomColor='transparent'" placeholder="Budget title" />
        <button class="btn-secondary" id="be-csv">Export CSV</button>
        <button class="btn-secondary" id="be-pdf">Export PDF</button>
        <button class="btn-primary"   id="be-save-close">Save &amp; close</button>
      </div>
      ${b.notes ? `<div style="background:var(--bg-secondary);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--text-secondary);line-height:1.6;white-space:pre-line">${esc(b.notes)}</div>` : ''}
      <div class="budget-layout">
        <div class="budget-main">
          <div class="mu-row">
            <div class="mu-field">Production fee <input type="number" id="be-markup" value="${b.markup}" min="0" max="100"> %</div>
            <div class="mu-field">Custom add-on <input type="number" id="be-custom" value="${b.custom_pct||0}" min="0"> %</div>
            <div class="mu-field">Prep rate <input type="number" id="be-preprate" value="${b.prep_rate??100}" min="0" max="100"> %</div>
            <div class="mu-field">Travel rate <input type="number" id="be-travelrate" value="${b.travel_rate??50}" min="0" max="100"> %</div>
            <div class="mu-field">Discount <input type="number" id="be-discount" value="${b.discount||0}" min="0" max="100" placeholder="0"> %</div>
            <div class="mu-field"><label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="be-vat" ${b.vat?'checked':''} style="cursor:pointer" /> VAT (20%)</label></div>
            <div class="mu-field"><label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="be-insurance" ${b.insurance?'checked':''} style="cursor:pointer" /> Insurance (2.5%)</label></div>
            <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto">Enter days to use day-rate mode per line</span>
          </div>
          <div id="be-sections">
            ${sections.map((s,si) => this.sectionHTML(b, s, si)).join('')}
          </div>
          <button class="dashed-btn" id="be-add-section" style="margin-top:12px">+ add custom section</button>
        </div>
        <div class="budget-sidebar-panel">
          <div class="bsum-card">
            <div class="bsum-head">Summary</div>
            ${activeSecs.length ? activeSecs.map(s=>`<div class="bsum-row"><span class="sk">${s.code} ${s.label.split('—')[0].split(' ').slice(0,3).join(' ').trim()}</span><span class="sv">${gbpA(secNet(s,edTr))}</span></div>`).join('') : '<div style="padding:10px 15px;font-size:12px;color:var(--text-tertiary)">No sections active</div>'}
            <div class="bsum-row" style="border-top:0.5px solid var(--border-light)"><span class="sk">Net total</span><span class="sv">${gbpA(net)}</span></div>
            ${(parseFloat(b.markup)||0)>0 ? `<div class="bsum-row"><span class="sk">Production fee (${b.markup}%)</span><span class="sv">${gbpA(mu)}</span></div>` : ''}
            ${(parseFloat(b.custom_pct)||0)>0 ? `<div class="bsum-row"><span class="sk">Add-on (${b.custom_pct}%)</span><span class="sv">${gbpA(customVal)}</span></div>` : ''}
            ${b.insurance&&insVal>0?`<div class="bsum-row"><span class="sk">Insurance (2.5%)</span><span class="sv">${gbpA(insVal)}</span></div>`:""}
            ${b.vat ? `<div class="bsum-row"><span class="sk">VAT (20%)</span><span class="sv">${gbpA(vatVal)}</span></div>` : ''}
            <div class="bsum-row grand"><span class="sk">Grand total</span><span class="sv">${gbpA(tot)}</span></div>
          </div>
          <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">
            <label style="display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--bg-secondary);border-radius:var(--radius-md);cursor:pointer;font-size:13px;color:var(--text-secondary)">
              <input type="checkbox" id="be-signedoff" ${b.signed_off?'checked':''} style="cursor:pointer;width:15px;height:15px;flex-shrink:0" />
              Signed off
              ${b.signed_off && b.signed_off_at ? `<span style="margin-left:auto;font-size:11px;color:var(--text-tertiary)">${new Date(b.signed_off_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}${b.signed_off_by?' · '+esc(b.signed_off_by):''}</span>` : ''}
            </label>
            <div>
              <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Prepared by</div>
              <input class="bl-in w" type="text" id="be-preparedby" value="${esc(b.prepared_by||this.app.settings?.prepared_by)}" placeholder="e.g. Robbie Meade" style="font-size:12px;padding:5px 8px" />
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Reply-to email</div>
              <input class="bl-in w" type="email" id="be-email" value="${esc(b.quote_email||this.app.settings?.email)}" placeholder="${esc(this.app.settings?.email||'hello@yourcompany.com')}" style="font-size:12px;padding:5px 8px" />
            </div>
            <div style="padding-top:4px;border-top:0.5px solid var(--border-light)">
              <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Version history</div>
              <div style="display:flex;gap:6px">
                <input class="bl-in w" type="text" id="be-version-name" placeholder="e.g. Sent to client" style="font-size:12px;padding:5px 8px;flex:1" />
                <button class="btn-secondary" id="be-save-version" style="font-size:11px;padding:5px 10px;white-space:nowrap">Save version</button>
              </div>
              <div id="be-version-list" style="margin-top:8px;display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto">
                <div style="font-size:11px;color:var(--text-tertiary)">Loading history…</div>
              </div>
            </div>
          </div>

          <div class="bsum-card" style="margin-top:12px">
            <div class="bsum-head">Client quote link</div>
            <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px">
              ${b.quote_token
                ? `<div style="display:flex;gap:6px">
                     <input type="text" class="bl-in w" readonly value="${location.origin}/quote/${b.quote_token}" style="font-size:11px;color:var(--text-secondary);flex:1" />
                     <button class="btn-secondary" id="be-copy-quote" style="font-size:11px;padding:4px 8px;white-space:nowrap">Copy</button>
                   </div>
                   <button class="btn-cancel" id="be-regen-quote" style="font-size:11px;width:100%">Regenerate link</button>`
                : `<button class="btn-primary" id="be-gen-quote" style="font-size:12px;width:100%">Generate client link</button>
                   <div style="font-size:11px;color:var(--text-tertiary);line-height:1.5">Share a read-only view of this quote with your client.</div>`}
            </div>
          </div>
        </div>
      </div>`

    this.bindEditor(mc, b)
  }

  sectionHTML(b, s, si) {
    const tr = parseFloat(b.travel_rate) || 50
    const pr = parseFloat(b.prep_rate)||100
    const sn = secNet(s, tr, pr)
    // All sections now use the same column layout:
    // ☐ | Item | Notes | Days | Qty | Travel | Rate | Total | ×
    // The Days and Travel cells are shown/hidden per line via the checkbox
    return `<div class="bsec-wrap" id="bsw-${si}">
      <div class="bsec-head ${s.enabled?'enabled':''}" data-toggle-open="${si}">
        <span class="bsec-code">${s.code}</span>
        <span class="bsec-name">${s.label}</span>
        <span class="bsec-amt" id="bamt-${si}">${s.enabled&&sn>0?gbpA(sn):''}</span>
        <button class="bsec-tog ${s.enabled?'on':''}" data-toggle-sec="${si}">${s.enabled?'On':'Off'}</button>
        <span class="bsec-chev ${s.open?'open':''}">▶</span>
      </div>
      <div class="bsec-body ${s.open?'open':''}">
        <table class="bl-table" style="table-layout:fixed"><colgroup>
          ${s.crew
            ? `<col style="width:20%" />
               <col style="width:6%" />`
            : `<col style="width:24%" />
               <col style="width:10%" />`}
          <col style="width:7%" />
          <col style="width:60px" />
          <col style="width:60px" />
          <col style="width:60px" />
          <col style="width:70px" />
          <col style="width:54px" />
          <col style="width:32px" />
          <col style="width:32px" />
          <col style="width:68px" />
          <col style="width:28px" />
        </colgroup><thead><tr>
          <th>Item</th>
          <th>Notes</th>
          <th class="r">Qty</th>
          <th class="r" title="Prep days">Prep</th>
          <th class="r" title="Shoot days">Shoot</th>
          <th class="r" title="Travel days">Travel</th>
          <th class="r">Rate £</th>
          <th class="r">Disc %</th>
          <th class="r" title="Daily rate">D</th>
          <th class="r" title="Track time">⏱</th>
          <th class="r">Total</th>
          <th></th>
        </tr></thead><tbody>
          ${(s.lines||[]).map((l,li) => this.lineHTML(si, li, l, tr, pr)).join('')}
          <tr class="sub">
            <td colspan="9" style="text-align:right;color:var(--text-secondary);font-size:11px;padding-right:8px">Section total</td>
            <td style="text-align:right" id="bst-${si}">${gbpA(sn)}</td><td></td>
          </tr>
        </tbody></table>
        <button class="add-line" data-add-line="${si}">+ add line item</button>
      </div>
    </div>`
  }

  lineHTML(si, li, l, travelRate, prepRate) {
    const t = lineTotal(l, travelRate, prepRate)
    const disc = l.discount != null ? l.discount : ''
    const useDays = l.useDays || (parseFloat(l.prepDays)||0) > 0 || (parseFloat(l.days)||0) > 0 || (parseFloat(l.travelDays)||0) > 0
    const showTot = t > 0 || (parseFloat(l.discount)||0) >= 100
    return `<tr id="bl-${si}-${li}">
      <td><input class="bl-in w" value="${esc(l.item)}" placeholder="Item" data-field="${si},${li},item" /></td>
      <td><input class="bl-in w" value="${esc(l.notes||'')}" placeholder="Notes" data-field="${si},${li},notes" /></td>
      <td><input class="bl-in w" type="number" value="${l.qty??0}" placeholder="0" min="0" data-num="${si},${li},qty" style="text-align:right" /></td>
      <td style="${useDays?'':'opacity:0.3;pointer-events:none'}"><input class="bl-in w" type="number" value="${l.prepDays||''}" placeholder="0" min="0" step="0.5" data-num="${si},${li},prepDays" style="text-align:right" title="Prep days" /></td>
      <td style="${useDays?'':'opacity:0.3;pointer-events:none'}"><input class="bl-in w" type="number" value="${l.days||''}" placeholder="0" min="0" step="0.5" data-num="${si},${li},days" style="text-align:right" title="Shoot days" /></td>
      <td style="${useDays?'':'opacity:0.3;pointer-events:none'}"><input class="bl-in w" type="number" value="${l.travelDays||''}" placeholder="0" min="0" step="0.5" data-num="${si},${li},travelDays" style="text-align:right" title="Travel days" /></td>
      <td><input class="bl-in w" type="number" value="${l.rate||''}" placeholder="0" min="0" data-num="${si},${li},rate" style="text-align:right" /></td>
      <td><input class="bl-in w" type="number" value="${disc}" placeholder="0" min="0" max="100" step="0.5" data-num="${si},${li},discount" style="text-align:right" title="Discount %" /></td>
      <td style="text-align:center;padding:4px 6px" title="Daily rate">
        <input type="checkbox" ${useDays?'checked':''} data-toggle-days="${si},${li}" style="cursor:pointer;width:13px;height:13px" />
      </td>
      <td style="text-align:center;padding:4px 6px">
        <input type="checkbox" title="Track time" ${l.track_time?'checked':''} data-toggle-track="${si},${li}" style="cursor:pointer;width:13px;height:13px" />
      </td>
      <td class="bl-tot ${showTot?'nz':''}" id="blt-${si}-${li}">${showTot?gbpA(t):'—'}</td>
      <td style="text-align:right"><button class="row-btn" style="color:#c03020" data-rem-line="${si},${li}">×</button></td>
    </tr>`
  }

  bindEditor(mc, b) {
    const sections = b.sections
    const save = () => this.saveField(b)
    const refreshSummary = () => {
      const rsTr = parseFloat(b.travel_rate)||50
      const rsPr = parseFloat(b.prep_rate)||100
      const net = budNet(b), mu = net*((parseFloat(b.markup)||0)/100)
      const insVal = b.insurance ? net*0.025 : 0, afterFee = net+insVal+mu
      const customVal = afterFee*((parseFloat(b.custom_pct)||0)/100), afterCustom = afterFee+customVal
    const vatVal = b.vat ? afterCustom*0.2 : 0, tot = afterCustom+vatVal
      const card = mc.querySelector('.bsum-card')
      if (!card) return
      const activeSecs = sections.filter(s => s.enabled && secNet(s, rsTr, rsPr) > 0)
      card.innerHTML = `
        <div class="bsum-head">Summary</div>
        ${activeSecs.length ? activeSecs.map(s=>`<div class="bsum-row"><span class="sk">${s.code} ${s.label.split('—')[0].split(' ').slice(0,3).join(' ').trim()}</span><span class="sv">${gbpA(secNet(s,rsTr))}</span></div>`).join('') : '<div style="padding:10px 15px;font-size:12px;color:var(--text-tertiary)">No sections active</div>'}
        <div class="bsum-row" style="border-top:0.5px solid var(--border-light)"><span class="sk">Net total</span><span class="sv">${gbpA(net)}</span></div>
        ${(parseFloat(b.markup)||0)>0?`<div class="bsum-row"><span class="sk">Production fee (${b.markup}%)</span><span class="sv">${gbpA(mu)}</span></div>`:''}
        ${(parseFloat(b.custom_pct)||0)>0?`<div class="bsum-row"><span class="sk">Add-on (${b.custom_pct}%)</span><span class="sv">${gbpA(customVal)}</span></div>`:''}
        ${b.insurance&&insVal>0?`<div class="bsum-row"><span class="sk">Insurance (2.5%)</span><span class="sv">${gbpA(insVal)}</span></div>`:""}
            ${b.vat?`<div class="bsum-row"><span class="sk">VAT (20%)</span><span class="sv">${gbpA(vatVal)}</span></div>`:''}
        <div class="bsum-row grand"><span class="sk">Grand total</span><span class="sv">${gbpA(tot)}</span></div>`
    }

    mc.querySelector('#back-to-list')?.addEventListener('click', () => { this.currentId = null; this.editingId = null; this.renderList(mc); this.app.updateTitle() })
    mc.querySelector('#be-save-close')?.addEventListener('click', () => { this.editingId = null; this.render(mc); this.app.updateTitle() })
    mc.querySelector('#be-name')?.addEventListener('change', e => {
      const val = e.target.value.trim()
      if (!val) { e.target.value = b.name; return }
      b.name = val; save()
      this.app.updateTitle()
    })
    mc.querySelector('#be-markup')?.addEventListener('change', e => { b.markup = parseFloat(e.target.value)||0; save(); refreshSummary() })
    mc.querySelector('#be-custom')?.addEventListener('change', e => { b.custom_pct = parseFloat(e.target.value)||0; save(); refreshSummary() })
    mc.querySelector('#be-travelrate')?.addEventListener('change', e => { b.travel_rate = parseFloat(e.target.value)??50; save(); this.renderEditor(mc) })
    mc.querySelector('#be-preprate')?.addEventListener('change',  e => { b.prep_rate  = parseFloat(e.target.value)??100; save(); this.renderEditor(mc) })
    mc.querySelector('#be-discount')?.addEventListener('change', e => {
      const pct = Math.min(Math.max(parseFloat(e.target.value)||0, 0), 100)
      b.discount = pct
      // Autofill all line discount fields with the master value
      sections.forEach(s => s.lines.forEach(l => { l.discount = pct }))
      save(); this.renderEditor(mc)
    })
    mc.querySelector('#be-vat')?.addEventListener('change',       e => { b.vat       = e.target.checked; save(); refreshSummary() })
    mc.querySelector('#be-insurance')?.addEventListener('change', e => { b.insurance = e.target.checked; save(); refreshSummary() })
    mc.querySelector('#be-signedoff')?.addEventListener('change', e => {
      b.signed_off = e.target.checked
      if (e.target.checked) {
        b.signed_off_at = new Date().toISOString()
        b.signed_off_by = this.app.appUser?.name || this.app.user?.primaryEmailAddress?.emailAddress || ''
      } else {
        b.signed_off_at = null
        b.signed_off_by = null
      }
      save(); this.renderEditor(mc)
    })
    mc.querySelector('#be-preparedby')?.addEventListener('change', e => { b.prepared_by = e.target.value; save() })
    mc.querySelector('#be-email')?.addEventListener('change',      e => { b.quote_email = e.target.value; save() })

    // Version history
    this._loadVersionList(mc, b)
    mc.querySelector('#be-save-version')?.addEventListener('click', async () => {
      const nameEl = mc.querySelector('#be-version-name')
      const name = nameEl?.value.trim() || 'Unnamed version'
      try {
        const snapshot = {
          name: b.name, markup: b.markup, custom_pct: b.custom_pct, vat: b.vat,
          travel_rate: b.travel_rate??50, discount: b.discount??0,
          sections: b.sections, prepared_by: b.prepared_by, quote_email: b.quote_email, notes: b.notes,
        }
        await saveBudgetVersion(this.app.userId, b.id, snapshot, name, false)
        if (nameEl) nameEl.value = ''
        this._loadVersionList(mc, b)
        this.app.toast(`Version "${name}" saved`)
      } catch(e) { console.error(e); this.app.toast('Error saving version') }
    })
    mc.querySelector('#be-csv')?.addEventListener('click', () => this.exportCSV(b))
    mc.querySelector('#be-pdf')?.addEventListener('click', () => this.exportPDF(b))

    // Quote link
    const genQuote = async () => {
      const token = crypto.randomUUID().replace(/-/g,'').slice(0,24)
      const { setQuoteToken } = await import('../db/client.js')
      await setQuoteToken(this.app.userId, b.id, token)
      b.quote_token = token
      const idx = this.app.budgets.findIndex(x => x.id === b.id)
      if (idx >= 0) this.app.budgets[idx].quote_token = token
      this.renderEditor(mc)
    }
    mc.querySelector('#be-gen-quote')?.addEventListener('click', genQuote)
    mc.querySelector('#be-regen-quote')?.addEventListener('click', async () => {
      if (!confirm('Regenerate quote link? The old link will stop working.')) return
      await genQuote()
    })
    mc.querySelector('#be-copy-quote')?.addEventListener('click', async e => {
      await navigator.clipboard.writeText(`${location.origin}/quote/${b.quote_token}`)
      const btn = e.target; btn.textContent = '✓'; setTimeout(() => btn.textContent = 'Copy', 1500)
    })
    mc.querySelector('#be-add-section')?.addEventListener('click', () => {
      const label = prompt('Section name:')
      if (!label) return
      sections.push({ code: 'X', label, enabled: true, open: true, lines: [{ item: '', notes: '', days: 0, qty: 0, rate: null }] })
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

    // Per-line track time toggle
    mc.querySelectorAll('[data-toggle-days]').forEach(el => {
      el.addEventListener('change', () => {
        const [si, li] = el.dataset.toggleDays.split(',').map(Number)
        const l = sections[si].lines[li]
        l.useDays = el.checked
        if (!el.checked) { l.prepDays = 0; l.days = 0; l.travelDays = 0 }
        save()
        this.renderEditor(mc)
      })
    })

    mc.querySelectorAll('[data-toggle-track]').forEach(el => {
      el.addEventListener('change', () => {
        const [si, li] = el.dataset.toggleTrack.split(',').map(Number)
        sections[si].lines[li].track_time = el.checked
        save()
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

    // Numeric inputs — update totals live on input, save on change
    const updateLineTotal = (el) => {
      const [si,li,field] = el.dataset.num.split(',')
      const s = sections[+si]; const l = s.lines[+li]
      const val = parseFloat(el.value)
      if (isNaN(val)) return  // don't update mid-typing (e.g. "-" or ".")
      l[field] = val || 0
      const tr = parseFloat(b.travel_rate)||50
      const pr = parseFloat(b.prep_rate)||100
      const t = lineTotal(l, tr, pr)
      const ltEl = mc.querySelector(`#blt-${si}-${li}`)
      const showZero = t>0||(parseFloat(l.discount)||0)>=100; if (ltEl) { ltEl.textContent = showZero?gbpA(t):'—'; ltEl.className = 'bl-tot'+(showZero?' nz':'') }
      const stEl = mc.querySelector(`#bst-${si}`)
      if (stEl) stEl.textContent = gbpA(secNet(s, tr))
      const amtEl = mc.querySelector(`#bamt-${si}`)
      if (amtEl) amtEl.textContent = s.enabled&&secNet(s,tr)>0?gbpA(secNet(s,tr)):''
      refreshSummary()
    }

    mc.querySelectorAll('[data-num]').forEach(el => {
      // Live update on every keystroke
      el.addEventListener('input', () => updateLineTotal(el))
      // Full save + auto-enable logic on blur/change
      el.addEventListener('change', () => {
        const [si,li,field] = el.dataset.num.split(',')
        const s = sections[+si]; const l = s.lines[+li]
        l[field] = parseFloat(el.value) || 0
        // Auto-enable section when a meaningful value is entered
        if (!s.enabled) {
          const triggers = (field === 'days' && l.days > 0)
            || ((field === 'qty' || field === 'rate') && (parseFloat(l.qty)||0) > 0 && (parseFloat(l.rate)||0) > 0)
          if (triggers) {
            s.enabled = true; s.open = true
            mc.querySelector(`#bsw-${si} .bsec-head`)?.classList.add('enabled')
            const tog = mc.querySelector(`#bsw-${si} .bsec-tog`)
            if (tog) { tog.classList.add('on'); tog.textContent = 'On' }
          }
        }
        const tr = parseFloat(b.travel_rate)||50
        const pr = parseFloat(b.prep_rate)||100
        const t = lineTotal(l, tr, pr)
        const ltEl = mc.querySelector(`#blt-${si}-${li}`)
        const showZero = t>0||(parseFloat(l.discount)||0)>=100; if (ltEl) { ltEl.textContent = showZero?gbpA(t):'—'; ltEl.className = 'bl-tot'+(showZero?' nz':'') }
        const stEl = mc.querySelector(`#bst-${si}`)
        if (stEl) stEl.textContent = gbpA(secNet(s, tr))
        const amtEl = mc.querySelector(`#bamt-${si}`)
        if (amtEl) amtEl.textContent = s.enabled&&secNet(s,tr)>0?gbpA(secNet(s,tr)):''
        refreshSummary()
        save()
      })
    })

    // Add line — crew sections default to days-based
    mc.querySelectorAll('[data-add-line]').forEach(btn => {
      btn.addEventListener('click', () => {
        const si = +btn.dataset.addLine
        const defaultDays = !!sections[si].crew
        sections[si].lines.push({ item:'', notes:'', qty:0, rate:null, prepDays:0, days:0, travelDays:0, useDays:false, track_time:false })
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

  async _loadVersionList(mc, b) {
    const listEl = mc.querySelector('#be-version-list')
    if (!listEl) return
    try {
      const versions = await getBudgetVersions(b.id)
      if (!versions.length) {
        listEl.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary)">No versions saved yet</div>'
        return
      }
      const fmt = ts => {
        const d = new Date(ts)
        return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) + ' ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
      }
      listEl.innerHTML = versions.map(v => `
        <div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:0.5px solid var(--border-light)" data-vid="${v.id}">
          <div style="flex:1;min-width:0">
            <div style="font-size:11px;font-weight:${v.is_auto?'400':'500'};color:${v.is_auto?'var(--text-tertiary)':'var(--text-secondary)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.name}</div>
            <div style="font-size:10px;color:var(--text-tertiary)">${fmt(v.created_at)}</div>
          </div>
          <button class="row-btn" data-restore="${v.id}" title="Restore this version" style="font-size:10px;flex-shrink:0">Restore</button>
          <button class="row-btn" data-del-ver="${v.id}" style="font-size:10px;color:#b03020;flex-shrink:0">×</button>
        </div>`).join('')

      listEl.querySelectorAll('[data-restore]').forEach(btn => {
        btn.addEventListener('click', () => this._restoreVersion(btn.dataset.restore, versions, b, mc))
      })
      listEl.querySelectorAll('[data-del-ver]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this version?')) return
          await deleteBudgetVersion(btn.dataset.delVer)
          this._loadVersionList(mc, b)
        })
      })
    } catch(e) { console.error(e); listEl.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary)">Could not load history</div>' }
  }

  async _restoreVersion(versionId, versions, b, mc) {
    const v = versions.find(x => x.id === versionId)
    if (!v || !confirm(`Restore "${v.name}"? This will overwrite the current budget. A snapshot of the current state will be saved first.`)) return
    try {
      // Save current state as auto-snapshot before overwriting
      const currentSnap = {
        name: b.name, markup: b.markup, custom_pct: b.custom_pct, vat: b.vat,
        travel_rate: b.travel_rate??50, discount: b.discount??0,
        sections: b.sections, prepared_by: b.prepared_by, quote_email: b.quote_email, notes: b.notes,
      }
      await saveBudgetVersion(this.app.userId, b.id, currentSnap, 'Before restore', true)
      // Apply snapshot
      const snap = v.snapshot
      Object.assign(b, snap)
      await updateBudget(this.app.userId, b.id, snap)
      const idx = this.app.budgets.findIndex(x => x.id === b.id)
      if (idx >= 0) this.app.budgets[idx] = { ...this.app.budgets[idx], ...snap }
      this.renderEditor(mc)
      this.app.toast(`Restored to "${v.name}"`)
    } catch(e) { console.error(e); this.app.toast('Restore failed') }
  }

  async saveField(b) {
    try {
      const data = {
        name: b.name,
        markup: b.markup, custom_pct: b.custom_pct, vat: b.vat, insurance: b.insurance ?? false,
        travel_rate: b.travel_rate ?? 50, prep_rate: b.prep_rate ?? 100, discount: b.discount ?? 0,
        signed_off: b.signed_off ?? false,
        signed_off_at: b.signed_off_at ?? null,
        signed_off_by: b.signed_off_by ?? null,
        sections: b.sections, prepared_by: b.prepared_by, quote_email: b.quote_email,
        notes: b.notes, include_in_pipeline: b.signed_off ?? false,  // keep in sync for dashboard
      }
      const [updated] = await updateBudget(this.app.userId, b.id, data)
      const idx = this.app.budgets.findIndex(x => x.id === b.id)
      if (idx >= 0) this.app.budgets[idx] = { ...this.app.budgets[idx], ...updated }
      // Auto-snapshot (throttled — max one per 30s to avoid flood on rapid edits)
      const now = Date.now()
      if (!b._lastAutoSnap || now - b._lastAutoSnap > 30000) {
        b._lastAutoSnap = now
        saveBudgetVersion(this.app.userId, b.id, data, 'Auto-save', true).catch(console.error)
      }
    } catch (e) { console.error('Budget save failed:', e) }
  }

  // ── CSV Export ──────────────────────────────────────────────────────────────

  exportCSV(b) {
    const cl = this.app.contacts.find(c => c.id === b.client_id)
    const net = budNet(b), mu = net*((parseFloat(b.markup)||0)/100)
    const insVal = b.insurance ? net*0.025 : 0, afterFee = net+insVal+mu
    const customVal = afterFee*((parseFloat(b.custom_pct)||0)/100), afterCustom = afterFee+customVal
    const vatVal = b.vat ? afterCustom*0.2 : 0
    const tot = afterCustom + vatVal
    const pr = parseFloat(b.prep_rate)||100
    let rows = [
      ['Budget',b.name],['Client',cl?cl.first_name+' '+cl.last_name:''],
      ['Production fee %',b.markup],['Custom add-on %',b.custom_pct||0],['Travel rate %',b.travel_rate??50],['Master discount %',b.discount||0],['VAT',b.vat?'Yes':'No'],[''],
      ['Section','Item','Notes','Prep Days','Shoot Days','Qty','Travel Days','Rate (£)','Discount %','Total (£)']
    ]
    const tr = parseFloat(b.travel_rate)||50
    ;(b.sections||[]).filter(s=>s.enabled).forEach(s => {
      const al = (s.lines||[]).filter(l => hasVisibleValue(l))
      if (!al.length) return
      al.forEach(l => {
        const pDays = parseFloat(l.prepDays)||0, sDays = parseFloat(l.days)||0, tDays = parseFloat(l.travelDays)||0
        const useDays = pDays > 0 || sDays > 0 || tDays > 0
        rows.push([s.code+' — '+s.label, l.item, l.notes||'', useDays?pDays:'N/A', useDays?sDays:'N/A', l.qty??0, useDays?tDays:'N/A', l.rate||0, l.discount||0, Math.round(lineTotal(l,tr,pr))])
      })
      rows.push([s.code+' SUBTOTAL','','','','','','','','',Math.round(secNet(s,tr,pr))]); rows.push([])
    })
    rows.push(['NET TOTAL','','','','','','','',Math.round(net)])
    if ((parseFloat(b.markup)||0)>0)     rows.push(['PRODUCTION FEE ('+b.markup+'%)','','','','','','','',Math.round(mu)])
    if ((parseFloat(b.custom_pct)||0)>0) rows.push(['CUSTOM ADD-ON ('+b.custom_pct+'%)','','','','','','','',Math.round(customVal)])
    if (b.vat)                           rows.push(['VAT (20%)','','','','','','','',Math.round(vatVal)])
    if (b.insurance && insVal > 0) rows.push(['INSURANCE (2.5%)','','','','','','','',Math.round(insVal)])
    rows.push(['GRAND TOTAL','','','','','','','',Math.round(tot)])
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
    const pdfTr = parseFloat(b.travel_rate)||50
    const pdfPr = parseFloat(b.prep_rate)||100
    const net = budNet(b), mu = net*((parseFloat(b.markup)||0)/100)
    const insVal = b.insurance ? net*0.025 : 0, afterFee = net+insVal+mu
    const customVal = afterFee*((parseFloat(b.custom_pct)||0)/100), afterCustom = afterFee+customVal
    const vatVal = b.vat ? afterCustom*0.2 : 0, tot = afterCustom+vatVal
    const today = new Date()
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const dateStr = today.getDate()+' '+months[today.getMonth()]+' '+today.getFullYear()
    const validDate = new Date(today); validDate.setDate(validDate.getDate()+30)
    const validStr = validDate.getDate()+' '+months[validDate.getMonth()]+' '+validDate.getFullYear()
    const activeSecs = (b.sections||[]).filter(s => s.enabled && (s.lines||[]).some(l => hasVisibleValue(l)))
    const LOGO_WHITE = '/slate-logo-white.png'
    const LOGO_BLACK = '/slate-logo.png'

    const coverHTML = `
      <div class="pdf-cover">
        <div class="pdf-logo"><img src="${LOGO_WHITE}" alt="Slate" /></div>
        <div class="pdf-cover-body">
          <div class="pdf-quote-label">Quote</div>
          <div class="pdf-budget-title">${esc(b.name)}</div>
          <div class="pdf-client-name">${cl?'Prepared for '+esc(cl.first_name)+' '+esc(cl.last_name)+', '+esc(cl.company):''}</div>
          ${b.notes?`<div style="font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:28px;line-height:1.6">${esc(b.notes).replace(/\n/g,'<br>')}</div>`:''}
          <hr class="pdf-cover-divider" />
          <table class="pdf-cover-summary"><tbody>
            ${activeSecs.map(sec=>`<tr><td class="sec-code">${sec.code}</td><td class="sec-name">${sec.label}</td><td class="sec-total">${gbpA(secNet(sec,pdfTr,pdfPr))}</td></tr>`).join('')}
          </tbody></table>
          <div class="pdf-cover-totals">
            <div class="pdf-cover-total-row"><span class="tk">Net total</span><span class="tv">${gbpA(net)}</span></div>
            ${(parseFloat(b.markup)||0)>0?`<div class="pdf-cover-total-row"><span class="tk">Production fee (${b.markup}%)</span><span class="tv">${gbpA(mu)}</span></div>`:''}
            ${(parseFloat(b.custom_pct)||0)>0?`<div class="pdf-cover-total-row"><span class="tk">Add-on (${b.custom_pct}%)</span><span class="tv">${gbpA(customVal)}</span></div>`:''}
            ${b.insurance&&insVal>0?`<div class="pdf-cover-total-row"><span class="tk">Insurance (2.5%)</span><span class="tv">${gbpA(insVal)}</span></div>`:""}
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
      const al = (sec.lines||[]).filter(l => hasVisibleValue(l))
      if (!al.length) return
      detailSecHTML += `
        <div class="pdf-section">
          <div class="pdf-section-header">
            <span class="pdf-section-code">${sec.code}</span>
            <span class="pdf-section-name">${sec.label}</span>
            <span class="pdf-section-total">${gbpA(secNet(sec,pdfTr,pdfPr))}</span>
          </div>
          <div class="pdf-col-heads">
            <div class="pdf-col-head" style="text-align:left">Item</div>
            <div class="pdf-col-head">Days</div><div class="pdf-col-head">Qty</div>
            <div class="pdf-col-head">Travel / Rate</div>
            <div class="pdf-col-head">Total</div>
          </div>
          ${al.map(l => {
            const prep=parseFloat(l.prepDays)||0,d=parseFloat(l.days)||0,q=parseFloat(l.qty)||0,r=parseFloat(l.rate)||0,td=parseFloat(l.travelDays)||0
            const useDaysPDF = l.useDays || prep>0||d>0||td>0
            const t=lineTotal(l,pdfTr,pdfPr)
            const disc = parseFloat(l.discount)||0
            return `<div class="pdf-line">
              <div class="pdf-line-item">${esc(l.item)}${l.notes?`<div class="pdf-line-sub">${esc(l.notes)}</div>`:''}${useDaysPDF&&prep>0?`<div class="pdf-line-sub">Prep: ${prep}d @ ${pdfPr}%</div>`:''}${useDaysPDF&&td>0?`<div class="pdf-line-sub">Travel: ${td}d @ ${pdfTr}%</div>`:''}${disc>0?`<div class="pdf-line-sub">Discount: ${disc}%</div>`:''}</div>
              <div class="pdf-line-num">${useDaysPDF&&(prep>0||d>0)?(prep+d)+'d':''}</div>
              <div class="pdf-line-num">${useDaysPDF?(q!==1?q:''):q}</div>
              <div class="pdf-line-num">${useDaysPDF&&prep>0?gbpA(r*prep*q*(pdfPr/100)):''} ${useDaysPDF&&td>0?gbpA(r*td*(pdfTr/100)):(r>0?gbpA(r):'')}</div>
              <div class="pdf-line-total">${disc>=100?gbpA(0):t>0?gbpA(t):''}</div>
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
          <img src="${LOGO_BLACK}" alt="Slate" />
        </div>
        ${detailSecHTML}
        <div class="pdf-detail-totals">
          <div class="pdf-detail-total-row"><span class="dk">Net total</span><span>${gbpA(net)}</span></div>
          ${(parseFloat(b.markup)||0)>0?`<div class="pdf-detail-total-row"><span class="dk">Production fee (${b.markup}%)</span><span>${gbpA(mu)}</span></div>`:''}
          ${(parseFloat(b.custom_pct)||0)>0?`<div class="pdf-detail-total-row"><span class="dk">Add-on (${b.custom_pct}%)</span><span>${gbpA(customVal)}</span></div>`:''}
          ${b.insurance&&insVal>0?`<div class="pdf-detail-total-row"><span class="dk">Insurance (2.5%)</span><span>${gbpA(insVal)}</span></div>`:""}
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
