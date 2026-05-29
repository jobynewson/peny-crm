const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const fmt2 = n => Number(n || 0).toFixed(2)

const TYPE_ICON = {
  mileage:   `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="13" r="1.2"/><path d="M5.5 13V8.5l2.5-6 2.5 6V13"/><path d="M6 10h4"/></svg>`,
  expense:   `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="12" height="8" rx="1.2"/><path d="M5 5V4a3 3 0 016 0v1"/><path d="M8 8.5v1"/><circle cx="8" cy="8" r=".7" fill="currentColor"/></svg>`,
  overnight: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 10A6 6 0 016 3a6 6 0 100 10 6 6 0 007-3z"/></svg>`,
}
const TYPE_COLOR = { mileage: 'var(--accent)', expense: '#059669', overnight: '#7c3aed' }
const CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 8l4 4 6-7"/></svg>`

export class ExpensesView {
  constructor(app) {
    this.app = app
    this.entries = null
    this.submissions = null
    this._addType = 'mileage'
  }

  async _load() {
    const { getExpenseEntries, getExpenseSubmissions } = await import('../db/client.js')
    const [entries, submissions] = await Promise.all([
      getExpenseEntries(this.app.userId, this.app.clerkUserId),
      getExpenseSubmissions(this.app.userId, this.app.clerkUserId),
    ])
    this.entries = entries
    this.submissions = submissions
  }

  async render(mc) {
    mc.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:60px;color:var(--text-tertiary);font-size:13px">Loading…</div>`
    try { await this._load() } catch(e) {
      mc.innerHTML = `<div style="padding:40px;color:var(--text-tertiary);font-size:13px">Failed to load expenses.</div>`
      return
    }
    this._render(mc)
  }

  _render(mc) {
    const now = new Date()
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const mileageRate = parseFloat(this.app.settings?.mileage_rate ?? 45) / 100

    const byMonth = {}
    for (const e of this.entries ?? []) {
      const mk = e.entry_date.slice(0, 7)
      if (!byMonth[mk]) byMonth[mk] = []
      byMonth[mk].push(e)
    }

    const submittedMonths = new Set((this.submissions ?? []).map(s => s.month_key))
    const currentEntries = byMonth[currentMonthKey] ?? []
    const isCurrentSubmitted = submittedMonths.has(currentMonthKey)
    const pastMonths = Object.keys(byMonth).filter(mk => mk < currentMonthKey).sort((a, b) => b.localeCompare(a))

    const projects = this.app.projects ?? []

    mc.innerHTML = `
      <div style="max-width:860px">

        <!-- Add entry form -->
        <div class="panel" style="margin-bottom:20px">
          <div class="panel-header"><span class="panel-title">Log expense</span></div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${['mileage', 'expense', 'overnight'].map(t => `
                <button class="exp-type-btn" data-type="${t}" style="padding:6px 16px;border-radius:20px;border:1px solid ${this._addType === t ? 'var(--accent)' : 'var(--border-med)'};background:${this._addType === t ? 'var(--accent)' : 'transparent'};color:${this._addType === t ? '#fff' : 'var(--text-secondary)'};font-size:13px;cursor:pointer;font-family:var(--font);transition:all 0.15s">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join('')}
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
              <div class="field" style="flex:0 0 auto">
                <div class="field-label">Date</div>
                <input type="date" id="exp-date" value="${now.toISOString().slice(0, 10)}" style="color-scheme:var(--color-scheme,light)" />
              </div>
              ${this._addType === 'mileage' ? `
                <div class="field" style="flex:0 0 auto">
                  <div class="field-label">Miles</div>
                  <input type="number" id="exp-miles" placeholder="0" min="0" step="0.1" style="width:88px" />
                </div>` : this._addType === 'expense' ? `
                <div class="field" style="flex:0 0 auto">
                  <div class="field-label">Amount (£)</div>
                  <input type="number" id="exp-amount" placeholder="0.00" min="0" step="0.01" style="width:96px" />
                </div>` : `
                <div class="field" style="flex:0 0 auto">
                  <div class="field-label">Nights</div>
                  <input type="number" id="exp-overnights" value="1" min="1" style="width:72px" />
                </div>`}
              <div class="field" style="flex:2;min-width:160px">
                <div class="field-label">Description</div>
                <input type="text" id="exp-desc" placeholder="${this._addType === 'mileage' ? 'e.g. Travel to client shoot' : this._addType === 'expense' ? 'e.g. Equipment hire' : 'e.g. London overnight'}" />
              </div>
              <div class="field" style="flex:2;min-width:160px">
                <div class="field-label">Project / reference</div>
                <select id="exp-project">
                  <option value="">— Select —</option>
                  <option value="__other__">Other (specify below)</option>
                  ${projects.filter(p => p.status !== 'Archived').map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
                </select>
              </div>
              <div class="field exp-other-wrap" style="flex:1;min-width:120px;display:none">
                <div class="field-label">Other reference</div>
                <input type="text" id="exp-other-title" placeholder="e.g. Team travel" />
              </div>
            </div>
            <div><button class="btn-primary" id="exp-add-btn">Add entry</button></div>
          </div>
        </div>

        <!-- Current month -->
        <div class="panel" style="margin-bottom:20px">
          <div class="panel-header" style="display:flex;align-items:center;justify-content:space-between">
            <span class="panel-title">${this._fmtMonth(currentMonthKey)}</span>
            ${isCurrentSubmitted
              ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#d1fae5;color:#065f46;border-radius:20px;font-size:12px;font-weight:500">${CHECK_ICON} Submitted</span>`
              : `<button class="btn-primary" id="exp-submit-now-btn" style="font-size:12px;padding:5px 12px">Submit expenses now</button>`}
          </div>
          ${this._renderEntries(currentEntries, mileageRate, projects)}
        </div>

        <!-- Past months -->
        ${pastMonths.length ? `
          <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;padding-left:2px">Previous months</div>
          ${pastMonths.map(mk => {
            const submitted = submittedMonths.has(mk)
            return `
              <div class="panel" style="margin-bottom:10px">
                <div class="exp-month-head" data-mk="${mk}" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;user-select:none">
                  <div style="display:flex;align-items:center;gap:10px">
                    <svg class="exp-chev" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" style="transition:transform 0.15s;flex-shrink:0"><path d="M5 7l3 3 3-3"/></svg>
                    <span style="font-size:14px;font-weight:500;color:var(--text-primary)">${this._fmtMonth(mk)}</span>
                    ${submitted ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#d1fae5;color:#065f46;border-radius:12px;font-size:11px;font-weight:500">${CHECK_ICON} Submitted</span>` : ''}
                  </div>
                  <span style="font-size:12px;color:var(--text-tertiary)">${this._summary(byMonth[mk], mileageRate)}</span>
                </div>
                <div class="exp-month-body" data-mk="${mk}" style="display:none;border-top:1px solid var(--border-light)">
                  ${this._renderEntries(byMonth[mk], mileageRate, projects)}
                </div>
              </div>`
          }).join('')}
        ` : ''}
      </div>`

    this._bind(mc, currentMonthKey)
  }

  _fmtMonth(mk) {
    const [y, m] = mk.split('-')
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  }

  _summary(entries, mileageRate) {
    let mi = 0, amt = 0, nights = 0
    for (const e of entries ?? []) {
      if (e.type === 'mileage') mi += parseFloat(e.miles ?? 0)
      if (e.type === 'expense') amt += parseFloat(e.amount ?? 0)
      if (e.type === 'overnight') nights += parseInt(e.overnights ?? 0)
    }
    const parts = []
    if (mi) parts.push(`${mi}mi = £${fmt2(mi * mileageRate)}`)
    if (amt) parts.push(`£${fmt2(amt)} expenses`)
    if (nights) parts.push(`${nights} night${nights !== 1 ? 's' : ''}`)
    return parts.join(' · ') || 'No entries'
  }

  _renderEntries(entries, mileageRate, projects) {
    if (!entries?.length) return `<div style="padding:24px 16px;text-align:center;font-size:13px;color:var(--text-tertiary)">No entries this month.</div>`

    let totalMiles = 0, totalAmt = 0, totalNights = 0
    for (const e of entries) {
      if (e.type === 'mileage') totalMiles += parseFloat(e.miles ?? 0)
      if (e.type === 'expense') totalAmt += parseFloat(e.amount ?? 0)
      if (e.type === 'overnight') totalNights += parseInt(e.overnights ?? 0)
    }

    const totals = [
      totalMiles  ? `${totalMiles}mi = £${fmt2(totalMiles * mileageRate)}` : null,
      totalAmt    ? `£${fmt2(totalAmt)} expenses` : null,
      totalNights ? `${totalNights} night${totalNights !== 1 ? 's' : ''}` : null,
    ].filter(Boolean)

    const sorted = [...entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date))

    return `
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:1px solid var(--border-light)">
          <th style="padding:8px 8px 8px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:left;width:28px"></th>
          <th style="padding:8px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:left">Date</th>
          <th style="padding:8px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:left">Description</th>
          <th style="padding:8px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:left">Project / ref</th>
          <th style="padding:8px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:right">Amount</th>
          <th style="padding:8px 8px;width:28px"></th>
        </tr></thead>
        <tbody>
          ${sorted.map(e => {
            const ref = e.project_id
              ? (projects.find(p => p.id === e.project_id)?.name ?? '—')
              : (e.other_title || '—')
            const amtCell = e.type === 'mileage'
              ? `${e.miles}mi <span style="color:var(--text-tertiary);font-size:11px">(£${fmt2(parseFloat(e.miles ?? 0) * mileageRate)})</span>`
              : e.type === 'expense'
              ? `£${fmt2(parseFloat(e.amount ?? 0))}`
              : `${e.overnights} night${parseInt(e.overnights) !== 1 ? 's' : ''}`
            return `
              <tr style="border-bottom:1px solid var(--border-light)">
                <td style="padding:10px 4px 10px 16px">
                  <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${TYPE_COLOR[e.type]}1a;color:${TYPE_COLOR[e.type]}">${TYPE_ICON[e.type]}</span>
                </td>
                <td style="padding:10px 16px;font-size:13px;color:var(--text-secondary);white-space:nowrap">${new Date(e.entry_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                <td style="padding:10px 16px;font-size:13px;color:var(--text-primary)">${esc(e.description || '—')}</td>
                <td style="padding:10px 16px;font-size:13px;color:var(--text-secondary)">${esc(ref)}</td>
                <td style="padding:10px 16px;font-size:13px;color:var(--text-primary);text-align:right;white-space:nowrap">${amtCell}</td>
                <td style="padding:10px 8px">
                  <button class="row-btn exp-del" data-id="${e.id}" style="color:var(--text-tertiary)" title="Remove">×</button>
                </td>
              </tr>`
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:var(--bg-secondary)">
            <td colspan="4" style="padding:10px 16px;font-size:12px;font-weight:600;color:var(--text-secondary)">Total</td>
            <td style="padding:10px 16px;font-size:13px;font-weight:600;color:var(--text-primary);text-align:right">${totals.join(' + ') || '—'}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>`
  }

  _bind(mc, currentMonthKey) {
    // Type toggle
    mc.querySelectorAll('.exp-type-btn').forEach(btn =>
      btn.addEventListener('click', () => { this._addType = btn.dataset.type; this._render(mc) })
    )

    // Project → show other-title field
    mc.querySelector('#exp-project')?.addEventListener('change', e => {
      const wrap = mc.querySelector('.exp-other-wrap')
      if (wrap) wrap.style.display = e.target.value === '__other__' ? '' : 'none'
    })

    // Add entry
    mc.querySelector('#exp-add-btn')?.addEventListener('click', () => this._addEntry(mc, currentMonthKey))

    // Submit now
    mc.querySelector('#exp-submit-now-btn')?.addEventListener('click', () => this._submitMonth(mc, currentMonthKey))

    // Past month accordion
    mc.querySelectorAll('.exp-month-head').forEach(head => {
      head.addEventListener('click', () => {
        const mk = head.dataset.mk
        const body = mc.querySelector(`.exp-month-body[data-mk="${mk}"]`)
        const chev = head.querySelector('.exp-chev')
        if (!body) return
        const open = body.style.display !== 'none'
        body.style.display = open ? 'none' : ''
        if (chev) chev.style.transform = open ? '' : 'rotate(180deg)'
      })
    })

    // Delete
    mc.querySelectorAll('.exp-del').forEach(btn =>
      btn.addEventListener('click', () => this._deleteEntry(mc, btn.dataset.id))
    )
  }

  async _addEntry(mc, currentMonthKey) {
    const date = mc.querySelector('#exp-date')?.value
    if (!date) { this.app.toast('Please select a date'); return }

    const projVal = mc.querySelector('#exp-project')?.value || ''
    const projectId = projVal && projVal !== '__other__' ? projVal : null
    const otherTitle = projVal === '__other__' ? (mc.querySelector('#exp-other-title')?.value.trim() || null) : null

    const entry = {
      workspace_id: this.app.userId,
      clerk_user_id: this.app.clerkUserId,
      entry_date: date,
      type: this._addType,
      description: mc.querySelector('#exp-desc')?.value.trim() || null,
      project_id: projectId,
      other_title: otherTitle,
    }

    if (this._addType === 'mileage') {
      const miles = parseFloat(mc.querySelector('#exp-miles')?.value || '0')
      if (!miles) { this.app.toast('Please enter miles'); return }
      entry.miles = miles
    } else if (this._addType === 'expense') {
      const amount = parseFloat(mc.querySelector('#exp-amount')?.value || '0')
      if (!amount) { this.app.toast('Please enter an amount'); return }
      entry.amount = amount
    } else {
      const nights = parseInt(mc.querySelector('#exp-overnights')?.value || '0')
      if (!nights) { this.app.toast('Please enter number of nights'); return }
      entry.overnights = nights
    }

    try {
      const { createExpenseEntry } = await import('../db/client.js')
      const [row] = await createExpenseEntry(entry)
      this.entries = [...(this.entries ?? []), row]
      this.app.toast('Entry added')
      this._render(mc)
    } catch(e) {
      console.error(e)
      this.app.toast('Error adding entry')
    }
  }

  async _deleteEntry(mc, id) {
    try {
      const { deleteExpenseEntry } = await import('../db/client.js')
      await deleteExpenseEntry(id)
      this.entries = (this.entries ?? []).filter(e => e.id !== id)
      this.app.toast('Entry removed')
      this._render(mc)
    } catch(e) {
      console.error(e)
      this.app.toast('Error removing entry')
    }
  }

  async _submitMonth(mc, monthKey) {
    try {
      const { createExpenseSubmission } = await import('../db/client.js')
      const row = await createExpenseSubmission({ workspace_id: this.app.userId, clerk_user_id: this.app.clerkUserId, month_key: monthKey })
      this.submissions = [...(this.submissions ?? []), row]
      this.app.toast('Expenses submitted')
      this._render(mc)
    } catch(e) {
      console.error(e)
      this.app.toast('Error submitting expenses')
    }
  }
}
