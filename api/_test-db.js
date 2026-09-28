// api/_test-db.js
// Test-only helpers for the integration suites (*.integration.test.js). They
// run the real handlers against a real Postgres and skip unless
// SLATE_TEST_DATABASE_URL is set, so `npm test` stays green with no database.
//
// To run them:
//   npm i --no-save pg          # the app's Neon HTTP driver cannot reach localhost
//   SLATE_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/slate_test \
//     npx vitest run api/*.integration.test.js
//
// The database needs the whole schema: build it from src/db/schema.js
// (drizzle-kit generate) and then run the app's runMigrations() once, which
// applies every drizzle/*.sql change on top.
//
// NOT a Vercel function (underscore prefix) and never imported by one.

export const TEST_DB = process.env.SLATE_TEST_DATABASE_URL

// Stands in for the Neon tagged template: same (strings, ...values) call shape,
// same "resolves to an array of rows" contract.
export async function connectTestDb(url = TEST_DB) {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: url })
  const sql = (strings, ...values) => {
    let text = strings[0]
    for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1]
    return pool.query(text, values).then(r => r.rows)
  }
  sql.end = () => pool.end()
  return sql
}

// Just enough of Vercel's res for the handlers.
export function fakeRes() {
  const r = { statusCode: null, body: null, headers: {} }
  r.status = c => { r.statusCode = c; return r }
  r.json = b => { r.body = b; return r }
  r.send = b => { r.body = b; return r }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.end = () => r
  return r
}
