/**
 * Price the engine-certainty guard over the shipped surface.
 *
 * ## What this runner is careful about
 *
 * The guard reads the SCORE MARGIN between the engine's first and second candidate, and the only artifact that carries
 * scores is `terms.ndjson`. Its own ordering is not byte-identical to the shipped ranking's — the two disagree on 83
 * of 1 422 cases — so the runner **prints that disagreement** before any reading and refuses to hide it. A reading
 * taken on an ordering that is not the shipped one is a reading about the ordering, and the line exists so nobody can
 * quote the number as if it were about the product.
 *
 * ## What it prints, in order
 *
 * 1. The three digests, and the disagreement between the term order and the shipped order (when `--cases` is given).
 * 2. The surface the first-hop rule already ships, so the guard is priced on the surface it will be added to.
 * 3. The held-out reading of the guard, with its four clauses.
 *
 * @module benchmarks/run-engine-certainty
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  CERTAINTY_GRID,
  MIN_CERTAINTY_GAIN,
  MIN_CERTAINTY_PRECISION,
  crossValidateCertainty,
  formatCertaintyReport,
  type CertaintyCase,
} from './engine-certainty.js';

/** The bar the first-hop rule ships at, repeated here so the runner prices the surface it will be added to. */
const FIRST_HOP_BETA = 50;

/** The flags this runner accepts. */
interface Args {
  readonly terms: string;
  readonly answers: string;
  readonly edges: string;
  readonly cases: string | null;
}

/** One candidate as `terms.ndjson` wrote it. */
interface TermCandidate {
  readonly id: string;
  readonly score: number;
}

/** One case as `terms.ndjson` wrote it. */
interface TermLine {
  readonly datapack: string;
  readonly candidates: readonly TermCandidate[];
}

/** One answer as the arm published it. */
interface AnswerLine {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  readonly answer: string | null;
  readonly entry: string | null;
  readonly entryChildErrors: number | null;
  readonly belowFails: boolean | null;
}

/** One case's failing edges, as the corpus walk wrote them. */
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

/** One case's shipped ranking, as `per-case.ndjson` wrote it. */
interface CaseLine {
  readonly datapack: string;
  readonly ranked: readonly string[];
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
  const edges = map.get('edges') ?? '';
  if (terms === '' || answers === '' || edges === '') {
    throw new Error('--terms, --answers and --edges are all required');
  }
  const cases = map.get('cases');
  return { terms, answers, edges, cases: cases === undefined || cases === '' ? null : cases };
}

/** Read an ndjson file into rows, skipping blank lines. */
function readNdjson<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

/** The first 16 hex characters of a file's sha256. */
function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

/** Failures on the edge into the entry, above the pre-injection baseline. */
function inboundFailures(line: EdgeLine): number {
  let total = 0;
  for (const one of line.failedEdges) {
    if (one.callee !== line.entry) continue;
    const rise = one.failed - one.baseline;
    if (rise > 0) total += rise;
  }
  return total;
}

/** Whether the first-hop rule speaks on this case. */
function speaksFirstHop(one: AnswerLine, line: EdgeLine): boolean {
  if (one.entry === null || one.answer === null) return false;
  if (one.entryChildErrors !== 0) return false;
  if (one.belowFails !== false) return false;
  if (one.answer === one.entry) return false;
  return inboundFailures(line) > FIRST_HOP_BETA;
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const edges = new Map(readNdjson<EdgeLine>(args.edges).map((one) => [one.id, one]));
  const terms = new Map(readNdjson<TermLine>(args.terms).map((one) => [one.datapack, one]));
  const answers = readNdjson<AnswerLine>(args.answers);
  console.log(`terms   ${args.terms}: sha256 ${digestOf(args.terms)}`);
  console.log(`answers ${args.answers}: sha256 ${digestOf(args.answers)}`);
  console.log(`edges   ${args.edges}: sha256 ${digestOf(args.edges)}`);
  if (args.cases !== null) {
    const shipped = new Map(
      readNdjson<CaseLine>(args.cases).map((one) => [one.datapack, one.ranked[0] ?? null]),
    );
    let disagree = 0;
    let compared = 0;
    for (const [datapack, term] of terms) {
      const top = [...term.candidates].sort((a, b) => b.score - a.score)[0]?.id ?? null;
      const published = shipped.get(datapack);
      if (published === undefined) continue;
      compared += 1;
      if (published !== top) disagree += 1;
    }
    console.log(
      `term order vs shipped order: ${disagree} of ${compared} cases disagree, so a reading here is about the ` +
        'TERM order and not yet about the product',
    );
  }
  const cases: CertaintyCase[] = [];
  let doorRepairs = 0;
  let firstHopShipped = 0;
  for (const one of answers) {
    const line = edges.get(one.datapack);
    if (line === undefined) continue;
    const term = terms.get(one.datapack);
    if (term === undefined) continue;
    const ranked = [...term.candidates].sort((a, b) => b.score - a.score);
    // The surface the guard will be added to: the first-hop rule first, because it is applied LAST in the resolver
    // and a guard priced on the surface before it would be priced on a pipeline nobody runs.
    const settled = speaksFirstHop(one, line) ? one.entry : one.answer;
    if (settled !== null && one.truth.includes(settled)) firstHopShipped += 1;
    if (speaksFirstHop(one, line) && one.answer !== null && !one.truth.includes(one.answer)) {
      doorRepairs += 1;
    }
    cases.push({
      datapack: one.datapack,
      faultType: one.faultType,
      truth: one.truth,
      answer: settled,
      engineTop1: ranked[0]?.id ?? null,
      margin: ranked.length > 1 ? ranked[0]!.score - ranked[1]!.score : null,
    });
  }
  console.log('');
  console.log(`the surface the first-hop rule ships: ${firstHopShipped} of ${cases.length}`);
  console.log(`  (of the rows it moved, ${doorRepairs} were wrong before and are not now)`);
  console.log('');
  console.log(
    formatCertaintyReport(
      crossValidateCertainty(cases, CERTAINTY_GRID, MIN_CERTAINTY_GAIN, MIN_CERTAINTY_PRECISION),
    ),
  );
}

main();
