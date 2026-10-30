/**
 * Build the REPORTED configuration for the FSE'26 half — the record the `Config:` line and the JSON artifact
 * are both rendered from.
 *
 * ## The defect this module closes
 *
 * `topoClosure` was forwarded to the engine (`buildFse26EngineOptions`) and **not** to this record. Dispatch
 * `41053711414` asked for `topo_closure=sum`, the engine ran `sum`, and the run's own configuration line read
 * `topoClosure=max` — the shipped value — because {@link FSE26RunConfig.topoClosure} is optional and the line
 * renders `?? DEFAULT_TOPO_CLOSURE`. The numbers were therefore a `sum` measurement published under a `max`
 * label: an artifact asserting a configuration the run did not have, which is the same failure
 * `docs/dispatch-surface-audit.md` records in the other direction (a knob that reaches the label and not the
 * engine).
 *
 * The hole was structural rather than clerical. The golden half renders its line straight from the parsed
 * options (`rcaeval-engine-options.ts`), so it cannot disagree with itself; this half renders from a RECORD,
 * and an optional field on that record is a field a producer may forget. `fse26-engine-options.ts` was
 * extracted from `main()` for exactly this reason — "a file that calls `main()` at import time is importable
 * by nothing" — and this module is the same extraction for the other object, so that the mapping from parsed
 * options to the reported record is checkable in a test instead of readable only in a 60-line literal.
 *
 * ## What the invariant is
 *
 * {@link buildFse26RunConfig} and {@link buildFse26EngineOptions} are two projections of one input, and the
 * property that matters is that they agree: **every option the engine receives must be an option the artifact
 * can state**, at the same value. `fse26-run-config.test.ts` asserts that over the key sets rather than over a
 * hand-written list, and `NOT_REPORTED_FSE26_OPTION_KEYS` names the options that are deliberately absent (the
 * run harness's own switches, which describe the invocation rather than the configuration).
 *
 * @module benchmarks/fse26-run-config
 */

import type { Fse26CliOptions } from './fse26-cli.js';
import type { FSE26RunConfig } from './fse26-report.js';

/**
 * Options that are deliberately NOT part of the reported configuration.
 *
 * Each describes how the run was INVOKED rather than how it was configured: where the corpus was read from,
 * how many cases were taken, where the artifact was written, and what the diagnostic dump was asked to print.
 * Two runs of the same configuration from two directories are the same configuration, so recording the path
 * would make byte-equal configurations look different — the opposite defect to the one above, and the reason
 * this is a named list rather than "everything the builder felt like copying".
 *
 * `dropMetrics` is NOT here: it changes the ranking, so it is reported.
 */
export const NOT_REPORTED_FSE26_OPTION_KEYS = [
  'dataDir',
  'maxCases',
  'output',
  'diagnose',
  'diagnoseLimit',
  'diagnoseDecimals',
] as const;

/**
 * Project parsed options onto the record both renderings of the run configuration come from.
 *
 * Every field is copied EXPRESSLY. A spread of `opts` would make the record complete by accident and would
 * also carry the harness options into it, so the parity test would pass on a record that names the corpus
 * directory — the copy is the point, and the test is what stops it from being forgotten.
 *
 * @param opts - Parsed command-line options.
 * @returns The configuration recorded on the header line and in the artifact's `config` block.
 */
export function buildFse26RunConfig(opts: Fse26CliOptions): FSE26RunConfig {
  return {
    selfAnomalyWeight: opts.selfAnomalyWeight,
    logWeight: opts.logWeight,
    logSignalMode: opts.logMode,
    rankNormalization: opts.rankNormalization,
    anomalyNormalizeNodeThreshold: opts.anomalyNormalizeNodeThreshold,
    dropMetrics: opts.dropMetrics,
    metricRiseCeiling: opts.metricRiseCeiling,
    dropDeviationMode: opts.dropDeviationMode,
    baselineAnchor: opts.baselineAnchor,
    metricFleetBaseline: opts.metricFleetBaseline,
    suppressDemandMetrics: opts.suppressDemandMetrics,
    failedEdgeWeight: opts.failedEdgeWeight,
    failedEdgeMode: opts.failedEdgeMode,
    failedEdgeMinRecords: opts.failedEdgeMinRecords,
    latWeight: opts.latWeight,
    latMinRise: opts.latMinRise,
    poolMetricPenaltyWeight: opts.poolMetricPenaltyWeight,
    stabilityWeight: opts.stabilityWeight,
    selfTimeWeight: opts.selfTimeWeight,
    victimWeight: opts.victimWeight,
    dualFamilyWeight: opts.dualFamilyWeight,
    dualFamilyGate: opts.dualFamilyGate,
    dualFamilyGateMode: opts.dualFamilyGateMode,
    temporalWeight: opts.temporalWeight,
    onsetShape: opts.onsetShape,
    // The eight the mirror made reachable on this half. Carried on the config rather than left to the
    // line's default so that the JSON artifact records them too: the line may OMIT a default, and a
    // reader of the JSON must not have to know that an absent key means the shipped value.
    traceWeight: opts.traceWeight,
    traceSkipsLeader: opts.traceSkipsLeader,
    topoWeight: opts.topoWeight,
    topoDiscount: opts.topoDiscount,
    topoDiscountScope: opts.topoDiscountScope,
    topoDiscountGate: opts.topoDiscountGate,
    // The deduction's CLOSURE, and the field whose absence from this object is the defect in the module
    // docblock: the engine aggregated by `sum` while the line reported the shipped `max`.
    topoClosure: opts.topoClosure,
    collisionWeight: opts.collisionWeight,
    prismWeight: opts.prismWeight,
    prismPooling: opts.prismPooling,
    collapseDiscount: opts.collapseDiscount,
    suppressIdleTransients: opts.suppressIdleTransients,
    suppressNearZeroBaselineRise: opts.suppressNearZeroBaselineRise,
    suppressZeroBaselineLatency: opts.suppressZeroBaselineLatency,
    capTrendBonusAtDeviation: opts.capTrendBonusAtDeviation,
    // The anomaly composition: carried so the JSON records it too, and printed unconditionally by the
    // line, because on the golden half these four ARE the ranking.
    anomalyTrendWeight: opts.anomalyTrendWeight,
    anomalyBurstWeight: opts.anomalyBurstWeight,
    anomalyCvWeight: opts.anomalyCvWeight,
    anomalyBreadthWeight: opts.anomalyBreadthWeight,
    anomalyBreadthGate: opts.anomalyBreadthGate,
  };
}
