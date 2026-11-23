/**
 * The first-hop rule's own tests.
 *
 * The rule is a statement about a FAILURE BOUNDARY: when requests fail as they enter the system and nothing below the
 * door fails, the door is the answer. What makes these tests a test of that statement rather than of a threshold is
 * asserted here — the premise refuses every unmeasured column instead of reading it as a zero, the bar is compared
 * strictly so a case at the bar does not fire, the answer is the door only when the rule speaks, the partition is the
 * same one every axis in this programme uses, and four clauses can refuse the reading whatever it gains.
 */

import { describe, expect, it } from 'vitest';

import { foldOf, stableHash } from '../src/channel-split.js';
import {
  MIN_FIRST_HOP_GAIN,
  MIN_FIRST_HOP_PRECISION,
  crossValidateFirstHop,
  doorSpeaks,
  firstHopUnder,
  formatFirstHopReport,
  premiseHolds,
  type FirstHopValidation,
  type HopCase,
} from '../src/first-hop.js';

/** A case whose only failing boundary is the door's inbound edge. */
function hopCase(overrides: Partial<HopCase> = {}): HopCase {
  return {
    datapack: 'case-a',
    faultType: 'F',
    truth: ['front'],
    answer: 'mid',
    entry: 'front',
    entryChildErrors: 0,
    belowFails: false,
    inboundFails: 500,
    ...overrides,
  };
}

describe('the population the rule speaks over', () => {
  it('holds when nothing below the door fails and the case has an answer and an entry', () => {
    expect(premiseHolds(hopCase())).toBe(true);
  });

  it('refuses a child of the door that reports an error', () => {
    expect(premiseHolds(hopCase({ entryChildErrors: 12 }))).toBe(false);
  });

  it('refuses a case where a measured edge below the door failed', () => {
    expect(premiseHolds(hopCase({ belowFails: true }))).toBe(false);
  });

  it('refuses an UNMEASURED child-error column rather than reading it as a zero', () => {
    // `undefined > 0` is false and so is `null > 0`: a premise written with comparisons alone would fire on every
    // row of an artifact that predates the column, which is the hole 329 closed and this clause keeps closed.
    expect(premiseHolds(hopCase({ entryChildErrors: null }))).toBe(false);
  });

  it('refuses an unmeasured below-fails column', () => {
    expect(premiseHolds(hopCase({ belowFails: null }))).toBe(false);
  });

  it('refuses a case with no entry to name', () => {
    expect(premiseHolds(hopCase({ entry: null }))).toBe(false);
  });

  it('refuses a case with no answer to replace', () => {
    expect(premiseHolds(hopCase({ answer: null }))).toBe(false);
  });
});

describe('when the door speaks', () => {
  it('speaks when the inbound count is above the bar', () => {
    expect(doorSpeaks(hopCase({ inboundFails: 51 }), 50)).toBe(true);
  });

  it('stays silent AT the bar, because the comparison is strict', () => {
    expect(doorSpeaks(hopCase({ inboundFails: 50 }), 50)).toBe(false);
  });

  it('stays silent under the shipped pipeline, where the bar is disabled', () => {
    expect(doorSpeaks(hopCase(), null)).toBe(false);
  });

  it('stays silent when the inbound count was never measured', () => {
    expect(doorSpeaks(hopCase({ inboundFails: null }), 0)).toBe(false);
  });

  it('stays silent when the door is already the answer', () => {
    expect(doorSpeaks(hopCase({ answer: 'front' }), 50)).toBe(false);
  });

  it('stays silent when a child of the door reports an error, however loud the edge is', () => {
    expect(doorSpeaks(hopCase({ entryChildErrors: 1, inboundFails: 9_999 }), 50)).toBe(false);
  });

  it('stays silent when an edge below the door failed, however loud the edge is', () => {
    expect(doorSpeaks(hopCase({ belowFails: true, inboundFails: 9_999 }), 50)).toBe(false);
  });
});

describe('the answer under the rule', () => {
  it('is the door when the rule speaks', () => {
    expect(firstHopUnder(hopCase({ inboundFails: 400 }), 50)).toBe('front');
  });

  it('is the artifact answer when the rule is silent', () => {
    expect(firstHopUnder(hopCase({ inboundFails: 40 }), 50)).toBe('mid');
  });

  it('carries a null answer through rather than turning it into a name', () => {
    expect(firstHopUnder(hopCase({ answer: null }), 50)).toBeNull();
  });

  it('is the shipped answer when the bar is disabled', () => {
    expect(firstHopUnder(hopCase({ inboundFails: 9_999 }), null)).toBe('mid');
  });
});

describe('the scope check', () => {
  it('finds no firing outside the population, even for a case with a huge edge that fails the premise', () => {
    const cases = [
      hopCase({ entryChildErrors: 3, inboundFails: 9_999 }),
      hopCase({ belowFails: true }),
    ];
    const { firedOutsidePopulation } = crossValidateFirstHop(
      cases,
      [50],
      MIN_FIRST_HOP_GAIN,
      MIN_FIRST_HOP_PRECISION,
    );
    expect(firedOutsidePopulation).toBe(0);
  });
});

describe('the held-out reading', () => {
  const GRID = [0, 50, 100, 400, 1000];

  /**
   * A corpus of cases in one family, with the shape of each case decided by the fold it lands in.
   *
   * `repair` is a case whose truth is the door and whose answer is elsewhere; `breaks` is one the resolver got right
   * and the rule would take away; `narrow` is a break whose edge fires only under the two lowest bars, which is what
   * makes a higher cell the unique maximum instead of a tie at the grid's edge.
   */
  function corpusOf(
    spec: (fold: 0 | 1, nth: number) => 'repair' | 'breaks' | 'narrow',
    perFold = 20,
  ): HopCase[] {
    const rows: HopCase[] = [];
    const seen: [number, number] = [0, 0];
    for (let index = 0; index < perFold * 2; index += 1) {
      const fold = foldOf('F', index);
      const shape = spec(fold, seen[fold]);
      seen[fold] += 1;
      rows.push(
        hopCase({
          datapack: `case-${index}`,
          truth: shape === 'repair' ? ['front'] : ['mid'],
          answer: 'mid',
          inboundFails: shape === 'repair' ? 500 : shape === 'breaks' ? 500 : 60,
        }),
      );
    }
    return rows;
  }

  /** Fifteen repairs and four breaks a side, plus one narrow break: an interior cell with a 0.79 precision. */
  const healthy = (fold: 0 | 1, nth: number): 'repair' | 'breaks' | 'narrow' =>
    nth === 0 ? 'narrow' : nth <= 15 ? 'repair' : 'breaks';

  const reasonsOf = (reading: FirstHopValidation): readonly string[] => reading.reasons;

  it('reads the shipped surface as the comparison and the sizes as the population', () => {
    const cases = corpusOf(healthy);
    const reading = crossValidateFirstHop(cases, GRID, MIN_FIRST_HOP_GAIN, MIN_FIRST_HOP_PRECISION);
    expect(reading.sizes[0] + reading.sizes[1]).toBe(cases.length);
    // Every case the resolver got right is already right; the repairs are the ones it got wrong.
    expect(reading.mixed[0] + reading.mixed[1]).toBe(10);
    expect(reading.sweep).toHaveLength(GRID.length);
  });

  it('passes when both folds clear the gain, agree on an interior cell and stay calibrated', () => {
    const reading = crossValidateFirstHop(
      corpusOf(healthy),
      GRID,
      MIN_FIRST_HOP_GAIN,
      MIN_FIRST_HOP_PRECISION,
    );
    expect(reading.selected).toEqual([100, 100]);
    expect(reading.deltas[0]).toBeGreaterThanOrEqual(MIN_FIRST_HOP_GAIN);
    expect(reading.deltas[1]).toBeGreaterThanOrEqual(MIN_FIRST_HOP_GAIN);
    expect(Math.min(...reading.precision)).toBeGreaterThanOrEqual(MIN_FIRST_HOP_PRECISION);
    expect(reasonsOf(reading)).toEqual([]);
    expect(reading.passes).toBe(true);
  });

  it('fails when one fold gains less than the bar', () => {
    const blind = (fold: 0 | 1, nth: number): 'repair' | 'breaks' | 'narrow' =>
      fold === 1 ? (nth === 0 ? 'narrow' : 'breaks') : healthy(fold, nth);
    const reading = crossValidateFirstHop(
      corpusOf(blind),
      GRID,
      MIN_FIRST_HOP_GAIN,
      MIN_FIRST_HOP_PRECISION,
    );
    expect(reading.reasons.some((reason) => reason.startsWith('fold 1 gains'))).toBe(true);
    expect(reading.passes).toBe(false);
  });

  it('fails when the chosen cell sits on the grid corner, whatever it reads', () => {
    const noBreaks = (): 'repair' => 'repair';
    const reading = crossValidateFirstHop(
      corpusOf(noBreaks),
      GRID,
      MIN_FIRST_HOP_GAIN,
      MIN_FIRST_HOP_PRECISION,
    );
    expect(reading.deltas[0]).toBeGreaterThanOrEqual(MIN_FIRST_HOP_GAIN);
    expect(reading.reasons).toContain('the chosen bar is on the grid corner, so it is unmeasured');
    expect(reading.passes).toBe(false);
  });

  it('fails when the two folds choose cells more than one step apart', () => {
    // One half wants the middle of the grid; the other has nothing above the narrowest cell to stop it sliding to the
    // corner. The reading is then refused on its partition, not on its gain, so the deltas are asserted too.
    const slide = (fold: 0 | 1, nth: number): 'repair' | 'breaks' | 'narrow' =>
      fold === 1 ? healthy(fold, nth) : 'repair';
    const reading = crossValidateFirstHop(
      corpusOf(slide),
      GRID,
      MIN_FIRST_HOP_GAIN,
      MIN_FIRST_HOP_PRECISION,
    );
    expect(reading.deltas[0]).toBeGreaterThanOrEqual(MIN_FIRST_HOP_GAIN);
    expect(reading.deltas[1]).toBeGreaterThanOrEqual(MIN_FIRST_HOP_GAIN);
    expect(reading.reasons).toContain('the folds chose bars more than one step apart');
    expect(reading.passes).toBe(false);
  });

  it('fails when the rule fires on a population it cannot tell apart from the fallback', () => {
    // Eleven repairs against four breaks is a gain of seven and a precision of 0.73: the bar is cleared and the
    // calibration is not, which is exactly the reading the base-rate law says must be refused.
    const thin = (fold: 0 | 1, nth: number): 'repair' | 'breaks' | 'narrow' =>
      nth === 0 ? 'narrow' : nth <= 14 ? 'repair' : 'breaks';
    const reading = crossValidateFirstHop(
      corpusOf(thin),
      GRID,
      MIN_FIRST_HOP_GAIN,
      MIN_FIRST_HOP_PRECISION,
    );
    expect(reading.deltas[0]).toBeGreaterThanOrEqual(MIN_FIRST_HOP_GAIN);
    expect(Math.min(...reading.precision)).toBeLessThan(MIN_FIRST_HOP_PRECISION);
    expect(reading.reasons.some((reason) => reason.startsWith('precision'))).toBe(true);
    expect(reading.passes).toBe(false);
  });

  it('counts a bar that fires on nothing as zero repairs rather than as a silent success', () => {
    const reading = crossValidateFirstHop(
      corpusOf(() => 'narrow'),
      GRID,
      MIN_FIRST_HOP_GAIN,
      MIN_FIRST_HOP_PRECISION,
    );
    expect(reading.sweep.every((one) => one.repairs === 0)).toBe(true);
    expect(reading.deltas[0]).toBe(0);
  });
});

describe('the report', () => {
  const reading: FirstHopValidation = {
    sizes: [711, 711],
    mixed: [643, 644],
    sweep: [{ beta: 50, correct: [650, 651], repairs: 28, breaks: 7 }],
    selected: [50, 50],
    heldOut: [650, 651],
    deltas: [7, 7],
    precision: [0.8, 0.8],
    firedOutsidePopulation: 0,
    reasons: [],
    passes: true,
  };

  it('prints the gate, the sweep, the precision and the scope', () => {
    const text = formatFirstHopReport(reading);
    expect(text).toContain('P1');
    expect(text).toContain('P4');
    expect(text).toContain('fired outside the population 0');
    expect(text).toContain('passes every clause');
  });

  it('names the clause that refused a reading', () => {
    const refused = formatFirstHopReport({
      ...reading,
      reasons: ['fold 0 gains 3'],
      passes: false,
    });
    expect(refused).toContain('does not pass -- fold 0 gains 3');
  });
});

describe('the fold the module reads', () => {
  it('is the same partition every axis in this programme uses', () => {
    const cases = Array.from({ length: 4 }, (_, index) =>
      hopCase({ datapack: `case-${index}`, truth: ['front'], answer: 'mid', inboundFails: 500 }),
    );
    const reading = crossValidateFirstHop(
      cases,
      [0, 50],
      MIN_FIRST_HOP_GAIN,
      MIN_FIRST_HOP_PRECISION,
    );
    const bit = stableHash('F') & 1;
    expect(reading.sizes[bit]).toBe(2);
    expect(reading.sizes[1 - bit]).toBe(2);
  });
});
