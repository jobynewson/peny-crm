import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, loadEnv } from 'vite'

// `npm run dev` only: serve /api/<name> from api/<name>.js the way Vercel does
// in production, so the app (which loads data through /api/db) works locally.
// Server-only variables (DATABASE_URL, CLERK_SECRET_KEY, …) are read from
// .env.local alongside the VITE_ ones. `_`-prefixed files are helpers, not
// routes, as on Vercel.
function apiRoutes() {
  return {
    name: 'slate-api-routes',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value

      server.middlewares.use('/api', async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        const name = url.pathname.replace(/^\/|\/$/g, '')
        if (!/^[a-z0-9-]+$/.test(name) || !existsSync(join(server.config.root, 'api', `${name}.js`))) return next()
        try {
          const { default: handler } = await server.ssrLoadModule(`/api/${name}.js`)
          // The slice of Vercel's request/response helpers the handlers use.
          req.query = Object.fromEntries(url.searchParams)
          if (req.headers['content-type']?.includes('application/json')) {
            let raw = ''
            for await (const chunk of req) raw += chunk
            req.body = raw ? JSON.parse(raw) : {}
          }
          res.status = code => { res.statusCode = code; return res }
          res.json = body => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(body))
            return res
          }
          res.send = body => (typeof body === 'object' && !Buffer.isBuffer(body) ? res.json(body) : res.end(body))
          res.redirect = (a, b) => {
            const [code, location] = typeof a === 'number' ? [a, b] : [307, a]
            res.writeHead(code, { Location: location }).end()
            return res
          }
          await handler(req, res)
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [apiRoutes()],
  // Ensure client-side routing works on Vercel
  build: {
    outDir: 'dist',
  },
})
