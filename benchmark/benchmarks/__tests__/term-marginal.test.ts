import { describe, expect, it } from 'vitest';

import {
  contributionOf,
  evidencePartition,
  formatMarginals,
  marginalTable,
  MIN_MARGINAL_GAIN,
  publishedReading,
  recomputedScore,
  termVocabulary,
  topOneOf,
  type MarginalCandidate,
  type MarginalCase,
  type TermRow,
} from '../src/term-marginal.js';

const term = (name: string, weight: number | null, value: number | null): TermRow => ({
  name,
  weight,
  value,
});

/** A candidate whose published score is the sum of its own terms, so the drift assertion starts at zero. */
const candidate = (id: string, terms: readonly TermRow[]): MarginalCandidate => ({
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
  candidates: readonly MarginalCandidate[],
): MarginalCase => ({ datapack, truth, candidates });

/**
 * One corpus with a decisive term, a decorative pair, and a hinge.
 *
 * `c1` is decided by `base`: without it the runner-up wins. `c2` is decided wrongly by a hinge that lifts a late
 * candidate over the correct first one, and removing the hinge leaves a tie the pool's own order settles correctly.
 * `tiny` never closes a gap it has to close, and `alt` is large enough to matter in principle but is not on any
 * winner.
 */
const corpus: readonly MarginalCase[] = [
  testCase(
    'c1',
    ['svc-a'],
    [
      candidate('svc-a', [term('base', 1, 1), term('tiny', 0.001, 0.5)]),
      candidate('svc-b', [term('base', 1, 0.4), term('alt', 1, 0.5)]),
    ],
  ),
  testCase(
    'c2',
    ['svc-x'],
    [
      candidate('svc-x', [term('base', 1, 5)]),
      candidate('svc-z', [term('base', 1, 5), term('hinge', 1, 3)]),
    ],
  ),
  testCase(
    'c3',
    ['svc-a'],
    [
      candidate('svc-a', [term('base', 1, 1), term('tiny', 0.001, 0.5)]),
      candidate('svc-b', [term('base', 1, 0.4)]),
    ],
  ),
];

describe('the score identity', () => {
  it('recomputes the artifact score exactly when every term is present', () => {
    const table = marginalTable(corpus);
    expect(table.scoreDrift).toBe(0);
    expect(table.cases).toBe(3);
    expect(table.base).toBe(2);
  });

  it('reports the largest disagreement rather than rounding it away', () => {
    // A dump whose score column disagrees with its own terms is the one defect that would make every marginal
    // a property of this module instead of the engine, so the drift is a number the caller prints.
    const broken = [
      testCase(
        'c1',
        ['svc-a'],
        [
          { id: 'svc-a', score: 9, terms: [term('base', 1, 1)] },
          candidate('svc-b', [term('base', 1, 0.4)]),
        ],
      ),
    ];
    expect(marginalTable(broken).scoreDrift).toBe(8);
  });

  it('recomputes with one term removed', () => {
    expect(recomputedScore(corpus[1]!.candidates[1]!, 'hinge')).toBe(5);
    expect(recomputedScore(corpus[1]!.candidates[1]!)).toBe(8);
  });
});

describe('what a missing measurement is', () => {
  it('reads an unmeasured term as no contribution and not as a zero', () => {
    expect(contributionOf(term('trace', null, null))).toBeNull();
    // A value without a weight, and a weight without a value, are both incomplete measurements rather than products.
    expect(contributionOf(term('trace', 1, null))).toBeNull();
    expect(contributionOf(term('trace', null, 1))).toBeNull();
  });

  it('refuses a non-finite measurement rather than letting it poison the sum', () => {
    expect(contributionOf(term('trace', Number.NaN, 1))).toBeNull();
    expect(contributionOf(term('trace', 1, Number.POSITIVE_INFINITY))).toBeNull();
  });

  it('counts a term whose weight is zero as measured but inert', () => {
    // This is the shape the shipped vector writes for a channel it does not use: the term is computed, its weight
    // is zero, and it contributes nothing. It must not be reported as `load-bearing` on the strength of its presence.
    const zero = [
      testCase(
        'c1',
        ['svc-a'],
        [
          candidate('svc-a', [term('base', 1, 1), term('source', 0, 0.8)]),
          candidate('svc-b', [term('base', 1, 0.4)]),
        ],
      ),
    ];
    const row = marginalTable(zero).rows.find((one) => one.term === 'source')!;
    expect(row.present).toBe(1);
    expect(row.maxContribution).toBe(0);
    expect(row.role).toBe('inert');
    expect(row.weights).toEqual([0]);
  });

  it('reports a term that was never computed at all as inert with no weights', () => {
    const absent = [
      testCase(
        'c1',
        ['svc-a'],
        [
          candidate('svc-a', [term('base', 1, 1), term('trace', null, null)]),
          candidate('svc-b', [term('base', 1, 0.4), term('trace', null, null)]),
        ],
      ),
    ];
    const row = marginalTable(absent).rows.find((one) => one.term === 'trace')!;
    expect(row.present).toBe(0);
    expect(row.weights).toEqual([]);
    expect(row.role).toBe('inert');
  });
});

describe('the marginals', () => {
  it('charges a decisive term the cases it decides', () => {
    const row = marginalTable(corpus).rows.find((one) => one.term === 'base')!;
    expect(row.decided).toBe(3);
    // `c2` is the one the hinge decided, so `base` is on two winners that are right and one that is not. Removing
    // it loses `c1` and `c3` and leaves `c3` right only because its runner-up carries nothing else.
    expect(row.correct).toBe(2);
    expect(row.marginal).toBe(-1);
    expect(row.role).toBe('load-bearing');
  });

  it('reads a term that cannot close the decision gap as decorative', () => {
    const row = marginalTable(corpus).rows.find((one) => one.term === 'tiny')!;
    expect(row.maxContribution).toBeCloseTo(0.0005, 10);
    expect(row.marginal).toBe(0);
    expect(row.role).toBe('decorative');
  });

  it('calls a term that only buys ties a tie-maker, not a gain', () => {
    // Removing the hinge makes the two candidates equal, and the pool's own order then prefers the correct one. The
    // improvement is real on the corpus and it is not evidence: it is the engine's published order re-entering the
    // score. The role is what stops the number from being quoted as a finding.
    const row = marginalTable(corpus).rows.find((one) => one.term === 'hinge')!;
    expect(row.decided).toBe(1);
    expect(row.correct).toBe(0);
    expect(row.marginal).toBe(MIN_MARGINAL_GAIN);
    expect(row.tiesGained).toBe(1);
    expect(row.role).toBe('tie-maker');
  });

  it('keeps the first maximum so a tie is settled the way the product settles it', () => {
    expect(topOneOf(corpus[1]!.candidates, 'hinge')).toEqual({ id: 'svc-x', tied: true });
  });

  it('has no top when the pool is empty', () => {
    expect(topOneOf([])).toEqual({ id: null, tied: false });
  });
});

/** A term whose removal repairs a case outright, so the classification has to name it rather than call it a loss. */
const harmful: readonly MarginalCase[] = [
  testCase(
    'c1',
    ['svc-a'],
    [
      candidate('svc-a', [term('decoy', 1, 1.5)]),
      candidate('svc-b', [term('decoy', 1, 1), term('harm', 1, 2)]),
    ],
  ),
];

describe('the marginals', () => {
  it('names a term whose removal repairs a case without a tie as harmful', () => {
    // Removing `harm` drops `svc-b` below `svc-a` with no tie anywhere: the gain is evidence against the term rather
    // than the pool's order re-entering the score, and the two must not print alike.
    const row = marginalTable(harmful).rows.find((one) => one.term === 'harm')!;
    expect(row.marginal).toBe(1);
    expect(row.tiesGained).toBe(0);
    expect(row.role).toBe('harmful');
  });
});

describe('the corpus bounds', () => {
  it('reads the median gap of an odd population as its middle value', () => {
    // Gaps of 0.1, 3 and 0.6005 sort to 0.1 / 0.6005 / 3, so the middle one is the third case's.
    expect(marginalTable(corpus).medianGap).toBeCloseTo(0.6005, 10);
  });

  it('has no gap and no top-1 change when every case offers one candidate', () => {
    const single = [testCase('c1', ['svc-a'], [candidate('svc-a', [term('base', 1, 1)])])];
    const table = marginalTable(single);
    expect(table.medianGap).toBeNull();
    expect(table.base).toBe(1);
    // A term that changes nothing on this corpus is decorative, whatever it contributes.
    expect(table.rows[0]!.role).toBe('decorative');
    expect(table.rows[0]!.marginal).toBe(0);
  });

  it('skips a case with no accepted set instead of counting it as a miss', () => {
    const unlabelled = [...corpus, testCase('c4', [], [candidate('svc-a', [term('base', 1, 1)])])];
    const table = marginalTable(unlabelled);
    expect(table.cases).toBe(3);
    expect(table.base).toBe(2);
  });

  it('lists the vocabulary in the order the dump first mentions it', () => {
    expect(termVocabulary(corpus)).toEqual(['base', 'tiny', 'alt', 'hinge']);
  });

  it('reads an empty corpus without dividing by zero', () => {
    const table = marginalTable([]);
    expect(table).toEqual({ cases: 0, base: 0, medianGap: null, scoreDrift: 0, rows: [] });
    expect(formatMarginals(table)).toContain('(0.00 %)');
  });
});

describe('the printed ledger', () => {
  it('prints every row with its role, its weights and a signed marginal', () => {
    const text = formatMarginals(marginalTable(corpus));
    expect(text).toMatch(/hinge\s+1\.0000\s+1\s+3\.0000\s+1\s+0 \(0\.00 %\)\s+\+1\s+1\s+tie-maker/);
    expect(text).toContain('decorative');
    expect(text).toContain('load-bearing');
  });

  it('prints an em dash where a term carried no weight at all', () => {
    const absent = [
      testCase(
        'c1',
        ['svc-a'],
        [
          candidate('svc-a', [term('base', 1, 1), term('trace', null, null)]),
          candidate('svc-b', [term('base', 1, 0.4)]),
        ],
      ),
    ];
    expect(formatMarginals(marginalTable(absent))).toMatch(/trace\s+—/);
  });

  it('prints a zero share for a term that decided nothing', () => {
    const text = formatMarginals(marginalTable(corpus));
    expect(text).toContain('0 (0.00 %)');
  });

  it('states the corpus and the drift under the table', () => {
    const text = formatMarginals(marginalTable(corpus));
    expect(text).toContain('cases 3, score-order Top-1 2 (66.67 %)');
    expect(text).toContain('score drift 0.000e+0');
  });
});

describe('the ledger at its edges', () => {
  it('reads the median gap of an even population as the mean of its middle two', () => {
    const two = [
      testCase(
        'c1',
        ['svc-a'],
        [candidate('svc-a', [term('base', 1, 1)]), candidate('svc-b', [term('base', 1, 0)])],
      ),
      testCase(
        'c2',
        ['svc-a'],
        [candidate('svc-a', [term('base', 1, 3)]), candidate('svc-b', [term('base', 1, 0)])],
      ),
    ];
    expect(marginalTable(two).medianGap).toBe(2);
  });

  it('skips a case whose pool is empty instead of reading a decision out of it', () => {
    // The engine can hand over an empty pool; the ledger must not turn that into a miss with a top-1 attached.
    const empty = [...corpus, testCase('c4', ['svc-a'], [])];
    const table = marginalTable(empty);
    expect(table.cases).toBe(4);
    expect(table.base).toBe(2);
    expect(table.rows.find((one) => one.term === 'base')!.marginal).toBe(-1);
  });

  it('lists every weight a term carried, ascending, when the vector differs between cases', () => {
    // A per-case vector is what an adaptive configuration produces, and a reader who sees only one of the two
    // weights would attribute the marginal to a setting half the corpus never ran.
    const mixed = [
      testCase(
        'c1',
        ['svc-a'],
        [candidate('svc-a', [term('base', 2, 1)]), candidate('svc-b', [term('base', 1, 0.4)])],
      ),
      testCase(
        'c2',
        ['svc-a'],
        [candidate('svc-a', [term('base', 1, 1)]), candidate('svc-b', [term('base', 1, 0.4)])],
      ),
    ];
    expect(marginalTable(mixed).rows[0]!.weights).toEqual([1, 2]);
  });
});

describe('the published order against the sum', () => {
  it('counts both orders and the cases where they disagree', () => {
    // `c2` is the case the two orders treat differently: the sum's maximum is `svc-z` and the published list leads
    // with `svc-x`. That is the shape the relational passes produce, and it is why the ledger's base is the sum's.
    const reading = publishedReading(
      corpus,
      new Map([
        ['c1', ['svc-a']],
        ['c2', ['svc-x']],
        ['c3', ['svc-b']],
      ]),
    );
    expect(reading.cases).toBe(3);
    expect(reading.published).toBe(2);
    expect(reading.scoreOrder).toBe(2);
    // Two of the three disagree: `c2` because the sum leads with a later candidate, `c3` because the published list
    // leads with one the sum did not.
    expect(reading.replaced).toBe(2);
  });

  it('skips an unlabelled case in both counts', () => {
    const unlabelled = [...corpus, testCase('c4', [], [candidate('svc-a', [term('base', 1, 1)])])];
    const reading = publishedReading(unlabelled, new Map([['c4', ['svc-a']]]));
    expect(reading.cases).toBe(3);
    // The artifact carries a published answer for the unlabelled case and it is not counted: there is no accepted set
    // to be right about.
    expect(reading.published).toBe(0);
  });

  it('reads a case the published artifact does not carry as having no published first choice', () => {
    const reading = publishedReading(corpus, new Map());
    expect(reading.published).toBe(0);
    expect(reading.replaced).toBe(3);
  });
});

describe('the evidence partition', () => {
  it('separates a pool that carries evidence from one that carries only the deviation', () => {
    const corpus = [
      testCase(
        'with',
        ['svc-a'],
        [
          candidate('svc-a', [term('selfAnomalyLog1p', 1, 1), term('log', 1, 1)]),
          candidate('svc-b', [term('selfAnomalyLog1p', 1, 0.5)]),
        ],
      ),
      testCase(
        'without',
        ['svc-a'],
        [
          candidate('svc-a', [term('selfAnomalyLog1p', 1, 0.2)]),
          candidate('svc-b', [term('selfAnomalyLog1p', 1, 0.9)]),
        ],
      ),
    ];
    const partition = evidencePartition(corpus);
    expect(partition.withEvidence).toEqual({ cases: 1, correct: 1 });
    expect(partition.kineticOnly).toEqual({ cases: 1, correct: 0 });
  });

  it('counts the evidence even when it sits on a candidate that loses', () => {
    // The split is structural: drawing it on the winner would make it a function of the outcome it is used to explain.
    const corpus = [
      testCase(
        'c',
        ['svc-a'],
        [
          candidate('svc-a', [term('selfAnomalyLog1p', 1, 0.2)]),
          candidate('svc-b', [term('selfAnomalyLog1p', 1, 0.9), term('podState', 8, 0.25)]),
        ],
      ),
    ];
    const partition = evidencePartition(corpus);
    expect(partition.withEvidence).toEqual({ cases: 1, correct: 0 });
    expect(partition.kineticOnly).toEqual({ cases: 0, correct: 0 });
  });

  it('does not read an evidence term whose weight is zero as evidence', () => {
    const corpus = [
      testCase(
        'c',
        ['svc-a'],
        [
          candidate('svc-a', [term('selfAnomalyLog1p', 1, 1), term('log', 0, 1)]),
          candidate('svc-b', [term('selfAnomalyLog1p', 1, 0.5)]),
        ],
      ),
    ];
    expect(evidencePartition(corpus).kineticOnly).toEqual({ cases: 1, correct: 1 });
  });

  it('has two empty sides on an empty corpus', () => {
    expect(evidencePartition([])).toEqual({
      withEvidence: { cases: 0, correct: 0 },
      kineticOnly: { cases: 0, correct: 0 },
    });
  });

  it('skips an unlabelled case', () => {
    const corpus = [testCase('c', [], [candidate('svc-a', [term('log', 1, 1)])])];
    expect(evidencePartition(corpus).withEvidence.cases).toBe(0);
  });
});
