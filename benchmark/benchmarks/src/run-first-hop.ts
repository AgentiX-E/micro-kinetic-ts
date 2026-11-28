/**
 * Price the first-hop rule over an arm's answers and the corpus walk's failing edges.
 *
 * ## Why this is a join and not a dispatch
 *
 * The boundary the rule reads is published in the corpus: `failedTraceEdges` carries every failing edge with its pre
 * injection baseline, the walk already wrote it per case, and the answers were paid for by the arm that produced the
 * artifact. The price is therefore ¥0 and the reading can be repeated by anyone holding the same two files.
 *
 * ## What it prints, in order
 *
 * 1. The artifact's own surface, to two decimals, with its digest.
 * 2. The population the rule speaks over, and how many of its cases the rule would repair or break at each bar.
 * 3. The held-out reading, with the four clauses that can refuse it.
 * 4. The scope check: firings outside the boundary premise, which must be zero.
 *
 * @module benchmarks/run-first-hop
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  BETA_GRID,
  MIN_FIRST_HOP_GAIN,
  MIN_FIRST_HOP_PRECISION,
  crossValidateFirstHop,
  formatFirstHopReport,
  formatSurfaceReplay,
  premiseHolds,
  replaySurface,
  type HopCase,
} from './first-hop.js';

/** The flags this runner accepts. */
interface Args {
  readonly artifact: string;
  readonly edges: string;
}

/** One answer, as the arm published it. */
interface AnswerLine {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  readonly answer: string | null;
  readonly entry: string | null;
  readonly entryChildErrors: number | null;
  readonly belowFails: boolean | null;
}

/** One case's failing edges, as the walk wrote them. */
interface EdgeLine {
  readonly id: string;
  readonly entry: string | null;
  readonly failedEdges: readonly {
    readonly caller: string;
    readonly callee: string;
    readonly failed: number;
    readonly baseline: number;
  }[];
}

/** Read the flags, refusing an unknown one rather than ignoring it. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const artifact = map.get('artifact') ?? '';
  const edges = map.get('edges') ?? '';
  if (artifact === '' || edges === '') throw new Error('--artifact and --edges are both required');
  return { artifact, edges };
}

/** Read an ndjson file into rows, skipping blank lines. */
function readNdjson<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

/** Print one aligned table. */
function table(headers: readonly string[], rows: readonly (readonly string[])[]): void {
  const widths = headers.map((head, column) =>
    Math.max(head.length, ...rows.map((cells) => (cells[column] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]!))
      .join('  ')
      .trimEnd();
  console.log(line(headers));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const cells of rows) console.log(line(cells));
}

/**
 * Failures above baseline on the edge into the entry.
 *
 * The corpus records the load generator's edge as the entry's only inbound edge and writes it in every case's
 * `traceEdges`, so a case with no failing inbound edge records a measured zero rather than an absence.
 *
 * @param line - The case's failing edges.
 * @returns The count, which is `0` when the edge did not fail.
 */
function inboundFailures(line: EdgeLine): number {
  let total = 0;
  for (const one of line.failedEdges) {
    if (one.callee !== line.entry) continue;
    const rise = one.failed - one.baseline;
    if (rise > 0) total += rise;
  }
  return total;
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const edges = new Map<string, EdgeLine>(
    readNdjson<EdgeLine>(args.edges).map((one) => [one.id, one]),
  );
  const lines = readNdjson<AnswerLine>(args.artifact);
  const cases: HopCase[] = lines.map((one) => {
    const line = edges.get(one.datapack);
    return {
      datapack: one.datapack,
      faultType: one.faultType,
      truth: one.truth,
      answer: one.answer,
      entry: one.entry,
      entryChildErrors: one.entryChildErrors,
      belowFails: one.belowFails,
      inboundFails: line === undefined ? null : inboundFailures(line),
    };
  });
  const digest = createHash('sha256')
    .update(readFileSync(args.artifact))
    .digest('hex')
    .slice(0, 16);
  const right = cases.filter((one) => one.answer !== null && one.truth.includes(one.answer)).length;
  console.log(`read ${cases.length} answers and ${edges.size} failing-edge records`);
  console.log(
    `\nartifact ${args.artifact}: sha256 ${digest}\n` +
      `the artifact's own answers: ${right} (${((100 * right) / cases.length).toFixed(2)} %)`,
  );

  const population = cases.filter((one) => premiseHolds(one));
  const withEdge = population.filter((one) => (one.inboundFails ?? 0) > 0);
  const repairable = population.filter((one) => one.truth.includes(one.entry!));
  console.log(
    `\nthe boundary premise holds on ${population.length} cases, ` +
      `${withEdge.length} of them with a failing inbound edge, ${repairable.length} with the door as the truth`,
  );
  // The table reads the same instrument the surface replay does. Counting "the paid answer was wrong" as a repair
  // reads a row the rule moved to a door that is not the truth as a gain, which is how a bar reads a delta it did not
  // earn; `replaySurface` compares both sides against the truth and puts that row in its own bucket.
  table(
    ['bar', 'fires', 'repairs', 'breaks', 'precision'],
    BETA_GRID.map((beta) => {
      const replay = replaySurface(cases, beta);
      const total = replay.repaired + replay.broken;
      return [
        String(beta),
        String(replay.decidedByTheDoor),
        String(replay.repaired),
        String(replay.broken),
        total === 0 ? '-' : (replay.repaired / total).toFixed(3),
      ];
    }),
  );

  const reading = crossValidateFirstHop(
    cases,
    BETA_GRID,
    MIN_FIRST_HOP_GAIN,
    MIN_FIRST_HOP_PRECISION,
  );
  console.log(`\n${formatFirstHopReport(reading)}`);
  console.log(
    `\n${formatSurfaceReplay(replaySurface(cases, reading.selected[0]), reading.selected[0])}`,
  );
  console.log(
    'a confirmation dispatch pays for 0 of these rows: every changed answer is the door, which the case names, and\n' +
      'every unchanged answer is the one already in the artifact.',
  );
}

main();
