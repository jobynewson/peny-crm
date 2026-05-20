import {
  getStoryPlans,
  createStoryPlan,
  updateStoryPlan,
  deleteStoryPlan,
} from '../db/client.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export class StoryPlannerView {
  constructor(app) {
    this.app = app
    this.currentPlanId = null
    this.plan = null
    this.plans = null
  }

  async render(mc) {
    if (this.currentPlanId) {
      this._renderEditorHTML(mc)
    } else {
      await this._renderList(mc)
    }
  }

  // ── List view ─────────────────────────────────────────────────────────────

  async _renderList(mc) {
    mc.innerHTML = `<div style="padding:20px;max-width:900px"><div style="color:var(--text-tertiary);font-size:13px">Loading plans…</div></div>`
    try {
      this.plans = await getStoryPlans(this.app.userId)
    } catch(e) {
      console.error(e)
      this.plans = []
    }
    this._renderListHTML(mc)
  }

  _renderListHTML(mc) {
    const plans = this.plans || []
    mc.innerHTML = `
      <div style="max-width:900px;padding:24px 20px">
        ${plans.length === 0 ? `
          <div style="text-align:center;padding:80px 20px;color:var(--text-tertiary)">
            <div style="font-size:36px;margin-bottom:16px">🎬</div>
            <div style="font-size:16px;font-weight:500;color:var(--text-primary);margin-bottom:6px">No story plans yet</div>
            <div style="font-size:13px;margin-bottom:24px">Build a timeline for your edit — block by block.</div>
            <button class="btn-primary" id="sp-new-plan-empty">+ Create your first plan</button>
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
            ${plans.map(p => this._planCardHTML(p)).join('')}
          </div>
        `}
      </div>
    `
    mc.querySelector('#sp-new-plan-empty')?.addEventListener('click', () => this._openNewPlanModal(mc))
    mc.querySelectorAll('[data-sp-open]').forEach(el => {
      el.addEventListener('click', () => this._openPlan(mc, el.dataset.spOpen))
    })
    mc.querySelectorAll('[data-sp-delete]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        this._deletePlan(mc, el.dataset.spDelete, el.dataset.spTitle)
      })
    })
  }

  _planCardHTML(plan) {
    const blocks = plan.blocks || []
    const totalMins = blocks.reduce((s, b) => s + (parseFloat(b.duration_mins) || 0), 0)
    return `
      <div data-sp-open="${plan.id}"
        style="background:var(--bg-secondary);border:0.5px solid var(--border-light);border-radius:var(--radius-md);padding:16px 16px 14px;cursor:pointer;transition:border-color 0.15s;position:relative;min-height:80px"
        onmouseover="this.style.borderColor='var(--border-strong)'" onmouseout="this.style.borderColor='var(--border-light)'">
        <button data-sp-delete="${plan.id}" data-sp-title="${esc(plan.title)}" draggable="false"
          style="position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:16px;line-height:1;padding:3px 6px;border-radius:3px"
          onmouseover="this.style.color='#e07070'" onmouseout="this.style.color='var(--text-tertiary)'">×</button>
        <div style="font-size:14px;font-weight:500;margin-bottom:5px;padding-right:22px">${esc(plan.title)}</div>
        <div style="font-size:12px;color:var(--text-tertiary)">
          ${blocks.length} block${blocks.length !== 1 ? 's' : ''}${totalMins > 0 ? ` · ${fmtDuration(totalMins)}` : ''}
        </div>
        ${blocks.length > 0 ? `
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:3px">
            ${blocks.slice(0, 3).map(b => `
              <div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                · ${esc(b.title)}${b.duration_mins ? ` <span style="color:var(--text-tertiary)">(${fmtDuration(b.duration_mins)})</span>` : ''}
              </div>`).join('')}
            ${blocks.length > 3 ? `<div style="font-size:11px;color:var(--text-tertiary)">+ ${blocks.length - 3} more</div>` : ''}
          </div>
        ` : ''}
      </div>
    `
  }

  // ── Plan editor ───────────────────────────────────────────────────────────

  _openPlan(mc, planId) {
    this.currentPlanId = planId
    this.plan = (this.plans || []).find(p => p.id === planId) || { id: planId, title: 'Plan', blocks: [] }
    this._renderEditorHTML(mc)
  }

  _renderEditorHTML(mc) {
    const plan = this.plan || { title: '', blocks: [] }
    const blocks = plan.blocks || []
    const totalMins = blocks.reduce((s, b) => s + (parseFloat(b.duration_mins) || 0), 0)

    mc.innerHTML = `
      <div style="max-width:700px;padding:24px 20px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <button class="btn-secondary" id="sp-back" style="flex-shrink:0">← Plans</button>
          <input id="sp-plan-title" value="${esc(plan.title)}"
            style="flex:1;font-size:17px;font-weight:600;background:transparent;border:none;outline:none;color:var(--text-primary);font-family:var(--font);min-width:0;border-bottom:1.5px solid transparent;padding:2px 0;transition:border-color 0.15s"
            onfocus="this.style.borderBottomColor='var(--accent,#4a90d9)'"
            onblur="this.style.borderBottomColor='transparent'" />
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn-secondary" id="sp-export-btn">Export ↓</button>
            <button class="btn-primary" id="sp-add-block">+ Block</button>
          </div>
        </div>

        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:20px;padding-left:2px">
          ${blocks.length} block${blocks.length !== 1 ? 's' : ''}
          ${totalMins > 0
            ? ` · <span style="color:var(--text-secondary)">${fmtDuration(totalMins)} total (${fmtTimecode(totalMins)})</span>`
            : ' · No duration set yet'}
        </div>

        <div id="sp-blocks-list">
          ${blocks.length > 0
            ? blocks.map((b, i) => this._blockCardHTML(b, i)).join('')
            : `<div style="border:1.5px dashed var(--border-light);border-radius:var(--radius-md);padding:48px 24px;text-align:center;color:var(--text-tertiary);font-size:13px">
                Add your first block to build the story timeline
               </div>`}
        </div>

        ${blocks.length > 4 ? `
          <div style="margin-top:12px;padding-top:12px;border-top:0.5px solid var(--border-light)">
            <button class="btn-secondary" id="sp-add-block-btm">+ Add block</button>
          </div>
        ` : ''}
      </div>
    `

    mc.querySelector('#sp-back')?.addEventListener('click', () => {
      this.currentPlanId = null
      this.plan = null
      if (this.plans) this._renderListHTML(mc)
      else this._renderList(mc)
    })

    const titleInput = mc.querySelector('#sp-plan-title')
    titleInput?.addEventListener('blur', async () => {
      const newTitle = titleInput.value.trim() || plan.title
      if (newTitle !== plan.title) {
        this.plan.title = newTitle
        try { await updateStoryPlan(this.app.userId, this.currentPlanId, { title: newTitle, blocks: this.plan.blocks }) }
        catch(e) { console.error(e) }
        const idx = (this.plans || []).findIndex(p => p.id === this.currentPlanId)
        if (idx !== -1) this.plans[idx].title = newTitle
      }
    })
    titleInput?.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur() })

    mc.querySelector('#sp-add-block')?.addEventListener('click', () => this._openBlockModal(mc))
    mc.querySelector('#sp-add-block-btm')?.addEventListener('click', () => this._openBlockModal(mc))
    mc.querySelector('#sp-export-btn')?.addEventListener('click', () => {
      this._showExportMenu(mc.querySelector('#sp-export-btn'))
    })

    mc.querySelectorAll('[data-sp-block-edit]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        const block = (this.plan.blocks || []).find(b => b.id === el.dataset.spBlockEdit)
        if (block) this._openBlockModal(mc, block)
      })
    })
    mc.querySelectorAll('[data-sp-block-del]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        this._deleteBlock(mc, el.dataset.spBlockDel)
      })
    })

    this._bindDragDrop(mc)
  }

  _blockCardHTML(block, index) {
    const duration = parseFloat(block.duration_mins) || 0
    const imgSrc = block.image_url
      ? (block.image_url.includes('.blob.vercel-storage.com')
          ? `/api/blob?url=${encodeURIComponent(block.image_url)}`
          : block.image_url)
      : null
    return `
      <div class="sp-block" data-id="${block.id}" draggable="true"
        style="display:flex;align-items:stretch;background:var(--bg-secondary);border:0.5px solid var(--border-light);border-radius:var(--radius-md);margin-bottom:8px;overflow:hidden;transition:box-shadow 0.12s,opacity 0.15s">

        <div class="sp-drag-handle"
          style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 9px;background:var(--bg-tertiary);border-right:0.5px solid var(--border-light);gap:5px;flex-shrink:0;cursor:grab;user-select:none">
          <span style="font-size:10px;font-weight:600;color:var(--text-tertiary);line-height:1">${String(index + 1).padStart(2, '0')}</span>
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" style="opacity:0.3;flex-shrink:0;color:var(--text-secondary)">
            <circle cx="2.5" cy="2" r="1.2"/><circle cx="7.5" cy="2" r="1.2"/>
            <circle cx="2.5" cy="6" r="1.2"/><circle cx="7.5" cy="6" r="1.2"/>
            <circle cx="2.5" cy="10" r="1.2"/><circle cx="7.5" cy="10" r="1.2"/>
          </svg>
        </div>

        <div style="flex:1;padding:10px 14px;min-width:0">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:${block.description || duration ? '3px' : '0'}">${esc(block.title)}</div>
          ${block.description ? `<div style="font-size:12px;color:var(--text-secondary);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:${duration ? '6px' : '0'}">${esc(block.description)}</div>` : ''}
          ${duration > 0 ? `<span style="font-size:11px;background:rgba(74,144,217,0.12);color:#4a90d9;border-radius:4px;padding:2px 7px;font-weight:500;display:inline-block">${fmtDuration(duration)}</span>` : ''}
        </div>

        ${imgSrc ? `<div style="width:72px;flex-shrink:0;overflow:hidden;border-left:0.5px solid var(--border-light)"><img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover" loading="lazy" /></div>` : ''}

        <div style="display:flex;flex-direction:column;justify-content:center;gap:4px;padding:8px 10px;border-left:0.5px solid var(--border-light);flex-shrink:0">
          <button data-sp-block-edit="${block.id}" draggable="false"
            style="background:none;border:0.5px solid var(--border-light);border-radius:4px;cursor:pointer;color:var(--text-tertiary);padding:3px 9px;font-size:11px;font-family:var(--font);line-height:1.5;transition:color 0.1s"
            onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-tertiary)'">Edit</button>
          <button data-sp-block-del="${block.id}" draggable="false"
            style="background:none;border:0.5px solid var(--border-light);border-radius:4px;cursor:pointer;color:var(--text-tertiary);padding:3px 9px;font-size:11px;font-family:var(--font);line-height:1.5;transition:color 0.1s"
            onmouseover="this.style.color='#e07070'" onmouseout="this.style.color='var(--text-tertiary)'">×</button>
        </div>
      </div>
    `
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────

  _bindDragDrop(mc) {
    const list = mc.querySelector('#sp-blocks-list')
    if (!list) return
    let dragSrcId = null

    list.querySelectorAll('.sp-block').forEach(card => {
      card.addEventListener('dragstart', e => {
        dragSrcId = card.dataset.id
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', card.dataset.id)
        setTimeout(() => { card.style.opacity = '0.4' }, 0)
      })
      card.addEventListener('dragend', () => {
        card.style.opacity = ''
        list.querySelectorAll('.sp-block').forEach(c => c.style.boxShadow = '')
        dragSrcId = null
      })
      card.addEventListener('dragover', e => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (card.dataset.id !== dragSrcId) {
          list.querySelectorAll('.sp-block').forEach(c => c.style.boxShadow = '')
          card.style.boxShadow = '0 -3px 0 0 var(--accent,#4a90d9)'
        }
      })
      card.addEventListener('dragleave', () => {
        card.style.boxShadow = ''
      })
      card.addEventListener('drop', async e => {
        e.preventDefault()
        list.querySelectorAll('.sp-block').forEach(c => c.style.boxShadow = '')
        if (!dragSrcId || card.dataset.id === dragSrcId) return
        const blocks = this.plan.blocks
        const si = blocks.findIndex(b => b.id === dragSrcId)
        const di = blocks.findIndex(b => b.id === card.dataset.id)
        if (si === -1 || di === -1) return
        const [moved] = blocks.splice(si, 1)
        blocks.splice(di, 0, moved)
        await this._savePlan()
        this._renderEditorHTML(mc)
      })
    })
  }

  // ── Block modal ───────────────────────────────────────────────────────────

  _openBlockModal(mc, block = null) {
    const isEdit = !!block
    let imageUrl = block?.image_url || null

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'

    const setStatus = (msg, color = 'var(--text-tertiary)') => {
      const el = overlay.querySelector('#bm-img-status')
      if (el) { el.textContent = msg; el.style.color = color; el.style.display = 'block' }
    }

    const uploadImage = async (file) => {
      setStatus('Uploading…')
      try {
        const base64 = await new Promise((res, rej) => {
          const img = new Image()
          const objUrl = URL.createObjectURL(file)
          img.onload = () => {
            URL.revokeObjectURL(objUrl)
            const MAX = 2000
            let { width, height } = img
            if (width > MAX || height > MAX) {
              if (width > height) { height = Math.round(height * MAX / width); width = MAX }
              else { width = Math.round(width * MAX / height); height = MAX }
            }
            const canvas = document.createElement('canvas')
            canvas.width = width; canvas.height = height
            canvas.getContext('2d').drawImage(img, 0, 0, width, height)
            res(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
          }
          img.onerror = rej
          img.src = objUrl
        })
        const resp = await fetch('/api/blob', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64,
            filename: (file.name || 'image').replace(/\.[^.]+$/, '.jpg'),
            contentType: 'image/jpeg',
          }),
        })
        const data = await resp.json()
        if (!resp.ok || !data.url) throw new Error(data.error || 'Upload failed')
        imageUrl = data.url
        renderModal()
      } catch(e) {
        console.error(e)
        setStatus('Upload failed — ' + e.message, '#e07070')
      }
    }

    const imgSrc = () => imageUrl
      ? (imageUrl.includes('.blob.vercel-storage.com')
          ? `/api/blob?url=${encodeURIComponent(imageUrl)}`
          : imageUrl)
      : null

    const renderModal = () => {
      overlay.innerHTML = `
        <div style="background:var(--bg-primary);border:0.5px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:460px;overflow:hidden" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:0.5px solid var(--border-light)">
            <div style="font-size:14px;font-weight:600">${isEdit ? 'Edit block' : 'New block'}</div>
            <button id="bm-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);line-height:1;padding:0 2px">×</button>
          </div>
          <div style="padding:18px;display:flex;flex-direction:column;gap:13px;overflow-y:auto;max-height:65vh">
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Title *</label>
              <input id="bm-title" value="${esc(block?.title || '')}" placeholder="e.g. Intro, B-roll, Interview, Outro…"
                style="width:100%;padding:8px 11px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-size:13px;font-family:var(--font);outline:none;box-sizing:border-box;transition:border-color 0.15s"
                onfocus="this.style.borderColor='var(--accent,#4a90d9)'" onblur="this.style.borderColor='var(--border-med)'" />
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Description</label>
              <textarea id="bm-desc" placeholder="Shot notes, action, dialogue cues…"
                style="width:100%;min-height:72px;padding:8px 11px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-size:13px;font-family:var(--font);outline:none;resize:vertical;line-height:1.5;box-sizing:border-box;transition:border-color 0.15s"
                onfocus="this.style.borderColor='var(--accent,#4a90d9)'" onblur="this.style.borderColor='var(--border-med)'">${esc(block?.description || '')}</textarea>
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Duration (minutes)</label>
              <div style="display:flex;align-items:center;gap:10px">
                <input id="bm-duration" type="number" min="0" step="0.25" value="${block?.duration_mins ?? ''}" placeholder="e.g. 0.5"
                  style="width:110px;padding:8px 11px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-size:13px;font-family:var(--font);outline:none;transition:border-color 0.15s"
                  onfocus="this.style.borderColor='var(--accent,#4a90d9)'" onblur="this.style.borderColor='var(--border-med)'" />
                <span style="font-size:12px;color:var(--text-tertiary)">min — 0.5 = 30 sec</span>
              </div>
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:6px">Image</label>
              ${imgSrc() ? `
                <div style="position:relative;display:inline-block;margin-bottom:8px">
                  <img src="${imgSrc()}" style="max-width:200px;max-height:120px;border-radius:var(--radius-sm);border:0.5px solid var(--border-light);object-fit:cover;display:block" />
                  <button id="bm-img-remove"
                    style="position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-radius:50%;background:var(--bg-primary);border:0.5px solid var(--border-med);cursor:pointer;font-size:13px;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;line-height:1">×</button>
                </div>
              ` : ''}
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <label for="bm-img-upload"
                  style="cursor:pointer;font-size:12px;padding:5px 11px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);color:var(--text-secondary);background:var(--bg-secondary);font-family:var(--font);flex-shrink:0"
                  onmouseover="this.style.borderColor='var(--border-strong)'" onmouseout="this.style.borderColor='var(--border-med)'">
                  ${imgSrc() ? 'Replace image' : '+ Upload image'}
                </label>
                <input id="bm-img-upload" type="file" accept="image/*" style="display:none" />
                <button id="bm-img-paste"
                  style="font-size:12px;padding:5px 11px;border:0.5px solid var(--border-med);border-radius:var(--radius-sm);color:var(--text-secondary);background:var(--bg-secondary);cursor:pointer;font-family:var(--font);flex-shrink:0"
                  onmouseover="this.style.borderColor='var(--border-strong)'" onmouseout="this.style.borderColor='var(--border-med)'">Paste screenshot</button>
              </div>
              <div id="bm-img-status" style="font-size:11px;margin-top:5px;display:none"></div>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding:13px 18px;border-top:0.5px solid var(--border-light)">
            <button class="btn-cancel" id="bm-cancel">Cancel</button>
            <button class="btn-primary" id="bm-save">${isEdit ? 'Save changes' : 'Add block'}</button>
          </div>
        </div>
      `

      overlay.querySelector('#bm-close')?.addEventListener('click', () => overlay.remove())
      overlay.querySelector('#bm-cancel')?.addEventListener('click', () => overlay.remove())

      overlay.querySelector('#bm-img-remove')?.addEventListener('click', () => {
        if (imageUrl?.includes('.blob.vercel-storage.com')) {
          fetch(`/api/blob?url=${encodeURIComponent(imageUrl)}`, { method: 'DELETE' }).catch(() => {})
        }
        imageUrl = null
        renderModal()
        setTimeout(() => overlay.querySelector('#bm-title')?.focus(), 10)
      })

      overlay.querySelector('#bm-img-upload')?.addEventListener('change', e => {
        const file = e.target.files[0]
        if (file) uploadImage(file)
        e.target.value = ''
      })

      overlay.querySelector('#bm-img-paste')?.addEventListener('click', async () => {
        try {
          const items = await navigator.clipboard.read()
          for (const item of items) {
            const imgType = item.types.find(t => t.startsWith('image/'))
            if (imgType) {
              const blob = await item.getType(imgType)
              await uploadImage(new File([blob], 'screenshot.png', { type: imgType }))
              return
            }
          }
          setStatus('No image in clipboard — copy a screenshot first', '#e07070')
        } catch(e) {
          setStatus('Clipboard access denied — use the upload button instead', 'var(--text-tertiary)')
        }
      })

      // Ctrl+V paste anywhere in modal
      overlay.addEventListener('paste', e => {
        const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
        if (item) { const file = item.getAsFile(); if (file) uploadImage(file) }
      })

      overlay.querySelector('#bm-save')?.addEventListener('click', async () => {
        const title = overlay.querySelector('#bm-title')?.value.trim()
        if (!title) {
          const inp = overlay.querySelector('#bm-title')
          inp.style.borderColor = '#e07070'
          inp.focus()
          return
        }
        const desc = overlay.querySelector('#bm-desc')?.value.trim() || null
        const durVal = overlay.querySelector('#bm-duration')?.value
        const duration_mins = durVal ? (parseFloat(durVal) || null) : null

        const btn = overlay.querySelector('#bm-save')
        btn.disabled = true; btn.textContent = 'Saving…'

        try {
          if (isEdit) {
            const idx = (this.plan.blocks || []).findIndex(b => b.id === block.id)
            if (idx !== -1) {
              this.plan.blocks[idx] = { ...this.plan.blocks[idx], title, description: desc, image_url: imageUrl, duration_mins }
            }
          } else {
            if (!this.plan.blocks) this.plan.blocks = []
            this.plan.blocks.push({
              id: crypto.randomUUID(),
              title, description: desc, image_url: imageUrl, duration_mins,
              created_at: Date.now(),
            })
          }
          await this._savePlan()
          overlay.remove()
          this._renderEditorHTML(mc)
        } catch(e) {
          console.error(e)
          btn.disabled = false; btn.textContent = isEdit ? 'Save changes' : 'Add block'
          setStatus('Error saving — please try again', '#e07070')
        }
      })

      overlay.querySelector('#bm-title')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') overlay.querySelector('#bm-save')?.click()
      })
    }

    renderModal()
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#bm-title')?.focus(), 50)
  }

  // ── CRUD helpers ──────────────────────────────────────────────────────────

  async _deleteBlock(mc, blockId) {
    const block = (this.plan.blocks || []).find(b => b.id === blockId)
    if (block?.image_url?.includes('.blob.vercel-storage.com')) {
      fetch(`/api/blob?url=${encodeURIComponent(block.image_url)}`, { method: 'DELETE' }).catch(() => {})
    }
    this.plan.blocks = (this.plan.blocks || []).filter(b => b.id !== blockId)
    await this._savePlan()
    this._renderEditorHTML(mc)
  }

  async _savePlan() {
    if (!this.currentPlanId || !this.plan) return
    const updated = await updateStoryPlan(this.app.userId, this.currentPlanId, {
      title: this.plan.title,
      blocks: this.plan.blocks || [],
    })
    if (updated && this.plans) {
      const idx = this.plans.findIndex(p => p.id === this.currentPlanId)
      if (idx !== -1) this.plans[idx] = updated
    }
  }

  openNewPlanModal(mc) {
    this._openNewPlanModal(mc)
  }

  _openNewPlanModal(mc) {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px'
    overlay.innerHTML = `
      <div style="background:var(--bg-primary);border:0.5px solid var(--border-med);border-radius:var(--radius-lg);width:100%;max-width:380px;overflow:hidden" onclick="event.stopPropagation()">
        <div style="padding:16px 18px;border-bottom:0.5px solid var(--border-light);font-size:14px;font-weight:600">New story plan</div>
        <div style="padding:18px">
          <input id="np-title" placeholder="e.g. Brand film v2, Interview cut…"
            style="width:100%;padding:9px 12px;border:0.5px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;font-family:var(--font);outline:none;box-sizing:border-box"
            onfocus="this.style.borderColor='var(--accent,#4a90d9)'" onblur="this.style.borderColor='var(--border-med)'" />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:0.5px solid var(--border-light)">
          <button class="btn-cancel" id="np-cancel">Cancel</button>
          <button class="btn-primary" id="np-create">Create plan</button>
        </div>
      </div>
    `
    overlay.addEventListener('click', () => overlay.remove())
    overlay.querySelector('#np-cancel')?.addEventListener('click', () => overlay.remove())

    const create = async () => {
      const title = overlay.querySelector('#np-title')?.value.trim()
      if (!title) { overlay.querySelector('#np-title').style.borderColor = '#e07070'; return }
      const btn = overlay.querySelector('#np-create')
      btn.disabled = true; btn.textContent = 'Creating…'
      try {
        const plan = await createStoryPlan(this.app.userId, { title, blocks: [] })
        if (!this.plans) this.plans = []
        this.plans.unshift(plan)
        overlay.remove()
        this._openPlan(mc, plan.id)
      } catch(e) {
        console.error(e)
        btn.disabled = false; btn.textContent = 'Create plan'
        this.app.toast('Error creating plan')
      }
    }

    overlay.querySelector('#np-create')?.addEventListener('click', create)
    overlay.querySelector('#np-title')?.addEventListener('keydown', e => { if (e.key === 'Enter') create() })
    document.body.appendChild(overlay)
    setTimeout(() => overlay.querySelector('#np-title')?.focus(), 50)
  }

  async _deletePlan(mc, planId, title) {
    if (!confirm(`Delete "${title || 'this plan'}"? All blocks will be lost.`)) return
    try {
      await deleteStoryPlan(this.app.userId, planId)
      this.plans = (this.plans || []).filter(p => p.id !== planId)
      this._renderListHTML(mc)
    } catch(e) {
      console.error(e)
      this.app.toast('Error deleting plan')
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  _showExportMenu(triggerBtn) {
    const existing = document.getElementById('sp-export-menu')
    if (existing) { existing.remove(); return }
    const rect = triggerBtn.getBoundingClientRect()
    const menu = document.createElement('div')
    menu.id = 'sp-export-menu'
    menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px;background:var(--bg-primary);border:0.5px solid var(--border-med);border-radius:var(--radius-md);z-index:9999;overflow:hidden;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,0.2)`
    menu.innerHTML = `
      <div id="spe-premiere" style="padding:10px 14px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:10px"
        onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="3,2 14,8 3,14" fill="currentColor" stroke="none"/></svg>
        Premiere Pro markers
        <span style="margin-left:auto;font-size:10px;color:var(--text-tertiary)">.xml</span>
      </div>
      <div style="height:0.5px;background:var(--border-light)"></div>
      <div id="spe-csv" style="padding:10px 14px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:10px"
        onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h9M2 12h11"/></svg>
        Markers CSV
        <span style="margin-left:auto;font-size:10px;color:var(--text-tertiary)">.csv</span>
      </div>
    `
    menu.querySelector('#spe-premiere')?.addEventListener('click', () => { this._exportXML(); menu.remove() })
    menu.querySelector('#spe-csv')?.addEventListener('click', () => { this._exportCSV(); menu.remove() })
    document.body.appendChild(menu)
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10)
  }

  _exportXML() {
    const fps = 25
    const blocks = this.plan?.blocks || []
    let cursor = 0
    const markers = blocks.map(b => {
      const frames = b.duration_mins ? Math.round(parseFloat(b.duration_mins) * 60 * fps) : fps
      const inFrame = cursor
      cursor += frames
      return { name: b.title || '', comment: b.description || '', in: inFrame, out: cursor }
    })
    const total = cursor || fps
    const name = this.plan?.title || 'Story Plan'
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence>
    <name>${escXml(name)}</name>
    <duration>${total}</duration>
    <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
    <in>-1</in>
    <out>-1</out>
    ${markers.map(m => `<marker>
      <name>${escXml(m.name)}</name>
      <comment>${escXml(m.comment)}</comment>
      <in>${m.in}</in>
      <out>${m.out}</out>
    </marker>`).join('\n    ')}
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <width>1920</width><height>1080</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
          </samplecharacteristics>
        </format>
        <track><enabled>TRUE</enabled><locked>FALSE</locked></track>
      </video>
    </media>
  </sequence>
</xmeml>`
    this._download(`${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.xml`, xml, 'application/xml')
  }

  _exportCSV() {
    const fps = 25
    const blocks = this.plan?.blocks || []
    const rows = [['Name', 'Description', 'In', 'Duration', 'Marker Type']]
    let cursor = 0
    blocks.forEach(b => {
      const durSecs = (parseFloat(b.duration_mins) || 0) * 60
      rows.push([b.title || '', b.description || '', secsToTC(cursor, fps), secsToTC(durSecs, fps), 'Comment'])
      cursor += durSecs
    })
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const name = this.plan?.title || 'story-plan'
    this._download(`${name.replace(/[^a-zA-Z0-9_-]/g, '_')}-markers.csv`, csv, 'text/csv')
  }

  _download(filename, content, type) {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(mins) {
  const m = parseFloat(mins) || 0
  if (m <= 0) return ''
  if (m < 1) return `${Math.round(m * 60)}s`
  const h = Math.floor(m / 60)
  const rem = m % 60
  const remWhole = Math.floor(rem)
  const remSecs = Math.round((rem - remWhole) * 60)
  if (h > 0) return `${h}h${remWhole > 0 ? ' ' + remWhole + 'm' : ''}`
  return `${remWhole}m${remSecs > 0 ? ' ' + remSecs + 's' : ''}`
}

function fmtTimecode(totalMins) {
  const s = Math.round(totalMins * 60)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sc = s % 60
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`
}

function secsToTC(secs, fps = 25) {
  const totalFrames = Math.round(secs * fps)
  const f = totalFrames % fps
  const ts = Math.floor(totalFrames / fps)
  const h = Math.floor(ts / 3600)
  const m = Math.floor((ts % 3600) / 60)
  const s = ts % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(f).padStart(2,'0')}`
}

function escXml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
}
