// api/_db-ops.js
// What the browser may do through POST /api/db (api/db.js), and who may do it.
//
// This is the route off direct browser → database access. A helper moves here
// from src/db/client.js with its query unchanged (`db` is the same Drizzle
// schema, on the server's DATABASE_URL), and client.js keeps the name as a
// thin stub that calls through src/db/api.js, so views don't change.
//
// Every decision comes from the verified Clerk user id: the workspace and the
// caller's role are looked up here, never taken from the request, and any
// workspaceId the browser still passes is ignored. OPS is an allow-list;
// nothing else in this module is reachable from the browser.
import { drizzle } from 'drizzle-orm/neon-http'
import { and, eq } from 'drizzle-orm'
import * as schema from '../src/db/schema.js'
import { credentials } from '../src/db/schema.js'
import { resolvePermissions } from '../src/db/roles.js'
import { runMigrations } from './_migrations.js'

export class DbOpError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

// `permission` for ops any signed-in Clerk user may run. Bootstrap calls them
// before the caller has an app_users row.
const SIGNED_IN = 'signed-in'

// Members have an app_users row, which carries their role. There is one
// workspace; its owner_id scopes every table (the `user_id` columns).
async function loadCaller(sql, clerkUserId) {
  const [[ws], [user]] = await Promise.all([
    sql`SELECT owner_id FROM workspace LIMIT 1`,
    sql`SELECT id, role FROM app_users WHERE clerk_id = ${clerkUserId} LIMIT 1`,
  ])
  if (!ws) throw new DbOpError('No workspace', 404)
  if (!user) throw new DbOpError('Not a member of this workspace', 403)
  return { workspaceId: ws.owner_id, appUser: user, permissions: resolvePermissions(user) }
}

// Once per server instance: the statements are idempotent, but there are
// dozens of them and every app load asks.
let migrated = null
function migrateOnce(sql) {
  migrated ??= runMigrations(sql).catch(err => { migrated = null; throw err })
  return migrated
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function idArg(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new DbOpError('Invalid id', 400)
  return id
}

// Only the listed columns can be written from the browser; ids, workspace
// scoping and timestamps are set here.
function pickFields(data, allowed) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DbOpError('Invalid data', 400)
  return Object.fromEntries(allowed.filter(k => Object.hasOwn(data, k)).map(k => [k, data[k]]))
}

const CREDENTIAL_FIELDS = ['program', 'login', 'password', 'url', 'notes', 'category', 'sort_order']

// `permission` is the ROLE_PRESETS flag the caller's role must grant, or
// SIGNED_IN. An op without one is refused.
const OPS = {
  runMigrations: {
    permission: SIGNED_IN,
    run: ({ sql }) => migrateOnce(sql),
  },

  // ── Credentials (password manager) ──
  getCredentials: {
    permission: 'vault',
    run: ({ db, workspaceId }) => db.select().from(credentials)
      .where(eq(credentials.user_id, workspaceId))
      .orderBy(credentials.sort_order, credentials.program),
  },
  createCredential: {
    permission: 'vault',
    run: async ({ db, workspaceId }, data) => {
      const [row] = await db.insert(credentials)
        .values({ ...pickFields(data, CREDENTIAL_FIELDS), user_id: workspaceId })
        .returning()
      return row
    },
  },
  updateCredential: {
    permission: 'vault',
    run: async ({ db, workspaceId }, id, data) => {
      const [row] = await db.update(credentials)
        .set({ ...pickFields(data, CREDENTIAL_FIELDS), updated_at: new Date() })
        .where(and(eq(credentials.id, idArg(id)), eq(credentials.user_id, workspaceId)))
        .returning()
      return row
    },
  },
  deleteCredential: {
    permission: 'vault',
    run: async ({ db, workspaceId }, id) => {
      await db.delete(credentials)
        .where(and(eq(credentials.id, idArg(id)), eq(credentials.user_id, workspaceId)))
    },
  },
}

// `sql` is a neon() tagged-template client (or a test double with the same
// shape); `db` defaults to Drizzle over it.
export async function runOp({ op, args = [], clerkUserId, sql, db = drizzle(sql, { schema }) }) {
  if (!clerkUserId) throw new DbOpError('Unauthorised', 401)
  if (typeof op !== 'string' || !Object.hasOwn(OPS, op)) throw new DbOpError('Unknown operation', 400)
  if (!Array.isArray(args)) throw new DbOpError('Invalid arguments', 400)
  const { permission, run } = OPS[op]
  if (permission === SIGNED_IN) return run({ sql, db }, ...args)
  const caller = await loadCaller(sql, clerkUserId)
  if (caller.permissions[permission] !== true) throw new DbOpError('Not allowed', 403)
  return run({ sql, db, ...caller }, ...args)
}
