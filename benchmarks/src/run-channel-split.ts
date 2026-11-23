/**
 * Price the channel split over the corpus and an artifact, and print what the swap decided.
 *
 * ## What this runner does that a dispatch does not
 *
 * It walks the corpus once and writes **every** service's channel profile, then reads the answers off an artifact
 * a dispatch already produced. Nothing here calls a model: the split is a re-reading of evidence the case carries,
 * so its price is a corpus walk rather than a second arm. That is the difference between a ¥0 answer and a ¥21 one,
 * and it is why this exists as a runner instead of as a footnote to a dispatch.
 *
 * ## What it deliberately does not do
 *
 * It does not choose a bar. `crossValidate` picks one on each fold and reads it on the other, and the number it
 * prints is the HELD-OUT one; the in-sample maximum is printed beside it so the two can be compared, because the
 * whole reason this axis was not shipped in 326 is that its in-sample maximum was reported without its neighbours.
 *
 * @module benchmarks/run-channel-split
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { FSE26Loader } from '../../packages/kinetic/src/benchmarks/index.js';
import { discoverCaseDirs } from './case-discovery.js';
import type { ChannelDeparture } from './channel-kind.js';
import { readChannelProfiles, trafficOnly } from './channel-kind.js';
import type { Profiles, SplitCase } from './channel-split.js';
import { crossValidate, KAPPA_GRID, MIN_CHANNEL_GAIN, resolvedUnder } from './channel-split.js';
import { buildTelemetry } from './query-agent.js';

/** One case's profiles, as written to the artifact. Compact because it is 70 000 services of three numbers. */
interface ProfileLine {
  readonly datapack: string;
  readonly services: Readonly<
    Record<string, readonly [number | null, number | null, number | null]>
  >;
}

/** The flags this runner accepts. */
interface Args {
  readonly artifact: string;
  readonly dataDir: string;
  readonly channelIn: string;
  readonly channelOut: string;
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
  const dataDir = map.get('data-dir') ?? '';
  const channelIn = map.get('channel-in') ?? '';
  // `--artifact` is OPTIONAL and that is a design decision rather than a convenience: the profiles are a property
  // of the CORPUS, so a dispatch that produced no answers can still write them, and a later pricing reads them at
  // zero cost. Requiring an artifact would have made the walk unrepeatable on a dispatch whose arm did not run —
  // and the first dispatch of this axis threw its profiles away for exactly that reason.
  if (artifact === '' && channelIn === '' && map.get('channel-out') === undefined) {
    throw new Error('--artifact, --channel-in or --channel-out is required');
  }
  if (dataDir === '' && channelIn === '') {
    throw new Error('--data-dir is required unless --channel-in supplies the profiles');
  }
  return { artifact, dataDir, channelIn, channelOut: map.get('channel-out') ?? '' };
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

/**
 * Walk the corpus and read every service's channel profile.
 *
 * Incremental for the reason the witness census is: 1 422 loaded cases do not fit in the default heap, and the walk
 * has been one case at a time since that was measured.
 *
 * @param dataDir - The corpus root.
 * @returns One line per case, plus the number of cases the walk could not load.
 */
function walkCorpus(dataDir: string): { lines: ProfileLine[]; skipped: number } {
  const loader = new FSE26Loader();
  const lines: ProfileLine[] = [];
  let skipped = 0;
  for (const dir of discoverCaseDirs(dataDir)) {
    let raw;
    try {
      raw = loader.loadCase(dir);
    } catch {
      skipped += 1;
      continue;
    }
    const bench = loader.toBenchmarkCase(raw);
    if (bench.callGraph.edges.length === 0) {
      skipped += 1;
      continue;
    }
    const profiles = readChannelProfiles(buildTelemetry(bench));
    const services: Record<string, readonly [number | null, number | null, number | null]> = {};
    for (const [id, one] of profiles) services[id] = [one.resource, one.traffic, one.other];
    lines.push({ datapack: dir.split('/').at(-1)!, services });
  }
  return { lines, skipped };
}

/** Turn the written lines back into the map the reader takes. */
function keyed(lines: readonly ProfileLine[]): Profiles {
  const profiles = new Map<string, ReadonlyMap<string, ChannelDeparture>>();
  for (const line of lines) {
    const services = new Map<string, ChannelDeparture>();
    for (const [id, triple] of Object.entries(line.services)) {
      services.set(id, { resource: triple[0], traffic: triple[1], other: triple[2] });
    }
    profiles.set(line.datapack, services);
  }
  return profiles;
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  let profiles: Profiles;
  if (args.channelIn !== '') {
    profiles = keyed(readNdjson<ProfileLine>(args.channelIn));
    console.log(`read ${profiles.size} case profiles from ${args.channelIn}`);
  } else {
    const walked = walkCorpus(args.dataDir);
    profiles = keyed(walked.lines);
    console.log(`walked ${walked.lines.length} cases, skipped ${walked.skipped}`);
    if (args.channelOut !== '') {
      const body = walked.lines.map((one) => JSON.stringify(one)).join('\n');
      writeFileSync(args.channelOut, `${body}\n`);
      console.log(`wrote ${args.channelOut}`);
    }
  }
  if (args.artifact === '') {
    console.log('\nprofiles written, no artifact to price: nothing to read');
    return;
  }
  const rows = readNdjson<SplitCase>(args.artifact);
  const report = crossValidate(rows, profiles);
  console.log(`\nartifact ${args.artifact}: ${rows.length} rows`);
  console.log(`folds ${report.sizes[0]} / ${report.sizes[1]}`);
  console.log(`shipped surface, per fold: ${report.mixed[0]} / ${report.mixed[1]}`);

  console.log('\nthe sweep (correct per fold, then what it changed)');
  table(
    ['kappa', 'fold 0', 'fold 1', 'repairs', 'breaks'],
    report.sweep.map((one) => [
      String(one.kappa),
      String(one.correct[0]),
      String(one.correct[1]),
      String(one.repairs),
      String(one.breaks),
    ]),
  );

  const total = report.mixed[0] + report.mixed[1];
  const inSample = Math.max(...report.sweep.map((one) => one.correct[0] + one.correct[1]));
  console.log(`\nselected on fold 0: ${report.selected[0]}, on fold 1: ${report.selected[1]}`);
  console.log(
    `held out: ${report.heldOut[0]} / ${report.heldOut[1]} (delta ${report.deltas[0]} / ${report.deltas[1]})`,
  );
  console.log(
    `mean held-out ${((report.heldOut[0] + report.heldOut[1]) / 2).toFixed(1)} against ${total}`,
  );
  console.log(`in-sample maximum ${inSample} — reported for comparison, never for the claim`);
  console.log(
    `verdict: ${report.passes ? 'PASSES' : 'REFUSED'} (needs >= ${MIN_CHANNEL_GAIN} on both folds, bars within one step)`,
  );

  // What the winning bar would do per family, so a reader can see WHERE it pays rather than only how much.
  const winner = report.selected[0];
  const byFamily = new Map<
    string,
    { cases: number; fires: number; repairs: number; breaks: number }
  >();
  for (const one of rows) {
    const bucket = byFamily.get(one.faultType) ?? { cases: 0, fires: 0, repairs: 0, breaks: 0 };
    bucket.cases += 1;
    const before = resolvedUnder(one, profiles, null);
    const after = resolvedUnder(one, profiles, winner);
    const hitBefore = before !== null && one.truth.includes(before);
    const hitAfter = after !== null && one.truth.includes(after);
    if (after !== before) bucket.fires += 1;
    if (hitAfter && !hitBefore) bucket.repairs += 1;
    if (!hitAfter && hitBefore) bucket.breaks += 1;
    byFamily.set(one.faultType, bucket);
  }
  const firing = [...byFamily]
    .filter(([, bucket]) => bucket.fires > 0)
    .sort((a, b) => b[1].fires - a[1].fires);
  console.log(`\nwhere the bar of ${winner} fires`);
  table(
    ['fault', 'cases', 'fires', 'repairs', 'breaks'],
    firing.map(([fault, bucket]) => [
      fault,
      String(bucket.cases),
      String(bucket.fires),
      String(bucket.repairs),
      String(bucket.breaks),
    ]),
  );
  console.log(`grid swept: ${KAPPA_GRID.join(', ')}`);

  // A bar that fires on nothing has to be EXPLAINED rather than reported as a zero, and the explanation is either a
  // broken join or a refuted premise. Both are printed, because the two produce the same table.
  const noCase = rows.filter((one) => !profiles.has(one.datapack)).length;
  const noService = rows.filter((one) => {
    const services = profiles.get(one.datapack);
    return one.answer !== null && services !== undefined && !services.has(one.answer);
  }).length;
  console.log(
    `\nprofile join: ${noCase} rows with no case profile, ${noService} rows whose answer the case does not carry`,
  );

  /** The gate conditions the rule would be evaluated under, minus the bar. */
  const gated = (one: SplitCase): boolean =>
    one.entry !== null &&
    one.answer !== null &&
    one.answer !== one.entry &&
    one.belowFails === false &&
    (one.entryChildErrors ?? 1) <= 0 &&
    one.novelCaller === null &&
    (one.answerSurprise ?? 0) > 300;

  const quantile = (values: readonly number[], q: number): string => {
    if (values.length === 0) return '-';
    const sorted = [...values].sort((a, b) => a - b);
    const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
    return sorted[at]!.toFixed(0);
  };

  const describe = (label: string, keep: (one: SplitCase, hit: boolean) => boolean): void => {
    const population = rows.filter((one) => {
      const base = resolvedUnder(one, profiles, null);
      return keep(one, base !== null && one.truth.includes(base));
    });
    const resource: number[] = [];
    const traffic: number[] = [];
    let quiet = 0;
    for (const one of population) {
      const departure =
        one.answer === null ? undefined : profiles.get(one.datapack)?.get(one.answer);
      if (departure === undefined) continue;
      if (departure.resource !== null) resource.push(departure.resource);
      if (departure.traffic !== null) traffic.push(departure.traffic);
      if (trafficOnly(departure, KAPPA_GRID.at(-1)!)) quiet += 1;
    }
    console.log(
      `${label}: ${population.length} cases, resource p50 ${quantile(resource, 0.5)} / p90 ${quantile(
        resource,
        0.9,
      )}, traffic p50 ${quantile(traffic, 0.5)} / p90 ${quantile(traffic, 0.9)}, traffic-only at ${KAPPA_GRID.at(
        -1,
      )!}: ${quiet}`,
    );
  };
  console.log(
    '\nis the premise true? the answer’s resource side, over the two populations the bar would decide',
  );
  describe('reachable (answer wrong, gate satisfied)', (one, hit) => !hit && gated(one));
  describe('at risk   (answer right, gate satisfied)', (one, hit) => hit && gated(one));
}

main();
