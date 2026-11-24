import { describe, expect, it } from 'vitest';

import {
  additiveTopOne,
  axisShares,
  conjunctionReading,
  conjunctiveTopOne,
  formatConjunction,
  isRankable,
  MIN_CONJUNCTIVE_GAIN,
  type ConjunctiveCandidate,
  type ConjunctiveCase,
  type TermRow,
} from '../src/conjunctive-score.js';
import { contributionOf } from '../src/term-marginal.js';

const term = (name: string, weight: number | null, value: number | null): TermRow => ({
  name,
  weight,
  value,
});

const candidate = (id: string, terms: readonly TermRow[]): ConjunctiveCandidate => ({
  id,
  score: terms.reduce((total, row) => {
    const contribution = contributionOf(row);
    return contribution === null ? total : total + contribution;
  }, 0),
  terms,
});

const testCase = (
  datapack: string,
  truth: readonly string[],
  candidates: readonly ConjunctiveCandidate[],
): ConjunctiveCase => ({ datapack, truth, candidates });

/**
 * The mechanism CIE's paper describes, in the smallest pool that can carry it.
 *
 * `svc-propagator` is loud externally — the failure it propagates is enormous — and quiet internally. `svc-root`
 * deviates on both axes, less loudly on the external one. The additive score ranks the propagator first, which is the
 * failure mode the conjunction exists to prevent.
 */
const mechanism: readonly ConjunctiveCase[] = [
  testCase(
    'c1',
    ['svc-root'],
    [
      candidate('svc-root', [term('selfAnomalyLog1p', 1, 1), term('rise', 1, 2)]),
      candidate('svc-propagator', [term('selfAnomalyLog1p', 1, 0.05), term('rise', 1, 10)]),
    ],
  ),
];

/** The same two candidates where the root is *also* the loudest on both axes: every mode must keep it. */
const easy: readonly ConjunctiveCase[] = [
  testCase(
    'c1',
    ['svc-root'],
    [
      candidate('svc-root', [term('selfAnomalyLog1p', 1, 3), term('rise', 1, 9)]),
      candidate('svc-propagator', [term('selfAnomalyLog1p', 1, 0.05), term('rise', 1, 1)]),
    ],
  ),
];

describe('the axes', () => {
  it('splits one candidate into what it does to itself and what it is seen to cause', () => {
    const shares = axisShares(
      candidate('svc-root', [
        term('selfAnomalyLog1p', 1, 1),
        term('selfTime', 1, 0.5),
        term('rise', 1, 2),
        term('log', 1, 4),
      ]),
    );
    expect(shares.internal).toBe(1.5);
    expect(shares.external).toBe(2);
    expect(shares.other).toBe(4);
  });

  it('reads a channel the dump did not measure as no contribution rather than as a zero', () => {
    const shares = axisShares(
      candidate('svc-root', [term('selfAnomalyLog1p', 1, 1), term('rise', null, null)]),
    );
    expect(shares.internal).toBe(1);
    expect(shares.external).toBe(0);
  });

  it('refuses to rank a candidate that has only one of the two axes measured', () => {
    // A conjunction over an unmeasured axis is not a conjunction: the candidate would rank last for a missing
    // measurement, which is a statement about the dump and not about the component.
    expect(isRankable(candidate('svc-root', [term('selfAnomalyLog1p', 1, 1)]))).toBe(false);
    expect(
      isRankable(candidate('svc-root', [term('selfAnomalyLog1p', 1, 1), term('rise', 1, 1)])),
    ).toBe(true);
  });
});

describe('the conjunction on the mechanism it was proposed for', () => {
  it('ranks the propagator first additively, which is the failure it exists to prevent', () => {
    expect(additiveTopOne(mechanism[0]!.candidates)).toEqual({ id: 'svc-propagator', tied: false });
  });

  it('ranks the root first under the normalised minimum', () => {
    expect(conjunctiveTopOne(mechanism[0]!.candidates, 'normMin')).toEqual({
      id: 'svc-root',
      tied: false,
    });
  });

  it('ranks the root first under the normalised product', () => {
    expect(conjunctiveTopOne(mechanism[0]!.candidates, 'normProduct')).toEqual({
      id: 'svc-root',
      tied: false,
    });
  });

  it('ranks the root first under the product', () => {
    expect(conjunctiveTopOne(mechanism[0]!.candidates, 'product')).toEqual({
      id: 'svc-root',
      tied: false,
    });
  });

  it('keeps a root that is loudest on both axes', () => {
    for (const mode of ['normMin', 'normProduct', 'product'] as const) {
      expect(conjunctiveTopOne(easy[0]!.candidates, mode)).toEqual({ id: 'svc-root', tied: false });
    }
  });

  it('reads an axis that improved as no deviation rather than as a negative one', () => {
    // `rise` and the pool penalty can both be negative; a component whose own metric improved cannot be a root, and a
    // negative product would otherwise rank it last by magnitude rather than by evidence.
    const improved = [
      testCase(
        'c1',
        ['svc-root'],
        [
          candidate('svc-root', [term('selfAnomalyLog1p', 1, 1), term('rise', 1, -5)]),
          candidate('svc-other', [term('selfAnomalyLog1p', 1, 0.5), term('rise', 1, 0.2)]),
        ],
      ),
    ];
    expect(conjunctiveTopOne(improved[0]!.candidates, 'product')).toEqual({
      id: 'svc-other',
      tied: false,
    });
  });

  it('keeps the pool order on a full tie', () => {
    const tied = [
      candidate('svc-a', [term('selfAnomalyLog1p', 1, 1), term('rise', 1, 1)]),
      candidate('svc-b', [term('selfAnomalyLog1p', 1, 1), term('rise', 1, 1)]),
    ];
    expect(conjunctiveTopOne(tied, 'normMin')).toEqual({ id: 'svc-a', tied: true });
  });

  it('has no top when nothing in the pool carries both axes', () => {
    const nothing = [
      candidate('svc-a', [term('log', 1, 1)]),
      candidate('svc-b', [term('log', 1, 2)]),
    ];
    expect(conjunctiveTopOne(nothing, 'normMin')).toEqual({ id: null, tied: false });
  });
});

describe('the reading', () => {
  it('prints the additive base, all three modes, and refuses the conjunction when it does not pay', () => {
    const reading = conjunctionReading(mechanism);
    expect(reading.cases).toBe(1);
    expect(reading.additive).toBe(0);
    for (const mode of ['normMin', 'normProduct', 'product'] as const) {
      const one = reading.modes.find((entry) => entry.mode === mode)!;
      expect(one.correct).toBe(1);
      expect(one.gain).toBe(1);
    }
    expect(reading.verdict).toBe('candidate');
  });

  it('refuses a conjunction that ties the additive score, because a tie is not a gain', () => {
    const reading = conjunctionReading(easy);
    expect(reading.additive).toBe(1);
    for (const one of reading.modes) expect(one.gain).toBe(0);
    expect(reading.verdict).toBe('refused');
    expect(reading.best!.gain).toBeLessThan(MIN_CONJUNCTIVE_GAIN);
  });

  it('counts the cases where the accepted answer itself has no second axis', () => {
    // A case whose truth lacks an axis is not a case the conjunction lost; it is a case the conjunction never saw.
    const partial = [
      testCase(
        'c1',
        ['svc-root'],
        [
          candidate('svc-root', [term('selfAnomalyLog1p', 1, 1)]),
          candidate('svc-propagator', [term('selfAnomalyLog1p', 1, 0.05), term('rise', 1, 10)]),
        ],
      ),
    ];
    const reading = conjunctionReading(partial);
    expect(reading.truthUnrankable).toBe(1);
    expect(reading.modes.find((one) => one.mode === 'normMin')!.undecided).toBe(0);
  });

  it('counts a case with no rankable candidate as undecided rather than as a miss', () => {
    const blind = [
      testCase(
        'c1',
        ['svc-a'],
        [candidate('svc-a', [term('log', 1, 1)]), candidate('svc-b', [term('log', 1, 2)])],
      ),
    ];
    const reading = conjunctionReading(blind);
    expect(reading.modes.find((one) => one.mode === 'normMin')!.undecided).toBe(1);
    expect(reading.modes.find((one) => one.mode === 'normMin')!.correct).toBe(0);
  });

  it('reports each mode on both folds, so a gain that lives on one half is visible', () => {
    const reading = conjunctionReading([...mechanism, ...easy]);
    const norm = reading.modes.find((one) => one.mode === 'normMin')!;
    expect(norm.folds.length).toBe(2);
    // The mechanism case is index 0 (even fold) and the easy case index 1 (odd fold).
    expect(norm.folds[0]).toEqual({ cases: 1, additive: 0, conjunctive: 1, gain: 1 });
    expect(norm.folds[1]).toEqual({ cases: 1, additive: 1, conjunctive: 1, gain: 0 });
  });

  it('has no best mode on an empty corpus', () => {
    const reading = conjunctionReading([]);
    expect(reading.cases).toBe(0);
    expect(reading.verdict).toBe('refused');
    expect(reading.best).toBeNull();
    expect(formatConjunction(reading)).toContain('(0.00 %)');
  });
});

describe('the printed reading', () => {
  it('prints every mode with its gain and its verdict line', () => {
    const text = formatConjunction(conjunctionReading(mechanism));
    expect(text).toContain('normMin');
    expect(text).toContain('normProduct');
    expect(text).toContain('product');
    expect(text).toContain('candidate');
  });

  it('prints a negative gain without a sign and a positive one with', () => {
    // The additive winner here is loud internally and silent externally, which is exactly the case a minimum
    // punishes: the conjunction loses it. A renderer that prefixed `+` to the loss would hide the whole point.
    const loss = [
      testCase(
        'c1',
        ['svc-a'],
        [
          candidate('svc-a', [term('selfAnomalyLog1p', 1, 10), term('rise', 1, 0.3)]),
          candidate('svc-b', [term('selfAnomalyLog1p', 1, 2.5), term('rise', 1, 2.5)]),
        ],
      ),
    ];
    const reading = conjunctionReading(loss);
    expect(reading.additive).toBe(1);
    expect(reading.modes.find((one) => one.mode === 'normMin')!.gain).toBe(-1);
    const text = formatConjunction(reading);
    expect(text).toMatch(/normMin\s+0 \(0\.00 %\)\s+1\s+-1/);
  });
});

describe('the instruments at their edges', () => {
  it('has no additive top when the pool is empty', () => {
    expect(additiveTopOne([])).toEqual({ id: null, tied: false });
  });

  it('marks two candidates that share the additive score as tied', () => {
    const shared = [
      candidate('svc-a', [term('selfAnomalyLog1p', 1, 1)]),
      candidate('svc-b', [term('selfAnomalyLog1p', 1, 1)]),
    ];
    expect(additiveTopOne(shared)).toEqual({ id: 'svc-a', tied: true });
  });

  it('prints an em dash for a reading that carries no folds', () => {
    // A reading assembled from a single case cannot be split into two halves; the formatter says so rather than
    // printing a fold of zero cases as if it had been measured.
    const reading = conjunctionReading(mechanism);
    const withoutFolds = {
      ...reading,
      modes: reading.modes.map((one) => ({ ...one, folds: [] })),
    };
    expect(formatConjunction(withoutFolds)).toMatch(
      /normMin\s+1 \(100\.00 %\)\s+0\s+\+1\s+0\s+—\s+—/,
    );
  });
});

describe('the axes when a component improves', () => {
  it('normalises a pool whose every internal axis is an improvement', () => {
    // Both candidates improved their own metric — measured, and negative. The pool's largest internal deviation is
    // therefore zero, and the normalised modes must read that as "no internal deviation anywhere" rather than divide
    // by it.
    const improving = [
      testCase(
        'c1',
        ['svc-a'],
        [
          candidate('svc-a', [term('selfAnomalyLog1p', 1, -2), term('rise', 1, 3)]),
          candidate('svc-b', [term('selfAnomalyLog1p', 1, -1), term('rise', 1, 1)]),
        ],
      ),
    ];
    // With the internal axis flat at zero for the whole pool, every key ties and the additive score still separates
    // the two — the honest reading: the conjunction has nothing to say here and does not pretend otherwise.
    expect(conjunctiveTopOne(improving[0]!.candidates, 'normMin')).toEqual({
      id: 'svc-a',
      tied: false,
    });
  });

  it('normalises a pool whose every external axis is an improvement', () => {
    const improving = [
      testCase(
        'c1',
        ['svc-a'],
        [
          candidate('svc-a', [term('selfAnomalyLog1p', 1, 2), term('rise', 1, -3)]),
          candidate('svc-b', [term('selfAnomalyLog1p', 1, 1), term('rise', 1, -1)]),
        ],
      ),
    ];
    // The symmetric case: the external axis is flat, so the additive tie-break prefers the candidate that did not
    // lose three points of downstream rise.
    expect(conjunctiveTopOne(improving[0]!.candidates, 'normMin')).toEqual({
      id: 'svc-b',
      tied: false,
    });
  });
});
