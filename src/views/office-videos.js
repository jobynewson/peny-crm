// src/views/office-videos.js
// Personal Tools › Office screen videos (#office-videos): each person's own
// list of YouTube links. The office screen plays everyone's in a loop. Kept on
// the server under your own login (api/_office-videos.js), so you can add and
// remove only your own.

import * as api from '../api/office-videos.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export class OfficeVideosView {
  constructor(app) {
    this.app = app
    this.videos = []
  }

  async render(mc) {
    this.mc = mc
    mc.innerHTML = `<p class="tr-muted">Loading…</p>`
    try {
      this.videos = (await api.fetchOfficeVideos()).videos
    } catch (e) {
      mc.innerHTML = `<p class="tr-muted">Couldn't load your videos. ${esc(e.message)}</p>`
      return
    }
    this._draw()
  }

  _draw(message = '') {
    const mc = this.mc
    mc.innerHTML = `
      <p class="tr-muted" style="margin:0 0 16px">Links to inspiration for the office screen. It plays everyone's videos one after another, muted. Paste the link to a single YouTube video (not a playlist).</p>
      <form class="panel" id="ov-form" style="display:flex;gap:10px;align-items:flex-start;padding:16px;margin-bottom:16px;max-width:720px">
        <div class="field" style="flex:1;margin:0">
          <input type="url" id="ov-url" placeholder="https://www.youtube.com/watch?v=…" aria-label="YouTube link" required />
          <div id="ov-msg" class="tr-muted" style="margin-top:6px;font-size:12px" role="status">${esc(message)}</div>
        </div>
        <button type="submit" class="btn-primary">Add video</button>
      </form>
      ${this.videos.length ? `<div class="card-grid">${this.videos.map(v => `
        <div class="panel" style="padding:12px;display:flex;gap:12px;align-items:center">
          <img src="https://i.ytimg.com/vi/${esc(v.video_id)}/mqdefault.jpg" alt="" width="120" height="68" style="border-radius:8px;object-fit:cover;flex:none" loading="lazy" />
          <a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.url)}</a>
          <button type="button" class="btn-secondary" data-remove="${esc(v.id)}">Remove</button>
        </div>`).join('')}</div>` : `<p class="tr-muted">You haven't added any videos yet.</p>`}`

    mc.querySelector('#ov-form').addEventListener('submit', async e => {
      e.preventDefault()
      const input = mc.querySelector('#ov-url')
      const msg = mc.querySelector('#ov-msg')
      msg.textContent = 'Adding…'
      try {
        const { video } = await api.addOfficeVideo(input.value)
        if (!this.videos.some(v => v.id === video.id)) this.videos.unshift(video)
        this._draw('Added. It will show on the office screen within a few minutes.')
      } catch (err) {
        msg.textContent = err.message
      }
    })
    mc.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await api.deleteOfficeVideo(btn.dataset.remove)
        this.videos = this.videos.filter(v => v.id !== btn.dataset.remove)
        this._draw('Removed.')
      } catch (err) {
        this._draw(err.message)
      }
    }))
  }
}
