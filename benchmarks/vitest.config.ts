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
        // The trace-channel census's pure half: five arms, a strip that may not touch the label, and the
        // accumulator the report renders from. Its tests import it directly, which is what makes its absence
        // here a hole rather than a choice — the same hole `semantic-config.ts` sat in.
        'src/trace-channel-census.ts',
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
        // Added with the module: the transcript cap's paired reading. Its whole value is the THREE distinctions it
        // draws — a preserved trajectory against a moved one, a moved trajectory against a moved ANSWER (a cap can
        // change what the arm names without changing what it looked at), and an unrecorded cache or clock against a
        // zero — so every one of them is asserted here rather than trusted. `run-cap-reading.ts` stays outside the
        // denominator for the reason every `run-*.ts` does: it calls `main()` at import time.
        'src/transcript-reading.ts',
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
        // Added with the module: the decomposition of a miss into the ranking formula's own terms. Three
        // statements are what make it a decomposition rather than a description — the differences sum to the
        // score gap, an absent truth is NAMED instead of decomposed, and a tie is NAMED instead of resolved — and
        // every branch that could silently turn one of the three into a different claim is asserted here.
        'src/miss-anatomy.ts',
        // Added with the module: the ceiling a reranker is shown, as a function of the presentation's WIDTH. Its
        // whole value is that an arm measured under a ceiling below the target cannot succeed, so the four
        // statements that make the number a gate rather than a description — monotone in the width, an absent
        // truth unreachable at every width, the SMALLEST width that reaches a target, and a refusal for a rank the
        // artifact could not have written — are asserted by name here.
        'src/presentation-ceiling.ts',
        // Added with the module: the free-investigation arm, which is the first agent surface in this repository
        // that does not ask a model to choose from a table. Its whole value is the two refusals it makes — a
        // directive its grammar does not admit is not a call, and a service the case does not carry is refused BY
        // NAME rather than answered with an empty list — plus the budget that stops the loop instead of being
        // consulted. Every branch of those four is asserted here, and the model is a fake at the port, so what is
        // measured is the loop and the tools rather than an endpoint's mood.
        'src/query-agent.ts',
        // Added with the module: the arm's misses, coded. Its whole value is the LADDER — a refusal outranks the
        // direction it also has, a null answer is not a refusal by a prior that is also null, and a wrong branch the
        // model LOOKED at is a different finding from one it never queried — so every rung is asserted by name.
        'src/agentic-failure-codes.ts',
        // Added with the modules: the channel split, as a classification and as a held-out reading. Both are
        // measured rather than trusted because both can lie in a way that looks like a result — a classifier that
        // reads `k8s.pod.network.errors` by its prefix counts a symptom as work the service did, and a
        // cross-validation that reports its SELECTION reading instead of its held-out one turns a fitted parameter
        // into a finding. Every branch of the four-way classification, of the "traffic only" verdict and of the
        // fold assignment is asserted by name in `channel-kind.test.ts` and `channel-split.test.ts`.
        'src/channel-kind.ts',
        'src/channel-split.ts',
        // Added with the module: the corpus's LABEL census, which answers whether a status column exists at all.
        // Its whole value is that a zero means "no column" rather than "no signal", and a renderer that printed
        // the count without the consequence would leave a reader unable to tell those two apart — so the zero
        // branch, the non-zero branch, the ordering and the accumulation across an incremental walk are all
        // asserted by name in `channel-label-census.test.ts`.
        'src/channel-label-census.ts',
        // Added with the module: the ancestry bound, which is the first rule in this programme whose evidence is a
        // RELATION rather than a number. Its whole claim is that a correct answer sits on the path to the rung and a
        // contradictable one does not, so what is measured here is the graph arithmetic itself — the direction of the
        // path, the tie-break that carries no preference for the truth, the refusal on a rung the entry cannot
        // reach, the two-way sort that keeps a comparator from hiding an unreachable equality arm, and the control
        // that holds the firing population constant while destroying the relation.
        'src/channel-ancestry.ts',
        // Added with the module: the causal-depth slice, which exists because two quantities in this repository were
        // both called "depth" and the confusion had a price. Its whole value is the three distinctions it draws — the
        // smallest reachable distance over a multi-service truth rather than the deepest, an unreachable truth NAMED
        // in `unattached` rather than dropped, and a share whose denominator is the depth's own population — so the
        // null branches, the multi-label minimum, the missing-graph branch and the table's alignment are all
        // asserted by name in `causal-depth-slice.test.ts`.
        'src/causal-depth-slice.ts',
        // Added with the module: the head-precedence rule's guard, its two refusals that are not about a number
        // (an unmeasured profile and a disabled bar), the partition it shares with the channel split, and the
        // three clauses that can refuse the rule whatever it reads. `head-precedence.test.ts` names each.
        'src/head-precedence.ts',
        // Added with the module: the first-hop rule's boundary premise, its three refusals that are not about a
        // number, the calibration floor and the four clauses that can refuse the reading whatever it gains.
        'src/first-hop.ts',
        // Added with the module: the retrieval block's five classes, the widening curve and the gap sweep. Its whole
        // value is that four different failures are kept apart — a precedence failure, a reasoning failure, a breadth
        // failure and a pool failure — so the unranked branch, the multi-label minimum, the comparator's null cases
        // and the two zero-denominator readings are asserted by name in `retrieval-block.test.ts`.
        'src/retrieval-block.ts',
        // Added with the module: the engine-certainty guard, which reads a margin about the ENGINE rather than a
        // loudness about the answer. The refusals are the test — an unmeasured margin, an unranked case and a null
        // answer must all pass the answer through — and the four clauses that can refuse the reading are asserted.
        'src/engine-certainty.ts',
        // Added with the module: the miss ledger, which names each remaining miss and prices the rules that could
        // have bought it. Its whole value is that the three populations stay apart — a precedence residue, a
        // reasoning failure and a breadth failure are three different budgets — and that a rule which never fired
        // reports `null` precision instead of a perfect one, so `miss-ledger.test.ts` asserts the class boundaries
        // (rank 1, rank 5, rank 6, unranked), the four refusals the promotion sweep makes, and both directions of
        // the concentration reading's separation test.
        'src/miss-ledger.ts',
        // Added with the module: the term marginal ledger, which is the only reading in this programme that answers
        // "what does this implementation contribute" in the units the target is measured in. Its whole value is the
        // distinction between a term that is absent, one that is measured and cannot decide, one that buys ties, and
        // one that decides — so `term-marginal.test.ts` asserts each of the four by name, plus the score identity that
        // makes every marginal a property of the engine rather than of this module.
        'src/term-marginal.ts',
        // Added with the module: the reader both pool instruments share. It is measured because a reader that dropped
        // a candidate or read an unmeasured weight as zero would move the denominator of every published number while
        // leaving the surface intact, and `term-dump.test.ts` asserts each refusal by the line it names.
        'src/term-dump.ts',
        // Added with the module: the first competitor's theorem, measured on our own pool. The three modes, the
        // additive base and both folds are asserted, and the refusals are the test — a candidate with one axis
        // measured is excluded rather than scored zero, and a case whose whole pool lacks an axis is `undecided`.
        'src/conjunctive-score.ts',
        // Added with the module: the cutoff-average metric every `Avg@5`-publishing competitor is quoted in, and the
        // floor a random order of the same pool pays. Its whole value is that neither number is a convention this
        // repository invented — `Avg@k` is defined as the mean of `AC@1..k`, and the floor is an expectation with a
        // closed form — so the tests assert the DEFINITION against the closed forms rather than asserting the code
        // against itself: the average against `max(0, k+1-r)/k`, the floor against an enumeration over every rank the
        // pool allows, the sandwich `AC@k >= Avg@k >= AC@1` that every external comparison leans on, and each of the
        // census reader's refusals by the line it names. The one that is not arithmetic is the `rankMeasured` flag:
        // nine real census rows carry no `truthRank`, and scoring them as misses would move every cutoff by 1.2 pp
        // while leaving the surface intact.
        'src/cutoff-accuracy.ts',
        // Added with the module: the A/B comparison of two published surfaces. Its whole value is that a net delta
        // is not a finding — a repair and a break are two populations, and a comparison over the intersection would
        // report a movement on a denominator neither file states. So the refusals ARE the test: two case sets that
        // differ raise instead of scoring what they share, a duplicated id raises instead of letting the last row
        // win, a non-boolean `correct` raises instead of reading a truthy string as a hit, and the fold assignment
        // refuses an id it was not given rather than defaulting it into the first half.
        'src/surface-diff.ts',
        // Added with the module: the investigation's schedule, which is the first instrument in this package that
        // prices a ROUTE rather than a ranking. Its whole value is that it never reports one number where there are
        // two — a structural ceiling and the point estimate the arm's own conversion buys — and that it keeps the
        // three miss populations apart, so the refusals are the test: a row with no call column is neither measured
        // bucket, a truth the pool never held is `unreachable` rather than "infinitely far", a repeated id cannot
        // consume a second slot, and a width that is not a non-negative integer is refused rather than coerced.
        'src/investigation-schedule.ts',
        // Added with the module: the retrieval decomposition split by what the arm's own record says it did. Its whole
        // value is that the field's headline ("retrieval is nearly solved") is true of ONE of the two populations and
        // false of the other — 99.25 % against 26.79 % at five — so the refusals are the test: an absent record is its
        // own split rather than a negative one, an empty split reports `null` rather than zero, and an unreachable
        // label counts against retrieval instead of being excluded from its denominator.
        'src/reach-decomposition.ts',
        // Added with the module: the sibling record that makes two artifacts comparable at all. It exists because
        // iteration 345 compared a run with one from two days earlier and read a 236-case drift as an arm effect, so
        // the refusals are the test: a clock that ends before it starts throws rather than writing a negative
        // duration, and the four flags collapse to `free` or to a `+`-joined list a diff can show.
        'src/run-metadata.ts',
        // Added with the module: the gate a paired delta has to pass before it is a measurement. The record above says
        // WHICH configuration an artifact is; this one refuses to compare two artifacts that differ outside the axis
        // the caller names — the check that would have stopped a `gate contrast, fallback engine, resolve edge-novel`
        // artifact from being read as the same "free arm" as a bare one, and a 236-case configuration delta from being
        // published as model drift. Its refusals are the test (a model, a budget, a revision, an absent flag), and so
        // are the two statistics: the exact conditional binomial, and the continuity-corrected chi-square whose 0.243
        // for 22 against 14 is the figure this programme already published.
        'src/arm-comparison.ts',
        // Added with the modules: the bill, and the one saving that is taken before the call instead of after the
        // run. The audit's whole value is the split it makes — 98.2 % of 20.81 CNY is prompt tokens, and 786 of 1 422
        // cases were settled without the model after paying six turns each — plus the refusals that stop it being
        // read off a file that never recorded a margin. `token-rates.ts` is separate so a different provider is a
        // different table rather than a different audit.
        'src/cost-model.ts',
        'src/token-rates.ts',
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
        // Added with the module: weight reachability is the first instrument in this package that decides a case
        // rather than sampling one, and its whole value is that BOTH verdicts carry a certificate the reader can
        // substitute back — a witness that re-ranks the case, or a combination that rebuilds the answer. Every
        // branch is measured rather than trusted: the four verdicts, the two bases, the tie that is not a
        // separation, the answer the ranking never listed, and the held-out fit's two orientations.
        'src/weight-reachability.ts',
        // Added with the module: the gate, as an object rather than a sentence. Its whole value is two distinctions
        // the repository has been reading past — a tie is not a win (the zero vector scores the published run, all
        // of it by tie, because the artifact's order IS the recorded order), and a promotion that costs a protected
        // case is not a promotion. Every branch is measured rather than trusted: both readings of one case, the
        // family below the floor, the gap that cannot close inside one step, and the move that is rolled back.
        'src/gate-fit.ts',
        // Added with the module: a gated term's recorded coefficient is a DECISION (`configured × admitted`), not a
        // configuration, and reading the first zero as the shipped weight is what made every screen here understate
        // the run it was measuring by 42 cases. Its whole value is two recoveries — `max` over the coefficients is
        // the configuration, and the two arms the gate chose between are a free ablation — so every branch is
        // measured: the name only ever recorded at zero, the case whose candidates disagree, the residual that does
        // not rebuild, and the arm that weights a slope the dump never weighted.
        'src/conditional-weight.ts',
        // Added with the module: the gate's decision as a calibrated rejector, where the statistic is the baseline's
        // own lead rather than the fault type or the metric name. Its whole value is four readings — the frontier's
        // per-family loss, the isotonic calibration's pooling, the Chow bound at its exchange rate, and the same bound
        // spent on a fold that did not choose it — so every branch is measured: the reach of a case with no rival, a
        // case whose term was never measured, the block exactly at the bar, and the calibration with nothing in it.
        'src/gate-rejector.ts',
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
        // Added with the modules: `cell-population.ts` decides whether a cell's rate is a measurement at all
        // (the run-43901259774 defect: thirty asked for, none loaded, `AC@1 0.0 %` published over an empty
        // denominator), and `semantic-preflight.ts` decides what happens when the embedding provider refuses to
        // answer. Both are pure decision points whose every branch is asserted, because both exist to stop an
        // absence from being rendered as a number.
        'src/cell-population.ts',
        'src/semantic-preflight.ts',
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
        // Added with the module: the one decision a presentation-width arm rests on — whether the ordering a
        // fingerprint is built from is the published one, a slice of it, or a second pass at a wider cut. Its
        // whole value is the branch that does NOTHING: at the published width the function must hand back the
        // array it was given, by identity, because a slice that equals it is a different code path and the arm's
        // control would then be produced by something the treatment does not share.
        'src/fingerprint-width.ts',
        // Added with the module: the corpus topology brief as an artifact. What is asserted is the part that can
        // fail silently — that the digest is re-derived rather than trusted, that a file holding two briefs is
        // REFUSED instead of attributed by name, and that the writer truncates on construction. An arm that read a
        // stale or half-attributed brief would report a channel it never sent.
        'src/topology-brief-file.ts',
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
        // Added with the module: the census of the ranks a `Top@5` presentation can still repair. Measured because
        // every number in it is one a plan is SIZED against — the anchor is `72 near misses, 41 of them won by
        // three services` — and a miscount here is not an error anywhere: it is a plausible share in a table, the
        // failure mode `ranking-depth.ts` is listed for one line up.
        'src/near-miss-census.ts',
        // Added with the module: the decomposition of a miss into the terms that separate its truth from its
        // winner, which is `docs/depth-reranking-preregistration.md` as arithmetic. Its whole value is that every
        // constant in it is quoted from a document written BEFORE the data — so the population statement, the
        // bar, the split and the exact-binomial correction are all asserted rather than trusted, and the
        // denominator itself is checked against the file that produces the term names.
        'src/term-decomposition.ts',
        // Added with the module: the weight screen, promoted from the 60-line script that published
        // `docs/term-weight-landscape.md` into the repository. It is measured because the promotion is where its
        // three corrections came from — the admissible set that was not empty, the understated loss column, and
        // the gross-against-net column that makes "no direction of improvement" a number rather than a sentence.
        // A screen whose arithmetic is taken on trust is a script again, with a test file in front of it.
        'src/term-weight-screen.ts',
        // The floor under every weight sweep this project has published: below a term's resolution floor no case
        // can be recovered at any weight, which is what entitles a sweep to be called complete rather than
        // grid-shaped. It is a bound on what a term can PAY and not on what it can COST, and the tests hold that
        // asymmetry — a module whose floor were read as "safe when small" would license every weight it rejects.
        'src/weight-resolution.ts',
        // Added with the module: the certified budget is the first statistic here whose claim is about the corpus
        // rather than about itself, and its whole value is four exact readings — the Clopper–Pearson end, the level
        // split across families, the budget a point needs, and the floor no amount of data moves — so every branch is
        // measured: a corpus with no families (vacuous certification), zero losses (the rule of three), a level at
        // either end of the interval, and a family that loses every case.
        'src/risk-control.ts',
        // Added with the module: the certificate a SELECTION can carry, which is the one reading the two modules
        // above cannot produce — a row named after looking at the data is not a hypothesis anybody formulated, so its
        // claim pays for the looks that named it. Its whole value is four verdicts and three winners, and every branch
        // is measured: an improvement that concedes nothing, a concession priced per budget unit, a flat row that gives
        // up budget for nothing, a population too small to state a claim, a malformed count of looks, and the
        // selection of nothing at all.
        'src/certified-selection.ts',
        // Added with the modules: the model arm's three IO-free halves — the reply cache with its provenance
        // (`agentic-claims.ts`), the proposer that drives a client under a concurrency bound
        // (`agentic-proposer.ts`), and the client itself (`chat-completions.ts`). All three are measured because
        // every one of them can fail silently in the flattering direction: a cache that accepts a stale answer, a
        // proposer that drops a failed case out of the denominator, and a client that counts a retry as an answer.
        // The client is measured against a real loopback socket, because its failure modes ARE the transport.
        'src/agentic-claims.ts',
        'src/agentic-proposer.ts',
        'src/chat-completions.ts',
        // Added with the module: the study that turns an artifact into a scored model arm. Its `runStudy` takes its
        // output sink as a parameter, which is what lets a test read the table rather than spy on a global — every
        // number it prints is a line somebody will quote. The two-line entry point that calls it
        // (`run-agentic-eliminator.ts`) is deliberately not here: a guard that only fires when the file IS the
        // process's script cannot be measured by a test that imports it, so the file is split rather than exempted.
        'src/agentic-eliminator-study.ts',
        // Added with the module: the two nulls that decide whether a paid arm contains information at all. Its
        // whole value is that both are computable from one artifact with no model and no network, so every branch
        // is measured — including the two that keep an unreadable record in the denominator instead of dropping
        // it, because a replay that shrinks its own population improves by forgetting.
        'src/agentic-null-model.ts',
        // Added with the module: what the claims CITED, read against the table they were shown. It exists because
        // the refusal ledger could not separate two failures a reader has to tell apart — a channel the eliminated
        // row never printed at all, and one it printed and the kept row did not — so every branch of that split is
        // measured, together with the ordinary-channel bucket and the empty-census path a first run takes.
        'src/agentic-citation-census.ts',
        // Added with the module: whether the model's preference depends on the case, which accuracy cannot say. Its
        // whole value is the contingency inside the cases a service was PRESENTED in, so every branch is measured —
        // including the empty half that must print as `-` rather than as the strongest rate there is, and the verdict
        // that is undecidable rather than false when one half has no denominator.
        'src/agentic-preference-census.ts',
        // Added with the second expression protocol: the record format, the refusal census and the scored arm of a
        // ranking answer. Its whole value is the accounting a reader cannot redo by hand — a refused nomination is
        // not an abstention, a case with no record keeps its engine answer and stays in the denominator, and an
        // unreadable reply is recorded rather than dropped — so every branch of that accounting is measured.
        'src/agentic-nomination.ts',
        // Added with the module: the proposal loop and the sweep. The loop's value is what it does with a call that
        // never returned, so the failure paths (a typed endpoint error, a wiring fault, a reply that is not JSON)
        // and the reuse path are measured rather than trusted.
        'src/agentic-nomination-study.ts',
        // Added with the module: the two ceilings that bound any arm — the reader (truth in the posterior, which no
        // protocol can exceed) and the union (engine or arm, which no model can exceed under that protocol) — plus
        // the recall curve that says which of the two a gap belongs to. Every branch of the accounting is measured,
        // including the empty posterior and the clamp on a depth.
        'src/agentic-protocol-ceiling.ts',
        // Added with the modules: the containment sweep's observation and the residual read off it. `containment-rows`
        // is the artifact H2's population lives in, so an unmeasured side that survives as a `null` — or a missing
        // `ungatedPairs` trace read as "the arm examined nothing" — becomes a residual rather than an error; the
        // builder is where the two arms are swept from one fusion order and where the replay against the published
        // ranking is decided, and its `differs` verdict is the only thing that can show the observation and the
        // decision disagreeing; the residual module is arithmetic whose every branch (a population below its floor,
        // one class empty, a tie, an ambiguous case) is a number a reader would otherwise take on trust; and the
        // report is where an absent measurement must print `N/A` rather than `0.5`.
        'src/containment-pruner.ts',
        'src/containment-rows.ts',
        'src/containment-row-build.ts',
        'src/containment-residual.ts',
        'src/containment-residual-report.ts',
        // Added with the gate: H2's second criterion, where a wrong split, a prior applied to the half it was
        // fitted on, or an unmeasured edge admitted as an independent one would each produce a plausible number
        // rather than an error. `containment-replay` is the walk every arm goes through — its four arms are
        // `off`, no requirement, the interface record, and a prior — and `containment-gate` is the cross-fitting
        // and the verdict, including the three ways a reading is refused rather than reported.
        'src/containment-replay.ts',
        'src/containment-gate.ts',
        'src/containment-gate-report.ts',
        'src/containment-term.ts',
        'src/containment-term-study.ts',
        'src/containment-term-report.ts',
        // Added with H7: the pass's MEASUREMENT swapped while its rule is held fixed. The study is included for
        // the reason the gate's is — three arms over one chain, where an unmeasurable row counted as a lost case
        // would turn a smaller population into a worse arm — and the report for the reason the term's is, that a
        // reason missing from the census line would read as a reason nobody looked for.
        'src/containment-surprise-study.ts',
        'src/containment-surprise-report.ts',
        // Added with H8: the interface record read at CASE scope, and the family's ceiling counted off the
        // artifact. The study is included for the reason the other two are — three arms over one chain, where an
        // unmeasurable row counted as a lost case would turn a smaller population into a worse arm — and the
        // report for the reason the others are, that a reason missing from the census line reads as a reason
        // nobody looked for.
        'src/containment-veto-study.ts',
        'src/containment-veto-report.ts',
        // Added with the exact test: the p-value that replaces the population floor, and the multiplicity that
        // replacing it exposes. Both refusals are arguments that must not become `null`s — a table whose parts do
        // not fit its whole is a lost observation, not weak evidence — and the log-space sum is the only reason a
        // 191-observation edge reports a finite number instead of `NaN`.
        'src/containment-significance.ts',
        // Added with the self-time census: the term's REACH over a corpus, printed as one line. Included because
        // the line is the only place "the arm moved nothing because the map was never built" can be said at all,
        // and a formatter outside coverage is a claim about a population nobody counts.
        'src/self-time-census-report.ts',
        // Added with the interface witness: the pricing of the resolver's three modes on ONE artifact, at zero
        // cost. Included because it is the module that decides whether a rule SHIPS — a reading that counted a
        // rename as a repair without checking the renamed answer, or a break only when the answer changed, would
        // both produce a table that looks better than the run — and its bookkeeping is asserted either way. The
        // runner beside it (`run-edge-novel-census.ts`) is an entry point and stays outside, as every `run-*` is.
        'src/edge-novel-census.ts',
        // Added with the closure labels: the ONE input format this repository does not own. Included because it
        // is the whole of what makes the evidence-closure axis adoptable rather than invented — the scope of a
        // `fault_object`, whether a milestone is decidable from a tool name alone, and the parse that refuses a
        // malformed label instead of scoring it as a miss — and because a format is exactly the kind of thing
        // that changes upstream without anybody here touching a line. The reader runs over all 754 published
        // labels and refuses none of them; a change there fails here rather than mis-scoring a corpus.
        'src/closure-labels.ts',
        // Added with the Cloud-OpsBench loader: the only reader of a corpus whose layout this repository does not
        // own. Its whole value is the four things a wrong guess would silently corrupt — the LAST hyphen that keeps
        // `redis-cart` a service, an EMPTY cell that is a gap rather than the zero `Number('')` would return, a
        // malformed row counted rather than dropped, and an `alert.json` that states no window answering `null`
        // instead of a window at epoch zero. Every branch is asserted in `cloudopsbench-case.test.ts`.
        'src/cloudopsbench-case.ts',
        // Added with the Cloud-OpsBench census: the twelve-row reach table and the audit of the competitor's own
        // replay surface. Included because the two numbers it produces ARE the decision — 472 of 2 478 milestones
        // are inside a metric/log/edge surface and 0 of 754 cases are — and because a table that defaulted an
        // unknown tool to reachable would over-report the one quantity the axis turns on. The synonym list, the
        // second key convention, the argument-free bare key and the unnamed counter are all asserted by name.
        'src/cloudopsbench-census.ts',
        // Added with the Cloud-OpsBench adapter: the four refusals that decide the denominator, in an order that
        // makes them sum to the corpus instead of overlapping it. Included because a denominator is the one number
        // a cell cannot be checked against afterwards — a case quietly kept despite having no injection time raises
        // the score, and nothing downstream can see that it happened. The absent-vs-empty distinction for
        // `logs`/`traces`/`failedTraceEdges` is asserted too: `[]` claims an artefact existed and held nothing.
        'src/cloudopsbench-suite.ts',
        // Added with the Cloud-OpsBench runner's flags. Included because a silently ignored flag is how a run gets
        // reported under a configuration it did not use, and because `--max-cases` caps the number of DIRECTORIES
        // READ rather than the number of cases kept: a cap applied after selection changes what the denominator
        // means while leaving the printed rate looking ordinary.
        'src/cloudopsbench-cli.ts',
        // Added with the Cloud-OpsBench cell table. Included because counting is where a benchmark reading goes
        // wrong invisibly: the verdict is read from the runner rather than recomputed from top-1, an unranked
        // truth stays out of every Top@k numerator instead of being credited as rank 0, and a case id the cell map
        // does not know THROWS rather than being skipped into a smaller denominator.
        'src/cloudopsbench-score.ts',
        // Added with the neighbour rerank probe: the module that turns §362's "50 % of misses lead with a neighbour"
        // into a priced arm and then refuses it in both signs. Included because every one of its claims is arithmetic
        // a reader cannot check by eye — a within-case normalisation that must not change the engine's order at
        // `α = 0`, a mean over partners that must not pay for degree, a Poisson-binomial null in place of the
        // binomial one a heterogeneous degree invalidates, and a decision rule whose four clauses are the only thing
        // standing between a sweep of seven arms and a number adopted because it was the largest of seven.
        'src/neighbour-rerank.ts',
        // Added with the miss-term census: the count that names the Hard bucket's remaining 34.9 pp instead of
        // describing it. Included because the three ways it could lie are all silent — a hit filed under a term
        // inflates every count by the population the engine already gets right, an unranked truth decomposed as a
        // difference of zeros reads as a decided miss, and a case whose cell is missing shrinks the denominator of a
        // share the reader cannot re-derive. Every one of those is asserted by name in `miss-term-census.test.ts`,
        // along with the two orderings that keep two runs printing the same table.
        'src/miss-term-census.ts',
        // Added with the membership grid: the four cells, the weight that would flip a case, the budget split and the
        // offline repricing. Included because every one of its numbers can lie silently — an unranked truth filed as a
        // measured exclusion, a median taken over cases with no family, a precision of `0` where the population is
        // empty, a reprice that breaks a tie by service id, and a McNemar p over two different case sets. Each is
        // asserted by name in `dual-family-membership.test.ts`, including the corruption check that a single-label hit
        // can never land in either asymmetric cell.
        'src/dual-family-membership.ts',
        // Added with the margin-gated prior — the first arm on this corpus that lifts one cell without charging
        // another. Included because each of its readings has a way of being silently wrong that no cell table would
        // show: a prior that includes the case it scores, a floor smoothed by a constant instead of `1/V`, a gate read
        // off the gated score, a margin taken from the wrong pair, and an unlabelled neighbour counted as a zero.
        // `margin-gated-prior.test.ts` asserts every one of those by name, plus the two properties of the registered
        // grid (the null arm first, and at least one gated arm per scope).
        'src/margin-gated-prior.ts',
        // Added with the ENGINE's wiring of that prior. Included because the construction is where the arm can be
        // silently dishonest in three ways no cell table shows: a pool that includes the case it scores (hindsight
        // dressed as history), a multi-label case counted once per accepted answer (a history larger than the number
        // of incidents), and a case with no accepted answer counted as a zero (every probability shrunk toward a
        // uniform nobody measured). `label-prior-profiles.test.ts` asserts each by name, and the fourth assertion is
        // the one the engine depends on: the per-case map must key EVERY case it was handed.
        'src/label-prior-profiles.ts',
        // Added with the FSE'26 half's history. Included because the reader is where this half can be wrong in a
        // way no cell table shows: a prefix scan that silently missed the label would read as "this deployment
        // diagnosed nothing here", and a fallback that did not agree with the loader would score the corpus
        // against a history the corpus does not have. `fse26-label-history.test.ts` asserts the fast path, the
        // fallback on a file padded past the window, the bracket inside a service name, the pooling rule and the
        // unreadable count by name.
        'src/fse26-label-history.ts',
        // Added with the gate's census: the reach is what separates a term the gate withheld everywhere from a
        // term that spoke and agreed, so the two are counted apart — and a run that never armed the term is a
        // third state rather than a zero.
        'src/label-prior-reach.ts',
        // Added with the module, and it should have existed before the enrolment: the Cloud-OpsBench runner answered
        // "is the label prior priced?" from the RAW command line, which agreed with the engine only while the shipped
        // weight was `0`. The projection answers it from the resolved options, and what is measured here is the pair
        // of facts that keeps the two from drifting again — the resolved weight IS the shipped default when no flag
        // is passed, and an absent flag does not overwrite that default with `undefined`.
        'src/cloudopsbench-arm-baseline.ts',
        'src/cloudopsbench-engine-options.ts',
        // Added with the module, and it is the one this corpus needed for three iterations without anyone asking:
        // `raw_data/logs.json` is present in 754 of 754 case directories and `cloudopsbench-suite.ts` declared the
        // corpus carried no log at all. The parts measured here are the four line shapes the file mixes, the
        // eight-hour wall-clock offset that decides whether the engine's `timestamp >= injectTimeMs` filter admits a
        // single line, and the census that keeps "not asked", "absent", "empty" and "read" apart — because a bridge
        // whose coverage is a zero reads identically to a bridge that was never run.
        'src/cloudopsbench-logs.ts',
        // Added with the module, and for the reason the module exists: two of the board's six metrics were in the
        // comparison because two were cheap to transcribe. What is measured here is the arithmetic that turns a
        // verdict file into all six — the cumulative ladder, the MRR convention that charges a miss zero, the
        // `Avg@k` definition recovered from the board's own published rows, and the two refusals (a row from before
        // the rank columns, a difference across two populations) that keep a comparison from being made anyway.
        'src/board-metrics.ts',
        // Added with the module, and it is the one that turns a one-name arm into a row the metric layer can read:
        // `sota-comparison.md` refused five of the board's six columns for the LLM arm because the arm publishes a
        // NAME and four of the six are functions of a position in an ORDER. What is measured here is the promotion
        // rule (the settled name first, the order behind it), the depth consequence of it (everything above the
        // promoted name is demoted by one, so an arm can repair the head and cost a rank in the same case), the pool
        // arithmetic when the arm names a service the pool did not carry, and every refusal that keeps a composed
        // file from being a different population: an answer to an unscored case, two answers for one case, a dump
        // truncated below its own candidate count, an empty name.
        'src/arm-order.ts',
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
