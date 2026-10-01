import { describe, it, expect, vi } from 'vitest'

// budgets.js imports the DB client, which needs Clerk's browser env; the maths under test doesn't.
vi.mock('../db/client.js', () => ({}))
const { budNet, budDiscount, hasDiscount } = await import('./budgets.js')

const sec = (lines, enabled = true) => ({ code: 'X', label: 'X', enabled, lines })
const bud = (sections, extra = {}) => ({ markup: 0, custom_pct: 0, sections, ...extra })

describe('budget discount', () => {
  it('sums per-line discounts, so net + discount is the undiscounted total', () => {
    const b = bud([sec([
      { item: 'a', qty: 2, rate: 100, discount: 10 },      // 200 gross, 20 off
      { item: 'b', qty: 1, rate: 500, discount: 0 },       // no discount
      { item: 'c', qty: 1, days: 2, rate: 300, discount: 50 }, // day rate: 600 gross, 300 off
    ])])
    expect(budDiscount(b)).toBeCloseTo(320)
    expect(budNet(b) + budDiscount(b)).toBeCloseTo(200 + 500 + 600)
  })

  it('counts a master discount that has been copied onto every line', () => {
    const b = bud([sec([{ qty: 1, rate: 1000, discount: 20 }, { qty: 1, rate: 500, discount: 20 }])], { discount: 20 })
    expect(budDiscount(b)).toBeCloseTo(300)
  })

  it('ignores disabled sections and clamps to 0–100%', () => {
    const b = bud([
      sec([{ qty: 1, rate: 100, discount: 150 }]),          // clamped to 100% → 100 off
      sec([{ qty: 1, rate: 900, discount: 50 }], false),    // off section
    ])
    expect(budDiscount(b)).toBeCloseTo(100)
  })

  it('is zero when nothing is discounted', () => {
    expect(budDiscount(bud([sec([{ qty: 1, rate: 100 }])]))).toBe(0)
  })

  it('hasDiscount is true for a master or any line discount, false otherwise', () => {
    expect(hasDiscount(bud([sec([{ qty: 1, rate: 100 }])]))).toBe(false)
    expect(hasDiscount(bud([sec([{ qty: 1, rate: 100 }])], { discount: 5 }))).toBe(true)
    expect(hasDiscount(bud([sec([{ qty: 1, rate: 100, discount: 5 }])]))).toBe(true)
  })
})
