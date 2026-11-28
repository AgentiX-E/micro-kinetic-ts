/**
 * Price the retrieval block over an arm's answers and the engine's own ranking.
 *
 * ## Why this is a join and not a dispatch
 *
 * Both halves were paid for by runs that already happened: `terms.ndjson` carries every candidate with its score, and
 * `query-agent.ndjson` carries whether the arm answered the case. Nothing here calls an endpoint, and the runner
 * prints both digests before any number, so a reading is attached to the files it came from — the lesson iteration 329
 * paid for when two dispatches were mistaken for one file.
 *
 * ## What it prints, in order
 *
 * 1. The two digests.
 * 2. The five-class census of the corpus.
 * 3. What breadth buys, at the widths a plan can actually buy.
 * 4. What a DEPLOYED rule can see: the gap between the top two candidates, which is the only undecidable-ness a
 *    pipeline can read without knowing the truth.
 *
 * @module benchmarks/run-retrieval-block
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  SEED_WIDTH,
  censusRetrieval,
  formatRetrievalReport,
  gapSeparability,
  wideningCurve,
  type RetrievalCase,
} from './retrieval-block.js';

/** The widths to price: the shipped seed, and the three a plan has named. */
const WIDTHS: readonly number[] = [5, 10, 22, 44];

/** Gaps between the top two candidates to sweep. The block's median is around 0.16, the corpus's hit median 0.69. */
const GAPS: readonly number[] = [0.01, 0.05, 0.1, 0.164, 0.25, 0.5, 1, 5];

/** The flags this runner accepts. */
interface Args {
  readonly terms: string;
  readonly answers: string;
}

/** One candidate as `terms.ndjson` wrote it. */
interface TermCandidate {
  readonly id: string;
  readonly score: number;
}

/** One case as `terms.ndjson` wrote it. */
interface TermLine {
  readonly datapack: string;
  readonly accepted: readonly string[];
  readonly candidates: readonly TermCandidate[];
}

/** One answer as the arm published it. */
interface AnswerLine {
  readonly datapack: string;
  readonly correct: boolean;
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

/** Read an ndjson file into rows, skipping blank lines. */
function readNdjson<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

/** The first 16 hex characters of a file's sha256, the digest every reading in this programme is attached to. */
function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const answers = new Map(
    readNdjson<AnswerLine>(args.answers).map((one) => [one.datapack, one.correct]),
  );
  const cases: RetrievalCase[] = [];
  let unjoined = 0;
  for (const line of readNdjson<TermLine>(args.terms)) {
    const correct = answers.get(line.datapack);
    if (correct === undefined) {
      unjoined += 1;
      continue;
    }
    const ranked = [...line.candidates].sort((a, b) => b.score - a.score);
    cases.push({
      datapack: line.datapack,
      truth: line.accepted,
      ranked: ranked.map((one) => one.id),
      scores: ranked.map((one) => one.score),
      correct,
    });
  }
  console.log(`terms ${args.terms}: sha256 ${digestOf(args.terms)}`);
  console.log(`answers ${args.answers}: sha256 ${digestOf(args.answers)}`);
  if (unjoined > 0)
    console.log(`WARNING: ${unjoined} term rows carried no answer and are not read`);
  console.log('');
  console.log(
    formatRetrievalReport(
      censusRetrieval(cases, SEED_WIDTH),
      wideningCurve(cases, WIDTHS),
      gapSeparability(cases, GAPS, SEED_WIDTH),
      SEED_WIDTH,
    ),
  );
}

main();
