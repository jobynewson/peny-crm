// A project's deliverables live on its worklist (workstreams → deliverables).
// The old JSON columns on projects — deliverables and monthly_deliverables —
// are left in the database, untouched, and nothing may read or write them.
// This reads the source so a stray use comes back as a failing test.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(full)
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [full] : []
  })
}
const sources = [...files(path.join(root, 'api')), ...files(path.join(root, 'src'))]
  .filter(f => !f.endsWith('src/db/schema.js'))   // the column is still declared
  .map(f => [path.relative(root, f), fs.readFileSync(f, 'utf8')])

describe('the old JSON deliverables on projects', () => {
  it('are not read or written by anything', () => {
    const uses = []
    for (const [file, text] of sources) {
      text.split('\n').forEach((line, i) => {
        if (/monthly_deliverables|monthlyDeliv/.test(line)) uses.push(`${file}:${i + 1} ${line.trim().slice(0, 80)}`)
        if (/\b(p|project|proj)\.deliverables\b/.test(line)) uses.push(`${file}:${i + 1} ${line.trim().slice(0, 80)}`)
      })
    }
    expect(uses).toEqual([])
  })

  it('have no reader module left', () => {
    expect(fs.existsSync(path.join(root, 'api/_legacy-deliverables.js'))).toBe(false)
  })
})
