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

// Resolve the view count for `videoId`. Returns { views } on success (with
// `stale: true` when serving a cached value after a failed refresh), or
// { error } describing why there is no number. Never throws.
//
// The error strings are surfaced on the token-gated dashboard endpoint so a
// ticker that isn't appearing can be diagnosed without guessing — they never
// contain the API key (Google's own messages are scrubbed of it below).
export async function getYoutubeViews(videoId) {
  if (!VIDEO_ID_RE.test(String(videoId || ''))) {
    return { error: 'The saved video ID is not a valid YouTube ID — re-save the video URL in Settings' }
  }

  const cached = cache.get(videoId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return { views: cached.views }

  const key = process.env.YOUTUBE_API_KEY
  if (!key) {
    return { error: 'YOUTUBE_API_KEY is not set on this deployment — note that adding it in Vercel only takes effect on the next deploy' }
  }

  const url = 'https://www.googleapis.com/youtube/v3/videos'
    + `?part=statistics&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(key)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      // Google explains the real cause (key restrictions, API not enabled,
      // quota) in the body. Surface it, with the key scrubbed just in case.
      let detail = ''
      try {
        const body = await res.json()
        if (body?.error?.message) detail = ` — ${String(body.error.message).split(key).join('[key]')}`
      } catch {}
      throw new Error(`YouTube API returned ${res.status}${detail}`)
    }
    const body = await res.json()
    if (!body?.items?.length) {
      throw new Error('YouTube returned no such video — check the video is public or unlisted, not private or deleted')
    }
    const stats = body.items[0].statistics
    // A video with statistics hidden by its owner has no viewCount at all.
    if (!stats || stats.viewCount == null) {
      throw new Error('That video does not expose a view count — its owner has hidden its statistics')
    }
    const views = Number(stats.viewCount)
    if (!Number.isFinite(views)) throw new Error('YouTube returned an unparseable view count')
    cache.set(videoId, { views, fetchedAt: Date.now() })
    return { views }
  } catch (e) {
    const reason = e.name === 'AbortError' ? `YouTube did not respond within ${TIMEOUT_MS}ms` : e.message
    console.error('[youtube-ticker]', reason)
    // Quota exhausted, video deleted, network blip — keep showing the last good
    // number rather than letting the pill vanish off an office screen.
    if (cached) return { views: cached.views, stale: true }
    return { error: reason }
  } finally {
    clearTimeout(timer)
  }
}
