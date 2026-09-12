/**
 * Coordinate descent — a deterministic, derivative-free black-box optimizer.
 *
 * This is the L2 workhorse for tuning the five ranking fusion weights
 * (`RankingWeights`): unlike the GP/LLM surrogate (which is best for a large
 * mixed space), coordinate descent is cheap, interpretable, and converges
 * monotonically for a small continuous space. It is deliberately DECOUPLED
 * from the config-space: it operates on a raw `Float64Array` (typically the
 * unit-cube representation) plus per-dimension bounds, so it can optimize any
 * low-dimensional continuous objective.
 *
 * ## Algorithm
 *
 * Starting from `initial` with per-dimension step sizes:
 *
 *   1. Evaluate the initial point.
 *   2. For each dimension, try `+step` then `−step` (clamped to bounds);
 *      keep whichever improves the objective (ties keep the current point).
 *   3. After a full sweep, if every step is below `minStep`, stop.
 *   4. Otherwise multiply every step by `shrinkFactor` and repeat.
 *
 * This is the classic Hooke–Jeeves-style cyclic coordinate search. It is
 * guaranteed to terminate within `maxRounds` sweeps and never returns a point
 * worse than the initial one (it is a monotone improvement method).
 *
 * The oracle is async so callers can evaluate through the async RCA pipeline
 * (`buildFaultGraph` + `analyze`); a synchronous objective can be wrapped with
 * `async (x) => f(x)`.
 *
 * @module optimize/coordinate-descent
 */

// ── Types ─────────────────────────────────────────────────

export interface CoordinateDescentOptions {
  /** Starting point (cloned; not mutated). */
  readonly initial: Float64Array;
  /** Initial step size per dimension. */
  readonly stepSizes: Float64Array;
  /** Per-dimension lower bound (defaults to 0). */
  readonly lower?: Float64Array;
  /** Per-dimension upper bound (defaults to 1). */
  readonly upper?: Float64Array;
  /** Maximum number of full sweeps. Default 10. */
  readonly maxRounds?: number;
  /** Stop when every step size drops below this. Default 1e-3. */
  readonly minStep?: number;
  /** Per-sweep step shrink factor in (0, 1). Default 0.5. */
  readonly shrinkFactor?: number;
}

export interface CoordinateDescentStep {
  readonly round: number;
  readonly dim: number;
  /** Objective value after this dimension's step (kept best so far). */
  readonly score: number;
  /** Whether this step improved the objective. */
  readonly improved: boolean;
}

export interface CoordinateDescentResult {
  /** Best point found (cloned from internal state). */
  readonly best: Float64Array;
  /** Objective value at `best`. */
  readonly bestScore: number;
  /** Number of full sweeps performed. */
  readonly rounds: number;
  /** Total number of oracle evaluations (including the initial one). */
  readonly evaluations: number;
  /** Per-dimension-step trajectory (diagnostic). */
  readonly history: readonly CoordinateDescentStep[];
}

/** Async black-box objective to maximize. */
export type CoordinateOracle = (x: Float64Array) => Promise<number>;

// ── Defaults ──────────────────────────────────────────────

const DEFAULT_MAX_ROUNDS = 10;
const DEFAULT_MIN_STEP = 1e-3;
const DEFAULT_SHRINK = 0.5;

// ── Implementation ────────────────────────────────────────

/**
 * Run cyclic coordinate descent to maximize `oracle`.
 *
 * @param oracle - Objective to maximize (called with a fresh array each time).
 * @param options - Initial point, step sizes, and termination controls.
 */
export async function coordinateDescent(
  oracle: CoordinateOracle,
  options: CoordinateDescentOptions,
): Promise<CoordinateDescentResult> {
  const n = options.initial.length;
  if (n === 0) {
    return {
      best: new Float64Array(0),
      bestScore: await oracle(new Float64Array(0)),
      rounds: 0,
      evaluations: 1,
      history: [],
    };
  }
  if (options.stepSizes.length !== n) {
    throw new RangeError('stepSizes.length must equal initial.length');
  }
  if (options.lower && options.lower.length !== n) {
    throw new RangeError('lower.length must equal initial.length');
  }
  if (options.upper && options.upper.length !== n) {
    throw new RangeError('upper.length must equal initial.length');
  }

  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const minStep = options.minStep ?? DEFAULT_MIN_STEP;
  const shrink = options.shrinkFactor ?? DEFAULT_SHRINK;

  const lower = options.lower ?? new Float64Array(n).fill(0);
  const upper = options.upper ?? new Float64Array(n).fill(1);

  // Clamp the initial point into bounds so the search is always feasible.
  const current = Float64Array.from(options.initial);
  for (let i = 0; i < n; i++) {
    if (current[i]! < lower[i]!) current[i] = lower[i]!;
    else if (current[i]! > upper[i]!) current[i] = upper[i]!;
  }

  const steps = Float64Array.from(options.stepSizes).map((s) => Math.abs(s));
  const candidate = new Float64Array(n);
  const history: CoordinateDescentStep[] = [];

  let bestScore = await oracle(Float64Array.from(current));
  let evaluations = 1;

  const tryCandidate = async (): Promise<boolean> => {
    const score = await oracle(Float64Array.from(candidate));
    evaluations++;
    if (score > bestScore) {
      bestScore = score;
      current.set(candidate);
      return true;
    }
    return false;
  };

  let rounds = 0;
  for (let round = 1; round <= maxRounds; round++) {
    rounds = round;

    for (let dim = 0; dim < n; dim++) {
      candidate.set(current);
      // Try +step (clamped to upper bound).
      candidate[dim] = Math.min(current[dim]! + steps[dim]!, upper[dim]!);
      let improved = false;
      if (candidate[dim] !== current[dim]) {
        improved = await tryCandidate();
      }
      if (!improved) {
        // Try −step (clamped to lower bound).
        candidate.set(current);
        candidate[dim] = Math.max(current[dim]! - steps[dim]!, lower[dim]!);
        if (candidate[dim] !== current[dim]) {
          improved = await tryCandidate();
        }
      }
      history.push({ round, dim, score: bestScore, improved });
    }

    // Stop if every step is below the threshold.
    let converged = true;
    for (let i = 0; i < n; i++) {
      if (steps[i]! >= minStep) {
        converged = false;
        break;
      }
    }
    if (converged) break;

    for (let i = 0; i < n; i++) {
      steps[i] = steps[i]! * shrink;
    }
  }

  return {
    best: Float64Array.from(current),
    bestScore,
    rounds,
    evaluations,
    history,
  };
}
