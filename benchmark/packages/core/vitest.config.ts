import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic-core': resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/**/index.ts',
        // Pure type files — no runtime code to cover
        'src/di/registry.ts',
        'src/interfaces/**',
        'src/types/benchmark.ts',
        'src/types/graph.ts',
        'src/types/probability.ts',
        'src/types/ranking-weights.ts',
        // Storage — pure interface + test helper
        'src/storage/i-key-value-store.ts',
        'src/storage/abstract-store-test.ts',
      ],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
