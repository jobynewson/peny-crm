// api/_leads.js
// Company leads are kept but hidden until a superadmin turns them on
// (settings.show_leads, default off, in Settings › Company). While they are
// hidden nothing acts on them: alerts and the digest's approvals skip the lead
// and go to the superadmins, a new company isn't given one, and removing a
// person who happens to be one is allowed. The lead column stays as it is, so
// turning the setting on brings back whatever was set.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { workspaceId } from './_api.js'

export async function leadsShown(sql) {
  const ws = await workspaceId(sql)
  const [settings] = await sql`SELECT show_leads FROM settings WHERE user_id = ${ws}`
  return settings?.show_leads === true
}
