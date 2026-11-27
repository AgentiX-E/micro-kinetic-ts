/**
 * Re-score an arm artifact under a gate policy the run was not dispatched with, and write the settled names.
 *
 * ## The reading this closes
 *
 * The counter-intuitive number in this programme is that the arm with a model in it scores WORSE than the engine it
 * sits on. Run `44909105091` carries it: `agent Top@1 732 · engine Top@1 on the same cases 1 157`. The same artifact
 * carries the other half of the same table, one line below: under the policy the product SHIPS (`lag`, falling back
 * to the engine) the same 1 422 transcripts settle `1 181` (`83.05 %`, `+24` net). Both readings are of ONE artifact,
 * produced from ONE set of transcripts, and they differ by the gate — `none` against `lag`.
 *
 * The board carried only the first, and it carried it for a reason that was correct: the arm publishes a NAME per
 * case, and five of the board's six columns are functions of a position in an ORDER. `arm-order.ts` closed that for
 * the arm's DISPATCHED configuration (a settled name plus the order it was settled over is an order). What was still
 * missing is the same composition for the four policies the run did not dispatch, and that is this module: the gate
 * is a decision about one field of a row, `summariseGatePolicies` already re-scores it at zero cost, and the name it
 * settles on is all the composer needs.
 *
 * So the two readings above stop being a contradiction between a model and an engine and become a difference between
 * two CONFIGURATIONS of one arm, measured on one population with one reader. A reader who wants to know whether the
 * model helps asks this module; a reader who wants to know what the model would have said with nothing behind it asks
 * the free arm.
 *
 * ## The rule is the loop's rule, not a second one
 *
 * `replayGateAnswer` calls `gateAdmits` — the function `investigate` calls — with the context the artifact carries,
 * and applies the same fallback the loop applies. It is deliberately not a re-derivation: a second implementation of
 * a gate is a second definition of what the arm ships, which is the defect `board-metrics.md` §3.3 found in the
 * platform's own `MRR`.
 *
 * Two consequences follow from that, and both are asserted in the tests:
 *
 * * An artifact's `answer` column is reproduced EXACTLY by replaying the policy it was dispatched with. That is the
 *   check that this module and the loop agree, and the report command refuses to write a file when it fails.
 * * A case the model never answered — the certainty floor settled it before the first call — has nothing to gate and
 *   settles on the prior under EVERY policy. The runner's own gate table charges such a case to `null` under `none`
 *   (a control with a fallback would not be the surface iteration 318 measured), so the table's `none` row and this
 *   module's `none` replay differ on exactly those rows, and the tests pin the difference rather than hiding it.
 *
 * ## What this module refuses
 *
 * A row it cannot read as one of the shapes the loop writes, a policy name it does not know, and — in
 * `replayDisagreements` — a settled column that does not match the artifact it was replayed from. Each refusal names
 * the line or the case, because a replay that silently dropped a row would be a denominator nobody can state.
 *
 * @module benchmarks/arm-gate-replay
 */

import type { ArmAnswerRow } from './arm-order.js';
import type { GatePolicy, Onset } from './query-agent.js';
import { gateAdmits } from './query-agent.js';

/**
 * The fields a replay reads out of one artifact row. `QueryArmRow` satisfies it structurally.
 *
 * The list is short on purpose: the artifact carries dozens of columns (the trace, the tokens, the tool census) and a
 * reader that validated another module's artifact would be a second definition of that artifact. These are exactly
 * the columns `gateAdmits` reads plus the three the census counts.
 */
export interface GateReplayRow {
  /** The case directory's name, which is the corpus's stable id for the case. */
  readonly datapack: string;
  /** How the investigation ended: `error` is the only value a replay drops. */
  readonly stop: string;
  /** The service the loop settled on under the policy it was dispatched with. */
  readonly answer: string | null;
  /** The model's own answer before the gate, or `null` when the loop settled without calling it. */
  readonly rawAnswer: string | null;
  /** The prior's first name — what a refused override falls back to — or `null` on a free arm. */
  readonly engineWinner: string | null;
  /** Services the investigation executed a per-service query against. A refused query is not a record. */
  readonly calls: readonly string[];
  /** Whether the model's answer sits on the prior's callee-side cone. */
  readonly inCone: boolean;
  /** The answer's own evidence, or `null` when the case does not carry that name. */
  readonly answerOnset: Onset | null;
  /** The prior's own evidence, or `null` when there is no prior. */
  readonly priorOnset: Onset | null;
  /** How the interface between the two failed, from the answer's side. */
  readonly intoAnswer: number | null;
  /** How the interface between the two failed, from the prior's side. */
  readonly intoPrior: number | null;
}

/** What a replay counted while it decided. Every field is a refusal the reader has to be able to subtract. */
export interface ReplayCensus {
  /** Rows in the artifact. */
  readonly cases: number;
  /** Rows the investigation ended on with `error`: no settlement to replay, and they are not in the output. */
  readonly errored: number;
  /** Cases the certainty floor settled before the first call, so the arm had no name of its own to gate. */
  readonly settledBeforeModel: number;
  /** Cases where the model's own answer WAS the prior's first name, so there was no override to decide. */
  readonly agreedWithPrior: number;
  /** Overrides the policy let stand. */
  readonly admitted: number;
  /** Overrides the policy refused, each falling back to the prior. */
  readonly refused: number;
  /** Cases left with no name at all — a free arm whose model answered nothing. */
  readonly unanswered: number;
}

/** A replayed artifact: the settled names in the artifact's own order, and what the replay counted. */
export interface ReplayOutcome {
  /** One row per case the replay settled, in the artifact's order. */
  readonly answers: readonly ArmAnswerRow[];
  /** The census behind the answers. */
  readonly census: ReplayCensus;
}

/** One case where a replay disagreed with the column the artifact recorded. */
export interface ReplayDisagreement {
  /** The case. */
  readonly datapack: string;
  /** What the artifact says the loop settled on. */
  readonly recorded: string | null;
  /** What this module says the same policy settles on. */
  readonly replayed: string | null;
}

/** The policy names this module accepts, which are the loop's own. */
const POLICIES: readonly string[] = ['none', 'cited', 'cone', 'contrast', 'lag'];

/**
 * Read one onset block.
 *
 * @param value - The parsed value.
 * @param where - The row label used in a refusal.
 * @param field - The field name used in a refusal.
 * @returns The onset, or `null` when the artifact recorded none.
 * @throws Error when the value is neither `null` nor an onset block.
 */
function asOnset(value: unknown, where: string, field: string): Onset | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where}: \`${field}\` is neither null nor an onset block`);
  }
  const block = value as Record<string, unknown>;
  const firstError = block['firstError'];
  const fall = block['fall'];
  if (firstError !== null && firstError !== undefined && typeof firstError !== 'number') {
    throw new Error(`${where}: \`${field}.firstError\` is neither null nor a number`);
  }
  if (fall !== null && fall !== undefined && typeof fall !== 'number') {
    throw new Error(`${where}: \`${field}.fall\` is neither null nor a number`);
  }
  return { firstError: firstError ?? null, fall: fall ?? null };
}

/**
 * Read one nullable string column.
 *
 * @param value - The parsed value.
 * @param where - The row label used in a refusal.
 * @param field - The field name used in a refusal.
 * @returns The string, or `null` when the artifact recorded none.
 * @throws Error when the value is neither `null` nor a string.
 */
function asName(value: unknown, where: string, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new Error(`${where}: \`${field}\` is neither null nor a name`);
  return value;
}

/**
 * Read one nullable number column.
 *
 * @param value - The parsed value.
 * @param where - The row label used in a refusal.
 * @param field - The field name used in a refusal.
 * @returns The number, or `null` when the artifact recorded none.
 * @throws Error when the value is neither `null` nor a finite number.
 */
function asNumber(value: unknown, where: string, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where}: \`${field}\` is neither null nor a finite number`);
  }
  return value;
}

/**
 * Read one string list.
 *
 * @param value - The parsed value.
 * @param where - The row label used in a refusal.
 * @param field - The field name used in a refusal.
 * @returns The list, which may be empty.
 * @throws Error when the value is not a list of non-empty strings.
 */
function asNames(value: unknown, where: string, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${where}: \`${field}\` is not a list`);
  return value.map((entry: unknown) => {
    if (typeof entry !== 'string' || entry === '') {
      throw new Error(`${where}: \`${field}\` carries an entry that is not a name`);
    }
    return entry;
  });
}

/**
 * Parse an arm artifact's rows.
 *
 * @param text - The artifact's contents, one JSON record per line.
 * @returns One row per non-blank line, in file order.
 * @throws Error when a line is not a JSON object, or a column this module reads is not the shape the loop writes.
 */
export function parseGateReplayRows(text: string): GateReplayRow[] {
  const rows: GateReplayRow[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue;
    const where = `arm replay: line ${String(index + 1)}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${where} is not JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${where} is not a JSON object`);
    }
    const record = parsed as Record<string, unknown>;
    const datapack = record['datapack'];
    if (typeof datapack !== 'string' || datapack === '') {
      throw new Error(`${where} carries no datapack`);
    }
    const stop = record['stop'];
    if (typeof stop !== 'string' || stop === '') {
      throw new Error(`${where} carries no stop`);
    }
    const inCone = record['inCone'];
    if (typeof inCone !== 'boolean') {
      throw new Error(`${where}: \`inCone\` is not a boolean`);
    }
    rows.push({
      datapack,
      stop,
      answer: asName(record['answer'], where, 'answer'),
      rawAnswer: asName(record['rawAnswer'], where, 'rawAnswer'),
      engineWinner: asName(record['engineWinner'], where, 'engineWinner'),
      calls: asNames(record['calls'], where, 'calls'),
      inCone,
      answerOnset: asOnset(record['answerOnset'], where, 'answerOnset'),
      priorOnset: asOnset(record['priorOnset'], where, 'priorOnset'),
      intoAnswer: asNumber(record['intoAnswer'], where, 'intoAnswer'),
      intoPrior: asNumber(record['intoPrior'], where, 'intoPrior'),
    });
  }
  return rows;
}

/**
 * The name a policy settles one case on.
 *
 * The order of the three tests is the semantics, not an optimisation:
 *
 * 1. A case the model never answered has nothing to gate. It settles on the prior under every policy, including
 *    `none` — the certainty floor is a decision taken BEFORE the gate, so re-scoring the gate cannot move it.
 * 2. An answer that IS the prior's first name is not an override, and `gateAdmits` says so; the replay agrees
 *    without asking, because the answer it would ask about is the name it would fall back to.
 * 3. Everything else is the gate's decision, and a refusal falls back to the prior — which is what makes the arm
 *    monotone rather than merely selective.
 *
 * @param row - The artifact row.
 * @param policy - The rule to replay.
 * @returns The settled name, or `null` when the case has neither a model answer nor a prior.
 * @throws Error when the policy is not one the loop knows.
 */
export function replayGateAnswer(row: GateReplayRow, policy: GatePolicy): string | null {
  if (!POLICIES.includes(policy)) {
    throw new Error(`arm replay: \`${policy}\` is not a gate policy`);
  }
  if (row.rawAnswer === null) return row.engineWinner;
  if (row.engineWinner === null || row.rawAnswer === row.engineWinner) return row.rawAnswer;
  const stands = gateAdmits(policy, row.rawAnswer, {
    priorTop: row.engineWinner,
    cited: new Set(row.calls),
    onCone: row.inCone,
    evidence: {
      answer: row.answerOnset ?? undefined,
      prior: row.priorOnset ?? undefined,
      intoAnswer: row.intoAnswer,
      intoPrior: row.intoPrior,
    },
  });
  return stands ? row.rawAnswer : row.engineWinner;
}

/**
 * Replay every case under one policy.
 *
 * @param rows - The artifact's rows.
 * @param policy - The rule to replay.
 * @returns The settled names in the artifact's order, and the census behind them.
 * @throws Error when the policy is not one the loop knows.
 */
export function replayGateAnswers(
  rows: readonly GateReplayRow[],
  policy: GatePolicy,
): ReplayOutcome {
  const answers: ArmAnswerRow[] = [];
  let errored = 0;
  let settledBeforeModel = 0;
  let agreedWithPrior = 0;
  let admitted = 0;
  let refused = 0;
  let unanswered = 0;
  for (const row of rows) {
    if (row.stop === 'error') {
      errored += 1;
      continue;
    }
    const settled = replayGateAnswer(row, policy);
    if (row.rawAnswer === null) {
      if (row.engineWinner === null) unanswered += 1;
      else settledBeforeModel += 1;
    } else if (row.engineWinner !== null && row.rawAnswer === row.engineWinner)
      agreedWithPrior += 1;
    else if (settled === row.rawAnswer) admitted += 1;
    else refused += 1;
    if (settled === null) continue;
    answers.push({ datapack: row.datapack, answer: settled });
  }
  return {
    answers,
    census: {
      cases: rows.length,
      errored,
      settledBeforeModel,
      agreedWithPrior,
      admitted,
      refused,
      unanswered,
    },
  };
}

/**
 * Compare a replay against the column the artifact recorded.
 *
 * This is the check that makes every other number in this module a reading of the loop rather than of a copy of it:
 * replay the policy the run was DISPATCHED with and the settled names must be identical to the ones the loop wrote.
 *
 * @param rows - The artifact's rows.
 * @param replay - The replayed answers, as `replayGateAnswers` returned them.
 * @returns One entry per case the two disagree on, in the artifact's order. Empty means they are one rule.
 */
export function replayDisagreements(
  rows: readonly GateReplayRow[],
  replay: readonly ArmAnswerRow[],
): ReplayDisagreement[] {
  const settled = new Map<string, string>();
  for (const answer of replay) settled.set(answer.datapack, answer.answer);
  const disagreements: ReplayDisagreement[] = [];
  for (const row of rows) {
    if (row.stop === 'error') continue;
    const replayed = settled.get(row.datapack) ?? null;
    if (replayed !== row.answer) {
      disagreements.push({ datapack: row.datapack, recorded: row.answer, replayed });
    }
  }
  return disagreements;
}
