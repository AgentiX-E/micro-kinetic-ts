/**
 * Held-out validation for the routing frontier, and the benchmark's PRIOR FLOOR.
 *
 * Two questions this module answers, and the second arrived from outside this repository.
 *
 * **1. Is the routing lead real?** Iteration 77 re-took the routing probe on the full corpus and found a
 * *deployable* zero-regression router on RE3 — `engine-margin < 0.5671 -> prism`, worth +13.33 pp with zero
 * regressing cells. That threshold was chosen by the probe to maximise the gain **on all 90 cases at once**, so
 * the number is an IN-SAMPLE optimum and the verdict document's own caution applies to it: *one fitted threshold
 * on 90 cases with no held-out validation*. The only way to find out is to re-fit on a train fold and score on a
 * disjoint test fold, which is what {@link crossValidateRouter} does. An in-sample optimum and a held-out estimate
 * are different quantities and this module reports both, because their DIFFERENCE is the amount of fitting.
 *
 * **2. What is the floor our headline must clear?** arXiv:2609.27069 (a controlled audit of this benchmark) records
 * that RCAEval *"injects faults into only five services per system while exposing 12 to 70 in telemetry"*, so a
 * ranker that reads no telemetry at all is not a coin flip: on the benchmark's own `Avg@5` its score is **0.488**,
 * against 0.137 for uniform-random, and it *"collapses to 0.192 across systems"*. That is a statement about the
 * benchmark, and it conditions every Top-1 number on it — including ours. {@link priorFloor} measures the
 * analogous quantity for OUR metric (service Top-1) on OUR corpus, **held out**, so the margin we report is the
 * margin over a ranker that reads nothing rather than the margin over a coin.
 *
 * Pure functions throughout: every arm here is a decision that can be tested without a run.
 *
 * @module benchmarks/router-validation
 */

/** One case as the routing probe records it: both engines' top-2, and the truth. */
export interface RoutingCase {
  readonly caseId: string;
  readonly cell: string;
  readonly faultType: string;
  readonly truth: string;
  readonly engineTop1: string;
  readonly engineTop1Score: number;
  readonly engineTop2Score: number;
  readonly prismTop1: string;
  readonly prismTop1Score: number;
  readonly prismTop2Score: number;
}

/** Whether the engine's top-1 is the truth. */
export const engineCorrect = (c: RoutingCase): boolean => c.engineTop1 === c.truth;

/** Whether PRISM's top-1 is the truth. */
export const prismCorrect = (c: RoutingCase): boolean => c.prismTop1 === c.truth;

/** Whether the two engines disagree — the only cases a router can move. */
export const disjoint = (c: RoutingCase): boolean => c.engineTop1 !== c.prismTop1;

/** The gap between the engine's first and second candidate, i.e. how sure it is. */
export const engineMargin = (c: RoutingCase): number => c.engineTop1Score - c.engineTop2Score;

/** The gap between PRISM's first and second candidate. */
export const prismMargin = (c: RoutingCase): number => c.prismTop1Score - c.prismTop2Score;

/**
 * The INFERENCE-TIME signals a router may read.
 *
 * A `Record` rather than a union, so a caller that forgets one is a type error at the one place they are read —
 * the shape `PRISM_POOLINGS` and `LATENCY_VIEWS` use, for the same reason.
 *
 * **Nothing here reads `truth`.** An earlier draft of this list included a `per-cell-oracle`, which is what the
 * probe reports as the best zero-regression router on RE1 and RE2 — and it is not deployable, because a
 * (system x fault-type) cell is not known at inference time either. Keeping the oracle OUT of this list is the
 * difference between "a router" and "a lookup table".
 */
export const ROUTER_SIGNALS: Readonly<
  Record<'engine-margin' | 'prism-margin' | 'prism-score', true>
> = {
  'engine-margin': true,
  'prism-margin': true,
  'prism-score': true,
};

/** A signal a router may read. */
export type RouterSignal = keyof typeof ROUTER_SIGNALS;

/** The value a signal takes on a case. */
export function signalValue(c: RoutingCase, signal: RouterSignal): number {
  switch (signal) {
    case 'engine-margin':
      return engineMargin(c);
    case 'prism-margin':
      return prismMargin(c);
    case 'prism-score':
      return c.prismTop1Score;
  }
}

/** A router: switch to PRISM when the signal is below the threshold. */
export interface ThresholdRouter {
  readonly signal: RouterSignal;
  readonly threshold: number;
}

/** Which engine a router picks for a case. */
export function route(c: RoutingCase, router: ThresholdRouter): 'engine' | 'prism' {
  return signalValue(c, router.signal) < router.threshold ? 'prism' : 'engine';
}

/** Whether the router's chosen engine is correct on this case. */
export function routedCorrect(c: RoutingCase, router: ThresholdRouter): boolean {
  return route(c, router) === 'prism' ? prismCorrect(c) : engineCorrect(c);
}

/** Accuracy of a fixed router (the engine alone is `threshold = -Infinity`). */
export function accuracy(cases: readonly RoutingCase[], router: ThresholdRouter): number {
  if (cases.length === 0) return 0;
  let hit = 0;
  for (const c of cases) if (routedCorrect(c, router)) hit++;
  return hit / cases.length;
}

/**
 * The best threshold on a set of cases, by exhaustive scan over candidate split points.
 *
 * The candidate set is the observed signal values themselves (plus one below the minimum, which is the
 * "always engine" arm), because the optimum of a step function always sits at a breakpoint — so the scan is exact
 * and not a grid. Ties resolve to the SMALLER threshold, deterministically, so two runs on the same fold agree.
 */
export function fitThreshold(cases: readonly RoutingCase[], signal: RouterSignal): ThresholdRouter {
  const values = cases.map((c) => signalValue(c, signal));
  const candidates = [Number.NEGATIVE_INFINITY, ...[...values].sort((a, b) => a - b)];
  let best: ThresholdRouter = { signal, threshold: Number.NEGATIVE_INFINITY };
  let bestScore = accuracy(cases, best);
  for (const threshold of candidates) {
    const router: ThresholdRouter = { signal, threshold };
    const score = accuracy(cases, router);
    if (score > bestScore) {
      bestScore = score;
      best = router;
    }
  }
  return best;
}

/**
 * `k` disjoint folds, assigned by position so the split is deterministic and reproducible.
 *
 * Deterministic on purpose: a fold assignment that varies between runs would make a held-out claim
 * irreproducible, and this repository has already paid once for a case SET that depended on the filesystem.
 */
export function folds(n: number, k: number): number[][] {
  if (k < 2) throw new Error(`folds: k must be >= 2, got ${k}`);
  const out: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) out[i % k]!.push(i);
  return out;
}

/** What a cross-validation reports: the in-sample optimum and the held-out estimate, side by side. */
export interface CrossValidation {
  readonly signal: RouterSignal;
  readonly folds: number;
  /** The best accuracy achievable on the FULL set — the number a probe reports, and it is optimistic. */
  readonly inSample: number;
  /** Accuracy of the baseline the router starts from, measured on the full set. */
  readonly baseline: number;
  /** Mean accuracy over folds, each scored with a router fitted on the other folds only. */
  readonly heldOut: number;
  /** Per-fold held-out accuracy, so the spread is visible rather than only the mean. */
  readonly perFold: readonly number[];
  /** The thresholds each fold chose — how much the fit moves, which is a direct read on stability. */
  readonly thresholds: readonly number[];
  /**
   * `heldOut - baseline`, the quantity a decision must be taken on.
   * **Not** `inSample - baseline`, which is what a frontier table reports by default.
   */
  readonly heldOutGain: number;
  /**
   * `inSample - heldOut`: how much larger the whole-set optimum is than the fold mean.
   *
   * **Its sign is NOT guaranteed, and that is a fact about the estimator rather than a defect.** `heldOut` is the
   * mean of `k` accuracies, each from a router fitted on a *different* train set, so a fold whose cases happen to
   * be easy can score above the whole-set optimum. `inSample` is optimistic for a **fixed** router chosen on all
   * the data; it is not a ceiling on a fold mean. Reporting both, and never asserting `inSample >= heldOut`, is
   * the difference between a held-out estimate and a wish.
   */
  readonly fittingAllowance: number;
}

/**
 * Cross-validate one signal's threshold router.
 *
 * Each fold fits on the other `k-1` folds and scores on the held-out one, so no case is ever scored by a router
 * that saw it. The baseline is the engine alone, measured on the full set — the same quantity the in-sample arm
 * starts from, so the two gains are comparable.
 */
export function crossValidateRouter(
  cases: readonly RoutingCase[],
  signal: RouterSignal,
  k: number,
): CrossValidation {
  const partition = folds(cases.length, k);
  const alwaysEngine: ThresholdRouter = { signal, threshold: Number.NEGATIVE_INFINITY };
  const perFold: number[] = [];
  const thresholds: number[] = [];
  for (const testIdx of partition) {
    const test = new Set(testIdx);
    const train = cases.filter((_, i) => !test.has(i));
    const testCases = testIdx.map((i) => cases[i]!);
    // An empty TRAIN fold cannot fit anything; the honest answer is the baseline, not a crash.
    const router = train.length === 0 ? alwaysEngine : fitThreshold(train, signal);
    thresholds.push(router.threshold);
    perFold.push(accuracy(testCases, router));
  }
  const heldOut = perFold.reduce((s, x) => s + x, 0) / perFold.length;
  const baseline = accuracy(cases, alwaysEngine);
  const inSample = accuracy(cases, fitThreshold(cases, signal));
  return {
    signal,
    folds: k,
    inSample,
    baseline,
    heldOut,
    perFold,
    thresholds,
    heldOutGain: heldOut - baseline,
    fittingAllowance: inSample - heldOut,
  };
}

/** The floor a ranker that reads NO telemetry can reach, and it is measured held out. */
export interface PriorFloor {
  readonly cases: number;
  /** Distinct root-cause services in the population — the size of the candidate set the truth draws from. */
  readonly truths: number;
  /** Accuracy of predicting the single most frequent culprit, fitted on ALL cases — optimistic. */
  readonly inSample: number;
  /** Accuracy of that rule with the culprit fitted on the other folds only. */
  readonly heldOut: number;
  /** What a uniform-random ranker gets over the candidate set, for contrast. */
  readonly uniform: number;
  /** Which services the folds disagreed about, so an unstable prior is visible. */
  readonly perFoldWinners: readonly string[];
}

/**
 * The telemetry-free floor, measured the same way a router is.
 *
 * `arXiv:2609.27069` establishes that this benchmark's candidate surface is small (faults land on only five
 * services per system while telemetry exposes 12 to 70), so a ranker that reads nothing is a serious baseline and
 * not a straw man — its own published figure is 0.488 on `Avg@5` against 0.137 for uniform-random. This measures
 * the analogous quantity for service Top-1: always name the most frequent culprit, with that culprit fitted on a
 * train fold and scored on a disjoint one.
 *
 * `uniform` is `1 / |truths|`, which is the WEAKER floor and the one a naive report would quote. Reporting both
 * is the point: the benchmark's candidate set is the injected services, and no uniform ranker over them is what a
 * telemetry-free method actually achieves.
 */
export function priorFloor(cases: readonly RoutingCase[], k: number): PriorFloor {
  const partition = folds(cases.length, k);
  const winners: string[] = [];
  const perFold: number[] = [];
  for (const testIdx of partition) {
    const test = new Set(testIdx);
    const train = cases.filter((_, i) => !test.has(i));
    const testCases = testIdx.map((i) => cases[i]!);
    const modal = modalTruth(train);
    winners.push(modal);
    if (testCases.length === 0) continue;
    perFold.push(
      modal === '' ? 0 : testCases.filter((c) => c.truth === modal).length / testCases.length,
    );
  }
  const truths = new Set(cases.map((c) => c.truth)).size;
  return {
    cases: cases.length,
    truths,
    inSample:
      cases.length === 0
        ? 0
        : cases.filter((c) => c.truth === modalTruth(cases)).length / cases.length,
    heldOut: perFold.length === 0 ? 0 : perFold.reduce((s, x) => s + x, 0) / perFold.length,
    uniform: truths === 0 ? 0 : 1 / truths,
    perFoldWinners: winners,
  };
}

/** The most frequent truth, ties broken by name so the result is deterministic. */
export function modalTruth(cases: readonly RoutingCase[]): string {
  const counts = new Map<string, number>();
  for (const c of cases) counts.set(c.truth, (counts.get(c.truth) ?? 0) + 1);
  let best = '';
  let bestN = -1;
  for (const [name, n] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best;
}
