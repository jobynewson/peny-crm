// Logging hours against a project, used by the header's Log time popover and
// the log form on a project's Time tab. Same fields, rules and save as the
// old sidebar widget: Project, Role (a budget line ticked ⏱, or a retainer
// item — stored as time_entries.line_label), Date, Hours and Notes, saved
// with addTimeEntry(). The last project and role are remembered per browser.

const LS_PROJECT = 'tt-project-id'
const LS_ROLE    = 'tt-task-label'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const today = () => new Date().toISOString().slice(0, 10)
const read = key => { try { return localStorage.getItem(key) || '' } catch { return '' } }
const write = (key, value) => { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key) } catch {} }

// The lines a project's time can be logged against.
export function trackableLines(app, project) {
  if (!project) return []
  const lines = []
  if (project.is_retainer && (project.retainer_items || []).length) {
    for (const item of project.retainer_items) {
      if (item.label) lines.push({ label: item.label, budgetId: null })
    }
  } else {
    for (const bid of (project.budget_ids || [])) {
      const b = app.budgets.find(x => x.id === bid)
      if (!b) continue
      for (const s of (b.sections || [])) {
        if (!s.enabled) continue
        for (const l of (s.lines || [])) {
          if (!l.track_time || !l.item) continue
          lines.push({ label: l.item, budgetId: b.id })
        }
      }
    }
  }
  return lines
}

function roleOptions(project, lines, selected) {
  if (!project) return '<option value="">Choose a project first</option>'
  if (!lines.length) return '<option value="">No tracked lines</option>'
  return lines.map(l => `<option value="${esc(l.label)}"${l.label === selected ? ' selected' : ''}>${esc(l.label)}</option>`).join('')
}

const NO_LINES_HINT = 'Tick ⏱ on a daily-rate line in a linked budget to log time against it.'

/**
 * @param {object} app
 * @param {{ idPrefix: string, projectId?: string|null, fixedProject?: boolean }} opts
 *   projectId pre-selects a project (the one you're looking at); with
 *   fixedProject the form logs against it without showing a picker.
 */
export function timeLogFormHtml(app, { idPrefix, projectId = null, fixedProject = false }) {
  const open = (app.projects || []).filter(p => p.status !== 'Delivered')
  const current = projectId ? (app.projects || []).find(p => p.id === projectId) : null
  // The project you're on is always offered, even once it's delivered.
  const projects = current && !open.includes(current) ? [current, ...open] : open
  const pid = current?.id ?? read(LS_PROJECT)
  const project = projects.find(p => p.id === pid) || null
  const lines = trackableLines(app, project)
  const saved = read(LS_ROLE)
  const role = lines.some(l => l.label === saved) ? saved : lines[0]?.label
  // Land on the first thing still to fill in.
  const focus = !project ? 'project' : 'hours'
  const af = name => (name === focus ? ' data-autofocus' : '')
  const id = name => `${idPrefix}-${name}`

  return `
    <form class="tl-form" id="${id('form')}" novalidate>
      ${fixedProject
        ? `<input type="hidden" id="${id('project')}" value="${esc(project?.id || '')}">`
        : `<div class="tl-field">
            <label for="${id('project')}">Project</label>
            <select id="${id('project')}"${af('project')}>
              <option value="">Choose a project…</option>
              ${projects.map(p => `<option value="${p.id}"${p.id === project?.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </div>`}
      <div class="tl-field">
        <label for="${id('role')}">Role</label>
        <select id="${id('role')}"${!lines.length ? ' disabled' : ''} aria-describedby="${id('role-hint')}">${roleOptions(project, lines, role)}</select>
        <p class="tl-hint" id="${id('role-hint')}"${project && !lines.length ? '' : ' hidden'}>${NO_LINES_HINT}</p>
      </div>
      <div class="tl-row">
        <div class="tl-field">
          <label for="${id('date')}">Date</label>
          <input type="date" id="${id('date')}" value="${today()}" max="${today()}">
        </div>
        <div class="tl-field">
          <label for="${id('hours')}">Hours</label>
          <input type="number" id="${id('hours')}" min="0.5" max="24" step="0.5" inputmode="decimal" placeholder="e.g. 2"${af('hours')}>
        </div>
      </div>
      <div class="tl-field">
        <label for="${id('note')}">Notes <span class="tl-optional">(optional)</span></label>
        <input type="text" id="${id('note')}" maxlength="300" placeholder="What did you work on?">
      </div>
      <button type="submit" class="btn-primary tl-submit">Log time</button>
      <p class="tl-msg" id="${id('msg')}" role="status" aria-live="polite"></p>
    </form>`
}

/**
 * @param {object} app
 * @param {HTMLElement} root
 * @param {{ idPrefix: string, onLogged?: (entry: { projectId: string, hours: number }) => void }} opts
 */
export function bindTimeLogForm(app, root, { idPrefix, onLogged }) {
  const $ = name => root.querySelector(`#${idPrefix}-${name}`)
  const form = $('form')
  if (!form) return
  const projectEl = $('project'), roleEl = $('role'), hint = $('role-hint'), msg = $('msg')
  const findProject = pid => (app.projects || []).find(p => p.id === pid) || null

  const say = (text, tone) => {
    msg.textContent = text
    msg.dataset.tone = tone || ''
  }

  const refreshRoles = () => {
    const project = findProject(projectEl.value)
    const lines = trackableLines(app, project)
    const saved = read(LS_ROLE)
    roleEl.innerHTML = roleOptions(project, lines, lines.some(l => l.label === saved) ? saved : lines[0]?.label)
    roleEl.disabled = !lines.length
    hint.hidden = !(project && !lines.length)
  }

  if (projectEl.tagName === 'SELECT') {
    projectEl.addEventListener('change', () => {
      write(LS_PROJECT, projectEl.value)
      if (!projectEl.value) write(LS_ROLE, '')
      refreshRoles()
      say('')
    })
  }
  roleEl.addEventListener('change', () => write(LS_ROLE, roleEl.value))

  form.addEventListener('submit', async e => {
    e.preventDefault()
    const pid   = projectEl.value
    const role  = roleEl.value
    const hours = parseFloat($('hours').value)
    const date  = $('date').value || today()
    const note  = $('note').value.trim() || null
    if (!pid)  { say('Choose a project', 'error'); projectEl.focus(); return }
    if (!role) { say(roleEl.disabled ? NO_LINES_HINT : 'Choose a role', 'error'); roleEl.focus(); return }
    if (!hours || hours <= 0 || hours > 24) { say('Enter hours between 0.5 and 24', 'error'); $('hours').focus(); return }

    const project  = findProject(pid)
    const budgetId = trackableLines(app, project).find(l => l.label === role)?.budgetId ?? null
    const name     = app.appUser?.name || app.user?.primaryEmailAddress?.emailAddress || 'Unknown'
    say('')
    try {
      await app.withBusy(form.querySelector('.tl-submit'), async () => {
        const { addTimeEntry } = await import('../db/client.js')
        await addTimeEntry({ project_id: pid, budget_id: budgetId, line_label: role, crew_name: name, hours, entry_date: date, note })
      }, 'Logging…')
    } catch (err) {
      console.error(err)
      say('Couldn’t log that — please try again', 'error')
      return
    }
    $('hours').value = ''
    $('note').value = ''
    app.toast(`${hours}h logged`)
    app.refreshTimeViews(pid)
    onLogged?.({ projectId: pid, hours })
  })
}
