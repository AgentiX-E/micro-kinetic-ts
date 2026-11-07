/**
 * The RCAEval table's four metric rows must print four different quantities.
 *
 * The defect this file exists for: the row loop used each metric's `key` for its LABEL and read every
 * value from `perFaultType[ft].accuracy`, so `AC@1`, `Avg@5`, `LA` and `TA` were one column printed
 * four times on every published cell. Nothing failed, because a case set where every correct case is
 * correct at rank one makes the four numbers equal — and that is precisely the shape a reader expects
 * to see, so the defect was invisible.
 *
 * @module benchmarks/__tests__/rcaeval-metric-rows.test
 */

import { describe, expect, it } from 'vitest';

import { buildMetricRows, metricValue, type FaultTypeCounts } from '../src/rcaeval-metric-rows.js';

/**
 * Counts for a fault type of four cases: two at rank 1, one at rank 3, one at rank 7.
 *
 * `Avg@5` = (1 + 1 + 3/5 + 0) / 4 = 0.65 — the rank-3 case contributes `3/5`, which is why the number is
 * neither the Top-1 share (0.5) nor the hit-at-5 share (0.75).
 */
const MIXED: FaultTypeCounts = {
  cases: 4,
  accuracy: 0.5,
  avg5: 0.65,
  typeAccuracy: 0.25,
};

describe('rcaeval metric rows', () => {
  it("prints RCAEval's Avg@5 — the mean of Acc@1..Acc@5 — not the Top-1 share and not hit-at-5", () => {
    // Three candidate readings, and only one is the published metric. A case at rank 3 contributes
    // 3/5: AC@1 counts it 0, a hit-at-5 count counts it 1, and `Avg@5` counts it 0.6. The defect this
    // file exists for printed 0.5 (AC@1) under the label; a hit-at-5 implementation would print 0.75,
    // which is closer and still not the number any paper reports.
    const rows = buildMetricRows(['cpu'], () => MIXED);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.avg5!.cells).toEqual([0.65]);
    expect(byKey.ac1!.cells).toEqual([0.5]);
    expect(byKey.avg5!.average).toBeGreaterThan(byKey.ac1!.average);
  });

  it('prints the fault-type share on TA', () => {
    const rows = buildMetricRows(['cpu'], () => MIXED);
    expect(rows.find((r) => r.key === 'ta')!.cells).toEqual([0.25]);
  });

  it('reads LA from Top-1 because the metric IS Top-1, and says so instead of hiding it', () => {
    // `LA` and `AC@1` being equal is a property of RCAEval's Location Accuracy, not a second copy of
    // the bug: it asks whether the top-1 prediction named the right service. The row is kept because
    // readers of Table 6 look for it, and the equality is asserted here so a future change that makes
    // them differ has to argue with this test rather than pass silently.
    const rows = buildMetricRows(['cpu'], () => MIXED);
    const la = rows.find((r) => r.key === 'la')!;
    const ac1 = rows.find((r) => r.key === 'ac1')!;
    expect(la.cells).toEqual(ac1.cells);
    expect(metricValue(MIXED, 'la')).toBe(MIXED.accuracy);
  });

  it('prints a null cell for a fault type the run has no cases of, and averages only what exists', () => {
    // The published convention averages over the CELLS the table printed, not over the cases, so an
    // absent fault type must not enter the mean as a zero — RE2 and RE3 hold unequal case counts per
    // type and a zero would read as a catastrophic cell rather than an absent one.
    const rows = buildMetricRows(['cpu', 'ghost'], (ft) => (ft === 'cpu' ? MIXED : undefined));
    const ac1 = rows.find((r) => r.key === 'ac1')!;
    expect(ac1.cells).toEqual([0.5, null]);
    expect(ac1.average).toBe(0.5);
  });

  it('returns every row even when no cell exists, so the table keeps its shape', () => {
    const rows = buildMetricRows(['ghost'], () => undefined);
    expect(rows.map((r) => r.key)).toEqual(['ac1', 'avg5', 'la', 'ta']);
    expect(rows.every((r) => r.average === 0)).toBe(true);
  });
});
