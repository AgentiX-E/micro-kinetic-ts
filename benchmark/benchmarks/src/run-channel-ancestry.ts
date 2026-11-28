/**
 * Price the ancestry bound over a corpus walk's profiles, a call graph, and an artifact's answers.
 *
 * ## What this runner is for, and why it is not a dispatch
 *
 * The bound it prices is a statement about a GRAPH: the source lies on the path from the entry to the deepest rising
 * service. Every input it needs already exists — the 5-slot profile file the census walk wrote (¥0), the call graph
 * the containment artifact already carries, and the answers a dispatch already published — so the whole pricing is a
 * re-reading and costs no model call. That is the difference between a ¥0 answer and a ¥21 one, and it is why the
 * axis is priced here rather than by buying a second arm.
 *
 * ## The report it prints, in the order the questions have to be asked
 *
 * 1. **What is the baseline?** The artifact's own surface, to two decimals, with its digest — because 329 spent a day
 *    on a two-case difference that was only ever two dispatches, and a delta from a file nobody can identify is not a
 *    delta.
 * 2. **Does the relation hold?** A population table across the whole bar grid: how many cases carry a rung, how many
 *    of those the answer gets right and wrong, how often the rule fires on each side, and how often the rung IS the
 *    truth where the answer is wrong. Predictions P1–P3 are read off this table and nowhere else.
 * 3. **Does it pay?** The held-out reading, selected on one fold and read on the other, with the verdict 328, 329 and
 *    this iteration share.
 * 4. **Is the relation the reason?** The randomised control on the same firing population, which is the only way a
 *    rule about a graph can be shown to need the graph.
 *
 * @module benchmarks/run-channel-ancestry
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { CallGraph } from './channel-ancestry.js';
import {
  MIN_ANCESTRY_GAIN,
  crossValidateAncestry,
  renamedUnder,
  rungOf,
} from './channel-ancestry.js';
import { departureFromSlots, type ChannelDeparture } from './channel-kind.js';
import type { ArmRow, Profiles, SplitCase } from './channel-split.js';
import {
  KAPPA_GRID,
  foldAssignments,
  gateHolds,
  resolvedUnder,
  surfaceReading,
  toSplitCase,
} from './channel-split.js';

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

/** One case's call graph, as the containment artifact already carries it. */
interface ContainmentLine {
  readonly datapack: string;
  readonly chain: { readonly edges: readonly (readonly [string, string])[] };
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

/** One row of the population table: what the bound sees, split by whether the answer is right. */
interface PopulationRow {
  readonly kappa: number;
  /** Cases carrying a rung at all, i.e. the population the rule may speak about. */
  readonly withRung: number;
  readonly wrong: number;
  readonly right: number;
  /** Cases the rule contradicts, on each side. */
  readonly firesWrong: number;
  readonly firesRight: number;
  /** Cases where the rung IS the truth, on the side the answer gets wrong: prediction P1. */
  readonly rungIsTruth: number;
}

/**
 * Count what the bound sees at one bar, split by side, without reading a truth to decide whether to speak.
 *
 * The split by side is a DIAGNOSTIC and not part of the rule: it is how the pre-registered asymmetry is read. The
 * rule itself never consults it — `renamedUnder` receives the case and the graph and nothing else.
 */
function populationUnder(
  rows: readonly SplitCase[],
  profiles: Profiles,
  graphs: ReadonlyMap<string, CallGraph>,
  kappa: number,
): PopulationRow {
  let withRung = 0;
  let wrong = 0;
  let right = 0;
  let firesWrong = 0;
  let firesRight = 0;
  let rungIsTruth = 0;
  for (const one of rows) {
    const graph = graphs.get(one.datapack);
    if (graph === undefined) continue;
    if (!gateHolds(one)) continue;
    const reading = rungOf(one, profiles, graph, kappa);
    if (reading === null) continue;
    withRung += 1;
    const settled = resolvedUnder(one, profiles, null);
    const hit = settled !== null && one.truth.includes(settled);
    const fires = renamedUnder(one, profiles, graph, kappa) !== null;
    if (hit) {
      right += 1;
      if (fires) firesRight += 1;
    } else {
      wrong += 1;
      if (fires) firesWrong += 1;
      if (one.truth.includes(reading.rung)) rungIsTruth += 1;
    }
  }
  return { kappa, withRung, wrong, right, firesWrong, firesRight, rungIsTruth };
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const lines = readNdjson<ProfileLine>(args.channelIn);
  const profiles = keyed(lines);
  const graphs = new Map<string, CallGraph>(
    readNdjson<ContainmentLine>(args.containment).map((one) => [
      one.datapack,
      { edges: one.chain.edges },
    ]),
  );
  const rows = readNdjson<ArmRow>(args.artifact).map(toSplitCase);
  const digest = createHash('sha256')
    .update(readFileSync(args.artifact))
    .digest('hex')
    .slice(0, 16);
  const surface = surfaceReading(rows);
  console.log(`read ${profiles.size} profiles, ${graphs.size} call graphs, ${rows.length} answers`);
  console.log(
    `\nartifact ${args.artifact}: ${surface.rows} rows, sha256 ${digest}\n` +
      `the artifact's own answers: ${surface.correct} (${surface.share} %)`,
  );

  // ── The baseline, named and re-read ────────────────────────────────────────────────────────────────────────────
  const folds = foldAssignments(rows);
  const settled = rows.map((one) => resolvedUnder(one, profiles, null));
  const base = rows.map(
    (one, index) => settled[index] !== null && one.truth.includes(settled[index]!),
  );
  const mixed: [number, number] = [0, 0];
  let moved = 0;
  rows.forEach((one, index) => {
    if (base[index]!) mixed[folds[index]!] += 1;
    if (settled[index] !== one.answer) moved += 1;
  });
  console.log(
    `shipped surface, per fold: ${mixed[0]} / ${mixed[1]} = ${mixed[0] + mixed[1]}\n` +
      `re-reading through the shipped resolvers moves ${moved} of ${rows.length} answers` +
      (moved === 0
        ? ' — the baseline column IS the file'
        : ' — WARNING: the baseline is not the file'),
  );

  // ── The relation, across the whole grid, before any bar is chosen ────────────────────────────────────────────
  console.log(
    '\nthe population the bound sees (diagnostic: split by side, never read by the rule)',
  );
  const population = KAPPA_GRID.map((kappa) => populationUnder(rows, profiles, graphs, kappa));
  table(
    ['kappa', 'with rung', 'wrong', 'right', 'fires/wrong', 'fires/right', 'rung=truth (wrong)'],
    population.map((one) => [
      String(one.kappa),
      String(one.withRung),
      String(one.wrong),
      String(one.right),
      String(one.firesWrong),
      String(one.firesRight),
      String(one.rungIsTruth),
    ]),
  );

  // ── The price: the rule, then the control on the same firing population ──────────────────────────────────────
  const rule = crossValidateAncestry(
    rows,
    profiles,
    graphs,
    KAPPA_GRID,
    MIN_ANCESTRY_GAIN,
    'deepest',
  );
  const control = crossValidateAncestry(
    rows,
    profiles,
    graphs,
    KAPPA_GRID,
    MIN_ANCESTRY_GAIN,
    'shuffled',
  );
  // The same rule on every case, whether or not the pipeline would consult a prior: the relation's REACH. Printed
  // because it is the number that says the relation is not a whole-corpus statement, and a report that omitted it
  // would be quoting the friendlier of two readings.
  const reach = crossValidateAncestry(
    rows,
    profiles,
    graphs,
    KAPPA_GRID,
    MIN_ANCESTRY_GAIN,
    'deepest',
    'all',
  );
  console.log(`\nfolds ${rule.sizes[0]} / ${rule.sizes[1]}`);
  console.log('\nthe rule (correct per fold, then what it changed)');
  table(
    ['kappa', 'fold 0', 'fold 1', 'fires', 'repairs', 'breaks'],
    rule.sweep.map((one) => [
      String(one.kappa),
      String(one.correct[0]),
      String(one.correct[1]),
      String(one.fires),
      String(one.repairs),
      String(one.breaks),
    ]),
  );
  console.log(
    `chosen on fold 0: ${rule.selected[0]}, on fold 1: ${rule.selected[1]}\n` +
      `held out: ${rule.heldOut[0]} / ${rule.heldOut[1]} (delta ${rule.deltas[0]} / ${rule.deltas[1]})\n` +
      `verdict: ${rule.passes ? 'PASSES' : `REFUSED (needs >= ${MIN_ANCESTRY_GAIN} on both folds)`}`,
  );
  console.log('\nthe randomised control (same fires, a pseudo-random member of the rising set)');
  table(
    ['kappa', 'fold 0', 'fold 1', 'fires', 'repairs', 'breaks'],
    control.sweep.map((one) => [
      String(one.kappa),
      String(one.correct[0]),
      String(one.correct[1]),
      String(one.fires),
      String(one.repairs),
      String(one.breaks),
    ]),
  );
  console.log(
    `held out: ${control.heldOut[0]} / ${control.heldOut[1]} (delta ${control.deltas[0]} / ${control.deltas[1]}) — ` +
      `the relation is worth ${rule.deltas[0] + rule.deltas[1] - (control.deltas[0] + control.deltas[1])} cases over the control`,
  );

  console.log(
    `\nreach, on every case regardless of the premise, at kappa ${rule.selected[0]}: ` +
      `${reach.sweep.find((one) => one.kappa === rule.selected[0])!.fires} fires, ` +
      `${reach.sweep.find((one) => one.kappa === rule.selected[0])!.repairs} repairs, ` +
      `${reach.sweep.find((one) => one.kappa === rule.selected[0])!.breaks} breaks ` +
      `(delta ${reach.deltas[0]} / ${reach.deltas[1]})`,
  );

  // ── Where the fires land, by family, at the bar the rule was priced at ───────────────────────────────────────
  const priced = rule.selected[0];
  const byFamily = new Map<
    string,
    { cases: number; fires: number; repairs: number; breaks: number }
  >();
  rows.forEach((one, index) => {
    const graph = graphs.get(one.datapack);
    if (graph === undefined) return;
    const row = byFamily.get(one.faultType) ?? { cases: 0, fires: 0, repairs: 0, breaks: 0 };
    row.cases += 1;
    const renamed = renamedUnder(one, profiles, graph, priced);
    if (renamed !== null) {
      row.fires += 1;
      const hit = one.truth.includes(renamed);
      if (hit && !base[index]!) row.repairs += 1;
      if (!hit && base[index]!) row.breaks += 1;
    }
    byFamily.set(one.faultType, row);
  });
  console.log(`\nwhere the fires land, at kappa ${priced}`);
  table(
    ['family', 'cases', 'fires', 'repairs', 'breaks'],
    [...byFamily.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([family, one]) => [
        family,
        String(one.cases),
        String(one.fires),
        String(one.repairs),
        String(one.breaks),
      ]),
  );
}

main();
