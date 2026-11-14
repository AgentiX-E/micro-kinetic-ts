/**
 * Routing-feasibility probe for fusing two root-cause engines per case.
 *
 * The fusion-ceiling analysis established that our deterministic engine and
 * the PRISM graph-free baseline are strongly complementary: their per-case
 * union of correct top-1 predictions reaches 87.5% while either engine alone
 * sits at ~76%. The union, however, assumes a perfect case-level oracle that
 * always knows which engine is right. A real router must decide, from
 * inference-time signals only, whether to trust the engine's top-1 or PRISM's
 * top-1 — and it must do so without ever making any cell worse than the
 * engine-only baseline (the "zero-regression" gate that the fixed-weight
 * fusion failed).
 *
 * This module is a PURE aggregation that answers the feasibility question
 * BEFORE any router is wired into the ranking pipeline: given per-case records
 * carrying each engine's top-1/top-2 predictions and their scores (the
 * engine's ranking `finalScore` and PRISM's M-score), it evaluates a family of
 * candidate routers and reports the zero-regression frontier.
 *
 * Candidate routers:
 *   1. `always-engine` / `always-prism` — reference points (the latter being
 *      the whole-route-to-PRISM ceiling).
 *   2. `resource-fault→prism` — a fault-type prior that routes the internal
 *      resource faults (cpu/memory/disk) to PRISM and everything else to the
 *      engine, encoding the empirical "PRISM wins on resource cells, loses on
 *      delay/socket cells" split.
 *   3. `engine-margin<θ→prism` — route to PRISM when the engine's top-1 vs
 *      top-2 ranking gap is below a threshold (the engine is uncertain).
 *   4. `prism-margin>θ→prism` — route to PRISM when PRISM's top-1 vs top-2
 *      M-score gap is above a threshold (PRISM is confident).
 *   5. `prism-score>θ→prism` — route to PRISM when its absolute top-1 M-score
 *      exceeds a threshold (strong internal+external anomaly).
 *   6. `per-cell-oracle` — the upper bound of STATIC per-cell routing: route
 *      every case of a (system × fault-type) cell to whichever engine scores
 *      more correct on that cell. This never regresses a cell by construction,
 *      so it is the ceiling a coarse router can reach before per-case signals
 *      are needed.
 *
 * A router "regresses" a cell when its accuracy on that cell is strictly below
 * the always-engine baseline (within a floating-point tolerance). The
 * zero-regression frontier is the set of candidate routers with no regressing
 * cell; its best member is the highest-accuracy zero-regression router.
 *
 * This module performs no I/O and makes no assumption about how the records
 * were produced.
 *
 * @module benchmarks/leaderboard/routing-probe
 */

/** Fault types PRISM's internal/external asymmetry is hypothesised to win. */
export const RESOURCE_FAULT_TYPES: ReadonlySet<string> = new Set(['cpu', 'mem', 'disk']);

/** Which engine a router trusts for a given case. */
export type RoutingDecision = 'engine' | 'prism';

/** A single case's routing-relevant predictions and scores from both engines. */
export interface RoutingProbeRecord {
  /** Stable case identifier. */
  readonly caseId: string;
  /** System-level cell key (e.g. "RE1:OnlineBoutique"). */
  readonly cell: string;
  /** Lowercase fault type (e.g. "cpu", "delay", "f1"). */
  readonly faultType: string;
  /** Ground-truth root-cause service id. */
  readonly truth: string;
  /** The engine's top-1 prediction, or `undefined` if it produced none. */
  readonly engineTop1?: string;
  /** The engine's top-1 ranking `finalScore`. */
  readonly engineTop1Score?: number;
  /** The engine's top-2 prediction, or `undefined` if it produced none. */
  readonly engineTop2?: string;
  /** The engine's top-2 ranking `finalScore`. */
  readonly engineTop2Score?: number;
  /** PRISM's top-1 prediction, or `undefined` if it produced none. */
  readonly prismTop1?: string;
  /** PRISM's top-1 M-score. */
  readonly prismTop1Score?: number;
  /** PRISM's top-2 prediction, or `undefined` if it produced none. */
  readonly prismTop2?: string;
  /** PRISM's top-2 M-score. */
  readonly prismTop2Score?: number;
}

/** The evaluated outcome of a single candidate router. */
export interface RuleResult {
  /** Human-readable rule identifier (includes the threshold where relevant). */
  readonly name: string;
  /** Cases routed correctly. */
  readonly correct: number;
  /** Cases routed. */
  readonly total: number;
  /** `correct / total`. */
  readonly accuracy: number;
  /** `accuracy - baselineAccuracy` (always-engine), in [−1, 1]. */
  readonly gain: number;
  /** Cells whose accuracy falls below the always-engine baseline. */
  readonly regressingCells: readonly string[];
}

/** The full routing-feasibility analysis over a set of cases. */
export interface RoutingProbeAnalysis {
  /** Number of cases evaluated. */
  readonly total: number;
  /** Cases the engine got right. */
  readonly engineCorrect: number;
  /** Cases PRISM got right. */
  readonly prismCorrect: number;
  /** Cases the two engines disagree on top-1. */
  readonly disagreement: number;
  /** Cases only the engine got right. */
  readonly engineOnly: number;
  /** Cases only PRISM got right. */
  readonly prismOnly: number;
  /** Cases neither engine got right. */
  readonly bothWrong: number;
  /** Union of the two correct sets (the perfect-oracle ceiling). */
  readonly union: number;
  /** `union / total`, in [0, 1]. */
  readonly unionRate: number;
  /** Always-engine accuracy (the baseline every router must not regress). */
  readonly baselineAccuracy: number;
  /** Every evaluated candidate router. */
  readonly rules: readonly RuleResult[];
  /** Candidate routers with no regressing cell. */
  readonly zeroRegressionRules: readonly RuleResult[];
  /** The highest-accuracy zero-regression router, or `null` if none exists. */
  readonly bestZeroRegression: RuleResult | null;
}

/** Floating-point tolerance for detecting a cell-level regression. */
const REGRESSION_EPSILON = 1e-9;

/** The (system × fault-type) cell key used for regression accounting. */
export function regressionCellKey(cell: string, faultType: string): string {
  return `${cell}/${faultType}`;
}

/** Whether a top-1 prediction matches the ground-truth service. */
function isCorrect(top1: string | undefined, truth: string): boolean {
  return top1 !== undefined && top1 === truth;
}

/**
 * The engine's top-1 minus top-2 ranking score, or `undefined` when fewer than
 * two scored engine candidates are available. A router treats an undefined
 * margin as "confident" (never route away from the engine).
 */
export function engineMargin(r: RoutingProbeRecord): number | undefined {
  if (r.engineTop1Score === undefined || r.engineTop2Score === undefined) return undefined;
  return r.engineTop1Score - r.engineTop2Score;
}

/**
 * PRISM's top-1 minus top-2 M-score, or `undefined` when fewer than two scored
 * PRISM candidates are available. A router treats an undefined margin as
 * "unconfident" (never route toward PRISM).
 */
export function prismMargin(r: RoutingProbeRecord): number | undefined {
  if (r.prismTop1Score === undefined || r.prismTop2Score === undefined) return undefined;
  return r.prismTop1Score - r.prismTop2Score;
}

/** A candidate router: map a record to the engine it trusts. */
type Router = (r: RoutingProbeRecord) => RoutingDecision;

/** Per-cell accuracy bookkeeping for regression detection. */
interface CellTally {
  correct: number;
  total: number;
}

/** The outcome of evaluating a router over a set of records. */
interface RouterEvaluation {
  correct: number;
  total: number;
  accuracy: number;
  perCell: ReadonlyMap<string, CellTally>;
}

/** Evaluate a router, returning its accuracy and per-cell breakdown. */
function evaluateRouter(records: readonly RoutingProbeRecord[], decide: Router): RouterEvaluation {
  let correct = 0;
  const perCell = new Map<string, CellTally>();
  for (const r of records) {
    const key = regressionCellKey(r.cell, r.faultType);
    let tally = perCell.get(key);
    if (!tally) {
      tally = { correct: 0, total: 0 };
      perCell.set(key, tally);
    }
    tally.total++;
    const decision = decide(r);
    const top1 = decision === 'prism' ? r.prismTop1 : r.engineTop1;
    if (isCorrect(top1, r.truth)) {
      correct++;
      tally.correct++;
    }
  }
  return {
    correct,
    total: records.length,
    accuracy: records.length > 0 ? correct / records.length : 0,
    perCell,
  };
}

/**
 * Compute the set of cells a router regresses relative to the always-engine
 * baseline: every (system × fault-type) cell whose accuracy is strictly below
 * the baseline's accuracy on that same cell.
 *
 * Both maps are always built over the SAME record set by `evaluateRouter`, so
 * every baseline cell has a counterpart in `perCell` and every tally holds at
 * least one case. Iterating the baseline's keys encodes that invariant in the
 * control flow, leaving no defensive branch for an impossible mismatch.
 */
function regressingCells(
  perCell: ReadonlyMap<string, CellTally>,
  baselinePerCell: ReadonlyMap<string, CellTally>,
): string[] {
  const regressed: string[] = [];
  for (const [key, baseline] of baselinePerCell) {
    const tally = perCell.get(key)!;
    const acc = tally.correct / tally.total;
    const base = baseline.correct / baseline.total;
    if (acc + REGRESSION_EPSILON < base) regressed.push(key);
  }
  return regressed;
}

/** Build a named `RuleResult` from an evaluated router. */
function toRuleResult(
  name: string,
  evalResult: RouterEvaluation,
  baselineAccuracy: number,
  baselinePerCell: ReadonlyMap<string, CellTally>,
): RuleResult {
  return {
    name,
    correct: evalResult.correct,
    total: evalResult.total,
    accuracy: evalResult.accuracy,
    gain: evalResult.accuracy - baselineAccuracy,
    regressingCells: regressingCells(evalResult.perCell, baselinePerCell),
  };
}

/** Deduplicate a number list and sort ascending. */
function distinctAscending(values: readonly number[]): number[] {
  const unique = Array.from(new Set(values));
  unique.sort((a, b) => a - b);
  return unique;
}

/**
 * Aggregate the routing-feasibility analysis over a set of per-case records.
 *
 * The returned analysis always includes the `always-engine` and `always-prism`
 * references, the fault-type prior, the `per-cell-oracle`, and the three
 * threshold sweeps over every distinct observed signal value. The zero-
 * regression frontier and its best member are derived from those rules.
 *
 * @param records - Per-case predictions and scores from both engines.
 * @returns The full routing analysis; for empty input the references have 0
 *   accuracy and `bestZeroRegression` is `null`.
 */
export function analyzeRoutingProbe(records: readonly RoutingProbeRecord[]): RoutingProbeAnalysis {
  const total = records.length;

  // ── Aggregate correctness / disagreement statistics ──
  let engineCorrect = 0;
  let prismCorrect = 0;
  let disagreement = 0;
  let bothCorrect = 0;
  let bothWrong = 0;
  for (const r of records) {
    const e = isCorrect(r.engineTop1, r.truth);
    const p = isCorrect(r.prismTop1, r.truth);
    if (e) engineCorrect++;
    if (p) prismCorrect++;
    if (r.engineTop1 !== r.prismTop1) disagreement++;
    if (e && p) bothCorrect++;
    if (!e && !p) bothWrong++;
  }
  const engineOnly = engineCorrect - bothCorrect;
  const prismOnly = prismCorrect - bothCorrect;
  const union = bothCorrect + engineOnly + prismOnly;

  // ── Always-engine baseline (per-cell) ──
  const baselineEval = evaluateRouter(records, () => 'engine');
  const baselineAccuracy = baselineEval.accuracy;
  const baselinePerCell = baselineEval.perCell;

  const rules: RuleResult[] = [];

  const push = (name: string, evalResult: RouterEvaluation): void => {
    rules.push(toRuleResult(name, evalResult, baselineAccuracy, baselinePerCell));
  };

  // Reference points.
  push('always-engine', baselineEval);
  push(
    'always-prism',
    evaluateRouter(records, () => 'prism'),
  );

  // Fault-type prior: resource faults → PRISM, everything else → engine.
  push(
    'resource-fault->prism',
    evaluateRouter(records, (r) => (RESOURCE_FAULT_TYPES.has(r.faultType) ? 'prism' : 'engine')),
  );

  // Per-cell static oracle: route a whole (system × fault-type) cell to the
  // engine that scores more correct on it (ties keep the engine baseline).
  {
    const cellCorrect = new Map<string, { engine: number; prism: number }>();
    for (const r of records) {
      const key = regressionCellKey(r.cell, r.faultType);
      let tally = cellCorrect.get(key);
      if (!tally) {
        tally = { engine: 0, prism: 0 };
        cellCorrect.set(key, tally);
      }
      if (isCorrect(r.engineTop1, r.truth)) tally.engine++;
      if (isCorrect(r.prismTop1, r.truth)) tally.prism++;
    }
    push(
      'per-cell-oracle',
      evaluateRouter(records, (r) => {
        const tally = cellCorrect.get(regressionCellKey(r.cell, r.faultType));
        return tally !== undefined && tally.prism > tally.engine ? 'prism' : 'engine';
      }),
    );
  }

  // Threshold sweeps over every distinct observed signal value.
  const engineMargins = distinctAscending(
    records.map(engineMargin).filter((m): m is number => m !== undefined),
  );
  for (const theta of engineMargins) {
    push(
      `engine-margin<${theta.toFixed(4)}->prism`,
      evaluateRouter(records, (r) => {
        const m = engineMargin(r);
        return m !== undefined && m < theta ? 'prism' : 'engine';
      }),
    );
  }

  const prismMargins = distinctAscending(
    records.map(prismMargin).filter((m): m is number => m !== undefined),
  );
  for (const theta of prismMargins) {
    push(
      `prism-margin>${theta.toFixed(4)}->prism`,
      evaluateRouter(records, (r) => {
        const m = prismMargin(r);
        return m !== undefined && m > theta ? 'prism' : 'engine';
      }),
    );
  }

  const prismScores = distinctAscending(
    records.map((r) => r.prismTop1Score).filter((s): s is number => s !== undefined),
  );
  for (const theta of prismScores) {
    push(
      `prism-score>${theta.toFixed(4)}->prism`,
      evaluateRouter(records, (r) =>
        r.prismTop1Score !== undefined && r.prismTop1Score > theta ? 'prism' : 'engine',
      ),
    );
  }

  // ── Zero-regression frontier ──
  const zeroRegressionRules = rules.filter((rule) => rule.regressingCells.length === 0);
  let bestZeroRegression: RuleResult | null = null;
  if (total > 0) {
    for (const rule of zeroRegressionRules) {
      if (bestZeroRegression === null || rule.accuracy > bestZeroRegression.accuracy) {
        bestZeroRegression = rule;
      }
    }
  }

  return {
    total,
    engineCorrect,
    prismCorrect,
    disagreement,
    engineOnly,
    prismOnly,
    bothWrong,
    union,
    unionRate: total > 0 ? union / total : 0,
    baselineAccuracy,
    rules,
    zeroRegressionRules,
    bestZeroRegression,
  };
}
