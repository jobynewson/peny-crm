// src/views/planning-tab.js
// Milanote-lite planning board: notes, images (Vercel Blob), and video links

import { updateProject } from '../db/client.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// ─── Render ──────────────────────────────────────────────────────────────────

export function renderPlanningTab(p) {
  const cards = p.planning_cards || []
  return `
    <div class="plan-toolbar">
      <button class="plan-add-btn" id="plan-add-note">
        <span class="plan-add-icon">✏️</span> Note
      </button>
      <button class="plan-add-btn" id="plan-add-image">
        <span class="plan-add-icon">🖼</span> Image
      </button>
      <button class="plan-add-btn" id="plan-add-video">
        <span class="plan-add-icon">▶</span> Video link
      </button>
      <input type="file" id="plan-image-input" accept="image/*" style="display:none">
    </div>

    <div class="plan-board" id="planning-board">
      ${cards.length
        ? cards.map(card => renderCard(card)).join('')
        : renderEmptyState()
      }
    </div>
  `
}

function renderEmptyState() {
  return `
    <div class="plan-empty">
      <div class="plan-empty-icon">🗂</div>
      <div class="plan-empty-title">Your planning board is empty</div>
      <div class="plan-empty-sub">Add notes, images and video links to build your visual plan</div>
    </div>
  `
}

function renderCard(card) {
  if (card.type === 'note')  return renderNoteCard(card)
  if (card.type === 'image') return renderImageCard(card)
  if (card.type === 'video') return renderVideoCard(card)
  return ''
}

function renderNoteCard(card) {
  return `
    <div class="plan-card plan-card--note" data-card-id="${card.id}">
      <button class="plan-card-delete" data-delete="${card.id}" title="Remove">×</button>
      <textarea
        class="plan-note-text"
        data-save-note="${card.id}"
        placeholder="Type a note…"
        spellcheck="true"
      >${esc(card.content || '')}</textarea>
    </div>
  `
}

function imgSrc(url) {
  if (!url) return ''
  // Private Vercel Blob URLs require auth headers — proxy them server-side
  if (url.includes('.private.blob.vercel-storage.com')) {
    return `/api/blob?url=${encodeURIComponent(url)}`
  }
  return esc(url)
}

function renderImageCard(card) {
  return `
    <div class="plan-card plan-card--image" data-card-id="${card.id}">
      <button class="plan-card-delete" data-delete="${card.id}" title="Remove">×</button>
      <div class="plan-image-wrap">
        <img src="${imgSrc(card.url)}" alt="${esc(card.alt || 'Planning image')}" loading="lazy" />
      </div>
      <input
        class="plan-image-caption"
        type="text"
        value="${esc(card.caption || '')}"
        placeholder="Add a caption…"
        data-save-caption="${card.id}"
      />
    </div>
  `
}

function renderVideoCard(card) {
  const embed = parseVideoUrl(card.url || '')
  let embedHtml

  if (embed?.type === 'youtube') {
    embedHtml = `<iframe
      src="https://www.youtube.com/embed/${embed.id}?rel=0"
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
      loading="lazy"
    ></iframe>`
  } else if (embed?.type === 'vimeo') {
    embedHtml = `<iframe
      src="https://player.vimeo.com/video/${embed.id}?dnt=1"
      frameborder="0"
      allow="autoplay; fullscreen; picture-in-picture"
      allowfullscreen
      loading="lazy"
    ></iframe>`
  } else {
    embedHtml = `<a class="plan-video-raw-link" href="${esc(card.url)}" target="_blank" rel="noopener">
      <span>▶</span> ${esc(card.url)}
    </a>`
  }

  return `
    <div class="plan-card plan-card--video" data-card-id="${card.id}">
      <button class="plan-card-delete" data-delete="${card.id}" title="Remove">×</button>
      <div class="plan-video-embed">${embedHtml}</div>
      <input
        class="plan-image-caption"
        type="text"
        value="${esc(card.title || '')}"
        placeholder="Add a title…"
        data-save-title="${card.id}"
      />
    </div>
  `
}

function parseVideoUrl(url) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  if (yt) return { type: 'youtube', id: yt[1] }
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return { type: 'vimeo', id: vm[1] }
  return null
}

// ─── Bind ─────────────────────────────────────────────────────────────────────

export function bindPlanningTab(mc, p, userId) {

  const saveCards = async () => {
    try {
      await updateProject(userId, p.id, { planning_cards: p.planning_cards || [] })
    } catch (err) {
      console.error('Planning save failed:', err)
    }
  }

  const getCards = () => p.planning_cards || []

  const rerender = (focusId = null) => {
    const board = mc.querySelector('#planning-board')
    if (!board) return
    const cards = getCards()
    board.innerHTML = cards.length ? cards.map(renderCard).join('') : renderEmptyState()
    bindCardEvents()
    if (focusId) {
      mc.querySelector(`[data-card-id="${focusId}"] textarea`)?.focus()
    }
  }

  const bindCardEvents = () => {
    // ── Delete ──
    mc.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.delete
        const card = getCards().find(c => c.id === id)

        // Fire-and-forget blob cleanup (don't block UI on failure)
        if (card?.type === 'image' && card.url) {
          const { getAuthToken } = await import('../auth/clerk.js')
          getAuthToken().then(t => fetch(`/api/blob?url=${encodeURIComponent(card.url)}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${t}` },
          })).catch(e => console.warn('Blob cleanup failed:', e))
        }

        p.planning_cards = getCards().filter(c => c.id !== id)
        await saveCards()
        rerender()
      })
    })

    // ── Note autosave ──
    mc.querySelectorAll('[data-save-note]').forEach(textarea => {
      let timer
      textarea.addEventListener('input', () => {
        clearTimeout(timer)
        timer = setTimeout(async () => {
          const card = getCards().find(c => c.id === textarea.dataset.saveNote)
          if (card) { card.content = textarea.value; await saveCards() }
        }, 700)
      })
      // Auto-grow
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto'
        textarea.style.height = textarea.scrollHeight + 'px'
      })
      // Trigger once on load to set correct initial height
      textarea.style.height = 'auto'
      textarea.style.height = textarea.scrollHeight + 'px'
    })

    // ── Image caption autosave ──
    mc.querySelectorAll('[data-save-caption]').forEach(input => {
      let timer
      input.addEventListener('input', () => {
        clearTimeout(timer)
        timer = setTimeout(async () => {
          const card = getCards().find(c => c.id === input.dataset.saveCaption)
          if (card) { card.caption = input.value; await saveCards() }
        }, 700)
      })
    })

    // ── Video title autosave ──
    mc.querySelectorAll('[data-save-title]').forEach(input => {
      let timer
      input.addEventListener('input', () => {
        clearTimeout(timer)
        timer = setTimeout(async () => {
          const card = getCards().find(c => c.id === input.dataset.saveTitle)
          if (card) { card.title = input.value; await saveCards() }
        }, 700)
      })
    })
  }

  // ── Add note ──
  mc.querySelector('#plan-add-note')?.addEventListener('click', async () => {
    const card = { id: crypto.randomUUID(), type: 'note', content: '', created_at: Date.now() }
    p.planning_cards = [...getCards(), card]
    await saveCards()
    rerender(card.id)
  })

  // ── Add image ──
  mc.querySelector('#plan-add-image')?.addEventListener('click', () => {
    mc.querySelector('#plan-image-input')?.click()
  })

  mc.querySelector('#plan-image-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (file.size > 20 * 1024 * 1024) {
      window.app?.toast('Image is too large — use a file under 20 MB')
      e.target.value = ''
      return
    }

    const btn = mc.querySelector('#plan-add-image')
    const original = btn.innerHTML
    btn.innerHTML = '<span class="plan-add-icon">⏳</span> Uploading…'
    btn.disabled = true

    try {
      // Compress via Canvas: max 2000px on longest side, JPEG at 85%
      // This keeps the base64 payload well under Vercel's 4.5 MB body limit.
      const base64 = await new Promise((resolve, reject) => {
        const img = new Image()
        const objectUrl = URL.createObjectURL(file)
        img.onload = () => {
          URL.revokeObjectURL(objectUrl)
          const MAX = 2000
          let { width, height } = img
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX }
            else                { width  = Math.round(width  * MAX / height); height = MAX }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          canvas.getContext('2d').drawImage(img, 0, 0, width, height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          resolve(dataUrl.split(',')[1])
        }
        img.onerror = reject
        img.src = objectUrl
      })

      const { getAuthToken } = await import('../auth/clerk.js')
      const authToken = await getAuthToken()
      const res = await fetch('/api/blob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({
          base64,
          filename: file.name.replace(/\.[^.]+$/, '.jpg'),
          contentType: 'image/jpeg',
          projectId: p.id,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Upload failed')
      }

      const { url } = await res.json()
      const card = { id: crypto.randomUUID(), type: 'image', url, alt: file.name, caption: '', created_at: Date.now() }
      p.planning_cards = [...getCards(), card]
      await saveCards()
      rerender()
    } catch (err) {
      console.error(err)
      window.app?.toast('Image upload failed')
    } finally {
      btn.innerHTML = original
      btn.disabled = false
      e.target.value = ''
    }
  })

  // ── Add video ──
  mc.querySelector('#plan-add-video')?.addEventListener('click', async () => {
    const url = prompt('Paste a YouTube or Vimeo URL:')
    if (!url?.trim()) return

    const card = { id: crypto.randomUUID(), type: 'video', url: url.trim(), title: '', created_at: Date.now() }
    p.planning_cards = [...getCards(), card]
    await saveCards()
    rerender()
  })

  // Initial card bindings
  bindCardEvents()
}
