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
    setupFiles: ['tests/setup-goal-engine.mjs'],
    globals: true,
    testTimeout: 15_000,
    server: {
      deps: {
        // zustand 默认被外部化（externalized），其内部 `import React from 'react'`
        // 不经 vi.mock('react') 拦截，mock-react 的 hook 测试会拿到真实 React 而
        // 崩溃；内联后 zustand 与被测源码共享同一 mock 模块图。
        inline: ['zustand'],
      },
    },
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
