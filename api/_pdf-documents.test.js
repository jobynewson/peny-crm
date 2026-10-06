// PDF Generator routes: validation, and that every query is scoped to the
// workspace. A fake sql records each query and its values.
import { describe, it, expect } from 'vitest'
import { ROUTES, cleanDocument, LIMITS, FLAGS } from './_pdf-documents.js'
import { matchRoute, accessDenied } from './_api.js'
import { fakeRes } from './_test-db.js'

const WS = 'user_owner'
const ME = 'user_me'
const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const doc = (over = {}) => ({
  title: 'Rate card', theme: 'light',
  content: { label: 'Rates', subtitle: '2026', date: '6 October 2026', blocks: [
    { type: 'heading', text: 'Day rates' },
    { type: 'text', text: 'Hello' },
    { type: 'bullets', items: ['a', 'b'] },
    { type: 'table', rows: [['Camera', '£500']] },
  ] },
  ...over,
})

function run(method, path, body, rows = [{ id: ID }]) {
  const calls = []
  const sql = (strings, ...values) => {
    const text = strings.join('?')
    calls.push({ text, values })
    return Promise.resolve(text.includes('FROM workspace') ? [{ owner_id: WS }] : rows)
  }
  const m = matchRoute(method, path, ROUTES)
  const res = fakeRes()
  return m.route.handler({ body }, res, { sql, user: { clerk_id: ME }, params: m.params }).then(() => ({ res, calls }))
}

describe('cleanDocument', () => {
  it('accepts a full document and keeps only known keys', () => {
    const d = doc(); d.content.blocks[1].extra = 'x'
    const { value } = cleanDocument({ ...d, junk: 1 })
    expect(value.title).toBe('Rate card')
    expect(value.content.blocks[1]).toEqual({ type: 'text', text: 'Hello' })
    expect(Object.keys(value).sort()).toEqual(['content', 'theme', 'title'])
  })
  it('keeps the footer fields and layout flags, defaulting the flags to off', () => {
    const d = doc(); d.content.preparedBy = 'Joby'; d.content.emails = 'a@b.co, c@d.co'; d.content.condensedPage = true
    const { value } = cleanDocument(d)
    expect(value.content).toMatchObject({ preparedBy: 'Joby', emails: 'a@b.co, c@d.co', condensedPage: true, condensedHeader: false, condensedFooter: false })
    expect(cleanDocument(doc({ content: { blocks: [], condensedHeader: 'yes' } })).field).toBe('content.condensedHeader')
    expect(cleanDocument(doc({ content: { blocks: [], preparedBy: 'x'.repeat(LIMITS.preparedBy + 1) } })).field).toBe('content.preparedBy')
    expect(cleanDocument(doc({ content: { blocks: [], emails: 'x'.repeat(LIMITS.emails + 1) } })).field).toBe('content.emails')
    expect(FLAGS).toEqual(['condensedHeader', 'condensedFooter', 'condensedPage'])
  })
  it('keeps a whole-number scale in range, defaulting to 100', () => {
    expect(cleanDocument(doc()).value.content.scale).toBe(100)
    expect(cleanDocument(doc({ content: { blocks: [], scale: 72 } })).value.content.scale).toBe(72)
    for (const bad of [LIMITS.scaleMin - 1, LIMITS.scaleMax + 1, 80.5, '80']) {
      expect(cleanDocument(doc({ content: { blocks: [], scale: bad } })).field).toBe('content.scale')
    }
  })
  it('defaults the theme to dark and trims the title', () => {
    expect(cleanDocument({ ...doc({ title: '  Hi  ', theme: undefined }) }).value).toMatchObject({ title: 'Hi', theme: 'dark' })
  })
  it('refuses a missing title, unknown theme, unknown block and oversized pieces', () => {
    expect(cleanDocument(doc({ title: '  ' })).field).toBe('title')
    expect(cleanDocument(doc({ theme: 'neon' })).field).toBe('theme')
    expect(cleanDocument(doc({ content: { blocks: [{ type: 'script' }] } })).field).toBe('content.blocks')
    expect(cleanDocument(doc({ content: { blocks: [{ type: 'table', rows: [['one']] }] } })).field).toBe('content.blocks')
    expect(cleanDocument(doc({ content: { blocks: [{ type: 'text', text: 'x'.repeat(LIMITS.text + 1) }] } })).field).toBe('content.blocks')
    expect(cleanDocument(doc({ content: { blocks: Array(LIMITS.blocks + 1).fill({ type: 'text', text: '' }) } })).field).toBe('content.blocks')
    expect(cleanDocument(doc({ content: { label: 'x'.repeat(LIMITS.label + 1), blocks: [] } })).field).toBe('content.label')
    expect(cleanDocument(null).field).toBe('body')
  })
})

describe('every query is scoped to the workspace', () => {
  it('list, get, update and delete filter by the workspace owner', async () => {
    for (const [method, path, body] of [['GET', 'pdf-documents'], ['GET', `pdf-documents/${ID}`], ['PUT', `pdf-documents/${ID}`, doc()], ['DELETE', `pdf-documents/${ID}`]]) {
      const { calls } = await run(method, path, body)
      const q = calls.find(c => c.text.includes('pdf_documents'))
      expect(q.text).toMatch(/user_id = \?/)
      expect(q.values).toContain(WS)
    }
  })
  it('create stamps the workspace and the saver', async () => {
    const { res, calls } = await run('POST', 'pdf-documents', doc())
    expect(res.statusCode).toBe(201)
    const q = calls.find(c => c.text.includes('INSERT INTO pdf_documents'))
    expect(q.values).toContain(WS)
    expect(q.values.filter(v => v === ME)).toHaveLength(2)
  })
  it('update records who saved it', async () => {
    const { calls } = await run('PUT', `pdf-documents/${ID}`, doc())
    expect(calls.find(c => c.text.includes('UPDATE pdf_documents')).values).toContain(ME)
  })
})

describe('responses', () => {
  it('rejects an invalid body with 422 and a field', async () => {
    const { res } = await run('POST', 'pdf-documents', doc({ title: '' }))
    expect(res.statusCode).toBe(422)
    expect(res.body.error.field).toBe('title')
  })
  it('404s when the document is not in the workspace', async () => {
    expect((await run('GET', `pdf-documents/${ID}`, undefined, [])).res.statusCode).toBe(404)
    expect((await run('PUT', `pdf-documents/${ID}`, doc(), [])).res.statusCode).toBe(404)
    expect((await run('DELETE', `pdf-documents/${ID}`, undefined, [])).res.statusCode).toBe(404)
  })
})

describe('access', () => {
  it('viewers can read the library but not change it', () => {
    for (const r of ROUTES) {
      const denied = accessDenied(r.access, { role: 'viewer' })
      expect(!!denied).toBe(r.method !== 'GET')
    }
  })
})
