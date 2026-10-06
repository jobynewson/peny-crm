// src/pdf/paginate.js
// Lays a document out across A4 pages, in the browser (it needs real layout to
// know what fits). Page breaks fall between a heading's group and the next, so
// a heading never sits alone at the bottom of a page; a group that is too long
// for a page is split between its blocks instead. Page numbers ("Page 2 of 3")
// appear once there is more than one page, and the studio footer closes the
// last page.
//
// Used for the live preview and the print, so both show the same pages.

import { buildModel, pageHtml } from './onepager.js'

const A4_PX = 297 * 96 / 25.4

/** The pages' HTML for a document: `<div class="pdf-one-pages">…</div>`, and how many pages it has. */
export function paginate(doc, settings = {}) {
  const m = buildModel(doc, settings)
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none'
  document.body.appendChild(host)

  // Does a page with these blocks fit on one sheet? The page grows past A4 when
  // its content doesn't, so measuring its height is the test. The page-number
  // line is sized as if there were several pages, so the answer holds once the
  // real count is known.
  const fits = (blocks, first, last) => {
    host.innerHTML = pageHtml(m, { first, last, num: 99, total: 99, bodyHtml: blocks.map(b => b.html).join('') })
    return host.firstElementChild.offsetHeight <= A4_PX + 1
  }

  try {
    const pages = [[]]
    m.groups.forEach((group, g) => {
      const blocks = group.map(html => ({ html, g }))
      const cur = () => pages.at(-1)
      if (fits([...cur(), ...blocks], pages.length === 1, false)) { cur().push(...blocks); return }
      if (cur().length) pages.push([])                      // start the section on a fresh page
      if (fits(blocks, pages.length === 1, false)) { cur().push(...blocks); return }
      for (const b of blocks) {                              // longer than a page: split between blocks
        if (fits([...cur(), b], pages.length === 1, false) || !cur().length) cur().push(b)
        else pages.push([b])
      }
    })

    // The studio footer closes the last page; if it doesn't fit there, the last
    // section moves to a page of its own, or failing that its last block does.
    for (let guard = 0; guard < 200 && !fits(pages.at(-1), pages.length === 1, true); guard++) {
      const last = pages.at(-1)
      const lastG = last.at(-1)?.g
      const tail = last.filter(b => b.g === lastG)
      const move = tail.length < last.length ? tail : last.length > 1 ? last.slice(-1) : null
      if (!move) break
      pages[pages.length - 1] = last.slice(0, last.length - move.length)
      pages.push(move)
    }

    const total = pages.length
    return {
      total,
      html: `<div class="pdf-one-pages">${pages.map((blocks, i) =>
        pageHtml(m, { first: i === 0, last: i === total - 1, num: i + 1, total, bodyHtml: blocks.map(b => b.html).join('') })).join('')}</div>`,
    }
  } finally {
    host.remove()
  }
}
