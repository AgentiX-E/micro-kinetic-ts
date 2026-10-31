/**
 * The pre-injection window's PRECONDITION — a baseline is a level only if the segment it is measured on
 * was STATIONARY, and the first fault of a run is the one whose pre-window is the container's own ramp.
 *
 * `docs/baseline-anchor.md` §6–§7 is the record this suite fences. The nine-cell measurement of the
 * `pre-injection` arm is `+13/−10` cases, and five of the ten losses are injection **index 1** cases while
 * the thirteen rescues are spread across indices 2–5 — the shape a warm-up contaminating the PRE-window
 * predicts, not the shape a fault family predicts. The axis therefore gets a second value rather than a
 * second default: `pre-injection-stationary` refuses the anchored baseline when the pre-segment's own two
 * halves disagree by more than `DEFAULT_MAX_PRE_WINDOW_DRIFT`, or when it is too short to halve at all, and
 * falls back to the shipped window in exactly the way the unguarded arm already falls back.
 *
 * The property every test here defends is the one that keeps this a WINDOW question: on a stationary
 * pre-segment the guarded arm must return the SAME number as the unguarded one, and on a ramp it must
 * return the shipped number. Nothing in between is admissible, because a guard that re-prices every case
 * is a new estimator wearing a guard's name.
 */
import { describe, expect, it } from 'vitest';

import type { ServiceCallGraph, ServiceId, TimeSeries } from '@agentix-e/micro-kinetic-core';
import {
  buildTopologyFaultGraph,
  DEFAULT_MAX_PRE_WINDOW_DRIFT,
  MIN_STATIONARY_PRE_SAMPLES,
  preWindowDrift,
  type BaselineAnchor,
} from '../../src/causal/topology-fault-graph.js';

/** One-second samples, so index `i` is `i × 1000` ms and `t₀` can be named as a sample boundary. */
function series(label: string, values: readonly number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 1000),
    values: Float64Array.from(values),
    unit: 'percent',
  };
}

function callGraph(
  ids: readonly ServiceId[],
  edges: Array<{ from: ServiceId; to: ServiceId }>,
): ServiceCallGraph {
  return {
    nodes: new Map(ids.map((id) => [id, { id, name: id, namespace: 'test', labels: {} }] as const)),
    edges: edges.map((e) => ({
      ...e,
      type: 'REST' as const,
      callRate: 100,
      p99Latency: 50,
      errorRate: 0.01,
    })),
    systemLoad: 0.5,
  };
}

const graph = callGraph(['subject', 'peer'], [{ from: 'subject', to: 'peer' }]);

/** A 30-sample pre-segment then 10 post-injection samples — `t₀` at index 30, i.e. 30 000 ms. */
const INJECT_AT = 30_000;

function scoreWith(
  ts: TimeSeries,
  anchor?: BaselineAnchor,
  injectTimeMs: number = INJECT_AT,
): { score: number; baselineMean: number | undefined; deviation: number | undefined } {
  const result = buildTopologyFaultGraph(
    graph,
    new Map<ServiceId, readonly TimeSeries[]>([
      ['subject', [ts]],
      ['peer', [series('cpu', Array<number>(ts.values.length).fill(5))]],
    ]),
    {
      injectTimeMs,
      anomalyBreadthWeight: 0,
      anomalyBreadthGate: 0,
      ...(anchor === undefined ? {} : { baselineAnchor: anchor }),
    },
  );
  const breakdown = result.dominantMetrics.get('subject')?.breakdown;
  return {
    score: result.anomalyScores.get('subject') ?? 0,
    baselineMean: breakdown?.baselineMean,
    deviation: breakdown?.deviation,
  };
}

/** The warm-up series the anchor axis was built on: 6 samples at 30, 24 at 3.5, then the fault. */
function warmUpThen(post: readonly number[]): TimeSeries {
  return series('cpu', [...Array<number>(6).fill(30), ...Array<number>(24).fill(3.5), ...post]);
}

/**
 * A pre-segment that is a RAMP and nothing else: the level climbs from 1 to 30 over the whole 30 samples,
 * which is what a container does while it is still warming up. Its own two halves are 8.5 and 23 apart, so
 * the anchored baseline would be a level the service never held.
 */
function rampPreThen(post: readonly number[]): TimeSeries {
  return series('cpu', [...Array.from({ length: 30 }, (_, i) => 1 + i), ...post]);
}

describe('preWindowDrift — the pre-segment is a level only if its own two halves agree', () => {
  it('reads ~0 on a plateau, including one that carries a start-up step inside it', () => {
    // 6 × 30 then 24 × 3.5: the halves' medians are both 3.5 because the MEDIAN of a 15-sample half that
    // holds six 30s is still the steady level. That is why the anchor axis survives this guard: the
    // corpus' warm-up cases look stationary to a half-median test by construction.
    const ts = warmUpThen(Array<number>(10).fill(10));
    expect(preWindowDrift(ts.values, ts.timestamps, INJECT_AT)).toBeLessThan(0.01);
  });

  it('reads the ramp it is for', () => {
    const ts = rampPreThen(Array<number>(10).fill(40));
    const drift = preWindowDrift(ts.values, ts.timestamps, INJECT_AT);

    expect(drift).toBeDefined();
    expect(drift!).toBeGreaterThan(DEFAULT_MAX_PRE_WINDOW_DRIFT * 3);
  });

  it('is undefined when the pre-segment cannot be halved into two judgeable halves', () => {
    // `MIN_STATIONARY_PRE_SAMPLES` is the floor: five samples is two and a half per half, and a "level"
    // that rests on two samples is a sample. The guard refuses what it cannot certify rather than
    // certifying what it cannot see.
    const ts = series('cpu', [
      ...Array<number>(MIN_STATIONARY_PRE_SAMPLES - 1).fill(3.5),
      ...Array<number>(30).fill(9),
    ]);
    expect(preWindowDrift(ts.values, ts.timestamps, 3_000)).toBeUndefined();
  });

  it('is undefined when the injection time is unknown or no sample reaches it', () => {
    const ts = warmUpThen(Array<number>(10).fill(10));
    expect(preWindowDrift(ts.values, ts.timestamps, 0)).toBeUndefined();
    expect(preWindowDrift(ts.values, ts.timestamps, 1e12)).toBeUndefined();
  });

  it('is undefined when the pre-segment has no positive level to divide by', () => {
    const ts = series('cpu', [...Array<number>(30).fill(0), ...Array<number>(10).fill(5)]);
    expect(preWindowDrift(ts.values, ts.timestamps, INJECT_AT)).toBeUndefined();
  });
});

describe('baselineAnchor=pre-injection-stationary — the same window, gated on the level it rests on', () => {
  it('agrees with the unguarded arm on a stationary pre-segment', () => {
    // The property that makes this a guard and not a second estimator.
    const ts = warmUpThen(Array<number>(10).fill(10));
    const guarded = scoreWith(ts, 'pre-injection-stationary');
    const unguarded = scoreWith(ts, 'pre-injection');

    expect(guarded.baselineMean).toBeCloseTo(unguarded.baselineMean!, 10);
    expect(guarded.score).toBe(unguarded.score);
  });

  it('refuses the anchored baseline on a ramping pre-segment and keeps the shipped window', () => {
    // The five index-1 losses' shape: the pre-window is the ramp, its median is a level the service never
    // held, and the arm that trusts it moves the truth off rank 1. The guarded arm declines and the case
    // is decided exactly as it was before the axis existed.
    const ts = rampPreThen(Array<number>(10).fill(40));
    const guarded = scoreWith(ts, 'pre-injection-stationary');
    const shipped = scoreWith(ts);
    const unguarded = scoreWith(ts, 'pre-injection');

    expect(guarded.baselineMean).toBeCloseTo(shipped.baselineMean!, 10);
    expect(guarded.score).toBe(shipped.score);
    // And the unguarded arm really does move it, so the test is not asserting a no-op on both sides.
    expect(unguarded.baselineMean).not.toBeCloseTo(shipped.baselineMean!, 3);
  });

  it('refuses a pre-segment too short to certify, whatever its halves say', () => {
    // Four pre-samples on a flat 3.5: the halves agree, and the guard refuses anyway. Length is a separate
    // condition from shape because a short window's halves are two samples each, and two samples agree by
    // accident far more often than a hundred do.
    const ts = series('cpu', [
      ...Array<number>(MIN_STATIONARY_PRE_SAMPLES - 2).fill(3.5),
      ...Array<number>(40).fill(10),
    ]);
    const guarded = scoreWith(
      ts,
      'pre-injection-stationary',
      (MIN_STATIONARY_PRE_SAMPLES - 2) * 1000,
    );
    const shipped = scoreWith(ts, undefined, (MIN_STATIONARY_PRE_SAMPLES - 2) * 1000);

    expect(guarded.baselineMean).toBeCloseTo(shipped.baselineMean!, 10);
  });

  it('still falls back where the unguarded arm falls back — the guard adds a condition, it does not replace one', () => {
    const ts = warmUpThen(Array<number>(10).fill(10));
    const guarded = scoreWith(ts, 'pre-injection-stationary', 0);
    const shipped = scoreWith(ts);

    expect(guarded.baselineMean).toBe(shipped.baselineMean);
    expect(guarded.score).toBe(shipped.score);
  });

  it('leaves the shipped value untouched: whole-file is still the default and still anchors nothing', () => {
    const ts = rampPreThen(Array<number>(10).fill(40));
    const explicit = scoreWith(ts, 'whole-file');
    const omitted = scoreWith(ts);

    expect(explicit.baselineMean).toBe(omitted.baselineMean);
    expect(explicit.score).toBe(omitted.score);
  });
});
