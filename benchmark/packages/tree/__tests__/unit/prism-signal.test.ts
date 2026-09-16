/**
 * Unit tests for the PRISM ranking-fusion signal.
 *
 * The signal fuses PRISM's graph-free internal/external asymmetry into the
 * collision-tree engine: for every graph service it computes the PRISM
 * root-cause score M(C) (max-pooled internal/external deviation z-scores,
 * combined additively or conjunctively) and max-normalises the result to
 * [0, 1] so it is comparable to the other ranking priors in the log-space
 * fusion.
 *
 * @module pruning/prism-signal.test
 */

import type { ServiceId, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { computePrismScores } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Helpers ───────────────────────────────────────────────

const INJECT_MS = 1000;

function makeSeries(label: string, baseline: number[], fault: number[]): TimeSeries {
  const timestamps: number[] = [];
  const values: number[] = [];
  baseline.forEach((v, i) => {
    timestamps.push(i);
    values.push(v);
  });
  fault.forEach((v, i) => {
    timestamps.push(INJECT_MS + i);
    values.push(v);
  });
  return { label, timestamps, values: new Float64Array(values), unit: '' };
}

function metricsOf(services: Record<string, TimeSeries[]>): Map<string, readonly TimeSeries[]> {
  return new Map(Object.entries(services));
}

function nodesOf(...ids: string[]): Set<ServiceId> {
  return new Set(ids);
}

// ── computePrismScores ────────────────────────────────────

describe('computePrismScores', () => {
  it('returns an empty map when the injection time is unknown', () => {
    const metrics = metricsOf({ a: [makeSeries('cpu', [10, 10], [50, 50])] });
    expect(computePrismScores(metrics, nodesOf('a'), 0)).toEqual(new Map());
  });

  it('returns an empty map for empty metrics', () => {
    expect(computePrismScores(new Map(), nodesOf('a'), INJECT_MS)).toEqual(new Map());
  });

  it('returns an empty map for empty node ids', () => {
    const metrics = metricsOf({ a: [makeSeries('cpu', [10, 10], [50, 50])] });
    expect(computePrismScores(metrics, new Set(), INJECT_MS)).toEqual(new Map());
  });

  it('returns an empty map when no service carries any deviation', () => {
    const metrics = metricsOf({ a: [makeSeries('cpu', [5, 5], [5, 5])] });
    expect(computePrismScores(metrics, nodesOf('a'), INJECT_MS)).toEqual(new Map());
  });

  it('max-normalises a root cause above an external-only victim', () => {
    const metrics = metricsOf({
      // root: S^I = 4, S^E = 4 → M = 8 − log1p(8).
      root: [makeSeries('cpu', [10, 10], [50, 50]), makeSeries('latency', [1, 1], [5, 5])],
      // victim: S^I = 0, S^E = 2 → M = 2 − log1p(2).
      victim: [makeSeries('cpu', [10, 10], [10, 10]), makeSeries('latency', [1, 1], [3, 3])],
    });
    const scores = computePrismScores(metrics, nodesOf('root', 'victim'), INJECT_MS);

    const rootM = 8 - Math.log1p(8);
    const victimM = 2 - Math.log1p(2);
    expect(scores.get('root')).toBeCloseTo(1, 10);
    expect(scores.get('victim')).toBeCloseTo(victimM / rootM, 10);
  });

  it('restricts scoring to graph members, ignoring extra metrics', () => {
    const metrics = metricsOf({
      a: [makeSeries('cpu', [10, 10], [30, 30])], // S^I = 2 → M = 2 − log1p(2)
      b: [makeSeries('cpu', [5, 5], [5, 5])], // flat → 0
      ghost: [makeSeries('cpu', [10, 10], [500, 500])], // not in nodeIds → ignored
    });
    const scores = computePrismScores(metrics, nodesOf('a', 'b'), INJECT_MS);

    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBe(0);
    expect(scores.has('ghost')).toBe(false);
  });

  it('gives a graph member with no metrics a zero score when others are anomalous', () => {
    const metrics = metricsOf({
      a: [makeSeries('cpu', [10, 10], [30, 30])],
      // b is a graph member but carries no metrics.
    });
    const scores = computePrismScores(metrics, nodesOf('a', 'b'), INJECT_MS);

    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBe(0);
  });

  it('conjunctive pooling gates an external-only symptom to 0', () => {
    const metrics = metricsOf({
      source: [makeSeries('cpu', [10, 10], [30, 30]), makeSeries('latency', [1, 1], [3, 3])],
      // S^I = 2, S^E = 2 → conj = 2.
      extOnly: [makeSeries('cpu', [10, 10], [10, 10]), makeSeries('latency', [1, 1], [5, 5])],
      // S^I = 0, S^E = 4 → conj = 0.
    });
    const scores = computePrismScores(
      metrics,
      nodesOf('source', 'extOnly'),
      INJECT_MS,
      'conjunctive',
    );

    expect(scores.get('source')).toBe(1);
    expect(scores.get('extOnly')).toBe(0);
  });

  it('defaults to additive pooling', () => {
    const metrics = metricsOf({
      svc: [makeSeries('cpu', [10, 10], [30, 30]), makeSeries('latency', [1, 1], [3, 3])],
    });
    const scores = computePrismScores(metrics, nodesOf('svc'), INJECT_MS);
    // Additive M = 2 + 2 − log1p(4); max-normalised to 1.
    expect(scores.get('svc')).toBe(1);
  });
});
