const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export class PasswordManagerView {
  constructor(app) {
    this.app = app
    this.credentials = null
    this.search = ''
    this.visibleIds = new Set()
  }

  async _load() {
    const { getCredentials } = await import('../db/client.js')
    this.credentials = await getCredentials(this.app.userId)
  }

  async render(mc) {
    mc.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:60px;color:var(--text-tertiary);font-size:13px">Loading…</div>`
    try {
      await this._load()
    } catch(e) {
      mc.innerHTML = `<div style="padding:40px;color:var(--text-tertiary);font-size:13px">Failed to load credentials.</div>`
      return
    }
    this._render(mc)
  }

  _render(mc) {
    const creds = this.credentials ?? []
    const q = this.search.toLowerCase()
    const filtered = q
      ? creds.filter(c => (c.program||'').toLowerCase().includes(q) || (c.login||'').toLowerCase().includes(q) || (c.category||'').toLowerCase().includes(q) || (c.notes||'').toLowerCase().includes(q))
      : creds

    // Group by category (null/empty → 'Uncategorised')
    const groups = {}
    for (const c of filtered) {
      const cat = c.category?.trim() || 'Uncategorised'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(c)
    }
    const sortedCats = Object.keys(groups).sort((a, b) => {
      if (a === 'Uncategorised') return 1
      if (b === 'Uncategorised') return -1
      return a.localeCompare(b)
    })

    mc.innerHTML = `
      <div style="max-width:960px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
          <div style="position:relative;flex:1;max-width:340px">
            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-tertiary);pointer-events:none">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            </span>
            <input id="pm-search" type="text" value="${esc(this.search)}" placeholder="Search programs…"
              style="width:100%;padding:7px 10px 7px 30px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;box-sizing:border-box">
          </div>
          <button class="btn-primary" id="pm-add-btn">+ Add credential</button>
        </div>

        ${creds.length === 0 && !q ? `
          <div class="panel" style="padding:48px;text-align:center">
            <div style="font-size:32px;margin-bottom:12px">🔑</div>
            <div style="font-size:14px;font-weight:500;margin-bottom:6px">No credentials yet</div>
            <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:20px">Store logins for all your tools and services in one place.</div>
            <button class="btn-primary" id="pm-add-btn-2">+ Add your first credential</button>
          </div>
        ` : filtered.length === 0 ? `
          <div style="padding:40px;text-align:center;color:var(--text-tertiary);font-size:13px">No results for "${esc(q)}"</div>
        ` : sortedCats.map(cat => `
          <div style="margin-bottom:24px">
            <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;padding-left:2px">${esc(cat)}</div>
            <div class="panel">
              <table style="width:100%;border-collapse:collapse">
                <thead>
                  <tr style="border-bottom:1px solid var(--border-light)">
                    <th style="padding:10px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:left;width:22%">Program</th>
                    <th style="padding:10px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:left;width:24%">Email / Login</th>
                    <th style="padding:10px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:left;width:24%">Password</th>
                    <th style="padding:10px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:left">Notes</th>
                    <th style="padding:10px 16px;font-size:11px;font-weight:500;color:var(--text-tertiary);text-align:right;white-space:nowrap;width:80px"></th>
                  </tr>
                </thead>
                <tbody>
                  ${groups[cat].map((c, i) => `
                    <tr class="pm-row" data-id="${c.id}" style="border-bottom:${i < groups[cat].length - 1 ? '1px solid var(--border-light)' : 'none'}">
                      <td style="padding:12px 16px;font-size:13px;font-weight:500;color:var(--text-primary)">
                        ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--text-primary);text-decoration:none;border-bottom:1px solid var(--border-light)" title="${esc(c.url)}">${esc(c.program)}</a>` : esc(c.program)}
                      </td>
                      <td style="padding:12px 16px">
                        <div style="display:flex;align-items:center;gap:6px">
                          <span style="font-size:13px;color:var(--text-secondary);font-family:monospace">${esc(c.login) || '<span style="color:var(--text-tertiary)">—</span>'}</span>
                          ${c.login ? `<button class="pm-copy" data-val="${esc(c.login)}" data-id="${c.id}" data-field="login" title="Copy email/login" style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:2px;line-height:0;border-radius:var(--radius-sm);transition:color 0.15s" onmouseover="this.style.color='var(--text-secondary)'" onmouseout="this.style.color='var(--text-tertiary)'">${this._iconCopy()}</button>` : ''}
                        </div>
                      </td>
                      <td style="padding:12px 16px">
                        <div style="display:flex;align-items:center;gap:6px">
                          <span class="pm-pw-display" data-id="${c.id}" style="font-size:13px;color:var(--text-secondary);font-family:monospace;letter-spacing:${this.visibleIds.has(c.id) ? 'normal' : '2px'}">${c.password ? (this.visibleIds.has(c.id) ? esc(c.password) : '••••••••') : '<span style="color:var(--text-tertiary);letter-spacing:normal">—</span>'}</span>
                          ${c.password ? `
                            <button class="pm-toggle-pw" data-id="${c.id}" title="${this.visibleIds.has(c.id) ? 'Hide' : 'Show'} password" style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:2px;line-height:0;border-radius:var(--radius-sm);transition:color 0.15s" onmouseover="this.style.color='var(--text-secondary)'" onmouseout="this.style.color='var(--text-tertiary)'">${this.visibleIds.has(c.id) ? this._iconEyeOff() : this._iconEye()}</button>
                            <button class="pm-copy" data-val="${esc(c.password)}" data-id="${c.id}" data-field="password" title="Copy password" style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:2px;line-height:0;border-radius:var(--radius-sm);transition:color 0.15s" onmouseover="this.style.color='var(--text-secondary)'" onmouseout="this.style.color='var(--text-tertiary)'">${this._iconCopy()}</button>
                          ` : ''}
                        </div>
                      </td>
                      <td style="padding:12px 16px;font-size:12px;color:var(--text-tertiary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.notes) || ''}</td>
                      <td style="padding:12px 16px;text-align:right;white-space:nowrap">
                        <button class="pm-edit" data-id="${c.id}" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:4px 6px;font-size:12px;border-radius:var(--radius-sm);transition:color 0.15s" onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-tertiary)'">Edit</button>
                        <button class="pm-delete" data-id="${c.id}" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:4px 6px;font-size:12px;border-radius:var(--radius-sm);transition:color 0.15s" onmouseover="this.style.color='var(--accent-red,#e53e3e)'" onmouseout="this.style.color='var(--text-tertiary)'">Delete</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    `

    this._bind(mc)
  }

  _bind(mc) {
    mc.querySelector('#pm-search')?.addEventListener('input', e => {
      this.search = e.target.value
      this._render(mc)
    })

    mc.querySelector('#pm-add-btn')?.addEventListener('click', () => this._openModal(mc, null))
    mc.querySelector('#pm-add-btn-2')?.addEventListener('click', () => this._openModal(mc, null))

    mc.querySelectorAll('.pm-toggle-pw').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id
        if (this.visibleIds.has(id)) {
          this.visibleIds.delete(id)
        } else {
          // Reveal is a deliberate per-item click — record it.
          this.visibleIds.add(id)
          this._logVaultActivity(this.credentials.find(c => c.id === id), 'Password revealed')
        }
        this._render(mc)
      })
    })

    mc.querySelectorAll('.pm-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.val)
          const orig = btn.innerHTML
          btn.innerHTML = this._iconCheck()
          btn.style.color = 'var(--accent-green, #38a169)'
          setTimeout(() => { btn.innerHTML = orig; btn.style.color = 'var(--text-tertiary)' }, 1500)
          if (btn.dataset.id) {
            this._logVaultActivity(this.credentials.find(c => c.id === btn.dataset.id),
              btn.dataset.field === 'password' ? 'Password copied' : 'Login copied')
          }
        } catch { /* clipboard not available */ }
      })
    })

    mc.querySelectorAll('.pm-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const cred = this.credentials.find(c => c.id === btn.dataset.id)
        if (cred) this._openModal(mc, cred)
      })
    })

    mc.querySelectorAll('.pm-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await this.app.confirm({ title: 'Delete credential?', confirmLabel: 'Delete' })) return
        try {
          const { deleteCredential } = await import('../db/client.js')
          await deleteCredential(this.app.userId, btn.dataset.id)
          this.credentials = this.credentials.filter(c => c.id !== btn.dataset.id)
          this.visibleIds.delete(btn.dataset.id)
          this._render(mc)
        } catch(e) { console.error(e); this.app.toast('Failed to delete credential') }
      })
    })
  }

  _openModal(mc, existing) {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'

    const categories = [...new Set((this.credentials ?? []).map(c => c.category).filter(Boolean))].sort()

    overlay.innerHTML = `
      <div style="background:var(--bg-primary);border:0.5px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,0.25)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:0.5px solid var(--border-light)">
          <div style="font-size:14px;font-weight:600">${existing ? 'Edit credential' : 'Add credential'}</div>
          <button id="pm-modal-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary);line-height:1;padding:4px">×</button>
        </div>
        <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
          <div class="field">
            <div class="field-label">Program / Service *</div>
            <input id="pm-f-program" type="text" value="${esc(existing?.program ?? '')}" placeholder="e.g. WeTransfer Pro" />
          </div>
          <div class="field">
            <div class="field-label">Email / Login</div>
            <input id="pm-f-login" type="text" value="${esc(existing?.login ?? '')}" placeholder="e.g. hello@wearepeny.com" autocomplete="off" />
          </div>
          <div class="field">
            <div class="field-label">Password</div>
            <div style="position:relative">
              <input id="pm-f-password" type="password" value="${esc(existing?.password ?? '')}" placeholder="Password" autocomplete="new-password"
                style="width:100%;padding-right:36px;box-sizing:border-box" />
              <button id="pm-pw-toggle" type="button" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:0;line-height:0">${this._iconEye()}</button>
            </div>
          </div>
          <div class="field">
            <div class="field-label">URL (optional)</div>
            <input id="pm-f-url" type="text" value="${esc(existing?.url ?? '')}" placeholder="https://wetransfer.com" />
          </div>
          <div class="field">
            <div class="field-label">Category (optional)</div>
            <input id="pm-f-category" type="text" value="${esc(existing?.category ?? '')}" placeholder="e.g. Adobe, Cloud Storage…" list="pm-cats" />
            <datalist id="pm-cats">${categories.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
          </div>
          <div class="field">
            <div class="field-label">Notes (optional)</div>
            <input id="pm-f-notes" type="text" value="${esc(existing?.notes ?? '')}" placeholder="e.g. x2 seat licence" />
          </div>
          <div id="pm-modal-err" style="font-size:12px;color:var(--accent-red,#e53e3e);display:none"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px">
            <button class="btn-cancel" id="pm-modal-cancel">Cancel</button>
            <button class="btn-primary" id="pm-modal-save">${existing ? 'Save changes' : 'Add credential'}</button>
          </div>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    const closeModal = () => overlay.remove()
    overlay.addEventListener('click', closeModal)
    overlay.querySelector('#pm-modal-close').addEventListener('click', closeModal)
    overlay.querySelector('#pm-modal-cancel').addEventListener('click', closeModal)

    const pwInput = overlay.querySelector('#pm-f-password')
    const pwToggle = overlay.querySelector('#pm-pw-toggle')
    pwToggle.addEventListener('click', () => {
      const isHidden = pwInput.type === 'password'
      pwInput.type = isHidden ? 'text' : 'password'
      pwToggle.innerHTML = isHidden ? this._iconEyeOff() : this._iconEye()
    })

    overlay.querySelector('#pm-modal-save').addEventListener('click', async () => {
      const program = overlay.querySelector('#pm-f-program').value.trim()
      if (!program) {
        const err = overlay.querySelector('#pm-modal-err')
        err.textContent = 'Program name is required.'
        err.style.display = 'block'
        return
      }
      const data = {
        program,
        login:    overlay.querySelector('#pm-f-login').value.trim() || null,
        password: overlay.querySelector('#pm-f-password').value || null,
        url:      overlay.querySelector('#pm-f-url').value.trim() || null,
        category: overlay.querySelector('#pm-f-category').value.trim() || null,
        notes:    overlay.querySelector('#pm-f-notes').value.trim() || null,
      }
      const saveBtn = overlay.querySelector('#pm-modal-save')
      saveBtn.disabled = true
      saveBtn.textContent = 'Saving…'
      try {
        const { createCredential, updateCredential } = await import('../db/client.js')
        if (existing) {
          const updated = await updateCredential(this.app.userId, existing.id, data)
          const idx = this.credentials.findIndex(c => c.id === existing.id)
          if (idx >= 0) this.credentials[idx] = updated
        } else {
          const created = await createCredential(this.app.userId, data)
          this.credentials.push(created)
        }
        closeModal()
        this._render(mc)
      } catch(e) {
        saveBtn.disabled = false
        saveBtn.textContent = existing ? 'Save changes' : 'Add credential'
        const err = overlay.querySelector('#pm-modal-err')
        err.textContent = 'Failed to save: ' + e.message
        err.style.display = 'block'
      }
    })

    overlay.querySelector('#pm-f-program').focus()
  }

  // Record vault access (reveal/copy) to the shared activity log, if available.
  async _logVaultActivity(cred, summary) {
    if (!cred) return
    try {
      const { logActivity } = await import('../db/client.js')
      await logActivity(this.app.userId, 'credential', cred.id, cred.program || 'Credential', summary)
    } catch (e) { console.error('Vault activity log failed:', e) }
  }

  _iconCopy() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>`
  }

  _iconCheck() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 8.5L6 12l7.5-8"/></svg>`
  }

  _iconEye() {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8c0 0 2.5-5 7-5s7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>`
  }

  _iconEyeOff() {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2l12 12M6.5 6.7A2 2 0 0 0 9.3 9.5"/><path d="M4.2 4.4C2.7 5.4 1 8 1 8s2.5 5 7 5c1.4 0 2.6-.4 3.6-1M6 3.2C6.6 3.1 7.3 3 8 3c4.5 0 7 5 7 5s-.7 1.4-2 2.6"/></svg>`
  }
}
