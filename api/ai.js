// api/ai.js
// POST /api/ai — extracts project + client data from email thread using Claude
//
// Slate staff only. It spends the studio's Anthropic key on whatever text it's
// given, so it must never answer an anonymous caller or a client portal
// account. Same-origin only: no CORS headers.

import { neon } from '@neondatabase/serverless'
import { verifyClerkUser } from './_auth.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { error } = await verifyClerkUser(req, neon(process.env.VITE_DATABASE_URL))
  if (error) return res.status(error.status).json({ error: error.message })

  const { text } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  const prompt = `You are helping a video production company extract structured project information from an email thread or brief.

Extract the following information and return ONLY valid JSON with no preamble, markdown, or explanation.

Return this exact structure:
{
  "project_name": "string — concise descriptive name, e.g. 'Red Bull MTB Highlight Film'",
  "brief": "string — 2-4 sentence summary of the project objectives, deliverables requested, audience, and tone. Write in plain English as if briefing a producer.",
  "shoot_start": "YYYY-MM-DD or null",
  "shoot_end": "YYYY-MM-DD or null",
  "location": "string or null — location name/area",
  "deliverables": ["array of strings — each a specific deliverable, e.g. '3x 30s social cuts', '1x 3min hero film'"],
  "client": {
    "first_name": "string",
    "last_name": "string",
    "company": "string or null",
    "email": "string or null",
    "phone": "string or null",
    "role": "string or null — their job title if mentioned"
  },
  "budget_notes": "string or null — any budget figures or constraints mentioned",
  "notes": "string or null — anything else useful: special requirements, tone references, key contacts"
}

If a field cannot be determined from the text, use null. For dates, infer the most likely year based on context.

EMAIL THREAD / BRIEF:
${text.slice(0, 8000)}`

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
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return res.status(502).json({ error: 'AI extraction failed' })
    }

    const data = await response.json()
    const raw = data.content?.[0]?.text || ''

    // Strip any accidental markdown fences
    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    return res.status(200).json(parsed)
  } catch (err) {
    console.error('AI error:', err)
    return res.status(500).json({ error: 'Failed to parse AI response' })
  }
}
