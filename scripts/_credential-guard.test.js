import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { connectionStringVars, credentialsIn, credentialGuard } from './_credential-guard.js'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const REAL = 'postgresql://neondb_owner:npg_Sup3rS3cret@ep-cool-lake-a1b2c3-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require'
// The connection string the browser's driver starts with (src/db/client.js).
const PLACEHOLDER = /neon\('(postgresql:\/\/[^']+)'\)/.exec(fs.readFileSync(path.join(ROOT, 'src/db/client.js'), 'utf8'))?.[1]

describe('connectionStringVars', () => {
  it('names the variables that hold a connection string', () => {
    expect(connectionStringVars({ VITE_DATABASE_URL: REAL, VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_x', MODE: 'production', BASE_URL: '/' }))
      .toEqual(['VITE_DATABASE_URL'])
    expect(connectionStringVars({ VITE_OTHER: ' postgres://u:p@h/db' })).toEqual(['VITE_OTHER'])
  })
})

describe('credentialsIn', () => {
  it('finds the connection string, or its password on its own', () => {
    expect(credentialsIn(`const u = "${REAL}"`, { databaseUrl: REAL })).toContain('DATABASE_URL')
    expect(credentialsIn('password:"npg_Sup3rS3cret"', { databaseUrl: REAL })).toEqual(['the database password'])
    const odd = 'postgresql://u:p%40ss%2Fword99@db.invalid/x'
    expect(credentialsIn('p%40ss%2Fword99', { databaseUrl: odd })).toEqual(['the database password'])
    expect(credentialsIn('p@ss/word99', { databaseUrl: odd })).toEqual(['the database password'])
  })

  it('finds any Neon connection string, whoever it belongs to', () => {
    expect(credentialsIn('x="postgres://someone:else@ep-other.us-east-2.aws.neon.tech/db"')).toEqual(['a Neon connection string'])
  })

  it('lets through what a clean bundle holds', () => {
    expect(PLACEHOLDER).toMatch(/@[^/]+\.invalid\//)
    expect(credentialsIn(PLACEHOLDER, { databaseUrl: REAL })).toEqual([])
    // The driver's own error message.
    expect(credentialsIn('should be: postgresql://user:password@host.tld/dbname?option=value', { databaseUrl: REAL })).toEqual([])
    // A password too short to look for without false alarms.
    expect(credentialsIn('abc', { databaseUrl: 'postgresql://u:abc@h.invalid/d' })).toEqual([])
  })
})

describe('credentialGuard', () => {
  const resolve = (env, config) => credentialGuard({ env }).configResolved({ command: 'build', env: {}, ...config })

  it('refuses a VITE_ connection string before building anything', () => {
    expect(() => resolve({ DATABASE_URL: REAL }, { env: { VITE_DATABASE_URL: REAL } })).toThrow(/VITE_DATABASE_URL holds a database connection string/)
  })

  it('refuses a Vercel build with no DATABASE_URL, and nothing else without one', () => {
    expect(() => resolve({ VERCEL: '1' })).toThrow(/DATABASE_URL is not set/)
    expect(() => resolve({ VERCEL: '1', DATABASE_URL: REAL })).not.toThrow()
    expect(() => resolve({})).not.toThrow()
    expect(() => resolve({ VERCEL: '1' }, { command: 'serve' })).not.toThrow()
  })

  it('fails the build when a built file holds the credential', () => {
    const guard = credentialGuard({ env: { DATABASE_URL: REAL } })
    const bundle = {
      'assets/main-abc.js': { type: 'chunk', code: `neon("${REAL}")` },
      'index.html': { type: 'asset', source: '<html></html>' },
      'assets/logo.png': { type: 'asset', source: new Uint8Array(Buffer.from(REAL)) },
    }
    expect(() => guard.writeBundle({}, bundle)).toThrow(/assets\/main-abc\.js: DATABASE_URL/)
    delete bundle['assets/main-abc.js']
    expect(() => guard.writeBundle({}, bundle)).not.toThrow()
  })
})

describe('the browser code', () => {
  it('never reads a database URL from the environment', () => {
    const offenders = []
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(file)
        else if (/\.m?js$/.test(entry.name) && /(import\.meta\.env|process\.env)\.\w*DATABASE_URL/.test(fs.readFileSync(file, 'utf8'))) offenders.push(path.relative(ROOT, file))
      }
    }
    walk(path.join(ROOT, 'src'))
    expect(offenders).toEqual([])
  })
})
