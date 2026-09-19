/**
 * Argument parsing for the RCAEval benchmark runner.
 *
 * Extracted from `run-rcaeval.ts` for the reason `fse26-cli.ts` records about itself: that file
 * calls `main()` at import time and therefore cannot be imported by a test, so its parser was
 * unreachable to every guard in `benchmarks/__tests__/`. The hole that survived in the FSE'26
 * parser survived here too, and here it is wider.
 *
 * ## An unrecognised argument used to be DISCARDED SILENTLY
 *
 * The chain ended with the last `else if` and no `else`: a token the runner did not test left the
 * loop untouched, so the run proceeded at the shipped configuration and printed a confident number
 * for a configuration nobody had asked for. `fse26-cli.ts` records the sibling failure — a dispatch
 * asking for `--log-mode count` ran `logicHttp` and reported 47.3% — and closes it for the VALUE,
 * by making the accepted modes an exhaustive `Record<LogSignalMode, true>`. The FLAG was left open,
 * and a flag is the wider hole: a value that falls back still names its switch, while a switch that
 * falls away leaves nothing in the artifact to say so.
 *
 * ## Why the two runners make this sharp
 *
 * They do not share a vocabulary, and the log mode is where the divergence bites:
 *
 *     run-fse26.ts    --log-mode <count|novelty|logicHttp|logicHttpJoint|logicHttpDominant|all>
 *     run-rcaeval.ts  --log-signal-mode <count|novelty>
 *
 * `run-rcaeval.ts --log-mode novelty` is a request this runner cannot honour, and the run it
 * produced was indistinguishable from one asked for `--log-signal-mode count`. It now throws and
 * names the token, which is the only part of the input the parser is certain about.
 *
 * @module benchmarks/rcaeval-cli
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { OnsetShape } from '../../packages/tree/src/pruning/pruner.js';
import {
  DEFAULT_ONSET_SHAPE,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  isOnsetShape,
} from '../../packages/tree/src/pruning/pruner.js';

import { SERVICE_FIELD_DECIMALS } from '../../packages/kinetic/src/benchmarks/fse26-diagnose.js';

import { hasValue, parseFieldDecimals, parseWeight } from './cli-args.js';

/**
 * Every option the RCAEval runner reads off its command line.
 *
 * Exported with the parser that produces it, so a test can drive the parser directly: the runner
 * itself calls `main()` at import time, which is what kept this type and its contract out of reach.
 */
export interface CliOptions {
  dataDir: string;
  maxCases: number;
  /** Filter to specific system: 'ob', 'ss', 'tt', or 'all' */
  system: string;
  /** Filter to specific suite: 're1', 're2', 're3', or 'all' */
  suite: string;
  /**
   * Disable the fault injection time signal (dataset-decoupled mode). When
   * set, the runner does NOT forward inject_time to the engine, so the
   * temporal causal onset is neutral and ranking falls back to pure
   * self-anomaly. This produces the production-transferable result; the
   * default (no flag) produces the result comparable to the RCAEval baselines.
   */
  noInjectTime: boolean;
  /**
   * Strength of the injection-time-anchored temporal prior in the ranking.
   *
   * Read from {@link DEFAULT_TEMPORAL_WEIGHT} rather than restated as a literal, and
   * that is the whole point of the field: this runner IS the golden 9-cell, so a
   * private copy of the shipped value would let the gate it feeds stay blind to a
   * signal the engine ships — a cell-by-cell identical RCAEval would then be evidence
   * that the pin held, not that the signal is harmless. Pass `0` explicitly for the
   * ablation; the CLI's fallback on a malformed value is the shipped value, so a typo
   * reproduces the published configuration instead of measuring the term switched off.
   */
  temporalWeight: number;
  /**
   * Which shape the temporal prior reads the onset delays in.
   *
   * Inert while `temporalWeight` is 0 — the term is multiplied by the weight — and
   * read from {@link DEFAULT_ONSET_SHAPE} for the same reason the weight is.
   */
  onsetShape: OnsetShape;
  /**
   * Strength of the decisive-stability prior (reward the service whose decisive metric is the
   * STEADIEST one in its case).
   *
   * Read from {@link DEFAULT_STABILITY_WEIGHT} for the reason `temporalWeight` is: this runner IS
   * the golden 9-cell, so a private copy of the shipped value would let the gate stay blind to a
   * signal the engine ships. The engine's contract makes the field OPTIONAL on `RankingWeights`,
   * which is exactly why the golden was bit-identical while the term was enrolled at weight 0 —
   * and why measuring the term on THIS benchmark needs the flag rather than a change to the
   * engine's default. Its weight is the same 0.03017 the FSE'26 screen solved for, so a dispatch
   * of this input is what turns "admitted on one benchmark" into "measured on both".
   */
  stabilityWeight: number;
  /** Strength of the collision-energy signal (penalise upstream-inherited energy). */
  collisionWeight: number;
  /** Strength of the topological-source signal (reward no-anomalous-parent nodes). */
  topoWeight: number;
  /** Strength of the log signal (reward post-injection ERROR/FATAL volume). */
  logWeight: number;
  /** Log signal scoring mode: 'count' (default) or 'novelty' (IDF-weighted). */
  logSignalMode: 'count' | 'novelty';
  /**
   * Strength of the trace span-activity rise signal in the ranking. Default 0
   * (disabled). When > 0, the loader computes per-service pre/post span counts
   * from traces.csv — SCOPED to the RE3 suite only, because the "more spans ⇒
   * source" mechanism holds only for RE3 code-level faults (the source does
   * MORE work). On RE1/RE2 (route / latency / memory / resource faults) a span
   * rise is not a source signature, so the expensive traces.csv scan is skipped
   * and the signal stays neutral there.
   */
  traceWeight: number;
  /**
   * Strength of the PRISM graph-free internal/external asymmetry signal in the
   * ranking. Default 0 (disabled). When > 0, the engine computes PRISM's
   * root-cause score M(C) per service (max-pooled internal/external deviation
   * z-scores, combined additively) and max-normalises it to [0, 1], rewarding
   * the node anomalous in BOTH channels. Genuinely complementary to the
   * topology-aware priors (fusion ceiling union 87.5%).
   */
  prismWeight: number;
  /**
   * Direction-aware deviation: discount the DROP component of a metric's
   * deviation by this factor (0 = symmetric, 1 = ignore drops entirely). A
   * traffic-loss collapse (symptom) is discounted so it cannot out-rank an
   * equivalent rise (source). Opt-in; default 0.
   */
  collapseDiscount: number;
  /**
   * Rank-based anomaly-score normalization on large topologies (≥ 20 nodes).
   * Robust to a single near-zero-baseline outlier that would otherwise stretch
   * the min-max range. Opt-in; default false.
   */
  rankNormalization: boolean;
  /**
   * Extend the transient-spike guard to idle-start transients: a metric that
   * starts at ~0, has a transient excursion, and settles at a NON-zero tail.
   * Suppresses the near-zero-baseline latency spike that outranks a genuine
   * permanent drop (ts-route-service RE3). Opt-in; default false.
   */
  suppressIdleTransients: boolean;
  /**
   * Suppress a metric whose baseline is essentially zero (≤ 0.001) from scoring
   * its RISE: a near-zero-baseline cpu/diskio fluctuation reads as a spurious
   * 32× "rise" and outranks a genuine crash drop (dev capped at ≈0.301). Opt-in;
   * default false.
   */
  suppressNearZeroBaselineRise: boolean;
  /**
   * When set, compute the PRISM graph-free baseline on the SAME loaded cases
   * and emit the fusion-ceiling analysis (engine vs PRISM union of correct
   * cases) as JSON to this path, in addition to the normal benchmark table.
   */
  fusionCeiling: string;
  /**
   * When set, emit a per-case routing-feasibility probe to this path: for each
   * case it records the engine's top-1/top-2 ranking scores and PRISM's
   * top-1/top-2 M-scores, plus the fault type, so the zero-regression routing
   * frontier can be derived offline. Pairs with the benchmark table.
   */
  routingProbe: string;
  /**
   * When set, write the FSE'26 signal diagnostic for every diagnosed case to this path.
   *
   * The SAME artifact the FSE'26 runner emits, assembled by the same function, so the analyzer's
   * screens — the weight solver, the family screen, the decisive-stability screen — run on THIS
   * benchmark with no second instrument. That is what makes a weight's second half checkable before
   * a dispatch instead of after one: `benchmark-rcaeval.yml` can produce the dump once, and every
   * candidate weight is then solved offline against it.
   *
   * The file is written ONCE per invocation and opens with the run's signal configuration, so one
   * artifact states its own mode and holds every group the suite covered — `--suite re1` evaluates
   * three systems, and a file per group would keep only the last one.
   *
   * Empty means "do not write one": the flag allocates the file, not the runner.
   */
  diagnoseDump: string;
  /**
   * How many decimals the dump's per-service fields are rendered with.
   *
   * Defaults to the producer's {@link SERVICE_FIELD_DECIMALS}, so a dispatch that says nothing gets
   * exactly the artifact every existing dump is — and the dump STATES the value it got in its header,
   * so a reader never has to know which invocation produced the file.
   */
  diagnoseDecimals: number;
}

export function parseRCAEvalArgs(args: readonly string[]): CliOptions {
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCAEval-json'),
    maxCases: 0,
    system: 'all',
    suite: 'all',
    noInjectTime: false,
    temporalWeight: DEFAULT_TEMPORAL_WEIGHT,
    onsetShape: DEFAULT_ONSET_SHAPE,
    stabilityWeight: DEFAULT_STABILITY_WEIGHT,
    collisionWeight: 0,
    topoWeight: 0,
    logWeight: 1.0,
    logSignalMode: 'count',
    collapseDiscount: 0,
    traceWeight: 0,
    prismWeight: 0,
    // Rank/quantile normalization of per-service anomaly scores is the default:
    // it is robust to a single near-zero-baseline symptom spike that would
    // otherwise set the min-max range max and crush the genuine source toward
    // ~0. Monotonic, so it is a no-op on small graphs (<20 nodes) and whenever
    // traceWeight is 0; it only materialises when a downstream causal signal
    // (trace/topo) can exploit the compressed anomaly gap.
    rankNormalization: true,
    suppressIdleTransients: false,
    suppressNearZeroBaselineRise: false,
    fusionCeiling: '',
    routingProbe: '',
    diagnoseDump: '',
    diagnoseDecimals: SERVICE_FIELD_DECIMALS,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && hasValue(args, i + 1)) opts.dataDir = args[++i]!;
    else if (args[i] === '--max-cases' && hasValue(args, i + 1))
      opts.maxCases = parseInt(args[++i]!, 10) || 0;
    else if (args[i] === '--system' && hasValue(args, i + 1)) opts.system = args[++i]!;
    else if (args[i] === '--suite' && hasValue(args, i + 1)) opts.suite = args[++i]!;
    else if (args[i] === '--no-inject-time') opts.noInjectTime = true;
    else if (args[i] === '--temporal-weight' && hasValue(args, i + 1))
      opts.temporalWeight = parseWeight(args[++i]!, DEFAULT_TEMPORAL_WEIGHT);
    else if (args[i] === '--onset-shape' && hasValue(args, i + 1)) {
      // Strict, falling back to the SHIPPED shape on an unknown value: a typo must
      // reproduce a published configuration rather than invent one. Inert while the
      // weight is 0, so a dispatch that only meant to set the shape is safe.
      const shape = args[++i]!;
      opts.onsetShape = isOnsetShape(shape) ? shape : DEFAULT_ONSET_SHAPE;
    } else if (args[i] === '--stability-weight' && hasValue(args, i + 1))
      opts.stabilityWeight = parseWeight(args[++i]!, DEFAULT_STABILITY_WEIGHT);
    else if (args[i] === '--collision-weight' && hasValue(args, i + 1))
      opts.collisionWeight = parseWeight(args[++i]!, 0);
    else if (args[i] === '--topo-weight' && hasValue(args, i + 1))
      opts.topoWeight = parseWeight(args[++i]!, 0);
    else if (args[i] === '--log-weight' && hasValue(args, i + 1))
      // Falls back to the field's own default (1.0), NOT to 0: an inline
      // `parseFloat(x) || 0` read an empty flag as "the log signal off", which is a
      // configuration this runner never described and never recorded.
      opts.logWeight = parseWeight(args[++i]!, 1.0);
    else if (args[i] === '--trace-weight' && hasValue(args, i + 1))
      opts.traceWeight = parseWeight(args[++i]!, 0);
    else if (args[i] === '--prism-weight' && hasValue(args, i + 1))
      opts.prismWeight = parseWeight(args[++i]!, 0);
    else if (args[i] === '--log-signal-mode' && hasValue(args, i + 1)) {
      const mode = args[++i]!;
      opts.logSignalMode = mode === 'novelty' ? 'novelty' : 'count';
    } else if (args[i] === '--collapse-discount' && hasValue(args, i + 1)) {
      const d = parseFloat(args[++i]!);
      opts.collapseDiscount = Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0;
    } else if (args[i] === '--rank-normalization') {
      opts.rankNormalization = true;
    } else if (args[i] === '--no-rank-normalization') {
      opts.rankNormalization = false;
    } else if (args[i] === '--suppress-idle-transients') {
      opts.suppressIdleTransients = true;
    } else if (args[i] === '--no-suppress-idle-transients') {
      opts.suppressIdleTransients = false;
    } else if (args[i] === '--suppress-near-zero-baseline-rise') {
      opts.suppressNearZeroBaselineRise = true;
    } else if (args[i] === '--no-suppress-near-zero-baseline-rise') {
      opts.suppressNearZeroBaselineRise = false;
    } else if (args[i] === '--fusion-ceiling' && hasValue(args, i + 1)) {
      opts.fusionCeiling = args[++i]!;
    } else if (args[i] === '--routing-probe' && hasValue(args, i + 1)) {
      opts.routingProbe = args[++i]!;
    } else if (args[i] === '--diagnose-dump' && hasValue(args, i + 1)) {
      opts.diagnoseDump = args[++i]!;
    } else if (args[i] === '--diagnose-decimals' && hasValue(args, i + 1)) {
      // Strict, falling back to the SHIPPED precision, for the same reason `--onset-shape` does: a
      // typo must reproduce a published artifact rather than invent one — and here it must also not
      // crash the run, which is what an out-of-domain digit count would do inside `toFixed`.
      opts.diagnoseDecimals = parseFieldDecimals(args[++i]!, SERVICE_FIELD_DECIMALS);
    } else {
      throw new Error(
        `unrecognised argument ${args[i]!} — either this runner does not accept it, ` +
          'or the flag before it is missing its value',
      );
    }
  }
  return opts;
}
