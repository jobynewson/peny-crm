// scripts/convert-planning-cards.js
//
// ONE-OFF migration: convert legacy Moodboard cards (projects.planning_cards
// jsonb) into canvas_items on each project's canvas. Throwaway — not wired into
// the app or CI. Run manually against the target DB:
//
//   VITE_DATABASE_URL=postgres://… node scripts/convert-planning-cards.js          # dry run (default)
//   VITE_DATABASE_URL=postgres://… node scripts/convert-planning-cards.js --apply  # actually writes
//
// Dry run logs exactly what it WOULD convert and writes nothing. Confirm the
// counts look right, then re-run with --apply. It does NOT touch the
// planning_cards column — dropping that is a separate, later step.

import { neon } from '@neondatabase/serverless'
import { fetchLinkPreview } from '../api/_preview.js'

const APPLY = process.argv.includes('--apply')
const DEFAULT_NOTE_COLOR = '#FFF8C5'

// Simple grid: 240px cells, wrap every 4, with a little gap and margin.
const CELL = 260
const COLS = 4
const MARGIN = 40
function gridPos(i) {
  return {
    x: MARGIN + (i % COLS) * CELL,
    y: MARGIN + Math.floor(i / COLS) * 240,
  }
}

async function main() {
  const url = process.env.VITE_DATABASE_URL
  if (!url) { console.error('Set VITE_DATABASE_URL'); process.exit(1) }
  const sql = neon(url)

  console.log(APPLY ? '🟢 APPLY mode — writing canvas_items\n' : '🟡 DRY RUN — nothing will be written (pass --apply to commit)\n')

  const projects = await sql`
    SELECT id, user_id, name, planning_cards FROM projects
    WHERE planning_cards IS NOT NULL AND jsonb_array_length(planning_cards) > 0
  `
  console.log(`Found ${projects.length} project(s) with legacy planning cards.\n`)

  const totals = { projects: 0, note: 0, image: 0, link: 0, skipped: 0, canvasesCreated: 0 }

  for (const p of projects) {
    const cards = Array.isArray(p.planning_cards) ? p.planning_cards : []
    if (!cards.length) continue

    // Find or create the project's canvas (same scoping as getCanvasForProject).
    let canvas = (await sql`
      SELECT id FROM canvases WHERE user_id = ${p.user_id} AND project_id = ${p.id} LIMIT 1
    `)[0]
    if (!canvas) {
      if (APPLY) {
        canvas = (await sql`
          INSERT INTO canvases (user_id, name, project_id)
          VALUES (${p.user_id}, ${p.name}, ${p.id}) RETURNING id
        `)[0]
      } else {
        canvas = { id: '(new canvas)' }
      }
      totals.canvasesCreated++
    }

    // Start z above whatever already lives on the canvas.
    let z = 0
    if (canvas.id !== '(new canvas)') {
      const row = (await sql`SELECT COALESCE(MAX(z), 0) AS maxz FROM canvas_items WHERE canvas_id = ${canvas.id}`)[0]
      z = Number(row?.maxz || 0)
    }

    console.log(`▸ ${p.name} (${cards.length} card[s]) → canvas ${canvas.id}`)
    totals.projects++

    let i = 0
    for (const card of cards) {
      const { x, y } = gridPos(i)
      z += 1
      let item = null

      if (card.type === 'note') {
        item = { kind: 'note', x, y, w: 220, h: 140, z, content: card.content || '', color: DEFAULT_NOTE_COLOR, image_url: null, url: null }
        totals.note++
        console.log(`    • note  "${(card.content || '').slice(0, 40).replace(/\n/g, ' ')}"`)
      } else if (card.type === 'image') {
        item = { kind: 'image', x, y, w: 240, h: 180, z, content: card.caption || null, color: null, image_url: card.url || null, url: null }
        totals.image++
        console.log(`    • image ${card.url || '(no url)'}`)
      } else if (card.type === 'video') {
        let preview = null
        try { preview = await fetchLinkPreview(card.url) } catch (e) { /* fall back to bare link */ }
        item = { kind: 'link', x, y, w: 280, h: 120, z, content: preview?.title || card.title || '', color: null, image_url: preview?.image || null, url: card.url || null }
        totals.link++
        console.log(`    • link  ${card.url || '(no url)'}${preview?.title ? `  [${preview.title.slice(0, 40)}]` : '  (no preview)'}`)
      } else {
        totals.skipped++
        console.log(`    • SKIP unknown card type: ${card.type}`)
        i++
        continue
      }

      if (APPLY) {
        await sql`
          INSERT INTO canvas_items (canvas_id, kind, x, y, w, h, z, content, color, image_url, url)
          VALUES (${canvas.id}, ${item.kind}, ${item.x}, ${item.y}, ${item.w}, ${item.h}, ${item.z},
                  ${item.content}, ${item.color}, ${item.image_url}, ${item.url})
        `
      }
      i++
    }
  }

  console.log('\n── Summary ─────────────────────────────')
  console.log(`Projects converted:  ${totals.projects}`)
  console.log(`Canvases created:    ${totals.canvasesCreated}`)
  console.log(`Notes:               ${totals.note}`)
  console.log(`Images:              ${totals.image}`)
  console.log(`Links (from video):  ${totals.link}`)
  console.log(`Skipped (unknown):   ${totals.skipped}`)
  console.log(APPLY ? '\n✅ Applied.' : '\nDry run only — re-run with --apply to write.')
}

main().catch(e => { console.error(e); process.exit(1) })
