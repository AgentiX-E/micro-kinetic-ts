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
