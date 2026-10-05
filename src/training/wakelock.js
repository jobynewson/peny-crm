// src/training/wakelock.js
// Keeps the screen on while a session runs.
//
// Slate is a top-level page, so the Screen Wake Lock API works: request it when
// the session starts, ask again whenever the page becomes visible (the browser
// drops the lock when a tab is hidden), and release it when the session ends.
// Browsers without the API (or that refuse the request) fall back to the
// original silent looping video.

import { AWAKE_SRC } from './awake-video.js'

export function createAwake({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  let active = false
  let lock = null
  let video = null
  let requesting = false

  const hasApi = () => !!nav?.wakeLock?.request

  function startVideo() {
    if (!doc) return
    if (!video) {
      video = doc.createElement('video')
      video.setAttribute('playsinline', '')
      video.setAttribute('muted', '')
      video.muted = true
      video.loop = true
      video.style.cssText = 'position:fixed;width:48px;height:27px;right:0;bottom:0;opacity:.02;pointer-events:none;z-index:30'
      AWAKE_SRC.forEach(src => {
        const so = doc.createElement('source')
        so.src = src
        so.type = src.slice(5, src.indexOf(';'))
        video.appendChild(so)
      })
      video.addEventListener('timeupdate', () => { if (video.currentTime > 1.5) video.currentTime = 0 })
      doc.body.appendChild(video)
    }
    try { video.play()?.catch(() => {}) } catch { /* autoplay refused until a tap */ }
  }

  function stopVideo() {
    try { video?.pause() } catch { /* ignore */ }
  }

  async function request() {
    if (!active || lock || requesting) return
    if (!hasApi()) { startVideo(); return }
    requesting = true
    try {
      const l = await nav.wakeLock.request('screen')
      if (!active) { l.release?.().catch?.(() => {}); return }   // ended while we asked
      lock = l
      l.addEventListener?.('release', () => { if (lock === l) lock = null })
      stopVideo()
    } catch {
      startVideo()   // refused (battery saver, permissions): use the fallback
    } finally {
      requesting = false
    }
  }

  const onVisible = () => { if (active && doc.visibilityState === 'visible') request() }
  // Autoplay can be blocked until a tap; any tap during a session retries it.
  const onTap = () => { if (active && video && video.paused && !lock) startVideo() }

  return {
    on() {
      if (active) return
      active = true
      doc?.addEventListener('visibilitychange', onVisible)
      doc?.addEventListener('click', onTap, true)
      request()
    },
    off() {
      if (!active) return
      active = false
      doc?.removeEventListener('visibilitychange', onVisible)
      doc?.removeEventListener('click', onTap, true)
      const l = lock
      lock = null
      try { l?.release?.()?.catch?.(() => {}) } catch { /* ignore */ }
      stopVideo()
    },
    // For tests and diagnostics.
    get state() { return { active, locked: !!lock, video: !!video && !video.paused } },
  }
}
