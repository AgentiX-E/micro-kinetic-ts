/**
 * The term study's aggregation, tested where aggregation is the thing that can be wrong.
 *
 * `containment-term.test.ts` pins the arithmetic of one pair. What is left is the census: which pairs were
 * examined, which of them the corpus could fit, and whether the four arms are read on one scale. The fixture is
 * therefore built around ONE edge whose φ is hand-computable — twelve observations per half, six of each
 * configuration — so that "the term paid" and "the corpus measured no coupling" are distinguishable numbers rather
 * than two spellings of the same one.
 */

import { describe, expect, it } from 'vitest';

import { foldOf } from '../src/containment-gate.js';
import type { ContainmentCaseRow } from '../src/containment-rows.js';
import {
  readTerm,
  sweepTerm,
  termVerdict,
  type ScoreTable,
} from '../src/containment-term-study.js';

/**
 * `count` names in `fold`, found by walking `n0, n1, …` and keeping the ones the hash puts where they are wanted.
 *
 * The fold is a hash of the name (`containment-gate.ts`), so a fixture that hardcoded names would be asserting
 * against a constant it cannot control. Searching for the names it needs is the only way to build a two-half
 * fixture whose halves are a property of the code under test rather than of a lucky string.
 */
function namesFor(fold: 'a' | 'b', count: number): string[] {
  const names: string[] = [];
  for (let i = 0; names.length < count; i++) {
    const name = `n${i}`;
    if (foldOf(name) === fold) names.push(name);
  }
  return names;
}

/** The observations the fixture cycles through: both in, both out, callee only, caller only. */
const EXCURSIONS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 0],
  [1, 1],
  [1, 1],
  [0, 1],
  [1, 0],
];

/** Extra knobs the branch-covering fixtures need, all of them things a real dump can carry. */
interface BuildOptions {
  /** The order to record. Defaults to the two candidates; one candidate is a case with no adjacency at all. */
  readonly order?: readonly string[];
  /** How many pairs the ungated trace recorded, so the population census can be made to agree. */
  readonly ungatedPairCount?: number;
}

interface BuildInput {
  /** The excursion pair this case contributes to the edge's population. */
  readonly excursion: readonly [number, number];
  /** The fusion's score for `hub` and `leaf`. */
  readonly scores: readonly [number, number];
  /** The accepted answer. */
  readonly accepted: readonly string[];
  /** Whether the row carries a chain at all. */
  readonly chained?: boolean;
  /** Whether the depth dump scored this case. */
  readonly scored?: boolean;
}

/** One case: `hub` calls `leaf`, the fusion puts `hub` first, and the excursions say what the profile saw. */
function caseRow(name: string, input: BuildInput, options: BuildOptions = {}): ContainmentCaseRow {
  const chained = input.chained ?? true;
  const order = options.order ?? ['hub', 'leaf'];
  const row = {
    datapack: name,
    faultType: 'PodKill',
    sigma: 3,
    margin: 0,
    fusionTop1: 'hub',
    gatedTop1: 'hub',
    ungatedTop1: 'hub',
    shippedTop1: 'hub',
    replay: 'identical',
    pairs: [],
    ungatedPairs: Array.from({ length: options.ungatedPairCount ?? 0 }, () => ({
      upper: 'hub',
      lower: 'leaf',
      decision: 'not-larger',
      upperExcursion: input.excursion[0],
      lowerExcursion: input.excursion[1],
    })),
    ...(chained
      ? {
          chain: {
            order: [...order],
            edges: [['hub', 'leaf']],
            excursions: { hub: input.excursion[0], leaf: input.excursion[1] },
            failedInterfaces: {},
            flows: {},
            failingEdges: {},
            attribution: 'count',
          },
        }
      : {}),
  } as unknown as ContainmentCaseRow;
  return row;
}

/** The score table the depth dump would produce. */
function scoreTable(entries: readonly (readonly [string, number, number, boolean])[]): ScoreTable {
  const table = new Map<string, ReadonlyMap<string, number>>();
  for (const [name, hub, leaf, scored] of entries) {
    if (!scored) continue;
    table.set(
      name,
      new Map([
        ['hub', hub],
        ['leaf', leaf],
      ]),
    );
  }
  return table;
}

/** A corpus of two halves, both observing the same edge with the same coupling. */
function corpus(perHalf = 12): {
  rows: ContainmentCaseRow[];
  scores: ScoreTable;
  accepted: Map<string, readonly string[]>;
} {
  const rows: ContainmentCaseRow[] = [];
  const scoreRows: (readonly [string, number, number, boolean])[] = [];
  const accepted = new Map<string, readonly string[]>();
  for (const fold of ['a', 'b'] as const) {
    const names = namesFor(fold, perHalf);
    for (const [index, name] of names.entries()) {
      const excursion = EXCURSIONS[index % EXCURSIONS.length]!;
      // The leaf's score sits 0.2 below the hub's: smaller than the δ a coupled edge pays (≈1/3), so every case
      // whose excursions qualify is promoted, and a case whose excursions do not qualify is not.
      rows.push(caseRow(name, { excursion, scores: [1, 0.8], accepted: ['leaf'] }));
      scoreRows.push([name, 1, 0.8, true]);
      accepted.set(name, ['leaf']);
    }
  }
  return { rows, scores: scoreTable(scoreRows), accepted };
}

describe('reading the term arm', () => {
  it('fits φ on one half and pays it on the other', () => {
    const { rows, scores, accepted } = corpus();
    const reading = readTerm(rows, scores, accepted, 1);
    expect(reading.fits).toHaveLength(2);
    for (const fit of reading.fits) {
      // Six configurations, each appearing twice in a half: p = q = 3/6, joint = 2/6, so ρ = 1/3 − 1/4 = 1/12 and
      // φ = (1/12) / (1/2 · 1/2) = 1/3. Hand-computed, because a φ that the fixture computes is a φ the fixture
      // can get wrong in the same direction as the code.
      expect(fit.edges).toBe(1);
      expect(fit.fitted).toBe(1);
      expect(fit.positive).toBe(1);
      expect(fit.observations).toBe(12);
      expect(fit.appliesTo).not.toBe(fit.fittedOn);
    }
  });

  it('pays the coupled pairs and counts the rest apart, so the census adds up', () => {
    const { rows, scores, accepted } = corpus();
    const reading = readTerm(rows, scores, accepted, 1);
    const { qualified, unfitted, paid, silent, refused } = reading.census;
    // Two of the six configurations have the callee strictly further out — `[0,1]` twice per half.
    expect(qualified).toBe(4);
    expect(refused).toBe(20);
    expect(unfitted).toBe(0);
    expect(paid).toBe(4);
    expect(silent).toBe(0);
    expect(qualified).toBe(unfitted + paid + silent);
  });

  it('moves exactly the cases whose gap the payment clears, and no others', () => {
    const { rows, scores, accepted } = corpus();
    const reading = readTerm(rows, scores, accepted, 1);
    // δ = 1 × 1/3 × 1 = 0.333 against a 0.2 gap: the four qualifying cases are promoted and nothing else is.
    expect(reading.moved).toBe(4);
    expect(reading.arms.graded.gains).toBe(4);
    expect(reading.arms.graded.losses).toBe(0);
    expect(reading.arms.graded.top1).toBe(reading.arms.fusion.top1 + 4);
  });

  it('is the baseline at λ = 0, which is what makes the sweep a curve rather than a choice', () => {
    const { rows, scores, accepted } = corpus();
    const reading = readTerm(rows, scores, accepted, 0);
    expect(reading.moved).toBe(0);
    expect(reading.arms.graded).toEqual(reading.arms.fusion);
    // The pairs are still counted: λ = 0 prices the population, it does not skip it.
    expect(reading.census.qualified).toBe(4);
    expect(reading.census.paid).toBe(0);
  });

  it('reproduces the shipped arm on its own artifact, which is the instrument check', () => {
    const { rows, scores, accepted } = corpus();
    const reading = readTerm(rows, scores, accepted, 1);
    expect(reading.disagreements).toBe(0);
    expect(reading.replayable).toBe(rows.length);
    expect(reading.unordered).toBe(0);
    // The fixture's chains say `shippedTop1: hub` and its graphs carry no failed interface, so the shipped arm
    // and the fusion agree — and the reading says so rather than assuming it.
    expect(reading.arms.shipped).toEqual(reading.arms.fusion);
  });

  it('reports the population the fit used against the one the gate used', () => {
    const { rows, scores, accepted } = corpus();
    const reading = readTerm(rows, scores, accepted, 1);
    // Both counts see the one edge; the sweep's trace is empty in this fixture, so the two are not equal and the
    // census says by how much rather than leaving it to be inferred.
    expect(reading.population.fusion).toBe(rows.length);
    expect(reading.population.ungated).toBe(0);
    expect(reading.population.shared).toBe(0);
  });

  it('refuses a case whose candidate has no score, and counts the refusal', () => {
    const { rows, scores, accepted } = corpus();
    const withoutFirst = new Map([...scores].slice(1));
    const reading = readTerm(rows, withoutFirst, accepted, 1);
    expect(reading.unordered).toBe(1);
    // The refused case contributes to no arm: reading it as wrong would credit the arm for a case it declined.
    expect(reading.census.qualified).toBe(4);
  });

  it('skips a row with no chain, and a row with no accepted answer', () => {
    const { rows, scores, accepted } = corpus();
    const extra = [
      caseRow('unchained', {
        excursion: [0, 1],
        scores: [1, 0.8],
        accepted: ['leaf'],
        chained: false,
      }),
    ];
    const withExtra = [...rows, ...extra];
    const reading = readTerm(withExtra, scores, accepted, 1);
    expect(reading.cases).toBe(withExtra.length);
    expect(reading.replayable).toBe(rows.length);

    const unlabelled = new Map(accepted);
    unlabelled.delete(rows[0]!.datapack);
    const partial = readTerm(rows, scores, unlabelled, 1);
    expect(partial.arms.fusion.top1).toBe(reading.arms.fusion.top1);
  });

  it('counts a qualifying pair on an unfitted edge as unfitted, not as a refusal', () => {
    // One half only: the other half has no cases, so the fold that pays has an empty φ map and every qualifying
    // pair is a pair the corpus could not fit. This is the branch that keeps `prior-absent` and `prior-below`
    // apart, applied to a term.
    const rows = namesFor('a', 12).map((name, index) =>
      caseRow(name, {
        excursion: EXCURSIONS[index % EXCURSIONS.length]!,
        scores: [1, 0.8],
        accepted: ['leaf'],
      }),
    );
    const scores = scoreTable(namesFor('a', 12).map((name) => [name, 1, 0.8, true] as const));
    const reading = readTerm(rows, scores, new Map(rows.map((row) => [row.datapack, ['leaf']])), 1);
    // Twelve cases are two cycles of six, so the callee-only configuration occurs twice and both are unfitted.
    expect(reading.census.qualified).toBe(2);
    expect(reading.census.unfitted).toBe(2);
    expect(reading.census.paid).toBe(0);
    expect(reading.moved).toBe(0);
  });

  it('sweeps λ without re-reading the corpus differently each time', () => {
    const { rows, scores, accepted } = corpus();
    const readings = sweepTerm(rows, scores, accepted, [0, 0.5, 1, 4]);
    expect(readings.map((reading) => reading.lambda)).toEqual([0, 0.5, 1, 4]);
    // A larger λ cannot promote fewer cases: the transfers are monotone in λ and the tie-break is the fusion's.
    const moved = readings.map((reading) => reading.moved);
    expect(moved).toEqual([...moved].sort((left, right) => left - right));
    expect(readings[0]!.arms.graded.top1).toBe(readings[0]!.arms.fusion.top1);
  });
});

describe('the term verdict', () => {
  it('is unmeasured when nothing can be walked', () => {
    const empty = readTerm([], new Map(), new Map(), 1);
    expect(termVerdict(empty)).toEqual({
      verdict: 'unmeasured',
      reason: 'no row carries the sweep input, so no arm can be walked',
    });
  });

  it('is unmeasured when some rows carry no chain', () => {
    const { rows, scores, accepted } = corpus();
    const extra = [
      caseRow('unchained', {
        excursion: [0, 1],
        scores: [1, 0.8],
        accepted: ['leaf'],
        chained: false,
      }),
    ];
    const reading = readTerm([...rows, ...extra], scores, accepted, 1);
    expect(termVerdict(reading).verdict).toBe('unmeasured');
    expect(termVerdict(reading).reason).toContain('carry no sweep input');
  });

  it('is unmeasured when a case could not be ordered, rather than reading the rest', () => {
    const { rows, scores, accepted } = corpus();
    const reading = readTerm(rows, new Map([...scores].slice(1)), accepted, 1);
    const verdict = termVerdict(reading);
    expect(verdict.verdict).toBe('unmeasured');
    expect(verdict.reason).toContain('no finite score');
  });

  it('is unmeasured when the shipped replay does not reproduce the recorded answer', () => {
    // The instrument check: a dump whose chain is missing an input cannot license a row beneath it. Simulated by
    // moving a case's recorded top-1 away from what its own chain produces.
    const { rows, scores, accepted } = corpus();
    const tampered = rows.map((row, index) =>
      index === 0 ? ({ ...row, shippedTop1: 'leaf' } as ContainmentCaseRow) : row,
    );
    const reading = readTerm(tampered, scores, accepted, 1);
    expect(reading.disagreements).toBe(1);
    const verdict = termVerdict(reading);
    expect(verdict.verdict).toBe('unmeasured');
    expect(verdict.reason).toContain('did not reproduce');
  });

  it('applies the standing bar, and fails the fixture because four gains are fewer than fifteen', () => {
    const { rows, scores, accepted } = corpus();
    const reading = readTerm(rows, scores, accepted, 1);
    const verdict = termVerdict(reading);
    expect(verdict.verdict).toBe('fail');
    expect(verdict.reason).toBe('+4 is below the 15 the gate requires');
  });

  it('passes when an arm clears all three numbers, which no real reading has yet', () => {
    const { rows, scores, accepted } = corpus(60);
    const reading = readTerm(rows, scores, accepted, 1);
    // Sixty per half: 120 cases, 40 of them qualifying, so the gain bar is cleared on the fixture alone.
    expect(reading.arms.graded.gains).toBeGreaterThanOrEqual(15);
    expect(reading.arms.graded.losses).toBe(0);
    const verdict = termVerdict(reading);
    expect(verdict.verdict).toBe(reading.arms.graded.top1 > 1_156 ? 'pass' : 'fail');
  });
});

describe('the branches a real corpus reaches and a happy fixture does not', () => {
  /** A corpus whose one edge moves AGAINST itself: `[0,1],[0,1],[1,0],[1,0],[0,0],[1,1]`. */
  const ANTI: readonly (readonly [number, number])[] = [
    [0, 1],
    [0, 1],
    [1, 0],
    [1, 0],
    [0, 0],
    [1, 1],
  ];

  it('counts a fitted edge with φ ≤ 0 as fitted and NOT positive, and pays it nothing', () => {
    // The distinction the term's census exists for: an edge the corpus measured to move against itself is a
    // measurement, and an edge nobody fitted is not. A fit census that only counted `fitted` would report the
    // anti-correlated edge as a resource.
    const rows: ContainmentCaseRow[] = [];
    const scores: (readonly [string, number, number, boolean])[] = [];
    for (const fold of ['a', 'b'] as const) {
      for (const [index, name] of namesFor(fold, 12).entries()) {
        const excursion = ANTI[index % ANTI.length]!;
        rows.push(caseRow(name, { excursion, scores: [1, 0.8], accepted: ['leaf'] }));
        scores.push([name, 1, 0.8, true]);
      }
    }
    const reading = readTerm(
      rows,
      scoreTable(scores),
      new Map(rows.map((row) => [row.datapack, ['leaf']])),
      1,
    );
    for (const fit of reading.fits) {
      expect(fit.fitted).toBe(1);
      expect(fit.positive).toBe(0);
    }
    // The callee's side is out alone in two of the six configurations — the two `[0,1]` rows — so four cycles of
    // six over twenty-four cases give eight qualifying pairs. The edge is fitted, so they are SILENT rather than
    // unfitted: the corpus answered, and its answer was zero.
    expect(reading.census.qualified).toBe(8);
    expect(reading.census.unfitted).toBe(0);
    expect(reading.census.silent).toBe(8);
    expect(reading.census.paid).toBe(0);
    expect(reading.moved).toBe(0);
    expect(reading.arms.graded).toEqual(reading.arms.fusion);
  });

  it('counts a loss, which is the branch a corpus of wins never reaches', () => {
    // The same corpus read against the OTHER answer: the fusion is right on every case and the term promotes
    // four of them, so the arm is 0 gains and 4 losses. Without this the losses branch would be exercised only by
    // the real artifact, where a failure would first appear as a wrong published number.
    const { rows, scores } = corpus();
    const against = new Map(rows.map((row) => [row.datapack, ['hub']]));
    const reading = readTerm(rows, scores, against, 1);
    expect(reading.arms.graded.gains).toBe(0);
    expect(reading.arms.graded.losses).toBe(4);
    expect(reading.arms.graded.top1).toBe(reading.arms.fusion.top1 - 4);
  });

  it('handles a case with one candidate: no adjacency, so no pair and no transfer', () => {
    const names = namesFor('a', 12);
    const rows = names.map((name, index) =>
      caseRow(
        name,
        { excursion: EXCURSIONS[index % EXCURSIONS.length]!, scores: [1, 0.8], accepted: ['hub'] },
        { order: ['hub'] },
      ),
    );
    const reading = readTerm(
      rows,
      scoreTable(names.map((name) => [name, 1, 0.8, true] as const)),
      new Map(rows.map((row) => [row.datapack, ['hub']])),
      1,
    );
    expect(reading.census.qualified).toBe(0);
    expect(reading.census.refused).toBe(0);
    expect(reading.population.fusion).toBe(0);
    expect(reading.moved).toBe(0);
  });

  it('reports how many cases the two populations agree on, rather than assuming they all do', () => {
    // The term fits on the fusion's adjacency and the gate on a sweep's; on a case the sweep left alone the two
    // are the same pairs. Recording the agreement lets a reader bound how far the two arms' numbers can diverge
    // for a reason that has nothing to do with the residual.
    const names = namesFor('a', 12);
    const rows = names.map((name, index) =>
      caseRow(
        name,
        { excursion: EXCURSIONS[index % EXCURSIONS.length]!, scores: [1, 0.8], accepted: ['leaf'] },
        { ungatedPairCount: 1 },
      ),
    );
    const reading = readTerm(
      rows,
      scoreTable(names.map((name) => [name, 1, 0.8, true] as const)),
      new Map(rows.map((row) => [row.datapack, ['leaf']])),
      1,
    );
    expect(reading.population.fusion).toBe(12);
    expect(reading.population.ungated).toBe(12);
    expect(reading.population.shared).toBe(12);
  });
});

describe('the reach census', () => {
  it('records a lift that reaches past the runner-up, which an adjacent swap cannot do', () => {
    // Three candidates: `top` is the fusion's first, `mid` second, `low` third, and `mid` calls `low`. The pair
    // (mid, low) qualifies on the cases where the callee's excursion is the larger, so `low` is paid δ — and with
    // δ larger than the 0.2 between `top` and `low` the published head changes from rank 3. That is precisely the
    // move a swap of adjacent positions cannot make, and the census is what prices it.
    const rows: ContainmentCaseRow[] = [];
    const scoreRows: (readonly [string, number, number, boolean])[] = [];
    for (const fold of ['a', 'b'] as const) {
      for (const [index, name] of namesFor(fold, 12).entries()) {
        const pattern = EXCURSIONS[index % EXCURSIONS.length]!;
        rows.push({
          datapack: name,
          faultType: 'PodKill',
          sigma: 3,
          margin: 0,
          fusionTop1: 'top',
          gatedTop1: 'top',
          ungatedTop1: 'top',
          shippedTop1: 'top',
          replay: 'identical',
          pairs: [],
          ungatedPairs: [],
          chain: {
            order: ['top', 'mid', 'low'],
            edges: [
              ['top', 'mid'],
              ['mid', 'low'],
            ],
            excursions: { top: 0, mid: pattern[0], low: pattern[1] },
            failedInterfaces: {},
            flows: {},
            failingEdges: {},
            attribution: 'count',
          },
        } as unknown as ContainmentCaseRow);
        scoreRows.push([name, 1, 0.9, true]);
      }
    }
    const scores = new Map(
      scoreRows.map(([name]) => [
        name,
        new Map([
          ['top', 1],
          ['mid', 0.9],
          ['low', 0.8],
        ]),
      ]),
    );
    const promoted = readTerm(rows, scores, new Map(rows.map((row) => [row.datapack, ['low']])), 1);
    expect(promoted.reach).toEqual([{ rank: 3, gains: 4, losses: 0 }]);
    expect(promoted.arms.graded.gains).toBe(4);
    // Sixteen pairs qualify. Four are on `mid → low` (the `[0,1]` rows, the callee further out) and twelve on
    // `top → mid` — the eight `[1,1]` rows and the four `[1,0]` ones, where `mid` is out while `top` never is.
    // Only the first edge is fitted: `top` is never out of band, its marginal is degenerate, and φ is undefined
    // there, which is why the twelve `top → mid` pairs are unfitted and pay nothing.
    expect(promoted.census.qualified).toBe(16);
    expect(promoted.census.unfitted).toBe(12);
    expect(promoted.census.paid).toBe(4);

    const wrong = readTerm(rows, scores, new Map(rows.map((row) => [row.datapack, ['top']])), 1);
    expect(wrong.reach).toEqual([{ rank: 3, gains: 0, losses: 4 }]);
    expect(wrong.arms.graded.losses).toBe(4);
  });

  it('omits a rank whose promotions changed no answer, because a bet that was not placed is not a price', () => {
    const { rows, scores, accepted } = corpus();
    const reading = readTerm(rows, scores, accepted, 1);
    // Only rank 2 was reachable in this fixture and every promotion there was right, so the census has one row —
    // not a row per rank in the corpus.
    expect(reading.reach).toEqual([{ rank: 2, gains: 4, losses: 0 }]);
  });
});

describe('a corpus that promotes at two distances', () => {
  it('sorts the reach census by rank and counts each distance separately', () => {
    // Two row shapes in one corpus: a two-candidate case where the promotion reaches rank 2, and a three-candidate
    // case where it reaches rank 3 past the runner-up. The census has to keep them apart — the finding of this
    // iteration is that the two distances are not the same bet — and sorting them is the only code that has to run
    // for that to be true.
    const rows: ContainmentCaseRow[] = [];
    const scoreRows: (readonly [string, number, number, boolean])[] = [];
    // The answer follows the shape: the deep case's truth is the candidate the lift reaches, and the shallow
    // case's is the runner-up. Without that, a shallow row would be wrong before and after its promotion and the
    // census would drop it — which is correct behaviour and a bad fixture.
    const answers = new Map<string, readonly string[]>();
    for (const fold of ['a', 'b'] as const) {
      // Twenty-four per half, so each shape contributes twelve observations to its own edge: the residual module's
      // floor is ten, and a fixture that split twelve cases between two edges would fit neither of them and then
      // report a corpus in which the term was silent for want of data.
      for (const [index, name] of namesFor(fold, 24).entries()) {
        const pattern = EXCURSIONS[index % EXCURSIONS.length]!;
        // Split by BLOCK rather than by parity: `index % 6` cycles the configurations, so an odd/even split would
        // give one shape the configurations at 1, 3 and 5 and never the one at 4 — the only one that qualifies —
        // and the fixture would report a corpus in which half the cases could not be promoted.
        const deep = index < 12;
        rows.push({
          datapack: name,
          faultType: 'PodKill',
          sigma: 3,
          margin: 0,
          fusionTop1: 'top',
          gatedTop1: 'top',
          ungatedTop1: 'top',
          shippedTop1: 'top',
          replay: 'identical',
          pairs: [],
          ungatedPairs: [],
          chain: deep
            ? {
                order: ['top', 'mid', 'low'],
                edges: [['mid', 'low']],
                excursions: { top: 0, mid: pattern[0], low: pattern[1] },
                failedInterfaces: {},
                flows: {},
                failingEdges: {},
                attribution: 'count',
              }
            : {
                order: ['top', 'mid'],
                edges: [['top', 'mid']],
                excursions: { top: pattern[0], mid: pattern[1] },
                failedInterfaces: {},
                flows: {},
                failingEdges: {},
                attribution: 'count',
              },
        } as unknown as ContainmentCaseRow);
        scoreRows.push([name, 1, 0.8, true]);
        answers.set(name, [deep ? 'low' : 'mid']);
      }
    }
    const scores = new Map(
      scoreRows.map(([name, , mid]) => [
        name,
        new Map([
          ['top', 1],
          ['mid', mid],
          ['low', 0.8],
        ]),
      ]),
    );
    const reading = readTerm(rows, scores, answers, 1);
    // Both distances produced promotions, and the census lists them in rank order.
    expect(reading.reach.map((entry) => entry.rank)).toEqual([2, 3]);
    // Twelve rows per shape per half is two six-row cycles, so `[0,1]` — the one configuration whose callee is
    // out alone — occurs twice per shape per half and four times over both.
    expect(reading.reach).toEqual([
      { rank: 2, gains: 4, losses: 0 },
      { rank: 3, gains: 4, losses: 0 },
    ]);
  });
});

describe('a case an arm answered with nothing', () => {
  it('drops a case whose published order is empty from every column at once', () => {
    // An empty order is not a wrong answer: the engine could not score the case at all. `answerOf` returns no head
    // and no verdict, the guard drops the case from the four arms together, and the case still counts as walked —
    // because the walk happened and only the answer is missing.
    const names = namesFor('a', 12);
    const rows = names.map((name, index) =>
      caseRow(
        name,
        { excursion: EXCURSIONS[index % EXCURSIONS.length]!, scores: [1, 0.8], accepted: ['hub'] },
        { order: [] },
      ),
    );
    const reading = readTerm(
      rows,
      scoreTable(names.map((name) => [name, 1, 0.8, true] as const)),
      new Map(rows.map((row) => [row.datapack, ['hub']])),
      1,
    );
    expect(reading.replayable).toBe(12);
    expect(reading.arms.fusion.top1).toBe(0);
    expect(reading.arms.graded.top1).toBe(0);
    expect(reading.reach).toEqual([]);
  });
});
