// Staff leave / holiday planner — TimeTastic-style.
// Book leave → named approver approves/declines → approved leave is mirrored
// onto the Team Calendar and deducted from the person's annual allowance.

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const LEAVE_TYPES = {
  holiday: { label: 'Annual leave', color: '#0891b2', deducts: true  },
  sick:    { label: 'Sickness',     color: '#dc2626', deducts: false },
  unpaid:  { label: 'Unpaid leave', color: '#6b7280', deducts: false },
  other:   { label: 'Other',        color: '#7c3aed', deducts: false },
}

const STATUS_META = {
  pending:   { label: 'Pending',  color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  approved:  { label: 'Approved', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
  declined:  { label: 'Declined', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  cancelled: { label: 'Cancelled',color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

// ── Shared date helpers (also used by the dashboard / nav badge) ───────────────
export function dateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// First day of the leave year that contains `ref`.
export function leaveYearStart(fyMonth, fyDay = 1, ref = new Date()) {
  const m = (Number(fyMonth) || 4) - 1
  const d = Math.max(1, Number(fyDay) || 1)
  let start = new Date(ref.getFullYear(), m, d)
  if (ref < start) start = new Date(ref.getFullYear() - 1, m, d)
  start.setHours(0, 0, 0, 0)
  return start
}

// Days approved + pending for one person within the current leave year.
export function leaveBalance(user, requests, fyMonth, fyDay = 1) {
  const start = leaveYearStart(fyMonth, fyDay)
  const end = new Date(start); end.setFullYear(end.getFullYear() + 1)
  const startKey = dateKey(start), endKey = dateKey(end)
  let booked = 0, pending = 0
  for (const r of requests) {
    if (r.requester_id !== user.id) continue
    if (!LEAVE_TYPES[r.leave_type]?.deducts) continue
    if (r.start_date < startKey || r.start_date >= endKey) continue
    const days = Number(r.total_days) || 0
    if (r.status === 'approved') booked += days
    else if (r.status === 'pending') pending += days
  }
  const allowance = Number(user.annual_allowance ?? 25)
  return { allowance, booked, pending, remaining: Math.round((allowance - booked) * 10) / 10 }
}

// Requests this person is responsible for approving and that are still pending.
export function pendingApprovalsFor(appUser, requests) {
  if (!appUser) return []
  const isAdmin = appUser.role === 'superadmin'
  return requests.filter(r => r.status === 'pending'
    && r.requester_id !== appUser.id
    && (isAdmin || r.approver_id === appUser.id))
}

export class LeaveView {
  constructor(app) {
    this.app = app
    this._tab = 'mine'           // mine | approvals | team | balances
    this._teamMonthOffset = 0
  }

  // ── Data accessors ────────────────────────────────────────────────────────
  get requests() { return this.app.leaveRequests || [] }
  get holidays() { return this.app.publicHolidays || [] }
  get users()    { return this.app.allUsers || [] }
  get me()       { return this.app.appUser }
  get fyMonth()  { return (this.app.settings?.leave_year_start_month || this.app.settings?.financial_year_start) ?? 4 }
  get fyDay()    { return this.app.settings?.leave_year_start_day ?? 1 }
  get isAdmin()  { return this.me?.role === 'superadmin' }
  get canBook()  { return this.me?.role !== 'viewer' }

  _holidaySet() { return new Set(this.holidays.map(h => h.holiday_date)) }
  _userName(id) { const u = this.users.find(x => x.id === id); return u ? (u.name || u.email) : 'Unknown' }

  // Working days (Mon–Fri, minus public holidays) in an inclusive date range.
  _workingDays(startKey, endKey, holidaySet) {
    let count = 0
    const d = new Date(startKey + 'T00:00:00')
    const end = new Date(endKey + 'T00:00:00')
    while (d <= end) {
      const dow = d.getDay()
      if (dow !== 0 && dow !== 6 && !holidaySet.has(dateKey(d))) count++
      d.setDate(d.getDate() + 1)
    }
    return count
  }

  // Deducted day total, accounting for half days.
  _computeTotal(startKey, endKey, startHalf, endHalf, holidaySet) {
    const wd = this._workingDays(startKey, endKey, holidaySet)
    if (wd <= 0) return 0
    if (startKey === endKey) return startHalf ? 0.5 : 1
    let total = wd
    if (startHalf) total -= 0.5
    if (endHalf)   total -= 0.5
    return Math.max(0.5, total)
  }

  _fmtDate(key) {
    return new Date(key + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  _fmtRange(r) {
    const half = (r.start_date === r.end_date)
      ? (r.start_half ? ' (half day)' : '')
      : `${r.start_half ? ' ½' : ''}`
    if (r.start_date === r.end_date) return this._fmtDate(r.start_date) + half
    return `${this._fmtDate(r.start_date)} → ${this._fmtDate(r.end_date)}`
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  render(mc) {
    const bal = this.me ? leaveBalance(this.me, this.requests, this.fyMonth, this.fyDay) : null
    const approvals = pendingApprovalsFor(this.me, this.requests)

    const tabs = [
      ['mine', 'My leave'],
      ['approvals', `Approvals${approvals.length ? ` (${approvals.length})` : ''}`],
      ['team', "Who's off"],
    ]
    if (this.isAdmin) tabs.push(['balances', 'Balances'])

    mc.innerHTML = `
      <div style="max-width:1080px">
        ${bal ? this._balanceCard(bal) : ''}
        <div style="display:flex;align-items:center;gap:8px;margin:18px 0 14px;flex-wrap:wrap">
          ${tabs.map(([id, label]) => `
            <button class="leave-tab" data-tab="${id}" style="padding:7px 14px;border-radius:20px;border:1px solid ${this._tab === id ? 'var(--accent)' : 'var(--border-med)'};background:${this._tab === id ? 'var(--accent)' : 'transparent'};color:${this._tab === id ? '#fff' : 'var(--text-secondary)'};font-size:13px;cursor:pointer;font-family:var(--font);transition:all 0.15s">${esc(label)}</button>`).join('')}
          <div style="margin-left:auto"></div>
          ${this.canBook ? `<button class="btn-primary" id="leave-book-btn">+ Book leave</button>` : ''}
        </div>
        <div id="leave-tab-body"></div>
      </div>`

    mc.querySelectorAll('.leave-tab').forEach(b => b.addEventListener('click', () => { this._tab = b.dataset.tab; this.render(mc) }))
    mc.querySelector('#leave-book-btn')?.addEventListener('click', () => this._openBookModal())

    this._renderTab(mc.querySelector('#leave-tab-body'))
  }

  _balanceCard(bal) {
    const cell = (label, value, color) => `
      <div style="flex:1;min-width:120px;padding:14px 16px;border-right:1px solid var(--border-light)">
        <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px">${label}</div>
        <div style="font-size:24px;font-weight:600;color:${color || 'var(--text-primary)'};margin-top:3px">${value}</div>
      </div>`
    return `
      <div class="panel" style="overflow:hidden">
        <div class="panel-header"><span class="panel-title">My allowance · ${esc(leaveYearStart(this.fyMonth, this.fyDay).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }))} – ${esc(new Date(leaveYearStart(this.fyMonth, this.fyDay).getFullYear() + 1, leaveYearStart(this.fyMonth, this.fyDay).getMonth(), 0).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }))}</span></div>
        <div style="display:flex;flex-wrap:wrap">
          ${cell('Allowance', bal.allowance, null)}
          ${cell('Booked', bal.booked, '#0891b2')}
          ${cell('Pending', bal.pending, '#d97706')}
          ${cell('Remaining', bal.remaining, bal.remaining < 0 ? '#dc2626' : '#16a34a')}
        </div>
      </div>`
  }

  _renderTab(body) {
    if (!body) return
    if (this._tab === 'mine')      return this._renderMine(body)
    if (this._tab === 'approvals') return this._renderApprovals(body)
    if (this._tab === 'team')      return this._renderTeam(body)
    if (this._tab === 'balances')  return this._renderBalances(body)
  }

  _statusPill(status) {
    const m = STATUS_META[status] || STATUS_META.pending
    return `<span style="font-size:11px;font-weight:500;color:${m.color};background:${m.bg};padding:2px 9px;border-radius:20px">${m.label}</span>`
  }

  _typeChip(type) {
    const t = LEAVE_TYPES[type] || LEAVE_TYPES.other
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary)"><span style="width:9px;height:9px;border-radius:2px;background:${t.color}"></span>${esc(t.label)}</span>`
  }

  // ── My leave ──────────────────────────────────────────────────────────────
  _renderMine(body) {
    const mine = this.requests.filter(r => r.requester_id === this.me?.id)
    if (!mine.length) {
      body.innerHTML = `<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-tertiary);font-size:13px">No leave booked yet.${this.canBook ? ' Hit <strong>Book leave</strong> to request some time off.' : ''}</div>`
      return
    }
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">${mine.map(r => this._requestRow(r, true)).join('')}</div>`
    this._bindRowActions(body)
  }

  _requestRow(r, mineView) {
    const today = dateKey(new Date())
    const canCancel = mineView && (r.status === 'pending' || (r.status === 'approved' && r.end_date >= today))
    const approverName = r.approver_id ? this._userName(r.approver_id) : 'Unassigned'
    return `
      <div style="border:1px solid var(--border-light);border-radius:var(--radius-md);padding:13px 15px;display:flex;align-items:center;gap:14px;flex-wrap:wrap" data-req="${r.id}">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            ${this._typeChip(r.leave_type)}
            ${this._statusPill(r.status)}
            <span style="font-size:12px;color:var(--text-tertiary)">${Number(r.total_days)} day${Number(r.total_days) === 1 ? '' : 's'}</span>
          </div>
          <div style="font-size:13px;color:var(--text-primary)">${esc(this._fmtRange(r))}</div>
          ${r.reason ? `<div style="font-size:12px;color:var(--text-tertiary);margin-top:3px">“${esc(r.reason)}”</div>` : ''}
          ${!mineView ? `<div style="font-size:12px;color:var(--text-tertiary);margin-top:3px">${esc(this._userName(r.requester_id))}</div>` : `<div style="font-size:11px;color:var(--text-tertiary);margin-top:3px">Approver: ${esc(approverName)}</div>`}
          ${r.status === 'declined' && r.decision_note ? `<div style="font-size:12px;color:#dc2626;margin-top:3px">Declined: ${esc(r.decision_note)}</div>` : ''}
        </div>
        ${canCancel ? `<button class="row-btn" data-cancel="${r.id}" style="font-size:11px;color:var(--red,#e05252);border-color:var(--red,#e05252)">Cancel</button>` : ''}
      </div>`
  }

  // ── Approvals ───────────────────────────────────────────────────────────────
  _renderApprovals(body) {
    const pending = pendingApprovalsFor(this.me, this.requests)
    const decided = this.requests.filter(r => r.decided_by === this.me?.id && r.status !== 'pending')
    if (!pending.length && !decided.length) {
      body.innerHTML = `<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-tertiary);font-size:13px">No leave requests need your approval.</div>`
      return
    }
    body.innerHTML = `
      ${pending.length ? `<div style="font-size:12px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Awaiting your decision</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">
        ${pending.map(r => `
          <div style="border:1px solid var(--border-light);border-radius:var(--radius-md);padding:13px 15px" data-req="${r.id}">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <div style="font-size:13px;font-weight:500;color:var(--text-primary);margin-bottom:4px">${esc(this._userName(r.requester_id))}</div>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:3px">${this._typeChip(r.leave_type)}<span style="font-size:12px;color:var(--text-tertiary)">${Number(r.total_days)} day${Number(r.total_days) === 1 ? '' : 's'}</span></div>
                <div style="font-size:13px;color:var(--text-primary)">${esc(this._fmtRange(r))}</div>
                ${r.reason ? `<div style="font-size:12px;color:var(--text-tertiary);margin-top:3px">“${esc(r.reason)}”</div>` : ''}
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn-primary" data-approve="${r.id}" style="font-size:12px;padding:6px 14px">Approve</button>
                <button class="row-btn" data-decline="${r.id}" style="font-size:12px;color:var(--red,#e05252);border-color:var(--red,#e05252)">Decline</button>
              </div>
            </div>
          </div>`).join('')}
      </div>` : ''}
      ${decided.length ? `<div style="font-size:12px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Previously decided by you</div>
      <div style="display:flex;flex-direction:column;gap:10px">${decided.map(r => this._requestRow(r, false)).join('')}</div>` : ''}`
    this._bindRowActions(body)
  }

  // ── Who's off (month wall chart) ─────────────────────────────────────────────
  _renderTeam(body) {
    const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + this._teamMonthOffset); base.setHours(0, 0, 0, 0)
    const month = base.getMonth()
    const days = []
    const d = new Date(base)
    while (d.getMonth() === month) { days.push(new Date(d)); d.setDate(d.getDate() + 1) }
    const label = base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    const holidaySet = this._holidaySet()
    const todayKey = dateKey(new Date())

    const approved = this.requests.filter(r => r.status === 'approved')
    // Only show users that have at least one approved leave this month, plus everyone if small team
    const inMonth = (r, key) => key >= r.start_date && key <= r.end_date
    const navBtn = 'background:var(--bg-secondary);border:1px solid var(--border-med);border-radius:var(--radius-md);padding:4px 11px;cursor:pointer;font-size:13px;color:var(--text-secondary);font-family:var(--font);line-height:1.2'

    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <button id="leave-team-prev" style="${navBtn}">‹</button>
        <button id="leave-team-today" style="${navBtn};font-size:12px">Today</button>
        <button id="leave-team-next" style="${navBtn}">›</button>
        <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-left:6px">${esc(label)}</div>
      </div>
      <div style="overflow-x:auto;border:1px solid var(--border-light);border-radius:var(--radius-md)">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:${140 + this.users.length * 70}px">
          <thead><tr style="background:var(--bg-secondary)">
            <th style="padding:7px 10px;text-align:left;font-weight:500;font-size:11px;color:var(--text-tertiary);position:sticky;left:0;background:var(--bg-secondary);border-right:1px solid var(--border-light)">Date</th>
            ${this.users.map(u => `<th style="padding:7px 6px;text-align:center;font-weight:500;font-size:11px;color:var(--text-secondary);border-right:1px solid var(--border-light);white-space:nowrap">${esc((u.name || u.email).split(' ')[0])}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${days.map(day => {
              const key = dateKey(day)
              const dow = day.getDay()
              const isWeekend = dow === 0 || dow === 6
              const isHol = holidaySet.has(key)
              const isToday = key === todayKey
              const rowBg = isToday ? 'rgba(var(--accent-rgb),0.07)' : (isWeekend || isHol) ? 'var(--bg-secondary)' : 'var(--bg-primary)'
              return `<tr style="background:${rowBg};border-top:1px solid var(--border-light)">
                <td style="padding:5px 10px;border-right:1px solid var(--border-light);white-space:nowrap;position:sticky;left:0;background:${rowBg};${isToday ? 'font-weight:600;color:var(--accent)' : isWeekend || isHol ? 'color:var(--text-tertiary)' : 'color:var(--text-secondary)'}">
                  ${day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}${isHol ? ' 🎌' : ''}
                </td>
                ${this.users.map(u => {
                  const r = approved.find(x => x.requester_id === u.id && inMonth(x, key))
                  if (!r) return `<td style="border-right:1px solid var(--border-light)"></td>`
                  const t = LEAVE_TYPES[r.leave_type] || LEAVE_TYPES.other
                  return `<td title="${esc(t.label)}" style="border-right:1px solid var(--border-light);background:${t.color}33;text-align:center"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.color}"></span></td>`
                }).join('')}
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text-tertiary)">
        ${Object.values(LEAVE_TYPES).map(t => `<span style="display:flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:${t.color}"></span>${esc(t.label)}</span>`).join('')}
      </div>`

    body.querySelector('#leave-team-prev')?.addEventListener('click', () => { this._teamMonthOffset--; this._renderTeam(body) })
    body.querySelector('#leave-team-next')?.addEventListener('click', () => { this._teamMonthOffset++; this._renderTeam(body) })
    body.querySelector('#leave-team-today')?.addEventListener('click', () => { this._teamMonthOffset = 0; this._renderTeam(body) })
  }

  // ── Balances (admin) ──────────────────────────────────────────────────────
  _renderBalances(body) {
    body.innerHTML = `
      <div style="overflow-x:auto;border:1px solid var(--border-light);border-radius:var(--radius-md)">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:var(--bg-secondary)">
            ${['Team member', 'Approver', 'Allowance', 'Booked', 'Pending', 'Remaining'].map((h, i) => `<th style="padding:9px 12px;text-align:${i === 0 || i === 1 ? 'left' : 'center'};font-weight:500;font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid var(--border-light)">${h}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${this.users.map(u => {
              const b = leaveBalance(u, this.requests, this.fyMonth, this.fyDay)
              return `<tr style="border-bottom:1px solid var(--border-light)">
                <td style="padding:9px 12px;color:var(--text-primary)">${esc(u.name || u.email)}</td>
                <td style="padding:9px 12px;color:var(--text-tertiary)">${u.approver_id ? esc(this._userName(u.approver_id)) : '—'}</td>
                <td style="padding:9px 12px;text-align:center">${b.allowance}</td>
                <td style="padding:9px 12px;text-align:center;color:#0891b2">${b.booked}</td>
                <td style="padding:9px 12px;text-align:center;color:#d97706">${b.pending}</td>
                <td style="padding:9px 12px;text-align:center;font-weight:600;color:${b.remaining < 0 ? '#dc2626' : '#16a34a'}">${b.remaining}</td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--text-tertiary)">Allowances and approvers are set per person under <strong>Settings → Users</strong>.</div>`
  }

  // ── Row actions (cancel / approve / decline) ────────────────────────────────
  _bindRowActions(body) {
    body.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => this._cancel(b.dataset.cancel)))
    body.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => this._decide(b.dataset.approve, 'approved')))
    body.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => this._decide(b.dataset.decline, 'declined')))
  }

  async _cancel(id) {
    const r = this.requests.find(x => x.id === id)
    if (!r || !confirm('Cancel this leave request?')) return
    try {
      const { updateLeaveRequest, deleteTeamCalendarEntry } = await import('../db/client.js')
      const updated = await updateLeaveRequest(this.app.userId, id, { status: 'cancelled' })
      if (r.calendar_entry_id) {
        try { await deleteTeamCalendarEntry(this.app.userId, r.calendar_entry_id) } catch (e) { console.error(e) }
        this.app.teamCalendarEntries = (this.app.teamCalendarEntries || []).filter(e => e.id !== r.calendar_entry_id)
      }
      this._replace(updated)
      this.app.toast('Leave cancelled')
      this._syncGoogleCalendar('delete', id)
      this._rerender()
    } catch (e) { console.error(e); this.app.toast('Could not cancel leave') }
  }

  async _decide(id, status) {
    const r = this.requests.find(x => x.id === id)
    if (!r) return
    let note = ''
    if (status === 'declined') {
      note = prompt('Reason for declining (optional):') ?? ''
      if (note === null) return
    }
    try {
      const { updateLeaveRequest, createTeamCalendarEntry } = await import('../db/client.js')
      const patch = { status, decision_note: note || null, decided_by: this.me.id, decided_at: new Date() }

      if (status === 'approved') {
        const t = LEAVE_TYPES[r.leave_type] || LEAVE_TYPES.other
        const entry = await createTeamCalendarEntry(this.app.userId, {
          assignee_id: r.requester_id,
          entry_date:  r.start_date,
          end_date:    r.start_date === r.end_date ? null : r.end_date,
          entry_type:  'leave',
          label:       t.label,
          color:       t.color,
          notes:       r.reason || null,
        })
        patch.calendar_entry_id = entry.id
        if (!this.app.teamCalendarEntries) this.app.teamCalendarEntries = []
        this.app.teamCalendarEntries.push(entry)
      }

      const updated = await updateLeaveRequest(this.app.userId, id, patch)
      this._replace(updated)
      this.app.toast(status === 'approved' ? 'Leave approved' : 'Leave declined')
      this._sendNotify('decided', id)
      if (status === 'approved') this._syncGoogleCalendar('create', id)
      this._rerender()
    } catch (e) { console.error(e); this.app.toast('Could not update request') }
  }

  _replace(updated) {
    const i = this.requests.findIndex(x => x.id === updated.id)
    if (i >= 0) this.app.leaveRequests[i] = updated
  }

  _rerender() {
    if (this.app.currentView === 'leave') this.render(document.getElementById('main-content'))
    this.app.updateLeaveBadge?.()
  }

  // Fire-and-forget: create or delete a Google Calendar event for a leave request.
  async _syncGoogleCalendar(action, requestId) {
    try {
      const { getAuthToken } = await import('../auth/clerk.js')
      const token = await getAuthToken()
      fetch('/api/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, requestId }),
      }).catch(e => console.warn('Google Calendar sync failed (non-fatal):', e))
    } catch (e) {
      console.warn('Google Calendar sync failed (non-fatal):', e)
    }
  }

  // Fire-and-forget: notify the relevant person by email. Never blocks UI.
  async _sendNotify(action, requestId) {
    try {
      const { getAuthToken } = await import('../auth/clerk.js')
      const token = await getAuthToken()
      await fetch('/api/reminders?type=leave-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, requestId }),
      })
    } catch (e) {
      console.warn('Leave email notification failed (non-fatal):', e)
    }
  }

  // ── Book leave modal ──────────────────────────────────────────────────────
  _openBookModal() {
    document.getElementById('leave-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'leave-modal'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,0.54);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px 16px'
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

    const today = dateKey(new Date())
    const holidaySet = this._holidaySet()
    const canPickPerson = this.isAdmin

    const render = (state = {}) => {
      const requesterId = state.requester_id ?? this.me.id
      const type   = state.leave_type ?? 'holiday'
      const start  = state.start_date ?? today
      const end    = state.end_date ?? start
      const startHalf = state.start_half ?? false
      const endHalf   = state.end_half ?? false
      const reason = state.reason ?? ''
      const single = start === end
      const total = this._computeTotal(start, end, startHalf, endHalf, holidaySet)
      const requester = this.users.find(u => u.id === requesterId) || this.me
      const bal = leaveBalance(requester, this.requests, this.fyMonth, this.fyDay)
      const deducts = LEAVE_TYPES[type]?.deducts
      const projected = Math.round((bal.remaining - (deducts ? total : 0)) * 10) / 10
      const approverName = requester.approver_id ? this._userName(requester.approver_id) : null

      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:480px;max-height:90vh;overflow-y:auto" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light)">
            <div style="font-size:14px;font-weight:600">Book leave</div>
            <button id="lm-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);padding:2px 6px;line-height:1">×</button>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            ${canPickPerson ? `
            <div>
              <div class="leave-lbl">Team member</div>
              <select id="lm-person" class="leave-input">
                ${this.users.map(u => `<option value="${u.id}" ${u.id === requesterId ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}
              </select>
            </div>` : ''}
            <div>
              <div class="leave-lbl">Leave type</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${Object.entries(LEAVE_TYPES).map(([val, t]) => `
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:5px 11px;border:1px solid ${type === val ? t.color : 'var(--border-med)'};border-radius:var(--radius-md);font-size:12px;background:${type === val ? t.color + '22' : 'var(--bg-secondary)'};color:${type === val ? t.color : 'var(--text-secondary)'}">
                    <input type="radio" name="lm-type" value="${val}" ${type === val ? 'checked' : ''} style="display:none">
                    <span style="width:9px;height:9px;border-radius:2px;background:${t.color}"></span>${esc(t.label)}
                  </label>`).join('')}
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <div class="leave-lbl">From</div>
                <input type="date" id="lm-start" class="leave-input" value="${start}" style="color-scheme:var(--color-scheme,light)">
              </div>
              <div>
                <div class="leave-lbl">To</div>
                <input type="date" id="lm-end" class="leave-input" value="${end}" min="${start}" style="color-scheme:var(--color-scheme,light)">
              </div>
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap">
              ${single ? `
                <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:var(--text-secondary)">
                  <input type="checkbox" id="lm-starthalf" ${startHalf ? 'checked' : ''} style="accent-color:var(--accent)"> Half day
                </label>` : `
                <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:var(--text-secondary)">
                  <input type="checkbox" id="lm-starthalf" ${startHalf ? 'checked' : ''} style="accent-color:var(--accent)"> First day is a half day
                </label>
                <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:var(--text-secondary)">
                  <input type="checkbox" id="lm-endhalf" ${endHalf ? 'checked' : ''} style="accent-color:var(--accent)"> Last day is a half day
                </label>`}
            </div>
            <div>
              <div class="leave-lbl">Reason / note (optional)</div>
              <input type="text" id="lm-reason" class="leave-input" value="${esc(reason)}" placeholder="e.g. Family holiday">
            </div>
            <div style="background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
              <div style="font-size:13px;color:var(--text-primary)"><strong>${total}</strong> working day${total === 1 ? '' : 's'}${deducts ? '' : ' <span style="color:var(--text-tertiary)">(not deducted)</span>'}</div>
              ${deducts ? `<div style="font-size:12px;color:${projected < 0 ? '#dc2626' : 'var(--text-tertiary)'}">Remaining after: <strong>${projected}</strong></div>` : ''}
            </div>
            ${approverName ? `<div style="font-size:12px;color:var(--text-tertiary)">This request will be sent to <strong>${esc(approverName)}</strong> for approval.</div>`
              : `<div style="font-size:12px;color:#d97706">No approver is assigned${canPickPerson ? ' for this person' : ' to you'} — a Superadmin can approve it. Set approvers under Settings → Users.</div>`}
            ${deducts && projected < 0 ? `<div style="font-size:12px;color:#dc2626">⚠ This exceeds the remaining allowance.</div>` : ''}
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
              <button class="btn-cancel" id="lm-cancel">Cancel</button>
              <button class="btn-primary" id="lm-submit" ${total <= 0 ? 'disabled' : ''}>Submit request</button>
            </div>
          </div>
        </div>`

      const collect = () => ({
        requester_id: overlay.querySelector('#lm-person')?.value || requesterId,
        leave_type:   overlay.querySelector('input[name="lm-type"]:checked')?.value || type,
        start_date:   overlay.querySelector('#lm-start').value,
        end_date:     overlay.querySelector('#lm-end').value,
        start_half:   overlay.querySelector('#lm-starthalf')?.checked || false,
        end_half:     overlay.querySelector('#lm-endhalf')?.checked || false,
        reason:       overlay.querySelector('#lm-reason').value,
      })
      const refresh = () => {
        const s = collect()
        if (s.end_date < s.start_date) s.end_date = s.start_date
        if (s.start_date === s.end_date) s.end_half = false
        render(s)
      }

      overlay.querySelector('#lm-close').addEventListener('click', () => overlay.remove())
      overlay.querySelector('#lm-cancel').addEventListener('click', () => overlay.remove())
      overlay.querySelector('#lm-person')?.addEventListener('change', refresh)
      overlay.querySelectorAll('input[name="lm-type"]').forEach(el => el.addEventListener('change', refresh))
      overlay.querySelector('#lm-start').addEventListener('change', refresh)
      overlay.querySelector('#lm-end').addEventListener('change', refresh)
      overlay.querySelector('#lm-starthalf')?.addEventListener('change', refresh)
      overlay.querySelector('#lm-endhalf')?.addEventListener('change', refresh)
      overlay.querySelector('#lm-submit').addEventListener('click', () => this._submit(collect(), overlay))
    }

    render()
    document.body.appendChild(overlay)
  }

  async _submit(s, overlay) {
    const holidaySet = this._holidaySet()
    const total = this._computeTotal(s.start_date, s.end_date, s.start_half, s.end_half, holidaySet)
    if (total <= 0) { this.app.toast('Select at least one working day'); return }
    const requester = this.users.find(u => u.id === s.requester_id) || this.me
    try {
      const { createLeaveRequest } = await import('../db/client.js')
      const created = await createLeaveRequest(this.app.userId, {
        requester_id: s.requester_id,
        approver_id:  requester.approver_id || null,
        leave_type:   s.leave_type,
        start_date:   s.start_date,
        end_date:     s.end_date,
        start_half:   s.start_half,
        end_half:     s.end_half,
        total_days:   String(total),
        reason:       s.reason || null,
        status:       'pending',
      })
      if (!this.app.leaveRequests) this.app.leaveRequests = []
      this.app.leaveRequests.unshift(created)
      overlay.remove()
      this.app.toast('Leave request submitted')
      this._sendNotify('submitted', created.id)
      this._tab = 'mine'
      this._rerender()
    } catch (e) { console.error(e); this.app.toast('Could not submit request') }
  }
}
