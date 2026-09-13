/**
 * Unit tests for the case -> engine-options mapping.
 *
 * The property under test is the one whose absence caused a real defect: the
 * FSE'26 runner assembles its fault graph inline while every other suite goes
 * through `BenchmarkRunner`, and the inline copy had been dropping
 * `traceActivity` and then `failedTraceEdges`. Neither drop raised an error or
 * lowered coverage — both signals simply received nothing, and "nothing"
 * reports the same headline as "no effect". So the mapping lives in one place
 * and this test pins every case-level input it carries.
 *
 * @module __tests__/unit/runners/fault-graph-options
 */

import { describe, expect, it } from 'vitest';

import type { BenchmarkCase } from '../../../src/benchmarks/loaders/types.js';
import { toFaultGraphOptions } from '../../../src/benchmarks/runners/fault-graph-options.js';

/**
 * The case-level evidence {@link toFaultGraphOptions} forwards.
 *
 * A `Record` over the union rather than a bare list: adding a name to the union
 * without handling it fails to compile, which a plain string array cannot do.
 */
type ForwardedEvidence = 'logs' | 'traceActivity' | 'failedTraceEdges';

const FORWARDED: Readonly<Record<ForwardedEvidence, true>> = {
  logs: true,
  traceActivity: true,
  failedTraceEdges: true,
};

function makeCase(overrides: Partial<BenchmarkCase> = {}): BenchmarkCase {
  return {
    id: 'fse26_case',
    datasetName: 'fse26',
    callGraph: {
      nodes: new Map([
        ['a', { id: 'a', name: 'a', namespace: 'default', labels: {} }],
        ['b', { id: 'b', name: 'b', namespace: 'default', labels: {} }],
      ]),
      edges: [],
      systemLoad: 0.5,
    },
    metrics: new Map(),
    injectTime: 1_757_000_000_000,
    groundTruth: { serviceId: 'a', faultType: 'CPUStress' },
    ...overrides,
  };
}

describe('toFaultGraphOptions', () => {
  it('forwards the injection anchor it is given', () => {
    // The caller owns this policy (the runner disables the anchor for
    // ablations), so the mapping must not re-derive it from the case.
    expect(toFaultGraphOptions(makeCase(), 0).injectTimeMs).toBe(0);
    expect(toFaultGraphOptions(makeCase(), 42).injectTimeMs).toBe(42);
  });

  it('forwards every case-level evidence field it names', () => {
    const logs = [{ timestamp: 1, service: 'a', message: 'x', level: 'ERROR' as const }];
    const traceActivity = new Map([['a', { pre: 1, post: 2 }]]);
    const failedTraceEdges = [{ caller: 'b', callee: 'a', failed: 3, baseline: 0 }];

    const options = toFaultGraphOptions(makeCase({ logs, traceActivity, failedTraceEdges }), 7);

    for (const field of Object.keys(FORWARDED) as ForwardedEvidence[]) {
      expect(options[field]).toBeDefined();
    }
    expect(options.logs).toBe(logs);
    expect(options.traceActivity).toBe(traceActivity);
    expect(options.failedTraceEdges).toBe(failedTraceEdges);
  });

  it('leaves an absent field ABSENT rather than substituting an empty value', () => {
    // The engine reads "absent" as "no evidence" and disables the signal. An
    // empty array or map would be a different claim — that the measurement was
    // taken and found nothing — and the engine's sparse maps keep that
    // distinction, so the mapping must not collapse it.
    const options = toFaultGraphOptions(makeCase(), 7);

    expect(options.logs).toBeUndefined();
    expect(options.traceActivity).toBeUndefined();
    expect(options.failedTraceEdges).toBeUndefined();
  });

  it('is pure: the same case yields an equal options object', () => {
    const oneCase = makeCase({
      failedTraceEdges: [{ caller: 'b', callee: 'a', failed: 1, baseline: 0 }],
    });
    expect(toFaultGraphOptions(oneCase, 5)).toEqual(toFaultGraphOptions(oneCase, 5));
  });
});
