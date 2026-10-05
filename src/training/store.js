// src/training/store.js
// A person's Training state with instant saves. Changes show straight away and
// are sent in the background; anything that can't be sent (offline, a server
// hiccup) waits in a queue kept in localStorage, per person, and goes out when
// the connection is back. A small warning shows while something is waiting,
// or when the server refuses a save.
//
// `api` is { fetchTraining, saveTrainingProfile, saveTrainingSession,
// deleteTrainingProgram } (src/api/training.js). Tests pass fakes.

import { DEFAULT_PROFILE } from './data.js'

const doneKey = (sport, w, k) => `${sport}:w${w}${k}`
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
}))

// A failure worth retrying: no answer at all, or the server having a bad moment.
const retryable = err => !err?.status || err.status >= 500 || err.status === 401 || err.status === 429

export class TrainingStore {
  constructor({ api, userId, storage = globalThis.localStorage, onChange = () => {}, onWarn = () => {} }) {
    this.api = api
    this.storageKey = `slate-training-queue:${userId}`
    this.storage = storage
    this.onChange = onChange
    this.onWarn = onWarn
    this.profile = null        // null until saved: the first-open setup screen
    this.done = new Map()      // "sport:w1A" → completed_at
    this.queue = this._readQueue()
    this.flushing = null
    this.retryTimer = null
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  async load() {
    const { profile, done } = await this.api.fetchTraining()
    this.profile = profile
    this.done = new Map(done.map(d => [doneKey(d.sport, d.week, d.session_key), d.completed_at]))
    // Anything still waiting from before is shown as if it had been saved.
    this.queue.forEach(op => this._apply(op))
    this.onChange()
    this.flush()
  }

  hasProfile() { return !!this.profile }
  isDone(sport, w, k) { return this.done.has(doneKey(sport, w, k)) }
  doneSet(sport) {
    const out = new Set(), prefix = sport + ':'
    for (const key of this.done.keys()) if (key.startsWith(prefix)) out.add(key.slice(prefix.length))
    return out
  }

  // ── Changes (each shows at once and is sent in the background) ─────────────
  saveProfile(profile) {
    const clean = { sport: profile.sport, areas: [...profile.areas], kit: [...profile.kit], gen: { ...DEFAULT_PROFILE.gen, ...profile.gen } }
    // Only the latest profile matters, so it replaces one that is still waiting.
    this.queue = this.queue.filter(op => op.type !== 'profile')
    this._enqueue({ type: 'profile', profile: clean })
  }

  markDone(sport, w, k, extra = {}) {
    const now = new Date().toISOString()
    this._enqueue({
      type: 'session',
      session: { id: uuid(), sport, kind: 'program', week: w, session_key: k, items: null, completed_at: now, ...extra },
    })
  }

  unmarkDone(sport, w, k) {
    this._enqueue({ type: 'unmark', sport, week: w, key: k })
  }

  // A finished timer run: a program session (week + key) or a custom one.
  logSession({ sport, kind, week, key, items, startedAt, completedAt, durationSeconds }) {
    this._enqueue({
      type: 'session',
      session: {
        id: uuid(), sport, kind,
        ...(kind === 'program' ? { week, session_key: key } : {}),
        items, started_at: startedAt, completed_at: completedAt, duration_seconds: durationSeconds,
      },
    })
  }

  // ── Queue ──────────────────────────────────────────────────────────────────
  _apply(op) {
    if (op.type === 'profile') this.profile = op.profile
    else if (op.type === 'session' && op.session.kind === 'program') {
      const s = op.session
      this.done.set(doneKey(s.sport, s.week, s.session_key), s.completed_at)
    } else if (op.type === 'unmark') this.done.delete(doneKey(op.sport, op.week, op.key))
  }

  _enqueue(op) {
    this._apply(op)
    this.queue.push(op)
    this._writeQueue()
    this.onChange()
    this.flush()
  }

  _readQueue() {
    try { const q = JSON.parse(this.storage?.getItem(this.storageKey) || '[]'); return Array.isArray(q) ? q : [] } catch { return [] }
  }
  _writeQueue() {
    try { this.storage?.setItem(this.storageKey, JSON.stringify(this.queue)) } catch { /* private mode: still sends this visit */ }
  }

  pending() { return this.queue.length }

  async _send(op) {
    if (op.type === 'profile') return this.api.saveTrainingProfile(op.profile)
    if (op.type === 'session') return this.api.saveTrainingSession(op.session)
    return this.api.deleteTrainingProgram(op.sport, op.week, op.key)
  }

  // Sends what is waiting, oldest first. Stops at the first failure worth
  // retrying; drops (and says so) anything the server refuses outright.
  flush() {
    if (this.flushing) return this.flushing
    this.flushing = (async () => {
      let refused = false
      while (this.queue.length) {
        const op = this.queue[0]
        try {
          await this._send(op)
          this.queue.shift()
        } catch (err) {
          if (retryable(err)) {
            this.onWarn('Not saved yet. Your progress is kept on this device and will be sent when you’re back online.')
            this._scheduleRetry()
            this._writeQueue()
            return
          }
          console.error('[training] save refused:', err)
          this.queue.shift()
          refused = true
        }
        this._writeQueue()
      }
      this.onWarn(refused ? 'Some changes couldn’t be saved.' : null)
    })().finally(() => { this.flushing = null })
    return this.flushing
  }

  _scheduleRetry() {
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.flush(), 20000)
  }

  dispose() { clearTimeout(this.retryTimer) }
}
