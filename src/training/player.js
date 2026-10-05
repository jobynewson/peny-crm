// src/training/player.js
// The guided timer: warm-up, sets, rests and the cool-down, full screen. A
// port of the original app's player, with the screen kept awake by wakelock.js.
// Rest lengths, side handling, beeps and countdowns are as they were.

import { DETAILS, whyFor } from './data.js'
import { EX, isMain, makeSteps } from './engine.js'
import { createAwake } from './wakelock.js'

const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function howTo(ex) {
  const d = DETAILS[ex.id]
  if (!d) return ''
  return `<div class="tr-howto"><h4>Setup</h4><p>${esc(d.setup)}</p><h4>How to do it</h4><ol>${d.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol><h4>What you should feel</h4><p>${esc(d.feel)}</p></div>`
}

export class Player {
  // onDone({ startedAt, completedAt, durationSeconds }) runs once, when the last step finishes.
  constructor({ sport, onDone, onClose }) {
    this.sport = sport
    this.onDone = onDone
    this.onClose = onClose
    this.awake = createAwake()
    this.actx = null
    this.timer = null
    this.P = null
    this.el = document.createElement('div')
    this.el.className = 'tr-player'
    this.el.hidden = true
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-modal', 'true')
    this.el.setAttribute('aria-label', 'Training session')
    this.el.addEventListener('click', e => this._click(e))
    document.body.appendChild(this.el)
  }

  get open() { return !!this.P }

  start({ items, title, color, doneMsg = '' }) {
    try { this.actx = this.actx || new (window.AudioContext || window.webkitAudioContext)(); this.actx.resume() } catch { /* no sound */ }
    this.P = { items, title, color, doneMsg, steps: makeSteps(items), i: 0, sound: true, t0: Date.now(), closeArm: false }
    this.el.hidden = false
    document.body.style.overflow = 'hidden'
    this._enter()
    clearInterval(this.timer)
    this.timer = setInterval(() => this._tick(), 200)
    this.awake.on()
  }

  destroy() {
    clearInterval(this.timer)
    this.awake.off()
    this.P = null
    document.body.style.overflow = ''
    this.el.remove()
  }

  _beep(f, d) {
    const P = this.P, actx = this.actx
    if (!actx || !P || !P.sound) return
    try {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime
      o.frequency.value = f
      o.connect(g); g.connect(actx.destination)
      g.gain.setValueAtTime(.0001, t)
      g.gain.exponentialRampToValueAtTime(.35, t + .01)
      g.gain.exponentialRampToValueAtTime(.0001, t + d)
      o.start(t); o.stop(t + d + .02)
    } catch { /* ignore */ }
  }

  _stepDur(st) { return st.k === 'work' ? this.P.items[st.xi].time || 0 : st.dur }

  _enter() {
    const P = this.P, st = P.steps[P.i], d = this._stepDur(st)
    P.paused = false; P.rem = d; P.endAt = Date.now() + d * 1000; P.last = Math.ceil(d)
    if (st.k === 'work') this._beep(880, .15)
    if (st.sw) { this._beep(1200, .12); setTimeout(() => this._beep(1200, .12), 220) }
    this._draw()
  }

  _tick() {
    const P = this.P
    if (!P || P.fin || P.paused) return
    const st = P.steps[P.i]
    if (!this._stepDur(st)) return
    const rem = (P.endAt - Date.now()) / 1000, w = Math.ceil(rem)
    if (w !== P.last) {
      P.last = w
      if (w <= 3 && w > 0) this._beep(660, .1)
      const el = this.el.querySelector('#tr-time')
      if (el) el.textContent = fmt(rem)
    }
    if (rem <= 0) { this._beep(990, .35); this._next() }
  }

  _next() { const P = this.P; P.i++; if (P.i >= P.steps.length) this._finish(); else this._enter() }
  _prev() {
    const P = this.P
    let i = P.i - 1
    while (i > 0 && P.steps[i].k === 'rest') i--
    P.i = Math.max(0, i)
    this._enter()
  }

  _finish() {
    const P = this.P
    P.fin = true
    clearInterval(this.timer)
    this.awake.off()
    const completedAt = new Date()
    this.onDone?.({
      startedAt: new Date(P.t0).toISOString(),
      completedAt: completedAt.toISOString(),
      durationSeconds: Math.round((completedAt.getTime() - P.t0) / 1000),
    })
    this._draw()
  }

  _close() {
    clearInterval(this.timer)
    this.awake.off()
    this.P = null
    this.el.hidden = true
    document.body.style.overflow = ''
    this.onClose?.()
  }

  _click(e) {
    const P = this.P
    if (!P) return
    const b = e.target.closest('[data-a]')
    if (!b) return
    const a = b.dataset.a
    if (a !== 'pclose' && P.closeArm) P.closeArm = false
    switch (a) {
      case 'pnext': this._next(); break
      case 'pprev': this._prev(); break
      case 'ppause':
        if (P.paused) { P.endAt = Date.now() + P.rem * 1000; P.paused = false } else { P.rem = (P.endAt - Date.now()) / 1000; P.paused = true }
        this._draw(); break
      case 'padd':
        if (P.paused) P.rem += 15; else { P.endAt += 15000; P.rem = (P.endAt - Date.now()) / 1000 }
        P.last = null; this._draw(); break
      case 'psound': P.sound = !P.sound; this._draw(); break
      case 'pclose': if (P.closeArm) this._close(); else { P.closeArm = true; this._draw() } break
      case 'close': this._close(); break
    }
  }

  _draw() {
    const P = this.P, el = this.el
    el.style.setProperty('--c', P.color || 'var(--cat-green)')
    if (P.fin) {
      el.className = 'tr-player rest'
      el.innerHTML = `<div class="tr-pl-top"><span>${esc(P.title)}</span></div><div class="tr-pl-body"><p class="tr-pl-kind">Finished</p><h2 class="tr-pl-name">Session done</h2><div class="tr-pl-big">${Math.round((Date.now() - P.t0) / 60000)}<span class="tr-pl-sub"> min</span></div>${P.doneMsg ? `<p class="tr-pl-sub" style="margin-top:14px">${esc(P.doneMsg)}</p>` : ''}</div><div class="tr-pl-ctrl"><button class="tr-btn primary" data-a="close">Back to the app</button></div>`
      return
    }
    const st = P.steps[P.i], workSteps = P.steps.filter(s => s.k === 'work')
    const doneWork = P.steps.slice(0, P.i).filter(s => s.k === 'work').length
    const exNo = (st.xi ?? P.steps[P.i + 1]?.xi ?? 0) + 1
    let kind, name, big, sub = '', extra = '', sideHtml = ''
    const timed = this._stepDur(st) > 0
    const sides = (on, note) => `<div class="tr-sides"><span class="${on.includes('L') ? 'on' : ''}">Left</span><span class="${on.includes('R') ? 'on' : ''}">Right</span></div>${note ? `<p class="tr-sides-note">${note}</p>` : ''}`
    const preview = (nit, open) => {
      const ex = EX[nit.id]
      const body = `<p class="tr-pl-why">${esc(whyFor(ex.id, this.sport))}</p>${howTo(ex)}`
      return open ? `<div class="tr-pl-next"><h3>${esc(ex.name)}</h3>${body}</div>` : `<details class="tr-pl-more"><summary>How to do ${esc(ex.name)}</summary>${body}</details>`
    }

    if (st.k === 'ready') {
      kind = 'Get ready'; name = EX[P.items[0].id].name
      big = `<span id="tr-time">${fmt(P.rem)}</span>`; sub = 'First up'; extra = preview(P.items[0], true)
    } else if (st.k === 'rest') {
      const nx = P.steps[P.i + 1], nit = P.items[nx.xi]
      const toCool = nit.cool && !st.sw
      kind = st.sw ? EX[nit.id].name : toCool ? 'Cool-down' : 'Rest'
      name = st.sw ? 'Switch to right side' : toCool ? 'Next stretch' : 'Rest'
      if (st.sw) sideHtml = sides('R', 'Get set on the right side')
      big = `<span id="tr-time">${fmt(P.rem)}</span>`
      sub = `Up next: ${EX[nit.id].name}${!isMain(nit) ? '' : `, set ${nx.s} of ${nit.sets}`}${nx.side ? `, ${nx.side.toLowerCase()} side` : ''}`
      const prevWork = P.steps.slice(0, P.i).reverse().find(x => x.k === 'work')
      if (!st.sw) extra = preview(nit, !prevWork || prevWork.xi !== nx.xi)
    } else {
      const it = P.items[st.xi], ex = EX[it.id]
      kind = it.warm ? 'Warm-up' : it.cool ? 'Cool-down stretch' : `Set ${st.s} of ${it.sets}`
      name = ex.name
      if (ex.uni) sideHtml = st.side === 'Left' ? sides('L', 'Left side first, then the timer switches you to the right') : st.side === 'Right' ? sides('R', 'Right side, last half of this set') : sides('LR', `Both sides: ${it.reps} on the left, then ${it.reps} on the right`)
      big = it.time ? `<span id="tr-time">${fmt(P.rem)}</span>` : it.reps
      sub = it.time ? '' : `reps${ex.uni ? ' each side' : ''}`
      extra = `<ul class="tr-pl-cues">${ex.cues.map(c => `<li>${esc(c)}</li>`).join('')}</ul><details class="tr-pl-more"><summary>Full how-to</summary><p class="tr-pl-why">${esc(whyFor(ex.id, this.sport))}${it.cool ? ' Hold gently and breathe; mild tension, never pain.' : ''}</p>${howTo(ex)}</details>`
    }
    el.className = st.k === 'work' ? 'tr-player' : 'tr-player rest'
    const ctrls = [`<button class="tr-btn" data-a="pprev" ${P.i === 0 ? 'disabled' : ''}>Back</button>`]
    if (timed) ctrls.push(`<button class="tr-btn" data-a="ppause">${P.paused ? 'Resume' : 'Pause'}</button>`)
    if (st.k === 'rest' && !st.sw) ctrls.push('<button class="tr-btn" data-a="padd">+15 s</button>')
    ctrls.push(`<button class="tr-btn primary" data-a="pnext">${st.k === 'work' && !P.items[st.xi].time ? 'Done' : 'Skip'}</button>`)
    el.innerHTML = `<div class="tr-pl-top"><button data-a="pclose">${P.closeArm ? 'Tap again to leave' : 'Close'}</button><span>Exercise ${exNo} of ${P.items.length}</span><button data-a="psound">${P.sound ? 'Sound on' : 'Sound off'}</button></div>
      <div class="tr-pl-bar"><i style="width:${doneWork / workSteps.length * 100}%"></i></div>
      <div class="tr-pl-body"><p class="tr-pl-kind">${kind}</p><h2 class="tr-pl-name">${esc(name)}</h2>${sideHtml}<div class="tr-pl-big">${big}</div>${sub ? `<p class="tr-pl-sub">${esc(sub)}</p>` : ''}${extra}</div>
      <div class="tr-pl-ctrl">${ctrls.join('')}</div>`
  }
}
