/**
 * The arm's published order: one settled name, promoted over the order it was settled against.
 *
 * ## The gap this closes
 *
 * `sota-comparison.md` §0c-vii carries the LLM arm at **`1 327 = 93.32 %`** on the FSE'26 corpus and, beside it, a
 * refusal: the board publishes six metrics and the arm had one, because the arm's artifact records **one name per
 * case** and four of the six are functions of a position in an ORDER. The refusal was right about the arithmetic —
 * an `MRR` computed from a mean of a published rate is a fabricated column — and it was wrong about the artifact:
 * the arm's `query-agent.ndjson` sits beside `depth.ndjson` **from the same run**, and `depth.ndjson` carries the
 * engine's full order for every case. A settled name plus the order it was settled over is an order: the arm's own
 * product is "the engine's ranking, re-read", and the re-reading is one name moved to the front.
 *
 * ## Why the promotion rule is the arm's rule and not a convenience
 *
 * The free-investigation arm does not emit a ranking. It emits an ANSWER — `TOOL answer <name>`, enforced by the
 * harness (`benchmarks/src/query-agent.ts`) — and the harness holds a prior it may override. So the question "what
 * would this arm publish as a five-wide list" has exactly one answer that does not invent anything: the name it
 * settled on, then the prior's order without it. That is also the composition the arm's own gate is defined against
 * (`--fallback engine`, `--resolve edge-novel`: a refused override falls back to the prior), so the composed order IS
 * the shipped product's order at every setting of the gate.
 *
 * The depth consequence is what makes this worth a module rather than a line of arithmetic. Promoting one name
 * **demotes everything above it by one**, so an arm can repair the head and cost a rank at depth in the same case.
 * On the 2026-11-25 dispatch it never did: `+171` cases at rank 1, `+125` at rank 5, and **zero** cases where a
 * truth inside the top five was pushed out of it. A reader who assumed either sign without measuring would have been
 * guessing in one direction or the other.
 *
 * ## What this module refuses
 *
 * Every refusal here is a comparison across two populations, a truncated order read as a whole one, or a name that
 * is not a name. Each is refused by name rather than dropped, because a composed row that quietly lost a case is a
 * denominator nobody can state.
 *
 * @module benchmarks/arm-order
 */

import { readFileSync } from 'node:fs';

import { bestAcceptedRank } from '../../packages/kinetic/src/benchmarks/loaders/types.js';

import type { PerCaseVerdict } from './fse26-per-case.js';
import { PER_CASE_RANK_LIMIT } from './fse26-per-case.js';
import type { DepthRow } from './ranking-depth.js';

/** One case's settled answer: the two fields this module reads out of an arm artifact. */
export interface ArmAnswerRow {
  /** The case directory's name, which is the corpus's stable id for the case. */
  readonly datapack: string;
  /** The service the arm settled on. */
  readonly answer: string;
}

/** Where the arm's name sat in the order it was settled over. */
export type PromotedFrom =
  /** The engine's own head: the arm agreed and the order is unchanged. */
  | 'head'
  /** Somewhere inside the order, so everything above it is demoted by one. */
  | 'order'
  /** Nowhere in the order: the arm named a service the pool did not carry. */
  | 'outside';

/** One case, composed: the arm's published order as a verdict row, and where its name came from. */
export interface ComposedRow {
  /** The row the board's metric layer reads. */
  readonly verdict: PerCaseVerdict;
  /** Where the arm's answer sat in the engine's order. */
  readonly promotedFrom: PromotedFrom;
  /** The answer's rank in the engine's order, `0` when that order did not carry it. */
  readonly engineAnswerRank: number;
}

/** How the arm's answers sit against the orders they were settled over. */
export interface CompositionCensus {
  readonly cases: number;
  /** Answers that were already the engine's head — the arm retained the prior. */
  readonly alreadyFirst: number;
  /** Answers promoted from inside the order, each demoting every name above it by one. */
  readonly promotedFromOrder: number;
  /** Answers naming a service the pool did not carry. */
  readonly promotedFromOutside: number;
}

/**
 * The arm's published order: the settled name first, then the order without it.
 *
 * @param order - The engine's full order for the case, best first.
 * @param answer - The service the arm settled on.
 * @param where - The case label used in a refusal, so a failure names the row.
 * @returns The composed order, one name longer than `order` when the answer was not in it.
 * @throws Error when the answer is empty (a stop is not a name) or the order names a service twice.
 */
export function promoteAnswer(
  order: readonly string[],
  answer: string,
  where = 'arm order',
): string[] {
  if (answer === '') {
    throw new Error(`${where}: the arm settled on nothing, and a stop is not a name`);
  }
  const seen = new Set<string>();
  for (const name of order) {
    if (seen.has(name)) {
      throw new Error(
        `${where}: names ${name} twice in its order, so a position is not a position`,
      );
    }
    seen.add(name);
  }
  return [answer, ...order.filter((name) => name !== answer)];
}

/**
 * Compose every case the two artifacts share into a verdict row the board's metric layer can read.
 *
 * @param engine - The run's depth rows: one per case, carrying the FULL order.
 * @param answers - The arm's settled answers, one per case.
 * @returns One row per case the arm answered, in the engine file's order. A sampled dispatch composes its sample;
 *   the count is the caller's to print against the engine's, because a denominator nobody states is the error the
 *   board comparison refuses one layer up.
 * @throws Error when either population is empty, when an answer names a case the engine did not score, when a case
 *   carries two answers, when a depth row's order is truncated below its own candidate count, or when a row is not a
 *   name.
 */
export function composeArmVerdicts(
  engine: readonly DepthRow[],
  answers: readonly ArmAnswerRow[],
): ComposedRow[] {
  if (engine.length === 0) {
    throw new Error(
      'arm order: the engine order held no cases, and an average over none is not zero',
    );
  }
  if (answers.length === 0) {
    throw new Error('arm order: the arm answered no cases, so there is no order to compose');
  }
  const byCase = new Map<string, string>();
  for (const row of answers) {
    if (byCase.has(row.datapack)) {
      throw new Error(
        `arm order: two answers for one case (\`${row.datapack}\`), so one of them would be dropped`,
      );
    }
    byCase.set(row.datapack, row.answer);
  }
  const engineCases = new Set(engine.map((row) => row.datapack));
  const unscored = [...byCase.keys()].filter((id) => !engineCases.has(id));
  if (unscored.length > 0) {
    throw new Error(
      `arm order: ${String(unscored.length)} arm answer(s) name a case the engine did not score ` +
        `(for example \`${unscored[0]!}\`), so the two files are not one population`,
    );
  }
  // The arm's population, not the engine's. A dispatch may sample (`query_agent_sample`), and a sample is a stated
  // property of the artifact rather than a defect in it: the composed file carries the cases the arm ANSWERED, and
  // the caller prints that count against the engine's. What is refused is the other direction — an answer to a case
  // the engine never scored — because there is no order to compose it over.
  const scored = engine.filter((row) => byCase.has(row.datapack));
  return scored.map((row, index) =>
    composeOne(row, byCase.get(row.datapack)!, `row ${String(index + 1)} (${row.datapack})`),
  );
}

/**
 * Compose one case. Split out of the loop so the row label is built in one place.
 *
 * @param row - The engine's depth row.
 * @param answer - The arm's settled name.
 * @param where - The row label used in a refusal.
 * @returns The composed row.
 */
function composeOne(row: DepthRow, answer: string, where: string): ComposedRow {
  const order = row.top.map((entry) => entry[0]);
  if (order.length < row.candidates) {
    // A dump truncated below its own candidate count cannot state a position beyond its head, and a `truthRank`
    // read from a prefix is the defect `computeBoardMetrics` refuses one layer up. The composer refuses it first so
    // the failure names the dump rather than the metric.
    throw new Error(
      `${where}: carries ${String(order.length)} of its own ${String(row.candidates)} candidates, ` +
        'so a rank over it would be a prefix reading',
    );
  }
  const composed = promoteAnswer(order, answer, where);
  const engineAnswerRank = order.indexOf(answer) + 1;
  const outside = engineAnswerRank === 0;
  return {
    verdict: {
      datapack: row.datapack,
      faultType: row.faultType,
      accepted: row.accepted,
      ranked: composed.slice(0, PER_CASE_RANK_LIMIT),
      // The rank is read over the WHOLE composed order, so `MRR` and `Top@k` are exact at every depth rather than
      // exact up to the five-wide prefix this file publishes.
      truthRank: bestAcceptedRank(
        composed.map((serviceId) => ({ serviceId })),
        row.accepted,
      ),
      // The pool grows by one exactly when the arm named a service the pool did not carry: the composed order then
      // holds one candidate the run's own deduction never saw, and a denominator that ignored it would make the row
      // claim a rank beyond its own order.
      pool: row.candidates + (outside ? 1 : 0),
    },
    promotedFrom: outside ? 'outside' : answer === order[0] ? 'head' : 'order',
    engineAnswerRank,
  };
}

/**
 * Count the three ways an answer can sit against the order it was settled over.
 *
 * @param rows - The composed rows.
 * @returns The census.
 */
export function summariseComposition(rows: readonly ComposedRow[]): CompositionCensus {
  let alreadyFirst = 0;
  let promotedFromOrder = 0;
  let promotedFromOutside = 0;
  for (const row of rows) {
    if (row.promotedFrom === 'head') alreadyFirst += 1;
    else if (row.promotedFrom === 'order') promotedFromOrder += 1;
    else promotedFromOutside += 1;
  }
  return { cases: rows.length, alreadyFirst, promotedFromOrder, promotedFromOutside };
}

/**
 * Read an arm artifact's answers, one JSONL row per case.
 *
 * The arm's record carries dozens of fields — the trace, the tokens, the gate's verdicts — and this module reads two
 * of them. The rest are not validated here: a reader that policed another module's artifact would be a second
 * definition of that artifact.
 *
 * @param text - The artifact's contents.
 * @returns One row per non-blank line, in file order.
 * @throws Error when a line is not a JSON record, or carries no `datapack`, or an `answer` that is not a string.
 */
export function parseArmAnswers(text: string): ArmAnswerRow[] {
  const rows: ArmAnswerRow[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const where = `arm answers: line ${String(index + 1)}`;
    const record = asRecord(line, where);
    const datapack = record['datapack'];
    if (typeof datapack !== 'string' || datapack === '') {
      throw new Error(`${where} carries no datapack`);
    }
    const answer = record['answer'];
    if (answer === undefined) {
      throw new Error(`${where} carries no answer`);
    }
    if (typeof answer !== 'string') {
      throw new Error(`${where} carries an answer that is not a string`);
    }
    rows.push({ datapack, answer });
  }
  return rows;
}

/**
 * Parse one line as a JSON object, refusing anything else by line number.
 *
 * @param line - The line's text.
 * @param where - The label used in a refusal.
 * @returns The record, as a bag of unknown fields.
 */
function asRecord(line: string, where: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`${where} is not JSON, so the artifact is truncated or is not this format`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${where} is not a record`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Read an arm artifact from disk.
 *
 * @param path - The artifact's path.
 * @returns One row per case the file carries.
 * @throws Error as {@link parseArmAnswers}.
 */
export function readArmAnswers(path: string): ArmAnswerRow[] {
  return parseArmAnswers(readFileSync(path, 'utf8'));
}
