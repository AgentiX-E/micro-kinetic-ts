/**
 * The census's POPULATION, asserted against the artifact and against the reader's own field map.
 *
 * `scripts/dump_capability.py` answers one question — what does this artifact carry at all — and it answered
 * it from a hand-written list of seven channels while the artifact renders thirty-one. The list was wrong in
 * both directions that matter: it carried the failed-edge SCORE while the COUNT the record's best-holding
 * candidate reads had no channel, and the latency COUNT while the RISE the `lat` term reads had none — the
 * two families covered in OPPOSITE halves, so a candidate reading either half had to name the other half's
 * channel and was told the other half's reach. The reach in question was not a detail: `latEdges` is valued on
 * every row of the shipped artifact while `latRise` is valued on 52.0% of them.
 *
 * Nothing connected the list to the artifact, and the connection was already available twice over: the
 * PRODUCER (`formatFSE26Diagnostic`) is what writes the fields, and the READER declares them exhaustively —
 * `SERVICE_FIELD_AUDIT` is a `Record<keyof DiagnosedService, string>`, so a new parsed field breaks the build
 * until it is classified there. This file is that connection, and it is asserted in both directions for the
 * same reason the census refuses a one-way count: a one-sided equality passes on an empty table.
 *
 * The census's own table is read from `scripts/dump_capability.channels.json`, a projection the python side
 * regenerates with `python3 scripts/dump_capability.py --channels` and holds equal to its table by
 * `scripts/test_dump_capability.py`. Text is not parsed on either side: a fence that depends on another
 * language's FORMATTING can be disarmed by reindenting the thing it guards.
 *
 * @module benchmarks/__tests__/fse26-capability-census
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FaultPropagationGraph, ServiceCallGraph } from '../../packages/core/src/index.js';
import {
  buildFSE26Diagnostic,
  SERVICE_FIELD_DECIMALS,
  SyntheticBenchmarkGenerator,
} from '../../packages/kinetic/src/benchmarks/index.js';
import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { SEPARATOR_SCALARS, SERVICE_FIELD_AUDIT } from '../src/fse26-separator.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECTION = path.join(REPO_ROOT, 'scripts', 'dump_capability.channels.json');

/** The scopes the census declares, as the projection spells them. */
const ROW = 'row';
const ROW_IDENTITY = 'row-identity';
const CASE_LINE = 'case-line';
const HEADER = 'header';
const SUB_LINE = 'sub-line';

/** One entry of `scripts/dump_capability.channels.json`. */
interface ChannelDeclaration {
  readonly channel: string;
  readonly scope: string;
  readonly key: string | null;
  readonly fields: readonly string[];
}

function declarations(): readonly ChannelDeclaration[] {
  return JSON.parse(readFileSync(PROJECTION, 'utf-8')) as ChannelDeclaration[];
}

function scoped(scope: string): readonly ChannelDeclaration[] {
  return declarations().filter((one) => one.scope === scope);
}

/**
 * Every `<key>=` on the artifact's `DIAG` header line.
 *
 * Taken from the PRODUCER's output rather than from the reader's `HEADER_RE`, because the question is what
 * the artifact carries: a field the writer emits and the reader's pattern does not match is a finding, not a
 * licence to compare the writer against itself.
 */
function emittedHeaderKeys(text: string): readonly string[] {
  const line = text.split('\n').find((one) => one.startsWith('DIAG '));
  if (line === undefined) throw new Error('the producer wrote no DIAG header');
  return [...line.matchAll(/\b(\w+)=/g)].map((match) => match[1]!);
}

/** Every `<key>=` on a two-space line of its own inside the case: `edges=`, `prediction=`. */
function emittedCaseLineKeys(text: string): readonly string[] {
  return text
    .split('\n')
    .filter((one) => /^ {2}\w+=/.test(one) && !one.includes('selfAnomaly='))
    .map((one) => /^ {2}(\w+)=/.exec(one)![1]!);
}

/** Every `<key>=` on a service row, which is every per-service magnitude the block renders. */
function emittedRowKeys(text: string): readonly string[] {
  const row = text.split('\n').find((one) => one.includes('selfAnomaly='));
  if (row === undefined) throw new Error('the producer wrote no service row');
  return [...row.matchAll(/\b(\w+)=/g)].map((match) => match[1]!);
}

/** Every four-space sub-line's marker, which is the inventory's and the messages' own grammar. */
function emittedSubLineKeys(text: string): readonly string[] {
  return text
    .split('\n')
    .map((one) => /^ {4}([A-Za-z]\w*)[:(]/.exec(one))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]!);
}

const generator = new SyntheticBenchmarkGenerator();

function caseOf(): BenchmarkCase {
  const base = generator.generateRCAEvalCase('cpu', 3);
  const service = base.groundTruth.serviceId as string & { toString(): string };
  // Logs that carry BOTH signature flags on one line, so `both=` is rendered rather than defaulted to zero:
  // the overlap is the term that makes `sigLines` a union, and a fixture without it would leave that channel
  // unexercised while the equality above still passed.
  return {
    ...base,
    logs: [
      {
        timestamp: base.injectTime + 10,
        service: String(service),
        message: 'boom',
        level: 'ERROR' as const,
        isLogicException: true,
        deepestExceptionClass: 'IllegalArgumentException',
      },
      {
        timestamp: base.injectTime + 20,
        service: String(service),
        message: 'also boom',
        level: 'ERROR' as const,
        isLogicException: true,
        isHttpException: true,
        deepestExceptionClass: 'ConnectException',
      },
      {
        timestamp: base.injectTime + 30,
        service: String(service),
        message: 'fatal',
        level: 'FATAL' as const,
        isHttpException: true,
      },
    ],
  };
}

function graphOf(callGraph: ServiceCallGraph): FaultPropagationGraph {
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
          // One DROPPED metric, so `metricDrop` is rendered: a channel the census declares cannot be reached
          // by a fixture that only ever keeps. The outcome is the closed union's own member rather than a cast
          // — `as string` widened the whole array past `MetricDiagnostic` and only the workspace typecheck
          // (which covers `__tests__`) said so.
          {
            label: 'mem_usage_bytes',
            outcome: 'transient-return' as const,
            score: 0,
            breakdown: {
              deviation: 0.1,
              trend: 0.05,
              cv: 0.3,
              burst: 0,
              riseRatio: 1,
              dropRatio: 0,
              baselineMean: 0.5,
            },
          },
        ],
      ]),
    ),
    postInjectOnsetDelays: new Map(ids.map((id, index) => [id, 100 + index * 50])),
  };
}

/** The block the producer writes for one case rendered with EVERY feature, so no channel can pass by absence. */
function fullBlock(): string {
  const benchCase = caseOf();
  const graph = graphOf(benchCase.callGraph);
  return buildFSE26Diagnostic({
    case: benchCase,
    graph,
    ranking: [...benchCase.callGraph.nodes.keys()].map((serviceId) => ({ serviceId })),
    callGraph: benchCase.callGraph,
    datapack: 'dp-census',
    faultType: 'HTTPResponseReplaceCode',
    groundTruthServices: [benchCase.groundTruth.serviceId],
    logSignalMode: 'logicHttp',
    injectTimeMs: benchCase.injectTime,
    fieldDecimals: SERVICE_FIELD_DECIMALS,
  });
}

describe("the capability census's population — the artifact it describes", () => {
  const block = fullBlock();

  it('declares EVERY field the producer renders, in both directions, per scope', () => {
    const emitted: Record<string, readonly string[]> = {
      [HEADER]: emittedHeaderKeys(block),
      [CASE_LINE]: emittedCaseLineKeys(block),
      [ROW]: emittedRowKeys(block),
      [SUB_LINE]: emittedSubLineKeys(block),
    };
    for (const [scope, keys] of Object.entries(emitted)) {
      // Non-vacuity first: an equality between two empty sets is satisfied by a producer that renders
      // nothing and by a table that declares nothing, and this module's whole subject is that trap.
      expect(keys.length).toBeGreaterThan(0);
      expect([...new Set(keys)].sort()).toEqual(
        scoped(scope)
          .map((one) => one.key!)
          .sort(),
      );
    }
    // The identity carries no `<key>=` field, so it is not part of the equality above — asserted here so the
    // two channels cannot be dropped from the table by a passing test.
    expect(
      scoped(ROW_IDENTITY)
        .map((one) => one.channel)
        .sort(),
    ).toEqual(['row-labels', 'service-id']);
  });

  it('declares every field the READER parses, against its own typed map', () => {
    // The connection that was missing. `SERVICE_FIELD_AUDIT` is `Record<keyof DiagnosedService, string>`, so
    // this comparison is against a type-enforced set rather than a list someone maintains: a field added to
    // the parsed row fails the build here until it is classified, and the census then has to declare it.
    const serviceScopes = new Set([ROW, ROW_IDENTITY, SUB_LINE]);
    const declared = [
      ...new Set(
        declarations()
          .filter((one) => serviceScopes.has(one.scope))
          .flatMap((one) => one.fields),
      ),
    ].sort();
    expect(declared).toEqual(Object.keys(SERVICE_FIELD_AUDIT).sort());
  });

  it('leaves no SIGNAL reading a field the census has no channel for', () => {
    // The other half of the same connection: `SEPARATOR_SCALARS` declares `reads`, so a signal added over a
    // field nobody declared a channel for is caught here rather than when a screen is built on a reach the
    // census cannot report. `serviceId` counts — the census has a channel for the row's identity.
    const declared = new Set(declarations().flatMap((one) => one.fields));
    const reads = [...new Set(SEPARATOR_SCALARS.flatMap((scalar) => scalar.reads))].sort();
    expect(reads.length).toBeGreaterThan(10);
    const undeclared = reads.filter((field) => !declared.has(field));
    expect(undeclared).toEqual([]);
  });

  it('is big enough that the equality above is not satisfied by two empty sets', () => {
    expect(declarations().length).toBeGreaterThanOrEqual(31);
    expect(scoped(ROW).length).toBe(13);
    expect(scoped(SUB_LINE).length).toBe(7);
    expect(scoped(HEADER).length).toBe(7);
    expect(scoped(CASE_LINE).length).toBe(2);
    expect(SEPARATOR_SCALARS.length).toBeGreaterThanOrEqual(15);
  });

  it('gives every channel a unique name and every keyed channel a unique literal', () => {
    const channels = declarations().map((one) => one.channel);
    expect(new Set(channels).size).toBe(channels.length);
    const keys = declarations().map((one) => one.key);
    const literal = keys.filter((key): key is string => key !== null);
    expect(new Set(literal).size).toBe(literal.length);
    // A `key` of `null` is the row's IDENTITY and nothing else: it is what the projection spells for the two
    // channels whose field is not a `key=value` at all.
    expect(keys.filter((key) => key === null)).toHaveLength(2);
  });

  it('names a channel for the COUNT as well as the SCORE, and for the RISE as well as the EDGES', () => {
    // The measured defect, kept as an assertion so a future edit cannot silently fold a family back into one
    // name: the two halves of each pair are different quantities, they are read by different signals, and one
    // of the two halves is selective while the other is universal.
    const byChannel = new Map(declarations().map((one) => [one.channel, one]));
    expect(byChannel.get('failed-edge')!.key).toBe('failedEdge');
    expect(byChannel.get('failed-edge-records')!.key).toBe('failedEdgeRecords');
    expect(byChannel.get('latency-edges')!.key).toBe('latEdges');
    expect(byChannel.get('latency-rise')!.key).toBe('latRise');
    // `reads` is typed `keyof DiagnosedService`, which is the point — so the comparison widens it rather than
    // the field narrowing, or the assertion would be about the compiler instead of about the declaration.
    const readBy = (field: string): string[] =>
      SEPARATOR_SCALARS.filter((scalar) => (scalar.reads as readonly string[]).includes(field))
        .map((scalar) => scalar.name)
        .sort();
    expect(readBy('failedEdgeScore')).toEqual(['failedEdge']);
    expect(readBy('failedEdgeRecords')).toEqual(['edgeRecords']);
    expect(readBy('latRise')).toEqual(['lat']);
    expect(readBy('latEdges')).toEqual(['inLatEdges']);
  });

  it('declares a channel for the channels NO reader parses, rather than omitting them', () => {
    // Three lines the producer renders and no parsed field holds. They are channels — the census reports what
    // the artifact CARRIES — and the projection's empty `fields` array is how they are excluded from the field
    // equality by decision rather than by omission.
    const noField = declarations()
      .filter((one) => one.fields.length === 0)
      .map((one) => one.channel)
      .sort();
    expect(noField).toEqual(['error-messages', 'exceptions', 'metric-list']);
  });
});
