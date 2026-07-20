// scripts/seed-loop-prospects.js
//
// ONE-OFF seed: load the researched Shrewsbury-area prospect list and sector
// playbook from `Loop_Creative_outbound_tracker.xlsx` into the CRM as Loop
// records. Throwaway — not wired into the app, not a serverless function, not on
// any runtime import path. Run manually against the target DB:
//
//   VITE_DATABASE_URL=postgres://… node scripts/seed-loop-prospects.js            # dry run (default)
//   VITE_DATABASE_URL=postgres://… node scripts/seed-loop-prospects.js --apply    # actually writes
//
// Dry run reads the sheet + the DB and prints exactly what it WOULD insert/skip,
// writing nothing. Idempotent: prospects are keyed on (brand='loop', lower(company))
// and sector angles on (brand='loop', lower(sector)) — re-running skips anything
// already present, so it never duplicates.
//
// Mapping (Prospects sheet -> contacts):
//   Business -> company            Sector -> sector (kept verbatim)
//   Tier -> tier (A|B|C)           Why they fit -> fit_note
//   Pitch angle -> pitch_angle     Base / area -> area
//   Phone -> phone (blank=null)    Website -> website (blank=null)
//   Rating -> source_rating        Reviews -> source_review_count
//   Priority -> priority           Status -> lifecycle_stage
//   Owner -> owner (blank=null)    Last contact -> last_contacted_at (blank=null)
//   Next action -> next_action     Notes -> notes[] (contact note)
//   (brand='loop', type='brand', status='Warm')
//
// Priority note: the sheet numbers 1..5 with 1 = top ("1 - Hero"). The app orders
// the work queue by a "higher int = more important" priority, so we invert:
// priority = 6 - N (Hero->5 … Reach->1). Unseeded/manual prospects default to 0.

import { readFileSync } from 'node:fs'
import xlsx from 'xlsx'
import { neon } from '@neondatabase/serverless'

const XLSX_PATH = process.argv.find(a => a.endsWith('.xlsx')) || './Loop_Creative_outbound_tracker.xlsx'
const APPLY = process.argv.includes('--apply')

// ── Pure transforms (exported so the mapping can be validated offline) ─────────

const clean = v => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// Sheet Status -> lifecycle_stage (tolerant; defaults to 'prospect').
const STATUS_MAP = {
  'not started': 'prospect', 'prospect': 'prospect', 'to contact': 'prospect',
  'contacted': 'contacted', 'in touch': 'contacted', 'reached out': 'contacted',
  'engaged': 'engaged', 'in conversation': 'engaged',
  'proposal': 'proposal', 'quoted': 'proposal', 'proposal sent': 'proposal',
  'won': 'won', 'client': 'won', 'signed': 'won',
  'lost': 'lost', 'dead': 'lost',
  'nurture': 'nurture', 'later': 'nurture',
}
export function toLifecycleStage(status) {
  const s = (clean(status) || '').toLowerCase()
  return STATUS_MAP[s] || 'prospect'
}

// "1 - Hero" -> 5, "5 - Reach" -> 1 (higher int = more important). Blank -> 0.
export function toPriority(raw) {
  const m = String(raw ?? '').match(/\d+/)
  if (!m) return 0
  const n = parseInt(m[0], 10)
  if (!Number.isFinite(n) || n < 1 || n > 5) return 0
  return 6 - n
}

export function toTier(raw) {
  const s = (clean(raw) || '').toUpperCase().charAt(0)
  return ['A', 'B', 'C'].includes(s) ? s : null
}

export function toNumber(raw) {
  if (raw === '' || raw === null || raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function toRating(raw) {
  const n = toNumber(raw)
  if (n === null) return null
  return Math.round(n * 10) / 10   // one decimal to fit NUMERIC(2,1)
}

export function toDate(raw) {
  if (raw === '' || raw === null || raw === undefined) return null
  if (raw instanceof Date) return raw.toISOString()
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// Map one Prospects row to a contacts insert payload (brand/user filled by caller).
export function mapProspect(row) {
  const company = clean(row['Business'])
  if (!company) return null
  const notesText = clean(row['Notes'])
  return {
    company,
    sector:              clean(row['Sector']),
    tier:                toTier(row['Tier']),
    fit_note:            clean(row['Why they fit']),
    pitch_angle:         clean(row['Pitch angle (opening hook)']),
    area:                clean(row['Base / area']),
    phone:               clean(row['Phone']),
    website:             clean(row['Website']),
    source_rating:       toRating(row['Rating']),
    source_review_count: toNumber(row['Reviews']) == null ? null : Math.round(toNumber(row['Reviews'])),
    priority:            toPriority(row['Priority']),
    lifecycle_stage:     toLifecycleStage(row['Status']),
    owner:               clean(row['Owner']),        // no Clerk mapping available -> usually null
    last_contacted_at:   toDate(row['Last contact']),
    next_action:         clean(row['Next action']),
    notes:               notesText ? [{ text: notesText, date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }] : [],
  }
}

// Map one Sector angles row to a sector_angles insert payload.
export function mapAngle(row) {
  const sector = clean(row['Sector'])
  if (!sector) return null
  return {
    sector,
    tier:         clean(row['Tier']),   // free text here ("A - retainer", "A/B", …)
    why_video:    clean(row['Why they need video']),
    opening_hook: clean(row['Opening hook (what you say first)']),
    offer:        clean(row['Offer to lead with']),
    best_time:    clean(row['Best time to pitch']),
    proof:        clean(row['Proof to show']),
  }
}

export function readSheets(path = XLSX_PATH) {
  const wb = xlsx.read(readFileSync(path))
  const prospects = xlsx.utils.sheet_to_json(wb.Sheets['Prospects'], { defval: '' })
  const angles = xlsx.utils.sheet_to_json(wb.Sheets['Sector angles'], { defval: '' })
  return { prospects, angles }
}

// ── Seed runner ────────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.VITE_DATABASE_URL || process.env.DATABASE_URL
  if (!url) { console.error('Set VITE_DATABASE_URL'); process.exit(1) }
  const sql = neon(url)

  console.log(APPLY ? '🟢 APPLY mode — writing Loop records\n' : '🟡 DRY RUN — nothing will be written (pass --apply to commit)\n')
  console.log('Reading', XLSX_PATH, '\n')

  const { prospects, angles } = readSheets()

  // Workspace owner id scopes every row, same as the app (getOrCreateWorkspace).
  const ws = (await sql`SELECT owner_id FROM workspace LIMIT 1`)[0]
  if (!ws) { console.error('No workspace row found — start the app once first.'); process.exit(1) }
  const userId = ws.owner_id

  const totals = { prospectsInserted: 0, prospectsSkipped: 0, anglesInserted: 0, anglesSkipped: 0, prospectsBad: 0 }

  // ── Sector angles first (so they're present when the list is worked) ──────────
  console.log('── Sector angles ───────────────────────────────')
  for (const raw of angles) {
    const a = mapAngle(raw)
    if (!a) continue
    const exists = (await sql`
      SELECT id FROM sector_angles
      WHERE user_id = ${userId} AND brand = 'loop' AND lower(sector) = lower(${a.sector}) LIMIT 1
    `)[0]
    if (exists) { totals.anglesSkipped++; console.log(`  = skip (exists)  ${a.sector}`); continue }
    console.log(`  + angle          ${a.sector}${a.tier ? ` [${a.tier}]` : ''}`)
    if (APPLY) {
      await sql`
        INSERT INTO sector_angles (user_id, brand, sector, tier, why_video, opening_hook, offer, best_time, proof)
        VALUES (${userId}, 'loop', ${a.sector}, ${a.tier}, ${a.why_video}, ${a.opening_hook}, ${a.offer}, ${a.best_time}, ${a.proof})
      `
    }
    totals.anglesInserted++
  }

  // ── Prospects ─────────────────────────────────────────────────────────────────
  console.log('\n── Prospects ───────────────────────────────────')
  for (const raw of prospects) {
    const p = mapProspect(raw)
    if (!p) { totals.prospectsBad++; continue }
    const exists = (await sql`
      SELECT id FROM contacts
      WHERE user_id = ${userId} AND brand = 'loop' AND lower(company) = lower(${p.company}) LIMIT 1
    `)[0]
    if (exists) { totals.prospectsSkipped++; console.log(`  = skip (exists)  ${p.company}`); continue }
    console.log(`  + ${p.lifecycle_stage.padEnd(9)} T${p.tier || '-'} P${p.priority}  ${p.company}${p.sector ? `  · ${p.sector}` : ''}`)
    if (APPLY) {
      await sql`
        INSERT INTO contacts (
          user_id, brand, type, status, company,
          sector, tier, fit_note, pitch_angle, area, phone, website,
          source_rating, source_review_count, priority, lifecycle_stage,
          owner, last_contacted_at, next_action, notes
        ) VALUES (
          ${userId}, 'loop', 'brand', 'Warm', ${p.company},
          ${p.sector}, ${p.tier}, ${p.fit_note}, ${p.pitch_angle}, ${p.area}, ${p.phone}, ${p.website},
          ${p.source_rating}, ${p.source_review_count}, ${p.priority}, ${p.lifecycle_stage},
          ${p.owner}, ${p.last_contacted_at}, ${p.next_action}, ${JSON.stringify(p.notes)}::jsonb
        )
      `
    }
    totals.prospectsInserted++
  }

  console.log('\n── Summary ─────────────────────────────────────')
  console.log(`Sector angles inserted: ${totals.anglesInserted}   skipped (already present): ${totals.anglesSkipped}`)
  console.log(`Prospects inserted:     ${totals.prospectsInserted}   skipped (already present): ${totals.prospectsSkipped}${totals.prospectsBad ? `   ignored (no name): ${totals.prospectsBad}` : ''}`)
  console.log(APPLY ? '\n✅ Applied.' : '\nDry run only — re-run with --apply to write.')
}

// Only run when invoked directly (so the pure transforms can be imported/tested).
if (process.argv[1] && process.argv[1].endsWith('seed-loop-prospects.js')) {
  main().catch(e => { console.error(e); process.exit(1) })
}
