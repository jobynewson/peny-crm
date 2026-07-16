// api/generate-ra.js
// POST /api/generate-ra — generates a risk assessment from shoot + project data
import { neon } from '@neondatabase/serverless'
import { verifyAuthHeader } from './_auth.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let userId
  try {
    userId = (await verifyAuthHeader(req)).sub
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message })
  }

  const { shoot_id } = req.body
  if (!shoot_id) return res.status(400).json({ error: 'shoot_id required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  const sql = neon(process.env.VITE_DATABASE_URL)

  // Pull shoot + project data — user_id constraint prevents cross-user access
  const rows = await sql`
    SELECT sh.*, p.name AS project_name, p.brief AS project_brief, p.notes AS project_notes
    FROM shoots sh
    JOIN projects p ON p.id = sh.project_id
    WHERE sh.id = ${shoot_id} AND sh.user_id = ${userId}
    LIMIT 1
  `
  if (!rows[0]) return res.status(404).json({ error: 'Shoot not found' })
  const sh = rows[0]

  // Build context block for Claude
  const crew = Array.isArray(sh.crew) ? sh.crew.filter(c => c.name) : []
  const hotels = Array.isArray(sh.hotels) ? sh.hotels : []
  const locations = Array.isArray(sh.locations) ? sh.locations : []
  const schedule = Array.isArray(sh.schedule) ? sh.schedule : []

  const context = `PROJECT CONTEXT
Project: ${sh.project_name || 'Untitled'}
Brief: ${sh.project_brief || '(none)'}
Project notes: ${sh.project_notes || '(none)'}

SHOOT DETAILS
Date: ${sh.shoot_date || '(not set)'}
General call: ${sh.general_call || '(not set)'}
Primary location: ${sh.location_name || '(not set)'}
Address: ${sh.location_address || sh.location_map_link || '(not set)'}
Parking: ${sh.parking_notes || '(none)'}
Nearest transport: ${sh.nearest_transport || '(none)'}
Weather forecast: ${sh.weather_text || '(not fetched)'}
${locations.length ? 'Additional locations: ' + locations.map(l => `${l.name||''}${l.address?' ('+l.address+')':''}`).join('; ') : ''}

CREW (${crew.length})
${crew.map(c => `- ${c.name}${c.role?' — '+c.role:''}`).join('\n') || '(none listed)'}

${schedule.length ? 'SCHEDULE / RUN OF SHOW\n' + schedule.map(r => `- ${r.time||''}: ${r.description||''}`).join('\n') : ''}

${hotels.length ? 'ACCOMMODATION\n' + hotels.map(h => `- ${h.name||''}${h.address?' ('+h.address+')':''}`).join('\n') : ''}

EMERGENCY SERVICES
Hospital: ${sh.nearest_hospital_name || 'not set'}
Police: ${sh.nearest_police_name || 'not set'}
Fire: ${sh.nearest_fire_name || 'not set'}

${sh.notes ? 'SHOOT NOTES\n' + sh.notes : ''}
${sh.hs_notes ? 'EXISTING H&S NOTES\n' + sh.hs_notes : ''}`

  const prompt = `You are generating a UK-standard production risk assessment for a professional video/film shoot. Use the context below to identify real, specific hazards — not generic boilerplate.

${context}

Generate a risk assessment as valid JSON with no preamble, markdown, or explanation. The structure must be exactly:

{
  "hazards": [
    {
      "hazard": "string — specific hazard (e.g. 'Slips, trips and falls on uneven ground at Pen y Fan ridgeline')",
      "who_at_risk": "string — who could be harmed (e.g. 'All crew, talent, especially camera operators carrying kit')",
      "existing_controls": "string — controls already in place (e.g. 'Crew briefed pre-shoot; appropriate footwear mandatory; weather monitored')",
      "likelihood": 1-5,
      "severity": 1-5,
      "additional_controls": "string — further controls needed to reduce residual risk (e.g. 'Second person to spot when moving heavy kit across uneven terrain; first aid kit on location')",
      "residual_likelihood": 1-5,
      "residual_severity": 1-5,
      "responsible": "string — role responsible (e.g. 'Producer', 'DoP', 'Drone Pilot', 'All crew')"
    }
  ],
  "notes": "string or null — any overall notes about the assessment, e.g. weather contingencies or unusual circumstances"
}

REQUIREMENTS:
- Generate 6-12 hazards depending on shoot complexity.
- Be specific to THIS shoot. If the brief mentions mountain biking, include MTB-specific hazards (impact, high-speed terrain, rider welfare). If the location is urban, include traffic. If drone is in the crew, include drone-specific hazards. If weather forecast shows rain/cold/heat, include weather-specific hazards.
- Likelihood: 1=rare, 2=unlikely, 3=possible, 4=likely, 5=almost certain
- Severity: 1=minor (first aid), 2=moderate (lost-time injury), 3=serious (hospital), 4=major (long-term harm), 5=catastrophic (fatal/life-changing)
- Residual ratings should be LOWER than initial ratings after additional controls.
- Cover common production hazards (manual handling, electrical, working at height, long hours/fatigue, lone working, vehicle movements) plus shoot-specific ones.
- "responsible" should match actual crew roles from the shoot where possible.

Output ONLY the JSON object.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return res.status(502).json({ error: 'AI generation failed' })
    }

    const data = await response.json()
    const raw = data.content?.[0]?.text || ''
    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    return res.status(200).json(parsed)
  } catch (err) {
    console.error('RA generation error:', err)
    return res.status(500).json({ error: 'Failed to generate risk assessment' })
  }
}
