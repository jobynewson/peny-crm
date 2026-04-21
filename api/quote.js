// api/quote.js — Public client-facing budget/quote page
import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { token } = req.query
  if (!token) return res.status(400).json({ error: 'Token required' })

  const sql = neon(process.env.VITE_DATABASE_URL)
  const rows = await sql`
    SELECT b.id, b.name, b.sections, b.markup, b.custom_pct, b.vat, b.insurance,
           b.travel_rate, b.prep_rate, b.discount, b.notes, b.prepared_by, b.quote_email,
           b.signed_off, b.created_at,
           c.first_name, c.last_name, c.company,
           s.company_name, s.address, s.email, s.phone, s.website, s.vat_number
    FROM budgets b
    LEFT JOIN contacts c ON c.id = b.client_id
    LEFT JOIN settings s ON s.user_id = b.user_id
    WHERE b.quote_token = ${token}
    LIMIT 1
  `
  if (!rows[0]) return res.status(404).json({ error: 'Quote not found' })

  const b = rows[0]
  let sections = b.sections
  if (typeof sections === 'string') { try { sections = JSON.parse(sections) } catch { sections = [] } }

  return res.status(200).json({
    budget: {
      name: b.name, notes: b.notes, prepared_by: b.prepared_by,
      markup: b.markup, custom_pct: b.custom_pct, vat: b.vat,
      insurance: b.insurance, travel_rate: b.travel_rate, prep_rate: b.prep_rate,
      discount: b.discount, signed_off: b.signed_off, created_at: b.created_at,
    },
    sections: (sections||[]).filter(s => s.enabled),
    client: b.first_name ? { name: `${b.first_name} ${b.last_name}`, company: b.company } : null,
    studio: { name: b.company_name, address: b.address, email: b.email, phone: b.phone, website: b.website, vat_number: b.vat_number },
  })
}
