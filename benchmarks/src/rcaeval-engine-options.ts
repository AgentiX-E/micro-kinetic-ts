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

import type {
  DropDeviationMode,
  DualFamilyGateMode,
  LogSignalMode,
  OnsetShape,
  PrismPooling,
} from '../../packages/tree/src/index.js';

import type { CliOptions } from './rcaeval-cli.js';

/** The ranking options, consumed by the pruner's first constructor argument. */
export interface RCAEvalSignalOptions {
  readonly temporalWeight: number;
  readonly onsetShape: OnsetShape;
  readonly stabilityWeight: number;
  /**
   * The SELF-TIME prior: the share of a service's own latency rise that no callee can explain.
   *
   * Required here for the reason every other weight is: the engine's default is 0, and a runner that
   * inherited it by omission could not state the term on an artifact — the defect this file exists to
   * prevent, one term over. It ships at the engine's 0 until a measurement enrols it.
   */
  readonly selfTimeWeight: number;
  /** The internal/external symmetry mask — see `CliOptions.victimWeight`. */
  readonly victimWeight: number;
  /** The dual-family presence bonus — see `CliOptions.dualFamilyWeight`. */
  readonly dualFamilyWeight: number;
  /**
   * The dual-family membership's POPULATION — see `CliOptions.dualFamilyGate`.
   *
   * Required rather than optional for the reason every weight here is: the engine's default is 0, so a
   * dropped key would run the ungated membership while the artifact reported a gated one.
   */
  readonly dualFamilyGate: number;
  /** Which fleet-relative comparison that gate applies — see `CliOptions.dualFamilyGateMode`. */
  readonly dualFamilyGateMode: DualFamilyGateMode;
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
  /**
   * The failed-edge direction term's weight, on the same footing as the latency pair above.
   *
   * Required rather than optional for the reason this whole interface exists: a partial passed through would be
   * a silent no-op, and this field spent six iterations absent — the golden half of the kill criterion could
   * not be asked for at all.
   */
  readonly failedEdgeWeight: number;
  readonly poolMetricPenaltyWeight: number;
  readonly collisionWeight: number;
  readonly topoWeight: number;
  /** Multiplicative topological discount (0 = off). */
  readonly topoDiscount: number;
  readonly logWeight: number;
  readonly logSignalMode: LogSignalMode;
  readonly traceWeight: number;
  /** Whether the trace vote is withheld from the anomaly leader — see `CliOptions.traceSkipsLeader`. */
  readonly traceSkipsLeader: boolean;
  readonly prismWeight: number;
  readonly prismPooling: PrismPooling;
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
  /** The largest ratio one metric's deviation may reflect; `0` = unbounded. */
  readonly metricRiseCeiling: number;
  /** How a metric's drop becomes a deviation (`bounded` = shipped, `log` = symmetric). */
  readonly dropDeviationMode: DropDeviationMode;
  readonly rankNormalization: boolean;
  /**
   * The node count at or above which `rankNormalization` runs at all.
   *
   * In this list rather than in `signals`, and not because it is a switch: it is an argument to
   * {@link TopologyFaultGraphConfig}, which is this object's subject — the fault graph's own construction. A
   * value that decided the population of a *ranking term* would belong above; this one decides which graphs
   * the graph BUILDER rescales, so a reader looking for which cases a mechanism reached finds it beside the
   * mechanism's flag.
   */
  readonly anomalyNormalizeNodeThreshold: number;
  readonly suppressIdleTransients: boolean;
  readonly suppressNearZeroBaselineRise: boolean;
  /** Discard a transport channel whose head window has no level — see `CliOptions`. */
  readonly suppressZeroBaselineLatency: boolean;
  /** Cap the trend bonus at its deviation — see `CliOptions`. */
  readonly capTrendBonusAtDeviation: boolean;
  /** The demand guard — see `CliOptions.suppressDemandMetrics` for the measurement that enrolled it. */
  readonly suppressDemandMetrics: boolean;
  /**
   * The anomaly composition's three coefficients — see `CliOptions.anomalyTrendWeight`.
   *
   * Here rather than in `signals` for the reason {@link RCAEvalTopologyOptions.anomalyNormalizeNodeThreshold}
   * gives: they are arguments to the graph builder, not terms in the ranking. On RCAEval RE1 the graph
   * builder's output IS the ranking, so the distinction is about which function reads the value, not about
   * which number it moves.
   */
  readonly anomalyTrendWeight: number;
  readonly anomalyBurstWeight: number;
  readonly anomalyCvWeight: number;
  /** The channels-moved term — see `CliOptions.anomalyBreadthWeight`. */
  readonly anomalyBreadthWeight: number;
  /** The contender gate — see `CliOptions.anomalyBreadthGate`. */
  readonly anomalyBreadthGate: number;
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
  'latencyView',
  'noInjectTime',
  'fusionCeiling',
  'routingProbe',
  'diagnoseDump',
  'diagnoseDecimals',
  'lossCensus',
];

/**
 * Build BOTH of the engine's constructor arguments from the parsed options.
 *
 * The two are returned together rather than assembled where the engine is built, because that is what
 * makes them one list: the runner spreads nothing by hand, so a value cannot be present in one argument
 * and absent from the other. The fields this artifact is permitted to omit are not listed here — they are
 * shared with the ablation runner's artifact and live in `reported-config.ts`.
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
      selfTimeWeight: opts.selfTimeWeight,
      victimWeight: opts.victimWeight,
      dualFamilyWeight: opts.dualFamilyWeight,
      dualFamilyGate: opts.dualFamilyGate,
      dualFamilyGateMode: opts.dualFamilyGateMode,
      latWeight: opts.latWeight,
      latMinRise: opts.latMinRise,
      failedEdgeWeight: opts.failedEdgeWeight,
      poolMetricPenaltyWeight: opts.poolMetricPenaltyWeight,
      collisionWeight: opts.collisionWeight,
      topoWeight: opts.topoWeight,
      topoDiscount: opts.topoDiscount,
      logWeight: opts.logWeight,
      logSignalMode: opts.logSignalMode,
      traceWeight: opts.traceWeight,
      traceSkipsLeader: opts.traceSkipsLeader,
      prismWeight: opts.prismWeight,
      prismPooling: opts.prismPooling,
    },
    topology: {
      collapseDiscount: opts.collapseDiscount,
      metricRiseCeiling: opts.metricRiseCeiling,
      dropDeviationMode: opts.dropDeviationMode,
      rankNormalization: opts.rankNormalization,
      anomalyNormalizeNodeThreshold: opts.anomalyNormalizeNodeThreshold,
      suppressIdleTransients: opts.suppressIdleTransients,
      suppressNearZeroBaselineRise: opts.suppressNearZeroBaselineRise,
      suppressZeroBaselineLatency: opts.suppressZeroBaselineLatency,
      capTrendBonusAtDeviation: opts.capTrendBonusAtDeviation,
      suppressDemandMetrics: opts.suppressDemandMetrics,
      anomalyTrendWeight: opts.anomalyTrendWeight,
      anomalyBurstWeight: opts.anomalyBurstWeight,
      anomalyCvWeight: opts.anomalyCvWeight,
      anomalyBreadthWeight: opts.anomalyBreadthWeight,
      anomalyBreadthGate: opts.anomalyBreadthGate,
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
    `topoWeight=${opts.topoWeight} topoDiscount=${opts.topoDiscount} logWeight=${opts.logWeight} logSignalMode=${opts.logSignalMode} ` +
    // The three the golden half inherited in silence until this line named them.
    `latWeight=${opts.latWeight} latMinRise=${opts.latMinRise} ` +
    `poolMetricPenaltyWeight=${opts.poolMetricPenaltyWeight} ` +
    // The direction term, named unconditionally like the three above. It is 0 on every published cell, so an
    // omitted-when-default rule would render the measured arm and the shipped configuration byte-identically —
    // the defect this line exists to prevent, one term over.
    `failedEdgeWeight=${opts.failedEdgeWeight} ` +
    `collapseDiscount=${opts.collapseDiscount} metricRiseCeiling=${opts.metricRiseCeiling} ` +
    `dropDeviationMode=${opts.dropDeviationMode} traceWeight=${opts.traceWeight} ` +
    // Unconditional: the mask is inert at traceWeight 0, so this field is the only thing that can distinguish a
    // masked arm from the shipped run on the seven cells where the term is off.
    `traceSkipsLeader=${opts.traceSkipsLeader} ` +
    `prismWeight=${opts.prismWeight} prismPooling=${opts.prismPooling} ` +
    `rankNormalization=${opts.rankNormalization} ` +
    `anomalyNormalizeNodeThreshold=${opts.anomalyNormalizeNodeThreshold} ` +
    `suppressIdleTransients=${opts.suppressIdleTransients} ` +
    `suppressNearZeroBaselineRise=${opts.suppressNearZeroBaselineRise} ` +
    `suppressZeroBaselineLatency=${opts.suppressZeroBaselineLatency} ` +
    `capTrendBonusAtDeviation=${opts.capTrendBonusAtDeviation} ` +
    // Named unconditionally even though it ships `true`: the ablation is `false`, and a line that printed
    // only the non-default would render this run and its ablation identically — the defect the failed-edge
    // weight's comment above records, one guard over.
    `suppressDemandMetrics=${opts.suppressDemandMetrics} ` +
    // The anomaly COMPOSITION. On this corpus it is the ranking itself (every other term is inert on RE1),
    // so an artifact that omitted it could not attribute a RE1 movement to anything at all.
    `anomalyTrendWeight=${opts.anomalyTrendWeight} ` +
    `anomalyBurstWeight=${opts.anomalyBurstWeight} anomalyCvWeight=${opts.anomalyCvWeight} ` +
    `anomalyBreadthWeight=${opts.anomalyBreadthWeight} anomalyBreadthGate=${opts.anomalyBreadthGate} ` +
    // The self-time term, named unconditionally for the failed-edge reason: it ships at 0, so an
    // omitted-when-default rule would render the measured arm and the shipped run identically.
    `selfTimeWeight=${opts.selfTimeWeight} ` +
    `victimWeight=${opts.victimWeight} ` +
    `dualFamilyWeight=${opts.dualFamilyWeight} ` +
    // Unconditional on the self-time rule: it ships at 0, so an omitted-when-default field would render the
    // gated arm and the shipped run identically on the artifact that is supposed to attribute the difference.
    `dualFamilyGate=${opts.dualFamilyGate} dualFamilyGateMode=${opts.dualFamilyGateMode} ` +
    `temporalWeight=${opts.temporalWeight} onsetShape=${opts.onsetShape}`
  );
}
