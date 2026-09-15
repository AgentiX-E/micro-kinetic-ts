/**
 * Argument parsing for the FSE'26 benchmark runner.
 *
 * Extracted from `run-fse26.ts` so it can be tested: that file calls `main()` at
 * import time and therefore cannot be imported by a test, which is how the
 * `--log-mode` defect below survived review.
 *
 * ## Why the accepted modes are an exhaustive object rather than a list
 *
 * `--log-mode` used to be validated against a hand-written `||` chain. When the
 * default was flipped to the best-measured mode, that chain was rewritten and
 * **`count` was left out** — so `--log-mode count` matched nothing and fell back
 * to `logicHttp`. The `count` configuration became unreachable through the
 * workflow, and silently: a dispatch asking for `count` ran `logicHttp` and
 * printed a confident 47.3%. Two diagnostics dispatched to compare the two modes
 * came back byte-identical, which is what exposed it.
 *
 * A list of names cannot be checked against a union. `LOG_MODE_ACCEPTED` is a
 * `Record<LogSignalMode, true>` instead, so **adding a member to the union fails
 * to compile until it is added here**, and the fallback is reserved for values
 * that are genuinely not modes.
 *
 * @module benchmarks/fse26-cli
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { FailedEdgeMode, LogSignalMode } from '../../packages/tree/src/index.js';
import {
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
} from '../../packages/tree/src/index.js';

/**
 * The log-signal mode the benchmark reports.
 *
 * Measured, not guessed. Full 1422-case runs on one commit and one
 * provenance-verified cache:
 *
 *     logicHttp  Top@1 47.3% (673/1422)  — run 34604105028
 *     count      Top@1 23.1% (328/1422)  — run 34604119657
 *
 * The +24.2pp gain comes from the replace-code / replace-method / replace-path /
 * delay / abort classes, whose faulting service floods a propagated framework
 * HTTP error that the logic-exception-only gate discards. `Network*` and
 * `JVMException` do regress under it, but the net is strongly positive and
 * clears the published SOTA best of 37.0%, so this is the configuration that
 * gets reported.
 */
export const DEFAULT_FSE26_LOG_MODE: LogSignalMode = 'logicHttp';

/**
 * Every log-signal mode, as a `Record` over the union.
 *
 * Exhaustive by construction: a new member of `LogSignalMode` is a compile error
 * here until it is listed. The value is unused; the keys are the point.
 */
const LOG_MODE_ACCEPTED: Readonly<Record<LogSignalMode, true>> = {
  count: true,
  novelty: true,
  logicHttp: true,
  logicHttpJoint: true,
  logicHttpDominant: true,
  all: true,
};

/** The aggregation modes the failed-edge signal has been measured with. */
export const FAILED_EDGE_MODES = { sum: true, mean: true } as const;

/**
 * The shipped aggregation: the one the +5.8pp ablation measured.
 *
 * Widened to {@link FailedEdgeMode} on purpose — `as const` would narrow it to
 * the literal `'sum'`, which then cannot hold a parsed `'mean'`.
 */
export const DEFAULT_FAILED_EDGE_MODE: FailedEdgeMode = 'sum';

/** Whether a raw argument names a failed-edge aggregation mode. */
export function isFailedEdgeMode(value: string): value is FailedEdgeMode {
  return Object.prototype.hasOwnProperty.call(FAILED_EDGE_MODES, value);
}

/** Whether a raw argument names a log-signal mode. */
export function isLogSignalMode(value: string): value is LogSignalMode {
  return Object.prototype.hasOwnProperty.call(LOG_MODE_ACCEPTED, value);
}

/** Parsed command-line options for one benchmark run. */
export interface Fse26CliOptions {
  readonly dataDir: string;
  readonly maxCases: number;
  /** Strength of the log signal (self-caused logic-exception volume). */
  readonly logWeight: number;
  readonly logMode: LogSignalMode;
  /** Rank-based anomaly-score normalization on large topologies (≥ 20 nodes). */
  readonly rankNormalization: boolean;
  /** Emit a JSON result document to this path (empty = none). */
  readonly output: string;
  /** Fault types to dump a per-service signal diagnostic for (empty = none). */
  readonly diagnose: readonly string[];
  /** Max diagnostic dumps per matching fault type (0 = unlimited). */
  readonly diagnoseLimit: number;
  /**
   * Metric names to filter out of every case before scoring (empty = none).
   * Component-ablation switch: the bridge merges four metric sources into one
   * map, so removing a source's names here re-scores the same cases as if the
   * bridge had never emitted that source — without rebuilding the cache.
   */
  readonly dropMetrics: readonly string[];
  /**
   * Ceiling on one metric's relative deviation (0 = unbounded, the shipped
   * behaviour).
   *
   * The anomaly score is `max` over a service's metrics and the RISE direction
   * is unbounded, so a symptom with a wide dynamic range can out-score the
   * source's own signature — measured at 29.2x against 8.5x median rise on the
   * FSE'26 silent block (`docs/fse26-metric-competition-verdict.md`). This is
   * the ablation switch for that bound; the default is off.
   */
  readonly metricRiseCeiling: number;
  /**
   * Subtract each metric's cross-service median before the service maximum.
   *
   * The other half of the dynamic-range question: a metric that moved for every
   * service carries no information about WHICH service is the source, yet a
   * maximum over metrics cannot tell "unusual on this metric" from "everyone
   * moved". Off by default; the run config records whether it was used.
   */
  readonly metricFleetBaseline: boolean;
  /**
   * Strength of the failed-edge-DIRECTION signal (0 = disabled, the shipped
   * behaviour).
   *
   * Charges each post-injection failed call to its CALLEE — the service its
   * callers' calls failed against — which is the inverse of the log signal's
   * credit to the emitter. This is the ablation switch for it.
   */
  readonly failedEdgeWeight: number;
  /**
   * How a callee's failed calls are aggregated: `sum` (default) or `mean` over
   * its failing callers (fan-in normalised).
   */
  readonly failedEdgeMode: FailedEdgeMode;
  /**
   * Minimum contributing edges a callee needs before the signal credits it.
   * 1 = the shipped behaviour.
   */
  readonly failedEdgeMinRecords: number;
  /**
   * Strength of the per-edge LATENCY-rise signal.
   *
   * Credits the callee of an edge whose mean span duration rose, which is the
   * same direction as the failed-edge signal but exists on the cases where no
   * call failed at all.
   *
   * The default is the engine's own {@link DEFAULT_LAT_WEIGHT}, imported rather
   * than restated: a literal here would be a second copy, and a second copy of a
   * measured default is what let the published mode drift 24.2pp from the measured
   * one. Pass 0 for the ablation.
   */
  readonly latWeight: number;
  /**
   * Rise a service must clear before the latency term credits it.
   *
   * Shipped as {@link DEFAULT_LAT_MIN_RISE}, the engine's own constant, because it is
   * one half of a measured PAIR: at the shipped weight a floor of 1 scores 673 and a
   * floor of 10.3 scores 750, and the reverse pairing (a floor of 10.3 at the old
   * 0.03) is a 6-case regression. `1` restores the credited-everything shape.
   */
  readonly latMinRise: number;
  /**
   * Weight of the DB-connection-pool dominance penalty: subtracts it from a
   * service whose anomaly maximum was won by a `db.client.connections.*` series.
   *
   * Required, not optional, and defaulted to the engine's own constant rather
   * than to a literal: this is the value a dispatched run without the flag uses,
   * so a second copy here is a second shipped configuration.
   */
  readonly poolMetricPenaltyWeight: number;
}

/** Split a comma-separated flag value, dropping empty entries. */
function csv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Parse a non-negative weight flag, falling back to the SHIPPED weight.
 *
 * Two ways a weight flag can go wrong, and they need the same answer:
 *
 * 1. an unusable value (`'1O'`, `'-1'`) — `parseFloat` would read `1O` as `1`, so a
 *    typo would run a plausible but DIFFERENT ablation than the one asked for;
 * 2. an EMPTY value. `Number('')` is `0`, which is not a missing measurement — it is
 *    a *different measured configuration* (the ablation), so accepting it silently
 *    selects one nobody asked for.
 *
 * Both fall back to the shipped weight, so the worst case is a run of the published
 * configuration under a name that says so, never an unrequested experiment wearing
 * the published configuration's label. The workflow passes each weight flag only
 * when its dispatch input is non-empty, for exactly the reason in (2); enforcing it
 * here as well means the CLI cannot be a second door into the same swap.
 *
 * @param raw - The flag's argument, verbatim.
 * @param shipped - The shipped weight for this flag.
 * @returns The parsed weight, or `shipped`.
 */
function parseWeight(raw: string, shipped: number): number {
  if (raw.trim() === '') return shipped;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : shipped;
}

/**
 * Parse the runner's arguments.
 *
 * An UNRECOGNISED mode is never downgraded to a *different* configuration: it
 * falls back to {@link DEFAULT_FSE26_LOG_MODE}, so a typo reports the default
 * rather than an unmeasured mode. A RECOGNISED mode always takes effect — see
 * the module note for what happens when it does not.
 *
 * @param argv - Arguments after the script name (`process.argv.slice(2)`).
 * @returns The options, with every default applied.
 */
export function parseFSE26Args(argv: readonly string[]): Fse26CliOptions {
  const opts = {
    dataDir: join(homedir(), 'RCABench-json'),
    maxCases: 0,
    logWeight: 1.0,
    logMode: DEFAULT_FSE26_LOG_MODE as LogSignalMode,
    rankNormalization: true,
    output: '',
    diagnose: [] as string[],
    diagnoseLimit: 3,
    dropMetrics: [] as string[],
    metricRiseCeiling: 0,
    metricFleetBaseline: false,
    failedEdgeWeight: 0,
    failedEdgeMode: DEFAULT_FAILED_EDGE_MODE,
    failedEdgeMinRecords: 1,
    latWeight: DEFAULT_LAT_WEIGHT,
    latMinRise: DEFAULT_LAT_MIN_RISE,
    poolMetricPenaltyWeight: DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data-dir' && i + 1 < argv.length) opts.dataDir = argv[++i]!;
    else if (arg === '--max-cases' && i + 1 < argv.length)
      opts.maxCases = parseInt(argv[++i]!, 10) || 0;
    else if (arg === '--log-weight' && i + 1 < argv.length) {
      // The fallback is the SHIPPED weight (1.0), not 0 — 0 is a *different*
      // measured configuration (14.98% Top@1), so silently selecting it would
      // publish an ablation nobody chose. See `parseWeight` for the empty value.
      opts.logWeight = parseWeight(argv[++i]!, 1.0);
    } else if (arg === '--log-mode' && i + 1 < argv.length) {
      const mode = argv[++i]!;
      opts.logMode = isLogSignalMode(mode) ? mode : DEFAULT_FSE26_LOG_MODE;
    } else if (arg === '--no-rank-normalization') opts.rankNormalization = false;
    else if (arg === '--output' && i + 1 < argv.length) opts.output = argv[++i]!;
    else if (arg === '--diagnose' && i + 1 < argv.length) opts.diagnose = csv(argv[++i]!);
    else if (arg === '--diagnose-limit' && i + 1 < argv.length)
      opts.diagnoseLimit = parseInt(argv[++i]!, 10) || 0;
    else if (arg === '--drop-metrics' && i + 1 < argv.length) opts.dropMetrics = csv(argv[++i]!);
    else if (arg === '--rise-ceiling' && i + 1 < argv.length) {
      // STRICT, unlike the other numeric flags: `parseFloat('1O')` is 1, so a
      // typo would run a plausible but DIFFERENT ablation than the one asked
      // for — `--rise-ceiling 1O` meaning 10 would silently measure 1. `Number`
      // rejects the trailing garbage, and anything not a finite positive value
      // falls back to the SHIPPED configuration, which can only reproduce
      // published numbers rather than invent an unmeasured one.
      const ceiling = Number(argv[++i]!);
      opts.metricRiseCeiling = Number.isFinite(ceiling) && ceiling > 0 ? ceiling : 0;
    } else if (arg === '--fleet-baseline') opts.metricFleetBaseline = true;
    else if (arg === '--failed-edge-min-records' && i + 1 < argv.length) {
      // Strict, and it falls back to the SHIPPED floor of 1 — a floor of 0 would
      // credit a callee on no evidence at all, which is not a configuration
      // anyone asked for. A non-integer is rejected for the same reason the
      // other numeric switches reject trailing garbage.
      const floor = Number(argv[++i]!);
      opts.failedEdgeMinRecords = Number.isInteger(floor) && floor >= 1 ? floor : 1;
    } else if (arg === '--failed-edge-mode' && i + 1 < argv.length) {
      // Falling back to the SHIPPED mode on an unknown value, like the log mode:
      // a typo must reproduce a published configuration, never invent one.
      const mode = argv[++i]!;
      opts.failedEdgeMode = isFailedEdgeMode(mode) ? mode : DEFAULT_FAILED_EDGE_MODE;
    } else if (arg === '--failed-edge-weight' && i + 1 < argv.length) {
      // Same strictness as the other numeric ablation switches, and the same
      // safe fallback: the SHIPPED weight is 0 (the signal is off), so a typo
      // reproduces a published configuration instead of inventing one.
      const weight = Number(argv[++i]!);
      opts.failedEdgeWeight = Number.isFinite(weight) && weight >= 0 ? weight : 0;
    } else if (arg === '--lat-weight' && i + 1 < argv.length) {
      // Same rule and the same fallback as `--log-weight`: the SHIPPED weight, NOT
      // 0. Zero is a *different measured* configuration — the 47.33% ablation — so
      // a typo must reproduce the published configuration rather than silently run
      // an experiment nobody asked for under the shipped one's name.
      opts.latWeight = parseWeight(argv[++i]!, DEFAULT_LAT_WEIGHT);
    } else if (arg === '--lat-min-rise' && i + 1 < argv.length) {
      // STRICT and floored at 1: a floor below 1 would be a no-op that silently
      // reports a configuration the operator believes changed something, and a
      // non-finite one would drop every measurement through the mask.
      const rise = Number(argv[++i]!);
      opts.latMinRise = Number.isFinite(rise) && rise >= 1 ? rise : DEFAULT_LAT_MIN_RISE;
    } else if (arg === '--pool-penalty' && i + 1 < argv.length) {
      // Through `parseWeight`, not an inline `Number(...)`: an empty value must
      // fall back to the SHIPPED weight rather than select 0, which is a
      // different measured configuration (`--pool-penalty 0` is the ablation).
      opts.poolMetricPenaltyWeight = parseWeight(argv[++i]!, DEFAULT_POOL_METRIC_PENALTY_WEIGHT);
    }
  }

  return opts;
}
