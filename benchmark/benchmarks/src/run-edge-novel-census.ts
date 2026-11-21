/**
 * Read the interface witness over a corpus and price the three resolver modes on an artifact.
 *
 * The walk is the expensive part — one `FSE26Loader` load per case — so the witnesses are written to a file that a
 * later reading can take as input. A census whose every question costs a corpus walk is a census nobody re-runs,
 * and the questions this one answers ("does the rule still pay for itself after the next change?") are asked every
 * iteration.
 *
 * @module benchmarks/run-edge-novel-census
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { FSE26Loader } from '../../packages/kinetic/src/benchmarks/index.js';
import { discoverCaseDirs } from './case-discovery.js';
import { priceModes, type PriceableRow, type Witness } from './edge-novel-census.js';
import { buildTelemetry, readInterfacePrior } from './query-agent.js';

/** The flags this runner accepts. */
interface Args {
  readonly dataDir: string;
  readonly artifact: string;
  readonly witnessIn: string;
  readonly witnessOut: string;
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
  if (artifact === '') throw new Error('--artifact is required');
  const witnessIn = map.get('witness-in') ?? '';
  const dataDir = map.get('data-dir') ?? '';
  if (dataDir === '' && witnessIn === '') {
    throw new Error('--data-dir is required unless --witness-in supplies the witnesses');
  }
  return {
    dataDir,
    artifact,
    witnessIn,
    witnessOut: map.get('witness-out') ?? '',
  };
}

/** One artifact row, in the fields this reads. */
interface Row extends PriceableRow {
  readonly faultType: string;
  readonly correct: boolean;
  readonly rawAnswer: string | null;
}

/** Read an ndjson file into rows, skipping blank lines. */
function readNdjson<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

/**
 * Read every case's witness by walking the corpus.
 *
 * One case at a time and the trace dropped immediately, because 1 422 loaded cases do not fit in the default heap:
 * an earlier census of this corpus ran out of memory holding them, and the walk has been incremental since.
 *
 * @param dataDir - The corpus root.
 * @returns The witness per case and the number of cases the walk could not load.
 */
function walkCorpus(dataDir: string): { witnesses: Witness[]; skipped: number } {
  const loader = new FSE26Loader();
  const witnesses: Witness[] = [];
  let skipped = 0;
  for (const dir of discoverCaseDirs(dataDir)) {
    let raw;
    try {
      raw = loader.loadCase(dir);
    } catch {
      skipped += 1;
      continue;
    }
    const bench = loader.toBenchmarkCase(raw);
    if (bench.callGraph.edges.length === 0) {
      skipped += 1;
      continue;
    }
    const read = readInterfacePrior(buildTelemetry(bench));
    witnesses.push({
      datapack: dir.split('/').at(-1)!,
      novelCaller: read.novelCaller,
      novelRise: read.novelRise,
    });
  }
  return { witnesses, skipped };
}

/** The witness keyed for the pricing. */
function keyed(witnesses: readonly Witness[]): Map<string, Witness> {
  return new Map(witnesses.map((one) => [one.datapack, one]));
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

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const rows = readNdjson<Row>(args.artifact);
  let witnesses: readonly Witness[];
  if (args.witnessIn !== '') {
    witnesses = readNdjson<Witness>(args.witnessIn);
  } else {
    const walked = walkCorpus(args.dataDir);
    witnesses = walked.witnesses;
    console.log(`walked ${witnesses.length} cases, skipped ${walked.skipped}`);
  }
  if (args.witnessOut !== '') {
    writeFileSync(args.witnessOut, `${witnesses.map((one) => JSON.stringify(one)).join('\n')}\n`);
    console.log(`wrote ${args.witnessOut}`);
  }

  const byCase = keyed(witnesses);
  console.log(
    `\nartifact ${args.artifact}: ${rows.length} rows, ${rows.filter((row) => row.correct).length} correct`,
  );
  console.log(
    `witness present on ${witnesses.filter((one) => one.novelCaller !== null).length} cases`,
  );

  const presence = new Map<string, { cases: number; witnessed: number }>();
  for (const row of rows) {
    const bucket = presence.get(row.faultType) ?? { cases: 0, witnessed: 0 };
    bucket.cases += 1;
    if ((byCase.get(row.datapack)?.novelCaller ?? null) !== null) bucket.witnessed += 1;
    presence.set(row.faultType, bucket);
  }
  const families = [...presence]
    .filter(([, bucket]) => bucket.witnessed > 0)
    .sort((a, b) => b[1].witnessed - a[1].witnessed);
  console.log('\nwhere the channel speaks');
  table(
    ['fault', 'cases', 'witnessed'],
    families.map(([fault, bucket]) => [fault, String(bucket.cases), String(bucket.witnessed)]),
  );

  console.log('\nthe three modes on the same rows');
  table(
    ['mode', 'fires', 'repairs', 'breaks', 'net', 'correct'],
    priceModes(rows, byCase).map((reading) => [
      reading.mode,
      String(reading.fires),
      String(reading.repairs),
      String(reading.breaks),
      String(reading.net),
      String(reading.correct),
    ]),
  );

  // The population the rule was built for: the truth IS the entry, a callee of the entry rose, and the arm is
  // wrong. It is stated here so the reading can be checked against the reason the rule exists.
  const ceiling = rows.filter(
    (row) =>
      row.entry !== null &&
      row.truth.includes(row.entry) &&
      (row.entryChildErrors ?? 0) > 0 &&
      row.answer !== row.entry,
  );
  const rescued = ceiling.filter((row) => {
    const pick = byCase.get(row.datapack)?.novelCaller ?? null;
    return pick !== null && row.truth.includes(pick);
  });
  console.log(
    `\nceiling (truth is the entry, a callee rose, arm wrong): ${ceiling.length}, witnessed: ${rescued.length}`,
  );

  const after = rows.filter((row) => {
    const pick = byCase.get(row.datapack)?.novelCaller ?? null;
    const answer = pick ?? row.answer;
    return answer !== null && row.truth.includes(answer);
  });
  console.log(
    `correct after the witness: ${after.length} (was ${rows.filter((row) => row.correct).length})`,
  );
}

main();
