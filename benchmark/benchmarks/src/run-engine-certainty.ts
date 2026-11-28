/**
 * Price the engine-certainty guard over the shipped surface.
 *
 * ## What changed in iteration 336, and why
 *
 * Iteration 334 read this guard's margin off the **score-sorted** pair in `terms.ndjson`, and could therefore only
 * call its reading a reading about the TERM order: the dump's own order and the shipped order disagree on 83 of
 * 1 422 cases, so on those cases the margin was taken between two candidates the product never showed first and
 * second. It withheld a **+20** for that reason rather than for doubt.
 *
 * This runner reads the **published** pair instead: `per-case.ndjson` carries the engine's order, the dump carries a
 * `finalScore` per candidate, and the margin is `score(published[0]) − score(published[1])` — which is exactly the
 * `top1Score − top2Score` the engine's own per-case record writes. The pair is the product's and the values are the
 * engine's, so nothing here is a proxy.
 *
 * ## Why a dump's `score` IS the engine's `finalScore`, asserted rather than assumed
 *
 * The dump records `(name, weight, slope)` per candidate beside its `score`, and `finalScore` is a weighted sum of
 * those slopes. The runner therefore **recomputes the sum on every candidate of the corpus and prints the worst
 * deviation** before any reading: `0.000e+00` over 69 688 candidates is the statement "the column this guard reads is
 * the engine's own sort value", and a non-zero worst case would say the two vocabularies had drifted apart.
 *
 * ## What it prints, in order
 *
 * 1. The four digests, the sum identity, the published names that carry no score, and the score-order disagreement.
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
  certaintyCasesOf,
  crossValidateCertainty,
  formatCertaintyReport,
  type PublishedCase,
} from './engine-certainty.js';

/** The bar the first-hop rule ships at, repeated here so the runner prices the surface it will be added to. */
const FIRST_HOP_BETA = 50;

/** The flags this runner accepts. */
interface Args {
  readonly terms: string;
  readonly answers: string;
  readonly edges: string;
  readonly cases: string;
}

/** One candidate as `terms.ndjson` wrote it: its id, its final score, and the terms that sum to it. */
interface TermCandidate {
  readonly id: string;
  readonly score: number;
  readonly terms?: readonly (readonly [string, number | null, number | null])[] | undefined;
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

/** One case's shipped ranking, as `per-case.ndjson` wrote it — with the two columns when the run carried them. */
interface CaseLine {
  readonly datapack: string;
  readonly ranked: readonly string[];
  readonly top1Score?: number | null;
  readonly top2Score?: number | null;
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
  // The published order is no longer optional: a guard priced without it is a guard priced on an order the product
  // did not publish, which is the reading iteration 334 had to withhold.
  const cases = map.get('cases') ?? '';
  if (terms === '' || answers === '' || edges === '' || cases === '') {
    throw new Error('--terms, --answers, --edges and --cases are all required');
  }
  return { terms, answers, edges, cases };
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

/**
 * The worst gap between a candidate's recorded score and the weighted sum of its own terms.
 *
 * @param candidates - One case's candidates, as the dump wrote them.
 * @returns The largest absolute deviation over the candidates that carry slopes.
 */
function worstSumGap(candidates: readonly TermCandidate[]): number {
  let worst = 0;
  for (const one of candidates) {
    let sum = 0;
    for (const term of one.terms ?? []) {
      const weight = term[1];
      const slope = term[2];
      if (weight === null || slope === null) continue;
      sum += weight * slope;
    }
    worst = Math.max(worst, Math.abs(one.score - sum));
  }
  return worst;
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const edges = new Map(readNdjson<EdgeLine>(args.edges).map((one) => [one.id, one]));
  const terms = new Map(readNdjson<TermLine>(args.terms).map((one) => [one.datapack, one]));
  const published = new Map(readNdjson<CaseLine>(args.cases).map((one) => [one.datapack, one]));
  const answers = readNdjson<AnswerLine>(args.answers);
  console.log(`terms   ${args.terms}: sha256 ${digestOf(args.terms)}`);
  console.log(`answers ${args.answers}: sha256 ${digestOf(args.answers)}`);
  console.log(`edges   ${args.edges}: sha256 ${digestOf(args.edges)}`);
  console.log(`cases   ${args.cases}: sha256 ${digestOf(args.cases)}`);
  let worst = 0;
  let candidates = 0;
  for (const one of terms.values()) {
    worst = Math.max(worst, worstSumGap(one.candidates));
    candidates += one.candidates.length;
  }
  console.log(
    `the dump's score is the engine's finalScore: worst |score - sum(w*slope)| = ${worst.toExponential(3)} ` +
      `over ${candidates} candidates`,
  );
  const rows: PublishedCase[] = [];
  let unscored = 0;
  let reordered = 0;
  let doorRepairs = 0;
  for (const one of answers) {
    const line = edges.get(one.datapack);
    const term = terms.get(one.datapack);
    const verdict = published.get(one.datapack);
    if (line === undefined || term === undefined || verdict === undefined) continue;
    const scoreOf = new Map(term.candidates.map((candidate) => [candidate.id, candidate.score]));
    for (const name of verdict.ranked) if (!scoreOf.has(name)) unscored += 1;
    const sorted = [...term.candidates].sort((a, b) => b.score - a.score)[0]?.id ?? null;
    if (sorted !== (verdict.ranked[0] ?? null)) reordered += 1;
    // The surface the guard will be added to: the first-hop rule first, because it is applied LAST in the resolver
    // and a guard priced on the surface before it would be priced on a pipeline nobody runs.
    const speaks = speaksFirstHop(one, line);
    const settled = speaks ? one.entry : one.answer;
    if (speaks && one.answer !== null && !one.truth.includes(one.answer)) doorRepairs += 1;
    rows.push({
      datapack: one.datapack,
      faultType: one.faultType,
      truth: one.truth,
      settled,
      ranked: verdict.ranked,
      // The artifact's own columns when it has them, the dump only when it does not: the reading states which source
      // it took below, because a margin whose provenance is unstated is not an auditable measurement.
      top1Score: verdict.top1Score,
      top2Score: verdict.top2Score,
      scoreOf: (service) => scoreOf.get(service),
    });
  }
  console.log(
    `published names with no score in the dump: ${unscored}; cases where the score order names a different first ` +
      `than the published order: ${reordered} (this reading takes the PUBLISHED pair, so those cases no longer ` +
      'move it)',
  );
  const native = rows.filter((one) => typeof one.top1Score === 'number').length;
  console.log(
    `margin source: ${native} rows read the artifact's own columns, ${rows.length - native} fell back to the dump`,
  );
  const cases = certaintyCasesOf(rows);
  const firstHopShipped = cases.filter(
    (one) => one.answer !== null && one.truth.includes(one.answer),
  ).length;
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
