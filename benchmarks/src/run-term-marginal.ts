/**
 * Print the term marginal ledger: what each implementation contributes on the pool the engine ordered.
 *
 * ## Why this runner spends nothing
 *
 * Both inputs are artifacts of runs that already happened — the engine's term dump and the arm's answers — and the
 * reading is a re-summation of numbers already in the dump. Nothing here calls an endpoint and nothing here re-scores
 * a case from the raw corpus, so the whole table is ¥0.
 *
 * ## What it prints
 *
 * 1. The two digests, so a reading is attached to the files it came from.
 * 2. The ledger: every term with its weights, the largest contribution it can make, how many cases it decided and how
 *    many of those were right, its marginal, and the role that marginal supports.
 * 3. The score drift, which must be zero: a dump whose `score` column disagrees with its own terms would make every
 *    marginal a property of this programme rather than of the engine.
 *
 * 4. The published headline beside the sum's own order, because they are different numbers: two relational passes
 *    reorder the list after scoring, so the engine publishes more correct first choices than the sum's maximum. A
 *    marginal is a property of the sum, and the two counts are printed together so neither can be read as the other.
 *
 * Usage:
 *   npx tsx benchmarks/src/run-term-marginal.ts --terms <terms.ndjson> --answers <query-agent.ndjson> \
 *     [--cases <per-case.ndjson>]
 *
 * @module benchmarks/run-term-marginal
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { corpusOf, parseAnswerLine, parseTermLine } from './term-dump.js';
import {
  evidencePartition,
  formatMarginals,
  marginalTable,
  publishedReading,
  type MarginalRow,
} from './term-marginal.js';

/** The flags this runner accepts. */
interface Args {
  readonly terms: string;
  readonly answers: string;
  /** The engine's per-case verdict, whose `ranked` column carries the order the engine actually published. */
  readonly cases: string;
}

/** Read the flags, refusing an unknown one rather than ignoring it. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const terms = map.get('terms') ?? '';
  const answers = map.get('answers') ?? '';
  const cases = map.get('cases') ?? '';
  if (terms === '' || answers === '') throw new Error('--terms and --answers are both required');
  return { terms, answers, cases };
}

/** Read an ndjson file into parsed rows, skipping blank lines. */
function linesOf(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

/** The first 16 hex characters of a file's sha256. */
function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

/** A share, so no cell implies more precision than the corpus carries. */
function share(value: number, total: number): string {
  return total === 0 ? '(0.00 %)' : `(${((100 * value) / total).toFixed(2)} %)`;
}

/** One line naming the terms of a role, or a dash when the role is empty on this corpus. */
function lineOf(role: MarginalRow['role'], rows: readonly MarginalRow[]): string {
  const named = rows.filter((row) => row.role === role).map((row) => row.term);
  return `${role.padEnd(12)} ${named.length === 0 ? '—' : named.join(', ')}`;
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const rows = linesOf(args.terms).map((raw, index) => parseTermLine(raw, index + 1));
  const truth = new Map(
    linesOf(args.answers).map((raw, index) => {
      const one = parseAnswerLine(raw, index + 1);
      return [one.datapack, one.truth] as const;
    }),
  );
  const corpus = corpusOf(rows, truth);
  const table = marginalTable(corpus);

  console.log(
    [
      `terms   ${args.terms} sha256 ${digestOf(args.terms)}`,
      `answers ${args.answers} sha256 ${digestOf(args.answers)}`,
      `cases ${String(corpus.length)} dumped, ${String(table.cases)} graded`,
    ].join('\n'),
  );
  console.log('');
  console.log(formatMarginals(table));
  if (args.cases !== '') {
    // The published order is the engine's own headline and it is NOT the sum's order: the passes that reorder the
    // list after scoring are worth 83 cases on this corpus. Printing both is what keeps a marginal honest.
    const ranked = new Map(
      linesOf(args.cases).map((raw) => {
        const one = raw as { datapack: string; ranked?: readonly string[] };
        return [one.datapack, one.ranked ?? []] as const;
      }),
    );
    const published = publishedReading(corpus, ranked);
    console.log('');
    console.log(
      `published ${String(published.published)} ${share(published.published, published.cases)} ` +
        `(cases ${args.cases} sha256 ${digestOf(args.cases)}) | ` +
        `sum order ${String(published.scoreOrder)} ${share(published.scoreOrder, published.cases)} | ` +
        `the two disagree on ${String(published.replaced)} cases`,
    );
  }
  const partition = evidencePartition(corpus);
  console.log('');
  console.log(
    `pools carrying evidence ${String(partition.withEvidence.correct)} / ` +
      `${String(partition.withEvidence.cases)} ${share(partition.withEvidence.correct, partition.withEvidence.cases)}` +
      ` | pools with the deviation alone ${String(partition.kineticOnly.correct)} / ` +
      `${String(partition.kineticOnly.cases)} ${share(partition.kineticOnly.correct, partition.kineticOnly.cases)}`,
  );
  console.log('');
  for (const role of ['load-bearing', 'tie-maker', 'harmful', 'decorative', 'inert'] as const) {
    console.log(lineOf(role, table.rows));
  }
  if (table.scoreDrift !== 0) {
    // Never a warning: a non-zero drift means the artifact's own score column and its terms disagree, and every
    // marginal above is then a statement about this programme's arithmetic rather than about the engine.
    throw new Error(
      `the dump's score column disagrees with its own terms by ${table.scoreDrift.toExponential(3)}`,
    );
  }
}

main();
