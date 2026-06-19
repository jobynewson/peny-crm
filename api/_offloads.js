// api/_offloads.js
// Offload Log ingest — receives backup reports from Fence (our internal
// file-transfer tool). Not a Vercel function in its own right: the `_` prefix
// keeps it out of Vercel's function count (we're at the 12-function cap — see
// claude.md). It's reached via POST /api/offloads, which vercel.json rewrites to
// /api/portal?view=offloads; portal.js delegates here.
//
// Auth: shared secret in the Authorization header — Authorization: Bearer
// <FENCE_API_KEY> — matching the Bearer convention used by the cron routes.

const VERIFICATION_MODES = ['filename+size', 'xxh3']

const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0
const isBool = v => typeof v === 'boolean'
const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v)

// Validate the Fence payload. Returns an array of human-readable error strings
// (empty when valid) so the 400 response can name exactly what was wrong.
function validatePayload(body) {
  const errors = []
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['Request body must be a JSON object']
  }

  // Top-level required strings
  const requiredStrings = ['timestamp', 'year', 'industry', 'client', 'project', 'sourcePath', 'driveType', 'location']
  for (const key of requiredStrings) {
    if (!isNonEmptyString(body[key])) errors.push(`Missing or empty required field: ${key}`)
  }
  // timestamp must be a parseable ISO8601 date
  if (isNonEmptyString(body.timestamp) && Number.isNaN(Date.parse(body.timestamp))) {
    errors.push('Field "timestamp" must be a valid ISO8601 date string')
  }
  // notes is optional, but if present must be a string
  if (body.notes != null && typeof body.notes !== 'string') {
    errors.push('Field "notes" must be a string when provided')
  }
  if (!isBool(body.overallPassed)) errors.push('Field "overallPassed" must be a boolean')

  // backups — exactly two entries
  if (!Array.isArray(body.backups)) {
    errors.push('Field "backups" must be an array')
  } else if (body.backups.length !== 2) {
    errors.push(`Field "backups" must contain exactly two entries (received ${body.backups.length})`)
  } else {
    body.backups.forEach((b, i) => {
      const at = `backups[${i}]`
      if (!b || typeof b !== 'object' || Array.isArray(b)) { errors.push(`${at} must be an object`); return }
      if (!isNonEmptyString(b.label)) errors.push(`${at}.label is required`)
      if (!isNonEmptyString(b.driveName)) errors.push(`${at}.driveName is required`)
      if (!isNonEmptyString(b.destinationPath)) errors.push(`${at}.destinationPath is required`)
      if (!isNonEmptyString(b.verificationMode)) {
        errors.push(`${at}.verificationMode is required`)
      } else if (!VERIFICATION_MODES.includes(b.verificationMode)) {
        errors.push(`${at}.verificationMode must be one of: ${VERIFICATION_MODES.join(', ')}`)
      }
      if (!isFiniteNumber(b.totalFiles) || b.totalFiles < 0) errors.push(`${at}.totalFiles must be a non-negative number`)
      if (!isFiniteNumber(b.totalSizeBytes) || b.totalSizeBytes < 0) errors.push(`${at}.totalSizeBytes must be a non-negative number`)
      if (!isBool(b.passed)) errors.push(`${at}.passed must be a boolean`)

      if (!Array.isArray(b.folderResults)) {
        errors.push(`${at}.folderResults must be an array`)
      } else {
        b.folderResults.forEach((f, j) => {
          const fat = `${at}.folderResults[${j}]`
          if (!f || typeof f !== 'object' || Array.isArray(f)) { errors.push(`${fat} must be an object`); return }
          if (!isNonEmptyString(f.folder)) errors.push(`${fat}.folder is required`)
          if (!isBool(f.passed)) errors.push(`${fat}.passed must be a boolean`)
          if (!isFiniteNumber(f.fileCount) || f.fileCount < 0) errors.push(`${fat}.fileCount must be a non-negative number`)
        })
      }
    })
  }

  return errors
}

// Parse the request body whether Vercel handed us a parsed object or raw text.
function parseBody(req) {
  if (req.body == null) return null
  if (typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch { return undefined } // undefined ⇒ malformed JSON
  }
  return null
}

export async function handleOffloadIngest(req, res, sql) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Shared-secret auth (matches the cron Bearer convention).
  const expected = process.env.FENCE_API_KEY
  if (!expected) {
    return res.status(500).json({ error: 'FENCE_API_KEY not configured' })
  }
  const authHeader = req.headers['authorization'] || ''
  if (authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  const body = parseBody(req)
  if (body === undefined) {
    return res.status(400).json({ error: 'Malformed JSON body' })
  }

  const errors = validatePayload(body)
  if (errors.length) {
    return res.status(400).json({ error: 'Invalid offload payload', details: errors })
  }

  try {
    const [offload] = await sql`
      INSERT INTO offloads (
        offloaded_at, year, industry, client, project,
        source_path, drive_type, location, notes, overall_passed
      ) VALUES (
        ${body.timestamp}, ${body.year}, ${body.industry}, ${body.client}, ${body.project},
        ${body.sourcePath}, ${body.driveType}, ${body.location},
        ${body.notes ?? null}, ${body.overallPassed}
      )
      RETURNING id
    `

    for (const b of body.backups) {
      await sql`
        INSERT INTO offload_backups (
          offload_id, label, drive_name, destination_path, verification_mode,
          folder_results, total_files, total_size_bytes, passed
        ) VALUES (
          ${offload.id}, ${b.label}, ${b.driveName}, ${b.destinationPath}, ${b.verificationMode},
          ${JSON.stringify(b.folderResults)}::jsonb, ${b.totalFiles}, ${b.totalSizeBytes}, ${b.passed}
        )
      `
    }

    return res.status(201).json({ id: offload.id })
  } catch (e) {
    console.error('Offload ingest failed:', e)
    return res.status(500).json({ error: 'Failed to store offload' })
  }
}
