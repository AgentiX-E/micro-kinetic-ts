/**
 * Why the arm missed a case, as a code rather than as an adjective.
 *
 * ## Why this exists
 *
 * Every iteration since 316 has ended with a sentence of the form "what is left is X" — salience, direction, the
 * base term — and every one of those sentences was written by reading a dozen traces. A dozen traces out of thirty
 * misses is an anecdote with a percentage attached. `arXiv:2608.21310` makes the same argument from the other side:
 * it codes 154 incorrectly localized trajectories into twelve behaviours and finds that **86.0 %** of the
 * strongest model's failures are a single code, which is a number no reading of a dozen traces could have produced.
 *
 * ## What this classifies, and what it deliberately does not
 *
 * The twelve-code book of that paper is built from **trajectories**: it reads what the agent did, message by
 * message. This module reads the **artifact** — the records every run already writes — plus the case's call graph,
 * and it codes only the distinctions those records can decide:
 *
 * * whether the arm answered at all;
 * * whether its answer was refused, and therefore whether the prior answered;
 * * whether the answer sits **above** the truth (a caller: direction reversed), **below** it (a callee: overshoot),
 *   or in another branch entirely;
 * * whether the truth was ever queried.
 *
 * Every one of those is decidable from a row and a graph, which makes the census re-derivable and cheap. What it
 * cannot decide is *why* the model preferred a wrong service — salience, a misread metric, a bad argument. That is
 * a claim about reasoning and it needs the transcript, so it is **not coded here**: a code that guessed would put
 * an anecdote back inside the number this module exists to replace.
 *
 * @module benchmarks/agentic-failure-codes
 */

/** One miss's cause, in priority order: the first code that applies is the one reported. */
export const FAILURE_CODES = [
  'never-answered',
  'refused-fallback',
  'answered-upstream',
  'answered-downstream',
  'answered-other-branch',
  'answered-elsewhere-truth-queried',
] as const;

/** A miss's code. */
export type FailureCode = (typeof FAILURE_CODES)[number];

/** The part of an artifact row this reads. `QueryArmRow` satisfies it structurally. */
export interface MissRecord {
  readonly truth: readonly string[];
  readonly answer: string | null;
  /** The model's own answer before the gate, or `null` when it never named one. */
  readonly rawAnswer: string | null;
  /** The prior's first name, or `null` when the arm had no prior. */
  readonly engineWinner: string | null;
  /** Services the investigation executed a per-service query against. */
  readonly calls: readonly string[];
}

/** What the classifier needs to know about the case's shape. */
export interface MissGraph {
  readonly callers: ReadonlySet<string>;
  readonly callees: ReadonlySet<string>;
}

/**
 * Classify one miss.
 *
 * The ladder is ordered by what the record can prove, strongest first, because the codes overlap: a refused
 * fallback whose prior is also upstream of the truth is both a refusal and a direction error, and only one of them
 * says what to change. A refusal is the harness's decision and therefore comes first; a direction error is the
 * model's and comes after.
 *
 * @param record - The artifact row.
 * @param graph - The truth's direct callers and callees.
 * @returns The code, or `undefined` when the row is a hit and has no cause to report.
 */
export function classifyMiss(record: MissRecord, graph: MissGraph): FailureCode | undefined {
  const truth = record.truth[0];
  if (truth === undefined) return undefined;
  if (record.answer !== null && record.truth.includes(record.answer)) return undefined;
  if (record.rawAnswer === null) return 'never-answered';
  // A refusal is visible only through the answer: the gate's fallback replaces the model's name with the prior's.
  // A null answer is therefore tested against a NON-NULL prior — with no prior there is no fallback to observe, and
  // `null === null` would report a free arm's silence as the gate's decision.
  if (
    record.engineWinner !== null &&
    record.answer === record.engineWinner &&
    record.rawAnswer !== record.engineWinner
  ) {
    return 'refused-fallback';
  }
  const answered = record.answer ?? record.rawAnswer;
  if (graph.callers.has(answered)) return 'answered-upstream';
  if (graph.callees.has(answered)) return 'answered-downstream';
  if (record.calls.includes(truth)) return 'answered-elsewhere-truth-queried';
  return 'answered-other-branch';
}

/** Running totals over one population. */
export interface FailureCodeCensus {
  readonly cases: number;
  readonly misses: number;
  readonly byCode: Record<FailureCode, number>;
}

/** A census with nothing counted yet. */
export function createFailureCodeCensus(): FailureCodeCensus {
  const byCode = {} as Record<FailureCode, number>;
  for (const code of FAILURE_CODES) byCode[code] = 0;
  return { cases: 0, misses: 0, byCode };
}

/** Fold one row into the census. */
export function accumulateFailureCodeCensus(
  census: FailureCodeCensus,
  record: MissRecord,
  graph: MissGraph,
): FailureCodeCensus {
  const code = classifyMiss(record, graph);
  return {
    cases: census.cases + 1,
    misses: census.misses + (code === undefined ? 0 : 1),
    byCode:
      code === undefined ? census.byCode : { ...census.byCode, [code]: census.byCode[code] + 1 },
  };
}

/**
 * The census as lines, ordered by the ladder rather than by count.
 *
 * Ordered by the LADDER because the order is the priority: a reader comparing two arms needs the rows in the same
 * places, and a table sorted by count would move a row every time a code gained a case.
 *
 * @param census - The totals.
 * @returns The lines, one per code that occurred.
 */
export function renderFailureCodeCensus(census: FailureCodeCensus): string[] {
  const lines = [
    `misses ${census.misses} of ${census.cases} cases ` +
      `(${((census.misses / Math.max(census.cases, 1)) * 100).toFixed(1)}%)`,
  ];
  for (const code of FAILURE_CODES) {
    const count = census.byCode[code];
    if (count === 0) continue;
    const share = (count / Math.max(census.misses, 1)) * 100;
    lines.push(
      `  ${code.padEnd(32)} ${String(count).padStart(3)}  ${share.toFixed(1).padStart(5)}%`,
    );
  }
  return lines;
}
