/**
 * Map parsed command-line options onto the engine's constructor arguments.
 *
 * This lived inside `run-fse26.ts`'s `main()`, which calls itself on import and
 * therefore cannot be called from a test — so nothing could check that an option
 * reached the engine. That gap is not hypothetical for this file's neighbours: a
 * dispatch input that the workflow accepted and the runner dropped would run the
 * CONTROL while the `Config:` line reported the ablation, and the run would
 * "prove" the ablation changes nothing. `dropMetrics` had no test at all, and
 * `logMode` was once hardcoded in the workflow so the published number was 24.2pp
 * below the best-measured one.
 *
 * Extracting the mapping makes both halves checkable: {@link
 * buildFse26EngineOptions} returns the exact objects the constructor receives,
 * and {@link NON_ENGINE_OPTION_KEYS} names the options that are deliberately not
 * forwarded — so a NEW option fails the completeness test until it is classified
 * as one or the other.
 *
 * @module benchmarks/fse26-engine-options
 */

import type {
  DualFamilyGateMode,
  FailedEdgeMode,
  FaultFreeProfile,
  FaultFreeSelection,
  LogNormalisation,
  LogSignalMode,
  OnsetShape,
  PoolAdmission,
  PrismPooling,
  TopoClosure,
  TopoDiscountScope,
  TopologyFaultGraphConfig,
} from '../../packages/tree/src/index.js';

import type { Fse26CliOptions } from './fse26-cli.js';

/** Ranking-signal options, consumed by the pruner's first constructor argument. */
export interface Fse26SignalOptions {
  readonly logWeight: number;
  readonly logSignalMode: LogSignalMode;
  /**
   * The log term's SCALE — how an admitted count becomes a score.
   *
   * Required for the reason every field here is, and the reason is sharper for this one: `max` and
   * `saturating` and `share` produce the same ORDER within a case and different magnitudes, so a runner that
   * inherited the engine's default by omission would report the shipped number as an arm's reading — the arm
   * and the control would be the same run. See `docs/log-volume-scale.md`.
   */
  readonly logNormalisation: LogNormalisation;
  /**
   * Failed-edge-direction weight. Carried as a required field with an explicit
   * default (0 = shipped/off) rather than an optional one: the engine's option
   * is optional so that `undefined` means disabled, but a PARTIAL passed through
   * here would be a silent no-op if the key were ever misspelled, and this file
   * exists precisely because a dropped option ran the control while the `Config:`
   * line reported the ablation.
   */
  readonly failedEdgeWeight: number;
  /**
   * Carried as a required field for the same reason as the weight above: a
   * PARTIAL passed through here would be a silent no-op if the key were ever
   * misspelled, and this file exists because a dropped option once ran the
   * control while the `Config:` line reported the ablation.
   */
  readonly failedEdgeMode: FailedEdgeMode;
  /** Required for the same reason as the two above: a silent no-op is the bug. */
  readonly failedEdgeMinRecords: number;
  /**
   * Weight of the per-edge LATENCY-rise signal. Required for the same reason as
   * the three above: a PARTIAL passed through here would be a silent no-op if
   * the key were ever misspelled.
   */
  readonly latWeight: number;
  /** Rise a service must clear before the latency term credits it (1 = shipped). */
  readonly latMinRise: number;
  /**
   * DB-connection-pool dominance penalty. Required for the same reason as the
   * weights above: a PARTIAL passed through here would be a silent no-op if the
   * key were ever misspelled.
   */
  readonly poolMetricPenaltyWeight: number;
  /** Weight on the decisive-stability prior. Required for the same reason as the pool penalty. */
  readonly stabilityWeight: number;
  /**
   * Weight on the fault-free frequency prior. Required for the reason every weight here is: its shipped value
   * is 0, which is exactly what a silently dropped option produces.
   */
  readonly faultFreeWeight: number;
  /**
   * Which of a candidate's channels that prior reads. Required rather than omitted-when-default because the two
   * spellings are different hypotheses, and a run that published one under the other's label would be the same
   * defect this module's docblock records.
   */
  readonly faultFreeSelection: FaultFreeSelection;
  /**
   * The corpus profile, when this run has one.
   *
   * DECLARED here but never WRITTEN by {@link buildFse26EngineOptions}: the profile is data rather than
   * configuration, so the runner merges it in after the projection. Declaring it keeps the merge type-checked
   * and leaving it unwritten keeps the reported-config parity fence honest.
   */
  readonly faultFreeProfile?: FaultFreeProfile | undefined;

  /**
   * Weight on the SELF-TIME prior. Required for the same reason as the pool penalty: a PARTIAL
   * passed through here would be a silent no-op if the key were ever misspelled, and the term's
   * shipped value is 0, which is exactly the value a silent no-op produces.
   */
  readonly selfTimeWeight: number;
  /** Weight on the internal/external symmetry mask. Required for the same reason as the pool penalty. */
  readonly victimWeight: number;
  /** Weight on the dual-family presence bonus. Required for the same reason as the pool penalty. */
  readonly dualFamilyWeight: number;
  /** Weight on the pod-state term. Required for the same reason as the pool penalty. */
  readonly podStateWeight: number;
  /** The BASE term's coefficient — see `FSE26CliOptions.selfAnomalyWeight`. */
  readonly selfAnomalyWeight: number;
  /**
   * The dual-family membership's POPULATION. Required for the same reason as the pool penalty — its shipped
   * value is 0, which is exactly the value a silent no-op produces.
   */
  readonly dualFamilyGate: number;
  /** Which fleet-relative comparison that gate applies. Required for the same reason as the gate itself. */
  readonly dualFamilyGateMode: DualFamilyGateMode;
  /**
   * Weight of the injection-anchored temporal prior. Required for the same reason as
   * every weight above: a PARTIAL passed through here would be a silent no-op if the
   * key were ever misspelled, and this file exists precisely because a dropped option
   * ran the control while the `Config:` line reported the ablation.
   */
  readonly temporalWeight: number;
  /**
   * Which shape the temporal prior reads the onset delays in.
   *
   * Not a weight, so it cannot be omitted-when-default: it is forwarded unconditionally,
   * and it is inert while `temporalWeight` is 0 — which is exactly why the shape is
   * `runner`-owned and can be flipped without a second measured configuration.
   */
  readonly onsetShape: OnsetShape;
  /**
   * The five knobs the mirror of iteration 96 added, all required for the reason every field above is:
   * a PARTIAL passed through here would be a silent no-op if a key were ever misspelled, which is the
   * defect this file exists for.
   *
   * They are grouped rather than each carrying its own measurement, because their measurements live on the
   * surfaces the census sends a reader to (`KNOBS`' `owner` field per knob), and a second copy of a number
   * here is how this repo published one 24.2pp off the best-measured value.
   */
  readonly traceWeight: number;
  /** Whether the trace vote is withheld from the anomaly leader. Required for the same reason as the weight. */
  readonly traceSkipsLeader: boolean;
  readonly topoWeight: number;
  /** Topological deduction strength (0 = off) — see `TreePrunerOptions.topoDiscount`. */
  readonly topoDiscount: number;
  /** Which channels the deduction may act on — see `TopoDiscountScope`. */
  readonly topoDiscountScope: TopoDiscountScope;
  /** The smallest explained share at which the deduction may charge a node — see `TreePrunerOptions.topoDiscountGate`. */
  readonly topoDiscountGate: number;
  /** How the deduction's explanation is aggregated over a caller's callees — see `TopoClosure`. */
  readonly topoClosure: TopoClosure;
  /** Which SET of nodes the ranking may answer with — see `PoolAdmission`. */
  readonly poolAdmission: PoolAdmission;
  readonly collisionWeight: number;
  readonly prismWeight: number;
  readonly prismPooling: PrismPooling;
}

/** The two constructor arguments, named so a test can assert both. */
export interface Fse26EngineOptions {
  readonly signals: Fse26SignalOptions;
  readonly topology: Partial<TopologyFaultGraphConfig>;
}

/**
 * Parsed options that must NOT reach the engine.
 *
 * `dropMetrics` is applied at LOAD time — the bridge filters the named series out
 * of each case before scoring, so it changes the input rather than the engine.
 * The rest are run harness concerns: where the data is, how many cases to take,
 * where to write the artifact, which fault types to dump a diagnostic for, and
 * at what precision that diagnostic renders its per-service fields — the last
 * being a property of the written ARTIFACT that a reader derives its error bar
 * from, and of nothing the engine computes.
 */
export const NON_ENGINE_OPTION_KEYS = [
  'dataDir',
  'maxCases',
  'output',
  // A writer, not a knob: it records what the engine answered, and the engine never reads it back. It is
  // classified here rather than in the reported-config exclusion alone because this list is what the
  // completeness test above checks — an option that reaches neither the engine nor this list is the silent
  // drop the test exists to catch.
  'perCaseOut',
  'diagnose',
  'diagnoseLimit',
  'diagnoseDecimals',
  // The same kind of writer as `perCaseOut`, and on the same rule: `--terms-out` serialises the breakdown
  // the engine already produced for its own answer, and the engine never reads the file back. It is
  // classified here for the reason stated above rather than left out, because a path that reaches neither
  // the engine nor this list is exactly the silent drop the completeness test exists to catch.
  'termsOut',
  // The fingerprint writer, on exactly the same rule as `termsOut` above: it serialises a summary of the ranking
  // the engine already produced, for a layer that runs AFTER the ranking, and the engine never reads it back. A
  // path that reached neither the engine nor this list is the silent drop the completeness test exists to catch.
  'fingerprintOut',
  // The ranking-depth writer, on exactly the same rule: it serialises the position of the corpus's answer in
  // the order the engine already produced. The engine never reads it back, so it is a harness artifact rather
  // than a knob — but it is listed here because an option that reached neither the engine nor this list is the
  // silent drop the completeness test exists to catch.
  'depthOut',
  'dropMetrics',
  // Where the fault-free profile is read FROM. The profile reaches the engine as a second argument rather than
  // as a parsed field, because reading a file is IO and this module is the pure projection a test checks; the
  // PATH is therefore a harness option on the same rule as `dataDir` — two runs of one configuration from two
  // files are one configuration.
  'faultFreeProfilePath',
] as const;

/**
 * Build the engine's constructor arguments from parsed options.
 *
 * @param opts - Parsed command-line options.
 * @returns The signal options and the topology config the engine is built with.
 */
export function buildFse26EngineOptions(
  opts: Fse26CliOptions,
  profile?: FaultFreeProfile | undefined,
): Fse26EngineOptions {
  return {
    signals: {
      logWeight: opts.logWeight,
      logSignalMode: opts.logMode,
      logNormalisation: opts.logNormalisation,
      failedEdgeWeight: opts.failedEdgeWeight,
      failedEdgeMode: opts.failedEdgeMode,
      failedEdgeMinRecords: opts.failedEdgeMinRecords,
      latWeight: opts.latWeight,
      latMinRise: opts.latMinRise,
      poolMetricPenaltyWeight: opts.poolMetricPenaltyWeight,
      stabilityWeight: opts.stabilityWeight,
      faultFreeWeight: opts.faultFreeWeight,
      faultFreeSelection: opts.faultFreeSelection,
      // Handed in rather than loaded here: reading a file is IO and this module is the pure projection a test
      // checks against the parsed options. The key is built CONDITIONALLY rather than assigned `undefined`,
      // and the reason is a census rather than taste: `forwarded ∪ nonEngine = parsed` is asserted over the
      // returned key SET, and the profile is not a parsed option — it arrives as a second argument. An
      // always-present key would put a non-parsed name into the forwarded set and break that partition in
      // six places (measured, not predicted: that is exactly what assigning it unconditionally did).
      ...(profile === undefined ? {} : { faultFreeProfile: profile }),
      selfTimeWeight: opts.selfTimeWeight,
      victimWeight: opts.victimWeight,
      selfAnomalyWeight: opts.selfAnomalyWeight,
      dualFamilyWeight: opts.dualFamilyWeight,
      podStateWeight: opts.podStateWeight,
      dualFamilyGate: opts.dualFamilyGate,
      dualFamilyGateMode: opts.dualFamilyGateMode,
      temporalWeight: opts.temporalWeight,
      onsetShape: opts.onsetShape,
      // The five the golden half could state alone until `docs/dispatch-surface-audit.md`'s Finding 6
      // registered the mirror. They belong in THIS object and not in `topology` below for the reason that
      // document's own split records: these are consumed by the pruner's first constructor argument, and a
      // value placed in the wrong object is a silent no-op rather than an error.
      traceWeight: opts.traceWeight,
      traceSkipsLeader: opts.traceSkipsLeader,
      topoWeight: opts.topoWeight,
      topoDiscount: opts.topoDiscount,
      topoDiscountScope: opts.topoDiscountScope,
      topoDiscountGate: opts.topoDiscountGate,
      topoClosure: opts.topoClosure,
      poolAdmission: opts.poolAdmission,
      collisionWeight: opts.collisionWeight,
      prismWeight: opts.prismWeight,
      prismPooling: opts.prismPooling,
    },
    topology: {
      // The EVENT family the run measures against. It lives in THIS object because it is a
      // `TopologyFaultGraphConfig` member — the graph's own guard reads it — and because the same name on two
      // interfaces is a name whose owner nobody can name, which `rcaeval-reported-config.test.ts` refuses.
      eventExtraLabels: opts.eventExtraLabels,
      // Load-bearing on Train Ticket's large topologies.
      rankNormalization: opts.rankNormalization,
      // …and the node count that decides which topologies count as large. Named on the artifact for the same
      // reason: this corpus is the large-graph one, so the flag above acts on nearly every case here, and a
      // reader cannot tell that from the boolean alone.
      anomalyNormalizeNodeThreshold: opts.anomalyNormalizeNodeThreshold,
      // Ablation switches; both are bit-identical to the shipped scoring when
      // they are at their defaults.
      metricRiseCeiling: opts.metricRiseCeiling,
      metricFleetBaseline: opts.metricFleetBaseline,
      // …and the three that belong to the FAULT GRAPH rather than to the ranking fusion: the drop-half
      // discount and the two suppression switches. They are forwarded unconditionally rather than
      // omitted-when-default, which is this object's difference from the rendered line: the line may omit a
      // default because its own rule makes the omission readable, while a PARTIAL here with a key left out
      // would be a silent revert to the engine's default with nothing failing.
      collapseDiscount: opts.collapseDiscount,
      dropDeviationMode: opts.dropDeviationMode,
      baselineAnchor: opts.baselineAnchor,
      // The guard's QUESTION, on the same unconditional-forwarding rule as every field above: a PARTIAL
      // with a key left out is a silent revert to the engine's default, and on this half that default is
      // the very value the flag was added to make measurable.
      transientGuardTest: opts.transientGuardTest,
      anomalyTrendWeight: opts.anomalyTrendWeight,
      anomalyBurstWeight: opts.anomalyBurstWeight,
      anomalyCvWeight: opts.anomalyCvWeight,
      anomalyBreadthWeight: opts.anomalyBreadthWeight,
      anomalyBreadthGate: opts.anomalyBreadthGate,
      suppressIdleTransients: opts.suppressIdleTransients,
      suppressNearZeroBaselineRise: opts.suppressNearZeroBaselineRise,
      suppressZeroBaselineLatency: opts.suppressZeroBaselineLatency,
      capTrendBonusAtDeviation: opts.capTrendBonusAtDeviation,
      suppressDemandMetrics: opts.suppressDemandMetrics,
    },
  };
}
