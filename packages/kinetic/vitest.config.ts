import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic': resolve(__dirname, 'src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../core/src/index.ts'),
      '@agentix-e/micro-kinetic-tree': resolve(__dirname, '../tree/src/index.ts'),
      '@agentix-e/micro-kinetic-cutting': resolve(__dirname, '../cutting/src/index.ts'),
      '@agentix-e/micro-kinetic-noise': resolve(__dirname, '../noise/src/index.ts'),
      '@agentix-e/micro-kinetic-scaling': resolve(__dirname, '../scaling/src/index.ts'),
      '@agentix-e/micro-kinetic-wave': resolve(__dirname, '../wave/src/index.ts'),
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
        // Benchmark loaders — tested via integration/benchmark pipelines, not unit tests
        'src/benchmarks/loaders/**',
        'src/benchmarks/synthetic/**',
      ],
      // Kinetic is an umbrella/integration package — unit coverage reflects DI wiring,
      // CLI formatters, and pipeline. Benchmark and loader code is tested via full
      // integration/benchmark pipelines, not per-function unit tests.
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 75,
        lines: 75,
      },
    },
  },
});
