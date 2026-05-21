// Time Tracker — sidebar quick-log panel

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const today = () => new Date().toISOString().slice(0, 10)

const LS_PROJECT = 'tt-project-id'
const LS_TASK    = 'tt-task-label'

export class TimeTrackView {
  constructor(app) {
    this.app = app
  }

  // Extract trackable lines for a given project (same logic as projects.js _loadTimePanel)
  _trackableLines(project) {
    if (!project) return []
    const lines = []
    if (project.is_retainer && (project.retainer_items || []).length) {
      for (const item of project.retainer_items) {
        if (item.label) lines.push({ label: item.label, budgetId: null })
      }
    } else {
      const budgetIds = Array.isArray(project.budget_ids) ? project.budget_ids : []
      for (const bid of budgetIds) {
        const b = this.app.budgets.find(x => x.id === bid)
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

  render(mc) {
    const projects = this.app.projects || []

    const savedProjectId = localStorage.getItem(LS_PROJECT) || ''
    const savedTask      = localStorage.getItem(LS_TASK) || ''

    const selectedProject = projects.find(p => p.id === savedProjectId) || null
    const trackableLines  = this._trackableLines(selectedProject)

    const loggedInName = this.app.appUser?.name
      || this.app.user?.primaryEmailAddress?.emailAddress
      || 'Unknown'

    mc.innerHTML = `
      <div style="max-width:520px">

        <!-- Log form -->
        <div style="background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:20px;box-shadow:0 1px 3px rgba(9,30,66,0.06);margin-bottom:24px">
          <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">Logging as <strong style="color:var(--text-secondary)">${esc(loggedInName)}</strong></div>

          <!-- Project -->
          <div style="margin-bottom:12px">
            <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Project</label>
            <select id="tt-project"
              style="width:100%;padding:8px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;cursor:pointer">
              <option value="">— Select project —</option>
              ${projects.map(p => `<option value="${p.id}"${p.id === savedProjectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </div>

          <!-- Task -->
          <div style="margin-bottom:12px">
            <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Task</label>
            <select id="tt-task"
              style="width:100%;padding:8px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;cursor:pointer"
              ${!selectedProject ? 'disabled' : ''}>
              ${!selectedProject
                ? '<option value="">Select a project first</option>'
                : trackableLines.length
                  ? trackableLines.map(l => `<option value="${esc(l.label)}"${l.label === savedTask ? ' selected' : ''}>${esc(l.label)}</option>`).join('')
                  : '<option value="">No trackable lines on this project</option>'
              }
            </select>
            ${selectedProject && !trackableLines.length
              ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Tick ⏱ on a daily-rate line in a linked budget to add tasks.</div>`
              : ''}
          </div>

          <!-- Hours + Date row -->
          <div style="display:flex;gap:12px;margin-bottom:12px">
            <div style="flex:1">
              <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Hours</label>
              <input id="tt-hours" type="number" min="0.5" max="24" step="0.5" placeholder="e.g. 2"
                style="width:100%;padding:8px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;box-sizing:border-box">
            </div>
            <div style="flex:1">
              <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Date</label>
              <input id="tt-date" type="date" value="${today()}"
                style="width:100%;padding:8px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;box-sizing:border-box">
            </div>
          </div>

          <!-- Note -->
          <div style="margin-bottom:16px">
            <label style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Note <span style="text-transform:none;letter-spacing:0;font-size:10px">(optional)</span></label>
            <input id="tt-note" type="text" placeholder="What did you work on?" maxlength="300"
              style="width:100%;padding:8px 10px;font-size:13px;border:1px solid var(--border-med);border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-family:var(--font);outline:none;box-sizing:border-box">
          </div>

          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn-primary" id="tt-submit" style="padding:8px 20px">Log hours</button>
            <div id="tt-msg" style="font-size:12px;display:none"></div>
          </div>
        </div>

        <!-- Hours log for selected project -->
        <div id="tt-log">
          ${selectedProject
            ? `<div style="font-size:11px;color:var(--text-tertiary);padding:8px 0">Loading entries…</div>`
            : `<div style="font-size:13px;color:var(--text-tertiary);padding:4px 0">Select a project to see the log.</div>`
          }
        </div>

      </div>`

    this._bindForm(mc, selectedProject, trackableLines, loggedInName)
    if (selectedProject) this._loadLog(mc, selectedProject)
  }

  _bindForm(mc, selectedProject, trackableLines, loggedInName) {
    const projectSel = mc.querySelector('#tt-project')
    const taskSel    = mc.querySelector('#tt-task')

    // Project change → persist, re-render
    projectSel?.addEventListener('change', () => {
      localStorage.setItem(LS_PROJECT, projectSel.value)
      if (!projectSel.value) localStorage.removeItem(LS_TASK)
      this.render(mc)
    })

    // Task change → persist
    taskSel?.addEventListener('change', () => {
      localStorage.setItem(LS_TASK, taskSel.value)
    })

    // Submit
    mc.querySelector('#tt-submit')?.addEventListener('click', async () => {
      const projectId = mc.querySelector('#tt-project')?.value
      const task      = mc.querySelector('#tt-task')?.value
      const hours     = parseFloat(mc.querySelector('#tt-hours')?.value)
      const date      = mc.querySelector('#tt-date')?.value || today()
      const note      = mc.querySelector('#tt-note')?.value?.trim() || null
      const msgEl     = mc.querySelector('#tt-msg')

      const show = (text, color) => {
        if (!msgEl) return
        msgEl.style.display = 'block'
        msgEl.style.color = color
        msgEl.textContent = text
        setTimeout(() => { if (msgEl) msgEl.style.display = 'none' }, 3000)
      }

      if (!projectId)     return show('Please select a project.', 'var(--text-tertiary)')
      if (!task)          return show('Please select a task.', 'var(--text-tertiary)')
      if (!hours || hours <= 0 || hours > 24) return show('Enter hours between 0.5 and 24.', 'var(--text-tertiary)')

      const project = this.app.projects.find(p => p.id === projectId)
      const budgetId = project ? this._trackableLines(project).find(l => l.label === task)?.budgetId ?? null : null

      const submitBtn = mc.querySelector('#tt-submit')
      if (submitBtn) submitBtn.disabled = true

      try {
        const { addTimeEntry } = await import('../db/client.js')
        await addTimeEntry({
          project_id:  projectId,
          budget_id:   budgetId,
          line_label:  task,
          crew_name:   loggedInName,
          hours,
          entry_date:  date,
          note,
        })
        mc.querySelector('#tt-hours').value = ''
        mc.querySelector('#tt-note').value  = ''
        show('Logged ✓', '#22a06b')
        this.app.toast('Hours logged')
        if (project) this._loadLog(mc, project)
      } catch (e) {
        console.error(e)
        show('Error logging hours.', '#ef4444')
      } finally {
        if (submitBtn) submitBtn.disabled = false
      }
    })

    // Enter on note → submit
    mc.querySelector('#tt-note')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); mc.querySelector('#tt-submit')?.click() }
    })
  }

  async _loadLog(mc, project) {
    const logEl = mc.querySelector('#tt-log')
    if (!logEl) return

    try {
      const { getTimeEntries, deleteTimeEntry } = await import('../db/client.js')
      const entries = await getTimeEntries(project.id)

      if (!entries.length) {
        logEl.innerHTML = `<div style="font-size:13px;color:var(--text-tertiary);padding:4px 0">No entries yet for ${esc(project.name)}.</div>`
        return
      }

      const totalHours = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0)

      logEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">${esc(project.name)}</div>
          <div style="font-size:12px;color:var(--text-tertiary)">${totalHours.toFixed(1)}h total</div>
        </div>
        <div style="background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-lg);overflow:hidden;box-shadow:0 1px 3px rgba(9,30,66,0.06)">
          ${entries.map(e => `
          <div class="tt-entry-row" data-eid="${e.id}" style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border-light)">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
                <span style="font-size:13px;font-weight:500;color:var(--text-primary)">${esc(e.line_label)}</span>
                <span style="font-size:11px;color:var(--text-tertiary)">${fmtDate(e.entry_date)}</span>
              </div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px">
                ${esc(e.crew_name)}${e.note ? ` · ${esc(e.note)}` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
              <span style="font-size:13px;font-weight:600;color:#4a90d9">${parseFloat(e.hours)}h</span>
              <button class="row-btn tt-del-btn" data-eid="${e.id}" style="font-size:10px;color:#b03020;padding:2px 6px">×</button>
            </div>
          </div>`).join('')}
        </div>`

      logEl.querySelectorAll('.tt-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this entry?')) return
          try {
            const { deleteTimeEntry } = await import('../db/client.js')
            await deleteTimeEntry(btn.dataset.eid)
            this._loadLog(mc, project)
          } catch (e) { console.error(e); this.app.toast('Error deleting entry') }
        })
      })
    } catch (e) {
      console.error(e)
      logEl.innerHTML = `<div style="font-size:12px;color:var(--text-tertiary)">Could not load entries.</div>`
    }
  }
}
