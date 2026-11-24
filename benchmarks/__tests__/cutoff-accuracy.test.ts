import { describe, expect, it } from 'vitest';

import {
  acAt,
  avgAt,
  censusPopulations,
  chanceAt,
  chanceAverageOf,
  cutoffTable,
  decompositionAt,
  formatCutoffs,
  formatDecomposition,
  hitRank,
  liftOf,
  parseCensusLine,
  publishedRate,
  readCutoffs,
  uniformFloor,
  type CutoffCase,
} from '../src/cutoff-accuracy.js';

/** A case whose first hit sits at `rank`, in a pool of `pool`. */
function at(caseId: string, cell: string, rank: number | null, pool = 10): CutoffCase {
  return { caseId, cell, hitRank: rank, pool };
}

describe('the rank a case first hits', () => {
  it('counts positions from one and stops at the first accepted answer', () => {
    expect(hitRank(['a', 'b', 'c'], ['c'])).toBe(3);
    // The first hit wins even when a later position also hits: the metric is a rank, not a count.
    expect(hitRank(['a', 'b', 'c'], ['b', 'c'])).toBe(2);
  });

  it('returns null when the answer appears nowhere in the order', () => {
    expect(hitRank(['a', 'b'], ['z'])).toBeNull();
    expect(hitRank([], ['z'])).toBeNull();
  });

  it('returns null when the accepted set is empty, so an unlabelled case cannot be scored as a hit', () => {
    expect(hitRank(['a', 'b'], [])).toBeNull();
  });
});

describe('AC@k', () => {
  it('is the indicator of the answer being inside the first k positions', () => {
    expect(acAt(1, 1)).toBe(1);
    expect(acAt(1, 5)).toBe(1);
    expect(acAt(5, 5)).toBe(1);
    expect(acAt(6, 5)).toBe(0);
  });

  it('is zero for an absent answer at every cutoff, and for a rank below the first position', () => {
    for (let k = 1; k <= 5; k += 1) expect(acAt(null, k)).toBe(0);
    expect(acAt(0, 5)).toBe(0);
    expect(acAt(-1, 5)).toBe(0);
  });

  it('refuses a cutoff that is not a positive integer rather than shifting every row silently', () => {
    for (const bad of [0, -1, 2.5, Number.NaN])
      expect(() => acAt(1, bad)).toThrow(/positive integer/);
  });
});

describe('Avg@k', () => {
  it('is the mean of the cutoffs it is defined as the mean of', () => {
    expect(avgAt(1, 5)).toBe(1);
    expect(avgAt(2, 5)).toBeCloseTo(0.8, 12);
    expect(avgAt(3, 5)).toBeCloseTo(0.6, 12);
    expect(avgAt(5, 5)).toBeCloseTo(0.2, 12);
    expect(avgAt(6, 5)).toBe(0);
    expect(avgAt(null, 5)).toBe(0);
  });

  it('agrees with the closed form max(0, k + 1 - rank) / k wherever both are defined', () => {
    for (let k = 1; k <= 6; k += 1) {
      for (let rank = 1; rank <= k + 3; rank += 1) {
        expect(avgAt(rank, k)).toBeCloseTo(Math.max(0, k + 1 - rank) / k, 12);
      }
    }
  });

  it('refuses the same cutoffs AC@k refuses', () => {
    expect(() => avgAt(1, 0)).toThrow(/positive integer/);
  });
});

describe('the inequality a competitor comparison rests on', () => {
  /**
   * `Avg@k >= AC@1` for every rank and every cutoff, because `AC@1` is the first term of the mean it averages.
   * A method that publishes only its cutoff average therefore publishes an UPPER BOUND on its `AC@1`, and that is
   * the whole basis on which a `Avg@5`-only competitor can be compared with an `AC@1`-only system without any
   * protocol assumption. The property is asserted rather than reasoned about because this is the one claim every
   * external comparison in the register leans on.
   */
  it('holds for every rank and every cutoff, and the average never exceeds the widest cut', () => {
    for (let k = 1; k <= 8; k += 1) {
      for (let rank = 1; rank <= k + 4; rank += 1) {
        // The sandwich AC@k >= Avg@k >= AC@1, which is what makes a cutoff average an upper bound on AC@1 and a
        // lower bound on AC@k at once.
        expect(avgAt(rank, k)).toBeGreaterThanOrEqual(acAt(rank, 1));
        expect(avgAt(rank, k)).toBeLessThanOrEqual(acAt(rank, k));
      }
      expect(avgAt(1, k)).toBe(acAt(1, k));
      // An absent answer is zero on both, which is the case that keeps the inequality from being strict everywhere.
      expect(avgAt(null, k)).toBe(acAt(null, 1));
    }
  });

  it('holds over a population, which is where a comparison actually reads it', () => {
    const population = [at('a', 'X', 1), at('b', 'X', 2), at('c', 'X', 4), at('d', 'X', null)];
    const reading = readCutoffs(population, 5);
    expect(reading.avg).toBeGreaterThanOrEqual(reading.ac[0]!);
  });
});

describe('the floor a random order pays', () => {
  it('equals the enumeration of the metric over every rank the pool allows', () => {
    for (const k of [1, 2, 5]) {
      for (const pool of [1, 2, 4, 6, 10, 64]) {
        let total = 0;
        for (let rank = 1; rank <= pool; rank += 1) total += avgAt(rank, k);
        expect(uniformFloor(k, pool)).toBeCloseTo(total / pool, 12);
      }
    }
  });

  it('collapses to (k + 1) / (2n) once the pool is at least as large as the cutoff', () => {
    expect(uniformFloor(5, 64)).toBeCloseTo(6 / 128, 12);
    expect(uniformFloor(5, 6)).toBeCloseTo(0.5, 12);
    expect(uniformFloor(1, 10)).toBeCloseTo(0.1, 12);
  });

  it('pays most of itself when the pool is smaller than the cutoff — which is why the floor must be quoted', () => {
    // A four-candidate pool: every rank is inside the first five, so only the cutoffs' own weights remain.
    expect(uniformFloor(5, 4)).toBeCloseTo(0.7, 12);
    // (1 + 2 + 2 + 2 + 2) / (2 × 5) — only the first two cutoffs can be empty.
    expect(uniformFloor(5, 2)).toBeCloseTo(0.9, 12);
    expect(uniformFloor(5, 1)).toBeCloseTo(1, 12);
  });

  it('refuses a pool that is not a positive integer', () => {
    for (const bad of [0, -3, 2.5]) expect(() => uniformFloor(5, bad)).toThrow(/positive integer/);
    expect(() => uniformFloor(0, 10)).toThrow(/positive integer/);
  });
});

describe('a population', () => {
  it('reads each cutoff at the population level and the average as the mean of the per-case averages', () => {
    const population = [at('a', 'X', 1), at('b', 'X', 2), at('c', 'X', 3), at('d', 'X', null)];
    const reading = readCutoffs(population, 5);
    expect(reading.cases).toBe(4);
    expect(reading.ac).toEqual([0.25, 0.5, 0.75, 0.75, 0.75]);
    // (1 + 0.8 + 0.6 + 0) / 4 — the absent case contributes zero rather than being dropped from the denominator.
    expect(reading.avg).toBeCloseTo(0.6, 12);
    expect(reading.absent).toBe(1);
  });

  it('averages the floor over the cases rather than assuming one pool for the corpus', () => {
    const reading = readCutoffs([at('a', 'X', 1, 4), at('b', 'X', 1, 64)], 5);
    expect(reading.floor).toBeCloseTo((uniformFloor(5, 4) + uniformFloor(5, 64)) / 2, 12);
  });

  it('reads an empty population as zeros rather than as a division by zero', () => {
    const reading = readCutoffs([], 5);
    expect(reading).toEqual({
      k: 5,
      cases: 0,
      ac: [0, 0, 0, 0, 0],
      avg: 0,
      floor: 0,
      lift: 0,
      absent: 0,
    });
  });

  it('refuses a cutoff it cannot read', () => {
    expect(() => readCutoffs([], 0)).toThrow(/positive integer/);
  });
});

describe('a corpus of cells', () => {
  // The two cells differ in size by four to one, which is what separates a case-weighted pool from a mean of means.
  const corpus = [
    at('a', 'B', 1),
    at('b', 'B', 1),
    at('c', 'B', 1),
    at('d', 'B', 1),
    at('e', 'A', 6),
  ];

  it('pools over the cases, so a small cell cannot weigh as much as a large one', () => {
    const table = cutoffTable(corpus, 5);
    expect(table.cells.map((one) => one.cell)).toEqual(['A', 'B']);
    expect(table.pooled.cases).toBe(5);
    // Four hits out of five, not the mean of the two cells' 0 and 1.
    expect(table.pooled.ac[0]).toBeCloseTo(0.8, 12);
    expect(table.pooled.avg).toBeCloseTo(4 / 5, 12);
  });

  it('reads each cell on its own population', () => {
    const table = cutoffTable(corpus, 5);
    const a = table.cells.find((one) => one.cell === 'A')!;
    expect(a.cases).toBe(1);
    expect(a.avg).toBe(0);
    expect(a.absent).toBe(0);
    const b = table.cells.find((one) => one.cell === 'B')!;
    expect(b.avg).toBe(1);
  });

  it('orders the cells by name rather than by first appearance', () => {
    const table = cutoffTable([at('z', 'Z', 1), at('a', 'A', 1)], 3);
    expect(table.cells.map((one) => one.cell)).toEqual(['A', 'Z']);
  });

  it('refuses a cutoff it cannot read', () => {
    expect(() => cutoffTable(corpus, 1.5)).toThrow(/positive integer/);
  });
});

describe('the rendering', () => {
  it('prints a column per cutoff, the average, the floor and the absent count', () => {
    const text = formatCutoffs(
      cutoffTable([at('a', 'RE1:SockShop', 2, 10), at('b', 'RE1:SockShop', null, 10)], 5),
    );
    expect(text).toContain('AC@1');
    expect(text).toContain('AC@5');
    expect(text).toContain('floor');
    expect(text).toContain('abs');
    expect(text).toContain('RE1:SockShop');
    expect(text).toContain('pooled');
    // One hit at rank two of two cases: AC@1 = 0.0 %, AC@2 = 50.0 %, Avg@5 = (0+0.5+0.5+0.5+0.5)/5 = 0.4.
    const cellLine = text.split('\n').find((line) => line.startsWith('RE1:SockShop'))!;
    expect(cellLine).toContain('0.0 %'.padStart(7));
    expect(cellLine).toContain('50.0 %');
    expect(cellLine).toContain('40.0 %');
    expect(cellLine).toContain('  1');
  });

  it('prints one cutoff column for a k of one, so the header is not hard-coded to five', () => {
    const text = formatCutoffs(cutoffTable([at('a', 'X', 1)], 1));
    expect(text).toContain('AC@1');
    expect(text).not.toContain('AC@2');
  });
});

describe('the census reader', () => {
  const good = {
    caseId: 'rcaeval-re1_re1ob_adservice_cpu_1',
    cell: 'RE1:OnlineBoutique',
    truthRank: 1,
    pool: 4,
    correct: true,
  };

  it('reads the five fields both metrics need, and nothing it does not', () => {
    expect(parseCensusLine(JSON.stringify(good), 1)).toEqual({
      caseId: 'rcaeval-re1_re1ob_adservice_cpu_1',
      cell: 'RE1:OnlineBoutique',
      hitRank: 1,
      pool: 4,
      correct: true,
      rankMeasured: true,
    });
  });

  it('reads a null rank as absent rather than as a rank of zero', () => {
    const row = parseCensusLine(JSON.stringify({ ...good, truthRank: null, correct: false }), 2);
    expect(row.hitRank).toBeNull();
    expect(row.rankMeasured).toBe(true);
  });

  it('marks a row with no truthRank column as UNMEASURED, which is not the same as absent', () => {
    // The real artifact has nine such rows, and scoring them as misses would understate every cutoff.
    const { truthRank: _dropped, ...rest } = good;
    const row = parseCensusLine(JSON.stringify(rest), 15);
    expect(row).toMatchObject({ hitRank: null, rankMeasured: false });
    // A row whose order was never written can still have a right ANSWER, so the two columns do not contradict.
    expect(row.correct).toBe(true);
  });

  it('refuses a line that is not a JSON object', () => {
    expect(() => parseCensusLine('not json', 3)).toThrow(/not JSON/);
    expect(() => parseCensusLine('[1,2]', 4)).toThrow(/not an object/);
    expect(() => parseCensusLine('null', 5)).toThrow(/not an object/);
  });

  it('refuses a line that is missing a field rather than defaulting it', () => {
    for (const key of ['caseId', 'cell', 'pool', 'correct']) {
      const { [key as keyof typeof good]: _dropped, ...rest } = good;
      expect(() => parseCensusLine(JSON.stringify(rest), 6)).toThrow(new RegExp(`has no .?${key}`));
    }
  });

  it('refuses an empty or non-string identity, because a refusal has to be able to name its row', () => {
    expect(() => parseCensusLine(JSON.stringify({ ...good, caseId: '' }), 7)).toThrow(/no caseId/);
    expect(() => parseCensusLine(JSON.stringify({ ...good, caseId: 7 }), 8)).toThrow(/no caseId/);
    expect(() => parseCensusLine(JSON.stringify({ ...good, cell: '' }), 9)).toThrow(/no cell/);
    expect(() => parseCensusLine(JSON.stringify({ ...good, cell: null }), 10)).toThrow(/no cell/);
  });

  it('refuses a rank that is not a positive integer', () => {
    for (const bad of [0, -2, 1.5, '1']) {
      expect(() => parseCensusLine(JSON.stringify({ ...good, truthRank: bad }), 11)).toThrow(
        /unusable truthRank/,
      );
    }
  });

  it('refuses a pool the floor cannot divide by', () => {
    for (const bad of [0, -1, 2.5, null]) {
      expect(() => parseCensusLine(JSON.stringify({ ...good, pool: bad }), 12)).toThrow(
        /no usable pool/,
      );
    }
  });

  it('refuses a line whose two columns contradict each other', () => {
    expect(() =>
      parseCensusLine(JSON.stringify({ ...good, truthRank: null, correct: true }), 13),
    ).toThrow(/correct on an answer the order does not contain/);
    expect(() => parseCensusLine(JSON.stringify({ ...good, correct: 'yes' }), 14)).toThrow(
      /boolean/,
    );
  });
});

describe('the two populations of a census', () => {
  it('keeps an unmeasured row out of the order population and counts it', () => {
    const measured = parseCensusLine(
      JSON.stringify({ caseId: 'a', cell: 'X', truthRank: 1, pool: 5, correct: true }),
      1,
    );
    const unmeasured = parseCensusLine(
      JSON.stringify({ caseId: 'b', cell: 'X', pool: 5, correct: false }),
      2,
    );
    const split = censusPopulations([measured, unmeasured]);
    expect(split.measured.map((one) => one.caseId)).toEqual(['a']);
    expect(split.unmeasured).toBe(1);
  });
});

describe('the answer rate, as distinct from the order rate', () => {
  const rows = [
    parseCensusLine(
      JSON.stringify({ caseId: 'a', cell: 'X', truthRank: 1, pool: 5, correct: true }),
      1,
    ),
    parseCensusLine(
      JSON.stringify({ caseId: 'b', cell: 'X', truthRank: 2, pool: 5, correct: true }),
      2,
    ),
    parseCensusLine(
      JSON.stringify({ caseId: 'c', cell: 'X', truthRank: 3, pool: 5, correct: false }),
      3,
    ),
  ];

  it('counts the published answer, which can be right on a case the order ranked second', () => {
    expect(publishedRate(rows)).toEqual({ cases: 3, correct: 2, rate: 2 / 3 });
    // The order's own AC@1 is lower by exactly that case, which is why both are printed.
    expect(readCutoffs(rows, 1).ac[0]).toBeCloseTo(1 / 3, 12);
  });

  it('reads an empty census as zero rather than as a division by zero', () => {
    expect(publishedRate([])).toEqual({ cases: 0, correct: 0, rate: 0 });
  });
});

describe('the retrieval-rerank decomposition', () => {
  const cases = [at('a', 'c', 1), at('b', 'c', 2), at('c', 'c', 4), at('d', 'c', null)];

  it('separates "never retrieved" from "retrieved but ranked too low"', () => {
    const reading = decompositionAt(cases, 5);
    expect(reading.cases).toBe(4);
    expect(reading.retrieved).toBe(3);
    expect(reading.retrieval).toBeCloseTo(0.75, 10);
    expect(reading.rerank).toBeCloseTo(1 / 3, 10);
  });

  it('is an identity, not a second measurement: AC@1 equals retrieval times rerank', () => {
    for (const k of [1, 2, 3, 4, 5]) {
      const reading = decompositionAt(cases, k);
      const ac1 = cases.reduce((sum, one) => sum + acAt(one.hitRank, 1), 0) / cases.length;
      expect(reading.retrieval * reading.rerank).toBeCloseTo(ac1, 10);
    }
  });

  it('reads the rerank rate as one at k = 1, where everything retrieved is first by definition', () => {
    // Not a degenerate case to be smoothed over: at k = 1 the retrieved population IS the hits, so the conditional
    // rate is 1 and the ONLY failure mode left is retrieval. That is exactly what the split is for.
    const reading = decompositionAt(cases, 1);
    expect(reading.retrieved).toBe(1);
    expect(reading.rerank).toBeCloseTo(1, 10);
    expect(reading.retrieval).toBeCloseTo(0.25, 10);
  });

  it('reads an all-absent corpus as zero retrieval and zero rerank, not as NaN', () => {
    const reading = decompositionAt([at('a', 'c', null), at('b', 'c', null)], 5);
    expect(reading).toMatchObject({ retrieved: 0, retrieval: 0, rerank: 0 });
  });

  it('reads an empty corpus as zero rather than dividing by it', () => {
    expect(decompositionAt([], 5)).toMatchObject({
      cases: 0,
      retrieved: 0,
      retrieval: 0,
      rerank: 0,
    });
  });

  it('refuses a cutoff below one, like every other reader here', () => {
    expect(() => decompositionAt(cases, 0)).toThrow(/cutoff/);
  });

  it('names both numbers and the population they are over', () => {
    const text = formatDecomposition(decompositionAt(cases, 5));
    expect(text).toContain('Retrieval@5');
    expect(text).toContain('75.0 %');
    expect(text).toContain('33.3 %');
    expect(text).toContain('4 cases');
  });

  it('says the rerank rate is undefined when nothing was retrieved, instead of printing 0 %', () => {
    const text = formatDecomposition(decompositionAt([at('a', 'c', null)], 5));
    expect(text).toContain('no candidate was retrieved');
  });
});

describe('the chance baseline the evaluator now prints', () => {
  it('is min(k, n) / n for a case whose pool could hold its answer', () => {
    expect(chanceAt(1, 5, true)).toBeCloseTo(1 / 5, 12);
    expect(chanceAt(3, 5, true)).toBeCloseTo(3 / 5, 12);
    // Beyond the pool the cutoff cannot reach any more of it, so the chance stops rising.
    expect(chanceAt(9, 5, true)).toBe(1);
  });

  it('is zero for a case whose answer was never in the pool, at every cutoff', () => {
    for (const k of [1, 2, 5, 9]) expect(chanceAt(k, 10, false)).toBe(0);
  });

  it('is the closed form `uniformFloor` whenever every case is in its pool', () => {
    for (const pool of [4, 6, 12, 49])
      expect(chanceAverageOf([at('a', 'c', 2, pool)], 5)).toBeCloseTo(uniformFloor(5, pool), 12);
  });

  it('averages over the cuts, which is what the evaluator labels `Chance@5`', () => {
    // n = 4: AC chances are 1/4, 2/4, 3/4, 4/4, 4/4 -- the mean is 0.70, and that is the number the field prints.
    expect(chanceAverageOf([at('a', 'c', 1, 4)], 5)).toBeCloseTo(0.7, 12);
    // Two cases: the mean of the per-case averages, never the average of a nominal pool size.
    const mixed = [at('a', 'c', 1, 4), at('b', 'c', 1, 6)];
    expect(chanceAverageOf(mixed, 5)).toBeCloseTo((0.7 + 0.5) / 2, 12);
  });

  it('charges an absent case nothing, so the same corpus reads a LOWER floor with it than without', () => {
    const inPool = [at('a', 'c', 1, 4), at('b', 'c', 2, 4)];
    const withAbsent = [...inPool, at('z', 'c', null, 4)];
    expect(chanceAverageOf(inPool, 5)).toBeCloseTo(0.7, 12);
    // 2 x 0.70 + 0 over three cases: an answer the pool never held cannot be found by any order over it.
    expect(chanceAverageOf(withAbsent, 5)).toBeCloseTo(1.4 / 3, 12);
  });

  it('refuses a pool that is not a positive integer, like every other reader here', () => {
    for (const pool of [0, -1, 2.5]) expect(() => chanceAt(1, pool, true)).toThrow(/pool/);
  });

  it('reads an empty population as zero rather than dividing by it', () => {
    expect(chanceAverageOf([], 5)).toBe(0);
  });
});

describe('the reading states its own baseline', () => {
  const cases = [at('a', 'c', 1, 4), at('b', 'c', 3, 4), at('z', 'c', null, 4), at('d', 'c', 9, 4)];

  it('computes the floor as the chance average over the SAME cases, not as a second formula', () => {
    for (const k of [1, 2, 3, 4, 5]) {
      expect(readCutoffs(cases, k).floor).toBeCloseTo(chanceAverageOf(cases, k), 12);
    }
  });

  it('reports the lift as an EXCESS and not as a multiple, which is what the field prints', () => {
    const reading = readCutoffs(cases, 5);
    expect(liftOf(reading)).toBeCloseTo(reading.avg - reading.floor, 12);
    // A ratio would be a different number, and printing one under the field's label would be a quiet redefinition.
    const ratio = reading.avg / reading.floor;
    expect(ratio).not.toBeCloseTo(liftOf(reading), 6);
  });

  it('reads a population that does nothing as zero lift, not as a negative one', () => {
    // Every case absent: the metric is 0 and the floor is 0, so the excess is 0 rather than NaN.
    const reading = readCutoffs([at('a', 'c', null, 4)], 5);
    expect(reading.avg).toBe(0);
    expect(reading.floor).toBe(0);
    expect(liftOf(reading)).toBe(0);
  });

  it('prints the chance and the lift beside the average, so a cell cannot be quoted without its floor', () => {
    const text = formatCutoffs(cutoffTable(cases, 5));
    expect(text).toContain('Chance');
    expect(text).toContain('Lift');
    expect(text).toContain('floor');
    for (const line of text.split('\n').slice(1))
      expect(line.split(/\s+/).length).toBeGreaterThan(6);
  });
});
