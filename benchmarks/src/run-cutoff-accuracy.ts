/**
 * Print the cutoff-average metric — `AC@1..k`, `Avg@k`, and the floor a random order of the same pool pays.
 *
 * ## Why this runner exists
 *
 * Every published competitor number this project compares against is one of two things: an `AC@1`, which the
 * register already quotes, or an `Avg@5`, which it quoted for three iterations with the caveat "not comparable
 * directly". That caveat was wrong. `Avg@5` is `(1/5) Σ_{j=1..5} AC@j` — a function of the same per-case integer
 * the census already writes — so the comparison was a missing column rather than a missing population.
 *
 * ## What makes the comparison honest
 *
 * A cutoff average is not scale-free: on a pool of `n` a uniformly random order already scores
 * `(1/(n·k)) Σ min(j, n)`, which is `0.70` at `n = 4` and `0.05` at `n = 64`. Every row therefore prints the floor of
 * its own cases beside it, and a cell whose `Avg@5` sits at the floor is a cell the metric cannot rank. This is the
 * same discipline `docs/base-term-price.md` applies to a weight and `docs/term-marginal-338.md` applies to a term.
 *
 * ## What it does not do
 *
 * It does not re-score, re-rank or call an endpoint: both numbers are read from the census of a run that already
 * happened, so the whole table is ¥0.
 *
 * Usage:
 *   npx tsx benchmarks/src/run-cutoff-accuracy.ts --census <census.jsonl>[,<census2.jsonl>] \
 *     [--k 5] [--cells RE1:SockShop,RE2:SockShop,RE1:OnlineBoutique]
 *
 * @module benchmarks/run-cutoff-accuracy
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  censusPopulations,
  cutoffTable,
  formatCutoffs,
  parseCensusLine,
  publishedRate,
  type CensusRow,
} from './cutoff-accuracy.js';

/** The flags this runner accepts. */
interface Args {
  /** One or more census files, comma separated. */
  readonly census: readonly string[];
  readonly k: number;
  /** Cells to keep, or every cell when empty. */
  readonly cells: readonly string[];
}

/** Read the flags, refusing an unknown one rather than ignoring it. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index] ?? '';
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const census = (map.get('census') ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
  if (census.length === 0) throw new Error('--census is required');
  const k = map.has('k') ? Number(map.get('k')) : 5;
  if (!Number.isInteger(k) || k < 1)
    throw new Error(`--k must be a positive integer, got ${map.get('k') ?? ''}`);
  const cells = (map.get('cells') ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
  return { census, k, cells };
}

/** The first 16 hex characters of a file's sha256. */
function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

/** Read one census file into validated rows, keeping the line number for a refusal that can name it. */
function rowsOf(path: string): CensusRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, index) => parseCensusLine(line, index + 1));
}

/** A share, so no cell implies more precision than the corpus carries. */
function share(value: number, total: number): string {
  return total === 0 ? '(0.00 %)' : `(${((100 * value) / total).toFixed(2)} %)`;
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const rows: CensusRow[] = [];
  for (const path of args.census) {
    console.log(`census ${path} sha256 ${digestOf(path)}`);
    rows.push(...rowsOf(path));
  }

  const known = [...new Set(rows.map((one) => one.cell))].sort();
  for (const cell of args.cells) {
    // A cell name that matches nothing is a typo, and a typo that printed an empty table would read as a corpus
    // with no cases rather than as a misspelled scope.
    if (!known.includes(cell)) {
      throw new Error(
        `--cells names ${cell}, which no census row carries; this corpus has ${known.join(', ')}`,
      );
    }
  }
  const kept = args.cells.length === 0 ? rows : rows.filter((one) => args.cells.includes(one.cell));
  const split = censusPopulations(kept);

  console.log('');
  console.log(
    `census ${String(kept.length)} rows; the ORDER metric is defined on ${String(split.measured.length)} ` +
      `and ${String(split.unmeasured)} rows carry no truthRank at all`,
  );
  console.log('');
  console.log(formatCutoffs(cutoffTable(split.measured, args.k)));

  // The answer's own AC@1 beside the order's, per cell. They agree on this artifact — its `truthRank` is a position
  // in the PUBLISHED order — so the column that matters is `passes`, which must read 0 here and reads 83 on the
  // term-dumped 1 422-case surface. A non-zero number on this line would mean the census had started carrying a
  // pre-pass order, and every reading below would then be quoting one of two different populations.
  console.log('');
  console.log(
    'published answer vs order, AC@1 — `passes` must be 0: this census ranks the PUBLISHED order',
  );
  const byCell = new Map<string, CensusRow[]>();
  for (const one of kept) {
    const bucket = byCell.get(one.cell);
    if (bucket === undefined) byCell.set(one.cell, [one]);
    else bucket.push(one);
  }
  let publishedCorrect = 0;
  let orderFirst = 0;
  for (const cell of [...byCell.keys()].sort()) {
    const bucket = byCell.get(cell)!;
    const published = publishedRate(bucket);
    const order = bucket.filter((one) => one.hitRank === 1).length;
    publishedCorrect += published.correct;
    orderFirst += order;
    console.log(
      `${cell.padEnd(22)} published ${String(published.correct).padStart(4)} ${share(published.correct, published.cases).padStart(10)}` +
        ` | order ${String(order).padStart(4)} ${share(order, bucket.length).padStart(10)}` +
        ` | passes ${String(published.correct - order).padStart(4)}`,
    );
  }
  console.log(
    `${'pooled'.padEnd(22)} published ${String(publishedCorrect).padStart(4)} ${share(publishedCorrect, kept.length).padStart(10)}` +
      ` | order ${String(orderFirst).padStart(4)} ${share(orderFirst, kept.length).padStart(10)}` +
      ` | passes ${String(publishedCorrect - orderFirst).padStart(4)}`,
  );
}

main();
