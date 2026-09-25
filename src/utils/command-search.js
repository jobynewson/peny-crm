// Matching for the search palette's pages and actions ("expenses",
// "new project", "holiday"). Pure, so it's unit-tested; the list itself is
// built per person in src/views/search-commands.js.
//
// Every word typed must start a word in the entry's label or keywords, in
// any order. Ranking: the label itself, then a label word, then a keyword;
// pages come before actions when the scores tie.

const words = s => String(s ?? '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean)

/**
 * @param {{ kind: 'page'|'action', label: string, keywords?: string }[]} commands
 * @param {string} query
 * @param {number} [limit]
 */
export function matchCommands(commands, query, limit = 6) {
  const q = words(query)
  if (!q.length) return []
  const phrase = q.join(' ')
  const scored = []
  for (const c of commands) {
    const label = words(c.label)
    const all = [...label, ...words(c.keywords)]
    if (!q.every(w => all.some(x => x.startsWith(w)))) continue
    const labelText = label.join(' ')
    let score
    if (labelText === phrase) score = 100
    else if (labelText.startsWith(phrase)) score = 80
    else if (q.every(w => label.some(x => x.startsWith(w)))) score = 60
    else score = 30
    if (c.kind === 'page') score += 1
    scored.push({ c, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.c.label.localeCompare(b.c.label))
    .slice(0, limit)
    .map(s => s.c)
}
