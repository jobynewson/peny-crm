// /api/db, the browser's database connection: who gets through, what is
// forwarded to Neon and what comes back — including a round trip with the
// real Neon driver playing the browser.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Writable } from 'node:stream'
import { neon, neonConfig } from '@neondatabase/serverless'
import handler, { queryBody } from './db.js'

const auth = vi.hoisted(() => ({ result: null, options: [] }))
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async (_req, _sql, options) => { auth.options.push(options); return auth.result },
}))

const DATABASE_URL = 'postgresql://neondb_owner:npg_Sup3rS3cret@ep-cool-lake-a1b2c3-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require'
const STAFF = { user: { id: 'u1', role: 'user' } }
const saved = { fetchEndpoint: neonConfig.fetchEndpoint, fetchFunction: neonConfig.fetchFunction }
let upstream

// Vercel's res, as a stream the answer can be piped into.
function streamRes() {
  const chunks = []
  const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() } })
  res.statusCode = 200
  res.headers = {}
  res.status = code => { res.statusCode = code; return res }
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value }
  res.json = body => { res.body = body; res.end(); return res }
  res.text = () => Buffer.concat(chunks).toString('utf8')
  return res
}

// Neon's HTTP answer for a query, in the shape the driver asks for (raw text,
// rows as arrays): every query here returns one int column, `n`.
const neonAnswer = body => {
  const one = q => ({ command: 'SELECT', rowCount: 1, fields: [{ name: 'n', dataTypeID: 23 }], rows: [[String(q.params[0] ?? 1)]] })
  return new Response(JSON.stringify(body.queries ? { results: body.queries.map(one) } : one(body)), { headers: { 'content-type': 'application/json' } })
}

const post = async (body, headers = {}) => {
  const res = streamRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer t', ...headers }, body }, res)
  return res
}

beforeEach(() => {
  process.env.DATABASE_URL = DATABASE_URL
  auth.result = STAFF
  auth.options = []
  upstream = []
  neonConfig.fetchFunction = async (url, init) => { upstream.push({ url, init, body: JSON.parse(init.body) }); return neonAnswer(JSON.parse(init.body)) }
})
afterEach(() => { Object.assign(neonConfig, saved) })

describe('who gets through', () => {
  it('only POST', async () => {
    const res = streamRes()
    await handler({ method: 'GET', headers: {} }, res)
    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('POST')
    expect(upstream).toEqual([])
  })

  it('only Slate users, checked with the remembered staff check', async () => {
    auth.result = { error: { status: 403, code: 'not_provisioned', message: 'This account is not a Slate user' } }
    const res = await post({ query: 'SELECT 1', params: [] })
    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('not_provisioned')
    expect(upstream).toEqual([])
    expect(auth.options).toEqual([{ remember: true }])
  })

  it('only what the driver sends', async () => {
    for (const body of [null, {}, { query: 7 }, { query: 'SELECT 1', params: 'x' }, { queries: [] }, { queries: [{ query: 'SELECT 1' }, {}] }]) {
      expect((await post(body)).statusCode).toBe(422)
    }
    expect(upstream).toEqual([])
    expect(queryBody({ query: 'SELECT 1', params: [1], extra: 'dropped' })).toEqual({ query: 'SELECT 1', params: [1] })
    expect(queryBody({ queries: [{ query: 'SELECT 1' }] })).toEqual({ queries: [{ query: 'SELECT 1', params: [] }] })
  })
})

describe('what is forwarded', () => {
  it('to where the driver would send it, with the server\'s connection string', async () => {
    const res = await post({ query: 'SELECT $1', params: ['1'] }, { 'neon-connection-string': 'postgresql://evil:x@elsewhere.example/db' })
    expect(res.statusCode).toBe(200)
    const [{ url, init, body }] = upstream
    expect(url).toBe('https://api.eu-west-2.aws.neon.tech/sql')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'Neon-Connection-String': DATABASE_URL,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    })
    expect(body).toEqual({ query: 'SELECT $1', params: ['1'] })
  })

  it('a transaction, with the options Neon knows', async () => {
    await post({ queries: [{ query: 'SELECT 1', params: [] }, { query: 'SELECT 2', params: [] }] }, {
      'neon-batch-isolation-level': 'Serializable', 'neon-batch-read-only': 'yes please', 'neon-batch-deferrable': 'false',
    })
    expect(upstream[0].body.queries).toHaveLength(2)
    expect(upstream[0].init.headers['neon-batch-isolation-level']).toBe('Serializable')
    expect(upstream[0].init.headers['neon-batch-deferrable']).toBe('false')
    expect(upstream[0].init.headers).not.toHaveProperty('neon-batch-read-only')
    await post({ query: 'SELECT 1', params: [] }, { 'neon-batch-isolation-level': 'Serializable' })
    expect(upstream[1].init.headers).not.toHaveProperty('neon-batch-isolation-level')
  })
})

describe('what comes back', () => {
  it('Neon\'s answer as it is, errors included', async () => {
    neonConfig.fetchFunction = async () => new Response('{"message":"relation \\"nope\\" does not exist","code":"42P01"}', { status: 400, headers: { 'content-type': 'application/json' } })
    const res = await post({ query: 'SELECT * FROM nope', params: [] })
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toBe('application/json')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(res.text())).toEqual({ message: 'relation "nope" does not exist', code: '42P01' })
  })

  it('502 when the database can\'t be reached', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    neonConfig.fetchFunction = async () => { throw new TypeError('fetch failed') }
    const res = await post({ query: 'SELECT 1', params: [] })
    quiet.mockRestore()
    expect(res.statusCode).toBe(502)
    expect(res.body.error.code).toBe('database_unreachable')
  })

  it('reads, to the Neon driver in the browser, as if it came from Neon', async () => {
    // The driver as src/db/client.js sets it up: queries go to /api/db, which
    // (here) runs this handler in-process; the handler's own fetch to Neon
    // gets the stand-in answer.
    neonConfig.fetchEndpoint = host => (host === 'database.invalid' ? '/api/db' : saved.fetchEndpoint(host))
    const toNeon = neonConfig.fetchFunction
    neonConfig.fetchFunction = async (url, init) => {
      if (url !== '/api/db') return toNeon(url, init)
      const headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]))
      const res = await post(JSON.parse(init.body), headers)
      return new Response(res.text(), { status: res.statusCode, headers: { 'content-type': res.headers['content-type'] } })
    }
    const browserSql = neon('postgresql://slate:none@database.invalid/slate')

    expect(await browserSql`SELECT ${7}::int AS n`).toEqual([{ n: 7 }])
    expect(await browserSql.transaction([browserSql`SELECT ${1}`, browserSql`SELECT ${2}`])).toEqual([[{ n: 1 }], [{ n: 2 }]])
    expect(upstream.every(u => u.init.headers['Neon-Connection-String'] === DATABASE_URL)).toBe(true)

    neonConfig.fetchFunction = async (url, init) => {
      if (url !== '/api/db') return new Response('{"message":"relation \\"nope\\" does not exist","code":"42P01"}', { status: 400 })
      const res = await post(JSON.parse(init.body))
      return new Response(res.text(), { status: res.statusCode })
    }
    await expect(browserSql`SELECT * FROM nope`).rejects.toMatchObject({ name: 'NeonDbError', code: '42P01' })
  })
})
