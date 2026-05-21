const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const TYPE_COLORS = { shoot: '#4CAF50', post_production: '#C47E3A', other: '#7B6EAB' }
const ENTRY_TYPE_LABELS = { shoot: 'Shoot', post_production: 'Post Production', other: 'Other' }

export class TeamCalendarView {
  constructor(app) {
    this.app = app
    this._expanded = localStorage.getItem('tc-expanded') !== 'false'
    this._weekOffset = 0
  }

  // ── Week helpers ──────────────────────────────────────────────────────────────

  _getWeekStart() {
    const now = new Date()
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + this._weekOffset * 7)
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  _getWeekDays(weekStart) {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return d
    })
  }

  _dateKey(d) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // ── Dashboard section ─────────────────────────────────────────────────────────

  renderDashboardSection(container) {
    let section = container.querySelector('#tc-section')
    if (!section) {
      section = document.createElement('div')
      section.id = 'tc-section'
      section.style.cssText = 'margin-bottom:20px'
      const cdWidget = container.querySelector('#cd-widget-wrap')
      if (cdWidget) {
        cdWidget.insertAdjacentElement('afterend', section)
      } else {
        container.prepend(section)
      }
    }
    this._renderSection(section)
    this._bindSection(section)
  }

  _renderSection(section) {
    const users = this.app.allUsers || []
    const weekStart = this._getWeekStart()
    const days = this._getWeekDays(weekStart)
    const entries = this.app.teamCalendarEntries || []
    const weekKeys = new Set(days.map(d => this._dateKey(d)))
    const weekEntries = entries.filter(e => weekKeys.has(e.entry_date))
    const label0 = days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const label6 = days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const weekLabel = `${label0} – ${label6}`

    section.innerHTML = `
      <div class="db-section-head" style="cursor:pointer;user-select:none" id="tc-toggle">
        <span class="db-section-dot" style="background:#4a90d9"></span>
        Team Calendar
        ${weekEntries.length ? `<span class="db-section-count">${weekEntries.length}</span>` : ''}
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          ${this._expanded ? `
            <button id="tc-prev" style="background:none;border:1px solid var(--border-light);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px;color:var(--text-secondary);font-family:var(--font);line-height:1.4" onclick="event.stopPropagation()">‹</button>
            <span style="font-size:11px;color:var(--text-tertiary);white-space:nowrap">${esc(weekLabel)}</span>
            <button id="tc-next" style="background:none;border:1px solid var(--border-light);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px;color:var(--text-secondary);font-family:var(--font);line-height:1.4" onclick="event.stopPropagation()">›</button>
          ` : `<span style="font-size:11px;color:var(--text-tertiary)">${esc(weekLabel)}</span>`}
          <span class="db-chevron${this._expanded ? ' db-chevron--open' : ''}">▶</span>
        </div>
      </div>
      <div id="tc-body" style="display:${this._expanded ? 'block' : 'none'}">
        ${this._expanded ? this._renderGrid(days, users, weekEntries) : ''}
      </div>`
  }

  _renderGrid(days, users, entries) {
    if (!users.length) {
      return `<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">No team members to display.</div>`
    }

    const today = new Date(); today.setHours(0, 0, 0, 0)

    const byUserDate = {}
    for (const e of entries) {
      const k = `${e.assignee_id}:${e.entry_date}`
      if (!byUserDate[k]) byUserDate[k] = []
      byUserDate[k].push(e)
    }

    const projectMap = {}
    for (const p of (this.app.projects || [])) projectMap[p.id] = p

    return `
      <div style="overflow-x:auto;border-radius:var(--radius-md);border:1px solid var(--border-light)">
        <table style="width:100%;min-width:${100 + users.length * 140}px;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--bg-secondary)">
              <th style="padding:8px 10px;text-align:left;font-weight:500;font-size:11px;color:var(--text-tertiary);width:110px;border-right:1px solid var(--border-light);white-space:nowrap">Date</th>
              ${users.map(u => `
                <th style="padding:8px 10px;text-align:left;font-weight:500;font-size:11px;color:var(--text-secondary);min-width:140px;border-right:1px solid var(--border-light)">
                  ${esc(u.name || u.email.split('@')[0])}
                  <div style="font-weight:400;font-size:10px;color:var(--text-tertiary)">${esc(u.role || '')}</div>
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${days.map(day => {
              const dateKey = this._dateKey(day)
              const isToday = day.getTime() === today.getTime()
              const isWeekend = day.getDay() === 0 || day.getDay() === 6
              const dayStr = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
              const rowBg = isToday ? 'rgba(74,144,217,0.06)' : isWeekend ? 'var(--bg-secondary)' : 'var(--bg-primary)'
              return `<tr style="background:${rowBg};border-top:1px solid var(--border-light)">
                <td style="padding:8px 10px;border-right:1px solid var(--border-light);vertical-align:top;white-space:nowrap;${isToday ? 'font-weight:600;color:var(--accent)' : isWeekend ? 'color:var(--text-tertiary)' : 'color:var(--text-secondary)'}">
                  ${esc(dayStr)}
                  ${isToday ? '<br><span style="font-size:9px;background:var(--accent);color:#fff;border-radius:3px;padding:1px 4px">Today</span>' : ''}
                </td>
                ${users.map(u => {
                  const cellEntries = byUserDate[`${u.id}:${dateKey}`] || []
                  return `<td class="tc-cell" data-tc-date="${dateKey}" data-tc-user="${u.id}" style="padding:5px 6px;border-right:1px solid var(--border-light);vertical-align:top;min-height:36px;cursor:pointer">
                    ${cellEntries.map(e => {
                      const col = e.color || TYPE_COLORS[e.entry_type] || '#7B6EAB'
                      const proj = e.project_id ? projectMap[e.project_id] : null
                      return `<div class="tc-chip" data-tc-entry-id="${e.id}"
                        style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:${col}22;border:0.5px solid ${col}88;border-radius:4px;margin-bottom:2px;cursor:pointer;max-width:100%"
                        title="${esc(e.label)}${proj ? ' · ' + esc(proj.name) : ''}">
                        <div style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${col}"></div>
                        <span style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">${esc(e.label)}</span>
                      </div>`
                    }).join('')}
                    <div class="tc-add-hint" style="opacity:0;font-size:18px;color:var(--text-tertiary);line-height:1;text-align:center;padding:2px 0;transition:opacity 0.1s;pointer-events:none">+</div>
                  </td>`
                }).join('')}
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:6px;font-size:11px;color:var(--text-tertiary)">Click a cell to add · Click an entry to edit</div>`
  }

  _bindSection(section) {
    section.querySelector('#tc-toggle')?.addEventListener('click', () => {
      this._expanded = !this._expanded
      localStorage.setItem('tc-expanded', String(this._expanded))
      this._renderSection(section)
      this._bindSection(section)
    })

    section.querySelector('#tc-prev')?.addEventListener('click', e => {
      e.stopPropagation()
      this._weekOffset--
      this._renderSection(section)
      this._bindSection(section)
    })

    section.querySelector('#tc-next')?.addEventListener('click', e => {
      e.stopPropagation()
      this._weekOffset++
      this._renderSection(section)
      this._bindSection(section)
    })

    section.querySelectorAll('.tc-cell').forEach(cell => {
      const hint = cell.querySelector('.tc-add-hint')
      cell.addEventListener('mouseenter', () => { if (hint) hint.style.opacity = '0.5' })
      cell.addEventListener('mouseleave', () => { if (hint) hint.style.opacity = '0' })
      cell.addEventListener('click', e => {
        const chip = e.target.closest('.tc-chip')
        if (chip) {
          const entry = (this.app.teamCalendarEntries || []).find(x => x.id === chip.dataset.tcEntryId)
          if (entry) this._openEntryModal(entry, section)
        } else {
          this._openEntryModal(null, section, cell.dataset.tcDate, cell.dataset.tcUser)
        }
      })
    })
  }

  // ── Entry modal ───────────────────────────────────────────────────────────────

  _openEntryModal(entry, section, defaultDate, defaultUserId) {
    document.getElementById('tc-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'tc-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px 16px'

    const users = this.app.allUsers || []
    const projects = (this.app.projects || []).filter(p => !p.is_retainer)

    const renderModal = (state = {}) => {
      const selUserId    = state.assignee_id  || defaultUserId || users[0]?.id || ''
      const selDate      = state.entry_date   || defaultDate   || this._dateKey(new Date())
      const selType      = state.entry_type   || entry?.entry_type   || 'other'
      const selLabel     = state.label        ?? (entry?.label ?? '')
      const selColor     = state.color        ?? (entry?.color ?? '')
      const selProjectId = state.project_id   ?? (entry?.project_id ?? '')
      const selShootId   = state.shoot_id     ?? (entry?.shoot_id ?? '')
      const selPhaseId   = state.pps_phase_id ?? (entry?.pps_phase_id ?? '')
      const selBudgetId  = state.budget_id    ?? (entry?.budget_id ?? '')
      const selLineLabel = state.line_label   ?? (entry?.line_label ?? '')
      const selNotes     = state.notes        ?? (entry?.notes ?? '')

      const selProject = selProjectId ? projects.find(p => p.id === selProjectId) : null
      const linkedBudgets = selProject
        ? (selProject.budget_ids || []).map(id => (this.app.budgets || []).find(b => b.id === id)).filter(Boolean)
        : []

      const allLineItems = []
      for (const b of linkedBudgets) {
        for (const sec of (b.sections || [])) {
          for (const item of (sec.items || [])) {
            if (item.label && !allLineItems.find(l => l.label === item.label && l.budgetId === b.id)) {
              allLineItems.push({ label: item.label, budgetId: b.id, budgetName: b.name })
            }
          }
        }
      }

      const projectShoots = selProject ? (selProject._shoots || []) : []

      const COLORS = ['', '#4CAF50', '#C47E3A', '#7B6EAB', '#4a90d9', '#ef4444', '#f59e0b', '#06b6d4', '#ec4899']
      const colorSwatches = COLORS.map(c => c
        ? `<div class="tc-swatch${selColor === c ? ' tc-swatch--sel' : ''}" data-color="${c}" style="width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${selColor === c ? '#fff' : 'transparent'};transition:border 0.1s;flex-shrink:0"></div>`
        : `<div class="tc-swatch tc-swatch--auto${selColor === '' ? ' tc-swatch--sel' : ''}" data-color="" style="width:20px;height:20px;border-radius:50%;background:var(--bg-tertiary);border:2px solid ${selColor === '' ? 'var(--accent)' : 'var(--border-med)'};cursor:pointer;font-size:8px;display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);flex-shrink:0">auto</div>`
      ).join('')

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:460px;max-height:90vh;overflow-y:auto" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light)">
            <div style="font-size:14px;font-weight:600">${entry ? 'Edit entry' : 'Add calendar entry'}</div>
            <button id="tc-m-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);padding:2px 6px;line-height:1">×</button>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Team member</div>
                <select id="tc-m-user" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                  ${users.map(u => `<option value="${u.id}" ${u.id === selUserId ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
                </select>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Date</div>
                <input type="date" id="tc-m-date" value="${esc(selDate)}" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
              </div>
            </div>

            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Type</div>
              <div style="display:flex;gap:6px">
                ${Object.entries(ENTRY_TYPE_LABELS).map(([val, lbl]) => `
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:5px 10px;border:1px solid ${selType === val ? 'var(--accent)' : 'var(--border-med)'};border-radius:var(--radius-md);font-size:12px;background:${selType === val ? 'rgba(74,144,217,0.1)' : 'var(--bg-secondary)'};color:${selType === val ? 'var(--accent)' : 'var(--text-secondary)'}">
                    <input type="radio" name="tc-m-type" value="${val}" ${selType === val ? 'checked' : ''} style="accent-color:var(--accent)">
                    ${lbl}
                  </label>`).join('')}
              </div>
            </div>

            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Label <span style="color:#ef4444">*</span></div>
              <input type="text" id="tc-m-label" value="${esc(selLabel)}" placeholder="e.g. Hero Edit Day 3" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)" />
            </div>

            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Colour</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap" id="tc-m-swatches">${colorSwatches}</div>
            </div>

            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Project</div>
              <select id="tc-m-project" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                <option value="">— None —</option>
                ${projects.map(p => `<option value="${p.id}" ${p.id === selProjectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
            </div>

            ${selType === 'shoot' && selProjectId ? `
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Shoot</div>
              <select id="tc-m-shoot" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                <option value="">— None —</option>
                ${projectShoots.map(sh => `<option value="${sh.id}" ${sh.id === selShootId ? 'selected' : ''}>${esc(sh.name || sh.location_name || 'Untitled shoot')}</option>`).join('')}
              </select>
            </div>` : ''}

            ${selType === 'post_production' && selProjectId ? `
            <div id="tc-m-phase-wrap">
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Post Production Phase</div>
              <select id="tc-m-phase" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                <option value="">— None —</option>
              </select>
              <div id="tc-m-phase-loading" style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Loading phases…</div>
            </div>` : ''}

            ${selProjectId && allLineItems.length ? `
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Time Tracking Task</div>
              <select id="tc-m-task" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                <option value="">— None —</option>
                ${allLineItems.map(li => `<option value="${li.budgetId}::${li.label}" ${li.budgetId === selBudgetId && li.label === selLineLabel ? 'selected' : ''}>${esc(li.label)} (${esc(li.budgetName)})</option>`).join('')}
              </select>
            </div>` : ''}

            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Notes</div>
              <textarea id="tc-m-notes" rows="2" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);resize:vertical">${esc(selNotes)}</textarea>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              ${entry ? `<button id="tc-m-delete" class="btn-cancel" style="color:#ef4444;border-color:rgba(239,68,68,0.35)">Delete</button>` : '<div></div>'}
              <div style="display:flex;gap:8px">
                <button id="tc-m-cancel" class="btn-cancel">Cancel</button>
                <button id="tc-m-save" class="btn-primary">${entry ? 'Save changes' : 'Add entry'}</button>
              </div>
            </div>
          </div>
        </div>`

      // Bind swatches
      overlay.querySelectorAll('.tc-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          const newState = this._collectModalState(overlay, state)
          newState.color = sw.dataset.color
          renderModal(newState)
        })
      })

      // Re-render on type or project change
      overlay.querySelectorAll('input[name="tc-m-type"]').forEach(r => {
        r.addEventListener('change', () => {
          const newState = this._collectModalState(overlay, state)
          newState.entry_type = overlay.querySelector('input[name="tc-m-type"]:checked')?.value || 'other'
          renderModal(newState)
        })
      })
      overlay.querySelector('#tc-m-project')?.addEventListener('change', e => {
        const newState = this._collectModalState(overlay, state)
        newState.project_id = e.target.value
        newState.shoot_id = ''
        newState.pps_phase_id = ''
        renderModal(newState)
      })

      // Load PPS phases async
      if (selType === 'post_production' && selProjectId) {
        this._loadPhasesForProject(overlay, selProjectId, selPhaseId)
      }

      // Close
      overlay.querySelector('#tc-m-close')?.addEventListener('click', () => overlay.remove())
      overlay.querySelector('#tc-m-cancel')?.addEventListener('click', () => overlay.remove())

      // Save
      overlay.querySelector('#tc-m-save')?.addEventListener('click', () => this._saveFromModal(overlay, entry, section))

      // Delete
      overlay.querySelector('#tc-m-delete')?.addEventListener('click', () => {
        if (entry && confirm('Delete this calendar entry?')) {
          this._deleteEntry(entry.id, section)
          overlay.remove()
        }
      })
    }

    renderModal()
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#tc-m-label')?.focus(), 50)
  }

  async _loadPhasesForProject(overlay, projectId, selectedPhaseId) {
    const phaseSelect = overlay.querySelector('#tc-m-phase')
    const phaseLoading = overlay.querySelector('#tc-m-phase-loading')
    if (!phaseSelect) return
    try {
      const { getPpsForProject } = await import('../db/client.js')
      const pps = await getPpsForProject(this.app.userId, projectId)
      if (phaseLoading) phaseLoading.style.display = 'none'
      if (pps?.phases?.length) {
        phaseSelect.innerHTML = `
          <option value="">— None —</option>
          ${pps.phases.map(ph => `<option value="${ph.id}" ${ph.id === selectedPhaseId ? 'selected' : ''}>${esc(ph.name)}</option>`).join('')}`
      } else {
        phaseSelect.innerHTML = '<option value="">No phases yet (create PPS in project)</option>'
      }
    } catch (e) {
      console.error(e)
      if (phaseLoading) { phaseLoading.textContent = 'Failed to load phases'; phaseLoading.style.display = 'block' }
    }
  }

  _collectModalState(overlay, prev = {}) {
    const taskVal = overlay.querySelector('#tc-m-task')?.value || ''
    const [taskBudgetId, ...taskLabelParts] = taskVal.split('::')
    return {
      assignee_id:  overlay.querySelector('#tc-m-user')?.value  || prev.assignee_id  || '',
      entry_date:   overlay.querySelector('#tc-m-date')?.value  || prev.entry_date   || '',
      entry_type:   overlay.querySelector('input[name="tc-m-type"]:checked')?.value || prev.entry_type || 'other',
      label:        overlay.querySelector('#tc-m-label')?.value || prev.label        || '',
      color:        prev.color !== undefined ? prev.color : '',
      project_id:   overlay.querySelector('#tc-m-project')?.value || prev.project_id || '',
      shoot_id:     overlay.querySelector('#tc-m-shoot')?.value   || prev.shoot_id   || '',
      pps_phase_id: overlay.querySelector('#tc-m-phase')?.value   || prev.pps_phase_id || '',
      budget_id:    taskBudgetId || '',
      line_label:   taskLabelParts.join('::') || '',
      notes:        overlay.querySelector('#tc-m-notes')?.value   || prev.notes      || '',
    }
  }

  async _saveFromModal(overlay, entry, section) {
    const state = this._collectModalState(overlay)
    if (!state.label.trim()) {
      overlay.querySelector('#tc-m-label')?.focus()
      return
    }
    if (!state.assignee_id || !state.entry_date) return

    const btn = overlay.querySelector('#tc-m-save')
    if (btn) btn.textContent = 'Saving…'

    try {
      const { createTeamCalendarEntry, updateTeamCalendarEntry } = await import('../db/client.js')
      const payload = {
        assignee_id:  state.assignee_id,
        entry_date:   state.entry_date,
        entry_type:   state.entry_type,
        label:        state.label.trim(),
        color:        state.color || null,
        project_id:   state.project_id   || null,
        shoot_id:     state.shoot_id     || null,
        pps_phase_id: state.pps_phase_id || null,
        budget_id:    state.budget_id    || null,
        line_label:   state.line_label   || null,
        notes:        state.notes        || null,
      }
      if (entry) {
        const updated = await updateTeamCalendarEntry(this.app.userId, entry.id, payload)
        const idx = (this.app.teamCalendarEntries || []).findIndex(e => e.id === entry.id)
        if (idx >= 0) this.app.teamCalendarEntries[idx] = updated
      } else {
        const created = await createTeamCalendarEntry(this.app.userId, payload)
        if (!this.app.teamCalendarEntries) this.app.teamCalendarEntries = []
        this.app.teamCalendarEntries.push(created)
      }
      overlay.remove()
      this._renderSection(section)
      this._bindSection(section)
    } catch (e) {
      console.error(e)
      if (btn) btn.textContent = 'Error — retry'
    }
  }

  async _deleteEntry(id, section) {
    try {
      const { deleteTeamCalendarEntry } = await import('../db/client.js')
      await deleteTeamCalendarEntry(this.app.userId, id)
      this.app.teamCalendarEntries = (this.app.teamCalendarEntries || []).filter(e => e.id !== id)
      this._renderSection(section)
      this._bindSection(section)
    } catch (e) {
      console.error(e)
    }
  }

  // ── Quick-log time ────────────────────────────────────────────────────────────

  openTimeLogger(entry) {
    if (!entry.budget_id || !entry.line_label) return
    const sidebar = document.getElementById('time-logger-sidebar')
    if (sidebar) {
      const projectSel = sidebar.querySelector('#tl-project')
      const taskSel    = sidebar.querySelector('#tl-task')
      if (projectSel) { projectSel.value = entry.project_id || ''; projectSel.dispatchEvent(new Event('change')) }
      setTimeout(() => { if (taskSel) taskSel.value = `${entry.budget_id}::${entry.line_label}` }, 100)
      sidebar.scrollIntoView({ behavior: 'smooth' })
    }
  }
}
