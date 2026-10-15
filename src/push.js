// src/push.js
// This device's side of web push: registers the service worker (public/sw.js),
// asks permission, subscribes, and tells the server (/api/push). The server
// side is api/_push.js; Settings › Notifications drives this.

import { request } from './api/http.js'

const FLAG = 'slate-push-device'   // this browser has push switched on (a convenience only)
const flag = {
  get() { try { return localStorage.getItem(FLAG) === '1' } catch { return false } },
  set(on) { try { on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG) } catch { /* private window */ } },
}

export const getPushStatus = () => request('/api/push/status')
export const sendTestPush = () => request('/api/push/test', { method: 'POST', body: {} })
export const removePushDevice = id => request(`/api/push/devices/${id}`, { method: 'DELETE' }).then(r => r.devices)

// What this browser can do, and what stands in the way, in plain words.
//   { state: 'ready' | 'blocked' | 'unsupported' | 'install', message }
export function pushSupport() {
  const ua = navigator.userAgent || ''
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (ios && !standalone) {
    return { state: 'install', message: 'On an iPhone, add Slate to your Home Screen first: tap Share, then Add to Home Screen, then open Slate from its new icon and come back here.' }
  }
  if (!capable) return { state: 'unsupported', message: 'This browser can’t receive push notifications. On an iPhone it needs iOS 16.4 or later.' }
  if (Notification.permission === 'denied') {
    return { state: 'blocked', message: ios
      ? 'Notifications are blocked for Slate. Open the Settings app, tap Notifications, find Slate and allow them.'
      : 'Notifications are blocked for this site. Allow them in your browser’s site settings, then come back here.' }
  }
  return { state: 'ready', message: '' }
}

const b64ToBytes = s => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function registration() {
  await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}

// Same short hash the server gives each device (endpointHash in _push-routes.js),
// so Settings can say which row is this one.
export async function thisDeviceHash() {
  try {
    if (!('serviceWorker' in navigator)) return null
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return null
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint))
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  } catch { return null }
}

const send = sub => {
  const json = sub.toJSON()
  return request('/api/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } })
}

// Must run from a tap (browsers only show the permission question then).
// Throws an Error with a message fit to show.
export async function enablePush(publicKey) {
  const support = pushSupport()
  if (support.state !== 'ready') throw new Error(support.message)
  if (!publicKey) throw new Error('Push isn’t set up on this Slate yet.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications weren’t allowed, so push is still off.')
  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  if (sub) {
    // A subscription made with a different key (the keys were regenerated)
    // can never receive from this server; start again.
    const current = sub.options?.applicationServerKey
    const wanted = b64ToBytes(publicKey)
    const same = current && current.byteLength === wanted.length && new Uint8Array(current).every((b, i) => b === wanted[i])
    if (!same) { await sub.unsubscribe(); sub = null }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) })
  const { devices } = await send(sub)
  flag.set(true)
  return devices
}

export async function disablePush() {
  flag.set(false)
  const reg = await navigator.serviceWorker?.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  await request('/api/push/unsubscribe', { method: 'POST', body: { endpoint } })
}

// On every start: if this device had push on, make sure the server still has
// it (a browser can swap its subscription, and someone else may have signed in
// on a shared phone). Quiet; never asks for anything.
export async function syncPushDevice() {
  try {
    if (!flag.get() || pushSupport().state !== 'ready' || Notification.permission !== 'granted') return
    const reg = await registration()
    const sub = await reg.pushManager.getSubscription()
    if (sub) await send(sub)
  } catch (err) { console.warn('[push] sync failed:', err.message) }
}
