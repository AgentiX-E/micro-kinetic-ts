import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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
    globals: true,
    environment: 'node',
    setupFiles: ['__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
    coverage: {
      include: [
        'src/rcaeval-topology.ts',
        'src/rcaeval-semantic.ts',
      ],
      exclude: ['__tests__/integration/**'],
      thresholds: {
        // rcaeval-semantic.ts hits 99%+, rcaeval-topology.ts is ~76%
        // due to YAML file-loading / BFS discovery functions that are
        // tested indirectly through integration (buildRCAEvalCallGraph
        // exercises them via exact-match and ring-connect paths).
        // Semantic enhancement paths are fully covered.
        //
        // The LLM reranking layer (reranking-engine.ts + investigator-engine.ts)
        // was retired as net-negative dead code; those two files were ~100%
        // covered and previously padded this aggregate above 83%. With them
        // gone, the honest floor is the rcaeval-topology-dominated ~82.9% —
        // no remaining line lost coverage, the scope simply shrank.
        statements: 82,
        branches: 77,
        functions: 80,
        lines: 82,
      },
    },
  },
});
