/**
 * The engine-certainty guard's tests.
 *
 * The guard has one statement — *when the engine's own margin says it was not close, a resolver may not rename the
 * case* — and the tests are written to keep it from decaying into the loudness guard 331 refuted: the bar is read on
 * the ENGINE's margin and not on the answer, an unmeasured margin refuses rather than reads as decided, and the
 * four clauses can refuse the held-out reading whatever it gains.
 */

import { describe, expect, it } from 'vitest';

import { foldOf } from '../src/channel-split.js';
import {
  CERTAINTY_GRID,
  CERTAINTY_MARGIN,
  MIN_CERTAINTY_GAIN,
  MIN_CERTAINTY_PRECISION,
  certaintyCasesOf,
  certaintyUnder,
  crossValidateCertainty,
  formatCertaintyReport,
  formatGuardCensus,
  guardCensusOf,
  type CertaintyCase,
  type CertaintyValidation,
  type PublishedCase,
} from '../src/engine-certainty.js';
import { engineCertainty } from '../src/query-agent.js';

/** A case whose engine was decided and whose answer was renamed away from it. */
function certaintyCase(overrides: Partial<CertaintyCase> = {}): CertaintyCase {
  return {
    datapack: 'case-a',
    faultType: 'F',
    truth: ['engine-pick'],
    answer: 'someone-else',
    engineTop1: 'engine-pick',
    margin: 4,
    ...overrides,
  };
}

describe('the guard', () => {
  it('returns the engine’s first choice when its margin clears the bar', () => {
    expect(certaintyUnder(certaintyCase(), CERTAINTY_MARGIN)).toBe('engine-pick');
  });

  it('leaves the answer alone when the margin is at or below the bar', () => {
    expect(certaintyUnder(certaintyCase({ margin: 1.5 }), CERTAINTY_MARGIN)).toBe('someone-else');
    expect(certaintyUnder(certaintyCase({ margin: 1 }), CERTAINTY_MARGIN)).toBe('someone-else');
  });

  it('leaves an answer that already names the engine’s first choice alone', () => {
    expect(certaintyUnder(certaintyCase({ answer: 'engine-pick' }), CERTAINTY_MARGIN)).toBe(
      'engine-pick',
    );
  });

  it('refuses an UNMEASURED margin rather than reading it as decided', () => {
    // `null > 1.5` is false, so a comparison alone would silently pass this case through — which is correct here and
    // for the wrong reason. The refusal is stated so it survives a future change of comparison.
    expect(certaintyUnder(certaintyCase({ margin: null }), CERTAINTY_MARGIN)).toBe('someone-else');
  });

  it('refuses a case the engine never ranked', () => {
    expect(certaintyUnder(certaintyCase({ engineTop1: null }), CERTAINTY_MARGIN)).toBe(
      'someone-else',
    );
  });

  it('returns null for a case with no answer, whatever the margin says', () => {
    expect(certaintyUnder(certaintyCase({ answer: null }), CERTAINTY_MARGIN)).toBeNull();
  });

  it('is the shipped surface, byte for byte, when the bar is null', () => {
    expect(certaintyUnder(certaintyCase(), null)).toBe('someone-else');
    expect(certaintyUnder(certaintyCase({ answer: null }), null)).toBeNull();
  });
});

/**
 * A corpus with two roles under the guard, one of which a WIDER bar stops touching.
 *
 * The margins are chosen so the best cell is INTERIOR: a repair at 4 (fired by every bar below 4) and a break at 1.2
 * (fired only by the narrowest bar). A corpus of repairs alone would put the optimum on the grid's first point, and
 * the corner clause would refuse every reading — correctly, and for a reason that says nothing about the guard.
 */
function corpusOf(
  role: (fold: 0 | 1, nth: number) => 'repair' | 'break' | 'narrow',
  breakMargin = 1.2,
): CertaintyCase[] {
  const cases: CertaintyCase[] = [];
  const seen = new Map<string, number>();
  for (const faultType of ['A', 'B']) {
    for (let nth = 0; nth < 40; nth += 1) {
      const index = seen.get(faultType) ?? 0;
      seen.set(faultType, index + 1);
      const fold = foldOf(faultType, index);
      const kind = role(fold, nth);
      cases.push(
        kind === 'repair'
          ? certaintyCase({ datapack: `${faultType}-${nth}`, faultType, margin: 4 })
          : kind === 'break'
            ? certaintyCase({
                datapack: `${faultType}-${nth}`,
                faultType,
                truth: ['someone-else'],
                margin: breakMargin,
              })
            : certaintyCase({
                datapack: `${faultType}-${nth}`,
                faultType,
                answer: 'engine-pick',
                margin: 0.2,
              }),
      );
    }
  }
  return cases;
}

/**
 * One case as the three artifacts describe it.
 *
 * The defaults are the ordinary shape: the engine published `engine-pick` first, its score leads the runner-up by
 * four, and the shipped answer is somebody else's name.
 */
function publishedCase(overrides: Partial<PublishedCase> = {}): PublishedCase {
  const scores = new Map([
    ['engine-pick', 9],
    ['runner-up', 5],
    ['someone-else', 1],
  ]);
  return {
    datapack: 'case-a',
    faultType: 'F',
    truth: ['engine-pick'],
    settled: 'someone-else',
    ranked: ['engine-pick', 'runner-up', 'someone-else'],
    scoreOf: (service) => scores.get(service),
    ...overrides,
  };
}

describe('the pair the margin is taken between', () => {
  it('reads the first two candidates the engine PUBLISHED, in the order it published them', () => {
    const [one] = certaintyCasesOf([publishedCase()]);
    expect(one!.engineTop1).toBe('engine-pick');
    expect(one!.margin).toBe(4);
  });

  it('is the published pair even when the scores would sort the two the other way round', () => {
    // The engine's order is NOT a function of its scores: two relational passes permute a finished list, so a case
    // can publish a first choice its own arithmetic scores below the second. Reading the margin off the sorted pair
    // would then be reading a pair the product never showed — the whole of iteration 334's scope gap.
    const [one] = certaintyCasesOf([
      publishedCase({
        ranked: ['runner-up', 'engine-pick'],
        scoreOf: (service) => (service === 'engine-pick' ? 9 : 5),
      }),
    ]);
    expect(one!.engineTop1).toBe('runner-up');
    expect(one!.margin).toBe(-4);
  });

  it('refuses a margin for a case the engine ranked once, rather than inventing a second', () => {
    const [one] = certaintyCasesOf([publishedCase({ ranked: ['engine-pick'] })]);
    expect(one!.engineTop1).toBe('engine-pick');
    expect(one!.margin).toBeNull();
  });

  it('refuses a margin when either name carries no score, rather than reading it as zero', () => {
    // An absent score is an UNMEASURED boundary. A `?? 0` here would turn a column the artifact never carried into
    // the strongest possible statement — "the engine led by nine" — which is exactly the shape 329 paid for.
    const [one] = certaintyCasesOf([
      publishedCase({ scoreOf: (service) => (service === 'engine-pick' ? 9 : undefined) }),
    ]);
    expect(one!.margin).toBeNull();
  });

  it('refuses a margin for a case the engine never ranked', () => {
    const [one] = certaintyCasesOf([publishedCase({ ranked: [] })]);
    expect(one!.engineTop1).toBeNull();
    expect(one!.margin).toBeNull();
  });

  it('prefers the artifact’s own two columns over the dump, because that is the product’s number', () => {
    // Both sources describe the same pair, and the native one is the engine's own record. The precedence is asserted
    // so a future caller cannot silently price the dump while the artifact carries the column: on this corpus the two
    // agree exactly (iteration 336 recomputed the sum on 69 688 candidates), which is why the reading survives either
    // source — but a reading that does not SAY which source it took is not auditable.
    const [one] = certaintyCasesOf([
      publishedCase({ top1Score: 9, top2Score: 5, scoreOf: () => 1 }),
    ]);
    expect(one!.margin).toBe(4);
  });

  it('falls back to the dump only when the artifact carried no columns', () => {
    const [one] = certaintyCasesOf([publishedCase({ top1Score: null, top2Score: null })]);
    expect(one!.margin).toBe(4);
  });

  it('is unmeasured when the artifact carries one column and the dump none', () => {
    const [one] = certaintyCasesOf([publishedCase({ top1Score: 9, scoreOf: () => undefined })]);
    expect(one!.margin).toBeNull();
  });

  it('carries the shipped answer through untouched, so the guard reads the surface it is added to', () => {
    const [one] = certaintyCasesOf([publishedCase({ settled: 'engine-pick' })]);
    expect(one!.answer).toBe('engine-pick');
  });

  it('builds one case per row, in the artifact’s own order', () => {
    const cases = certaintyCasesOf([
      publishedCase({ datapack: 'first' }),
      publishedCase({ datapack: 'second' }),
    ]);
    expect(cases.map((one) => one.datapack)).toEqual(['first', 'second']);
  });
});

/** A corpus that mixes the two roles, so a bar can be right on one and wrong on the other. */
function mixedCorpus(): CertaintyCase[] {
  return corpusOf((_fold, nth) => (nth % 7 === 0 ? 'break' : nth % 3 === 0 ? 'repair' : 'narrow'));
}

describe('the priced rule and the shipped rule', () => {
  it('settle on the same answer over the whole grid of inputs they can be handed', () => {
    // Two implementations, one statement. The instrument prices `certaintyUnder` over an artifact and the product
    // ships `engineCertainty` inside `applyResolver`; a rule priced by one and shipped by another is two rules, and
    // the artifact would then measure the one nobody runs — the defect iteration 322 paid a dispatch to learn.
    const answers = [null, 'a', 'b'];
    const tops = [null, 'a', 'b'];
    const margins = [null, 0, 1.5, 1.500001, 3, Number.NaN];
    const bars = [null, ...CERTAINTY_GRID];
    for (const answer of answers) {
      for (const top1 of tops) {
        for (const margin of margins) {
          for (const bar of bars) {
            const priced = certaintyUnder(
              certaintyCase({ answer, engineTop1: top1, margin, truth: ['a'] }),
              bar,
            );
            const shipped = engineCertainty(answer, { top1, margin }, bar) ?? answer;
            expect(
              shipped,
              `${String(answer)} ${String(top1)} ${String(margin)} ${String(bar)}`,
            ).toBe(priced);
          }
        }
      }
    }
  });
});

describe('the held-out reading', () => {
  it('passes a guard that repairs on both folds without breaking anything', () => {
    const reading = crossValidateCertainty(
      mixedCorpus(),
      CERTAINTY_GRID,
      MIN_CERTAINTY_GAIN,
      MIN_CERTAINTY_PRECISION,
    );
    expect(reading.deltas[0]).toBeGreaterThanOrEqual(MIN_CERTAINTY_GAIN);
    expect(reading.deltas[1]).toBeGreaterThanOrEqual(MIN_CERTAINTY_GAIN);
    expect(reading.passes).toBe(true);
  });

  it('refuses a guard that breaks cases it was meant to protect', () => {
    // Every case is a break: the guard moves a correct answer to a wrong engine pick, which is the failure mode a
    // "do no harm" rule is supposed to make impossible.
    const reading = crossValidateCertainty(
      corpusOf(() => 'break'),
      CERTAINTY_GRID,
      MIN_CERTAINTY_GAIN,
      MIN_CERTAINTY_PRECISION,
    );
    // The narrowest bar is the only one that fires, and it fires on every case: the sweep's first point is the
    // reading that shows the damage, while the chosen cell is the one that fires on nothing.
    expect(reading.sweep[0]!.correct[0]).toBeLessThan(reading.shipped[0]);
    expect(reading.deltas[0]).toBe(0);
    expect(reading.passes).toBe(false);
  });

  it('counts a guard that fires on nothing as zero gain rather than as a silent success', () => {
    const reading = crossValidateCertainty(
      corpusOf(() => 'narrow'),
      CERTAINTY_GRID,
      MIN_CERTAINTY_GAIN,
      MIN_CERTAINTY_PRECISION,
    );
    expect(reading.deltas[0]).toBe(0);
    expect(reading.sweep.every((one) => one.repairs === 0)).toBe(true);
  });

  it('refuses a reading whose chosen margin sits on the grid corner', () => {
    // A two-point grid makes every choice a corner, which is exactly the "unmeasured" case the clause exists for.
    const reading = crossValidateCertainty(
      corpusOf(() => 'repair'),
      [1, 2],
      MIN_CERTAINTY_GAIN,
      MIN_CERTAINTY_PRECISION,
    );
    expect(reading.reasons.some((reason) => reason.includes('grid corner'))).toBe(true);
  });

  it('refuses two folds that chose margins more than one step apart', () => {
    // The break sits just above the bar on one half and well above it on the other, so each half's best cell is
    // decided by a different break: the two halves disagree by two grid steps, which is what "the bar is a property of
    // the corpus rather than of a fold" fails to be.
    const cases: CertaintyCase[] = [];
    const seen = new Map<string, number>();
    for (const faultType of ['A', 'B']) {
      for (let nth = 0; nth < 40; nth += 1) {
        const index = seen.get(faultType) ?? 0;
        seen.set(faultType, index + 1);
        const fold = foldOf(faultType, index);
        cases.push(
          nth < 15
            ? certaintyCase({ datapack: `${faultType}-${nth}`, faultType, margin: 4 })
            : nth < 20
              ? certaintyCase({
                  datapack: `${faultType}-${nth}`,
                  faultType,
                  truth: ['someone-else'],
                  margin: fold === 0 ? 1.2 : 2.5,
                })
              : certaintyCase({
                  datapack: `${faultType}-${nth}`,
                  faultType,
                  answer: 'engine-pick',
                  margin: 0.2,
                }),
        );
      }
    }
    const reading = crossValidateCertainty(
      cases,
      CERTAINTY_GRID,
      MIN_CERTAINTY_GAIN,
      MIN_CERTAINTY_PRECISION,
    );
    expect(reading.reasons.some((reason) => reason.includes('more than one step apart'))).toBe(
      true,
    );
    expect(reading.passes).toBe(false);
  });

  it('refuses a reading below the precision floor', () => {
    // Twenty repairs against fifteen breaks AT THE SAME margin: every bar that fires, fires on both, so the best cell
    // is the first and its precision is 20/35 — the reading a gain gate alone would wave through.
    const reading = crossValidateCertainty(
      corpusOf((_fold, nth) => (nth < 20 ? 'repair' : nth < 35 ? 'break' : 'narrow'), 4),
      CERTAINTY_GRID,
      MIN_CERTAINTY_GAIN,
      MIN_CERTAINTY_PRECISION,
    );
    expect(Math.min(...reading.precision)).toBeLessThan(MIN_CERTAINTY_PRECISION);
    expect(reading.reasons.some((reason) => reason.startsWith('precision'))).toBe(true);
    expect(reading.passes).toBe(false);
  });
});

describe('the report', () => {
  const reading: CertaintyValidation = {
    sizes: [710, 712],
    shipped: [645, 642],
    sweep: [{ margin: 1.5, correct: [650, 648], repairs: 11, breaks: 0 }],
    selected: [1.5, 1.5],
    heldOut: [650, 648],
    deltas: [5, 6],
    precision: [1, 1],
    reasons: [],
    passes: true,
  };

  it('prints the sweep, the choice, the precision and the verdict', () => {
    const text = formatCertaintyReport(reading);
    expect(text).toContain('P1');
    expect(text).toContain('1.5');
    expect(text).toContain('precision 1.000 / 1.000');
    expect(text).toContain('passes every clause');
  });

  it('names the clause that refused a reading', () => {
    const refused = formatCertaintyReport({
      ...reading,
      reasons: ['fold 1 gains 2'],
      passes: false,
    });
    expect(refused).toContain('does not pass -- fold 1 gains 2');
  });
});

describe('the census of a guard that may not have been evaluated at all', () => {
  it('counts the cases whose pair was measured', () => {
    expect(guardCensusOf([1, 2, null, 0.5])).toEqual({ cases: 4, measured: 3 });
  });

  it('counts a zero margin as measured, because a tie is a reading and not an absence', () => {
    expect(guardCensusOf([0])).toEqual({ cases: 1, measured: 1 });
  });

  it('reports an empty population as zero rather than as a rate', () => {
    expect(guardCensusOf([])).toEqual({ cases: 0, measured: 0 });
  });

  it('says the guard fired on every case when every pair was measured', () => {
    expect(formatGuardCensus(guardCensusOf([1, 2]))).toContain('margin measured on every one');
  });

  it('names the population it could NOT evaluate, and what that costs the reading', () => {
    const text = formatGuardCensus(guardCensusOf([1, null, null]));
    expect(text).toContain('1 / 3');
    expect(text).toContain('2 carry no measured pair');
    expect(text).toContain('cannot fire there');
  });

  it('refuses to let a wholly unmeasured guard read as a guard that changed nothing', () => {
    const text = formatGuardCensus(guardCensusOf([null, null]));
    expect(text).toContain('not evaluated');
    expect(text).toContain("first-hop rule's alone");
  });

  it('prints an empty population without a percentage', () => {
    expect(formatGuardCensus(guardCensusOf([]))).toContain('0 cases');
  });
});
