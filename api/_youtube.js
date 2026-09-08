// api/_youtube.js
// Fetches the public view count for a single YouTube video, for the office
// dashboard's view-count ticker.
//
// NOT a Vercel function (underscore prefix), so it doesn't count against the
// 12-function limit — see claude.md. Called from api/_dashboard.js, which is
// itself reached via api/portal.js?view=dashboard.
//
// Needs YOUTUBE_API_KEY (a plain Google API key with the YouTube Data API v3
// enabled — no OAuth, so this only works for public/unlisted videos). Unset =
// the ticker simply doesn't render; nothing else on the dashboard is affected.

const TIMEOUT_MS = 4000
// The dashboard polls every 3 minutes and there may be several screens on it.
// One cached count per video for 60s keeps quota use flat regardless of how
// many displays are pointed at the dashboard (videos.list costs 1 unit of a
// 10,000/day allowance, so this is belt-and-braces).
const CACHE_TTL_MS = 60 * 1000

// Module-scope cache, shared across invocations that reuse a warm instance.
// Doubles as a staleness buffer: if YouTube errors we keep serving the last
// good number rather than making the pill vanish off an office screen.
const cache = new Map() // videoId -> { views, fetchedAt, title }

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/

// Resolve the view count for `videoId`, or null if it can't be determined and
// nothing usable is cached. Never throws.
export async function getYoutubeViews(videoId) {
  if (!VIDEO_ID_RE.test(String(videoId || ''))) return null

  const cached = cache.get(videoId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached

  const key = process.env.YOUTUBE_API_KEY
  if (!key) return null

  const url = 'https://www.googleapis.com/youtube/v3/videos'
    + `?part=statistics&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(key)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`YouTube responded ${res.status}`)
    const body = await res.json()
    const stats = body?.items?.[0]?.statistics
    // A video with statistics hidden by its owner has no viewCount at all.
    if (!stats || stats.viewCount == null) throw new Error('No view count available')
    const views = Number(stats.viewCount)
    if (!Number.isFinite(views)) throw new Error('Unparseable view count')
    const entry = { views, fetchedAt: Date.now() }
    cache.set(videoId, entry)
    return entry
  } catch (e) {
    // Quota exhausted, video deleted/private, network blip — fall back to the
    // last good number if we have one, otherwise hide the ticker.
    console.error('[youtube-ticker]', e.message)
    return cached || null
  } finally {
    clearTimeout(timer)
  }
}
