/**
 * The RCAEval runner's engine-option assembly, and the configuration line its artifact carries.
 *
 * ## Why these two live here rather than in the runner
 *
 * They lived inside `run-rcaeval.ts`, which calls `main()` at import time and is therefore
 * importable by nothing — the exact defect `fse26-engine-options.ts` records having fixed on ITS
 * half: *"This lived inside `run-fse26.ts`'s `main()`, which calls itself on import and therefore
 * cannot be called from a test — so nothing could check that an option reached the engine."* The
 * same hole was closed on the FSE'26 side and left open on the golden side, and the cost was not
 * hypothetical: the line this module renders **omitted three of the fifteen fields
 * `REPORTED_CONFIG_FIELDS` requires**, including the two that dominate the shipped ranking.
 *
 * Extracting them makes both halves checkable, and it is the check that matters rather than the
 * extraction: `buildRCAEvalEngineOptions` returns the exact object the engine's constructor
 * receives, and {@link formatSignalLine} renders the artifact's record of it, so a test can hold
 * the two against each other instead of against a list somebody remembered to update.
 *
 * ## The rule the line obeys
 *
 * Every option the runner FORWARDS is named, unconditionally. That is stricter than the FSE'26
 * line's `omit when it holds its default`, and deliberately so: that rule is only safe while the
 * default is ZERO, and the shipped values here are not — `latWeight=0.561495` with
 * `latMinRise=10.3` were measured as a PAIR (+56 cases, none regressed), `poolMetricPenaltyWeight`
 * as +6, and `stabilityWeight` as +1 — so an omission would render the shipped run and its ablation
 * byte-identically, which is the defect the line exists to prevent.
 *
 * @module benchmarks/rcaeval-engine-options
 */

import type { LogSignalMode, OnsetShape } from '../../packages/tree/src/index.js';

import type { CliOptions } from './rcaeval-cli.js';

/** The ranking options, consumed by the pruner's first constructor argument. */
export interface RCAEvalSignalOptions {
  readonly temporalWeight: number;
  readonly onsetShape: OnsetShape;
  readonly stabilityWeight: number;
  /**
   * The per-edge latency pair — a WEIGHT and the RISE FLOOR it was measured with.
   *
   * The two are one configuration rather than two settings: the floor is not safe on its own, and
   * the weight's zero-regression window ends far below its shipped value without it. They are
   * required fields here, not optionals, for the reason `fse26-engine-options.ts` records about its
   * own: a PARTIAL passed through would be a silent no-op if a key were ever misspelled, and this
   * module exists because an option did exactly that — it was absent, and nothing could see it.
   */
  readonly latWeight: number;
  readonly latMinRise: number;
  readonly poolMetricPenaltyWeight: number;
  readonly collisionWeight: number;
  readonly topoWeight: number;
  readonly logWeight: number;
  readonly logSignalMode: LogSignalMode;
  readonly traceWeight: number;
  readonly prismWeight: number;
}

/**
 * The engine's SECOND constructor argument: `Partial<TopologyFaultGraphConfig>`.
 *
 * These four travelled in the object above until this split, and the cost was not theoretical:
 * `TreePrunerOptions` does not declare any of them, so `new TreePruner(options)` spread them into the
 * pruner's own options **where nothing read them** — the fault graph is built from
 * `...this.topologyConfig` alone. They reached the engine through a hand-written SECOND literal at the
 * call site instead, which is a second owner of the same four values and the place a silent omission
 * would hide: drop one there and that term silently reverts to the engine's default with nothing
 * failing.
 *
 * The FSE'26 half has separated the two from the start (`Fse26EngineOptions.signals` /
 * `.topology`). This is that shape, and the membership of each list is asserted against the engine's
 * own declarations rather than remembered.
 */
export interface RCAEvalTopologyOptions {
  readonly collapseDiscount: number;
  readonly rankNormalization: boolean;
  readonly suppressIdleTransients: boolean;
  readonly suppressNearZeroBaselineRise: boolean;
}

/** The engine's two constructor arguments, named so a test can assert both. */
export interface RCAEvalEngineOptions {
  readonly signals: RCAEvalSignalOptions;
  readonly topology: RCAEvalTopologyOptions;
}

/**
 * Every parsed option that must NOT reach the engine, with the reason it is not a ranking term.
 *
 * A `Record` rather than a list so each exemption carries its reason: "not a ranking knob" and "a
 * ranking knob that was silently dropped" are the same shape in a set, and telling those two apart
 * is the whole point of the partition the test asserts.
 */
export const NON_ENGINE_OPTION_KEYS: readonly string[] = [
  'dataDir',
  'maxCases',
  'system',
  'suite',
  'noInjectTime',
  'fusionCeiling',
  'routingProbe',
  'diagnoseDump',
  'diagnoseDecimals',
];

/**
 * The fields `REPORTED_CONFIG_FIELDS` requires that an RCAEval artifact may omit, each with its
 * reason.
 *
 * The FSE'26 half prints `failedEdge*` only when the weight is non-zero and never prints the three
 * load-time/ablation switches, because those are properties of a pipeline this runner does not
 * have: `dropMetrics` filters the case corpus at LOAD time, and the rise ceiling and fleet baseline
 * are TOPOLOGY-config options the RCAEval construction site never passes. Each of the six therefore
 * holds its neutral value for every RCAEval run, which is what makes the omission safe rather than
 * convenient.
 */
export const UNREPORTED_BY_RCAEVAL: Readonly<Record<string, string>> = {
  dropMetrics: 'a load-time input ablation; this runner has no loader that can apply it',
  metricRiseCeiling: 'a topology-config option; the RCAEval construction site never passes it',
  metricFleetBaseline: 'a topology-config option; the RCAEval construction site never passes it',
  failedEdgeWeight:
    'ships at 0 and is never forwarded by this runner, so the term is off for every RCAEval run',
  failedEdgeMode: 'meaningless without a weight to aggregate; ships at `sum` and is not forwarded',
  failedEdgeMinRecords:
    'meaningless without a weight to threshold; ships at 1 and is not forwarded',
};

/**
 * Build BOTH of the engine's constructor arguments from the parsed options.
 *
 * The two are returned together rather than assembled where the engine is built, because that is what
 * makes them one list: the runner spreads nothing by hand, so a value cannot be present in one argument
 * and absent from the other.
 *
 * @param opts - The parsed command-line options.
 * @returns `signals` (the first constructor argument) and `topology` (the second).
 */
export function buildRCAEvalEngineOptions(opts: CliOptions): RCAEvalEngineOptions {
  return {
    signals: {
      temporalWeight: opts.temporalWeight,
      onsetShape: opts.onsetShape,
      stabilityWeight: opts.stabilityWeight,
      latWeight: opts.latWeight,
      latMinRise: opts.latMinRise,
      poolMetricPenaltyWeight: opts.poolMetricPenaltyWeight,
      collisionWeight: opts.collisionWeight,
      topoWeight: opts.topoWeight,
      logWeight: opts.logWeight,
      logSignalMode: opts.logSignalMode,
      traceWeight: opts.traceWeight,
      prismWeight: opts.prismWeight,
    },
    topology: {
      collapseDiscount: opts.collapseDiscount,
      rankNormalization: opts.rankNormalization,
      suppressIdleTransients: opts.suppressIdleTransients,
      suppressNearZeroBaselineRise: opts.suppressNearZeroBaselineRise,
    },
  };
}

/**
 * The run's whole configuration, as one line.
 *
 * One owner for two renderings — the console banner and the diagnostic dump's header — for the
 * reason `fse26-report.ts` records about its own pair: a second copy is a second owner, and the day
 * the two drift the artifact describes a configuration nobody ran.
 *
 * It names the configuration the RUN used rather than one of the two arguments it reached the engine
 * through: the fields of `signals` and `topology` together, in a fixed order. That is deliberate, and
 * the test holds the line to the union — an artifact that named only the first argument would omit the
 * four topology switches, which is the same class of omission as naming neither.
 *
 * The order is the order this line has always printed, so splitting the arguments into two objects did
 * not change a byte of the artifacts. The three fields the golden half could not name at all until the
 * previous iteration are marked, because a reader meeting this function next should be able to see
 * which ones the artifact used to lack.
 *
 * @param opts - The parsed options.
 * @returns The line the banner prints and the dump stores verbatim.
 */
export function formatSignalLine(opts: CliOptions): string {
  return (
    `signals: stabilityWeight=${opts.stabilityWeight} collisionWeight=${opts.collisionWeight} ` +
    `topoWeight=${opts.topoWeight} logWeight=${opts.logWeight} logSignalMode=${opts.logSignalMode} ` +
    // The three the golden half inherited in silence until this line named them.
    `latWeight=${opts.latWeight} latMinRise=${opts.latMinRise} ` +
    `poolMetricPenaltyWeight=${opts.poolMetricPenaltyWeight} ` +
    `collapseDiscount=${opts.collapseDiscount} traceWeight=${opts.traceWeight} ` +
    `prismWeight=${opts.prismWeight} rankNormalization=${opts.rankNormalization} ` +
    `suppressIdleTransients=${opts.suppressIdleTransients} ` +
    `suppressNearZeroBaselineRise=${opts.suppressNearZeroBaselineRise} ` +
    `temporalWeight=${opts.temporalWeight} onsetShape=${opts.onsetShape}`
  );
}
