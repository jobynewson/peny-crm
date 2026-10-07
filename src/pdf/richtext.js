// src/pdf/richtext.js
// Converts between what the rich text boxes hold (bold, italic and line breaks
// in the page) and what a document stores: the text markup that inline() in
// onepager.js turns into HTML, **bold** and _italic_ with one line per line.
// Storing the markup keeps saved documents plain strings.
//
// Pure: htmlToMarkup() only reads nodeType / nodeName / data / childNodes /
// style, so it is tested with plain objects and runs on a real DOM unchanged.

import { inline } from './onepager.js'

/** Stored markup → the HTML a rich text box shows. inline() leaves only strong, em and text, so it is safe as innerHTML. */
export const markupToHtml = markup => inline(markup).replace(/\n/g, '<br>')

const BOLD = new Set(['B', 'STRONG'])
const ITALIC = new Set(['I', 'EM'])
const BLOCK = new Set(['DIV', 'P', 'LI'])
const isBoldStyle = w => w === 'bold' || w === 'bolder' || Number(w) >= 600
const word = c => /\w/.test(c ?? '')
const plain = s => s.replace(/[\\*_]/g, '\\$&')

// The box's content as a flat list of runs: { text, b, i } or { br: true }.
function runsOf(root) {
  const out = []
  const walk = (node, b, i) => {
    if (node.nodeType === 3) {
      const text = String(node.data ?? '').replace(/[ ​]/g, m => (m === ' ' ? ' ' : ''))
      if (text) out.push({ text, b, i })
      return
    }
    if (node.nodeType !== 1) return
    const name = String(node.nodeName).toUpperCase()
    if (name === 'BR') { out.push({ br: true }); return }
    const b2 = b || BOLD.has(name) || isBoldStyle(node.style?.fontWeight)
    const i2 = i || ITALIC.has(name) || node.style?.fontStyle === 'italic'
    const block = BLOCK.has(name)
    if (block && out.length && !out.at(-1).br) out.push({ br: true })
    for (const child of node.childNodes ?? []) walk(child, b2, i2)
    if (block && out.length && !out.at(-1).br) out.push({ br: true })
  }
  walk(root, false, false)
  if (out.at(-1)?.br) out.pop()          // the browser's placeholder break at the end of the last line
  return out
}

/** A rich text box's content → stored markup. */
export function htmlToMarkup(root) {
  const runs = runsOf(root)
  // Neighbouring text with the same look is one piece.
  const parts = []
  for (const r of runs) {
    const last = parts.at(-1)
    if (!r.br && last && !last.br && last.b === r.b && last.i === r.i) last.text += r.text
    else parts.push({ ...r })
  }
  let out = ''
  parts.forEach((p, k) => {
    if (p.br) { out += '\n'; return }
    if (!p.b && !p.i) { out += plain(p.text); return }
    // Spaces stay outside the marks: "**word **" would not read back as bold.
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(p.text)
    if (!core) { out += p.text; return }
    let body = plain(core)
    if (p.i) {
      // _italic_ only reads at the edge of a word; inside a word it is *italic*.
      const before = (out + lead).slice(-1), after = (trail || parts[k + 1]?.text || '')[0]
      const mark = word(before) || word(after) ? '*' : '_'
      body = mark + body + mark
    }
    if (p.b) body = `**${body}**`
    out += lead + body + trail
  })
  return out
}
