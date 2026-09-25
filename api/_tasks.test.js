import { describe, it, expect } from 'vitest'
import { matchRoute, routePathFrom, ROUTES } from './_tasks.js'

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('matchRoute', () => {
  it('matches collection routes', () => {
    expect(matchRoute('GET',  'tasks').route.method).toBe('GET')
    expect(matchRoute('POST', 'tasks').route.method).toBe('POST')
    expect(matchRoute('GET',  'notifications').route.method).toBe('GET')
  })

  it('extracts the task id as a named param', () => {
    expect(matchRoute('GET',   `tasks/${ID}`).params).toEqual({ id: ID })
    expect(matchRoute('PATCH', `tasks/${ID}`).params).toEqual({ id: ID })
    expect(matchRoute('POST',  `tasks/${ID}/acknowledge`).params).toEqual({ id: ID })
    expect(matchRoute('POST',  `tasks/${ID}/comments`).params).toEqual({ id: ID })
  })

  it('405s a known path with the wrong method, and says what is allowed', () => {
    const r = matchRoute('DELETE', `tasks/${ID}`)
    expect(r.status).toBe(405)
    expect(r.code).toBe('method_not_allowed')
    expect(r.allow.sort()).toEqual(['GET', 'PATCH'])
  })

  it('405 on the collection lists both verbs', () => {
    expect(matchRoute('DELETE', 'tasks').allow.sort()).toEqual(['GET', 'POST'])
  })

  it('404s an unknown path', () => {
    expect(matchRoute('GET', 'tasks/nope').status).toBe(404)
    expect(matchRoute('GET', 'widgets').status).toBe(404)
    expect(matchRoute('GET', '').status).toBe(404)
  })

  // A non-uuid id must 404 rather than reaching a query.
  it('rejects a malformed task id', () => {
    expect(matchRoute('GET', 'tasks/123').status).toBe(404)
    expect(matchRoute('GET', "tasks/'; DROP TABLE tasks;--").status).toBe(404)
    expect(matchRoute('POST', 'tasks/123/acknowledge').status).toBe(404)
  })

  it('does not confuse notifications/read with a task route', () => {
    expect(matchRoute('POST', 'notifications/read').route.method).toBe('POST')
    expect(matchRoute('GET',  'notifications/read').status).toBe(405)
  })

  it('keeps the literal _ping route distinct from tasks/:id', () => {
    expect(matchRoute('GET', 'tasks/_ping').route.handler.name).toBe('ping')
  })

  // Patterns are non-global, so exec() must not carry lastIndex between calls.
  it('is stable across repeated calls', () => {
    for (let i = 0; i < 3; i++) expect(matchRoute('GET', `tasks/${ID}`).params.id).toBe(ID)
  })

  it('anchors patterns so extra segments do not match', () => {
    expect(matchRoute('GET', `tasks/${ID}/extra`).status).toBe(404)
    expect(matchRoute('GET', 'xtasks').status).toBe(404)
  })

  it('every route in the table has a handler', () => {
    for (const r of ROUTES) expect(typeof r.handler).toBe('function')
  })
})

describe('routePathFrom', () => {
  it('prefers the rewrite-supplied route param', () => {
    expect(routePathFrom({ query: { route: 'tasks/abc' }, url: '/api/portal' })).toBe('tasks/abc')
  })

  it('strips surrounding slashes', () => {
    expect(routePathFrom({ query: { route: '/tasks/' } })).toBe('tasks')
  })

  it('falls back to the url path when no rewrite ran', () => {
    expect(routePathFrom({ query: {}, url: '/api/tasks?scope=board' })).toBe('tasks')
    expect(routePathFrom({ query: {}, url: `/api/tasks/${ID}` })).toBe(`tasks/${ID}`)
  })

  it('survives a missing query bag or url', () => {
    expect(routePathFrom({})).toBe('')
    expect(routePathFrom({ query: { route: '' }, url: '' })).toBe('')
  })
})
