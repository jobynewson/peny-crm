// Theme choice: 'system' (follow the device), 'light' (Warm Paper) or
// 'dark' (Darkroom). Stored in localStorage under 'slate-theme'; the inline
// script in index.html applies it before first paint, and tokens.css reads
// html[data-theme] or, with no attribute, prefers-color-scheme.

export const THEME_KEY = 'slate-theme'
export const THEME_CHOICES = ['system', 'light', 'dark']

export function getThemeChoice() {
  let stored = null
  try { stored = localStorage.getItem(THEME_KEY) } catch {}
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function setThemeChoice(choice) {
  const value = THEME_CHOICES.includes(choice) ? choice : 'system'
  if (value === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', value)
  try { localStorage.setItem(THEME_KEY, value) } catch {}
  return value
}

// The theme actually showing, resolving System against the device setting.
export function effectiveTheme() {
  const forced = document.documentElement.getAttribute('data-theme')
  if (forced === 'light' || forced === 'dark') return forced
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
