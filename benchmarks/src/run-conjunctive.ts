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
 * ## Why both bases are printed
 *
 * The shipped weight vector zeroes the propagation channels, so on the `weighted` basis a propagation term contributes
 * nothing and the conjunction sees a candidate's internal deviation only. The `raw` basis reads the same dump's
 * **values**, which is how a pool-relative propagation share can be priced *before* anyone builds it into the engine:
 * if the conjunction cannot beat the additive score even when the silenced channel is handed to it for free, then the
 * share has no signal to carry and the engine change is refuted before it exists. Printing both makes that comparison
 * one command rather than one argument.
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
  type AxisSpec,
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

/**
 * The specifications the runner prints, in the order it prints them.
 *
 * The first is the shipped score's two axes. The second hands the conjunction every external channel at its measured
 * value — the vector zeroes most of them, so this is the most generous form of the axis the dump permits. The third
 * and fourth are the narrowed axes the register quotes: the channels that measure *propagated failure* only, with and
 * without the kinetic neighbours. They are printed from the same module and the same dump, so every number in the
 * register is a command a reader can run rather than a script that no longer exists.
 */
const SPECS: readonly { label: string; spec: AxisSpec }[] = [
  { label: 'shipped axes, shipped weights', spec: {} },
  { label: 'every external channel, measured values', spec: { basis: 'raw' } },
  {
    label: 'propagated failure only, measured values',
    spec: { basis: 'raw', external: ['rise', 'temporal', 'collision'] },
  },
  { label: 'downstream rise only, measured values', spec: { basis: 'raw', external: ['rise'] } },
];

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

  console.log(
    [
      `terms   ${args.terms} sha256 ${digestOf(args.terms)}`,
      `answers ${args.answers} sha256 ${digestOf(args.answers)}`,
      `cases ${String(corpus.length)}`,
    ].join('\n'),
  );

  for (const { label, spec } of SPECS) {
    let candidates = 0;
    let internalMeasured = 0;
    let externalMeasured = 0;
    let rankable = 0;
    for (const one of corpus) {
      for (const candidate of one.candidates) {
        candidates += 1;
        const shares = axisShares(candidate, spec);
        if (shares.hasInternal) internalMeasured += 1;
        if (shares.hasExternal) externalMeasured += 1;
        if (isRankable(candidate, spec)) rankable += 1;
      }
    }
    const share = (value: number): string =>
      candidates === 0 ? '(0.00 %)' : `(${((100 * value) / candidates).toFixed(2)} %)`;
    const reading = conjunctionReading(corpus, spec);
    console.log('');
    console.log(`--- ${label} [${reading.spec}]`);
    console.log(
      `candidates ${String(candidates)}: internal measured ${String(internalMeasured)} ` +
        `${share(internalMeasured)}, external ${String(externalMeasured)} ${share(externalMeasured)}, ` +
        `both ${String(rankable)} ${share(rankable)}`,
    );
    console.log('');
    console.log(formatConjunction(reading));
  }
}

main();
