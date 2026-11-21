/**
 * The deviation's WINDOW — what a metric is measured *against*, once the injection time is known.
 *
 * `docs/baseline-anchor.md` is the record this suite is the fence for. The defect it pins is that the
 * shipped estimator picks the baseline and the excursion from the WHOLE file: `max` and `min` are taken
 * over every sample, and when the tail has collapsed the baseline is anchored to the series' first five
 * samples. On a series that opens with a container WARM-UP plateau — SockShop's `cpu` sits at 30 for the
 * first minute and then runs at 3.5 — those first five samples are the warm-up, so the baseline becomes
 * 30, the true excursion after `t₀` disappears into a ratio of ~0, and the drop is capped at
 * `log₁₀2 ≈ 0.301`. The service whose dominant channel behaved that way is the one that was KILLED.
 *
 * Every case below is expressed as a SERIES and asserted on the DECOMPOSITION (`baselineMean`,
 * `riseRatio`, `dropRatio`, `deviation`), so a change to the formula fails here rather than silently
 * re-pricing the nine cells.
 */
import { describe, expect, it } from 'vitest';

import type { ServiceCallGraph, ServiceId, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { buildTopologyFaultGraph } from '../../src/causal/topology-fault-graph.js';

/** One-second samples, so index `i` is `i × 1000` ms and `t₀` can be named as a sample boundary. */
function series(label: string, values: readonly number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 1000),
    values: Float64Array.from(values),
    unit: 'percent',
  };
}

function metrics(entries: Array<[ServiceId, TimeSeries[]]>): Map<ServiceId, readonly TimeSeries[]> {
  return new Map(entries);
}

function callGraph(
  ids: readonly ServiceId[],
  edges: Array<{ from: ServiceId; to: ServiceId }>,
): ServiceCallGraph {
  // The node and edge shapes are the graph's own, not a minimum this suite invented: a hand-built
  // `{ id, kind }` node type-checks against nothing and would have made the subject invisible to the
  // very code under test, which reads `labels` and the edge rates.
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

/** The subject service is `subject`; `peer` is a flat control so the graph has an edge. */
const graph = callGraph(['subject', 'peer'], [{ from: 'subject', to: 'peer' }]);

/**
 * A warm-up plateau of `WARM` samples followed by `steady` samples at the operating level, then
 * `post` samples of the injected behaviour. `t₀` sits at the warm-up/steady boundary PLUS the steady
 * run, i.e. exactly where the fault starts.
 */
function withWarmUp(steadyLevel: number, postValues: readonly number[]): TimeSeries {
  return series('cpu', [
    ...Array<number>(6).fill(30), // container start: a plateau the series leaves within a minute
    ...Array<number>(24).fill(steadyLevel), // the level the service actually ran at
    ...postValues,
  ]);
}

/** The injection index of `withWarmUp`'s default shape: 6 warm-up samples + 24 steady ones. */
const INJECT_AT = 30_000;

function scoreWith(
  ts: TimeSeries,
  anchor?: 'whole-file' | 'pre-injection',
  injectTimeMs: number = INJECT_AT,
): {
  score: number;
  baselineMean: number | undefined;
  riseRatio: number | undefined;
  dropRatio: number | undefined;
  deviation: number | undefined;
} {
  const result = buildTopologyFaultGraph(
    graph,
    metrics([
      ['subject', [ts]],
      ['peer', [series('cpu', Array<number>(ts.values.length).fill(5))]],
    ]),
    {
      injectTimeMs,
      // Both are shipped bonuses over the same disagreement; the subject here is the WINDOW, so they are
      // named at zero rather than left to move the number under test.
      anomalyBreadthWeight: 0,
      anomalyBreadthGate: 0,
      ...(anchor === undefined ? {} : { baselineAnchor: anchor }),
    },
  );
  const breakdown = result.dominantMetrics.get('subject')?.breakdown;
  return {
    score: result.anomalyScores.get('subject') ?? 0,
    baselineMean: breakdown?.baselineMean,
    riseRatio: breakdown?.riseRatio,
    dropRatio: breakdown?.dropRatio,
    deviation: breakdown?.deviation,
  };
}

describe('baselineAnchor — the deviation is measured between two WINDOWS, and t₀ is the boundary', () => {
  it('measures the post-injection excursion against the pre-injection level', () => {
    // 3.5 → 10 is a 1.857× rise over the level the service was RUNNING AT, which is what the metric did.
    const got = scoreWith(withWarmUp(3.5, Array<number>(10).fill(10)), 'pre-injection');

    expect(got.baselineMean).toBeCloseTo(3.5, 10);
    expect(got.riseRatio).toBeCloseTo(6.5 / 3.5, 10);
    expect(got.deviation).toBeCloseTo(Math.log10(1 + 6.5 / 3.5), 10);
  });

  it('the shipped window under-states that excursion, because baseline and maximum are both the warm-up', () => {
    // Not a behaviour to preserve — the fence that keeps the fix honest about what it changes. The shipped
    // estimator puts the baseline at 19.4 for a service that ran at 3.5 and takes its `max` from the
    // start-up plateau, so the same 3.5 → 10 excursion is divided by a level that has nothing to do with
    // the service's operating point.
    const shipped = scoreWith(withWarmUp(3.5, Array<number>(10).fill(10)));
    const fixed = scoreWith(withWarmUp(3.5, Array<number>(10).fill(10)), 'pre-injection');

    expect(shipped.baselineMean).toBeGreaterThan(3.5 * 3);
    expect(shipped.deviation).toBeLessThan(fixed.deviation! * 0.75);
  });

  it('a warm-up with nothing after it is not a deviation', () => {
    // The whole claim in one case: a series that only leaves its start-up plateau has no excursion. The
    // shipped window reads it as a 91%-collapse of the fault; the anchored one finds no deviation and the
    // metric does not compete.
    const flat = withWarmUp(3.5, Array<number>(10).fill(3.5));
    const fixed = scoreWith(flat, 'pre-injection');
    const shipped = scoreWith(flat);

    expect(fixed.score).toBe(0);
    expect(shipped.score).toBeGreaterThan(0);
  });

  it('measures a crash against the pre-injection level, not against the warm-up', () => {
    // A killed container: 3.5 → 0.3. The drop fraction is 0.914 — bounded at 1 by the formula's own
    // construction, and the point here is only that the level it is a fraction OF is 3.5.
    const got = scoreWith(withWarmUp(3.5, Array<number>(10).fill(0.3)), 'pre-injection');

    expect(got.baselineMean).toBeCloseTo(3.5, 10);
    expect(got.dropRatio).toBeCloseTo((3.5 - 0.3) / 3.5, 10);
    expect(got.deviation).toBeCloseTo(Math.log10(1 + (3.5 - 0.3) / 3.5), 10);
  });

  it('falls back to the shipped window when the injection time is unknown', () => {
    // `injectTimeMs = 0` is the "unknown" pole and the graph builder's own default. Without a boundary
    // there are no two windows, and an option that silently halved the series wherever the anchor was
    // missing would be a different estimator wearing the same name.
    const got = scoreWith(withWarmUp(3.5, Array<number>(10).fill(10)), 'pre-injection', 0);
    const shipped = scoreWith(withWarmUp(3.5, Array<number>(10).fill(10)));

    expect(got.baselineMean).toBe(shipped.baselineMean);
    expect(got.score).toBe(shipped.score);
  });

  it('falls back when the anchor leaves too few samples on one side', () => {
    // An injection at the second sample splits nothing: a median of one sample is a sample, and a "post"
    // window of zero is not an excursion. Bounded by the same tenth-of-the-series floor the transient
    // guard uses, so the fallback is a stated width rather than a tolerated accident.
    const ts = withWarmUp(3.5, Array<number>(10).fill(10));
    const got = scoreWith(ts, 'pre-injection', 1_000);
    const shipped = scoreWith(ts);

    expect(got.baselineMean).toBe(shipped.baselineMean);
  });

  it('agrees with the shipped window on a stationary series — the change is about the warm-up alone', () => {
    // No start-up plateau: the level before `t₀` is the level the whole pre-window held, so both
    // estimators have to return the same number. This is what keeps the option a WINDOW change rather
    // than a re-pricing of every case.
    const clean = series('cpu', [...Array<number>(30).fill(3.5), ...Array<number>(10).fill(10)]);
    const got = scoreWith(clean, 'pre-injection');
    const shipped = scoreWith(clean);

    expect(got.baselineMean).toBeCloseTo(shipped.baselineMean!, 10);
    expect(got.score).toBe(shipped.score);
  });

  it('reads the pre-injection MEDIAN, so one spike before t₀ cannot move the level', () => {
    // The baseline is a level, not an extreme. One 6.0 sample inside a 30-sample pre-window would move a
    // `max` to 6.0 and a mean to 3.583; the median is 3.5 to ten decimals. The spike is kept small enough
    // that it does not become the series' own range — beyond that the transient guard, not this window,
    // decides the channel's fate, and that is a different question.
    const spiked = series('cpu', [
      ...Array<number>(14).fill(3.5),
      6,
      ...Array<number>(15).fill(3.5),
      ...Array<number>(10).fill(10),
    ]);
    const got = scoreWith(spiked, 'pre-injection');

    expect(got.baselineMean).toBeCloseTo(3.5, 10);
  });
});
