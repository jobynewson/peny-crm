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
