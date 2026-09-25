// api/_db.js
// Server-side database connection. DATABASE_URL is server-only and must never
// be given a VITE_ prefix: Vite inlines every VITE_* variable into the browser
// bundle (the same rule as ABLY_API_KEY and YOUTUBE_API_KEY — see claude.md).
//
// Transitional: falls back to VITE_DATABASE_URL so a deploy that lands before
// DATABASE_URL is set in Vercel keeps working. Remove the fallback once the
// browser no longer talks to the database directly.
import { neon } from '@neondatabase/serverless'

let warnedFallback = false

export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  if (process.env.VITE_DATABASE_URL) {
    if (!warnedFallback) {
      console.warn('DATABASE_URL is not set; falling back to VITE_DATABASE_URL')
      warnedFallback = true
    }
    return process.env.VITE_DATABASE_URL
  }
  return null
}

// A neon() tagged-template client for DATABASE_URL.
export function getSql() {
  const url = databaseUrl()
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}
