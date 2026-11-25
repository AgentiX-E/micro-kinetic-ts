/**
 * Unit tests for the trace-channel census: the instrument that asks what the FSE'26 cell reads when its
 * trace-derived inputs are taken away.
 *
 * ## What this file is defending
 *
 * `arXiv:2603.02057` (TU Berlin / Huawei, 2026-03-02) re-runs 24 RCA methods on a GPU-driven LLM inference
 * deployment and finds **"trace-based methods largely fail"** there, while metric-based ones are strongly
 * fault-type dependent and only multi-source approaches hold. This engine's largest single FSE'26 gain is
 * `failedTraceEdges`, so the paper is a statement about a channel this arm leans on and the question is how
 * hard: if the cell loses twenty points without traces, the dependence is structural and the paper names a
 * real ceiling; if it loses three, the paper is about methods that lean on traces harder than this one does.
 *
 * The census answers that with an ablation, and an ablation has exactly one thing it may not do: **change the
 * label**. Three of these tests exist only to assert that it does not — the accepted set, the fault type and
 * the metric series survive every strip, because a "gain" produced by narrowing the answer set would be the
 * same defect class as a gate that reads the answer key.
 *
 * ## Why the arms are a record over a union and not a list
 *
 * `--log-mode count` was once dropped from a hand-written `||` chain, so a dispatch that asked for `count`
 * silently ran `logicHttp` and two comparisons came back byte-identical. The arm vocabulary here is a
 * `Record<TraceChannel, …>` for the same reason: **adding a channel to the union fails to compile until it is
 * added to the table**, so a fourth trace channel cannot become silently unablatable.
 *
 * @module benchmarks/__tests__/trace-channel-census
 */

import type { BenchmarkCase, FSE26RawCase } from '../../packages/kinetic/src/benchmarks/index.js';
import {
  TRACE_ARM_NAMES,
  TRACE_CHANNELS,
  acceptedServices,
  accumulateTraceCase,
  createTraceCensus,
  formatTraceCensusLine,
  rawForArm,
  stripAllTraceChannels,
  stripTraceChannel,
  topOneHit,
  type RankedService,
  type TraceArmHits,
  type TraceArmName,
} from '../src/trace-channel-census.js';

/** A case carrying one edge in each of the three trace channels, and nothing else of interest. */
function rawCase(overrides: Partial<FSE26RawCase> = {}): FSE26RawCase {
  return {
    datapack: 'ts0-ts-order-service-exception-hdgpgm',
    faultType: 'exception',
    groundTruthServices: ['ts-order-service'],
    injectTimeMs: 1_700_000_000_000,
    metrics: {},
    traceEdges: [['ts-ui-dashboard', 'ts-order-service']],
    failedTraceEdges: [['ts-ui-dashboard', 'ts-order-service', 3, 0]],
    traceEdgeLatency: [['ts-ui-dashboard', 'ts-order-service', 12, 340]],
    logs: [],
    ...overrides,
  };
}

/** A ranking position. `topOneHit` reads only the name, which is the point of {@link RankedService}. */
function ranked(serviceId: string): RankedService {
  return { serviceId };
}

describe('TRACE_CHANNELS', () => {
  it('names the three trace-derived inputs the FSE\'26 loader forwards, and only those', () => {
    // Exhaustive by construction: the record's keys ARE the union.
    expect(Object.keys(TRACE_CHANNELS).sort()).toEqual([
      'call-graph-edges',
      'edge-latency',
      'failed-edges',
    ]);
  });

  it('maps every channel to the raw field it empties', () => {
    // The mapping is the contract: a channel that named no field would strip nothing and read as a null
    // result, which is indistinguishable from "the engine does not use this channel".
    expect(TRACE_CHANNELS['call-graph-edges'].field).toBe('traceEdges');
    expect(TRACE_CHANNELS['failed-edges'].field).toBe('failedTraceEdges');
    expect(TRACE_CHANNELS['edge-latency'].field).toBe('traceEdgeLatency');
  });
});

describe('stripTraceChannel', () => {
  it('empties the call-graph channel and leaves the other two channels intact', () => {
    const out = stripTraceChannel(rawCase(), 'call-graph-edges');
    expect(out.traceEdges).toEqual([]);
    expect(out.failedTraceEdges).toEqual([['ts-ui-dashboard', 'ts-order-service', 3, 0]]);
    expect(out.traceEdgeLatency).toEqual([['ts-ui-dashboard', 'ts-order-service', 12, 340]]);
  });

  it('empties the failed-edge channel and leaves the call graph intact', () => {
    const out = stripTraceChannel(rawCase(), 'failed-edges');
    expect(out.failedTraceEdges).toEqual([]);
    expect(out.traceEdges).toEqual([['ts-ui-dashboard', 'ts-order-service']]);
  });

  it('empties the edge-latency channel and leaves the call graph intact', () => {
    const out = stripTraceChannel(rawCase(), 'edge-latency');
    expect(out.traceEdgeLatency).toEqual([]);
    expect(out.traceEdges).toEqual([['ts-ui-dashboard', 'ts-order-service']]);
  });

  it('returns a new object rather than mutating its input', () => {
    // An in-place strip would make the arms ORDER-DEPENDENT: the second arm would read a case the first had
    // already cut, and every arm after the first would measure a cumulative ablation it was not labelled as.
    const input = rawCase();
    stripTraceChannel(input, 'call-graph-edges');
    expect(input.traceEdges).toEqual([['ts-ui-dashboard', 'ts-order-service']]);
  });

  it('never touches the label, the fault type, the metrics, the logs or the injection time', () => {
    // The one thing an ablation may not do. A narrower accepted set on a stripped arm would produce a "gain"
    // that is really the answer key moving, which is the defect `engineRank` was refused for.
    for (const channel of TRACE_ARM_NAMES) {
      if (channel === 'baseline' || channel === 'all-trace') continue;
      const out = stripTraceChannel(rawCase(), channel);
      expect(out.groundTruthServices).toEqual(['ts-order-service']);
      expect(out.faultType).toBe('exception');
      expect(out.metrics).toEqual({});
      expect(out.logs).toEqual([]);
      expect(out.injectTimeMs).toBe(1_700_000_000_000);
      expect(out.datapack).toBe('ts0-ts-order-service-exception-hdgpgm');
    }
  });

  it('preserves a two-label network fault exactly as it found it', () => {
    // Network faults accept BOTH the injection point's source and target, and the census scores the dual-label
    // set. A strip that dropped the second label would raise accuracy by making the question easier.
    const out = stripTraceChannel(
      rawCase({ faultType: 'network-delay', groundTruthServices: ['ts-a', 'ts-b'] }),
      'failed-edges',
    );
    expect(out.groundTruthServices).toEqual(['ts-a', 'ts-b']);
  });

  it('is idempotent', () => {
    const once = stripTraceChannel(rawCase(), 'edge-latency');
    const twice = stripTraceChannel(once, 'edge-latency');
    expect(twice).toEqual(once);
  });

  it('empties a field that was already absent without adding a spurious value', () => {
    // Absent and empty are the same thing downstream — `toFSE26FailedEdges` and `toFSE26EdgeLatency` both
    // return `undefined` for either — so a case the bridge never instrumented strips to the same state.
    const out = stripTraceChannel(rawCase({ failedTraceEdges: undefined }), 'failed-edges');
    expect(out.failedTraceEdges).toEqual([]);
  });
});

describe('TRACE_ARM_NAMES', () => {
  it('carries the baseline, every channel once, and the all-trace arm', () => {
    expect([...TRACE_ARM_NAMES].sort()).toEqual([
      'all-trace',
      'baseline',
      'call-graph-edges',
      'edge-latency',
      'failed-edges',
    ]);
  });

  it('has one arm per channel, so no channel can be silently unablatable', () => {
    for (const channel of Object.keys(TRACE_CHANNELS)) {
      expect(TRACE_ARM_NAMES).toContain(channel);
    }
  });

  it('reports the full-removal arm as exactly the three channels applied in sequence', () => {
    // The composite arm is derived, not hand-written: if it disagreed with the singles the table would report a
    // total that is not the sum of the parts it is presented as.
    let raw = rawCase();
    for (const channel of Object.keys(TRACE_CHANNELS) as Array<keyof typeof TRACE_CHANNELS>) {
      raw = stripTraceChannel(raw, channel);
    }
    expect(raw).toEqual(stripAllTraceChannels(rawCase()));
    expect(raw.traceEdges).toEqual([]);
    expect(raw.failedTraceEdges).toEqual([]);
    expect(raw.traceEdgeLatency).toEqual([]);
    // And nothing else moved.
    expect(raw.groundTruthServices).toEqual(['ts-order-service']);
    expect(raw.injectTimeMs).toBe(1_700_000_000_000);
  });

  it('leaves the control arm alone, so `baseline` and the shipped run are the same case', () => {
    // `baseline` is not in the channel table and must never be stripped. Asserted because the arm name is a
    // member of the same union the channels are, so a caller that passed it to `stripTraceChannel` would be a
    // type error — but the TABLE-driven loop above iterates that union and a reader is owed the proof.
    expect(Object.keys(TRACE_CHANNELS)).not.toContain('baseline');
    expect(Object.keys(TRACE_CHANNELS)).not.toContain('all-trace');
  });
});

describe('rawForArm', () => {
  it('returns the case ITSELF for the control, not a copy', () => {
    // The control must be the case the shipped run scores, byte for byte. A copy that differed in one key would
    // make `baseline` a sixth arm rather than the reference the other four are measured against.
    const input = rawCase();
    expect(rawForArm(input, 'baseline')).toBe(input);
  });

  it('strips exactly one channel for a single arm', () => {
    expect(rawForArm(rawCase(), 'failed-edges').failedTraceEdges).toEqual([]);
    expect(rawForArm(rawCase(), 'failed-edges').traceEdges).toEqual([
      ['ts-ui-dashboard', 'ts-order-service'],
    ]);
  });

  it('strips all three for the composite arm', () => {
    const out = rawForArm(rawCase(), 'all-trace');
    expect(out.traceEdges).toEqual([]);
    expect(out.failedTraceEdges).toEqual([]);
    expect(out.traceEdgeLatency).toEqual([]);
  });

  it('agrees with applying the single strips one after another, for every channel', () => {
    // The composite arm is presented as the sum of the singles. If the two disagreed the table would report a
    // total that is not what its parts say.
    let manual = rawCase();
    for (const channel of Object.keys(TRACE_CHANNELS) as Array<keyof typeof TRACE_CHANNELS>) {
      manual = stripTraceChannel(manual, channel);
    }
    expect(rawForArm(rawCase(), 'all-trace')).toEqual(manual);
  });

  it('never mutates the case it is given', () => {
    const input = rawCase();
    rawForArm(input, 'all-trace');
    expect(input.traceEdges).toEqual([['ts-ui-dashboard', 'ts-order-service']]);
  });
});

describe('acceptedServices', () => {
  it('reads the dual-label set when the case carries one', () => {
    const benchCase = {
      groundTruth: { serviceId: 'ts-a', serviceIds: ['ts-a', 'ts-b'] },
    } as unknown as BenchmarkCase;
    expect([...acceptedServices(benchCase)].sort()).toEqual(['ts-a', 'ts-b']);
  });

  it('falls back to the single label when it does not', () => {
    const benchCase = {
      groundTruth: { serviceId: 'ts-order-service' },
    } as unknown as BenchmarkCase;
    expect([...acceptedServices(benchCase)]).toEqual(['ts-order-service']);
  });
});

describe('topOneHit', () => {
  it('counts rank 1 in the accepted set as a hit', () => {
    expect(topOneHit([ranked('ts-order-service')], new Set(['ts-order-service']))).toBe(true);
  });

  it('counts the SECOND label of a network fault as a hit', () => {
    // The whole point of the dual-label set: the engine naming the target of an injected network fault is
    // correct, and scoring it against the first label alone would under-count it.
    expect(topOneHit([ranked('ts-b')], new Set(['ts-a', 'ts-b']))).toBe(true);
  });

  it('counts rank 1 outside the accepted set as a miss', () => {
    expect(topOneHit([ranked('ts-cart-service')], new Set(['ts-a', 'ts-b']))).toBe(false);
  });

  it('counts an empty ranking as a miss rather than throwing', () => {
    // A case whose graph had no edges produces no ranking; a census that threw on it would lose the case
    // entirely and quietly raise the denominator's accuracy.
    expect(topOneHit([], new Set(['ts-a']))).toBe(false);
  });

  it('reads position 0 only, not any position in the accepted set', () => {
    expect(
      topOneHit([ranked('ts-cart-service'), ranked('ts-a')], new Set(['ts-a'])),
    ).toBe(false);
  });
});

describe('accumulateTraceCase', () => {
  /** Every arm set to `hits`, so a test states only the arms it is about. */
  function allArms(hits: boolean): TraceArmHits {
    return Object.fromEntries(TRACE_ARM_NAMES.map((arm) => [arm, hits])) as TraceArmHits;
  }

  it('tallies per arm and records the cases an arm LOST against the baseline', () => {
    let census = createTraceCensus();
    census = accumulateTraceCase(census, 'c1', {
      ...allArms(true),
      'call-graph-edges': false,
      'all-trace': false,
    });
    expect(census.arms['call-graph-edges'].hits).toBe(0);
    expect(census.arms['call-graph-edges'].total).toBe(1);
    expect(census.arms['call-graph-edges'].lost).toEqual(['c1']);
    expect(census.arms['failed-edges'].lost).toEqual([]);
  });

  it('records the cases an arm GAINED, which is the direction that refutes the paper', () => {
    // A channel the engine does not need can only be neutral or harmful. An arm that gains cases when the
    // channel is removed says the channel is actively misleading, which is a different finding and must not be
    // reported as zero.
    let census = createTraceCensus();
    census = accumulateTraceCase(census, 'c1', {
      ...allArms(false),
      'call-graph-edges': true,
      'all-trace': true,
    });
    expect(census.arms['all-trace'].gained).toEqual(['c1']);
    expect(census.arms['all-trace'].lost).toEqual([]);
  });

  it('counts a case once per arm whatever the hit, so the denominator cannot drift', () => {
    let census = createTraceCensus();
    for (const id of ['c1', 'c2', 'c3']) {
      census = accumulateTraceCase(census, id, {
        ...allArms(true),
        'failed-edges': false,
        'all-trace': false,
      });
    }
    for (const arm of TRACE_ARM_NAMES) {
      expect(census.arms[arm].total).toBe(3);
    }
    expect(census.arms.baseline.hits).toBe(3);
    expect(census.arms['failed-edges'].hits).toBe(0);
  });

  it('starts empty rather than zero-filled, so an unrun arm is not reported as 0 %', () => {
    const census = createTraceCensus();
    for (const arm of TRACE_ARM_NAMES) {
      expect(census.arms[arm].total).toBe(0);
      expect(census.arms[arm].hits).toBe(0);
    }
    expect(formatTraceCensusLine(census, 'all-trace')).toContain('not measured');
  });

  it('leaves the input census untouched', () => {
    const before = createTraceCensus();
    const after = accumulateTraceCase(before, 'c1', allArms(true));
    expect(before.arms.baseline.total).toBe(0);
    expect(after.arms.baseline.total).toBe(1);
  });
});

describe('formatTraceCensusLine', () => {
  /** Every arm set to `hits`. */
  function allArms(hits: boolean): TraceArmHits {
    return Object.fromEntries(TRACE_ARM_NAMES.map((arm) => [arm, hits])) as TraceArmHits;
  }

  function measured(): ReturnType<typeof createTraceCensus> {
    let census = createTraceCensus();
    // Ten cases, all correct on the baseline. Then: call-graph 4, failed-edges 3, edge-latency 8, all-trace 2.
    const rows: Array<Partial<Record<TraceArmName, boolean>>> = [
      { 'call-graph-edges': true, 'failed-edges': true, 'edge-latency': true, 'all-trace': true },
      { 'call-graph-edges': true, 'failed-edges': true, 'edge-latency': true, 'all-trace': true },
      { 'call-graph-edges': false, 'failed-edges': true, 'edge-latency': true, 'all-trace': false },
      { 'call-graph-edges': false, 'failed-edges': false, 'edge-latency': true, 'all-trace': false },
      { 'call-graph-edges': false, 'failed-edges': false, 'edge-latency': true, 'all-trace': false },
      { 'call-graph-edges': false, 'failed-edges': false, 'edge-latency': true, 'all-trace': false },
      { 'call-graph-edges': false, 'failed-edges': false, 'edge-latency': false, 'all-trace': false },
      { 'call-graph-edges': false, 'failed-edges': false, 'edge-latency': false, 'all-trace': false },
      { 'call-graph-edges': true, 'failed-edges': false, 'edge-latency': true, 'all-trace': false },
      { 'call-graph-edges': true, 'failed-edges': false, 'edge-latency': true, 'all-trace': false },
    ];
    rows.forEach((row, i) => {
      census = accumulateTraceCase(census, `c${i}`, { ...allArms(false), baseline: true, ...row });
    });
    return census;
  }

  it('renders the arm count and the count as a fraction of the denominator', () => {
    const line = formatTraceCensusLine(measured(), 'all-trace');
    expect(line).toContain('10');
    expect(line).toContain('2/10');
  });

  it('renders the delta against the baseline in points', () => {
    // baseline 10/10, failed-edges 3/10 = -70.0 pp. The sign matters: a reader must not have to subtract.
    const line = formatTraceCensusLine(measured(), 'failed-edges');
    expect(line).toContain('-70.0');
  });

  it('renders a GAIN with a plus sign rather than an unsigned number', () => {
    let census = createTraceCensus();
    census = accumulateTraceCase(census, 'c1', {
      ...allArms(false),
      'call-graph-edges': true,
    });
    // baseline 0/1, call-graph 1/1 = +100.0 pp.
    expect(formatTraceCensusLine(census, 'call-graph-edges')).toContain('+100.0');
  });

  it('names the cases an arm lost, so a number can be re-derived from the artifact', () => {
    const line = formatTraceCensusLine(measured(), 'all-trace');
    expect(line).toContain('lost=');
    expect(line).toContain('gained=');
  });

  it('renders an unchanged arm as +0.0 rather than as a missing delta', () => {
    let census = createTraceCensus();
    census = accumulateTraceCase(census, 'c1', allArms(true));
    expect(formatTraceCensusLine(census, 'edge-latency')).toContain('+0.0');
  });
});
