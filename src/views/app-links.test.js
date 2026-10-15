import { describe, it, expect } from 'vitest'
import { appLinkUrl, cleanAppLinks, visibleAppLinks } from './app-links.js'

describe('appLinkUrl', () => {
  it('keeps http and https links', () => {
    expect(appLinkUrl('https://fence.example.com/latest')).toBe('https://fence.example.com/latest')
    expect(appLinkUrl(' http://192.168.1.240:8080 ')).toBe('http://192.168.1.240:8080/')
  })
  it('refuses anything a browser cannot open safely from a page', () => {
    expect(appLinkUrl('nfs://192.168.1.240/mnt/tank/Peny Fence.app')).toBeNull()
    expect(appLinkUrl('file:///Applications/Fence.app')).toBeNull()
    expect(appLinkUrl('javascript:alert(1)')).toBeNull()
    expect(appLinkUrl('fence.example.com')).toBeNull()
    expect(appLinkUrl('')).toBeNull()
  })
})

describe('cleanAppLinks', () => {
  it('drops blank rows and reports unusable ones', () => {
    const { links, rejected } = cleanAppLinks([
      { name: 'Peny Fence', url: 'https://fence.example.com' },
      { name: '', url: '' },
      { name: 'Broken', url: 'nfs://x' },
      { name: '', url: 'https://nameless.example.com' },
    ])
    expect(links).toEqual([{ name: 'Peny Fence', url: 'https://fence.example.com/' }])
    expect(rejected).toEqual(['Broken', 'https://nameless.example.com'])
  })
  it('copes with a missing list', () => {
    expect(cleanAppLinks(undefined)).toEqual({ links: [], rejected: [] })
    expect(visibleAppLinks(null)).toEqual([])
  })
})
