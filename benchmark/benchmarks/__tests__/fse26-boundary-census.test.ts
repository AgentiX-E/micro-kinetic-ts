/**
 * Unit tests for the level test's boundary census.
 *
 * The number this prints decides how a whole-corpus comparison is READ: a `transientGuardTest` arm that
 * measures zero on a corpus where `placeable=0/90` has measured nothing, and the same zero on
 * `placeable=90/90` is a statement about the two statistics agreeing. Every test below pins one of the
 * two failure modes that a ratio would collapse into one.
 *
 * @module benchmarks/__tests__/fse26-boundary-census
 */

import { describe, expect, it } from 'vitest';

import type { MetricMap, TimeSeries } from '../../packages/core/src/index.js';
import {
  boundaryPlaceable,
  formatBoundaryCensus,
  summariseBoundaryCensus,
} from '../src/fse26-boundary-census.js';

const INJECT = 1_000_000;
/** 4 samples before the boundary and 4 after it — the minimum the statistic accepts, one either side. */
const TS_PLACEABLE = [
  INJECT - 4000,
  INJECT - 3000,
  INJECT - 2000,
  INJECT - 1000,
  INJECT,
  INJECT + 1000,
  INJECT + 2000,
  INJECT + 3000,
];

function series(timestamps: readonly number[], value = 1): TimeSeries {
  return {
    label: 'cpu',
    timestamps,
    values: Float64Array.from({ length: timestamps.length }, () => value),
    unit: 'pct',
  };
}

function metricsOf(...all: readonly TimeSeries[]): MetricMap {
  return new Map([['svc', all]]);
}

describe('whether one case can place its boundary', () => {
  it('answers yes when a channel straddles the injection with three samples a side', () => {
    expect(boundaryPlaceable(metricsOf(series(TS_PLACEABLE)), INJECT)).toBe(true);
  });

  it('answers NO on an unknown injection time, without looking at the channels', () => {
    // `injectTime = 0` is the builder's own "unknown" sentinel and the first refusal inside
    // `injectionSplitIndex`. A census that counted these as placeable would report a population the
    // estimator refuses, which is the direction that makes an arm look measured when it is not.
    expect(boundaryPlaceable(metricsOf(series(TS_PLACEABLE)), 0)).toBe(false);
    expect(boundaryPlaceable(metricsOf(series(TS_PLACEABLE)), -1)).toBe(false);
  });

  it('answers NO when a channel carries no timestamps at all', () => {
    // The `{start, step, values}` bridge form is expanded by the loader, but nothing forces a corpus to
    // ship one; a channel with an empty timestamp list is the second refusal and must read as unplaceable.
    expect(boundaryPlaceable(metricsOf(series([])), INJECT)).toBe(false);
  });

  it('answers NO when either side holds fewer than the three-sample floor', () => {
    // Two samples a side is an average, not a median, and it is the case `injectionSplitIndex` refuses.
    const twoASide = [INJECT - 2000, INJECT - 1000, INJECT, INJECT + 1000];
    expect(boundaryPlaceable(metricsOf(series(twoASide)), INJECT)).toBe(false);
    // …and asymmetry is refused on the short side alone: a long pre window does not license a two-sample post.
    const shortPost = [
      INJECT - 4000,
      INJECT - 3000,
      INJECT - 2000,
      INJECT - 1000,
      INJECT,
      INJECT + 1000,
    ];
    expect(boundaryPlaceable(metricsOf(series(shortPost)), INJECT)).toBe(false);
  });

  it('answers yes when ANY channel qualifies, so one good series carries the case', () => {
    // The estimator is per channel, so a case is placeable if one channel is: a case whose `mem` series is
    // truncated but whose `cpu` series is whole still runs the level test on `cpu`.
    const split = metricsOf(series([]), series(TS_PLACEABLE));
    expect(boundaryPlaceable(split, INJECT)).toBe(true);
  });
});

describe('counting a corpus, keeping the two failures apart', () => {
  it('separates "no injection time" from "injection time but no split"', () => {
    // This is the whole reason the summary is not a ratio. A cell with `placeable=0` is a cell where the
    // arm measured nothing, and WHICH of these two produced the zero decides whether the corpus lacks the
    // clock or lacks the samples — different repairs, different claims.
    const census = summariseBoundaryCensus([
      { injectTime: 0, placeable: false },
      { injectTime: INJECT, placeable: false },
      { injectTime: INJECT, placeable: true },
      { injectTime: INJECT, placeable: true },
    ]);
    expect(census).toEqual({
      cases: 4,
      withInjectionTime: 3,
      placeable: 2,
      injectionTimeButNoSplit: 1,
    });
  });

  it('counts an empty corpus as four zeroes rather than dividing by it', () => {
    expect(summariseBoundaryCensus([])).toEqual({
      cases: 0,
      withInjectionTime: 0,
      placeable: 0,
      injectionTimeButNoSplit: 0,
    });
  });

  it('renders all four numbers, so a reader never has to infer one', () => {
    // A percentage here would be the one thing the format refuses to print: `placeable=0/90` with
    // `injectTime=90` and `placeable=0/90` with `injectTime=0` are the same ratio and opposite findings.
    const line = formatBoundaryCensus({
      cases: 90,
      withInjectionTime: 90,
      placeable: 0,
      injectionTimeButNoSplit: 90,
    });
    expect(line).toBe('[guard] boundary placeable=0/90 injectTime=90 noSplit=90');
    expect(line).not.toContain('%');
  });
});
