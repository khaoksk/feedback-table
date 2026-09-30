/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Django API runs in Docker on :8000. Proxying /api keeps the browser on
// one origin, so the backend needs no CORS setup (docs/PRD.md §10).
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': API_TARGET,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Dates render in the viewer's timezone; pin it so assertions are stable.
    env: { TZ: 'UTC' },
  },
})
