/**
 * The ONE owner of the step that turns per-fault-type accuracies into a suite number.
 *
 * ## Why this module exists
 *
 * RCAEval's published table reports, per system, an `AVERAGE` column beside one column per fault type.
 * That column is the **unweighted mean of the fault-type accuracies**, and the nine published cells are
 * its values. It was implemented once, inline, in `benchmarks/src/run-rcaeval.ts` — and **re-implemented
 * three more times in the study's own instruments with a different convention**: an ablation row
 * accumulated `accuracy × cases` and divided by the case count, and so did the PRISM sweep. One quantity,
 * four owners, two answers.
 *
 * The two conventions coincide **only when every cell holds the same number of cases**, which is exactly
 * RE1 (25 per cell) and exactly not RE2/RE3. The consequence was a recorded, unexplained disagreement:
 * the study's RE3 baseline read 53.33% against the golden's 58.70%, and it was investigated as an input
 * defect — a suspected difference in attached trace spans. It is not. The per-fault-type accuracies are
 * **identical**; only the step that folds them into one number differed.
 *
 * ## The two functions, named rather than assumed
 *
 * - {@link meanOverFaultTypes} — the **published** convention, and the one every headline number uses.
 *   Domain: metric values in any unit; it is a plain mean over the supplied values.
 * - {@link caseWeightedMean} — the study's original convention, kept because it is the statistic an
 *   ablation of a *weight* is naturally read in: it answers "how many cases changed", not "how many
 *   fault types changed". It is never the headline and it is always reported beside one.
 *
 * Both are plain loops in the order their callers already accumulated in, so replacing an inline
 * implementation with a call to these is value-preserving to the last bit — which is what makes the
 * change to the published path a refactor rather than a re-measurement.
 *
 * @module benchmarks/runners/suite-accuracy
 */

/** A fold of per-fault-type accuracies. */
export interface AccuracyCell {
  /** The cell's accuracy, as a fraction in `[0, 1]`. */
  readonly accuracy: number;
  /** How many cases the cell was measured over — the case-weighted convention's weight. */
  readonly cases: number;
}

/** Both conventions at once, for the instruments that must report which one they used. */
export interface AccuracyRollup {
  /** The published convention: the unweighted mean of the per-fault-type accuracies. */
  readonly faultTypeMean: number;
  /** The study's convention: the mean over cases, so a larger cell pulls harder. */
  readonly caseWeighted: number;
  /** Total cases across the cells. */
  readonly cases: number;
  /** How many cells were folded. */
  readonly faultTypes: number;
}

/**
 * The published convention: the unweighted mean over fault types.
 *
 * This is RCAEval's `AVERAGE` column. It is unit-agnostic — the callers that fold percentages and the
 * callers that fold fractions each get their own units back — and it accumulates in input order, so it
 * reproduces the inline expression it replaces exactly.
 *
 * @param values - The per-fault-type metric values.
 * @returns The mean, or `0` for an empty population (which no caller may report as a measurement).
 */
export function meanOverFaultTypes(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * The study's convention: the mean over cases.
 *
 * Kept because it is NOT interchangeable with the above and the difference is signed: it reports a
 * weight's effect in the unit the weight acts on. It is the second number in every study report, never
 * the first.
 *
 * @param cells - The cells to weight, each carrying its own case count.
 * @returns The case-weighted mean, or `0` when no cell carries a case.
 */
export function caseWeightedMean(cells: readonly AccuracyCell[]): number {
  let weighted = 0;
  let cases = 0;
  for (const cell of cells) {
    weighted += cell.accuracy * cell.cases;
    cases += cell.cases;
  }
  return cases > 0 ? weighted / cases : 0;
}

/**
 * Fold cells into both conventions at once.
 *
 * Every instrument that reports a suite number calls this rather than choosing a convention locally,
 * because a report that names one number and means another is what this module is here to prevent: the
 * refusal is that the pair is returned together, so a caller cannot obtain the published statistic
 * without the case-weighted one appearing in the same object.
 *
 * @param cells - The cells to fold.
 * @returns Both means plus the population they were taken over.
 */
export function rollupSuiteAccuracy(cells: readonly AccuracyCell[]): AccuracyRollup {
  const cases = cells.reduce((sum, cell) => sum + cell.cases, 0);
  return {
    faultTypeMean: meanOverFaultTypes(cells.map((cell) => cell.accuracy)),
    caseWeighted: caseWeightedMean(cells),
    cases,
    faultTypes: cells.length,
  };
}
