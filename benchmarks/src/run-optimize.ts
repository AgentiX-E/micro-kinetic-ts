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
import type {
  BenchmarkCase,
  BenchmarkLogEntry,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { augmentTopologyWithTraces } from '../../packages/kinetic/src/signals/trace-topology.js';
import type { RCAConfiguration } from '../../packages/optimize/src/index.js';
import {
  coordinateDescent,
  createEngineWithConfig,
  DEFAULT_CONFIG,
  rankingToVector,
  stratifiedSplit,
  vectorToRanking,
} from '../../packages/optimize/src/index.js';
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
    maxCases: 0,
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

/**
 * Derive a lightweight `system:suite` stratum key from a directory PATH only,
 * without parsing any file. Used to deterministically down-sample the full
 * 735-case dataset before loading — loading every case at once exhausts the
 * 12 GB CI heap (the benchmark itself caps RE2 at 50 cases for the same
 * reason), so we sample proportionally per (system, suite) to stay bounded
 * while preserving the fault-type distribution.
 */
function deriveStratumKey(dirPath: string): string {
  let suite = '';
  let system = '';
  for (const seg of dirPath.replace(/\\/g, '/').split('/')) {
    const lower = seg.toLowerCase();
    if (!suite) {
      const m = lower.match(/^re([123])/);
      if (m) suite = `re${m[1]}`;
    }
    if (!system) {
      if (/^re[123](ob|ss|tt)\b/.test(lower)) {
        system = lower.slice(2, 4);
      } else if (lower === 'ob' || lower === 'onlineboutique') system = 'ob';
      else if (lower === 'ss' || lower === 'sockshop') system = 'ss';
      else if (lower === 'tt' || lower === 'trainticket') system = 'tt';
    }
  }
  return `${system || 'unknown'}:${suite || 'unknown'}`;
}

const SUITE_IDS = { RE1: 'rcaeval-re1', RE2: 'rcaeval-re2', RE3: 'rcaeval-re3' } as const;

// ── Case loading ──────────────────────────────────────────

interface LoadedCase {
  benchCase: BenchmarkCase;
  /** Stratum key = system + suite + fault type. */
  stratum: string;
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
  // held at once, so cap the working set to `maxCases` while preserving each
  // (system, suite) stratum's share.
  if (maxCases > 0 && dirs.length > maxCases) {
    const ratio = maxCases / dirs.length;
    const { train } = stratifiedSplit(
      dirs,
      deriveStratumKey,
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
      }

      const benchCase = loader.toBenchmarkCase(rawCase, callGraph, suiteId);
      out.push({
        benchCase,
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
      try {
        const faultGraph = engine.buildFaultGraph(c.callGraph, c.metrics, {
          injectTimeMs: 0,
          logs: c.logs as readonly BenchmarkLogEntry[],
        });
        const results = await engine.analyze(faultGraph, 1);
        evaluated++;
        if (results.length > 0 && results[0]!.serviceId === c.groundTruth.serviceId) {
          correct++;
        }
      } catch {
        // Skip cases the engine cannot build (defensive parity with the runner).
      }
    }

    return evaluated > 0 ? correct / evaluated : 0;
  };
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

  if (!existsSync(opts.dataDir)) {
    console.error(`Data directory not found: ${opts.dataDir}`);
    process.exit(2);
  }

  const loaded = await loadAllCases(opts.dataDir, opts.maxCases, opts.seed);
  console.log(`loaded ${loaded.length} cases`);

  if (loaded.length === 0) {
    console.error('No cases loaded — aborting.');
    process.exit(2);
  }

  // Stratified split by system + suite + fault type.
  const { train, val, test } = stratifiedSplit(
    loaded,
    (l) => l.stratum,
    { train: 0.7, val: 0.15, test: 0.15 },
    opts.seed,
  );
  const trainCases = train.map((l) => l.benchCase);
  const valCases = val.map((l) => l.benchCase);
  const testCases = test.map((l) => l.benchCase);
  console.log(`split: train=${trainCases.length} val=${valCases.length} test=${testCases.length}`);

  const initial = rankingToVector(DEFAULT_CONFIG.ranking);

  const evaluate = async (u: Float64Array, cases: readonly BenchmarkCase[]): Promise<number> =>
    makeOracle(cases)(u);

  const trainAcc0 = await evaluate(initial, trainCases);
  const valAcc0 = await evaluate(initial, valCases);
  const testAcc0 = await evaluate(initial, testCases);
  console.log(
    `baseline (default weights): train=${formatPct(trainAcc0)} val=${formatPct(valAcc0)} test=${formatPct(testAcc0)}`,
  );

  // Coordinate descent on the TRAIN split only.
  const oracle = makeOracle(trainCases);
  // Step length in unit space must match the ranking-vector dimension; derive
  // it from `initial` so adding a weight (5 → 6) cannot desynchronise them.
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
    `tuned weights: source=${bestWeights.sourceWeight.toFixed(2)} temporal=${bestWeights.temporalWeight.toFixed(2)} collision=${bestWeights.collisionWeight.toFixed(2)} topo=${bestWeights.topoWeight.toFixed(2)} log=${bestWeights.logWeight.toFixed(2)}`,
  );

  console.log('\n=== Generalization (held-out) ===');
  console.log(`train = ${formatPct(trainAcc)}`);
  console.log(`val   = ${formatPct(valAcc)}`);
  console.log(`test  = ${formatPct(testAcc)}`);
  console.log(
    `\nbaseline test = ${formatPct(testAcc0)} | tuned test = ${formatPct(testAcc)} | Δ = ${testAcc - testAcc0 >= 0 ? '+' : ''}${((testAcc - testAcc0) * 100).toFixed(1)}pp`,
  );
}

main().catch((err) => {
  console.error('Weight search failed:', err);
  process.exit(1);
});
