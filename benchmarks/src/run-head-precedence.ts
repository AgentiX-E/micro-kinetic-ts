/**
 * Price the head-precedence rule over a corpus walk's profiles, a containment artifact and an arm's answers.
 *
 * ## Why this runner exists rather than a dispatch
 *
 * The rule is a statement about a CHAIN the artifact already carries and a profile the walk already wrote, so the
 * whole reading is a join over files that have been paid for. Iteration 331's pre-registration states the cost as
 * zero, and a runner that dispatched an arm to price a precedence rule would be pricing a different rule.
 *
 * ## The order the questions have to be asked
 *
 * 1. **What is the baseline?** The artifact's own surface, to two decimals, with its digest — because a delta from a
 *    file nobody can identify is not a delta.
 * 2. **Is the mechanism there?** Predictions P1 and P2, read off {@link loudnessUnder} at every bar: how often the
 *    overridden heads were loud on each side.
 * 3. **Does it pay?** The held-out reading, selected on one fold and read on the other, with three clauses that can
 *    refuse it whatever it reads.
 * 4. **Did the guard stay inside its population?** P4, computed rather than assumed: the model's answers must be
 *    untouched, and a non-zero count voids the price.
 *
 * @module benchmarks/run-head-precedence
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { departureFromSlots, type ChannelDeparture } from './channel-kind.js';
import { KAPPA_GRID, surfaceReading, type Profiles, type SurfaceReading } from './channel-split.js';
import {
  MIN_PRECEDENCE_GAIN,
  crossValidatePrecedence,
  formatPrecedenceReport,
  loudnessUnder,
  modelAnswersTouched,
  type ChainOrder,
  type PrecedenceCase,
  type ResolvedBy,
} from './head-precedence.js';

/** The flags this runner accepts. */
interface Args {
  readonly artifact: string;
  readonly channelIn: string;
  readonly containment: string;
}

/** One case's profiles, as the walk wrote them: five numbers per service, in the schema's order. */
interface ProfileLine {
  readonly datapack: string;
  readonly services: Readonly<Record<string, readonly (number | null)[]>>;
}

/** One case's chain, as the containment artifact carries it. */
interface ContainmentLine {
  readonly datapack: string;
  readonly chain: { readonly order: readonly string[] };
}

/** One answer, as the arm published it. */
interface AnswerLine {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  readonly answer: string | null;
  readonly entry: string | null;
  readonly answeredBy: string | null;
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
  const channelIn = map.get('channel-in') ?? '';
  const containment = map.get('containment') ?? '';
  if (artifact === '' || channelIn === '' || containment === '') {
    throw new Error('--artifact, --channel-in and --containment are all required');
  }
  return { artifact, channelIn, containment };
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

/** Turn the written lines back into the map the reader takes. */
function keyed(lines: readonly ProfileLine[]): Profiles {
  const profiles = new Map<string, ReadonlyMap<string, ChannelDeparture>>();
  for (const line of lines) {
    const services = new Map<string, ChannelDeparture>();
    for (const [id, slots] of Object.entries(line.services)) {
      services.set(id, departureFromSlots(line.datapack, slots));
    }
    profiles.set(line.datapack, services);
  }
  return profiles;
}

/** The channel that settled an answer, narrowed to the four the artifact writes. */
function settledBy(value: string | null): ResolvedBy | null {
  if (value === 'entry' || value === 'interface' || value === 'prior' || value === 'model')
    return value;
  return null;
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const profiles = keyed(readNdjson<ProfileLine>(args.channelIn));
  const heads = new Map<string, ChainOrder>(
    readNdjson<ContainmentLine>(args.containment).map((one) => [
      one.datapack,
      { order: one.chain.order },
    ]),
  );
  const lines = readNdjson<AnswerLine>(args.artifact);
  const cases: PrecedenceCase[] = lines.map((one) => ({
    datapack: one.datapack,
    faultType: one.faultType,
    truth: one.truth,
    answer: one.answer,
    entry: one.entry,
    by: settledBy(one.answeredBy),
  }));
  const surface: SurfaceReading = surfaceReading(
    cases.map((one) => ({
      datapack: one.datapack,
      faultType: one.faultType,
      truth: one.truth,
      answer: one.answer,
      entry: one.entry,
      entryChildErrors: null,
      belowFails: null,
      answerSurprise: null,
      novelCaller: null,
      novelRise: null,
    })),
  );
  const digest = createHash('sha256')
    .update(readFileSync(args.artifact))
    .digest('hex')
    .slice(0, 16);
  console.log(`read ${profiles.size} profiles, ${heads.size} chains, ${cases.length} answers`);
  console.log(
    `\nartifact ${args.artifact}: ${surface.rows} rows, sha256 ${digest}\n` +
      `the artifact's own answers: ${surface.correct} (${surface.share} %)`,
  );

  const loudness = KAPPA_GRID.map((kappa) => loudnessUnder(cases, profiles, heads, kappa));
  const reading = crossValidatePrecedence(cases, profiles, heads, KAPPA_GRID, MIN_PRECEDENCE_GAIN);
  const touched = KAPPA_GRID.map((kappa) => modelAnswersTouched(cases, profiles, heads, kappa));
  console.log(`\n${formatPrecedenceReport(reading, loudness, Math.max(...touched))}`);

  table(
    ['bar', 'overridden-wrong', 'head loud', 'overridden-right', 'head loud'],
    loudness.map((one) => [
      String(one.kappa),
      String(one.overriddenWrong),
      String(one.ofWhichLoud),
      String(one.overriddenRight),
      String(one.ofWhichLoudRight),
    ]),
  );
  console.log(`\nmodel answers touched at every bar: ${touched.join(', ')}`);
}

main();
