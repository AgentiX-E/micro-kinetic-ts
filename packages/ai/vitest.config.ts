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
        statements: 98,   // ~1.5% in unreachable retry-loop fallthrough + import checks
        branches: 87,     // Nullish coalescing guards (?? 0), dead fallthrough, union===0
        functions: 100,   // All functions covered
        lines: 98,        // Defensive guard branches impossible from TypeScript test inputs
      },
    },
  },
});
