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
    // NO coverage block, and its absence is a decision rather than an omission.
    //
    // A `coverage` block is a POPULATION plus a BAR, and this suite has neither. Its `src/` holds
    // exactly one file — `pipeline.spec.ts`, the suite itself — so a population of `src/**` would
    // measure the tests covering themselves, and the block that used to sit here (a `provider` and a
    // reporter, nothing else) resolved to an EMPTY population: measured on 2026-09-20 it printed
    // `All files | 0 | 0 | 0 | 0` over zero files and exited 0, which is a table that reads as a
    // measurement and enforces nothing.
    //
    // What this suite measures is the PACKAGES, end to end, and each package carries its own
    // population and bar (`packages/*/vitest.config.ts`, `benchmarks/vitest.config.ts`). This suite's
    // own gate is that it RUNS — `nx test @agentix-e/micro-kinetic-integration-tests` and the CI
    // `integration` job — and the root `pnpm coverage` excludes it by name for the same reason.
  },
});
