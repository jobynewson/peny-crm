// src/views/client-facing.js
// The one quiet cue for "a client can see this". A teal eye chip next to
// content they read, and a caption under fields they read. Content that is
// internal gets no mark at all. Every surface calls these helpers so the look
// and the wording stay the same everywhere.

import { icon } from './icons.js'

/** @param {any} s */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Who would see it: company names, or anyone with the project's client link.
// null when nobody can (so no mark is drawn).
/** @param {{ companies?: (string | null | undefined)[], hasLink?: boolean }} p @returns {string | null} */
export function audienceFor({ companies = [], hasLink = false } = {}) {
  const names = [...new Set(companies.filter(Boolean))]
  const parts = []
  if (names.length) parts.push(names.join(', '))
  if (hasLink) parts.push('anyone with the client link')
  return parts.length ? parts.join(' and ') : null
}

// "Shown to Acme in their portal" / "Shown to the client".
/** @param {string | null | undefined} to */
export const shownTo = to => (to ? `Shown to ${to}` : 'Shown to the client')

// The chip. `word: false` is the icon alone, for dense rows.
/** @param {{ to?: string | null, word?: boolean }} [o] */
export function clientChip({ to, word = true } = {}) {
  const label = shownTo(to)
  return `<span class="cf-chip" role="img" title="${esc(label)}" aria-label="${esc(label)}">${icon('eye', 14)}${word ? '<span class="cf-word">Client</span>' : ''}</span>`
}

// A line under a field or panel head the client reads.
/** @param {string} text */
export const clientCaption = text => `<div class="cf-caption">${icon('eye', 12)}<span>${esc(text)}</span></div>`
