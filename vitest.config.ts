import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{mjs,ts}'],
    globals: true,
    testTimeout: 15_000,
  },
})
