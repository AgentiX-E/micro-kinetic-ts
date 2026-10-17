/**
 * Unit tests for the FSE'26 diagnostic BUILDER — the write half of the dump.
 *
 * The formatter's own test (`fse26-diagnose.test.ts`) pins how a field renders; this one pins WHERE
 * each field comes from: the graph the engine built, the case the loader produced, or a count taken
 * here because the engine does not expose it. The distinction is the whole point of the module — a
 * dump that re-derives a signal instead of reading it reports a number the ranking never used — so
 * every assertion below is about provenance rather than formatting.
 *
 * @module __tests__/unit/loaders/fse26-diagnostic-builder.test
 */

import type { FaultPropagationGraph, ServiceCallGraph } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';

import { SERVICE_FIELD_DECIMALS } from '../../../src/benchmarks/fse26-diagnose.js';
import { buildFSE26Diagnostic } from '../../../src/benchmarks/fse26-diagnostic-builder.js';
import {
  toFSE26EdgeLatency,
  toFSE26FailedEdges,
} from '../../../src/benchmarks/loaders/fse26-loader.js';
import type { BenchmarkCase } from '../../../src/benchmarks/loaders/types.js';
import { SyntheticBenchmarkGenerator } from '../../../src/benchmarks/synthetic/data-generator.js';

const generator = new SyntheticBenchmarkGenerator();

function caseOf(extra: Partial<BenchmarkCase> = {}): BenchmarkCase {
  const base = generator.generateRCAEvalCase('cpu', 2);
  return { ...base, ...extra };
}

/** The generated case's own service ids, so a fixture names nodes that exist. */
function idsOf(benchCase: BenchmarkCase): [string, string] {
  const ids = [...benchCase.callGraph.nodes.keys()];
  return [ids[0]!, ids[1] ?? ids[0]!];
}

/** A graph with one label per node, and no diagnostics unless the test asks for them. */
function graphOf(
  callGraph: ServiceCallGraph,
  overrides: Partial<FaultPropagationGraph> = {},
): FaultPropagationGraph {
  const ids = [...callGraph.nodes.keys()];
  return {
    callGraph,
    propagationWeights: new Float64Array(0),
    anomalyScores: new Map(ids.map((id) => [id, 0.9])),
    anomalyOnsetTimes: new Map(ids.map((id) => [id, 0])),
    detectedCycles: [],
    totalCycleContribution: 0,
    pruneThreshold: 0.001,
    ...overrides,
  };
}

function render(benchCase: BenchmarkCase, graph: FaultPropagationGraph): string {
  return buildFSE26Diagnostic({
    case: benchCase,
    graph,
    ranking: [{ serviceId: 'second' }, { serviceId: 'first' }],
    callGraph: graph.callGraph,
    datapack: 'dp-builder',
    faultType: 'JVMMemoryStress',
    groundTruthServices: ['first'],
    logSignalMode: 'logicHttp',
    injectTimeMs: benchCase.injectTime,
    // The producer's precision, named rather than omitted: the shared input REQUIRES it, so a
    // caller that wants "what the engine would have used" has to say so.
    fieldDecimals: SERVICE_FIELD_DECIMALS,
  });
}

describe('buildFSE26Diagnostic', () => {
  it('reads the named metric, the scores and the composition off the GRAPH', () => {
    // Not a second argmax over the inventory: the engine's own `dominantMetrics` entry is what the
    // ranking used, and a builder that picked the highest-scoring metric instead would disagree with
    // the engine in 9.7% of rows on the shipped dump — the defect that made `inventoryOf` wrong.
    const benchCase = caseOf();
    const [a, b] = idsOf(benchCase);
    const graph = graphOf(benchCase.callGraph, {
      dominantMetrics: new Map([
        [a, { label: 'cpu_usage', head: [], tail: [], transientSkipped: [] }],
        [b, { label: 'kernel_ticks', head: [], tail: [], transientSkipped: [] }],
      ]),
      anomalyScores: new Map([
        [a, 0.9],
        [b, 0.2],
      ]),
      logScores: new Map([
        [a, 0.5],
        [b, 0],
      ]),
      failedEdgeScores: new Map([
        [a, 0.25],
        [b, 0],
      ]),
      postInjectOnsetDelays: new Map([
        [a, 120],
        [b, -1],
      ]),
      metricDiagnostics: new Map([
        [
          a,
          [
            {
              label: 'cpu_usage',
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
        ],
      ]),
    });
    const text = render(benchCase, graph);

    expect(text).toContain('DIAG datapack=dp-builder faultType=JVMMemoryStress');
    expect(text).toContain('services=2 logMode=logicHttp');
    expect(text).toContain('prediction=[second, first]');
    expect(text).toContain('dominant=cpu_usage');
    expect(text).toContain('selfAnomaly=0.900');
    expect(text).toContain('logScore=0.500');
    expect(text).toContain('failedEdge=0.250');
    // The composition the screens read, rendered for the service the block would otherwise only
    // describe by its scalars.
    expect(text).toContain('metricDecisive: cpu_usage=0.750{dev=0.400,trend=0.100,cv=0.600');
    expect(text).toContain('inject=');
    // The delay is passed through RAW, so the engine's own `-1` reaches the formatter instead of
    // being flattened to a 0 here — the formatter is the only place that knows what `-1` means.
    expect(text).toContain('onset=120');
  });

  it('holds a service with no diagnostics, and a graph that does not cover every node', () => {
    // Absent is not zero: a graph the engine built without the diagnostic maps must render a block a
    // reader can tell apart from one whose every diagnostic was measured as zero, and the metric
    // inventory has to come back empty rather than fabricated.
    //
    // The second population is the node the graph does not mention. It is not a hypothetical — every
    // per-service map here is optional or partial — and the block has to report a score of zero for
    // it rather than dropping the service, because a service missing from the dump is a service no
    // reader can ask about at all.
    //
    // Both populations render the decisive line and MARK it undetermined, which is the change this
    // assertion used to deny: the CHANNEL is universal, and what a graph without diagnostics decides is
    // the VALUE. A channel that vanished instead would leave a reader unable to tell "no composition
    // here" from "this dump predates the line".
    const base = caseOf({ metrics: new Map() });
    const [a, b] = idsOf(base);
    const text = render(
      base,
      graphOf(base.callGraph, {
        anomalyScores: new Map([[a, 0.9]]),
        anomalyOnsetTimes: new Map([[a, 0]]),
      }),
    );

    expect(text).toContain('selfAnomaly=0.900');
    expect(text).toContain(`${b} selfAnomaly=0.000`);
    expect(text).toContain('dominant=-');
    expect(text.match(/metricDecisive: -/g)).toHaveLength(2);
    expect(text).not.toContain('metricDecisive: cpu');
    expect(text).not.toContain('metricTop');
  });

  it('counts failed-edge RECORDS from the case, one per callee', () => {
    // A COUNT, not a score — and the case already carries the loader's normalised form of the raw
    // tuples, so counting a raw array a runner still had in hand would be a second source for one
    // number. Two records against the same callee have to add up.
    const base = caseOf();
    const [a, b] = idsOf(base);
    const benchCase = {
      ...base,
      failedTraceEdges: toFSE26FailedEdges([
        ['caller-a', b, 3, 1],
        ['caller-b', b, 1, 2],
        ['caller-a', a, 1, 0],
      ]),
    };
    const text = render(benchCase, graphOf(benchCase.callGraph));

    expect(text).toContain('failedEdgeRecords=2');
    expect(text).toContain('failedEdgeRecords=1');
  });

  it('reports the LARGEST inbound rise per callee and how many callers measured', () => {
    const base = caseOf();
    const [, b] = idsOf(base);
    const benchCase = {
      ...base,
      edgeLatency: toFSE26EdgeLatency([
        ['caller-a', b, 10, 50],
        ['caller-b', b, 10, 200],
        ['caller-a', b, 10, 20],
      ]),
    };
    const text = render(benchCase, graphOf(benchCase.callGraph));

    // The maximum, not the mean: one caller going from 10 ms to 2 s is the signal, and averaging it
    // against two unchanged callers would bury it. Three rows, so three callers measured.
    expect(text).toContain('latRise=20.000 latEdges=3');
  });

  it('renders an unmeasured rise as a dash', () => {
    // The shape a dataset without per-edge latency produces: `-`, which every reader treats as
    // absent, rather than a 1.0 that would read as "every caller measured the same latency".
    const text = render(caseOf(), graphOf(caseOf().callGraph));

    expect(text).toContain('latRise=- latEdges=0');
    expect(text).toContain('failedEdgeRecords=0');
  });

  it('counts exception signatures by LEVEL and by FLAG, and only after the injection', () => {
    // Two independent flags and one union: `logic + http` double-counts a line carrying both, and
    // the union is the flood the engine's level-1 gate divides by. The pre-injection filter is the
    // third quantity — a line before the fault is not evidence of it.
    const base = caseOf();
    const [a, b] = idsOf(base);
    const benchCase = {
      ...base,
      injectTime: 1000,
      logs: [
        {
          timestamp: 900,
          service: a,
          message: 'pre',
          level: 'ERROR' as const,
          isLogicException: true,
        },
        {
          timestamp: 1100,
          service: a,
          message: 'e1',
          level: 'ERROR' as const,
          isLogicException: true,
        },
        {
          timestamp: 1200,
          service: a,
          message: 'e2',
          level: 'ERROR' as const,
          isLogicException: true,
          isHttpException: true,
          deepestExceptionClass: 'IllegalStateException',
        },
        {
          timestamp: 1300,
          service: a,
          message: 'f1',
          level: 'FATAL' as const,
          isHttpException: true,
        },
        {
          timestamp: 1400,
          service: a,
          message: 'e3',
          level: 'ERROR' as const,
          isLogicException: true,
        },
        { timestamp: 1500, service: a, message: 'e4', level: 'ERROR' as const },
        { timestamp: 1200, service: b, message: 'other', level: 'ERROR' as const },
      ],
    };
    const text = render(benchCase, graphOf(benchCase.callGraph));

    // ERROR 4 (1100, 1200, 1400, 1500 — the 900 one is before the injection), FATAL 1,
    // logic 3, http 2, both 1. `both` is the overlap, so the union the level-1 gate divides by is
    // `logic + http - both` = 4, not the sum of two overlapping sets.
    expect(text).toContain('err=4 fatal=1 logic=3 http=2 both=1');
    // The message cap: four ERROR/FATAL lines, three samples rendered, so a reader sees why the
    // service is anomalous without the block growing with the flood.
    expect(text).toContain('ERR: e1');
    expect(text).toContain('ERR: f1');
    expect(text).not.toContain('ERR: e3');
    expect(text).toContain('exc(1): IllegalStateException');
    // The other service's single line is counted on ITS line, not pooled into the case.
    expect(text).toContain('err=1 fatal=0 logic=0 http=0 both=0');
  });

  it('always renders the graph it scored, sorted, so two runs of one case agree', () => {
    const benchCase = caseOf();
    const graph = graphOf(benchCase.callGraph);
    const text = render(benchCase, graph);
    const rendered = /edges=(\S*)/.exec(text)?.[1] ?? '';

    expect(rendered.split(',')).toEqual(rendered.split(',').sort());
    expect(rendered.split(',')).toEqual(
      benchCase.callGraph.edges.map((e) => `${e.from}>${e.to}`).sort(),
    );
  });
});
