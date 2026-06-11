import {
  getCallSheetsForProject, getCallSheet, createCallSheet, updateCallSheet,
  deleteCallSheet, saveCallSheetCrew, saveCallSheetSchedule, saveCallSheetLocations
} from '../db/client.js'
import { continuationScript, PDF_CONTINUED_CSS, a4ContentWidthPx, a4ContentHeightPx } from '../utils/pdfContinuation.js'

const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
const fmtDate = s => {
  if (!s) return ''
  const d = new Date(s+'T12:00:00')
  return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
}

export class CallSheetsView {
  constructor(app) {
    this.app = app
    this.currentProjectId = null
    this.currentSheetId   = null
    this.sheet            = null  // loaded full sheet data
  }

  async renderList(mc, projectId) {
    this.currentProjectId = projectId
    this.currentSheetId   = null
    this.sheet            = null
    const project = this.app.projects.find(p => p.id === projectId)
    mc.innerHTML = `<div style="padding:20px"><div style="font-size:12px;color:var(--text-tertiary)">Loading call sheets…</div></div>`
    let sheets = []
    try { sheets = await getCallSheetsForProject(projectId) } catch(e) { console.error(e) }

    mc.innerHTML = `
      <div class="bh-row">
        <button class="btn-secondary" id="cs-back">← Back to project</button>
        <h2 style="flex:1;font-size:15px;font-weight:500">Call Sheets — ${esc(project?.name||'')}</h2>
        <button class="btn-primary" id="cs-new">+ New call sheet</button>
      </div>
      <div style="max-width:700px;margin-top:16px">
        ${sheets.length ? sheets.map(s => `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-secondary);border:0.5px solid var(--border-light);border-radius:var(--radius-md);margin-bottom:8px;cursor:pointer" data-cs-open="${s.id}">
            <div style="flex:1">
              <div style="font-size:14px;font-weight:500">${fmtDate(s.sheet_date)}</div>
              <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">
                ${s.general_call ? `General call ${esc(s.general_call)} · ` : ''}
                ${s.location_name ? esc(s.location_name) : 'No location set'}
              </div>
            </div>
            <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:${s.status==='sent'?'rgba(110,201,110,0.15)':'var(--bg-secondary)'};color:${s.status==='sent'?'#6ec96e':'var(--text-tertiary)'};border:0.5px solid ${s.status==='sent'?'rgba(110,201,110,0.3)':'var(--border-med)'}">
              ${s.status==='sent'?'Sent':'Draft'}
            </span>
          </div>`).join('')
        : `<div style="padding:40px;text-align:center;color:var(--text-tertiary);font-size:13px">No call sheets yet — create one for each shoot day.</div>`}
      </div>`

    mc.querySelector('#cs-back')?.addEventListener('click', () => {
      this.app.projectsView.currentId = projectId
      this.app.currentView = 'projects'
      this.app.render()
    })
    mc.querySelector('#cs-new')?.addEventListener('click', () => this.openNew(mc, projectId))
    mc.querySelectorAll('[data-cs-open]').forEach(el => {
      el.addEventListener('click', () => this.openEditor(mc, el.dataset.csOpen))
    })
  }

  async openNew(mc, projectId) {
    const project = this.app.projects.find(p => p.id === projectId)
    // Default date to project shoot_start or today
    const defaultDate = project?.shoot_start || new Date().toISOString().split('T')[0]
    try {
      const sheet = await createCallSheet(this.app.userId, projectId, { sheet_date: defaultDate })
      // Pre-populate crew from project
      // Pull crew with their types from the project
      const crew = (project?.crew||[]).filter(c => c.name).map((c, i) => ({
        name: c.name, role: c.role||'', phone: '', call_time: '',
        crew_type: c.crew_type||'crew', sort_order: i
      }))
      if (crew.length) await saveCallSheetCrew(sheet.id, crew)
      // Pull location data from project
      if (project?.location || project?.location_address) {
        await updateCallSheet(sheet.id, {
          sheet_date: sheet.sheet_date, status: 'draft',
          general_call: null,
          location_name: project.location || null,
          location_address: project.location_address || null,
          location_map_link: project.location_map_link || null,
          parking_notes: project.parking_notes || null,
          nearest_transport: project.nearest_transport || null,
          nearest_hospital_name:    project.nearest_hospital_name || null,
          nearest_hospital_address: project.nearest_hospital_address || null,
          nearest_police_name:      project.nearest_police_name || null,
          nearest_police_address:   project.nearest_police_address || null,
          nearest_fire_name:        project.nearest_fire_name || null,
          nearest_fire_address:     project.nearest_fire_address || null,
          hotels:                   project.hotels?.length ? JSON.parse(JSON.stringify(project.hotels)) : [],
        })
      }
      await this.openEditor(mc, sheet.id)
    } catch(e) { console.error(e); this.app.toast('Error creating call sheet') }
  }

  async openEditor(mc, sheetId) {
    this.currentSheetId = sheetId
    mc.innerHTML = `<div style="padding:20px;color:var(--text-tertiary)">Loading…</div>`
    try {
      this.sheet = await getCallSheet(sheetId)
      this.renderEditor(mc)
    } catch(e) { console.error(e); this.app.toast('Error loading call sheet') }
  }

  renderEditor(mc) {
    const s = this.sheet
    if (!s) return
    // Abort any previous bindEditor listeners attached to mc
    if (this._editorAbort) this._editorAbort.abort()
    this._editorAbort = new AbortController()
    const project = this.app.projects.find(p => p.id === s.project_id)
    const origin = location.origin

    mc.innerHTML = `
      <div class="bh-row" style="flex-wrap:wrap;gap:8px">
        <button class="btn-secondary" id="cs-back-list">← All call sheets</button>
        <h2 style="flex:1;font-size:15px;font-weight:500;min-width:200px">${fmtDate(s.sheet_date)||'New call sheet'}</h2>
        <span id="cs-save-indicator" style="font-size:11px;color:var(--text-tertiary)">—</span>
        <span id="cs-status-badge" style="font-size:11px;padding:4px 12px;border-radius:20px;cursor:pointer;background:${s.status==='sent'?'rgba(110,201,110,0.15)':'var(--bg-secondary)'};color:${s.status==='sent'?'#6ec96e':'var(--text-tertiary)'};border:0.5px solid ${s.status==='sent'?'rgba(110,201,110,0.3)':'var(--border-med)'}">
          ${s.status==='sent'?'✓ Sent':'Draft'} — click to toggle
        </span>
        <button class="btn-secondary" id="cs-dup">Duplicate for next day</button>
        <button class="btn-secondary" id="cs-pdf">Export PDF</button>
        <button class="btn-secondary" id="cs-copy-all">Copy all call times</button>
        <button class="row-btn" id="cs-delete" style="color:#b03020;border-color:rgba(180,50,30,0.2)">Delete</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 280px;gap:16px;margin-top:16px;align-items:flex-start;min-height:0">

        <!-- Main column -->
        <div style="display:flex;flex-direction:column;gap:16px">

          <!-- Header info -->
          <div class="proj-panel">
            <div class="cs-panel-head"><span class="bsec-chev open">▶</span> Sheet details</div>
            <div class="cs-panel-body proj-panel-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <div class="proj-field-label">Shoot date</div>
                <input type="date" class="proj-input" id="cs-date" value="${s.sheet_date||''}" />
              </div>
              <div>
                <div class="proj-field-label">General call time</div>
                <input type="time" class="proj-input" id="cs-general-call" value="${s.general_call||''}" />
              </div>
            </div>
          </div>

          <!-- Location -->
          <div class="proj-panel">
            <div class="cs-panel-head"><span class="bsec-chev open">▶</span> Primary location</div>
            <div class="cs-panel-body proj-panel-body" style="display:flex;flex-direction:column;gap:10px">
              <div>
                <div class="proj-field-label">Location name</div>
                <input type="text" class="proj-input" id="cs-loc-name" value="${esc(s.location_name||'')}" placeholder="e.g. Bwlch Farm, Eastnor Castle" />
              </div>
              <div>
                <div class="proj-field-label">Address or Maps link <span style="font-weight:400;color:var(--text-tertiary)">— paste a full address, or a Google Maps / dropped pin URL</span></div>
                <input type="text" class="proj-input" id="cs-loc-addr" value="${esc(s.location_address||s.location_map_link||'')}" placeholder="Full address or paste a Google Maps URL" />
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <div>
                  <div class="proj-field-label">Parking</div>
                  <input type="text" class="proj-input" id="cs-parking" value="${esc(s.parking_notes||'')}" placeholder="e.g. On-site car park, enter via main gate" />
                </div>
                <div>
                  <div class="proj-field-label">Nearest public transport</div>
                  <input type="text" class="proj-input" id="cs-transport" value="${esc(s.nearest_transport||'')}" placeholder="e.g. Ledbury station, 2 miles" />
                </div>
              </div>
              <div style="display:flex;gap:8px;align-items:flex-end">
                <div style="flex:1">
                  <div class="proj-field-label">Weather</div>
                  <input type="text" class="proj-input" id="cs-weather" value="${esc(s.weather_text||'')}" placeholder="e.g. 12°C, partly cloudy, light winds" />
                </div>
                <button class="btn-secondary" id="cs-fetch-weather" style="white-space:nowrap;font-size:12px" title="Fetch forecast for this date and location">🌤 Fetch</button>
              </div>
            </div>
          </div>

          <!-- Emergency services -->
          <div class="proj-panel">
            <div class="cs-panel-head"><span class="bsec-chev open">▶</span> Emergency services
              <button id="cs-find-nearby" class="btn-secondary" style="margin-left:auto;font-size:11px;padding:4px 10px">📍 Find nearby</button>
            </div>
            <div class="cs-panel-body proj-panel-body" style="display:flex;flex-direction:column;gap:12px">
              ${[
                ['Hospital','cs-hosp','nearest_hospital'],
                ['Police','cs-police','nearest_police'],
                ['Fire station','cs-fire','nearest_fire'],
              ].map(([label,id,key]) => `
              <div>
                <div class="proj-field-label" style="color:var(--text-secondary);margin-bottom:6px">${label}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
                  <input type="text" class="proj-input" id="${id}-name" value="${esc(s[key+'_name']||'')}" placeholder="Name" />
                  <input type="text" class="proj-input" id="${id}-addr" value="${esc(s[key+'_address']||'')}" placeholder="Address" />
                  <input type="text" class="proj-input" id="${id}-phone" value="${esc(s[key+'_phone']||'')}" placeholder="Phone" />
                </div>
              </div>`).join('')}
            </div>
          </div>

          <!-- Additional locations -->
          <div class="proj-panel">
            <div class="cs-panel-head"><span class="bsec-chev open">▶</span> Additional locations</div>
            <div class="cs-panel-body" id="cs-extra-locs" style="padding:0 14px">
              ${s.locations.length ? s.locations.map((l,i) => this.locationRowHTML(l,i)).join('') :
                '<div style="padding:10px 0;font-size:12px;color:var(--text-tertiary)">No additional locations</div>'}
            </div>
            <button class="add-line" id="cs-add-loc">+ add location</button>
          </div>

          <!-- Schedule -->
          <div class="proj-panel">
            <div class="cs-panel-head"><span class="bsec-chev open">▶</span> Schedule</div>
            <div class="cs-panel-body" id="cs-schedule" style="padding:0 14px">
              ${s.schedule.length ? s.schedule.map((r,i) => this.scheduleRowHTML(r,i)).join('') :
                '<div style="padding:10px 0;font-size:12px;color:var(--text-tertiary)">No schedule items yet</div>'}
            </div>
            <button class="add-line" id="cs-add-sched">+ add schedule item</button>
          </div>

          <!-- People — tabbed by type -->
          <div class="proj-panel">
            <div class="cs-panel-head" style="gap:0"><span class="bsec-chev open">▶</span> Crew</div>
            <div class="cs-panel-body">
              <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-bottom:0.5px solid var(--border-light)">
                <div style="display:flex;gap:0;background:var(--bg-secondary);border-radius:20px;padding:3px">
                  ${[['crew','Crew'],['on_camera','On Camera'],['client','Client']].map(([type,label]) =>
                    `<button class="filter-pill ${(s._crewTab||'crew')===type?'active':''}" data-crew-tab="${type}" style="border-radius:16px;font-size:11px">${label}</button>`
                  ).join('')}
                </div>
                <button id="cs-fill-general" class="btn-cancel" style="margin-left:auto;font-size:10px;padding:3px 8px;white-space:nowrap">Fill general call</button>
              </div>
              <div style="padding:0 14px">
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));padding:6px 8px" id="cs-crew">
                  ${this._crewForTab(s, s._crewTab||'crew').length
                    ? this._crewForTab(s, s._crewTab||'crew').map((c,i) => this.crewRowHTML(c, s.crew.indexOf(c))).join('')
                    : `<div style="padding:10px 0;font-size:12px;color:var(--text-tertiary)">No ${(s._crewTab||'crew')==='on_camera'?'on camera people':(s._crewTab||'crew')==='client'?'clients':'crew'} added yet</div>`}
                </div>
              </div>
              <button class="add-line" id="cs-add-crew">+ add ${(s._crewTab||'crew')==='on_camera'?'on camera person':(s._crewTab||'crew')==='client'?'client':'crew member'}</button>
            </div>
          </div>

          <!-- Notes -->
          <div class="proj-panel">
            <div class="cs-panel-head"><span class="bsec-chev open">▶</span> Notes</div>
            <div class="cs-panel-body" style="padding:12px 14px">
              <textarea class="proj-textarea" id="cs-notes" style="min-height:80px" placeholder="Any additional info for crew…">${esc(s.notes||'')}</textarea>
            </div>
          </div>

          <!-- H&S -->
          <div class="proj-panel">
            <div class="cs-panel-head" style="display:flex;align-items:center">
              <span class="bsec-chev open">▶</span>
              Health &amp; Safety
              ${this.app.settings?.hs_boilerplate ? `<button id="cs-load-hs" class="btn-cancel" style="margin-left:auto;font-size:10px;padding:3px 8px">Load boilerplate</button>` : ''}
            </div>
            <div class="cs-panel-body" style="padding:12px 14px">
              <textarea class="proj-textarea" id="cs-hs" style="min-height:100px" placeholder="Health and safety instructions for this shoot…">${esc(s.hs_notes||'')}</textarea>
            </div>
          </div>
        </div>

        <!-- Sidebar: share links only -->
        <div style="position:sticky;top:16px">
          <div class="proj-panel">
            <div class="cs-panel-head"><span class="bsec-chev open">▶</span> Share links</div>
            <div class="cs-panel-body" style="padding:10px 12px;display:flex;flex-direction:column;gap:6px">
              <!-- Full call sheet — visually distinct -->
              <div style="background:rgba(var(--accent-rgb),0.08);border:0.5px solid rgba(var(--accent-rgb),0.25);border-radius:var(--radius-md);padding:8px 10px;display:flex;justify-content:space-between;align-items:center">
                <div style="font-size:11px;font-weight:500;color:var(--accent)">📋 Full call sheet</div>
                <button class="btn-secondary" data-copy="${origin}/call/${s.sheet_token}" style="font-size:11px;padding:4px 10px">Copy</button>
              </div>
              ${(() => {
                const types = [['crew','Crew'],['on_camera','On Camera'],['client','Client']]
                return types.map(([type, label]) => {
                  const group = s.crew.filter(c => (c.crew_type||'crew')===type && c.crew_token)
                  if (!group.length) return ''
                  return `<div>
                    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-tertiary);padding:6px 0 4px;border-top:0.5px solid var(--border-light)">${label}</div>
                    ${group.map(c => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0">
                      <div style="font-size:12px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px">${esc(c.name)}</div>
                      <button class="btn-secondary" data-copy="${origin}/call/${s.sheet_token}/${c.crew_token}" style="font-size:11px;padding:3px 8px;white-space:nowrap;flex-shrink:0">Copy</button>
                    </div>`).join('')}
                  </div>`
                }).join('')
              })()}
            </div>
          </div>
        </div>
      </div>`

    this.bindEditor(mc, s, this._editorAbort.signal)
  }

  _readCrewFromDOM(mc, s) {
    // Read current DOM values back into s.crew before any re-render
    mc.querySelectorAll('.crew-row-cs').forEach(card => {
      const i = +card.dataset.crewIdx
      if (!s.crew[i]) return
      s.crew[i].name       = card.querySelector(`[data-cs-crew-name="${i}"]`)?.value ?? s.crew[i].name
      s.crew[i].role       = card.querySelector(`[data-cs-crew-role="${i}"]`)?.value ?? s.crew[i].role
      s.crew[i].call_time  = card.querySelector(`[data-cs-crew-time="${i}"]`)?.value || s.crew[i].call_time
    })
  }

  _refreshCrewPanel(mc, s, saveCrew) {
    // Update tab button styles
    mc.querySelectorAll('[data-crew-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.crewTab === (s._crewTab||'crew'))
    })
    // Update add button label
    const tab = s._crewTab || 'crew'
    const addBtn = mc.querySelector('#cs-add-crew')
    if (addBtn) addBtn.textContent = '+ add ' + (tab==='on_camera'?'on camera person':tab==='client'?'client':'crew member')
    // Re-render just the crew grid
    const container = mc.querySelector('#cs-crew')
    if (!container) return
    const filtered = this._crewForTab(s, tab)
    container.innerHTML = filtered.length
      ? filtered.map(c => this.crewRowHTML(c, s.crew.indexOf(c))).join('')
      : `<div style="padding:10px 0;font-size:12px;color:var(--text-tertiary)">No ${tab==='on_camera'?'on camera people':tab==='client'?'clients':'crew'} added yet</div>`
    // Re-bind remove buttons for newly rendered rows
    if (saveCrew) this.bindCrewRemove(mc, s, saveCrew)
  }

  _crewForTab(s, tab) {
    return s.crew.filter(c => (c.crew_type||'crew') === tab)
  }

  crewRowHTML(c, i) {
    return `<div class="crew-row-cs" data-crew-idx="${i}" data-crew-type="${esc(c.crew_type||'crew')}" style="background:var(--bg-secondary);border:0.5px solid var(--border-med);border-radius:var(--radius-md);padding:10px;margin:4px">
      <div style="display:grid;grid-template-columns:1fr 80px 24px;gap:6px;align-items:center;margin-bottom:6px">
        <input type="text" class="bl-in w" value="${esc(c.name)}" placeholder="Name" data-cs-crew-name="${i}" style="font-size:13px;padding:5px 8px;font-weight:500;background:var(--bg-primary)" />
        <input type="time" class="bl-in" value="${esc(c.call_time||'')}" data-cs-crew-time="${i}" style="font-size:12px;padding:5px 4px;background:var(--bg-primary)" />
        <button class="row-btn" data-cs-rem-crew="${i}" style="color:#b03020;padding:2px">×</button>
      </div>
      <input type="text" class="bl-in" value="${esc(c.role||'')}" placeholder="Role" data-cs-crew-role="${i}" style="font-size:11px;padding:3px 7px;color:var(--text-secondary);background:var(--bg-primary);width:100%;display:block" />
    </div>`
  }

  scheduleRowHTML(r, i) {
    return `<div style="display:grid;grid-template-columns:90px 1fr 28px;gap:6px;padding:6px 0;border-bottom:0.5px solid var(--border-light);align-items:center">
      <input type="time" class="bl-in" value="${esc(r.time||'')}" data-cs-sched-time="${i}" style="font-size:12px;padding:5px 6px" />
      <input type="text" class="bl-in" value="${esc(r.description||'')}" placeholder="Description" data-cs-sched-desc="${i}" style="font-size:12px;padding:5px 8px" />
      <button class="row-btn" data-cs-rem-sched="${i}" style="color:#b03020">×</button>
    </div>`
  }

  locationRowHTML(l, i) {
    return `<div class="cs-loc-row" style="border:0.5px solid var(--border-light);border-radius:var(--radius-md);padding:10px;margin-bottom:8px">
      <div style="display:grid;grid-template-columns:1fr 80px 28px;gap:6px;margin-bottom:6px;align-items:center">
        <input type="text" class="bl-in" value="${esc(l.name||'')}" placeholder="Location name" data-cs-loc-name="${i}" style="font-size:12px;padding:5px 8px" />
        <input type="time" class="bl-in" value="${esc(l.move_time||'')}" placeholder="Move time" data-cs-loc-time="${i}" title="Move time" style="font-size:12px;padding:5px 6px" />
        <button class="row-btn" data-cs-rem-loc="${i}" style="color:#b03020">×</button>
      </div>
      <input type="text" class="bl-in w" value="${esc(l.address||'')}" placeholder="Address" data-cs-loc-addr="${i}" style="font-size:12px;padding:5px 8px;width:100%;display:block;margin-bottom:4px" />
      <input type="text" class="bl-in w" value="${esc(l.notes||'')}" placeholder="Notes (parking, access, etc.)" data-cs-loc-notes="${i}" style="font-size:12px;padding:5px 8px;width:100%;display:block" />
    </div>`
  }

  bindEditor(mc, s, signal) {
    // Accordion panels — toggle cs-panel-body visibility on head click
    mc.querySelectorAll('.cs-panel-head').forEach(head => {
      head.addEventListener('click', e => {
        // Don't toggle if clicking a button/input/select inside the head
        if (e.target.closest('button,input,select,a')) return
        const body = head.nextElementSibling
        if (!body) return
        const isOpen = !body.classList.contains('cs-collapsed')
        body.classList.toggle('cs-collapsed', isOpen)
        head.querySelector('.bsec-chev')?.classList.toggle('open', !isOpen)
      })
    })

    const indicator = mc.querySelector('#cs-save-indicator')
    const showSaved = () => {
      if (!indicator) return
      indicator.textContent = '✓ Saved'; indicator.style.color = 'var(--text-tertiary)'
      setTimeout(() => { if (indicator) indicator.textContent = '' }, 2000)
    }
    const showSaving = () => { if (indicator) { indicator.textContent = 'Saving…'; indicator.style.color = 'var(--accent)' } }

    const save = async () => {
      showSaving()
      const data = {
        sheet_date:        mc.querySelector('#cs-date')?.value || s.sheet_date,
        general_call:      mc.querySelector('#cs-general-call')?.value || null,
        location_name:     mc.querySelector('#cs-loc-name')?.value.trim() || null,
        location_address:  (() => { const v = mc.querySelector('#cs-loc-addr')?.value.trim(); return v && !v.startsWith('http') ? v : null })(),
        location_map_link: (() => { const v = mc.querySelector('#cs-loc-addr')?.value.trim(); return v && v.startsWith('http') ? v : null })(),
        weather_text:      mc.querySelector('#cs-weather')?.value.trim() || null,
        weather_fetched_at: s.weather_fetched_at || null,
        notes:             mc.querySelector('#cs-notes')?.value.trim() || null,
        hs_notes:          mc.querySelector('#cs-hs')?.value.trim() || null,
        parking_notes:     mc.querySelector('#cs-parking')?.value.trim() || null,
        nearest_transport: mc.querySelector('#cs-transport')?.value.trim() || null,
        nearest_hospital_name:    mc.querySelector('#cs-hosp-name')?.value.trim() || null,
        nearest_hospital_address: mc.querySelector('#cs-hosp-addr')?.value.trim() || null,
        nearest_hospital_phone:   mc.querySelector('#cs-hosp-phone')?.value.trim() || null,
        nearest_police_name:    mc.querySelector('#cs-police-name')?.value.trim() || null,
        nearest_police_address: mc.querySelector('#cs-police-addr')?.value.trim() || null,
        nearest_police_phone:   mc.querySelector('#cs-police-phone')?.value.trim() || null,
        nearest_fire_name:    mc.querySelector('#cs-fire-name')?.value.trim() || null,
        nearest_fire_address: mc.querySelector('#cs-fire-addr')?.value.trim() || null,
        nearest_fire_phone:   mc.querySelector('#cs-fire-phone')?.value.trim() || null,
        status: s.status,
        hotels: s.hotels || [],
      }
      try {
        const updated = await updateCallSheet(s.id, data)
        Object.assign(s, updated)
        showSaved()
      } catch(e) { console.error(e); if (indicator) { indicator.textContent = '⚠ Save failed'; indicator.style.color = '#e07070' } }
    }

    const saveCrew = async () => {
      showSaving()
      // Read visible DOM values into s.crew first
      this._readCrewFromDOM(mc, s)
      // Save ALL crew (not just current tab) to avoid losing hidden tab members
      const rows = s.crew.map(c => ({
        name:       c.name || '',
        role:       c.role || '',
        call_time:  c.call_time || null,
        crew_token: c.crew_token || null,
        crew_type:  c.crew_type || 'crew',
      }))
      try { s.crew = await saveCallSheetCrew(s.id, rows); showSaved() } catch(e) { console.error(e) }
    }

    const saveSched = async () => {
      const rows = [...mc.querySelectorAll('[data-cs-sched-time]')].map((el, i) => ({
        time:        el.value,
        description: mc.querySelector(`[data-cs-sched-desc="${i}"]`)?.value || '',
      }))
      try { await saveCallSheetSchedule(s.id, rows); s.schedule = rows } catch(e) { console.error(e) }
    }

    const saveLocs = async () => {
      const rows = [...mc.querySelectorAll('[data-cs-loc-name]')].map((el, i) => ({
        name:      el.value,
        address:   mc.querySelector(`[data-cs-loc-addr="${i}"]`)?.value || '',
        map_link:  null,
        move_time: mc.querySelector(`[data-cs-loc-time="${i}"]`)?.value || null,
        notes:     mc.querySelector(`[data-cs-loc-notes="${i}"]`)?.value || '',
      }))
      try { await saveCallSheetLocations(s.id, rows); s.locations = rows } catch(e) { console.error(e) }
    }

    // Auto-save on field changes — includes new fields
    mc.querySelectorAll('#cs-date,#cs-loc-name,#cs-loc-addr,#cs-weather,#cs-notes,#cs-hs,#cs-parking,#cs-transport,#cs-hosp-name,#cs-hosp-addr,#cs-hosp-phone,#cs-police-name,#cs-police-addr,#cs-police-phone,#cs-fire-name,#cs-fire-addr,#cs-fire-phone').forEach(el => {
      el.addEventListener('change', save)
    })

    // General call time — cascade to any crew times matching the OLD value (visible + hidden tabs)
    mc.querySelector('#cs-general-call')?.addEventListener('change', e => {
      const newCall = e.target.value
      const oldCall = s.general_call || ''
      if (oldCall) {
        // Update visible DOM crew times that match old value
        mc.querySelectorAll('[data-cs-crew-time]').forEach(el => {
          if (el.value === oldCall) el.value = newCall
        })
        // Also update hidden crew (other tabs) in s.crew directly
        s.crew.forEach(c => { if (c.call_time === oldCall) c.call_time = newCall })
        // Save all crew with updated times
        saveCrew()
      }
      save()
    })

    // Crew changes — use document-level delegation to catch all tabs
    mc.addEventListener('change', e => {
      if (e.target.matches('[data-cs-crew-name],[data-cs-crew-role],[data-cs-crew-time]')) saveCrew()
    }, { signal })
    // Crew type tabs — read DOM first, switch tab, refresh only crew panel
    mc.querySelectorAll('[data-crew-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._readCrewFromDOM(mc, s)
        s._crewTab = btn.dataset.crewTab
        this._refreshCrewPanel(mc, s, saveCrew)
      })
    })

    // Find nearby services
    mc.querySelector('#cs-find-nearby')?.addEventListener('click', async () => {
      const addrVal = mc.querySelector('#cs-loc-addr')?.value.trim()
      const locName = mc.querySelector('#cs-loc-name')?.value.trim()
      const btn = mc.querySelector('#cs-find-nearby')
      const result = await this.app.projectsView._findNearbyServices(addrVal, locName, btn)
      if (!result) return
      const setField = (id, val) => { const el = mc.querySelector(id); if (el && val) { el.value = val } }
      if (result.transport) { setField('#cs-transport', result.transport.name); s.nearest_transport = result.transport.name }
      if (result.hospital) {
        setField('#cs-hosp-name', result.hospital.name); setField('#cs-hosp-addr', result.hospital.address)
        s.nearest_hospital_name = result.hospital.name; s.nearest_hospital_address = result.hospital.address
      }
      if (result.police) {
        setField('#cs-police-name', result.police.name); setField('#cs-police-addr', result.police.address)
        s.nearest_police_name = result.police.name; s.nearest_police_address = result.police.address
      }
      if (result.fire) {
        setField('#cs-fire-name', result.fire.name); setField('#cs-fire-addr', result.fire.address)
        s.nearest_fire_name = result.fire.name; s.nearest_fire_address = result.fire.address
      }
      save()
      this.app.toast('Nearby services found ✓')
    })

    // H&S boilerplate
    mc.querySelector('#cs-load-hs')?.addEventListener('click', () => {
      const el = mc.querySelector('#cs-hs')
      if (el) { el.value = this.app.settings?.hs_boilerplate || ''; save() }
    })

    // Add crew member — read current values first, then refresh only crew panel
    mc.querySelector('#cs-add-crew')?.addEventListener('click', () => {
      this._readCrewFromDOM(mc, s)
      const type = s._crewTab || 'crew'
      s.crew.push({ name:'', role:'', department:'', phone:'', call_time: s.general_call||'', crew_token: null, sort_order: s.crew.length, crew_type: type })
      this._refreshCrewPanel(mc, s, saveCrew)
      // Focus the new name field
      mc.querySelector(`[data-cs-crew-name="${s.crew.length-1}"]`)?.focus()
    })
    this.bindCrewRemove(mc, s, saveCrew)

    // Schedule changes
    mc.querySelector('#cs-schedule')?.addEventListener('change', saveSched)
    mc.querySelector('#cs-add-sched')?.addEventListener('click', () => {
      s.schedule.push({ time:'', description:'' })
      const container = mc.querySelector('#cs-schedule')
      if (s.schedule.length === 1) container.innerHTML = ''
      container.insertAdjacentHTML('beforeend', this.scheduleRowHTML(s.schedule[s.schedule.length-1], s.schedule.length-1))
      this.bindSchedRemove(mc, s, saveSched)
      container.querySelector(`[data-cs-sched-time="${s.schedule.length-1}"]`)?.focus()
    })
    this.bindSchedRemove(mc, s, saveSched)

    // Location changes
    mc.querySelector('#cs-extra-locs')?.addEventListener('change', saveLocs)
    mc.querySelector('#cs-add-loc')?.addEventListener('click', () => {
      s.locations.push({ name:'', address:'', move_time:null, notes:'' })
      const container = mc.querySelector('#cs-extra-locs')
      if (s.locations.length === 1) container.innerHTML = ''
      container.insertAdjacentHTML('beforeend', this.locationRowHTML(s.locations[s.locations.length-1], s.locations.length-1))
      this.bindLocRemove(mc, s, saveLocs)
    })
    this.bindLocRemove(mc, s, saveLocs)

    // Fill all blank crew call times with general call
    mc.querySelector('#cs-fill-general')?.addEventListener('click', () => {
      const generalCall = mc.querySelector('#cs-general-call')?.value
      if (!generalCall) { this.app.toast('Set a general call time first'); return }
      mc.querySelectorAll('[data-cs-crew-time]').forEach(el => {
        if (!el.value) el.value = generalCall
      })
      saveCrew()
      this.app.toast('Blank call times filled')
    })

    // Status toggle
    mc.querySelector('#cs-status-badge')?.addEventListener('click', async () => {
      s.status = s.status === 'sent' ? 'draft' : 'sent'
      await save()
      this.renderEditor(mc)
    })

    // Copy buttons
    mc.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(btn.dataset.copy)
        const orig = btn.textContent; btn.textContent = '✓'; setTimeout(() => btn.textContent = orig, 1500)
      })
    })

    // Copy all call times
    mc.querySelector('#cs-copy-all')?.addEventListener('click', async () => {
      const date = mc.querySelector('#cs-date')?.value || s.sheet_date
      const project = this.app.projects.find(p => p.id === s.project_id)
      const lines = [`📋 ${project?.name||''} — ${fmtDate(date)}`, '']
      s.crew.forEach(c => {
        if (c.name) lines.push(`${c.name}${c.role?' ('+c.role+')':''} — ${c.call_time||'TBC'} — ${location.origin}/call/${s.sheet_token}/${c.crew_token||''}`)
      })
      await navigator.clipboard.writeText(lines.join('\n'))
      this.app.toast('Call times copied to clipboard')
    })

    // Fetch weather
    mc.querySelector('#cs-fetch-weather')?.addEventListener('click', async () => {
      const locName = mc.querySelector('#cs-loc-name')?.value.trim()
      const locAddr = mc.querySelector('#cs-loc-addr')?.value.trim()
      const mapLink = locAddr?.startsWith('http') ? locAddr : null
      const textAddr = !locAddr?.startsWith('http') ? locAddr : null
      const date = mc.querySelector('#cs-date')?.value || s.sheet_date
      if (!locName && !locAddr) { this.app.toast('Enter a location first'); return }
      const btn = mc.querySelector('#cs-fetch-weather')
      btn.disabled = true; btn.textContent = 'Fetching…'
      try {
        // Resolve short URLs (maps.app.goo.gl) server-side before extracting coords
        let resolvedAddr = locAddr
        if (locAddr?.startsWith('http') && (locAddr.includes('goo.gl') || locAddr.includes('maps.app'))) {
          try {
            const r = await fetch(`/api/maps?action=resolve&url=${encodeURIComponent(locAddr)}`)
            const d = await r.json()
            if (d.url) resolvedAddr = d.url
          } catch(e) { /* fall through */ }
        }
        const mapLink = resolvedAddr?.startsWith('http') ? resolvedAddr : null
        const textAddr = !resolvedAddr?.startsWith('http') ? resolvedAddr : null


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

        // Extract coordinates from the resolved URL
        let lat = null, lng = null
        if (mapLink) {
          const coords = extractCoords(mapLink)
          if (coords) { lat = coords.lat; lng = coords.lng }
        }

        if (!lat) {
          // Fall back to geocoding — try each comma-separated part, stripping UK postcodes
          const stripPostcode = str => str.replace(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/gi, '').trim()
          const searchTerms = []
          if (locAddr && !locAddr.startsWith('http')) {
            const parts = locAddr.split(',').map(str => stripPostcode(str.trim())).filter(str => str.length > 1)
            searchTerms.push(...[...parts].reverse())
          }
          if (locName) searchTerms.push(...locName.split(',').map(str => str.trim()).filter(Boolean).reverse())

          let loc = null
          for (const term of searchTerms) {
            const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=1&language=en&format=json`)
            const geoData = await geoRes.json()
            if (geoData.results?.[0]) { loc = geoData.results[0]; break }
          }
          if (!loc) { this.app.toast('Location not found — try pasting a Google Maps URL into the address field'); btn.disabled = false; btn.textContent = '🌤 Fetch'; return }
          lat = loc.latitude; lng = loc.longitude
          this.app.toast(`Fetching weather for ${loc.name}…`)
        }

        // Fetch forecast
        const wxRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,weathercode,sunrise,sunset&timezone=Europe%2FLondon&start_date=${date}&end_date=${date}`)
        const wx = await wxRes.json()
        const d = wx.daily
        if (!d) { this.app.toast('Weather data not available for this date'); return }
        const code = d.weathercode?.[0]
        const desc = wxCode(code)
        const tMax = d.temperature_2m_max?.[0], tMin = d.temperature_2m_min?.[0]
        const rain = d.precipitation_probability_max?.[0]
        const wind = d.windspeed_10m_max?.[0]
        const sunrise = d.sunrise?.[0]?.split('T')[1] || ''
        const sunset  = d.sunset?.[0]?.split('T')[1] || ''
        const sunTimes = sunrise && sunset ? ` · Sunrise ${sunrise} · Sunset ${sunset}` : ''
        const text = `${desc} · ${tMin}–${tMax}°C · Wind ${wind}km/h · ${rain}% chance of rain${sunTimes}`
        mc.querySelector('#cs-weather').value = text
        s.weather_text = text
        s.weather_fetched_at = new Date().toISOString()
        await updateCallSheet(s.id, { ...s, weather_text: text, weather_fetched_at: s.weather_fetched_at })
        this.app.toast('Weather fetched ✓')
      } catch(e) { console.error(e); this.app.toast('Error fetching weather') }
      finally { btn.disabled = false; btn.textContent = '🌤 Fetch' }
    })

    // Duplicate for next day
    mc.querySelector('#cs-dup')?.addEventListener('click', async () => {
      await save(); await saveCrew(); await saveSched(); await saveLocs()
      try {
        const nextDate = new Date(s.sheet_date+'T12:00:00')
        nextDate.setDate(nextDate.getDate()+1)
        const newDateStr = nextDate.toISOString().split('T')[0]
        const newSheet = await createCallSheet(this.app.userId, s.project_id, {
          ...s, sheet_date: newDateStr, weather_text: null, weather_fetched_at: null, status: 'draft'
        })
        await saveCallSheetCrew(newSheet.id, s.crew.map(c => ({ ...c, crew_token: null })))
        await saveCallSheetSchedule(newSheet.id, s.schedule)
        await saveCallSheetLocations(newSheet.id, s.locations)
        this.app.toast('Duplicated for next day')
        await this.openEditor(mc, newSheet.id)
      } catch(e) { console.error(e); this.app.toast('Error duplicating') }
    })

    // Delete
    mc.querySelector('#cs-delete')?.addEventListener('click', async () => {
      if (!await this.app.confirm({ title: 'Delete call sheet?', message: 'This cannot be undone.', confirmLabel: 'Delete' })) return
      try {
        await deleteCallSheet(s.id)
        this.app.toast('Call sheet deleted')
        await this.renderList(mc, s.project_id)
      } catch(e) { console.error(e); this.app.toast('Error deleting') }
    })

    // Back
    mc.querySelector('#cs-back-list')?.addEventListener('click', () => this.renderList(mc, s.project_id))

    // Export PDF
    mc.querySelector('#cs-pdf')?.addEventListener('click', () => this.exportPDF(s))
  }

  bindCrewRemove(mc, s, saveCrew) {
    mc.querySelectorAll('[data-cs-rem-crew]').forEach(btn => {
      btn.onclick = () => {
        this._readCrewFromDOM(mc, s)
        const i = +btn.dataset.csRemCrew
        s.crew.splice(i, 1)
        saveCrew()
        this._refreshCrewPanel(mc, s, saveCrew)
      }
    })
  }
  bindSchedRemove(mc, s, saveSched) {
    mc.querySelectorAll('[data-cs-rem-sched]').forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.csCsRemSched || +btn.dataset.csRemSched
        s.schedule.splice(i, 1)
        saveSched()
        this.renderEditor(mc)
      }
    })
  }
  bindLocRemove(mc, s, saveLocs) {
    mc.querySelectorAll('[data-cs-rem-loc]').forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.csRemLoc
        s.locations.splice(i, 1)
        saveLocs()
        this.renderEditor(mc)
      }
    })
  }

  exportPDF(s) {
    const project = this.app.projects.find(p => p.id === s.project_id)
    const settings = this.app.settings || {}
    const LOGO = '/slate-logo.png'
    const f = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

    const fmtDateLong = d => {
      if (!d) return ''
      return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short',year:'numeric'})
    }
    const fmtDateShort = d => {
      if (!d) return ''
      return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})
    }

    // Group crew by department
    const depts = {}
    for (const c of s.crew) {
      const dept = c.department || 'General'
      if (!depts[dept]) depts[dept] = []
      depts[dept].push(c)
    }

    const cell = (content, opts='') => `<td style="padding:7px 10px;font-size:12px;vertical-align:top;${opts}">${content}</td>`
    const th   = (content, opts='') => `<th style="padding:6px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#555;text-align:left;border-bottom:1.5px solid #1a1a18;${opts}">${content}</th>`

    const tableStyle = 'width:100%;border-collapse:collapse;margin-bottom:0'
    const rowStyle   = 'border-bottom:0.5px solid #e8e8e4'
    const secHead    = (title, count='') => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin:28px 0 8px">
        <div style="font-size:16px;font-weight:700;color:#1a1a18">${title}</div>
        ${count?`<div style="font-size:11px;color:#aaa">${count}</div>`:''}
      </div>`

    // ── Header strip ─────────────────────────────────────────────────────────
    const header = `
      <div class="cs-keep" style="display:grid;grid-template-columns:160px 1fr 200px;gap:0;border:1px solid #ddd;border-radius:4px;margin-bottom:0;page-break-inside:avoid">

        <!-- Left: Studio -->
        <div style="padding:16px;border-right:1px solid #ddd">
          <img src="${LOGO}" alt="${f(settings.company_name||'')}" style="height:32px;object-fit:contain;object-position:left;margin-bottom:8px;display:block" onerror="this.style.display='none'" />
          <div style="font-size:11px;font-weight:600;color:#1a1a18;margin-bottom:2px">${f(settings.company_name||'')}</div>
          ${settings.address?`<div style="font-size:10px;color:#666;line-height:1.5">${f(settings.address)}</div>`:''}
          ${settings.phone?`<div style="font-size:10px;color:#666">Tel: ${f(settings.phone)}</div>`:''}
        </div>

        <!-- Centre: Project + call time -->
        <div style="padding:16px;text-align:center;border-right:1px solid #ddd">
          <div style="font-size:18px;font-weight:700;color:#1a1a18;margin-bottom:4px">${f(project?.name||'')}</div>
          ${s.location_name?`<div style="font-size:11px;color:#888;margin-bottom:12px">${f(s.location_name)}</div>`:'<div style="margin-bottom:12px"></div>'}
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#aaa;margin-bottom:4px">General call time</div>
          <div style="font-size:36px;font-weight:800;color:#1a1a18;letter-spacing:-1px">${f(s.general_call||'TBC')}</div>
          ${s.notes?`<div style="font-size:11px;color:#666;margin-top:10px;line-height:1.5;font-style:italic">${f(s.notes)}</div>`:''}
        </div>

        <!-- Right: Date + weather + key times -->
        <div style="padding:16px">
          <div style="font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:0.5px">Shoot date</div>
          <div style="font-size:14px;font-weight:700;color:#1a1a18;margin-bottom:8px">${fmtDateLong(s.sheet_date)}</div>
          ${s.weather_text?`
          <div style="font-size:11px;color:#666;background:#f7f7f5;border-radius:4px;padding:6px 8px;margin-bottom:10px">${f(s.weather_text)}</div>`:''}
          ${s.crew.length?`
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#aaa;margin-bottom:4px">Key call times</div>
          ${[...new Set(s.crew.filter(c=>c.call_time).map(c=>c.call_time))].sort().slice(0,4).map(t => {
            const names = s.crew.filter(c=>c.call_time===t).map(c=>c.role||c.name).join(', ')
            return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;border-bottom:0.5px solid #f0efe9"><span style="color:#555">${f(names)}</span><span style="font-weight:600">${f(t)}</span></div>`
          }).join('')}`:''}
        </div>
      </div>`

    // ── Locations ─────────────────────────────────────────────────────────────
    const allLocs = []
    if (s.location_name || s.location_address) allLocs.push({ name: s.location_name, address: s.location_address, map_link: s.location_map_link, notes: null, move_time: null })
    allLocs.push(...s.locations)

    const locsSection = allLocs.length ? `
      ${secHead('Locations', allLocs.length + ' location' + (allLocs.length!==1?'s':''))}
      <div class="cs-keep" style="page-break-inside:avoid">
      <table style="${tableStyle}">
        <thead><tr style="background:#f7f7f5">${th('#','width:28px;text-align:center')}${th('Location')}${th('Address')}${th('Notes')}</tr></thead>
        <tbody>
        ${allLocs.map((l,i) => `<tr style="${rowStyle}">
          ${cell(`${i+1}`,'text-align:center;font-weight:600;color:#aaa;font-size:11px')}
          ${cell(`<strong style="color:#1a1a18">${f(l.name||'')}</strong>${l.move_time?`<div style="font-size:10px;color:#f59e0b;margin-top:2px">Move: ${f(l.move_time)}</div>`:''}`)}
          ${cell(`<span style="color:#555">${f(l.address||'')}</span>${l.map_link?`<div style="font-size:10px;margin-top:2px"><a href="${f(l.map_link)}" style="color:#4a90d9">View map</a></div>`:''}`)}
          ${cell(`<span style="color:#777;font-size:11px;font-style:italic">${f(l.notes||'')}</span>`)}
        </tr>`).join('')}
        </tbody>
      </table>
      </div>` : ''

    // ── Schedule ──────────────────────────────────────────────────────────────
    const schedSection = s.schedule.length ? `
      ${secHead('Schedule', fmtDateShort(s.sheet_date))}
      <div class="cs-keep" style="page-break-inside:avoid">
      <table style="${tableStyle}">
        <thead><tr style="background:#f7f7f5">${th('Time','width:70px')}${th('Description')}</tr></thead>
        <tbody>
        ${s.schedule.map(r => `<tr style="${rowStyle}">
          ${cell(`<strong style="color:#1a1a18;font-size:13px">${f(r.time)}</strong>`,'width:70px')}
          ${cell(f(r.description))}
        </tr>`).join('')}
        </tbody>
      </table>
      </div>` : ''

    // ── Crew — two-column grouped by department ───────────────────────────────
    const deptKeys = Object.keys(depts)
    const crewSection = deptKeys.length ? `
      ${secHead('Crew', s.crew.length + ' total')}
      <div class="cs-keep" style="page-break-inside:avoid">
      <table style="${tableStyle}">
        <thead><tr style="background:#f7f7f5">
          ${th('Name')}${th('Call','width:64px')}
          <td style="width:16px;background:#f7f7f5;border-bottom:1.5px solid #1a1a18"></td>
          ${th('Name')}${th('Call','width:64px')}
        </tr></thead>
        <tbody>
        ${(() => {
          // Interleave department headers and crew into two columns
          let rows = []
          deptKeys.forEach(dept => {
            rows.push({ type:'dept', label: dept })
            depts[dept].forEach(c => rows.push({ type:'crew', crew:c }))
          })
          // Pair rows into two columns
          const pairs = []
          for (let i = 0; i < rows.length; i += 2) {
            pairs.push([rows[i], rows[i+1]])
          }
          return pairs.map(([left, right]) => {
            const renderCell = (item) => {
              if (!item) return '<td colspan="2" style="border-bottom:0.5px solid #e8e8e4"></td>'
              if (item.type === 'dept') return `<td colspan="2" style="padding:6px 10px;background:#2a2a28;font-size:10px;font-weight:700;color:#e8e8e4;text-transform:uppercase;letter-spacing:0.8px;border-bottom:none">${f(item.label)}</td>`
              const c = item.crew
              return `${cell(`<div style="font-weight:500;font-size:12px">${f(c.name)}</div><div style="font-size:10px;color:#888">${f(c.role||'')}</div>`)}${cell(`<strong style="font-size:12px">${f(c.call_time||'TBC')}</strong>`,'width:64px')}`
            }
            return `<tr style="border-bottom:0.5px solid #e8e8e4">
              ${renderCell(left)}
              <td style="width:16px;background:#f5f5f5;border-bottom:0.5px solid #e8e8e4"></td>
              ${renderCell(right)}
            </tr>`
          }).join('')
        })()}
        </tbody>
      </table>
      </div>` : ''

    // ── Footer ─────────────────────────────────────────────────────────────────
    const footer = `
      <div style="margin-top:32px;padding-top:10px;border-top:0.5px solid #ddd;display:flex;justify-content:space-between;font-size:9px;color:#bbb">
        <span>${f(settings.company_name||'Slate')}${settings.email?' · '+f(settings.email):''}</span>
        <span>Confidential — crew use only</span>
      </div>`

    const html = `
      <div id="cs-root" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;padding:32px;background:#fff;color:#1a1a18;max-width:900px;margin:0 auto">
        <style>
          @media print {
            @page { size:A4; margin:16mm 14mm }
            * { -webkit-print-color-adjust:exact; print-color-adjust:exact }
          }
          table { page-break-inside:auto }
          tr { page-break-inside:avoid }
          ${PDF_CONTINUED_CSS}
        </style>
        ${header}
        ${locsSection}
        ${schedSection}
        ${crewSection}
        ${footer}
      </div>
      ${continuationScript({
        rootSelector: '#cs-root',
        rootWidthPx: a4ContentWidthPx(14),
        pageHeightPx: a4ContentHeightPx(16),
        blockSelector: '.cs-keep',
        mode: 'block',
      })}`

    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { this.app.toast('Allow pop-ups to export PDF'); return }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(project?.name||'Call Sheet')} — ${fmtDateLong(s.sheet_date)}</title></head><body style="margin:0;padding:0">${html}</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print() }, 600)
    this.app.toast('PDF opening in new window…')
  }
}

// Open-Meteo WMO weather code to description
function wxCode(code) {
  const map = {
    0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
    45:'Foggy',48:'Foggy',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
    61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',
    80:'Rain showers',81:'Rain showers',82:'Heavy showers',
    95:'Thunderstorm',96:'Thunderstorm with hail',99:'Thunderstorm with hail'
  }
  return map[code] || 'Variable conditions'
}
