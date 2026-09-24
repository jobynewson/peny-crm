// src/realtime/transport.js
// The one place that talks to Ably. Everything else uses the small room API in
// ./realtime.js, so the transport can be swapped (the browser test harness
// replaces this file with a BroadcastChannel stand-in).

/**
 * @typedef {{ clientId: string, connectionId: string }} Meta
 * @typedef {{
 *   subscribe(fn: (name: string, data: any, meta: Meta) => void): void,
 *   publish(name: string, data: any): Promise<void>,
 *   enter(data: any): Promise<void>,
 *   update(data: any): Promise<void>,
 *   leave(): Promise<void>,
 *   members(): Promise<Array<Meta & { data: any }>>,
 *   onPresence(fn: (action: string, member: Meta & { data: any }) => void): void,
 *   close(): void,
 * }} TransportChannel
 * @typedef {{
 *   readonly connectionId: string | undefined,
 *   readonly clientId: string | undefined,
 *   onState(fn: (current: string, previous: string) => void): void,
 *   channel(name: string): TransportChannel,
 * }} Transport
 */

/** @param {() => Promise<any>} fetchTokenRequest @returns {Promise<Transport>} */
export async function createTransport(fetchTokenRequest) {
  const mod = /** @type {any} */ (await import('ably'))
  const Ably = mod.Realtime ? mod : mod.default
  const client = new Ably.Realtime({
    authCallback: (/** @type {any} */ _params, /** @type {any} */ cb) => {
      fetchTokenRequest().then(t => cb(null, t), e => cb(e, null))
    },
    echoMessages: false,        // never receive our own publishes back
    closeOnUnload: true,
  })
  return {
    get connectionId() { return client.connection.id },
    get clientId() { return client.auth.clientId },
    onState(fn) { client.connection.on((/** @type {any} */ c) => fn(c.current, c.previous)) },
    channel(name) {
      const ch = client.channels.get(name)
      /** @param {any} m */
      const meta = m => ({ clientId: m.clientId, connectionId: m.connectionId, data: m.data })
      return {
        subscribe: fn => { ch.subscribe((/** @type {any} */ m) => fn(m.name, m.data, meta(m))) },
        publish: (n, d) => ch.publish(n, d),
        enter: d => ch.presence.enter(d),
        update: d => ch.presence.update(d),
        leave: () => ch.presence.leave(),
        members: async () => (await ch.presence.get()).map(meta),
        onPresence: fn => { ch.presence.subscribe((/** @type {any} */ ev) => fn(ev.action, meta(ev))) },
        close: () => {
          ch.presence.leave().catch(() => {})
          ch.unsubscribe()
          ch.presence.unsubscribe()
          ch.detach().catch(() => {})
        },
      }
    },
  }
}
