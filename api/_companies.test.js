import { describe, it, expect } from 'vitest'
import { normaliseCompanyName, ROUTES } from './_companies.js'
import { matchRoute } from './_api.js'

describe('normaliseCompanyName', () => {
  it('trims and collapses whitespace but keeps the case typed', () => {
    expect(normaliseCompanyName('  DMM  ')).toBe('DMM')
    expect(normaliseCompanyName('Kinetic   Brand\tCo.')).toBe('Kinetic Brand Co.')
    expect(normaliseCompanyName('dmm')).toBe('dmm')
  })
  it('treats blank and non-strings as no company', () => {
    expect(normaliseCompanyName('   ')).toBe(null)
    expect(normaliseCompanyName('')).toBe(null)
    expect(normaliseCompanyName(null)).toBe(null)
    expect(normaliseCompanyName(42)).toBe(null)
  })
})

describe('company routes', () => {
  it('lists for everyone and creates for editors only', () => {
    expect(matchRoute('GET', 'companies', ROUTES).route.access).toBeUndefined()
    expect(matchRoute('POST', 'companies', ROUTES).route.access).toBe('editor')
    expect(matchRoute('DELETE', 'companies', ROUTES).status).toBe(405)
  })
})
