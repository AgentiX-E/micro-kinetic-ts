/**
 * The structured FSE'26 result summary written to `--output`.
 *
 * This object is the machine-readable half of a benchmark run: the CI workflow
 * uploads it as an artifact and every downstream reader — a diff job, a report,
 * a later investigation — works from it. It therefore has to carry **the
 * configuration that produced the numbers**, not just the numbers. The plain
 * text report prints that configuration in a header line, so a gap here is
 * invisible to whoever reads the log and fatal to whoever reads the JSON.
 *
 * It used to be assembled inline inside `run-fse26.ts`'s `main()`, which is why
 * it could drift from the header: `main()` runs on import and cannot be called
 * from a test, so nothing could check that the two agreed. Extracting it makes
 * the shape testable, and {@link buildFSE26Report} takes the whole run
 * configuration as one object so a new field cannot be silently dropped.
 *
 * @module benchmarks/fse26-report
 */

/** The published SOTA anchor the run is compared against. */
export interface FSE26Anchor {
  readonly sotaAvgTop1: number;
  readonly sotaBestTop1: number;
}

import type { FaultFailedEdge } from '../../packages/core/src/index.js';
import type {
  BaselineAnchor,
  DropDeviationMode,
  DualFamilyGateMode,
  FailedEdgeFirstScope,
  FailedEdgeGateMode,
  FailureAttribution,
  FailureContainmentScope,
  FaultFreeSelection,
  LabelPriorJurisdiction,
  OnsetShape,
  PoolAdmission,
  PrismPooling,
  SelfTimeScope,
  StabilityScope,
  TopoClosure,
  TopoDiscountScope,
  TopoEdgeRise,
  TransientGuardTest,
} from '../../packages/tree/src/index.js';

import {
  DEFAULT_CONTAINMENT_MARGIN,
  DEFAULT_CONTAINMENT_ORDER,
  DEFAULT_FAILED_EDGE_FIRST_SCOPE,
  DEFAULT_FAILED_EDGE_GATE_MODE,
  DEFAULT_FAILURE_ATTRIBUTION,
  DEFAULT_FAILURE_CONTAINMENT,
  DEFAULT_FAILURE_CONTAINMENT_SCOPE,
  DEFAULT_POOL_ADMISSION,
  DEFAULT_SELF_TIME_SCOPE,
  DEFAULT_STABILITY_SCOPE,
  DEFAULT_TOPO_CLOSURE,
  DEFAULT_TOPO_DISCOUNT_GATE,
  DEFAULT_TOPO_EDGE_RISE,
  formatTopoEdgeRise,
} from '../../packages/tree/src/index.js';

/**
 * Everything that determines the reported numbers.
 *
 * Every field here can change the headline metric on its own: `logMode` is
 * worth ~24pp, `dropMetrics` selects an ablation, `logWeight` scales the log
 * signal and `rankNormalization` is load-bearing on Train Ticket's large
 * topologies. A reader who cannot see these cannot attribute the artifact.
 */
export interface FSE26RunConfig {
  /** Weight of the log signal in the ranking fusion. */
  readonly logWeight: number;
  /** Log-signal scoring mode (`count` | `logicHttp` | `all` | ...). */
  readonly logSignalMode: string;
  /** How the log signal's counts become a score — see `LogNormalisation` in `packages/tree`. */
  readonly logNormalisation: string;
  /** Whether ranking scores are rank-normalised before fusion. */
  readonly rankNormalization: boolean;
  /**
   * The node count at or above which `rankNormalization` runs at all — the flag's POPULATION.
   *
   * A separate field because the boolean cannot describe itself: two runs that both print
   * `rankNormalization=true` differ completely if one rescaled every graph and the other only the graphs
   * with 20+ services, and the register's verdict about this axis is a verdict about a population that has
   * never been varied. Printed unconditionally, on the latency weight's rule — this default is non-zero, so
   * an omitted-when-default field would render the shipped run and its ablation byte-identically.
   */
  readonly anomalyNormalizeNodeThreshold: number;
  /**
   * The anomaly composition's four coefficients.
   *
   * On the RCAEval half these ARE the ranking (every other term is inert there); here they decide how a
   * service's own series is scored before any term reads it. The artifact printed none of them until an
   * `anomaly_breadth_weight=0.05` run reported 56.6% and the `Config:` line could not be checked against
   * the dispatch — the defect this whole line exists to prevent, one object over.
   */
  readonly anomalyTrendWeight: number;
  readonly anomalyBurstWeight: number;
  readonly anomalyCvWeight: number;
  readonly anomalyBreadthWeight: number;
  /** The breadth contender gate (0 = none). */
  readonly anomalyBreadthGate: number;
  /** Metric names dropped for this run (empty = no ablation). */
  readonly dropMetrics: readonly string[];
  /**
   * Additional metric labels the run admitted to the EVENT family (absent = the shipped family, `['error']`).
   *
   * Stated on the record rather than left to the line's default because it changes which channels are
   * measurable at all: a reader comparing two artifacts must be able to tell a run that admitted the FSE'26
   * spelling of the error rate from one that did not, without knowing what the shipped family was.
   */
  readonly eventExtraLabels?: readonly string[];
  /**
   * Ceiling on one metric's relative deviation (0 = unbounded, the shipped
   * behaviour). An ablation switch for the anomaly score's dynamic range: the
   * RISE direction is unbounded while a DROP is capped at `log10(2)`, so a
   * service's score can be handed to whichever of its metrics has the widest
   * range. A run at a non-zero ceiling is a different configuration and has to
   * say so, or its numbers cannot be compared with the published ones.
   */
  readonly metricRiseCeiling: number;
  /**
   * Whether each metric's cross-service median is subtracted before the service
   * maximum (`false` = the shipped absolute score). The ONLY operation that can
   * reorder two services on the metric axis, so a run that uses it is a
   * different configuration and has to say so.
   */
  readonly metricFleetBaseline: boolean;
  /**
   * Weight of the failed-edge-DIRECTION signal (0 = disabled, the shipped
   * configuration). It charges each post-injection failed call to its CALLEE —
   * the inverse of the log signal's credit to the emitter — so a non-zero value
   * is a different ranking and has to say so.
   */
  readonly failedEdgeWeight: number;
  /**
   * How a callee's failed calls were aggregated (`sum` = the shipped one). A
   * run using `mean` ranks differently, so it has to say so.
   */
  readonly failedEdgeMode: string;
  /** Minimum contributing edges a callee needs to be credited (1 = shipped). */
  readonly failedEdgeMinRecords: number;
  /**
   * Weight of the per-edge LATENCY-rise signal. The shipped configuration carries
   * it ON — unlike `failedEdgeWeight` above, whose shipped value is 0 — so this
   * field is always rendered, and a run at `0` is the ablation that scores 47.33%.
   */
  readonly latWeight: number;
  /**
   * Rise a service must clear before the latency term credits it. The shipped value
   * is 1, so it is rendered only when it differs — like the failed-edge floor, and
   * unlike the weight above, whose shipped value is not zero.
   */
  readonly latMinRise: number;
  /**
   * Weight of the DB-connection-pool dominance penalty. Required here for the same
   * reason the weights above are: this line is the only record of which
   * configuration produced a number.
   */
  readonly poolMetricPenaltyWeight: number;
  /**
   * Weight on the decisive-stability prior; the shipped value is the engine's own constant, and
   * both halves of the kill criterion were measured at it before the default moved, so the flag
   * path and the DEFAULT path agree on this line.
   */
  readonly stabilityWeight: number;
  /**
   * Weight on the FAULT-FREE FREQUENCY prior; the shipped value is the engine's 0, i.e. OFF.
   *
   * Printed unconditionally for the reason the two weights above are: the term's shipped value is 0, so an
   * omitted-when-default rule would render a measured arm and the shipped run byte-identically.
   */
  readonly faultFreeWeight: number;
  /**
   * Which channel that prior reads when it is on. Printed beside the weight because the two are one
   * hypothesis: `rarest` and `dominant` are different readings of the same profile, and a number published
   * without the spelling could belong to either.
   */
  readonly faultFreeSelection: FaultFreeSelection;
  /**
   * Weight on the LABEL prior; the shipped value is the engine's 0, i.e. OFF.
   *
   * Printed unconditionally for the reason the fault-free weight above is: `0` is the ablation, so an
   * omitted-when-default rule would render a measured arm and the shipped run byte-identically — and on this
   * half the arm is the one the census could not state until the history was derived from the corpus.
   */
  readonly labelPriorWeight: number;
  /**
   * The margin at which that prior may speak, on the engine's own `top1 − top2` before the term is added.
   *
   * Printed beside the weight because the two are one configuration and neither alone identifies the arm. The
   * gate is INERT at weight 0, so its shipped value goes on the line anyway — a reader who sees `0` for the
   * weight must still be able to tell which gate the next arm was paired with.
   */
  readonly labelPriorMarginGate: number;
  /**
   * Where in the ranking that prior may act, `everywhere` or `tail`.
   *
   * Printed beside the pair for the reason the gate is: on this half the two words are the difference between the
   * refused arm and the one that survives, and `everywhere` is the shipped default rather than a mode to infer.
   */
  readonly labelPriorJurisdiction: LabelPriorJurisdiction;
  /**
   * Content digest of the fault-free profile the run supplied, or `null` when it supplied none.
   *
   * Recorded because the profile is an input to **two** consumers and only one of them is a reported field.
   * The fault-free term reads it and is described by {@link faultFreeWeight}; the containment order reads it
   * for the per-service latency excursions that license an inversion, and is described by nothing.
   *
   * With the shipped weight of `0` the first consumer is silent, so on this corpus a run WITHOUT a profile
   * and a run WITH one are identical under every other reported field and read `1 141` against `1 156`
   * Top@1 — 15 cases, 1.06 pp, with no error and no printed line saying the pass did nothing. A digest
   * rather than the path, because a path is a location (two directories, one configuration) while a digest
   * is a content identity (two bands, two configurations).
   */
  readonly faultFreeProfileDigest: string | null;
  /**
   * Whether the containment pass had excursions to read — the CAPABILITY, not the outcome.
   *
   * `'absent'` means the pass could not have inverted anything: either it was switched off, or no profile was
   * supplied and `latencyExcursions` therefore returned an empty map, which makes `inspectContainmentOrder`
   * return the ranking unchanged. That is a property of the invocation and is why it is printed beside
   * {@link containmentOrder}: the boolean says the pass was ASKED for, this says whether it could speak.
   */
  readonly containmentExcursions: 'measured' | 'absent';
  /**
   * Weight on the SELF-TIME prior; the shipped value is the engine's 0, i.e. OFF. Printed
   * unconditionally, because the term ships at 0 and an omitted-when-default rule would render the
   * measured arm and the shipped run byte-identically.
   */
  readonly selfTimeWeight: number;
  /**
   * Which scale that weight reads. Printed beside the weight because the two are ONE configuration: the same
   * number means the refused absolute share under `absolute` and the fleet residual under `fleet`, so a line
   * carrying only the weight could belong to either arm.
   */
  readonly selfTimeScope: SelfTimeScope;
  readonly stabilityScope: StabilityScope;
  /** Weight on the internal/external symmetry mask; `0` = the shipped configuration. */
  readonly victimWeight: number;
  /** Weight on the dual-family presence bonus; `0` = the shipped configuration. */
  readonly dualFamilyWeight: number;
  /** Weight on the pod-state term; `0` = the shipped configuration. */
  readonly podStateWeight: number;
  /**
   * Weight on the BASE term — the candidate's own anomaly. `1` is the shipped configuration and is the value
   * the formula carried as a literal before it was named; printed unconditionally so that an arm which
   * ablates it cannot produce the shipped run's line.
   */
  readonly selfAnomalyWeight: number;
  /** The dual-family membership's population; `0` = no gate, the membership the weight was enrolled on. */
  readonly dualFamilyGate: number;
  /** Which fleet-relative comparison that gate applies; `min` = the shipped configuration. */
  readonly dualFamilyGateMode: DualFamilyGateMode;
  /** Weight of the injection-anchored temporal prior; `0` = the shipped configuration. */
  readonly temporalWeight: number;
  /** Which shape the prior reads the onsets in; inert while the weight is 0. */
  readonly onsetShape: OnsetShape;
  /**
   * The eight knobs the mirror of iteration 96 made dispatchable on this half.
   *
   * They are on this interface because the kill criterion's two halves live on two benchmarks, and an
   * option the engine carries while the artifact cannot name it is a run whose configuration nobody can
   * state — the defect `docs/dispatch-surface-audit.md`'s Findings 3 and 5 record, arriving from the other
   * direction. The line prints each on its own `omit when it holds its default` rule, and that rule is
   * SAFE for all eight because every default here is zero or false: an omission is then readable as the
   * default both before and after any change to it.
   */
  readonly traceWeight: number;
  /** Whether the trace vote is withheld from the anomaly leader; `false` = the shipped configuration. */
  readonly traceSkipsLeader: boolean;
  /**
   * Whether the containment pass runs. Its shipped value is TRUE, so this field may not follow the `omit when
   * default` rule the eight knobs above use: an omitted field would then read as the ablation and an arm that
   * switched the pass off would be byte-identical to the shipped run. Printed unconditionally.
   */
  readonly containmentOrder?: boolean;
  /**
   * Margin of the containment pass, in band widths. Ships at 0, so the omission rule IS sound here — an
   * omitted field reads as a strict comparison both before and after any change to the constant.
   */
  readonly containmentMargin?: number;
  /** The failure-flow order's switch, rendered for the same reason the containment order's is. */
  readonly failureContainment?: boolean;
  /**
   * Whether the failed-edge ledger's candidate set was ranked ahead of everything else.
   *
   * Rendered only when it is ON, because the switch ships OFF: the failure the unconditional renderings guard
   * against is an ON run that reads as the shipped one, and here the ON value is the one that must be visible.
   */
  readonly failedEdgeFirst?: boolean;
  /** Which membership that partition ranked first, rendered only when it is not the shipped `credited`. */
  readonly failedEdgeFirstScope?: FailedEdgeFirstScope;
  /** Which reading of the failure flow that pass applied. */
  readonly failureAttribution?: FailureAttribution;
  /**
   * How far the failure-flow pass looked for a pair to invert, rendered only when it is not the shipped
   * `adjacent`.
   *
   * Conditional for the gate-mode reason below: a traversal that is not the shipped one can always be read off
   * the artifact, so the failure an unconditional rendering guards against — a wide run that renders byte-identically
   * to the shipped one — is unreachable, and the shipped byte stream stays what every published cell was measured
   * on.
   */
  readonly failureContainmentScope?: FailureContainmentScope;
  /**
   * Which bar let the failed-call direction term speak, rendered only when it is not the shipped one.
   *
   * Conditional rather than unconditional, unlike the two switches above: a MODE that is not the default can always
   * be read off the artifact, so the failure the unconditional rendering guards against — an ON run that renders
   * byte-identically to the shipped OFF one — is unreachable here. The shipped byte stream stays what every
   * published cell was measured on.
   */
  readonly failedEdgeGateMode?: FailedEdgeGateMode;
  readonly topoWeight: number;
  /**
   * Topological deduction strength. Printed only when non-zero, and its scope nested under it: the deduction
   * map is not built at `0`, so a scope alone is not a configuration the engine can distinguish.
   */
  readonly topoDiscount: number;
  /** Which channels the deduction may act on — see `TopoDiscountScope`. */
  readonly topoDiscountScope: TopoDiscountScope;
  /**
   * The smallest explained share at which the deduction may charge a node. Optional in this record, like
   * every weight here, because the record is what an artifact is read BACK into: an artifact written before
   * the field existed must still parse, and `missingReportedConfigFields` is the audit that says so.
   */
  readonly topoDiscountGate?: number;
  /**
   * How the deduction's explanation was aggregated over a caller's callees — see `TopoClosure`.
   *
   * Optional for the reason the gate records: this record is what an artifact is read BACK into, so a run
   * published before the field existed must still parse, and the reader renders the ENGINE's default for it
   * rather than the value that happened to ship when the field was added.
   */
  readonly topoClosure?: TopoClosure;
  /**
   * The smallest out-edge latency rise at which an edge stood in for a response channel, and the quantity
   * it was measured AGAINST, or `null` for the shipped reading that consults no edge — see `TopoEdgeRise`.
   *
   * Optional for the reason the closure records: an artifact published before the field existed must
   * still parse. Rendered only when a threshold is set, because `null` is the operator AS IT SHIPS and a
   * line that printed it would alter the configuration of every published run retroactively — the one
   * direction in which "print the default" is wrong, since here the default is the absence of a knob
   * rather than a value of it.
   *
   * **Both halves of the pair are in the field, not just the threshold.** `2` and `2:inbound` are the same
   * number and different rules — one compares an edge's rise to a constant, the other to the caller's own
   * inbound measurement — so a record that kept only `threshold` would render two configurations that
   * differ by a divisor as one line, which is the `topoClosure` defect (a value that reached the engine and
   * not the record) on the axis where the two readings are not even the same units. Rendered through
   * `formatTopoEdgeRise`, the same function the CLI parses with, so the spelling cannot drift between the
   * flag and the line that attributes it.
   */
  readonly topoEdgeRise?: TopoEdgeRise | null;
  /**
   * Which SET of nodes the ranking covered — see `PoolAdmission`.
   *
   * Optional for the reason the gate and the closure record: a run published before the field existed must
   * still parse, and the reader renders the ENGINE's default for it rather than the value that happened to ship
   * when the field was added. Printed unconditionally, because it is a VALUE (`positive` is the shipped one) and
   * an omitted-when-default field would render a widened pool and the published run identically.
   */
  readonly poolAdmission?: PoolAdmission;
  readonly collisionWeight: number;
  readonly prismWeight: number;
  /**
   * The pooling the PRISM term fuses with. Printed only alongside a non-zero `prismWeight`, on the rule
   * `failedEdgeMode` already follows: the pooling is INERT at a zero weight, so two runs that differ only
   * in a value the engine multiplies by zero are the same configuration and printing both would report a
   * difference that does not exist.
   */
  readonly prismPooling: PrismPooling;
  readonly collapseDiscount: number;
  /** How a metric's drop becomes a deviation; `bounded` is the shipped value. */
  readonly dropDeviationMode: DropDeviationMode;
  /** Which WINDOW the deviation is measured between; `whole-file` is the shipped value. */
  readonly baselineAnchor: BaselineAnchor;
  /**
   * Which STATISTIC decides a channel moved for good — the guard's question.
   *
   * Named unconditionally like its neighbours on the anchor's rule, because the shipped reading and the
   * arm that buys 13 cases on the golden half are otherwise byte-identical artifacts. The union has four
   * members and `evidence-aware` resolves per case from what the case observed, so this field records the
   * POLICY a run was launched under rather than the statistic any individual case used; the resolved arm
   * is a property of the case and is recorded by `--diagnose-dump`, not here.
   */
  readonly transientGuardTest: TransientGuardTest;
  readonly suppressIdleTransients: boolean;
  readonly suppressNearZeroBaselineRise: boolean;
  /** Discard a transport channel whose head window has no level; `false` is the shipped value. */
  readonly suppressZeroBaselineLatency: boolean;
  /** Cap the trend bonus at its deviation; `false` is the shipped value. */
  readonly capTrendBonusAtDeviation: boolean;
  /**
   * The demand guard. Printed only at its NON-shipped pole, on this line's own rule: the shipped line stays
   * byte-identical to the published one, so the DEFAULT here is invisible and the ablation is not.
   */
  readonly suppressDemandMetrics: boolean;
}

/** One fault type's cell in the summary. */
export interface FSE26FaultCell {
  readonly total: number;
  readonly correct: number;
}

/**
 * How much failed-edge evidence a run's cases actually carry.
 *
 * A ranking signal can report "no change" for two very different reasons: the
 * signal is not informative, or it never received any input. The two are
 * indistinguishable from the headline number, and the second looks exactly like
 * a result — so the input has to be counted, not assumed. This is the counter:
 * how many cases carry the field at all, how many records there are, how many
 * name a CALLEE that is actually rankable in that case's graph (the signal drops
 * the rest), and the total post-injection failures those in-graph edges carry
 * net of their own baselines.
 *
 * All four zero means the signal was driven by nothing; `casesWithEdges: 0` is
 * the specific shape of an empty evidence class.
 */
export interface FailedEdgeCoverage {
  /** Cases in the run. */
  readonly cases: number;
  /** Cases carrying at least one failed-edge record. */
  readonly casesWithEdges: number;
  /** Failed-edge records across all cases. */
  readonly edges: number;
  /** Records whose CALLEE is a graph node — the ones the signal can use. */
  readonly inGraphEdges: number;
  /** In-graph failures net of each edge's own pre-injection baseline. */
  readonly netFailures: number;
}

/**
 * Count the failed-edge evidence a run actually loaded.
 *
 * Takes a deliberately compact per-case projection rather than the loaded case:
 * a case's metric SERIES are large and the runner releases them after scoring,
 * so a counter that retained them would hold the whole dataset in memory. The
 * metric KEYS are the graph nodes (`toBenchmarkCase` builds one node per service
 * with metric series), so `metricKeys.has(callee)` is the same test the signal
 * performs, without this module depending on the kinetic package.
 *
 * A self-edge (`caller === callee`) counts as a RECORD but not as in-graph
 * evidence, because the signal drops it: it says nothing about direction. Same
 * for a callee with no metric series.
 *
 * @param cases - One compact projection per evaluated case.
 * @returns The coverage counters.
 */
export function summariseFailedEdgeCoverage(
  cases: ReadonlyArray<{
    readonly failedTraceEdges?: readonly FaultFailedEdge[];
    readonly metricKeys: ReadonlySet<string>;
  }>,
): FailedEdgeCoverage {
  let casesWithEdges = 0;
  let edges = 0;
  let inGraphEdges = 0;
  let netFailures = 0;

  for (const oneCase of cases) {
    const list = oneCase.failedTraceEdges;
    if (!list || list.length === 0) continue;
    casesWithEdges += 1;
    edges += list.length;
    for (const { caller, callee, failed, baseline } of list) {
      if (caller === callee) continue;
      if (!oneCase.metricKeys.has(callee)) continue;
      inGraphEdges += 1;
      netFailures += Math.max(0, failed - baseline);
    }
  }

  return { cases: cases.length, casesWithEdges, edges, inGraphEdges, netFailures };
}

/**
 * Render {@link summariseFailedEdgeCoverage} as one line for the run's header.
 *
 * Printed unconditionally, unlike an ablation line: a run whose signal received
 * nothing must be indistinguishable from one that received everything only in
 * the numbers, never in the log.
 *
 * @param coverage - The counters.
 * @returns One human-readable line, without a trailing newline.
 */
export function formatFailedEdgeCoverageLine(coverage: FailedEdgeCoverage): string {
  return (
    `Data:   failed edges in ${coverage.casesWithEdges}/${coverage.cases} cases ` +
    `(${coverage.edges} records, ${coverage.inGraphEdges} in-graph, ` +
    `net ${coverage.netFailures} failures)`
  );
}

/** The complete summary object written to `--output`. */
export interface FSE26Report {
  readonly dataset: 'fse26';
  readonly anchor: FSE26Anchor;
  readonly config: FSE26RunConfig;
  readonly cases: number;
  readonly top1: number;
  readonly top3: number;
  readonly top5: number;
  readonly deltaVsSotaAvg: number;
  readonly loadErrors: number;
  readonly engineErrors: number;
  readonly emptyGraphs: number;
  readonly perFaultType: Readonly<Record<string, FSE26FaultCell & { readonly top1: number }>>;
}

/** Inputs to {@link buildFSE26Report}. */
export interface FSE26ReportInput {
  readonly anchor: FSE26Anchor;
  readonly config: FSE26RunConfig;
  readonly cases: number;
  readonly top1: number;
  readonly top3: number;
  readonly top5: number;
  readonly loadErrors: number;
  readonly engineErrors: number;
  readonly emptyGraphs: number;
  readonly perFaultType: ReadonlyMap<string, FSE26FaultCell>;
}

/**
 * The configuration fields a run artifact MUST carry to be attributable.
 *
 * Each of these can change the headline metric on its own, so an artifact that
 * omits one cannot be compared with another artifact — the difference is
 * unexplained. `logMode` alone is worth ~24pp on this benchmark, which is why
 * it is first on the list of things to check rather than a footnote.
 */
export const REPORTED_CONFIG_FIELDS = [
  'logWeight',
  'logSignalMode',
  'logNormalisation',
  'rankNormalization',
  'dropMetrics',
  'metricRiseCeiling',
  'dropDeviationMode',
  'baselineAnchor',
  'metricFleetBaseline',
  'failedEdgeWeight',
  'failedEdgeMode',
  'failedEdgeMinRecords',
  'latWeight',
  'latMinRise',
  'poolMetricPenaltyWeight',
  'stabilityWeight',
  'stabilityScope',
  'faultFreeWeight',
  'faultFreeSelection',
  // The capability, not the identity. This list is obeyed by BOTH runners, and `containmentExcursions` is
  // derivable from options on both; `faultFreeProfileDigest` is not, because only the FSE 26 runner reads the
  // profile file before it builds its record. So the digest is a field of that record and not a requirement of
  // the shared list — and the field that closes the silent no-op is this one, since it is what tells the two
  // runs of 1 141 and 1 156 apart.
  'containmentExcursions',
  'failedEdgeFirst',
  'failedEdgeFirstScope',
  'failureContainmentScope',
  'selfTimeWeight',
  'selfTimeScope',
  'victimWeight',
  'dualFamilyWeight',
  'podStateWeight',
  'selfAnomalyWeight',
  'dualFamilyGate',
  'dualFamilyGateMode',
  'temporalWeight',
  'onsetShape',
  'topoDiscount',
  'topoDiscountScope',
  'topoDiscountGate',
  'topoClosure',
  'topoEdgeRise',
  'poolAdmission',
  'transientGuardTest',
] as const;

/**
 * Report which of {@link REPORTED_CONFIG_FIELDS} a configuration object omits.
 *
 * Takes `unknown` on purpose: its use is to audit a record that arrived from
 * somewhere else — an artifact read back from a workflow, a JSON pasted into an
 * issue — so the input is untrusted by construction and must not be described
 * by a type that assumes the answer. Returns `[]` when the object carries every
 * field.
 *
 * @param config - A candidate configuration object, typically parsed JSON.
 * @returns The names of the missing fields, in {@link REPORTED_CONFIG_FIELDS}
 *   order; empty when the object is attributable.
 */
export function missingReportedConfigFields(config: unknown): string[] {
  if (typeof config !== 'object' || config === null) {
    return [...REPORTED_CONFIG_FIELDS];
  }
  const record = config as Record<string, unknown>;
  return REPORTED_CONFIG_FIELDS.filter((field) => record[field] === undefined);
}

/**
 * Render the run configuration as the single header line the text report prints.
 *
 * Both renderings of the configuration — this line and the `config` object in
 * the JSON — come from the SAME object on purpose. They used to be written out
 * independently, which is how the JSON lost `logMode` while the line kept it;
 * a test asserts they agree on every reported field.
 *
 * @param config - The run configuration.
 * @returns One human-readable line, without a trailing newline.
 */
export function formatFSE26ConfigLine(config: FSE26RunConfig): string {
  let line =
    `Config: logWeight=${config.logWeight} logMode=${config.logSignalMode} logNormalisation=${config.logNormalisation} ` +
    `rankNormalization=${config.rankNormalization}`;
  // Unconditional, on the latency weight's rule: this default is NON-zero (20), so an
  // omitted-when-default field would render a byte-identical line for the shipped run and for a run that
  // rescaled every graph. It is also the field that says WHICH CASES the boolean above could act on, so
  // omitting it would leave the line unable to distinguish the two populations the axis is about.
  line += ` anomalyNormalizeNodeThreshold=${config.anomalyNormalizeNodeThreshold}`;
  // Unconditional, and for the reason the threshold above is: three of the four are NON-zero, so an
  // omitted-when-default rule would render the shipped run and an ablation identically, and the fourth
  // (breadth) is the one a dispatch varies — a line that could not show it made a 56.6% reading
  // unattributable to the knob that produced it.
  line +=
    ` anomalyTrendWeight=${config.anomalyTrendWeight}` +
    ` anomalyBurstWeight=${config.anomalyBurstWeight}` +
    ` anomalyCvWeight=${config.anomalyCvWeight}` +
    ` anomalyBreadthWeight=${config.anomalyBreadthWeight}` +
    ` anomalyBreadthGate=${config.anomalyBreadthGate}`;
  if (config.dropMetrics.length > 0) {
    line += ` dropMetrics=[${config.dropMetrics.join(', ')}]`;
  }
  // Printed only when it changes the configuration, like `dropMetrics`: the JSON
  // always carries it, and the line exists to make a NON-default run visible.
  // Both are printed UNCONDITIONALLY, and their tokens are the FIELD names: the reported-field partition
  // is read by matching `<field>=` on the line, so a shorter token (`riseCeiling=`) would leave the field
  // looking unreported and force an exemption that then contradicts the printed name.
  line += ` metricRiseCeiling=${config.metricRiseCeiling}`;
  line += ` dropDeviationMode=${config.dropDeviationMode}`;
  line += ` baselineAnchor=${config.baselineAnchor}`;
  line += ` transientGuardTest=${config.transientGuardTest}`;
  if (config.metricFleetBaseline) {
    line += ' fleetBaseline=true';
  }
  // Same rule as the two above: the shipped value is 0, so a zero-weight run's
  // line is byte-identical to the published one and a flipped switch is visible.
  if (config.failedEdgeWeight !== 0) {
    line += ` failedEdgeWeight=${config.failedEdgeWeight}`;
    // Only once the signal is on, and only when it is not the shipped mode:
    // the aggregation is meaningless without a weight to apply it to.
    if (config.failedEdgeMode !== 'sum') {
      line += ` failedEdgeMode=${config.failedEdgeMode}`;
    }
    if (config.failedEdgeMinRecords !== 1) {
      line += ` failedEdgeMinRecords=${config.failedEdgeMinRecords}`;
    }
  }
  // ALWAYS printed, unlike the three fields above. The rule that lets a field be
  // omitted when it holds its default only holds while that default is ZERO: the
  // omission then means "0" both before and after any change to the default, so two
  // different shipped configurations can never render the same line. The shipped
  // latency weight is not zero, so an omitted-when-default field would print a
  // byte-identical `Config:` line for the 694-case run and the 673-case ablation —
  // which is the exact defect this line exists to prevent. It is NOT nested under
  // the failed-edge weight either: the two terms are independent, and this one can
  // be on while that one is off.
  line += ` latWeight=${config.latWeight}`;
  // Only when it changes the configuration, like the failed-edge floor: the shipped
  // value is 1, so a run WITH a floor is a different term and has to say so.
  if (config.latMinRise !== 1) {
    line += ` latMinRise=${config.latMinRise}`;
  }
  // Unconditional, on the same rule as the latency weight: this term's shipped value
  // will be NON-zero once measured, so an omitted-when-default field would render a
  // byte-identical line for the shipped run and for `--pool-penalty 0`. Printing it
  // while the shipped value is still 0 costs one field and cannot go stale.
  line += ` poolMetricPenaltyWeight=${config.poolMetricPenaltyWeight}`;
  // Unconditional, on the same rule as the two above: the value is a candidate whose DEFAULT may
  // become non-zero, and an omitted-when-default field would then render a byte-identical line for
  // the shipped run and for its ablation.
  line += ` stabilityWeight=${config.stabilityWeight}`;
  // Unconditional on the same rule. The weight ships at 0, so this pair IS the only thing on the artifact that
  // can distinguish a measured arm from the shipped run.
  line += ` faultFreeWeight=${config.faultFreeWeight} faultFreeSelection=${config.faultFreeSelection}`;
  // Unconditional on the same rule, and the pair the FSE 26 half could not state at all until the history was
  // derived from the corpus: at weight 0 these two fields are the only thing on the artifact that distinguishes
  // a measured arm from the shipped run.
  line += ` labelPriorWeight=${config.labelPriorWeight} labelPriorMarginGate=${config.labelPriorMarginGate}`;
  line += ` labelPriorJurisdiction=${config.labelPriorJurisdiction}`;
  // Unconditional, and the one field on this line whose omission was measured. The profile feeds the
  // containment order's excursions as well as the weight above, so a run with the shipped weight of 0 and no
  // profile was byte-identical on this line to the shipped run while reading 1 141 instead of 1 156 Top@1.
  // `none` rather than an empty string, because an omitted token would read as "the field was not recorded".
  line += ` faultFreeProfileDigest=${config.faultFreeProfileDigest ?? 'none'}`;
  // Unconditional on the same rule: the term ships OFF, so the only thing that can distinguish a
  // measured arm from the shipped run on an artifact is this field.
  line += ` selfTimeWeight=${config.selfTimeWeight}`;
  // Unconditional on the same rule: the term ships OFF, so this field is the only thing that can tell a
  // measured arm from the shipped run on the artifact.
  line += ` victimWeight=${config.victimWeight}`;
  line += ` dualFamilyWeight=${config.dualFamilyWeight}`;
  // Unconditional on the same rule: the term ships OFF, so this field is the only thing that can tell a
  // measured arm from the shipped run on the artifact.
  line += ` podStateWeight=${config.podStateWeight}`;
  // Unconditional: it ships at 0, and 0 is the identity of the membership above — so this field is the only
  // thing that can distinguish a gated arm from the shipped run.
  line += ` dualFamilyGate=${config.dualFamilyGate}`;
  // Unconditional: the mode is inert at gate 0, so this field is the only thing that can say which comparison
  // a gated arm actually applied.
  line += ` dualFamilyGateMode=${config.dualFamilyGateMode}`;
  // Both unconditional, and for a stronger reason than the pool term's: a SHAPE is not a
  // weight, so there is no "default 0" it could be omitted against — and the weight's
  // own default is about to become non-zero, at which point an omitted-when-default
  // field would render the shipped run and its ablation byte-identically.
  line += ` temporalWeight=${config.temporalWeight}`;
  line += ` onsetShape=${config.onsetShape}`;
  // APPENDED after the unconditional prefix rather than inserted among the weights: every byte before this one
  // is what the published artifacts already carry. Unconditional, because 1 is the shipped value and 0 is its
  // ablation — an omitted-when-default rule would render the arm and the control identically on the artifact
  // that is supposed to attribute the difference.
  line += ` selfAnomalyWeight=${config.selfAnomalyWeight}`;
  // The eight the mirror made reachable on this half, each on the `omit when it holds its default` rule
  // every weight above follows — which is sound here for the reason it is unsound for `latWeight`: all
  // eight defaults are zero or false, so an omission reads as the default rather than as a value nobody
  // chose. A knob whose shipped value is NON-zero may not use this rule (see the latency weight above),
  // and none of these is.
  if (config.traceWeight !== 0) {
    line += ` traceWeight=${config.traceWeight}`;
  }
  // Unconditional: the mask is inert at traceWeight 0, so this field is the only thing that can distinguish a
  // masked arm from the shipped run — the rule the ceiling and the drop mode established.
  if (config.traceSkipsLeader) {
    line += ` traceSkipsLeader=${config.traceSkipsLeader}`;
  }
  // Unconditional, and for the reason stated on the field: a pass is a configuration on EVERY artifact, so an
  // omission would have to be read as the ablation, and a run that switched it ON would render byte-identically
  // to the shipped run that left it off. Both passes ship off — this comment said "ships ON" until iteration 289,
  // when the constant was read and the comment was not.
  line += ` containmentOrder=${config.containmentOrder ?? DEFAULT_CONTAINMENT_ORDER}`;
  // Unconditional, and beside the boolean rather than folded into it: `containmentOrder=true` states that the
  // pass was ASKED for, not that it could speak. Without a profile `latencyExcursions` returns an empty map and
  // `inspectContainmentOrder` returns the ranking unchanged, so the pass is on and inert — the state this line
  // exists to make visible, because it cost 15 cases and 1.06 pp on this corpus while every other reported
  // field said the run was the shipped one.
  line += ` containmentExcursions=${config.containmentExcursions}`;
  line += ` failureContainment=${config.failureContainment ?? DEFAULT_FAILURE_CONTAINMENT}`;
  if (config.failedEdgeFirst === true) line += ' failedEdgeFirst=true';
  if (
    (config.failedEdgeFirstScope ?? DEFAULT_FAILED_EDGE_FIRST_SCOPE) !==
    DEFAULT_FAILED_EDGE_FIRST_SCOPE
  ) {
    line += ` failedEdgeFirstScope=${config.failedEdgeFirstScope}`;
  }
  if ((config.failureAttribution ?? DEFAULT_FAILURE_ATTRIBUTION) !== DEFAULT_FAILURE_ATTRIBUTION) {
    line += ` failureAttribution=${config.failureAttribution}`;
  }
  if (
    (config.failureContainmentScope ?? DEFAULT_FAILURE_CONTAINMENT_SCOPE) !==
    DEFAULT_FAILURE_CONTAINMENT_SCOPE
  ) {
    line += ` failureContainmentScope=${config.failureContainmentScope}`;
  }
  if (
    (config.failedEdgeGateMode ?? DEFAULT_FAILED_EDGE_GATE_MODE) !== DEFAULT_FAILED_EDGE_GATE_MODE
  ) {
    line += ` failedEdgeGateMode=${config.failedEdgeGateMode}`;
  }
  if ((config.containmentMargin ?? DEFAULT_CONTAINMENT_MARGIN) !== 0) {
    line += ` containmentMargin=${config.containmentMargin}`;
  }
  if (config.topoWeight !== 0) {
    line += ` topoWeight=${config.topoWeight}`;
  }
  if (config.topoDiscount !== 0) {
    line += ` topoDiscount=${config.topoDiscount}`;
    // Nested under the weight, on `prismPooling`'s rule: a scope combined with a zero deduction is not part
    // of the configuration, so printing it would report a difference the engine cannot have.
    line += ` topoDiscountScope=${config.topoDiscountScope}`;
    // Nested under the SAME weight as the scope, on the same rule: a gate combined with a zero deduction is
    // not a configuration the engine can distinguish, because the map is never built. Printed whenever the
    // weight is non-zero — including at 0, which is the value it ships with — so a gated arm and an ungated
    // one are never byte-identical on the artifact that is supposed to attribute the difference.
    line += ` topoDiscountGate=${config.topoDiscountGate ?? DEFAULT_TOPO_DISCOUNT_GATE}`;
    // Nested under the same weight AGAIN, and for the same reason: `max` and `sum` agree on a tree, so a
    // closure printed without the weight it belongs to would name an aggregation no run performed. Printed
    // even at the shipped `max`, because an omitted-when-default value would render the `sum` arm and the
    // shipped run identically on the artifact whose whole job is to attribute the difference between them.
    line += ` topoClosure=${config.topoClosure ?? DEFAULT_TOPO_CLOSURE}`;
    // The threshold that lets an EDGE stand in for a response channel, printed only when one was set —
    // unlike the three knobs above, whose shipped values are VALUES of their axis. `null` here is the
    // absence of the axis, so printing it would rewrite the configuration line of every published run;
    // printing it when set is what makes an arm's artifact able to attribute its own number.
    //
    // `formatTopoEdgeRise` and not a template, because the axis now has TWO members: `2` and `2:inbound`
    // agree on the threshold and disagree on what it is compared to, so a line built from the number alone
    // would attribute an inbound arm's number to the absolute reading and the two dispatches would be
    // byte-identical on the one artifact whose job is to tell them apart.
    const edgeRise = formatTopoEdgeRise(config.topoEdgeRise ?? DEFAULT_TOPO_EDGE_RISE);
    if (edgeRise !== '') {
      line += ` topoEdgeRise=${edgeRise}`;
    }
  }
  // OUTSIDE the deduction block, because the pool is not a property of the deduction: the filter applies at
  // every weight, and a line that printed it only when the deduction ran would make a `graph` run at weight 0
  // indistinguishable from the published one.
  line += ` poolAdmission=${config.poolAdmission ?? DEFAULT_POOL_ADMISSION}`;
  if (config.collisionWeight !== 0) {
    line += ` collisionWeight=${config.collisionWeight}`;
  }
  if (config.prismWeight !== 0) {
    line += ` prismWeight=${config.prismWeight}`;
    // Nested under the weight, on `failedEdgeMode`'s rule: a pooling combined with a zero weight is not
    // part of the configuration, so printing it would report a difference the engine cannot have.
    if (config.prismPooling !== 'additive') {
      line += ` prismPooling=${config.prismPooling}`;
    }
  }
  if (config.collapseDiscount !== 0) {
    line += ` collapseDiscount=${config.collapseDiscount}`;
  }
  // The two switched guards. A flipped switch is a different ranking and has to say so; the shipped pole
  // says nothing, which is what makes the shipped line byte-identical to the published one.
  if (config.suppressIdleTransients) {
    line += ' suppressIdleTransients=true';
  }
  if (config.suppressNearZeroBaselineRise) {
    line += ' suppressNearZeroBaselineRise=true';
  }
  if (config.suppressZeroBaselineLatency) {
    line += ' suppressZeroBaselineLatency=true';
  }
  if (config.capTrendBonusAtDeviation) {
    line += ' capTrendBonusAtDeviation=true';
  }
  // Ships `true`, so the pole worth printing is the one an ABLATION chooses — the inverse of its neighbours
  // above, and the reason this line's rule is "print the non-shipped value" rather than "print what is true".
  if (!config.suppressDemandMetrics) {
    line += ' suppressDemandMetrics=false';
  }
  // APPENDED at the very end, and printed only when it is NOT the shipped pole, because the scope is a PAIR with
  // `selfTimeWeight` and the weight's own field is unconditional. `absolute` is the arm every published line already
  // carries, so printing it unconditionally would make every artifact on record disagree with the code that
  // produced it — a cost with no reader's benefit, since the field is still reachable on the artifact the moment a
  // dispatch states `fleet`. `docs/self-time-share.md` §6 refused the absolute arm; a `fleet` line is the only
  // thing that can distinguish that arm from the repair built on top of it.
  // Appended only off the shipped pole, on the same rule as `selfTimeScope`: the published artifacts must stay
  // byte-identical, and a token that repeated the default on every line would be a value no run varies.
  if (config.stabilityScope !== DEFAULT_STABILITY_SCOPE) {
    line += ` stabilityScope=${config.stabilityScope}`;
  }
  if (config.selfTimeScope !== DEFAULT_SELF_TIME_SCOPE) {
    line += ` selfTimeScope=${config.selfTimeScope}`;
  }
  return line;
}

/**
 * Build the structured summary for one run.
 *
 * Pure: it takes every number and the whole configuration, and derives only the
 * per-cell `top1` ratios. The fault-type cells are sorted by descending `total`
 * (then by name, so the order is total) because the artifact is diffed between
 * runs and an insertion-order map would make the JSON churn.
 *
 * @param input - Run configuration, headline metrics and per-fault-type cells.
 * @returns The summary object, ready to serialise.
 */
export function buildFSE26Report(input: FSE26ReportInput): FSE26Report {
  const cells = [...input.perFaultType.entries()].sort((a, b) => {
    if (b[1].total !== a[1].total) return b[1].total - a[1].total;
    return a[0] < b[0] ? -1 : 1;
  });

  const perFaultType: Record<string, FSE26FaultCell & { top1: number }> = {};
  for (const [faultType, cell] of cells) {
    perFaultType[faultType] = {
      total: cell.total,
      correct: cell.correct,
      top1: cell.total > 0 ? cell.correct / cell.total : 0,
    };
  }

  return {
    dataset: 'fse26',
    anchor: input.anchor,
    config: input.config,
    cases: input.cases,
    top1: input.top1,
    top3: input.top3,
    top5: input.top5,
    deltaVsSotaAvg: input.top1 - input.anchor.sotaAvgTop1,
    loadErrors: input.loadErrors,
    engineErrors: input.engineErrors,
    emptyGraphs: input.emptyGraphs,
    perFaultType,
  };
}
