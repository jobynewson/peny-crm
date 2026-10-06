import { describe, it, expect, vi } from 'vitest'
import {
  AREAS, DEFAULT_PROFILE, PREFILLS, KIT, DETAILS, EXERCISES, PROGRAMS, SPORTS, SPORT_WHY, WHY, whyFor, phaseOf,
} from './data.js'
import { EX, COOL_BUDGET, coolDown, curWeek, est, generate, makeSteps, progSession, stretchesFor, swap } from './engine.js'
import { TrainingStore } from './store.js'
import { createAwake } from './wakelock.js'
import { FIGURES, figureHtml, videoUrl } from './figures.js'

const ALL_KIT = ['band', 'kb', 'db']
const ALL_AREAS = AREAS.map(a => a.id)

describe('content', () => {
  it('has 53 original exercises and stretches plus the seven new stretches', () => {
    expect(EXERCISES).toHaveLength(60)
    expect(new Set(EXERCISES.map(e => e.id)).size).toBe(60)
  })
  it('gives every exercise full details, a general line and cues', () => {
    for (const e of EXERCISES) {
      const d = DETAILS[e.id]
      expect(d?.setup, e.id).toBeTruthy()
      expect(d.steps.length, e.id).toBeGreaterThan(0)
      expect(d.feel, e.id).toBeTruthy()
      expect(WHY[e.id], e.id).toBeTruthy()
      expect(e.cues.length, e.id).toBeGreaterThan(0)
    }
  })
  it('keeps the original wording as the MTB lines, with a general fallback', () => {
    expect(SPORT_WHY.mtb.goblet).toBe('Leg strength for absorbing landings, compressions and long braking sections.')
    expect(whyFor('goblet', 'mtb')).toBe(SPORT_WHY.mtb.goblet)
    expect(whyFor('goblet', 'road')).toBe(WHY.goblet)
    expect(WHY.goblet).not.toMatch(/bike|ride|riding|bars/i)
    // Only the MTB lines may mention riding; the general ones are sport-neutral.
    for (const [id, line] of Object.entries(WHY)) expect(line, id).not.toMatch(/\bbike\b|\briding\b|\bbars\b/i)
  })
  it('only names exercises and sports that exist', () => {
    for (const s of Object.keys(SPORT_WHY)) expect(SPORTS.map(x => x.id)).toContain(s)
    for (const [s, m] of Object.entries(SPORT_WHY)) for (const id of Object.keys(m)) expect(EX[id], `${s}.${id}`).toBeTruthy()
    for (const s of SPORTS) {
      for (const k of 'ABC') {
        const p = PROGRAMS[s.id][k]
        expect(p.warm).toHaveLength(3)
        for (const ph of [1, 2, 3]) {
          expect(new Set(p.main[ph]).size).toBe(p.main[ph].length)
          p.main[ph].forEach(id => expect(EX[id], `${s.id}${k}${ph}${id}`).toBeTruthy())
        }
      }
    }
  })
  it('has stretches for every cool-down area, and the new ones follow the same format', () => {
    for (const a of AREAS) expect(stretchesFor(a.id, ALL_KIT).length, a.id).toBeGreaterThan(0)
    for (const id of ['hipflexor', 'figure4', 'child', 'lumbartwist', 'floorchest', 'wristflex', 'wristext']) {
      expect(EX[id].cat).toBe('stretch')
      expect(EX[id].t).toBeGreaterThan(0)
    }
  })
})

describe('the original MTB program is unchanged', () => {
  it('has the original sessions, warm-ups and prescriptions', () => {
    expect(PROGRAMS.mtb.A.main[1]).toEqual(['goblet', 'slrdl', 'bss', 'swing', 'attack'])
    expect(PROGRAMS.mtb.C.main[3]).toEqual(['broadjump', 'revlunge', 'thrust', 'skater', 'chop', 'sideplank'])
    const s = progSession('mtb', ['ham', 'calf', 'shoulder'], ALL_KIT, 5, 'A')
    const goblet = s.find(i => i.id === 'goblet')
    expect(goblet).toMatchObject({ sets: 4, reps: '8–10', rest: 60 })
    expect(s.find(i => i.id === 'swing')).toMatchObject({ sets: 4, reps: '15', rest: 45 })
    expect(s.find(i => i.id === 'wgs')).toMatchObject({ warm: true, sets: 1, time: 40, rest: 10 })
  })
  it('keeps the cool-down timings: 20 s between stretches, 12 s to switch sides', () => {
    const steps = makeSteps(progSession('mtb', ['ham', 'calf', 'shoulder'], ALL_KIT, 1, 'A').filter(i => i.cool))
    expect(steps.filter(s => s.sw).every(s => s.dur === 12)).toBe(true)
    expect(steps.filter(s => s.k === 'rest' && !s.sw).every(s => s.dur === 20)).toBe(true)
  })
})

describe('cool-down', () => {
  it('is one stretch per chosen area, about five minutes', () => {
    for (const k of [0, 1, 2]) {
      const c = coolDown(['ham', 'calf', 'shoulder'], ALL_KIT, k, 1)
      expect(c.map(i => EX[i.id].area)).toEqual(['ham', 'calf', 'shoulder'])
      expect(est(c)).toBeLessThanOrEqual(COOL_BUDGET + 90)
    }
  })
  it('rotates the areas across A, B and C when they do not all fit', () => {
    const seen = new Set()
    for (const k of [0, 1, 2]) {
      const c = coolDown(ALL_AREAS, ALL_KIT, k, 1)
      expect(est(c)).toBeLessThanOrEqual(COOL_BUDGET + 90)
      expect(c.length).toBeLessThan(ALL_AREAS.length)
      c.forEach(i => seen.add(EX[i.id].area))
    }
    expect([...seen].sort()).toEqual([...ALL_AREAS].sort())
  })
  it('is empty with no areas and ignores areas the kit cannot do', () => {
    expect(coolDown([], ALL_KIT, 0, 1)).toEqual([])
    for (const k of [0, 1, 2]) coolDown(ALL_AREAS, [], k, 1).forEach(i => expect(EX[i.id].eq).toContain('bw'))
  })
})

describe('Build a session', () => {
  it('uses the chosen areas and kit and stays near the length', () => {
    let n = 0
    const rand = () => { n = (n * 9301 + 49297) % 233280; return n / 233280 }
    const s = generate({ gen: { dur: 30, focus: 'full', phase: 2 }, kit: ['band'], areas: ['hips', 'chest'] }, rand)
    expect(s.filter(i => i.cool).map(i => EX[i.id].area).sort()).toEqual(['chest', 'hips'])
    s.forEach(i => expect(EX[i.id].eq.some(e => e === 'bw' || e === 'band')).toBe(true))
    expect(est(s)).toBeLessThanOrEqual(30 * 60 + 90 + 10)
  })
  it('swaps within the same kind of exercise', () => {
    const s = generate({ gen: { dur: 30, focus: 'full', phase: 1 }, kit: ALL_KIT, areas: ['ham'] })
    const i = s.findIndex(x => x.cool)
    const t = swap(s, i, { kit: ALL_KIT, phase: 1 })
    expect(EX[t[i].id].area).toBe('ham')
    expect(t[i].cool).toBe(true)
  })
})

describe('plan progress', () => {
  it('opens on the first week with a session left', () => {
    expect(curWeek(new Set())).toBe(1)
    expect(curWeek(new Set(['w1A', 'w1B', 'w1C', 'w2A']))).toBe(2)
    expect(curWeek(new Set(['w1A', 'w1B', 'w1C']))).toBe(2)
    expect(phaseOf(4)).toBe(2)
  })
})

// ── Saving ───────────────────────────────────────────────────────────────────
function memoryStorage() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }
function fakeApi({ fail = null } = {}) {
  const calls = []
  const api = {
    calls, failWith: fail,
    fetchTraining: vi.fn(async () => ({ profile: null, done: [] })),
    saveTrainingProfile: vi.fn(async p => { if (api.failWith) throw api.failWith; calls.push(['profile', p]) }),
    saveTrainingSession: vi.fn(async s => { if (api.failWith) throw api.failWith; calls.push(['session', s]) }),
    deleteTrainingProgram: vi.fn(async (...a) => { if (api.failWith) throw api.failWith; calls.push(['delete', ...a]) }),
  }
  return api
}
const offline = Object.assign(new TypeError('Failed to fetch'), {})

describe('TrainingStore', () => {
  it('shows a change at once and sends it in the background', async () => {
    const api = fakeApi(), store = new TrainingStore({ api, userId: 'u1', storage: memoryStorage() })
    await store.load()
    store.markDone('mtb', 1, 'A')
    expect(store.isDone('mtb', 1, 'A')).toBe(true)         // before the request finishes
    await store.flush()
    expect(api.calls[0][0]).toBe('session')
    expect(store.pending()).toBe(0)
  })

  it('keeps plan progress per sport', async () => {
    const store = new TrainingStore({ api: fakeApi(), userId: 'u1', storage: memoryStorage() })
    await store.load()
    store.markDone('mtb', 1, 'A')
    store.markDone('road', 1, 'B')
    expect([...store.doneSet('mtb')]).toEqual(['w1A'])
    expect([...store.doneSet('road')]).toEqual(['w1B'])
    store.unmarkDone('mtb', 1, 'A')
    expect(store.doneSet('mtb').size).toBe(0)
    expect(store.doneSet('road').size).toBe(1)
  })

  it('queues while offline, warns, survives a reload and sends later', async () => {
    const storage = memoryStorage(), warns = []
    const api = fakeApi({ fail: offline })
    const store = new TrainingStore({ api, userId: 'u1', storage, onWarn: m => warns.push(m) })
    await store.load()
    store.logSession({ sport: 'mtb', kind: 'custom', items: [{ id: 'row' }], startedAt: 'a', completedAt: 'b', durationSeconds: 60 })
    await store.flush()
    expect(store.pending()).toBe(1)
    expect(warns.at(-1)).toMatch(/Not saved yet/)
    store.dispose()

    // "Refresh": a new store reads the same queue, and back online it goes out once.
    const api2 = fakeApi(), warns2 = []
    const again = new TrainingStore({ api: api2, userId: 'u1', storage, onWarn: m => warns2.push(m) })
    expect(again.pending()).toBe(1)
    await again.load()
    await again.flush()
    expect(api2.calls.filter(c => c[0] === 'session')).toHaveLength(1)
    expect(again.pending()).toBe(0)
    expect(warns2.at(-1)).toBe(null)
  })

  it('keeps a queued completion on screen after reloading from the server', async () => {
    const storage = memoryStorage()
    const api = fakeApi({ fail: offline })
    const a = new TrainingStore({ api, userId: 'u1', storage })
    await a.load()
    a.logSession({ sport: 'mtb', kind: 'program', week: 3, key: 'C', items: [], startedAt: 'a', completedAt: 'b', durationSeconds: 5 })
    a.dispose()
    const b = new TrainingStore({ api: fakeApi({ fail: offline }), userId: 'u1', storage })
    await b.load()
    expect(b.isDone('mtb', 3, 'C')).toBe(true)
    b.dispose()
  })

  it('keeps each person’s queue apart', () => {
    const storage = memoryStorage()
    const a = new TrainingStore({ api: fakeApi({ fail: offline }), userId: 'u1', storage })
    a.markDone('mtb', 1, 'A')
    expect(new TrainingStore({ api: fakeApi(), userId: 'u2', storage }).pending()).toBe(0)
    a.dispose()
  })

  it('drops what the server refuses and says so', async () => {
    const warns = []
    const api = fakeApi({ fail: Object.assign(new Error('no'), { status: 422 }) })
    const store = new TrainingStore({ api, userId: 'u1', storage: memoryStorage(), onWarn: m => warns.push(m) })
    await store.load()
    store.saveProfile({ sport: 'mtb', areas: [], kit: [], gen: {} })
    await store.flush()
    expect(store.pending()).toBe(0)
    expect(warns.at(-1)).toMatch(/couldn’t be saved/)
  })

  it('only sends the latest profile', async () => {
    const api = fakeApi({ fail: offline }), store = new TrainingStore({ api, userId: 'u1', storage: memoryStorage() })
    await store.load()
    store.saveProfile({ sport: 'mtb', areas: [], kit: [], gen: {} })
    store.saveProfile({ sport: 'road', areas: [], kit: [], gen: {} })
    expect(store.queue.filter(o => o.type === 'profile')).toHaveLength(1)
    expect(store.profile.sport).toBe('road')
    store.dispose()
  })
})

// ── Screen wake lock ─────────────────────────────────────────────────────────
function fakeDoc() {
  const listeners = {}
  const video = { children: [], style: {}, paused: true, muted: false, currentTime: 0, setAttribute() {}, appendChild(c) { this.children.push(c) }, addEventListener() {}, play() { this.paused = false; return Promise.resolve() }, pause() { this.paused = true } }
  return {
    visibilityState: 'visible', body: { appendChild() {} }, video,
    createElement: tag => (tag === 'video' ? video : {}),
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f) },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter(x => x !== f) },
    fire: t => (listeners[t] || []).forEach(f => f()),
    listeners,
  }
}
function fakeNav() {
  const locks = []
  return { locks, wakeLock: { request: vi.fn(async () => { const l = { released: false, release: vi.fn(async () => { l.released = true }), addEventListener() {} }; locks.push(l); return l }) } }
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('keeping the screen awake', () => {
  it('requests the lock at start and cleans up at the end', async () => {
    const nav = fakeNav(), doc = fakeDoc(), awake = createAwake({ nav, doc })
    awake.on(); await tick()
    expect(nav.wakeLock.request).toHaveBeenCalledWith('screen')
    expect(awake.state.locked).toBe(true)
    expect(doc.video.paused).toBe(true)                 // no video when the API works

    awake.off(); await tick()
    expect(awake.state.active).toBe(false)
    expect(doc.listeners.visibilitychange).toHaveLength(0)
  })

  it('re-requests on visibilitychange after the lock was dropped', async () => {
    const nav = fakeNav(), doc = fakeDoc()
    const released = []
    nav.wakeLock.request = vi.fn(async () => { const l = { release: async () => {}, addEventListener: (e, f) => released.push(f) }; nav.locks.push(l); return l })
    const awake = createAwake({ nav, doc })
    awake.on(); await tick()
    released[0]()                                       // browser released it (tab hidden)
    expect(awake.state.locked).toBe(false)
    doc.fire('visibilitychange'); await tick()
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(2)
    expect(awake.state.locked).toBe(true)
    awake.off()
  })

  it('releases when the session ends and stops listening', async () => {
    const nav = fakeNav(), doc = fakeDoc(), awake = createAwake({ nav, doc })
    awake.on(); await tick()
    awake.off(); await tick()
    expect(nav.locks[0].release).toHaveBeenCalled()
    doc.visibilityState = 'visible'; doc.fire('visibilitychange'); await tick()
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1)   // nothing after the end
  })

  it('falls back to the silent video without the API, or if the request is refused', async () => {
    const doc = fakeDoc(), awake = createAwake({ nav: {}, doc })
    awake.on(); await tick()
    expect(doc.video.paused).toBe(false)
    expect(doc.video.children.map(s => s.type)).toEqual(['video/webm', 'video/mp4'])
    awake.off()
    expect(doc.video.paused).toBe(true)

    const doc2 = fakeDoc(), nav = { wakeLock: { request: vi.fn(async () => { throw new Error('denied') }) } }
    const a2 = createAwake({ nav, doc: doc2 })
    a2.on(); await tick()
    expect(doc2.video.paused).toBe(false)
    a2.off()
  })
})

describe('defaults', () => {
  it('pre-fills only valid choices', () => {
    for (const p of Object.values(PREFILLS)) {
      expect(SPORTS.map(x => x.id)).toContain(p.sport)
      p.areas.forEach(a => expect(ALL_AREAS).toContain(a))
      p.kit.forEach(k => expect(KIT.map(x => x.id)).toContain(k))
    }
  })
  it('start general with three areas and all the kit', () => {
    expect(DEFAULT_PROFILE).toMatchObject({ sport: 'general', areas: ['ham', 'calf', 'shoulder'], kit: ALL_KIT })
  })
})

describe('exercise diagrams', () => {
  const POINTS = ['head', 'sh', 'hip', 'kn', 'an', 'toe', 'el', 'wr', 'kn2', 'an2', 'toe2', 'el2', 'wr2']
  const SEGS = ['thigh', 'shin', 'torso', 'uarm', 'farm']
  it('every exercise has 2 or 3 frames and every figure belongs to an exercise', () => {
    for (const e of EXERCISES) expect(FIGURES[e.id]?.length, e.id).toBeGreaterThanOrEqual(2)
    for (const id of Object.keys(FIGURES)) expect(EXERCISES.some(e => e.id === id), id).toBe(true)
  })
  it('frames use known joints, keep the head inside their own viewBox and have a caption', () => {
    for (const [id, frames] of Object.entries(FIGURES)) {
      expect(frames.length, id).toBeLessThanOrEqual(3)
      for (const f of frames) {
        expect(f.label, id).toBeTruthy()
        expect(f.head && f.sh && f.hip, id).toBeTruthy()
        const [vx, vy, vw, vh] = (f.vb ?? '14 8 172 128').split(' ').map(Number)
        for (const k of POINTS) if (f[k]) {
          expect(f[k].length, `${id}.${k}`).toBe(2)
          if (k !== 'head') continue // zoomed frames may crop the legs on purpose
          expect(f[k][0], `${id}.${k} x`).toBeGreaterThanOrEqual(vx); expect(f[k][0], `${id}.${k} x`).toBeLessThanOrEqual(vx + vw)
          expect(f[k][1], `${id}.${k} y`).toBeGreaterThanOrEqual(vy); expect(f[k][1], `${id}.${k} y`).toBeLessThanOrEqual(vy + vh)
        }
        for (const h of f.hl ?? []) expect(SEGS, id).toContain(h)
      }
    }
  })
  it('renders svg with accessible captions, and builds a video search link', () => {
    expect(figureHtml('goblet')).toContain('role="img"')
    expect(figureHtml('nope')).toBe('')
    const u = videoUrl({ name: 'Goblet squat', cat: 'squat' })
    expect(u).toMatch(/^https:\/\/www\.youtube\.com\/results\?search_query=how%20to%20do%20Goblet%20squat/)
  })
})
