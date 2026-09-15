import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['tests/**/*.test.{mjs,ts}'],
    globals: true,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server/**/*.mjs', 'src/**/*.{ts,tsx}'],
      exclude: [
        'coverage/**',
        'tests/**',
        'node_modules/**',
        'dist/**',
        'package-dist/**',
        'package-offline/**',
        'vendor/**',
        'android/**',
        'desktop-dist/**',
        '**/*.d.ts',
        '**/*.d.mts',
      ],
    },
  },
})
