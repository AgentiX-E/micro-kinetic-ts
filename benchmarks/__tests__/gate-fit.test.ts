import type { ReachCase } from '../src/gate-fit.js';
import {
  DEFAULT_GATE_FIT,
  countUnder,
  familySizes,
  fitUnderGate,
  formatGateFit,
  formatGateReading,
  fragileMask,
  gateMask,
  gateReading,
  gateViolations,
  parseGateArgs,
  readUnder,
} from '../src/gate-fit.js';

const NAMES = ['p', 'q', 'r'] as const;

function kase(
  datapack: string,
  faultType: string,
  accepted: readonly string[],
  ids: readonly string[],
  vectors: readonly (readonly number[])[],
): ReachCase {
  return {
    datapack,
    faultType,
    accepted: new Set(accepted),
    ids,
    names: NAMES,
    vectors: vectors.map((vector) => Float64Array.from(vector)),
  };
}

const direction = (p: number, q: number, r: number): Float64Array => Float64Array.from([p, q, r]);

/** The shipped weights of every fixture: `p` pays 1, `q` pays 0.5, `r` pays nothing. */
const START = { p: 1, q: 0.5, r: 0 } as const;

/**
 * Five cases, in the shape the gate is stated on.
 *
 * `keep/answered` and `keep/missed` are one family above the floor of 2; the three below are one family of three,
 * which the tests move above and below the floor to read both verdicts. Between them they carry every reading the
 * module distinguishes: a strict answer, a tie, a strict miss, a tie the optimistic rule also refuses because the
 * earlier candidate is not the answer, and a case whose accepted answer the ranking never listed.
 */
const CORPUS: readonly ReachCase[] = [
  kase(
    'keep/answered',
    'keep',
    ['k'],
    ['k', 'm'],
    [
      [1, 0, 0],
      [0, 1, 0],
    ],
  ),
  kase(
    'keep/missed',
    'keep',
    ['g'],
    ['h', 'g'],
    [
      [1, 0, 0],
      [1, 0, 4],
    ],
  ),
  kase(
    'below/tie',
    'below',
    ['t'],
    ['v', 't'],
    [
      [1, 0, 0],
      [1, 0, 0],
    ],
  ),
  kase(
    'below/lost',
    'below',
    ['y'],
    ['x', 'y'],
    [
      [3, 0, 0],
      [0, 1, 0],
    ],
  ),
  kase('below/none', 'below', ['zzz'], ['p1'], [[0, 0, 0]]),
];

/** A case whose ranking carries no competitor at all, which is a different failure from a miss. */
const ALONE = kase('alone', 'alone', ['o'], ['o'], [[1, 0, 0]]);

const FLOOR = 2;

describe('readUnder', () => {
  it('answers a case whose accepted candidate strictly leads', () => {
    const reading = readUnder(CORPUS[0]!, direction(1, 0.5, 0));
    expect(reading.answers).toBe(true);
    expect(reading.optimistic).toBe(true);
    expect(reading.accepted).toBe(0);
    expect(reading.competitor).toBe(1);
    expect(reading.gap).toBeCloseTo(0.5, 12);
  });

  it('does not answer a tie, and reports the gap as zero rather than as a loss', () => {
    const reading = readUnder(CORPUS[1]!, direction(1, 0.5, 0));
    expect(reading.answers).toBe(false);
    expect(reading.gap).toBe(0);
  });

  it('reports how far short a strict miss fell', () => {
    const reading = readUnder(CORPUS[3]!, direction(1, 0.5, 0));
    expect(reading.answers).toBe(false);
    expect(reading.optimistic).toBe(false);
    expect(reading.gap).toBeCloseTo(-2.5, 12);
  });

  it('reads a tie the optimistic rule also refuses, because the earlier candidate is not the answer', () => {
    const reading = readUnder(CORPUS[2]!, direction(1, 1, 0));
    expect(reading.answers).toBe(false);
    expect(reading.optimistic).toBe(false);
    expect(reading.gap).toBe(0);
  });

  it('treats a ranking with no competitor as an answer of infinite margin', () => {
    const reading = readUnder(ALONE, direction(1, 0, 0));
    expect(reading.answers).toBe(true);
    expect(reading.competitor).toBe(-1);
    expect(reading.gap).toBe(Infinity);
  });

  it('refuses an answer the ranking never listed, without blaming the weights for it', () => {
    const reading = readUnder(CORPUS[4]!, direction(1, 1, 1));
    expect(reading.answers).toBe(false);
    expect(reading.accepted).toBe(-1);
    expect(reading.gap).toBe(-Infinity);
    expect(reading.optimistic).toBe(false);
  });

  it('separates the two readings of the zero vector, which is the whole reason both are reported', () => {
    const zero = direction(0, 0, 0);
    // Every candidate ties, so nothing is answered strictly...
    const readings = CORPUS.map((entry) => readUnder(entry, zero));
    expect(readings.filter((reading) => reading.answers)).toHaveLength(0);
    // ...while the optimistic rule hands the first candidate of the dump's order the case, which is the recorded
    // answer. That is how the zero vector reproduces a published run without doing anything.
    expect(readings.filter((reading) => reading.optimistic)).toHaveLength(1);
  });
});

describe('countUnder', () => {
  it('counts both readings over the corpus', () => {
    expect(countUnder(CORPUS, direction(1, 0.5, 0))).toEqual({ answers: 1, optimistic: 1 });
    expect(countUnder(CORPUS, direction(0, 0, 0))).toEqual({ answers: 0, optimistic: 1 });
  });

  it('counts nothing on an empty corpus', () => {
    expect(countUnder([], direction(1, 1, 1))).toEqual({ answers: 0, optimistic: 0 });
  });
});

describe('the readings a tie-break and an equal-size pair leave behind', () => {
  it('keeps the earlier candidate on a level score, for both the accepted and the rejected side', () => {
    // Two rejected candidates that score the same: the second must not replace the first, or the competitor the
    // fit is handed would depend on the tail of the ranking rather than on its head.
    const flat = kase(
      'flat',
      'flat',
      ['yes'],
      ['no1', 'no2', 'yes'],
      [
        [2, 0],
        [2, 0],
        [0, 1],
      ],
    );
    const reading = readUnder(flat, direction(1, 0));
    expect(reading.competitor).toBe(0);
    expect(reading.accepted).toBe(2);
    expect(reading.gap).toBe(-2);
  });

  it('orders two families of equal size by name, so two runs print the same table', () => {
    const pair = [
      kase('z/one', 'z', ['a'], ['a'], [[1, 0]]),
      kase('a/one', 'a', ['b'], ['b'], [[1, 0]]),
    ];
    const baseline = pair.map((entry) => readUnder(entry, direction(1, 0)));
    const reading = gateReading(pair, baseline, direction(1, 0), 1);
    expect(reading.families.map((family) => family.faultType)).toEqual(['a', 'z']);
  });
});

describe('familySizes', () => {
  it('counts one population per fault type', () => {
    const sizes = familySizes(CORPUS);
    expect(sizes.get('keep')).toBe(2);
    expect(sizes.get('below')).toBe(3);
  });
});

describe('gateMask', () => {
  it('protects only the cases the baseline answers in a family at or above the floor', () => {
    const baseline = CORPUS.map((entry) => readUnder(entry, direction(1, 0.5, 0)));
    const gate = gateMask(CORPUS, baseline, FLOOR);
    expect(gate).toEqual([true, false, false, false, false]);
  });

  it('protects a one-case family once the floor admits it, and refuses to at a floor above its size', () => {
    const solo = [ALONE];
    const baseline = solo.map((entry) => readUnder(entry, direction(1, 0, 0)));
    expect(gateMask(solo, baseline, 1)).toEqual([true]);
    expect(gateMask(solo, baseline, 2)).toEqual([false]);
  });
});

describe('gateReading', () => {
  const baseline = CORPUS.map((entry) => readUnder(entry, direction(1, 0.5, 0)));
  const reading = gateReading(CORPUS, baseline, direction(1, 0.5, 0), FLOOR);

  it('reproduces its own baseline with no loss', () => {
    expect(reading.answers).toBe(1);
    expect(reading.gateLost).toBe(0);
    expect(reading.familiesLost).toBe(0);
    expect(reading.cases).toBe(5);
  });

  it('names the family a vector cost a case to, above the floor only', () => {
    const lost = gateReading(CORPUS, baseline, direction(1, 3, 0), FLOOR);
    // `q` up to 3 makes `m` beat `k`: the protected case goes.
    const keep = lost.families.find((family) => family.faultType === 'keep')!;
    expect(keep.before).toBe(1);
    expect(keep.after).toBe(0);
    expect(keep.lost).toEqual(['keep/answered']);
    expect(keep.aboveFloor).toBe(true);
    expect(lost.gateLost).toBe(1);
    expect(lost.familiesLost).toBe(1);
  });

  it('reports a below-floor family loss without turning it into a verdict', () => {
    // Lifting `r` answers the missed case and nothing else; the below-floor families are untouched, so a corpus
    // where only a small family loses has to report the loss and a zero gate verdict.
    const small = gateReading(CORPUS, baseline, direction(1, 0.5, 1), 5);
    expect(small.gateLost).toBe(0);
    const below = small.families.find((family) => family.faultType === 'below')!;
    expect(below.aboveFloor).toBe(false);
  });

  it('orders the families by size and then by name', () => {
    const families = reading.families.map((family) => family.faultType);
    expect(families).toEqual(['below', 'keep']);
  });
});

describe('gateViolations', () => {
  const baseline = CORPUS.map((entry) => readUnder(entry, direction(1, 0.5, 0)));
  const gate = gateMask(CORPUS, baseline, FLOOR);
  const all = CORPUS.map(() => true);

  it('counts a protected case the vector lost', () => {
    expect(gateViolations(CORPUS, gate, direction(1, 3, 0), all)).toBe(1);
  });

  it('ignores a case outside the subset, which is how a half-corpus fit stays inside its half', () => {
    const subset = CORPUS.map((_, index) => index !== 0);
    expect(gateViolations(CORPUS, gate, direction(1, 3, 0), subset)).toBe(0);
  });

  it('ignores a case the gate never protected', () => {
    const none = CORPUS.map(() => false);
    expect(gateViolations(CORPUS, none, direction(1, 3, 0), all)).toBe(0);
  });
});

describe('fragileMask', () => {
  const baseline = CORPUS.map((entry) => readUnder(entry, direction(1, 0.5, 0)));
  const gate = gateMask(CORPUS, baseline, FLOOR);
  const all = CORPUS.map(() => true);

  it('admits a protected case whose gap is inside the bound', () => {
    expect(fragileMask(CORPUS, gate, all, direction(1, 0.5, 0), 1)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('skips a protected case a step of that bound provably cannot take away', () => {
    expect(fragileMask(CORPUS, gate, all, direction(1, 0.5, 0), 0.25)[0]).toBe(false);
  });

  it('skips cases that do not currently hold an answer, and cases outside the subset', () => {
    const none = CORPUS.map(() => false);
    expect(fragileMask(CORPUS, gate, none, direction(1, 0.5, 0), 10)).toEqual(none);
    // `below/tie` does not answer, so it is not something a step can take away even with an infinite bound.
    expect(fragileMask(CORPUS, gate, all, direction(1, 1, 0), 10).slice(2)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('fitUnderGate', () => {
  it('returns the start when there are no epochs to move through', () => {
    const report = fitUnderGate(CORPUS, START, NAMES, {
      ...DEFAULT_GATE_FIT,
      epochs: 0,
      familyFloor: FLOOR,
    });
    expect(report.applied).toBe(0);
    expect(report.refused).toBe(0);
    expect(report.weights).toEqual({ p: 1, q: 0.5, r: 0 });
    expect(report.train).toEqual({ cases: 5, baseline: 1, after: 1, gateLost: 0 });
    expect(report.held).toEqual({ cases: 0, baseline: 0, after: 0, gateLost: 0 });
  });

  it('promotes a missed case along a term the protected case does not read', () => {
    const report = fitUnderGate(CORPUS, START, NAMES, {
      ...DEFAULT_GATE_FIT,
      epochs: 3,
      familyFloor: FLOOR,
    });
    expect(report.applied).toBeGreaterThan(0);
    expect(report.refused).toBe(0);
    expect(report.weights.r).toBeGreaterThan(0);
    expect(report.train.after).toBeGreaterThan(report.train.baseline);
    expect(report.train.gateLost).toBe(0);
  });

  it('refuses a promotion that would take a protected case away', () => {
    // `q` is the term that separates `keep/answered` from its competitor, so a corpus whose only miss needs `q`
    // cannot be promoted at all: the first step breaks the gate and is rolled back.
    const corpus = [
      kase(
        'keep/answered',
        'keep',
        ['k'],
        ['k', 'm'],
        [
          [1, 0, 0],
          [0, 1, 0],
        ],
      ),
      kase(
        'keep/missed',
        'keep',
        ['g'],
        ['h', 'g'],
        [
          [1, 0, 0],
          [0, 1, 0],
        ],
      ),
      kase(
        'keep/three',
        'keep',
        ['s'],
        ['s', 'u'],
        [
          [1, 0, 0],
          [0, 1, 0],
        ],
      ),
    ];
    const report = fitUnderGate(corpus, START, NAMES, {
      ...DEFAULT_GATE_FIT,
      epochs: 2,
      familyFloor: FLOOR,
      learningRate: 0.5,
    });
    expect(report.refused).toBeGreaterThan(0);
    expect(report.train.gateLost).toBe(0);
    expect(report.train.after).toBe(report.train.baseline);
  });

  it('keeps its own half and reads the other one, which is the only number about the corpus', () => {
    const even = fitUnderGate(CORPUS, START, NAMES, {
      ...DEFAULT_GATE_FIT,
      epochs: 3,
      familyFloor: FLOOR,
      orientation: 0,
    });
    const odd = fitUnderGate(CORPUS, START, NAMES, {
      ...DEFAULT_GATE_FIT,
      epochs: 3,
      familyFloor: FLOOR,
      orientation: 1,
    });
    expect(even.train.cases).toBe(3);
    expect(even.held.cases).toBe(2);
    expect(odd.train.cases).toBe(2);
    expect(odd.held.cases).toBe(3);
    // The two halves partition the corpus, so their baselines sum to the corpus baseline.
    expect(even.train.baseline + even.held.baseline).toBe(1);
  });

  it('reads a name the baseline does not carry as a zero, not as a missing term', () => {
    const report = fitUnderGate(CORPUS, { p: 1, q: 0.5 }, NAMES, {
      ...DEFAULT_GATE_FIT,
      epochs: 0,
      familyFloor: FLOOR,
    });
    expect(report.weights.r).toBe(0);
    expect(report.train.baseline).toBe(1);
  });

  it('is reproducible from its seed', () => {
    const options = { ...DEFAULT_GATE_FIT, epochs: 3, familyFloor: FLOOR, seed: 7 };
    expect(fitUnderGate(CORPUS, START, NAMES, options).weights).toEqual(
      fitUnderGate(CORPUS, START, NAMES, options).weights,
    );
  });
});

describe('formatGateReading', () => {
  it('prints the population, the verdict and the families with the below-floor marker', () => {
    const baseline = CORPUS.map((entry) => readUnder(entry, direction(1, 0.5, 0)));
    // A floor of 3 puts `keep` (2 cases) below it, which is what the marker has to say out loud.
    const text = formatGateReading(gateReading(CORPUS, baseline, direction(1, 0.5, 0), 3));
    expect(text).toContain('cases 5   answers 1   optimistic 1');
    expect(text).toContain('gate: 0 case(s) lost, 0 famil(ies) above the floor affected');
    expect(text).toContain('below');
    expect(text).toContain('(below floor)');
    expect(text.split('\n')[2]).toContain('faultType');
  });
});

describe('formatGateFit', () => {
  it('prints both halves and the move counts', () => {
    const text = formatGateFit({
      weights: { p: 1, q: 0.5, r: 0 },
      train: { cases: 5, baseline: 2, after: 3, gateLost: 0 },
      held: { cases: 0, baseline: 0, after: 0, gateLost: 0 },
      applied: 4,
      refused: 1,
    });
    expect(text).toContain('train');
    expect(text).toContain('vs baseline +1');
    expect(text).toContain('moves: 4 applied, 1 refused');
    expect(text).toContain('gate lost 0');
  });

  it('writes a fall as a sign, not as a bare number', () => {
    const text = formatGateFit({
      weights: { p: 1, q: 0.5, r: 0 },
      train: { cases: 5, baseline: 3, after: 2, gateLost: 1 },
      held: { cases: 5, baseline: 3, after: 3, gateLost: 0 },
      applied: 0,
      refused: 2,
    });
    expect(text).toContain('vs baseline -1');
    expect(text).toContain('vs baseline +0');
  });
});

describe('parseGateArgs', () => {
  it('reads every flag', () => {
    expect(
      parseGateArgs([
        '--terms',
        'a.ndjson',
        '--fit',
        '--epochs',
        '7',
        '--seed',
        '3',
        '--orientation',
        '1',
        '--floor',
        '20',
      ]),
    ).toEqual({
      terms: 'a.ndjson',
      fit: true,
      epochs: 7,
      seed: 3,
      orientation: 1,
      familyFloor: 20,
    });
  });

  it('defaults everything but the dump', () => {
    expect(parseGateArgs(['--terms', 'a.ndjson'])).toEqual({
      terms: 'a.ndjson',
      fit: false,
      epochs: DEFAULT_GATE_FIT.epochs,
      seed: DEFAULT_GATE_FIT.seed,
      orientation: DEFAULT_GATE_FIT.orientation,
      familyFloor: DEFAULT_GATE_FIT.familyFloor,
    });
  });

  it('refuses a missing dump, an unknown flag, a non-number and an orientation it cannot read', () => {
    expect(() => parseGateArgs([])).toThrow('--terms is required');
    expect(() => parseGateArgs(['--terms'])).toThrow('--terms expects a dump path');
    expect(() => parseGateArgs(['--nope'])).toThrow('unknown argument: --nope');
    expect(() => parseGateArgs(['--terms', 'a', '--epochs'])).toThrow('--epochs expects a number');
    expect(() => parseGateArgs(['--terms', 'a', '--seed', 'x'])).toThrow('--seed expects a number');
    expect(() => parseGateArgs(['--terms', 'a', '--floor', 'y'])).toThrow(
      '--floor expects a number',
    );
    expect(() => parseGateArgs(['--terms', 'a', '--orientation', '2'])).toThrow(
      '--orientation expects -1, 0 or 1',
    );
  });

  it('accepts all three orientations', () => {
    for (const orientation of [-1, 0, 1]) {
      expect(
        parseGateArgs(['--terms', 'a', '--orientation', String(orientation)]).orientation,
      ).toBe(orientation);
    }
  });
});
