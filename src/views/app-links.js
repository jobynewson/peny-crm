// The team's other apps, listed under Apps in the account menu. Stored on
// settings.app_links as [{ name, url }]. Only http(s) links are kept: a link
// opens in a new tab, and other schemes (nfs://, file://, javascript:) either
// don't open from a web page or aren't safe to.

export const MAX_APP_LINKS = 12

export function appLinkUrl(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  try {
    const u = new URL(text)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch { return null }
}

// Rows from the Settings form -> { links, rejected }. Blank rows are dropped;
// a row with a name or URL that can't be used is reported, not saved.
export function cleanAppLinks(rows) {
  const links = []
  const rejected = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.name ?? '').trim()
    const rawUrl = String(row?.url ?? '').trim()
    if (!name && !rawUrl) continue
    const url = appLinkUrl(rawUrl)
    if (!name || !url) { rejected.push(name || rawUrl); continue }
    links.push({ name: name.slice(0, 60), url })
  }
  return { links: links.slice(0, MAX_APP_LINKS), rejected }
}

// What the account menu shows: saved entries that still pass the check.
export function visibleAppLinks(settings) {
  return cleanAppLinks(settings?.app_links).links
}
