/**
 * The score-gap census: a re-scorable instrument for the claim `docs/rank-depth.md` §5 makes about the
 * first/second score margin.
 *
 * ## The defect this module exists to prevent
 *
 * §5 was written on 2026-11-20 against an engine that answered 1 141 of 1 422 cases at rank 1. It records a
 * "calibration curve" over the relative gap `(s₁ − s₂)/|s₁|`: 103 cases below 0.02, 19.4 % accurate, with the
 * truth twice as often at rank 3 as at rank 2 — the "twin" premise `ENGINE_AXES_DESIGN_PLAN.md` item 3 built a
 * run-off on. None of that table carries the artifact it was read from, so when the shipped engine moved to
 * 1 192 rank-1 answers the table could neither be re-scored nor refuted: it was a number with no owner.
 *
 * Two distinct confusions are pinned here rather than trusted:
 *
 * 1. **published order is not score order.** The verdict row carries `top1Score`/`top2Score` for the two
 *    candidates the run PLACED first and second, and two relational passes permute a finished list. On the
 *    shipped artifact 217 of 1 422 rows have `top2Score > top1Score`, so a relative gap over the published pair
 *    is negative — not a "close call" but evidence the order was permuted. Treating that as a small gap is the
 *    exact category error §5's table invites.
 * 2. **the stratum is a property of the artifact, not of the plan.** The census takes the scored rows as data
 *    and returns the band histogram, the sub-0.02 truth-rank histogram, the twin direction and the negative-gap
 *    count. A caller that plans a run-off must read the direction from the artifact; it may not assert it from a
 *    document written against a different engine.
 *
 * @module benchmarks/__tests__/score-gap-census
 */

import { describe, expect, it } from 'vitest';

import {
  BAND_EDGES,
  STRATUM_GAP,
  bandOf,
  buildCensus,
  relativeGap,
  twinDirection,
  type GapBand,
  type ScoredGap,
} from '../src/score-gap-census.js';

/** A row is the only shape the census needs: the published pair and where the truth actually sat. */
function row(top1Score: number, top2Score: number, truthRank: number): ScoredGap {
  return { top1Score, top2Score, truthRank };
}

describe('relativeGap', () => {
  it('returns a non-negative gap when the published leader also leads on score', () => {
    expect(relativeGap(row(1, 0.5, 1))).toBeCloseTo(0.5);
  });

  it('returns a NEGATIVE gap when the relational passes placed a lower score first', () => {
    // The defect §5's table hides: the order is not a function of the scores.
    expect(relativeGap(row(1, 2, 1))).toBeCloseTo(-1);
  });

  it('normalises by |s1| so a negative leader still yields a bounded relative gap', () => {
    expect(relativeGap(row(-2, -1, 1))).toBeCloseTo(-0.5);
  });

  it('returns Infinity when the published leader scored exactly zero (no finite ratio)', () => {
    expect(relativeGap(row(0, 0, 1))).toBe(Number.POSITIVE_INFINITY);
    expect(relativeGap(row(0, -1, 1))).toBe(Number.POSITIVE_INFINITY);
  });

  it('refuses a non-finite score rather than letting NaN into a band', () => {
    expect(() => relativeGap(row(Number.NaN, 1, 1))).toThrow(/finite/);
    expect(() => relativeGap(row(1, Number.POSITIVE_INFINITY, 1))).toThrow(/finite/);
  });
});

describe('bandOf', () => {
  it('places a gap exactly on an edge in the band that starts at that edge', () => {
    expect(bandOf(0)).toBe(0);
    expect(bandOf(0.005)).toBe(1);
    // 0.02 starts the band [0.020, 0.050), index 3 — not the [0.010, 0.020) band that ends at it.
    expect(bandOf(0.02)).toBe(3);
    expect(bandOf(0.3)).toBe(6);
  });

  it('places a negative gap in the sentinel band (-1), never in the calibration bands', () => {
    expect(bandOf(-0.0001)).toBe(-1);
    expect(bandOf(-1)).toBe(-1);
  });

  it('clamps a gap at or above the last finite edge into the open top band', () => {
    expect(bandOf(BAND_EDGES[BAND_EDGES.length - 1]! + 10)).toBe(BAND_EDGES.length);
    expect(bandOf(Number.POSITIVE_INFINITY)).toBe(BAND_EDGES.length);
  });

  it('refuses NaN', () => {
    expect(() => bandOf(Number.NaN)).toThrow(/NaN/);
  });
});

describe('buildCensus', () => {
  it('counts every row in exactly one bucket: the bands, or the negative sentinel', () => {
    const rows = [
      row(1, 0.999, 1), // gap 0.001 → band 0
      row(1, 0.99, 2), // gap 0.01 → band 2
      row(1, 0.5, 1), // gap 0.5 → band 6
      row(1, 2, 1), // gap -1 → sentinel
    ];
    const c = buildCensus(rows);
    const banded = c.bands.reduce((n, b) => n + b.cases, 0);
    expect(banded + c.negativeGaps).toBe(rows.length);
    expect(c.total).toBe(rows.length);
  });

  it('computes top-1 and accuracy per band from the truth rank', () => {
    const c = buildCensus([row(1, 0.999, 1), row(1, 0.999, 3), row(1, 0.5, 1), row(1, 0.5, 5)]);
    expect(c.bands[0]).toMatchObject({ cases: 2, top1: 1, accuracy: 0.5 });
    expect(c.bands[6]).toMatchObject({ cases: 2, top1: 1, accuracy: 0.5 });
  });

  it('counts a zero truthRank as absent, never as a top-1 hit', () => {
    const c = buildCensus([row(1, 0.999, 0), row(1, 0.999, 1)]);
    expect(c.bands[0]!.top1).toBe(1);
    expect(c.bands[0]!.cases).toBe(2);
  });

  it('restricts the truth-rank histogram to the sub-0.02 stratum', () => {
    // gap 0.01 (in stratum, truth rank 3), gap 0.05 (out), gap 0.001 (in, rank 2), gap 0.9 (out).
    const c = buildCensus([row(1, 0.99, 3), row(1, 0.95, 1), row(1, 0.999, 2), row(1, 0.1, 1)]);
    expect(c.stratum.cases).toBe(2);
    expect(c.stratum.top1).toBe(0);
    expect(c.stratum.ranks[2]).toBe(1);
    expect(c.stratum.ranks[3]).toBe(1);
  });

  it('excludes negative-gap rows from the stratum entirely', () => {
    // A permuted order with a "small" absolute difference must not enter the calibration stratum.
    const c = buildCensus([row(1, 0.999, 2), row(1, 1.001, 3)]);
    expect(c.stratum.cases).toBe(1);
    expect(c.negativeGaps).toBe(1);
    expect(c.stratum.ranks[3]).toBe(0);
  });

  it('buckets an in-stratum deep truth and an absent truth into their own counters', () => {
    const c = buildCensus([row(1, 0.999, 9), row(1, 0.999, 0)]);
    expect(c.stratum.ranks.deeper).toBe(1);
    expect(c.stratum.ranks.absent).toBe(1);
    expect(c.stratum.top1).toBe(0);
  });

  it('buckets every in-stratum rank 1 through 5 into its own counter', () => {
    const c = buildCensus([
      row(1, 0.999, 1),
      row(1, 0.999, 2),
      row(1, 0.999, 3),
      row(1, 0.999, 4),
      row(1, 0.999, 5),
    ]);
    expect([
      c.stratum.ranks[1],
      c.stratum.ranks[2],
      c.stratum.ranks[3],
      c.stratum.ranks[4],
      c.stratum.ranks[5],
    ]).toEqual([1, 1, 1, 1, 1]);
  });

  it('reports band labels and edges from one vocabulary', () => {
    const c = buildCensus([row(1, 0.5, 1)]);
    expect(c.bands).toHaveLength(BAND_EDGES.length + 1);
    const labels: readonly GapBand['label'][] = c.bands.map((b) => b.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(c.bands[0]!.label).toContain('0.000');
    expect(c.bands[c.bands.length - 1]!.label).toContain('inf');
  });

  it('keeps STRATUM_GAP as the single owner of the sub-0.02 cutoff', () => {
    expect(STRATUM_GAP).toBe(0.02);
    const at = buildCensus([row(1, 1 - STRATUM_GAP, 1)]);
    const justBelow = buildCensus([row(1, 1 - STRATUM_GAP + 1e-9, 1)]);
    expect(at.stratum.cases).toBe(0); // gap exactly 0.02 is band 3 [0.020,0.050), not the sub-0.02 stratum
    expect(justBelow.stratum.cases).toBe(1);
  });
});

describe('twinDirection', () => {
  it('reports twin-at-rank-3 when rank 3 outnumbers rank 2 in the stratum (the §5 premise)', () => {
    const c = buildCensus([row(1, 0.999, 2), row(1, 0.999, 3), row(1, 0.999, 3)]);
    expect(twinDirection(c)).toBe('rank3');
  });

  it('reports twin-at-rank-2 when rank 2 outnumbers rank 3 (the shipped artifact)', () => {
    const c = buildCensus([row(1, 0.999, 2), row(1, 0.999, 2), row(1, 0.999, 3)]);
    expect(twinDirection(c)).toBe('rank2');
  });

  it('reports none when the stratum is empty or the two ranks tie', () => {
    expect(twinDirection(buildCensus([]))).toBe('none');
    expect(twinDirection(buildCensus([row(1, 0.999, 2), row(1, 0.999, 3)]))).toBe('none');
  });
});
