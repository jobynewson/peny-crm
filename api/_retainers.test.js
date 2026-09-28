import { describe, it, expect } from 'vitest'
import { matchRoute } from './_api.js'
import { ROUTES } from './_retainers.js'

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const match = (method, path) => matchRoute(method, path, ROUTES)

describe('/api/retainers routes', () => {
  it('matches every route', () => {
    for (const [method, path] of [
      ['GET', 'retainers/companies'], ['GET', `retainers/companies/${ID}`],
      ['POST', 'retainers/workstreams'], ['PATCH', `retainers/workstreams/${ID}`], ['DELETE', `retainers/workstreams/${ID}`],
      ['POST', 'retainers/deliverables'], ['PATCH', `retainers/deliverables/${ID}`], ['DELETE', `retainers/deliverables/${ID}`],
      ['POST', `retainers/deliverables/${ID}/deliveries`], ['DELETE', `retainers/deliveries/${ID}`],
      ['POST', `retainers/deliveries/${ID}/preview`], ['POST', `retainers/deliveries/${ID}/response`],
    ]) {
      expect(match(method, path).route, `${method} ${path}`).toBeTruthy()
    }
  })

  it('only takes uuids as ids', () => {
    expect(match('GET', 'retainers/companies/1').status).toBe(404)
    expect(match('PATCH', "retainers/deliverables/1' OR 1=1").status).toBe(404)
  })

  it('answers a wrong method with 405 and what is allowed', () => {
    expect(match('PUT', `retainers/deliverables/${ID}`)).toMatchObject({ status: 405, allow: ['PATCH', 'DELETE'] })
  })

  it('lets anyone on the team read, and only non-viewers write', () => {
    for (const r of ROUTES) expect(r.access ?? 'none', `${r.method} ${r.pattern}`).toBe(r.method === 'GET' ? 'none' : 'editor')
  })
})
