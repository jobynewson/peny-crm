import { describe, it, expect } from 'vitest'
import { planImport, parseWhen, productBlocks } from './_worklist-sheet.js'

// DMM's worklist (Worklists.xlsx), cell for cell as the reader returns it:
// merged cells carry their value on the first row only.
const NBSP = ' '
const DMM = [
  { n: 2, A: 'Products', B: 'Brief', C: 'Deliverables', D: 'Deadlines' },
  { n: 3, A: 'Cams', B: 'Storyboard, shot list, briefing teams and Russell', D: 'September' },
  { n: 4, A: 'Trad videos', B: 'Editing the videos', C: '1 video per week to be published' },
  { n: 6, A: `Pink Campaign${NBSP}`, B: 'Campaign', C: 'Website product images including macros', D: '17th September' },
  { n: 7, C: 'Images for social media launch post- anything creative' },
  { n: 8, C: 'Any other images/video we can take while shooting that I can use for socials' },
  { n: 9, A: 'Winter - ice axes', B: 'Showcase the features of each ice axe', C: 'Macro Images', D: 'Cortex – 7th October' },
  { n: 10, C: 'Videos/images of ice axes to talk about the features', D: 'Apex – 1st November' },
  { n: 11, C: "Can the background or something be different in each axe so it doesn't get boring?", D: 'Vertex – 16th November' },
  { n: 12, C: 'micro video shots', D: 'Spire Tech – 1st December' },
  { n: 13, D: 'Spire - 1st December' },
  { n: 14, D: 'Flux- 8th December' },
  { n: 15, B: 'video with engineer', C: 'will try to film it and send it for editing' },
  { n: 16, A: 'Durolock ', B: 'Launch', C: 'Website images inclduing macro , social media images/videos' },
  { n: 17, A: 'Flight Bag', B: 'Features and images of the bag', C: 'Video or images to show the features of it\nIf you are doing images please can we get some macro shots too?', D: '12th October' },
  { n: 18, A: `Locking carabiner${NBSP}`, B: 'Showing different locking types', C: 'Video for social media and website', D: '19th November' },
  { n: 19, A: 'Pro Shoot - September', B: 'Product shoot indoor- Brief to be finalised 1st week September.', D: '1st week October /Nov' },
  { n: 20, A: 'Pro Shoot November – 2nd and 3rd', B: 'Kinisi KEY Sit Harness Features – these kinds of videos to go over the features and uses of each product', C: 'Long form videos for YT', D: '7th December' },
  { n: 21, B: 'We will also probably add in use shots of the products.', C: 'Cut down for IG/FB reel format – shorter version with key features only' },
  { n: 23, B: '1.Fidus 6.5 mm Retrieval Loop', boldB: true },
  { n: 24, B: '2.Fidus 10mm Loop', boldB: true },
  { n: 25, B: '3. Fidus 8.5 mm Loop', boldB: true },
  { n: 26, B: '4. Fidus 8.5 mm Loop' },
  { n: 27, B: '5. Tryggr Thimble' },
  { n: 28, B: '6. Tryggr Thimble Vario', boldB: true },
]

const plan = planImport(DMM, { year: 2026, today: '2026-09-28' })
const ws = title => plan.workstreams.find(w => w.title === title)
const titles = w => w.deliverables.map(d => d.title)

describe('reading DMM\'s worklist', () => {
  it('makes one workstream per product, in order', () => {
    expect(productBlocks(DMM).map(b => b.product)).toHaveLength(9)
    expect(plan.workstreams.map(w => w.title)).toEqual([
      'Cams', 'Trad videos', 'Pink Campaign', 'Winter - ice axes', 'Durolock', 'Flight Bag', 'Locking carabiner',
      'Pro Shoot - September', 'Pro Shoot November – 2nd and 3rd',
    ])
  })

  it('names a product with no deliverables from its brief', () => {
    expect(ws('Cams').deliverables).toEqual([expect.objectContaining({
      title: 'Storyboard, shot list, briefing teams and Russell', due: { due_kind: 'month', due_month: '2026-09' },
    })])
    expect(ws('Pro Shoot - September').deliverables[0]).toMatchObject({
      title: 'Product shoot indoor',
      due: { due_kind: 'window', due_date: '2026-11-07', due_label: '1st week October /Nov' },
    })
  })

  it('makes "1 video per week" recurring', () => {
    expect(ws('Trad videos').deliverables).toEqual([expect.objectContaining({
      title: '1 video per week to be published', due: { due_kind: 'recurring', cadence: 'weekly', due_date: null },
    })])
  })

  it('gives each deliverable line the product\'s deadline', () => {
    expect(ws('Pink Campaign').deliverables.map(d => [d.title, d.due])).toEqual([
      ['Website product images including macros', { due_kind: 'exact', due_date: '2026-09-17' }],
      ['Images for social media launch post- anything creative', { due_kind: 'exact', due_date: '2026-09-17' }],
      ['Any other images/video we can take while shooting that I can use for socials', { due_kind: 'exact', due_date: '2026-09-17' }],
    ])
  })

  it('makes one deliverable per ice axe, sharing the content list, plus the engineer video', () => {
    const axes = ws('Winter - ice axes')
    expect(axes.deliverables.map(d => [d.title, d.due.due_date])).toEqual([
      ['Cortex', '2026-10-07'], ['Apex', '2026-11-01'], ['Vertex', '2026-11-16'],
      ['Spire Tech', '2026-12-01'], ['Spire', '2026-12-01'], ['Flux', '2026-12-08'], ['Video with engineer', null],
    ])
    expect(axes.deliverables[0].format).toBe('Macro Images; Videos/images of ice axes to talk about the features; micro video shots')
    expect(axes.deliverables[6].internal_notes).toBe('From the worklist: will try to film it and send it for editing')
    expect(axes.brief).toBe("Showcase the features of each ice axe\nFrom the client: Can the background or something be different in each axe so it doesn't get boring?")
  })

  it('keeps the client\'s questions as notes on the brief, not deliverables', () => {
    expect(titles(ws('Flight Bag'))).toEqual(['Video or images to show the features of it'])
    expect(ws('Flight Bag').brief).toContain('From the client: If you are doing images please can we get some macro shots too?')
  })

  it('makes one deliverable per listed product, the duplicate once', () => {
    const pro = ws('Pro Shoot November – 2nd and 3rd')
    expect(titles(pro)).toEqual(['Fidus 6.5 mm Retrieval Loop', 'Fidus 10mm Loop', 'Fidus 8.5 mm Loop', 'Tryggr Thimble', 'Tryggr Thimble Vario'])
    expect(pro.deliverables[0]).toMatchObject({
      format: 'Long form videos for YT; Cut down for IG/FB reel format – shorter version with key features only',
      due: { due_kind: 'exact', due_date: '2026-12-07' },
    })
    expect(pro.brief).toContain('We will also probably add in use shots of the products.')
  })

  it('leaves undated work undated', () => {
    expect(ws('Durolock').deliverables[0].due).toEqual({ due_kind: 'exact', due_date: null })
  })

  it('lists every assumption for the dry run', () => {
    expect(plan.assumptions).toEqual([
      'Cams: no deliverables listed — one named from its brief, “Storyboard, shot list, briefing teams and Russell”',
      'Pink Campaign: 3 items were due before today and will show as overdue — pass --approved "Pink Campaign" if they\'re done',
      'Pro Shoot - September: “1st week October /Nov” read as a window ending 7 Nov 2026 (the later month named)',
      'Pro Shoot - September: no deliverables listed — one named from its brief, “Product shoot indoor”',
      'Pro Shoot November – 2nd and 3rd: “Fidus 8.5 mm Loop” is listed twice — imported once',
      'Pro Shoot November – 2nd and 3rd: bold on items 1, 2, 3, 6 is ignored',
      'Everything imported is hidden from the client — pass --visible to show it',
    ])
  })

  it('imports hidden and planned unless told otherwise', () => {
    const all = plan.workstreams.flatMap(w => w.deliverables)
    expect(all).toHaveLength(21)
    expect(all.every(d => d.client_visible === false && d.status === 'planned')).toBe(true)
    const shown = planImport(DMM, { year: 2026, visible: true, approved: ['pink campaign'] })
    expect(shown.workstreams.flatMap(w => w.deliverables).every(d => d.client_visible)).toBe(true)
    expect(shown.workstreams.find(w => w.title === 'Pink Campaign')).toMatchObject({ status: 'complete' })
    expect(shown.workstreams.find(w => w.title === 'Pink Campaign').deliverables.every(d => d.status === 'approved')).toBe(true)
    expect(planImport(DMM, { year: 2026, approved: ['Pink'] }).assumptions).toContain('--approved "Pink" matches no product in the sheet')
  })
})

describe('parseWhen', () => {
  it('reads the ways the sheet writes dates', () => {
    expect(parseWhen('17th September', 2026).due).toEqual({ due_kind: 'exact', due_date: '2026-09-17' })
    expect(parseWhen('1 Dec', 2026).due).toEqual({ due_kind: 'exact', due_date: '2026-12-01' })
    expect(parseWhen('September', 2026).due).toEqual({ due_kind: 'month', due_month: '2026-09' })
    expect(parseWhen('2nd week of March', 2027).due).toEqual({ due_kind: 'window', due_date: '2027-03-14', due_label: '2nd week of March' })
    expect(parseWhen('5th week February', 2026).due.due_date).toBe('2026-02-28')
  })

  it('keeps anything else as words', () => {
    expect(parseWhen('when the client is ready', 2026)).toEqual({
      due: { due_kind: 'exact', due_date: null, due_label: 'when the client is ready' },
      assumption: '“when the client is ready” isn\'t a date I can read — kept as words, no date',
    })
  })
})
