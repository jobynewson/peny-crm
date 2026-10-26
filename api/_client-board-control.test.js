// What staff hide must not reach the client by any route. The statements that
// serve or accept a client's answer are SQL strings, so this checks each one
// that starts from `deliveries` and is client-facing keeps hidden_at in its
// WHERE. (api/_worklist.js scopes: company, link; api/_client-view.js views.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const statements = file => readFileSync(new URL(file, import.meta.url), 'utf8').split('sql`').slice(1).map(s => s.slice(0, s.indexOf('`')))

describe('hidden rounds', () => {
  it('stay out of every client-facing statement over deliveries', () => {
    for (const file of ['./_client-view.js', './_worklist.js']) {
      for (const q of statements(file)) {
        if (!/FROM deliveries dv/.test(q)) continue
        const clientFacing = /client_visible/.test(q) || /action_links/.test(q)
        if (!clientFacing) continue
        expect(q, `${file}: ${q.slice(0, 80)}`).toMatch(/dv\.hidden_at IS NULL/)
      }
    }
  })
  it('do not count as a round waiting on the client', () => {
    const src = readFileSync(new URL('./_worklist.js', import.meta.url), 'utf8')
    expect(src).toMatch(/x\.hidden_at IS NULL AND x\.client_response = 'pending'/)
  })
})
