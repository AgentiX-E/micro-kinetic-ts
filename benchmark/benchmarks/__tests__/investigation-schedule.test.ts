import { describe, expect, it } from 'vitest';

import {
  bucketOf,
  conversionOf,
  formatConversion,
  formatScheduleReading,
  positionOf,
  SCHEDULE_WIDTH,
  scheduleOf,
  scheduleReadingOf,
  usableCallsOf,
  type ScheduledCase,
  type ScheduleReading,
} from '../src/investigation-schedule.js';

/** One case with an engine order and an optional call record. */
function one(
  datapack: string,
  order: readonly string[],
  truth: readonly string[],
  correct: boolean,
  calls: readonly string[] | null,
): ScheduledCase {
  return { datapack, truth, order, correct, calls };
}

describe('the calls a schedule spends', () => {
  it('takes the first entries in the engine order, up to the width', () => {
    expect(scheduleOf(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
  });

  it('spends every distinct entry when the order is narrower than the width', () => {
    expect(scheduleOf(['a', 'b'], 10)).toEqual(['a', 'b']);
  });

  it('drops a repeat at its second occurrence, because a repeat would consume a call', () => {
    expect(scheduleOf(['a', 'b', 'a', 'c'], 3)).toEqual(['a', 'b', 'c']);
  });

  it('skips an empty name rather than spending a call on nothing', () => {
    expect(scheduleOf(['', 'a'], 2)).toEqual(['a']);
  });

  it('returns nothing at width zero, which is a refusal rather than a default', () => {
    expect(scheduleOf(['a', 'b'], 0)).toEqual([]);
  });

  it('defaults to the calls the SHIPPED budget can actually execute, which is five and not the ten it states', () => {
    const order = Array.from({ length: 30 }, (_, index) => `s${String(index)}`);
    expect(scheduleOf(order)).toHaveLength(SCHEDULE_WIDTH);
    // The loop gives its last turn to the answer, so six rounds execute five calls. `maxToolCalls: 10` never binds.
    expect(SCHEDULE_WIDTH).toBe(5);
    expect(usableCallsOf({ maxRounds: 6, maxToolCalls: 10, transcriptChars: 9_000 })).toBe(5);
  });

  it('takes the smaller of the two limits, so either one can be the wall', () => {
    expect(usableCallsOf({ maxRounds: 11, maxToolCalls: 10, transcriptChars: 9_000 })).toBe(10);
    expect(usableCallsOf({ maxRounds: 4, maxToolCalls: 2, transcriptChars: 9_000 })).toBe(2);
  });

  it('returns zero for a loop with a single turn, which has no room for a query at all', () => {
    expect(usableCallsOf({ maxRounds: 1, maxToolCalls: 10, transcriptChars: 9_000 })).toBe(0);
  });

  it('refuses a width that is not a non-negative integer, rather than coercing one', () => {
    for (const width of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => scheduleOf(['a'], width)).toThrow(/non-negative integer/);
    }
  });
});

describe('where the culprit sits in the engine order', () => {
  it('reports a one-based position', () => {
    expect(positionOf(['a', 'b', 'c'], ['c'])).toBe(3);
  });

  it('reads a multi-label case at its NEAREST acceptable answer', () => {
    expect(positionOf(['a', 'b', 'c'], ['c', 'a'])).toBe(1);
  });

  it('returns null for a truth the pool never held, which no schedule can reach', () => {
    expect(positionOf(['a', 'b'], ['z'])).toBeNull();
  });

  it('returns null for an empty order and for an empty label set, which are two different absences', () => {
    expect(positionOf([], ['a'])).toBeNull();
    expect(positionOf(['a'], [])).toBeNull();
  });

  it('takes the FIRST occurrence of a repeated id', () => {
    expect(positionOf(['a', 'b', 'a'], ['a'])).toBe(1);
  });
});

describe('the bucket a position is reported in', () => {
  it('places every boundary on the side the label claims', () => {
    expect([1, 5].map(bucketOf)).toEqual(['top5', 'top5']);
    expect([6, 10].map(bucketOf)).toEqual(['top10', 'top10']);
    expect([11, 20].map(bucketOf)).toEqual(['top20', 'top20']);
    expect([21, 900].map(bucketOf)).toEqual(['beyond', 'beyond']);
  });

  it('calls a null position unreachable rather than "beyond", because a pool failure is not a depth failure', () => {
    expect(bucketOf(null)).toBe('unreachable');
  });
});

describe('reading an artifact against a schedule', () => {
  /** Four rows that between them take every branch of the reader. */
  function population(): ScheduledCase[] {
    return [
      // A hit whose culprit was queried.
      one('h-q', ['a', 'b'], ['a'], true, ['a']),
      // A hit whose culprit was never queried.
      one('h-u', ['a', 'b'], ['b'], true, ['a']),
      // A miss that queried the culprit and still failed.
      one('m-q', ['a', 'b'], ['b'], false, ['b']),
      // A miss that never queried it, inside the width.
      one('m-u-near', ['a', 'b', 'c'], ['b'], false, ['a']),
      // A miss that never queried it, past the width AND past the deepest bucket: twenty-one fillers keep the
      // culprit at position 22, so this row is the only one that reports `beyond`.
      one(
        'm-u-far',
        [...Array.from({ length: 21 }, (_, index) => `f${String(index)}`), 'q'],
        ['q'],
        false,
        ['a'],
      ),
      // A miss whose answer the pool never held.
      one('m-u-absent', ['a', 'b'], ['z'], false, ['a']),
      // A miss with no call column at all.
      one('m-null', ['a', 'b'], ['b'], false, null),
    ];
  }

  it('keeps the three miss populations disjoint and exhaustive', () => {
    const reading = scheduleReadingOf(population(), 2);
    expect(reading.cases).toBe(7);
    expect(reading.hits).toBe(2);
    expect(reading.misses).toBe(5);
    expect(reading.queriedMisses + reading.unqueriedMisses + reading.unrecordedMisses).toBe(
      reading.misses,
    );
    expect(reading.queriedMisses).toBe(1);
    expect(reading.unqueriedMisses).toBe(3);
    expect(reading.unrecordedMisses).toBe(1);
  });

  it('puts an unmeasured row in neither measured bucket', () => {
    const reading = scheduleReadingOf(population(), 2);
    expect(reading.unqueriedMisses).toBe(3);
    expect(reading.unrecordedMisses).toBe(1);
  });

  it('splits the unqueried misses into reachable, beyond and unreachable', () => {
    const reading = scheduleReadingOf(population(), 2);
    expect(reading.reachableUnqueried).toBe(1);
    expect(reading.beyondUnqueried).toBe(1);
    expect(reading.unreachableUnqueried).toBe(1);
    expect(
      reading.reachableUnqueried + reading.beyondUnqueried + reading.unreachableUnqueried,
    ).toBe(reading.unqueriedMisses);
  });

  it('counts the hits it converted from an investigation, which is the conversion numerator', () => {
    const reading = scheduleReadingOf(population(), 2);
    expect(reading.hitsQueried).toBe(1);
    expect(reading.hitsUnqueried).toBe(1);
    expect(reading.hitsQueried + reading.hitsUnqueried).toBe(reading.hits);
  });

  it('counts the buckets over the unqueried misses, and their sum is that population', () => {
    const reading = scheduleReadingOf(population(), 2);
    const { buckets } = reading;
    expect(buckets).toEqual({ top5: 1, top10: 0, top20: 0, beyond: 1, unreachable: 1 });
    expect(Object.values(buckets).reduce((sum, value) => sum + value, 0)).toBe(
      reading.unqueriedMisses,
    );
  });

  it('moves only the reachable count when the width narrows, which is what makes the width a lever', () => {
    const wide = scheduleReadingOf(population(), 3);
    const narrow = scheduleReadingOf(population(), 2);
    expect(narrow.reachableUnqueried).toBe(wide.reachableUnqueried);
    const tinier = scheduleReadingOf(population(), 1);
    expect(tinier.reachableUnqueried).toBe(0);
    expect(tinier.beyondUnqueried).toBe(2);
    expect(tinier.unreachableUnqueried).toBe(1);
    expect(tinier.buckets).toEqual(wide.buckets);
  });

  it('reads an empty population as zero rather than refusing it', () => {
    const reading = scheduleReadingOf([], 10);
    expect(reading).toMatchObject({ cases: 0, hits: 0, misses: 0, unqueriedMisses: 0 });
  });

  it('refuses a width that is not a non-negative integer', () => {
    expect(() => scheduleReadingOf([], -2)).toThrow(/non-negative integer/);
  });

  it('defaults to the shipped width', () => {
    expect(scheduleReadingOf([]).width).toBe(SCHEDULE_WIDTH);
  });
});

describe('rendering the reading', () => {
  function reading(over: Partial<ScheduleReading> = {}): ScheduleReading {
    return {
      width: 10,
      cases: 1_422,
      hits: 1_328,
      misses: 94,
      queriedMisses: 20,
      unqueriedMisses: 74,
      unrecordedMisses: 0,
      reachableUnqueried: 40,
      beyondUnqueried: 34,
      unreachableUnqueried: 0,
      hitsQueried: 1_178,
      hitsUnqueried: 150,
      buckets: { top5: 29, top10: 11, top20: 16, beyond: 18, unreachable: 0 },
      ...over,
    };
  }

  it('prints the population, the ceiling in cases and in points, and the population a schedule cannot reach', () => {
    const text = formatScheduleReading(reading());
    expect(text).toContain('schedule reach at width 10 — 1 422 answers, 1 328 hits, 94 misses');
    expect(text).toContain('top 5 29, 6–10 11, 11–20 16, beyond 20 18, not in the pool 0');
    expect(text).toContain('inside the first 10: 40 of 74 (54.05 %)');
    expect(text).toContain('2.81 pp of this corpus, and no more');
    expect(text).toContain('already queried it and still missed: 20');
  });

  it('says 0 answers rather than printing a table of zeroes', () => {
    expect(formatScheduleReading(reading({ cases: 0, hits: 0, misses: 0 }))).toBe(
      'schedule reach: 0 answers',
    );
  });

  it('names the unmeasured rows only when there are any, so their absence is not read as a zero', () => {
    expect(formatScheduleReading(reading())).not.toContain('no call column');
    expect(formatScheduleReading(reading({ unrecordedMisses: 3 }))).toContain(
      'rows with no call column: 3 — unmeasured, and therefore in neither population',
    );
  });

  it('states the past-width split only when something is past the width', () => {
    expect(formatScheduleReading(reading())).toContain(
      'past the width: 34 inside the pool, 0 the pool never held',
    );
    expect(
      formatScheduleReading(reading({ beyondUnqueried: 0, unreachableUnqueried: 0 })),
    ).not.toContain('past the width');
  });

  it('prints an empty denominator as undefined rather than as a share of zero', () => {
    const text = formatScheduleReading(
      reading({
        unqueriedMisses: 0,
        reachableUnqueried: 0,
        buckets: {
          top5: 0,
          top10: 0,
          top20: 0,
          beyond: 0,
          unreachable: 0,
        },
      }),
    );
    expect(text).toContain('inside the first 10: 0 of 0 (undefined — the denominator is empty)');
  });
});

describe('converting the ceiling by what the arm did when it DID look', () => {
  function reading(over: Partial<ScheduleReading> = {}): ScheduleReading {
    return {
      width: 10,
      cases: 1_422,
      hits: 1_328,
      misses: 94,
      queriedMisses: 20,
      unqueriedMisses: 74,
      unrecordedMisses: 0,
      reachableUnqueried: 40,
      beyondUnqueried: 34,
      unreachableUnqueried: 0,
      hitsQueried: 1_178,
      hitsUnqueried: 150,
      buckets: { top5: 29, top10: 11, top20: 16, beyond: 18, unreachable: 0 },
      ...over,
    };
  }

  it('measures the rate on the investigations that queried the culprit', () => {
    const conversion = conversionOf(reading());
    expect(conversion.queried).toBe(1_198);
    expect(conversion.converted).toBe(1_178);
    expect(conversion.rate).toBeCloseTo(1_178 / 1_198, 10);
  });

  it('multiplies the reachable population by that rate, and keeps it below the ceiling', () => {
    const base = reading();
    const conversion = conversionOf(base);
    expect(conversion.expected).toBeCloseTo(40 * (1_178 / 1_198), 10);
    expect(conversion.expected!).toBeLessThan(base.reachableUnqueried);
  });

  it('returns a null rate when nothing in the artifact queried the culprit', () => {
    const conversion = conversionOf(reading({ hitsQueried: 0, queriedMisses: 0 }));
    expect(conversion).toEqual({ queried: 0, converted: 0, rate: null, expected: null });
  });

  it('prints both numbers, and says which of them is an estimate', () => {
    const base = reading();
    const text = formatConversion(base, conversionOf(base));
    expect(text).toContain('1 178 of 1 198 answered correctly (98.33 %)');
    expect(text).toContain('40 reachable × 98.33 % = 39.33 cases — 2.77 pp, a POINT estimate');
    expect(text).toContain('2.81 pp is the ceiling');
  });

  it('says so when the artifact cannot support a rate at all', () => {
    const base = reading({ hitsQueried: 0, queriedMisses: 0 });
    expect(formatConversion(base, conversionOf(base))).toContain(
      'conversion: undefined — no investigation in this artifact queried the culprit',
    );
  });

  it('says there is nothing to convert when the schedule reaches nothing', () => {
    const base = reading({ reachableUnqueried: 0 });
    expect(formatConversion(base, conversionOf(base))).toContain(
      'nothing is reachable at width 10, so there is nothing to convert',
    );
  });
});
