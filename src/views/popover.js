// Floating panels anchored to a header button: the account and New menus
// (role="menu": arrow keys, Home/End) and the Log time popover
// (role="dialog"). Only one is open at a time. Each closes on Escape, a click
// outside or navigation (App.render calls closeFloating), takes focus when it
// opens and hands it back to its button when it closes.

let current = null

export function closeFloating(opts) {
  current?.close(opts)
}

export function floatingOpen(id) {
  return !!current && (!id || current.id === id)
}

/**
 * @param {{ anchor: HTMLElement, id: string, role?: 'menu'|'dialog', label?: string,
 *           html: string, className?: string, onReady?: (el: HTMLElement, close: Function) => void }} opts
 * Returns the open panel's { el, close }, or null when the call toggled the
 * same panel shut.
 */
export function openFloating({ anchor, id, role = 'menu', label, html, className = '', onReady }) {
  if (current && current.id === id && current.anchor === anchor) { current.close(); return null }
  closeFloating({ restoreFocus: false })

  const el = document.createElement('div')
  el.id = id
  el.className = `pop ${className}`.trim()
  el.setAttribute('role', role)
  if (label) el.setAttribute('aria-label', label)
  el.innerHTML = html
  document.body.appendChild(el)
  place(el, anchor)
  anchor.setAttribute('aria-expanded', 'true')
  anchor.setAttribute('aria-controls', id)

  const items = () => [...el.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')]
    .filter(n => !n.disabled && n.offsetParent !== null)

  const onKey = e => {
    if (e.key === 'Escape') {
      // Capture phase + stopPropagation, so the app's own Escape handling
      // (close modal / leave edit mode / go back) doesn't also run.
      e.preventDefault(); e.stopPropagation(); close()
      return
    }
    const active = document.activeElement
    if (!el.contains(active) || role !== 'menu') return
    const list = items()
    const i = list.indexOf(active)
    const move = n => { e.preventDefault(); list[(n + list.length) % list.length]?.focus() }
    if (e.key === 'ArrowDown') move(i + 1)
    else if (e.key === 'ArrowUp') move(i - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(list.length - 1)
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && active.getAttribute('role') === 'menuitemradio') {
      const group = [...active.parentElement.querySelectorAll('[role="menuitemradio"]')]
      const j = group.indexOf(active) + (e.key === 'ArrowRight' ? 1 : -1)
      e.preventDefault()
      group[(j + group.length) % group.length]?.focus()
    }
    else if (e.key === ' ' && active.tagName === 'A') { e.preventDefault(); active.click() }
    else if (e.key === 'Tab') close({ restoreFocus: false })
  }
  const onPointer = e => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) close({ restoreFocus: false })
  }
  // A dialog closes once focus has moved somewhere outside it.
  const onFocusOut = e => {
    if (role === 'dialog' && e.relatedTarget && !el.contains(e.relatedTarget) && !anchor.contains(e.relatedTarget)) close({ restoreFocus: false })
  }
  const onResize = () => place(el, anchor)

  const state = { id, el, anchor, close }
  function close({ restoreFocus = true } = {}) {
    if (current !== state) return
    current = null
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerdown', onPointer, true)
    el.removeEventListener('focusout', onFocusOut)
    window.removeEventListener('resize', onResize)
    anchor.setAttribute('aria-expanded', 'false')
    anchor.removeAttribute('aria-controls')
    el.remove()
    if (restoreFocus && document.contains(anchor)) anchor.focus()
  }
  current = state
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)
  el.addEventListener('focusout', onFocusOut)
  window.addEventListener('resize', onResize)

  onReady?.(el, close)
  const first = role === 'menu'
    ? items()[0]
    : el.querySelector('[autofocus]') || el.querySelector('input:not([type="hidden"]), select, textarea, button')
  first?.focus()
  return state
}

// Below the button, right edges aligned, kept inside the viewport.
function place(el, anchor) {
  const r = anchor.getBoundingClientRect()
  const w = el.offsetWidth
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))
  el.style.left = `${left}px`
  el.style.top = `${r.bottom + 8}px`
}
