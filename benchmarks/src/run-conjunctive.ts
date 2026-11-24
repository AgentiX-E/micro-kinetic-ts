/**
 * Print the conjunctive score's reading: the first competitor with a theorem, measured on our own pool.
 *
 * ## What is being tested
 *
 * CIE (arXiv:2601.21359v2) ranks a candidate by the **conjunction** of an internal axis (the component's own
 * deviation) and an external one (what its neighbours observe), and proves that the conjunction ranks the root first
 * under arbitrary amplification where an additive score needs a bound. Our score is additive, so the question this
 * runner answers is the only one that matters for the target: does the conjunction win cases **here**, on the pool the
 * engine published, with both axes reconstructed from the term dump?
 *
 * ## What it prints
 *
 * 1. The two digests and the axis coverage, because a conjunction over an unmeasured axis would rank candidates for a
 *    property of the dump rather than of the component.
 * 2. The three modes against the additive score, with the gain, the undecided count and both folds.
 * 3. The verdict, which is `refused` unless the best mode buys at least one case over the additive score.
 *
 * Usage:
 *   npx tsx benchmarks/src/run-conjunctive.ts --terms <terms.ndjson> --answers <query-agent.ndjson>
 *
 * @module benchmarks/run-conjunctive
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  axisShares,
  conjunctionReading,
  formatConjunction,
  isRankable,
} from './conjunctive-score.js';
import { corpusOf, parseAnswerLine, parseTermLine } from './term-dump.js';

/** The flags this runner accepts. */
interface Args {
  readonly terms: string;
  readonly answers: string;
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
  if (terms === '' || answers === '') throw new Error('--terms and --answers are both required');
  return { terms, answers };
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

  let candidates = 0;
  let internalMeasured = 0;
  let externalMeasured = 0;
  let rankable = 0;
  for (const one of corpus) {
    for (const candidate of one.candidates) {
      candidates += 1;
      const shares = axisShares(candidate);
      if (shares.hasInternal) internalMeasured += 1;
      if (shares.hasExternal) externalMeasured += 1;
      if (isRankable(candidate)) rankable += 1;
    }
  }
  const share = (value: number): string =>
    candidates === 0 ? '(0.00 %)' : `(${((100 * value) / candidates).toFixed(2)} %)`;

  console.log(
    [
      `terms   ${args.terms} sha256 ${digestOf(args.terms)}`,
      `answers ${args.answers} sha256 ${digestOf(args.answers)}`,
      `cases ${String(corpus.length)}`,
      `candidates ${String(candidates)}: internal measured ${String(internalMeasured)} ` +
        `${share(internalMeasured)}, external ${String(externalMeasured)} ${share(externalMeasured)}, ` +
        `both ${String(rankable)} ${share(rankable)}`,
    ].join('\n'),
  );
  console.log('');
  console.log(formatConjunction(conjunctionReading(corpus)));
}

main();
