import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Electron e2e (.spec.ts) runs via `npm run test:e2e` (positional dir)
    testTimeout: 90000,
    hookTimeout: 90000,
  },
})
