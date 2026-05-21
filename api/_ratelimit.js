// Simple in-memory sliding-window rate limiter.
// Per-instance only — resets on cold start. Provides meaningful protection
// against simple brute-force and DoS; not a substitute for infrastructure-level
// rate limiting on high-traffic deployments.

const store = new Map()

const CLEANUP_INTERVAL = 5 * 60 * 1000 // prune stale entries every 5 min
let lastCleanup = Date.now()

function cleanup(windowMs) {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, entry] of store) {
    if (now - entry.start > windowMs) store.delete(key)
  }
}

/**
 * Returns true if the request should be rejected.
 * @param {string} ip  - client IP
 * @param {object} opts
 * @param {number} opts.windowMs - window length in ms (default 60 000)
 * @param {number} opts.max      - max requests per window (default 60)
 */
export function isRateLimited(ip, { windowMs = 60_000, max = 60 } = {}) {
  cleanup(windowMs)
  const now = Date.now()
  const entry = store.get(ip) || { count: 0, start: now }
  if (now - entry.start > windowMs) {
    store.set(ip, { count: 1, start: now })
    return false
  }
  entry.count++
  store.set(ip, entry)
  return entry.count > max
}

export function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  )
}
