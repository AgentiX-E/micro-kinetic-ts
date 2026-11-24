/**
 * The miss ledger's tests.
 *
 * The ledger makes one claim — *every remaining miss has a named cause and none of them is recoverable by a promotion
 * rule* — and the tests are written to keep the claim falsifiable: the classes are separated at their boundaries, an
 * unmeasured quantity refuses instead of reading as small, and the two refutation sweeps have to report `separates:
 * false` from the data rather than from a constant.
 */

import { describe, expect, it } from 'vitest';

import {
  classOf,
  formatLedger,
  formatPromotion,
  formatStability,
  ledgerOf,
  promotionReadings,
  separationConcentration,
  stabilityReading,
  type LedgerCase,
} from '../src/miss-ledger.js';

/** A case that the pipeline answered correctly, with every optional column unmeasured. */
function ledgerCase(overrides: Partial<LedgerCase> = {}): LedgerCase {
  return {
    datapack: 'c0',
    truth: ['svc-a'],
    published: 'svc-a',
    answeredBy: 'model',
    engineTop1: 'svc-a',
    truthRank: 1,
    margin: null,
    ...overrides,
  };
}

/** Concentrations that a repair can carry, in the order the guard moved them. */
function concentrated(
  margin: number,
  first: Record<string, number>,
  second: Record<string, number>,
) {
  return { margin, top1Terms: first, top2Terms: second };
}

describe('classOf', () => {
  it('calls a correct case a hit before it asks anything else', () => {
    // The truth rank is 1 and the engine agrees, so a reader that classified by rank would also say
    // "engine-was-right"; the hit must win, because a correct case is not a miss of any kind.
    expect(classOf(ledgerCase())).toBe('hit');
  });

  it('calls a miss whose engine led with the truth a precedence failure', () => {
    expect(classOf(ledgerCase({ published: 'svc-b', engineTop1: 'svc-a', truthRank: 1 }))).toBe(
      'engine-was-right',
    );
  });

  it('calls a miss whose truth sat inside the seed a reasoning failure', () => {
    expect(classOf(ledgerCase({ published: 'svc-b', engineTop1: 'svc-c', truthRank: 5 }))).toBe(
      'seen-not-taken',
    );
  });

  it('puts the first rank outside the seed in breadth, not in reasoning', () => {
    // The boundary is the seed width and it must be read on one side only: rank 6 is not shown.
    expect(classOf(ledgerCase({ published: 'svc-b', engineTop1: 'svc-c', truthRank: 6 }))).toBe(
      'breadth',
    );
  });

  it('calls a miss whose truth is not a candidate absent, and never breadth', () => {
    expect(classOf(ledgerCase({ published: 'svc-b', engineTop1: 'svc-c', truthRank: null }))).toBe(
      'absent',
    );
  });

  it('reads rank 1 as precedence even when the engine top is unknown', () => {
    // An older artifact carries no engine top; the rank still says the engine led with the truth, and
    // reporting it as a reasoning failure would send the next iteration at the wrong instrument.
    expect(classOf(ledgerCase({ published: 'svc-b', engineTop1: null, truthRank: 1 }))).toBe(
      'engine-was-right',
    );
  });
});

describe('ledgerOf', () => {
  const corpus: LedgerCase[] = [
    ledgerCase({ datapack: 'hit', truthRank: 1 }),
    ledgerCase({
      datapack: 'prec',
      published: 'svc-b',
      engineTop1: 'svc-a',
      truthRank: 1,
      answeredBy: 'model',
    }),
    ledgerCase({
      datapack: 'seen',
      published: 'svc-b',
      engineTop1: 'svc-c',
      truthRank: 2,
      answeredBy: 'prior',
    }),
    ledgerCase({
      datapack: 'block-prior',
      published: 'svc-b',
      engineTop1: 'svc-c',
      truthRank: 9,
      answeredBy: 'prior',
    }),
    ledgerCase({
      datapack: 'block-model',
      published: 'svc-b',
      engineTop1: 'svc-c',
      truthRank: 22,
      answeredBy: 'model',
    }),
    ledgerCase({
      datapack: 'gone',
      published: 'svc-b',
      engineTop1: 'svc-c',
      truthRank: null,
      answeredBy: 'entry',
    }),
  ];

  it('counts the corpus, the hits and the misses so that they add up', () => {
    const ledger = ledgerOf(corpus);
    expect(ledger.cases).toBe(6);
    expect(ledger.hit).toBe(1);
    expect(ledger.misses).toBe(5);
    const summed = Object.values(ledger.classes).reduce((total, one) => total + one, 0);
    expect(summed).toBe(ledger.misses);
  });

  it('splits the misses into the four causes', () => {
    const ledger = ledgerOf(corpus);
    expect(ledger.classes).toEqual({
      'engine-was-right': 1,
      'seen-not-taken': 1,
      breadth: 2,
      absent: 1,
    });
  });

  it('cross-tabulates every miss with the channel that answered it', () => {
    const ledger = ledgerOf(corpus);
    expect(ledger.byClassAndChannel).toEqual([
      { class: 'engine-was-right', channel: 'model', cases: 1 },
      { class: 'seen-not-taken', channel: 'prior', cases: 1 },
      { class: 'breadth', channel: 'model', cases: 1 },
      { class: 'breadth', channel: 'prior', cases: 1 },
      { class: 'absent', channel: 'entry', cases: 1 },
    ]);
  });

  it('counts the breadth cases that no seed widening can reach', () => {
    // A case the model never answered cannot be repaired by showing the model more candidates: the
    // widening would pay tokens for a row whose answer was settled by a channel that does not read
    // the seed at all. One of the two breadth rows here was answered by `prior`.
    expect(ledgerOf(corpus).unwidenable).toBe(1);
  });

  it('orders the cross-tab so that two runs on one artifact agree', () => {
    const forward = ledgerOf(corpus).byClassAndChannel;
    const backward = ledgerOf([...corpus].reverse()).byClassAndChannel;
    expect(backward).toEqual(forward);
  });

  it('refuses an empty corpus rather than dividing by it', () => {
    const ledger = ledgerOf([]);
    expect(ledger.cases).toBe(0);
    expect(ledger.misses).toBe(0);
    expect(ledger.byClassAndChannel).toEqual([]);
  });
});

describe('promotionReadings', () => {
  const corpus: LedgerCase[] = [
    // The model agreed with the engine and the pipeline moved away: the promotion repairs it.
    ledgerCase({
      datapack: 'repair',
      truth: ['svc-a'],
      published: 'svc-b',
      engineTop1: 'svc-a',
      truthRank: 1,
      answeredBy: 'model',
      rawNames: ['svc-a'],
    }),
    // The model agreed with the engine and the pipeline was right to move: the promotion breaks it.
    ledgerCase({
      datapack: 'break',
      truth: ['svc-b'],
      published: 'svc-b',
      engineTop1: 'svc-a',
      truthRank: 7,
      answeredBy: 'interface',
      rawNames: ['svc-a'],
    }),
    // The pipeline already published the engine's own top: nothing to promote.
    ledgerCase({ datapack: 'agreed', truth: ['svc-a'], published: 'svc-a', engineTop1: 'svc-a' }),
    // The model answered something the engine did not lead with, and the engine was wrong.
    ledgerCase({
      datapack: 'model-off',
      truth: ['svc-c'],
      published: 'svc-c',
      engineTop1: 'svc-a',
      truthRank: 3,
      answeredBy: 'model',
      rawNames: ['svc-c'],
    }),
  ];

  it('reads each rule as fires, repairs, breaks and precision', () => {
    const readings = promotionReadings(corpus);
    const byName = new Map(readings.map((one) => [one.rule, one]));
    expect(byName.get('model-agrees-with-engine')).toEqual({
      rule: 'model-agrees-with-engine',
      fires: 2,
      repairs: 1,
      breaks: 1,
      precision: 0.5,
    });
    expect(byName.get('engine-over-any')).toEqual({
      rule: 'engine-over-any',
      fires: 3,
      repairs: 1,
      breaks: 2,
      precision: 1 / 3,
    });
  });

  it('scopes the model rule to the cases the model actually answered', () => {
    const readings = promotionReadings(corpus);
    const scoped = readings.find((one) => one.rule === 'engine-over-model');
    expect(scoped?.fires).toBe(2);
    expect(scoped?.repairs).toBe(1);
    expect(scoped?.breaks).toBe(1);
  });

  it('refuses a ratio rule on a case whose anomaly was never measured', () => {
    // `null / number` is not a small ratio: an unmeasured self-anomaly is an absence, and a rule that
    // read it as zero would fire on every row of an artifact that predates the column.
    const readings = promotionReadings([
      ledgerCase({ datapack: 'unmeasured', published: 'svc-b', engineTop1: 'svc-a', truthRank: 9 }),
    ]);
    const quiet = readings.find((one) => one.rule === 'engine-over-quiet-answer');
    expect(quiet?.fires).toBe(0);
    expect(quiet?.precision).toBeNull();
  });

  it('fires the ratio rule only below its floor', () => {
    const readings = promotionReadings([
      ledgerCase({
        datapack: 'quiet',
        truth: ['svc-a'],
        published: 'svc-b',
        engineTop1: 'svc-a',
        truthRank: 1,
        answerAnomaly: 0.1,
        engineAnomaly: 5,
      }),
      ledgerCase({
        datapack: 'loud',
        truth: ['svc-b'],
        published: 'svc-b',
        engineTop1: 'svc-a',
        truthRank: 9,
        answerAnomaly: 4.9,
        engineAnomaly: 5,
      }),
    ]);
    const quiet = readings.find((one) => one.rule === 'engine-over-quiet-answer');
    expect(quiet).toEqual({
      rule: 'engine-over-quiet-answer',
      fires: 1,
      repairs: 1,
      breaks: 0,
      precision: 1,
    });
  });

  it('reports a null precision when a rule never fires, rather than 0 or 1', () => {
    const readings = promotionReadings([ledgerCase()]);
    for (const one of readings) {
      expect(one.fires).toBe(0);
      expect(one.precision).toBeNull();
    }
  });

  it('names every rule it prices, in a fixed order', () => {
    expect(promotionReadings([]).map((one) => one.rule)).toEqual([
      'model-agrees-with-engine',
      'engine-over-model',
      'engine-over-any',
      'engine-over-quiet-answer',
    ]);
  });
});

describe('stabilityReading', () => {
  const corpus: LedgerCase[] = [
    // A repair whose margin rests almost entirely on one term: concentration above one.
    ledgerCase({
      datapack: 'repair-concentrated',
      truth: ['svc-a'],
      published: 'svc-b',
      engineTop1: 'svc-a',
      truthRank: 1,
      ...concentrated(4.0, { selfAnomalyLog1p: 3.98, stability: 0.02 }, { selfAnomalyLog1p: 0.0 }),
    }),
    // A break that is just as concentrated: no floor can separate the two populations.
    ledgerCase({
      datapack: 'break-concentrated',
      truth: ['svc-b'],
      published: 'svc-b',
      engineTop1: 'svc-a',
      truthRank: 9,
      ...concentrated(0.6, { selfAnomalyLog1p: 0.62 }, { selfAnomalyLog1p: 0.0 }),
    }),
  ];

  it('reports the concentration spread of the repairs and the breaks separately', () => {
    const reading = stabilityReading(corpus, 0.5);
    expect(reading.repairs).toEqual({ measured: 1, min: 0.995, median: 0.995, max: 0.995 });
    expect(reading.breaks).toEqual({ measured: 1, min: 1.033, median: 1.033, max: 1.033 });
  });

  it('refuses to separate two populations whose intervals overlap', () => {
    // One repair inside the breaks' own interval: no floor keeps it and drops them, in either
    // direction. This is the shape the corpus actually has, and the reading must say so.
    const reading = stabilityReading(
      [
        ledgerCase({
          datapack: 'inside',
          truth: ['svc-a'],
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 1,
          ...concentrated(4.0, { a: 3.98 }, { a: 0 }),
        }),
        ledgerCase({
          datapack: 'below',
          truth: ['svc-b'],
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 9,
          ...concentrated(0.6, { a: 0.54 }, { a: 0 }),
        }),
        ledgerCase({
          datapack: 'above',
          truth: ['svc-b'],
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 9,
          ...concentrated(0.6, { a: 0.72 }, { a: 0 }),
        }),
      ],
      0.5,
    );
    expect(reading.repairs).toEqual({ measured: 1, min: 0.995, median: 0.995, max: 0.995 });
    expect(reading.breaks).toEqual({ measured: 2, min: 0.9, median: 1.05, max: 1.2 });
    expect(reading.separates).toBe(false);
  });

  it('separates them when every repair is outside the breaks interval', () => {
    const reading = stabilityReading(
      [
        ledgerCase({
          datapack: 'wide',
          truth: ['svc-a'],
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 1,
          ...concentrated(4.0, { a: 2.0, b: 2.0 }, { a: 0, b: 0 }),
        }),
        ledgerCase({
          datapack: 'thin',
          truth: ['svc-b'],
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 9,
          ...concentrated(1.0, { a: 1.9 }, { a: 0 }),
        }),
      ],
      0.5,
    );
    expect(reading.repairs.max).toBeLessThan(reading.breaks.min!);
    expect(reading.separates).toBe(true);
  });

  it('counts only the cases the guard would move at the bar', () => {
    // The margin is unmeasured on this row, so the guard cannot fire and the row is not a repair, a
    // break, or a concentration.
    const reading = stabilityReading(
      [ledgerCase({ published: 'svc-b', engineTop1: 'svc-a', truthRank: 1 })],
      0.5,
    );
    expect(reading.repairs.measured).toBe(0);
    expect(reading.breaks.measured).toBe(0);
    expect(reading.separates).toBe(false);
  });

  it('refuses a NaN margin as an unmeasured one', () => {
    const reading = stabilityReading(
      [
        ledgerCase({
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 1,
          margin: Number.NaN,
        }),
      ],
      0.5,
    );
    expect(reading.repairs.measured).toBe(0);
  });

  it('refuses a zero margin as a concentration rather than dividing by it', () => {
    const reading = stabilityReading(
      [
        ledgerCase({
          truth: ['svc-a'],
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 1,
          margin: 0,
          top1Terms: { a: 1 },
          top2Terms: { a: 0 },
        }),
      ],
      0.5,
    );
    // The margin is not above the bar, so the case is not moved at all; the assertion that matters is
    // that nothing threw and no infinite concentration was recorded.
    expect(reading.repairs).toEqual({ measured: 0, min: null, median: null, max: null });
  });

  it('reports the fired population and its repair share', () => {
    const reading = stabilityReading(corpus, 0.5);
    expect(reading.fired).toBe(2);
    expect(reading.repairs.measured + reading.breaks.measured).toBe(2);
  });
});

describe('formatters', () => {
  const corpus: LedgerCase[] = [
    ledgerCase({ datapack: 'hit' }),
    ledgerCase({
      datapack: 'prec',
      published: 'svc-b',
      engineTop1: 'svc-a',
      truthRank: 1,
      answeredBy: 'model',
    }),
    ledgerCase({
      datapack: 'block',
      published: 'svc-b',
      engineTop1: 'svc-c',
      truthRank: 30,
      answeredBy: 'prior',
    }),
  ];

  it('prints the corpus, the misses and every class it counted', () => {
    const text = formatLedger(ledgerOf(corpus));
    expect(text).toContain('3 cases');
    expect(text).toContain('2 misses');
    expect(text).toContain('engine-was-right');
    expect(text).toContain('breadth');
  });

  it('prints the unwidenable count, which is the sentence the next plan reads', () => {
    expect(formatLedger(ledgerOf(corpus))).toContain('unwidenable 1');
  });

  it('prints a promotion reading with its precision', () => {
    const text = formatPromotion(promotionReadings(corpus));
    expect(text).toContain('engine-over-any');
    expect(text).toContain('1.000');
  });

  it('prints the stability reading and says whether it separates', () => {
    const text = formatStability(
      stabilityReading(
        [ledgerCase({ published: 'svc-b', engineTop1: 'svc-a', truthRank: 1 })],
        0.5,
      ),
    );
    expect(text).toContain('separates false');
  });
});

describe('the ledger at its edges', () => {
  it('accumulates two misses that share a class and a channel', () => {
    // A cross-tab whose rows never accumulate is a listing, not a tabulation: the same class settled by
    // the same channel has to arrive as one row with a count of two.
    const ledger = ledgerOf([
      ledgerCase({
        datapack: 'a',
        published: 'svc-b',
        engineTop1: 'svc-c',
        truthRank: 12,
        answeredBy: 'prior',
      }),
      ledgerCase({
        datapack: 'b',
        published: 'svc-b',
        engineTop1: 'svc-c',
        truthRank: 30,
        answeredBy: 'prior',
      }),
    ]);
    expect(ledger.byClassAndChannel).toEqual([{ class: 'breadth', channel: 'prior', cases: 2 }]);
    expect(ledger.unwidenable).toBe(2);
  });

  it('treats a case with no published answer as a miss rather than as a hit', () => {
    const ledger = ledgerOf([ledgerCase({ published: null, truthRank: null })]);
    expect(ledger.hit).toBe(0);
    expect(ledger.classes.absent).toBe(1);
  });

  it('takes the median of an even population as the mean of its middle two', () => {
    const reading = stabilityReading(
      [
        ledgerCase({
          datapack: 'half',
          truth: ['svc-a'],
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 1,
          ...concentrated(4.0, { a: 2.0 }, { a: 0 }),
        }),
        ledgerCase({
          datapack: 'whole',
          truth: ['svc-a'],
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 1,
          ...concentrated(1.0, { a: 1.0 }, { a: 0 }),
        }),
      ],
      0.5,
    );
    expect(reading.repairs).toEqual({ measured: 2, min: 0.5, median: 0.75, max: 1 });
  });

  it('reads a term one side does not carry as a zero contribution', () => {
    // The score is a sum over the terms a candidate HAS; a term it does not carry contributed nothing to
    // its score, so the difference is the other side's contribution and not a missing measurement.
    const share = separationConcentration(
      ledgerCase({
        margin: 4,
        top1Terms: { a: 1 },
        top2Terms: { b: 2 },
      }),
    );
    expect(share).toBe(0.5);
  });

  it('refuses a concentration on a case that carries no terms at all', () => {
    expect(
      separationConcentration(ledgerCase({ margin: 4, top1Terms: {}, top2Terms: {} })),
    ).toBeNull();
  });

  it('refuses a concentration whose margin is not a finite number', () => {
    expect(
      separationConcentration(
        ledgerCase({ margin: Number.POSITIVE_INFINITY, top1Terms: { a: 1 }, top2Terms: { a: 0 } }),
      ),
    ).toBeNull();
  });

  it('refuses the quiet-answer rule when the engine showed no anomaly to be quiet against', () => {
    const readings = promotionReadings([
      ledgerCase({
        published: 'svc-b',
        engineTop1: 'svc-a',
        truthRank: 9,
        answerAnomaly: 0.1,
        engineAnomaly: 0,
      }),
    ]);
    expect(readings.find((one) => one.rule === 'engine-over-quiet-answer')).toEqual({
      rule: 'engine-over-quiet-answer',
      fires: 0,
      repairs: 0,
      breaks: 0,
      precision: null,
    });
  });

  it('refuses a case with no engine top from every promotion rule', () => {
    const readings = promotionReadings([
      ledgerCase({ published: 'svc-b', engineTop1: null, truthRank: 4, answeredBy: 'model' }),
    ]);
    for (const one of readings) expect(one.fires).toBe(0);
  });
});

describe('the empty corpus', () => {
  it('prints a zero share rather than dividing by zero cases', () => {
    const text = formatLedger(ledgerOf([]));
    expect(text).toContain('0 cases');
    expect(text).toContain('(0.00 %)');
  });
});

describe('the readings a plan reads before it spends money', () => {
  it('refuses a concentration when the term dump was not joined', () => {
    // An artifact without the dump is not a case with zero concentration: it is a case whose separation
    // was never decomposed, and a zero would enter the spread as the best-behaved repair on record.
    expect(separationConcentration(ledgerCase({ margin: 4 }))).toBeNull();
  });

  it('does not move a case whose pipeline already published the engine top', () => {
    const reading = stabilityReading(
      [
        ledgerCase({
          truth: ['svc-a'],
          published: 'svc-a',
          engineTop1: 'svc-a',
          truthRank: 1,
          ...concentrated(4.0, { a: 3.98 }, { a: 0 }),
        }),
      ],
      0.5,
    );
    expect(reading.fired).toBe(0);
  });

  it('marks a positive delta with a sign, so a loss and a gain cannot be read alike', () => {
    const text = formatPromotion(
      promotionReadings([
        ledgerCase({
          datapack: 'gain',
          truth: ['svc-a'],
          published: 'svc-b',
          engineTop1: 'svc-a',
          truthRank: 1,
          answeredBy: 'model',
          rawNames: ['svc-a'],
        }),
      ]),
    );
    expect(text).toContain('+1');
  });

  it('prints an em dash for a population with nothing measured in it', () => {
    const text = formatStability(
      stabilityReading(
        [
          ledgerCase({
            truth: ['svc-a'],
            published: 'svc-b',
            engineTop1: 'svc-a',
            truthRank: 1,
            ...concentrated(4.0, { a: 3.98 }, { a: 0 }),
          }),
        ],
        0.5,
      ),
    );
    expect(text).toContain('—');
  });
});
