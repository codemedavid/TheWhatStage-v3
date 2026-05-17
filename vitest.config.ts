import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 'server-only' is a Next.js package that throws at import time in non-Next
      // environments. Stub it out so Vitest can import server-side modules.
      'server-only': path.resolve(__dirname, 'src/__test-stubs__/server-only.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
