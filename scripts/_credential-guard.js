// scripts/_credential-guard.js
// Keeps the database credential out of the JavaScript the browser downloads,
// where anyone could read it. A Vite plugin (vite.config.js) that fails the
// build — so Vercel keeps serving the last good deploy — when:
//   - a VITE_ variable holds a connection string: Vite builds every VITE_
//     variable into the public JavaScript. The server's is DATABASE_URL.
//   - a Vercel build has no DATABASE_URL: every /api function reads it, and
//     without it the whole app would fail after deploying.
//   - the built files contain DATABASE_URL's value, its password, or any Neon
//     connection string. The browser's placeholder (…@database.invalid, see
//     src/db/client.js) is none of those.
// The checks are pure functions, unit-tested in _credential-guard.test.js.

const CONNECTION_STRING = /^\s*postgres(?:ql)?:\/\//i
const NEON_CONNECTION_STRING = /postgres(?:ql)?:\/\/[^\s'"`<>]*@[^\s'"`<>/]*neon\.tech/i
const TEXT_FILE = /\.(?:m?js|css|html?|json|map|svg|txt|xml|webmanifest)$/i

// The names, in `env`, that hold a connection string.
export function connectionStringVars(env) {
  return Object.entries(env)
    .filter(([, value]) => typeof value === 'string' && CONNECTION_STRING.test(value))
    .map(([name]) => name)
}

function passwordOf(url) {
  try { return decodeURIComponent(new URL(url).password) } catch { return '' }
}

// What in `text` gives the credential away: [] when nothing does.
export function credentialsIn(text, { databaseUrl } = {}) {
  const found = []
  if (databaseUrl && text.includes(databaseUrl)) found.push('DATABASE_URL')
  const password = databaseUrl ? passwordOf(databaseUrl) : ''
  if (password.length >= 8 && !found.length && (text.includes(password) || text.includes(encodeURIComponent(password)))) {
    found.push('the database password')
  }
  if (NEON_CONNECTION_STRING.test(text)) found.push('a Neon connection string')
  return found
}

export function credentialGuard({ env = process.env } = {}) {
  return {
    name: 'slate-credential-guard',
    configResolved(config) {
      const exposed = connectionStringVars(config.env)
      if (exposed.length) {
        throw new Error(`${exposed.join(', ')} holds a database connection string, and Vite builds every VITE_ variable into the JavaScript anyone can download. Name it DATABASE_URL instead, which only the server reads (claude.md › Database access).`)
      }
      if (config.command === 'build' && env.VERCEL && !env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not set, and every /api function reads it. Add it in Vercel › Settings › Environment Variables.')
      }
    },
    writeBundle(_options, bundle) {
      const leaks = []
      for (const [file, output] of Object.entries(bundle)) {
        if (!TEXT_FILE.test(file)) continue
        const text = output.type === 'chunk' ? output.code : String(output.source)
        for (const what of credentialsIn(text, { databaseUrl: env.DATABASE_URL })) leaks.push(`${file}: ${what}`)
      }
      if (leaks.length) {
        throw new Error(`The build contains the database credential, so it won't ship:\n  ${leaks.join('\n  ')}`)
      }
    },
  }
}
