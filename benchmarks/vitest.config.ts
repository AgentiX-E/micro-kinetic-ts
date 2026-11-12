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
        // Added with the module: the writer of the per-candidate TERM dump, which two runners now share and two
        // scripts read. Its whole value is the two distinctions it draws — `null` for a factor the term never had
        // against `0` for a weight a gate zeroed, and a whole ranking against the reported top five — so the
        // newline shape, the null round-trip, the count it reports and the truncation on construction are all
        // asserted rather than trusted.
        'src/terms-dump.ts',
        // Added with the module: the dual-family census reads the term's POPULATION off the ranking the
        // correctness checks count from. Its whole value is the distinction it draws — a paid member, a
        // non-member, a `WEIGHT_ZERO` case and a retrieval failure are four different findings that render as
        // the same absence — so every branch of it is measured here rather than trusted.
        'src/dual-family-census.ts',
        // Added with the module: the three evidence-handling families of arXiv:2608.21310 as deterministic
        // predicates. Every branch is measured because the instrument's whole claim is that a family it cannot
        // reach is a defect in the PREDICATE and not a clean bill — so the branch that produces a finding, the
        // branch that withholds one, and the branch that reports an unauditable case are all asserted by name.
        'src/evidence-audit-census.ts',
        // Added with the module: the direction term's gate, counted as DECISIONS rather than as capability. The
        // whole value is the three distinctions it draws — a name refusal, a bar refusal, and a case the gate let
        // through into an empty map — plus the engine's own `acted` read against the predicate it was predicted
        // from, so every branch is measured rather than trusted.
        'src/failed-edge-gate-census.ts',
        // Added with the module: the boundary census counts how many cases can place the level test's
        // precondition at all, and its whole value is the distinction a RATIO collapses — a corpus that knows
        // no injection time against one that knows every injection time and can still split none of them.
        // Every branch of the predicate and of the summary is measured rather than trusted.
        'src/fse26-boundary-census.ts',
        // Added with the module: the term-gap census subtracts the two sides of every miss, term by term, and its
        // whole value is the four distinctions it draws — a cost, a help, an unmeasured side, and a name paid to
        // one side only. Every branch is measured rather than trusted.
        'src/term-gap-census.ts',
        // Added with the module: the latent census turns each term's recorded SLOPE into the weight at which it wins
        // a case back and the weight at which it costs one, so a weight decision stops needing an arm per value. Its
        // value is the four distinctions it draws — a requirement, a cap taken from every candidate, a tie, and a
        // side with no terms at all — so every branch is measured rather than trusted.
        'src/latent-term-census.ts',
        // Added with the module: the fault census reads every miss on the axis that names an owner — a truth the
        // ranking never surfaced, a truth that deviated less than the one that beat it, or a truth that deviated at
        // least as much and was outvoted by a named term — so its value is the three exclusive buckets and the blame
        // map, and every branch is measured rather than trusted.
        'src/fault-census.ts',
        // Added with the module: the prior floor is the only baseline in this package that is a property of the
        // CORPUS rather than of the engine — the closed forms behind "a ranker reading no telemetry scores
        // `Avg@5 = 3/S` here" — so its whole value is arithmetic a reader must be able to recompute by hand.
        // Every branch is measured rather than trusted: the two cutoff regimes, the empty census, the
        // single-candidate degeneration, the support tie-break, and the case-weighted pool.
        'src/prior-floor.ts',
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
        // Added with the module: the per-case verdict writer is what makes a published average re-scorable
        // under a judgement chosen AFTER the run. Its whole value is that a line loses nothing — the accepted
        // SET, the ranking ORDER, and the truncation depth — because a judgement computed from a lossy line is
        // a judgement about a different corpus. Every branch is measured rather than trusted.
        'src/fse26-per-case.ts',
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
        // Added with the module: the OTHER projection of the same parsed options — the record the `Config:`
        // line and the JSON artifact are rendered from. It was inline in `run-fse26.ts`'s `main()` until run
        // `41053711414` aggregated by `sum` and printed `topoClosure=max`: the engine mapping had been
        // extracted for exactly this reason and the reported record had not, so nothing could ask whether the
        // two agreed. They are two objects built from one input, and the test that compares them is the only
        // thing standing between a dispatch and an artifact that misnames its own configuration.
        'src/fse26-run-config.ts',
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
        // Added with the module: the failure block's six per-case comparisons are read by `weight × signal`, and
        // four of those weights are zero on the published configuration — so a comparison a reader takes as
        // evidence may be a description of a mechanism the run did not use. The module's whole output is a
        // label, and a label is only worth what its coverage is: every branch here decides whether a printed
        // number arrives with the weight that reads it.
        'src/signal-evidence.ts',
        // Added with the module: the gate that holds the nine published cells to a committed baseline. It is the
        // only fence in this repository that compares a READING against a run rather than the document against
        // itself — `docs/sota-comparison.md`'s block was one case low for four days because nothing did — so its
        // own branches are the fence: an empty baseline, an arm that must be skipped, a census that is not one,
        // and the one verdict that matters. 98.66% here, and the two uncovered lines are the `process.exit` of
        // the entry-point guard, which is the same pair every CLI in this package leaves to the workflow.
        'src/cell-baseline.ts',
        // Added with the module: the corpus traversal and the ORDER it returns, which is a property of the
        // CORPUS and must not be a property of the filesystem. Two runners' `discoverAllCases` used to return
        // `readdirSync` order while every sibling canonicalised — and the two that did not are the ones whose
        // `slice(0, maxCases)` decides a published case set. It is imported by `case-corpus-walk.test.ts`, so
        // leaving it out of this list would be the allow-list's own hole a seventh time;
        // `__tests__/coverage-scope.test.ts` diffs the list against what the tests import, in both directions.
        'src/case-corpus-walk.ts',
        // Added with the module: the WINDOW's own census, i.e. the instrument `docs/baseline-anchor.md` §7b
        // recorded as owed and §8.5 proved could not be built against the corpus rows. It is the first module in
        // this list whose whole subject is a REFUSAL — so its uncovered branches would be the refusals nobody
        // exercised, which is precisely the state the module exists to make impossible.
        'src/anchor-census.ts',
        // Added with the module: the log flood census, which is what turned "the log term always claims a full
        // weight" from an observation about the code into a measurement of the corpus — the median case admits
        // eight lines, a third admit one or none, and in 16.9% the truth emits NOTHING while a neighbour floods.
        // Its whole value is the distinctions it refuses to collapse (a silent case against a quiet one, a tie
        // against a champion, a concentration that must not absorb the silent cases), so every branch is measured
        // rather than trusted.
        'src/log-flood-census.ts',
        // Added with the module: the two folds that make memory slicing a rewrite of the ORDER a cell is processed
        // in rather than a change to what it reports. Measured rather than trusted for the reason the folds exist:
        // a count that is not added, a mean that is averaged instead of re-derived, or a summary folded as a summary
        // each produces a plausible number that no single pass would have produced — and the artifact cannot tell
        // the difference from the outside.
        'src/case-slicing.ts',
        'src/load-stats.ts',
        // Added with the module: obtaining a collector a plain dispatch does not expose. Its whole value is the
        // difference between a release and a reclamation — the runner drops 3 GB of cases per cell and, without a
        // collection, keeps every page until V8 next feels pressure.
        'src/collect-garbage.ts',
        // Added with the modules: the fault-free frequency profile — the ONE term whose input is a property of
        // the CORPUS rather than of the case being ranked. Three files, and each is measured for its own reason.
        // The writer decides what a second arm can even read, so its round trip and its two refusals (a file
        // with no channel list, a record with a non-finite field) are asserted rather than trusted: an empty
        // profile scores the term at nothing and is indistinguishable from a corpus whose channels all fell
        // below the floor. The builder's BAND is what every arm is scored against, so its two floors and its
        // refusal to let a case profile itself are the whole of its correctness. The walk is a property of the
        // corpus and must not be a property of the filesystem.
        'src/fault-free-profile-file.ts',
        'src/fault-free-profile-build.ts',
        'src/case-discovery.ts',
        // Added with the module: the stratified subsample that lets a 500-case arm stand in for the 1 422-case
        // corpus without dropping a fault family. Every branch is measured because the module's whole claim is a
        // coverage claim — a floor it cannot afford, a stratum it cannot fill, a target it cannot reach and a
        // proportional share it misses are four different findings, and three of them would read as success if
        // only the happy path were asserted.
        'src/agentic-sampling.ts',
        // Added with the modules: the elimination layer's three measurable parts, and each is here for its own
        // reason. The FINGERPRINT is what a model would be allowed to see, so every number in it is attested —
        // the medians either side of the injection, the published band and rate, the onset — and the four
        // refusal counters are what separate a sparse fingerprint caused by an unprofiled corpus from one caused
        // by a cap. The DUMP is the artifact every offline arm reads, so a field it writes as `null` or forgets
        // to validate becomes an arm's number rather than an error, and the reader is asserted against every
        // shape that would do it. The HEADROOM is the ceiling that decides whether the layer is worth paying
        // for: its arms are asserted separately because an oracle that also respected the skip rule would
        // report a bound on the method rather than on the population, and weight zero is asserted to be the
        // identity, which is the property the whole ablation rests on.
        'src/agentic-fingerprint.ts',
        'src/agentic-fingerprint-file.ts',
        'src/agentic-headroom.ts',
        // Added with the module: the rendering that puts a rate BESIDE the population that bounds it and the
        // refusals that qualify it. An arm that abstained on most of a corpus has a number describing the rest,
        // and a layout is only worth its coverage if a test can read it.
        'src/agentic-headroom-report.ts',
        // Added with the modules: the depth instrument and the two tables read off it. `ranking-depth.ts` is the
        // only writer of a row that says whether a miss is a RANKING defect or a case the order never held, and
        // `run-depth-report.ts` is the only place that split is turned into a per-family table — the artifact a
        // roadmap is read from. Both are measured because a wrong depth is not an error anywhere: it is a
        // plausible share in a table, which is the failure mode this repository refuses by name.
        'src/ranking-depth.ts',
        'src/depth-report.ts',
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
