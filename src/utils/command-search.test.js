import { describe, it, expect } from 'vitest'
import { matchCommands } from './command-search.js'
import { searchCommands } from '../views/search-commands.js'

const app = (permissions = {}, role = 'user') => ({
  permissions, appUser: { role }, leaveView: { canBook: true },
})
const everyone = { projects_view: true, projects_edit: true, contacts_view: true, contacts_edit: true, budgets_view: true, budgets_edit: true, settings: true }
const labels = (q, a = app(everyone)) => matchCommands(searchCommands(a), q).map(c => c.label)

describe('search palette: pages and actions', () => {
  it('finds a page by its name', () => {
    expect(labels('expenses')[0]).toBe('Expenses')
    expect(labels('exp')[0]).toBe('Expenses')
    expect(labels('Offload')[0]).toBe('Offload Log')
  })

  it('finds a page by what people call it', () => {
    expect(labels('holiday')).toEqual(expect.arrayContaining(['Leave', 'Book leave']))
    expect(labels('holiday')[0]).toBe('Leave')
    expect(labels('receipts')[0]).toBe('Expenses')
    expect(labels('rota')[0]).toBe('Calendar')
  })

  it('finds actions, words in any order', () => {
    expect(labels('new project')[0]).toBe('New project')
    expect(labels('proj new')[0]).toBe('New project')
    expect(labels('dark')[0]).toBe('Theme: Dark')
    expect(labels('log time')[0]).toBe('Log time')
  })

  it('ranks a label match above a keyword match', () => {
    // "Log time" starts with the word; "Offload Log" only contains it.
    expect(labels('log').indexOf('Log time')).toBeLessThan(labels('log').indexOf('Offload Log'))
  })

  it('matches the start of words only, and needs every word', () => {
    expect(labels('pense')).toEqual([])
    expect(labels('expenses zebra')).toEqual([])
    expect(labels('')).toEqual([])
    expect(labels('   ')).toEqual([])
  })

  it('caps the number of results', () => {
    expect(matchCommands(searchCommands(app(everyone)), 'new', 3)).toHaveLength(3)
  })

  it('only lists what the person can reach', () => {
    const viewer = app({})
    expect(labels('projects', viewer)).not.toContain('Projects')
    expect(labels('new project', viewer)).toEqual([])
    expect(labels('passwords', viewer)).toEqual([])
    expect(labels('team', viewer)).not.toContain('Team & roles')
    expect(labels('passwords', app({ vault: true }))).toContain('Passwords')
    expect(labels('team', app(everyone, 'superadmin'))).toContain('Team & roles')
    expect(labels('book leave', { ...viewer, leaveView: { canBook: false } })).not.toContain('Book leave')
  })
})
