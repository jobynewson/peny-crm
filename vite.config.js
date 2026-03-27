import { defineConfig } from 'vite'

export default defineConfig({
  // Ensure client-side routing works on Vercel
  build: {
    outDir: 'dist',
  },
})
