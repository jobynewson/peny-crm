// src/utils/window-days.js
// The "how far ahead" control shared by every screen that shows dated work:
// 7, 14, 30 or 60 days. Each screen remembers its own choice in this browser
// (its own key, its own default), so the board can look a month ahead while
// What's due looks a fortnight ahead.

export const WINDOW_DAYS = [7, 14, 30, 60]   // mirrors api/_retainer-rules.js (a test compares them)

export function readWindow(key, fallback) {
  try {
    const n = Number.parseInt(localStorage.getItem(key), 10)
    if (WINDOW_DAYS.includes(n)) return n
  } catch {}
  return fallback
}

export function saveWindow(key, days) {
  try { localStorage.setItem(key, String(days)) } catch {}
}

// "7 days / 14 / 30 / 60", one button pressed. `attr` is the data attribute the
// buttons carry, so a screen can find them: data-<attr>="14".
export function windowToggleHtml(current, attr, label = 'Look ahead') {
  return `<div class="seg" role="group" aria-label="${label}">${WINDOW_DAYS.map(d =>
    `<button type="button" class="seg-btn" data-${attr}="${d}" aria-pressed="${d === current}">${d}${d === WINDOW_DAYS[0] ? ' days' : ''}</button>`).join('')}</div>`
}

export const windowWords = days => `${days} days`
