import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

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
        // LLM classifier — requires DEEPSEEK_API_KEY, prompt builder tested via integration
        'src/classifiers/llm-classifier.ts',
        // Signal collectors — tested via RCAEval pipeline, not unit tests
        'src/signals/trace-provider.ts',
        'src/signals/fusion-engine.ts',
      ],
      // Kinetic is an umbrella/integration package — covers DI wiring, CLI, pipeline,
      // benchmark runner, and metrics. Benchmark loaders and synthetic generators are
      // tested via full integration/benchmark pipelines rather than per-function unit tests.
      thresholds: {
        statements: 96,
        branches: 92,
        functions: 96,
        lines: 96,
      },
    },
  },
});
