// src/views/test-mode.js
// Settings › Company › Testing: while it is on, the emails about the worklist
// and portal work (a delivery for review, the alerts, tasks assigned, the due
// digest) go to the people chosen here instead of the people they are for, each
// saying who it would have gone to (api/_notify.js does the redirect). Off by
// default; a superadmin setting, guarded here like the others.

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Addresses typed in the "another address" box: separated by commas, spaces or
// new lines; anything that isn't an address is dropped (and reported).
export function parseExtraEmails(text) {
  const parts = String(text ?? '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
  return { emails: [...new Set(parts.filter(p => EMAIL.test(p)).map(p => p.toLowerCase()))], rejected: parts.filter(p => !EMAIL.test(p)) }
}

// Team members' emails ticked, then the typed ones; no duplicates, in order.
export function chosenEmails(ticked, extraText) {
  const { emails, rejected } = parseExtraEmails(extraText)
  return { emails: [...new Set([...ticked.map(e => e.toLowerCase()), ...emails])], rejected }
}

export function testPanelHtml(settings, users) {
  const chosen = (Array.isArray(settings?.test_emails) ? settings.test_emails : []).map(e => String(e).toLowerCase())
  const team = (users || []).filter(u => u.email)
  const teamEmails = new Set(team.map(u => u.email.toLowerCase()))
  const extra = chosen.filter(e => !teamEmails.has(e))
  const on = !!settings?.test_mode
  return `
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Testing</span></div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:12px">
        <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">While this is on, the emails about the worklist and the client portal go to the people you choose below instead of the people they are for: a delivery for review (with its Approve links), the alerts (new request, changes, comments are in, a client reply, due soon, input overdue), tasks assigned to someone, and the “what’s due” email. Each one says who it would have gone to. Leave, expenses and everything else send as normal. Turn it off when you are done.</div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;font-weight:500">
          <input type="checkbox" id="s-test-mode" ${on ? 'checked' : ''} /> Testing mode
        </label>
        <div id="s-test-warn" style="font-size:12px;color:var(--danger)"${on && !chosen.length ? '' : ' hidden'}>Nobody is chosen, so these emails are being held back and not sent to anyone.</div>
        <div>
          <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Send them to</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${team.map(u => `
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                <input type="checkbox" data-test-user="${esc(u.email)}" ${chosen.includes(u.email.toLowerCase()) ? 'checked' : ''} />
                <span>${esc(u.name || u.email)}</span> <span style="color:var(--text-tertiary);font-size:12px">${esc(u.email)}</span>
              </label>`).join('') || '<div style="font-size:12px;color:var(--text-tertiary)">No team members yet.</div>'}
          </div>
        </div>
        <div>
          <label for="s-test-extra" style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px">Or another address</label>
          <input id="s-test-extra" type="text" placeholder="name@example.com, another@example.com" value="${esc(extra.join(', '))}" autocomplete="off" spellcheck="false" style="width:100%" />
        </div>
        <div><button class="btn-primary" id="s-test-save">Save</button></div>
      </div>
    </div>`
}
