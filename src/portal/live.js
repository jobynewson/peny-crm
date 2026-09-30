// src/portal/live.js
// Keeps the portal close to live: it asks for the view every so often while the
// page is on screen and redraws when something has changed. It never redraws
// over someone who is in the middle of something (typing a request, writing a
// comment, about to press Approve): it waits for the next time round. A redraw
// keeps the scroll position, the folds that were open and the left column's scroll.

const BUSY_OPEN = [
  '[data-request-form]:not([hidden])', '[data-confirm]:not([hidden])', '[data-comments-confirm]:not([hidden])',
  '.pt-changes:not([hidden])', '[data-reply-form]:not([hidden])', '[data-comments-now]:not([hidden])',
]

// True when a redraw would get in the way.
export function isBusy(root, active = globalThis.document?.activeElement) {
  if (active && active !== globalThis.document?.body && root.contains?.(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return true
  if (BUSY_OPEN.some(sel => root.querySelector(sel))) return true
  return [...(root.querySelectorAll?.('textarea') ?? [])].some(t => t.value?.trim())
}

// What to put back after a redraw.
export function snapshotUi(root, win = globalThis.window) {
  return {
    scrollY: win?.scrollY ?? 0,
    open: [...(root.querySelectorAll?.('details') ?? [])].map(d => d.open),
    columns: Object.fromEntries(['pt-col-requests'].map(id => [id, root.querySelector?.(`#${id}`)?.scrollTop ?? 0])),
  }
}

export function restoreUi(root, snap, win = globalThis.window) {
  const details = [...(root.querySelectorAll?.('details') ?? [])]
  // Same page, same folds: only restore when the number of folds has not changed.
  if (details.length === snap.open.length) details.forEach((d, i) => { d.open = snap.open[i] })
  for (const [id, top] of Object.entries(snap.columns)) { const el = root.querySelector?.(`#${id}`); if (el) el.scrollTop = top }
  win?.scrollTo?.(0, snap.scrollY)
}

// fetchView() → the view; apply(view) draws it. `seen(view)` says what is on
// screen now (call it after every draw, including the ones the page makes itself).
export function startLive({ root, fetchView, apply, interval = 30000, doc = globalThis.document, win = globalThis.window }) {
  let last = null
  let running = false
  const seen = view => { last = JSON.stringify(view) }

  async function tick() {
    if (running || doc?.visibilityState === 'hidden' || isBusy(root)) return
    running = true
    try {
      const fresh = await fetchView()
      if (!fresh || JSON.stringify(fresh) === last) return
      if (isBusy(root)) return                        // they started something while it loaded
      const snap = snapshotUi(root, win)
      apply(fresh)
      restoreUi(root, snap, win)
    } catch { /* offline, or the session ended: leave what is on screen */ }
    finally { running = false }
  }

  const timer = setInterval(tick, interval)
  const onVisible = () => { if (doc?.visibilityState === 'visible') tick() }
  doc?.addEventListener?.('visibilitychange', onVisible)
  return { seen, tick, stop() { clearInterval(timer); doc?.removeEventListener?.('visibilitychange', onVisible) } }
}
