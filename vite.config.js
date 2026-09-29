import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { credentialGuard } from './scripts/_credential-guard.js'

export default defineConfig({
  // No database credential in anything the browser downloads, ever.
  plugins: [credentialGuard()],
  // Ensure client-side routing works on Vercel
  build: {
    outDir: 'dist',
    // Two pages: Slate itself, and the client portal (its own bundle, with no
    // db/client.js in it). vercel.json sends /portal and /portal/<token> to
    // portal.html.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        portal: fileURLToPath(new URL('portal.html', import.meta.url)),
      },
    },
  },
})
