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
import {
  computeChannelSymmetry,
  computePrismScores,
  DEFAULT_PRISM_POOLING,
  isPrismPooling,
  PRISM_POOLINGS,
} from '@agentix-e/micro-kinetic-tree';
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

  it('takes its default from the OWNER constant, so a moved default moves the signal', () => {
    // The default used to be a literal here. The value is quoted by the engine's
    // option surface and by the reported configuration line, and a literal is a
    // second owner of a shipped value that can only drift from the first silently —
    // the failure this repository has already paid for once.
    expect(isPrismPooling(DEFAULT_PRISM_POOLING)).toBe(true);
    const metrics = metricsOf({
      both: [makeSeries('cpu', [10, 10], [30, 30]), makeSeries('latency', [1, 1], [3, 3])],
      extOnly: [makeSeries('cpu', [10, 10], [10, 10]), makeSeries('latency', [1, 1], [5, 5])],
    });
    const omitted = computePrismScores(metrics, nodesOf('both', 'extOnly'), INJECT_MS);
    const explicit = computePrismScores(
      metrics,
      nodesOf('both', 'extOnly'),
      INJECT_MS,
      DEFAULT_PRISM_POOLING,
    );
    expect([...omitted.entries()]).toEqual([...explicit.entries()]);
    // And the default really is the ADDITIVE one rather than whichever happens to
    // be first: under conjunctive the external-only symptom is gated to 0 while the
    // both-channel service keeps the maximum, which is a different map.
    const conjunctive = computePrismScores(
      metrics,
      nodesOf('both', 'extOnly'),
      INJECT_MS,
      'conjunctive',
    );
    expect(conjunctive.get('both')).toBe(1);
    expect(conjunctive.get('extOnly')).toBe(0);
    expect(omitted.get('both')).toBe(1);
    expect(omitted.get('extOnly')).toBeGreaterThan(0);
  });

  it('re-exports the pooling vocabulary beside the signal that consumes it', () => {
    // A runner reads its own pooling vocabulary from the module it reads
    // `computePrismScores` from — the way `--onset-shape` and `--log-signal-mode`
    // are parsed, through the guard that owns the union rather than through a cast.
    // The re-export and the core census must be the SAME object, not a copy.
    expect(Object.keys(PRISM_POOLINGS).sort()).toEqual(['additive', 'conjunctive']);
    for (const member of Object.keys(PRISM_POOLINGS)) {
      expect(isPrismPooling(member)).toBe(true);
    }
    expect(isPrismPooling('nope')).toBe(false);
  });
});

// ── computeChannelSymmetry ────────────────────────────────

describe('computeChannelSymmetry', () => {
  // The mask form of PRISM's axiom. The measurement that motivates it is the six-arm
  // `prism_weight × prism_pooling` sweep (iteration 140): the conjunctive form lifts RE3-TrainTicket
  // from 15 to 24 of 30 cases — past PRISM's own 23 — while costing RE1 37 cases, because an ADDITIVE
  // score at a weight that can reorder everything trades one population for another. The axiom does not
  // need to reorder anything: it only says a component must not look like a root cause when it has no
  // internal anomaly at all, so the form built here is a bounded MULTIPLIER on a candidate's own
  // evidence rather than a new score added beside it.

  it('is 1 for a component whose two channels moved equally — nothing to discount', () => {
    const metrics = metricsOf({
      v: [makeSeries('cpu', [10, 10], [20, 20]), makeSeries('latency-90', [20, 20], [40, 40])],
    });
    // |20-10|/10 = 1 and |40-20|/20 = 1 → the harmonic-style ratio 2·min/(sum) = 1.
    expect(computeChannelSymmetry(metrics, nodesOf('v'), INJECT_MS).get('v')).toBeCloseTo(1, 12);
  });

  it('is 0 for an EXTERNAL-ONLY component — the victim signature PRISM names', () => {
    const metrics = metricsOf({
      v: [makeSeries('cpu', [10, 10], [10, 10]), makeSeries('latency-90', [10, 10], [30, 30])],
    });
    expect(computeChannelSymmetry(metrics, nodesOf('v'), INJECT_MS).get('v')).toBe(0);
  });

  it('is 1 when the component carries NO internal channel — unknown is not a measured zero', () => {
    // The rule the self-time term records one module over: a component with no internal telemetry
    // cannot be judged by an axiom about internal properties, and answering anyway is how a classifier
    // becomes a guess. Absence of the channel is therefore NEUTRAL, not a full discount.
    const metrics = metricsOf({ v: [makeSeries('latency-90', [10, 10], [30, 30])] });
    expect(computeChannelSymmetry(metrics, nodesOf('v'), INJECT_MS).get('v')).toBe(1);
  });

  it('is a RATIO, so the same shape at a different MAGNITUDE scores the same', () => {
    // Scale-freedom is the property the breadth and self-time terms were both re-derived to get: a
    // statistic whose value depends on the units of its inputs is a graph-density artefact waiting to
    // happen. Service `a` moves 1σ internal / 2σ external; service `b` is the SAME shape at 5× the
    // magnitude (5σ / 10σ). A statistic that read magnitudes would separate them; a ratio cannot.
    const metrics = metricsOf({
      a: [makeSeries('cpu', [10, 10], [20, 20]), makeSeries('latency-90', [20, 20], [60, 60])],
      b: [makeSeries('cpu', [10, 10], [60, 60]), makeSeries('latency-90', [20, 20], [220, 220])],
    });
    const sym = computeChannelSymmetry(metrics, nodesOf('a', 'b'), INJECT_MS);
    // |20-10|/10 = 1 against |60-20|/20 = 2 → 2·1/3; and |60-10|/10 = 5 against |220-20|/20 = 10
    // → 2·5/15, the same number.
    expect(sym.get('a')).toBeCloseTo(2 / 3, 12);
    expect(sym.get('b')).toBeCloseTo(sym.get('a')!, 12);
  });

  it('refuses to answer without an injection instant, like the score it is derived beside', () => {
    const metrics = metricsOf({ v: [makeSeries('cpu', [10, 10], [20, 20])] });
    expect(computeChannelSymmetry(metrics, nodesOf('v'), 0)).toEqual(new Map());
  });

  it('scores only the services in the graph', () => {
    const metrics = metricsOf({
      in: [makeSeries('cpu', [10, 10], [20, 20])],
      out: [makeSeries('cpu', [10, 10], [90, 90])],
    });
    expect([...computeChannelSymmetry(metrics, nodesOf('in'), INJECT_MS).keys()]).toEqual(['in']);
  });
});
