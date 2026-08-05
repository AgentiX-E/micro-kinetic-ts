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
        statements: 90,   // Math-heavy package with F-dist approx + YAML parser
        branches: 85,     // Rare error-propagation + F-test edge branches
        functions: 100,   // All functions 100% covered
        lines: 90,        // Combinatorically rare arithmetic branches
      },
    },
  },
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../core/src'),
    },
  },
});
