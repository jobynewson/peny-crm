// src/training/engine.js
// The maths behind Training, free of the DOM so it can be tested: prescriptions,
// time estimates, the cool-down built from a person's areas, session
// generation, and the timer's step list. Content lives in data.js.

import { EXERCISES, PROGRAMS, SLOTS, SESSION_KEYS, WEEKS, phaseOf } from './data.js'

export const EX = Object.fromEntries(EXERCISES.map(e => [e.id, e]))
const T = 'time'

// Cool-down: about five minutes, with the same slack Build a session allows.
export const COOL_BUDGET = 300
const SLACK = 90

export function presc(ex, ph, warm, cool) {
  const i = ph - 1
  if (cool) return { sets: 1, time: ex.t || 40, rest: 20 }
  if (warm) return ex.mode === T ? { sets: 1, time: 40, rest: 10 } : { sets: 1, reps: '8', rest: 10 }
  if (ex.p) return { ...ex.p[i] }
  if (ex.mode === T) return { sets: 3, time: [30, 40, 45][i], rest: [30, 45, 45][i] }
  if (ex.cat === 'power') return [{ sets: 3, reps: '5', rest: 45 }, { sets: 3, reps: '6', rest: 60 }, { sets: 4, reps: '5', rest: 75 }][i]
  if (ex.cat === 'core') return { sets: 3, reps: ['8', '10', '12'][i], rest: 30 }
  if (ex.cat === 'cond') return { sets: 3, reps: ['8', '10', '10'][i], rest: 45 }
  return [{ sets: 3, reps: '10–12', rest: 45 }, { sets: 4, reps: '8–10', rest: 60 }, { sets: 4, reps: '6', rest: 75 }][i]
}

export const item = (id, ph, role) => ({ id, warm: role === 'warm', cool: role === 'cool', ...presc(EX[id], ph, role === 'warm', role === 'cool') })
export const roleOf = it => (it.warm ? 'warm' : it.cool ? 'cool' : null)
export const isMain = it => !it.warm && !it.cool
export const grpName = it => (it.warm ? 'Warm-up' : it.cool ? 'Cool-down stretches' : 'Main work')

// Seconds, with the original's allowances for changing sides and setting up.
export function est(items) {
  let t = 0
  items.forEach(it => {
    const sd = EX[it.id].uni ? 2 : 1
    const work = it.time ? it.time * sd : parseInt(it.reps) * 3.5 * sd + 6
    t += it.sets * (work + it.rest) + 10
  })
  return t
}
export const mins = items => Math.max(1, Math.round(est(items) / 60))

export function rx(it) {
  const ex = EX[it.id]
  let s = (it.sets > 1 ? it.sets + ' × ' : '') + (it.time ? it.time + ' s' : it.reps + ' reps') + (ex.uni ? ' each side' : '')
  if (isMain(it)) s += ', ' + it.rest + ' s rest'
  return s
}
export const eqLabel = (ex, EQ) => ex.eq.map(e => EQ[e]).join(' or ')

export const usable = (ex, kit) => ex.eq.some(e => e === 'bw' || kit.includes(e))

// ── Cool-down ────────────────────────────────────────────────────────────────
// Stretches for an area, in library order, that the kit allows.
export const stretchesFor = (area, kit) => EXERCISES.filter(e => e.area === area && usable(e, kit))

// One stretch per chosen area, kept to about five minutes. When more areas are
// chosen than fit, each session takes the next areas along the list where the
// last one stopped (A, then B, then C), so every area gets looked at across the
// week. A session also moves along each area's own stretches, so A, B and C
// vary. `index` is 0, 1 or 2 for A, B, C.
export function coolDown(areas, kit, index, ph) {
  const chosen = areas.filter(a => stretchesFor(a, kit).length)
  if (!chosen.length) return []

  const forSession = s => chosen.map(a => { const list = stretchesFor(a, kit); return item(list[s % list.length].id, ph, 'cool') })
  let start = 0
  for (let s = 0; ; s++) {
    const all = forSession(s), picked = []
    for (let k = 0; k < all.length; k++) {
      const next = all[(start + k) % all.length]
      if (picked.length && est([...picked, next]) > COOL_BUDGET + SLACK) break
      picked.push(next)
    }
    if (s === index) return picked
    start = (start + picked.length) % all.length
  }
}

// ── Program ──────────────────────────────────────────────────────────────────
export function progSession(sport, areas, kit, w, k) {
  const ph = phaseOf(w), P = PROGRAMS[sport][k]
  return [
    ...P.warm.map(id => item(id, ph, 'warm')),
    ...P.main[ph].map(id => item(id, ph)),
    ...coolDown(areas, kit, SESSION_KEYS.indexOf(k), ph),
  ]
}

// The week to open on: the first with a session left. `done` is a Set of
// "w<week><key>" strings for one sport.
export function curWeek(done) {
  for (let w = 1; w <= WEEKS; w++) if (!SESSION_KEYS.every(k => done.has('w' + w + k))) return w
  return WEEKS
}

// ── Build a session ──────────────────────────────────────────────────────────
const shuffle = (arr, rand) => arr.map(v => [rand(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1])

export function generate({ gen, kit, areas }, rand = Math.random) {
  const pick = arr => arr[Math.floor(rand() * arr.length)]
  const budget = gen.dur * 60, used = new Set(), out = []
  const warm = shuffle(EXERCISES.filter(e => e.cat === 'warm' && usable(e, kit)), rand).slice(0, gen.dur <= 20 ? 2 : 3)
  warm.forEach(e => { used.add(e.id); out.push(item(e.id, gen.phase, 'warm')) })

  // Same areas as the plan, from a random starting point, up to the cool-down budget.
  const chosen = shuffle(areas.filter(a => stretchesFor(a, kit).length), rand)
  const cool = []
  for (const a of chosen) {
    const next = item(pick(stretchesFor(a, kit)).id, gen.phase, 'cool')
    if (cool.length && est([...cool, next]) > COOL_BUDGET + SLACK) break
    cool.push(next)
  }
  cool.forEach(c => used.add(c.id))
  const coolT = est(cool)

  for (const cat of SLOTS[gen.focus]) {
    const c = EXERCISES.filter(e => e.cat === cat && usable(e, kit) && !used.has(e.id))
    if (!c.length) continue
    const e = pick(c), it = item(e.id, gen.phase)
    if (est([...out, it]) + coolT <= budget + 90) { used.add(e.id); out.push(it) }
  }
  // Long sessions: use spare time for extra sets on the main lifts
  const main = out.filter(isMain)
  let guard = 0
  while (main.length && est(out) + coolT < budget - 240 && guard < main.length * 2) {
    const it = main[guard % main.length]
    it.sets++
    if (est(out) + coolT > budget + 90) { it.sets--; break }
    guard++
  }
  return [...out, ...cool]
}

export function swap(items, i, { kit, phase }, rand = Math.random) {
  const cur = items[i], ex = EX[cur.id], ids = new Set(items.map(x => x.id))
  const c = EXERCISES.filter(e => e.cat === ex.cat && (!ex.area || e.area === ex.area) && usable(e, kit) && !ids.has(e.id))
  if (!c.length) return items
  const next = items.slice()
  next[i] = item(c[Math.floor(rand() * c.length)].id, phase, roleOf(cur))
  return next
}

// ── Timer steps ──────────────────────────────────────────────────────────────
export function makeSteps(items) {
  const st = [{ k: 'ready', dur: 5 }]
  items.forEach((it, xi) => {
    const ex = EX[it.id]
    for (let s = 1; s <= it.sets; s++) {
      if (it.time && ex.uni) {
        st.push({ k: 'work', xi, s, side: 'Left' })
        st.push({ k: 'rest', dur: it.cool ? 12 : 6, sw: 1 })
        st.push({ k: 'work', xi, s, side: 'Right' })
      } else st.push({ k: 'work', xi, s })
      if (!(xi === items.length - 1 && s === it.sets)) st.push({ k: 'rest', dur: it.rest })
    }
  })
  return st
}
