/**
 * The dump's WRITE half, asserted against the dump's own READER.
 *
 * `buildFSE26Diagnostic` is the one writer of the format `benchmarks/src/fse26-diagnose-analyze.ts`
 * reads, so the only test that means anything is a round trip: assemble a block from engine objects,
 * parse it with the real parser, and check every value came back. A fixture that pasted expected text
 * would prove the two agreed on a snapshot; this proves they agree on the FORMAT, which is what a
 * second runner depends on when it starts emitting the same artifact.
 *
 * @module benchmarks/__tests__/fse26-diagnostic-builder
 */

import type { FaultPropagationGraph, ServiceCallGraph } from '../../packages/core/src/index.js';
import {
  buildFSE26Diagnostic,
  SERVICE_FIELD_DECIMALS,
  SyntheticBenchmarkGenerator,
} from '../../packages/kinetic/src/benchmarks/index.js';
import {
  toFSE26EdgeLatency,
  toFSE26FailedEdges,
} from '../../packages/kinetic/src/benchmarks/loaders/fse26-loader.js';
import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { parseDiagnosticDump } from '../src/fse26-diagnose-analyze.js';

const generator = new SyntheticBenchmarkGenerator();

/** One case, from the generator, so the metric inventory is a real one. */
function caseOf(extra: Partial<BenchmarkCase> = {}): BenchmarkCase {
  const base = generator.generateRCAEvalCase('cpu', 3);
  return { ...base, ...extra };
}

/**
 * A graph over the case's own call graph.
 *
 * `anomalyScores` is keyed by every node so the dump has a value for each, and the diagnostics are
 * supplied rather than omitted so the decisive-composition line is exercised — that line is what the
 * offline screens read, and it is absent, not zero, when the block does not render it.
 */
function graphOf(
  callGraph: ServiceCallGraph,
  overrides: Partial<FaultPropagationGraph> = {},
): FaultPropagationGraph {
  const ids = [...callGraph.nodes.keys()];
  return {
    callGraph,
    propagationWeights: new Float64Array(callGraph.edges.length),
    anomalyScores: new Map(ids.map((id, index) => [id, 1 - index * 0.1])),
    anomalyOnsetTimes: new Map(ids.map((id) => [id, 0])),
    detectedCycles: [],
    totalCycleContribution: 0,
    pruneThreshold: 0.001,
    dominantMetrics: new Map(
      ids.map((id) => [
        id,
        { label: 'cpu_usage_percent', head: [0.1], tail: [0.9], transientSkipped: [] },
      ]),
    ),
    logScores: new Map(ids.map((id, index) => [id, 0.5 - index * 0.1])),
    metricDiagnostics: new Map(
      ids.map((id) => [
        id,
        [
          {
            label: 'cpu_usage_percent',
            outcome: 'kept' as const,
            score: 0.75,
            breakdown: {
              deviation: 0.4,
              trend: 0.1,
              cv: 0.6,
              burst: 0,
              riseRatio: 12,
              dropRatio: 0,
              baselineMean: 0.02,
            },
          },
        ],
      ]),
    ),
    postInjectOnsetDelays: new Map(ids.map((id, index) => [id, 100 + index * 50])),
    ...overrides,
  };
}

function render(
  benchCase: BenchmarkCase,
  graph: FaultPropagationGraph,
  withLatency = false,
  fieldDecimals?: number,
) {
  return buildFSE26Diagnostic({
    case: withLatency
      ? benchCase
      : { ...benchCase, edgeLatency: undefined, failedTraceEdges: undefined },
    graph,
    ranking: [...graph.callGraph.nodes.keys()].map((serviceId) => ({ serviceId })),
    callGraph: graph.callGraph,
    datapack: 'dp-round-trip',
    faultType: 'HTTPResponseReplaceCode',
    groundTruthServices: [benchCase.groundTruth.serviceId],
    logSignalMode: 'logicHttp',
    injectTimeMs: benchCase.injectTime,
    // Named rather than spread-in: the shared input REQUIRES the precision, so a helper that wants
    // the producer's default has to say which default it means.
    fieldDecimals: fieldDecimals ?? SERVICE_FIELD_DECIMALS,
  });
}

describe('buildFSE26Diagnostic — the block the analyzer reads back', () => {
  it('round-trips every field through the real parser', () => {
    const base = caseOf();
    const [first] = [...base.callGraph.nodes.keys()];
    // A log record per field the block counts, so the round trip covers the counters too: they are
    // the fields no other section of the analyzer re-derives, and a writer that mismatched the
    // reader on their ORDER would be invisible to every assertion about the scalars.
    const benchCase = {
      ...base,
      logs: [
        {
          timestamp: base.injectTime + 10,
          service: first!,
          message: 'boom',
          level: 'ERROR' as const,
          isLogicException: true,
          deepestExceptionClass: 'IllegalArgumentException',
        },
        {
          timestamp: base.injectTime + 20,
          service: first!,
          message: 'fatal',
          level: 'FATAL' as const,
          isHttpException: true,
        },
      ],
    };
    const graph = graphOf(benchCase.callGraph);
    const parsed = parseDiagnosticDump(render(benchCase, graph))[0]!;

    expect(parsed.datapack).toBe('dp-round-trip');
    expect(parsed.faultType).toBe('HTTPResponseReplaceCode');
    expect(parsed.groundTruth).toEqual([benchCase.groundTruth.serviceId]);
    expect(parsed.injectTimeMs).toBe(benchCase.injectTime);
    expect(parsed.logSignalMode).toBe('logicHttp');
    // The order the ranking was in, not a re-sort: `prediction=` is what every attribution
    // comparison reads, and a builder that sorted would report an order the engine never produced.
    expect(parsed.prediction).toEqual([...benchCase.callGraph.nodes.keys()]);
    // Sorted by the FORMATTER, not by the builder: the graph goes on one line and its edge order is
    // an artefact of how the caller enumerated it, so the writer normalises it and two graphs with
    // the same edges produce the same line. The reader therefore sees a set, which is what every
    // structural question asks about.
    expect(parsed.edges).toEqual(benchCase.callGraph.edges.map((e) => `${e.from}>${e.to}`).sort());

    for (const [index, id] of [...benchCase.callGraph.nodes.keys()].entries()) {
      const service = parsed.services.find((s) => s.serviceId === id)!;
      expect(service.selfAnomaly).toBeCloseTo(1 - index * 0.1, 3);
      expect(service.logScore).toBeCloseTo(0.5 - index * 0.1, 3);
      // Read off the GRAPH, so the dump reports the metric the engine named rather than a second
      // argmax over the inventory — the defect that made `inventoryOf` wrong in 9.7% of rows.
      expect(service.dominantMetric).toBe('cpu_usage_percent');
      expect(service.decisiveOutcome?.breakdown?.cv).toBeCloseTo(0.6, 3);
      // Passed through raw: `0` here is the engine's own "no anchor", not an omission.
      expect(service.onsetDelayMs).toBe(100 + index * 50);
      // The counts, read back where they were written: one ERROR with the logic flag, one FATAL with
      // the HTTP flag, and neither carrying both — the union and the sum agree here, so this is a
      // check of the mapping rather than of the overlap.
      const counted =
        service.serviceId === first ? { err: 1, fatal: 1, logic: 1, http: 1 } : undefined;
      if (counted !== undefined) {
        expect(service.errorCount).toBe(counted.err);
        expect(service.fatalCount).toBe(counted.fatal);
        expect(service.logicExceptionCount).toBe(counted.logic);
        expect(service.httpExceptionCount).toBe(counted.http);
        expect(service.bothExceptionCount).toBe(0);
      }
    }
  });

  it('counts failed-edge RECORDS from the case, which is the loader’s normalised form', () => {
    // The count and the loader's conversion have to agree, because the count is what the dump
    // reports and the conversion is what the case carries: a builder reading one while the loader
    // wrote the other is a second source for one number. The raw tuples are the FSE'26 bridge's, and
    // the assertion is that counting them directly gives what the round trip reports.
    const raw: [string, string, number, number][] = [
      ['ts-a', 'ts-b', 3, 1],
      ['ts-c', 'ts-b', 1, 2],
      ['ts-a', 'ts-d', 1, 0],
    ];
    const benchCase = caseOf({ failedTraceEdges: toFSE26FailedEdges(raw) });
    const graph = graphOf(benchCase.callGraph);
    const parsed = parseDiagnosticDump(render(benchCase, graph))[0]!;
    const service = (id: string) => parsed.services.find((s) => s.serviceId === id);

    const direct = new Map<string, number>();
    for (const [, callee] of raw) direct.set(callee, (direct.get(callee) ?? 0) + 1);
    // Only the callees the case's graph actually carries are rendered, so the fixture is compared
    // over the intersection rather than over a name the dump never prints.
    for (const [callee, expected] of direct) {
      if (service(callee) === undefined) continue;
      expect(service(callee)!.failedEdgeRecords).toBe(expected);
    }
  });

  it('reports the LARGEST inbound rise per callee, and counts the callers that measured', () => {
    // A maximum rather than a mean: one caller going from 10 ms to 2 s is the signal, and averaging
    // it against an unchanged caller would bury it.
    const benchCase = caseOf({
      edgeLatency: toFSE26EdgeLatency([
        ['ts-a', 'ts-b', 10, 50],
        ['ts-c', 'ts-b', 10, 200],
        ['ts-a', 'ts-b', 10, 20],
      ]),
    });
    const graph = graphOf(benchCase.callGraph);
    const parsed = parseDiagnosticDump(render(benchCase, graph, true))[0]!;
    const b = parsed.services.find((s) => s.serviceId === 'ts-b');

    if (b !== undefined) {
      expect(b.latRise).toBeCloseTo(20, 3);
      expect(b.latEdges).toBe(3);
    }
  });

  it('carries the caller’s render precision through to the header', () => {
    // The builder sits between the runner and the formatter, so a field dropped HERE is a run that
    // rendered at six decimals and published an artifact claiming three: the reader would draw a box
    // a thousand times too wide for numbers that are actually finer, and every screen would then
    // report a resolution the artifact does not have.
    const benchCase = caseOf();
    const graph = graphOf(benchCase.callGraph);

    expect(parseDiagnosticDump(render(benchCase, graph, false, 6))[0]!.fieldDecimals).toBe(6);
    // And an OMITTED precision is the producer's default rather than a value of the builder's: the
    // builder chooses where the number goes, never what it is.
    expect(parseDiagnosticDump(render(benchCase, graph))[0]!.fieldDecimals).toBe(
      SERVICE_FIELD_DECIMALS,
    );
  });

  it('renders an unmeasured rise as absent, never as zero', () => {
    // The shape a dataset without per-edge latency produces — RCAEval carries no `edgeLatency` — and
    // the one place where a fabricated `0` would be indistinguishable from a measured "nothing got
    // slower". `latRise` is `-`, which the parser reads as `undefined`; the CALLER count is `0`,
    // which is true and is what `latEdges` is for.
    const benchCase = caseOf({ edgeLatency: undefined });
    const graph = graphOf(benchCase.callGraph);
    const parsed = parseDiagnosticDump(render(benchCase, graph))[0]!;

    for (const service of parsed.services) {
      expect(service.latRise).toBeUndefined();
      expect(service.latEdges).toBe(0);
      expect(service.failedEdgeRecords).toBe(0);
    }
  });

  it('drops a latency row the loader refuses rather than printing a non-finite rise', () => {
    // The loader's own contract, exercised through the builder: a row whose durations are not finite
    // and positive is dropped, so neither the maximum nor the caller count can be built from it. The
    // builder does NOT repeat that guard — it would be unreachable — so this asserts the filter lives
    // where it belongs, one layer down.
    const kept = toFSE26EdgeLatency([
      ['ts-a', 'ts-b', 10, 50],
      ['ts-c', 'ts-b', 0, 500],
      ['ts-d', 'ts-b', 10, Number.NaN],
    ]);
    expect(kept).toHaveLength(1);
    const benchCase = caseOf({ edgeLatency: kept });
    const graph = graphOf(benchCase.callGraph);
    const parsed = parseDiagnosticDump(render(benchCase, graph, true))[0]!;
    const b = parsed.services.find((s) => s.serviceId === 'ts-b');

    if (b !== undefined) {
      expect(b.latRise).toBeCloseTo(5, 3);
      expect(b.latEdges).toBe(1);
    }
  });
});
