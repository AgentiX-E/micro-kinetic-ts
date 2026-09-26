/**
 * The RCAEval runner's dump sink.
 *
 * `renderDiagnosedCase` is the only place the runner's record becomes the analyzer's input, so these
 * tests are about the MAPPING rather than the format: a reader comparing an RCAEval dump with an
 * FSE'26 dump has to be able to trust that the two describe the same configuration, and the three
 * decisions the mapping makes — the accepted set, the anchor, the case id — are exactly the ones
 * where a dump of the golden benchmark could quietly describe a run nobody did.
 *
 * @module benchmarks/__tests__/fse26-diagnose-sink
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FaultPropagationGraph } from '../../packages/core/src/index.js';

import {
  SERVICE_FIELD_DECIMALS,
  SyntheticBenchmarkGenerator,
} from '../../packages/kinetic/src/benchmarks/index.js';
import type { DiagnosedCaseRecord } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import { parseDiagnosticDump } from '../src/fse26-diagnose-analyze.js';
import { diagnoseDumpInput, renderDiagnosedCase } from '../src/fse26-diagnose-sink.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const generator = new SyntheticBenchmarkGenerator(7);

/**
 * A record in the shape the runner hands over.
 *
 * The graph is built directly rather than through an engine: this module reads it and never derives
 * anything from the case's metrics, so an engine in the middle would only add a fixture to explain.
 */
function recordOf(overrides: Partial<DiagnosedCaseRecord> = {}): DiagnosedCaseRecord {
  const benchCase = generator.generateRCAEvalCase('cpu', 3);
  const callGraph = benchCase.callGraph;
  const ids = [...callGraph.nodes.keys()];
  const graph: FaultPropagationGraph = {
    callGraph,
    propagationWeights: new Float64Array(callGraph.edges.length),
    anomalyScores: new Map(ids.map((id, index) => [id, 0.9 - index * 0.1])),
    anomalyOnsetTimes: new Map(ids.map((id) => [id, 0])),
    detectedCycles: [],
    totalCycleContribution: 0,
    pruneThreshold: 0.001,
  };
  return {
    case: benchCase,
    graph,
    ranking: ids.map((serviceId) => ({ serviceId })) as never,
    callGraph,
    ...overrides,
  };
}

describe('renderDiagnosedCase', () => {
  it('reports the case’s OWN accepted set, whole', () => {
    // A benchmark that marks several services correct has to report every one of them: a dump of a
    // multi-label case that carried only the first would describe a different scoring rule from the
    // one that produced the number next to it.
    const record = recordOf();
    const [a, b] = [...record.callGraph.nodes.keys()];
    const multi = {
      ...record,
      case: {
        ...record.case,
        groundTruth: { ...record.case.groundTruth, serviceId: a!, serviceIds: [a!, b!] },
      },
    };
    const parsed = parseDiagnosticDump(
      renderDiagnosedCase(multi, {
        logSignalMode: 'logicHttp',
        useInjectTime: true,
        fieldDecimals: SERVICE_FIELD_DECIMALS,
      }),
    )[0]!;

    expect(parsed.groundTruth).toEqual([a, b]);
    expect(multi.case.groundTruth.serviceIds).toBeDefined();
  });

  it('reports 0 as the anchor when the run disabled it', () => {
    // The anchor describes what the RANKING received, not what the case carries: a dump that wrote
    // the case's own injection time for a `--no-inject-time` run would license a temporal window the
    // engine never had, and every screen downstream would solve for a configuration nobody ran.
    const record = recordOf();
    expect(record.case.injectTime).toBeGreaterThan(0);

    const withoutAnchor = diagnoseDumpInput(record, {
      logSignalMode: 'logicHttp',
      useInjectTime: false,
      fieldDecimals: SERVICE_FIELD_DECIMALS,
    });
    expect(withoutAnchor.injectTimeMs).toBe(0);

    const withAnchor = diagnoseDumpInput(record, {
      logSignalMode: 'logicHttp',
      useInjectTime: true,
      fieldDecimals: SERVICE_FIELD_DECIMALS,
    });
    expect(withAnchor.injectTimeMs).toBe(record.case.injectTime);

    const parsed = parseDiagnosticDump(
      renderDiagnosedCase(record, {
        logSignalMode: 'logicHttp',
        useInjectTime: false,
        fieldDecimals: SERVICE_FIELD_DECIMALS,
      }),
    )[0]!;
    expect(parsed.injectTimeMs).toBe(0);
  });

  it('carries the case id, the ranking and the log mode, so the block joins the artifact table', () => {
    const record = recordOf();
    const parsed = parseDiagnosticDump(
      renderDiagnosedCase(record, {
        logSignalMode: 'novelty',
        useInjectTime: true,
        fieldDecimals: SERVICE_FIELD_DECIMALS,
      }),
    )[0]!;

    expect(parsed.datapack).toBe(record.case.id);
    expect(parsed.logSignalMode).toBe('novelty');
    expect(parsed.prediction).toEqual(record.ranking.map((one) => one.serviceId));
    expect(parsed.services.map((one) => one.serviceId)).toEqual([...record.callGraph.nodes.keys()]);
  });

  it('renders one block per case, with no separator of its own', () => {
    // The runner concatenates the blocks in case order, so the text has to be exactly one block:
    // a trailing newline of the sink's own would still parse, but two sinks disagreeing about the
    // separator is how a join comes to lose a case.
    const record = recordOf();
    const block = renderDiagnosedCase(record, {
      logSignalMode: 'logicHttp',
      useInjectTime: true,
      fieldDecimals: SERVICE_FIELD_DECIMALS,
    });

    expect(parseDiagnosticDump(block)).toHaveLength(1);
    expect(parseDiagnosticDump(block + block)).toHaveLength(2);
  });
});

/**
 * The precision the run rendered at, which the sink must FORWARD rather than choose.
 *
 * The reader's ensembles draw every decimal field inside the cell its render stands for, and the
 * artifact is the only thing that knows how wide that cell is. Two ways for the sink to get this
 * wrong, and both leave a file that parses: it can drop the option (so a four-decimal run is read as
 * a three-decimal one, by a factor of ten per digit), or it can carry a default of its own (a second
 * default, which is the same defect as two owners of a constant).
 */
describe('renderDiagnosedCase — the run’s render precision', () => {
  it('puts the run’s precision in the block, and the block still parses as one case', () => {
    const record = recordOf();
    const parsed = parseDiagnosticDump(
      renderDiagnosedCase(record, {
        logSignalMode: 'logicHttp',
        useInjectTime: true,
        fieldDecimals: 6,
      }),
    )[0]!;

    expect(parsed.fieldDecimals).toBe(6);
  });

  it('renders the FIELDS at that precision too, not only the header', () => {
    // The header and the digits are one value in the producer; this is the sink's half of that claim,
    // because a block whose header said six while its numbers carried three would hand the reader a
    // box three orders of magnitude too wide while looking self-consistent.
    const record = recordOf();
    const block = renderDiagnosedCase(record, {
      logSignalMode: 'logicHttp',
      useInjectTime: true,
      fieldDecimals: 6,
    });
    const selfAnomaly = /selfAnomaly=([\d.]+)/.exec(block)?.[1] ?? '';

    expect(block).toContain('decimals=6');
    expect(selfAnomaly.split('.')[1]).toHaveLength(6);
  });

  it('has NO default of its own: the option is required of every caller', () => {
    // Read as text, because that is the only thing that can see the difference: an optional field
    // with a fallback would satisfy every runtime assertion here and become a second default the day
    // the producer's moves. The sink chooses WHERE the precision goes, never what it is.
    const source = readFileSync(resolve(HERE, '../src/fse26-diagnose-sink.ts'), 'utf8');
    expect(source).toMatch(/readonly fieldDecimals: number;/);
    expect(source).not.toMatch(/fieldDecimals\?:/);
    expect(source).not.toMatch(/fieldDecimals: number \| undefined/);
  });
});
