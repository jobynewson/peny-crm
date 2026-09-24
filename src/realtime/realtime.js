// @ts-check
// src/realtime/realtime.js
// Live collaboration plumbing: one shared connection per browser tab, and
// "rooms" (a canvas, a board, a project's tab strip) that carry
//   • messages — change notifications and ephemeral things like cursors
//   • presence — who is here and what they're doing
// Realtime is an enhancement, never a dependency: when ABLY_API_KEY isn't set
// (/api/realtime answers 503), when the network drops, or before the socket
// is up, rooms quietly do nothing and the views keep polling as before.

import { createTransport } from './transport.js'

/** @typedef {import('./transport.js').Transport} Transport */
/** @typedef {import('./transport.js').TransportChannel} TransportChannel */
/** @typedef {{ clientId: string, connectionId: string, data: any }} Member */
/** @typedef {import('./transport.js').Meta} Meta */

/** @type {Promise<Transport | null> | null} */ let transportPromise = null
let disabled = false

/** @param {any} app */
async function fetchTokenRequest(app) {
  const { getAuthToken } = await import('../auth/clerk.js')
  const token = await getAuthToken()
  const res = await fetch('/api/realtime', { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 503 || res.status === 404) { disabled = true; throw new Error('Realtime not configured') }
  if (!res.ok) throw new Error(`Realtime token failed (${res.status})`)
  return res.json()
}

/** @param {any} app @returns {Promise<Transport | null>} */
function getTransport(app) {
  if (disabled) return Promise.resolve(null)
  if (!transportPromise) {
    transportPromise = (async () => {
      // Probe once up front so a deployment without Ably costs one request,
      // not a reconnect loop.
      try { await fetchTokenRequest(app) } catch (e) {
        if (!disabled) console.warn('Realtime unavailable:', e)
        disabled = true
        return null
      }
      try { return await createTransport(() => fetchTokenRequest(app)) } catch (e) {
        console.warn('Realtime unavailable:', e)
        disabled = true
        return null
      }
    })()
  }
  return transportPromise
}

export class Room {
  /** @param {any} app @param {string} name e.g. 'canvas:<id>' */
  constructor(app, name) {
    this.app = app
    this.name = name
    this.live = false
    /** @type {Map<string, Set<(data: any, meta: Meta) => void>>} */ this._handlers = new Map()
    /** @type {Map<string, Member>} */ this._members = new Map()
    /** @type {Set<(members: Member[]) => void>} */ this._peerFns = new Set()
    /** @type {Set<() => void>} */ this._resyncFns = new Set()
    /** @type {Set<(live: boolean) => void>} */ this._liveFns = new Set()
    /** @type {any} */ this._presence = undefined
    this._entered = false
    this._closed = false
    /** @type {TransportChannel | null} */ this._ch = null
    /** @type {Transport | null} */ this._t = null
    this._open()
  }

  get selfConnectionId() { return this._t?.connectionId }
  get selfClientId() { return this._t?.clientId ?? this.app.clerkUserId }

  async _open() {
    const t = await getTransport(this.app)
    if (!t || this._closed) return
    this._t = t
    const ch = t.channel(`slate:${this.app.userId}:${this.name}`)
    this._ch = ch
    ch.subscribe((name, data, meta) => {
      if (meta.connectionId && meta.connectionId === t.connectionId) return
      this._handlers.get(name)?.forEach(fn => { try { fn(data, meta) } catch (e) { console.error(e) } })
    })
    ch.onPresence((action, m) => {
      if (action === 'leave' || action === 'absent') this._members.delete(m.connectionId)
      else this._members.set(m.connectionId, m)
      this._emitPeers()
    })
    let wasDown = false
    t.onState(current => {
      const live = current === 'connected'
      if (live !== this.live) { this.live = live; this._liveFns.forEach(fn => fn(live)) }
      if (!live && current !== 'connecting') wasDown = true
      if (live && wasDown) {
        wasDown = false
        // Anything published while we were away is gone: views re-read, and
        // presence is re-established.
        this._resyncFns.forEach(fn => fn())
        this._refreshMembers()
        if (this._presence !== undefined) { this._entered = false; this.setPresence(this._presence) }
      }
    })
    this.live = true
    this._liveFns.forEach(fn => fn(true))
    this._refreshMembers()
    if (this._presence !== undefined) this.setPresence(this._presence)
  }

  async _refreshMembers() {
    if (!this._ch) return
    try {
      const list = await this._ch.members()
      this._members = new Map(list.map(m => [m.connectionId, m]))
      this._emitPeers()
    } catch (e) { console.warn('presence.get failed', e) }
  }

  _emitPeers() {
    const self = this.selfConnectionId
    const list = [...this._members.values()].filter(m => m.connectionId !== self)
    this._peerFns.forEach(fn => fn(list))
  }

  /** @param {string} type @param {(data: any, meta: Meta) => void} fn */
  on(type, fn) {
    let set = this._handlers.get(type)
    if (!set) { set = new Set(); this._handlers.set(type, set) }
    set.add(fn)
    return () => set?.delete(fn)
  }

  /** Fire-and-forget; dropped when not connected (polling covers it). @param {string} type @param {any} data */
  send(type, data) {
    if (!this._ch || this._closed || !this.live) return
    this._ch.publish(type, data).catch(e => console.warn('realtime publish failed', e))
  }

  /** @param {any} data */
  setPresence(data) {
    this._presence = data
    if (!this._ch || this._closed) return
    const p = this._entered ? this._ch.update(data) : this._ch.enter(data)
    this._entered = true
    p.catch(e => { this._entered = false; console.warn('presence failed', e) })
  }

  /** Other connections in this room (not this tab). @param {(members: Member[]) => void} fn */
  onPeers(fn) { this._peerFns.add(fn); return () => this._peerFns.delete(fn) }
  /** Called after reconnecting from a gap — re-read state. @param {() => void} fn */
  onResync(fn) { this._resyncFns.add(fn); return () => this._resyncFns.delete(fn) }
  /** @param {(live: boolean) => void} fn */
  onLive(fn) { this._liveFns.add(fn); return () => this._liveFns.delete(fn) }

  close() {
    if (this._closed) return
    this._closed = true
    this._ch?.close()
    this._handlers.clear(); this._peerFns.clear(); this._resyncFns.clear(); this._liveFns.clear()
  }
}

/** @param {any} app @param {string} name */
export function joinRoom(app, name) { return new Room(app, name) }
