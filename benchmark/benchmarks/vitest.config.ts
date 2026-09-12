import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { configDefaults, defineConfig } from 'vitest/config';

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
    // Pinned like `integration-tests/`: the include patterns, the setup file and
    // the coverage globs are all resolved against `root`, which otherwise
    // defaults to the working directory -- so running this config from the repo
    // root would select nothing at all.
    root: __dirname,
    globals: true,
    environment: 'node',
    setupFiles: ['__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
    // `__tests__/integration/**` calls the real Zhipu embedding API, gated on
    // ZHIPU_API_KEY, which `setup.ts` reads out of the gitignored `.env`. A gate
    // must not depend on a network service or on a quota, so those suites are
    // opt-in through `test:integration` and are never part of the default run.
    exclude: [...configDefaults.exclude, '__tests__/integration/**'],
    coverage: {
      // The modules with a unit-testable surface: the two that decide the call
      // graph every RCAEval number is computed on, plus the FSE'26 result and
      // diagnostic readers. The remaining files under `src/` are CLI entry
      // points that call `main()` at import time and have no such surface --
      // listed deliberately rather than by an `exclude` pattern, because an
      // allow-list that names its files is a claim that can be checked.
      include: [
        'src/rcaeval-topology.ts',
        'src/rcaeval-semantic.ts',
        'src/fse26-report.ts',
        'src/fse26-diagnose-analyze.ts',
        'src/fse26-cli.ts',
      ],
      exclude: ['__tests__/integration/**'],
      // The repository's 95% bar, every dimension. Reaching it took more than
      // tests: the previous 82/77/80/82 floor was itself failing (functions sat
      // at 78.26%), and the uncovered remainder contained real dead code -- an
      // unreachable `catch`, three `?? []` fallbacks that could never fire, a
      // `?? null` behind a total lookup, and a never-referenced system map.
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
