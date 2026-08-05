import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        statements: 85,   // Math-heavy package with F-distribution approximation
        branches: 85,     // branches that require specific noise patterns to hit
        functions: 100,   // All functions 100% covered
        lines: 85,        // Some arithmetic edge cases are combinatorically rare
      },
    },
  },
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../core/src'),
    },
  },
});
