/**
 * The Cloud-OpsBench adapter: what it keeps, what it refuses, and why the refusal order is a contract.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { CaseSeries, CloudOpsCase } from '../src/cloudopsbench-case.js';
import { readCloudOpsCase } from '../src/cloudopsbench-case.js';
import {
  CLOUDOPSBENCH_SUITE,
  REFUSAL_ORDER,
  benchmarkCaseId,
  callGraphOf,
  groupSeriesByService,
  selectScorable,
  toBenchmarkCase,
  truthServiceOf,
  unitOfMetric,
} from '../src/cloudopsbench-suite.js';
import { initRCAEvalTopology } from '../src/rcaeval-topology.js';

const T0 = 1_700_000_000_000;

// Every case in this file names a REGISTERED system, so the registry has to exist before a case can become a
// benchmark case at all — that is the contract `callGraphOf` enforces, and the guard's own refusal is asserted in
// `cloudopsbench-topology-guard.test.ts`, a file with no initialisation, because module state is per FILE and a
// test that wanted the uninitialised world here would have to depend on running before everything else.
beforeAll(async () => {
  await initRCAEvalTopology();
});

/** One series with a 5 s cadence, which is the corpus's own. */
function series(service: string, metric: string, values: readonly number[]): CaseSeries {
  return {
    service,
    metric,
    timestamps: values.map((_, index) => T0 + index * 5_000),
    values: [...values],
  };
}

/** A scorable case, with overrides for the one field a test is about. */
function scorableCase(over: Partial<CloudOpsCase> = {}): CloudOpsCase {
  return {
    id: 'boutique/performance/1',
    system: 'boutique',
    category: 'performance',
    namespace: 'boutique',
    query: 'Service quality degradation.',
    difficulty: 'hard',
    faultObject: 'app/adservice',
    faultTaxonomy: 'Performance_Fault',
    rootCause: 'pod_cpu_overload',
    services: ['adservice'],
    series: [series('adservice', 'cpu', [0.03, 0.16, 0.17])],
    alert: {
      startMs: T0 + 5_000,
      endMs: T0 + 15_000,
      entities: [{ type: 'Service', name: 'adservice' }],
    },
    hasToolCache: true,
    metricsRows: 3,
    ...over,
  };
}

describe('the label, as a service id', () => {
  it('strips app/ and refuses every other scope', () => {
    expect(truthServiceOf('app/adservice')).toBe('adservice');
    expect(truthServiceOf('app/redis-cart')).toBe('redis-cart');
    // A node or namespace truth is not a service, so no service ranking can contain it — refusing it here is what
    // keeps it out of the denominator instead of scoring the engine as wrong about an entity it cannot name.
    expect(truthServiceOf('node/worker-02')).toBeNull();
    expect(truthServiceOf('namespace/boutique')).toBeNull();
    expect(truthServiceOf('adservice')).toBeNull();
    expect(truthServiceOf('app/')).toBeNull();
    expect(truthServiceOf('/adservice')).toBeNull();
    expect(truthServiceOf('')).toBeNull();
  });
});

describe('a metric column’s unit', () => {
  it('reads the name and states nothing it does not know', () => {
    expect(unitOfMetric('cpu')).toBe('cores');
    expect(unitOfMetric('cpu_cfs')).toBe('cores');
    expect(unitOfMetric('container_cpu')).toBe('cores');
    expect(unitOfMetric('mem')).toBe('bytes');
    expect(unitOfMetric('memory_rss')).toBe('bytes');
    expect(unitOfMetric('pod_mem')).toBe('bytes');
    expect(unitOfMetric('p99latency')).toBe('ms');
    expect(unitOfMetric('p50')).toBe('ms');
    expect(unitOfMetric('http_p99')).toBe('ms');
    expect(unitOfMetric('p99bucket_width')).toBe('');
    expect(unitOfMetric('rps')).toBe('requests/s');
    expect(unitOfMetric('io_rps')).toBe('requests/s');
    expect(unitOfMetric('success_rate')).toBe('ratio');
    expect(unitOfMetric('net_tx')).toBe('bytes/s');
    expect(unitOfMetric('tx_bytes')).toBe('bytes/s');
    // The honest answer for a name that states none: `'count'` would claim the file said something it did not.
    expect(unitOfMetric('queue_depth')).toBe('');
  });
});

describe('grouping series for the engine', () => {
  it('keeps one entry per service, in the input order, with Float64Array values', () => {
    const grouped = groupSeriesByService([
      series('adservice', 'cpu', [0.1, 0.2]),
      series('adservice', 'mem', [10, 20]),
      series('redis-cart', 'cpu', [0.3]),
    ]);
    expect([...grouped.keys()]).toEqual(['adservice', 'redis-cart']);
    const adservice = grouped.get('adservice')!;
    expect(adservice.map((one) => one.label)).toEqual(['cpu', 'mem']);
    expect(adservice[0]!.values).toBeInstanceOf(Float64Array);
    expect(Array.from(adservice[0]!.values)).toEqual([0.1, 0.2]);
    expect(adservice[0]!.timestamps).toEqual([T0, T0 + 5_000]);
    expect(adservice[0]!.unit).toBe('cores');
  });

  it('does not alias the caller’s arrays, so a case cannot mutate a series another case shares', () => {
    const input = series('adservice', 'cpu', [0.1]);
    const grouped = groupSeriesByService([input]);
    const read = grouped.get('adservice')![0]!;
    expect(read.timestamps).not.toBe(input.timestamps);
    expect(read.values).not.toBe(input.values);
  });
});

describe('the call graph over a case’s own services', () => {
  it('builds the registry deployment, and the ring only when it is the arm that was asked for', () => {
    const caseUnderTest = scorableCase({ services: ['adservice', 'cartservice', 'frontend'] });
    const ring = callGraphOf(caseUnderTest, 'ring');
    expect([...ring.nodes.keys()].sort()).toEqual(['adservice', 'cartservice', 'frontend']);
    expect(ring.edges).toHaveLength(3);
    // A directed ring: the last service calls the first, so the collision tree has no sink and no source.
    expect(ring.edges.map((one) => `${one.from}>${one.to}`)).toEqual([
      'adservice>cartservice',
      'cartservice>frontend',
      'frontend>adservice',
    ]);
    expect(ring.systemLoad).toBe(0.5);
    // The registry arm is a DIFFERENT graph over the same three nodes: the deployment between these three has two
    // edges where the ring has three, which is the cheapest statement that the deployment was read rather than
    // synthesised. (For a service triple the registry does not carry the two arms coincide, which is why this
    // assertion is made on a triple it does.)
    const deployment = callGraphOf(caseUnderTest);
    expect([...deployment.nodes.keys()].sort()).toEqual(['adservice', 'cartservice', 'frontend']);
    const pairs = (graph: readonly { from: string; to: string }[]): string[] =>
      graph.map((one) => `${one.from}>${one.to}`).sort();
    expect(pairs(deployment.edges)).not.toEqual(pairs(ring.edges));
    expect(deployment.edges).toHaveLength(2);
  });

  it('builds the ring itself for a system the registry does not carry', () => {
    // A slug outside the map is not an error: the case still has services, and the fallback is the same
    // ring-connect the RCAEval path uses for a case id naming no system.
    const graph = callGraphOf(scorableCase({ system: 'unknown-system', services: ['a', 'b'] }));
    expect(graph.edges.map((one) => `${one.from}>${one.to}`)).toEqual(['a>b', 'b>a']);
    expect(graph.nodes.get('a')?.namespace).toBe('unknown-system');
  });

  it('leaves a single-service case with one self-edge rather than an empty edge list', () => {
    const graph = callGraphOf(scorableCase({ system: 'unknown', services: ['only'] }));
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: 'only', to: 'only' });
  });
});

describe('the suite-level id', () => {
  it('names the dataset, the system, the category and the ordinal', () => {
    expect(benchmarkCaseId(scorableCase())).toBe('cloudopsbench_boutique_performance_1');
    expect(
      benchmarkCaseId(scorableCase({ id: 'trainticket/performance/47', system: 'trainticket' })),
    ).toBe('cloudopsbench_trainticket_performance_47');
  });
});

describe('one case, converted', () => {
  it('takes the injection time from the alert window and the truth from the label', () => {
    const one = toBenchmarkCase(
      scorableCase({
        series: [series('adservice', 'cpu', [0.1, 0.2]), series('frontend', 'rps', [12])],
        services: ['adservice', 'frontend'],
      }),
    );
    expect(one.datasetName).toBe(CLOUDOPSBENCH_SUITE);
    expect(one.injectTime).toBe(T0 + 5_000);
    expect(one.groundTruth.serviceId).toBe('adservice');
    expect(one.groundTruth.faultType).toBe('pod_cpu_overload');
    expect([...one.metrics.keys()]).toEqual(['adservice', 'frontend']);
    // Absent, not empty: the metric-only arm carries no log, trace or edge artefact, and `[]` would claim the file
    // existed and held nothing — a different statement the engine's channels key off.
    expect(one.logs).toBeUndefined();
    expect(one.traces).toBeUndefined();
    expect(one.failedTraceEdges).toBeUndefined();
    expect(one.traceActivity).toBeUndefined();
    expect(one.edgeLatency).toBeUndefined();
    expect(one.logsReadRows).toBeUndefined();
  });

  it('forwards the log bridge to the engine when the case carries one', () => {
    // The corpus states `raw_data/logs.json` in all 754 directories; iteration 372 counted it, and this is the
    // wiring that lets the log channel read it. `logsReadRows` travels with the entries because `logs: []` reads the
    // same for "the file held nothing" and "none of the rows survived the bridge".
    const one = toBenchmarkCase(
      scorableCase({
        logs: {
          entries: [
            { timestamp: T0 + 6_000, service: 'adservice', message: 'boom', level: 'ERROR' },
          ],
          rows: 3,
          undated: 2,
          atOrAfterInjection: 1,
        },
      }),
    );
    expect(one.logs).toHaveLength(1);
    expect(one.logs![0]!.service).toBe('adservice');
    expect(one.logsReadRows).toBe(3);
  });

  it('keeps an EMPTY log list distinct from an absent one', () => {
    // `logs: []` is a file that held nothing. It must reach the engine as `[]` and not be collapsed to `undefined`,
    // because the log channel keys off exactly that difference.
    const one = toBenchmarkCase(
      scorableCase({ logs: { entries: [], rows: 0, undated: 0, atOrAfterInjection: 0 } }),
    );
    expect(one.logs).toEqual([]);
    expect(one.logsReadRows).toBe(0);
  });

  it('falls back to the taxonomy when the case states no root cause', () => {
    const one = toBenchmarkCase(scorableCase({ rootCause: '' }));
    expect(one.groundTruth.faultType).toBe('Performance_Fault');
  });

  it('refuses a case that should never have reached it', () => {
    // Two places deciding what is scorable is how a denominator and a score come to disagree, so the invariant is
    // asserted here instead of re-derived.
    expect(() => toBenchmarkCase(scorableCase({ faultObject: 'node/worker-02' }))).toThrow(
      /names no service/,
    );
    expect(() => toBenchmarkCase(scorableCase({ alert: null }))).toThrow(/no injection time/);
  });
});

describe('the scorable population', () => {
  it('keeps a case that satisfies all four conditions and charges the rest to one reason each', () => {
    const cases: CloudOpsCase[] = [
      scorableCase(),
      scorableCase({ id: 'boutique/admission/1', series: [], services: [], alert: null }),
      // A SECOND case with the same reason: the bucket has to accumulate, and a map that overwrote it would
      // under-report the population by every duplicate — the failure mode a histogram hides.
      scorableCase({ id: 'boutique/startup/1', series: [], services: [], alert: null }),
      scorableCase({ id: 'boutique/performance/2', alert: null }),
      scorableCase({ id: 'boutique/performance/3', faultObject: 'node/worker-02' }),
      scorableCase({
        id: 'boutique/performance/4',
        faultObject: 'app/absent-service',
        services: ['adservice'],
      }),
    ];
    const selection = selectScorable(cases);
    expect(selection.kept).toEqual(['boutique/performance/1']);
    expect(selection.suite.totalCases).toBe(1);
    expect(selection.suite.name).toBe(CLOUDOPSBENCH_SUITE);
    expect([...selection.refused.keys()]).toEqual(REFUSAL_ORDER);
    expect(selection.refused.get('no-series')).toEqual([
      'boutique/admission/1',
      'boutique/startup/1',
    ]);
    expect(selection.refused.get('no-alert-window')).toEqual(['boutique/performance/2']);
    expect(selection.refused.get('truth-outside-service-alphabet')).toEqual([
      'boutique/performance/3',
    ]);
    expect(selection.refused.get('truth-absent-from-own-series')).toEqual([
      'boutique/performance/4',
    ]);
    // Every input is accounted for exactly once, which is the property a denominator has to have.
    const charged = [...selection.refused.values()].reduce((sum, ids) => sum + ids.length, 0);
    expect(charged + selection.kept.length).toBe(cases.length);
  });

  it('charges a case to the FIRST reason it meets, so the buckets cannot overlap', () => {
    // This case would meet three of the four tests. A census that charged it to all of them would print a
    // population larger than the corpus.
    const both = scorableCase({
      id: 'boutique/performance/9',
      series: [],
      services: [],
      alert: null,
      faultObject: 'node/worker-02',
    });
    const selection = selectScorable([both]);
    expect(selection.refused.get('no-series')).toEqual(['boutique/performance/9']);
    expect(selection.refused.has('no-alert-window')).toBe(false);
    expect(selection.refused.has('truth-outside-service-alphabet')).toBe(false);
  });

  it('reports an empty corpus as an empty suite rather than a refusal', () => {
    const selection = selectScorable([]);
    expect(selection.suite.cases).toEqual([]);
    expect(selection.suite.totalCases).toBe(0);
    expect([...selection.refused.keys()]).toEqual([]);
  });

  it('reads a real checkout end to end, which is the only path a score ever takes', () => {
    const root = new URL('./fixtures/cloudopsbench', import.meta.url).pathname;
    const read = readCloudOpsCase(root, 'boutique/performance/1');
    const noSeries = readCloudOpsCase(root, 'boutique/scheduling/1');
    if (!read.ok) throw new Error(read.reason);
    if (!noSeries.ok) throw new Error(noSeries.reason);

    const selection = selectScorable([read.value, noSeries.value]);
    expect(selection.kept).toEqual(['boutique/performance/1']);
    expect(selection.refused.get('no-series')).toEqual(['boutique/scheduling/1']);

    const one = selection.suite.cases[0]!;
    expect(one.id).toBe('cloudopsbench_boutique_performance_1');
    // `ts-basic-service-rps` splits at its last hyphen, so the service list is the case's own names and not a
    // mangled `ts-basic`.
    expect([...one.metrics.keys()]).toEqual(['adservice', 'redis-cart', 'ts-basic-service']);
    expect(one.injectTime).toBe(Date.UTC(2026, 4, 18, 21, 55, 52));
    expect(one.groundTruth.serviceId).toBe('adservice');
  });
});
