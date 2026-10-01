import { describe, it, expect } from 'vitest'
import { parseExtraEmails, chosenEmails, testPanelHtml } from './test-mode.js'

const users = [{ id: 'u1', name: 'Joby <b>', email: 'Joby@peny.com' }, { id: 'u2', name: 'Ana', email: 'ana@peny.com' }, { id: 'u3', name: 'No email', email: null }]

describe('the Testing panel', () => {
  it('starts off, with nobody ticked, and lists the team to choose from', () => {
    const html = testPanelHtml({}, users)
    expect(html).not.toMatch(/id="s-test-mode" checked/)
    expect(html).toContain('data-test-user="Joby@peny.com"')
    expect(html).toContain('data-test-user="ana@peny.com"')
    expect(html).not.toContain('No email')
    expect(html).toContain('Joby &lt;b&gt;')
    expect(html).toMatch(/id="s-test-warn"[^>]* hidden/)
  })
  it('shows what is chosen: ticked team members, and other addresses in the box', () => {
    const html = testPanelHtml({ test_mode: true, test_emails: ['joby@peny.com', 'sam@client.test'] }, users)
    expect(html).toMatch(/id="s-test-mode" checked/)
    expect(html).toMatch(/data-test-user="Joby@peny.com" checked/)
    expect(html).not.toMatch(/data-test-user="ana@peny.com" checked/)
    expect(html).toContain('value="sam@client.test"')
  })
  it('warns when it is on and nobody is chosen', () => {
    expect(testPanelHtml({ test_mode: true, test_emails: [] }, users)).not.toMatch(/id="s-test-warn"[^>]* hidden/)
  })
  it('says what it redirects and what it leaves alone', () => {
    const html = testPanelHtml({}, users)
    expect(html).toContain('Approve links')
    expect(html).toContain('Leave, expenses and everything else send as normal')
  })
})

describe('reading the form', () => {
  it('splits typed addresses on commas, spaces and lines, drops duplicates and reports junk', () => {
    expect(parseExtraEmails('A@b.test, c@d.test\nA@B.test; nope')).toEqual({ emails: ['a@b.test', 'c@d.test'], rejected: ['nope'] })
    expect(parseExtraEmails('')).toEqual({ emails: [], rejected: [] })
  })
  it('puts ticked team members first, then typed ones, with no repeats', () => {
    expect(chosenEmails(['Joby@peny.com'], 'joby@peny.com, sam@client.test')).toEqual({ emails: ['joby@peny.com', 'sam@client.test'], rejected: [] })
  })
})
