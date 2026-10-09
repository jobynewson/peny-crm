// runMigrations() skips applyMigrations() once the database's recorded version
// reaches SCHEMA_VERSION. So a statement added without bumping the version
// would never run on a database that's already current. This pins the
// statements: change them, and this fails until SCHEMA_VERSION is bumped and
// the pair below is updated.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

// Update both together: bump SCHEMA_VERSION in client.js, then paste the hash
// this test prints.
const PINNED = { version: 7, hash: 'e686f1184fcd9745' }

function migrationsBody() {
  const start = source.indexOf('async function applyMigrations() {')
  const end = source.indexOf('\n}\n', start)
  if (start < 0 || end < 0) throw new Error('applyMigrations() not found in client.js')
  return source.slice(start, end)
}

describe('schema version', () => {
  it('is bumped whenever the migration statements change', () => {
    const hash = createHash('sha256').update(migrationsBody()).digest('hex').slice(0, 16)
    const version = Number(/export const SCHEMA_VERSION = (\d+)/.exec(source)?.[1])
    expect(
      { version, hash },
      `applyMigrations() changed. Bump SCHEMA_VERSION in client.js and set PINNED to { version: <new>, hash: '${hash}' }.`,
    ).toEqual(PINNED)
  })

  it('records the version only after the statements have run', () => {
    const body = source.slice(source.indexOf('export async function runMigrations()'), source.indexOf('async function applyMigrations()'))
    expect(body.indexOf('await applyMigrations()')).toBeGreaterThan(-1)
    expect(body.indexOf('INSERT INTO schema_version')).toBeGreaterThan(body.indexOf('await applyMigrations()'))
  })
})
