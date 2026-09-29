// scripts/import-worklist.js
//
// Imports a client's worklist spreadsheet (.xlsx) into Retainers: one
// workstream per product, its deliverables, due dates and the client's notes.
// How the sheet is read is in _worklist-sheet.js.
//
//   DATABASE_URL=… node scripts/import-worklist.js Worklists.xlsx --company "DMM"            # dry run
//   DATABASE_URL=… node scripts/import-worklist.js Worklists.xlsx --company "DMM" --apply    # writes
//
//   --year 2026              the year for dates written without one (default: this year, London)
//   --visible                show the imported deliverables to the client (default: hidden)
//   --approved "Pink Campaign"   a product whose items are already done: imported as approved,
//                            its workstream complete (repeat for more than one)
//
// The dry run writes nothing: it prints the plan and every assumption made, so
// check it before --apply. Without DATABASE_URL it still prints the plan.
// Re-running is safe: a workstream the company already has (same title) is
// skipped. The company is matched by name (ignoring case) or created.

import ExcelJS from 'exceljs'
import { neon } from '@neondatabase/serverless'
import { planImport, clean } from './_worklist-sheet.js'
import { checkPlan, currentState, applyPlan } from './_worklist-apply.js'
import { workspaceId } from '../api/_api.js'
import { londonDate } from '../api/_dates.js'
import { dueDisplay, normaliseDue } from '../api/_retainer-rules.js'

function parseArgs(argv) {
  const args = { file: null, company: null, apply: false, visible: false, year: Number(londonDate().slice(0, 4)), approved: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--visible') args.visible = true
    else if (a === '--company') args.company = argv[++i]
    else if (a === '--year') args.year = Number(argv[++i])
    else if (a === '--approved') args.approved.push(argv[++i])
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else args.file = a
  }
  if (!args.file) throw new Error('Which spreadsheet? node scripts/import-worklist.js <file.xlsx> --company "<name>"')
  if (!args.company) throw new Error('Which company? Add --company "<name>"')
  if (!Number.isInteger(args.year) || args.year < 2000 || args.year > 2100) throw new Error('--year needs a year, e.g. 2026')
  return args
}

// A cell's text, whatever Excel stored: plain, rich text, a formula's result,
// a link's text or a date. Merged cells count once, on their first cell.
function cellText(cell) {
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) return null
  const v = cell.value
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('')
    if ('result' in v) return v.result == null ? null : String(v.result)
    if ('text' in v) return String(v.text)
    return null
  }
  return String(v)
}

async function readRows(file) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const sheet = workbook.worksheets[0]
  const rows = []
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    const at = c => cellText(row.getCell(c))
    rows.push({ n, A: at(1), B: at(2), C: at(3), D: at(4), boldB: !!row.getCell(2).font?.bold })
  })
  return rows
}

function printPlan(plan, { company, existing, today }) {
  const out = []
  out.push('', 'Assumptions — check these before --apply:')
  for (const a of plan.assumptions) out.push(`  • ${a}`)
  out.push('')
  for (const w of plan.workstreams) {
    const skip = existing.has(w.title.toLowerCase())
    out.push(`${w.title}${w.status === 'complete' ? '  [complete]' : ''}${skip ? '  — already there, skipped' : ''}`)
    if (w.brief) for (const line of w.brief.split('\n')) out.push(`    ${line}`)
    for (const d of w.deliverables) {
      const due = normaliseDue(d.due)
      const when = due.error ? `?? ${due.error.message}` : dueDisplay(due, today)
      out.push(`  – ${d.title}  ·  ${when}${d.format ? `  ·  ${d.format}` : ''}${d.status === 'approved' ? '  ·  approved' : ''}${d.internal_notes ? `  ·  note: ${d.internal_notes}` : ''}`)
    }
  }
  const count = plan.workstreams.filter(w => !existing.has(w.title.toLowerCase()))
  out.push('', `${count.length} workstream(s), ${count.reduce((n, w) => n + w.deliverables.length, 0)} deliverable(s) to add for ${company ? `“${company.name}”` : 'a new company'}.`)
  console.log(out.join('\n'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const rows = await readRows(args.file)
  const today = londonDate()
  const plan = planImport(rows, { year: args.year, visible: args.visible, approved: args.approved, today })
  const problems = checkPlan(plan)

  const url = process.env.DATABASE_URL
  const sql = url ? neon(url) : null
  const ws = sql ? await workspaceId(sql) : null
  const state = sql ? await currentState(sql, { ws, companyName: args.company }) : { company: null, existing: new Set() }

  console.log(`Worklist import — ${clean(args.company)} — ${args.file} (dates in ${args.year})`)
  console.log(args.apply ? 'Writing.' : 'Dry run: nothing is written. Add --apply to write.')
  if (!sql) console.log('(No DATABASE_URL: showing the plan without checking what the database already has.)')
  printPlan(plan, { ...state, today })
  if (problems.length) {
    console.error(`\nThe plan has problems, so nothing can be written:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  if (!args.apply) return
  if (!sql) throw new Error('--apply needs DATABASE_URL')

  const result = await applyPlan(sql, { ws, companyName: args.company, plan })
  console.log(`\nDone: ${result.createdCompany ? 'created' : 'found'} “${result.company.name}”, added ${result.workstreams} workstream(s) and ${result.deliverables} deliverable(s).`)
  if (result.skipped.length) console.log(`Skipped (already there): ${result.skipped.join(', ')}`)
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
