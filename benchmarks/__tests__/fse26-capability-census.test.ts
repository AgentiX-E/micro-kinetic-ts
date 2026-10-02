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
import type { DiagnosedService } from '../src/fse26-diagnose-analyze.js';
import {
  onsetAvailability,
  parseDiagnosticDump,
  SERVICE_FIELD_KIND,
  UNDETERMINED_TOKENS,
} from '../src/fse26-diagnose-analyze.js';
import { DISCRIMINATOR_FEATURES } from '../src/fse26-discriminator.js';
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
  /** `field` (after the `=`), `paren` (the count in the parentheses) or `body` (the text after the `:`). */
  readonly valueIn: string;
  /** The census's OWN marker pattern, so this side applies the same regex rather than re-deriving it. */
  readonly pattern: string;
  /** The capture values that mean "rendered and undetermined" — the census's `ABSENT_VALUES`, as data. */
  readonly absent: readonly string[];
}

function declarations(): readonly ChannelDeclaration[] {
  return JSON.parse(readFileSync(PROJECTION, 'utf-8')) as ChannelDeclaration[];
}

function scoped(scope: string): readonly ChannelDeclaration[] {
  return declarations().filter((one) => one.scope === scope);
}

/**
 * The census's own reading of one artifact, per ROW, for one channel — the value of the projection's
 * `pattern`, applied the way the census applies it.
 *
 * The pattern travels in the projection for one reason: a regex re-derived here would be a second spelling of
 * the grammar, and a fence whose two halves disagreed about what a line means would pass on its own bug while
 * both halves stayed self-consistent. Here the pattern, the placement and the absent markers are all the
 * census's own values, so the only thing this side contributes is the block's STRUCTURE — a sub-line belongs
 * to the row above it, and the row boundary is taken from the census's own `self-anomaly` channel rather than
 * a literal of this file's choosing.
 *
 * @param text - One producer block.
 * @param declaration - The channel to read.
 * @returns: `reached[i]` / `valued[i]` for the `i`-th row, in the producer's own order.
 */
function censusPerRow(
  text: string,
  declaration: ChannelDeclaration,
): { readonly reached: readonly boolean[]; readonly valued: readonly boolean[] } {
  const pattern = new RegExp(declaration.pattern);
  const rowPattern = new RegExp(
    declarations().find((one) => one.channel === 'self-anomaly')!.pattern,
  );
  const reached: boolean[] = [];
  const valued: boolean[] = [];
  let current = -1;
  for (const line of text.split('\n')) {
    // A row line OPENS a row and is then read like any other line, because a row channel's marker is on it:
    // treating the boundary as a line that belongs to no row made `self-anomaly` — the channel whose marker
    // IS the boundary — report zero rows, which is the shape of harness bug that reads as a broken table.
    if (rowPattern.test(line)) {
      reached.push(false);
      valued.push(false);
      current = reached.length - 1;
    }
    if (current < 0) continue;
    const found = pattern.exec(line);
    if (found === null) continue;
    reached[current] = true;
    if (!declaration.absent.includes(found[1] ?? '')) valued[current] = true;
  }
  return { reached, valued };
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

function caseOf(nonFinite = false): BenchmarkCase {
  const base = generator.generateRCAEvalCase('cpu', 3);
  const service = base.groundTruth.serviceId as string & { toString(): string };
  // Logs that carry BOTH signature flags on one line, so `both=` is rendered rather than defaulted to zero:
  // the overlap is the term that makes `sigLines` a union, and a fixture without it would leave that channel
  // unexercised while the equality above still passed.
  return {
    ...base,
    // `latRise` is the one formatter-rendered row field the GRAPH cannot set: it comes from the case's own
    // edge latencies, as `postMeanMs / preMeanMs`. A zero denominator makes that rise `Infinity`, which is
    // exactly the non-finite value `fmt` renders as the tripwire — a real division, not a typed-in NaN.
    // A zero denominator makes the rise `Infinity` — a real division rather than a typed-in NaN. The healthy
    // case carries a finite one, so `latRise` is a NUMBER there and the control below has something to be
    // true about.
    edgeLatency: [
      {
        caller: 'caller-a',
        callee: String(service),
        preMeanMs: nonFinite ? 0 : 10,
        postMeanMs: nonFinite ? 5 : 25,
      },
    ],
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

function graphOf(
  callGraph: ServiceCallGraph,
  kept = 1,
  dropped = 1,
  onsetBase = 100,
  onsetStep = 50,
  nonFinite = false,
): FaultPropagationGraph {
  const ids = [...callGraph.nodes.keys()];
  // Every number a formatter renders, in one object, so the non-finite case cannot miss one by being
  // assembled a second time somewhere else. `riseRatio` is an Infinity from a real division and
  // `baselineMean` a NaN, so both of the RATIO formatters are exercised by arithmetic rather than by a
  // literal — a fixture that typed `'nonfinite'` would be measuring this file instead of the producer.
  const breakdown = nonFinite
    ? {
        deviation: Number.NaN,
        trend: Number.NaN,
        cv: Number.NaN,
        burst: Number.NaN,
        riseRatio: 5 / 0,
        dropRatio: 5 / 0,
        baselineMean: Number.NaN,
      }
    : {
        deviation: 0.4,
        trend: 0.1,
        cv: 0.6,
        burst: 0,
        riseRatio: 12,
        dropRatio: 0,
        baselineMean: 0.02,
      };
  // The counts are parameters because the two count channels' zero case is the one that has to be
  // reproducible: `metricKept(0):` is rendered with NO BODY, so a value read from the body beside the count
  // is absent on exactly the row that states the most definite measurement there is.
  // `formatDecisiveComposition` picks `metricOutcomes.find(o => o.outcome === 'kept' && o.label ===
  // service.dominantMetric)`, so a diagnostic LABELLED with the dominant metric is the only thing that makes
  // `metricDecisive:` carry a body at all — the existing fixtures have none, which is why the channel reads
  // `every` / `none` in all of them. Emitted only when the block is meant to be non-finite, so the healthy
  // block's `metricKept` counts and `metricTop` body are untouched.
  const dominantLabel = 'cpu_usage_percent';
  const diagnostics = [
    ...(nonFinite
      ? [{ label: dominantLabel, outcome: 'kept' as const, score: 0.75, breakdown }]
      : []),
    ...Array.from({ length: kept }, (_, index) => ({
      label: `kept_${index}`,
      outcome: 'kept' as const,
      // FINITE even when everything around it is not: the builder picks the decisive metric with a comparison,
      // and a NaN score makes that selection fail, so the channel would never see the token. The tripwire
      // reaches it through the BREAKDOWN instead (`dev=`, `rise=`, `base=`), which is where the ratio
      // formatters live.
      score: 0.75,
      breakdown,
    })),
    ...Array.from({ length: dropped }, (_, index) => ({
      label: `dropped_${index}`,
      outcome: 'transient-return' as const,
      score: 0,
      breakdown,
    })),
  ];
  return {
    callGraph,
    propagationWeights: new Float64Array(callGraph.edges.length),
    anomalyScores: new Map(ids.map((id, index) => [id, nonFinite ? Number.NaN : 1 - index * 0.1])),
    anomalyOnsetTimes: new Map(ids.map((id) => [id, 0])),
    detectedCycles: [],
    totalCycleContribution: 0,
    pruneThreshold: 0.001,
    dominantMetrics: new Map(
      ids.map((id) => [
        id,
        { label: dominantLabel, head: [0.1], tail: [0.9], transientSkipped: [] },
      ]),
    ),
    logScores: new Map(ids.map((id, index) => [id, nonFinite ? Number.NaN : 0.5 - index * 0.1])),
    // The failed-edge SCORE is the fourth `fmt` render, and it comes from the graph rather than from the
    // case: `graph.failedEdgeScores?.get(serviceId) ?? 0`.
    ...(nonFinite ? { failedEdgeScores: new Map(ids.map((id) => [id, Number.NaN])) } : {}),
    metricDiagnostics: new Map(ids.map((id) => [id, diagnostics])),
    // The onset delays are parameters because `onset=0` is the token whose VALUATION is under test: the
    // producer prints a zero delay as `0` (`fmtOnset` rounds and keeps it), so a graph with all-zero delays
    // is a block where the same token that means NO ANCHOR on the header means a MEASUREMENT on the row.
    postInjectOnsetDelays: new Map(ids.map((id, index) => [id, onsetBase + index * onsetStep])),
  };
}

/** The block the producer writes for one case rendered with EVERY feature, so no channel can pass by absence. */
function fullBlock(): string {
  return blockWith(1, 1);
}

/**
 * The same block with the inventory's two counts set explicitly.
 *
 * Built rather than hand-written because the census's population is the ARTIFACT's: a block typed into this
 * file could carry a line the producer does not write, and the edge below would then be measuring this file.
 */
function blockWith(
  kept: number,
  dropped: number,
  options: {
    readonly injectTimeMs?: number;
    readonly onsetBase?: number;
    readonly onsetStep?: number;
    readonly nonFinite?: boolean;
  } = {},
): string {
  const nonFinite = options.nonFinite ?? false;
  const benchCase = caseOf(nonFinite);
  const graph = graphOf(
    benchCase.callGraph,
    kept,
    dropped,
    options.onsetBase ?? 100,
    options.onsetStep ?? 50,
    nonFinite,
  );
  return buildFSE26Diagnostic({
    case: benchCase,
    graph,
    ranking: [...benchCase.callGraph.nodes.keys()].map((serviceId) => ({ serviceId })),
    callGraph: benchCase.callGraph,
    datapack: 'dp-census',
    faultType: 'HTTPResponseReplaceCode',
    groundTruthServices: [benchCase.groundTruth.serviceId],
    logSignalMode: 'logicHttp',
    // Stated rather than inherited, because `0` is the engine's spelling of NO ANCHOR and the block that
    // carries it has to be producible: `.github/workflows/benchmark-rcaeval.yml` runs `--no-inject-time` for
    // all three suites, so the artifact below is one a real run makes.
    injectTimeMs: options.injectTimeMs ?? benchCase.injectTime,
    fieldDecimals: SERVICE_FIELD_DECIMALS,
  });
}

/** The `DIAG` header line of a block — where the case-scoped channels live. */
function headerOf(block: string): string {
  const line = block.split('\n').find((one) => one.startsWith('DIAG '));
  if (line === undefined) throw new Error('the producer wrote no DIAG header');
  return line;
}

/**
 * The census's own verdict on ONE line, for one channel — rendered, and valued or not.
 *
 * The pattern, the placement and the absent set are all the projection's values, so this function adds
 * nothing but the line. That matters for the edge below: the claim is that the census's VALUATION agrees with
 * what the producer meant by the token, and a version of this that classified by the token's shape would be
 * asserting itself.
 */
/**
 * The line a channel's marker is on, taken from the block rather than typed: the first line the census's own
 * pattern matches.
 */
function headerOrRow(block: string, channel: string): string {
  const declaration = declarations().find((one) => one.channel === channel);
  if (declaration === undefined) throw new Error(`no declaration for ${channel}`);
  const line = block.split('\n').find((one) => new RegExp(declaration.pattern).test(one));
  if (line === undefined) throw new Error(`the block renders no ${channel}`);
  return line;
}

function censusOnLine(
  line: string,
  channel: string,
): { readonly reached: boolean; readonly valued: boolean } {
  const declaration = declarations().find((one) => one.channel === channel);
  if (declaration === undefined) throw new Error(`no declaration for ${channel}`);
  const found = new RegExp(declaration.pattern).exec(line);
  if (found === null) return { reached: false, valued: false };
  return { reached: true, valued: !declaration.absent.includes(found[1] ?? '') };
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
    // Two lines the producer renders and no parsed field holds. They are channels — the census reports what
    // the artifact CARRIES — and the projection's empty `fields` array is how they are excluded from the field
    // equality by decision rather than by omission.
    //
    // `metric-list` was the third until iteration 41 BUILT the reader the declaration named: its own `why`
    // said the channel was "rendered on every row and parsed by no reader ... so a truncation check built on
    // it would be the first thing to read it", the check exists now, and the channel carries `metricNames`.
    // This assertion is what made the departure a reviewed decision rather than a line that disappeared.
    const noField = declarations()
      .filter((one) => one.fields.length === 0)
      .map((one) => one.channel)
      .sort();
    expect(noField).toEqual(['error-messages', 'exceptions']);
  });

  /**
   * The channels the reader's own parse CANNOT be compared against, each with why.
   *
   * An exclusion by decision rather than by silence, for the same reason the projection carries a `fields`
   * column: the population of an equality has to be stated, and a channel that can drop out of it unnamed is
   * how a one-sided test starts passing.
   */
  const NOT_FIELD_PRESENCE: Readonly<Record<string, string>> = {
    'service-id': "the reader spells an absent id '' rather than leaving the field out",
    'row-labels':
      'two fields, and the label tag is their DISJUNCTION — the marker is not either of them',
    'dominant-metric':
      "the block's `dominant=-` becomes '', so the field is present while its value is not",
    'metric-top':
      'the value is the DECOMPOSITION, a nested condition on the parsed outcomes rather than the field',
    // Added with the field itself, and the divergence is REAL rather than a gap in either side: this channel's
    // `absent` set makes an EMPTY body unvalued, because the census is asking which names a row CARRIES and
    // `metrics(0): ` carries none — while the reader is asking what the service's inventory IS, and answers
    // `[]`, a measured zero. Both are right about the same line and they are not the same claim, which is
    // exactly the state this map exists to name instead of letting an equality report it as a defect.
    'metric-list':
      'the census reads the BODY (names carried), the reader reads the inventory (`[]` is a measured zero)',
  };

  it('reads every field-carrying channel the way the READER reads it, on the same artifact', () => {
    // THE EDGE THAT WAS MISSING. The two edges above hold the table against the keys the PRODUCER emits and
    // against the READER's typed field map, and both were satisfied while two channels read their value from
    // the wrong half of the line: the table was self-consistent (the census's own eight tests passed on it)
    // and the reader was correct, so nothing compared them. This does, PER ROW, on a block the PRODUCER wrote.
    //
    // Its sharpest subject is a block whose inventory is EMPTY, because that is where a count line's two
    // halves come apart: `metricKept(0):` is rendered with no body, and the count beside the empty body is
    // the measurement. Read from the body, a block that kept nothing came back as "rendered and undetermined".
    for (const block of [fullBlock(), blockWith(0, 0), blockWith(4, 0), blockWith(0, 3)]) {
      const rows = parseDiagnosticDump(block).flatMap((kase) => kase.services);
      expect(rows.length).toBeGreaterThan(0);

      const declared = declarations().filter(
        (one) =>
          one.fields.length > 0 &&
          (one.scope === ROW || one.scope === ROW_IDENTITY || one.scope === SUB_LINE),
      );
      // Non-vacuity in both directions: the population is stated, and so is what is NOT in it.
      //
      // Both counts moved by one when `metric-list` gained its field, and the SECOND did not move with the
      // first: the channel entered the population of 19 -> 20 and left it again into `NOT_FIELD_PRESENCE`, so
      // `comparable` is still 15. A pair of literals that both changed by one would have been the easier edit
      // and the wrong one — the line between the two sets is what the numbers are about.
      expect(declared).toHaveLength(20);
      expect(declared.filter((one) => one.channel in NOT_FIELD_PRESENCE)).toHaveLength(5);
      expect(
        declared
          .filter((one) => one.channel in NOT_FIELD_PRESENCE)
          .map((one) => one.channel)
          .sort(),
      ).toEqual(Object.keys(NOT_FIELD_PRESENCE).sort());

      const comparable = declared.filter((one) => !(one.channel in NOT_FIELD_PRESENCE));
      expect(comparable).toHaveLength(15);
      for (const declaration of comparable) {
        const field = declaration.fields[0]!;
        const census = censusPerRow(block, declaration);
        expect(census.reached).toHaveLength(rows.length);
        for (let index = 0; index < rows.length; index++) {
          // Asked BY NAME, so a field the table misspells reads as absent everywhere and fails here.
          const present = (rows[index] as unknown as Record<string, unknown>)[field] !== undefined;
          // The valued count IS the reader's own field: a value iff the reader has one. The reached count is
          // the weaker claim (a rendered `-` reaches the row and carries nothing), so it is asserted only
          // where a value exists — the two are different numbers and folding them is the defect above.
          expect({
            block: `${block.length}b`,
            channel: declaration.channel,
            index,
            valued: census.valued[index],
          }).toEqual({
            block: `${block.length}b`,
            channel: declaration.channel,
            index,
            valued: present,
          });
          if (present) expect(census.reached[index]).toBe(true);
        }
      }
    }
  });

  it('reaches the row whose count is ZERO, which is the whole reason the placement is stated', () => {
    // The fixture's own non-vacuity, and the defect written as a reading: a block that kept nothing renders
    // `metricKept(0):` with nothing after the colon, and the census must report that row as VALUED. Before the
    // placement was stated it reported `some` reach against a SHORTER value count — the two channels were the
    // only pair in the table where a rendered zero was indistinguishable from a gap.
    const block = blockWith(0, 0);
    expect(block).toContain('    metricKept(0):');
    expect(block).toContain('    metricDrop(0):');
    for (const channel of ['metric-kept', 'metric-drop']) {
      const declaration = declarations().find((one) => one.channel === channel)!;
      expect(declaration.valueIn).toBe('paren');
      // The pattern is the census's own, and it captures the ZERO rather than the empty body beside it — built
      // from the declaration's OWN key literal, because a probe typed for one channel does not exercise the
      // other and would pass on a table that had lost one of them.
      const zero = `    ${declaration.key!}(0):`;
      expect(new RegExp(declaration.pattern).exec(zero)?.[1]).toBe('0');
      const census = censusPerRow(block, declaration);
      expect(census.reached.every(Boolean)).toBe(true);
      expect(census.valued.every(Boolean)).toBe(true);
    }
    // The sibling that is genuinely BODY-placed is not dragged along: `metricTop`'s value IS the
    // decomposition, so a fixture without one cannot make it `every`.
    const top = declarations().find((one) => one.channel === 'metric-top')!;
    expect(top.valueIn).toBe('body');
  });

  it("names, in a screen's ADVICE, the producer field the census reads that channel from", () => {
    // A screen that cannot act now tells the reader which field to find in a dump that CAN — `inject=`,
    // `onset=` and `metricDecisive`, in the producer's own spelling. That is a claim about the producer's
    // grammar, so it is held against the census's key column rather than trusted, and the key column is
    // itself held against the producer by the test above (the producer BUILDS the block every declared key
    // has to appear in). The chain is therefore: advice → census key → emitted literal.
    //
    // Why it needs a fence at all: a renamed field would leave the advice pointing at a line nobody
    // writes, which is the defect class Finding 8 records one level down — a declaration standing in for
    // the thing it names.
    const byChannel = new Map(declarations().map((one) => [one.channel, one]));
    expect(byChannel.get('inject-time')?.key).toBe('inject');
    expect(byChannel.get('onset')?.key).toBe('onset');
    expect(byChannel.get('decisive-composition')?.key).toBe('metricDecisive');
    // And the sentences must actually NAME them, in the producer's spelling, because the reader has to
    // type them — and the SEPARATOR is part of that spelling: a header field is `key=value`, a row is
    // `key=value`, and a sub-line is `key(N): body`, whose marker carries no `=` at all. Deriving it from
    // the channel's own scope is what stops `metricDecisive=` from being asserted as if it were a field.
    const source = readFileSync(
      path.join(REPO_ROOT, 'benchmarks', 'src', 'fse26-diagnose-analyze.ts'),
      'utf-8',
    );
    for (const channel of ['inject-time', 'onset', 'decisive-composition']) {
      const one = byChannel.get(channel)!;
      const literal = one.scope === SUB_LINE ? `\`${one.key}\`` : `\`${one.key}=\``;
      expect(source, `${channel} -> ${literal}`).toContain(literal);
    }
  });
});

describe("the census's VALUATION — a rendered zero is a value only where its producer says so", () => {
  // **The rule "a rendered zero is a value" is true, and it was generalised from ONE field to all 31.** The
  // sentence that justified the constant was the producer's own doc for `bothExceptionCount`: "`both=0` is
  // NEVER omitted because it is zero — `both=0` is a measurement (the sets are disjoint)". Applied to
  // `inject-time` it is wrong, and wrong in the direction that MANUFACTURES coverage: `injectTimeMs: 0` is the
  // engine's spelling of "unknown" (`packages/tree/src/causal/topology-fault-graph.ts`: "injectTimeMs: 0, //
  // unknown — temporal anchor disabled by default"; `dist/index.d.ts`: "0 = unknown -> no time filter", ×3),
  // and `.github/workflows/benchmark-rcaeval.yml` runs `run-rcaeval.ts --no-inject-time` for all three
  // suites. The census called those artifacts `every/every` — a certificate for an artifact that cannot serve
  // the read at all — and the refusal, which judged the RENDERING reach, certified it too.
  //
  // This block is the edge the column needs, and it is asked of the PRODUCER's own bytes rather than of a line
  // typed here: every token below came out of `buildFSE26Diagnostic`.

  it("calls the engine's spelling of NO ANCHOR undetermined, and a real anchor a value", () => {
    const noAnchor = headerOf(blockWith(1, 1, { injectTimeMs: 0 }));
    const anchored = headerOf(blockWith(1, 1, { injectTimeMs: 1_685_202_688_000 }));

    // The producer really wrote both tokens, so this is a measurement of the artifact and not of the fixture.
    expect(noAnchor).toContain('inject=0');
    expect(anchored).toContain('inject=1685202688000');

    // …and the census's own valuation of them differs, from the projection's `absent` set: `0` is on the
    // channel's list and a real timestamp is not.
    expect(censusOnLine(noAnchor, 'inject-time')).toEqual({ reached: true, valued: false });
    expect(censusOnLine(anchored, 'inject-time')).toEqual({ reached: true, valued: true });
  });

  it('keeps a ZERO a value on the channel whose producer means a measurement, on the SAME artifact', () => {
    // The other direction, and the reason the column has to belong to the channel rather than to the token:
    // `fmtOnset` prints a zero delay as `0`, and `onset=0` occurs ONLY beside a positive anchor in the local
    // artifacts (1021 / 570 / 679 rows of re1 / re2 / re3, never on a row whose anchor is zero), so there a
    // zero is a measurement. A rule keyed on the TOKEN would have closed a real reading.
    const zeroOnsets = blockWith(1, 1, {
      injectTimeMs: 1_685_202_688_000,
      onsetBase: 0,
      onsetStep: 0,
    });
    const row = zeroOnsets.split('\n').find((one) => one.includes('onset='));
    expect(row).toBeDefined();
    expect(row).toContain('onset=0');

    expect(censusOnLine(row!, 'onset')).toEqual({ reached: true, valued: true });
    // …while the SAME block's header holds the anchor, so the two channels' valuations differ inside one
    // artifact rather than across two.
    expect(censusOnLine(headerOf(zeroOnsets), 'inject-time').valued).toBe(true);
  });

  it("agrees with the SCREEN's own private count, which is the second reading of the same fact", () => {
    // The screen counts anchors itself (`(kase.injectTimeMs ?? 0) > 0`) because it reads the PARSED NUMBER
    // while the census reads the RENDERED TOKEN — different inputs, so the two cannot be the same code. What
    // this edge can do is hold them EQUAL on the producer's bytes, which is the only place a disagreement
    // shows: the screen's count and the census's valuation must move together, or one of them is wrong about
    // an artifact that is right there.
    const none = parseDiagnosticDump(blockWith(1, 1, { injectTimeMs: 0 }));
    const real = parseDiagnosticDump(blockWith(1, 1, { injectTimeMs: 1_685_202_688_000 }));
    expect(none.length).toBeGreaterThan(0);
    expect(onsetAvailability(none).withAnchor).toBe(0);
    expect(onsetAvailability(real).withAnchor).toBe(real.length);
    // …and the census agrees on those same two artifacts, in the same direction.
    expect(censusOnLine(headerOf(blockWith(1, 1, { injectTimeMs: 0 })), 'inject-time').valued).toBe(
      false,
    );
    expect(
      censusOnLine(headerOf(blockWith(1, 1, { injectTimeMs: 1_685_202_688_000 })), 'inject-time')
        .valued,
    ).toBe(true);
  });

  it('states the sentinel on the channel that has one and on no other, in the projection', () => {
    // Both directions on the table itself, because a projection that listed `0` everywhere would satisfy
    // both tests above and would have closed `onset`, `both` and every count channel with it.
    const withZero = declarations().filter((one) => one.absent.includes('0'));
    expect(withZero.map((one) => one.channel)).toEqual(['inject-time']);
    for (const declaration of declarations()) {
      // The two shared markers are on every channel; only the third one is per channel.
      expect(declaration.absent, declaration.channel).toEqual(expect.arrayContaining(['', '-']));
    }
  });
});

describe("the block's SECOND undetermined token, on both sides of the fence", () => {
  // **The producer writes two tokens for "rendered and undetermined", and the census named one.**
  // `fmt`/`fmtRatio`/`fmtBase` return the literal `nonfinite` for a non-finite value, which the producer
  // documents as a TRIPWIRE — *"louder than a silently skipped row"* — and its own suite asserts the render
  // (`'guards against non-finite self-anomaly values'`). The census counted it as a MEASUREMENT on every
  // channel a formatter renders into, and the reader parsed it to `Number('nonfinite')` = `NaN`: a `number`,
  // so every "is it measured?" test downstream answered YES and `Math.log1p` carried the NaN into a score.
  //
  // Nothing below types the token or a NaN into a line: the block comes out of `buildFSE26Diagnostic`, and
  // the two non-finite values are a real `5 / 0` and a real `Number.NaN` fed through the graph.

  /** The `nonfinite` block, and the census's own reading of it. */
  const flagged = blockWith(1, 1, { nonFinite: true });
  const healthy = blockWith(1, 1);

  /** Every channel that SEES the token, by applying the census's own pattern to the producer's own bytes. */
  function channelsSeeingTheToken(block: string): readonly string[] {
    const seen: string[] = [];
    for (const declaration of declarations()) {
      if (declaration.scope === 'row-identity') continue;
      for (const line of block.split('\n')) {
        const found = new RegExp(declaration.pattern).exec(line);
        if (found !== null && (found[1] ?? '').includes('nonfinite')) {
          if (!seen.includes(declaration.channel)) seen.push(declaration.channel);
          break;
        }
      }
    }
    return seen.sort();
  }

  function declaringTheToken(): readonly string[] {
    return declarations()
      .filter((one) => one.absent.includes('nonfinite'))
      .map((one) => one.channel)
      .sort();
  }

  it('declares the token on EXACTLY the channels whose value a formatter renders into', () => {
    // The derived property, both directions: a channel that can see the token and does not declare it is the
    // defect this iteration fixes, and a channel that declares it without being able to see it would have
    // taken the token away from a channel where it means something.
    const seen = channelsSeeingTheToken(flagged);
    // Non-vacuity first: a block where nothing became non-finite would satisfy an equality of two empty sets.
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(seen).toContain('self-anomaly');
    expect(seen).toContain('latency-rise');
    // Reported as two NAMED lists rather than an equality of arrays: the answer to a failure is which channel
    // is on the wrong side, and `expected [...] to deeply equal [...]` truncates the very thing being asked.
    const declared = declaringTheToken();
    expect({
      declaresButNeverSees: declared.filter((channel) => !seen.includes(channel)),
      seesButDoesNotDeclare: seen.filter((channel) => !declared.includes(channel)),
    }).toEqual({ declaresButNeverSees: [], seesButDoesNotDeclare: [] });
    // …and the HEALTHY block sees it nowhere, so the token is a property of the values rather than of the
    // fixture's shape.
    expect(channelsSeeingTheToken(healthy)).toEqual([]);
  });

  it('keeps the token OFF the channels whose value is a count or a `fmtOnset` render', () => {
    // The other direction, named: these channels are rendered in the same block and must not be dragged in. A
    // rule keyed on the TOKEN rather than on the channel would have taken all of them.
    const declared = declaringTheToken();
    for (const channel of [
      'metric-kept',
      'metric-drop',
      'failed-edge-records',
      'latency-edges',
      'onset',
    ]) {
      expect(declared, channel).not.toContain(channel);
      expect(channelsSeeingTheToken(flagged), channel).not.toContain(channel);
    }
  });

  it("names the token in the READER's one copy of the rule, and the census agrees", () => {
    // The reader used to answer this question in eight private opinions — `-` spelled inline in two parses and
    // six with no guard — so the two sides could disagree without either being wrong on its own terms. The set
    // is now exported, and this holds it to the census's declared union.
    expect(UNDETERMINED_TOKENS).toEqual(['', '-', 'nonfinite']);
    const declared = new Set(declaringTheToken());
    // Every channel the reader parses carries either no token, or one of the reader's own.
    const readerChannels = [
      'self-anomaly',
      'log-score',
      'failed-edge',
      'latency-rise',
      'failed-edge-records',
      'latency-edges',
      'signature-overlap',
      'onset',
    ];
    for (const channel of readerChannels) {
      const entry = declarations().find((one) => one.channel === channel)!;
      for (const token of entry.absent) {
        // `inject-time`'s `0` is the one token the reader handles NUMERICALLY (`(injectTimeMs ?? 0) > 0`),
        // which is the reading the screen tie-in above pins; every other token must be in this set.
        if (token === '0') continue;
        expect(UNDETERMINED_TOKENS, `${channel} declares ${JSON.stringify(token)}`).toContain(
          token,
        );
      }
    }
    // …and the reader's set does not invent a token no channel declares, which would make it a second
    // spelling rather than a copy.
    const union = new Set(declarations().flatMap((one) => [...one.absent]));
    for (const token of UNDETERMINED_TOKENS) expect(union as Set<string>, token).toContain(token);
    expect(declared.size).toBeGreaterThan(0);
  });

  it('parses the flagged block to `undefined` on every field the type can hold it on', () => {
    // The consequence, on the producer's own bytes: the reader no longer invents a number for a value the
    // producer flagged as broken. `failedEdgeScore` and `latRise` are the two the block actually flags.
    const [parsed] = parseDiagnosticDump(flagged);
    expect(parsed).toBeDefined();
    const service = parsed!.services.find((one) => one.latRise !== undefined || true)!;
    expect(Number.isFinite(service.failedEdgeScore ?? Number.NaN)).toBe(false);
    expect(service.failedEdgeScore).toBeUndefined();
    expect(service.latRise).toBeUndefined();
    // …and the two fields whose TYPE used to be a required number carry the same `undefined` now. Iteration 28
    // asserted the opposite here — `Number.isNaN(...)` — because the NaN was the type's own admission rather
    // than a defect the reader could fix alone. The type is widened, so the assertion is inverted rather than
    // deleted: a record of what the defect looked like is what made the fix legible.
    expect(service.selfAnomaly).toBeUndefined();
    expect(service.logScore).toBeUndefined();
  });

  it('reports the same block as carrying NO measurement, which is where the defect is legible', () => {
    // The reader's NaN is unavoidable while the type says `number`; the census has no such constraint, and it
    // is the instrument whose job is to answer what the artifact carries. So the two sides of one fact are
    // asserted together: the artifact says `none`, and the reader's number is the type's own admission.
    for (const channel of ['self-anomaly', 'log-score', 'failed-edge', 'latency-rise']) {
      expect(censusOnLine(headerOrRow(flagged, channel), channel).valued, channel).toBe(false);
    }
    // The control: the healthy block carries all four.
    for (const channel of ['self-anomaly', 'log-score', 'failed-edge', 'latency-rise']) {
      expect(censusOnLine(headerOrRow(healthy, channel), channel).valued, channel).toBe(true);
    }
  });
});

describe("the reader's TYPES — the half the value fence could not reach", () => {
  // Iteration 28 gave the reader ONE owner for "is this token a measurement?" and then threw the answer away
  // for the two fields whose TYPE was a required `number`: `measured()` returned `undefined` and the parse
  // wrote `Number.NaN` back. `NaN` IS a `number`, so the write type-checked, every downstream "is it
  // measured?" test answered YES, and the two comparisons a ranking is made of fail in BOTH directions
  // (`NaN >= t` and `NaN <= t` are each false) while `NaN !== NaN` keeps the id tiebreak from ever being
  // reached. The type was the lie — and nothing connected it to the census, which had ALREADY declared these
  // two channels able to carry a token meaning "undetermined".
  //
  // This fence is derived on both sides. The fields are the CENSUS's own (`ChannelDeclaration.fields`), and
  // the type is asked of the reader's own interface through `SERVICE_FIELD_KIND`, whose honesty is checked by
  // the compiler in the module that declares the interface. A new channel that declares the token, or a field
  // re-typed, moves one side and fails here.

  /** The channels whose declared `absent` set carries the producer's tripwire render. */
  function tripwireChannels(): readonly string[] {
    return declarations()
      .filter((one) => one.absent.includes('nonfinite'))
      .map((one) => one.channel)
      .sort();
  }

  /** The reader fields those channels render into — the census's own field map, not a list held here. */
  function tripwireFields(): readonly string[] {
    const fields = new Set<string>();
    for (const channel of tripwireChannels()) {
      const entry = declarations().find((one) => one.channel === channel);
      if (entry === undefined) throw new Error(`no declaration for ${channel}`);
      for (const field of entry.fields) fields.add(field);
    }
    return [...fields].sort();
  }

  it('classifies exactly the fields the census says can carry an undetermined token as able to hold one', () => {
    const fromCensus = tripwireFields();
    // Non-vacuity first: an equality between two empty sets is satisfied by a census that declares nothing.
    expect(fromCensus.length).toBeGreaterThanOrEqual(6);
    expect(fromCensus).toEqual([
      'decisiveOutcome',
      'failedEdgeScore',
      'latRise',
      'logScore',
      'metricOutcomes',
      'selfAnomaly',
    ]);
    const fromReader = (Object.keys(SERVICE_FIELD_KIND) as (keyof DiagnosedService)[])
      .filter((key) => SERVICE_FIELD_KIND[key] === 'undetermined-capable')
      .sort();
    // Reported as two NAMED lists, because the answer to a failure is which field is on the wrong side and a
    // deep-equality message truncates the very thing being asked.
    expect({
      censusNamesItButTheReaderCallsItAMeasurement: fromCensus.filter(
        (field) => !fromReader.includes(field as keyof DiagnosedService),
      ),
      theReaderCallsItUndeterminedButNoChannelRendersTheToken: fromReader.filter(
        (field) => !fromCensus.includes(field),
      ),
    }).toEqual({
      censusNamesItButTheReaderCallsItAMeasurement: [],
      theReaderCallsItUndeterminedButNoChannelRendersTheToken: [],
    });
  });

  it('parses the flagged block to `undefined` on `selfAnomaly` and `logScore` too', () => {
    // The consequence, on the producer's own bytes: the two fields whose type used to force a NaN.
    const [parsed] = parseDiagnosticDump(blockWith(1, 1, { nonFinite: true }));
    expect(parsed).toBeDefined();
    expect(parsed!.services.length).toBeGreaterThan(0);
    for (const service of parsed!.services) {
      expect(service.selfAnomaly, service.serviceId).toBeUndefined();
      expect(service.logScore, service.serviceId).toBeUndefined();
    }
    // The control, so the assertion above is about the VALUES rather than about the fixture being empty.
    const [healthyCase] = parseDiagnosticDump(blockWith(1, 1));
    expect(healthyCase).toBeDefined();
    for (const service of healthyCase!.services) {
      expect(Number.isFinite(service.selfAnomaly), service.serviceId).toBe(true);
      expect(Number.isFinite(service.logScore), service.serviceId).toBe(true);
    }
  });

  it('answers every declared feature with a number or with `undefined`, never with a NaN', () => {
    // `NaN` is the answer that reads as a measurement and behaves as neither: it satisfies no threshold in
    // either direction, so a rule "fitted" to it fires on nothing while looking like a rule.
    const [parsed] = parseDiagnosticDump(blockWith(1, 1, { nonFinite: true }));
    expect(parsed).toBeDefined();
    for (const feature of DISCRIMINATOR_FEATURES) {
      const value = feature.of(parsed!);
      const legal = value === undefined || Number.isFinite(value);
      expect({ feature: feature.name, value: String(value), legal }).toEqual({
        feature: feature.name,
        value: String(value),
        legal: true,
      });
    }
  });

  it('makes every declared feature a function of the SET rather than of the row order', () => {
    // The other half of the same defect. `[...services].sort((a, b) => b.selfAnomaly - a.selfAnomaly)` returns
    // `NaN` for a `NaN` operand, which is falsy, i.e. "equal" — so a stable sort leaves the entries where the
    // INPUT put them and the feature becomes a function of the dump's row order.
    const [parsed] = parseDiagnosticDump(blockWith(1, 1, { nonFinite: true }));
    expect(parsed).toBeDefined();
    expect(parsed!.services.length).toBeGreaterThanOrEqual(2);
    const reversed = { ...parsed!, services: [...parsed!.services].reverse() };
    const moved: Record<string, readonly [string, string]> = {};
    for (const feature of DISCRIMINATOR_FEATURES) {
      const forwardValue = String(feature.of(parsed!));
      const reversedValue = String(feature.of(reversed));
      if (forwardValue !== reversedValue) moved[feature.name] = [forwardValue, reversedValue];
    }
    expect(moved).toEqual({});
  });
});
