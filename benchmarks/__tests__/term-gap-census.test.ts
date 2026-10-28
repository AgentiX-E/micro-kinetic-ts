import { describe, expect, it } from 'vitest';
import type { ScoreTerm } from '../../packages/core/src/types/faults.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import {
  accumulateTermGap,
  createTermGapCensus,
  formatTermGapLine,
  TERM_GAP_TOP,
} from '../src/term-gap-census.js';

/**
 * The term-gap census, and the two arithmetic rules it is built on.
 *
 * The instrument exists because every failure block this repository prints describes the ANOMALY that lost and
 * never the RANKING TERM that lost it — and the anomaly breakdown of a rank-2 miss and a rank-40 miss can be
 * identical. The runner already records both sides' term arrays, so the difference is an identity rather than an
 * inference; these tests pin the identity.
 */

const term = (name: string, contribution: number): ScoreTerm => ({ name, contribution });

const prediction = (over: Partial<CasePrediction> = {}): CasePrediction => ({
  caseId: 'c1',
  truth: 'ts-src',
  top1: 'ts-sink',
  correct: false,
  ...over,
});

/** A failing case whose truth and winner differ on exactly the named terms. */
const caseWith = (
  truthTerms: readonly ScoreTerm[],
  winnerTerms: readonly ScoreTerm[],
): CasePrediction =>
  prediction({
    truthEvidence: {
      rcaScore: 0.2,
      rcaThreshold: 0.1,
      finalScore: 0.5,
      depth: 0,
      viaTreeSearch: false,
      metricCount: 2,
      terms: truthTerms,
    },
    top1Terms: winnerTerms,
  });

describe('the term-gap census', () => {
  it('counts a correct case and drops it — a term that helps the truth WIN is not a cost', () => {
    // The distinction matters: a cell that loses 11 of 30 has 19 wins, and summing the wins in would make every
    // list a wash of the successes and read as "nothing much separates the sides".
    const census = createTermGapCensus();
    accumulateTermGap(
      census,
      prediction({ correct: true, truthEvidence: undefined, top1Terms: undefined }),
    );

    expect(census.correct).toBe(1);
    expect(census.compared).toBe(0);
    expect(census.unmeasured).toBe(0);
    expect(formatTermGapLine(census)).toBeUndefined();
  });

  it('subtracts per name, so a term the winner was paid and the truth was NOT is a cost of its full amount', () => {
    // The union rule. A term absent from one side is one the formula did not build for that candidate — the
    // largest gap there is — and skipping it would silently drop the case that decides the question.
    const census = createTermGapCensus();
    accumulateTermGap(
      census,
      caseWith([term('lat', 0.4)], [term('lat', 0.4), term('dualFamily', 0.25)]),
    );

    expect([...census.gaps.entries()]).toEqual([['dualFamily', { sum: 0.25, cases: 1 }]]);
  });

  it('sums a name that appears more than once on one side, as the score did', () => {
    // The ranking emits a term per contributing edge in some families, so a candidate whose score was built from
    // three edges carries three entries under one name. Recording the last value would make the census disagree
    // with the score on exactly the candidates with the most evidence.
    const census = createTermGapCensus();
    accumulateTermGap(
      census,
      // Binary-exact values, so the assertion is about the SUM RULE and not about floating-point noise.
      caseWith([term('lat', 0.5)], [term('lat', 0.5), term('lat', 0.5), term('lat', 0.25)]),
    );

    expect(census.gaps.get('lat')).toEqual({ sum: 0.75, cases: 1 });
  });

  it('reads a term the truth carries and the winner does NOT as a help, of its full amount', () => {
    // The mirror of the union rule: `winner.get(name) ?? 0` has to find nothing and say so, rather than dropping
    // the term because the winner had no entry to subtract. A `failedEdge` the winner was never charged is a term
    // that was already doing its job.
    const census = createTermGapCensus();
    accumulateTermGap(census, caseWith([term('lat', 0.4), term('failedEdge', 0.4)], [term('lat', 0.5)]));

    // Read through the map rather than as a literal: 0.5 − 0.4 is not binary-exact, and the assertion is about
    // WHICH SIDE the gap went, not about the fourth decimal of a subtraction.
    expect(census.gaps.get('lat')!.cases).toBe(1);
    expect(census.gaps.get('lat')!.sum).toBeCloseTo(0.1, 12);
    expect(census.gaps.get('failedEdge')).toEqual({ sum: -0.4, cases: 1 });
  });

  it('reports UNMEASURED rather than a zero gap when a side carries no terms at all', () => {
    // "The terms were not built" and "the terms contributed nothing" are the same number and different findings.
    const census = createTermGapCensus();
    accumulateTermGap(
      census,
      prediction({ truthEvidence: undefined, top1Terms: [term('lat', 1)] }),
    );
    accumulateTermGap(census, prediction({ truthEvidence: undefined, top1Terms: undefined }));

    expect(census.unmeasured).toBe(2);
    expect(census.compared).toBe(0);
    expect(formatTermGapLine(census)).toContain('unmeasured=2');
    expect(formatTermGapLine(census)).toContain('costs: none');
  });

  it('sums over cases and orders each list by magnitude, then by name', () => {
    const census = createTermGapCensus();
    // Two cases where `lat` costs 0.3 and 0.5, one where `prism` costs 0.9, one where `source` helps by 0.2.
    accumulateTermGap(census, caseWith([term('lat', 0.1)], [term('lat', 0.4)]));
    accumulateTermGap(census, caseWith([term('lat', 0.5)], [term('lat', 1.0)]));
    accumulateTermGap(census, caseWith([term('prism', 0)], [term('prism', 0.9)]));
    accumulateTermGap(census, caseWith([term('source', 0.7)], [term('source', 0.5)]));

    const line = formatTermGapLine(census)!;
    expect(census.compared).toBe(4);
    // `prism` 0.9 leads `lat` 0.8; `source` −0.2 is the only help.
    expect(line).toContain('costs: prism=+0.900(1) lat=+0.800(2)');
    expect(line).toContain('helps: source=-0.200(1)');
  });

  it('breaks a tie by NAME, so two runs of one corpus print the same census', () => {
    const census = createTermGapCensus();
    for (const name of ['zeta', 'alpha', 'mu']) {
      accumulateTermGap(census, caseWith([term(name, 0)], [term(name, 0.5)]));
    }

    const line = formatTermGapLine(census)!;
    expect(line.indexOf('alpha=')).toBeLessThan(line.indexOf('mu='));
    expect(line.indexOf('mu=')).toBeLessThan(line.indexOf('zeta='));
  });

  it('bounds each list, so a sixteen-term ranking cannot bury its own head', () => {
    const census = createTermGapCensus();
    for (let i = 0; i < 12; i++) {
      accumulateTermGap(
        census,
        caseWith(
          [term(`t${String(i).padStart(2, '0')}`, 0)],
          [term(`t${String(i).padStart(2, '0')}`, 0.1 * (i + 1))],
        ),
      );
    }

    const line = formatTermGapLine(census)!;
    // Twelve distinct names, each with a different gap: the five largest are t11..t07 and nothing else is printed.
    expect(line.match(/t\d\d=/g)!.length).toBe(TERM_GAP_TOP);
    expect(line).toContain('t11=');
    expect(line).not.toContain('t00=');
  });

  it('is silent for a cell with no failing case, rather than printing an empty verdict', () => {
    expect(formatTermGapLine(createTermGapCensus())).toBeUndefined();
  });
});
