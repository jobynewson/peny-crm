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

  _renderPpsContent(container, pps, project) {
    const phases = pps.phases || []
    const hasAnyDates = phases.some(ph => ph.start_date || ph.end_date)

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:14px;font-weight:600">Post Production Schedule</div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">${phases.length} phase${phases.length !== 1 ? 's' : ''}${hasAnyDates ? ' · ' + this._scheduleSummary(phases) : ''}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${project.portal_token ? `<span style="font-size:11px;color:var(--text-tertiary)">${phases.filter(p => p.show_in_portal).length} visible in portal</span>` : ''}
          <button class="btn-primary" id="pps-add-phase">+ Add phase</button>
        </div>
      </div>

      ${hasAnyDates ? `
      <div id="pps-gantt" style="margin-bottom:20px">
        ${this._renderGantt(phases)}
      </div>` : ''}

      <div id="pps-phase-list">
        ${this._renderPhaseList(phases, pps.id, project)}
      </div>`

    this._bindPpsContent(container, pps, project)
  }

  _scheduleSummary(phases) {
    const dates = phases.flatMap(ph => [ph.start_date, ph.end_date]).filter(Boolean).sort()
    if (!dates.length) return ''
    const start = new Date(dates[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const end   = new Date(dates[dates.length - 1]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    return `${start} – ${end}`
  }

  _renderGantt(phases) {
    const withDates = phases.filter(ph => ph.start_date && ph.end_date)
    if (!withDates.length) return ''

    const allDates = withDates.flatMap(ph => [new Date(ph.start_date), new Date(ph.end_date)])
    const minDate  = new Date(Math.min(...allDates.map(d => d.getTime())))
    const maxDate  = new Date(Math.max(...allDates.map(d => d.getTime())))
    const totalMs  = maxDate - minDate || 1
    const today    = new Date(); today.setHours(0, 0, 0, 0)

    const todayPct = Math.max(0, Math.min(100, ((today - minDate) / totalMs) * 100))
    const showTodayLine = today >= minDate && today <= maxDate

    const fmtShort = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

    return `
      <div style="background:var(--bg-secondary);border-radius:var(--radius-md);padding:16px;overflow-x:auto">
        <div style="min-width:500px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-tertiary);margin-bottom:8px">
            <span>${fmtShort(minDate)}</span>
            <span>${fmtShort(maxDate)}</span>
          </div>
          <div style="position:relative">
            ${showTodayLine ? `<div style="position:absolute;top:0;bottom:0;left:${todayPct.toFixed(1)}%;width:1px;background:rgba(74,144,217,0.5);z-index:2;pointer-events:none"></div>` : ''}
            ${withDates.map(ph => {
              const start  = new Date(ph.start_date)
              const end    = new Date(ph.end_date)
              const left   = ((start - minDate) / totalMs * 100).toFixed(1)
              const width  = Math.max(0.5, ((end - start) / totalMs * 100)).toFixed(1)
              const days   = Math.round((end - start) / 86400000) + 1
              return `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
                  <div style="flex:0 0 140px;font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right">${esc(ph.name)}</div>
                  <div style="flex:1;position:relative;height:20px">
                    <div style="position:absolute;left:${left}%;width:${width}%;height:100%;background:${ph.color || '#C47E3A'};border-radius:3px;display:flex;align-items:center;padding:0 6px;overflow:hidden;min-width:4px" title="${esc(ph.name)}: ${fmtShort(ph.start_date)} – ${fmtShort(ph.end_date)} (${days}d)">
                      <span style="font-size:10px;color:rgba(255,255,255,0.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${days}d</span>
                    </div>
                  </div>
                </div>`
            }).join('')}
          </div>
          ${showTodayLine ? `<div style="display:flex;align-items:center;gap:4px;margin-top:6px;font-size:10px;color:rgba(74,144,217,0.8)">
            <div style="width:12px;height:1px;background:rgba(74,144,217,0.5)"></div> Today
          </div>` : ''}
        </div>
      </div>`
  }

  _renderPhaseList(phases, scheduleId, project) {
    if (!phases.length) {
      return `<div style="font-size:13px;color:var(--text-tertiary);text-align:center;padding:24px 0">No phases yet — click <strong style="color:var(--text-primary)">+ Add phase</strong> above.</div>`
    }

    const hasPortal = !!project.portal_token
    const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'

    return `
      <div style="border:1px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:var(--bg-secondary)">
              <th style="padding:8px 12px;text-align:left;font-weight:500;font-size:11px;color:var(--text-tertiary)">Phase</th>
              <th style="padding:8px 12px;text-align:left;font-weight:500;font-size:11px;color:var(--text-tertiary);white-space:nowrap">Start</th>
              <th style="padding:8px 12px;text-align:left;font-weight:500;font-size:11px;color:var(--text-tertiary);white-space:nowrap">End</th>
              <th style="padding:8px 12px;text-align:center;font-weight:500;font-size:11px;color:var(--text-tertiary);white-space:nowrap">Dur.</th>
              ${hasPortal ? `<th style="padding:8px 12px;text-align:center;font-weight:500;font-size:11px;color:var(--text-tertiary)">Portal</th>` : ''}
              <th style="padding:8px 12px;text-align:right;font-weight:500;font-size:11px;color:var(--text-tertiary)"></th>
            </tr>
          </thead>
          <tbody>
            ${phases.map((ph, i) => {
              const days = (ph.start_date && ph.end_date)
                ? Math.round((new Date(ph.end_date) - new Date(ph.start_date)) / 86400000) + 1
                : null
              return `<tr style="border-top:1px solid var(--border-light);${i % 2 ? 'background:var(--bg-secondary)' : ''}">
                <td style="padding:9px 12px">
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${ph.color || '#C47E3A'}"></div>
                    <span style="font-weight:500">${esc(ph.name)}</span>
                  </div>
                </td>
                <td style="padding:9px 12px;color:var(--text-secondary)">${fmtD(ph.start_date)}</td>
                <td style="padding:9px 12px;color:var(--text-secondary)">${fmtD(ph.end_date)}</td>
                <td style="padding:9px 12px;text-align:center;color:var(--text-tertiary)">${days ? days + 'd' : '—'}</td>
                ${hasPortal ? `<td style="padding:9px 12px;text-align:center">
                  <input type="checkbox" class="pps-portal-toggle" data-phase-id="${ph.id}" ${ph.show_in_portal ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent)" title="${ph.show_in_portal ? 'Visible in client portal' : 'Hidden from client portal'}" />
                </td>` : ''}
                <td style="padding:9px 12px;text-align:right">
                  <button class="db-action-link pps-edit-phase" data-phase-id="${ph.id}" style="font-size:11px;padding:2px 8px;border:1px solid var(--border-light);border-radius:var(--radius-sm);background:var(--bg-secondary)">Edit</button>
                </td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>`
  }

  _bindPpsContent(container, pps, project) {
    container.querySelector('#pps-add-phase')?.addEventListener('click', () => {
      this._openPhaseModal(null, pps, project, container)
    })

    container.querySelectorAll('.pps-edit-phase').forEach(btn => {
      btn.addEventListener('click', () => {
        const phase = (pps.phases || []).find(ph => ph.id === btn.dataset.phaseId)
        if (phase) this._openPhaseModal(phase, pps, project, container)
      })
    })

    container.querySelectorAll('.pps-portal-toggle').forEach(cb => {
      cb.addEventListener('change', async () => {
        const phaseId = cb.dataset.phaseId
        try {
          const { updatePpsPhase } = await import('../db/client.js')
          const updated = await updatePpsPhase(phaseId, { show_in_portal: cb.checked })
          const ph = (pps.phases || []).find(p => p.id === phaseId)
          if (ph) ph.show_in_portal = cb.checked
        } catch (e) { console.error(e); cb.checked = !cb.checked }
      })
    })
  }

  // ── Phase modal ───────────────────────────────────────────────────────────────

  _openPhaseModal(phase, pps, project, container) {
    document.getElementById('pps-phase-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'pps-phase-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px 16px'

    const selColor = phase?.color || '#C47E3A'

    const renderModal = (color = selColor) => {
      const colorSwatches = PRESET_COLORS.map(c =>
        `<div class="pps-swatch${color === c ? ' pps-swatch--sel' : ''}" data-color="${c}"
          style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${color === c ? '#fff' : 'transparent'};flex-shrink:0;transition:border 0.1s"></div>`
      ).join('')

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:420px" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light)">
            <div style="font-size:14px;font-weight:600">${phase ? 'Edit phase' : 'Add phase'}</div>
            <button id="pps-m-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);padding:2px 6px;line-height:1">×</button>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Phase name <span style="color:#ef4444">*</span></div>
              <input type="text" id="pps-m-name" value="${esc(phase?.name || '')}" placeholder="e.g. Hero — Edit" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Start date</div>
                <input type="date" id="pps-m-start" value="${phase?.start_date || ''}" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">End date</div>
                <input type="date" id="pps-m-end" value="${phase?.end_date || ''}" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
              </div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Colour</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${colorSwatches}</div>
            </div>
            ${project.portal_token ? `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="pps-m-portal" ${phase?.show_in_portal ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent)" />
              Show in client portal
            </label>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              ${phase ? `<button id="pps-m-delete" class="btn-cancel" style="color:#ef4444;border-color:rgba(239,68,68,0.35)">Delete</button>` : '<div></div>'}
              <div style="display:flex;gap:8px">
                <button id="pps-m-cancel" class="btn-cancel">Cancel</button>
                <button id="pps-m-save" class="btn-primary">${phase ? 'Save changes' : 'Add phase'}</button>
              </div>
            </div>
          </div>
        </div>`

      overlay.querySelectorAll('.pps-swatch').forEach(sw => {
        sw.addEventListener('click', () => renderModal(sw.dataset.color))
      })

      overlay.querySelector('#pps-m-close')?.addEventListener('click', () => overlay.remove())
      overlay.querySelector('#pps-m-cancel')?.addEventListener('click', () => overlay.remove())

      overlay.querySelector('#pps-m-save')?.addEventListener('click', async () => {
        const name = overlay.querySelector('#pps-m-name')?.value.trim()
        if (!name) { overlay.querySelector('#pps-m-name')?.focus(); return }
        const btn = overlay.querySelector('#pps-m-save')
        if (btn) btn.textContent = 'Saving…'
        const data = {
          name,
          start_date:     overlay.querySelector('#pps-m-start')?.value || null,
          end_date:       overlay.querySelector('#pps-m-end')?.value   || null,
          color:          overlay.querySelector('.pps-swatch--sel')?.dataset.color || '#C47E3A',
          show_in_portal: overlay.querySelector('#pps-m-portal')?.checked ?? false,
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

      overlay.querySelector('#pps-m-delete')?.addEventListener('click', async () => {
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

    renderModal()
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#pps-m-name')?.focus(), 50)
  }
}
