import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Opt-in configuration for the benchmark integration suites.
 *
 * These call the real Zhipu embedding API through `createApiEmbeddingFromEnv`.
 * They are not part of any gate: their result depends on a live network service,
 * on a credential, and on a daily quota. `vitest.config.ts` excludes them for
 * exactly that reason; this config puts them back.
 *
 * Requires ZHIPU_API_KEY (via `.env` or the environment). Without it the suites
 * skip themselves rather than fail.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic': resolve(__dirname, '../packages/kinetic/src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../packages/core/src/index.ts'),
      '@agentix-e/micro-kinetic-tree': resolve(__dirname, '../packages/tree/src/index.ts'),
      '@agentix-e/micro-kinetic-causal': resolve(__dirname, '../packages/causal/src/index.ts'),
      '@agentix-e/micro-kinetic-cutting': resolve(__dirname, '../packages/cutting/src/index.ts'),
      '@agentix-e/micro-kinetic-noise': resolve(__dirname, '../packages/noise/src/index.ts'),
      '@agentix-e/micro-kinetic-scaling': resolve(__dirname, '../packages/scaling/src/index.ts'),
      '@agentix-e/micro-kinetic-wave': resolve(__dirname, '../packages/wave/src/index.ts'),
      '@agentix-e/micro-kinetic-ai': resolve(__dirname, '../packages/ai/src/index.ts'),
    },
  },
  test: {
    root: __dirname,
    globals: true,
    environment: 'node',
    setupFiles: ['__tests__/setup.ts'],
    include: ['__tests__/integration/**/*.test.ts'],
    // Deliberately no coverage thresholds: coverage of a network-dependent suite
    // says nothing, and these files are excluded from the gate's coverage scope.
    testTimeout: 30_000,
  },
});
