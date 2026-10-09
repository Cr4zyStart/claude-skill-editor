import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ADD [Claude AI - Opus 5] (2026-10-08 14:05:12): builds into ../public, which
// serve.mjs already serves. One server, one port, token injection unchanged.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('../public', import.meta.url)),
    // FIX [Claude AI - Opus 5] (2026-10-08 15:01:40): in watch mode emptying the
    // folder leaves a window where the server serves 404s, and the reload the
    // deletion triggers can land inside it. Only wipe on a one-shot build.
    emptyOutDir: mode !== 'development',
    chunkSizeWarningLimit: 1200,
  },
}))
