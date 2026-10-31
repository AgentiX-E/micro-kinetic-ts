/**
 * `RETRIEVAL` is one loss class and three different facts, and this is the fence that keeps them apart.
 *
 * `truthRank === undefined` records the same thing whether the graph never held the service, the service never
 * deviated, or the topological deduction deleted it. The three have different owners — graph construction, the
 * signal layer, and the operator — and until iteration 166 the census could not tell them apart, which is how
 * twelve published misses came to be described as "unreachable" when the truth had in fact moved
 * (`docs/topo-discount-scope.md` §7.4).
 *
 * The classifier reads ONE measured number against ONE threshold, and the threshold is zero: a truth that moved
 * and is absent was explained away, a truth that did not move was silent. `unmeasured` exists for the artifact
 * that predates the column, on the rule this module applies to every absence — a missing measurement is never
 * reported as a measured zero.
 */

import { describe, expect, it } from 'vitest';
import { classifyTruthAbsence, type TruthAbsence } from '../src/loss-census.js';

/** The census row's fields this classifier reads, in the shape a caller would hand it. */
function row(overrides: {
  truthInGraph?: boolean;
  errored?: boolean;
  truthRank?: number;
  truthAnomalyBefore?: number;
}): {
  truthInGraph: boolean;
  errored?: boolean;
  truthRank?: number;
  truthAnomalyBefore?: number;
} {
  return { truthInGraph: true, ...overrides };
}

describe('classifyTruthAbsence: three absences, three owners', () => {
  it('reports a ranked truth as ranked, whatever its anomaly was', () => {
    expect(classifyTruthAbsence(row({ truthRank: 1, truthAnomalyBefore: 3 }))).toBe<TruthAbsence>(
      'ranked',
    );
    expect(classifyTruthAbsence(row({ truthRank: 12 }))).toBe<TruthAbsence>('ranked');
  });

  it('reports a truth that moved and is absent as explained away', () => {
    // The shape the deduction produces at `gate = 1`, `rho = 1`: the caller is charged its whole anomaly.
    expect(classifyTruthAbsence(row({ truthAnomalyBefore: 2.026 }))).toBe<TruthAbsence>(
      'explained',
    );
  });

  it('reports a truth that never moved as silent, and does not call it explained', () => {
    expect(classifyTruthAbsence(row({ truthAnomalyBefore: 0 }))).toBe<TruthAbsence>('silent');
  });

  it('reports a truth outside the graph as not-in-graph, before asking about its anomaly', () => {
    expect(
      classifyTruthAbsence(row({ truthInGraph: false, truthAnomalyBefore: 9 })),
    ).toBe<TruthAbsence>('not-in-graph');
    expect(classifyTruthAbsence(row({ truthInGraph: false }))).toBe<TruthAbsence>('not-in-graph');
  });

  it('reports a case whose analysis threw as errored, whatever else it carries', () => {
    expect(classifyTruthAbsence(row({ errored: true, truthInGraph: false }))).toBe<TruthAbsence>(
      'errored',
    );
    expect(classifyTruthAbsence(row({ errored: true, truthAnomalyBefore: 4 }))).toBe<TruthAbsence>(
      'errored',
    );
  });

  it('reports an artifact that predates the column as unmeasured rather than either answer', () => {
    // The one branch that must never be folded into `silent`: a census written before iteration 166 has no
    // `truthAnomalyBefore`, and reporting that as "nothing moved at the origin" would invent a measurement.
    expect(classifyTruthAbsence(row({}))).toBe<TruthAbsence>('unmeasured');
  });

  it('keeps the five answers distinct, so a count over them sums to the misses it partitions', () => {
    const answers = new Set<TruthAbsence>([
      classifyTruthAbsence(row({ truthRank: 2 })),
      classifyTruthAbsence(row({ truthAnomalyBefore: 1 })),
      classifyTruthAbsence(row({ truthAnomalyBefore: 0 })),
      classifyTruthAbsence(row({ truthInGraph: false })),
      classifyTruthAbsence(row({ errored: true })),
    ]);
    expect(answers.size).toBe(5);
  });
});
