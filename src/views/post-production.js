const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const PRESET_COLORS = ['#4CAF50', '#C47E3A', '#7B6EAB', '#4a90d9', '#d9534f', '#f59e0b', '#06b6d4', '#ec4899', '#6ec96e']

export class PostProductionView {
  constructor(app) {
    this.app = app
  }

  // ── Tab renderer ──────────────────────────────────────────────────────────────

  async renderTab(container, project) {
    container.innerHTML = `<div style="font-size:13px;color:var(--text-tertiary);padding:16px 0">Loading post production schedule…</div>`
    try {
      const { getPpsForProject, createPpsWithDefaults } = await import('../db/client.js')
      let pps = await getPpsForProject(this.app.userId, project.id)
      if (!pps) {
        container.innerHTML = `
          <div style="text-align:center;padding:40px 0;display:flex;flex-direction:column;align-items:center;gap:12px">
            <div style="font-size:16px;font-weight:500">No post production schedule yet</div>
            <div style="font-size:13px;color:var(--text-tertiary);max-width:380px;line-height:1.6">Create a schedule with standard phase defaults based on a typical post production workflow. You can customise all phases after creating.</div>
            <button class="btn-primary" id="pps-create-btn" style="margin-top:4px">+ Create Post Production Schedule</button>
          </div>`
        container.querySelector('#pps-create-btn')?.addEventListener('click', async () => {
          const btn = container.querySelector('#pps-create-btn')
          if (btn) btn.textContent = 'Creating…'
          try {
            pps = await createPpsWithDefaults(this.app.userId, project.id)
            this._renderPpsContent(container, pps, project)
          } catch (e) { console.error(e); if (btn) btn.textContent = '+ Create Post Production Schedule' }
        })
        return
      }
      this._renderPpsContent(container, pps, project)
    } catch (e) {
      console.error(e)
      container.innerHTML = `<div style="font-size:13px;color:var(--text-tertiary);padding:16px 0">Error loading schedule.</div>`
    }
  }

  // ── Main content ──────────────────────────────────────────────────────────────

  _renderPpsContent(container, pps, project) {
    const phases = pps.phases || []
    const hasPortal = !!project.portal_token
    const portalCount = phases.filter(p => p.show_in_portal).length

    container.innerHTML = `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:14px;font-weight:600;margin-bottom:2px">Post Production Schedule</div>
            <div style="font-size:12px;color:var(--text-tertiary)">${phases.length} phase${phases.length !== 1 ? 's' : ''}${hasPortal && portalCount ? ` · ${portalCount} visible in portal` : ''}</div>
          </div>
          <button class="btn-primary" id="pps-add-phase">+ Add phase</button>
        </div>

        <div style="background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--text-tertiary);font-weight:500;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">Schedule range</span>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <input type="date" id="pps-master-start" value="${pps.start_date || ''}" style="padding:5px 9px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
            <span style="color:var(--text-tertiary);font-size:13px">→</span>
            <input type="date" id="pps-master-end" value="${pps.end_date || ''}" style="padding:5px 9px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
            <button id="pps-save-dates" class="btn-primary" style="padding:5px 12px;font-size:12px">Save</button>
          </div>
        </div>

        <div id="pps-grid-wrap">
          ${this._renderGrid(pps, phases, hasPortal)}
        </div>
      </div>`

    this._bindContent(container, pps, project)
  }

  // ── Grid (date rows × phase columns) ─────────────────────────────────────────

  _renderGrid(pps, phases, hasPortal) {
    if (!pps.start_date || !pps.end_date) {
      return `<div style="padding:28px;text-align:center;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md)">
        <div style="font-size:13px;color:var(--text-tertiary)">Set a schedule range above to see the phase grid</div>
      </div>`
    }
    if (!phases.length) {
      return `<div style="padding:28px;text-align:center;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md)">
        <div style="font-size:13px;color:var(--text-tertiary)">Add phases to populate the schedule grid</div>
      </div>`
    }

    const start = new Date(pps.start_date + 'T00:00:00')
    const end   = new Date(pps.end_date   + 'T00:00:00')
    if (end < start) {
      return `<div style="padding:16px;font-size:13px;color:var(--text-tertiary)">End date must be after start date.</div>`
    }

    const days = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d))
    }
    if (days.length > 366) {
      return `<div style="padding:16px;font-size:13px;color:var(--text-tertiary)">Schedule range too large — please narrow to under one year.</div>`
    }

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    // Build per-phase active-day sets and "first visible day in range" markers
    const phaseData = phases.map(ph => {
      if (!ph.start_date || !ph.end_date) return { active: new Set(), firstDay: null }
      const ps = new Date(ph.start_date + 'T00:00:00')
      const pe = new Date(ph.end_date   + 'T00:00:00')
      const active = new Set()
      for (let d = new Date(ps); d <= pe; d.setDate(d.getDate() + 1)) {
        active.add(d.toISOString().slice(0, 10))
      }
      // First day of phase that's within the master range
      let firstDay = null
      for (const d of days) {
        const ds = d.toISOString().slice(0, 10)
        if (active.has(ds)) { firstDay = ds; break }
      }
      return { active, firstDay }
    })

    const CELL_W = 82
    const abbr = s => s.length > 13 ? s.slice(0, 11) + '…' : s

    return `
      <div style="overflow-x:auto;border:1px solid var(--border-light);border-radius:var(--radius-md)">
        <table style="border-collapse:collapse;font-size:12px;min-width:${90 + phases.length * CELL_W + 36}px">
          <thead>
            <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border-light)">
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:400;color:var(--text-tertiary);width:90px;white-space:nowrap;position:sticky;left:0;background:var(--bg-secondary);z-index:2;border-right:1px solid var(--border-light)">Date</th>
              ${phases.map((ph, pi) => {
                const { active, firstDay } = phaseData[pi]
                const hasDates = ph.start_date && ph.end_date
                const days_ = hasDates
                  ? Math.round((new Date(ph.end_date) - new Date(ph.start_date)) / 86400000) + 1
                  : null
                return `<th class="pps-phase-header" data-phase-id="${ph.id}"
                  style="padding:8px 6px;text-align:center;cursor:pointer;width:${CELL_W}px;min-width:${CELL_W}px;max-width:${CELL_W}px;border-left:1px solid var(--border-light)"
                  title="Click to edit · ${esc(ph.name)}${hasDates ? ' · ' + days_ + ' days' : ''}">
                  <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
                    <div style="width:10px;height:10px;border-radius:50%;background:${ph.color || '#C47E3A'};flex-shrink:0"></div>
                    <div style="font-size:10px;font-weight:600;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${CELL_W - 12}px;text-transform:uppercase;letter-spacing:0.3px">${esc(abbr(ph.name))}</div>
                    <div style="font-size:9px;color:var(--text-tertiary);white-space:nowrap">${hasDates ? days_ + 'd' : 'no dates'}</div>
                  </div>
                </th>`
              }).join('')}
              <th style="width:36px;min-width:36px;border-left:1px solid var(--border-light)">
                <div style="display:flex;align-items:center;justify-content:center">
                  <button id="pps-add-phase-col" title="Add phase" style="background:none;border:1px solid var(--border-light);color:var(--text-tertiary);border-radius:4px;width:22px;height:22px;cursor:pointer;font-size:16px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center">+</button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            ${days.map(d => {
              const ds = d.toISOString().slice(0, 10)
              const dow = DOW[d.getDay()]
              const isWeekend = d.getDay() === 0 || d.getDay() === 6
              const isToday = d.getTime() === today.getTime()
              const isMonthStart = d.getDate() === 1

              const dateBg = isToday
                ? 'rgba(74,144,217,0.08)'
                : isWeekend
                  ? 'var(--bg-secondary)'
                  : 'var(--bg-primary)'

              const dateLabel = `${d.getDate()} ${MON[d.getMonth()]}`
              const monthLabel = isMonthStart
                ? `<div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;margin-top:1px">${MON[d.getMonth()]} ${d.getFullYear()}</div>`
                : ''

              return `<tr style="border-bottom:1px solid var(--border-light);opacity:${isWeekend ? '0.5' : '1'}${isToday ? ';outline:1px solid rgba(74,144,217,0.25);outline-offset:-1px' : ''}">
                <td style="padding:3px 12px;white-space:nowrap;font-size:11px;position:sticky;left:0;background:${dateBg};z-index:1;border-right:1px solid var(--border-light)">
                  <div style="display:flex;align-items:baseline;gap:5px">
                    <span style="color:var(--text-tertiary);font-size:10px;width:24px;flex-shrink:0">${dow}</span>
                    <span style="color:${isToday ? 'var(--accent)' : 'var(--text-secondary)'};font-weight:${isToday ? '700' : '400'}">${dateLabel}</span>
                  </div>
                  ${monthLabel}
                </td>
                ${phases.map((ph, pi) => {
                  const { active, firstDay } = phaseData[pi]
                  const isActive = active.has(ds)
                  const isFirst  = firstDay === ds
                  if (!isActive) return `<td style="border-left:1px solid var(--border-light)"></td>`
                  const rgba25 = _hexRgba(ph.color || '#C47E3A', 0.22)
                  const rgba55 = _hexRgba(ph.color || '#C47E3A', 0.55)
                  return `<td style="border-left:2px solid ${rgba55};background:${rgba25};padding:2px 6px">
                    ${isFirst ? `<div style="font-size:9px;font-weight:700;color:${ph.color || '#C47E3A'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${CELL_W - 12}px;text-transform:uppercase;letter-spacing:0.3px" title="${esc(ph.name)}">${esc(ph.name)}</div>` : ''}
                  </td>`
                }).join('')}
                <td style="border-left:1px solid var(--border-light)"></td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>`
  }

  // ── Event binding ─────────────────────────────────────────────────────────────

  _bindContent(container, pps, project) {
    const hasPortal = !!project.portal_token

    container.querySelector('#pps-add-phase')?.addEventListener('click', () => {
      this._openPhaseModal(null, pps, project, container)
    })

    container.querySelector('#pps-save-dates')?.addEventListener('click', async () => {
      const btn = container.querySelector('#pps-save-dates')
      const startVal = container.querySelector('#pps-master-start')?.value || null
      const endVal   = container.querySelector('#pps-master-end')?.value   || null
      if (btn) btn.textContent = 'Saving…'
      try {
        const { updatePpsScheduleDates } = await import('../db/client.js')
        await updatePpsScheduleDates(pps.id, { start_date: startVal, end_date: endVal })
        pps.start_date = startVal
        pps.end_date   = endVal
        const gridWrap = container.querySelector('#pps-grid-wrap')
        if (gridWrap) {
          gridWrap.innerHTML = this._renderGrid(pps, pps.phases || [], hasPortal)
          this._bindGrid(container, pps, project)
        }
        if (btn) btn.textContent = '✓ Saved'
        setTimeout(() => { if (btn && btn.textContent === '✓ Saved') btn.textContent = 'Save' }, 1500)
      } catch (e) {
        console.error(e)
        if (btn) btn.textContent = 'Error'
        setTimeout(() => { if (btn) btn.textContent = 'Save' }, 1500)
      }
    })

    this._bindGrid(container, pps, project)
  }

  _bindGrid(container, pps, project) {
    container.querySelectorAll('.pps-phase-header').forEach(th => {
      th.addEventListener('mouseenter', () => { th.style.background = 'var(--bg-secondary)' })
      th.addEventListener('mouseleave', () => { th.style.background = '' })
      th.addEventListener('click', () => {
        const phase = (pps.phases || []).find(ph => ph.id === th.dataset.phaseId)
        if (phase) this._openPhaseModal(phase, pps, project, container)
      })
    })

    container.querySelector('#pps-add-phase-col')?.addEventListener('click', () => {
      this._openPhaseModal(null, pps, project, container)
    })
  }

  // ── Phase modal ───────────────────────────────────────────────────────────────

  _openPhaseModal(phase, pps, project, container) {
    document.getElementById('pps-phase-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'pps-phase-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px 16px'

    let selColor = phase?.color || '#C47E3A'

    const render = () => {
      const swatches = PRESET_COLORS.map(c =>
        `<div class="pps-sw${selColor === c ? ' pps-sw-sel' : ''}" data-c="${c}"
          style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${selColor === c ? '#fff' : 'transparent'};flex-shrink:0"></div>`
      ).join('')

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:420px" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light)">
            <div style="font-size:14px;font-weight:600">${phase ? 'Edit phase' : 'Add phase'}</div>
            <button id="ppsm-x" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);padding:2px 6px;line-height:1">×</button>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Phase name <span style="color:#ef4444">*</span></label>
              <input type="text" id="ppsm-name" value="${esc(phase?.name || '')}" placeholder="e.g. V1 Edits" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Start date</label>
                <input type="date" id="ppsm-start" value="${phase?.start_date || ''}" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
              </div>
              <div>
                <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">End date</label>
                <input type="date" id="ppsm-end" value="${phase?.end_date || ''}" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
              </div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:7px">Colour</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${swatches}</div>
            </div>
            ${project.portal_token ? `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="ppsm-portal" ${phase?.show_in_portal ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent)" />
              Show in client portal
            </label>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px">
              ${phase ? `<button id="ppsm-del" class="btn-cancel" style="color:#ef4444;border-color:rgba(239,68,68,0.35)">Delete</button>` : '<div></div>'}
              <div style="display:flex;gap:8px">
                <button id="ppsm-cancel" class="btn-cancel">Cancel</button>
                <button id="ppsm-save" class="btn-primary">${phase ? 'Save changes' : 'Add phase'}</button>
              </div>
            </div>
          </div>
        </div>`

      overlay.querySelectorAll('.pps-sw').forEach(sw => {
        sw.addEventListener('click', () => { selColor = sw.dataset.c; render() })
      })
      overlay.querySelector('#ppsm-x')?.addEventListener('click',      () => overlay.remove())
      overlay.querySelector('#ppsm-cancel')?.addEventListener('click', () => overlay.remove())

      overlay.querySelector('#ppsm-save')?.addEventListener('click', async () => {
        const name = overlay.querySelector('#ppsm-name')?.value.trim()
        if (!name) { overlay.querySelector('#ppsm-name')?.focus(); return }
        const btn = overlay.querySelector('#ppsm-save')
        if (btn) btn.textContent = 'Saving…'
        const data = {
          name,
          start_date:     overlay.querySelector('#ppsm-start')?.value || null,
          end_date:       overlay.querySelector('#ppsm-end')?.value   || null,
          color:          selColor,
          show_in_portal: overlay.querySelector('#ppsm-portal')?.checked ?? false,
        }
        try {
          const { createPpsPhase, updatePpsPhase } = await import('../db/client.js')
          if (phase) {
            const updated = await updatePpsPhase(phase.id, data)
            const idx = (pps.phases || []).findIndex(p => p.id === phase.id)
            if (idx >= 0) pps.phases[idx] = updated
          } else {
            const created = await createPpsPhase(pps.id, { ...data, sort_order: (pps.phases || []).length })
            if (!pps.phases) pps.phases = []
            pps.phases.push(created)
          }
          overlay.remove()
          this._renderPpsContent(container, pps, project)
        } catch (e) {
          console.error(e)
          if (btn) btn.textContent = 'Error — retry'
        }
      })

      overlay.querySelector('#ppsm-del')?.addEventListener('click', async () => {
        if (!phase || !confirm('Delete this phase?')) return
        try {
          const { deletePpsPhase } = await import('../db/client.js')
          await deletePpsPhase(phase.id)
          pps.phases = (pps.phases || []).filter(p => p.id !== phase.id)
          overlay.remove()
          this._renderPpsContent(container, pps, project)
        } catch (e) { console.error(e) }
      })
    }

    render()
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#ppsm-name')?.focus(), 50)
  }
}

function _hexRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
