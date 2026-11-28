/**
 * Print the miss ledger, and price the rules that could have bought the misses.
 *
 * ## Why this is a join and not a dispatch
 *
 * Every input was paid for by a run that already happened: the arm's answers, the engine's per-case verdict (which
 * carries the truth's rank among the whole candidate list and the row's two sort values), the corpus walk (which
 * carries the failing edges the first-hop rule reads) and the term dump (which carries the per-term decomposition of
 * each candidate's score). Nothing here calls an endpoint, and every digest is printed before any number, so a
 * reading is attached to the files it came from.
 *
 * ## What it prints, in order
 *
 * 1. The four digests and the three surfaces the pipeline passes through.
 * 2. The ledger on the shipped surface: hits, the three kinds of miss, and the channel that settled each miss.
 * 3. The promotion sweep: what "publish the engine's own first choice" would repair and break, in four scopings.
 * 4. The concentration reading: whether the share of the margin carried by one term separates the guard's repairs
 *    from its breaks. §336 named this as the next axis; this is its price, and it is ¥0.
 *
 * @module benchmarks/run-miss-ledger
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { CERTAINTY_GRID, formatGuardCensus, guardCensusOf } from './engine-certainty.js';
import { firstHopUnder, type HopCase } from './first-hop.js';
import {
  formatLedger,
  formatPromotion,
  formatStability,
  ledgerOf,
  promotionReadings,
  stabilityReading,
  type LedgerCase,
} from './miss-ledger.js';
import { ENGINE_CERTAINTY_MARGIN, engineCertainty } from './query-agent.js';
import { formatReachCensus, reachCensusOf, type ArmAnswer } from './retrieval-block.js';
import { renderSurfaceLine, type SurfaceRow } from './surface-diff.js';

/** The bar the first-hop rule ships at. */
const FIRST_HOP_BETA = 50;

/** The flags this runner accepts. */
interface Args {
  readonly answers: string;
  readonly cases: string;
  readonly edges: string;
  readonly terms: string;
  /**
   * Where the SHIPPED surface is written, one case per line, when the caller asks for it.
   *
   * Empty means "do not write", because a push-triggered run has no second surface to compare against and an
   * artifact nobody reads is a file the workflow has to carry. The default is therefore the absence, which is
   * also the state every earlier artifact was produced in.
   */
  readonly surfaceOut: string;
}

/** One answer as the arm published it. */
interface AnswerLine {
  readonly datapack: string;
  readonly truth: readonly string[];
  readonly answer: string | null;
  readonly answeredBy: string;
  readonly entry: string | null;
  readonly entryChildErrors: number | null;
  readonly belowFails: boolean | null;
  readonly rawAnswer: string | null;
  /** The services whose telemetry the arm queried, or absent on an artifact that predates the column. */
  readonly calls?: readonly string[] | null;
  /** The arm's own `seeded` flag, or absent on an artifact that predates it. */
  readonly seeded?: boolean | null;
}

/** One case as the engine's per-case verdict wrote it. */
interface VerdictLine {
  readonly datapack: string;
  readonly accepted: readonly string[];
  readonly ranked: readonly string[];
  readonly truthRank: number | null;
  readonly top1Score?: number | null;
  readonly top2Score?: number | null;
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

/** One candidate as `terms.ndjson` wrote it: its id and the per-term contributions that sum to its score. */
interface TermCandidate {
  readonly id: string;
  readonly terms?: readonly (readonly [string, number | null, number | null])[] | undefined;
}

/** One case as `terms.ndjson` wrote it. */
interface TermLine {
  readonly datapack: string;
  readonly candidates: readonly TermCandidate[];
}

/** Read the flags, refusing an unknown one rather than ignoring it. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const answers = map.get('answers') ?? '';
  const cases = map.get('cases') ?? '';
  const edges = map.get('edges') ?? '';
  const terms = map.get('terms') ?? '';
  if (answers === '' || cases === '' || edges === '' || terms === '') {
    throw new Error('--answers, --cases, --edges and --terms are all required');
  }
  // Read through the same pair-loop as the four inputs rather than from a flag scan of its own: a second
  // parser is how `--surface-out` and its value would come to disagree about which token is the path.
  const surfaceOut = map.get('surface-out') ?? '';
  return { answers, cases, edges, terms, surfaceOut };
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

/** Failures above the pre-injection baseline on the edge into the entry, as the first-hop rule reads them. */
function inboundFailures(line: EdgeLine): number {
  let total = 0;
  for (const one of line.failedEdges) {
    if (one.callee !== line.entry) continue;
    const rise = one.failed - one.baseline;
    if (rise > 0) total += rise;
  }
  return total;
}

/** The per-term contributions of one candidate, with an unmeasured factor refused rather than read as zero. */
function contributionsOf(candidate: TermCandidate | undefined): Record<string, number> | undefined {
  if (candidate === undefined || candidate.terms === undefined) return undefined;
  const out: Record<string, number> = {};
  for (const [name, weight, slope] of candidate.terms) {
    if (weight === null || slope === null) continue;
    out[name] = weight * slope;
  }
  return out;
}

/** The candidate names the model's own raw answer carried, restricted to names the case actually has. */
function rawNamesOf(raw: string | null, pool: ReadonlySet<string>): readonly string[] {
  if (raw === null) return [];
  const out: string[] = [];
  for (const word of raw.replace(/\n/g, ' ').split(/\s+/)) {
    const name = word.replace(/^[.:;()[\]`*,"']+|[.:;()[\]`*,"']+$/g, '');
    if (!pool.has(name)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Whether a published answer is one of the labelled services. */
function right(truth: readonly string[], answer: string | null): boolean {
  return answer !== null && truth.includes(answer);
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const answers = readNdjson<AnswerLine>(args.answers);
  const verdicts = new Map<string, VerdictLine>(
    readNdjson<VerdictLine>(args.cases).map((one) => [one.datapack, one]),
  );
  const edges = new Map<string, EdgeLine>(
    readNdjson<EdgeLine>(args.edges).map((one) => [one.id, one]),
  );
  const terms = new Map<string, TermLine>(
    readNdjson<TermLine>(args.terms).map((one) => [one.datapack, one]),
  );

  console.log(
    [
      `answers ${args.answers} sha256 ${digestOf(args.answers)}`,
      `verdicts ${args.cases} sha256 ${digestOf(args.cases)}`,
      `edges ${args.edges} sha256 ${digestOf(args.edges)}`,
      `terms ${args.terms} sha256 ${digestOf(args.terms)}`,
    ].join('\n'),
  );

  const base: LedgerCase[] = [];
  const hopped: LedgerCase[] = [];
  const shipped: LedgerCase[] = [];
  // Every case's margin, kept so the report can say how much of the corpus the guard could see. A surface read
  // without this line cannot distinguish "the guard did not fire" from "the guard was never asked".
  const margins: (number | null)[] = [];
  let missing = 0;
  for (const one of answers) {
    const verdict = verdicts.get(one.datapack);
    const edge = edges.get(one.datapack);
    if (verdict === undefined || edge === undefined) {
      missing += 1;
      continue;
    }
    const hopCase: HopCase = {
      datapack: one.datapack,
      faultType: '',
      truth: one.truth,
      answer: one.answer,
      entry: one.entry,
      entryChildErrors: one.entryChildErrors,
      belowFails: one.belowFails,
      inboundFails: inboundFailures(edge),
    };
    const after = firstHopUnder(hopCase, FIRST_HOP_BETA);
    const engineTop1 = verdict.ranked[0] ?? null;
    const top1 = verdict.top1Score;
    const top2 = verdict.top2Score;
    const margin =
      typeof top1 === 'number' &&
      typeof top2 === 'number' &&
      Number.isFinite(top1) &&
      Number.isFinite(top2)
        ? top1 - top2
        : null;
    margins.push(margin);
    const guard = engineCertainty(after, { top1: engineTop1, margin }, ENGINE_CERTAINTY_MARGIN);
    const line = terms.get(one.datapack);
    const pool = new Set((line?.candidates ?? []).map((candidate) => candidate.id));
    const second = verdict.ranked[1];
    const contributions = (id: string | null): Record<string, number> | undefined =>
      contributionsOf(line?.candidates.find((candidate) => candidate.id === id));
    const anomaly = (id: string | null): number | null =>
      contributions(id)?.selfAnomalyLog1p ?? null;
    const shared = {
      datapack: one.datapack,
      truth: one.truth,
      answeredBy: one.answeredBy,
      engineTop1,
      truthRank: verdict.truthRank,
      margin,
      top1Terms: contributions(engineTop1),
      top2Terms: contributions(second ?? null),
      rawNames: rawNamesOf(one.rawAnswer, pool),
      engineAnomaly: anomaly(engineTop1),
    };
    const settled = guard ?? after;
    base.push({ ...shared, published: one.answer, answerAnomaly: anomaly(one.answer) });
    hopped.push({ ...shared, published: after, answerAnomaly: anomaly(after) });
    shipped.push({ ...shared, published: settled, answerAnomaly: anomaly(settled) });
  }

  const count = (cases: readonly LedgerCase[]): number =>
    cases.filter((one) => right(one.truth, one.published)).length;
  console.log(
    `\nread ${answers.length} answers, ${verdicts.size} verdicts, ${edges.size} failing-edge records, ` +
      `${terms.size} term records${missing === 0 ? '' : `, ${missing} cases without a verdict or a walk`}`,
  );
  console.log(
    `surfaces: arm answers ${count(base)} -> first hop ${count(hopped)} -> shipped ${count(shipped)}` +
      ` / ${shipped.length} (${((100 * count(shipped)) / Math.max(1, shipped.length)).toFixed(2)} %)`,
  );

  // The shipped surface, written only when a caller asked for it. Every flip this file can support is a comparison
  // against ANOTHER file produced the same way, so the writer is stated here — beside the population it printed —
  // rather than in a second script that would have to re-derive which of the three surfaces was the shipped one.
  if (args.surfaceOut !== '') {
    const rows: SurfaceRow[] = shipped.map((one) => ({
      datapack: one.datapack,
      answer: one.published,
      correct: right(one.truth, one.published),
    }));
    writeFileSync(args.surfaceOut, `${rows.map(renderSurfaceLine).join('\n')}\n`);
    console.log(`  shipped surface: ${rows.length} rows -> ${args.surfaceOut}`);
  }

  // What the arm INVESTIGATED, which is a different question from what the engine ranked. The 340 entry established
  // that the two artifacts are joined rather than dependent; this is the reading that says where the arm's own
  // attention went, and it is the only one of the two that can price a change to the arm's policy.
  const shippedCorrect = new Map(
    shipped.map((one) => [one.datapack, right(one.truth, one.published)]),
  );
  const armAnswers = (correctOf: (one: AnswerLine) => boolean): ArmAnswer[] =>
    answers.map((one) => ({
      datapack: one.datapack,
      truth: one.truth,
      calls: one.calls ?? null,
      correct: correctOf(one),
      seeded: one.seeded ?? null,
    }));
  console.log("\narm reach, on the arm's own answers");
  console.log(formatReachCensus(reachCensusOf(armAnswers((one) => right(one.truth, one.answer)))));
  console.log('arm reach, on the shipped surface');
  console.log(
    formatReachCensus(
      reachCensusOf(
        armAnswers((one) => shippedCorrect.get(one.datapack) ?? right(one.truth, one.answer)),
      ),
    ),
  );

  console.log(formatGuardCensus(guardCensusOf(margins)));
  console.log(`\n${formatLedger(ledgerOf(shipped))}`);
  console.log(`\npromotion sweep on the shipped surface`);
  console.log(formatPromotion(promotionReadings(shipped)));
  // The shipped bar is the one bar at which the guard has no breaks by construction, so a reading taken
  // only there would report that nothing can be separated from nothing. The grid is printed instead: the
  // concentration statistic has to be able to separate the repairs from the breaks at the bar where the
  // trade-off actually exists, which is where a lower bar starts paying for its extra repairs in losses.
  console.log(
    `\nconcentration of the separation, on the surface the guard is added to ` +
      `(shipped bar ${String(ENGINE_CERTAINTY_MARGIN)})`,
  );
  for (const bar of CERTAINTY_GRID)
    console.log(`\n${formatStability(stabilityReading(hopped, bar))}`);
}

main();
