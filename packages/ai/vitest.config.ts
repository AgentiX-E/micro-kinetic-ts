import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../core/src'),
    },
  },
  test: {
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/interfaces/**'],
      thresholds: {
        statements: 95,
        branches: 90,   // `??` null coalescing creates unreachable false-branches
        functions: 95,
        lines: 95,
      },
    },
  },
});
