/**
 * The ablation runner's engine arguments, and the configuration line its artifact carries.
 *
 * ## Why this exists
 *
 * This is the repository's THIRD engine construction site — `run-fse26.ts`, `run-rcaeval.ts` and this one
 * — and the first two were each extracted for the same reason, recorded in
 * `fse26-engine-options.ts` and `rcaeval-engine-options.ts`: a runner that calls `main()` at import time
 * cannot be imported, so neither its option assembly nor the line that records it can be called by a test.
 * Here the cost was visible in the ARTIFACT rather than in the code: `ablation-re1-results` printed
 * `Running: BASELINE (all OFF)` and a JSON record of twelve BOOLEANS, and **not one weight**.
 *
 * That artifact is the register's ablation reference, and a reader could not reconstruct a single run from
 * it:
 *
 * - the flags are the ablation's INPUTS; the run is decided by the numbers they map to
 *   (`flags.logSignal ? 1.0 : 0.0`), and that mapping lived only in the runner's source;
 * - six weights were not named by the flags OR the artifact, because the construction site simply did not
 *   pass them — `latWeight`, `latMinRise`, `poolMetricPenaltyWeight`, `stabilityWeight`, `temporalWeight`
 *   and `onsetShape` fell through to `DEFAULT_TREE_PRUNER_OPTIONS`;
 * - so the row labelled **`BASELINE (all OFF)`** ran with the four terms that dominate the shipped ranking
 *   ON. The label asserted a configuration the run did not have.
 *
 * ## What the repair does, and does not, change
 *
 * The six inherited terms are now passed EXPLICITLY, read from the engine's own constants. Their values are
 * byte-identical to the defaults they were already receiving, so no number in the artifact may move — the
 * change is that the artifact can now SAY them. The flags keep their meaning, the base row keeps its
 * measurements, and the label is corrected because a label is a claim.
 *
 * The line is rendered with the same `signals: name=value …` shape the golden half's artifact carries, so
 * one reader covers both artifacts: the ablation's reference and the configuration it was measured against
 * are then comparable by eye, which they were not.
 *
 * @module benchmarks/ablation-engine-options
 */

import type { LogSignalMode, OnsetShape, PrismPooling } from '../../packages/tree/src/index.js';
import {
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_LOG_SIGNAL_MODE,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_PRISM_POOLING,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
} from '../../packages/tree/src/index.js';

/**
 * The features this study switches, one boolean each.
 *
 * These are the ablation's INPUTS and they are recorded as such: the `Flags:` line the artifact carries
 * keeps naming them, because the study's design is the flags. What was missing is the CONFIGURATION they
 * produce, which is what {@link formatAblationConfigLine} now states.
 */
export interface AblationFeatureFlags {
  /** Collision tree aggregator with Boltzmann Q(f,f). */
  collisionAggregation: boolean;
  /**
   * A SECOND, stricter trace-topology validation pass, applied by the runner on top of the corpus.
   *
   * This is **not** the shipped augmentation. The shipped corpus augments every trace-bearing case from its
   * own spans (`rcaeval-corpus.ts`, `{ minCallFrequency: 1 }`, always on), and its arm here was a DIFFERENT
   * option set (`{ minCallFrequency: 0, discoverNewEdges: false, pruneUnobserved: true }`). It was named
   * `traceAugmentation` until iteration 72, and that name is why the corpus difference went unnoticed: the
   * flag advertised the shipped step while being a separate one, so a run that "had trace augmentation ON"
   * and a run that "had it OFF" could both be missing the shipped step entirely. It measures `+0.0` on RE2
   * and RE3 — the only two suites that have traces — which is the signature of a mechanism that never
   * reaches the ranking.
   */
  extraTraceValidation: boolean;
  /** Online weight calibration (self-evolving). */
  selfLearning: boolean;
  /** Log signal: reward post-injection ERROR/FATAL volume (logWeight). */
  logSignal: boolean;
  /** Topological-source signal: reward no-anomalous-parent nodes (topoWeight). */
  topoSignal: boolean;
  /** Collision-energy signal: penalise upstream-inherited energy (collisionWeight). */
  collisionSignal: boolean;
  /** Direction-aware deviation: discount the DROP component (collapseDiscount). */
  collapseDiscount: boolean;
  /** Metric-direction signal: reward source RISE, penalise symptom COLLAPSE (riseWeight). */
  riseSignal: boolean;
  /** Trace span-activity rise signal: reward the service whose spans rise post-injection. */
  traceSignal: boolean;
  /** Rank-based anomaly-score normalization on large topologies (≥ 20 nodes). */
  rankNormalization: boolean;
  /** Extend the transient guard to idle-start transients (near-zero-baseline latency spike). */
  suppressIdleTransients: boolean;
  /** PRISM graph-free signal: reward the node anomalous in BOTH internal and external channels. */
  prismSignal: boolean;
}

/**
 * The first constructor argument: `Partial<TreePrunerOptions>`.
 *
 * The seven fields the study VARIES come first, then the seven it holds at the shipped value. The second
 * group exists because leaving them out is what made the artifact unreadable: an option that is not passed
 * is not absent from the run, it is INHERITED, and the artifact had no way to say either.
 */
export interface AblationSignalOptions {
  readonly enableCollisionAggregation: boolean;
  readonly collisionWeight: number;
  readonly topoWeight: number;
  readonly logWeight: number;
  readonly riseWeight: number;
  readonly traceWeight: number;
  readonly prismWeight: number;
  readonly logSignalMode: LogSignalMode;
  readonly latWeight: number;
  readonly latMinRise: number;
  readonly poolMetricPenaltyWeight: number;
  readonly stabilityWeight: number;
  readonly temporalWeight: number;
  readonly onsetShape: OnsetShape;
  readonly prismPooling: PrismPooling;
}

/** The second constructor argument: `Partial<TopologyFaultGraphConfig>`. */
export interface AblationTopologyOptions {
  readonly collapseDiscount: number;
  readonly rankNormalization: boolean;
  readonly suppressIdleTransients: boolean;
}

/** The engine's two constructor arguments, named so a test can assert both. */
export interface AblationEngineOptions {
  readonly signals: AblationSignalOptions;
  readonly topology: AblationTopologyOptions;
}

/**
 * The engine arguments this study OVERRIDES directly, rather than deriving from a boolean flag.
 *
 * ## Why the study needs this at all
 *
 * Every row of the battery was, until this, a point in a binary cube: twelve flags, each mapping to a
 * weight of `1.0` or `0.0`. That design cannot express a question about a term whose SHIPPED weight is
 * neither — and the three terms that dominate the shipped ranking are exactly those: `latWeight`
 * **0.561495**, `poolMetricPenaltyWeight` **0.0679**, `stabilityWeight` **0.007352**. They ran in every
 * configuration of the battery at full shipped strength, varying with none of it, so **their contribution
 * was not a zero — it was unmeasured**. `ABLATION_FINDINGS.md` v2 records that as the first of its two
 * gaps.
 *
 * ## `??`, not `||`, and that is the whole subtlety
 *
 * The value an override most needs to express is **zero** — "turn this term off" — and `||` cannot: `0` is
 * falsy, so `override || default` silently returns the shipped weight and the row labelled OFF measures ON.
 * An `undefined` field means "not overridden"; a `0` means "overridden to zero". Only `??` tells them apart.
 *
 * ## Why the name is not `...WeightOverrides`, and why that is not a rename for its own sake
 *
 * It was, and the battery's SECOND gap closes with a field that is not a weight. `prismPooling` selects
 * WHICH OF PRISM'S TWO COMBINATION FUNCTIONS the fused signal is built with, and the two are not close
 * variants: the controlled head-to-head (`docs/prism-head-to-head.md`, the identical 735 cases) reads
 * `additive` at **78.9% overall** while `conjunctive` resolves the code-level block at **RE3 TrainTicket
 * 76.7% against `additive`'s 33.3%** — the largest single-cell margin in the record, on the weakest cell of
 * the published nine. A record whose name promised numbers would have to lie about its member or keep the
 * axis out of the study, and keeping it out is precisely what the engine did: `combinePrismScore` takes the
 * pooling, the standalone evaluator dispatches it (`run-prism.ts --pooling conjunctive`), and **no engine
 * run, battery row or dispatch could select it** — the call site omitted the argument, so every one of them
 * combined additively whatever it asked for. The name now states what the record holds: an override of an
 * engine argument, keyed by that argument's own name — the vocabulary both artifacts are read in.
 *
 * @see ABLATION_FINDINGS.md in the docs repository
 */
export interface AblationEngineOverrides {
  /** Overrides `prismWeight` (the PRISM sweep's continuum). */
  readonly prismWeight?: number;
  /** Overrides `latWeight` — the per-edge-latency prior's strength. */
  readonly latWeight?: number;
  /** Overrides `latMinRise` — the floor below which a rise is masked out of that prior. */
  readonly latMinRise?: number;
  /**
   * Overrides `poolMetricPenaltyWeight` — the pool-dominance penalty.
   *
   * The two priors below were, until iteration 73, **the only shipped terms the battery had never varied**,
   * which the register recorded as its own residue: *the ledger's rows do not sum to the golden's, and the
   * never-ablated numeric terms are the candidates.* They are also the ONLY knobs that can move RE1, whose
   * channels are both starved — that suite has no `logs.csv` and no `traces.csv` at all, so every boolean
   * signal there has no input to act on and reads a zero that says nothing about the term's worth.
   */
  readonly poolMetricPenaltyWeight?: number;
  /** Overrides `stabilityWeight` — the decisive-stability prior. See above. */
  readonly stabilityWeight?: number;
  /**
   * Overrides `prismPooling` — which of PRISM's two combination functions the signal is built with.
   *
   * The one override here that is not a number, and the reason the record is not called
   * `...WeightOverrides`. Its effect is inert while `prismWeight` is 0, which is the shipped value, so the
   * rows that vary it also carry the flag that turns the signal on — otherwise the row would move nothing
   * and read as a measurement that the pooling does not matter.
   */
  readonly prismPooling?: PrismPooling;
}

/**
 * Build BOTH of the engine's constructor arguments for one ablation configuration.
 *
 * @param flags - The configuration's feature flags.
 * @param overrides - The engine arguments the study varies directly, if this configuration varies any.
 * @returns `signals` and `topology`.
 */
export function buildAblationEngineOptions(
  flags: AblationFeatureFlags,
  overrides: AblationEngineOverrides = {},
): AblationEngineOptions {
  return {
    signals: {
      enableCollisionAggregation: flags.collisionAggregation,
      collisionWeight: flags.collisionSignal ? 1.0 : 0.0,
      topoWeight: flags.topoSignal ? 1.0 : 0.0,
      logWeight: flags.logSignal ? 1.0 : 0.0,
      riseWeight: flags.riseSignal ? 1.0 : 0.0,
      traceWeight: flags.traceSignal ? 1.0 : 0.0,
      prismWeight: overrides.prismWeight ?? (flags.prismSignal ? 1.0 : 0.0),
      // The terms the study holds at the shipped value unless a row overrides them, named from their owners
      // so the artifact can state them. Passing them is value-identical to inheriting them, and that is the
      // point: an inherited option is a configuration the artifact used to be unable to describe. Every
      // overridable one reads its override through `??`, so an explicit `0` is honoured.
      logSignalMode: DEFAULT_LOG_SIGNAL_MODE,
      latWeight: overrides.latWeight ?? DEFAULT_LAT_WEIGHT,
      latMinRise: overrides.latMinRise ?? DEFAULT_LAT_MIN_RISE,
      poolMetricPenaltyWeight:
        overrides.poolMetricPenaltyWeight ?? DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
      stabilityWeight: overrides.stabilityWeight ?? DEFAULT_STABILITY_WEIGHT,
      temporalWeight: DEFAULT_TEMPORAL_WEIGHT,
      onsetShape: DEFAULT_ONSET_SHAPE,
      // The one override that is not a number. Read through `??` for the same reason the weights are: the
      // shipped pooling is a non-empty STRING, so `||` would silently discard an override the moment a
      // future pooling were spelled `''` — and, more to the point, one reading of the record for every
      // field beats two.
      prismPooling: overrides.prismPooling ?? DEFAULT_PRISM_POOLING,
    },
    topology: {
      collapseDiscount: flags.collapseDiscount ? 1.0 : 0.0,
      rankNormalization: flags.rankNormalization,
      suppressIdleTransients: flags.suppressIdleTransients,
    },
  };
}

/**
 * The configuration, as one line, in the shape the golden half's artifact uses.
 *
 * @param flags - The configuration's feature flags.
 * @param overrides - The engine arguments the study varies directly, if this configuration varies any.
 * @returns One line naming every field of both constructor arguments.
 */
export function formatAblationConfigLine(
  flags: AblationFeatureFlags,
  overrides: AblationEngineOverrides = {},
): string {
  const { signals, topology } = buildAblationEngineOptions(flags, overrides);
  // Every name here is the ENGINE's option name, not the study's flag name: the artifact has to be
  // joinable against the source it describes, and the fence holds it to exactly that. `collisionAggregation`
  // is the flag; `enableCollisionAggregation` is the option it sets.
  return (
    `signals: enableCollisionAggregation=${signals.enableCollisionAggregation} ` +
    `collisionWeight=${signals.collisionWeight} topoWeight=${signals.topoWeight} ` +
    `logWeight=${signals.logWeight} logSignalMode=${signals.logSignalMode} ` +
    `riseWeight=${signals.riseWeight} traceWeight=${signals.traceWeight} ` +
    `prismWeight=${signals.prismWeight} prismPooling=${signals.prismPooling} latWeight=${signals.latWeight} ` +
    `latMinRise=${signals.latMinRise} poolMetricPenaltyWeight=${signals.poolMetricPenaltyWeight} ` +
    `stabilityWeight=${signals.stabilityWeight} collapseDiscount=${topology.collapseDiscount} ` +
    `rankNormalization=${topology.rankNormalization} ` +
    `suppressIdleTransients=${topology.suppressIdleTransients} ` +
    `temporalWeight=${signals.temporalWeight} onsetShape=${signals.onsetShape}`
  );
}

/**
 * Which fields a row's configuration differs from the baseline's in.
 *
 * A row's label names the flag it turns on, and a flag is not a term: `logSignal: true` is `logWeight = 1`, and
 * `LAT OFF` is an override of a weight whose shipped value is neither 0 nor 1. Reading a `+0.0` therefore needs
 * the TERM, not the label — and the terms are already on both lines, so the difference between them is the
 * answer rather than a second copy of the mapping.
 *
 * @param baselineLine - `formatAblationConfigLine` of the baseline configuration.
 * @param rowLine - The same for the row.
 * @returns The field names whose values differ, in the order the baseline line states them.
 */
export function configDiff(baselineLine: string, rowLine: string): string[] {
  const values = (line: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const token of line.split(/\s+/)) {
      const eq = token.indexOf('=');
      if (eq > 0) out.set(token.slice(0, eq), token.slice(eq + 1));
    }
    return out;
  };
  const base = values(baselineLine);
  const row = values(rowLine);
  const changed: string[] = [];
  for (const [name, value] of base) {
    if (row.has(name) && row.get(name) !== value) changed.push(name);
  }
  return changed;
}
