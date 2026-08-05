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
        statements: 100,
        branches: 89,   // nullish coalescing guards (?? 0) + union===0 unreachable from TS
        functions: 100,
        lines: 100,
      },
    },
  },
});
