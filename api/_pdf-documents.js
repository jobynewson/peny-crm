// api/_pdf-documents.js
// Routes behind /api/pdf-documents: Tools › PDF Generator, the team's shared
// library of saved one-page documents. Everyone on staff can read the library;
// viewers are read-only (access: 'editor' on the writes). Rows are scoped to
// the workspace owner like the rest of the shared data, and created_by /
// updated_by record whose Clerk id saved them.
//
//   GET    /api/pdf-documents        → { documents: [{ id, title, theme, updated_at, updated_by_name }] }
//   GET    /api/pdf-documents/:id    → { document }
//   POST   /api/pdf-documents        → { document }
//   PUT    /api/pdf-documents/:id    → { document }
//   DELETE /api/pdf-documents/:id    → { ok }
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { UUID, fail, invalid, readBody, workspaceId } from './_api.js'

export const THEMES = ['dark', 'light']
// The layout tick boxes: a condensed header, a condensed footer, and a condensed page.
export const FLAGS = ['condensedHeader', 'condensedFooter', 'condensedPage']
export const BLOCK_TYPES = ['heading', 'text', 'bullets', 'table']
export const LIMITS = { title: 200, label: 60, subtitle: 300, date: 60, preparedBy: 120, emails: 300, blocks: 60, text: 5000, items: 40, rows: 30, cell: 300, bytes: 100_000 }

export const ROUTES = [
  { method: 'GET',    pattern: /^pdf-documents$/,                                    handler: listDocuments },
  { method: 'GET',    pattern: new RegExp(`^pdf-documents/(?<id>${UUID})$`),         handler: getDocument },
  { method: 'POST',   pattern: /^pdf-documents$/,                                    handler: createDocument, access: 'editor' },
  { method: 'PUT',    pattern: new RegExp(`^pdf-documents/(?<id>${UUID})$`),         handler: updateDocument, access: 'editor' },
  { method: 'DELETE', pattern: new RegExp(`^pdf-documents/(?<id>${UUID})$`),         handler: deleteDocument, access: 'editor' },
]

const isStr = (v, max) => typeof v === 'string' && v.length <= max

// Returns { value } or { field, message }. Only known keys survive, so the
// stored JSON is always the shape the page renders.
export function cleanDocument(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { field: 'body', message: 'Request body is not valid JSON' }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > LIMITS.title) return { field: 'title', message: `Give the document a title (up to ${LIMITS.title} characters)` }
  const theme = body.theme ?? 'dark'
  if (!THEMES.includes(theme)) return { field: 'theme', message: 'theme must be dark or light' }

  const c = body.content
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { field: 'content', message: 'content must be an object' }
  const label = c.label ?? '', subtitle = c.subtitle ?? '', date = c.date ?? ''
  const preparedBy = c.preparedBy ?? '', emails = c.emails ?? ''
  if (!isStr(label, LIMITS.label)) return { field: 'content.label', message: `Label is up to ${LIMITS.label} characters` }
  if (!isStr(subtitle, LIMITS.subtitle)) return { field: 'content.subtitle', message: `Subtitle is up to ${LIMITS.subtitle} characters` }
  if (!isStr(date, LIMITS.date)) return { field: 'content.date', message: `Date is up to ${LIMITS.date} characters` }
  if (!isStr(preparedBy, LIMITS.preparedBy)) return { field: 'content.preparedBy', message: `Prepared by is up to ${LIMITS.preparedBy} characters` }
  if (!isStr(emails, LIMITS.emails)) return { field: 'content.emails', message: `Email addresses are up to ${LIMITS.emails} characters` }
  for (const k of FLAGS) if (c[k] !== undefined && typeof c[k] !== 'boolean') return { field: `content.${k}`, message: `${k} must be true or false` }
  if (!Array.isArray(c.blocks) || c.blocks.length > LIMITS.blocks) return { field: 'content.blocks', message: `A document has up to ${LIMITS.blocks} blocks` }

  const blocks = []
  for (const b of c.blocks) {
    if (!b || typeof b !== 'object' || !BLOCK_TYPES.includes(b.type)) return { field: 'content.blocks', message: 'Unknown block type' }
    if (b.type === 'heading' || b.type === 'text') {
      if (!isStr(b.text ?? '', LIMITS.text)) return { field: 'content.blocks', message: `Text is up to ${LIMITS.text} characters` }
      blocks.push({ type: b.type, text: b.text ?? '' })
    } else if (b.type === 'bullets') {
      if (!Array.isArray(b.items) || b.items.length > LIMITS.items || !b.items.every(i => isStr(i, LIMITS.cell))) {
        return { field: 'content.blocks', message: `A list has up to ${LIMITS.items} items of up to ${LIMITS.cell} characters` }
      }
      blocks.push({ type: 'bullets', items: b.items })
    } else {
      const ok = Array.isArray(b.rows) && b.rows.length <= LIMITS.rows
        && b.rows.every(r => Array.isArray(r) && r.length === 2 && r.every(x => isStr(x, LIMITS.cell)))
      if (!ok) return { field: 'content.blocks', message: `A table has up to ${LIMITS.rows} rows of two cells` }
      blocks.push({ type: 'table', rows: b.rows })
    }
  }

  const content = { label, subtitle, date, preparedBy, emails, blocks }
  for (const k of FLAGS) content[k] = c[k] === true
  if (JSON.stringify(content).length > LIMITS.bytes) return { field: 'content', message: 'This document is too large to save' }
  return { value: { title, theme, content } }
}

async function listDocuments(req, res, { sql }) {
  const ws = await workspaceId(sql)
  const documents = await sql`
    SELECT d.id, d.title, d.theme, d.updated_at, u.name AS updated_by_name
    FROM pdf_documents d
    LEFT JOIN app_users u ON u.clerk_id = d.updated_by
    WHERE d.user_id = ${ws}
    ORDER BY d.updated_at DESC
  `
  return res.status(200).json({ documents })
}

async function getDocument(req, res, { sql, params }) {
  const ws = await workspaceId(sql)
  const [document] = await sql`
    SELECT id, title, theme, content, created_by, updated_by, created_at, updated_at
    FROM pdf_documents WHERE id = ${params.id} AND user_id = ${ws}
  `
  if (!document) return fail(res, 404, 'not_found', 'That document no longer exists')
  return res.status(200).json({ document })
}

async function createDocument(req, res, { sql, user }) {
  const body = readBody(req)
  const { value, field, message } = cleanDocument(body)
  if (!value) return invalid(res, field, message)
  const ws = await workspaceId(sql)
  const [document] = await sql`
    INSERT INTO pdf_documents (user_id, title, theme, content, created_by, updated_by)
    VALUES (${ws}, ${value.title}, ${value.theme}, ${JSON.stringify(value.content)}::jsonb, ${user.clerk_id}, ${user.clerk_id})
    RETURNING id, title, theme, content, created_by, updated_by, created_at, updated_at
  `
  return res.status(201).json({ document })
}

async function updateDocument(req, res, { sql, user, params }) {
  const body = readBody(req)
  const { value, field, message } = cleanDocument(body)
  if (!value) return invalid(res, field, message)
  const ws = await workspaceId(sql)
  const [document] = await sql`
    UPDATE pdf_documents
    SET title = ${value.title}, theme = ${value.theme}, content = ${JSON.stringify(value.content)}::jsonb,
        updated_by = ${user.clerk_id}, updated_at = NOW()
    WHERE id = ${params.id} AND user_id = ${ws}
    RETURNING id, title, theme, content, created_by, updated_by, created_at, updated_at
  `
  if (!document) return fail(res, 404, 'not_found', 'That document no longer exists')
  return res.status(200).json({ document })
}

async function deleteDocument(req, res, { sql, params }) {
  const ws = await workspaceId(sql)
  const rows = await sql`DELETE FROM pdf_documents WHERE id = ${params.id} AND user_id = ${ws} RETURNING id`
  if (!rows.length) return fail(res, 404, 'not_found', 'That document no longer exists')
  return res.status(200).json({ ok: true })
}
