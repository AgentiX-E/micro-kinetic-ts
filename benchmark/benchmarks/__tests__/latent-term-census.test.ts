/**
 * Unit tests for the latent-term census: the weight window each term would need, from one run.
 *
 * The claims this file pins are arithmetic, so they are asserted as numbers on constructed candidates rather than
 * through the rendered line wherever a number is the claim — the rule the failed-edge census records. Four of them
 * are the ones a plausible implementation gets wrong:
 *
 * 1. `required` is the weight at which the truth is placed ABOVE the winner, so it is `gap / advantage` and not
 *    `gap` — a term whose slope advantage is a tenth of the gap needs ten times the weight.
 * 2. A term that reads the truth LOWER than the winner has no required weight at all; recording one would let a
 *    term with the wrong sign appear in the head of the list.
 * 3. The cap comes from the runner-up and not from the winner: on a correct case the truth IS the top candidate,
 *    and a cap derived from its own score is infinite by construction.
 * 4. A case with no `top2Terms` makes the cell UNGUARDED rather than infinitely safe, and the line says so.
 *
 * @module benchmarks/__tests__/latent-term-census
 */

import { describe, expect, it } from 'vitest';

import type { ScoreTerm } from '../../packages/core/src/types/faults.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import {
  accumulateLatentTermCensus,
  createLatentTermCensus,
  formatLatentTermLine,
  type LatentTermCensus,
} from '../src/latent-term-census.js';

/** One candidate's breakdown, as the ranking emits it: a name with a weight, a slope and their product. */
function term(name: string, weight: number, slope: number): ScoreTerm {
  return { name, contribution: weight * slope, weight, slope };
}

/** One case, with everything the census reads and nothing it does not. */
function prediction(spec: {
  correct: boolean;
  truthTerms?: readonly ScoreTerm[];
  top1Terms?: readonly ScoreTerm[];
  rankedTerms?: readonly (readonly ScoreTerm[])[];
  truthRank?: number;
}): CasePrediction {
  return {
    caseId: 'case',
    truth: 'svc-truth',
    top1: spec.correct ? 'svc-truth' : 'svc-winner',
    correct: spec.correct,
    ...(spec.truthTerms === undefined ? {} : { truthEvidence: { terms: spec.truthTerms } }),
    ...(spec.top1Terms === undefined ? {} : { top1Terms: spec.top1Terms }),
    ...(spec.rankedTerms === undefined ? {} : { rankedTerms: spec.rankedTerms }),
    ...(spec.truthRank === undefined ? {} : { truthRank: spec.truthRank }),
  } as unknown as CasePrediction;
}

/** Fold a list of cases. */
function censusOf(predictions: readonly CasePrediction[]): LatentTermCensus {
  const census = createLatentTermCensus();
  for (const p of predictions) accumulateLatentTermCensus(census, p);
  return census;
}

describe('latent-term census — the required weight on a miss', () => {
  it('divides the gap by the slope advantage, because the score is affine in the weight', () => {
    // The winner leads by 1.4 − 1.0 = 0.40 in what was actually recorded. `knob` reads the truth 0.6 and the
    // winner 0.4 per unit of weight, so 0.40 / 0.20 = 2.0 units are needed — and at exactly 2.0 the two scores are
    // equal, which is why a flip is counted strictly below the requirement.
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.6)],
        top1Terms: [term('self', 1, 1.4), term('knob', 0, 0.4)],
      }),
    ]);
    expect(census.misses).toBe(1);
    expect(census.terms.get('knob')).toEqual({
      weight: 0,
      cap: Number.POSITIVE_INFINITY,
      required: [2],
    });
    expect(formatLatentTermLine(census)).toBe(
      '[latent] misses=1 guarded=0 | win: knob=1(inf,2.000)',
    );
  });

  it('records no requirement when the term reads the truth LOWER than the winner', () => {
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.1)],
        top1Terms: [term('self', 1, 1.4), term('knob', 0, 0.9)],
      }),
    ]);
    // `knob` is absent rather than present with an empty window: a term with the wrong sign is not a term with a
    // narrow window, and the list must not print the two the same way.
    expect(census.terms.has('knob')).toBe(false);
    expect(formatLatentTermLine(census)).toContain('win: none');
  });

  it('reports a case whose sides carry no terms as unmeasured rather than as a zero gap', () => {
    const census = censusOf([
      prediction({ correct: false, truthTerms: undefined, top1Terms: [term('self', 1, 1)] }),
    ]);
    expect(census.misses).toBe(0);
    expect(census.unmeasured).toBe(1);
    expect(formatLatentTermLine(census)).toBe(
      '[latent] misses=0 guarded=0 unmeasured=1 | win: none',
    );
  });

  it('reports a miss whose recorded score already leads as tied, so no term is credited with it', () => {
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.4), term('knob', 0, 0.9)],
        top1Terms: [term('self', 1, 1.0), term('knob', 0, 0.1)],
      }),
    ]);
    expect(census.tied).toBe(1);
    expect(formatLatentTermLine(census)).toContain('tied=1');
  });

  it('anchors the requirement to the weight the run carried, not to zero', () => {
    // The same 0.40 gap and 0.20 advantage, but the term is LIVE at 0.5: it needs 0.5 + 2.0 = 2.5, and a census
    // that assumed a dormant term would report 2.0 for a run already halfway there.
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('knob', 0.5, 0.6)],
        top1Terms: [term('self', 1, 1.5), term('knob', 0.5, 0.4)],
      }),
    ]);
    expect(census.terms.get('knob')?.required).toEqual([2.5]);
  });

  it('sums one name emitted several times, so a term is read as the score built from it', () => {
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('edge', 0, 0.2), term('edge', 0, 0.2)],
        top1Terms: [term('self', 1, 1.4), term('edge', 0, 0.1)],
      }),
    ]);
    // contribution for the truth is 0 either way (the weight is 0); the SLOPES are what move it: 0.4 − 0.1 = 0.3,
    // so the requirement is 0.4 / 0.3 rather than 0.4 / 0.1.
    expect(census.terms.get('edge')?.required[0]).toBeCloseTo(0.4 / 0.3, 12);
  });
});

describe('latent-term census — the rivals above the truth on a miss', () => {
  it('requires enough weight to pass EVERY candidate that outranks the truth, not just the winner', () => {
    // The truth is third. Passing the recorded winner needs 0.6; passing the candidate between them needs 0.5. The
    // requirement is the maximum, because a weight that clears one rival and not the other leaves the case lost —
    // and the recorded winner is not necessarily the harder of the two, which is why the bound is taken over all.
    const census = censusOf([
      prediction({
        correct: false,
        truthRank: 3,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
        top1Terms: [term('self', 1, 1.2), term('knob', 0, 0.0)],
        rankedTerms: [
          [term('self', 1, 1.2), term('knob', 0, 0.0)],
          [term('self', 1, 1.4), term('knob', 0, 0.2)],
          [term('self', 1, 1.0), term('knob', 0, 0.5)],
        ],
      }),
    ]);
    // Passing the recorded winner needs 0.2 / 0.5 = 0.4; passing the louder candidate needs 0.4 / 0.3 = 1.333,
    // and a weight of 0.4 would leave the truth third. A census that read only `top1Terms` would report 0.4.
    expect(census.terms.get('knob')?.required[0]).toBeCloseTo(4 / 3, 12);
  });

  it('reads a rival that does not carry the term as a zero slope, not as an absence of the term', () => {
    // A rival with no entry cannot be moved by the term, which is what a slope of zero says — and treating it as
    // "no information" would drop the case from the census on a term that demonstrably wins it back.
    const census = censusOf([
      prediction({
        correct: false,
        truthRank: 2,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.4)],
        top1Terms: [term('self', 1, 1.2)],
        rankedTerms: [[term('self', 1, 1.2)], [term('self', 1, 1.0), term('knob', 0, 0.4)]],
      }),
    ]);
    expect(census.terms.get('knob')?.required[0]).toBeCloseTo(0.5, 12);
  });

  it('drops the term when one rival cannot be passed at ANY weight', () => {
    // A rival whose slope is at least the truth's is not expensive, it is unreachable: no weight moves the truth
    // past it. Recording a large requirement instead would put the term in the list with a number that means
    // "never" and read as "far".
    const census = censusOf([
      prediction({
        correct: false,
        truthRank: 3,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
        top1Terms: [term('self', 1, 1.3), term('knob', 0, 0.0)],
        rankedTerms: [
          [term('self', 1, 1.3), term('knob', 0, 0.0)],
          [term('self', 1, 1.2), term('knob', 0, 0.5)],
          [term('self', 1, 1.0), term('knob', 0, 0.5)],
        ],
      }),
    ]);
    expect(census.terms.has('knob')).toBe(false);
  });

  it('anchors on a rival when the truth carries no entry for the term at all', () => {
    // The weight is a property of the TERM rather than of the candidate, so a rival's entry can anchor it — and the
    // truth's missing slope is a 0 for the arithmetic, which is exactly "this term does not move the truth".
    const census = censusOf([
      prediction({
        correct: false,
        truthRank: 2,
        truthTerms: [term('self', 1, 1.0)],
        top1Terms: [term('self', 1, 1.4), term('knob', 0, 0.0)],
        rankedTerms: [[term('self', 1, 1.4), term('knob', 0, 0.0)], [term('self', 1, 1.0)]],
      }),
    ]);
    // The truth's slope is absent (0) and the winner's is 0, so the advantage is 0 and the term cannot help.
    expect(census.terms.has('knob')).toBe(false);
  });
});

describe('latent-term census — the cap on a correct case', () => {
  it('comes from the runner-up, and the cell keeps the smallest of them', () => {
    // c1: margin 0.3 with a 0.2 advantage → 1.5. c2: margin 0.8 with a 0.4 advantage → 2.0. The cell's cap is the
    // first of those, because one broken case is what a cap forbids.
    const census = censusOf([
      prediction({
        correct: true,
        top1Terms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
        rankedTerms: [
          [term('self', 1, 1.0), term('knob', 0, 0.5)],
          [term('self', 1, 0.7), term('knob', 0, 0.7)],
        ],
      }),
      prediction({
        correct: true,
        top1Terms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
        rankedTerms: [
          [term('self', 1, 1.0), term('knob', 0, 0.5)],
          [term('self', 1, 0.2), term('knob', 0, 0.9)],
        ],
      }),
    ]);
    expect(census.guarded).toBe(2);
    // Floating point: 0.3 − 0.2 in the two subtractions that produced it, so the cap is asserted to twelve places
    // rather than to the last bit.
    expect(census.terms.get('knob')?.cap).toBeCloseTo(1.5, 12);
    expect(census.terms.get('knob')?.required).toEqual([]);
  });

  it('is infinite when the runner-up cannot gain on the truth at any weight', () => {
    const census = censusOf([
      prediction({
        correct: true,
        top1Terms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
        rankedTerms: [
          [term('self', 1, 1.0), term('knob', 0, 0.5)],
          [term('self', 1, 0.1), term('knob', 0, 0.1)],
        ],
      }),
    ]);
    // No entry rather than an infinite one: a term that cannot gain on the truth at any weight has no cap to
    // record, and a stored `Infinity` would be a claim that it was measured and found safe.
    expect(census.terms.has('knob')).toBe(false);
  });

  it('counts a miss as reachable only STRICTLY below the cap', () => {
    // The cell's cap is 1.0 (margin 0.5 over a 0.5 advantage). A miss needing exactly 1.0 arrives at a tie, and a
    // tie is not a win, so nothing is counted; the same miss needing 0.8 is counted.
    const guarded = prediction({
      correct: true,
      top1Terms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
      rankedTerms: [
        [term('self', 1, 1.0), term('knob', 0, 0.5)],
        [term('self', 1, 0.5), term('knob', 0, 1.0)],
      ],
    });
    const atCap = censusOf([
      guarded,
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
        top1Terms: [term('self', 1, 1.5), term('knob', 0, 0)],
      }),
    ]);
    expect(formatLatentTermLine(atCap)).toContain('knob(cap=1.000,need=1.000)');
    const underCap = censusOf([
      guarded,
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
        top1Terms: [term('self', 1, 1.4), term('knob', 0, 0)],
      }),
    ]);
    expect(formatLatentTermLine(underCap)).toContain('knob=1(1.000,0.800)');
  });

  it('anchors a term the TRUTH does not carry on the candidate that does', () => {
    // The weight belongs to the term, not to the candidate: a rival that carries an entry can set the cap for a
    // truth that has none, and the truth's missing slope is a 0 — "this term does not move the truth here".
    const census = censusOf([
      prediction({
        correct: true,
        top1Terms: [term('self', 1, 1.0)],
        rankedTerms: [[term('self', 1, 1.0)], [term('self', 1, 0.5), term('knob', 0, 1.0)]],
      }),
    ]);
    // Rival total 0.5 against the truth's 1.0: margin 0.5 over an advantage of 1.0 → cap 0.5.
    expect(census.terms.get('knob')?.cap).toBeCloseTo(0.5, 12);
  });

  it('takes the cap from a THIRD candidate when it breaks first, not from the runner-up', () => {
    // The defect this was built to catch, measured on RE3-SockShop: a screen that bounded the cap against the
    // runner-up predicted two recoverable cases at `prismWeight = 0.30` and the arm recovered one, because the case
    // it lost was broken by a candidate two places down. Here the runner-up sets a cap of 4.0 and the third
    // candidate one of 1.0; a census that read only `rankedTerms[1]` would call 2.0 safe and lose the case.
    const census = censusOf([
      prediction({
        correct: true,
        top1Terms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
        rankedTerms: [
          [term('self', 1, 1.0), term('knob', 0, 0.5)],
          [term('self', 1, -1.0), term('knob', 0, 0.0)],
          [term('self', 1, 0.5), term('knob', 0, 1.0)],
        ],
      }),
    ]);
    // Runner-up: margin 2.0 over an advantage of 0.0 … it cannot gain at all, so it sets no cap. Third: margin 0.5
    // over an advantage of 0.5 → cap 1.0.
    expect(census.terms.get('knob')?.cap).toBeCloseTo(1.0, 12);
  });

  it('renders the counters of a cell that has both a cap-only term and an unguarded case', () => {
    // This is the one shape the line can be read on and the entries cannot: a term that sets a CAP on a correct
    // case and never appears on a miss has nothing to win back, so it is filtered out of the list — while the
    // cell's own counters still have to render. Asserted through the line rather than through the census object,
    // because a counter that is correct on the object and absent from the line is a counter no reader sees.
    const line = formatLatentTermLine(
      censusOf([
        prediction({
          correct: true,
          top1Terms: [term('self', 1, 1.0), term('knob', 0, 0.5)],
          rankedTerms: [
            [term('self', 1, 1.0), term('knob', 0, 0.5)],
            [term('self', 1, 0.5), term('knob', 0, 1.0)],
          ],
        }),
        prediction({ correct: true, top1Terms: [term('self', 1, 1.0)] }),
        prediction({
          correct: false,
          truthTerms: [term('self', 1, 1.0), term('other', 0, 0.5)],
          top1Terms: [term('self', 1, 1.4), term('other', 0, 0)],
        }),
      ]),
    )!;
    expect(line).toContain('misses=1 guarded=1 unguarded=1');
    expect(line).toContain('other=1(');
    // `knob` has a cap of 0.5 and no reachable miss, so it is not printed: a term with nothing to win is not a
    // term with a narrow window.
    expect(line).not.toContain('knob=');
  });

  it('reports a correct case with no runner-up as unguarded rather than as an infinite cap', () => {
    const census = censusOf([prediction({ correct: true, top1Terms: [term('self', 1, 1.0)] })]);
    expect(census.guarded).toBe(0);
    expect(census.unguarded).toBe(1);
    expect(formatLatentTermLine(census)).toBeUndefined();
  });
});

describe('latent-term census — the line', () => {
  it('says nothing about a cell that lost nothing and measured nothing', () => {
    expect(formatLatentTermLine(createLatentTermCensus())).toBeUndefined();
    expect(
      formatLatentTermLine(
        censusOf([prediction({ correct: true, top1Terms: [term('self', 1, 1)] })]),
      ),
    ).toBeUndefined();
  });

  it('ranks by net gain, then by the smallest requirement, and stops at five terms', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const census = censusOf(
      names.map((name, i) =>
        prediction({
          correct: false,
          // A slope that GROWS with the index means a requirement that shrinks, so the last name needs the least
          // and must lead a list whose gains all tie at one.
          truthTerms: [term('self', 1, 1.0), term(name, 0, 0.5 + i * 0.1)],
          top1Terms: [term('self', 1, 1.5), term(name, 0, 0)],
        }),
      ),
    );
    const line = formatLatentTermLine(census)!;
    const shown = line.slice(line.indexOf('win: ') + 5).split(' ');
    expect(shown).toHaveLength(5);
    expect(shown[0]!.startsWith('f=1(')).toBe(true);
    expect(shown[4]!.startsWith('b=1(')).toBe(true);
  });

  it('breaks a tie in flips and requirement by NAME, so the line is reproducible', () => {
    // Two terms with the same reachable count and the same requirement: without the name arm the order would
    // depend on Map insertion, and the same corpus would print two different lines on two runs.
    // Three names, so the comparator runs in both directions over the tied pair rather than once.
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [
          term('self', 1, 1.0),
          term('zulu', 0, 0.5),
          term('mike', 0, 0.5),
          term('alpha', 0, 0.5),
        ],
        top1Terms: [
          term('self', 1, 1.5),
          term('zulu', 0, 0),
          term('mike', 0, 0),
          term('alpha', 0, 0),
        ],
      }),
    ]);
    const line = formatLatentTermLine(census)!;
    expect(line.indexOf('alpha=')).toBeLessThan(line.indexOf('mike='));
    expect(line.indexOf('mike=')).toBeLessThan(line.indexOf('zulu='));
  });

  it('orders six equally reachable terms by name alone', () => {
    // Every term is reachable at the same weight, so the whole order is the name arm. Six names arriving in an
    // arbitrary order force the comparator to answer in both directions.
    const names = ['d', 'b', 'f', 'a', 'e', 'c'];
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), ...names.map((name) => term(name, 0, 0.5))],
        top1Terms: [term('self', 1, 1.5), ...names.map((name) => term(name, 0, 0))],
      }),
    ]);
    const line = formatLatentTermLine(census)!;
    const shown = line
      .slice(line.indexOf('win: ') + 5)
      .split(' ')
      .map((entry) => entry.slice(0, 1));
    expect(shown).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('prints a LIVE term at the weight it carried, so its window is read in its own units', () => {
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('live', 0.25, 0.8)],
        top1Terms: [term('self', 1, 1.6), term('live', 0.25, 0.4)],
      }),
    ]);
    // gap = (1.6 + 0.10) − (1.0 + 0.20) = 0.50; advantage = 0.80 − 0.40 = 0.40 → 0.25 + 1.25 = 1.50.
    expect(formatLatentTermLine(census)).toContain('live=1(inf,1.500)');
  });

  it('reports a miss the live terms already tie as tied, not as reachable at the current weight', () => {
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('live', 0.25, 0.8)],
        top1Terms: [term('self', 1, 1.2), term('live', 0.25, 0.0)],
      }),
    ]);
    // The truth is at 1.20 and so is the winner: a tie broken by name, reachable at the weight already carried.
    expect(census.tied).toBe(1);
  });
});

/**
 * The closed segment: the terms a cell has NO room for.
 *
 * Written after an arm that lost a case on a cell whose reading was never printed. `temporalWeight = 0.02` gained
 * two cases on RE1 and lost one on RE3-TrainTicket, where the prior reads the truth higher than the winner on zero
 * of eight misses. A term with no reachable miss had no requirement to print, and the formatter's filter dropped it
 * before the head was taken — so the one number that said "do not dispatch here" (`cap < 0.02`) was the one the
 * line could not carry. These tests pin that a term with a price and no evidence is printed, that the segment leads
 * with the smallest price, and that the truncation is counted.
 */
describe('latent-term census — the closed segment', () => {
  it('prints a term that can never win a miss as a CLOSED bound, with its cap and no requirement', () => {
    const census = censusOf([
      // A correct case where `knob` can lift the runner-up: the truth leads by 0.50 and the rival gains 0.10 per
      // unit of weight, so the cell loses this case at 5.0 — a finite cap, which is the price of the term here.
      prediction({
        correct: true,
        truthTerms: [term('self', 1, 1.5), term('knob', 0, 0.5)],
        top1Terms: [term('self', 1, 1.5), term('knob', 0, 0.5)],
        rankedTerms: [
          [term('self', 1, 1.5), term('knob', 0, 0.5)],
          [term('self', 1, 1.0), term('knob', 0, 0.6)],
        ],
      }),
      // A miss where `knob` reads the truth LOWER than the winner on the only rival that outranks it: no weight
      // wins this case back, so the term has a price and no upside on the cell.
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.1)],
        top1Terms: [term('self', 1, 2.0), term('knob', 0, 0.9)],
      }),
    ]);
    const line = formatLatentTermLine(census)!;
    expect(line).toContain('win: none');
    expect(line).toContain('shut: knob(cap=5.000,need=none)');
  });

  it('leads the closed segment with the SMALLEST cap, because that is the cell’s weight budget', () => {
    // Three closed terms with different prices, declared in an order that is neither the cap order nor the name
    // order, so neither a stable sort of the input nor an alphabetical accident can produce the expected line.
    const priced = ['wide', 'tight', 'middle'];
    const caps = [0.9, 0.01, 0.2];
    const cases: CasePrediction[] = priced.map((name, i) =>
      prediction({
        correct: true,
        truthTerms: [term('self', 1, 1.5), term(name, 0, 0.5)],
        top1Terms: [term('self', 1, 1.5), term(name, 0, 0.5)],
        // The truth leads by 0.50 and the rival closes it at `advantage` per unit → cap = 0.50 / advantage, so a
        // slope pair chosen from the cap gives exactly the price this case is meant to carry.
        rankedTerms: [
          [term('self', 1, 1.5), term(name, 0, 0.5)],
          [term('self', 1, 1.0), term(name, 0, 0.5 + 0.5 / caps[i]!)],
        ],
      }),
    );
    const census = censusOf(cases);
    const line = formatLatentTermLine(census)!;
    expect(line).toContain(
      'shut: tight(cap=0.010,need=none) middle(cap=0.200,need=none) wide(cap=0.900,need=none)',
    );
  });

  it('counts the closed terms it truncated, so the tail is known to exist', () => {
    const names = ['e5', 'e4', 'e3', 'e2', 'e1'];
    const cases: CasePrediction[] = names.map((name, i) =>
      prediction({
        correct: true,
        truthTerms: [term('self', 1, 1.5), term(name, 0, 0.5)],
        top1Terms: [term('self', 1, 1.5), term(name, 0, 0.5)],
        rankedTerms: [
          [term('self', 1, 1.5), term(name, 0, 0.5)],
          [term('self', 1, 1.0), term(name, 0, 0.5 + 0.5 / (0.1 * (names.length - i)))],
        ],
      }),
    );
    const line = formatLatentTermLine(censusOf(cases))!;
    // Five closed terms against a head of three, priced 0.1 … 0.5: the two most expensive are cut off and counted.
    expect(line).toContain('+2');
    expect(line).toContain('e1(cap=0.100');
    expect(line).not.toContain('e5(');
  });

  it('orders two terms with the SAME cap by name, so the line does not depend on insertion', () => {
    // Caps are compared as numbers, but equal caps fall through to the name arm — and that arm has TWO branches,
    // so the names are declared in a mixed order: an insertion sort compares an older entry against a newer one, and
    // only an ascending pair answers `-1` while a descending pair answers `1`. Two names would cover one of them.
    const twins = [
      ['mike', 0.3],
      ['alpha', 0.3],
      ['zulu', 0.3],
      ['bravo', 0.3],
      ['yankee', 0.3],
      ['charlie', 0.3],
    ] as const;
    const cases: CasePrediction[] = twins.map(([name, cap]) =>
      prediction({
        correct: true,
        truthTerms: [term('self', 1, 1.5), term(name, 0, 0.5)],
        top1Terms: [term('self', 1, 1.5), term(name, 0, 0.5)],
        rankedTerms: [
          [term('self', 1, 1.5), term(name, 0, 0.5)],
          [term('self', 1, 1.0), term(name, 0, 0.5 + 0.5 / cap)],
        ],
      }),
    );
    const line = formatLatentTermLine(censusOf(cases))!;
    // Six equally priced terms and a head of three: the order is the name arm alone, and the tail is counted.
    expect(line.indexOf('alpha(')).toBeLessThan(line.indexOf('bravo('));
    expect(line.indexOf('bravo(')).toBeLessThan(line.indexOf('charlie('));
    expect(line).toContain('+3');
  });

  it('prints a term that would win only AFTER it starts losing as a CONFLICT, with both numbers', () => {
    // The cell loses this case at 0.20, and the cheapest miss on it needs 0.50: the window is empty because the
    // term would cost a case before it won one. Both numbers are printed, because "no window" and "no evidence"
    // are different findings and this one is a conflict between cases rather than an absent input.
    const census = censusOf([
      prediction({
        correct: true,
        truthTerms: [term('self', 1, 1.5), term('knob', 0, 0.5)],
        top1Terms: [term('self', 1, 1.5), term('knob', 0, 0.5)],
        rankedTerms: [
          [term('self', 1, 1.5), term('knob', 0, 0.5)],
          [term('self', 1, 1.0), term('knob', 0, 3.0)],
        ],
      }),
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.6)],
        top1Terms: [term('self', 1, 1.4), term('knob', 0, 0.4)],
      }),
    ]);
    // cap = 0.50 / (3.0 − 0.5) = 0.20; need = 0 + 0.40 / (0.6 − 0.4) = 2.00.
    expect(formatLatentTermLine(census)).toContain('shut: knob(cap=0.200,need=2.000)');
  });

  it('prices a cap on the rival that carries the term, and skips a name neither side prices', () => {
    // Two edges of the same loop. `knob` is absent from the truth's breakdown — the truth did not pay for it — and
    // the margin it can be lifted by is still real, so the cap must be anchored on the rival's weight rather than
    // lost. `ghost` is emitted by both sides with a contribution and NO weight: nothing can move it, and recording
    // an infinite cap for it would claim the cell is safe from a term that is not even priced.
    const ghost: ScoreTerm = { name: 'ghost', contribution: 0 };
    const census = censusOf([
      prediction({
        correct: true,
        // `extra` is carried by the truth and NOT by the challenger: its rival slope reads as zero, which is the
        // other `?? 0` arm — a term the rival does not pay for is a term that cannot lift it. It is in `top1Terms`
        // because on a correct case the TOP candidate IS the truth, and that is the side the guarded path reads.
        truthTerms: [term('self', 1, 1.5), term('extra', 1, 0.4), ghost],
        top1Terms: [term('self', 1, 1.5), term('extra', 1, 0.4), ghost],
        rankedTerms: [
          [term('self', 1, 1.5), term('extra', 1, 0.4), ghost],
          [term('self', 1, 1.0), term('knob', 0, 0.6), ghost],
        ],
      }),
    ]);
    // margin = (1.5 + 0.4) − 1.0 = 0.9; advantage = 0.6 − 0 = 0.6 → cap = 0.9 / 0.6.
    expect(census.terms.get('knob')?.weight).toBe(0);
    expect(census.terms.get('knob')?.cap).toBeCloseTo(0.9 / 0.6, 12);
    expect(census.terms.has('ghost')).toBe(false);
  });

  it('omits the segment when every recorded term has a window', () => {
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term('self', 1, 1.0), term('knob', 0, 0.6)],
        top1Terms: [term('self', 1, 1.4), term('knob', 0, 0.4)],
      }),
    ]);
    expect(formatLatentTermLine(census)).not.toContain('shut:');
  });
});
