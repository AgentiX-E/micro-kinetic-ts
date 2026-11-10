/**
 * The idle guard's WINDOW, and the confound that made it necessary.
 *
 * The guard refuses a channel that is at ~0 for more than 40% of its samples. Its denominator used to be the
 * whole recording, and the whole recording's first half is the PRE-INJECTION period — a period in which a
 * fault's error channel is quiet by construction. So the threshold sat below the structural floor of any event
 * channel a fault moves, and the guard refused the TRUTH's own `error` channel on 18 of the 30 RE3:SockShop
 * cases while never once refusing the winner's. These tests hold both halves of the repair: an event channel is
 * measured where its evidence is claimed, and a LEVEL channel keeps the whole-recording rule it was written for.
 *
 * @module __tests__/causal/duty-cycle-window
 */

import type { ServiceCallGraph, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';

import { buildTopologyFaultGraph } from '../../src/causal/topology-fault-graph.js';

/** The one service the fixtures need; the guard is a per-channel rule and reads nothing else. */
function oneNodeGraph(): ServiceCallGraph {
  return {
    nodes: new Map([['svc', { id: 'svc', name: 'svc', namespace: 'default', type: 'service' }]]),
    edges: [],
  } as unknown as ServiceCallGraph;
}

function series(label: string, values: readonly number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 1000),
    values: Float64Array.from(values),
    unit: '',
  };
}

function outcomeOf(label: string, values: readonly number[], injectTimeMs: number): string {
  const result = buildTopologyFaultGraph(
    oneNodeGraph(),
    new Map([['svc', [series(label, values)]]]) as never,
    { injectTimeMs } as never,
  );
  return result.metricDiagnostics.get('svc')!.find((d) => d.label === label)!.outcome;
}

describe('the idle guard measures an event channel where its evidence is claimed', () => {
  // The corpus shape: 20 quiet samples, then a dense fault, then a long decay back to quiet. Over the whole
  // recording this channel is ~0 for 86% of its samples — the reading that refused `carts` on 18 of 30 cases.
  const quietThenFaultThenDecay = (): number[] => [
    ...Array<number>(20).fill(0),
    ...Array<number>(20).fill(3.13),
    ...Array<number>(400).fill(0.36),
  ];

  it('ADMITS an error channel that is quiet before the fault and dense after it', () => {
    const outcome = outcomeOf('error', quietThenFaultThenDecay(), 20_000);
    expect(outcome).not.toBe('duty-cycled-idle');
  });

  it('still REFUSES an error channel that is sporadic in the fault window too', () => {
    // The guard's real job: a channel that blips three times in twenty-one thousand samples is noise, and a
    // term that read it would be reading the recording's length. `re3ss_carts_f4_*` is this shape.
    const values = [...Array<number>(20).fill(0), 5, ...Array<number>(719).fill(0)];
    expect(outcomeOf('error', values, 20_000)).toBe('duty-cycled-idle');
  });

  it("ADMITS the FSE'26 error family, which is the same channel under the other producer's name", () => {
    // The repair above was written against the RCAEval corpus, whose converter names this family `error`. The
    // FSE'26 converter names the same quantity `http.response.error_rate`, and membership of the event family
    // is an EXACT label list — so on that corpus the guard kept the whole-recording denominator and refused
    // the truth's own error channel on a series that steps 0.00 -> 16.7 (measured: `ts-ui-dashboard` under
    // `HTTPResponseReplaceCode`, where the channel was the service's decisive evidence and was dropped anyway).
    // `event-family-census.test.ts` holds the producer side of this; this is the behaviour it buys.
    //
    // The fixture is the corpus shape rather than the one above: a 10 s-window error rate over a 4-minute
    // recording is roughly half quiet and half sustained, because the pre-injection half is quiet BY
    // CONSTRUCTION. That is what puts the whole-recording reading over the 40 % line (24 of 49 samples are
    // zero) while the post-window reading never approaches it.
    const halfQuietThenSustained = [...Array<number>(24).fill(0), ...Array<number>(25).fill(16.4)];
    expect(outcomeOf('error', halfQuietThenSustained, 24_000)).not.toBe('duty-cycled-idle');
    expect(outcomeOf('http.response.error_rate', halfQuietThenSustained, 24_000)).not.toBe(
      'duty-cycled-idle',
    );
  });

  it("REFUSES the FSE'26 error family when the whole recording reads it as idle for its own reasons", () => {
    // The family gains a WINDOW, never an exemption, and the exemption has to be refused where the window is
    // not the reason: the pre-half of every case is quiet, so a case with no boundary to place it against is
    // refused on the whole recording exactly as before. This is `docs/duty-cycle-window.md`'s own rule — the
    // repair is scoped to the window, not to the label.
    const values = [...Array<number>(20).fill(0), 5, ...Array<number>(719).fill(0)];
    expect(outcomeOf('http.response.error_rate', values, 0)).toBe('duty-cycled-idle');
  });

  it('keeps the WHOLE-RECORDING rule for a level channel, which is what it was written for', () => {
    // A latency percentile that is 0 whenever there is no traffic is idle over its whole history; the fix is
    // scoped to the family whose zero is a measurement, so this channel is refused exactly as before.
    const values = [
      ...Array<number>(20).fill(0),
      ...Array<number>(20).fill(3),
      ...Array<number>(400).fill(0),
    ];
    expect(outcomeOf('latency-90', values, 20_000)).toBe('duty-cycled-idle');
  });

  it('falls back to the whole recording when the boundary leaves too little to measure', () => {
    // Two samples is the floor, and a boundary at the last sample is not a window — an idle channel that
    // happens to end on its only non-zero sample must not be admitted on a duty cycle over one point.
    const values = [...Array<number>(60).fill(0), 4];
    expect(outcomeOf('error', values, 59_000)).toBe('duty-cycled-idle');
  });

  it('is inert when the injection instant is unknown, because there is no window to prefer', () => {
    const values = [
      ...Array<number>(20).fill(0),
      ...Array<number>(20).fill(3),
      ...Array<number>(400).fill(0),
    ];
    expect(outcomeOf('error', values, 0)).toBe('duty-cycled-idle');
  });
});
