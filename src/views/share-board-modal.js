// src/views/share-board-modal.js
// "Share with clients": pick which client companies see a Planning board or
// canvas in their portal. View only — they can look and move around but not
// change anything. Saved through /api/board-shares (api/_board-shares.js).

import { listCompanies } from '../api/companies.js'
import { getBoardShares, setBoardShares } from '../api/board-shares.js'

/** @param {any} s */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// kind: 'board' | 'canvas'. Resolves to the number of companies it is shared with once saved.
/** @param {any} app @param {{ kind: 'board' | 'canvas', id: string, name: string }} item @param {(count: number) => void} [onSaved] */
export async function openShareModal(app, { kind, id, name }, onSaved) {
  document.getElementById('share-board-modal')?.remove()
  const overlay = document.createElement('div')
  overlay.id = 'share-board-modal'
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--scrim);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'
  overlay.innerHTML = `
    <div role="dialog" aria-modal="true" aria-label="Share with clients" style="background:var(--bg-primary);border:1px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:420px;max-height:90vh;display:flex;flex-direction:column;padding:20px" onclick="event.stopPropagation()">
      <div style="font-size:14px;font-weight:600">Share “${esc(name)}” with clients</div>
      <div style="font-size:12px;color:var(--text-tertiary);line-height:1.5;margin:4px 0 12px">Signed-in people at the companies you tick can open it from their portal. View only: they can look around but can’t change anything${kind === 'canvas' ? '. Boards inside it are shared too' : ''}.</div>
      <div id="sb-list" style="overflow:auto;display:flex;flex-direction:column;gap:2px;min-height:60px;font-size:13px;color:var(--text-tertiary)">Loading…</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button class="btn-cancel" id="sb-cancel">Cancel</button>
        <button class="btn-primary" id="sb-save" disabled>Save</button>
      </div>
    </div>`
  overlay.addEventListener('click', () => overlay.remove())
  document.body.appendChild(overlay)
  overlay.querySelector('#sb-cancel')?.addEventListener('click', () => overlay.remove())

  const list = /** @type {HTMLElement} */ (overlay.querySelector('#sb-list'))
  const save = /** @type {HTMLButtonElement} */ (overlay.querySelector('#sb-save'))
  try {
    const [companies, shared] = await Promise.all([listCompanies(), getBoardShares(kind, id)])
    const on = new Set(shared.map((/** @type {any} */ c) => c.id))
    // Clients only; a company that is already ticked stays listed whatever its type.
    const rows = companies.filter((/** @type {any} */ c) => c.type === 'client' || on.has(c.id))
    if (!rows.length) { list.textContent = 'There are no client companies yet.'; return }
    list.style.color = ''
    list.innerHTML = rows.map((/** @type {any} */ c) => `
      <label style="display:flex;align-items:center;gap:10px;padding:7px 4px;cursor:pointer;color:var(--text-primary)">
        <input type="checkbox" value="${esc(c.id)}"${on.has(c.id) ? ' checked' : ''}>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
        ${c.clerk_org_id ? '' : '<span style="font-size:11px;color:var(--text-tertiary)">no portal yet</span>'}
      </label>`).join('')
    save.disabled = false
    save.addEventListener('click', async () => {
      const ids = [...list.querySelectorAll('input:checked')].map(i => /** @type {HTMLInputElement} */ (i).value)
      save.disabled = true
      try {
        const saved = await setBoardShares(kind, id, ids)
        overlay.remove()
        app.toast(saved.length ? `Shared with ${saved.length} compan${saved.length === 1 ? 'y' : 'ies'}` : 'Not shared with anyone')
        onSaved?.(saved.length)
      } catch (/** @type {any} */ e) {
        console.error(e)
        save.disabled = false
        app.toast(e?.message || 'Could not save sharing')
      }
    })
  } catch (e) {
    console.error(e)
    list.textContent = 'Could not load companies. Close this and try again.'
  }
}
