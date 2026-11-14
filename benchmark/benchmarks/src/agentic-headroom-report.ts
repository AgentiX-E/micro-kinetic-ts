/**
 * The rendering of an elimination arm's result: one table, one sweep, and the refusals beside the number.
 *
 * A rate on its own is not a report. An arm that abstained on 90 % of a corpus and got the remaining 10 % right
 * has a number that describes the tenth, and an arm whose claims were refused 40 % of the time has a number that
 * describes the verifier as much as the method. Both quantities are printed here next to every accuracy, and the
 * refusal tally is printed by REASON, because "unsupported statistic" and "band disagrees with fingerprint" are
 * two different repairs and only one of them is a defect in the prompt.
 *
 * Pure string building: no IO, no clock, so a test can assert a layout rather than a screenshot.
 *
 * @module benchmarks/agentic-headroom-report
 */

import type { ClaimRejection } from '../../packages/ai/src/agent/index.js';

import type { ArmOutcome, GatePoint, SweepPoint } from './agentic-headroom.js';

/** Percent, one decimal, the precision every table in this repository uses. */
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Pad a cell to a width, right-aligning a numeric column. */
function cell(text: string, width: number, right = false): string {
  return right ? text.padStart(width) : text.padEnd(width);
}

/** The header line of the arm table. */
const ARM_HEADER = [
  cell('arm', 9),
  cell('w', 5, true),
  cell('cases', 6, true),
  cell('top1', 7, true),
  cell('moved', 6, true),
  cell('claims', 7, true),
  cell('abstain', 8, true),
  cell('refused', 8, true),
  cell('absent', 7, true),
  cell('reach', 6, true),
].join(' ');

/**
 * One row per arm.
 *
 * `absent` is the count of cases whose truth was not in the posterior at all, and `reach` the count the oracle
 * could have moved. The two make the ceiling readable without a second table: an arm cannot beat `cases - absent`,
 * and it cannot exceed `reach` however good its model is.
 *
 * @param outcomes - One outcome per arm, in the order they should be read (control first).
 * @returns A fixed-width table, without a trailing newline.
 */
export function formatArmTable(outcomes: readonly ArmOutcome[]): string {
  const rows = outcomes.map((outcome) =>
    [
      cell(outcome.arm, 9),
      cell(outcome.weight.toFixed(2), 5, true),
      cell(String(outcome.cases), 6, true),
      cell(pct(outcome.top1), 7, true),
      cell(String(outcome.moved), 6, true),
      cell(String(outcome.claims), 7, true),
      cell(String(outcome.abstained), 8, true),
      cell(String(Object.values(outcome.refused).reduce((a, b) => a + b, 0)), 8, true),
      cell(String(outcome.truthAbsent), 7, true),
      cell(String(outcome.reachable), 6, true),
    ].join(' '),
  );
  return [ARM_HEADER, ...rows].join('\n');
}

/**
 * The refusal tally, one line, only the non-zero reasons.
 *
 * Zero reasons are omitted because printing all nine would bury the two that fired; a tally whose every entry is
 * printed is a table a reader stops reading.
 *
 * @param outcome - The arm's outcome.
 * @returns A one-line summary, or `no refusals` when the verifier accepted every claim.
 */
export function formatRefusals(outcome: ArmOutcome): string {
  const fired = (Object.entries(outcome.refused) as Array<[ClaimRejection, number]>).filter(
    ([, count]) => count > 0,
  );
  if (fired.length === 0) return 'no refusals';
  return fired.map(([reason, count]) => `${reason}=${count}`).join(', ');
}

/**
 * The skip rule's own census: how many cases resolved without a model, and by which rule.
 *
 * @param outcome - Any arm's outcome; the skip counts are a property of the population, not of the arm.
 * @returns A one-line summary.
 */
export function formatSkipCensus(outcome: ArmOutcome): string {
  const { margin, evidence, none } = outcome.skipped;
  return `skip: margin=${margin} evidence=${evidence} consulted=${none}`;
}

/**
 * The skip rule's grid: what it resolves, and what that costs in cases a perfect eliminator could have fixed.
 *
 * `fixable-skipped` is the column the rule is judged on. A gate that skips a case the engine got wrong and an
 * agent could have fixed is not saving spend, it is lowering the ceiling — and the two columns beside it
 * (`skip`, `skip-right`) are what make the trade visible rather than asserted.
 *
 * @param points - The grid, in evaluation order.
 * @returns A fixed-width table.
 */
export function formatGateCensus(points: readonly GatePoint[]): string {
  const header = [
    cell('margin', 7, true),
    cell('decisive', 9, true),
    cell('skip', 6, true),
    cell('skip-right', 11, true),
    cell('fixable-skip', 13, true),
    cell('consult', 8, true),
  ].join(' ');
  const rows = points.map((point) =>
    [
      cell(point.marginThreshold.toFixed(2), 7, true),
      cell(String(point.decisiveChannels), 9, true),
      cell(String(point.skipped), 6, true),
      cell(String(point.skippedRight), 11, true),
      cell(String(point.skippedFixable), 13, true),
      cell(String(point.consulted), 8, true),
    ].join(' '),
  );
  return [header, ...rows].join('\n');
}

/**
 * The threshold sweep, one row per point.
 *
 * @param points - The sweep, in grid order.
 * @param best - The point the caller intends to carry forward, marked so the reader can see which row the
 *   out-of-sample column belongs to.
 * @returns A fixed-width table.
 */
export function formatSweep(points: readonly SweepPoint[], best?: SweepPoint): string {
  const header = [
    cell('floor', 6, true),
    cell('margin', 7, true),
    cell('top1', 7, true),
    cell('moved', 6, true),
    cell('claims', 7, true),
    cell('', 4),
  ].join(' ');
  const rows = points.map((point) =>
    [
      cell(point.rateFloor.toFixed(2), 6, true),
      cell(point.margin.toFixed(2), 7, true),
      cell(pct(point.outcome.top1), 7, true),
      cell(String(point.outcome.moved), 6, true),
      cell(String(point.outcome.claims), 7, true),
      cell(point === best ? '  <-' : '', 4),
    ].join(' '),
  );
  return [header, ...rows].join('\n');
}
