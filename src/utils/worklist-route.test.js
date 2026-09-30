import { describe, it, expect } from 'vitest'
import { legacyRetainersTarget } from './worklist-route.js'

const projects = [
  { id: 'p1', company_id: 'c1', is_retainer: false },
  { id: 'p2', company_id: 'c1', is_retainer: true },
  { id: 'p3', company_id: 'c2', is_retainer: false },
]

describe('the old #retainers addresses', () => {
  it('send a company to its retainer project first', () => {
    expect(legacyRetainersTarget('#retainers/c1', projects)).toEqual({ hash: '#projects/p2/worklist', found: true })
  })
  it('send a company with no retainer to its only or first project', () => {
    expect(legacyRetainersTarget('#retainers/c2', projects)).toEqual({ hash: '#projects/p3/worklist', found: true })
  })
  it('send a company with no project, or nothing at all, to the project list', () => {
    expect(legacyRetainersTarget('#retainers/c9', projects)).toEqual({ hash: '#projects', found: false })
    expect(legacyRetainersTarget('#retainers', projects)).toEqual({ hash: '#projects', found: false })
    expect(legacyRetainersTarget('#retainers/c1', [])).toEqual({ hash: '#projects', found: false })
  })
  it('leave every other address alone', () => {
    for (const h of ['#projects/p1', '#requests', '', '#tasks/abc']) expect(legacyRetainersTarget(h, projects)).toBeNull()
  })
})
