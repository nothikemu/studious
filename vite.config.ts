/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './', // relative asset URLs so the app works from any sub-path (GitHub Pages project sites)
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'jsdom', globals: true, setupFiles: ['src/test-setup.ts'] },
})
