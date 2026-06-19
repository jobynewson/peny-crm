const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

// "2026_BU1_A" style drive names and free-text fields, formatted for display.
function fmtDate(v) {
  if (!v) return '—'
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtBytes(n) {
  const bytes = Number(n)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0, val = bytes
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`
}

function statusBadge(passed) {
  const ok = !!passed
  const color = ok ? 'var(--accent-green,#38a169)' : 'var(--accent-red,#e53e3e)'
  return `<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;color:${color};background:${color}1a;white-space:nowrap">${ok ? 'Pass' : 'Fail'}</span>`
}

export class OffloadLogView {
  constructor(app) {
    this.app = app
    this.offloads = null
    this.search = ''
    this.expandedIds = new Set()
  }

  // Pick a backup by its label ("Backup 1" / "Backup 2"), falling back to index
  // so unexpected labels still render in a stable order.
  _backup(o, label, index) {
    const list = o.backups ?? []
    return list.find(b => (b.label ?? '').toLowerCase() === label.toLowerCase()) ?? list[index] ?? null
  }

  async _load() {
    const { getOffloads } = await import('../db/client.js')
    this.offloads = await getOffloads()
  }

  async render(mc) {
    mc.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:60px;color:var(--text-tertiary);font-size:13px">Loading…</div>`
    try {
      await this._load()
    } catch (e) {
      console.error(e)
      mc.innerHTML = `<div style="padding:40px;color:var(--text-tertiary);font-size:13px">Failed to load the offload log.</div>`
      return
    }
    this._render(mc)
  }

  _filtered() {
    const all = this.offloads ?? []
    const q = this.search.toLowerCase().trim()
    if (!q) return all
    return all.filter(o => {
      const driveNames = (o.backups ?? []).map(b => b.drive_name ?? '').join(' ')
      return [o.client, o.project, driveNames].some(v => (v ?? '').toLowerCase().includes(q))
    })
  }

  _render(mc) {
    const all = this.offloads ?? []
    const rows = this._filtered()
    const q = this.search.trim()

    const th = (label, extra = '') => `<th style="padding:10px 14px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:left;white-space:nowrap;${extra}">${label}</th>`

    mc.innerHTML = `
      <div style="max-width:1180px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
          <div style="position:relative;flex:1;min-width:240px;max-width:380px">
            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-tertiary);pointer-events:none">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            </span>
            <input id="ol-search" type="text" value="${esc(this.search)}" placeholder="Search by client, project or drive name…"
              style="width:100%;padding:7px 10px 7px 30px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;box-sizing:border-box">
          </div>
          <div style="font-size:12px;color:var(--text-tertiary)">${rows.length} of ${all.length} offload${all.length === 1 ? '' : 's'}</div>
        </div>

        ${all.length === 0 ? `
          <div class="panel" style="padding:48px;text-align:center">
            <div style="font-size:32px;margin-bottom:12px">💾</div>
            <div style="font-size:14px;font-weight:500;margin-bottom:6px">No offloads logged yet</div>
            <div style="font-size:13px;color:var(--text-tertiary)">Reports appear here automatically when Fence offloads a project to external drives.</div>
          </div>
        ` : rows.length === 0 ? `
          <div style="padding:40px;text-align:center;color:var(--text-tertiary);font-size:13px">No results for "${esc(q)}"</div>
        ` : `
          <div class="panel" style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;min-width:1040px">
              <thead>
                <tr style="border-bottom:1px solid var(--border-light)">
                  ${th('Date')}${th('Year')}${th('Industry')}${th('Client')}${th('Project')}
                  ${th('Backup 1 Drive')}${th('Backup 2 Drive')}${th('Drive Type')}${th('Location')}
                  ${th('Status', 'text-align:right')}
                </tr>
              </thead>
              <tbody>
                ${rows.map((o, i) => this._rowHtml(o, i < rows.length - 1)).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `

    this._bind(mc)
  }

  _rowHtml(o, hasBorder) {
    const b1 = this._backup(o, 'Backup 1', 0)
    const b2 = this._backup(o, 'Backup 2', 1)
    const expanded = this.expandedIds.has(o.id)
    const td = (content, extra = '') => `<td style="padding:11px 14px;font-size:13px;color:var(--text-primary);white-space:nowrap;${extra}">${content}</td>`
    const dim = v => v ? esc(v) : '<span style="color:var(--text-tertiary)">—</span>'
    const mono = v => v ? `<span style="font-family:monospace;font-size:12px">${esc(v)}</span>` : '<span style="color:var(--text-tertiary)">—</span>'
    const borderStyle = hasBorder && !expanded ? 'border-bottom:1px solid var(--border-light)' : 'border-bottom:none'

    return `
      <tr class="ol-row" data-id="${o.id}" style="cursor:pointer;${borderStyle}" title="Click to ${expanded ? 'collapse' : 'expand'}">
        ${td(`<span style="display:inline-flex;align-items:center;gap:6px"><span style="color:var(--text-tertiary);transition:transform 0.15s;display:inline-block;transform:rotate(${expanded ? '90' : '0'}deg)">▸</span>${fmtDate(o.offloaded_at)}</span>`)}
        ${td(dim(o.year))}
        ${td(dim(o.industry))}
        ${td(dim(o.client), 'font-weight:500')}
        ${td(dim(o.project), 'font-weight:500')}
        ${td(mono(b1?.drive_name))}
        ${td(mono(b2?.drive_name))}
        ${td(dim(o.drive_type))}
        ${td(dim(o.location))}
        ${td(statusBadge(o.overall_passed), 'text-align:right')}
      </tr>
      ${expanded ? `
        <tr class="ol-detail" data-detail="${o.id}" style="${hasBorder ? 'border-bottom:1px solid var(--border-light)' : ''}">
          <td colspan="10" style="padding:0 14px 18px 14px;background:var(--bg-secondary)">
            ${this._detailHtml(o)}
          </td>
        </tr>
      ` : ''}
    `
  }

  _detailHtml(o) {
    const notes = (o.notes ?? '').trim()
    const b1 = this._backup(o, 'Backup 1', 0)
    const b2 = this._backup(o, 'Backup 2', 1)

    return `
      <div style="padding-top:14px;display:flex;flex-direction:column;gap:16px">
        ${o.source_path ? `<div style="font-size:12px;color:var(--text-secondary)"><span style="color:var(--text-tertiary)">Source:</span> <span style="font-family:monospace">${esc(o.source_path)}</span></div>` : ''}
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px">Notes</div>
          <div style="font-size:13px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap">${notes ? esc(notes) : '<span style="color:var(--text-tertiary)">No notes</span>'}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
          ${this._backupCardHtml(b1)}
          ${this._backupCardHtml(b2)}
        </div>
      </div>
    `
  }

  _backupCardHtml(b) {
    if (!b) return `<div style="border:1px solid var(--border-light);border-radius:var(--radius-md);padding:14px;font-size:12px;color:var(--text-tertiary)">No backup data</div>`
    const folders = Array.isArray(b.folder_results) ? b.folder_results : []
    return `
      <div style="border:1px solid var(--border-light);border-radius:var(--radius-md);background:var(--bg-primary);overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 14px;border-bottom:1px solid var(--border-light)">
          <div>
            <div style="font-size:13px;font-weight:600">${esc(b.label ?? 'Backup')}</div>
            <div style="font-size:12px;color:var(--text-secondary);font-family:monospace;margin-top:1px">${esc(b.drive_name ?? '—')}</div>
          </div>
          ${statusBadge(b.passed)}
        </div>
        <div style="padding:11px 14px;display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary)">
          ${b.destination_path ? `<div><span style="color:var(--text-tertiary)">Destination:</span> <span style="font-family:monospace;font-size:11px">${esc(b.destination_path)}</span></div>` : ''}
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <span><span style="color:var(--text-tertiary)">Verification:</span> ${esc(b.verification_mode ?? '—')}</span>
            <span><span style="color:var(--text-tertiary)">Files:</span> ${Number(b.total_files ?? 0).toLocaleString('en-GB')}</span>
            <span><span style="color:var(--text-tertiary)">Size:</span> ${fmtBytes(b.total_size_bytes)}</span>
          </div>
        </div>
        ${folders.length ? `
          <table style="width:100%;border-collapse:collapse;border-top:1px solid var(--border-light)">
            <thead>
              <tr style="border-bottom:1px solid var(--border-light)">
                <th style="padding:7px 14px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:left;text-transform:uppercase;letter-spacing:0.5px">Folder</th>
                <th style="padding:7px 14px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:right;text-transform:uppercase;letter-spacing:0.5px">Files</th>
                <th style="padding:7px 14px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:right;text-transform:uppercase;letter-spacing:0.5px">Result</th>
              </tr>
            </thead>
            <tbody>
              ${folders.map((f, i) => `
                <tr style="${i < folders.length - 1 ? 'border-bottom:1px solid var(--border-light)' : ''}">
                  <td style="padding:7px 14px;font-size:12px;color:var(--text-primary);font-family:monospace">${esc(f.folder ?? '—')}</td>
                  <td style="padding:7px 14px;font-size:12px;color:var(--text-secondary);text-align:right">${Number(f.fileCount ?? 0).toLocaleString('en-GB')}</td>
                  <td style="padding:7px 14px;text-align:right">${statusBadge(f.passed)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `<div style="padding:11px 14px;font-size:12px;color:var(--text-tertiary);border-top:1px solid var(--border-light)">No folder-level results</div>`}
      </div>
    `
  }

  _bind(mc) {
    const searchEl = mc.querySelector('#ol-search')
    if (searchEl) {
      searchEl.addEventListener('input', e => {
        this.search = e.target.value
        const start = searchEl.selectionStart
        this._render(mc)
        const next = mc.querySelector('#ol-search')
        if (next) { next.focus(); next.setSelectionRange(start, start) }
      })
    }

    mc.querySelectorAll('.ol-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id
        if (this.expandedIds.has(id)) this.expandedIds.delete(id)
        else this.expandedIds.add(id)
        this._render(mc)
      })
    })
  }
}
