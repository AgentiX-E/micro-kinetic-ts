/**
 * The scale-free census: where the truth stands on the axis the ratio threshold could not be.
 *
 * ## What this instrument is for
 *
 * Four refinements of the trace term have been refused by measurement — the leader mask, the tail-only rule, the
 * failure-direction vector and the materiality floor — and every refusal was a statement about the SHAPE of the
 * evidence. This census reads the one shape they left standing: a count change measured in units of its own
 * Poisson fluctuation (`traceSignificanceOf`), with the fleet's common-mode drift divided out.
 *
 * It is a census and not an arm. It answers three questions that an arm would otherwise have to guess:
 *
 * 1. **Does the axis carry the separation at all?** `truth-loudest` counts the cases where the ground truth holds
 *    the largest `|z|` in its cell. No selector on this axis can beat that number, so it is the ceiling and the
 *    first thing to read.
 * 2. **Is the miss a matter of MAGNITUDE or of SIGN?** The five TrainTicket route misses are cases where the
 *    truth's count FELL (0.82–0.94 on `pre ≈ 12 000`). If the truth is loud on those cases with a negative `z`,
 *    then the rule's premise — "a source does MORE work" — is what excluded it, and no threshold repairs a
 *    premise. If the truth is quiet there too, the axis is dead and the cell closes.
 * 3. **What would a selector have DONE?** Two policies are simulated over the same population, with no change to
 *    the engine: `zUp` votes for the unique service with `z ≥ 3`, `zAbs` for the unique one with `|z| ≥ 3` (three
 *    sigma, the conventional detection bar). Each is scored against the truth AND against the engine's own vote,
 *    so the cost of the abstentions is counted beside the gain.
 *
 * ## The control this census keeps
 *
 * The engine's own vote is recorded on the same cases (`traceVote`) and re-scored here rather than assumed. A
 * dispatch that changed the rule moves the two together or not at all, so an `engine` column that disagreed with
 * `[trace-vote]`'s totals would be a defect in this census rather than a finding about the corpus.
 *
 * @module benchmarks/trace-z-census
 */

import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import type { ServiceSignificance } from '../../packages/kinetic/src/benchmarks/runners/trace-significance.js';

/**
 * The significance bar both simulated policies use: three standard deviations.
 *
 * Three rather than two because a benchmark cell is a MULTIPLE-COMPARISON setting — sixty-eight services are tested
 * per case, so a two-sigma bar admits a false candidate on roughly one case in twenty by construction, and the whole
 * difficulty of this cell is that one plausible extra candidate turns a vote into an abstention. The bar is stated
 * here rather than parameterised because a census that swept its own bar would report the best of many readings as
 * though it were the one reading.
 */
export const Z_SIGNIFICANT = 3;

/** How many services a case line lists before it stops — three is the width of a comparison, not a ranking. */
const TOP_WIDTH = 3;

/** One policy's simulated outcome, scored against the truth and against the engine. */
export interface PolicyScore {
  /** Cases where the policy would have cast a vote. */
  readonly votes: number;
  /** Votes that would have named the ground truth. */
  readonly hits: number;
  /** Cases where the engine voted WRONG and this policy abstains — the wrong unit is withdrawn. */
  readonly withdrawn: number;
  /** Cases where the engine voted RIGHT and this policy abstains — the right unit is surrendered. */
  readonly surrendered: number;
}

/** The whole cell's readings. */
export interface TraceZCensus {
  /** Cases carrying a measurable axis. */
  readonly cases: number;
  /** Cases whose ground truth is in the population (it has a pre-injection baseline). */
  readonly truthMeasured: number;
  /** Cases where the truth holds the largest `|z|` in its cell — the ceiling of any selector on this axis. */
  readonly truthLoudest: number;
  /** Measured truths with `z > 0`: a source that did MORE work. */
  readonly truthRising: number;
  /** Measured truths with `z < 0`: a source that did LESS — the shape of the five route misses. */
  readonly truthFalling: number;
  /** Measured truths with `|z| >= Z_SIGNIFICANT`. */
  readonly truthSignificant: number;
  /** The engine's own vote on these cases, re-scored here as the control. */
  readonly engine: PolicyScore;
  /** The unique service with `z >= Z_SIGNIFICANT`. */
  readonly zUp: PolicyScore;
  /** The unique service with `|z| >= Z_SIGNIFICANT`. */
  readonly zAbs: PolicyScore;
}

/**
 * The shared zero, frozen.
 *
 * One object rather than a fresh literal per policy, because the fold is what produces new totals and the initial
 * state has no identity of its own. Frozen so that a future in-place fold cannot quietly mutate the seed every cell
 * is created from — the failure would be silent and would move every cell's numbers.
 */
const ZERO_POLICY: PolicyScore = Object.freeze({ votes: 0, hits: 0, withdrawn: 0, surrendered: 0 });

/**
 * A census with nothing in it.
 *
 * @returns Zeroed totals, ready for {@link accumulateTraceZ}.
 */
export function createTraceZCensus(): TraceZCensus {
  return {
    cases: 0,
    truthMeasured: 0,
    truthLoudest: 0,
    truthRising: 0,
    truthFalling: 0,
    truthSignificant: 0,
    engine: ZERO_POLICY,
    zUp: ZERO_POLICY,
    zAbs: ZERO_POLICY,
  };
}

/** The service each policy selects on one case, or `undefined` when it abstains. */
interface PolicyChoice {
  readonly zUp: string | undefined;
  readonly zAbs: string | undefined;
}

/**
 * Apply both policies to one case's ordered population.
 *
 * Uniqueness is the policies' whole content, and it is what makes them a comparison with the rule rather than a
 * ranking of their own: the rule this would replace also abstains when two services qualify, so a policy that
 * always named the loudest one would be measuring a different term and its totals would not be comparable.
 */
function choosePolicy(ranked: readonly ServiceSignificance[]): PolicyChoice {
  let rising: string | undefined;
  let risingCount = 0;
  let any: string | undefined;
  let anyCount = 0;
  for (const entry of ranked) {
    if (entry.z >= Z_SIGNIFICANT) {
      risingCount += 1;
      rising = entry.service;
    }
    if (Math.abs(entry.z) >= Z_SIGNIFICANT) {
      anyCount += 1;
      any = entry.service;
    }
  }
  return {
    zUp: risingCount === 1 ? rising : undefined,
    zAbs: anyCount === 1 ? any : undefined,
  };
}

/**
 * Add one case to one policy's totals.
 *
 * A vote is scored against the truth. An ABSTENTION is scored against the ENGINE's vote instead: withdrawing a
 * wrong unit and surrendering a right one are different consequences — a withdrawn unit leaves the ranking to its
 * other terms, a surrendered unit is given away — so they are counted apart rather than netted.
 */
function scoreCase(
  target: PolicyScore,
  vote: string | undefined,
  prediction: CasePrediction,
): PolicyScore {
  if (vote !== undefined) {
    return {
      votes: target.votes + 1,
      hits: target.hits + (vote === prediction.truth ? 1 : 0),
      withdrawn: target.withdrawn,
      surrendered: target.surrendered,
    };
  }
  const engineVote = prediction.traceVote;
  if (engineVote === undefined) return target;
  return {
    votes: target.votes,
    hits: target.hits,
    withdrawn: target.withdrawn + (engineVote === prediction.truth ? 0 : 1),
    surrendered: target.surrendered + (engineVote === prediction.truth ? 1 : 0),
  };
}

/**
 * Fold one case into the census.
 *
 * Pure: the caller rebinds the result, so two cells cannot share an accumulator by reference and a test can compare
 * a fold's output against a literal.
 *
 * @param census - The running totals.
 * @param prediction - The runner's record for one case.
 * @returns The updated totals, or the same object when the case carries no measurable axis.
 */
export function accumulateTraceZ(census: TraceZCensus, prediction: CasePrediction): TraceZCensus {
  const axis = prediction.traceSignificance;
  if (axis === undefined) return census;

  const truth = axis.truth;
  const choice = choosePolicy(axis.ranked);
  return {
    cases: census.cases + 1,
    truthMeasured: census.truthMeasured + (truth === undefined ? 0 : 1),
    truthLoudest: census.truthLoudest + (truth !== undefined && axis.truthRank === 1 ? 1 : 0),
    truthRising: census.truthRising + (truth !== undefined && truth.z > 0 ? 1 : 0),
    truthFalling: census.truthFalling + (truth !== undefined && truth.z < 0 ? 1 : 0),
    truthSignificant:
      census.truthSignificant + (truth !== undefined && Math.abs(truth.z) >= Z_SIGNIFICANT ? 1 : 0),
    engine: scoreCase(census.engine, prediction.traceVote, prediction),
    zUp: scoreCase(census.zUp, choice.zUp, prediction),
    zAbs: scoreCase(census.zAbs, choice.zAbs, prediction),
  };
}

/** Render a `z` to one decimal with an explicit sign — a signed axis whose zero must not read as "absent". */
function signedZ(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

/**
 * One case as a line: the drift, the three loudest services, and where the truth stands.
 *
 * The truth's own entry is printed whether or not it is among the three loudest — it is the subject of the line, and
 * a reader should not have to check whether the subject happens to fall inside the sample. The column repeats the
 * `z` and the rank but not the counts, which are on the same line above.
 *
 * @param prediction - The runner's record for one case.
 * @returns The line, or `undefined` when the case carries no measurable axis.
 */
export function formatTraceZCaseLine(prediction: CasePrediction): string | undefined {
  const axis = prediction.traceSignificance;
  if (axis === undefined) return undefined;

  const top = axis.ranked
    .slice(0, TOP_WIDTH)
    .map(
      (e, i) => `${String(i + 1)} ${e.service} ${signedZ(e.z)} ${String(e.pre)}→${String(e.post)}`,
    )
    .join(' | ');

  const truth =
    axis.truth === undefined || axis.truthRank === undefined
      ? 'truth-not-measured'
      : `truth=${axis.truth.service} z=${signedZ(axis.truth.z)} rank=${String(axis.truthRank)}`;

  const engineVote = prediction.traceVote;
  const engine =
    engineVote === undefined
      ? 'engine=-'
      : `engine=${engineVote} ${engineVote === prediction.truth ? 'HIT' : 'MISS'}`;

  const choice = choosePolicy(axis.ranked);
  return (
    `[trace-z] ${prediction.caseId} drift=${axis.drift.toFixed(2)} | ${top} | ${truth} | ${engine}` +
    ` | zUp=${choice.zUp ?? '-'} zAbs=${choice.zAbs ?? '-'}`
  );
}

/** Render one policy's totals in a fixed column order, so three cells can be read against each other. */
function policyCell(label: string, p: PolicyScore): string {
  return (
    `${label} votes=${String(p.votes)} hits=${String(p.hits)} ` +
    `withdrawn=${String(p.withdrawn)} surrendered=${String(p.surrendered)}`
  );
}

/**
 * The whole cell as one line.
 *
 * @param census - The running totals.
 * @returns The line, or `undefined` when no case in the cell carried a measurable axis — a cell without traces
 *   prints nothing, so the absence is visible as the absence of the family rather than as a row of zeros.
 */
export function formatTraceZCensusLine(census: TraceZCensus): string | undefined {
  if (census.cases === 0) return undefined;
  return (
    `[trace-z] total cases=${String(census.cases)} truth-measured=${String(census.truthMeasured)} ` +
    `truth-loudest=${String(census.truthLoudest)} truth-rising=${String(census.truthRising)} ` +
    `truth-falling=${String(census.truthFalling)} truth-|z|>=${String(Z_SIGNIFICANT)}=` +
    `${String(census.truthSignificant)} | ${policyCell('engine', census.engine)} ` +
    `| ${policyCell('zUp', census.zUp)} | ${policyCell('zAbs', census.zAbs)}`
  );
}
