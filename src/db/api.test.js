import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../auth/clerk.js', () => ({ getAuthToken: async () => 'session-token' }))
const { callDb } = await import('./api.js')

const respond = (status, body) => vi.fn(async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (body === undefined ? Promise.reject(new SyntaxError('no body')) : body),
}))

afterEach(() => vi.unstubAllGlobals())

describe('callDb', () => {
  it('posts the op and args with the Clerk session, and returns the result', async () => {
    const fetch = respond(200, { result: [{ id: 1 }] })
    vi.stubGlobal('fetch', fetch)
    await expect(callDb('updateCredential', 'id-1', { notes: 'n' })).resolves.toEqual([{ id: 1 }])
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/db')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer session-token')
    expect(JSON.parse(init.body)).toEqual({ op: 'updateCredential', args: ['id-1', { notes: 'n' }] })
  })

  it('throws the server\'s error message, or the status when there is none', async () => {
    vi.stubGlobal('fetch', respond(403, { error: 'Not allowed' }))
    await expect(callDb('getCredentials')).rejects.toThrow('Not allowed')
    vi.stubGlobal('fetch', respond(504))
    await expect(callDb('getCredentials')).rejects.toThrow('Database request failed (504)')
  })
})
