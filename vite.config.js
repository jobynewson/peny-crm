import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
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
