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
      // diagnostic readers. Listed deliberately rather than by an `exclude`
      // pattern, because an allow-list that names its files is a claim that can be
      // checked -- and this one had two holes:
      //
      //   1. `semantic-config.ts` was imported by `semantic-config.test.ts` and
      //      absent from this list, so a module with tests sat outside the
      //      denominator and its own coverage was never measured or required.
      //   2. The claim that the remaining files "have no such surface" was false
      //      for `analyze-fse26-diagnose.ts`: its flag parsing was 235 unmeasured
      //      lines, and that is where the run's log weight came to be accepted on
      //      four different flags, producing a wrong cap for the register. The
      //      logic now lives in `fse26-diagnose-analyze.ts`, which is measured, and
      //      what is left is `readFileSync`/`writeFileSync`.
      //
      // What remains unmeasured is the runner entry points (`run-*.ts`,
      // `optimize-all.ts`, `merge-routing-probe.ts`): they execute at import time
      // and need the benchmark corpora, so they are exercised by the workflow
      // rather than here. That is a known gap, not a claim that they are trivial.
      include: [
        'src/semantic-config.ts',
        'src/rcaeval-topology.ts',
        'src/rcaeval-semantic.ts',
        'src/fse26-report.ts',
        'src/fse26-diagnose-dump.ts',
        'src/fse26-diagnose-sink.ts',
        // Added with the module: the dual-family census reads the term's POPULATION off the ranking the
        // correctness checks count from. Its whole value is the distinction it draws — a paid member, a
        // non-member, a `WEIGHT_ZERO` case and a retrieval failure are four different findings that render as
        // the same absence — so every branch of it is measured here rather than trusted.
        'src/dual-family-census.ts',
        // Added with the module: the term-gap census subtracts the two sides of every miss, term by term, and its
        // whole value is the four distinctions it draws — a cost, a help, an unmeasured side, and a name paid to
        // one side only. Every branch is measured rather than trusted.
        'src/term-gap-census.ts',
        // Added with the module: the trace vote is the only binary term in the formula, and its census is what
        // separates a wrong vote the ranking overruled from one that decided the case.
        'src/trace-vote-census.ts',
        // Added with the module: the riser census describes the CANDIDATE the trace rule chose and the truth it did
        // not, and attributes every wrong vote to the guard that excluded the truth. Its whole value is the four
        // exclusive buckets and the invariant among them (`truth-qualified` must be zero), so every branch is
        // measured rather than trusted.
        'src/riser-census.ts',
        'src/trace-share-census.ts',
        // Added with the module: the scale-free census normalises a count change by its own Poisson fluctuation and
        // simulates two selectors over the same population. Its whole value is the three distinctions it draws — a
        // loud truth that is not the loudest, an abstention that WITHDRaws a wrong unit against one that SURRENDERS
        // a right one, and a two-sided policy that votes where the one-sided one cannot — so every branch is
        // measured rather than trusted.
        'src/trace-z-census.ts',
        'src/fse26-diagnose-analyze.ts',
        'src/fse26-term-oracle.ts',
        'src/fse26-discriminator.ts',
        'src/fse26-formulation.ts',
        'src/fse26-composition.ts',
        'src/fse26-engine-agreement.ts',
        'src/fse26-fourth-term.ts',
        'src/fse26-proxy-audit.ts',
        // Added with the module: the metric-family ablation reads a DIAG dump and REFUSES to report a delta
        // unless its re-ranking reproduces the engine's rank-1 case for case. The refusal is the module's
        // whole value, so it is measured here rather than trusted.
        'src/rcaeval-metric-ablation.ts',
        // Added with the module: the table's four rows each name one field, and the mapping is the
        // only place a row can become another row's number again.
        'src/rcaeval-metric-rows.ts',
        // Added with the module: the separator screen is the register's own precondition
        // ("show it separates, on a free read") turned into code.
        'src/fse26-separator.ts',
        'src/fse26-cli.ts',
        'src/fse26-engine-options.ts',
        // Added with the module: `cli-args.ts` decides what a MALFORMED flag means, and
        // it was written, imported by two test files and left out of this list — the
        // allow-list's own hole, a third time. `__tests__/coverage-scope.test.ts` now
        // diffs this list against the modules the tests import, in both directions.
        'src/cli-args.ts',
        'src/rcaeval-cli.ts',
        // Added with the module: the RCAEval runner's engine-option assembly and the configuration
        // line its artifact carries, extracted from `run-rcaeval.ts` — which calls `main()` at
        // import time and therefore put both out of reach of every test. Their absence from a
        // measured surface is what let the line omit three of the fields `REPORTED_CONFIG_FIELDS`
        // requires. `__tests__/coverage-scope.test.ts` diffs this list against the modules the
        // tests import, in both directions.
        'src/rcaeval-engine-options.ts',
        // Added with the modules: the ablation runner's engine arguments and the configuration line its
        // artifact carries, extracted for the reason the two above were — the runner executes at import
        // time, so the mapping from the study's FLAGS to the run's WEIGHTS was reachable by nothing, and
        // the artifact it produced named twelve booleans and no weight at all. `reported-config.ts` holds
        // the fields both engine artifacts are permitted to omit, so the two cannot drift apart in what
        // they are allowed to leave out.
        'src/ablation-engine-options.ts',
        // Added with the module: what the weight search's corpus contained, which its artifact reported only
        // as three counts. The decisive field is the rank-normalization ACTING population — the cases at or
        // above the engine's node threshold — because on a corpus of small graphs the shipped rescale is
        // inert and the artifact's numbers are independent of it, which is a fact about the population.
        'src/optimize-population.ts',
        // Added with the module: the DIRECTIONAL evidence the RCAEval loader never built, derived from the
        // traces it does load. Every observable is a function of the case's inputs alone, which is what makes
        // a reading about it deployable rather than a description of the population it was measured inside.
        'src/directional-evidence.ts',
        'src/reported-config.ts',
        // Added with the module's own tests: the ONE assembly point of an RCAEval case's inputs, and the three
        // views of `edgeLatency` it owns. It was imported by `corpus-assembly.test.ts` as SOURCE TEXT and by
        // nothing as code, so it sat outside the denominator while every number in the repository went through
        // it — the allow-list's own hole, a fourth time, and now closed by `corpus-owner.test.ts`, which
        // assembles a real case directory and reads the three views back.
        'src/rcaeval-corpus.ts',
        // Added with the module: the LOG channel's four levels, and the gate that decides three of them.
        // `logWeight` is 1.0 and its map was empty on 719 of 735 cases against a corpus that supplied logs on all
        // 360 RE2 and RE3 cases, so this module carries the attribution for the largest weight in the ranking —
        // and it reads its admission rule from `packages/tree` rather than spelling one of its own.
        'src/log-route.ts',
        // Added with the modules: the held-out validator for the routing frontier and the readback that prints it.
        // Both were imported by `router-validation.test.ts` and absent from this list, so a module with 20 tests
        // sat outside the denominator and its own coverage was never measured or required — the allow-list's own
        // hole, a FIFTH time, and this one was not caught by reading it: `coverage-scope.test.ts` diffs the list
        // against what the tests import and had been failing on `master`, while the iteration that added the
        // modules reported coverage for them. A number measured over a denominator that excludes its own subject
        // is a statement about the other files.
        'src/router-validation.ts',
        'src/validate-routing-frontier.ts',
        'src/loss-census.ts',
        // Added with the module: the corpus traversal and the ORDER it returns, which is a property of the
        // CORPUS and must not be a property of the filesystem. Two runners' `discoverAllCases` used to return
        // `readdirSync` order while every sibling canonicalised — and the two that did not are the ones whose
        // `slice(0, maxCases)` decides a published case set. It is imported by `case-corpus-walk.test.ts`, so
        // leaving it out of this list would be the allow-list's own hole a seventh time;
        // `__tests__/coverage-scope.test.ts` diffs the list against what the tests import, in both directions.
        'src/case-corpus-walk.ts',
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
