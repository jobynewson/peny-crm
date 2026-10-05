// src/training/figures.js
// Side-view stick-figure diagrams for the exercise how-tos. Pure data plus a
// tiny renderer: every exercise has 2 to 3 frames (start, end, ...) drawn from
// the same body template so they look consistent in light and dark themes.
//
// Coordinates are SVG units in a 200 x 150 box, facing right, ground at y=130.
// Joints: head (circle centre), sh, hip, kn, an, toe, el, wr for the near side
// and kn2, an2, toe2, el2, wr2 for the far side (drawn lighter). Limb lengths
// to aim for: torso 32, thigh 32, shin 30, upper arm 17, forearm 17.
// `hl` names the working segments drawn in the accent colour: thigh, shin,
// torso, uarm, farm. `extra` is raw SVG (use the helpers below) for equipment
// and a direction arrow. `vb` overrides the viewBox to crop a frame. Set
// `flat: true` for a front or top-down view, where both sides are drawn alike
// (put the left limbs in kn/an/toe/el/wr and the right in kn2/an2/toe2/el2/wr2).
//
// To add an exercise: add its frames to a file in src/training/figs/ and keep
// the id the same as in EXERCISES (training.test.js checks all of them).

import { FIGS_A } from './figs/a.js'
import { FIGS_B } from './figs/b.js'
import { FIGS_C } from './figs/c.js'
import { FIGS_D } from './figs/d.js'
import { FIGS_E } from './figs/e.js'

export * from './figs/helpers.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const seg = (a, b, cls = '') => (a && b ? `<line class="fg-limb ${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>` : '')

function frameSvg(f) {
  const hl = new Set(f.hl ?? [])
  const h = n => (hl.has(n) ? 'hl' : '')
  const far = f.flat ? '' : 'far' // front and top-down views draw both sides alike
  let s = '<line class="fg-ground" x1="8" y1="130" x2="192" y2="130"/>'
  s += f.back ?? ''
  s += seg(f.hip, f.kn2, far) + seg(f.kn2, f.an2, far) + seg(f.an2, f.toe2, far)
  s += seg(f.sh, f.el2, far) + seg(f.el2, f.wr2, far)
  s += seg(f.hip, f.kn, h('thigh')) + seg(f.kn, f.an, h('shin')) + seg(f.an, f.toe)
  s += seg(f.sh, f.hip, h('torso'))
  s += seg(f.sh, f.el, h('uarm')) + seg(f.el, f.wr, h('farm'))
  s += `<circle class="fg-head" cx="${f.head[0]}" cy="${f.head[1]}" r="7"/>`
  s += f.extra ?? ''
  return `<figure class="fg-frame"><svg viewBox="${f.vb ?? '14 8 172 128'}" role="img" aria-label="${esc(f.label)}">${s}</svg><figcaption>${esc(f.label)}</figcaption></figure>`
}

export const FIGURES = { ...FIGS_A, ...FIGS_B, ...FIGS_C, ...FIGS_D, ...FIGS_E }

export function figureHtml(id) {
  const frames = FIGURES[id]
  if (!frames?.length) return ''
  return `<div class="fg-row${frames.length > 2 ? ' fg-wide' : ''}">${frames.map(frameSvg).join('')}</div>`
}

// Backup video: a search link, so it never goes stale and needs no curation.
export const videoUrl = ex =>
  'https://www.youtube.com/results?search_query=' + encodeURIComponent(`how to do ${ex.name} ${ex.cat === 'stretch' ? 'stretch' : 'exercise'} form`)
