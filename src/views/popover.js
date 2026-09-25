// Floating panels opened from a header button: the account and New menus
// (role="menu": arrow keys, Home/End) and the Log time popover
// (role="dialog"). Only one is open at a time. Each closes on Escape, a click
// outside or navigation (App.render calls closeFloating), takes focus when it
// opens and hands it back to its button when it closes.
//
// On desktop they're popovers anchored below the button. On phones (≤768px)
// they open as bottom sheets instead: modal, over a dimmed backdrop, with a
// grab handle and a close button, and focus kept inside until they close.

import { icon } from './icons.js'

const PHONE = '(max-width: 768px)'
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

  const sheet = window.matchMedia(PHONE).matches
  const el = document.createElement('div')
  el.id = id
  let scrim = null
  if (sheet) {
    // The sheet is the modal dialog; a menu keeps its role on the list inside.
    scrim = document.createElement('div')
    scrim.className = 'sheet-scrim'
    el.className = 'sheet'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    if (label) el.setAttribute('aria-label', label)
    el.innerHTML = `
      <div class="sheet-grab" aria-hidden="true"></div>
      <button type="button" class="icon-btn sheet-close" aria-label="Close">${icon('close', 20)}</button>
      <div class="sheet-body ${className}"${role === 'menu' ? ` role="menu"${label ? ` aria-label="${label}"` : ''}` : ''}>${html}</div>`
    document.body.append(scrim, el)
    document.getElementById('app')?.setAttribute('inert', '')
  } else {
    el.className = `pop ${className}`.trim()
    el.setAttribute('role', role)
    if (label) el.setAttribute('aria-label', label)
    el.innerHTML = html
    document.body.appendChild(el)
    place(el, anchor)
  }
  anchor.setAttribute('aria-expanded', 'true')
  anchor.setAttribute('aria-controls', id)

  const items = () => [...el.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')]
    .filter(n => !n.disabled && n.offsetParent !== null)
  const focusables = () => [...el.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')]
    .filter(n => n.offsetParent !== null)

  const onKey = e => {
    if (e.key === 'Escape') {
      // Capture phase + stopPropagation, so the app's own Escape handling
      // (close modal / leave edit mode / go back) doesn't also run.
      e.preventDefault(); e.stopPropagation(); close()
      return
    }
    const active = document.activeElement
    if (e.key === 'Tab' && sheet) {
      // Keep focus inside the sheet.
      const list = focusables()
      const i = list.indexOf(active)
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i === list.length - 1 ? 0 : i + 1)
      e.preventDefault()
      list[next]?.focus()
      return
    }
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
  // A popover dialog closes once focus has moved somewhere outside it.
  const onFocusOut = e => {
    if (!sheet && role === 'dialog' && e.relatedTarget && !el.contains(e.relatedTarget) && !anchor.contains(e.relatedTarget)) close({ restoreFocus: false })
  }
  // Crossing the phone breakpoint (rotating, resizing) would leave the wrong
  // kind of panel, so close it; otherwise keep a popover under its button.
  const onResize = () => {
    if (window.matchMedia(PHONE).matches !== sheet) close({ restoreFocus: false })
    else if (!sheet) place(el, anchor)
  }

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
    scrim?.remove()
    if (sheet) document.getElementById('app')?.removeAttribute('inert')
    if (restoreFocus && document.contains(anchor)) anchor.focus()
  }
  current = state
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)
  el.addEventListener('focusout', onFocusOut)
  window.addEventListener('resize', onResize)
  el.querySelector('.sheet-close')?.addEventListener('click', () => close())

  onReady?.(el, close)
  const first = role === 'menu'
    ? items()[0]
    : el.querySelector('[data-autofocus]') || el.querySelector('.sheet-body input:not([type="hidden"]), .sheet-body select, input:not([type="hidden"]), select, textarea')
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
