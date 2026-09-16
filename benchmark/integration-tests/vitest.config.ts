import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// This config is reached from two different working directories: the repo root
// runs `vitest run --config integration-tests/vitest.config.ts` (the CI
// `integration` job), while `nx test @agentix-e/micro-kinetic-integration-tests`
// runs the package script with `integration-tests/` as cwd. Vitest resolves
// `test.include` relative to `root`, and `root` defaults to `process.cwd()`, so
// a pattern written for one entry point matched nothing under the other
// (`integration-tests/integration-tests/src/**`). Pinning `root` to this
// directory makes both entry points select the same files.
export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../packages/core/src/index.ts'),
      '@agentix-e/micro-kinetic-tree': resolve(__dirname, '../packages/tree/src/index.ts'),
      '@agentix-e/micro-kinetic-cutting': resolve(__dirname, '../packages/cutting/src/index.ts'),
      '@agentix-e/micro-kinetic-noise': resolve(__dirname, '../packages/noise/src/index.ts'),
      '@agentix-e/micro-kinetic-scaling': resolve(__dirname, '../packages/scaling/src/index.ts'),
      '@agentix-e/micro-kinetic-wave': resolve(__dirname, '../packages/wave/src/index.ts'),
      '@agentix-e/micro-kinetic': resolve(__dirname, '../packages/kinetic/src/index.ts'),
    },
  },
  test: {
    root: __dirname,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
});
