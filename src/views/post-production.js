const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const PRESET_COLORS = ['#4CAF50', '#C47E3A', '#7B6EAB', '#4a90d9', '#d9534f', '#f59e0b', '#06b6d4', '#ec4899', '#6ec96e']

const newId = () => (crypto?.randomUUID ? crypto.randomUUID() : `b-${Date.now()}-${Math.random().toString(36).slice(2)}`)

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
            <div style="font-size:13px;color:var(--text-tertiary);max-width:380px;line-height:1.6">Create a schedule with the standard column headers. Add free-standing blocks within each column for the work happening at that stage.</div>
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
            <div style="font-size:12px;color:var(--text-tertiary)">${phases.length} column${phases.length !== 1 ? 's' : ''}${hasPortal && portalCount ? ` · ${portalCount} visible in portal` : ''}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn-cancel" id="pps-export-pdf" style="font-size:12px;padding:5px 12px">⬇ Export PDF</button>
            <button class="btn-primary" id="pps-add-phase">+ Add column</button>
          </div>
        </div>

        <div style="background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--text-tertiary);font-weight:500;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">Schedule range</span>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <input type="date" id="pps-master-start" value="${pps.start_date || ''}" style="padding:5px 9px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
            <span style="color:var(--text-tertiary);font-size:13px">→</span>
            <input type="date" id="pps-master-end" value="${pps.end_date || ''}" min="${pps.start_date || ''}" data-range-start="pps-master-start" style="padding:5px 9px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
            <button id="pps-save-dates" class="btn-primary" style="padding:5px 12px;font-size:12px">Save</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:11px;color:var(--text-tertiary);font-weight:500;white-space:nowrap">Lead:</span>
            <select id="pps-lead-user" style="padding:4px 8px;font-size:12px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-primary);color:var(--text-primary);font-family:var(--font)">
              <option value="">— None —</option>
              ${(this.app.allUsers || []).map(u => `<option value="${u.id}" ${u.id === (pps.lead_assignee_id || '') ? 'selected' : ''}>${esc(u.name || u.email.split('@')[0])}</option>`).join('')}
            </select>
          </div>
          <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto">Hover a cell for + to add a block · click a block to edit · drag edges to resize · drag block to move</span>
        </div>

        <div id="pps-grid-wrap">
          ${this._renderGrid(pps, phases)}
        </div>
      </div>`

    this._bindContent(container, pps, project)
  }

  // ── PDF Export ────────────────────────────────────────────────────────────────

  _exportPdf(pps, project) {
    const phases = pps.phases || []
    const usersById = {}
    for (const u of (this.app.allUsers || [])) usersById[u.id] = u
    const userName = id => id && usersById[id] ? (usersById[id].name || usersById[id].email?.split('@')[0] || '') : null
    const leadName = userName(pps.lead_assignee_id)

    const fmtDate = ds => {
      if (!ds) return ''
      const d = new Date(ds + 'T00:00:00')
      const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`
    }

    const fmtDateShort = ds => {
      if (!ds) return ''
      const d = new Date(ds + 'T00:00:00')
      const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return `${d.getDate()} ${MON[d.getMonth()]}`
    }

    // Build flat list of blocks sorted by start date
    const allBlocks = []
    for (const ph of phases) {
      for (const b of (ph.blocks || [])) {
        if (b && b.start_date && b.end_date) allBlocks.push({ ...b, _phaseName: ph.name, _phaseColor: ph.color || '#C47E3A' })
      }
    }
    allBlocks.sort((a, b) => a.start_date.localeCompare(b.start_date))

    // Gantt: calculate timeline bounds
    const schedStart = pps.start_date
    const schedEnd   = pps.end_date
    if (!schedStart || !schedEnd) {
      this.app.toast('Set a schedule range before exporting')
      return
    }
    const tStart = new Date(schedStart + 'T00:00:00')
    const tEnd   = new Date(schedEnd   + 'T00:00:00')
    const totalDays = Math.round((tEnd - tStart) / 86400000) + 1

    // Build month header spans for the Gantt
    const monthSpans = []
    let cursor = new Date(tStart)
    while (cursor <= tEnd) {
      const y = cursor.getFullYear(), m = cursor.getMonth()
      const monthEnd = new Date(Math.min(+new Date(y, m + 1, 0), +tEnd))
      const spanDays = Math.round((monthEnd - cursor) / 86400000) + 1
      const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      monthSpans.push({ label: `${MON[m]} ${y}`, days: spanDays })
      cursor = new Date(y, m + 1, 1)
    }

    const pct = (ds, de) => {
      const s = Math.max(0, Math.round((new Date(ds + 'T00:00:00') - tStart) / 86400000))
      const e = Math.min(totalDays - 1, Math.round((new Date(de + 'T00:00:00') - tStart) / 86400000))
      const left = (s / totalDays * 100).toFixed(2)
      const width = Math.max(0.5, ((e - s + 1) / totalDays * 100)).toFixed(2)
      return { left, width }
    }

    // Gantt rows — one row per phase
    const ganttRows = phases.map(ph => {
      const blocks = (ph.blocks || []).filter(b => b && b.start_date && b.end_date)
      const bars = blocks.map(b => {
        const { left, width } = pct(b.start_date, b.end_date)
        const color = b.color || ph.color || '#C47E3A'
        const opacity = b.is_complete ? 0.45 : 0.8
        const labelEnd = b.start_date === b.end_date
          ? fmtDateShort(b.start_date)
          : `${fmtDateShort(b.start_date)} – ${fmtDateShort(b.end_date)}`
        const rightPct = (parseFloat(left) + parseFloat(width)).toFixed(2)
        return `
        <div style="position:absolute;left:${left}%;width:${width}%;top:4px;bottom:4px;background:${color};opacity:${opacity};border-radius:3px;overflow:hidden;display:flex;align-items:center;padding:0 4px;box-sizing:border-box" title="${b.title || ''}">
          ${b.title ? `<span style="font-size:8px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;letter-spacing:0.3px;text-transform:uppercase">${b.is_complete ? '✓ ' : ''}${b.title}</span>` : ''}
        </div>
        <div style="position:absolute;left:calc(${rightPct}% + 3px);top:50%;transform:translateY(-50%);white-space:nowrap;font-size:8px;color:#555;line-height:1">${labelEnd}</div>`
      }).join('')
      return `<tr>
        <td style="padding:0 10px 0 0;white-space:nowrap;font-size:10px;font-weight:600;color:#333;width:130px;min-width:130px;vertical-align:middle">
          <div style="display:flex;align-items:center;gap:5px">
            <div style="width:8px;height:8px;border-radius:50%;background:${ph.color || '#C47E3A'};flex-shrink:0"></div>
            ${ph.name}
          </div>
        </td>
        <td style="position:relative;height:28px">${bars}</td>
      </tr>`
    }).join('')

    // Month tick marks for the Gantt header
    const monthTicks = monthSpans.map(ms => `<th style="font-size:8px;color:#888;font-weight:500;border-left:1px solid #e5e5e5;padding:3px 4px;text-align:left;width:${(ms.days/totalDays*100).toFixed(2)}%">${ms.label}</th>`).join('')

    // List table rows
    const listRows = allBlocks.map(b => {
      const sameYear = b.start_date?.slice(0,4) === b.end_date?.slice(0,4)
      const dateRange = b.start_date === b.end_date
        ? fmtDate(b.start_date)
        : `${sameYear ? fmtDateShort(b.start_date) : fmtDate(b.start_date)} – ${fmtDate(b.end_date)}`
      return `<tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:6px 10px 6px 0;vertical-align:top">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:8px;height:8px;border-radius:50%;background:${b._phaseColor};flex-shrink:0;margin-top:1px"></div>
            <span style="font-size:10px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:0.3px">${b._phaseName}</span>
          </div>
        </td>
        <td style="padding:6px 10px;vertical-align:top">
          <div style="font-size:11px;font-weight:${b.title ? '600' : '400'};color:${b.title ? '#111' : '#aaa'}${b.is_complete ? ';text-decoration:line-through;color:#888' : ''}">${b.title || '(untitled)'}</div>
          ${b.notes ? `<div style="font-size:10px;color:#777;margin-top:2px;line-height:1.4">${b.notes}</div>` : ''}
        </td>
        <td style="padding:6px 10px;font-size:10px;color:#555;white-space:nowrap;vertical-align:top">${dateRange}</td>
        <td style="padding:6px 0;font-size:10px;vertical-align:top;text-align:center">${b.is_complete ? '<span style="color:#4caf50;font-weight:700">✓</span>' : b.is_deadline ? '<span style="color:#d9534f;font-size:9px;font-weight:600">DEADLINE</span>' : ''}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${project.name || 'Post Production Schedule'} — Schedule</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; color: #111; background: #fff; padding: 36px 40px }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 2px }
  .meta { font-size: 11px; color: #777; margin-bottom: 28px; line-height: 1.6 }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 2px solid #111 }
  table { border-collapse: collapse; width: 100% }
  @media print {
    body { padding: 20px 24px }
    @page { margin: 1.5cm; size: A4 landscape }
  }
</style>
</head>
<body>
  <h1>${project.name || 'Post Production Schedule'}</h1>
  <div class="meta">
    Post Production Schedule
    ${leadName ? `&nbsp;·&nbsp; Lead: <strong>${leadName}</strong>` : ''}
    &nbsp;·&nbsp; ${fmtDate(schedStart)} – ${fmtDate(schedEnd)}
    &nbsp;·&nbsp; ${phases.length} phase${phases.length !== 1 ? 's' : ''}, ${allBlocks.length} block${allBlocks.length !== 1 ? 's' : ''}
    &nbsp;·&nbsp; <span style="color:#aaa">Generated ${fmtDate(new Date().toISOString().slice(0,10))}</span>
  </div>

  <div class="section-title" style="margin-bottom:14px">Timeline</div>
  <table style="margin-bottom:32px;table-layout:fixed">
    <thead>
      <tr>
        <th style="width:130px;min-width:130px"></th>
        <th style="padding:0"><table style="width:100%;table-layout:fixed;border-collapse:collapse"><thead><tr>${monthTicks}</tr></thead></table></th>
      </tr>
    </thead>
    <tbody>${ganttRows}</tbody>
  </table>

  <div class="section-title" style="margin-bottom:10px">Schedule</div>
  <table>
    <thead>
      <tr style="border-bottom:2px solid #111">
        <th style="padding:5px 10px 5px 0;font-size:9px;text-align:left;color:#888;text-transform:uppercase;letter-spacing:0.5px;width:130px">Phase</th>
        <th style="padding:5px 10px;font-size:9px;text-align:left;color:#888;text-transform:uppercase;letter-spacing:0.5px">Task</th>
        <th style="padding:5px 10px;font-size:9px;text-align:left;color:#888;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;width:160px">Dates</th>
        <th style="padding:5px 0;font-size:9px;text-align:center;color:#888;text-transform:uppercase;letter-spacing:0.5px;width:60px">Status</th>
      </tr>
    </thead>
    <tbody>${listRows}</tbody>
  </table>

  <script>window.onload = () => window.print()<\/script>
</body>
</html>`

    const win = window.open('', '_blank')
    if (!win) { this.app.toast('Allow pop-ups to export PDF'); return }
    win.document.write(html)
    win.document.close()
  }

  // ── Grid (date rows × column columns, free-standing blocks within) ───────────

  _renderGrid(pps, phases) {
    if (!pps.start_date || !pps.end_date) {
      return `<div style="padding:28px;text-align:center;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md)">
        <div style="font-size:13px;color:var(--text-tertiary)">Set a schedule range above to see the grid</div>
      </div>`
    }
    if (!phases.length) {
      return `<div style="padding:28px;text-align:center;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md)">
        <div style="font-size:13px;color:var(--text-tertiary)">Add a column to populate the grid</div>
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

    const usersById = {}
    for (const u of (this.app.allUsers || [])) usersById[u.id] = u
    const userName = u => u ? (u.name || u.email?.split('@')[0] || '') : ''
    // Local calendar date (matches the modal's date-input format — avoids UTC drift on write)
    const localKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    // Per-column: map each day → the block covering it, plus first/last visible day per block
    const phaseData = phases.map(ph => {
      const blocks = (ph.blocks || []).filter(b => b && b.start_date && b.end_date)
      const dayBlock = {}
      for (const b of blocks) {
        const bs = new Date(b.start_date + 'T00:00:00')
        const be = new Date(b.end_date   + 'T00:00:00')
        if (be < bs) continue
        for (let d = new Date(bs); d <= be; d.setDate(d.getDate() + 1)) {
          const ds = d.toISOString().slice(0, 10)
          if (!dayBlock[ds]) dayBlock[ds] = b   // first block wins on overlap
        }
      }
      const firstByBlock = {}, lastByBlock = {}
      for (const d of days) {
        const ds = d.toISOString().slice(0, 10)
        const b = dayBlock[ds]
        if (b) { if (!firstByBlock[b.id]) firstByBlock[b.id] = ds; lastByBlock[b.id] = ds }
      }
      return { dayBlock, firstByBlock, lastByBlock }
    })

    const CELL_W = 82
    const abbr = s => s.length > 13 ? s.slice(0, 11) + '…' : s

    return `
      <div style="overflow-x:auto;border:1px solid var(--border-light);border-radius:var(--radius-md)">
        <table style="border-collapse:collapse;font-size:12px;min-width:${90 + phases.length * CELL_W + 36}px">
          <thead>
            <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border-light)">
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:400;color:var(--text-tertiary);width:90px;white-space:nowrap;position:sticky;left:0;background:var(--bg-secondary);z-index:2;border-right:1px solid var(--border-light)">Date</th>
              ${phases.map(ph => {
                const blockCount = (ph.blocks || []).filter(b => b).length
                return `<th class="pps-phase-header" data-phase-id="${ph.id}"
                  style="padding:8px 6px;text-align:center;cursor:pointer;width:${CELL_W}px;min-width:${CELL_W}px;max-width:${CELL_W}px;border-left:1px solid var(--border-light)"
                  title="Click to edit column · ${esc(ph.name)}">
                  <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
                    <div style="width:10px;height:10px;border-radius:50%;background:${ph.color || '#C47E3A'};flex-shrink:0"></div>
                    <div style="font-size:10px;font-weight:600;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${CELL_W - 12}px;text-transform:uppercase;letter-spacing:0.3px">${esc(abbr(ph.name))}</div>
                    <div style="font-size:9px;color:var(--text-tertiary);white-space:nowrap">${blockCount ? blockCount + ' block' + (blockCount !== 1 ? 's' : '') : '—'}</div>
                  </div>
                </th>`
              }).join('')}
              <th style="width:36px;min-width:36px;border-left:1px solid var(--border-light)">
                <div style="display:flex;align-items:center;justify-content:center">
                  <button id="pps-add-phase-col" title="Add column" style="background:none;border:1px solid var(--border-light);color:var(--text-tertiary);border-radius:var(--radius-md);width:22px;height:22px;cursor:pointer;font-size:16px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center">+</button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            ${days.map(d => {
              const ds = d.toISOString().slice(0, 10)
              const dkey = localKey(d)
              const dow = DOW[d.getDay()]
              const isWeekend = d.getDay() === 0 || d.getDay() === 6
              const isToday = d.getTime() === today.getTime()
              const isMonthStart = d.getDate() === 1

              const dateBg = isToday
                ? 'rgba(var(--accent-rgb),0.06)'
                : isWeekend
                  ? 'var(--bg-secondary)'
                  : 'var(--bg-primary)'

              const dateLabel = `${d.getDate()} ${MON[d.getMonth()]}`
              const monthLabel = isMonthStart
                ? `<div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;margin-top:1px">${MON[d.getMonth()]} ${d.getFullYear()}</div>`
                : ''

              return `<tr style="border-bottom:1px solid var(--border-light);opacity:${isWeekend ? '0.5' : '1'}${isToday ? ';outline:1px solid rgba(var(--accent-rgb),0.25);outline-offset:-1px' : ''}">
                <td style="padding:3px 12px;white-space:nowrap;font-size:11px;position:sticky;left:0;background:${dateBg};z-index:1;border-right:1px solid var(--border-light)">
                  <div style="display:flex;align-items:baseline;gap:5px">
                    <span style="color:var(--text-tertiary);font-size:10px;width:24px;flex-shrink:0">${dow}</span>
                    <span style="color:${isToday ? 'var(--accent)' : 'var(--text-secondary)'};font-weight:${isToday ? '700' : '400'}">${dateLabel}</span>
                  </div>
                  ${monthLabel}
                </td>
                ${phases.map((ph, pi) => {
                  const { dayBlock, firstByBlock, lastByBlock } = phaseData[pi]
                  const block = dayBlock[ds]
                  if (!block) return `<td class="pps-empty-cell" data-phase-id="${ph.id}" data-date="${dkey}" style="border-left:1px solid var(--border-light);cursor:pointer;text-align:center;vertical-align:middle">
                    <span class="pps-add-hint" style="opacity:0;font-size:14px;line-height:1;color:${ph.color || '#C47E3A'};transition:opacity 0.1s;pointer-events:none;user-select:none">+</span>
                  </td>`
                  const isFirst = firstByBlock[block.id] === ds
                  const isLast  = lastByBlock[block.id]  === ds
                  const color = block.color || ph.color || '#C47E3A'
                  const rgba25 = _hexRgba(color, block.is_complete ? 0.10 : 0.22)
                  const rgba55 = _hexRgba(color, block.is_complete ? 0.30 : 0.55)
                  const assignee = block.assignee_id ? usersById[block.assignee_id] : null
                  const assigneeName = userName(assignee)
                  const blockTitle = block.title || ''
                  return `<td class="pps-block-cell" data-phase-id="${ph.id}" data-block-id="${block.id}" data-date="${dkey}"
                    title="Click to edit · drag edges to resize · drag to move${blockTitle ? ' · ' + esc(blockTitle) : ''}${assigneeName ? ' · ' + esc(assigneeName) : ''}${block.is_complete ? ' · ✓ Complete' : ''}"
                    style="position:relative;border-left:2px solid ${rgba55};${isFirst ? `border-top:2px solid ${rgba55};` : ''}${isLast ? `border-bottom:2px solid ${rgba55};` : ''}background:${rgba25};padding:2px 6px;cursor:grab;${block.is_complete ? 'opacity:0.55;' : ''}">
                    ${isFirst ? `<div class="pps-resize-handle" data-phase-id="${ph.id}" data-block-id="${block.id}" data-edge="start" style="position:absolute;top:0;left:0;right:0;height:6px;cursor:ns-resize;color:${color}"></div>` : ''}
                    ${isFirst && block.is_complete ? `<div style="font-size:9px;color:#6ec96e;font-weight:700;line-height:1.2">✓</div>` : ''}
                    ${isFirst && blockTitle ? `<div style="font-size:9px;font-weight:700;color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${CELL_W - 12}px;text-transform:uppercase;letter-spacing:0.3px;${block.is_complete ? 'text-decoration:line-through;' : ''}" title="${esc(blockTitle)}">${esc(blockTitle)}</div>` : ''}
                    ${isFirst && assigneeName ? `<div style="font-size:9px;color:${color};opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${CELL_W - 12}px" title="${esc(assigneeName)}">${esc(abbr(assigneeName))}</div>` : ''}
                    ${isLast ? `<div class="pps-resize-handle" data-phase-id="${ph.id}" data-block-id="${block.id}" data-edge="end" style="position:absolute;bottom:0;left:0;right:0;height:6px;cursor:ns-resize;color:${color}"></div>` : ''}
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
    container.querySelector('#pps-add-phase')?.addEventListener('click', () => {
      this._openColumnModal(null, pps, project, container)
    })

    container.querySelector('#pps-export-pdf')?.addEventListener('click', () => {
      this._exportPdf(pps, project)
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
        this._rerenderGrid(container, pps, project)
        if (btn) btn.textContent = '✓ Saved'
        setTimeout(() => { if (btn && btn.textContent === '✓ Saved') btn.textContent = 'Save' }, 1500)
      } catch (e) {
        console.error(e)
        if (btn) btn.textContent = 'Error'
        setTimeout(() => { if (btn) btn.textContent = 'Save' }, 1500)
      }
    })

    container.querySelector('#pps-lead-user')?.addEventListener('change', async e => {
      const leadId = e.target.value || null
      pps.lead_assignee_id = leadId
      try {
        const { updatePpsScheduleDates } = await import('../db/client.js')
        await updatePpsScheduleDates(pps.id, { lead_assignee_id: leadId })
      } catch (err) { console.error(err) }
    })

    this._bindGrid(container, pps, project)
  }

  _bindGrid(container, pps, project) {
    container.querySelectorAll('.pps-phase-header').forEach(th => {
      th.addEventListener('mouseenter', () => { th.style.background = 'var(--bg-secondary)' })
      th.addEventListener('mouseleave', () => { th.style.background = '' })
      th.addEventListener('click', () => {
        const phase = (pps.phases || []).find(ph => ph.id === th.dataset.phaseId)
        if (phase) this._openColumnModal(phase, pps, project, container)
      })
    })

    // Click a block to edit · pointerdown to drag-to-move
    container.querySelectorAll('.pps-block-cell').forEach(cell => {
      cell.addEventListener('click', e => {
        if (e.target.closest('.pps-resize-handle')) return
        const phase = (pps.phases || []).find(ph => ph.id === cell.dataset.phaseId)
        const block = phase && (phase.blocks || []).find(b => b.id === cell.dataset.blockId)
        if (phase && block) this._openBlockModal(phase, block, null, pps, project, container)
      })
      cell.addEventListener('pointerdown', e => {
        if (e.target.closest('.pps-resize-handle')) return
        this._startMove(e, cell, pps, project, container)
      })
    })

    // Drag a block's top/bottom edge to resize (change its start/end date)
    container.querySelectorAll('.pps-resize-handle').forEach(handle => {
      handle.addEventListener('pointerdown', e => this._startResize(e, handle, pps, project, container))
    })

    // +button in each empty calendar field — visible on rollover, adds a free-standing block
    container.querySelectorAll('.pps-empty-cell').forEach(cell => {
      const hint = cell.querySelector('.pps-add-hint')
      cell.addEventListener('mouseenter', () => { if (hint) hint.style.opacity = '0.7' })
      cell.addEventListener('mouseleave', () => { if (hint) hint.style.opacity = '0' })
      cell.addEventListener('click', () => {
        const phase = (pps.phases || []).find(ph => ph.id === cell.dataset.phaseId)
        if (phase) this._openBlockModal(phase, null, cell.dataset.date, pps, project, container)
      })
    })

    container.querySelector('#pps-add-phase-col')?.addEventListener('click', () => {
      this._openColumnModal(null, pps, project, container)
    })
  }

  _rerenderGrid(container, pps, project) {
    const gridWrap = container.querySelector('#pps-grid-wrap')
    if (gridWrap) {
      gridWrap.innerHTML = this._renderGrid(pps, pps.phases || [])
      this._bindGrid(container, pps, project)
    }
  }

  // ── Block operations ────────────────────────────────────────────────────────

  async _persistBlocks(phase) {
    const { updatePpsPhase } = await import('../db/client.js')
    await updatePpsPhase(phase.id, { blocks: phase.blocks })
    this._invalidateTeamCalendar()
  }

  // Force the dashboard team calendar to reload PPS-derived entries next time it renders
  _invalidateTeamCalendar() {
    if (this.app.teamCalendarView) this.app.teamCalendarView._ppsPhasesCache = null
  }

  // Drag a block's top (start) or bottom (end) edge to resize it
  _startResize(e, handle, pps, project, container) {
    e.preventDefault()
    e.stopPropagation()
    const edge  = handle.dataset.edge
    const phase = (pps.phases || []).find(p => p.id === handle.dataset.phaseId)
    const block = phase && (phase.blocks || []).find(b => b.id === handle.dataset.blockId)
    if (!block || !block.start_date || !block.end_date) return

    const orig = { start: block.start_date, end: block.end_date }
    let lastDate = null
    document.body.classList.add('is-resizing')

    const onMove = ev => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      const dateCell = el?.closest('tr')?.querySelector('[data-date]')
      const date = dateCell?.dataset.date
      if (!date || date === lastDate) return
      lastDate = date
      let s = orig.start, en = orig.end
      if (edge === 'start') s = date <= orig.end ? date : orig.end
      else                  en = date >= orig.start ? date : orig.start
      if (s === block.start_date && en === block.end_date) return
      block.start_date = s
      block.end_date   = en
      this._rerenderGrid(container, pps, project)
    }

    const onUp = async () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.classList.remove('is-resizing')
      if (block.start_date === orig.start && block.end_date === orig.end) return
      try { await this._persistBlocks(phase) }
      catch (err) {
        console.error(err)
        block.start_date = orig.start
        block.end_date   = orig.end
        this._rerenderGrid(container, pps, project)
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  // Drag a block's body to shift its start + end dates by the same offset
  _startMove(e, cell, pps, project, container) {
    e.preventDefault()
    const phase = (pps.phases || []).find(p => p.id === cell.dataset.phaseId)
    const block = phase && (phase.blocks || []).find(b => b.id === cell.dataset.blockId)
    if (!block || !block.start_date || !block.end_date) return

    const startX = e.clientX, startY = e.clientY
    const dragFromDate = cell.dataset.date
    const origStart = block.start_date, origEnd = block.end_date
    let moved = false, lastDate = null

    const shiftDate = (ds, days) => {
      const d = new Date(ds + 'T00:00:00')
      d.setDate(d.getDate() + days)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    const onMove = ev => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return
      if (!moved) { moved = true; document.body.classList.add('is-resizing') }
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      const date = el?.closest('td[data-date]')?.dataset.date
      if (!date || date === lastDate) return
      lastDate = date
      const offsetDays = Math.round((new Date(date + 'T00:00:00') - new Date(dragFromDate + 'T00:00:00')) / 86400000)
      block.start_date = shiftDate(origStart, offsetDays)
      block.end_date   = shiftDate(origEnd,   offsetDays)
      this._rerenderGrid(container, pps, project)
    }

    const onUp = async () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup',   onUp)
      document.body.classList.remove('is-resizing')
      if (!moved) return
      const suppressClick = ev => { ev.stopImmediatePropagation(); document.removeEventListener('click', suppressClick, true) }
      document.addEventListener('click', suppressClick, true)
      if (block.start_date === origStart && block.end_date === origEnd) return
      try { await this._persistBlocks(phase) }
      catch (err) {
        console.error(err)
        block.start_date = origStart
        block.end_date   = origEnd
        this._rerenderGrid(container, pps, project)
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup',   onUp)
  }

  // ── Block modal (title / notes / dates / colour / team member) ───────────────

  _openBlockModal(phase, block, defaultDate, pps, project, container) {
    document.getElementById('pps-block-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'pps-block-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px 16px'

    const users = this.app.allUsers || []
    const isNew = !block
    const data = block
      ? { ...block }
      : { id: newId(), title: '', notes: '', start_date: defaultDate || '', end_date: defaultDate || '', color: null, assignee_id: pps.lead_assignee_id || null, is_deadline: false, is_complete: false, show_in_portal: false }
    let selColor = data.color || ''   // '' = inherit column colour

    const render = () => {
      const autoSwatch = `<div class="pps-sw${selColor === '' ? ' pps-sw-sel' : ''}" data-c=""
        style="width:22px;height:22px;border-radius:50%;background:var(--bg-tertiary,#333);cursor:pointer;border:2px solid ${selColor === '' ? 'var(--accent)' : 'var(--border-med)'};font-size:8px;display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);flex-shrink:0" title="Inherit column colour">auto</div>`
      const swatches = autoSwatch + PRESET_COLORS.map(c =>
        `<div class="pps-sw${selColor === c ? ' pps-sw-sel' : ''}" data-c="${c}"
          style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${selColor === c ? '#fff' : 'transparent'};flex-shrink:0"></div>`
      ).join('')

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:440px;max-height:90vh;overflow-y:auto" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light)">
            <div style="font-size:14px;font-weight:600">${isNew ? 'Add block' : 'Edit block'} <span style="font-weight:400;color:var(--text-tertiary)">· ${esc(phase.name)}</span></div>
            <button id="ppsb-x" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);padding:2px 6px;line-height:1">×</button>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Title</label>
              <input type="text" id="ppsb-title" value="${esc(data.title || '')}" placeholder="e.g. HERO — Edit, EOP V1 Watch…" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Start date <span style="color:var(--danger)">*</span></label>
                <input type="date" id="ppsb-start" value="${data.start_date || ''}" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
              </div>
              <div>
                <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">End date <span style="color:var(--danger)">*</span></label>
                <input type="date" id="ppsb-end" value="${data.end_date || ''}" min="${data.start_date || ''}" data-range-start="ppsb-start" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
              </div>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Notes</label>
              <textarea id="ppsb-notes" rows="2" placeholder="What's happening in this block…" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);resize:vertical">${esc(data.notes || '')}</textarea>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Team member</label>
              <select id="ppsb-assignee" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                <option value="">— None —</option>
                ${users.map(u => `<option value="${u.id}" ${u.id === data.assignee_id ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
              </select>
              <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px">Assigning a member adds this block to their team calendar on the dashboard.</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:7px">Colour</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${swatches}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;padding-top:2px;border-top:1px solid var(--border-light)">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-primary);margin-top:6px">
                <input type="checkbox" id="ppsb-deadline" ${data.is_deadline ? 'checked' : ''} style="cursor:pointer;accent-color:var(--danger);width:14px;height:14px;flex-shrink:0" />
                <span>Deadline</span>
                <span style="font-size:11px;color:var(--text-tertiary)">(shows in dashboard "Edit Deadlines")</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-primary)">
                <input type="checkbox" id="ppsb-complete" ${data.is_complete ? 'checked' : ''} style="cursor:pointer;accent-color:#6ec96e;width:14px;height:14px;flex-shrink:0" />
                <span>Mark as complete</span>
              </label>
              ${project.portal_token ? `
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-primary)">
                <input type="checkbox" id="ppsb-portal" ${data.show_in_portal ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent);width:14px;height:14px;flex-shrink:0" />
                <span>Show in client portal</span>
              </label>` : ''}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px">
              ${!isNew ? `<button id="ppsb-del" class="btn-danger">Delete</button>` : '<div></div>'}
              <div style="display:flex;gap:8px">
                <button id="ppsb-cancel" class="btn-cancel">Cancel</button>
                <button id="ppsb-save" class="btn-primary">${isNew ? 'Add block' : 'Save changes'}</button>
              </div>
            </div>
          </div>
        </div>`

      overlay.querySelectorAll('.pps-sw').forEach(sw => {
        sw.addEventListener('click', () => {
          selColor = sw.dataset.c
          data.title = overlay.querySelector('#ppsb-title')?.value ?? data.title
          data.notes = overlay.querySelector('#ppsb-notes')?.value ?? data.notes
          data.start_date = overlay.querySelector('#ppsb-start')?.value ?? data.start_date
          data.end_date   = overlay.querySelector('#ppsb-end')?.value ?? data.end_date
          data.assignee_id = overlay.querySelector('#ppsb-assignee')?.value || null
          data.is_deadline = overlay.querySelector('#ppsb-deadline')?.checked ?? data.is_deadline
          data.is_complete = overlay.querySelector('#ppsb-complete')?.checked ?? data.is_complete
          data.show_in_portal = overlay.querySelector('#ppsb-portal')?.checked ?? data.show_in_portal
          render()
        })
      })
      overlay.querySelector('#ppsb-x')?.addEventListener('click',      () => overlay.remove())
      overlay.querySelector('#ppsb-cancel')?.addEventListener('click', () => overlay.remove())

      overlay.querySelector('#ppsb-save')?.addEventListener('click', async () => {
        const startVal = overlay.querySelector('#ppsb-start')?.value || ''
        const endVal   = overlay.querySelector('#ppsb-end')?.value   || ''
        if (!startVal || !endVal) { overlay.querySelector('#ppsb-start')?.focus(); return }
        // Normalise so start <= end
        const s = startVal <= endVal ? startVal : endVal
        const en = startVal <= endVal ? endVal : startVal
        const btn = overlay.querySelector('#ppsb-save')
        if (btn) btn.textContent = 'Saving…'
        const next = {
          id:             data.id,
          title:          overlay.querySelector('#ppsb-title')?.value.trim() || '',
          notes:          overlay.querySelector('#ppsb-notes')?.value.trim() || '',
          start_date:     s,
          end_date:       en,
          color:          selColor || null,
          assignee_id:    overlay.querySelector('#ppsb-assignee')?.value || null,
          is_deadline:    overlay.querySelector('#ppsb-deadline')?.checked || false,
          is_complete:    overlay.querySelector('#ppsb-complete')?.checked || false,
          show_in_portal: overlay.querySelector('#ppsb-portal')?.checked ?? (data.show_in_portal || false),
        }
        if (!phase.blocks) phase.blocks = []
        const idx = phase.blocks.findIndex(b => b.id === data.id)
        const prev = phase.blocks.slice()
        if (idx >= 0) phase.blocks[idx] = next
        else phase.blocks = [...phase.blocks, next]
        try {
          await this._persistBlocks(phase)
          overlay.remove()
          this._renderPpsContent(container, pps, project)
        } catch (e) {
          console.error(e)
          phase.blocks = prev
          if (btn) btn.textContent = 'Error — retry'
        }
      })

      overlay.querySelector('#ppsb-del')?.addEventListener('click', async () => {
        if (isNew) return
        if (!await this.app.confirm({ title: 'Delete this block?', confirmLabel: 'Delete' })) return
        const prev = phase.blocks.slice()
        phase.blocks = phase.blocks.filter(b => b.id !== data.id)
        try {
          await this._persistBlocks(phase)
          overlay.remove()
          this._renderPpsContent(container, pps, project)
        } catch (e) { console.error(e); phase.blocks = prev }
      })
    }

    render()
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#ppsb-title')?.focus(), 50)
  }

  // ── Column modal (header / colour / portal visibility) ───────────────────────

  _openColumnModal(phase, pps, project, container) {
    document.getElementById('pps-col-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'pps-col-modal'
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
            <div style="font-size:14px;font-weight:600">${phase ? 'Edit column' : 'Add column'}</div>
            <button id="ppsc-x" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);padding:2px 6px;line-height:1">×</button>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div>
              <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Column header <span style="color:var(--danger)">*</span></label>
              <input type="text" id="ppsc-name" value="${esc(phase?.name || '')}" placeholder="e.g. V1 Edits" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)" />
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:7px">Default colour</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${swatches}</div>
            </div>
            ${project.portal_token ? `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="ppsc-portal" ${phase?.show_in_portal ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent)" />
              Show in client portal
            </label>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px">
              ${phase ? `<button id="ppsc-del" class="btn-danger">Delete column</button>` : '<div></div>'}
              <div style="display:flex;gap:8px">
                <button id="ppsc-cancel" class="btn-cancel">Cancel</button>
                <button id="ppsc-save" class="btn-primary">${phase ? 'Save changes' : 'Add column'}</button>
              </div>
            </div>
          </div>
        </div>`

      overlay.querySelectorAll('.pps-sw').forEach(sw => {
        sw.addEventListener('click', () => { selColor = sw.dataset.c; render() })
      })
      overlay.querySelector('#ppsc-x')?.addEventListener('click',      () => overlay.remove())
      overlay.querySelector('#ppsc-cancel')?.addEventListener('click', () => overlay.remove())

      overlay.querySelector('#ppsc-save')?.addEventListener('click', async () => {
        const name = overlay.querySelector('#ppsc-name')?.value.trim()
        if (!name) { overlay.querySelector('#ppsc-name')?.focus(); return }
        const btn = overlay.querySelector('#ppsc-save')
        if (btn) btn.textContent = 'Saving…'
        const meta = {
          name,
          color:          selColor,
          show_in_portal: overlay.querySelector('#ppsc-portal')?.checked ?? false,
        }
        try {
          const { createPpsPhase, updatePpsPhase } = await import('../db/client.js')
          if (phase) {
            await updatePpsPhase(phase.id, meta)
            Object.assign(phase, meta)
          } else {
            const created = await createPpsPhase(pps.id, { ...meta, blocks: [], sort_order: (pps.phases || []).length })
            if (!created.blocks) created.blocks = []
            if (!pps.phases) pps.phases = []
            pps.phases.push(created)
          }
          this._invalidateTeamCalendar()
          overlay.remove()
          this._renderPpsContent(container, pps, project)
        } catch (e) {
          console.error(e)
          if (btn) btn.textContent = 'Error — retry'
        }
      })

      overlay.querySelector('#ppsc-del')?.addEventListener('click', async () => {
        if (!phase) return
        if (!await this.app.confirm({ title: 'Delete column?', message: 'This deletes the column and all its blocks.', confirmLabel: 'Delete' })) return
        try {
          const { deletePpsPhase } = await import('../db/client.js')
          await deletePpsPhase(phase.id)
          pps.phases = (pps.phases || []).filter(p => p.id !== phase.id)
          this._invalidateTeamCalendar()
          overlay.remove()
          this._renderPpsContent(container, pps, project)
        } catch (e) { console.error(e) }
      })
    }

    render()
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#ppsc-name')?.focus(), 50)
  }
}

function _hexRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
