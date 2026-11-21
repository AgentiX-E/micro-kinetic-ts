/**
 * Whether a cell was MEASURED, and the two populations that decide it.
 *
 * A cell reports a rate over the cases that reached the scorer. The runner's guard asked a different
 * question — `stats.considered === 0`, where `considered` counts the cases the loader was ASKED for — and
 * the difference between the two is exactly the run that could not read its corpus: on run 43901259774 all
 * thirty RE3 cases failed to load on an embedding-quota error, `considered` was thirty, and the cell printed
 *
 *     ║ Micro-Kinetic       | AC@1   |   0.0% ║
 *
 * with an empty denominator, exited 0, and left a workflow green behind a reading no case supports.
 *
 * The distinction this module draws is the one the repository already draws everywhere else — `dual-family`
 * reports UNMEASURED rather than an empty family, the loss census prints "no cases found: nothing to census,
 * and saying so beats printing a zero", `fse26-formulation` treats an unmeasured member as `undefined`
 * rather than 0. A RATE is the one number that had not been held to it.
 *
 * @module benchmarks/cell-population
 */

/** The two populations of one cell, and the load errors that separate them. */
export interface CellPopulation {
  /** Cases the dispatch's slice contains — the loader's `considered`. */
  readonly requested: number;
  /** Cases that reached the scorer — the sum of the cell's `RunResult.totalCases`. */
  readonly evaluated: number;
  /**
   * Load errors of this cell, as `message -> count`.
   *
   * Read for the REASON an emptied cell is empty, and only that: the counts are the loader's own, so the
   * block and the `Load Errors` diagnostic cannot disagree about how many cases were lost.
   */
  readonly loadErrors?: ReadonlyMap<string, number> | undefined;
}

/** A measured cell, with both counts so the rate can be read against its population. */
export interface MeasuredCell {
  readonly kind: 'measured';
  readonly requested: number;
  readonly evaluated: number;
}

/** A cell that produced no rate, with the reason it produced none. */
export interface UnmeasuredCell {
  readonly kind: 'unmeasured';
  readonly requested: number;
  readonly evaluated: number;
  readonly reason: string;
}

/** The verdict on one cell. */
export type CellMeasurement = MeasuredCell | UnmeasuredCell;

/** The dominant load error of a cell, as `[message, count]`, or `undefined` when it lost nothing. */
function dominantError(
  loadErrors: ReadonlyMap<string, number> | undefined,
): readonly [string, number] | undefined {
  if (loadErrors === undefined) return undefined;
  let best: readonly [string, number] | undefined;
  for (const [message, count] of loadErrors) {
    if (best === undefined || count > best[1]) best = [message, count];
  }
  return best;
}

/**
 * Decide whether a cell's rate is a measurement.
 *
 * Four states, and each gets its own sentence because they call for different responses:
 *
 * | requested | evaluated | verdict | what a reader should do |
 * |---|---|---|---|
 * | 0 | 0 | unmeasured — nothing selected | change the dispatch |
 * | > 0 | 0, with load errors | unmeasured — corpus/provider failure | restore the provider |
 * | > 0 | 0, no load errors | unmeasured — silent drop | this is a bug in the loader |
 * | > 0 | ≥ 1 | measured | read the rate against `evaluated` |
 *
 * @param population - The cell's two counts and its load errors.
 * @throws When `evaluated > requested`: a denominator below its own numerator is not a population.
 */
export function classifyCell(population: CellPopulation): CellMeasurement {
  const { requested, evaluated, loadErrors } = population;
  if (evaluated > requested) {
    throw new Error(
      `evaluated (${evaluated}) exceeds requested (${requested}): a cell cannot score more cases than it ` +
        'selected, and a coverage line over this pair would print a rate above 100 %',
    );
  }

  if (evaluated > 0) {
    return { kind: 'measured', requested, evaluated };
  }

  if (requested === 0) {
    return {
      kind: 'unmeasured',
      requested,
      evaluated,
      reason: 'no case was selected — the dispatch filters matched nothing in this cell',
    };
  }

  const dominant = dominantError(loadErrors);
  if (dominant === undefined) {
    return {
      kind: 'unmeasured',
      requested,
      evaluated,
      reason:
        `${requested} cases were selected and none reached the scorer, and the loader reported no error — ` +
        'cases were dropped without one, which is a defect in the loader rather than in the corpus',
    };
  }

  return {
    kind: 'unmeasured',
    requested,
    evaluated,
    reason:
      `0 of ${requested} cases reached the scorer; the dominant load error (${dominant[1]}×) was: ` +
      dominant[0],
  };
}

/**
 * The coverage line a measured cell prints when it lost cases, or `undefined` when it lost none.
 *
 * Printed BESIDE the table rather than in the load-error block, because the rate and its denominator have
 * to be readable together: a cell at 28 of 30 and a cell at 30 of 30 print the same format, and only this
 * line tells them apart.
 */
export function formatCellCoverageLine(measurement: CellMeasurement): string | undefined {
  if (measurement.kind !== 'measured') return undefined;
  if (measurement.evaluated === measurement.requested) return undefined;
  const share = (measurement.evaluated / measurement.requested) * 100;
  return (
    `  coverage: ${measurement.evaluated}/${measurement.requested} cases reached the scorer ` +
    `(${share.toFixed(1)}%) — the rate below is over the ${measurement.evaluated}`
  );
}

/**
 * Render an unmeasured cell as a block that states the counts and the reason and prints NO rate.
 *
 * The absence of a percentage is the contract, and the unit test asserts it: the artifact that misled run
 * 43901259774 was a percentage, in the published table format, over no cases.
 *
 * @param systemName - The cell's system.
 * @param suiteName - The cell's suite.
 * @param measurement - The verdict; must be `unmeasured`.
 * @throws When handed a measured cell, because the caller has mis-ordered its branches.
 */
export function formatUnmeasuredBlock(
  systemName: string,
  suiteName: string,
  measurement: CellMeasurement,
): string {
  if (measurement.kind !== 'unmeasured') {
    throw new Error(
      `${systemName}/${suiteName} was measured (${measurement.evaluated} cases) and cannot be rendered as ` +
        'an unmeasured block',
    );
  }
  return [
    '',
    `${'─'.repeat(80)}`,
    `  UNMEASURED: ${systemName}/${suiteName}`,
    `  requested ${measurement.requested} | evaluated ${measurement.evaluated}`,
    `  reason: ${measurement.reason}`,
    '  no rate is printed: this cell supplied no cases for one to be computed over',
    `${'─'.repeat(80)}`,
  ].join('\n');
}
