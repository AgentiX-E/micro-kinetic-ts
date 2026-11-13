/**
 * The recorded-weight census and the conditional-term ablation.
 *
 * The fixtures are built from the mechanism rather than from round numbers: a case's candidates agree about the
 * coefficient of a gated name (one coefficient applies to a whole case), a refused case records 0 and keeps the
 * baseline ranking, and the scores are the sums the dump would have written — so the residual check has something
 * true to accept and something false to reject.
 */

import type { WeightCensus } from '../src/conditional-weight.js';
import {
  SCORE_TOLERANCE,
  ablateTerm,
  formatAblation,
  formatCensus,
  weightCensusOf,
} from '../src/conditional-weight.js';
import type { ParsedTermCandidate, ParsedTermCase, TermDumpTriple } from '../src/terms-dump.js';

const GATED = 'term';

/** One candidate, with its score derived from its own triples unless a caller pins one. */
function candidate(
  id: string,
  terms: readonly TermDumpTriple[],
  score?: number,
): ParsedTermCandidate {
  if (score !== undefined) return { id, score, terms };
  let total = 0;
  for (const [, weight, slope] of terms) {
    if (weight === null || slope === null) continue;
    total += weight * slope;
  }
  return { id, score: total, terms };
}

/** One case. */
function kase(
  datapack: string,
  faultType: string,
  accepted: readonly string[],
  candidates: readonly ParsedTermCandidate[],
): ParsedTermCase {
  return { datapack, faultType, accepted, candidates };
}

/**
 * Six cases that between them take every path the ledger distinguishes.
 *
 * | case | coefficient | off | on   | what the gate did |
 * |------|-------------|-----|------|-------------------|
 * | A    | 3           | miss| hit  | admitted, and the term fixed it |
 * | B    | 0           | miss| hit  | refused, and the term would have fixed it |
 * | C    | 0           | hit | miss | refused, and the term would have broken it |
 * | D    | absent      | hit | hit  | the gate was never consulted |
 * | E    | 3           | hit | miss | admitted, and the term broke it |
 * | F    | 0           | tie | tie  | a level score, which only `optimistic` credits |
 */
const CORPUS: readonly ParsedTermCase[] = [
  kase(
    'a',
    'Alpha',
    ['x'],
    [
      candidate('x', [
        ['base', 1, 0.2],
        [GATED, 3, 1],
      ]),
      candidate('y', [
        ['base', 1, 0.5],
        [GATED, 3, 0],
      ]),
    ],
  ),
  kase(
    'b',
    'Alpha',
    ['x'],
    [
      candidate('x', [
        ['base', 1, 0.2],
        [GATED, 0, 1],
      ]),
      candidate('y', [
        ['base', 1, 0.5],
        [GATED, 0, 0],
      ]),
    ],
  ),
  kase(
    'c',
    'Beta',
    ['x'],
    [
      candidate('x', [
        ['base', 1, 0.2],
        [GATED, 0, -1],
      ]),
      candidate('y', [
        ['base', 1, 0.1],
        [GATED, 0, 0],
      ]),
    ],
  ),
  kase(
    'd',
    'Beta',
    ['x'],
    [candidate('x', [['base', 1, 0.3]]), candidate('y', [['base', 1, 0.1]])],
  ),
  kase(
    'e',
    'Gamma',
    ['x'],
    [
      candidate('x', [
        ['base', 1, 0.2],
        [GATED, 3, -1],
      ]),
      candidate('y', [
        ['base', 1, 0.1],
        [GATED, 3, 0],
      ]),
    ],
  ),
  kase(
    'f',
    'Gamma',
    ['x'],
    [
      candidate('x', [
        ['base', 1, 0.5],
        [GATED, 0, 0],
      ]),
      candidate('y', [
        ['base', 1, 0.5],
        [GATED, 0, 0],
      ]),
    ],
  ),
];

describe('weightCensusOf', () => {
  const census = weightCensusOf(CORPUS);

  it('recovers the configuration from the largest coefficient a gated name recorded', () => {
    const row = census.names.find((entry) => entry.name === GATED)!;
    expect(row.configured).toBe(3);
    expect(row.conditional).toBe(true);
    expect([...row.values.entries()]).toEqual([
      [0, 3],
      [3, 2],
    ]);
    expect(row.recorded).toBe(5);
    expect(row.absent).toBe(1);
    expect(row.switchedOff).toBe(3);
    expect(row.conflicts).toBe(0);
    expect(census.conditional).toEqual([GATED]);
  });

  it('does not call an unconditional name conditional, however heavy it is', () => {
    const row = census.names.find((entry) => entry.name === 'base')!;
    expect(row.configured).toBe(1);
    expect(row.conditional).toBe(false);
    expect(row.recorded).toBe(6);
    expect(row.absent).toBe(0);
    expect(row.switchedOff).toBe(0);
  });

  it('reports a name that only ever recorded zero as indistinguishable, not as a zero weight', () => {
    // A term configured at 0 and a term refused on every case record the same number, and the dump cannot tell them
    // apart — so the row says so instead of asserting the configuration.
    const refusedEverywhere = weightCensusOf([
      kase('a', 'Alpha', ['x'], [candidate('x', [['quiet', 0, 4]])]),
    ]);
    const row = refusedEverywhere.names[0]!;
    expect(row.configured).toBe(0);
    expect(row.conditional).toBe(false);
    expect(row.indistinguishable).toBe(true);
    expect(row.switchedOff).toBe(0);
  });

  it('counts a case whose candidates disagree about the coefficient, because that breaks the invariant', () => {
    const split = weightCensusOf([
      kase(
        'a',
        'Alpha',
        ['x'],
        [
          candidate('x', [
            ['base', 1, 1],
            [GATED, 0, 1],
          ]),
          candidate('y', [
            ['base', 1, 0],
            [GATED, 3, 1],
          ]),
        ],
      ),
    ]);
    const row = split.names.find((entry) => entry.name === GATED)!;
    expect(row.conflicts).toBe(1);
    // The first candidate's coefficient is the case's, and the conflict is reported rather than silently resolved.
    expect([...row.values.keys()]).toEqual([0]);
  });

  it('accepts the recorded scores it can rebuild and counts the ones it cannot', () => {
    expect(census.residual).toEqual({ candidates: 12, mismatched: 0 });
    const wrong = weightCensusOf([
      kase(
        'a',
        'Alpha',
        ['x'],
        [
          candidate('x', [['base', 1, 1]], 5),
          candidate('y', [['base', 1, 0]], 0),
          { id: 'z', score: null, terms: [['base', 1, 1]] },
        ],
      ),
    ]);
    expect(wrong.residual).toEqual({ candidates: 2, mismatched: 1 });
  });

  it('reads an empty dump as an empty census rather than as a failure', () => {
    expect(weightCensusOf([])).toEqual({
      cases: 0,
      names: [],
      conditional: [],
      residual: { candidates: 0, mismatched: 0 },
    });
  });

  it('keeps the names in name order and the coefficients in ascending order', () => {
    const shuffled = weightCensusOf([
      kase(
        'a',
        'Alpha',
        ['x'],
        [
          candidate('x', [
            ['zeta', 2, 1],
            ['alpha', 0, 1],
          ]),
        ],
      ),
      kase(
        'b',
        'Alpha',
        ['x'],
        [
          candidate('x', [
            ['zeta', 0, 1],
            ['alpha', 5, 1],
          ]),
        ],
      ),
    ]);
    expect(shuffled.names.map((row) => row.name)).toEqual(['alpha', 'zeta']);
    expect([...shuffled.names[1]!.values.keys()]).toEqual([0, 2]);
  });

  it('skips a triple that carries no weight and one that carries no slope, without calling either a residual', () => {
    // Both halves of "a term with no weight or no slope is not part of the sum": a null weight means the fusion did
    // not apply the term, a null slope means it never measured it, and neither is a disagreement about the score.
    const partial = weightCensusOf([
      kase(
        'a',
        'Alpha',
        ['x'],
        [
          {
            id: 'x',
            score: 2,
            terms: [
              ['base', 2, 1],
              ['unweighted', null, 3],
              ['unmeasured', 4, null],
            ],
          },
        ],
      ),
    ]);
    expect(partial.residual).toEqual({ candidates: 1, mismatched: 0 });
    expect(partial.names.find((row) => row.name === 'unweighted')!.absent).toBe(1);
    // A weight beside a null slope is still a recorded coefficient — the term was weighted, it just had nothing to
    // say — so the name is present with one case and contributes nothing to the sum.
    expect(partial.names.find((row) => row.name === 'unmeasured')!.recorded).toBe(1);
    expect([...partial.names.find((row) => row.name === 'unmeasured')!.values.entries()]).toEqual([
      [4, 1],
    ]);
  });

  it('tolerates a residual below the tolerance and not one above it', () => {
    const noise = SCORE_TOLERANCE / 2;
    const close = weightCensusOf([
      kase('a', 'Alpha', ['x'], [candidate('x', [['base', 1, 1]], 1 + noise)]),
    ]);
    expect(close.residual.mismatched).toBe(0);
    const off = weightCensusOf([
      kase('a', 'Alpha', ['x'], [candidate('x', [['base', 1, 1]], 1 + noise * 4)]),
    ]);
    expect(off.residual.mismatched).toBe(1);
  });
});

describe('ablateTerm', () => {
  const ablation = ablateTerm(CORPUS, GATED);

  it('reads the three arms off one dump', () => {
    expect(ablation.term).toBe(GATED);
    expect(ablation.configured).toBe(3);
    expect(ablation.cases).toBe(6);
    // A, C and D are answered by the arm that ran; B and E are answered only by the arm that did not, so the two
    // arms tie at three and the union is five.
    expect(ablation.arms.recorded.answers).toBe(3);
    expect(ablation.arms.off.answers).toBe(3);
    expect(ablation.arms.on.answers).toBe(3);
  });

  it('credits a level score only to the optimistic reading', () => {
    // Case F is level, so neither arm answers it strictly; the dump's order gives it to `x`, which is accepted.
    // Each arm gives the level case to the dump's first candidate, which is accepted, so every arm adds it.
    expect(ablation.arms.recorded.optimistic).toBe(4);
    expect(ablation.arms.off.optimistic).toBe(4);
    expect(ablation.arms.on.optimistic).toBe(4);
  });

  it('counts the per-case oracle as the union of the two arms', () => {
    // B is only answered with the term and E only without it, so the union is one more than either arm.
    expect(ablation.union).toBe(5);
    expect(ablation.families.find((row) => row.faultType === 'Alpha')!.union).toBe(2);
    expect(ablation.families.find((row) => row.faultType === 'Gamma')!.union).toBe(1);
  });

  it('reads the gate ledger off the coefficients it wrote', () => {
    expect(ablation.gate).toEqual({
      admitted: 2,
      helps: 1,
      hurts: 1,
      refused: 3,
      wouldHelp: 1,
      wouldHurt: 1,
    });
  });

  it('leaves a case that never measured the term out of the ledger, because the gate was never asked', () => {
    // Three refused cases: B, C and F. D is absent, so it is neither admitted nor refused.
    expect(ablation.gate.admitted + ablation.gate.refused).toBe(5);
  });

  it('aggregates the families largest first and breaks a tie by name', () => {
    expect(ablation.families.map((row) => [row.faultType, row.cases])).toEqual([
      ['Alpha', 2],
      ['Beta', 2],
      ['Gamma', 2],
    ]);
  });

  it('orders two families of equal size by name, so two runs print the same table', () => {
    const pair = ablateTerm(
      [
        kase(
          'z',
          'Zeta',
          ['x'],
          [
            candidate('x', [
              ['base', 1, 1],
              [GATED, 3, 1],
            ]),
          ],
        ),
        kase(
          'a',
          'Alpha',
          ['x'],
          [
            candidate('x', [
              ['base', 1, 1],
              [GATED, 3, 1],
            ]),
          ],
        ),
      ],
      GATED,
    );
    expect(pair.families.map((row) => row.faultType)).toEqual(['Alpha', 'Zeta']);
  });

  it('applies a measured slope on a candidate that recorded no coefficient, which is what the arm is for', () => {
    // A producer that measured the term and did not weight it on one candidate writes a null weight beside a real
    // slope. The arm has to read that as the counterfactual — "what if this term had been weighted here" — rather
    // than as "the term does not exist here", which is the reading that would make the arm silently equal `off`.
    const partial = ablateTerm(
      [
        kase(
          'a',
          'Alpha',
          ['x'],
          [
            candidate('x', [
              ['base', 1, 1],
              [GATED, 3, 0],
            ]),
          ],
        ),
        kase(
          'b',
          'Alpha',
          ['x'],
          [
            candidate('x', [
              ['base', 1, 0.1],
              [GATED, null, 5],
              ['other', null, 6],
              // A weight beside a null slope: the fusion weighted a term that measured nothing, so the arm must add
              // nothing rather than multiply a weight by an absence.
              ['flat', 2, null],
            ]),
            candidate('y', [['base', 1, 1]]),
          ],
        ),
      ],
      GATED,
    );
    // `recorded` skips the unweighted slope, so case `b` answers `y`; `on` weights it at the configured 3 and answers
    // `x`. `off` matches `recorded` on that case, which is what makes the difference the arm's and not the census's.
    expect(partial.arms.recorded.answers).toBe(1);
    expect(partial.arms.off.answers).toBe(1);
    expect(partial.arms.on.answers).toBe(2);
    expect(partial.gate.admitted + partial.gate.refused).toBe(1);
    expect(partial.configured).toBe(3);
  });

  it('throws when no case records the term, because that is not a measurement of zero', () => {
    expect(() => ablateTerm(CORPUS, 'absent')).toThrow('no case records absent');
  });
});

describe('formatCensus', () => {
  it('prints the residual, the conditional names and one row per name', () => {
    const text = formatCensus(weightCensusOf(CORPUS));
    expect(text).toContain('cases 6   candidates 12   residual mismatches 0');
    expect(text).toContain(`conditional names: ${GATED}`);
    expect(text).toContain(`${GATED}`);
    expect(text).toContain('(GATED)');
    expect(text).toContain('0 x3  3 x2');
  });

  it('says a dump with no conditional name has none rather than printing an empty list', () => {
    const text = formatCensus(
      weightCensusOf([kase('a', 'Alpha', ['x'], [candidate('x', [['base', 1, 1]])])]),
    );
    expect(text).toContain('conditional names: none');
  });

  it('marks the two states a reader would otherwise have to infer', () => {
    const census: WeightCensus = weightCensusOf([
      kase('a', 'Alpha', ['x'], [candidate('x', [['quiet', 0, 1]])]),
      kase(
        'b',
        'Alpha',
        ['x'],
        [candidate('x', [['split', 0, 1]]), candidate('y', [['split', 2, 1]])],
      ),
    ]);
    const text = formatCensus(census);
    expect(text).toContain('(0-or-refused)');
    expect(text).toContain('1 CONFLICTING');
  });
});

describe('formatAblation', () => {
  it('prints every arm with its share, the oracle and the gate ledger', () => {
    const text = formatAblation(ablateTerm(CORPUS, GATED));
    expect(text).toContain(`${GATED}: configured 3, cases 6`);
    expect(text).toContain('off             3   50.00%');
    expect(text).toContain('recorded        3   50.00%');
    expect(text).toContain('on              3   50.00%');
    expect(text).toContain('union           5   83.33%');
    expect(text).toContain(
      'gate: admitted 2 (helps 1, hurts 1), refused 3 (would help 1, would hurt 1)',
    );
  });

  it('prints a family whose arms agree with a zero, not with a blank', () => {
    const text = formatAblation(ablateTerm(CORPUS, GATED));
    // Gamma is the family whose gain is one-sided: the term fixes E and leaves F level, so the recorded arm answers
    // none of the two while `off` answers one — the only row whose `on-off` is negative.
    expect(text).toMatch(/Gamma\s+2\s+1\s+0\s+0\s+-1/);
    expect(text).toMatch(/Alpha\s+2\s+0\s+1\s+2\s+2/);
  });
});
