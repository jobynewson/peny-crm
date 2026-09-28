import { describe, it, expect } from 'vitest'
import { landingFor } from './landing.js'

describe('landingFor', () => {
  it('sends a client org member with no Slate account to the portal', () => {
    expect(landingFor({ orgCount: 1, isStaff: false })).toBe('portal')
  })
  it('keeps staff in the app, even if they have been added to a client org', () => {
    expect(landingFor({ orgCount: 0, isStaff: true })).toBe('app')
    expect(landingFor({ orgCount: 2, isStaff: true })).toBe('app')
  })
  it('lets a brand-new staff member (no org, no row yet) be provisioned', () => {
    expect(landingFor({ orgCount: 0, isStaff: false })).toBe('app')
  })
})
