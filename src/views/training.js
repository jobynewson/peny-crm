// src/views/training.js
// Personal Tools › Training (#training): an 8-week home strength plan, a
// session builder, the exercise library and a guided timer. Each person has
// their own sport, cool-down areas, kit and saved progress, kept on the server
// under their own login (api/training.js).
//
// Content is in src/training/data.js, the maths in src/training/engine.js, the
// timer in src/training/player.js and the saving in src/training/store.js.

import * as api from '../api/training.js'
import { segTabs, bindSegTabs } from './toolbar.js'
import {
  AREAS, CATS, DEFAULT_PROFILE, EQ, EXERCISES, FOCUS, KIT, PHASES, PREFILLS, PROGRAMS,
  SESSION_KEYS, SPORTS, WEEKS, phaseOf, whyFor,
} from '../training/data.js'
import { EX, curWeek, eqLabel, est, generate, grpName, isMain, mins, progSession, rx, swap } from '../training/engine.js'
import { Player, howTo } from '../training/player.js'
import { TrainingStore } from '../training/store.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const sportOf = id => SPORTS.find(s => s.id === id) ?? SPORTS[SPORTS.length - 1]
const REFRESH_MS = 30_000

function chips(name, opts, val) {
  return `<div class="tr-chips">${Object.entries(opts).map(([k, l]) =>
    `<button type="button" class="tr-chip" data-a="${name}" data-v="${esc(k)}" aria-pressed="${String(val) === k}">${esc(l)}</button>`).join('')}</div>`
}

// Chips that can each be on or off (areas, kit).
function toggleChips(name, opts, selected) {
  return `<div class="tr-chips">${Object.entries(opts).map(([k, l]) =>
    `<button type="button" class="tr-chip" data-a="${name}" data-v="${esc(k)}" aria-pressed="${selected.includes(k)}">${esc(l)}</button>`).join('')}</div>`
}

export class TrainingView {
  constructor(app) {
    this.app = app
    this.store = null
    this.loadedAt = 0
    this.error = null
    this.mc = null
    this.tab = 'plan'
    this.week = 1
    this.libCat = 'all'
    this.gen = null
    this.setup = null            // a draft profile while the setup/settings screen is open
    this.player = null
    this.warning = null
  }

  // ── Store ──────────────────────────────────────────────────────────────────
  _ensureStore() {
    if (this.store) return
    this.store = new TrainingStore({
      api,
      userId: this.app.clerkUserId || 'anon',
      onChange: () => {},
      onWarn: msg => { this.warning = msg; this._showWarning() },
    })
    window.addEventListener('online', () => this.store?.flush())
  }

  get profile() { return this.store?.profile }
  get sport() { return this.profile?.sport ?? DEFAULT_PROFILE.sport }

  async render(mc) {
    this.mc = mc
    this._ensureStore()
    if (!this.store.hasProfile() && !this.loadedAt) {
      mc.innerHTML = '<div class="empty-state">Loading…</div>'
    } else {
      this._draw()
    }
    if (Date.now() - this.loadedAt > REFRESH_MS) {
      try {
        await this.store.load()
        this.error = null
        const first = !this.loadedAt
        this.loadedAt = Date.now()
        if (first) this._startState()
      } catch (err) {
        console.error('[training] load failed:', err)
        if (!this.loadedAt) { this.error = err; }
      }
      if (this.mc === mc && !this.player?.open) this._draw()
    }
  }

  _startState() {
    this.week = curWeek(this.store.doneSet(this.sport))
    this.gen = null
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  toolbar() {
    if (!this.store?.hasProfile() || this.setup) return {}
    return {
      tabs: segTabs('Training views', [
        { id: 'plan', label: 'Plan' }, { id: 'build', label: 'Build a session' }, { id: 'library', label: 'Exercises' },
      ], this.tab),
      actions: '<button type="button" class="btn-secondary" id="tr-settings">Settings</button>',
    }
  }

  bindToolbar(bar) {
    bindSegTabs(bar, id => { this.tab = id; this._draw(); window.scrollTo(0, 0); this.app.updateTitle() })
    bar?.querySelector('#tr-settings')?.addEventListener('click', () => this._openSetup())
  }

  // ── Setup / settings ───────────────────────────────────────────────────────
  _openSetup() {
    const email = (this.app.user?.primaryEmailAddress?.emailAddress || this.app.appUser?.email || '').toLowerCase()
    const base = this.profile ?? { ...DEFAULT_PROFILE, ...(PREFILLS[email] ?? {}) }
    this.setup = { sport: base.sport, areas: [...base.areas], kit: [...base.kit], gen: { ...DEFAULT_PROFILE.gen, ...(base.gen ?? {}) }, editing: this.store.hasProfile() }
    this._draw()
    this.app.updateTitle()
  }

  _setupHtml() {
    const s = this.setup
    const sports = Object.fromEntries(SPORTS.map(x => [x.id, x.label]))
    const areas = Object.fromEntries(AREAS.map(x => [x.id, x.label]))
    const kit = Object.fromEntries(KIT.map(x => [x.id, x.label]))
    return `<div class="tr tr-setup">
      <h1 class="tr-h1">${s.editing ? 'Training settings' : 'Set up your training'}</h1>
      <p class="tr-muted">${s.editing ? 'Changing sport starts that sport’s plan fresh. Your history for other sports is kept.' : 'A few quick choices, and you can change them any time from Settings on the Training page.'}</p>
      <div class="tr-field"><span class="tr-lbl">Sport</span>${chips('s-sport', sports, s.sport)}</div>
      <div class="tr-field"><span class="tr-lbl">Areas to loosen in the cool-down</span>${toggleChips('s-area', areas, s.areas)}<p class="tr-muted tr-small">The cool-down has one stretch for each area, about 5 minutes in all. Pick more than fit and they take turns across sessions A, B and C.</p></div>
      <div class="tr-field"><span class="tr-lbl">Kit</span>${toggleChips('s-kit', kit, s.kit)}<p class="tr-muted tr-small">Bodyweight moves are always included.</p></div>
      <div class="tr-row"><button type="button" class="btn-primary tr-save" data-a="s-save">${s.editing ? 'Save settings' : 'Start training'}</button>${s.editing ? '<button type="button" class="btn-secondary" data-a="s-cancel">Cancel</button>' : ''}</div>
    </div>`
  }

  // ── Drawing ────────────────────────────────────────────────────────────────
  _draw() {
    const mc = this.mc
    if (!mc || !mc.isConnected) return
    if (this.error && !this.store.hasProfile()) {
      mc.innerHTML = `<div class="tr"><div class="tr-note" style="--c:var(--cat-red)"><strong>Couldn’t load your training</strong>Check your connection and try again.</div><div class="tr-row"><button type="button" class="btn-primary" data-a="retry">Try again</button></div></div>`
      this._bind(mc.firstElementChild)
      return
    }
    if (!this.store.hasProfile() && !this.setup) { if (this.loadedAt) this._openSetup(); return }
    if (this.setup) {
      mc.innerHTML = this._setupHtml()
      this._bind(mc.firstElementChild)
      return
    }
    if (this.tab === 'build' && !this.gen) this._generate()
    const body = this.tab === 'plan' ? this._planHtml() : this.tab === 'build' ? this._buildHtml() : this._libHtml()
    mc.innerHTML = `<div class="tr"><div class="tr-warn" id="tr-warn" role="status" hidden></div>${body}</div>`
    this._bind(mc.firstElementChild)
    this._showWarning()
  }

  _showWarning() {
    const el = this.mc?.querySelector('#tr-warn')
    if (!el) return
    el.hidden = !this.warning
    el.textContent = this.warning || ''
  }

  _sportLine() {
    const p = this.profile
    const kit = p.kit.length ? p.kit.map(k => KIT.find(x => x.id === k)?.label.toLowerCase()).join(', ') : 'bodyweight only'
    return `${esc(sportOf(p.sport).label)} · ${esc(kit)}`
  }

  _planHtml() {
    const p = this.profile, sport = p.sport, w = this.week, ph = PHASES[phaseOf(w)]
    const done = this.store.doneSet(sport)
    let bars = ''
    for (let i = 1; i <= WEEKS; i++) {
      const pp = PHASES[phaseOf(i)]
      const dots = SESSION_KEYS.map(k => `<i class="${done.has('w' + i + k) ? 'on' : ''}"></i>`).join('')
      bars += `<button type="button" class="tr-wk" style="--h:${100 - (i - 1) * 8.5}%;--c:${pp.c}" aria-pressed="${i === w}" aria-label="Week ${i}, ${pp.name}" data-a="week" data-w="${i}">${i}<span class="tr-dots">${dots}</span></button>`
    }
    const sess = SESSION_KEYS.map(k => {
      const items = progSession(sport, p.areas, p.kit, w, k), isDone = done.has('w' + w + k), n = items.filter(isMain).length
      return `<section class="tr-sess" style="--c:${ph.c}">
        <div class="tr-sess-head"><span class="tr-key">${k}</span><div><h3>${esc(PROGRAMS[sport][k].name)}</h3><p class="tr-meta">About ${mins(items)} min, ${n} exercises plus warm-up${items.some(i => i.cool) ? ' and stretches' : ''}</p></div>${isDone ? '<span class="tr-done-tag">Done</span>' : ''}</div>
        <details><summary>See the exercises</summary>${this._exList(items)}</details>
        <div class="tr-row"><button type="button" class="tr-btn primary" data-a="startProg" data-k="${k}">Start session</button>
        <button type="button" class="tr-btn" data-a="toggleDone" data-k="${k}">${isDone ? 'Mark not done' : 'Mark done'}</button></div></section>`
    }).join('')
    return `<p class="tr-sportline">${this._sportLine()}</p>
      <div class="tr-hero" style="--c:${ph.c}"><h1 class="tr-h1">Week ${w} of ${WEEKS}</h1><span class="tr-grade">${ph.name} phase</span></div>
      <div class="tr-profile">${bars}</div><div class="tr-ground"></div>
      <p class="tr-legend">Weeks are graded like trail centre runs: green builds control, blue builds strength, red builds power. Dots show sessions done.</p>
      <div class="tr-note" style="--c:${ph.c}"><strong>This phase</strong>${esc(ph.note)}</div>
      <div class="tr-sessions">${sess}</div>
      <div class="tr-tips"><p>Three sessions a week with a rest day between. ${esc(sportOf(sport).tip)}</p>
      <p>Dumbbells feeling light? Slow the lowering to 4 seconds, pause at the bottom, or switch to the single-leg or single-arm version.</p></div>`
  }

  _exList(items) {
    let h = '', g = null
    items.forEach(it => {
      const grp = grpName(it)
      if (grp !== g) { g = grp; h += `<li class="tr-grp">${grp}</li>` }
      h += `<li><span>${esc(EX[it.id].name)}</span><span class="tr-rx">${esc(rx(it))}</span></li>`
    })
    return `<ol class="tr-exlist">${h}</ol>`
  }

  _generate() {
    const p = this.profile
    this.gen = generate({ gen: this._gen(), kit: p.kit, areas: p.areas })
  }

  _gen() {
    const g = this.profile.gen ?? {}
    return { dur: g.dur ?? 30, focus: g.focus ?? 'full', phase: g.phase ?? phaseOf(this.week) }
  }

  _buildHtml() {
    const p = this.profile, g = this._gen(), items = this.gen, n = items.filter(isMain).length
    const kit = Object.fromEntries(KIT.map(x => [x.id, x.label]))
    let list = '', grp = null
    items.forEach((it, i) => {
      const gname = grpName(it)
      if (gname !== grp) { grp = gname; list += `<li class="tr-grp">${gname}</li>` }
      list += `<li><div><span>${esc(EX[it.id].name)}</span><button type="button" class="tr-swap" data-a="swap" data-i="${i}" aria-label="Swap ${esc(EX[it.id].name)}">Swap</button></div><span class="tr-rx">${esc(rx(it))}</span></li>`
    })
    return `<p class="tr-sportline">${this._sportLine()}</p>
      <div class="tr-build">
      <div class="tr-controls">
        <div class="tr-field"><label for="tr-dur" class="tr-lbl">Length</label><div class="tr-dur"><output id="tr-dur-out">${g.dur} min</output><input id="tr-dur" type="range" min="15" max="75" step="5" value="${g.dur}"></div>
          ${chips('durq', { 20: '20 min', 30: '30 min', 45: '45 min', 60: '60 min' }, g.dur)}</div>
        <div class="tr-field"><span class="tr-lbl">Focus</span>${chips('focus', FOCUS, g.focus)}</div>
        <div class="tr-field"><span class="tr-lbl">Rep scheme</span>${chips('phase', { 1: 'Foundation', 2: 'Strength', 3: 'Power' }, g.phase)}</div>
        <div class="tr-field"><span class="tr-lbl">Kit you have today</span>${toggleChips('kit', kit, p.kit)}<p class="tr-muted tr-small">Bodyweight moves are always included.</p></div>
      </div>
      <div class="tr-gen"><h2 class="tr-h2">About ${mins(items)} min</h2><p class="tr-muted">${esc(FOCUS[g.focus])}, ${n} exercises plus warm-up${items.some(i => i.cool) ? ' and stretches' : ''}</p>
        ${n ? `<ol class="tr-exlist">${list}</ol>` : '<p>No exercises fit. Add some kit or make the session longer.</p>'}
        <div class="tr-row"><button type="button" class="tr-btn primary" data-a="startGen" ${n ? '' : 'disabled'}>Start session</button><button type="button" class="tr-btn" data-a="shuffle">Shuffle</button></div></div>
      </div>`
  }

  _libHtml() {
    const sport = this.sport
    const list = EXERCISES.filter(e => this.libCat === 'all' || e.cat === this.libCat)
    return `<p class="tr-muted">Why each one matters for ${esc(sportOf(sport).forLabel)}, and how to do it.</p>
      <div class="tr-field">${chips('libcat', { all: 'All', ...CATS }, this.libCat)}</div>
      <div class="tr-lib-grid">${list.map(e => `<details class="tr-lib"><summary><span>${esc(e.name)}</span><span class="tr-tag">${esc(eqLabel(e, EQ))}</span></summary><p class="tr-why">${esc(whyFor(e.id, sport))}</p>${howTo(e)}</details>`).join('')}</div>`
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  _bind(root) {
    root.addEventListener('click', e => this._click(e))
    root.querySelector('#tr-dur')?.addEventListener('input', e => {
      root.querySelector('#tr-dur-out').textContent = e.target.value + ' min'
    })
    root.querySelector('#tr-dur')?.addEventListener('change', e => this._setGen({ dur: +e.target.value }))
  }

  _setGen(patch) {
    const p = this.profile
    this.store.saveProfile({ ...p, gen: { ...this._gen(), ...patch } })
    this._generate()
    this._draw()
  }

  _click(e) {
    const b = e.target.closest('[data-a]')
    if (!b) return
    const a = b.dataset.a, v = b.dataset.v
    const s = this.setup
    switch (a) {
      case 'retry': this.loadedAt = 0; this.error = null; this.render(this.mc); break
      // setup
      case 's-sport': s.sport = v; this._draw(); break
      case 's-area': s.areas = s.areas.includes(v) ? s.areas.filter(x => x !== v) : AREAS.map(x => x.id).filter(id => id === v || s.areas.includes(id)); this._draw(); break
      case 's-kit': s.kit = s.kit.includes(v) ? s.kit.filter(x => x !== v) : KIT.map(x => x.id).filter(id => id === v || s.kit.includes(id)); this._draw(); break
      case 's-cancel': this.setup = null; this._draw(); this.app.updateTitle(); break
      case 's-save': this._saveSetup(); break
      // plan
      case 'week': this.week = +b.dataset.w; this._draw(); break
      case 'toggleDone': {
        const k = b.dataset.k
        if (this.store.isDone(this.sport, this.week, k)) this.store.unmarkDone(this.sport, this.week, k)
        else this.store.markDone(this.sport, this.week, k)
        this._draw(); break
      }
      case 'startProg': this._startProg(b.dataset.k); break
      // build
      case 'durq': this._setGen({ dur: +v }); break
      case 'focus': this._setGen({ focus: v }); break
      case 'phase': this._setGen({ phase: +v }); break
      case 'kit': {
        const p = this.profile
        const kit = p.kit.includes(v) ? p.kit.filter(x => x !== v) : KIT.map(x => x.id).filter(id => id === v || p.kit.includes(id))
        this.store.saveProfile({ ...p, kit })
        this._generate(); this._draw(); break
      }
      case 'shuffle': this._generate(); this._draw(); break
      case 'swap': this.gen = swap(this.gen, +b.dataset.i, { kit: this.profile.kit, phase: this._gen().phase }); this._draw(); break
      case 'startGen': this._startGen(); break
      // library
      case 'libcat': this.libCat = v; this._draw(); break
    }
  }

  _saveSetup() {
    const s = this.setup
    const changedSport = this.profile && this.profile.sport !== s.sport
    this.store.saveProfile({ sport: s.sport, areas: s.areas, kit: s.kit, gen: { ...s.gen, phase: changedSport ? null : s.gen.phase } })
    this.setup = null
    this.week = curWeek(this.store.doneSet(s.sport))
    this.gen = null
    this.tab = 'plan'
    this._draw()
    this.app.updateTitle()
    window.scrollTo(0, 0)
  }

  // ── Player ─────────────────────────────────────────────────────────────────
  _player(sport) {
    this.player?.destroy()
    this.player = new Player({
      sport,
      onDone: summary => this._finished(summary),
      onClose: () => { this.player?.destroy(); this.player = null; this._draw() },
    })
    return this.player
  }

  _startProg(k) {
    const p = this.profile, w = this.week, sport = p.sport
    const items = progSession(sport, p.areas, p.kit, w, k)
    this._running = { kind: 'program', sport, week: w, key: k, items }
    this._player(sport).start({
      items, title: `Week ${w}, ${PROGRAMS[sport][k].name}`, color: PHASES[phaseOf(w)].c,
      doneMsg: `Week ${w}, session ${k} marked done.`,
    })
  }

  _startGen() {
    const p = this.profile, g = this._gen()
    this._running = { kind: 'custom', sport: p.sport, items: this.gen }
    this._player(p.sport).start({ items: this.gen, title: FOCUS[g.focus], color: PHASES[g.phase].c, doneMsg: 'Session saved.' })
  }

  _finished(summary) {
    const r = this._running
    if (!r) return
    this.store.logSession({ ...r, ...summary })
  }
}
