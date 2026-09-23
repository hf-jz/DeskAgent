import { defineConfig } from 'vitest/config'

// E2E config: real Electron app boots (.spec.ts). Run via `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.spec.ts'],
    testTimeout: 90000,
    hookTimeout: 90000,
  },
})
