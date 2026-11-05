/**
 * The prior floor: what a ranker reading NO telemetry scores on a cell, measured from the cell itself.
 *
 * ## Why this exists
 *
 * Every accuracy this project publishes is a rate over a candidate pool, and **the pool is not the fleet**. A
 * benchmark that injects faults at five services while exposing fourteen in telemetry makes "top five" a
 * question with five possible answers, so a ranker that reads nothing at all and lists those five answers
 * correctly 100 % of the time. The most recent published audit of this benchmark states the consequence
 * exactly: a telemetry-free ranker reaches **Avg@5 0.488** on the published corpus where uniform-random ranks
 * score 0.137, so 0.488 — not 0.137 — is the honest in-distribution floor, and the "graph structure" the
 * comparison is about may be measuring the restricted culprit pool rather than failure symptoms
 * ([`arXiv:2609.27069`](https://arxiv.org/abs/2609.27069)).
 *
 * That critique is about a number this engine also publishes. It cannot be answered by quoting a larger
 * number against random, because random is not the floor. It can be answered by computing the floor on the
 * same cells the engine is scored on, and by reporting the margin over THAT.
 *
 * ## What is measured, and what is assumed
 *
 * The floor is a property of the corpus, not of the engine, so the instrument reads it off the corpus's own
 * ground truth: the distinct truth services of a cell are exactly the services the benchmark injected into.
 * On a cell with `S` of them, a text-book baseline that knows the label support but no telemetry ranks them
 * by their own corpus frequency — the majority-class rule — and a baseline that assumes nothing ranks them
 * uniformly. Both are closed forms over the per-service case counts, so no run is needed to obtain them.
 *
 * ```
 *   uniform(S):  AC@k = min(k, S) / S          Avg@5 = (Σ_{k=1..5} min(k, S)) / (5·S)
 *   ordered:     AC@k = #{cases whose truth has frequency-rank ≤ k} / n
 * ```
 *
 * The two coincide on a balanced cell, which every RCAEval cell is, and the ordered form is reported beside
 * the uniform one so that a later unbalanced corpus cannot silently make the floor a fitted quantity: the
 * difference between the two is the part of the floor that came from the labels rather than from the size.
 *
 * ## What the floor says about this corpus, in advance of any run
 *
 * `Avg@5` is the mean of `AC@1…AC@5`, and `AC@k = min(k, S) / S` for a uniform prior, so the floor has two
 * regimes and the boundary is `S = 5`:
 *
 *     S ≥ 5:  Avg@5 = (1+2+3+4+5) / (5S) = 3 / S          Top@5 = 5 / S
 *     S = 5:  Avg@5 = 15 / 25 = 0.60                        Top@5 = 1
 *     S = 6:  Avg@5 = 15 / 30 = 0.50                        Top@5 = 5/6
 *
 * Every published cell of this corpus has `S ≤ 6`, so **`Avg@5` at its floor is 0.50–0.60 and `Top@5` is
 * 0.83–1.00 before the engine reads a single metric** — the top-five family cannot separate methods on a
 * benchmark whose culprit pool fits inside five candidates. The line this module prints states the floor
 * beside the reading rather than the one number the engine happens to win on, and it says so explicitly when
 * `Top@5` is saturated.
 *
 * @module benchmarks/prior-floor
 */

/** One case's contribution, reduced to the two fields the floor is a function of. */
export interface PriorFloorObservation {
  /** The case's accepted root-cause service. */
  readonly truth: string;
  /** Whether the engine's own top-1 was accepted. */
  readonly correct: boolean;
}

/** The running totals for one cell. */
export interface PriorFloorCensus {
  /** Cases handed over. */
  cases: number;
  /** Cases the engine got right, carried so the floor and the reading are printed from one walk. */
  engineCorrect: number;
  /** How many cases each truth service owns — the label support the baselines are built from. */
  readonly support: Map<string, number>;
}

/** A floor, resolved. Rates are fractions in `[0, 1]`. */
export interface PriorFloor {
  /** `S` — the number of distinct services the cell injected into. */
  readonly candidates: number;
  /** A ranker that assumes the support is flat. */
  readonly uniform: PriorOperatingPoint;
  /** A ranker that ranks by the corpus's own truth frequency. */
  readonly ordered: PriorOperatingPoint & { readonly order: readonly string[] };
}

/** The three rates a baseline is compared on. */
export interface PriorOperatingPoint {
  /** Accuracy at cutoff 1. */
  readonly ac1: number;
  /** Mean of `AC@1…AC@5`. */
  readonly avg5: number;
  /** Accuracy at cutoff 5. */
  readonly top5: number;
}

/**
 * A census with nothing in it.
 *
 * @returns Zeroed totals, ready for {@link accumulatePriorFloor}.
 */
export function createPriorFloorCensus(): PriorFloorCensus {
  return { cases: 0, engineCorrect: 0, support: new Map() };
}

/**
 * Add one case to the census.
 *
 * Both fields are required rather than optional: a floor computed from a case whose correctness was never
 * decided would be a floor over a different population than the engine's rate, and the two are printed on one
 * line precisely so that they cannot be.
 *
 * @param census - The cell's running totals, mutated in place.
 * @param observation - The case's truth and the engine's verdict on it.
 */
export function accumulatePriorFloor(
  census: PriorFloorCensus,
  observation: PriorFloorObservation,
): void {
  census.cases += 1;
  if (observation.correct) census.engineCorrect += 1;
  census.support.set(observation.truth, (census.support.get(observation.truth) ?? 0) + 1);
}

/**
 * Resolve a census into the two baselines.
 *
 * @param census - A census built by {@link accumulatePriorFloor}.
 * @returns The floor, or `undefined` when the census holds no cases — an empty cell has no floor and reporting
 *   one as zero would read as "the prior scores nothing here".
 */
export function priorFloor(census: PriorFloorCensus): PriorFloor | undefined {
  const total = census.cases;
  if (total === 0) return undefined;
  const candidates = census.support.size;

  const uniform: PriorOperatingPoint = {
    ac1: 1 / candidates,
    avg5: meanOverCutoffs((k) => Math.min(k, candidates) / candidates),
    top5: Math.min(5, candidates) / candidates,
  };

  // Descending support, ties by service id. Two arms and not three: `Map` keys are unique, so two entries can
  // never carry the same id and a third arm could not fire — the shape this package treats as a term that
  // silently stopped voting. What comes out is a TOTAL order, so the baseline is a function of the cell rather
  // than of the order the runner happened to visit its cases in.
  const order = [...census.support.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([serviceId]) => serviceId);
  const rank = new Map<string, number>(order.map((serviceId, i) => [serviceId, i + 1]));
  const byRankAtOrAbove = (k: number): number => {
    let hits = 0;
    for (const [serviceId, count] of census.support) {
      // `!` rather than a default: `rank` is built from this very map, so the lookup cannot miss — the rule the
      // miss attribution applies to its own total maps ("assert rather than defaulting").
      if (rank.get(serviceId)! <= k) hits += count;
    }
    return hits / total;
  };

  return {
    candidates,
    uniform,
    ordered: {
      ac1: byRankAtOrAbove(1),
      avg5: meanOverCutoffs(byRankAtOrAbove),
      top5: byRankAtOrAbove(5),
      order,
    },
  };
}

/**
 * The one place the `Avg@5` convention is defined: the unweighted mean of the first five cutoffs.
 *
 * Named rather than inlined because two baselines and one engine rate read it, and a metric whose definition
 * lives in three expressions is the defect `rcaeval-metric-rows` records one level up.
 *
 * @param atCutoff - `AC@k` as a function of `k`.
 * @returns The mean of `AC@1…AC@5`.
 */
function meanOverCutoffs(atCutoff: (k: number) => number): number {
  let sum = 0;
  for (let k = 1; k <= 5; k += 1) sum += atCutoff(k);
  return sum / 5;
}

/**
 * Render the cell's floor beside the engine's own reading.
 *
 * The line is printed unconditionally, at every configuration and on every cell, for the reason every census
 * in this package is: a floor that only appeared where the engine looked good would be a claim rather than a
 * measurement, and the two numbers are only comparable when they come from one walk over one population.
 *
 * @param system - The benchmark system, for the label.
 * @param suite - The suite, for the label.
 * @param census - The cell's totals.
 * @returns One line, or `undefined` when the cell held no cases.
 */
export function formatPriorFloorLine(
  system: string,
  suite: string,
  census: PriorFloorCensus,
): string | undefined {
  const floor = priorFloor(census);
  if (floor === undefined) return undefined;
  const engine = census.engineCorrect / census.cases;
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const parts = [
    `[prior-floor] ${system}/${suite}:`,
    `S=${floor.candidates}`,
    `telemetry-free AC@1 ${pct(floor.uniform.ac1)} (uniform) ${pct(floor.ordered.ac1)} (frequency)`,
    `Avg@5 ${pct(floor.uniform.avg5)}`,
    `Top@5 ${pct(floor.uniform.top5)}`,
    `engine AC@1 ${pct(engine)}`,
    liftClause(engine, floor.uniform.ac1, census.cases),
  ];
  if (floor.uniform.top5 === 1) {
    parts.push('— Top@5 is SATURATED by the prior here, so it is not evidence for this cell');
  }
  return parts.join(' | ');
}

/**
 * The lift, or the reason there is none.
 *
 * The reachable range is what is left of the unit interval after the prior has taken `ac1`, so the second
 * number is the share of the ACHIEVABLE margin the engine holds — a rate cannot be called "89 %" and "87 % of
 * what was available" in one cell without both being printed. A single-candidate cell has no range at all: the
 * prior takes the whole interval and the engine is necessarily right, so a lift of `0/0` is reported as the
 * degenerate quantity it is rather than as `0.0 %`, which would read as a failure.
 *
 * @param engine - The engine's `AC@1` over the same cases.
 * @param prior - The uniform baseline's `AC@1`.
 * @param cases - The population, used only to word the degenerate case.
 * @returns The clause the line joins, never empty.
 */
function liftClause(engine: number, prior: number, cases: number): string {
  const headroom = 1 - prior;
  if (headroom <= 0) {
    return `lift n/a (the prior takes the whole interval over ${cases} cases, so there is no margin to hold)`;
  }
  const lift = (engine - prior) / headroom;
  return `lift ${(lift * 100).toFixed(1)}% of the reachable margin`;
}

/**
 * The same reading aggregated over several cells.
 *
 * Cells are pooled by CASES, not by their rates: a 30-case cell and a 125-case cell are not equal evidence,
 * and averaging their rates is the defect `accuracy-aggregation` §208 records at the published level. The
 * pooled prior is the case-weighted mixture of the per-cell uniform rates, which is the floor of a ranker that
 * knows each system's support.
 *
 * @param cells - One census per cell.
 * @returns A one-line summary, or `undefined` when no cell held any case.
 */
export function formatPriorFloorSummary(cells: readonly PriorFloorCensus[]): string | undefined {
  let cases = 0;
  let engineCorrect = 0;
  let priorHits = 0;
  let top5Hits = 0;
  for (const census of cells) {
    const floor = priorFloor(census);
    if (floor === undefined) continue;
    cases += census.cases;
    engineCorrect += census.engineCorrect;
    priorHits += floor.uniform.ac1 * census.cases;
    top5Hits += floor.uniform.top5 * census.cases;
  }
  if (cases === 0) return undefined;
  const engine = engineCorrect / cases;
  const prior = priorHits / cases;
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  return (
    `[prior-floor] ALL CELLS (${cases} cases): telemetry-free AC@1 ${pct(prior)}, Top@5 ${pct(top5Hits / cases)}; ` +
    `engine AC@1 ${pct(engine)} → ${liftClause(engine, prior, cases)}`
  );
}
