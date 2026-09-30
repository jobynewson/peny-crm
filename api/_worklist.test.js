import { describe, it, expect } from 'vitest'
import { staffScope, isScope, respondToDelivery } from './_worklist.js'

describe('worklist scopes', () => {
  it('are only made by the constructors', () => {
    expect(isScope(staffScope('user_ws'))).toBe(true)
    expect(isScope({ kind: 'staff', ws: 'user_ws' })).toBe(false)
    expect(() => staffScope('')).toThrow()
  })

  it('cannot be forged or changed', () => {
    const scope = staffScope('user_ws')
    expect(() => { scope.ws = 'someone_else' }).toThrow()
    expect(isScope({ ...scope })).toBe(false)
    expect(isScope({ ...scope, ws: 'someone_else' })).toBe(false)
    expect(isScope(Object.create(scope))).toBe(false)
  })

  it('respondToDelivery refuses anything that is not a scope', async () => {
    const sql = () => { throw new Error('must not query') }
    await expect(respondToDelivery(sql, { kind: 'staff', ws: 'user_ws' }, { deliveryId: 'x', input: {} })).rejects.toThrow(/needs a scope/)
  })

  it('checks the response before touching the database', async () => {
    const sql = () => { throw new Error('must not query') }
    const scope = staffScope('user_ws')
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    expect((await respondToDelivery(sql, scope, { deliveryId: 'nope', input: { response: 'approved' } })).error.status).toBe(404)
    expect((await respondToDelivery(sql, scope, { deliveryId: id, input: { response: 'maybe' } })).error).toMatchObject({ status: 422, field: 'response' })
    expect((await respondToDelivery(sql, scope, { deliveryId: id, input: { response: 'changes_requested' } })).error).toMatchObject({ status: 422, field: 'comment' })
  })
})

// The SQL of one function in _worklist.js, by name: from its declaration to the
// next top-level declaration.
async function queriesOf(name) {
  const fs = await import('node:fs')
  const source = fs.readFileSync(new URL('./_worklist.js', import.meta.url), 'utf8')
  const start = source.indexOf(`async function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const rest = source.slice(start + 1)
  const next = rest.search(/\n(?:async function|function|export|const) /)
  const body = next === -1 ? rest : rest.slice(0, next)
  return [...body.matchAll(/sql`([\s\S]*?)`/g)].map(m => m[1])
}

describe('the client\'s answer', () => {
  it('keeps the company and visibility inside every statement it runs', async () => {
    const queries = await queriesOf('respondAsClient')
    expect(queries).toHaveLength(2)                 // the read and the write
    for (const q of queries) {
      expect(q).toContain('workstream_company WHERE company_id = ${scope.companyId}')
      expect(q).toContain('w.user_id = ${scope.ws}')
      expect(q).toContain('d.client_visible')
    }
  })
})

describe('the Approve link\'s answer', () => {
  it('names its one delivery, its workspace and visibility in every statement, and uses the link up inside the write', async () => {
    const queries = await queriesOf('respondViaLink')
    expect(queries.length).toBeGreaterThanOrEqual(2)
    for (const q of queries.filter(q => /FROM deliveries dv/.test(q))) {
      expect(q).toContain('dv.id = ${scope.deliveryId}')
      expect(q).toContain('w.user_id = ${scope.ws}')
      expect(q).toContain('client_visible')
    }
    const write = queries.find(q => /UPDATE deliveries SET/.test(q))
    expect(write).toContain('UPDATE action_links l SET used_at = NOW()')
    expect(write).toContain('l.id = ${scope.linkId}')
    expect(write).toContain('l.used_at IS NULL AND l.expires_at > NOW()')
    expect(write).toMatch(/FROM target, used WHERE deliveries\.id = target\.id/)   // no link, no approval
    expect(write).toContain("client_response   = 'approved'")                       // it can only approve
  })
})

describe('a client\'s request and reply', () => {
  it('a request is filed under the scope\'s own company, capped inside the write', async () => {
    const [write] = await queriesOf('submitRequest')
    expect(write).toContain('id = ${scope.companyId} AND user_id = ${scope.ws}')
    expect(write).toContain('${scope.clerkUserId}')
    expect(write).toContain("r.status = 'new'")
    expect(write).toContain('< ${MAX_OPEN_REQUESTS}')
  })
  it('a reply is written only to an item of the scope\'s company that is shown and waiting', async () => {
    const [write] = await queriesOf('replyToWaiting')
    expect(write).toContain('workstream_company WHERE company_id = ${scope.companyId}')
    expect(write).toContain('w.user_id = ${scope.ws}')
    expect(write).toContain('d.client_visible')
    expect(write).toContain("d.status = 'waiting_on_client'")
  })
})
