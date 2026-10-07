/**
 * L2 offline weight search — coordinate descent over the ranking fusion
 * weights, evaluated on the RCAEval dataset with a train/val/test split.
 *
 * The optimizer (GP/LLM in `optimize-all.ts`) validates on SYNTHETIC data,
 * which cannot tell us whether a weight combination generalizes to real
 * RCAEval faults. This harness closes that gap:
 *
 *   1. Loads all RCAEval cases (RE1/RE2/RE3).
 *   2. Splits them into train / validation / held-out test via a deterministic
 *      stratified split (stratum = system + suite + fault type).
 *   3. Runs coordinate descent over the five ranking fusion weights
 *      (`RankingWeights`) on the TRAIN split only.
 *   4. Reports the tuned weights' accuracy on train, validation, and test —
 *      the test number is the honest, held-out generalization estimate.
 *
 * The search is deliberately constrained to the ranking weights; the tree-decay
 * and discrete parameters stay at DEFAULT_CONFIG. This is the L2 layer: tune
 * only the source/symptom blending weights, not the whole pipeline.
 *
 * The oracle evaluates in the dataset-decoupled (OFF) regime — `injectTimeMs=0`
 * so no RCAEval-specific injection time is consumed — matching the production
 * SOTA target, while still forwarding logs for the log signal.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-optimize.ts [--data-dir ~/RCAEval-json] [--max-cases 0] [--rounds 4] [--seed 42]
 *
 * @module benchmarks/run-optimize
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { TraceSpan } from '@agentix-e/micro-kinetic-core';
import { RCAEvalLoader } from '../../packages/kinetic/src/benchmarks/index.js';
import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { toFaultGraphOptions } from '../../packages/kinetic/src/benchmarks/runners/fault-graph-options.js';
import { augmentTopologyWithTraces } from '../../packages/kinetic/src/signals/trace-topology.js';
import type { RCAConfiguration } from '../../packages/optimize/src/index.js';
import {
  coordinateDescent,
  createEngineWithConfig,
  DEFAULT_CONFIG,
  formatEngineConfigLine,
  RANKING_AXES,
  rankingToVector,
  stratifiedSplit,
  vectorToRanking,
} from '../../packages/optimize/src/index.js';
import {
  formatDirectionalEvidence,
  formatEvidenceSeparation,
  readDirectionalEvidence,
  readEvidenceSeparation,
  toEngineDirectionalInputs,
} from './directional-evidence.js';
import {
  CORPUS_SAMPLING_OBJECTIVE,
  deriveStratumFromCaseDir,
  formatCaseManifest,
  formatDatasetStrata,
  formatOverlayCounts,
  formatPopulation,
  formatSplitCapability,
  formatSplitCapacity,
  formatStratumRollup,
  OPTIMIZE_MAX_CASES,
  OPTIMIZE_SPLIT_RATIOS,
  strataCovered,
  summarizeDatasetStrata,
  summarizeOverlay,
  summarizePopulation,
  summarizeSplitCapability,
  type CaseOutcome,
  type CaseVerdict,
  type PopulationCase,
} from './optimize-population.js';
import { buildRCAEvalCallGraph, initRCAEvalTopology } from './rcaeval-topology.js';

// ── CLI ───────────────────────────────────────────────────

interface CliOptions {
  dataDir: string;
  maxCases: number;
  rounds: number;
  seed: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCAEval-json'),
    maxCases: OPTIMIZE_MAX_CASES,
    rounds: 4,
    seed: 42,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--max-cases' && i + 1 < args.length)
      opts.maxCases = parseInt(args[++i]!, 10) || 0;
    else if (args[i] === '--rounds' && i + 1 < args.length)
      opts.rounds = parseInt(args[++i]!, 10) || 4;
    else if (args[i] === '--seed' && i + 1 < args.length)
      opts.seed = parseInt(args[++i]!, 10) || 42;
  }
  return opts;
}

// ── Case discovery ────────────────────────────────────────

/**
 * Walk `dataDir` recursively and return every directory that contains a
 * `metrics.json` (i.e. an RCAEval case directory), in deterministic order.
 */
function discoverCaseDirs(dataDir: string): string[] {
  const found: string[] = [];
  const queue: string[] = [dataDir];

  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === 'metrics.json')) {
      found.push(current);
      continue; // do not descend into a case directory
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        queue.push(join(current, entry.name));
      }
    }
  }

  found.sort();
  return found;
}

/** Extract the suite (RE1/RE2/RE3) from a case directory path. */
function detectSuite(dirPath: string): 'RE1' | 'RE2' | 'RE3' {
  const segments = dirPath.replace(/\\/g, '/').split('/');
  for (let i = segments.length - 1; i >= 0; i--) {
    const m = segments[i]!.match(/^re([123])(?:[^/]*)$/i) ?? segments[i]!.match(/^re([123])$/i);
    if (m) return `RE${m[1]}` as 'RE1' | 'RE2' | 'RE3';
  }
  return 'RE1';
}

const SUITE_IDS = { RE1: 'rcaeval-re1', RE2: 'rcaeval-re2', RE3: 'rcaeval-re3' } as const;

// ── Case loading ──────────────────────────────────────────

interface LoadedCase {
  benchCase: BenchmarkCase;
  /** Stratum key = `<stem>:<RE n>:<fault>`, built from the case's own JSON. */
  stratum: string;
  /**
   * The directory this case was read from.
   *
   * Kept so the dataset-side stratum — derived from PATHS, before anything is loaded — can be cross-checked
   * against the loader-side key for every case that IS loaded. The path derivation is a hypothesis about a
   * naming scheme; this is how the run tests it instead of trusting it.
   */
  dir: string;
}

async function loadAllCases(
  dataDir: string,
  maxCases: number,
  seed: number,
): Promise<LoadedCase[]> {
  const loader = new RCAEvalLoader();
  await initRCAEvalTopology(); // exact-match topology (no semantic/API dependency)

  let dirs = discoverCaseDirs(dataDir);

  // Deterministic, stratified down-sample before loading: the full dataset
  // (735 cases) does not fit in the CI heap when every case's logs+metrics are
  // held at once, so cap the working set to `maxCases`.
  //
  // THE KEY IS THE FAULT-LEVEL ONE, and that is a repair rather than a detail. Stratifying on `system:suite`
  // — nine strata — preserves each system-and-suite share and says nothing about fault types, so a rare fault
  // type competes inside a nine-way partition and is drawn thinly or not at all. Measured: the dataset has 46
  // `system:suite:fault` strata of which only **2** are below the size a held-out split needs, yet the corpus
  // that nine-way key produced had **44** strata of which **28** were below it — the deficit was the
  // SAMPLER's, not the dataset's. Sampling each fault stratum from its own share is what makes the corpus's
  // coverage a statement about the split rather than about the draw.
  if (maxCases > 0 && dirs.length > maxCases) {
    const ratio = maxCases / dirs.length;
    const { train } = stratifiedSplit(
      dirs,
      deriveStratumFromCaseDir,
      { train: ratio, val: 0, test: 1 - ratio },
      seed,
    );
    dirs = [...train];
  }

  const out: LoadedCase[] = [];
  for (const dir of dirs) {
    try {
      const rawCase = loader.loadCase(dir);
      const suite = detectSuite(dir);
      const suiteId = SUITE_IDS[suite];

      const serviceIds = Object.keys(rawCase.metrics);
      let callGraph = buildRCAEvalCallGraph(rawCase.benchmark, serviceIds);
      // THE DIRECTION the RCAEval side never supplied, derived from the SAME spans the augmentation consumes.
      // Carried as a compact per-EDGE aggregate while the spans themselves stay dropped (the loader's documented
      // memory trade), so the two fields the engine reads for a fault's direction stop being structurally absent
      // on every RCAEval run.
      let directional: ReturnType<typeof toEngineDirectionalInputs> = {
        failedTraceEdges: [],
        edgeLatency: [],
      };

      if (rawCase.traces && rawCase.traces.length > 0) {
        const spans: TraceSpan[] = rawCase.traces.map((t) => ({
          traceId: t.traceId,
          spanId: t.spanId,
          parentSpanId: t.parentSpanId ?? '',
          service: t.service,
          operation: t.operationName,
          duration: t.duration,
          statusCode: t.status === 'ERROR' ? 500 : 200,
          isError: t.status === 'ERROR',
          startTime: t.startTime * 1000,
        }));
        callGraph = augmentTopologyWithTraces(callGraph, spans, { minCallFrequency: 1 });
        // `rawCase.injectTime` and the raw spans are in SECONDS; this adapter converts both to the milliseconds
        // the derivation's before/after split is defined over.
        directional = toEngineDirectionalInputs(
          spans.map((s) => ({
            spanId: s.spanId,
            parentSpanId: s.parentSpanId === '' ? undefined : s.parentSpanId,
            service: s.service,
            startTime: s.startTime,
            duration: s.duration,
            status: s.isError === true ? ('ERROR' as const) : ('OK' as const),
          })),
          rawCase.injectTime * 1000,
        );
      }

      const benchCase: BenchmarkCase = {
        ...loader.toBenchmarkCase(rawCase, callGraph, suiteId),
        failedTraceEdges: directional.failedTraceEdges,
        edgeLatency: directional.edgeLatency,
      };
      out.push({
        benchCase,
        dir,
        stratum: `${rawCase.benchmark}:${suite}:${rawCase.fault}`,
      });
      // `rawCase` goes out of scope here; its (large) trace array is eligible
      // for GC because `toBenchmarkCase` deliberately drops traces.
    } catch {
      // Defensive: a malformed case must not abort the whole search.
    }
  }

  return out;
}

// ── Oracle ────────────────────────────────────────────────

/** Build a config whose ONLY variation is the ranking weights. */
function withRankingWeights(weights: ReturnType<typeof vectorToRanking>): RCAConfiguration {
  return { ...DEFAULT_CONFIG, ranking: weights };
}

/**
 * Evaluate a ranking-weight vector (unit-cube [0,1]⁵) as the AC@1 accuracy
 * over a fixed case set, in the dataset-decoupled (OFF) regime.
 */
function makeOracle(cases: readonly BenchmarkCase[]): (u: Float64Array) => Promise<number> {
  return async (u: Float64Array): Promise<number> => {
    const weights = vectorToRanking(u);
    const config = withRankingWeights(weights);
    const engine = createEngineWithConfig(config);

    let correct = 0;
    let evaluated = 0;
    for (const c of cases) {
      const outcome = await scoreCase(engine, c);
      // A case the engine cannot build is SKIPPED rather than counted as a miss, which is what the
      // denominator has always done — and the overlay reports it as its own count so the two can be
      // reconciled instead of assumed.
      if (outcome === 'skipped') continue;
      evaluated++;
      if (outcome === 'hit') correct++;
    }

    return evaluated > 0 ? correct / evaluated : 0;
  };
}

/**
 * Score one case with an engine already built for a configuration.
 *
 * The verdict is the ONE definition of a hit in this runner, shared by {@link makeOracle} — which reduces
 * these to an accuracy 33 times per search — and by the overlay that reports them per case. Duplicating the
 * predicate would let the accuracy and the manifest disagree about the same run, which is the defect this
 * sweep keeps finding one layer down, and `CaseOutcome` lives in `optimize-population.ts` for the same reason.
 *
 * @param engine - The engine to rank with.
 * @param c - The case to score.
 * @returns `hit` when rank-1 is the ground-truth service, `miss` when it is not, `skipped` when the engine
 *          cannot build the case's fault graph at all.
 */
async function diagnoseCase(
  engine: ReturnType<typeof createEngineWithConfig>,
  c: BenchmarkCase,
): Promise<{ built: boolean; top1?: string }> {
  try {
    // THROUGH THE SHARED ASSEMBLY, not an inline literal. `toFaultGraphOptions` exists because two call sites
    // drifted and `traceActivity` and then `failedTraceEdges` were each silently dead on the benchmark with the
    // largest case count; this file was a THIRD site, forwarding `logs` and nothing else. On RCAEval all three
    // forwarded fields are undefined today, so this is behaviour-preserving — and it is the precondition for
    // any change that makes them non-empty, because an input that does not reach the engine reports "no change".
    const faultGraph = engine.buildFaultGraph(
      c.callGraph,
      c.metrics,
      // `0` is this caller's own policy (the injection anchor disabled), which the shared function takes as a
      // parameter precisely because the caller owns it.
      toFaultGraphOptions(c, 0),
    );
    const results = await engine.analyze(faultGraph, 1);
    // `built` is separated from `top1` because the two absences mean different things: a case the engine could
    // not build is not evidence about a ranking, while a case it built and ranked nothing for IS — the engine
    // named nothing where a source existed. Collapsing them would let a build failure read as a wrong answer.
    return results.length > 0 && results[0] !== undefined
      ? { built: true, top1: results[0].serviceId }
      : { built: true };
  } catch {
    return { built: false };
  }
}

/**
 * Score one case: the engine's rank-1 against the ground truth.
 *
 * @param engine - The engine to rank with.
 * @param c - The case to score.
 * @returns `hit` when rank-1 is the ground-truth service, `miss` when it is not or nothing was named,
 *          `skipped` when the engine cannot build the case's fault graph at all.
 */
async function scoreCase(
  engine: ReturnType<typeof createEngineWithConfig>,
  c: BenchmarkCase,
): Promise<CaseOutcome> {
  const d = await diagnoseCase(engine, c);
  if (!d.built) return 'skipped';
  return d.top1 === c.groundTruth.serviceId ? 'hit' : 'miss';
}

// ── Reporting ─────────────────────────────────────────────

function formatPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log('=== L2 Ranking-Weight Search (RCAEval, train/val/test) ===');
  console.log(`data: ${opts.dataDir}`);
  console.log(
    `maxCases: ${opts.maxCases === 0 ? 'all' : opts.maxCases}, rounds: ${opts.rounds}, seed: ${opts.seed}`,
  );
  // WHAT THIS SEARCH SEARCHES, and what it does not. The artifact used to report seven tuned weights and
  // nothing else, which read as "the optimizer found nothing to improve" without saying that four terms
  // that dominate the shipped ranking were ON, held, and absent from the search space — or that the base it
  // searched differs from the golden in `rankNormalization`. Both are one line each now.
  console.log(`search space (7 axes): ${RANKING_AXES.join(', ')}`);
  console.log(formatEngineConfigLine(DEFAULT_CONFIG));

  if (!existsSync(opts.dataDir)) {
    console.error(`Data directory not found: ${opts.dataDir}`);
    process.exit(2);
  }

  // THE DATASET, read from case DIRECTORY NAMES before anything is loaded. This is the population the cap
  // samples from, and its stratum sizes are what decide whether a larger cap could give the held-out splits
  // full coverage — a stratum with fewer than the boundary's cases in the whole dataset cannot be covered at
  // any cap, so the cap is not always the lever. `discoverCaseDirs` opens no file.
  const allCaseDirs = discoverCaseDirs(opts.dataDir);
  const SPLIT_RATIOS_FOR_DATASET = OPTIMIZE_SPLIT_RATIOS;
  console.log(
    formatDatasetStrata(
      summarizeDatasetStrata(allCaseDirs, SPLIT_RATIOS_FOR_DATASET),
      SPLIT_RATIOS_FOR_DATASET,
    ),
  );

  const loaded = await loadAllCases(opts.dataDir, opts.maxCases, opts.seed);
  console.log(`loaded ${loaded.length} cases`);

  // Does the path derivation agree with what the loader read? Reported as a COUNT rather than assumed, and
  // loud when it is not zero: the line above describes the dataset by paths alone, and a naming scheme it
  // cannot parse would make that line wrong while looking authoritative.
  const disagreements = loaded.filter((l) => deriveStratumFromCaseDir(l.dir) !== l.stratum);
  if (disagreements.length > 0) {
    console.log(
      `WARNING: the path-derived stratum disagrees with the loaded key on ${disagreements.length} of ` +
        `${loaded.length} cases (e.g. ${disagreements[0]!.dir} -> ` +
        `${deriveStratumFromCaseDir(disagreements[0]!.dir)} vs ${disagreements[0]!.stratum}) — the ` +
        `dataset line above is measured with the same derivation and is therefore unreliable`,
    );
  } else {
    console.log(
      `path-derived stratum agrees with the loaded key on ${loaded.length}/${loaded.length} loaded cases`,
    );
  }

  if (loaded.length === 0) {
    console.error('No cases loaded — aborting.');
    process.exit(2);
  }

  // Stratified split by system + suite + fault type.
  //
  // The RATIOS ARE THE NAMED CONSTANT, which is the site the affordability argument is about: `strata x
  // boundary` is what this split's coverage costs, and at the old 70/15/15 it cost 276 cases against a
  // 200-case heap. A literal here would be a second answer to the question the artifact has to justify, and
  // the second site is exactly the one a reader checks least.
  const { train, val, test } = stratifiedSplit(
    loaded,
    (l) => l.stratum,
    OPTIMIZE_SPLIT_RATIOS,
    opts.seed,
  );
  const trainCases = train.map((l) => l.benchCase);
  const valCases = val.map((l) => l.benchCase);
  const testCases = test.map((l) => l.benchCase);
  console.log(`split: train=${trainCases.length} val=${valCases.length} test=${testCases.length}`);

  // WHAT THIS CORPUS IS. The three counts above say how MANY cases each split holds and nothing about which:
  // not the system or fault-type composition, not which fault types the held-out splits are missing, and not
  // — the question that decided the previous iteration — how many cases are large enough for the shipped
  // rank-normalization value to act on at all. Node counts come from the case's own call graph, which is the
  // quantity the engine's guard compares.
  const asPopulation = (cases: readonly LoadedCase[]): PopulationCase[] =>
    cases.map((l) => ({ stratum: l.stratum, nodes: l.benchCase.callGraph.nodes.size }));
  const corpus = asPopulation(loaded);
  for (const line of formatPopulation(summarizePopulation(corpus), 'corpus')) {
    console.log(line);
  }
  console.log(`strata: corpus=${strataCovered(corpus)} distinct (system:suite:fault)`);
  // The split's own capability, measured against the corpus: the coverage the held-out numbers are quoted
  // over depends on how many strata are large enough to appear in BOTH of them, and that is a quantity the
  // corpus and the ratios decide together.
  const SPLIT_RATIOS = SPLIT_RATIOS_FOR_DATASET;
  const capability = summarizeSplitCapability(corpus, SPLIT_RATIOS);
  console.log(formatSplitCapability(capability, SPLIT_RATIOS));
  // WHETHER ANY SAMPLING OBJECTIVE COULD FIX THE COVERAGE UNDER THIS RUN'S CAP, and which objective this run
  // used. The first is arithmetic on three numbers the run already knows; the second is stated because a
  // reader comparing two runs needs to know if the corpus was drawn the same way.
  console.log(`sampling objective: ${CORPUS_SAMPLING_OBJECTIVE}`);
  console.log(formatSplitCapacity(capability, SPLIT_RATIOS, opts.maxCases));
  for (const [label, cases] of [
    ['train', train],
    ['val', val],
    ['test', test],
  ] as const) {
    console.log(`strata: ${label}=${strataCovered(asPopulation(cases))}`);
  }

  const initial = rankingToVector(DEFAULT_CONFIG.ranking);

  const evaluate = async (u: Float64Array, cases: readonly BenchmarkCase[]): Promise<number> =>
    makeOracle(cases)(u);

  /**
   * The same scoring, per case, for the overlay.
   *
   * `scoreCase` is called here too rather than a copy of the comparison, so the accuracy above and the
   * manifest below cannot disagree about what a hit is — and the overlay line prints the accuracy its own
   * counts imply, which is how a reader checks that without re-running anything.
   */
  const verdictsFor = async (
    u: Float64Array,
    cases: readonly LoadedCase[],
  ): Promise<CaseVerdict[]> => {
    const engine = createEngineWithConfig(withRankingWeights(vectorToRanking(u)));
    const out: CaseVerdict[] = [];
    for (const l of cases) {
      out.push({
        caseId: l.benchCase.id,
        stratum: l.stratum,
        outcome: await scoreCase(engine, l.benchCase),
      });
    }
    return out;
  };

  /**
   * Print a configuration's outcomes per split: counts, per-stratum rollup, and the TEST manifest.
   *
   * The manifest is emitted for the held-out split only. That is the set whose movement has to be attributed
   * when a number changes between runs, and the one a diff between two artifacts should be read against;
   * `train` is the set the search saw, so its per-case detail is not evidence about generalization.
   */
  const printOverlay = async (u: Float64Array, config: string): Promise<void> => {
    console.log(`\n=== Per-case overlay (${config}) ===`);
    for (const [label, cases] of [
      ['train', train],
      ['val', val],
      ['test', test],
    ] as const) {
      const verdicts = await verdictsFor(u, cases);
      console.log(formatOverlayCounts(summarizeOverlay(label, verdicts), config));
      for (const line of formatStratumRollup(label, verdicts)) console.log(line);
      if (label === 'test')
        for (const line of formatCaseManifest(label, verdicts)) console.log(line);
    }
  };

  const trainAcc0 = await evaluate(initial, trainCases);
  const valAcc0 = await evaluate(initial, valCases);
  const testAcc0 = await evaluate(initial, testCases);
  console.log(
    `baseline (default weights): train=${formatPct(trainAcc0)} val=${formatPct(valAcc0)} test=${formatPct(testAcc0)}`,
  );
  // WHICH CASES those three numbers are made of, for the configuration they were measured under. The counts
  // reconcile with the line above by construction, and the test manifest is the set a diff between two runs
  // is read against.
  await printOverlay(initial, 'default weights');

  // THE DIRECTIONAL EVIDENCE, and whether it separates the cases the engine misses. The observables are
  // derived from each case's OWN traces (never from its ground truth), so a reading about them is deployable;
  // the truth is used only to evaluate the reading. This is the measurement §85's falsifier asks for, and it
  // has never been taken on the RCAEval side because `failedTraceEdges`/`edgeLatencies` are FSE'26-only.
  {
    const engine = createEngineWithConfig(withRankingWeights(vectorToRanking(initial)));
    const truthByCase = new Map<string, string>();
    const top1ByCase = new Map<string, string>();
    const stratumByCase = new Map<string, string>();
    const readings = [];
    for (const l of loaded) {
      readings.push(
        readDirectionalEvidence({
          caseId: l.benchCase.id,
          stratum: l.stratum,
          // The case's REAL injection time, not the `0` the engine is built with above: the evidence is about
          // what the traces do across the injection, so the boundary has to be the actual one.
          injectTimeMs: l.benchCase.injectTime,
          traces: l.benchCase.traces,
        }),
      );
      truthByCase.set(l.benchCase.id, l.benchCase.groundTruth.serviceId);
      stratumByCase.set(l.benchCase.id, l.stratum);
      const d = await diagnoseCase(engine, l.benchCase);
      if (d.top1 !== undefined) top1ByCase.set(l.benchCase.id, d.top1);
    }
    console.log('\n=== Directional evidence (derived from traces, label-free) ===');
    for (const line of formatDirectionalEvidence(readings)) console.log(line);
    for (const channel of ['failedMass', 'latencyRise'] as const) {
      for (const want of ['', 'loss']) {
        for (const line of formatEvidenceSeparation(
          readEvidenceSeparation(
            readings,
            (id) => truthByCase.get(id),
            (id) => top1ByCase.get(id),
            (id) => stratumByCase.get(id) ?? '',
            want,
            channel,
          ),
        )) {
          console.log(line);
        }
      }
    }
  }

  // Coordinate descent on the TRAIN split only.
  const oracle = makeOracle(trainCases);
  // Step length in unit space must match the ranking-vector dimension; derive
  // it from `initial` so adding a weight cannot desynchronise them.
  const step = new Float64Array(initial.length).fill(0.25); // weight step 0.75 in [0,3] space
  const result = await coordinateDescent(oracle, {
    initial,
    stepSizes: step,
    maxRounds: opts.rounds,
    minStep: 1e-3,
    shrinkFactor: 0.5,
  });

  const bestWeights = vectorToRanking(result.best);
  const trainAcc = await evaluate(result.best, trainCases);
  const valAcc = await evaluate(result.best, valCases);
  const testAcc = await evaluate(result.best, testCases);

  console.log('\n=== Search Result ===');
  console.log(`iterations: ${result.rounds} sweeps, ${result.evaluations} oracle evaluations`);
  console.log(`best train: ${formatPct(result.bestScore)}`);
  console.log(
    `tuned weights: source=${bestWeights.sourceWeight.toFixed(2)} temporal=${bestWeights.temporalWeight.toFixed(2)} collision=${bestWeights.collisionWeight.toFixed(2)} topo=${bestWeights.topoWeight.toFixed(2)} log=${bestWeights.logWeight.toFixed(2)} trace=${(bestWeights.traceWeight ?? 0).toFixed(2)} prism=${(bestWeights.prismWeight ?? 0).toFixed(2)}`,
  );

  console.log('\n=== Generalization (held-out) ===');
  console.log(`train = ${formatPct(trainAcc)}`);
  console.log(`val   = ${formatPct(valAcc)}`);
  console.log(`test  = ${formatPct(testAcc)}`);
  // And the same overlay for the TUNED configuration, so a difference between the two blocks is the tuning's
  // per-case effect rather than a number that has to be taken on trust.
  await printOverlay(result.best, 'tuned weights');
  // The tuned configuration in full, through the same mapping the engine is built by — so the two numbers
  // above can be read against the configuration that produced them rather than against seven of its fields.
  // The search varies the RANKING vector only, so the rest of the configuration is the base it started from.
  console.log(formatEngineConfigLine({ ...DEFAULT_CONFIG, ranking: vectorToRanking(result.best) }));
  console.log(
    `\nbaseline test = ${formatPct(testAcc0)} | tuned test = ${formatPct(testAcc)} | Δ = ${testAcc - testAcc0 >= 0 ? '+' : ''}${((testAcc - testAcc0) * 100).toFixed(1)}pp`,
  );
}

main().catch((err) => {
  console.error('Weight search failed:', err);
  process.exit(1);
});
