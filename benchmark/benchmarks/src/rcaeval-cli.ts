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
 *     run-rcaeval.ts  --log-signal-mode <count|novelty|logicHttp|logicHttpJoint|logicHttpDominant|all>
 *
 * `run-rcaeval.ts --log-mode novelty` is a request this runner cannot honour, and the run it
 * produced was indistinguishable from one asked for `--log-signal-mode count`. It now throws and
 * names the token, which is the only part of the input the parser is certain about.
 *
 * ## The vocabulary is the UNION's, and it used to be narrower here
 *
 * The second line above read `<count|novelty>` until this iteration. The engine's
 * `LogSignalMode` has six members and implements all six, the loader classifies every line it
 * needs (`isLogicException`, `isHttpException`, `isStackTrace`), and the FSE'26 parser accepted
 * all six — but this parser tested `mode === 'novelty'` and wrote `count` for everything else.
 * So `--log-signal-mode all` ran `count` and printed a confident number, which is the defect
 * `fse26-cli.ts` records closing on its own side and the reason `all` had never been measured:
 * it was not merely undispatched on this half, it was UNEXPRESSIBLE. The parse now consults the
 * shared guard beside the union (`packages/tree`, `isLogSignalMode`).
 *
 * @module benchmarks/rcaeval-cli
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { TopoDiscountScope } from '../../packages/tree/src/causal/topology-fault-graph.js';
import {
  DEFAULT_TOPO_DISCOUNT_SCOPE,
  isTopoDiscountScope,
} from '../../packages/tree/src/causal/topology-fault-graph.js';
import type { OnsetShape } from '../../packages/tree/src/pruning/pruner.js';
import {
  DEFAULT_COLLISION_WEIGHT,
  DEFAULT_DUAL_FAMILY_GATE,
  DEFAULT_DUAL_FAMILY_GATE_MODE,
  DEFAULT_DUAL_FAMILY_WEIGHT,
  DEFAULT_FAILED_EDGE_GATE_MODE,
  DEFAULT_FAILED_EDGE_GATE_SHARE,
  DEFAULT_FAILED_EDGE_WEIGHT,
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_LOG_SIGNAL_MODE,
  DEFAULT_LOG_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_PRISM_WEIGHT,
  DEFAULT_SELF_ANOMALY_WEIGHT,
  DEFAULT_SELF_TIME_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  DEFAULT_TOPO_DISCOUNT,
  DEFAULT_TOPO_DISCOUNT_GATE,
  DEFAULT_TOPO_WEIGHT,
  DEFAULT_TRACE_WEIGHT,
  DEFAULT_VICTIM_WEIGHT,
  type DualFamilyGateMode,
  type FailedEdgeGateMode,
  isDualFamilyGateMode,
  isFailedEdgeGateMode,
  isOnsetShape,
} from '../../packages/tree/src/pruning/pruner.js';

import { SERVICE_FIELD_DECIMALS } from '../../packages/kinetic/src/benchmarks/fse26-diagnose.js';
import type {
  BaselineAnchor,
  DropDeviationMode,
  LogSignalMode,
  PoolAdmission,
  PrismPooling,
  TopoClosure,
  TopoPrecedence,
} from '../../packages/tree/src/index.js';
import {
  ANOMALY_NORMALIZE_NODE_THRESHOLD,
  DEFAULT_ANOMALY_BREADTH_GATE,
  DEFAULT_ANOMALY_BREADTH_WEIGHT,
  DEFAULT_ANOMALY_BURST_WEIGHT,
  DEFAULT_ANOMALY_CV_WEIGHT,
  DEFAULT_ANOMALY_TREND_WEIGHT,
  DEFAULT_BASELINE_ANCHOR,
  DEFAULT_CAP_TREND_BONUS_AT_DEVIATION,
  DEFAULT_COLLAPSE_DISCOUNT,
  DEFAULT_DROP_DEVIATION_MODE,
  DEFAULT_METRIC_RISE_CEILING,
  DEFAULT_POOL_ADMISSION,
  DEFAULT_PRISM_POOLING,
  DEFAULT_RANK_NORMALIZATION,
  DEFAULT_SUPPRESS_DEMAND_METRICS,
  DEFAULT_SUPPRESS_IDLE_TRANSIENTS,
  DEFAULT_SUPPRESS_NEAR_ZERO_BASELINE_RISE,
  DEFAULT_SUPPRESS_ZERO_BASELINE_LATENCY,
  DEFAULT_TOPO_CLOSURE,
  DEFAULT_TOPO_PRECEDENCE,
  DEFAULT_TRACE_SKIPS_LEADER,
  isBaselineAnchor,
  isDropDeviationMode,
  isLogSignalMode,
  isPoolAdmission,
  isPrismPooling,
  isTopoClosure,
  isTopoPrecedence,
} from '../../packages/tree/src/index.js';

import {
  hasValue,
  parseFieldDecimals,
  parseNodeCount,
  parseUnitInterval,
  parseWeight,
} from './cli-args.js';
// The view union, from the module that OWNS the three views. A `type` import would leave the guard
// unimported, and a guard restated here would be a second answer to "is this a view" — the defect
// `--prism-pooling` was repaired for, moved to the third vocabulary on this surface.
import { DEFAULT_LATENCY_SOURCE, isLatencySource, type LatencySource } from './rcaeval-corpus.js';

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
   * Which view of `edgeLatency` the corpus carries — i.e. which corpus the engine ranks on.
   *
   * A CORPUS property rather than a ranking one (`rcaeval-corpus.ts`'s own classification), which is why it
   * is NOT on the engine's option objects and why the configuration line does not name it: that line's
   * membership is held, in both directions, to the options the engine's constructor receives.
   *
   * It is on THIS surface for the reason the `--prism-pooling` flag was enrolled: the shipped view's
   * `edgeLatency` is an empty array, so `latWeight` — the largest weight in the ranking — multiplies nothing
   * in every published cell, and the axis that could supply it was reachable only from the ablation runner,
   * whose numbers are the all-flags-off battery rather than the nine cells the kill criterion judges. A
   * candidate measurable on one instrument and judged on another has an undecidable other half.
   *
   * The default is the SHIPPED view, so a bare dispatch reproduces the published cells exactly.
   */
  latencyView: LatencySource;
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
   * which is why the golden stayed byte-identical while the term was enrolled behind the engine's
   * constant — and why a re-measurement of the term on THIS benchmark is reached by dispatching
   * this input rather than by changing the engine's default. The value is the engine's criterion
   * intersection, and deliberately NOT the `0.03017` the FSE'26-only screen solved for: that point
   * was REJECTED for moving four of the nine golden cells, one of them by 15.8pp.
   */
  stabilityWeight: number;
  /**
   * Strength of the SELF-TIME prior: the share of a service's own latency rise that no callee can
   * explain.
   *
   * Read from {@link DEFAULT_SELF_TIME_WEIGHT}, which is 0 — the term is OFF until a measurement
   * enrols it. This runner is the golden 9-cell, so the weight a dispatch states here is the only
   * way the term can be measured on the half that decides the goal: on RCAEval RE1 the mechanism it
   * targets is the one `docs/transient-guard-window.md` §4 named, a CALLER's `latency-90` (25.89×)
   * outranking the truth's `cpu` (14.35×) because a caller's response time contains its callees'.
   */
  selfTimeWeight: number;
  /**
   * Weight on the BASE term — the candidate's own anomaly, `log1p(anomaly(v))` (see
   * `TreePrunerOptions.selfAnomalyWeight`).
   *
   * The one coefficient in the score that is a quantity of the model rather than a prior over it, and until it
   * was named here it was the one coefficient no arm could state. It travels in the packed `anomaly_knobs`
   * block as `selfanom=<weight>` for the same reason `victim` and `selftime` do: the golden half's 25-input
   * budget is full.
   */
  selfAnomalyWeight: number;
  /**
   * Weight on the internal/external SYMMETRY MASK — PRISM's axiom as a bounded discount on a candidate's
   * own evidence (see `TreePrunerOptions.victimWeight`).
   *
   * Read from {@link DEFAULT_VICTIM_WEIGHT}, which is 0. There is no `workflow_dispatch` input of its own
   * because the golden half's 25-input budget is full — the same constraint the self-time term works
   * under — so it travels in the packed `anomaly_knobs` block as `victim=<weight>`.
   */
  victimWeight: number;
  /**
   * Weight on the DUAL-FAMILY presence bonus — PRISM's shape test as a bounded 0/1 indicator rather than as an
   * imported score (see `TreePrunerOptions.dualFamilyWeight`).
   *
   * The blocking cell's defect is a RANK distance: the truth sits at median rank 33 of 68 on RE3-TrainTicket
   * while the same engine puts the same corpus's truth at rank 2 and 9 on the other two suites, so a lever has
   * to lift one candidate 32 places without lifting the 32 above it. The only thing that has ever reached this
   * cell is a SHAPE test, and a membership cannot claim more than its weight.
   */
  dualFamilyWeight: number;
  /**
   * The share of the fleet's strongest dual signal a component must reach to be a family member
   * (see `TreePrunerOptions.dualFamilyGate`).
   *
   * The weight above buys a bonus; this chooses who is paid it. A membership is a constant, so a family that
   * covers most of a cell cannot re-order that cell — measured as the split between RE3-SockShop (14
   * candidates, 15 → 18) and RE3-TrainTicket (68, unchanged). Travels in the packed `anomaly_knobs` block as
   * `dualfamgate=<share>` because the golden half's 25-input budget is full.
   */
  dualFamilyGate: number;
  /**
   * WHICH fleet-relative comparison the gate applies — `min` (shipped) or `channel`
   * (see `TreePrunerOptions.dualFamilyGateMode`).
   *
   * The distinction is a property of the FLEET: `max min(Sⁱ,Sᵉ)` can never exceed `min(max Sⁱ, max Sᵉ)` and on a
   * fleet whose extremes live in different components it falls far below it, so the `min` bar is loose exactly
   * where the fleet is heterogeneous. `channel` gives each family its own champion — PRISM's own per-family
   * normalisation. Travels in the packed `anomaly_knobs` block as `dualfamgatemode=<min|channel>`; ships at `channel`.
   */
  dualFamilyGateMode: DualFamilyGateMode;
  /**
   * Strength of the per-edge LATENCY-rise term, the largest of the shipped ranking weights.
   *
   * Read from {@link DEFAULT_LAT_WEIGHT} for the reason `stabilityWeight` is, and with a second one
   * on top of it: this value is not merely a copy that could drift, it was previously **absent from
   * this runner entirely**. The golden artifact therefore rendered its configuration without the
   * weight that carries the largest part of the ranking — `latWeight=0.561495` with
   * {@link DEFAULT_LAT_MIN_RISE} is a PAIR measured at +56 cases across 10 fault types with none
   * regressed — and a reader reconstructing the golden's configuration from its own artifact could
   * not state it. Naming the constant puts it on the line the artifact carries.
   */
  latWeight: number;
  /**
   * The rise a service must clear before the latency term credits it (see {@link DEFAULT_LAT_MIN_RISE}).
   *
   * Carried beside the weight rather than folded into it because the two are ONE measured
   * configuration: the floor is not safe on its own (at the previous weight of 0.03 it costs 6 cases
   * across 6 fault types) and the weight's zero-regression window ends far below the shipped value
   * without it. An artifact that named one and not the other would describe a configuration nobody
   * ran.
   */
  latMinRise: number;
  /**
   * Strength of the failed-edge DIRECTION term — the callee of a failed call is the candidate.
   *
   * Read from {@link DEFAULT_FAILED_EDGE_WEIGHT} (0), which is why the field looks inert, and it is here for
   * the opposite reason: the term has a MEASURED gate in the engine (`admitsFailedEdgeTerm` — +42 on FSE'26
   * with zero regressed fault types, ported in iteration 123), and until this field existed **no dispatch could
   * state a weight for the golden half of the kill criterion**. The criterion is an AND over two benchmarks, so
   * a knob one half can vary and the other cannot leaves the other half undecidable — the same seam
   * `latWeight`, `latMinRise` and `poolMetricPenaltyWeight` were repaired for, found the same way.
   *
   * The term's second half reads `edgeLatency`, so a weight here is only interpretable BESIDE the corpus view:
   * on the shipped view that array is empty on every RCAEval cell and the gate cannot fire. The runner prints
   * `direction-gate[...]` beside the latency census for exactly that reason.
   */
  failedEdgeWeight: number;
  /**
   * Which BAR the direction term's rise is read against — `absolute` (shipped) or `fleet`
   * (see `TreePrunerOptions.failedEdgeGateMode`).
   *
   * The absolute bar is 300 and was fitted on FSE'26, where an injection adds hundreds of milliseconds to a
   * sub-millisecond baseline. The golden corpus's latencies are SECONDS, so its rank-1 rises are 1.2–8 and **no
   * case can reach the bar** — the term reads `WEIGHT_ZERO` on 734 of 735 cases, which is the shape of a refusal
   * and not of a measurement. The fleet bar is the same statement without the corpus in it (`share × this case's
   * own champion`, the construction `anomalyBreadthGate` and `dualFamilyGate` already use), so this field is what
   * makes the term EXPRESSIBLE on the half the kill criterion is measured on.
   *
   * Named unconditionally on the configuration line: at `absolute` the option is inert, and an omitted-when-
   * default rule would render the fleet arm and the shipped run identically on the artifact whose whole job is to
   * attribute the difference. Travels in the packed `anomaly_knobs` block as `failededgegate=<absolute|fleet>`
   * because a `workflow_dispatch` accepts at most 25 inputs and this workflow is at that budget.
   */
  failedEdgeGateMode: FailedEdgeGateMode;
  /**
   * The share of the case's own champion the rank-1 rise must clear, read only at `failedEdgeGateMode: 'fleet'`
   * (see `TreePrunerOptions.failedEdgeGateShare`).
   *
   * A share rather than a rise, because a rise is only comparable inside the corpus that produced it: at 1 the
   * gate admits only the case's own largest rise, at 0 every measured rise. Travels as
   * `failededgegateshare=<share>` beside the mode — the two are one configuration, and an artifact that named one
   * without the other would describe a bar nobody read.
   */
  failedEdgeGateShare: number;
  /**
   * Strength of the DB-connection-pool dominance penalty (see
   * {@link DEFAULT_POOL_METRIC_PENALTY_WEIGHT}).
   *
   * Read from the constant for the same reason as the two above, and it is the third field this
   * runner used to inherit in silence: the penalty is +6 cases with zero regressed fault types, so
   * the artifact must be able to say whether a run applied it.
   */
  poolMetricPenaltyWeight: number;
  /** Strength of the collision-energy signal (penalise upstream-inherited energy). */
  collisionWeight: number;
  /** Strength of the topological-source signal (reward no-anomalous-parent nodes). */
  topoWeight: number;
  /** Topological deduction strength (0 = off; see `TreePrunerOptions.topoDiscount`). */
  topoDiscount: number;
  /**
   * Which channels the topological deduction may act on (see `TopoDiscountScope`).
   *
   * A field of its own rather than a second meaning for the weight, because the two answer different
   * questions and a run that changes one must still be able to say which the other was: the weight says HOW
   * MUCH of an explained anomaly is deducted, the scope says WHICH anomalies a callee is allowed to explain.
   */
  topoDiscountScope: TopoDiscountScope;
  /**
   * The smallest share of a node's anomaly its callees must account for before the deduction may charge
   * it (see `TreePrunerOptions.topoDiscountGate`). 0 = no gate, which is the shipped operator.
   */
  topoDiscountGate: number;
  /**
   * How the deduction's explanation is aggregated over a caller's callees (see `TopoClosure`).
   *
   * The axis `docs/topo-share.md` §11 asked for: the rank-2 band's largest single group is a node that CALLS
   * everything and is called by nothing, whose anomaly is an aggregate of its fan-out — a maximum over the
   * callees cannot reach it, a sum can. `max` is the shipped reading and every published number was measured
   * under it.
   */
  topoClosure: TopoClosure;
  /**
   * Whether a call boundary may carry a movement BACKWARDS in time (see `TopoPrecedence`).
   *
   * `off` is the shipped reading and the identity: the deduction never read an onset. `onset` withholds an
   * edge from a caller's explanation when the callee's onset is strictly later than the caller's, and the
   * population it is for is counted rather than argued — six of the corpus's ninety-four misses on battery
   * `41188083576` are truths that had moved (0.73 to 1.87 in deviation space) and were deleted by a deduction
   * that found a louder callee one hop away (`docs/topo-precedence.md`).
   */
  topoPrecedence: TopoPrecedence;
  /**
   * Which SET of nodes the ranking may answer with (see `PoolAdmission`).
   *
   * A field of its own rather than a hard-wired filter, because the filter is a decision: the ranking admits
   * only nodes whose post-deduction anomaly is positive, so a node the deduction explains in full is ABSENT
   * rather than last, and twelve published misses are a truth of that shape. `positive` is what every published
   * number ran under; `graph` admits the whole graph and is the arm `docs/topo-discount-scope.md` §7.4 names.
   */
  poolAdmission: PoolAdmission;
  /** Strength of the log signal (reward post-injection ERROR/FATAL volume). */
  logWeight: number;
  /**
   * Log signal scoring mode.
   *
   * The ENGINE's union, not a subset of it. This option used to be typed
   * `'count' | 'novelty'` and parsed with `mode === 'novelty' ? 'novelty' : 'count'`, so the
   * other four members of {@link LogSignalMode} — `logicHttp`, `logicHttpJoint`,
   * `logicHttpDominant` and `all` — were silently replaced by `count`. That is the same
   * defect `fse26-cli.ts` records having closed on its own side ("a list of names cannot be
   * checked against a union"), left open here; the parse now consults the shared
   * `isLogSignalMode`, and an unrecognised token still falls back to
   * {@link DEFAULT_LOG_SIGNAL_MODE} rather than inventing a configuration.
   */
  logSignalMode: LogSignalMode;
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
   * Which of PRISM's two combination functions the PRISM signal is built with.
   *
   * `additive` (the paper's default, and the shipped one) and `conjunctive` are not close variants:
   * the controlled head-to-head (`docs/prism-head-to-head.md`) reads `additive` at 78.9% overall while
   * `conjunctive` resolves the code-level block — **RE3 TrainTicket 76.7% against `additive`'s 33.3%**,
   * on the weakest cell of the published nine (51.1%). The engine accepted no pooling at all until this
   * iteration, so the second column of that table was reproducible only by the standalone evaluator.
   *
   * Inert while {@link prismWeight} is 0, which is the shipped value and the reason this flag cannot
   * move a published number on its own. Read from {@link DEFAULT_PRISM_POOLING} rather than restated.
   */
  prismPooling: PrismPooling;
  /**
   * Direction-aware deviation: discount the DROP component of a metric's
   * deviation by this factor (0 = symmetric, 1 = ignore drops entirely). A
   * traffic-loss collapse (symptom) is discounted so it cannot out-rank an
   * equivalent rise (source). Opt-in; default 0.
   */
  collapseDiscount: number;
  /**
   * The largest ratio ONE metric's deviation may reflect (`0` = unbounded).
   *
   * Exposed on this half because the axis it belongs to — how a DROP becomes a deviation — is a PAIR, and a
   * pair measurable on one half only has an undecidable other half. It had been FSE'26-only, so the golden
   * half could not state the value every published number ran at.
   */
  metricRiseCeiling: number;
  /**
   * How a metric's DROP becomes a deviation (`bounded` = shipped, `log` = symmetric with a rise).
   *
   * The blocking cell's defect: RE3-TrainTicket's truth is a `socket` drop (18 → 11) against victims whose
   * latency sits at `dev` 1.2–2.9, and the bounded form caps a drop at `log10(2) = 0.301` while a rise is
   * unbounded. `log` makes a 10× drop score what a 10× rise scores — and it is the form #193 reverted, which
   * is why it is only meaningful together with `metricRiseCeiling`.
   */
  dropDeviationMode: DropDeviationMode;
  /**
   * Which WINDOW a metric's deviation is measured between (`whole-file` = shipped, `pre-injection` = the
   * post-injection excursion over the pre-injection level).
   *
   * Not a lever and not a weight: the formula is untouched, and what moves is the pair of segments the same
   * `log10(1 + ratio)` reads. `docs/baseline-anchor.md` records the defect it addresses — a series that opens
   * with a container warm-up has its baseline AND its maximum taken from that warm-up — and the arm that
   * measured it on the nine cells.
   */
  baselineAnchor: BaselineAnchor;
  /**
   * Rank-based anomaly-score normalization on large topologies. Robust to a
   * single near-zero-baseline outlier that would otherwise stretch the min-max
   * range. SHIPPED ON (`DEFAULT_RANK_NORMALIZATION`) — the register keeps the axis on, and this
   * comment said "Opt-in; default false" after both had stopped being true.
   */
  rankNormalization: boolean;
  /**
   * The node count at or above which the rescale runs at all — `rankNormalization`'s POPULATION.
   *
   * Separate from the flag because it decides WHICH cases the flag can act on, and on this corpus that is
   * most of them: 487 of the 735 cases are below the shipped 20 (OnlineBoutique and SockShop), so the flag
   * is not read there and no run can have measured it. Dispatchable so the population stops being a
   * constant, and printing it so an artifact says which population it describes.
   */
  anomalyNormalizeNodeThreshold: number;
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
   * Discard a TRANSPORT channel (a latency percentile) whose head window has no level.
   *
   * The RE3-TrainTicket lever, measured from the acceptance artifact: the winning service's decisive channel
   * is `latency-90` at `head=[0,0,0,0,0,0]` and `tail=[0.0235, …]` — a 764× "rise" that is the arrival of
   * traffic, not slowness — against a truth whose own evidence is a `socket` drop. Read from
   * {@link DEFAULT_SUPPRESS_ZERO_BASELINE_LATENCY}, which is `false` until a dispatch measures it.
   */
  suppressZeroBaselineLatency: boolean;
  /**
   * Cap the TREND bonus at the deviation it augments.
   *
   * The RE3-TrainTicket lever of iteration 138's diff: the winner after the zero-baseline guard scored
   * `latency-90` 2.35 → 0.021 (a collapse, `dev=0.301`) with a **trend bonus of 0.661** — an amplifier
   * larger than the signal it amplifies, which can only happen on the collapse side because a drop's
   * deviation is capped at `log₁₀(2)`. `false` until a dispatch measures it.
   */
  capTrendBonusAtDeviation: boolean;
  /**
   * Whether the trace vote is withheld from the cell's anomaly LEADER — see
   * `TreePrunerOptions.traceSkipsLeader`.
   *
   * The vote is right three times in four on the blocking cell (`[trace-vote] votes=20 hits=15`), ALL five wrong
   * votes became the top-1, and removing the term costs ten cases — so the refinement is WHO is paid, not how
   * much. Inert at `traceWeight = 0`, so a suite without the pin cannot see it. Travels in the packed
   * `anomaly_knobs` block as `traceskipsleader=1|0`.
   */
  traceSkipsLeader: boolean;
  /**
   * Whether a DEMAND metric (`workload` — how much work a service was HANDED) may be a node's decisive
   * evidence. Shipped `true` since iteration 127, on the measurement `docs/rcaeval-local-harness.md` carries:
   * the family is decisive for 4.0% of ground truths against 12.5% of bystanders, and removing it takes
   * RE1-OnlineBoutique 100/125 → 103/125 with zero regressed fault types.
   *
   * The flag exists in the NEGATIVE (`--no-suppress-demand-metrics`) for the reason `no_rank_normalization`
   * does: the shipped pole is the one an artifact must be able to reproduce without an input, and the
   * ablation is the value worth typing.
   */
  suppressDemandMetrics: boolean;
  /**
   * Weight of the TREND bonus in the anomaly composition — `deviation + trend + burst + cv`.
   *
   * These three coefficients ARE the RCAEval RE1 ranking: on that population every other term is
   * `WEIGHT_ZERO` or `INPUT_MAP_EMPTY` on all 374 analysable cases, so the published RE1 number is this
   * composition plus a `0.007352` tie-break. They had never been named in the artifact or reachable from
   * a dispatch. Defaults are the shipped 0.15 / 0.1 / 0.05; a weight above the engine's bound of 10 is
   * refused at graph build rather than clamped here, because that is the only place that knows the bound.
   */
  anomalyTrendWeight: number;
  /** Weight of the BURST bonus (`deviation × w` on any sample above `mean + 3σ`). Default 0.1. */
  anomalyBurstWeight: number;
  /** Weight of the CV bonus (`min(cv, 1.5) × w` on `cv > 0.5`). Default 0.05. */
  anomalyCvWeight: number;
  /**
   * Weight of the BREADTH term — the effective number of a service's channels that moved, minus one.
   *
   * The aggregation elsewhere is a `max`, which cannot tell three moving channels from one; on RCAEval that
   * is the shape of the 26 one-step misses. Default 0 = OFF (bit-identical to the shipped ranking).
   */
  anomalyBreadthWeight: number;
  /**
   * CONTENDER gate for the breadth term: the bonus is paid only to nodes whose own deviation is at least
   * this fraction of the fleet's largest (0 = no gate, the shipped value).
   *
   * The gate exists because the UNGATED term's two halves disagree: +11 cases on RCAEval with no cell down,
   * but +7 Top@1 and −6 Top@5 on FSE'26 — the shape of a bonus paid to non-contenders. Accepts 0..1; a
   * value outside falls back to the shipped 0 rather than being clamped, because a fraction outside the
   * unit interval is a different quantity (the rule `--topo-discount` recorded).
   */
  anomalyBreadthGate: number;
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
  /**
   * When set, write the per-case LOSS CENSUS to this path, one JSON object per line.
   *
   * One line per case of EVERY group the invocation covers, correct cases included — deliberately not a
   * sample of the failures. The benchmark already prints failure diagnostics, but it prints the first few
   * per fault type, so a decomposition computed from them would be a decomposition of a sample, and a
   * conclusion may not rest on one. This artifact is the census instead: the same question asked of every
   * case, so the split it reports is about the population that produced the accuracy.
   *
   * The fields are the split itself: the size of the candidate pool the ranker chose from, whether the
   * ground truth is a member of it, and the truth's rank in the FULL ranking. A truth outside the pool is a
   * RETRIEVAL failure no ranking can recover; a truth inside it and placed second is a RERANKING failure.
   * The published accuracy cannot tell those apart, which is why the artifact exists.
   *
   * Empty means "do not write one": the flag allocates the file, not the runner.
   */
  lossCensus: string;
}

export function parseRCAEvalArgs(args: readonly string[]): CliOptions {
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCAEval-json'),
    maxCases: 0,
    system: 'all',
    suite: 'all',
    // From the corpus owner, so this runner cannot describe a corpus the assembler does not have: the three
    // views are its union, and a literal here would be a second owner of the value the published nine cells
    // were measured with. Inert on RE1, which carries no spans in any view.
    latencyView: DEFAULT_LATENCY_SOURCE,
    noInjectTime: false,
    temporalWeight: DEFAULT_TEMPORAL_WEIGHT,
    onsetShape: DEFAULT_ONSET_SHAPE,
    stabilityWeight: DEFAULT_STABILITY_WEIGHT,
    selfTimeWeight: DEFAULT_SELF_TIME_WEIGHT,
    selfAnomalyWeight: DEFAULT_SELF_ANOMALY_WEIGHT,
    victimWeight: DEFAULT_VICTIM_WEIGHT,
    dualFamilyWeight: DEFAULT_DUAL_FAMILY_WEIGHT,
    dualFamilyGate: DEFAULT_DUAL_FAMILY_GATE,
    dualFamilyGateMode: DEFAULT_DUAL_FAMILY_GATE_MODE,
    // The three terms the golden half used to inherit without naming. They are read from the
    // engine's own constants, so this runner cannot describe a configuration the engine does not
    // ship, and they are threaded by `buildRCAEvalEngineOptions` so the artifact states them.
    latWeight: DEFAULT_LAT_WEIGHT,
    latMinRise: DEFAULT_LAT_MIN_RISE,
    // The direction term's shipped weight, from the engine's own constant. 0 is what every published cell ran
    // with, so a bare dispatch still reproduces them; a non-zero value is the measurement this runner gained.
    failedEdgeWeight: DEFAULT_FAILED_EDGE_WEIGHT,
    // The bar that weight is read against, from the engine's own constants. `absolute` is the bar the weight was
    // measured under on FSE'26, so a bare dispatch still reproduces it; the goldens' units are why a dispatch has
    // to be able to name the other one.
    failedEdgeGateMode: DEFAULT_FAILED_EDGE_GATE_MODE,
    failedEdgeGateShare: DEFAULT_FAILED_EDGE_GATE_SHARE,
    poolMetricPenaltyWeight: DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
    collisionWeight: DEFAULT_COLLISION_WEIGHT,
    topoWeight: DEFAULT_TOPO_WEIGHT,
    topoDiscount: DEFAULT_TOPO_DISCOUNT,
    topoDiscountScope: DEFAULT_TOPO_DISCOUNT_SCOPE,
    topoDiscountGate: DEFAULT_TOPO_DISCOUNT_GATE,
    topoClosure: DEFAULT_TOPO_CLOSURE,
    topoPrecedence: DEFAULT_TOPO_PRECEDENCE,
    poolAdmission: DEFAULT_POOL_ADMISSION,
    logWeight: DEFAULT_LOG_WEIGHT,
    // From the ENGINE's owner, not from a local copy of it: this runner needs the value in two places (the
    // default a bare dispatch resolves to, and the fallback for a mode the guard rejects), and it used to
    // carry a local alias for that — `DEFAULT_RCAEVAL_LOG_SIGNAL_MODE`, one line of `= DEFAULT_LOG_SIGNAL_MODE`
    // and a second NAME for one value. The census reads a name by resolving it, so an alias is not an owner;
    // the alias is gone and both sites read this one.
    logSignalMode: DEFAULT_LOG_SIGNAL_MODE,
    collapseDiscount: DEFAULT_COLLAPSE_DISCOUNT,
    metricRiseCeiling: DEFAULT_METRIC_RISE_CEILING,
    dropDeviationMode: DEFAULT_DROP_DEVIATION_MODE,
    baselineAnchor: DEFAULT_BASELINE_ANCHOR,
    // Named rather than a literal, and this site is WHY the census exists: `traceWeight` had a constant and
    // a guarded description while the field default the no-flag path resolves to still wrote `0`. The
    // fallback below and this default are two answers to one question, and a guard that reads only the
    // fallback cannot see them disagree. See `docs/ranking-default-owners.md`.
    traceWeight: DEFAULT_TRACE_WEIGHT,
    prismWeight: DEFAULT_PRISM_WEIGHT,
    // From the owner, not a literal: the engine's own constructor default is the same constant, so this
    // runner cannot describe a pooling the engine does not ship. Inert at `prismWeight = 0`.
    prismPooling: DEFAULT_PRISM_POOLING,
    // Rank/quantile normalization of per-service anomaly scores is the default:
    // it is robust to a single near-zero-baseline symptom spike that would
    // otherwise set the min-max range max and crush the genuine source toward
    // ~0. Monotonic, so it is a no-op on small graphs (<20 nodes) and whenever
    // traceWeight is 0; it only materialises when a downstream causal signal
    // (trace/topo) can exploit the compressed anomaly gap.
    // Read from the engine's owner rather than restated: this parser and the FSE'26 one both carried a
    // literal `true` while the engine's own default was `false`, which is three owners of one shipped value.
    rankNormalization: DEFAULT_RANK_NORMALIZATION,
    // …and the population it acts on, from the same owner, for the same reason. Named on the artifact even
    // when it holds its default: this one decides which CASES the flag above can reach, so an omitted value
    // would leave a reader unable to tell a run that measured the flag from one that never consulted it.
    anomalyNormalizeNodeThreshold: ANOMALY_NORMALIZE_NODE_THRESHOLD,
    suppressIdleTransients: DEFAULT_SUPPRESS_IDLE_TRANSIENTS,
    suppressNearZeroBaselineRise: DEFAULT_SUPPRESS_NEAR_ZERO_BASELINE_RISE,
    suppressZeroBaselineLatency: DEFAULT_SUPPRESS_ZERO_BASELINE_LATENCY,
    capTrendBonusAtDeviation: DEFAULT_CAP_TREND_BONUS_AT_DEVIATION,
    traceSkipsLeader: DEFAULT_TRACE_SKIPS_LEADER,
    suppressDemandMetrics: DEFAULT_SUPPRESS_DEMAND_METRICS,
    anomalyTrendWeight: DEFAULT_ANOMALY_TREND_WEIGHT,
    anomalyBurstWeight: DEFAULT_ANOMALY_BURST_WEIGHT,
    anomalyCvWeight: DEFAULT_ANOMALY_CV_WEIGHT,
    anomalyBreadthWeight: DEFAULT_ANOMALY_BREADTH_WEIGHT,
    anomalyBreadthGate: DEFAULT_ANOMALY_BREADTH_GATE,
    fusionCeiling: '',
    routingProbe: '',
    diagnoseDump: '',
    diagnoseDecimals: SERVICE_FIELD_DECIMALS,
    lossCensus: '',
  };
  /**
   * The first `--log-signal-mode` this command line stated, and what it resolved to.
   *
   * A SECOND statement of the flag is not a repetition to be collapsed, because the two can
   * disagree — and one of them does, in the workflow this runner is driven by. The RE3 job runs
   * its `novelty` reference as `run-rcaeval.ts … --log-signal-mode novelty "${RANKING_ARG[@]}"`,
   * and `RANKING_ARG` carries `--log-signal-mode "${{ inputs.log_signal_mode }}"`. With the last
   * occurrence winning, a dispatch asking for `all` ran `all` inside the step whose entire purpose
   * is the `novelty` reference, and the artifact is still uploaded as
   * `rcaeval-re3-novelty-results.txt` — the same failure as the `count` → `logicHttp` fallback this
   * chain was closed for, with the roles of "request" and "default" exchanged.
   *
   * Both values are kept: the RAW token, because a value that is not a mode resolves to the
   * default and the dispatcher needs to see what they typed, and the RESOLVED mode, because that
   * is what two statements actually conflict about.
   */
  let statedLogSignalMode: { raw: string; mode: LogSignalMode } | undefined;

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
    else if (args[i] === '--self-time-weight' && hasValue(args, i + 1))
      opts.selfTimeWeight = parseWeight(args[++i]!, DEFAULT_SELF_TIME_WEIGHT);
    else if (args[i] === '--self-anomaly-weight' && hasValue(args, i + 1))
      opts.selfAnomalyWeight = parseWeight(args[++i]!, DEFAULT_SELF_ANOMALY_WEIGHT);
    else if (args[i] === '--victim-weight' && hasValue(args, i + 1))
      opts.victimWeight = parseWeight(args[++i]!, DEFAULT_VICTIM_WEIGHT);
    else if (args[i] === '--dual-family-weight' && hasValue(args, i + 1))
      opts.dualFamilyWeight = parseWeight(args[++i]!, DEFAULT_DUAL_FAMILY_WEIGHT);
    // A SHARE, so it takes the unit-interval parser rather than the weight parser: 1.5 is not a member
    // share and a negative one is not a gate.
    else if (args[i] === '--dual-family-gate' && hasValue(args, i + 1))
      opts.dualFamilyGate = parseUnitInterval(args[++i]!, DEFAULT_DUAL_FAMILY_GATE);
    else if (args[i] === '--dual-family-gate-mode' && hasValue(args, i + 1)) {
      // The union's own guard, not a hand-written pair — the `--prism-pooling` rule. An unusable value falls
      // back to the SHIPPED mode: a typo must reproduce a published configuration rather than invent one.
      const mode = args[++i]!;
      opts.dualFamilyGateMode = isDualFamilyGateMode(mode) ? mode : DEFAULT_DUAL_FAMILY_GATE_MODE;
    }
    // ── The three the artifact NAMED before any command line could set them ──
    //
    // All three are declared in `CliOptions`, defaulted from the engine's own constants, forwarded to the
    // engine's constructor and printed on every artifact's configuration line — and none of them had a
    // branch here, so the line asserted a configuration no invocation could state. The golden half of the
    // kill criterion is read from that line, which is why this is a defect and not an omission: a candidate
    // that moves the largest weight in the ranking had an undecidable other half, exactly as the `logWeight`
    // dispatch input records about the REJECTED temporal candidate.
    //
    // Each mirrors the FSE'26 runner's arm for the same flag, SPELLING INCLUDED, so one value means one
    // thing in both workflows — the rule the `no_rank_normalization` input states for its own pole.
    else if (args[i] === '--lat-weight' && hasValue(args, i + 1))
      // Falls back to the SHIPPED weight, not to 0: `--lat-weight 0` is a MEASURED configuration (the
      // latency term switched off), so a typo must reproduce the published one rather than run that
      // experiment under the published configuration's name.
      opts.latWeight = parseWeight(args[++i]!, DEFAULT_LAT_WEIGHT);
    else if (args[i] === '--lat-min-rise' && hasValue(args, i + 1)) {
      // The floor is the ONE weight-like value whose domain is not `parseWeight`'s: below 1 it suppresses
      // nothing, so accepting `0` would report a configuration the operator believes changed something.
      const rise = Number(args[++i]!);
      opts.latMinRise = Number.isFinite(rise) && rise >= 1 ? rise : DEFAULT_LAT_MIN_RISE;
    } else if (args[i] === '--failed-edge-weight' && hasValue(args, i + 1))
      // `parseWeight` and the SHIPPED fallback, like every weight above: `--failed-edge-weight 0` is a measured
      // configuration (the term switched off is what the published cells ran), so a typo must reproduce the
      // published one rather than run that experiment under its name.
      opts.failedEdgeWeight = parseWeight(args[++i]!, DEFAULT_FAILED_EDGE_WEIGHT);
    else if (args[i] === '--failed-edge-gate-mode' && hasValue(args, i + 1)) {
      // The union's own guard, not a hand-written pair — the `--dual-family-gate-mode` rule. An unusable value
      // falls back to the SHIPPED bar: a typo must reproduce the measured configuration rather than invent one.
      const mode = args[++i]!;
      opts.failedEdgeGateMode = isFailedEdgeGateMode(mode) ? mode : DEFAULT_FAILED_EDGE_GATE_MODE;
    } else if (args[i] === '--failed-edge-gate-share' && hasValue(args, i + 1))
      // A SHARE, so it takes the unit-interval parser: 1.5 is not a share of a champion and a negative one is
      // not a bar.
      opts.failedEdgeGateShare = parseUnitInterval(args[++i]!, DEFAULT_FAILED_EDGE_GATE_SHARE);
    else if (args[i] === '--pool-penalty' && hasValue(args, i + 1))
      // Through `parseWeight` rather than an inline parse, for the empty-value reason: `--pool-penalty 0`
      // is the ablation, so a blank flag must select the shipped 0.0679 rather than it.
      opts.poolMetricPenaltyWeight = parseWeight(args[++i]!, DEFAULT_POOL_METRIC_PENALTY_WEIGHT);
    // ── The corpus axis, which is not an engine option at all ──
    else if (args[i] === '--latency-view' && hasValue(args, i + 1)) {
      // `edgeLatency` is the input `latWeight` multiplies, and WHICH of the three views supplies it is a
      // property of the CORPUS rather than of the ranking — `rcaeval-corpus.ts`'s own words. It is offered
      // here because the floor and the corpus are an INTERACTION: neither axis moves a published cell on its
      // own, and only their cross product moves one at all, so an instrument that can vary one of the two
      // cannot measure the effect either of them has. The published cells' view stays the default, so a
      // bare dispatch reproduces them.
      //
      // The whole union, by the union's own guard rather than a hand-written pair — the repair
      // `--prism-pooling` carries, applied to the third two-and-three-member vocabulary on this surface. An
      // unusable value falls back to the SHIPPED view, like every other mode flag here: a typo must
      // reproduce a published corpus rather than invent one.
      const view = args[++i]!;
      opts.latencyView = isLatencySource(view) ? view : DEFAULT_LATENCY_SOURCE;
    } else if (args[i] === '--collision-weight' && hasValue(args, i + 1))
      opts.collisionWeight = parseWeight(args[++i]!, DEFAULT_COLLISION_WEIGHT);
    else if (args[i] === '--topo-weight' && hasValue(args, i + 1))
      opts.topoWeight = parseWeight(args[++i]!, DEFAULT_TOPO_WEIGHT);
    else if (args[i] === '--topo-discount' && hasValue(args, i + 1))
      opts.topoDiscount = parseUnitInterval(args[++i]!, DEFAULT_TOPO_DISCOUNT);
    else if (args[i] === '--topo-discount-scope' && hasValue(args, i + 1)) {
      // Falls back to the SHIPPED scope on an unusable value, on the rule every mode flag here follows: a
      // typo must reproduce a published corpus rather than invent one.
      const scope = args[++i]!;
      opts.topoDiscountScope = isTopoDiscountScope(scope) ? scope : DEFAULT_TOPO_DISCOUNT_SCOPE;
    } else if (args[i] === '--topo-discount-gate' && hasValue(args, i + 1))
      opts.topoDiscountGate = parseUnitInterval(args[++i]!, DEFAULT_TOPO_DISCOUNT_GATE);
    else if (args[i] === '--topo-closure' && hasValue(args, i + 1)) {
      // Falls back to the SHIPPED closure on an unusable value, on the rule the scope above follows: an
      // unnameable closure must reproduce a published corpus rather than invent a third aggregation.
      const closure = args[++i]!;
      opts.topoClosure = isTopoClosure(closure) ? closure : DEFAULT_TOPO_CLOSURE;
    } else if (args[i] === '--topo-precedence' && hasValue(args, i + 1)) {
      // Falls back to the SHIPPED reading on an unusable value, on the rule the closure above follows: an
      // unnameable guard must reproduce a published corpus rather than invent a third ordering rule.
      const precedence = args[++i]!;
      opts.topoPrecedence = isTopoPrecedence(precedence) ? precedence : DEFAULT_TOPO_PRECEDENCE;
    } else if (args[i] === '--pool-admission' && hasValue(args, i + 1)) {
      // Falls back to the SHIPPED admission on an unusable value, on the rule the scope and closure above
      // follow: a typo must reproduce a published corpus rather than widen the set a rank can index into.
      const admission = args[++i]!;
      opts.poolAdmission = isPoolAdmission(admission) ? admission : DEFAULT_POOL_ADMISSION;
    } else if (args[i] === '--log-weight' && hasValue(args, i + 1))
      // Falls back to the field's own default (1.0), NOT to 0: an inline
      // `parseFloat(x) || 0` read an empty flag as "the log signal off", which is a
      // configuration this runner never described and never recorded.
      opts.logWeight = parseWeight(args[++i]!, DEFAULT_LOG_WEIGHT);
    else if (args[i] === '--trace-weight' && hasValue(args, i + 1))
      opts.traceWeight = parseWeight(args[++i]!, DEFAULT_TRACE_WEIGHT);
    else if (args[i] === '--prism-weight' && hasValue(args, i + 1))
      opts.prismWeight = parseWeight(args[++i]!, DEFAULT_PRISM_WEIGHT);
    else if (args[i] === '--prism-pooling' && hasValue(args, i + 1)) {
      // The whole vocabulary, by the union's own guard — the `--log-signal-mode` repair applied to the
      // other two-member vocabulary on this surface rather than a second hand-written pair. A test asserts
      // the accepted set is the union rather than a subset of it, because a subset is exactly what this
      // flag would have been given: only one of the two poolings was ever reachable from the engine.
      //
      // An unusable VALUE falls back to the SHIPPED pooling, like every other mode flag here: a typo must
      // reproduce a published configuration rather than invent one. The value is inert while
      // `prismWeight` is 0.
      const pooling = args[++i]!;
      opts.prismPooling = isPrismPooling(pooling) ? pooling : DEFAULT_PRISM_POOLING;
    } else if (args[i] === '--log-signal-mode' && hasValue(args, i + 1)) {
      const raw = args[++i]!;
      // The whole union, by the union's own guard. A hand-written pair lived here, and here is
      // where `all` was thrown away: it is the mode that admits every ERROR/FATAL line, which is
      // the only way a golden run can be asked for the `NetworkPartition`/`errLines` cell.
      //
      // An unusable VALUE still falls back to the published default, which is a different decision
      // from a second statement of the flag and is tested as one. What is refused is the pair that
      // CONTRADICTS: two statements whose modes differ cannot both be honoured, and honouring the
      // later one silently is how a command line that pins its own mode ends up measured at another.
      // Two statements of the SAME mode are one request written twice and stay accepted.
      const mode = isLogSignalMode(raw) ? raw : DEFAULT_LOG_SIGNAL_MODE;
      if (statedLogSignalMode !== undefined && statedLogSignalMode.mode !== mode) {
        throw new Error(
          `--log-signal-mode is stated twice with different values: '${statedLogSignalMode.raw}' ` +
            `and '${raw}'. This runner cannot honour both, so it refuses rather than take the last ` +
            'one — a command line that names a mode twice is a contradiction, not a precedence.',
        );
      }
      statedLogSignalMode = { raw, mode };
      opts.logSignalMode = mode;
    } else if (args[i] === '--collapse-discount' && hasValue(args, i + 1)) {
      const d = parseFloat(args[++i]!);
      opts.collapseDiscount = Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0;
    } else if (args[i] === '--rise-ceiling' && hasValue(args, i + 1)) {
      const ceiling = parseFloat(args[++i]!);
      opts.metricRiseCeiling = Number.isFinite(ceiling) && ceiling > 0 ? ceiling : 0;
    } else if (args[i] === '--drop-deviation-mode' && hasValue(args, i + 1)) {
      // Through the guard that owns the union, so a value the engine cannot name is REFUSED rather than
      // silently becoming the shipped mode — the defect `logSignalMode` carried for two iterations.
      const raw = args[++i]!;
      if (isDropDeviationMode(raw)) opts.dropDeviationMode = raw;
      else throw new Error(`--drop-deviation-mode expects bounded|log, got '${raw}'`);
    } else if (args[i] === '--baseline-anchor' && hasValue(args, i + 1)) {
      // Through the guard that owns the union, for the reason the line above states: a value the engine
      // cannot name is refused rather than becoming the shipped window under a dispatch that asked for
      // something else.
      const raw = args[++i]!;
      if (isBaselineAnchor(raw)) opts.baselineAnchor = raw;
      else throw new Error(`--baseline-anchor expects whole-file|pre-injection, got '${raw}'`);
    } else if (args[i] === '--rank-normalization') {
      opts.rankNormalization = true;
    } else if (args[i] === '--no-rank-normalization') {
      opts.rankNormalization = false;
    } else if (args[i] === '--anomaly-normalize-threshold' && hasValue(args, i + 1)) {
      // Through `parseNodeCount`, whose docblock carries why `0` is kept and a fraction is refused. The
      // fallback is the shipped count, so a malformed dispatch reproduces a published population rather
      // than inventing one — and `0` is the widest setting this flag has, not an absent value.
      opts.anomalyNormalizeNodeThreshold = parseNodeCount(
        args[++i]!,
        ANOMALY_NORMALIZE_NODE_THRESHOLD,
      );
    } else if (args[i] === '--suppress-idle-transients') {
      opts.suppressIdleTransients = true;
    } else if (args[i] === '--no-suppress-idle-transients') {
      opts.suppressIdleTransients = false;
    } else if (args[i] === '--no-suppress-demand-metrics') opts.suppressDemandMetrics = false;
    else if (args[i] === '--suppress-demand-metrics') opts.suppressDemandMetrics = true;
    else if (args[i] === '--anomaly-trend-weight' && hasValue(args, i + 1))
      opts.anomalyTrendWeight = parseWeight(args[++i]!, DEFAULT_ANOMALY_TREND_WEIGHT);
    else if (args[i] === '--anomaly-burst-weight' && hasValue(args, i + 1))
      opts.anomalyBurstWeight = parseWeight(args[++i]!, DEFAULT_ANOMALY_BURST_WEIGHT);
    else if (args[i] === '--anomaly-cv-weight' && hasValue(args, i + 1))
      opts.anomalyCvWeight = parseWeight(args[++i]!, DEFAULT_ANOMALY_CV_WEIGHT);
    else if (args[i] === '--anomaly-breadth-weight' && hasValue(args, i + 1))
      opts.anomalyBreadthWeight = parseWeight(args[++i]!, DEFAULT_ANOMALY_BREADTH_WEIGHT);
    else if (args[i] === '--anomaly-breadth-gate' && hasValue(args, i + 1))
      opts.anomalyBreadthGate = parseUnitInterval(args[++i]!, DEFAULT_ANOMALY_BREADTH_GATE);
    else if (args[i] === '--suppress-near-zero-baseline-rise') {
      opts.suppressNearZeroBaselineRise = true;
    } else if (args[i] === '--no-suppress-near-zero-baseline-rise') {
      opts.suppressNearZeroBaselineRise = false;
    } else if (args[i] === '--suppress-zero-baseline-latency') {
      opts.suppressZeroBaselineLatency = true;
    } else if (args[i] === '--no-suppress-zero-baseline-latency') {
      opts.suppressZeroBaselineLatency = false;
    } else if (args[i] === '--cap-trend-bonus-at-deviation') {
      opts.capTrendBonusAtDeviation = true;
    } else if (args[i] === '--no-cap-trend-bonus-at-deviation') {
      opts.capTrendBonusAtDeviation = false;
    } else if (args[i] === '--trace-skips-leader') {
      opts.traceSkipsLeader = true;
    } else if (args[i] === '--no-trace-skips-leader') {
      opts.traceSkipsLeader = false;
    } else if (args[i] === '--fusion-ceiling' && hasValue(args, i + 1)) {
      opts.fusionCeiling = args[++i]!;
    } else if (args[i] === '--routing-probe' && hasValue(args, i + 1)) {
      opts.routingProbe = args[++i]!;
    } else if (args[i] === '--diagnose-dump' && hasValue(args, i + 1)) {
      opts.diagnoseDump = args[++i]!;
    } else if (args[i] === '--loss-census' && hasValue(args, i + 1)) {
      opts.lossCensus = args[++i]!;
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
