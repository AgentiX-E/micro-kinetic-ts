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
 * **3. Under WHICH criterion?** A number is only a measurement of a question, and question 1 as first written
 * asked for accuracy — while the probe that found the lead had already decided it under a STRICTER rule: the
 * zero-regression gate `analyzeRoutingProbe` applies to every candidate, because a router that lifts the mean by
 * sinking one (system x fault-type) cell is not a router anyone can ship. Scoring a candidate under a weaker
 * criterion than the one that admitted it reports a gain the decision was never allowed to take. So every fit and
 * every cross-validation here takes a {@link FitConstraint} as a REQUIRED argument: the axis is named at each call
 * site rather than defaulted, because an option the caller may omit is an open axis, and this repository has
 * already paid for one of those.
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
 * The criteria a threshold may be chosen under.
 *
 * A `Record` rather than a union, for the reason `ROUTER_SIGNALS` and `PRISM_POOLINGS` are: a caller that forgets
 * one is a type error at the one place they are read.
 */
export const FIT_CONSTRAINTS: Readonly<Record<'max-accuracy' | 'zero-regression', true>> = {
  /** The unconstrained optimum. What a frontier table reports by default, and it is optimistic twice over. */
  'max-accuracy': true,
  /** The highest accuracy among routers that regress NO cell — the rule the probe's frontier applies. */
  'zero-regression': true,
};

/** The criterion a threshold is chosen under. */
export type FitConstraint = keyof typeof FIT_CONSTRAINTS;

/** The always-engine arm: the baseline every router is read against, and the fallback when nothing is admissible. */
export function alwaysEngine(signal: RouterSignal): ThresholdRouter {
  return { signal, threshold: Number.NEGATIVE_INFINITY };
}

/**
 * The unit of REGRESSION accounting: the (system x fault-type) pair.
 *
 * The probe's `regressionCellKey` builds the identical string, and the duplication is deliberate rather than
 * tolerated — `benchmarks/package.json` does not depend on `@agentix-e/micro-kinetic`, and the vitest alias that
 * resolves the package for tests is absent from `benchmarks/tsconfig.json`, so importing the owner across the
 * boundary would be an undeclared dependency that fails the typecheck leg and would not resolve for the `tsx` CLI
 * this module is read back through. Two implementations of one convention therefore need a fence, and it is a
 * LITERAL on each side: `routing-probe.test.ts` pins the probe's function to `<cell>/<faultType>` and
 * `router-validation.test.ts` pins this one to the same string, so re-keying either alone fails that side's test
 * instead of silently splitting one unit into two.
 */
export function regressionKey(c: RoutingCase): string {
  return `${c.cell}/${c.faultType}`;
}

/** Correct/total for one regression unit. */
export interface CellTally {
  readonly correct: number;
  readonly total: number;
}

/** Per-unit tallies for one router over one case set. */
export type CellTallies = ReadonlyMap<string, CellTally>;

/**
 * How a router scores on each regression unit, over exactly the cases it was given.
 *
 * The tallies are the ONLY place a cell's membership is decided, so `regressedCells` compares two maps built by
 * this one function over the same case set — which is why every baseline key has a counterpart and the lookup can
 * assert rather than defend.
 */
export function cellTallies(cases: readonly RoutingCase[], router: ThresholdRouter): CellTallies {
  const tallies = new Map<string, { correct: number; total: number }>();
  for (const c of cases) {
    const key = regressionKey(c);
    let tally = tallies.get(key);
    if (!tally) {
      tally = { correct: 0, total: 0 };
      tallies.set(key, tally);
    }
    tally.total++;
    if (routedCorrect(c, router)) tally.correct++;
  }
  return tallies;
}

/**
 * The tolerance the regression test uses, matching the probe's accounting (1e-9).
 *
 * It is a tolerance and not a correction: both sides of the comparison are ratios of the same two integers, so
 * equal correctness yields bit-identical floats. It exists so that the two instruments cannot disagree on the
 * boundary over a floating-point artifact of how a ratio was formed.
 */
const REGRESSION_EPSILON = 1e-9;

/**
 * The units where `router` scores strictly below the always-engine baseline, on the SAME cases.
 *
 * The baseline is rebuilt here rather than taken from the caller, because a regression is a claim about a router
 * relative to the engine on that population and a caller-supplied baseline is a second chance to pass the wrong
 * one. Iterating the baseline's keys encodes that both maps cover the same set.
 */
export function regressedCells(
  cases: readonly RoutingCase[],
  router: ThresholdRouter,
): readonly string[] {
  const baseline = cellTallies(cases, alwaysEngine(router.signal));
  const routed = cellTallies(cases, router);
  const regressed: string[] = [];
  for (const [key, base] of baseline) {
    const got = routed.get(key)!;
    if (got.correct / got.total + REGRESSION_EPSILON < base.correct / base.total)
      regressed.push(key);
  }
  return regressed;
}

/**
 * Whether a router may be chosen under `constraint`.
 *
 * The criterion is evaluated in ONE place: a scan that re-implemented "no regressing cell" inline would be the
 * second copy of the rule the probe already owns, and the two would drift the first time either moved.
 */
function admissible(
  cases: readonly RoutingCase[],
  router: ThresholdRouter,
  constraint: FitConstraint,
): boolean {
  return constraint === 'max-accuracy' || regressedCells(cases, router).length === 0;
}

/**
 * The best threshold on a set of cases **under a named criterion**, by exhaustive scan over candidate split points.
 *
 * The candidate set is the observed signal values themselves (plus one below the minimum, which is the
 * "always engine" arm), because the optimum of a step function always sits at a breakpoint — so the scan is exact
 * and not a grid. Ties resolve to the SMALLER threshold, deterministically, so two runs on the same fold agree.
 *
 * Under `'zero-regression'` a candidate is skipped unless it regresses no unit ON THIS SET, which is the same
 * admissibility rule — and the same unit — `analyzeRoutingProbe` applies when it reports its frontier. The
 * always-engine arm is admissible by construction (it IS the baseline, so its regression set is empty), which is
 * what makes the constrained scan total: it can only improve on doing nothing, and it returns doing nothing when
 * nothing admissible does. On RE3's full-corpus probe records this scan reproduces the probe's own
 * `bestZeroRegression` exactly — `engine-margin < 0.5671 -> prism`, 66.67%, zero regressing cells — which is the
 * cross-check that the two implementations of the criterion agree.
 *
 * @param cases - The population to fit on.
 * @param signal - Which inference-time signal the threshold splits.
 * @param constraint - The criterion; REQUIRED, so no call site can silently take the weaker one.
 * @returns The best admissible router, or the always-engine arm when none beats it.
 */
export function fitThreshold(
  cases: readonly RoutingCase[],
  signal: RouterSignal,
  constraint: FitConstraint,
): ThresholdRouter {
  const values = cases.map((c) => signalValue(c, signal));
  const candidates = [Number.NEGATIVE_INFINITY, ...[...values].sort((a, b) => a - b)];
  let best: ThresholdRouter = alwaysEngine(signal);
  let bestScore = accuracy(cases, best);
  for (const threshold of candidates) {
    const router: ThresholdRouter = { signal, threshold };
    const score = accuracy(cases, router);
    if (score > bestScore && admissible(cases, router, constraint)) {
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
  /** The criterion the threshold was chosen under — carried so a report cannot print a number without its rule. */
  readonly constraint: FitConstraint;
  readonly folds: number;
  /** The best accuracy achievable on the FULL set **under `constraint`** — the number a probe reports, and optimistic. */
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
  /**
   * Regression units the deployed routers LOST, summed over the folds — `(fold, unit)` PAIRS, not distinct units.
   *
   * The unit is the (system x fault-type) pair and the comparison is against the always-engine baseline **on the
   * fold's own cases**, because that is the population the decision is made on. A `'zero-regression'` fit
   * admissible on a train fold is NOT guaranteed admissible on the fold it then scores: the constraint was checked
   * where the threshold was chosen, and it is this count that says how far the guarantee travels. A count is the
   * honest unit here — a percentage of units would read as accuracy, which it is not.
   */
  readonly regressedUnitsHeldOut: number;
  /** Per-fold regression counts, so a single bad fold is visible rather than only the total. */
  readonly perFoldRegressed: readonly number[];
}

/**
 * Cross-validate one signal's threshold router **under a named criterion**.
 *
 * Each fold fits on the other `k-1` folds and scores on the held-out one, so no case is ever scored by a router
 * that saw it. The baseline is the engine alone, measured on the full set — the same quantity the in-sample arm
 * starts from, so the two gains are comparable.
 *
 * Both the in-sample arm and every fold use the SAME `constraint`, so the difference between the two arms is the
 * amount of fitting and never the rule: an unconstrained optimum compared against constrained folds would make
 * "how much did the fit buy" a question about the criterion instead.
 *
 * @param cases - The population.
 * @param signal - Which inference-time signal the threshold splits.
 * @param k - How many folds; each is fitted on the other `k-1` and scored on itself.
 * @param constraint - The criterion; REQUIRED, so no call site can silently take the weaker one.
 * @returns The in-sample optimum, the held-out estimate, and the held-out regression count.
 */
export function crossValidateRouter(
  cases: readonly RoutingCase[],
  signal: RouterSignal,
  k: number,
  constraint: FitConstraint,
): CrossValidation {
  const partition = folds(cases.length, k);
  const baselineRouter = alwaysEngine(signal);
  const perFold: number[] = [];
  const thresholds: number[] = [];
  const perFoldRegressed: number[] = [];
  for (const testIdx of partition) {
    const test = new Set(testIdx);
    const train = cases.filter((_, i) => !test.has(i));
    const testCases = testIdx.map((i) => cases[i]!);
    // An empty TRAIN fold cannot fit anything; the honest answer is the baseline, not a crash.
    const router = train.length === 0 ? baselineRouter : fitThreshold(train, signal, constraint);
    thresholds.push(router.threshold);
    perFold.push(accuracy(testCases, router));
    perFoldRegressed.push(regressedCells(testCases, router).length);
  }
  const heldOut = perFold.reduce((s, x) => s + x, 0) / perFold.length;
  const baseline = accuracy(cases, baselineRouter);
  const inSample = accuracy(cases, fitThreshold(cases, signal, constraint));
  return {
    signal,
    constraint,
    folds: k,
    inSample,
    baseline,
    heldOut,
    perFold,
    thresholds,
    heldOutGain: heldOut - baseline,
    fittingAllowance: inSample - heldOut,
    regressedUnitsHeldOut: perFoldRegressed.reduce((s, x) => s + x, 0),
    perFoldRegressed,
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

/**
 * The most frequent truth, ties broken by name so the result is deterministic.
 *
 * Iterating the names in their DEFAULT sorted order makes "the first strict maximum wins" a name tie-break. The
 * obvious spelling — sorting the entries with a comparator ending in `a > b ? 1 : 0` — carries an equality arm no
 * input can reach, because a `Map`'s keys are unique by construction; that unreachable branch is why this reads the
 * keys and sorts them without a comparator, and the order it produces is the same one the comparator produced.
 */
export function modalTruth(cases: readonly RoutingCase[]): string {
  const counts = new Map<string, number>();
  for (const c of cases) counts.set(c.truth, (counts.get(c.truth) ?? 0) + 1);
  let best = '';
  let bestN = -1;
  for (const name of [...counts.keys()].sort()) {
    const n = counts.get(name)!;
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best;
}
