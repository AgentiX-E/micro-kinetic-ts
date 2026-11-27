/**
 * The containment order: the pairwise rule, and the engine that applies it.
 *
 * The unit half pins the ORDER with fixtures small enough that every position can be argued for, including the
 * refusals — no profile, no channel, one side unmeasured, the wrong direction of the edge. The engine half runs
 * a two-service case through the pruner and asserts the three properties that decide whether the pass ships: it
 * inverts a caller whose own latency stayed inside its band, it does nothing at all without a profile, and it
 * renumbers `rank` when it moves a pair.
 *
 * @module __tests__/unit/containment-order
 */

import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import type { ContainmentPrior, FaultFreeProfile } from '@agentix-e/micro-kinetic-tree';
import {
  DEFAULT_CONTAINMENT_MARGIN,
  DEFAULT_CONTAINMENT_ORDER,
  DEFAULT_MIN_CALLEE_EXCURSION,
  TreePruner,
  applyContainmentOrder,
  failureEdgeKey,
  inspectContainmentOrder,
  isLatencyChannel,
  latencyExcursions,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Helpers ───────────────────────────────────────────────

const LATENCY = 'http.server.request.duration';

function series(label: string, values: readonly number[], stepMs = 60_000): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * stepMs),
    values: new Float64Array(values),
    unit: 'ms',
  };
}

/**
 * A profile entry centred on `centre` with scale `scale`, so the shipped band at σ = 3 is
 * `[centre − 3·scale, centre + 3·scale]`.
 */
function profileOf(
  entries: ReadonlyArray<readonly [service: string, label: string, centre: number, scale: number]>,
): FaultFreeProfile {
  const byService = new Map<
    string,
    Map<string, { label: string; centre: number; scale: number; rate: number; windows: number }>
  >();
  for (const [service, label, centre, scale] of entries) {
    const channels = byService.get(service) ?? new Map();
    channels.set(label, { label, centre, scale, rate: 0.5, windows: 5 });
    byService.set(service, channels);
  }
  return byService as unknown as FaultFreeProfile;
}

/** Ten samples at one-minute spacing with the injection at index 5. */
const INJECT = 5 * 60_000;

function excursionsOf(
  metrics: MetricMap,
  profile: FaultFreeProfile | undefined,
  injectTimeMs = INJECT,
  sigma?: number,
): Map<string, number> {
  return latencyExcursions({
    metrics,
    profile,
    injectTimeMs,
    ...(sigma === undefined ? {} : { sigma }),
  });
}

// ── isLatencyChannel ──────────────────────────────────────

describe('isLatencyChannel', () => {
  it('accepts the server-side request histogram', () => {
    expect(isLatencyChannel(LATENCY)).toBe(true);
  });

  it('accepts every Hubble quantile', () => {
    for (const quantile of ['p50', 'p90', 'p95', 'p99', 'max']) {
      expect(isLatencyChannel(`hubble_http_request_duration_${quantile}_seconds`)).toBe(true);
    }
  });

  it('refuses channels that measure something else', () => {
    for (const label of [
      'container.cpu.usage',
      'http.response.error_rate',
      'k8s.pod.memory.rss',
      '',
    ]) {
      expect(isLatencyChannel(label)).toBe(false);
    }
  });
});

// ── latencyExcursions ─────────────────────────────────────

describe('latencyExcursions', () => {
  it('is empty without a profile', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 9, 9, 9, 9, 9])]]]);
    expect(excursionsOf(metrics, undefined).size).toBe(0);
  });

  it('is empty when the profile holds nothing', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 9, 9, 9, 9, 9])]]]);
    expect(excursionsOf(metrics, profileOf([])).size).toBe(0);
  });

  it('is empty when the injection instant is unknown', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 9, 9, 9, 9, 9])]]]);
    const profile = profileOf([['a', LATENCY, 1, 1]]);
    expect(excursionsOf(metrics, profile, 0).size).toBe(0);
  });

  it('measures zero for a service inside its band', () => {
    // Post median 5 against centre 5 with a band of ±3·1 → inside, so the excursion is a measured 0.
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 5, 5, 5, 5, 5])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).get('a')).toBe(0);
  });

  it('measures the distance above the band in band widths', () => {
    // Band [2, 8] (centre 5, scale 1, σ 3): post median 14 sits 6 above the top, i.e. 1 band width.
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 14, 14, 14, 14, 14])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).get('a')).toBeCloseTo(1, 12);
  });

  it('measures the distance below the band in band widths', () => {
    // Band [2, 8]; post median −4 sits 6 below the bottom → one band width. A COLLAPSE is an excursion too:
    // a service that stopped answering is not a service that did not move.
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, -4, -4, -4, -4, -4])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).get('a')).toBeCloseTo(1, 12);
  });

  it('reads the widest of a service\u2019s latency channels', () => {
    const metrics = new Map([
      [
        'a',
        [
          series(LATENCY, [1, 1, 1, 1, 1, 9, 9, 9, 9, 9]),
          series('hubble_http_request_duration_p99_seconds', [1, 1, 1, 1, 1, 20, 20, 20, 20, 20]),
        ],
      ],
    ]);
    const profile = profileOf([
      ['a', LATENCY, 5, 1],
      ['a', 'hubble_http_request_duration_p99_seconds', 5, 1],
    ]);
    // Band [2, 8] → width 6: 9 gives (9−8)/6 and 20 gives (20−8)/6 = 2, so the widest wins.
    expect(excursionsOf(metrics, profile).get('a')).toBeCloseTo(2, 12);
  });

  it('honours a caller-supplied sigma', () => {
    // At σ = 1 the band is [4, 6] and post 14 sits 8 outside a width of 2 → 4 band widths.
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 14, 14, 14, 14, 14])]]]);
    expect(
      excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]]), INJECT, 1).get('a'),
    ).toBeCloseTo(4, 12);
  });

  it('refuses a service the profile does not carry', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 14, 14, 14, 14, 14])]]]);
    expect(excursionsOf(metrics, profileOf([['b', LATENCY, 5, 1]])).has('a')).toBe(false);
  });

  it('refuses a service whose channels are not latency channels', () => {
    const metrics = new Map([
      ['a', [series('container.cpu.usage', [1, 1, 1, 1, 1, 90, 90, 90, 90, 90])]],
    ]);
    expect(excursionsOf(metrics, profileOf([['a', 'container.cpu.usage', 5, 1]])).has('a')).toBe(
      false,
    );
  });

  it('refuses a latency channel the profile has no entry for', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 90, 90, 90, 90, 90])]]]);
    expect(
      excursionsOf(
        metrics,
        profileOf([['a', 'hubble_http_request_duration_p50_seconds', 5, 1]]),
      ).has('a'),
    ).toBe(false);
  });

  it('refuses a degenerate band rather than dividing by its width', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 90, 90, 90, 90, 90])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 0]])).has('a')).toBe(false);
  });

  it('refuses a series with no post-injection sample', () => {
    // One sample, injection at index 5: there is no window after the boundary to measure.
    const metrics = new Map([['a', [series(LATENCY, [1])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).has('a')).toBe(false);
  });

  it('refuses a series holding a non-finite sample', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, Number.NaN, 9, 9, 9, 9])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).has('a')).toBe(false);
  });

  it('measures each service independently', () => {
    const metrics = new Map([
      ['a', [series(LATENCY, [1, 1, 1, 1, 1, 5, 5, 5, 5, 5])]],
      ['b', [series(LATENCY, [1, 1, 1, 1, 1, 14, 14, 14, 14, 14])]],
    ]);
    const profile = profileOf([
      ['a', LATENCY, 5, 1],
      ['b', LATENCY, 5, 1],
    ]);
    const result = excursionsOf(metrics, profile);
    expect(result.get('a')).toBe(0);
    expect(result.get('b')).toBeCloseTo(1, 12);
  });
});

// ── applyContainmentOrder ─────────────────────────────────

interface Row {
  readonly service: string;
}

const rows = (...services: readonly string[]): Row[] => services.map((service) => ({ service }));

const servicesOf = (list: readonly Row[]): string[] => list.map((one) => one.service);

const CALLS_AB: readonly CallEdge[] = [
  { from: 'a', to: 'b', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
];

describe('minCalleeExcursion (the noise floor)', () => {
  // Iteration 382. Three full-corpus cases carried a caller INSIDE its band (excursion 0) and a callee only
  // 0.03-0.096 band widths past its band edge -- measurement noise at the boundary, not a latency that "left
  // its band" in the sense the pass documents. A strict comparison (margin 0) still inverted them and moved a
  // correct root cause (ts-preserve-service) below its own callee. The floor demands that the callee be a
  // resolvable distance outside its band before the pair may be inverted.

  const CALL = CALLS_AB;

  it('refuses a callee only noise-width outside its band, when the caller is inside', () => {
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALL,
      excursions: new Map([
        ['a', 0],
        ['b', 0.088],
      ]),
      minCalleeExcursion: 0.1,
    });
    expect(servicesOf(swept.order)).toEqual(['a', 'b']);
    expect(swept.verdicts.map((one) => one.decision)).toEqual(['callee-in-band']);
  });

  it('inverts a callee that is genuinely outside its band', () => {
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALL,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      minCalleeExcursion: 0.1,
    });
    expect(servicesOf(swept.order)).toEqual(['b', 'a']);
    expect(swept.verdicts.map((one) => one.decision)).toEqual(['inverted']);
  });

  it('compares strictly against the floor: a callee exactly at it is refused', () => {
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALL,
      excursions: new Map([
        ['a', 0],
        ['b', 0.1],
      ]),
      minCalleeExcursion: 0.1,
    });
    expect(servicesOf(swept.order)).toEqual(['a', 'b']);
    expect(swept.verdicts[0]!.decision).toBe('callee-in-band');
  });

  it('is disabled by an explicit zero, so the pre-fix strict comparison can still be replayed', () => {
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALL,
      excursions: new Map([
        ['a', 0],
        ['b', 0.088],
      ]),
      minCalleeExcursion: 0,
    });
    expect(servicesOf(swept.order)).toEqual(['b', 'a']);
    expect(swept.verdicts[0]!.decision).toBe('inverted');
  });

  it('applies at its shipped default without the caller naming it', () => {
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALL,
      excursions: new Map([
        ['a', 0],
        ['b', 0.088],
      ]),
    });
    expect(servicesOf(swept.order)).toEqual(['a', 'b']);
    expect(swept.verdicts[0]!.decision).toBe('callee-in-band');
  });

  it('is checked after the interface record, so a pair that never carried a failed call keeps that reason', () => {
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALL,
      excursions: new Map([
        ['a', 0],
        ['b', 0.088],
      ]),
      failingEdges: new Map(),
      minCalleeExcursion: 0.1,
    });
    expect(swept.verdicts[0]!.decision).toBe('no-failed-interface');
  });

  it('is checked before the margin, so a noise-width pair is named by the floor and not by a larger bar', () => {
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALL,
      excursions: new Map([
        ['a', 0],
        ['b', 0.088],
      ]),
      minCalleeExcursion: 0.1,
      margin: 1,
    });
    expect(swept.verdicts[0]!.decision).toBe('callee-in-band');
  });

  it('ships at 0.1 in the engine, not zero', () => {
    expect(DEFAULT_MIN_CALLEE_EXCURSION).toBe(0.1);
  });
});

describe('applyContainmentOrder', () => {
  it('inverts a caller whose callee is further outside its band', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['b', 'a']);
  });

  it('leaves a pair alone when the caller is the one further outside', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 4],
        ['b', 1],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('leaves equal excursions alone, because the comparison is strict', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 1],
        ['b', 1],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('applies the margin in band widths', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 0.5],
      ]),
      margin: 1,
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('does nothing without edges', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: [],
      excursions: new Map([
        ['a', 0],
        ['b', 9],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('does nothing without excursions', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map(),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('leaves a list shorter than two alone', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a'),
      edges: CALLS_AB,
      excursions: new Map([['a', 9]]),
    });
    expect(servicesOf(ordered)).toEqual(['a']);
  });

  it('refuses the pair when only one side was measured', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([['b', 9]]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('does not invert a callee above its caller', () => {
    // The edge runs `b → a`, so the ranking puts the CALLER second. The rule only ever moves a callee up, never a
    // caller, whatever the excursions say — an upward move that ignored the direction would be a different claim.
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: [{ from: 'b', to: 'a' }],
      excursions: new Map([
        ['a', 0],
        ['b', 9],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('does not touch a non-adjacent pair', () => {
    // `a` calls `c`, but `b` sits between them: the pass compares POSITIONS, and a promotion across an
    // intervening candidate would be a re-sort rather than an inversion of the published order.
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b', 'c'),
      edges: [{ from: 'a', to: 'c' }],
      excursions: new Map([
        ['a', 0],
        ['b', 0],
        ['c', 9],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b', 'c']);
  });

  it('sweeps once, without re-examining what it moved', () => {
    // a → b → c with rising excursions: the first inversion puts `b` on top; the pass then compares `a` against
    // `c`, finds no edge, and stops. `c` never climbs, which is what keeps one measurement from compounding.
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b', 'c'),
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      excursions: new Map([
        ['a', 0],
        ['b', 1],
        ['c', 2],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['b', 'a', 'c']);
  });

  it('returns a new array and never mutates its input', () => {
    const ranking = rows('a', 'b');
    const ordered = applyContainmentOrder({
      ranking,
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    });
    expect(servicesOf(ranking)).toEqual(['a', 'b']);
    expect(ordered).not.toBe(ranking);
  });

  // ── The interface-evidence gate ──────────────────────────
  //
  // The excursion is measured per SERVICE, so two candidates that both moved are two independent measurements
  // until the case says something passed between them. These four tests pin that sentence at the pass's own
  // boundary: the record licenses an inversion, its absence refuses one, and its DIRECTION is the direction of
  // the edge rather than of the pair.

  it('inverts the pair when its own interface failed', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      failingEdges: new Map([[failureEdgeKey('a', 'b'), { rise: 12, novel: 0 }]]),
    });
    expect(servicesOf(ordered)).toEqual(['b', 'a']);
  });

  it('refuses the pair when no failed call was recorded on it', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      failingEdges: new Map(),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('refuses the pair when only the REVERSE interface failed', () => {
    // `b` reported failed calls to `a`; `a` reported none to `b`. The pair's own interface carried nothing, so
    // the record licenses no inversion — a key that ignored direction would invert on the wrong edge.
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      failingEdges: new Map([[failureEdgeKey('b', 'a'), { rise: 9, novel: 0 }]]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('cannot resurrect a pair the excursion rule rejected', () => {
    // The record is a REQUIREMENT, not a second reason to move: an interface that failed does not license an
    // inversion the excursions do not support.
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 4],
        ['b', 1],
      ]),
      failingEdges: new Map([[failureEdgeKey('a', 'b'), { rise: 12, novel: 0 }]]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('carries the caller\u2019s payload through the inversion', () => {
    const ordered = applyContainmentOrder({
      ranking: [
        { service: 'a', payload: 'caller' },
        { service: 'b', payload: 'callee' },
      ],
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    });
    expect(ordered.map((one) => one.payload)).toEqual(['callee', 'caller']);
  });
});

// ── The residual prior ────────────────────────────────────
//
// H2 asks whether an edge's factorisation residual can stand in for the per-case interface record: fitted over
// many cases on ONE half of the corpus and required on the other, so that no case is judged by a statistic it
// helped compute. The pass therefore has to accept a requirement it did not measure — and the five tests below
// pin the API at the boundary (admitted, absent, below, direction of the key, a threshold above zero) while the
// next five pin WHERE in the decision order the requirement sits, because a label that names a condition the
// pair never reached is a label that misdescribes the refusal.

describe('the residual prior', () => {
  /** A prior that admits the pair, and one that refuses it for each of the two reasons. */
  const ADMITS: ContainmentPrior = {
    residuals: new Map([[failureEdgeKey('a', 'b'), 0.2]]),
    threshold: 0,
  };
  const ABSENT: ContainmentPrior = { residuals: new Map(), threshold: 0 };
  const NEGATIVE: ContainmentPrior = {
    residuals: new Map([[failureEdgeKey('a', 'b'), -0.05]]),
    threshold: 0,
  };

  it('inverts a pair whose edge cleared the residual on the other half', () => {
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      prior: ADMITS,
    });
    expect(servicesOf(swept.order)).toEqual(['b', 'a']);
    expect(swept.verdicts.map((one) => one.decision)).toEqual(['inverted']);
  });

  it('refuses a pair whose edge was never fitted', () => {
    // The distinction that matters: an edge nobody fitted is not an edge measured to be independent, and a gate
    // that merged the two would report a corpus it never measured as a corpus that disagreed with it.
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      prior: ABSENT,
    });
    expect(servicesOf(swept.order)).toEqual(['a', 'b']);
    expect(swept.verdicts.map((one) => one.decision)).toEqual(['prior-absent']);
  });

  it('refuses a residual that sits exactly on the threshold', () => {
    // `ρ > 0` is the pre-registered requirement and the comparison is strict, for the same reason the margin is:
    // a zero residual IS the independence the gate exists to exclude, so admitting it would be admitting nothing.
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      prior: { residuals: new Map([[failureEdgeKey('a', 'b'), 0]]), threshold: 0 },
    });
    expect(swept.verdicts.map((one) => one.decision)).toEqual(['prior-below']);
  });

  it('refuses a negative residual, which is a pair that moved against itself', () => {
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      prior: NEGATIVE,
    });
    expect(swept.verdicts.map((one) => one.decision)).toEqual(['prior-below']);
  });

  it('keys the residual by the direction of the call edge', () => {
    // The residual itself is symmetric and the sweep only ever asks about `caller\0callee`. A key that ignored
    // direction would admit the pair on the strength of an edge the sweep is not looking at.
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      prior: { residuals: new Map([[failureEdgeKey('b', 'a'), 0.9]]), threshold: 0 },
    });
    expect(swept.verdicts.map((one) => one.decision)).toEqual(['prior-absent']);
  });

  it('cannot resurrect a pair the excursion rule rejected', () => {
    // A requirement, not a second reason to move: an edge that moves as one does not license an inversion the
    // excursions contradict. This is the same test the interface record had to pass.
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 4],
        ['b', 1],
      ]),
      prior: ADMITS,
    });
    expect(servicesOf(swept.order)).toEqual(['a', 'b']);
    expect(swept.verdicts.map((one) => one.decision)).toEqual(['not-larger']);
  });

  it('names the unmeasured side before the prior, because that is what decided it', () => {
    // The prior is consulted LAST so that `prior-below` means "this pair would have been inverted". Asking it
    // earlier would label refusals the measurements had already made, and the count of refused inversions —
    // the quantity the gate's price is read from — would report the gate blocking things it never reached.
    const swept = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([['a', 0]]),
      prior: ABSENT,
    });
    expect(swept.verdicts.map((one) => one.decision)).toEqual(['unmeasured']);
  });

  it('is never asked on top of the record\u2019s licence, and is still a requirement where the record is silent', () => {
    // This test said the opposite until iteration 300 — "a requirement beside the interface record, not an
    // alternative to it" — describing a conjunction that no arm ever ran and that §299 refused on the day it
    // priced the residual as a REPLACEMENT. A licensed pair already has a causal reason to move; asking whether
    // its two ends co-move as well puts the correlational statistic on top of the causal one, which is the same
    // mistake wearing a narrower scope. The defect it caused was measurable: with the conjunction in place the
    // case-scoped arm inverted 110 pairs where the shipped arm inverts 242, and its Top@1 came out BELOW the arm
    // it was built to improve.
    //
    // Where the record is silent, the prior IS a requirement — that is what the arm is for — and the two
    // branches below are the whole distinction.
    const both = {
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    };
    const licensed = new Map([[failureEdgeKey('a', 'b'), { rise: 12, novel: 0 }]]);
    expect(
      inspectContainmentOrder({ ...both, failingEdges: licensed, prior: ABSENT }).verdicts.map(
        (one) => one.decision,
      ),
    ).toEqual(['inverted']);
    expect(
      inspectContainmentOrder({
        ...both,
        failingEdges: new Map(),
        recordScope: 'case',
        prior: ADMITS,
      }).verdicts.map((one) => one.decision),
    ).toEqual(['record-silent']);
    expect(
      inspectContainmentOrder({
        ...both,
        failingEdges: new Map(),
        recordScope: 'case',
        prior: ABSENT,
      }).verdicts.map((one) => one.decision),
    ).toEqual(['prior-absent']);
    expect(
      inspectContainmentOrder({ ...both, failingEdges: new Map(), prior: ADMITS }).verdicts.map(
        (one) => one.decision,
      ),
    ).toEqual(['no-failed-interface']);
  });

  it('changes nothing when it is not supplied', () => {
    // The shipped configuration: no prior, and the two arms of the register unchanged. A gate that altered the
    // default would make every number in `docs/containment-order.md` a measurement of a different engine.
    const input = {
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    };
    expect(servicesOf(inspectContainmentOrder(input).order)).toEqual(
      servicesOf(inspectContainmentOrder({ ...input, prior: ADMITS }).order),
    );
    expect(servicesOf(inspectContainmentOrder(input).order)).toEqual(['b', 'a']);
  });

  it('honours a threshold above zero', () => {
    const sweep = (residual: number): string[] =>
      inspectContainmentOrder({
        ranking: rows('a', 'b'),
        edges: CALLS_AB,
        excursions: new Map([
          ['a', 0],
          ['b', 1],
        ]),
        prior: { residuals: new Map([[failureEdgeKey('a', 'b'), residual]]), threshold: 0.05 },
      }).verdicts.map((one) => one.decision);
    expect(sweep(0.03)).toEqual(['prior-below']);
    expect(sweep(0.06)).toEqual(['inverted']);
  });

  it('agrees with applyContainmentOrder on the order under a prior', () => {
    const input = {
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      prior: ADMITS,
    };
    expect(servicesOf(applyContainmentOrder(input))).toEqual(
      servicesOf(inspectContainmentOrder(input).order),
    );
  });
});

// ── The engine ────────────────────────────────────────────

function node(id: string): ServiceNode {
  return { id, name: id, namespace: 'default', labels: {} };
}

function graphOf(
  ids: readonly string[],
  pairs: ReadonlyArray<readonly [string, string]>,
): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of ids) nodes.set(id, node(id));
  const edges: CallEdge[] = pairs.map(([from, to]) => ({
    from,
    to,
    type: 'REST',
    callRate: 100,
    p99Latency: 10,
    errorRate: 0.01,
  }));
  return { nodes, edges, systemLoad: 0.3 };
}

/**
 * A two-service propagation case whose leader is the CALLER.
 *
 * `a` calls `b`. `a`'s cpu rises by a factor of ten while its latency stays inside the band it occupied when
 * nothing was wrong; `b`'s cpu is flat while its latency leaves the band by a wide margin. The fusion reads
 * `a`'s rise and answers with `a` — the mechanism the pass exists for.
 */
function propagationCase(withFailedInterface = true): {
  callGraph: ServiceCallGraph;
  metrics: MetricMap;
  injectTimeMs: number;
  failedTraceEdges: ReadonlyArray<{
    caller: string;
    callee: string;
    failed: number;
    baseline: number;
    total: number;
  }>;
} {
  const callGraph = graphOf(['a', 'b'], [['a', 'b']]);
  const metrics = new Map<string, readonly TimeSeries[]>([
    [
      'a',
      [
        series('cpu', [10, 10, 10, 10, 10, 100, 100, 100, 100, 100]),
        series(LATENCY, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      ],
    ],
    [
      'b',
      [
        series('cpu', [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
        series(LATENCY, [5, 5, 5, 5, 5, 40, 40, 40, 40, 40]),
      ],
    ],
  ]);
  // The interface record. `a` calls `b` and that call FAILED twelve times post-injection with no pre-injection
  // failures — the evidence that something passed between the two services. The gate reads it, so a case without
  // it is a case where the two excursions are two independent measurements of two services.
  const failedTraceEdges = withFailedInterface
    ? [{ caller: 'a', callee: 'b', failed: 12, baseline: 0, total: 40 }]
    : [];
  return { callGraph, metrics, injectTimeMs: INJECT, failedTraceEdges };
}

function profileForCase(): FaultFreeProfile {
  return profileOf([
    ['a', LATENCY, 5, 1],
    ['b', LATENCY, 5, 1],
  ]);
}

function rankWith(options: {
  readonly containmentOrder?: boolean;
  readonly profile?: FaultFreeProfile;
  readonly withFailedInterface?: boolean;
}): { readonly services: string[]; readonly ranks: number[] } {
  const { callGraph, metrics, injectTimeMs, failedTraceEdges } = propagationCase(
    options.withFailedInterface ?? true,
  );
  // The two switches that would otherwise answer first are held at their OFF poles, so the fixture measures the
  // containment pass and nothing else: `failedEdgeWeight = 0` keeps the direction term from paying the callee of
  // the failed interface (the record is still BUILT — it is a measurement of the case), and
  // `failureContainment = false` keeps the second relational pass out of the comparison.
  const pruner = new TreePruner({
    failedEdgeWeight: 0,
    failureContainment: false,
    ...(options.containmentOrder === undefined
      ? {}
      : { containmentOrder: options.containmentOrder }),
    ...(options.profile === undefined ? {} : { faultFreeProfile: options.profile }),
  });
  const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs, failedTraceEdges });
  const results = pruner.analyze(graph, 5);
  return { services: results.map((one) => one.serviceId), ranks: results.map((one) => one.rank) };
}

describe('inspectContainmentOrder', () => {
  // The same sweep, with its reasons kept. `applyContainmentOrder` answers "what is the order"; this answers
  // "what did you look at and why did you decline", which is the input to the factorisation residual (H2 in
  // `preregistration-294.md`): ρ is a property of an EDGE over the corpus, and the edge population is exactly
  // the set of adjacent pairs that carry a call edge — a set nothing in the ranking artifact can reconstruct.

  it('agrees with applyContainmentOrder on the order, pair for pair', () => {
    // The observation must not be able to disagree with the decision it observes. Both arms are the same
    // sweep, so an order that differed would mean the audit had become a second implementation.
    const input = {
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    };
    expect(servicesOf(inspectContainmentOrder(input).order)).toEqual(
      servicesOf(applyContainmentOrder(input)),
    );
    expect(servicesOf(inspectContainmentOrder(input).order)).toEqual(['b', 'a']);
  });

  it('records an inversion with both excursions, which is what ρ needs', () => {
    const { verdicts } = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0.25],
        ['b', 3.5],
      ]),
    });
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toEqual({
      upper: 'a',
      lower: 'b',
      decision: 'inverted',
      upperExcursion: 0.25,
      lowerExcursion: 3.5,
    });
  });

  it('keeps both excursions on a refusal, because a refusal is a negative example', () => {
    // The five losses iteration 293 removed were pairs with no failed call. Their excursions were the reason
    // the old arm inverted them, so a record that dropped the numbers on refusal would lose exactly the
    // population the residual has to separate.
    const { verdicts } = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 2],
      ]),
      failingEdges: new Map(),
    });
    expect(verdicts[0]).toMatchObject({
      decision: 'no-failed-interface',
      upperExcursion: 0,
      lowerExcursion: 2,
    });
  });

  it('names an unmeasured side as unmeasured rather than as a zero', () => {
    const { verdicts } = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([['b', 2]]),
    });
    expect(verdicts[0]!.decision).toBe('unmeasured');
    // The missing side is ABSENT from the record, not zero: a consumer that read it as 0 would be making the
    // substitution `latencyExcursions` refused to make in the first place.
    expect(verdicts[0]).not.toHaveProperty('upperExcursion');
    expect(verdicts[0]).toHaveProperty('lowerExcursion', 2);
  });

  it('omits whichever side is missing, so the two absences are not one case', () => {
    // The mirror of the test above. Both sides are measured in the fixtures everywhere else, so an
    // implementation that carried the LOWER side unconditionally would pass every other row here and would
    // quietly invent a zero for a callee the profile could not speak about.
    const { verdicts } = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([['a', 2]]),
    });
    expect(verdicts[0]!.decision).toBe('unmeasured');
    expect(verdicts[0]).toHaveProperty('upperExcursion', 2);
    expect(verdicts[0]).not.toHaveProperty('lowerExcursion');
  });

  it('names a pair that did not clear the margin', () => {
    const { verdicts } = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 0.5],
      ]),
      margin: 1,
    });
    expect(verdicts[0]!.decision).toBe('not-larger');
  });

  it('does not record a pair with no call edge, because ρ is undefined there', () => {
    // Exclusion rather than a verdict: the residual is a statistic about an EDGE, so a pair the topology does
    // not join has no edge to be a property of. Recording it as a decision would put a population in the
    // denominator that no reader of ρ asked about.
    const { verdicts } = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: [],
      excursions: new Map([
        ['a', 0],
        ['b', 9],
      ]),
    });
    expect(verdicts).toEqual([]);
  });

  it('records the pairs in sweep order, once each, and stops at the last position', () => {
    // Four candidates, three call edges, and after the first inversion the adjacency at `i = 1` is (a, c) —
    // which has no edge, so it produces no row. The two rows that remain are the sweep as it happened: one
    // inversion, and one pair that had an edge and did not clear the comparison.
    const chain: readonly CallEdge[] = [
      { from: 'a', to: 'b', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
      { from: 'b', to: 'c', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
      { from: 'c', to: 'd', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
    ];
    const { order, verdicts } = inspectContainmentOrder({
      ranking: rows('a', 'b', 'c', 'd'),
      edges: chain,
      excursions: new Map([
        ['a', 0],
        ['b', 5],
        ['c', 0],
        ['d', 0],
      ]),
    });
    expect(servicesOf(order)).toEqual(['b', 'a', 'c', 'd']);
    // `c>d` used to read `not-larger` at the old default of zero: both sat at 0, so the strict comparison refused.
    // At the shipped floor of 0.1 a callee with NO excursion is named by what actually refused it -- it never left
    // its band -- rather than by the margin that would also have refused it. The order is unchanged either way.
    expect(verdicts.map((one) => `${one.upper}>${one.lower}:${one.decision}`)).toEqual([
      'a>b:inverted',
      'c>d:callee-in-band',
    ]);
  });
});

describe('the containment order in the engine', () => {
  it('ships ON with a strict margin, on the interface requirement', () => {
    // The default moved in iteration 293 for two reasons that are both asserted elsewhere: the pass now demands
    // an interface record (the gate tests above), and with it the full corpus reads 15 gains against 0 losses
    // (`docs/containment-order.md` §12). The margin stays 0 — a strict comparison on one case's own band.
    expect(DEFAULT_CONTAINMENT_ORDER).toBe(true);
    expect(DEFAULT_CONTAINMENT_MARGIN).toBe(0);
  });

  it('promotes the callee whose own latency left its band', () => {
    expect(
      rankWith({ containmentOrder: true, profile: profileForCase() }).services.slice(0, 2),
    ).toEqual(['b', 'a']);
  });

  it('renumbers the published rank when it moves a pair', () => {
    expect(
      rankWith({ containmentOrder: true, profile: profileForCase() }).ranks.slice(0, 2),
    ).toEqual([1, 2]);
  });

  it('is a no-op without a profile, even when switched on', () => {
    const withoutPass = rankWith({ containmentOrder: false });
    const withPassButNoProfile = rankWith({ containmentOrder: true });
    expect(withPassButNoProfile.services).toEqual(withoutPass.services);
    expect(withoutPass.services[0]).toBe('a');
  });

  it('is a no-op when switched off, whatever the profile says', () => {
    expect(rankWith({ containmentOrder: false, profile: profileForCase() }).services[0]).toBe('a');
  });

  it('refuses the inversion when the case recorded no failed call on the pair', () => {
    // The ruled-out arm, at the engine's own boundary: the same case, the same excursions, and only the
    // interface record removed. Without it the pass promotes `b` past `a` on latency alone — the mechanism that
    // cost five cases on the full corpus (docs/containment-order.md §4, §7).
    expect(
      rankWith({
        containmentOrder: true,
        profile: profileForCase(),
        withFailedInterface: false,
      }).services[0],
    ).toBe('a');
  });

  it('is ON in the shipped configuration, and inert without a profile', () => {
    // ON: the omitted option behaves as the explicit one, and the fixture's own interface record is what
    // licenses the inversion.
    expect(rankWith({ profile: profileForCase() }).services[0]).toBe('b');
    // …and still inert where the profile is absent, which is every run that cannot build one.
    expect(rankWith({}).services[0]).toBe('a');
  });

  it('does not build the excursion map when it cannot be read', () => {
    const { callGraph, metrics, injectTimeMs, failedTraceEdges } = propagationCase();
    const graph = new TreePruner().buildFaultGraph(callGraph, metrics, {
      injectTimeMs,
      failedTraceEdges,
    });
    expect(graph.containmentExcursions).toBeUndefined();
  });

  it('measures the excursions on the graph when the pass can run', () => {
    const { callGraph, metrics, injectTimeMs, failedTraceEdges } = propagationCase();
    const pruner = new TreePruner({
      containmentOrder: true,
      faultFreeProfile: profileForCase(),
      failedEdgeWeight: 0,
      failureContainment: false,
    });
    const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs, failedTraceEdges });
    expect(graph.containmentExcursions?.get('a')).toBe(0);
    expect(graph.containmentExcursions?.get('b')).toBeGreaterThan(1);
  });

  it('lets one pruner analyze a graph another pruner built, under its OWN setting', () => {
    // THE PHASE FENCE. `containmentOrder` used to decide, at BUILD time, whether the excursion map existed, so a
    // graph built by a pruner that had the pass switched off carried no map and every other pruner reading that
    // graph silently ran without the pass — whatever its own option said. That is not hypothetical: it is how the
    // seven-arm factorial measured a 13-violation corpus at exactly the shipped 484, because the first arm built
    // the graph and the first arm was the pass-off control. A measurement is a property of the CASE; whether it
    // acts is a property of the RUN, and the run is `analyze` — the same phase `failedEdgeGateMode` already lives
    // in. The builder here has the pass OFF and the reader has it ON, which is the shape the harnesses use.
    const { callGraph, metrics, injectTimeMs, failedTraceEdges } = propagationCase();
    const builder = new TreePruner({
      containmentOrder: false,
      faultFreeProfile: profileForCase(),
      failedEdgeWeight: 0,
      failureContainment: false,
    });
    const graph = builder.buildFaultGraph(callGraph, metrics, { injectTimeMs, failedTraceEdges });
    const reader = new TreePruner({ containmentOrder: true, faultFreeProfile: profileForCase() });
    expect(
      reader
        .analyze(graph, 3)
        .map((result) => String(result.serviceId))
        .slice(0, 2),
    ).toEqual(['b', 'a']);
    // …and the builder, reading the same graph, still does nothing: the map's existence cannot switch the pass on.
    expect(
      builder
        .analyze(graph, 3)
        .map((result) => String(result.serviceId))
        .slice(0, 2),
    ).toEqual(['a', 'b']);
  });
});

// ── recordScope ───────────────────────────────────────────

/**
 * The record's absence is two facts, and `recordScope` is which of them the pass reads.
 *
 * The shipped arm reads the absence as one thing and refuses, which is what earns it `+15 / −0`. §299 measured
 * what that costs: three cases where the record correctly vetoed a promotion, and eighteen gains the same
 * requirement takes where the record never spoke at all. These tests pin the distinction at the sweep's own
 * boundary — the same maps, one word of interpretation — so that the corpus reading is a measurement of the
 * interpretation and not of anything else.
 */
describe('recordScope', () => {
  /** The pair, measured, with no record on its own edge. */
  const silent = {
    ranking: rows('a', 'b'),
    edges: CALLS_AB,
    excursions: new Map([
      ['a', 0],
      ['b', 1],
    ]),
  };

  it('refuses a missing record at edge scope, which is the configuration every published number was measured in', () => {
    const sweep = inspectContainmentOrder({ ...silent, failingEdges: new Map() });
    expect(sweep.verdicts.map((verdict) => verdict.decision)).toEqual(['no-failed-interface']);
    expect(servicesOf(sweep.order)).toEqual(['a', 'b']);
  });

  it('inverts on a silent record at case scope, and reports the reason as its own decision', () => {
    // A case with no failed call anywhere is a case the record cannot speak about: it is a fact about the
    // recording, not evidence that a call between these two completed.
    const sweep = inspectContainmentOrder({
      ...silent,
      failingEdges: new Map(),
      recordScope: 'case',
    });
    expect(sweep.verdicts.map((verdict) => verdict.decision)).toEqual(['record-silent']);
    expect(servicesOf(sweep.order)).toEqual(['b', 'a']);
  });

  it('keeps the veto when the case recorded a failed call somewhere else', () => {
    // The call between these two completed — that is what the record says when it says anything at all — and a
    // case-level walk must not lose that. This is the arm's whole risk and the three losses §299 records.
    const sweep = inspectContainmentOrder({
      ...silent,
      failingEdges: new Map([[failureEdgeKey('b', 'a'), { rise: 9, novel: 0 }]]),
      recordScope: 'case',
    });
    expect(sweep.verdicts.map((verdict) => verdict.decision)).toEqual(['no-failed-interface']);
    expect(servicesOf(sweep.order)).toEqual(['a', 'b']);
  });

  it('still refuses a silent pair the excursions do not support', () => {
    // Silence removes a REQUIREMENT, never a measurement: a case-scoped walk whose callee is not further out is
    // refused for the same reason the edge-scoped one is.
    const sweep = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 4],
        ['b', 1],
      ]),
      failingEdges: new Map(),
      recordScope: 'case',
    });
    expect(sweep.verdicts.map((verdict) => verdict.decision)).toEqual(['not-larger']);
  });

  it('refuses a silent pair the profile could not measure', () => {
    const sweep = inspectContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([['b', 1]]),
      failingEdges: new Map(),
      recordScope: 'case',
    });
    expect(sweep.verdicts.map((verdict) => verdict.decision)).toEqual(['unmeasured']);
  });

  it('lets the prior speak where the record is silent, and reports its two refusals as its own', () => {
    const below: ContainmentPrior = {
      residuals: new Map([[failureEdgeKey('a', 'b'), 0]]),
      threshold: 0,
    };
    expect(
      inspectContainmentOrder({
        ...silent,
        failingEdges: new Map(),
        recordScope: 'case',
        prior: below,
      }).verdicts.map((verdict) => verdict.decision),
    ).toEqual(['prior-below']);
    const absent: ContainmentPrior = { residuals: new Map(), threshold: 0 };
    expect(
      inspectContainmentOrder({
        ...silent,
        failingEdges: new Map(),
        recordScope: 'case',
        prior: absent,
      }).verdicts.map((verdict) => verdict.decision),
    ).toEqual(['prior-absent']);
  });

  it('inverts a silent pair the residual admits, and still calls the reason the silence', () => {
    const admitted: ContainmentPrior = {
      residuals: new Map([[failureEdgeKey('a', 'b'), 0.4]]),
      threshold: 0,
    };
    const sweep = inspectContainmentOrder({
      ...silent,
      failingEdges: new Map(),
      recordScope: 'case',
      prior: admitted,
    });
    expect(sweep.verdicts.map((verdict) => verdict.decision)).toEqual(['record-silent']);
    expect(servicesOf(sweep.order)).toEqual(['b', 'a']);
  });

  it('calls a licensed inversion `inverted` even at case scope, because the record did speak', () => {
    const sweep = inspectContainmentOrder({
      ...silent,
      failingEdges: new Map([[failureEdgeKey('a', 'b'), { rise: 12, novel: 0 }]]),
      recordScope: 'case',
    });
    expect(sweep.verdicts.map((verdict) => verdict.decision)).toEqual(['inverted']);
    expect(servicesOf(sweep.order)).toEqual(['b', 'a']);
  });

  it('is unreachable without a record at all, because there is then nothing to be silent', () => {
    // `failingEdges` absent is the ruled-out arm, not a case-scoped one: no map means no requirement, and the
    // pass reads the excursions alone. A walk that labelled its inversions `record-silent` here would claim a
    // record it was never given.
    const sweep = inspectContainmentOrder({ ...silent, recordScope: 'case' });
    expect(sweep.verdicts.map((verdict) => verdict.decision)).toEqual(['inverted']);
  });
});

describe('recordWindow', () => {
  /** Four services in a line, each callee further outside its band than its caller. */
  const LINE = {
    ranking: rows('a', 'b', 'c', 'd'),
    edges: [
      { from: 'a', to: 'b', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
      { from: 'b', to: 'c', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
      { from: 'c', to: 'd', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
    ],
    excursions: new Map([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
    ]),
  } as const;

  it('limits the RECORD and not the decision', () => {
    // The property the field exists for, and the one a windowed SWEEP would violate: `order` is the same array the
    // pass would return without the field, because the pass decides over the whole list either way. A fixture where
    // the window could change the order is what would let the artifact decide the answer it reports.
    const wide = inspectContainmentOrder(LINE);
    const narrow = inspectContainmentOrder({ ...LINE, recordWindow: 2 });
    expect(servicesOf(narrow.order)).toEqual(servicesOf(wide.order));
    expect(servicesOf(narrow.order)).toEqual(['b', 'a', 'd', 'c']);
    // One row: the window is stated in POSITIONS, so `2` records the single pair at positions 1-2.
    // Two rows and not three: the pair at positions 2-3 is `a` against `c`, which carries no call edge and is
    // therefore not an adjacency the pass records at all.
    expect(wide.verdicts).toHaveLength(2);
    expect(narrow.verdicts).toHaveLength(1);
    expect(narrow.verdicts[0]).toEqual(wide.verdicts[0]);
  });

  it('records the same prefix a sweep of that width would, so a dump is not a different walk', () => {
    // The reason the field replaced a truncated input rather than being added beside it: the verdicts inside the
    // window are identical to the ones a shorter sweep produces, because the pass is a single forward scan and a
    // swap at `i` cannot reach a pair at `j > i`. That equality is what lets a reader compare this corpus to the
    // five-wide one without a second dispatch.
    const narrow = inspectContainmentOrder({ ...LINE, recordWindow: 3 });
    const shorter = inspectContainmentOrder({ ...LINE, ranking: rows('a', 'b', 'c') });
    expect(narrow.verdicts).toEqual(shorter.verdicts.slice(0, 2));
  });

  it('records nothing at a window of one, and still performs the sweep', () => {
    const sweep = inspectContainmentOrder({ ...LINE, recordWindow: 1 });
    expect(sweep.verdicts).toEqual([]);
    expect(servicesOf(sweep.order)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('clamps a window wider than the order instead of padding the record', () => {
    const sweep = inspectContainmentOrder({ ...LINE, recordWindow: 99 });
    expect(sweep.verdicts).toEqual(inspectContainmentOrder(LINE).verdicts);
  });
});

describe('recordWindow and the prior', () => {
  /** The same four-service line, with the residual's two refusals available to it. */
  const LINE = {
    ranking: rows('a', 'b', 'c', 'd'),
    edges: [
      { from: 'a', to: 'b', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
      { from: 'b', to: 'c', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
      { from: 'c', to: 'd', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
    ],
    excursions: new Map([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
    ]),
  } as const;

  /** No residual on the first pair, and an exactly-zero one on the third: the two refusals in one walk. */
  const BOTH_REFUSALS: ContainmentPrior = {
    residuals: new Map([[failureEdgeKey('c', 'd'), 0]]),
    threshold: 0,
  };

  it('suppresses a prior refusal outside the window without changing what it decided', () => {
    // The two `prior-*` verdicts sit BELOW the window's edge in the code, one branch deeper than the four
    // refusals above them, so a window that only guarded the early ones would record a refusal the run's stated
    // population does not contain — and the census of blocked inversions is read off exactly those rows.
    const wide = inspectContainmentOrder({ ...LINE, prior: BOTH_REFUSALS });
    const narrow = inspectContainmentOrder({ ...LINE, prior: BOTH_REFUSALS, recordWindow: 2 });
    // Nothing inverts, so the walk examines all three adjacencies: absent, absent, and the exactly-zero residual.
    expect(wide.verdicts.map((verdict) => verdict.decision)).toEqual([
      'prior-absent',
      'prior-absent',
      'prior-below',
    ]);
    expect(narrow.verdicts.map((verdict) => verdict.decision)).toEqual(['prior-absent']);
    // The ORDER is the prior's, not the window's: both walks refuse the same two pairs, so both keep the fusion's
    // order. A window that reached the decisions would let a narrower dump report a different engine.
    expect(servicesOf(narrow.order)).toEqual(servicesOf(wide.order));
    expect(servicesOf(wide.order)).toEqual(['a', 'b', 'c', 'd']);
  });
});
