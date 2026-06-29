// api/_preview.js
// Link/URL preview fetcher. Shared by api/blob.js (?action=preview) and the
// one-off planning_cards → canvas migration. NOT a Vercel function (underscore
// prefix), so it doesn't count against the 12-function limit.
//
// This fetches an arbitrary user-supplied URL server-side, so it is SSRF-
// guarded: http(s) only, the resolved host must be public (no loopback /
// private / link-local ranges), a ~5s timeout, and at most ~200KB is read.

import { lookup } from 'node:dns/promises'

const MAX_BYTES = 200 * 1024
const TIMEOUT_MS = 5000

// Parse a YouTube / Vimeo URL into { type, id }. Moved here from the retired
// planning-tab.js — its remaining job is deriving video thumbnails for link
// previews (YouTube/Vimeo serve og:image too, but this is a reliable fallback).
export function parseVideoUrl(url) {
  const yt = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  if (yt) return { type: 'youtube', id: yt[1] }
  const vm = String(url).match(/vimeo\.com\/(\d+)/)
  if (vm) return { type: 'vimeo', id: vm[1] }
  return null
}

// A best-effort thumbnail URL for a known video host, or null.
export function videoThumbnail(url) {
  const v = parseVideoUrl(url)
  if (v?.type === 'youtube') return `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`
  return null
}

// IPv4/IPv6 private, loopback and link-local ranges that must never be fetched.
function isPrivateAddress(ip) {
  if (!ip) return true
  const v = ip.toLowerCase()
  // IPv6
  if (v.includes(':')) {
    if (v === '::1' || v === '::') return true
    if (v.startsWith('fe80')) return true                 // link-local
    if (v.startsWith('fc') || v.startsWith('fd')) return true // fc00::/7 unique-local
    // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return false
  }
  // IPv4
  const p = v.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 127) return true                               // loopback
  if (a === 10) return true                                // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true         // 172.16.0.0/12
  if (a === 192 && b === 168) return true                  // 192.168.0.0/16
  if (a === 169 && b === 254) return true                  // 169.254.0.0/16 link-local
  if (a === 0) return true                                 // 0.0.0.0/8
  return false
}

function attr(html, re) {
  const m = html.match(re)
  return m ? m[1].trim() : null
}

// Pull og:title / <title>, og:image and a favicon link out of raw HTML with
// simple regexes (no parsing library). Handles content-before-property order.
function parseMeta(html, baseUrl) {
  const metaContent = (prop) => {
    const ps = prop.replace(/[:]/g, '\\:')
    return (
      attr(html, new RegExp(`<meta[^>]+(?:property|name)=["']${ps}["'][^>]+content=["']([^"']*)["']`, 'i')) ||
      attr(html, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${ps}["']`, 'i'))
    )
  }
  const decode = (s) => s == null ? s : s
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim()

  const title = decode(metaContent('og:title') || attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i))
  let image = metaContent('og:image') || metaContent('og:image:url') || metaContent('twitter:image')
  let favicon = attr(html, /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
                attr(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i)

  const absolutise = (u) => {
    if (!u) return null
    try { return new URL(u, baseUrl).href } catch { return null }
  }
  image = absolutise(decode(image))
  favicon = absolutise(decode(favicon)) || absolutise('/favicon.ico')
  return { title: title || null, image, favicon }
}

// Fetch a preview for `rawUrl`. Resolves to { title, image, favicon, url } or
// throws an Error (with a human reason) the caller can surface as a 4xx.
export async function fetchLinkPreview(rawUrl) {
  let parsed
  try { parsed = new URL(rawUrl) } catch { throw new Error('Invalid URL') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed')
  }

  // Resolve the hostname and reject private / loopback / link-local targets.
  let addrs
  try {
    addrs = await lookup(parsed.hostname, { all: true })
  } catch { throw new Error('Could not resolve host') }
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) {
    throw new Error('Host not allowed')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(parsed.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SlateBot/1.0; +https://slate.wearepeny.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
  } catch (e) {
    clearTimeout(timer)
    throw new Error(e.name === 'AbortError' ? 'Fetch timed out' : 'Fetch failed')
  }

  if (!res.ok) { clearTimeout(timer); throw new Error(`Upstream responded ${res.status}`) }

  // Read at most ~200KB so a huge file never gets buffered.
  let html = ''
  try {
    const reader = res.body?.getReader()
    if (reader) {
      const decoder = new TextDecoder('utf-8')
      let received = 0
      while (received < MAX_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        html += decoder.decode(value, { stream: true })
      }
      try { await reader.cancel() } catch {}
    } else {
      html = (await res.text()).slice(0, MAX_BYTES)
    }
  } finally {
    clearTimeout(timer)
  }

  const meta = parseMeta(html, res.url || parsed.href)
  // Reliable thumbnail fallback for known video hosts.
  if (!meta.image) meta.image = videoThumbnail(parsed.href)
  return { title: meta.title, image: meta.image, favicon: meta.favicon, url: parsed.href }
}
