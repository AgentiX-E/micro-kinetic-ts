/**
 * The four metric rows of the RCAEval table, and which number each one prints.
 *
 * The table has printed `AC@1`, `Avg@5`, `LA` and `TA` since it was written, and until this module
 * existed all four rows were rendered from the SAME field — `perFaultType[ft].accuracy`, the Top-1
 * ratio — because the row loop used the metric's `key` for its LABEL and its value was read from the
 * fault-type entry regardless. Four rows, one number, on every published cell: `Avg@5` was `AC@1`
 * reprinted, and so were `LA` and `TA`.
 *
 * That is not a cosmetic defect. The published convention this project compares itself against reports
 * `Avg@5` (`(1/5)·Σ_{k=1..5} Acc@k` — ranked [RCAEval 2023]), and the literature it is placed beside
 * reports the same number under the same name (TraceRCA 0.77, PSC-GRCA 0.915, DeCoR 0.600/0.704/0.486
 * on SS1/SS2/OB). An artifact whose `Avg@5` column is its `AC@1` column cannot be placed in that table
 * at all, and the error is invisible because the two are equal exactly when every correct case is
 * correct at rank one — which is what a reader hopes to see.
 *
 * The mapping lives here, and only here, so that a row and its field cannot drift apart again: the
 * printer renders `cells` and `average` as given, and `metricValue` is the single place a key becomes a
 * field.
 *
 * @module benchmarks/rcaeval-metric-rows
 */

/** The four rows, in the order the table prints them. */
export type RCAEvalMetricKey = 'ac1' | 'avg5' | 'la' | 'ta';

/** What one fault type's row cell needs, structurally (no import of the runner's type). */
export interface FaultTypeCounts {
  readonly cases: number;
  /** Top-1 ratio. */
  readonly accuracy: number;
  /** RCAEval's `Avg@5` — `(1/5)·Σ_{k=1..5} Acc@k`, NOT the hit-at-5 share. */
  readonly avg5: number;
  /** Top-1 fault-type accuracy. */
  readonly typeAccuracy: number;
}

/** One rendered row: a label, the key it came from, its cells, and the published average. */
export interface RCAEvalMetricRow {
  readonly key: RCAEvalMetricKey;
  readonly label: string;
  /** One value per fault type, in the order given; `null` where the fault type has no cases. */
  readonly cells: ReadonlyArray<number | null>;
  /** Mean over the cells that exist — the published convention, not the mean over cases. */
  readonly average: number;
}

/** The label each key prints under. */
const LABELS: Readonly<Record<RCAEvalMetricKey, string>> = {
  ac1: 'AC@1  ',
  avg5: 'Avg@5 ',
  la: 'LA    ',
  ta: 'TA    ',
};

/**
 * The value a metric row prints for one fault type.
 *
 * `la` is Top-1 service accuracy **by definition** — RCAEval's Location Accuracy is "did the top-1
 * prediction name the right service" — so `LA` and `AC@1` are equal in every cell and that equality is
 * a property of the metric rather than a second copy of the same bug. The two rows are kept because a
 * reader of Table 6 expects both.
 *
 * @param counts - The fault type's counts.
 * @param key - Which row.
 */
export function metricValue(counts: FaultTypeCounts, key: RCAEvalMetricKey): number {
  switch (key) {
    case 'ac1':
      return counts.accuracy;
    case 'avg5':
      return counts.avg5;
    case 'la':
      return counts.accuracy;
    case 'ta':
      return counts.typeAccuracy;
  }
}

/**
 * Build the four rows for a table over `faultTypes`.
 *
 * @param faultTypes - The columns, in print order.
 * @param lookup - The fault type's counts, or `undefined` when the cell has none.
 * @returns The four rows, in print order.
 */
export function buildMetricRows(
  faultTypes: readonly string[],
  lookup: (faultType: string) => FaultTypeCounts | undefined,
): readonly RCAEvalMetricRow[] {
  const keys: readonly RCAEvalMetricKey[] = ['ac1', 'avg5', 'la', 'ta'];
  return keys.map((key) => {
    const cells = faultTypes.map((ft) => {
      const counts = lookup(ft);
      return counts === undefined ? null : metricValue(counts, key);
    });
    const present = cells.filter((v): v is number => v !== null);
    const average = present.length === 0 ? 0 : present.reduce((s, v) => s + v, 0) / present.length;
    return { key, label: LABELS[key], cells, average };
  });
}
