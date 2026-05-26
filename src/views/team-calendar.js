const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const TYPE_COLORS = { shoot: '#4CAF50', post_production: '#C47E3A', other: '#7B6EAB' }
const ENTRY_TYPE_LABELS = { shoot: 'Shoot', post_production: 'Post Production', other: 'Other' }

export class TeamCalendarView {
  constructor(app) {
    this.app = app
    this._expanded  = localStorage.getItem('tc-expanded') !== 'false'
    this._weekOffset = 0
    this._monthOffset = 0      // full-page month view offset from the current month
    this._mode = 'week'        // 'week' (dashboard section) | 'month' (full page)
    this._shootsCache = null   // lazily loaded
    this._ppsPhasesCache = null // lazily loaded — post production phases with an assignee
    this._clipboard = null     // { entry data for paste }
    this._dragOver  = null     // cell currently being dragged over
  }

  // ── Date helpers ──────────────────────────────────────────────────────────────

  _getWeekStart() {
    const now = new Date()
    const day = now.getDay()
    const mon = new Date(now)
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + this._weekOffset * 7)
    mon.setHours(0, 0, 0, 0)
    return mon
  }

  _getWeekDays(weekStart) {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return d
    })
  }

  // First day of the month currently shown in the full-page view.
  _getMonthBase() {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() + this._monthOffset)
    d.setHours(0, 0, 0, 0)
    return d
  }

  _getMonthDays() {
    const base = this._getMonthBase()
    const month = base.getMonth()
    const days = []
    const d = new Date(base)
    while (d.getMonth() === month) { days.push(new Date(d)); d.setDate(d.getDate() + 1) }
    return days
  }

  // Days currently driving the grid — depends on whether we're the dashboard
  // week section or the full-page month view.
  _activeDays() {
    return this._mode === 'month'
      ? this._getMonthDays()
      : this._getWeekDays(this._getWeekStart())
  }

  // ── Full-page month view (left-nav "Calendar") ────────────────────────────────

  renderFullPage(container) {
    this._mode = 'month'
    const section = document.createElement('div')
    section.id = 'tc-section'
    container.innerHTML = ''
    container.appendChild(section)
    this._renderFullPage(section)
  }

  _renderFullPage(section) {
    this._mode = 'month'
    const base  = this._getMonthBase()
    const label = base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    const navBtn = 'background:var(--bg-secondary);border:1px solid var(--border-med);border-radius:var(--radius-md);padding:5px 11px;cursor:pointer;font-size:14px;color:var(--text-secondary);font-family:var(--font);line-height:1.2'

    section.innerHTML = `
      <div style="padding:18px 22px;max-width:1500px;margin:0 auto">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px">
            <button id="tc-fp-prev"  style="${navBtn}" title="Previous month">‹</button>
            <button id="tc-fp-today" style="${navBtn};font-size:12px">Today</button>
            <button id="tc-fp-next"  style="${navBtn}" title="Next month">›</button>
          </div>
          <div id="tc-fp-month" style="font-size:18px;font-weight:600;color:var(--text-primary)">${esc(label)}</div>
        </div>
        <div id="tc-grid-wrap"><div style="font-size:12px;color:var(--text-tertiary);padding:8px 0">Loading…</div></div>
      </div>`

    section.querySelector('#tc-fp-prev')?.addEventListener('click',  () => { this._monthOffset--; this._renderFullPage(section) })
    section.querySelector('#tc-fp-next')?.addEventListener('click',  () => { this._monthOffset++; this._renderFullPage(section) })
    section.querySelector('#tc-fp-today')?.addEventListener('click', () => { this._monthOffset = 0; this._renderFullPage(section) })

    this._loadAndRenderGrid(section)
    this._bindClipboardEscape()
  }

  _dateKey(d) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  _addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00')
    d.setDate(d.getDate() + n)
    return this._dateKey(d)
  }

  // ── Dashboard section ─────────────────────────────────────────────────────────

  renderDashboardSection(container) {
    this._mode = 'week'
    let section = container.querySelector('#tc-section')
    if (!section) {
      section = document.createElement('div')
      section.id = 'tc-section'
      section.style.cssText = 'margin-bottom:20px'
      const cdWidget = container.querySelector('#cd-widget-wrap')
      if (cdWidget) cdWidget.insertAdjacentElement('afterend', section)
      else container.prepend(section)
    }
    this._renderSection(section)
    this._bindSection(section)
  }

  _renderSection(section) {
    const users   = this.app.allUsers || []
    const weekStart = this._getWeekStart()
    const days    = this._getWeekDays(weekStart)
    const entries = this.app.teamCalendarEntries || []
    const weekKeys = new Set(days.map(d => this._dateKey(d)))

    // Count real entries visible this week (multi-day entries count once)
    const weekEntries = entries.filter(e => {
      if (weekKeys.has(e.entry_date)) return true
      if (e.end_date && e.end_date > e.entry_date) {
        // spans into this week?
        for (const k of weekKeys) if (k >= e.entry_date && k <= e.end_date) return true
      }
      return false
    })

    const label0 = days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const label6 = days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const weekLabel = `${label0} – ${label6}`

    section.innerHTML = `
      <div class="db-section-head" style="cursor:pointer;user-select:none" id="tc-toggle">
        <span class="db-section-dot" style="background:var(--accent)"></span>
        Team Calendar
        ${weekEntries.length ? `<span class="db-section-count">${weekEntries.length}</span>` : ''}
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          ${this._expanded ? `
            <button id="tc-prev" style="background:none;border:1px solid var(--border-light);border-radius:var(--radius-md);padding:2px 8px;cursor:pointer;font-size:12px;color:var(--text-secondary);font-family:var(--font);line-height:1.4" onclick="event.stopPropagation()">‹</button>
            <span style="font-size:11px;color:var(--text-tertiary);white-space:nowrap">${esc(weekLabel)}</span>
            <button id="tc-next" style="background:none;border:1px solid var(--border-light);border-radius:var(--radius-md);padding:2px 8px;cursor:pointer;font-size:12px;color:var(--text-secondary);font-family:var(--font);line-height:1.4" onclick="event.stopPropagation()">›</button>
          ` : `<span style="font-size:11px;color:var(--text-tertiary)">${esc(weekLabel)}</span>`}
          <span class="db-chevron${this._expanded ? ' db-chevron--open' : ''}">▶</span>
        </div>
      </div>
      <div id="tc-body" style="display:${this._expanded ? 'block' : 'none'}">
        ${this._expanded ? '<div id="tc-grid-wrap"><div style="font-size:12px;color:var(--text-tertiary);padding:8px 0">Loading…</div></div>' : ''}
      </div>`
  }

  async _loadAndRenderGrid(section) {
    const gridWrap = section.querySelector('#tc-grid-wrap')
    if (!gridWrap) return

    // Lazy-load shoots for auto-populate
    if (this._shootsCache === null) {
      try {
        const { getShootsForCalendar } = await import('../db/client.js')
        this._shootsCache = await getShootsForCalendar(this.app.userId)
      } catch (e) {
        console.error('Could not load shoots for calendar:', e)
        this._shootsCache = []
      }
    }

    // Lazy-load post production phases that have a team member assigned
    if (this._ppsPhasesCache === null) {
      try {
        const { getPpsPhasesForCalendar } = await import('../db/client.js')
        this._ppsPhasesCache = await getPpsPhasesForCalendar(this.app.userId)
      } catch (e) {
        console.error('Could not load post production phases for calendar:', e)
        this._ppsPhasesCache = []
      }
    }

    const users   = this.app.allUsers || []
    const days    = this._activeDays()
    const entries = this.app.teamCalendarEntries || []

    gridWrap.innerHTML = this._renderGrid(days, users, entries)
    this._bindGrid(gridWrap, section)
  }

  _renderGrid(days, users, entries) {
    if (!users.length) return `<div style="font-size:13px;color:var(--text-tertiary);padding:12px 0">No team members found.</div>`

    const today   = new Date(); today.setHours(0, 0, 0, 0)
    const projects = this.app.projects || []

    // Build lookup: userId:dateKey → [entries] with _isFirst/_isLast continuity flags
    const byUserDate = {}
    for (const e of entries) {
      const start = e.entry_date
      const end   = e.end_date || e.entry_date
      for (const day of days) {
        const k = this._dateKey(day)
        if (k >= start && k <= end) {
          const key = `${e.assignee_id}:${k}`
          if (!byUserDate[key]) byUserDate[key] = []
          if (!byUserDate[key].find(x => x.id === e.id)) {
            byUserDate[key].push({ ...e, _isFirst: k === start, _isLast: k === end })
          }
        }
      }
    }

    const shootEntries = this._buildShootEntries(days, users)
    const ppsEntries   = this._buildPpsEntries(days, users)

    const paste = this._clipboard
      ? `<div id="tc-paste-hint" style="font-size:11px;color:var(--accent);margin-top:6px;margin-bottom:2px">📋 Entry copied — click a cell to paste (or press Escape to clear)</div>` : ''

    return `
      ${paste}
      <div id="tc-table-wrap" style="overflow-x:auto;border-radius:var(--radius-md);border:1px solid var(--border-light);position:relative">
        <table id="tc-table" style="width:100%;min-width:${100 + users.length * 150}px;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--bg-secondary)">
              <th style="padding:8px 10px;text-align:left;font-weight:500;font-size:11px;color:var(--text-tertiary);width:110px;border-right:1px solid var(--border-light);white-space:nowrap">Date</th>
              ${users.map(u => `
                <th style="padding:8px 10px;text-align:left;font-weight:500;font-size:11px;color:var(--text-secondary);min-width:150px;border-right:1px solid var(--border-light)">
                  ${esc(u.name || u.email.split('@')[0])}
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${days.map(day => {
              const dateKey   = this._dateKey(day)
              const isToday   = day.getTime() === today.getTime()
              const isWeekend = day.getDay() === 0 || day.getDay() === 6
              const dayStr    = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
              const rowBg     = isToday ? 'rgba(var(--accent-rgb),0.06)' : isWeekend ? 'var(--bg-secondary)' : 'var(--bg-primary)'
              return `<tr style="background:${rowBg};border-top:1px solid var(--border-light)">
                <td style="padding:7px 10px;border-right:1px solid var(--border-light);vertical-align:middle;white-space:nowrap;${isToday ? 'font-weight:600;color:var(--accent)' : isWeekend ? 'color:var(--text-tertiary)' : 'color:var(--text-secondary)'}">
                  ${esc(dayStr)}${isToday ? ' <span style="font-size:9px;background:var(--accent);color:var(--accent-text);border-radius:var(--radius-sm);padding:1px 4px;vertical-align:middle">TODAY</span>' : ''}
                </td>
                ${users.map(u => {
                  const realEntries  = byUserDate[`${u.id}:${dateKey}`] || []
                  const ghostEntries = shootEntries[`${u.id}:${dateKey}`] || []
                  const ppsGhosts    = ppsEntries[`${u.id}:${dateKey}`] || []
                  const allChips = [
                    ...realEntries.filter(e => !e.end_date || e.end_date <= e.entry_date).map(e => this._chipHTML(e, false, projects)),
                    ...ghostEntries.filter(e => !e._isMultiDayGhost).map(e => this._chipHTML(e, true, projects)),
                    ...ppsGhosts.filter(e => !e._blockIsMultiDay).map(e => this._chipHTML(e, true, projects)),
                  ]
                  return `<td class="tc-cell" data-tc-date="${dateKey}" data-tc-user="${u.id}"
                    style="padding:3px 4px;border-right:1px solid var(--border-light);height:34px;
                    vertical-align:middle;cursor:pointer;position:relative;box-sizing:border-box">
                    <div style="display:flex;gap:2px;height:26px;align-items:stretch;overflow:hidden">
                      ${allChips.join('')}
                    </div>
                    <div class="tc-add-hint" style="position:absolute;inset:0;display:flex;align-items:center;
                      justify-content:center;opacity:0;font-size:16px;color:var(--text-tertiary);
                      transition:opacity 0.1s;pointer-events:none;user-select:none">+</div>
                  </td>`
                }).join('')}
              </tr>`
            }).join('')}
          </tbody>
        </table>
        <div id="tc-overlay" style="position:absolute;inset:0;pointer-events:none;overflow:hidden"></div>
      </div>
      <div style="margin-top:6px;font-size:11px;color:var(--text-tertiary);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span>Click cell to add · Click entry to edit · Drag to move · Drag edges to resize</span>
        ${this._shootsCache?.length ? `<span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px dashed #4CAF50"></span> Auto from shoot plan</span>` : ''}
        ${this._ppsPhasesCache?.length ? `<span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px dashed #C47E3A"></span> Auto from post production</span>` : ''}
        ${this._clipboard ? `<span style="color:var(--accent)">📋 Paste active</span>` : ''}
      </div>`
  }

  _chipHTML(e, isGhost, projects) {
    const col    = e.color || TYPE_COLORS[e.entry_type] || '#7B6EAB'
    const proj   = e.project_id ? projects.find(p => p.id === e.project_id) : null
    const label  = proj ? proj.name : e.label
    const hasNav = isGhost && !!e._navTarget
    const ghostStyle = isGhost
      ? `border-style:dashed;opacity:0.75;${hasNav ? 'cursor:pointer;' : 'pointer-events:none;'}`
      : `cursor:pointer;`
    const navAttr   = hasNav ? `data-ghost-nav="${e._navTarget}"` : ''
    const chipAttrs = isGhost ? navAttr : `data-tc-entry-id="${e.id}" draggable="true"`
    // Multi-day continuity: square the corners and drop the border where the block continues
    const isMulti = !!(e.end_date && e.end_date > e.entry_date)
    const brTL = e._isFirst !== false ? 'var(--radius-md)' : '0'
    const brBL = e._isFirst !== false ? 'var(--radius-md)' : '0'
    const brTR = e._isLast  !== false ? 'var(--radius-md)' : '0'
    const brBR = e._isLast  !== false ? 'var(--radius-md)' : '0'
    const borderL = isMulti && e._isFirst === false ? 'none' : `1px solid ${col}88`
    const borderR = isMulti && e._isLast  === false ? 'none' : `1px solid ${col}88`
    const startHandle = !isGhost && e._isFirst
      ? `<div class="tc-resize-handle" data-tc-entry-id="${e.id}" data-edge="start" style="position:absolute;top:-1px;left:0;right:0;height:6px;cursor:ns-resize;color:${col}"></div>` : ''
    const endHandle = !isGhost && e._isLast
      ? `<div class="tc-resize-handle" data-tc-entry-id="${e.id}" data-edge="end" style="position:absolute;bottom:-1px;left:0;right:0;height:6px;cursor:ns-resize;color:${col}"></div>` : ''
    const title = `${esc(label)}${proj && e.label !== proj.name ? ' · ' + esc(e.label) : ''}${isMulti ? ' (multi-day)' : ''}${isGhost ? (e._ghostNote || ' (from shoot plan)') : ''}${hasNav ? ' · Click to open ↗' : ''}`
    return `<div class="${isGhost ? 'tc-chip-ghost' : 'tc-chip'}" ${chipAttrs}
      style="position:relative;flex:1;min-width:0;display:flex;align-items:center;gap:4px;padding:2px 5px;
      background:${col}22;border-top:1px solid ${col}88;border-bottom:1px solid ${col}88;
      border-left:${borderL};border-right:${borderR};
      border-radius:${brTL} ${brTR} ${brBR} ${brBL};
      ${ghostStyle}overflow:hidden" title="${title}">
      ${startHandle}
      <div style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${col}"></div>
      <span style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">${esc(label)}</span>
      ${endHandle}
    </div>`
  }

  _findConsecutiveSpans(sortedDates) {
    if (!sortedDates.length) return []
    const spans = []
    let spanStart = sortedDates[0]
    let spanDates = [sortedDates[0]]
    for (let i = 1; i < sortedDates.length; i++) {
      const diffDays = (new Date(sortedDates[i] + 'T00:00:00') - new Date(sortedDates[i-1] + 'T00:00:00')) / 86400000
      if (diffDays === 1) {
        spanDates.push(sortedDates[i])
      } else {
        spans.push({ start: spanStart, end: sortedDates[i-1], dates: spanDates })
        spanStart = sortedDates[i]
        spanDates = [sortedDates[i]]
      }
    }
    spans.push({ start: spanStart, end: sortedDates[sortedDates.length-1], dates: spanDates })
    return spans
  }

  _buildShootEntries(days, users) {
    const result = {}
    const shoots = this._shootsCache || []
    if (!shoots.length || !users.length) return result

    const dayKeySet = new Set(days.map(d => this._dateKey(d)))
    const nameToUser = {}
    for (const u of users) {
      if (u.name) nameToUser[u.name.toLowerCase().trim()] = u
    }

    for (const sh of shoots) {
      let shootDates = []
      if (Array.isArray(sh.shoot_dates) && sh.shoot_dates.length) {
        shootDates = sh.shoot_dates.filter(sd => sd.date).map(sd => sd.date)
      } else if (sh.shoot_date) {
        shootDates = [sh.shoot_date]
      }

      const crew = Array.isArray(sh.crew) ? sh.crew : (typeof sh.crew === 'string' ? JSON.parse(sh.crew || '[]') : [])
      for (const member of crew) {
        if (!member.name) continue
        const user = nameToUser[member.name.toLowerCase().trim()]
        if (!user) continue

        const visibleDates = shootDates.filter(d => dayKeySet.has(d)).sort()
        const multiDayDateSet = new Set()
        if (visibleDates.length >= 2) {
          for (const span of this._findConsecutiveSpans(visibleDates)) {
            if (span.dates.length >= 2) span.dates.forEach(d => multiDayDateSet.add(d))
          }
        }

        for (const dateStr of shootDates) {
          if (!dayKeySet.has(dateStr)) continue
          const key = `${user.id}:${dateStr}`
          if (!result[key]) result[key] = []
          result[key].push({
            id: `shoot-${sh.id}-${user.id}-${dateStr}`,
            assignee_id: user.id,
            entry_date: dateStr,
            end_date: null,
            entry_type: 'shoot',
            label: `Shoot — ${sh.project_name || 'Project'}${sh.name ? ': ' + sh.name : ''}`,
            color: '#4CAF50',
            project_id: sh.project_id,
            _ghost: true,
            _navTarget: `shoot::${sh.project_id}`,
            _isMultiDayGhost: multiDayDateSet.has(dateStr),
          })
        }
      }
    }
    return result
  }

  _buildPpsEntries(days, users) {
    const result = {}
    const phases = this._ppsPhasesCache || []
    if (!phases.length || !users.length) return result

    const userIds = new Set(users.map(u => u.id))

    for (const ph of phases) {
      const blocks = Array.isArray(ph.blocks) ? ph.blocks : []
      for (const b of blocks) {
        if (!b.assignee_id || !userIds.has(b.assignee_id)) continue
        if (!b.start_date || !b.end_date) continue
        const stage = b.title || ph.name
        const label = `${ph.project_name ? ph.project_name + ' — ' : ''}${stage}`
        const color = b.color || ph.color || '#C47E3A'
        for (const day of days) {
          const k = this._dateKey(day)
          if (k >= b.start_date && k <= b.end_date) {
            const key = `${b.assignee_id}:${k}`
            if (!result[key]) result[key] = []
            result[key].push({
              id: `pps-${b.id}-${k}`,
              assignee_id: b.assignee_id,
              entry_date: k,
              end_date: b.end_date,
              entry_type: 'post_production',
              label,
              color,
              project_id: ph.project_id,
              _isFirst: k === b.start_date,
              _ghost: true,
              _ghostNote: ' (from post production schedule)',
              _navTarget: `pps::${ph.project_id}`,
              _blockIsMultiDay: b.start_date !== b.end_date,
            })
          }
        }
      }
    }
    return result
  }

  _bindSection(section) {
    section.querySelector('#tc-toggle')?.addEventListener('click', () => {
      this._expanded = !this._expanded
      localStorage.setItem('tc-expanded', String(this._expanded))
      this._renderSection(section)
      this._bindSection(section)
      if (this._expanded) this._loadAndRenderGrid(section)
    })
    section.querySelector('#tc-prev')?.addEventListener('click', e => {
      e.stopPropagation(); this._weekOffset--
      this._renderSection(section); this._bindSection(section)
      if (this._expanded) this._loadAndRenderGrid(section)
    })
    section.querySelector('#tc-next')?.addEventListener('click', e => {
      e.stopPropagation(); this._weekOffset++
      this._renderSection(section); this._bindSection(section)
      if (this._expanded) this._loadAndRenderGrid(section)
    })
    if (this._expanded) this._loadAndRenderGrid(section)
    this._bindClipboardEscape()
  }

  // Escape clears a copied entry (paste mode). Bound once, globally.
  _bindClipboardEscape() {
    if (this._escBound) return
    this._escBound = true
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this._clipboard) {
        this._clipboard = null
        const gw = document.querySelector('#tc-grid-wrap')
        if (gw) { const s = document.querySelector('#tc-section'); if (s) { gw.innerHTML = this._renderGrid(this._activeDays(), this.app.allUsers || [], this.app.teamCalendarEntries || []); this._bindGrid(gw, s) } }
      }
    })
  }

  _bindGrid(gridWrap, section) {
    this._lastDays = this._activeDays()

    // ── Cell: click to add, drag-over highlight ──
    gridWrap.querySelectorAll('.tc-cell').forEach(cell => {
      const hint = cell.querySelector('.tc-add-hint')
      cell.addEventListener('mouseenter', () => { if (hint) hint.style.opacity = '0.5' })
      cell.addEventListener('mouseleave', () => { if (hint) hint.style.opacity = '0'; cell.style.background = '' })

      cell.addEventListener('click', e => {
        const chip = e.target.closest('.tc-chip')
        if (chip) return // handled by chip
        if (this._clipboard) {
          this._pasteEntry(cell.dataset.tcDate, cell.dataset.tcUser, section)
        } else {
          this._openEntryModal(null, section, cell.dataset.tcDate, cell.dataset.tcUser)
        }
      })

      // Drag-over (drop target)
      cell.addEventListener('dragover', e => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        cell.style.background = 'rgba(var(--accent-rgb),0.1)'
      })
      cell.addEventListener('dragleave', () => { cell.style.background = '' })
      cell.addEventListener('drop', async e => {
        e.preventDefault()
        cell.style.background = ''
        const entryId = e.dataTransfer.getData('text/plain')
        if (!entryId) return
        await this._moveEntry(entryId, cell.dataset.tcDate, cell.dataset.tcUser, section)
      })
    })

    // ── Chips: click to edit, drag to move ──
    gridWrap.querySelectorAll('.tc-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        if (e.target.closest('.tc-resize-handle')) return
        e.stopPropagation()
        const entry = (this.app.teamCalendarEntries || []).find(x => x.id === chip.dataset.tcEntryId)
        if (entry) this._openEntryModal(entry, section)
      })

      chip.addEventListener('dragstart', e => {
        if (this._resizing) { e.preventDefault(); return }
        e.dataTransfer.setData('text/plain', chip.dataset.tcEntryId)
        e.dataTransfer.effectAllowed = 'move'
        setTimeout(() => { chip.style.opacity = '0.4'; this._setChipPointerEvents(gridWrap, false) }, 0)
      })
      chip.addEventListener('dragend', () => {
        chip.style.opacity = ''
        this._setChipPointerEvents(gridWrap, true)
      })
    })

    // ── Ghost chips: click to navigate to source shoot or PPS ──
    gridWrap.querySelectorAll('.tc-chip-ghost[data-ghost-nav]').forEach(chip => {
      chip.addEventListener('click', e => {
        e.stopPropagation()
        const [type, projectId] = chip.dataset.ghostNav.split('::')
        const tab = type === 'shoot' ? 'shoots' : 'post-production'
        // navigate() resets currentId, so set state directly like openProject does
        this.app.currentView = 'projects'
        this.app.projectsView.currentId = projectId
        this.app.projectsView._pvTab = tab
        this.app.projectsView.editingId = null
        history.pushState({ view: 'projects' }, '', `#projects/${projectId}/${tab}`)
        this.app.render()
      })
    })

    // ── Resize handles: drag a chip's top/bottom edge to change its dates ──
    gridWrap.querySelectorAll('.tc-resize-handle').forEach(handle => {
      handle.addEventListener('pointerdown', e => this._startResize(e, handle, section))
    })

    this._positionOverlay(gridWrap, section)
  }

  _setChipPointerEvents(gridWrap, restore) {
    gridWrap.querySelectorAll('.tc-chip, .tc-chip-ghost').forEach(c => {
      c.style.pointerEvents = c.classList.contains('tc-chip-overlay')
        ? (restore ? 'all' : 'none')
        : (restore ? '' : 'none')
    })
  }

  _positionOverlay(gridWrap, section) {
    const overlay = gridWrap.querySelector('#tc-overlay')
    const wrap    = gridWrap.querySelector('#tc-table-wrap')
    if (!overlay || !wrap) return

    const entries  = this.app.teamCalendarEntries || []
    const days     = this._lastDays || this._activeDays()
    const projects = this.app.projects || []
    const users    = this.app.allUsers || []
    const day0Key  = this._dateKey(days[0])
    const dayNKey  = this._dateKey(days[days.length - 1])

    const measureCells = (userId, startDate, endDate) => {
      let firstCell = null, lastCell = null
      for (const cell of gridWrap.querySelectorAll(`.tc-cell[data-tc-user="${userId}"]`)) {
        const d = cell.dataset.tcDate
        if (d >= startDate && d <= endDate) {
          if (!firstCell) firstCell = cell
          lastCell = cell
        }
      }
      return { firstCell, lastCell }
    }

    // Phase 1: measure all overlay blocks before any DOM writes
    const wrapRect   = wrap.getBoundingClientRect()
    const scrollLeft = wrap.scrollLeft
    const toPlace    = []

    // 1a: real multi-day entries
    for (const e of entries) {
      if (!e.end_date || e.end_date <= e.entry_date) continue
      const { firstCell, lastCell } = measureCells(e.assignee_id, e.entry_date, e.end_date)
      if (!firstCell || !lastCell) continue
      const fr = firstCell.getBoundingClientRect()
      const lr = lastCell.getBoundingClientRect()
      toPlace.push({
        e, isGhost: false,
        top:    fr.top  - wrapRect.top,
        left:   fr.left - wrapRect.left + scrollLeft,
        width:  fr.width,
        height: lr.bottom - fr.top,
        isFirstVisible: e.entry_date >= day0Key,
        isLastVisible:  e.end_date   <= dayNKey,
      })
    }

    // 1b: PPS multi-day ghost blocks
    const userIdSet = new Set(users.map(u => u.id))
    for (const ph of (this._ppsPhasesCache || [])) {
      for (const b of (Array.isArray(ph.blocks) ? ph.blocks : [])) {
        if (!b.assignee_id || !userIdSet.has(b.assignee_id)) continue
        if (!b.start_date || !b.end_date || b.start_date === b.end_date) continue
        if (b.end_date < day0Key || b.start_date > dayNKey) continue
        const { firstCell, lastCell } = measureCells(b.assignee_id, b.start_date, b.end_date)
        if (!firstCell || !lastCell) continue
        const fr = firstCell.getBoundingClientRect()
        const lr = lastCell.getBoundingClientRect()
        const label = `${ph.project_name ? ph.project_name + ' — ' : ''}${b.title || ph.name}`
        const color = b.color || ph.color || '#C47E3A'
        toPlace.push({
          e: { id: `pps-overlay-${b.id}`, assignee_id: b.assignee_id, label, color,
               project_id: ph.project_id, _navTarget: `pps::${ph.project_id}`,
               _ghostNote: ' (from post production schedule)' },
          isGhost: true,
          top:    fr.top  - wrapRect.top,
          left:   fr.left - wrapRect.left + scrollLeft,
          width:  fr.width,
          height: lr.bottom - fr.top,
          isFirstVisible: b.start_date >= day0Key,
          isLastVisible:  b.end_date   <= dayNKey,
        })
      }
    }

    // 1c: shoot consecutive-date ghost spans
    const nameToUser = {}
    for (const u of users) {
      if (u.name) nameToUser[u.name.toLowerCase().trim()] = u
    }
    for (const sh of (this._shootsCache || [])) {
      let shootDates = []
      if (Array.isArray(sh.shoot_dates) && sh.shoot_dates.length) {
        shootDates = sh.shoot_dates.filter(sd => sd.date).map(sd => sd.date)
      } else if (sh.shoot_date) {
        shootDates = [sh.shoot_date]
      }
      const crew = Array.isArray(sh.crew) ? sh.crew : (typeof sh.crew === 'string' ? JSON.parse(sh.crew || '[]') : [])
      for (const member of crew) {
        if (!member.name) continue
        const user = nameToUser[member.name.toLowerCase().trim()]
        if (!user) continue
        const visibleDates = shootDates.filter(d => d >= day0Key && d <= dayNKey).sort()
        if (visibleDates.length < 2) continue
        for (const span of this._findConsecutiveSpans(visibleDates)) {
          if (span.dates.length < 2) continue
          const { firstCell, lastCell } = measureCells(user.id, span.start, span.end)
          if (!firstCell || !lastCell) continue
          const fr = firstCell.getBoundingClientRect()
          const lr = lastCell.getBoundingClientRect()
          const label = `Shoot — ${sh.project_name || 'Project'}${sh.name ? ': ' + sh.name : ''}`
          toPlace.push({
            e: { id: `shoot-overlay-${sh.id}-${user.id}-${span.start}`, assignee_id: user.id,
                 label, color: '#4CAF50', project_id: sh.project_id,
                 _navTarget: `shoot::${sh.project_id}` },
            isGhost: true,
            top:    fr.top  - wrapRect.top,
            left:   fr.left - wrapRect.left + scrollLeft,
            width:  fr.width,
            height: lr.bottom - fr.top,
            isFirstVisible: true,
            isLastVisible:  true,
          })
        }
      }
    }

    // Phase 2: write overlay chips
    overlay.innerHTML = ''
    for (const { e, isGhost, top, left, width, height, isFirstVisible, isLastVisible } of toPlace) {
      const col   = e.color || TYPE_COLORS[e.entry_type] || '#7B6EAB'
      const proj  = e.project_id ? projects.find(p => p.id === e.project_id) : null
      const label = proj ? proj.name : e.label
      const PAD   = 2

      const chip = document.createElement('div')
      if (isGhost) {
        chip.className = 'tc-chip-ghost tc-chip-overlay'
        if (e._navTarget) chip.dataset.ghostNav = e._navTarget
      } else {
        chip.className = 'tc-chip tc-chip-overlay'
        chip.dataset.tcEntryId = e.id
        chip.draggable = true
      }
      chip.title = `${label}${isGhost ? (e._ghostNote || ' (from shoot plan)') + ' · Click to open ↗' : ''}`
      chip.style.cssText = `position:absolute;left:${left+PAD}px;top:${top+PAD}px;` +
        `width:${width-PAD*2}px;height:${height-PAD*2}px;` +
        `display:flex;align-items:flex-start;gap:4px;padding:4px 6px;` +
        `background:${col}22;border:1px ${isGhost ? 'dashed' : 'solid'} ${col}88;border-radius:var(--radius-md);` +
        `${isGhost ? 'opacity:0.85;' : ''}` +
        `cursor:${isGhost && e._navTarget ? 'pointer' : isGhost ? 'default' : 'pointer'};` +
        `box-sizing:border-box;overflow:hidden;pointer-events:all;z-index:2`

      chip.innerHTML = `
        ${!isGhost && isFirstVisible ? `<div class="tc-resize-handle" data-tc-entry-id="${e.id}" data-edge="start" style="position:absolute;top:-1px;left:0;right:0;height:6px;cursor:ns-resize;color:${col}"></div>` : ''}
        <div style="display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden">
          <div style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${col}"></div>
          <span style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">${esc(label)}</span>
        </div>
        ${!isGhost && isLastVisible ? `<div class="tc-resize-handle" data-tc-entry-id="${e.id}" data-edge="end" style="position:absolute;bottom:-1px;left:0;right:0;height:6px;cursor:ns-resize;color:${col}"></div>` : ''}`

      if (isGhost && e._navTarget) {
        chip.addEventListener('click', ev => {
          ev.stopPropagation()
          const [type, projectId] = e._navTarget.split('::')
          const tab = type === 'shoot' ? 'shoots' : 'post-production'
          this.app.currentView = 'projects'
          this.app.projectsView.currentId = projectId
          this.app.projectsView._pvTab = tab
          this.app.projectsView.editingId = null
          history.pushState({ view: 'projects' }, '', `#projects/${projectId}/${tab}`)
          this.app.render()
        })
      } else if (!isGhost) {
        chip.addEventListener('click', ev => {
          if (ev.target.closest('.tc-resize-handle')) return
          ev.stopPropagation()
          const entry = (this.app.teamCalendarEntries || []).find(x => x.id === e.id)
          if (entry) this._openEntryModal(entry, section)
        })
        chip.addEventListener('dragstart', ev => {
          if (this._resizing) { ev.preventDefault(); return }
          ev.dataTransfer.setData('text/plain', e.id)
          ev.dataTransfer.effectAllowed = 'move'
          setTimeout(() => { chip.style.opacity = '0.4'; this._setChipPointerEvents(gridWrap, false) }, 0)
        })
        chip.addEventListener('dragend', () => {
          chip.style.opacity = ''
          this._setChipPointerEvents(gridWrap, true)
        })
        chip.querySelectorAll('.tc-resize-handle').forEach(h => {
          h.addEventListener('pointerdown', ev => this._startResize(ev, h, section))
        })
      }

      overlay.appendChild(chip)
    }
  }

  // ── Resize via drag ───────────────────────────────────────────────────────────

  _startResize(e, handle, section) {
    e.preventDefault()
    e.stopPropagation()
    this._resizing = true
    const edge  = handle.dataset.edge
    const entry = (this.app.teamCalendarEntries || []).find(x => x.id === handle.dataset.tcEntryId)
    if (!entry) { this._resizing = false; return }

    const fixedStart = entry.entry_date
    const fixedEnd   = entry.end_date || entry.entry_date
    const orig = { start: entry.entry_date, end: entry.end_date }
    let lastDate = null
    document.body.classList.add('is-resizing')

    const onMove = ev => {
      const cell = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tc-cell')
      const date = cell?.dataset.tcDate
      if (!date || date === lastDate) return
      lastDate = date
      let s, en
      if (edge === 'start') {
        s  = date <= fixedEnd ? date : fixedEnd
        en = s === fixedEnd ? null : fixedEnd
      } else {
        const target = date >= fixedStart ? date : fixedStart
        s  = fixedStart
        en = target === fixedStart ? null : target
      }
      if (s === entry.entry_date && en === entry.end_date) return
      entry.entry_date = s
      entry.end_date   = en
      this._refreshGrid(section)
    }

    const onUp = async () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.classList.remove('is-resizing')
      this._resizing = false
      if (entry.entry_date === orig.start && entry.end_date === orig.end) return
      try {
        const { updateTeamCalendarEntry } = await import('../db/client.js')
        const updated = await updateTeamCalendarEntry(this.app.userId, entry.id, {
          entry_date: entry.entry_date,
          end_date:   entry.end_date,
        })
        const idx = (this.app.teamCalendarEntries || []).findIndex(x => x.id === entry.id)
        if (idx >= 0) this.app.teamCalendarEntries[idx] = updated
        this._refreshGrid(section)
      } catch (err) {
        console.error(err)
        entry.entry_date = orig.start
        entry.end_date   = orig.end
        this._refreshGrid(section)
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  // ── Move via drag ─────────────────────────────────────────────────────────────

  async _moveEntry(entryId, newDate, newUserId, section) {
    const entry = (this.app.teamCalendarEntries || []).find(e => e.id === entryId)
    if (!entry || (entry.entry_date === newDate && entry.assignee_id === newUserId)) return

    // Preserve multi-day span length
    let newEndDate = null
    if (entry.end_date && entry.end_date > entry.entry_date) {
      const span = Math.round((new Date(entry.end_date + 'T00:00:00') - new Date(entry.entry_date + 'T00:00:00')) / 86400000)
      newEndDate = this._addDays(newDate, span)
    }

    try {
      const { updateTeamCalendarEntry } = await import('../db/client.js')
      const updated = await updateTeamCalendarEntry(this.app.userId, entryId, {
        entry_date:  newDate,
        end_date:    newEndDate,
        assignee_id: newUserId,
      })
      const idx = (this.app.teamCalendarEntries || []).findIndex(e => e.id === entryId)
      if (idx >= 0) this.app.teamCalendarEntries[idx] = updated
      this._refreshGrid(section)
    } catch (e) { console.error(e) }
  }

  async _pasteEntry(date, userId, section) {
    if (!this._clipboard) return
    const data = { ...this._clipboard, entry_date: date, assignee_id: userId, end_date: null }
    delete data.id
    // Adjust end_date to preserve span
    if (this._clipboard.end_date && this._clipboard.end_date > this._clipboard.entry_date) {
      const span = Math.round((new Date(this._clipboard.end_date + 'T00:00:00') - new Date(this._clipboard.entry_date + 'T00:00:00')) / 86400000)
      data.end_date = this._addDays(date, span)
    }
    try {
      const { createTeamCalendarEntry } = await import('../db/client.js')
      const created = await createTeamCalendarEntry(this.app.userId, data)
      if (!this.app.teamCalendarEntries) this.app.teamCalendarEntries = []
      this.app.teamCalendarEntries.push(created)
      this._refreshGrid(section)
    } catch (e) { console.error(e) }
  }

  _refreshGrid(section) {
    const gw = section.querySelector('#tc-grid-wrap')
    if (!gw) return
    const days = this._activeDays()
    gw.innerHTML = this._renderGrid(days, this.app.allUsers || [], this.app.teamCalendarEntries || [])
    this._bindGrid(gw, section)
    // Update header count (dashboard week section only)
    if (this._mode !== 'month') this._updateHeaderCount(section, days)
  }

  _updateHeaderCount(section, days) {
    const entries = this.app.teamCalendarEntries || []
    const weekKeys = new Set(days.map(d => this._dateKey(d)))
    const count = entries.filter(e => {
      if (weekKeys.has(e.entry_date)) return true
      if (e.end_date && e.end_date > e.entry_date) {
        for (const k of weekKeys) if (k >= e.entry_date && k <= e.end_date) return true
      }
      return false
    }).length
    const countEl = section.querySelector('.db-section-count')
    if (countEl) countEl.textContent = count || ''
    else if (count) {
      const head = section.querySelector('#tc-toggle')
      if (head) {
        const dot = head.querySelector('.db-section-dot')
        if (dot) dot.insertAdjacentHTML('afterend', `<span class="db-section-count">${count}</span>`)
      }
    }
  }

  // ── Entry modal ───────────────────────────────────────────────────────────────

  _openEntryModal(entry, section, defaultDate, defaultUserId) {
    document.getElementById('tc-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'tc-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px 16px'

    const users    = this.app.allUsers || []
    const projects = (this.app.projects || []).filter(p => !p.is_retainer)

    const renderModal = (state = {}) => {
      const selUserId    = state.assignee_id  ?? (defaultUserId || users[0]?.id || '')
      const selDate      = state.entry_date   ?? (defaultDate || this._dateKey(new Date()))
      const selEndDate   = state.end_date     ?? (entry?.end_date ?? '')
      const selType      = state.entry_type   ?? (entry?.entry_type ?? 'other')
      const selProjectId = state.project_id   ?? (entry?.project_id ?? '')
      const selLabel     = state.label        ?? (entry?.label ?? '')
      const selColor     = state.color        ?? (entry?.color ?? '')
      const selShootId   = state.shoot_id     ?? (entry?.shoot_id ?? '')
      const selPhaseId   = state.pps_phase_id ?? (entry?.pps_phase_id ?? '')
      const selBudgetId  = state.budget_id    ?? (entry?.budget_id ?? '')
      const selLineLabel = state.line_label   ?? (entry?.line_label ?? '')
      const selNotes     = state.notes        ?? (entry?.notes ?? '')
      const selIsDeadline = state.is_deadline ?? (entry?.is_deadline ?? false)

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
        ? `<div class="tc-swatch${selColor === c ? ' tc-swatch--sel' : ''}" data-color="${c}" style="width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${selColor === c ? '#fff' : 'transparent'};flex-shrink:0"></div>`
        : `<div class="tc-swatch tc-swatch--auto${selColor === '' ? ' tc-swatch--sel' : ''}" data-color="" style="width:20px;height:20px;border-radius:50%;background:var(--bg-tertiary,#333);border:2px solid ${selColor === '' ? 'var(--accent)' : 'var(--border-med)'};cursor:pointer;font-size:8px;display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);flex-shrink:0">auto</div>`
      ).join('')

      // Days span calculator
      let spanDays = 1
      if (selEndDate && selEndDate > selDate) {
        spanDays = Math.round((new Date(selEndDate + 'T00:00:00') - new Date(selDate + 'T00:00:00')) / 86400000) + 1
      }

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:460px;max-height:90vh;overflow-y:auto" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light)">
            <div style="font-size:14px;font-weight:600">${entry ? 'Edit entry' : 'Add calendar entry'}</div>
            <button id="tc-m-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);padding:2px 6px;line-height:1">×</button>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">

            <!-- 1. Project (first — drives label) -->
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Project</div>
              <select id="tc-m-project" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                <option value="">— None —</option>
                ${projects.map(p => `<option value="${p.id}" ${p.id === selProjectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
            </div>

            <!-- 2. Custom label (optional if project selected) -->
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">
                Label ${selProjectId ? '<span style="opacity:0.5">(optional — defaults to project name)</span>' : '<span style="color:var(--danger)">*</span>'}
              </div>
              <input type="text" id="tc-m-label" value="${esc(selLabel)}" placeholder="${selProjectId ? esc(selProject?.name || '') : 'e.g. Travel day, Location scout…'}" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)" />
            </div>

            <!-- 3. Person + Dates row -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Team member</div>
                <select id="tc-m-user" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                  ${users.map(u => `<option value="${u.id}" ${u.id === selUserId ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
                </select>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Start date</div>
                <input type="date" id="tc-m-date" value="${esc(selDate)}" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);color-scheme:dark" />
              </div>
            </div>

            <!-- 4. Multi-day span -->
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Duration</div>
              <div style="display:flex;align-items:center;gap:8px">
                <div style="display:flex;align-items:center;gap:4px;background:var(--bg-secondary);border:1px solid var(--border-med);border-radius:var(--radius-md);padding:4px 4px 4px 10px">
                  <input type="number" id="tc-m-days" value="${spanDays}" min="1" max="90" style="width:44px;font-size:13px;border:none;background:transparent;color:var(--text-primary);font-family:var(--font);outline:none;text-align:center" />
                  <span style="font-size:12px;color:var(--text-tertiary)">day${spanDays > 1 ? 's' : ''}</span>
                </div>
                ${spanDays > 1 && selEndDate ? `<span style="font-size:12px;color:var(--text-secondary)">→ ends ${new Date(selEndDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}</span>` : ''}
              </div>
            </div>

            <!-- 5. Type -->
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Type</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${Object.entries(ENTRY_TYPE_LABELS).map(([val, lbl]) => `
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:5px 10px;border:1px solid ${selType===val?'var(--accent)':'var(--border-med)'};border-radius:var(--radius-md);font-size:12px;background:${selType===val?'rgba(var(--accent-rgb),0.1)':'var(--bg-secondary)'};color:${selType===val?'var(--accent)':'var(--text-secondary)'}">
                    <input type="radio" name="tc-m-type" value="${val}" ${selType===val?'checked':''} style="accent-color:var(--accent)">
                    ${lbl}
                  </label>`).join('')}
              </div>
            </div>

            <!-- 6. Colour -->
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Colour</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap" id="tc-m-swatches">${colorSwatches}</div>
            </div>

            <!-- 7. Conditional: shoot link -->
            ${selType === 'shoot' && selProjectId ? `
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Shoot plan</div>
              <select id="tc-m-shoot" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                <option value="">— None —</option>
                ${projectShoots.map(sh => `<option value="${sh.id}" ${sh.id===selShootId?'selected':''}>${esc(sh.name||sh.location_name||'Untitled shoot')}</option>`).join('')}
              </select>
            </div>` : ''}

            <!-- 8. Conditional: PPS phase link -->
            ${selType === 'post_production' && selProjectId ? `
            <div id="tc-m-phase-wrap">
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Post Production Phase</div>
              <select id="tc-m-phase" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                <option value="">— None —</option>
              </select>
              <div id="tc-m-phase-loading" style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Loading phases…</div>
            </div>` : ''}

            <!-- 9. Time tracking task -->
            ${selProjectId && allLineItems.length ? `
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Time Tracking Task</div>
              <select id="tc-m-task" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font)">
                <option value="">— None —</option>
                ${allLineItems.map(li => `<option value="${li.budgetId}::${li.label}" ${li.budgetId===selBudgetId&&li.label===selLineLabel?'selected':''}>${esc(li.label)} (${esc(li.budgetName)})</option>`).join('')}
              </select>
              ${selBudgetId && selLineLabel ? `<button id="tc-m-log-time" class="btn-secondary" style="margin-top:6px;font-size:11px">⏱ Log time now</button>` : ''}
            </div>` : ''}

            <!-- 10. Notes -->
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Notes</div>
              <textarea id="tc-m-notes" rows="2" style="width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);resize:vertical">${esc(selNotes)}</textarea>
            </div>

            <!-- 11. Deadline -->
            <div>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-primary)">
                <input type="checkbox" id="tc-m-deadline" ${selIsDeadline ? 'checked' : ''} style="cursor:pointer;accent-color:var(--danger);width:14px;height:14px;flex-shrink:0" />
                <span>Mark as deadline</span>
                <span style="font-size:11px;color:var(--text-tertiary)">(shows in dashboard deadline widget)</span>
              </label>
            </div>

            <!-- Actions -->
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              ${entry ? `
                <div style="display:flex;gap:6px">
                  <button id="tc-m-delete" class="btn-danger">Delete</button>
                  <button id="tc-m-copy" class="btn-cancel">Copy</button>
                </div>` : '<div></div>'}
              <div style="display:flex;gap:8px">
                <button id="tc-m-cancel" class="btn-cancel">Cancel</button>
                <button id="tc-m-save" class="btn-primary">${entry ? 'Save changes' : 'Add entry'}</button>
              </div>
            </div>
          </div>
        </div>`

      // Swatch clicks
      overlay.querySelectorAll('.tc-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          const s = this._collectModalState(overlay, state); s.color = sw.dataset.color; renderModal(s)
        })
      })

      // Re-render on project/type change
      overlay.querySelector('#tc-m-project')?.addEventListener('change', e => {
        const s = this._collectModalState(overlay, state)
        s.project_id = e.target.value; s.shoot_id = ''; s.pps_phase_id = ''; renderModal(s)
      })
      overlay.querySelectorAll('input[name="tc-m-type"]').forEach(r => {
        r.addEventListener('change', () => {
          const s = this._collectModalState(overlay, state)
          s.entry_type = overlay.querySelector('input[name="tc-m-type"]:checked')?.value || 'other'
          renderModal(s)
        })
      })

      // Days spinner updates end date display
      overlay.querySelector('#tc-m-days')?.addEventListener('input', () => {
        const s = this._collectModalState(overlay, state); renderModal(s)
      })
      overlay.querySelector('#tc-m-date')?.addEventListener('change', () => {
        const s = this._collectModalState(overlay, state); renderModal(s)
      })

      // Load PPS phases async
      if (selType === 'post_production' && selProjectId) {
        this._loadPhasesForProject(overlay, selProjectId, selPhaseId)
      }

      overlay.querySelector('#tc-m-close')?.addEventListener('click', () => overlay.remove())
      overlay.querySelector('#tc-m-cancel')?.addEventListener('click', () => overlay.remove())
      overlay.querySelector('#tc-m-save')?.addEventListener('click', () => this._saveFromModal(overlay, entry, section))
      overlay.querySelector('#tc-m-delete')?.addEventListener('click', () => {
        if (entry && confirm('Delete this calendar entry?')) { this._deleteEntry(entry.id, section); overlay.remove() }
      })
      overlay.querySelector('#tc-m-copy')?.addEventListener('click', () => {
        if (entry) { this._clipboard = { ...entry }; overlay.remove(); this._refreshGrid(section) }
      })
      overlay.querySelector('#tc-m-log-time')?.addEventListener('click', () => {
        if (entry) { this.openTimeLogger(entry); overlay.remove() }
      })
    }

    renderModal()
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#tc-m-project')?.focus(), 50)
  }

  async _loadPhasesForProject(overlay, projectId, selectedPhaseId) {
    const phaseSelect  = overlay.querySelector('#tc-m-phase')
    const phaseLoading = overlay.querySelector('#tc-m-phase-loading')
    if (!phaseSelect) return
    try {
      const { getPpsForProject } = await import('../db/client.js')
      const pps = await getPpsForProject(this.app.userId, projectId)
      if (phaseLoading) phaseLoading.style.display = 'none'
      if (pps?.phases?.length) {
        phaseSelect.innerHTML = `<option value="">— None —</option>` +
          pps.phases.map(ph => `<option value="${ph.id}" ${ph.id === selectedPhaseId ? 'selected' : ''}>${esc(ph.name)}</option>`).join('')
      } else {
        phaseSelect.innerHTML = '<option value="">No phases yet (create PPS in project first)</option>'
      }
    } catch (e) { console.error(e); if (phaseLoading) { phaseLoading.textContent = 'Failed to load'; phaseLoading.style.display = 'block' } }
  }

  _collectModalState(overlay, prev = {}) {
    const taskVal = overlay.querySelector('#tc-m-task')?.value || ''
    const [taskBudgetId, ...taskLabelParts] = taskVal.split('::')
    const startDate = overlay.querySelector('#tc-m-date')?.value || prev.entry_date || ''
    const days = parseInt(overlay.querySelector('#tc-m-days')?.value) || 1
    const endDate = days > 1 && startDate ? this._addDays(startDate, days - 1) : ''
    return {
      assignee_id:  overlay.querySelector('#tc-m-user')?.value    || prev.assignee_id  || '',
      entry_date:   startDate,
      end_date:     endDate,
      entry_type:   overlay.querySelector('input[name="tc-m-type"]:checked')?.value || prev.entry_type || 'other',
      label:        overlay.querySelector('#tc-m-label')?.value    || prev.label        || '',
      color:        prev.color !== undefined ? prev.color : '',
      project_id:   overlay.querySelector('#tc-m-project')?.value  || prev.project_id  || '',
      shoot_id:     overlay.querySelector('#tc-m-shoot')?.value    || prev.shoot_id    || '',
      pps_phase_id: overlay.querySelector('#tc-m-phase')?.value    || prev.pps_phase_id || '',
      budget_id:    taskBudgetId || '',
      line_label:   taskLabelParts.join('::') || '',
      notes:        overlay.querySelector('#tc-m-notes')?.value    || prev.notes       || '',
      is_deadline:  overlay.querySelector('#tc-m-deadline')?.checked ?? prev.is_deadline ?? false,
    }
  }

  async _saveFromModal(overlay, entry, section) {
    const state = this._collectModalState(overlay)
    const projects = this.app.projects || []
    const proj = state.project_id ? projects.find(p => p.id === state.project_id) : null
    // Label: use project name if no custom label provided and project is selected
    const label = state.label.trim() || (proj ? proj.name : '')
    if (!label) { overlay.querySelector('#tc-m-label')?.focus(); return }
    if (!state.assignee_id || !state.entry_date) return

    const btn = overlay.querySelector('#tc-m-save')
    if (btn) btn.textContent = 'Saving…'

    try {
      const { createTeamCalendarEntry, updateTeamCalendarEntry } = await import('../db/client.js')
      const payload = {
        assignee_id:  state.assignee_id,
        entry_date:   state.entry_date,
        end_date:     state.end_date || null,
        entry_type:   state.entry_type,
        label,
        color:        state.color || null,
        project_id:   state.project_id   || null,
        shoot_id:     state.shoot_id     || null,
        pps_phase_id: state.pps_phase_id || null,
        budget_id:    state.budget_id    || null,
        line_label:   state.line_label   || null,
        notes:        state.notes        || null,
        is_deadline:  state.is_deadline  ?? false,
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
      this._refreshGrid(section)
    } catch (e) { console.error(e); if (btn) btn.textContent = 'Error — retry' }
  }

  async _deleteEntry(id, section) {
    try {
      const { deleteTeamCalendarEntry } = await import('../db/client.js')
      await deleteTeamCalendarEntry(this.app.userId, id)
      this.app.teamCalendarEntries = (this.app.teamCalendarEntries || []).filter(e => e.id !== id)
      this._refreshGrid(section)
    } catch (e) { console.error(e) }
  }

  openTimeLogger(entry) {
    if (!entry.budget_id || !entry.line_label) return
    const sidebar = document.getElementById('time-logger-sidebar')
    if (!sidebar) return
    const projectSel = sidebar.querySelector('#tl-project')
    const taskSel    = sidebar.querySelector('#tl-task')
    if (projectSel) { projectSel.value = entry.project_id || ''; projectSel.dispatchEvent(new Event('change')) }
    setTimeout(() => { if (taskSel) taskSel.value = `${entry.budget_id}::${entry.line_label}` }, 100)
    sidebar.scrollIntoView({ behavior: 'smooth' })
  }
}
