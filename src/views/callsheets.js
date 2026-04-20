import {
  getCallSheetsForProject, getCallSheet, createCallSheet, updateCallSheet,
  deleteCallSheet, saveCallSheetCrew, saveCallSheetSchedule, saveCallSheetLocations
} from '../db/client.js'

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
      const crew = (project?.crew||[]).filter(c => c.name).map((c, i) => ({
        name: c.name, role: c.role||'', phone: '', call_time: project?.general_call||'', sort_order: i
      }))
      if (crew.length) await saveCallSheetCrew(sheet.id, crew)
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
            <div class="proj-panel-head">Sheet details</div>
            <div class="proj-panel-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
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
            <div class="proj-panel-head">Primary location</div>
            <div class="proj-panel-body" style="display:flex;flex-direction:column;gap:10px">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <div>
                  <div class="proj-field-label">Location name</div>
                  <input type="text" class="proj-input" id="cs-loc-name" value="${esc(s.location_name||'')}" placeholder="e.g. Bwlch Farm" />
                </div>
                <div>
                  <div class="proj-field-label">Maps link (optional)</div>
                  <input type="url" class="proj-input" id="cs-loc-map" value="${esc(s.location_map_link||'')}" placeholder="https://maps.google.com/..." />
                </div>
              </div>
              <div>
                <div class="proj-field-label">Address</div>
                <input type="text" class="proj-input" id="cs-loc-addr" value="${esc(s.location_address||'')}" placeholder="Full address for maps / crew" />
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

          <!-- Additional locations -->
          <div class="proj-panel">
            <div class="proj-panel-head">Additional locations</div>
            <div id="cs-extra-locs" style="padding:0 14px">
              ${s.locations.length ? s.locations.map((l,i) => this.locationRowHTML(l,i)).join('') :
                '<div style="padding:10px 0;font-size:12px;color:var(--text-tertiary)">No additional locations</div>'}
            </div>
            <button class="add-line" id="cs-add-loc">+ add location</button>
          </div>

          <!-- Schedule -->
          <div class="proj-panel">
            <div class="proj-panel-head">Schedule</div>
            <div id="cs-schedule" style="padding:0 14px">
              ${s.schedule.length ? s.schedule.map((r,i) => this.scheduleRowHTML(r,i)).join('') :
                '<div style="padding:10px 0;font-size:12px;color:var(--text-tertiary)">No schedule items yet</div>'}
            </div>
            <button class="add-line" id="cs-add-sched">+ add schedule item</button>
          </div>


          <!-- Crew — in main column -->
          <div class="proj-panel">
            <div class="proj-panel-head" style="display:flex;align-items:center;gap:6px">
              Crew call times
              <button id="cs-fill-general" class="btn-cancel" style="margin-left:auto;font-size:10px;padding:3px 8px;white-space:nowrap">Fill general call</button>
            </div>
            <div style="padding:0 14px">
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0;padding:6px 8px" id="cs-crew">
                ${s.crew.length ? s.crew.map((c,i) => this.crewRowHTML(c,i)).join('') :
                  '<div style="padding:10px 0;font-size:12px;color:var(--text-tertiary)">No crew added yet</div>'}
              </div>
            </div>
            <button class="add-line" id="cs-add-crew">+ add crew member</button>
          </div>

          <!-- Notes -->
          <div class="proj-panel">
            <div class="proj-panel-head">Notes</div>
            <div style="padding:12px 14px">
              <textarea class="proj-textarea" id="cs-notes" style="min-height:80px" placeholder="Parking info, facilities, important reminders…">${esc(s.notes||'')}</textarea>
            </div>
          </div>
        </div>

        <!-- Sidebar: share links only -->
        <div style="position:sticky;top:16px">
          <div class="proj-panel">
            <div class="proj-panel-head">Share links</div>
            <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px">
              <div>
                <div class="proj-field-label">Full call sheet</div>
                <div style="display:flex;gap:6px">
                  <input type="text" class="proj-input" readonly value="${origin}/call/${s.sheet_token}" style="font-size:11px;color:var(--text-secondary)" />
                  <button class="btn-secondary" data-copy="${origin}/call/${s.sheet_token}" style="white-space:nowrap;font-size:11px">Copy</button>
                </div>
              </div>
              ${s.crew.filter(c=>c.crew_token).map(c => `
              <div>
                <div class="proj-field-label">${esc(c.name)}</div>
                <div style="display:flex;gap:6px">
                  <input type="text" class="proj-input" readonly value="${origin}/call/${s.sheet_token}/${c.crew_token}" style="font-size:11px;color:var(--text-secondary)" />
                  <button class="btn-secondary" data-copy="${origin}/call/${s.sheet_token}/${c.crew_token}" style="white-space:nowrap;font-size:11px">Copy</button>
                </div>
              </div>`).join('')}
            </div>
          </div>
        </div>
      </div>`

    this.bindEditor(mc, s)
  }

  crewRowHTML(c, i) {
    return `<div class="crew-row-cs" data-crew-idx="${i}" style="background:var(--bg-secondary);border:0.5px solid var(--border-med);border-radius:var(--radius-md);padding:10px;margin:4px">
      <div style="display:grid;grid-template-columns:1fr 80px 24px;gap:6px;align-items:center;margin-bottom:6px">
        <input type="text" class="bl-in w" value="${esc(c.name)}" placeholder="Name" data-cs-crew-name="${i}" style="font-size:13px;padding:5px 8px;font-weight:500;background:var(--bg-primary)" />
        <input type="time" class="bl-in" value="${esc(c.call_time||'')}" data-cs-crew-time="${i}" style="font-size:12px;padding:5px 4px;background:var(--bg-primary)" />
        <button class="row-btn" data-cs-rem-crew="${i}" style="color:#b03020;padding:2px">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
        <input type="text" class="bl-in" value="${esc(c.role||'')}" placeholder="Role" data-cs-crew-role="${i}" style="font-size:11px;padding:3px 7px;color:var(--text-secondary);background:var(--bg-primary)" />
        <input type="text" class="bl-in" value="${esc(c.department||'')}" placeholder="Department" data-cs-crew-dept="${i}" style="font-size:11px;padding:3px 7px;color:var(--text-secondary);background:var(--bg-primary)" />
      </div>
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

  bindEditor(mc, s) {
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
        location_address:  mc.querySelector('#cs-loc-addr')?.value.trim() || null,
        location_map_link: mc.querySelector('#cs-loc-map')?.value.trim() || null,
        weather_text:      mc.querySelector('#cs-weather')?.value.trim() || null,
        weather_fetched_at: s.weather_fetched_at || null,
        notes:             mc.querySelector('#cs-notes')?.value.trim() || null,
        status:            s.status,
      }
      try {
        const updated = await updateCallSheet(s.id, data)
        Object.assign(s, updated)
        showSaved()
      } catch(e) { console.error(e); if (indicator) { indicator.textContent = '⚠ Save failed'; indicator.style.color = '#e07070' } }
    }

    const saveCrew = async () => {
      showSaving()
      const rows = [...mc.querySelectorAll('[data-cs-crew-name]')].map((el, i) => ({
        name:       el.value,
        role:       mc.querySelector(`[data-cs-crew-role="${i}"]`)?.value || '',
        department: mc.querySelector(`[data-cs-crew-dept="${i}"]`)?.value || '',
        call_time:  mc.querySelector(`[data-cs-crew-time="${i}"]`)?.value || null,
        crew_token: s.crew[i]?.crew_token || null,
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

    // Auto-save on field changes
    mc.querySelectorAll('#cs-date,#cs-general-call,#cs-loc-name,#cs-loc-addr,#cs-loc-map,#cs-weather,#cs-notes').forEach(el => {
      el.addEventListener('change', save)
    })

    // Crew changes
    mc.querySelector('#cs-crew')?.addEventListener('change', saveCrew)
    mc.querySelector('#cs-add-crew')?.addEventListener('click', () => {
      s.crew.push({ name:'', role:'', phone:'', call_time: s.general_call||'', crew_token: null, sort_order: s.crew.length })
      const container = mc.querySelector('#cs-crew')
      if (!s.crew[s.crew.length-2]) container.innerHTML = ''  // clear empty state
      container.insertAdjacentHTML('beforeend', this.crewRowHTML(s.crew[s.crew.length-1], s.crew.length-1))
      this.bindCrewRemove(mc, s, saveCrew)
      container.querySelector(`[data-cs-crew-name="${s.crew.length-1}"]`)?.focus()
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
      const addr = mc.querySelector('#cs-loc-addr')?.value || mc.querySelector('#cs-loc-name')?.value
      const date = mc.querySelector('#cs-date')?.value || s.sheet_date
      if (!addr) { this.app.toast('Enter a location address first'); return }
      const btn = mc.querySelector('#cs-fetch-weather')
      btn.disabled = true; btn.textContent = 'Fetching…'
      try {
        // Geocode via Open-Meteo
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(addr)}&count=1&language=en&format=json`)
        const geoData = await geoRes.json()
        const loc = geoData.results?.[0]
        if (!loc) { this.app.toast('Location not found — try a simpler address'); return }
        // Fetch forecast
        const wxRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,weathercode,sunrise,sunset&timezone=Europe%2FLondon&start_date=${date}&end_date=${date}`)
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
        this.app.toast('Weather fetched')
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
      if (!confirm('Delete this call sheet? This cannot be undone.')) return
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
        const i = +btn.dataset.csRemCrew
        s.crew.splice(i, 1)
        saveCrew()
        this.renderEditor(mc)
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
    const LOGO = '/peny-logo.png'
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
      <div style="display:grid;grid-template-columns:160px 1fr 200px;gap:0;border:1px solid #ddd;border-radius:4px;margin-bottom:0;page-break-inside:avoid">

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
      <div style="page-break-inside:avoid">
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
      <div style="page-break-inside:avoid">
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
      <div style="page-break-inside:avoid">
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
        <span>${f(settings.company_name||'Peny')}${settings.email?' · '+f(settings.email):''}</span>
        <span>Confidential — crew use only</span>
      </div>`

    const html = `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;padding:32px;background:#fff;color:#1a1a18;max-width:900px;margin:0 auto">
        <style>
          @media print {
            @page { size:A4; margin:16mm 14mm }
            * { -webkit-print-color-adjust:exact; print-color-adjust:exact }
          }
          table { page-break-inside:auto }
          tr { page-break-inside:avoid }
        </style>
        ${header}
        ${locsSection}
        ${schedSection}
        ${crewSection}
        ${footer}
      </div>`

    let ts = document.getElementById('pdf-topsheet')
    if (!ts) { ts = document.createElement('div'); ts.id = 'pdf-topsheet'; document.body.appendChild(ts) }
    ts.innerHTML = html
    setTimeout(() => window.print(), 150)
    this.app.toast('Opening print dialog…')
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
