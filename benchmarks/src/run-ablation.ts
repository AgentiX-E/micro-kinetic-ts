/**
 * Ablation Study Runner — measures each feature's marginal contribution
 * by running benchmarks with features individually toggled on/off.
 *
 * ## Matrix
 *
 * | Feature        | Flag       | Expected effect    |
 * |----------------|------------|--------------------|
 * | Collision Q(f,f) | collisionAg | Amplifies bottleneck detection |
 * | PC Causal       | pcDisc      | Prunes spurious edges |
 * | Trace Topo      | traceAug    | Discovers missing edges from traces |
 * | Weight Calib    | selfLearn   | Adaptive signal blending |
 *
 * ## Methodology
 *
 * For each feature toggle combination, run ALL benchmark cases × 3 repetitions.
 * Compute mean A@1 and standard deviation. Report Δ vs baseline (all OFF).
 *
 * @module benchmarks/run-ablation
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Container,
  DEFAULT_CLASSIFICATION_RULES,
  DI_TOKENS,
  RegexFaultClassifier,
} from '../../packages/core/src/index.js';
import type {
  AccuracyCell,
  AxisPoint,
  PrismPooling,
} from '../../packages/kinetic/src/benchmarks/index.js';
import {
  analyzePrismSweep,
  axisPoint,
  BenchmarkRunner,
  caseWeightedMean,
  DEFAULT_PRISM_POOLING,
  // The one owner of the per-fault-type → suite fold, BOTH conventions of it. This study had its own
  // convention for the published fold, and that convention was the whole of a disagreement investigated for
  // three runs as an input defect (see the module's header). It then kept FOUR hand-rolled case-weighted
  // accumulators — the very re-implementation that module was written to remove, in the file its docblock
  // names as the first offender. Both folds now come from the owner: `meanOverFaultTypes` for the published
  // headline and `caseWeightedMean` for the four numbers reported beside it.
  meanOverFaultTypes,
  RCAEvalLoader,
} from '../../packages/kinetic/src/benchmarks/index.js';
import type {
  BenchmarkCase,
  BenchmarkSuite,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { WeightCalibrator } from '../../packages/kinetic/src/signals/weight-calibrator.js';
import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';
import {
  buildAblationEngineOptions,
  configDiff,
  formatAblationConfigLine,
  type AblationEngineOverrides,
  type AblationFeatureFlags,
} from './ablation-engine-options.js';
// The corpus assembly, SHARED with the golden path — this study used to rank on the unpruned graph while
// the published cells ranked on the pruned one.
import {
  channelCases,
  formatDirectionalCoverage,
  formatInputCoverage,
  formatLatencyRoutes,
  readZero,
  summarizeDirectionalCoverage,
  summarizeInputCoverage,
  summarizeLatencyRoutes,
  TERM_CHANNELS,
  type InputCoverage,
  type LatencyRouteCensus,
  type LatencyRouteEntry,
} from './directional-evidence.js';
import {
  applyLatencyView,
  assembleRCAEvalCase,
  DEFAULT_LATENCY_SOURCE,
  type LatencySource,
  type LatencyViews,
} from './rcaeval-corpus.js';
import type { SemanticEnhancerConfig } from './rcaeval-semantic.js';
import {
  buildRCAEvalCallGraph,
  enhanceRCAEvalCallGraph,
  initRCAEvalTopology,
  isRCAEvalTopologyInitialized,
} from './rcaeval-topology.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The AVG/CW rule, stated ONCE and printed by **both** renderings of this artifact's results.
 *
 * It used to be written out twice — above the study's results table and above the PRISM sweep's — with
 * different wording, and when RE2's corpus was corrected the two copies diverged in the worst way: the study's
 * was fixed and the sweep's still read *"…which is RE1 alone"*, so the artifact went on printing a claim its
 * own columns had already falsified, in one of its two tables. Two wordings of one fact is the register's
 * **"a quantity with N implementations is a quantity with no convention"**, in prose.
 *
 * The rule deliberately names no suite. RE2's `AVG` and `CW` both read 83.7% with all six fault types at 45
 * case-reps, so the suite the old parenthetical excluded is a second counter-example: *a named answer to a
 * population question goes stale the next time the population moves; a rule does not.* The evidence is the
 * per-fault-type cells, which print their counts.
 */
const FOLD_CONVENTIONS: readonly string[] = [
  'AVG = per-system mean over FAULT TYPES (the published convention; the nine cells are in it).',
  'CW = per-system mean over CASES. The PRISM sweep prints the same two numbers as `overall` and `cw`.',
  'They coincide exactly when every fault type holds the same case count — the per-fault-type cells print that count, so this statement never has to name a suite.',
];

// ── Feature Configuration ─────────────────────────────────

/**
 * The study's feature flags.
 *
 * Moved to `ablation-engine-options.ts` with the mapping they drive, because the mapping is what the
 * artifact has to state and it lived only here — in a file that calls `main()` at import time and is
 * therefore importable by nothing.
 */
type FeatureFlags = AblationFeatureFlags;

interface AblationRun {
  flags: FeatureFlags;
  /**
   * The weights this row OVERRODE, kept so the record can state its own configuration.
   *
   * It did not, until iteration 73, and the omission had a cost: the 0.0-verdict block needs a row's varied
   * TERMS, and without this the row's configuration line could not be rebuilt from its own record — the same
   * defect the artifact's line was added to repair, one level down.
   */
  overrides: AblationEngineOverrides;
  /**
   * Which view of `edgeLatency` this row ranked on.
   *
   * Part of the row's own record for the same reason `overrides` is: the 0.0-verdict block rebuilds a row's
   * varied axes from its own configuration, and a row that varies the CORPUS states no engine term at all — so
   * a block that read only the weights would skip it, which is exactly the shape of defect this record was
   * added to repair one level down. `shipped` is the published view.
   */
  latencyView: LatencySource;
  label: string;
  results: Map<string, AblationResult>;
}

interface AblationResult {
  /**
   * The PUBLISHED convention — the unweighted mean of this system's per-fault-type accuracies, which is
   * what RCAEval's `AVERAGE` column and therefore the nine published cells report. This is the headline.
   */
  publishedA1: number;
  /**
   * The study's own convention — the mean over cases. Kept because it reports a weight's effect in the
   * unit the weight acts on, reported BESIDE `publishedA1` and never instead of it. The two differ only
   * when the fault types hold unequal numbers of cases, which is every suite but RE1.
   */
  aTop1: number;
  aTop5: number;
  la: number;
  ta: number;
  totalCases: number;
  duration: number;
  failures: number;
  // Per-fault-type breakdown
  perFaultType: Map<string, { cases: number; accuracy: number }>;
  // Individual repetitions for stddev
  reps: number[];
}

// ── Configurations to Test ────────────────────────────────
//
// Full factorial over the 3 remaining features (2^3 = 8 configs).
// PC Causal Discovery was removed — see ABLATION_FINDINGS.md in the
// docs repo: it reduced Top-1 accuracy by up to 4.0% on RE2.

/**
 * Every flag OFF, which is the configuration the three propagation-channel rows vary.
 *
 * Named because three rows spread the same twelve booleans, and a row that differed from its siblings in a
 * flag would attribute a difference to a weight that a flag caused. The channel rows are about the
 * NUMBERS, so the flags are held identical by construction rather than by transcription.
 */
const ALL_OFF_FLAGS: FeatureFlags = {
  collisionAggregation: false,
  extraTraceValidation: false,
  selfLearning: false,
  logSignal: false,
  topoSignal: false,
  collisionSignal: false,
  collapseDiscount: false,
  riseSignal: false,
  traceSignal: false,
  rankNormalization: false,
  suppressIdleTransients: false,
  prismSignal: false,
};

/**
 * The two PRISM slices' flags, named so that their POOLING siblings differ from them in one override.
 *
 * `PRISM_ONLY_FLAGS` is the isolated signal; `PRODUCTION_PRISM_FLAGS` is the shipped configuration's flags
 * (`logWeight = 1`, `traceWeight = 1`, `rankNormalization = true`) with the PRISM signal added.
 *
 * They exist because the pooling rows are defined as `{ ...X }` with one override: a row that retyped twelve
 * booleans would attribute a difference to the pooling that a flag caused, which is the one thing a
 * single-knob ablation must not do — and the same reason `ALL_OFF_FLAGS` is a constant rather than three
 * transcriptions.
 */
const PRISM_ONLY_FLAGS: FeatureFlags = {
  ...ALL_OFF_FLAGS,
  prismSignal: true,
};

const PRODUCTION_PRISM_FLAGS: FeatureFlags = {
  ...ALL_OFF_FLAGS,
  logSignal: true,
  traceSignal: true,
  rankNormalization: true,
  prismSignal: true,
};

const CONFIGS: Array<{
  flags: FeatureFlags;
  label: string;
  overrides?: AblationEngineOverrides;
  /**
   * Which view of `edgeLatency` this row ranks on — a CORPUS axis, never a flag.
   *
   * Omitted means the published composition (`shipped`). It is stated as its own field rather than as an
   * `AblationEngineOverrides` member because it is not an engine knob at all: the value is selected on the
   * assembled case by the corpus owner, and the row's own line prints which corpus it ran, so a reader never
   * has to infer it. The flag that used to carry a corpus property (`traceAugmentation`) measured `+0.0` on
   * the only two suites that had traces, which is what a corpus step looks like when it is expressed as a
   * ranking flag.
   */
  latencyView?: LatencySource;
}> = [
  // Baseline: everything OFF
  {
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    // Was `BASELINE (all OFF)`, which asserted a configuration this run does not have: the four terms
    // that dominate the shipped ranking (`latWeight`, `latMinRise`, `poolMetricPenaltyWeight`,
    // `stabilityWeight`) are ON in it, inherited from the engine's defaults. The label now claims what it
    // can support — the FLAGS are off — and the configuration line below states the rest.
    label: 'BASELINE (flags OFF)',
  },
  // Individual features
  {
    flags: {
      collisionAggregation: true,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Collision Q(f,f)',
  },
  {
    flags: {
      collisionAggregation: false,
      extraTraceValidation: true,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Trace Topo',
  },
  {
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: true,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+SelfLearn',
  },
  // Pairs
  {
    flags: {
      collisionAggregation: true,
      extraTraceValidation: true,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Collision+Trace',
  },
  {
    flags: {
      collisionAggregation: true,
      extraTraceValidation: false,
      selfLearning: true,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Collision+SelfLearn',
  },
  {
    flags: {
      collisionAggregation: false,
      extraTraceValidation: true,
      selfLearning: true,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Trace+SelfLearn',
  },
  // Full stack
  {
    flags: {
      collisionAggregation: true,
      extraTraceValidation: true,
      selfLearning: true,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: 'FULL STACK (all ON)',
  },
  // ── New ranking signals (marginal over BASELINE, one at a time) ──
  // Each measures the marginal contribution of a single ranking signal.
  // They are NOT part of the full factorial above — 2^6 = 64 configs × 3 reps
  // would exceed CI budget — so they are added as 1-D slices: baseline + one
  // signal at full strength (weight 1.0).
  {
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: true,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Log Signal',
  },
  {
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: true,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Topo Signal',
  },
  {
    // The collision signal consumes `ratioContrib`, which is only populated
    // when Boltzmann aggregation is ON — so this config enables aggregation
    // (unlike +Log/+Topo). Its marginal over "+Collision Q(f,f)" isolates the
    // collisionWeight penalty from the aggregation itself.
    flags: {
      collisionAggregation: true,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: true,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Collision Signal',
  },
  {
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: true,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Collapse Discount',
  },
  {
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: true,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Rise Signal',
  },
  {
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: true,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Trace Activity Signal',
  },
  {
    // Combined slice: the production log signal + the trace-activity
    // backstop. The 1-D slices above measure each signal's MARGINAL effect in
    // isolation, but the real deployment question is whether the trace
    // signal's silent-source gains SURVIVE on top of the log signal. The log
    // signal alone names exception-type faults (OB f4 → 100%) but is blind to
    // silent wrong-value faults (TT f2 → 0%); the trace signal alone names TT
    // f2 (43%) but misfires onto OB f4 (67% → 50%) and RE2 TT mem (75% →
    // 63%). Whether the log signal's correct answer survives the trace vote's
    // interference (and vice versa) is a fusion-level question that no 1-D
    // slice can answer — it must be measured directly.
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: true,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: true,
      rankNormalization: false,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Log +Trace Activity',
  },
  {
    // Combination slice: rank normalization is a MONOTONIC transform, so in
    // isolation it is a provable no-op (identical ordering, all weights 0) —
    // the isolated +Rank Normalization slice above confirms it is bit-identical
    // to BASELINE. Its value only materialises when a downstream causal signal
    // (trace/topo) can exploit the COMPRESSED anomaly gap. Under min-max, a
    // near-zero-baseline symptom spike (latency-90 rising 41–764×) sets the
    // range max and crushes the silent source's modest deviation to ~0, so
    // log(source) ≈ −1.77 and the trace vote (+1.0) cannot overcome it. Under
    // rank, the outlier and the second-ranked source land at ≈1.0 vs ≈0.98, so
    // log(source) ≈ −0.02 and the trace vote flips the ranking. This slice
    // measures whether rank + trace beats trace alone (TT f3 is the target).
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: true,
      rankNormalization: true,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Trace Activity +Rank',
  },
  {
    // Combination slice: the production log + trace backstop, plus rank
    // normalization. The main benchmark ships logWeight=1 + traceWeight=1
    // (production defaults); this slice mirrors that on top of rank
    // normalization to answer whether rank lifts the production configuration's
    // TT RE3 (currently f3 = 10%) without regressing OB/SS/RE1/RE2.
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: true,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: true,
      rankNormalization: true,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Log +Trace Activity +Rank',
  },
  {
    // Rank-based anomaly-score normalization (rankNormalization), the P1 fix
    // for the near-zero-baseline spike pathology. A symptom metric (latency-90
    // rising 41–764× over a ~0 baseline) sets the min-max range's max and
    // crushes the genuine source's modest deviation to ~0, so the symptom wins
    // the log-domain anomaly term by ~1.7. Rank normalization maps the outlier
    // and the second-ranked source to ≈1.0 vs ≈0.98 — semantic-agnostic — so
    // the deterministic trace/topo signals that already point at the silent
    // source can tip the ranking. Affects only large topologies (≥ 20 nodes).
    // NOTE: in isolation this slice is a no-op (monotonic transform, all
    // weights 0); the +Trace Activity +Rank and +Log +Trace Activity +Rank
    // slices above are where its effect is actually measured.
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: true,
      suppressIdleTransients: false,
      prismSignal: false,
    },
    label: '+Rank Normalization',
  },
  {
    // Idle-start transient suppression (suppressIdleTransients), the P2 fix for
    // the ts-route-service socket-drop failures. Unlike rank normalization
    // (monotonic, a no-op in isolation), this guard REMOVES metrics from
    // scoring, so its isolated slice IS meaningful: it suppresses the victim's
    // near-zero-baseline latency-90 spike (head ≈ 0 → pulse → non-zero tail),
    // whose relative rise is a measurement artifact, so the genuine permanent
    // socket drop (23 → 9) survives as the top anomaly. Semantic-agnostic: the
    // NON-zero-tail requirement keeps a zero→burst→zero event fault (#199).
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: false,
      rankNormalization: false,
      suppressIdleTransients: true,
      prismSignal: false,
    },
    label: '+Idle Transient Suppression',
  },
  {
    // Production configuration + the idle-transient suppression. The main
    // benchmark ships logWeight=1 + traceWeight=1 + rankNormalization=true;
    // this slice adds suppressIdleTransients on top to answer whether the P2
    // fix lifts the production TT RE3 (f3 target) without regressing
    // OB/SS/RE1/RE2.
    flags: {
      collisionAggregation: false,
      extraTraceValidation: false,
      selfLearning: false,
      logSignal: true,
      topoSignal: false,
      collisionSignal: false,
      collapseDiscount: false,
      riseSignal: false,
      traceSignal: true,
      rankNormalization: true,
      suppressIdleTransients: true,
      prismSignal: false,
    },
    label: '+Log +Trace Activity +Rank +Idle Transient',
  },
  {
    // 1-D slice: the PRISM graph-free internal/external asymmetry signal in
    // isolation. PRISM scores a root cause as anomalous in BOTH internal
    // (cpu/mem/disk/socket) and external (latency/error/throughput) channels,
    // using a DIFFERENT anomaly scorer (a standardized mean shift over the
    // pre/post-inject windows) than the engine's own feature pipeline. The
    // fusion ceiling showed it is strongly complementary (union 87.5% vs
    // 76.1% engine / 76.7% PRISM separately), with the strongest complement in
    // RE2 resource faults and RE3. This slice measures PRISM's marginal effect
    // alone; the +Log +Trace Activity +Rank +PRISM slice measures whether the
    // gain survives on top of the production configuration.
    //
    // The flags are spread from a NAMED constant because the pooling rows below are its siblings: a
    // difference between this row and `PRISM Signal (conjunctive)` must be the pooling and nothing else.
    flags: { ...PRISM_ONLY_FLAGS },
    label: '+PRISM Signal',
  },
  {
    // Combination slice: the production configuration (logWeight=1 +
    // traceWeight=1 + rankNormalization=true) plus the PRISM signal. This is
    // the fusion answer the ceiling motivates: the engine and PRISM are
    // complementary, so PRISM should add cases the engine misses (RE2 resource
    // faults, some RE3) without regressing the cells the log/trace signals
    // already own. This slice is the one that decides whether prismWeight
    // ships enabled.
    flags: { ...PRODUCTION_PRISM_FLAGS },
    label: '+Log +Trace Activity +Rank +PRISM',
  },
  // ── PRISM's POOLING, as the second of its two knobs ─────────────────────
  //
  // `prismWeight` was the first PRISM knob this battery could pose a question about; the pooling is the
  // second, and it is the one the ENGINE could not pose at all. `combinePrismScore` takes both poolings and
  // the standalone evaluator dispatches them (`scripts/run-prism.ts --pooling conjunctive`), but the
  // engine's single call site omitted the argument — so the alternative was implemented, measured, and
  // unreachable from every ablation row and every dispatch. See `docs/prism-pooling-axis.md`.
  //
  // Why it is worth a row rather than an assumption: the controlled head-to-head (`docs/prism-head-to-head.md`,
  // the identical 735 cases) reads the two poolings side by side per cell, and the difference is not a
  // rounding on a corpus average — it is 78.9% against 69.8% overall in `additive`'s favour, and
  // **RE3 TrainTicket 76.7% against 33.3%** in `conjunctive`'s, on the weakest cell of the published nine.
  // Nothing above can see that, because nothing above varies the pooling.
  //
  // The two rows are the ADDITIVE rows' siblings with one override each, so each pair differs in the pooling
  // and in nothing else — which is the only way the delta is attributable to the pooling rather than to a
  // flag someone retyped.
  {
    flags: { ...PRISM_ONLY_FLAGS },
    overrides: { prismPooling: 'conjunctive' },
    label: 'PRISM Signal (conjunctive)',
  },
  {
    flags: { ...PRODUCTION_PRISM_FLAGS },
    overrides: { prismPooling: 'conjunctive' },
    label: '+Log +Trace +Rank +PRISM (conj)',
  },

  // ── The propagation-delay channel, as a 2x2 over its two knobs ──────────
  //
  // Every row above is a point in a binary cube, and the term this group varies is not: the SHIPPED
  // `latWeight = 0.561495` is neither 0 nor 1, and `latMinRise = 10.3` is a floor that MASKS out any rise
  // between 1 and 10.3 rather than compressing it. So the row that answers "what does the kinetic
  // propagation model contribute" cannot be built out of flags, which is why `ABLATION_FINDINGS.md` v2
  // listed the channel as UNMEASURED and why the loader had to be taught to carry its input first.
  //
  // The four cells of the 2x2 are: the shipped configuration (already the BASELINE row above), the channel
  // switched OFF, the floor REMOVED, and both. The floor's removal is spelled `1`, not `0`: `1` is the
  // value `computeEdgeLatencyScores` documents as identical to the pre-floor term ("a rise at or below 1 is
  // never dropped"), so it is the channel's own reference point rather than a number chosen here.
  {
    // The channel OFF, floor untouched. Reads the whole of `latWeight`'s contribution — the term that has
    // received nothing on every RCAEval run until this loader change.
    flags: { ...ALL_OFF_FLAGS },
    overrides: { latWeight: 0 },
    label: 'LAT OFF (latWeight=0)',
  },
  {
    // The floor REMOVED, weight shipped. The mask drops every rise in (1, 10.3); if the channel's input
    // turns out to be populated but inert, this row says whether the floor is what silences it.
    flags: { ...ALL_OFF_FLAGS },
    overrides: { latMinRise: 1 },
    label: 'LAT NO FLOOR (latMinRise=1)',
  },
  {
    // Both, so the two knobs' effects can be separated from their interaction. A term that is inert with a
    // floor AND inert without one is inert; a term whose effect appears only here is being read through the
    // floor rather than through the weight.
    flags: { ...ALL_OFF_FLAGS },
    overrides: { latWeight: 0, latMinRise: 1 },
    label: 'LAT OFF + NO FLOOR',
  },
  // ── The channel's input, which no row above can change ──
  //
  // The three rows above vary the WEIGHT and the FLOOR. If the array they multiply is empty, all three read
  // a zero and none of them says whether the term is worthless or unfed — which is the distinction
  // `input-coverage` draws and cannot explain, because on RCAEval the array has been empty by an artefact of
  // the derivation rather than by absence of evidence. These three rows move the INPUT instead:
  //
  // - `whole-file` is the derivation the one streaming pass already computes and the assembly used to drop;
  // - `capped` is the same derivation the published cells use, with the start-time unit repaired — so it
  //   isolates the CAP, which the loader's own docblock says truncates before the post-injection window;
  // - the third row is the control: the same corpus as the first with `latWeight` switched off, which must
  //   land back on the BASELINE row if the first row's movement belongs to `latWeight` and to nothing else.
  //
  // None of them changes what the engine IS — the same flags, the same weights, the same graph — so a
  // difference between them is a statement about the corpus, which is why they are corpus rows and not
  // ablation rows, and why the label names the corpus rather than the knob.
  {
    // The only view in which a pre/post pair exists at all. If this row is inert, the propagation channel
    // has no effect on this benchmark and the corner of the Deng-Yu mathematics that enters the ranking is
    // measured — for the first time on RCAEval.
    flags: { ...ALL_OFF_FLAGS },
    latencyView: 'whole-file',
    label: 'LAT WHOLE FILE (corpus edgeLatency=whole-file)',
  },
  {
    // The published input with only the unit repaired: the cap kept. Separates "the cap starves the
    // channel" from "the unit defect emptied it" by holding everything else identical.
    flags: { ...ALL_OFF_FLAGS },
    latencyView: 'capped',
    label: 'LAT CAPPED (corpus edgeLatency=capped)',
  },
  {
    // The control. `latWeight = 0` on the whole-file corpus must return to the BASELINE row; if it does not,
    // the first row's movement came from something other than the term the label credits it to.
    flags: { ...ALL_OFF_FLAGS },
    overrides: { latWeight: 0 },
    latencyView: 'whole-file',
    label: 'LAT WHOLE FILE + LAT OFF',
  },
  // ── The two priors the battery had never varied ──
  //
  // `ABLATION_FINDINGS.md` v2 recorded its own residue as a candidate rather than a number: the ledger's
  // rows did not sum to the golden's cells, and **the never-ablated numeric terms were what was left** —
  // `poolMetricPenaltyWeight` (0.0679) and `stabilityWeight` (0.007352). Both ran at full shipped strength
  // in every configuration of every battery, so their contribution was not a zero, it was UNMEASURED.
  //
  // They are also the only levers left on RE1, which is the suite that blocks every global PRISM weight:
  // RE1 carries **no `logs.csv` and no `traces.csv` at all** (the golden's own artifact records
  // `[log] No log data available for 125 cases` three times), so a boolean signal there has no input to act
  // on and reads a zero that says nothing about the term. A numeric prior acts on the metric anomaly the
  // suite does have, which is why these two rows are the only ones in the battery that can move it.
  {
    // The pool-dominance penalty OFF. The term exists to stop a service that pools many metrics from
    // outranking the source on volume alone; if it is worth nothing, removing it removes a chance to be
    // wrong, and it is dispatchable on both benchmarks.
    flags: { ...ALL_OFF_FLAGS },
    overrides: { poolMetricPenaltyWeight: 0 },
    label: 'POOL PENALTY OFF (poolMetricPenaltyWeight=0)',
  },
  {
    // The decisive-stability prior OFF. `0` is the value where the term is absent; the shipped 0.007352 is
    // its owner constant, and the row's own config line states which of the two it ran.
    flags: { ...ALL_OFF_FLAGS },
    overrides: { stabilityWeight: 0 },
    label: 'STABILITY OFF (stabilityWeight=0)',
  },
  {
    // Both, so their interaction is separable from either alone.
    flags: { ...ALL_OFF_FLAGS },
    overrides: { poolMetricPenaltyWeight: 0, stabilityWeight: 0 },
    label: 'POOL PENALTY + STABILITY OFF',
  },
];

// Default to 3 repetitions for statistical significance
const REPETITIONS = 3;

// ── PRISM Weight Sweep ────────────────────────────────────
//
// The fusion ceiling showed PRISM is strongly complementary to the production
// engine, but a fixed prismWeight=1 is net-positive (+5.18pp) yet violates
// zero-regression (5 cells regress — delay/socket + already-100% cells, where
// PRISM's max-normalised score overrides the engine's correct top-1). The
// sweep answers whether a SINGLE GLOBAL weight is both net-positive and
// zero-regression. The weight range is concentrated low because prismScore is
// max-normalised to [0,1] while the engine's log(selfAnomaly) term spans only
// ~[−2, 0], so weight 1 injects up to +1.0 — far above the natural log-space
// gaps that separate the true source from a large symptom.
const PRISM_SWEEP_WEIGHTS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0];

// The POOLINGS the sweep measures, and the shipped one leads.
//
// It leads because the frontier is measured against the axis's FIRST column, and the
// analyzer refuses an axis that does not start at the shipped configuration (weight 0 with
// DEFAULT_PRISM_POOLING) — a frontier measured against anything else describes a run nobody
// ships. So the shipped block comes first by construction, not by comment.
//
// Until the pooling was enrolled, this list could not exist: the engine's single call site
// omitted the pooling argument, so EVERY point of the weight ladder above was measured with
// `conjunctive` unreachable and the frontier it produced — `{0} only` — was a statement
// about one slice of the space the fusion decision is made in.
const PRISM_SWEEP_POOLINGS: readonly PrismPooling[] = [DEFAULT_PRISM_POOLING, 'conjunctive'];

// The swept axis: the cross product of the weight ladder and the poolings, shipped block
// first. Every column names its own configuration, so no reading can be reported without
// saying which pooling produced it.
const PRISM_SWEEP_AXIS: readonly AxisPoint[] = PRISM_SWEEP_POOLINGS.flatMap((pooling) =>
  PRISM_SWEEP_WEIGHTS.map((weight) => axisPoint(weight, pooling)),
);

// The production configuration (logWeight=1 + traceWeight=1 + rankNorm=true),
// whose prismWeight the sweep varies. Mirrors the '+Log +Trace Activity +Rank'
// ablation slice.
const PRISM_SWEEP_FLAGS: FeatureFlags = {
  collisionAggregation: false,
  extraTraceValidation: false,
  selfLearning: false,
  logSignal: true,
  topoSignal: false,
  collisionSignal: false,
  collapseDiscount: false,
  riseSignal: false,
  traceSignal: true,
  rankNormalization: true,
  suppressIdleTransients: false,
  prismSignal: false,
};

// ── Helpers ───────────────────────────────────────────────

function loadEnvFile(): void {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

interface CaseMeta {
  suite: 'RE1' | 'RE2' | 'RE3';
  system: 'OnlineBoutique' | 'SockShop' | 'TrainTicket' | 'Unknown';
  service: string;
  faultType: string;
  instance: number;
  dirPath: string;
}

function parseCaseDir(dirPath: string): CaseMeta | null {
  const name = basename(dirPath);

  // Pattern A: flat format — re{1-3}{ob|ss|tt}_{service}_{fault}_{instance}
  const flatMatch = name.match(/^re([123])(ob|ss|tt)_(.+?)_([a-z0-9]+)_(\d+)$/i);
  if (flatMatch) {
    const suiteNum = flatMatch[1]!;
    const sysCode = flatMatch[2]!;
    return {
      suite: `RE${suiteNum}` as CaseMeta['suite'],
      system: sysCode === 'ob' ? 'OnlineBoutique' : sysCode === 'ss' ? 'SockShop' : 'TrainTicket',
      service: flatMatch[3]!,
      faultType: flatMatch[4]!.toLowerCase() as CaseMeta['faultType'],
      instance: parseInt(flatMatch[5]!, 10),
      dirPath,
    };
  }

  // Pattern B: nested format — walk parent chain for re{1-3} and system code
  const chain = dirPath.replace(/\\/g, '/').split('/');
  let suiteNum: string | undefined;
  let sysCode: string | undefined;

  for (let i = chain.length - 2; i >= 0; i--) {
    const segment = chain[i]!;
    const suiteM = segment.match(/^re([123])$/i);
    if (suiteM && !suiteNum) {
      suiteNum = suiteM[1]!;
      continue;
    }
    const sysM = segment.match(/^(ob|ss|tt|onlineboutique|sockshop|trainticket)$/i);
    if (sysM && !sysCode) {
      const s = sysM[1]!.toLowerCase();
      sysCode = s.length === 2 ? s : s === 'onlineboutique' ? 'ob' : s === 'sockshop' ? 'ss' : 'tt';
      break;
    }
  }

  if (!suiteNum || !sysCode) return null;

  const sysName: CaseMeta['system'] =
    sysCode === 'ob' ? 'OnlineBoutique' : sysCode === 'ss' ? 'SockShop' : 'TrainTicket';

  const svcFaultMatch = name.match(/^(.+?)_([a-z0-9]+)_(\d+)$/i);
  if (svcFaultMatch) {
    return {
      suite: `RE${suiteNum}` as CaseMeta['suite'],
      system: sysName,
      service: svcFaultMatch[1]!,
      faultType: svcFaultMatch[2]!.toLowerCase() as CaseMeta['faultType'],
      instance: parseInt(svcFaultMatch[3]!, 10),
      dirPath,
    };
  }

  const caseMatch = name.match(/^case_(\d+)$/i);
  const indexMatch = name.match(/^(\d+)$/);
  const instance = caseMatch
    ? parseInt(caseMatch[1]!, 10)
    : indexMatch
      ? parseInt(indexMatch[1]!, 10)
      : -1;
  if (instance < 0) return null;

  return {
    suite: `RE${suiteNum}` as CaseMeta['suite'],
    system: sysName,
    service: name,
    faultType: 'cpu' as CaseMeta['faultType'],
    instance,
    dirPath,
  };
}

function discoverAllCases(dataDir: string): CaseMeta[] {
  if (!existsSync(dataDir)) return [];
  const cases: CaseMeta[] = [];
  const queue = [dataDir];
  while (queue.length > 0) {
    const current = queue.shift()!;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      const hasMetrics = entries.some((e) => e.isFile() && e.name === 'metrics.json');
      if (hasMetrics) {
        const meta = parseCaseDir(current);
        if (meta) cases.push(meta);
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          queue.push(join(current, entry.name));
        }
      }
    } catch {
      /* skip */
    }
  }
  return cases;
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let dataDir = join(homedir(), 'RCAEval-json');
  let systemFilter = 'all';
  let suiteFilter = 'all';
  let maxCases = 0;
  let prismSweep = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) dataDir = args[++i]!;
    else if (args[i] === '--system' && i + 1 < args.length) systemFilter = args[++i]!;
    else if (args[i] === '--suite' && i + 1 < args.length) suiteFilter = args[++i]!;
    else if (args[i] === '--max-cases' && i + 1 < args.length)
      maxCases = parseInt(args[++i]!, 10) || 0;
    else if (args[i] === '--prism-sweep') prismSweep = true;
  }

  console.log('═'.repeat(80));
  console.log('Micro-Kinetic — Feature Ablation Study');
  console.log('═'.repeat(80));
  console.log(`Data:       ${dataDir}`);
  console.log(`Filter:     system=${systemFilter}, suite=${suiteFilter}`);
  console.log(`Configs:    ${CONFIGS.length}`);
  console.log(`Repetitions: ${REPETITIONS}`);
  console.log('═'.repeat(80));

  loadEnvFile();

  const allCases = discoverAllCases(dataDir);
  console.log(`\nDiscovered: ${allCases.length} cases`);

  // ── Group by system ──
  const systemGroups = new Map<string, CaseMeta[]>();
  for (const c of allCases) {
    if (systemFilter !== 'all' && !c.system.toLowerCase().includes(systemFilter.toLowerCase()))
      continue;
    // Suite filter: 're1' matches RE1, 're2' matches RE2, etc.
    if (suiteFilter !== 'all' && c.suite !== `RE${suiteFilter.replace(/^re/i, '')}`) continue;
    const key = c.system;
    if (!systemGroups.has(key)) systemGroups.set(key, []);
    systemGroups.get(key)!.push(c);
  }

  if (systemGroups.size === 0) {
    console.log('No cases found. Exiting.');
    return;
  }

  // ── Init topology ──
  //
  // NOTE: this runner deliberately differs from `createSemanticConfig()` (used by
  // run-rcaeval). When no Zhipu key is usable it leaves the embedding provider
  // UNSET, so semantic enhancement is off and the topology falls back to exact
  // YAML matches plus ring-connect. run-rcaeval instead builds a TF-IDF provider
  // in that case, which changes the call graph and therefore every ablation cell.
  // The log lines below used to announce a "TF-IDF fallback" on both of those
  // paths, so an ablation report could describe a configuration it never ran.
  // Aligning the two runners is a behavioural change and needs its own ablation,
  // not a drive-by edit.
  const forceTfIdf = process.env['BENCHMARK_USE_TFIDF'] === '1';
  const zhipuKey = process.env['ZHIPU_API_KEY'];
  let embeddingProvider: SemanticEnhancerConfig['embeddingProvider'];
  if (zhipuKey && !forceTfIdf) {
    try {
      const { createApiEmbeddingFromEnv } = await import('@agentix-e/micro-kinetic-ai');
      const created = createApiEmbeddingFromEnv({
        vendorPrefix: 'ZHIPU',
        endpoint:
          process.env['ZHIPU_EMBEDDING_ENDPOINT'] ??
          'https://open.bigmodel.cn/api/paas/v4/embeddings',
        model: process.env['ZHIPU_EMBEDDING_MODEL'] ?? 'embedding-3',
        dimension: Number(process.env['ZHIPU_EMBEDDING_DIMENSION'] ?? '2048'),
      });
      if (created) {
        embeddingProvider = created;
        console.log('Semantic: Zhipu embedding-3 ✓');
      } else {
        console.log('Semantic: disabled (provider creation returned null)');
      }
    } catch {
      console.log('Semantic: disabled (provider creation failed)');
    }
  } else {
    console.log('Semantic: disabled (no ZHIPU_API_KEY)');
  }

  const semanticConfig: SemanticEnhancerConfig = {
    embeddingProvider,
    alignmentConfig: { embeddingThreshold: 0.6, llmThreshold: 0.5 },
  };

  await initRCAEvalTopology(undefined, semanticConfig);

  /**
   * Build a fresh DI container for a single ablation config.
   *
   * The collision-aggregation feature is controlled by the TreePruner's
   * `enableCollisionAggregation` option; the three ranking signals map to the
   * `collisionWeight` / `topoWeight` / `logWeight` options (weight 1.0 when
   * enabled). Each config gets its own container so the flags are wired
   * directly into the engine registered under RCA_ENGINE.
   */
  function buildContainer(flags: FeatureFlags, overrides?: AblationEngineOverrides): Container {
    const c = new Container();
    c.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
    // Both arguments come from the module that also renders the line the artifact carries, so the study's
    // configuration and its record cannot disagree. The hand-written literals that stood here named only
    // the seven fields the flags drive, which is why six shipped terms ran unstated.
    const engine = buildAblationEngineOptions(flags, overrides);
    c.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner(engine.signals, engine.topology));
    c.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());
    return c;
  }

  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  const loader = new RCAEvalLoader();

  // ── Load cases per-system (streaming) ──────────────────
  // On RE2/RE3 (270+ cases × thousands of trace spans each) loading
  // everything into memory crashes the heap even at 6 GiB.  Load and
  // process one system-bundle at a time, then release the references
  // so that GC can reclaim before the next bundle.
  //
  // Each system-bundle is the full (OnlineBoutique, RE1-3) set, or
  // (SockShop, RE1-3), or (TrainTicket, RE1-3).  The grouping is
  // coarse enough that ablations see the full dataset, but fine enough
  // that peak memory stays within the default 4 GiB heap.
  type SystemBundle = {
    /** The per-channel census of this system's cases: what a `0.0` can be attributed to. */
    coverage: InputCoverage;
    /**
     * The latency channel's three routes, counted from the same assembly.
     *
     * Kept beside `coverage` because `coverage` can only say that `latency` holds nothing, and this study's
     * sharpest open question is WHY: a truncating cap and a unit defect both read zero, in the same cases, from
     * the same file. `latency-routes` is the line that separates them, and it cannot be derived from the
     * assembled cases alone — the assembly derives its views and drops the spans, exactly as it drops the
     * graph's pre-augmentation shape. So the census is taken from the OWNER's own record.
     */
    latencyRoutes: LatencyRouteCensus;
    /** Case id → its three latency views, so a row can rank on a corpus without re-assembling one. */
    latencyViews: Map<string, LatencyViews>;
    systemName: string;
    cases: BenchmarkCase[];
    /** Case id → directory path, for lazy per-case trace loading. */
    caseDirMap: Map<string, string>;
  };

  async function loadSystemBundle(systemName: string, metas: CaseMeta[]): Promise<SystemBundle> {
    const cases: BenchmarkCase[] = [];
    /**
     * Cases that carried spans INTO the assembly.
     *
     * Counted here rather than read off the assembled cases, because the assembly derives everything it needs
     * and the runner drops the spans — so `case.traces` is empty on every case of every system, and a census
     * that read it reported `spans 0/30` on RE3 (a corpus whose graph WAS augmented from traces) and declared
     * `topoWeight` UNMEASURABLE there. **The count was reading what the case RETAINS, not what it HAD**, which
     * is the defect this census exists to prevent, committed by the census itself.
     */
    let casesWithSpans = 0;
    /** One entry per assembled case, from the owner's own record — see `SystemBundle.latencyRoutes`. */
    const latencyRouteEntries: LatencyRouteEntry[] = [];
    const latencyViewsById = new Map<string, LatencyViews>();
    const caseDirMap = new Map<string, string>();
    const selected = maxCases > 0 ? metas.slice(0, maxCases) : metas;
    // Trace-activity rise signal: compute per-service pre/post span counts
    // ONCE per system (not per config/rep) because each case's full
    // traces.csv scan is expensive (~27MB). Gated on any config enabling the
    // trace signal; the counts are config-independent (anchored to injectTime),
    // so the +Trace Activity slice reuses them across its repetitions.
    const needsTraceActivity =
      CONFIGS.some((c) => c.flags.traceSignal) || PRISM_SWEEP_FLAGS.traceSignal;
    for (const meta of selected) {
      try {
        const rawCase = loader.loadCase(meta.dirPath);
        const serviceIds = Object.keys(rawCase.metrics);

        let callGraph;
        if (semanticConfig?.embeddingProvider && isRCAEvalTopologyInitialized()) {
          callGraph = await enhanceRCAEvalCallGraph(rawCase.benchmark, serviceIds);
        } else {
          callGraph = buildRCAEvalCallGraph(rawCase.benchmark, serviceIds);
        }

        const suiteName =
          meta.suite === 'RE1'
            ? ('rcaeval-re1' as const)
            : meta.suite === 'RE2'
              ? ('rcaeval-re2' as const)
              : ('rcaeval-re3' as const);

        // The corpus, assembled by the SAME owner the golden uses and with the SAME augmentation. This study
        // used to rank on the UNPRUNED graph while the published cells ranked on the pruned one: the golden
        // prunes 55-82% of the edges of every trace-bearing case (`20 -> 9`, `218 -> 39`, `23 -> 9`,
        // `218 -> 41`) and this loader did nothing to the graph at all. The measured cost was one cell in
        // fourteen (RE2 TrainTicket, +1.8pp in the unpruned direction) — small, and beside the point, which
        // is that which graph a run ranks on was a property of which runner was invoked.
        //
        // The latency view is the same class of property, and it is stated rather than defaulted: the corpus
        // below is the PUBLISHED one (`shipped`), and the rows that rank on another view do so by
        // `applyLatencyView`, which the owner owns. A run that omitted it would rank on a corpus no artifact
        // names.
        const { benchCase, traceUsed, latencyViews, latencyRoute } = await assembleRCAEvalCase(
          loader,
          rawCase,
          meta,
          callGraph,
          suiteName,
          {
            augmentFromTraces: true,
            traceActivity: needsTraceActivity,
            latencyFrom: DEFAULT_LATENCY_SOURCE,
          },
        );
        if (traceUsed) casesWithSpans++;
        latencyRouteEntries.push(latencyRoute);
        latencyViewsById.set(benchCase.id, latencyViews);
        // Do NOT retain per-case traces here — RE2 traces.csv files are
        // large enough that holding all 50 cases' spans at once OOMs.
        // Record the directory path so the extraTraceValidation config can
        // load traces lazily, one fault-type group at a time.
        cases.push(benchCase);
        caseDirMap.set(benchCase.id, meta.dirPath);
      } catch (err) {
        console.log(
          `  ⚠ load error: ${meta.dirPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // Computed here, while the cases still exist: the caller releases them after each system, and a census
    // taken from an empty array would report every channel starved — the very mistake this instrument exists
    // to prevent.
    return {
      systemName,
      cases,
      caseDirMap,
      coverage: { ...summarizeInputCoverage(cases), casesWithSpans },
      latencyRoutes: summarizeLatencyRoutes(latencyRouteEntries),
      latencyViews: latencyViewsById,
    };
  }

  /**
   * PRISM weight sweep — run the production configuration (log + trace + rank)
   * at a continuum of prismWeight values and report the zero-regression
   * frontier: the set of weights where NO (system, fault-type) cell's AC@1
   * falls below its weight-0 baseline. This is the gating experiment for the
   * default-flip decision: a single global weight that is both net-positive
   * and zero-regression flips the default; otherwise per-context routing is
   * required.
   */
  async function runPrismSweep(): Promise<void> {
    console.log(`\n${'═'.repeat(80)}`);
    console.log('PRISM Sweep — zero-regression frontier over (weight × pooling)');
    console.log(`Poolings: ${PRISM_SWEEP_POOLINGS.join(', ')}`);
    console.log(`Weights:  ${PRISM_SWEEP_WEIGHTS.join(', ')}`);
    console.log(
      `Columns:  ${PRISM_SWEEP_AXIS.length} (${PRISM_SWEEP_AXIS.map((p) => p.label).join(', ')})`,
    );
    // Everything EXCEPT the swept value, so the sweep's cells are as attributable as the ablation's rows:
    // the two lines above name what is swept, and the line below names the rest.
    console.log(`Base config (swept over): ${formatAblationConfigLine(PRISM_SWEEP_FLAGS)}`);
    console.log('═'.repeat(80));

    // Per-cell accumulator: key → { key, cases, accuracy[axis index] }.
    const cells = new Map<string, { key: string; cases: number; accuracy: number[] }>();

    for (const [systemName, metas] of systemGroups) {
      const bundle = await loadSystemBundle(systemName, metas);
      const suite = (metas[0]?.suite ?? 'unknown').toLowerCase();

      // Group by fault type (stable across axis points).
      const byFT = new Map<string, BenchmarkCase[]>();
      for (const c of bundle.cases) {
        const ft = (c.groundTruth?.faultType ?? 'unknown').toLowerCase();
        if (!byFT.has(ft)) byFT.set(ft, []);
        byFT.get(ft)!.push(c);
      }

      for (let pi = 0; pi < PRISM_SWEEP_AXIS.length; pi++) {
        const point = PRISM_SWEEP_AXIS[pi]!;
        const container = buildContainer(PRISM_SWEEP_FLAGS, {
          prismWeight: point.weight,
          prismPooling: point.pooling,
        });
        for (const [ft, ftCases] of byFT) {
          if (ftCases.length === 0) continue;
          const key = `${suite}/${systemName}/${ft}`;
          const runner = new BenchmarkRunner(container, classifier);
          const suiteBundle: BenchmarkSuite = {
            name: `${systemName}-${ft}`,
            cases: ftCases,
            totalCases: ftCases.length,
          };
          const result = await runner.runSuite(suiteBundle);
          const existing = cells.get(key) ?? { key, cases: ftCases.length, accuracy: [] };
          existing.accuracy[pi] = result.avgTop1;
          cells.set(key, existing);
          console.log(`  [${point.label}] ${key}: ${(result.avgTop1 * 100).toFixed(1)}%`);
        }
      }

      // Release this system's bundle before loading the next. RE2 cases hold
      // large call graphs + embeddings; holding multiple systems at once OOMs
      // at the 12GB heap cap (mirrors the ablation main loop's release).
      bundle.cases.length = 0;
      byFT.clear();
      if (typeof globalThis.gc === 'function') globalThis.gc();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const cellList = [...cells.values()].sort((a, b) => a.key.localeCompare(b.key));
    const analysis = analyzePrismSweep(PRISM_SWEEP_AXIS, cellList);

    // ── Per-cell AC@1 table ──
    console.log(`\n${'═'.repeat(80)}`);
    console.log('PRISM SWEEP — Per-Cell AC@1');
    console.log('═'.repeat(80));
    let header = 'Cell'.padEnd(30);
    for (const p of PRISM_SWEEP_AXIS) header += ` ${p.label}`.padEnd(16);
    console.log(header);
    console.log('─'.repeat(header.length));
    for (const c of cellList) {
      let row = c.key.padEnd(30);
      for (const a of c.accuracy) row += ` ${`${(a * 100).toFixed(0)}%`.padStart(4)}`.padEnd(16);
      console.log(row);
    }

    // ── Overall + zero-regression frontier ──
    console.log(`\n${'═'.repeat(80)}`);
    console.log('PRISM SWEEP — Overall + Zero-Regression Frontier');
    console.log(
      '  overall = mean over CELLS (fault types) — the published convention, and what BEST is chosen by.',
    );
    // The same statement the study's table prints, from the same owner — see `FOLD_CONVENTIONS`.
    for (const line of FOLD_CONVENTIONS) console.log(`  ${line}`);
    console.log('═'.repeat(80));
    for (const r of analysis.readings) {
      const tag =
        r.regressingCells.length === 0
          ? 'ZERO-REGRESSION'
          : `regress: ${r.regressingCells.join(', ')}`;
      console.log(
        `  ${r.point.label.padEnd(17)}  overall=${`${(r.overall * 100).toFixed(2)}%`.padStart(7)}` +
          `  cw=${`${(r.caseWeighted * 100).toFixed(2)}%`.padStart(7)}  ${tag}`,
      );
    }
    // The no-op control, asserted rather than trusted: `prismWeight = 0` multiplies the signal
    // away whatever the pooling, so the shipped-pooling and other-pooling weight-0 columns MUST
    // read the same in every cell. If they ever differ, the pooling is reaching the ranking at
    // weight zero and no column above is the configuration its label claims. BOTH curves are
    // checked, because a control that holds in one convention and not the other is not a control.
    const zeroColumns = analysis.readings.filter((r) => r.point.weight === 0);
    if (zeroColumns.length > 1) {
      const reference = zeroColumns[0]!;
      const drift = zeroColumns
        .slice(1)
        .filter(
          (r) => r.overall !== reference.overall || r.caseWeighted !== reference.caseWeighted,
        );
      console.log(
        drift.length === 0
          ? `\n  no-op control OK: ${zeroColumns.length} weight-0 columns agree to the float` +
              ` in both conventions (${reference.point.label} = ${(reference.overall * 100).toFixed(2)}%` +
              ` overall, ${(reference.caseWeighted * 100).toFixed(2)}% cw)`
          : `\n  no-op control FAILED: ${drift.map((r) => `${r.point.label}=${(r.overall * 100).toFixed(2)}%`).join(', ')}` +
              ` differ from ${reference.point.label}=${(reference.overall * 100).toFixed(2)}% — the pooling moves the ranking at weight 0`,
      );
    }
    if (analysis.bestZeroRegression) {
      const b = analysis.bestZeroRegression;
      console.log(
        `\n  BEST zero-regression point: ${b.point.label}  prismWeight=${b.point.weight} prismPooling=${b.point.pooling}` +
          `  overall=${(b.overall * 100).toFixed(2)}%  gain=${`${(b.gain * 100).toFixed(2)}pp`}`,
      );
    } else {
      console.log('\n  No zero-regression point (empty input).');
    }

    // ── JSON for artifact upload + local merge ──
    const output = {
      suite: suiteFilter,
      poolings: PRISM_SWEEP_POOLINGS,
      weights: PRISM_SWEEP_WEIGHTS,
      axis: PRISM_SWEEP_AXIS,
      cells: cellList,
      analysis: {
        overall: analysis.overall,
        caseWeightedOverall: analysis.caseWeightedOverall,
        zeroRegressionPoints: analysis.zeroRegressionPoints,
        bestZeroRegression: analysis.bestZeroRegression,
      },
    };
    const outputPath = join(__dirname, '..', '..', `prism-sweep-${suiteFilter}.json`);
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nResults saved: ${outputPath}`);
  }

  if (prismSweep) {
    if (systemGroups.size === 0) {
      console.log('No benchmark cases discovered. Exiting.');
      return;
    }
    await runPrismSweep();
    return;
  }

  console.log('\n═'.repeat(80));
  console.log('Running Ablation');

  if (systemGroups.size === 0) {
    console.log('No benchmark cases discovered. Exiting.');
    return;
  }
  console.log('═'.repeat(80));

  // ── Run Ablation ──
  // Process ONE system at a time: load its bundle, run ALL configs on it,
  // release, then next system.  Pre-building all systems at once holds
  // 150+ RE2 cases (call graphs + trace spans + Zhipu embeddings) in memory
  // → OOM on public runners (TrainTicket has 68-69 services/case).
  const allRuns: AblationRun[] = CONFIGS.map((c) => ({
    flags: c.flags,
    overrides: c.overrides ?? {},
    latencyView: c.latencyView ?? DEFAULT_LATENCY_SOURCE,
    label: c.label,
    results: new Map<string, AblationResult>(),
  }));

  /**
   * Per-system input census, read by the 0.0-verdict block after the table.
   *
   * Declared OUTSIDE the system loop on purpose: the loop releases each system's cases, so the census must
   * outlive the population it counted, and the verdict block runs after every system is done.
   */
  const coverageBySystem = new Map<string, InputCoverage>();

  /**
   * Per-system latency-route census, for the same reason and read by the same block.
   *
   * A row that varies the CORPUS has to be vouched for against the coverage of the view it varied: the
   * published view's array is empty, so a corpus row's zero judged against `input-coverage`'s `latency` count
   * would be called STARVED whether or not the view it actually ran on had rows in every case.
   */
  const latencyRoutesBySystem = new Map<string, LatencyRouteCensus>();

  for (const [systemName, metas] of systemGroups) {
    console.log(`\n${'═'.repeat(60)}`);

    // ── Pre-build this system's bundle ONCE ──
    console.log(`  Pre-building ${systemName} …`);
    const bundle = await loadSystemBundle(systemName, metas);
    console.log(`  Pre-built: ${systemName} → ${bundle.cases.length} cases`);
    // WHAT THE DIRECTION CHANNELS ACTUALLY HOLD, before anything is measured with them. A weight ablated
    // against an empty map yields zero, and zero from an empty input is not evidence that the term does
    // nothing — the distinction the artifact could not draw until this line existed.
    console.log(
      `  ${formatDirectionalCoverage(summarizeDirectionalCoverage(bundle.cases), systemName)}`,
    );
    // The census that makes every 0.0 below readable: a term whose channel is empty here cannot be measured
    // on this system, only reported, and the two cases look identical in the results table without this.
    for (const line of formatInputCoverage(bundle.coverage, systemName)) console.log(line);
    // …and the census that says WHICH mechanism emptied the latency channel, which `input-coverage` cannot:
    // the capped list's own pre/post split, and the row count each of the three derivations produced.
    for (const line of formatLatencyRoutes(bundle.latencyRoutes, systemName)) console.log(line);
    coverageBySystem.set(systemName, bundle.coverage);
    latencyRoutesBySystem.set(systemName, bundle.latencyRoutes);

    // Split cases by fault type. The SPLIT is the same for every config on this system, but the CASES are not:
    // the corpus rows vary which view of `edgeLatency` the engine receives, and the split is rebuilt per config
    // from that config's own cases rather than shared, so a row cannot rank on a corpus its label does not name.
    let byFT = new Map<string, BenchmarkCase[]>();

    for (let ci = 0; ci < CONFIGS.length; ci++) {
      const config = CONFIGS[ci]!;
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Running: ${config.label}`);
      console.log(`Flags: ${JSON.stringify(config.flags)}`);
      // The flags are the study's inputs; this is the configuration they produce, in the same shape the
      // golden half's artifact carries. Without it the row cannot be attributed: the artifact named twelve
      // booleans and no weight at all.
      console.log(formatAblationConfigLine(config.flags, config.overrides));
      // …and the CORPUS, for the same reason one level down: the flags and the weights can be identical while
      // two rows rank on different arrays, and a row whose corpus is an inference is a row that cannot be
      // attributed. Printed for every row, including the ones that take the published view.
      const latencyView = config.latencyView ?? DEFAULT_LATENCY_SOURCE;
      console.log(`Corpus: edgeLatency from ${latencyView}`);
      console.log(`${'─'.repeat(60)}`);

      console.log(`  ${systemName}: ${bundle.cases.length} cases`);

      byFT = new Map<string, BenchmarkCase[]>();
      for (const c of applyLatencyView(bundle.cases, bundle.latencyViews, latencyView)) {
        const ft = (c.groundTruth?.faultType ?? 'unknown').toLowerCase();
        if (!byFT.has(ft)) byFT.set(ft, []);
        byFT.get(ft)!.push(c);
      }

      // ── Wire feature flags into this config's engine ──
      // Collision aggregation: toggles TreePruner.enableCollisionAggregation.
      // The three ranking signals map to collisionWeight/topoWeight/logWeight.
      const container = buildContainer(config.flags, config.overrides);
      // Self-learning: a SHARED calibrator across this config's reps/Fts so
      // weight updates from earlier cases feed back into later ones.
      const calibrator = config.flags.selfLearning ? new WeightCalibrator() : undefined;

      // The four CASE-WEIGHTED folds, as cells rather than as four hand-rolled accumulators. They used to be
      // `sum(value × cases) / cases` written out four times — the exact re-implementation
      // `runners/suite-accuracy.ts` was written to remove, and this file is the first offender its docblock
      // names. Cells are pushed in the order those accumulators added them, so folding them with the owner is
      // value-preserving to the last bit. `totalCases` stays a separate count because the artifact PRINTS it
      // (`N case-reps`), which is a population and not a fold.
      const a1Cells: AccuracyCell[] = [];
      const a5Cells: AccuracyCell[] = [];
      const laCells: AccuracyCell[] = [];
      const taCells: AccuracyCell[] = [];
      let totalCases = 0,
        totalFailures = 0,
        totalDuration = 0;
      // One sample per (fault type, repetition) cell: the population the PUBLISHED convention folds.
      // Collected rather than folded as we go precisely because the fold must not be the case-weighted
      // one — the whole point of the pair is that the same cells give two different, nameable numbers.
      const ftSamples: number[] = [];
      // ⚠️ Its `cases` is a **case-REP** count, not a case count, because this map is allocated OUTSIDE the
      // repetition loop below and accumulated INSIDE it: after three repetitions every entry holds
      // `3 x ftCases.length`. That is the right population for the percentage printed beside it (a mean over
      // case-reps), and it is what makes the running weighted mean below correct — `existing.cases` is in
      // case-reps and `ftMetric.cases` is in cases, and their 2:1 ratio after two reps is exactly the weight
      // ratio a mean over three samples needs. What was missing is the UNIT: this count is printed as a bare
      // `(N)` in a table whose sibling line prints `(N cases)`, so a reader reconciles them by dividing by
      // `REPETITIONS` or concludes the corpus is three times its size. The header states it now.
      const perFaultType = new Map<string, { cases: number; accuracy: number }>();
      const reps: number[] = [];

      for (let rep = 0; rep < REPETITIONS; rep++) {
        let repA1 = 0,
          repCases = 0;

        for (const [ft, ftCases] of byFT) {
          if (ftCases.length === 0) continue;

          // ── Apply feature flags ──

          // Trace topology augmentation: when enabled and trace span
          // data is present (RE2/RE3), augment the call graph with
          // observed parent-child relationships from traces. Traces are
          // loaded lazily per fault-type group (NOT pre-loaded) so peak
          // memory stays bounded — RE2 traces.csv files are large enough
          // that holding every case's spans at once OOMs.
          const traceOpts = config.flags.extraTraceValidation
            ? {
                enabled: true,
                pruneUnobserved: true,
                discoverNewEdges: false,
                minCallFrequency: 0,
                spans: [],
              }
            : undefined;

          // Attach per-case traces only when this config needs them; other
          // configs reuse the plain (trace-free) cases.
          const suiteCases = config.flags.extraTraceValidation
            ? ftCases.map((c) => {
                const dirPath = bundle.caseDirMap.get(c.id);
                return { ...c, traces: dirPath ? loader.loadTraces(dirPath) : undefined };
              })
            : ftCases;
          const suite: BenchmarkSuite = {
            name: `${systemName}-${ft}`,
            cases: suiteCases,
            totalCases: suiteCases.length,
          };

          const runner = new BenchmarkRunner(container, classifier, traceOpts, calibrator);

          const result = await runner.runSuite(suite);
          repCases += suite.cases.length;

          const cellCases = suite.cases.length;
          totalCases += cellCases;
          a1Cells.push({ accuracy: result.avgTop1, cases: cellCases });
          a5Cells.push({ accuracy: result.avgTop5, cases: cellCases });
          laCells.push({ accuracy: result.locationAccuracy, cases: cellCases });
          taCells.push({ accuracy: result.typeAccuracy, cases: cellCases });
          totalFailures += result.failures.length;
          totalDuration += result.duration;
          // The suite is one fault type by construction, so this IS that cell's accuracy — the same
          // number the case-weighted accumulation above consumes, folded the other way.
          ftSamples.push(result.avgTop1);

          // Per-fault-type
          const existing = perFaultType.get(ft) ?? { cases: 0, accuracy: 0 };
          let ftAcc: number;
          const ftMetric = result.perFaultType.get(ft);
          if (ftMetric) {
            ftAcc =
              (existing.accuracy * existing.cases + ftMetric.accuracy * ftMetric.cases) /
              Math.max(1, existing.cases + ftMetric.cases);
          } else {
            ftAcc = existing.accuracy;
          }
          perFaultType.set(ft, { cases: existing.cases + ftCases.length, accuracy: ftAcc });
        }

        reps.push(repCases > 0 ? repA1 / repCases : 0);

        if (REPETITIONS > 1) {
          const pct = (((rep + 1) / REPETITIONS) * 100).toFixed(0);
          process.stdout.write(`  Rep ${rep + 1}/${REPETITIONS} (${pct}%)... `);
        }
      }

      // Both conventions, from the owner: `caseWeightedMean` for the four numbers reported beside the
      // headline, `meanOverFaultTypes` for the headline itself. The empty-population arm returns `0` in both,
      // which is exactly the `totalCases > 0 ? … : 0` guard these four replaced.
      const avgA1 = caseWeightedMean(a1Cells);
      const avgA5 = caseWeightedMean(a5Cells);
      const avgLA = caseWeightedMean(laCells);
      const avgTA = caseWeightedMean(taCells);
      // The headline. `avgA1` above is the case-weighted one and is reported beside it, never instead.
      const publishedA1 = meanOverFaultTypes(ftSamples);

      allRuns[ci]!.results.set(systemName, {
        publishedA1,
        aTop1: avgA1,
        aTop5: avgA5,
        la: avgLA,
        ta: avgTA,
        totalCases,
        duration: totalDuration,
        failures: totalFailures,
        perFaultType,
        reps,
      });

      console.log(
        `  ${systemName}: A@1=${(publishedA1 * 100).toFixed(1)}% (published, ${ftSamples.length} type-cells)` +
          `  cw=${(avgA1 * 100).toFixed(1)}% (case-weighted, ${totalCases} case-reps)` +
          `  A@5=${(avgA5 * 100).toFixed(1)}% LA=${(avgLA * 100).toFixed(1)}% TA=${(avgTA * 100).toFixed(1)}%` +
          `  (${totalFailures} failures, ${totalDuration}ms)`,
      );

      // Yield to event loop after each config so GC can collect temporary
      // BenchmarkSuite / RunResult objects before the next config starts.
      if (typeof globalThis.gc === 'function') {
        globalThis.gc();
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    } // end config loop

    // Release this system's bundle before loading the next system.
    // Each RE2 system holds 50 cases × call graphs + trace spans + embeddings;
    // releasing prevents accumulation across systems (OOM on TrainTicket).
    bundle.cases.length = 0;
    byFT.clear();
    if (typeof globalThis.gc === 'function') globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } // end system loop

  // ── Results Table ──
  console.log(`\n${'═'.repeat(80)}`);
  console.log('ABLATION RESULTS');
  console.log(`${'═'.repeat(80)}`);

  // Header — use system groups as dataset keys
  const datasets = [...systemGroups.keys()];
  let header = `${'Configuration'.padEnd(30)}`;
  for (const ds of datasets) header += ` ${ds.padEnd(16)}`;
  header += ' AVG    CW';
  console.log(header);
  // The two folds, named on the artifact itself from ONE owner. A reader of the artifact is otherwise left to
  // guess which convention a number is in — the guess that cost three runs of investigation — and the rule
  // used to name the suites that satisfy it, which is a statement that goes stale when a corpus moves.
  for (const line of FOLD_CONVENTIONS) console.log(`  ${line}`);
  console.log(header);
  console.log('─'.repeat(80));

  const baseline = allRuns[0]!;
  const baselineAvgs = new Map<string, number>();
  for (const [ds, r] of baseline.results) baselineAvgs.set(ds, r.publishedA1);

  for (const run of allRuns) {
    let row = `${run.label.padEnd(30)}`;
    let totalA1 = 0;
    let totalCw = 0;
    let count = 0;
    for (const ds of datasets) {
      const r = run.results.get(ds);
      // The PUBLISHED convention — the one the nine published cells are in. The case-weighted number
      // this column used to carry is the `CW` column at the end of the row.
      const val = r ? (r.publishedA1 * 100).toFixed(1) + '%' : '     N/A';
      row += ` ${val.padEnd(16)}`;
      if (r) {
        totalA1 += r.publishedA1;
        totalCw += r.aTop1;
        count++;
      }
    }
    // The row average is the mean over the SYSTEMS in this row — a third population, neither the fault
    // types nor the cases, and named here so it is not mistaken for either. It is computed once: the
    // delta used to recompute the same quotient a second time under a different name.
    const rowAvg = count > 0 ? totalA1 / count : 0;
    const rowCwAvg = count > 0 ? totalCw / count : 0;
    const avg = count > 0 ? (rowAvg * 100).toFixed(1) + '%' : 'N/A';
    const cwAvg = count > 0 ? (rowCwAvg * 100).toFixed(1) + '%' : 'N/A';

    // Δ vs baseline, over the same population.
    const baseAvg = count > 0 ? [...baselineAvgs.values()].reduce((s, v) => s + v, 0) / count : 0;
    const delta = rowAvg - baseAvg;
    const deltaStr = delta >= 0 ? `+${(delta * 100).toFixed(1)}%` : `${(delta * 100).toFixed(1)}%`;
    row += ` ${avg.padEnd(6)} ${cwAvg.padEnd(6)} Δ${deltaStr}`;
    console.log(row);
  }

  console.log(`${'═'.repeat(80)}`);

  // ── Where every 0.0 came from: STARVED or INERT ──
  // The register's requirement in its own words — *a zero is only readable if the artifact says whether it is
  // starved or inert* — and the table above cannot say, because both render as `Δ+0.0%`. This block can,
  // because it meets each row's varied TERMS (diffed from its own configuration line) with the system's
  // channel census. `STARVED` means the input was absent, so the zero says nothing about the term; `INERT`
  // means the input was present and the ranking did not move, which is the term's verdict.
  console.log(`\n${'═'.repeat(80)}`);
  console.log('0.0 VERDICTS — STARVED (no input) vs INERT (input present, ranking unmoved)');
  console.log('═'.repeat(80));
  const baselineLine = formatAblationConfigLine(baseline.flags, baseline.overrides);
  for (const run of allRuns) {
    const changed = configDiff(baselineLine, formatAblationConfigLine(run.flags, run.overrides));
    // A row can vary the corpus and no engine term at all, and such a row is NOT uninformative: it is the only
    // kind that can ask what a term is worth when its input exists. Naming the axis here — rather than letting
    // the loop skip it — is what keeps the block total over the battery.
    const variesCorpus = run.latencyView !== DEFAULT_LATENCY_SOURCE;
    if (changed.length === 0 && !variesCorpus) continue;
    const axes = variesCorpus ? [...changed, `corpus:edgeLatency(${run.latencyView})`] : changed;
    const per = datasets.map((ds) => {
      const row = run.results.get(ds);
      const base = baseline.results.get(ds);
      const cov = coverageBySystem.get(ds);
      const routes = latencyRoutesBySystem.get(ds);
      if (!row || !base || !cov) return `${ds}:N/A`;
      const delta = row.publishedA1 - base.publishedA1;
      // A row may vary several terms; the verdicts are reported in the order the config line states them,
      // because collapsing two channels into one word would be a summary of a fact nobody measured.
      const verdicts = changed.map((term) => {
        const channel = TERM_CHANNELS[term];
        // A term with no channel is a SWITCH, a FLOOR or a FORM SELECTOR. It multiplies no input, so it cannot
        // be starved of one, and its zero is a statement that the ordering did not move — INERT. Reporting it as
        // an unknown channel left exactly the rows this block exists for unreadable: `+Rank Normalization` and
        // `+Idle Transient Suppression` both read `Δ+0.0%` on RE1 with nothing beside them.
        return readZero(delta, channel ? channelCases(cov, channel) : cov.cases);
      });
      // …and the corpus axis, vouched for against the coverage of the view this row actually ran on. Without
      // this the row that changes the latency input would be judged against `latency`'s count under the
      // PUBLISHED view — a count that is zero by the derivation defect, which is the very claim the row tests.
      if (variesCorpus && routes) {
        const casesOfView =
          run.latencyView === 'whole-file'
            ? routes.wholeFileCases
            : run.latencyView === 'capped'
              ? routes.cappedCases
              : routes.shippedCases;
        verdicts.push(readZero(delta, casesOfView));
      }
      return `${ds}:${[...new Set(verdicts)].join('+')}`;
    });
    console.log(`  ${run.label.padEnd(46)} varies=${axes.join(',')}`);
    console.log(`    ${per.join('  ')}`);
  }

  // ── Per-fault-type breakdown ──
  // Reconstruct fault-type sets from all runs' perFaultType results.
  for (const systemName of systemGroups.keys()) {
    // Collect fault types observed for this system across all configs.
    const ftSet = new Set<string>();
    for (const run of allRuns) {
      const res = run.results.get(systemName);
      if (res) {
        for (const ft of res.perFaultType.keys()) {
          ftSet.add(ft);
        }
      }
    }
    const faultTypes = [...ftSet].sort();

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`${systemName} — Per-Fault-Type A@1 Breakdown`);
    // The unit, stated where it is consumed. Without this line the counts below collide with the `N cases` the
    // loader prints for the same system: this table's `(n)` is CASES x REPETITIONS, because the accumulator is
    // allocated outside the repetition loop, and the two numbers differ by exactly `REPETITIONS`. A reader who
    // does not know that cannot tell a balanced corpus from a mis-loaded one — and the register quotes these
    // counts as the evidence that a sample is measurable.
    console.log(
      `  (n) = case-reps: cases x REPETITIONS (${REPETITIONS}) — the population each percentage is a mean over.`,
    );
    console.log(`${'─'.repeat(80)}`);

    let ftHeader = `${'Configuration'.padEnd(30)}`;
    for (const ft of faultTypes) ftHeader += ` ${ft.padEnd(10)}`;
    console.log(ftHeader);

    for (const run of allRuns) {
      const r = run.results.get(systemName);
      let ftRow = `${run.label.padEnd(30)}`;
      if (r) {
        for (const ft of faultTypes) {
          const ftData = r.perFaultType.get(ft);
          const val = ftData
            ? (ftData.accuracy * 100).toFixed(0) + '%' + `(${ftData.cases})`.padStart(5)
            : '   N/A    ';
          ftRow += ` ${val.padEnd(10)}`;
        }
      }
      console.log(ftRow);
    }
  }

  // ── Save results ──
  // Total cases across all loaded bundles (sum of system group meta counts).
  const totalCaseCount = [...systemGroups.values()].reduce((s, m) => s + m.length, 0);
  const resultsJson = {
    timestamp: new Date().toISOString(),
    systemFilter,
    repetitions: REPETITIONS,
    totalCases: totalCaseCount,
    datasets: datasets,
    runs: allRuns.map((r) => ({
      label: r.label,
      flags: r.flags,
      overrides: r.overrides,
      results: Object.fromEntries(
        [...r.results.entries()].map(([ds, res]) => [
          ds,
          {
            publishedA1: res.publishedA1,
            aTop1: res.aTop1,
            aTop5: res.aTop5,
            la: res.la,
            ta: res.ta,
            totalCases: res.totalCases,
            duration: res.duration,
            failures: res.failures,
            reps: res.reps,
            perFaultType: Object.fromEntries(res.perFaultType),
          },
        ]),
      ),
    })),
  };

  const outputPath = join(__dirname, '..', '..', 'ablation-results.json');
  writeFileSync(outputPath, JSON.stringify(resultsJson, null, 2));
  console.log(`\nResults saved: ${outputPath}`);
}

main().catch((err) => {
  console.error('Ablation study failed:', err);
  process.exit(1);
});
