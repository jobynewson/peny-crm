// @ts-check
// src/realtime/peers.js
// Pure helpers for showing other people on a canvas / tab strip. Unit-tested
// in peers.test.js.

// Distinct, readable-on-white-and-dark colours for other people's cursors and
// outlines. The same person always gets the same colour everywhere.
export const PEER_COLORS = ['#E5484D', '#0091FF', '#30A46C', '#F76B15', '#8E4EC6', '#12A594', '#D6409F', '#3E63DD', '#AD7F58', '#E54666']

/** @param {string | null | undefined} id */
export function peerColor(id) {
  const s = String(id ?? '')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return PEER_COLORS[(h >>> 0) % PEER_COLORS.length]
}

/** @param {string | null | undefined} name */
export function initials(name) {
  const parts = String(name ?? '').trim().split('@')[0].split(/[\s._-]+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** @param {string | null | undefined} name */
export const firstName = name => String(name ?? '').trim().split(/\s+/)[0] || 'Someone'

/**
 * One entry per person (a person with two tabs open counts once), excluding
 * yourself, in a stable order.
 * @template {{ clientId: string, connectionId: string, data: any }} M
 * @param {M[]} members @param {string | null | undefined} selfClientId
 * @returns {M[]}
 */
export function distinctPeers(members, selfClientId) {
  /** @type {Map<string, M>} */ const byClient = new Map()
  for (const m of members) {
    if (!m.clientId || m.clientId === selfClientId) continue
    const prev = byClient.get(m.clientId)
    // Prefer the connection that's actually doing something.
    if (!prev || (!prev.data?.edit && m.data?.edit) || (!(prev.data?.sel?.length) && m.data?.sel?.length)) byClient.set(m.clientId, m)
  }
  return [...byClient.values()].sort((a, b) => String(a.data?.name).localeCompare(String(b.data?.name)))
}

/**
 * Leading + trailing throttle: `fn` runs at most once per `ms`, and the last
 * call in a burst always runs.
 * @template {any[]} A @param {(...args: A) => void} fn @param {number} ms
 */
export function throttle(fn, ms) {
  let last = 0
  /** @type {ReturnType<typeof setTimeout> | null} */ let timer = null
  /** @type {A | null} */ let pending = null
  const run = () => { last = Date.now(); timer = null; const a = pending; pending = null; if (a) fn(...a) }
  /** @param {A} args */
  const t = (...args) => {
    pending = args
    const wait = ms - (Date.now() - last)
    if (wait <= 0 && !timer) run()
    else if (!timer) timer = setTimeout(run, Math.max(0, wait))
  }
  t.cancel = () => { if (timer) clearTimeout(timer); timer = null; pending = null }
  return t
}
