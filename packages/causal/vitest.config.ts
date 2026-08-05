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
        statements: 92,   // Math-heavy package with F-dist approx + YAML parser
        branches: 87,     // Rare error-prop + F-test edge + ring-connect guard branches
        functions: 100,   // All functions 100% covered
        lines: 92,        // Combinatorically rare arithmetic + defensive guard branches
      },
    },
  },
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../core/src'),
    },
  },
});
