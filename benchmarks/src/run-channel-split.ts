/**
 * Price the channel split over the corpus and an artifact, and print what the swap decided.
 *
 * ## What this runner does that a dispatch does not
 *
 * It walks the corpus once and writes **every** service's channel profile plus a **label census**, then reads the
 * answers off an artifact a dispatch already produced. Nothing here calls a model: the split is a re-reading of
 * evidence the case carries, so its price is a corpus walk rather than a second arm. That is the difference between
 * a ¥0 answer and a ¥21 one, and it is why this exists as a runner instead of as a footnote to a dispatch.
 *
 * ## The two questions it prints, in the order they have to be asked
 *
 * 1. **Does the column exist?** The label census counts the families the corpus writes and reports the status-shaped
 *    ones. Iteration 329's axis needs a status column, and a corpus that publishes none makes the axis unavailable
 *    rather than refuted — a distinction the census states in words rather than as a zero.
 * 2. **Is it separable?** Before a bar is swept, `separationOf` asks whether the conditioning holds on the population
 *    the rule repairs at a rate it does not hold on the population it breaks. 328's axis died of a shared evidence
 *    region, and this is the check that would have said so in one table instead of six identical rows.
 *
 * ## What it deliberately does not do
 *
 * It does not choose a bar. `crossValidate` and `crossValidateConditioned` pick one on each fold and read it on the
 * other, and the number printed as the reading is the HELD-OUT one; the in-sample maximum is printed beside it so the
 * two can be compared, because the whole reason this axis was not shipped in 326 is that its in-sample maximum was
 * reported without its neighbours.
 *
 * @module benchmarks/run-channel-split
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { FSE26Loader } from '../../packages/kinetic/src/benchmarks/index.js';
import { discoverCaseDirs } from './case-discovery.js';
import type { ChannelDeparture } from './channel-kind.js';
import { readChannelProfiles } from './channel-kind.js';
import type { CensusRow } from './channel-label-census.js';
import { censusRows, countLabels, renderCensus } from './channel-label-census.js';
import type { ArmRow, Profiles } from './channel-split.js';
import {
  KAPPA_GRID,
  MIN_CHANNEL_GAIN,
  MIN_SEPARATION_PRECISION,
  SYMPTOM_GRID,
  crossValidate,
  crossValidateConditioned,
  gateHolds,
  resolvedUnder,
  separationOf,
  toSplitCase,
} from './channel-split.js';
import { buildTelemetry } from './query-agent.js';

/**
 * One case's profiles, as written to the artifact.
 *
 * Five numbers per service, in this order: resource, traffic, other (all standardised surprises, or `null`), then
 * the two symptom columns — the standardised surprise and the ABSOLUTE rise, which is the one a rate is read on. The
 * schema is versioned by ARITY rather than by a field, and the reader refuses any other length by name: a cache that
 * silently filled a missing symptom with `null` would make an absent column look like a measured quiet, which is the
 * one defect this file's reader exists to prevent.
 */
interface ProfileLine {
  readonly datapack: string;
  readonly services: Readonly<Record<string, Slots>>;
}

/** The five slots one service's profile is written in, in the order the reader expects them. */
type Slots = readonly [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

/** The flags this runner accepts. */
interface Args {
  readonly artifact: string;
  readonly dataDir: string;
  readonly channelIn: string;
  readonly channelOut: string;
  readonly labelOut: string;
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
  if (
    artifact === '' &&
    channelIn === '' &&
    map.get('channel-out') === undefined &&
    map.get('label-out') === undefined
  ) {
    throw new Error('--artifact, --channel-in, --channel-out or --label-out is required');
  }
  if (dataDir === '' && channelIn === '') {
    throw new Error('--data-dir is required unless --channel-in supplies the profiles');
  }
  return {
    artifact,
    dataDir,
    channelIn,
    channelOut: map.get('channel-out') ?? '',
    labelOut: map.get('label-out') ?? '',
  };
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
 * Turn the walk into lines, accumulating the label census as it goes.
 *
 * Incremental for the reason the witness census is: 1 422 loaded cases do not fit in the default heap, and the walk
 * has been one case at a time since that was measured.
 *
 * @param dataDir - The corpus root.
 * @returns One line per case, the label counts, and the number of cases the walk could not load.
 */
function walkCorpus(dataDir: string): {
  lines: ProfileLine[];
  labels: Map<string, number>;
  skipped: number;
} {
  const loader = new FSE26Loader();
  const lines: ProfileLine[] = [];
  const labels = new Map<string, number>();
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
    for (const [, series] of bench.metrics) countLabels(labels, series);
    const profiles = readChannelProfiles(buildTelemetry(bench));
    const services: Record<string, Slots> = {};
    for (const [id, one] of profiles) {
      services[id] = [one.resource, one.traffic, one.other, one.symptom, one.symptomRise];
    }
    lines.push({ datapack: dir.split('/').at(-1)!, services });
  }
  return { lines, labels, skipped };
}

/**
 * Turn one written line back into a profile.
 *
 * @param datapack - The case the line describes, for the refusal's message.
 * @param slots - The five numbers, or the shorter shape an older walk wrote.
 * @returns The profile.
 * @throws When the line carries a schema this reader does not know, rather than reading a missing column as a null.
 */
function profileOf(datapack: string, slots: readonly (number | null)[]): ChannelDeparture {
  if (slots.length !== 5) {
    throw new Error(
      `${datapack}: the profile carries ${slots.length} slots and this reader knows 5 — the file predates the symptom column, re-walk it (the walk costs no model call)`,
    );
  }
  return {
    resource: slots[0]!,
    traffic: slots[1]!,
    other: slots[2]!,
    symptom: slots[3]!,
    symptomRise: slots[4]!,
  };
}

/** Turn the written lines back into the map the reader takes. */
function keyed(lines: readonly ProfileLine[]): Profiles {
  const profiles = new Map<string, ReadonlyMap<string, ChannelDeparture>>();
  for (const line of lines) {
    const services = new Map<string, ChannelDeparture>();
    for (const [id, slots] of Object.entries(line.services)) {
      services.set(id, profileOf(line.datapack, slots));
    }
    profiles.set(line.datapack, services);
  }
  return profiles;
}

/** A quantile of a list, or `-` when the list is empty. */
function quantile(values: readonly number[], q: number, digits = 0): string {
  if (values.length === 0) return '-';
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at]!.toFixed(digits);
}

/** Entry point. */
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  let profiles: Profiles;
  let census: readonly CensusRow[] | null = null;
  if (args.channelIn !== '') {
    profiles = keyed(readNdjson<ProfileLine>(args.channelIn));
    console.log(`read ${profiles.size} case profiles from ${args.channelIn}`);
  } else {
    const walked = walkCorpus(args.dataDir);
    profiles = keyed(walked.lines);
    census = censusRows(walked.labels);
    console.log(`walked ${walked.lines.length} cases, skipped ${walked.skipped}`);
    if (args.channelOut !== '') {
      const body = walked.lines.map((one) => JSON.stringify(one)).join('\n');
      writeFileSync(args.channelOut, `${body}\n`);
      console.log(`wrote ${args.channelOut}`);
    }
    if (args.labelOut !== '') {
      writeFileSync(args.labelOut, `${JSON.stringify(census, null, 1)}\n`);
      console.log(`wrote ${args.labelOut}`);
    }
  }
  // The census is printed in the same log as the pricing, so one artifact answers both questions this runner asks.
  if (census !== null) {
    console.log('');
    process.stdout.write(renderCensus(census));
  }
  if (args.artifact === '') {
    console.log('\nprofiles written, no artifact to price: nothing to read');
    return;
  }
  // Read through the mapping rather than by shape: the artifact records the surprise per SIDE, and a reader that
  // asserted the settled column's name would see `undefined` in every row (see `toSplitCase`).
  const rows = readNdjson<ArmRow>(args.artifact).map(toSplitCase);
  console.log(`\nartifact ${args.artifact}: ${rows.length} rows`);

  // ── 328's reading, reprinted so the conditioned one has a comparison in the same log ─────────────────────────
  const pooled = crossValidate(rows, profiles);
  console.log(`folds ${pooled.sizes[0]} / ${pooled.sizes[1]}`);
  console.log(`shipped surface, per fold: ${pooled.mixed[0]} / ${pooled.mixed[1]}`);
  console.log('\nthe pooled sweep (correct per fold, then what it changed)');
  table(
    ['kappa', 'fold 0', 'fold 1', 'repairs', 'breaks'],
    pooled.sweep.map((one) => [
      String(one.kappa),
      String(one.correct[0]),
      String(one.correct[1]),
      String(one.repairs),
      String(one.breaks),
    ]),
  );
  console.log(
    `pooled held out: ${pooled.heldOut[0]} / ${pooled.heldOut[1]} (delta ${pooled.deltas[0]} / ${pooled.deltas[1]}) — ${
      pooled.passes ? 'PASSES' : 'REFUSED'
    }`,
  );

  // ── The two questions 329 asks, in the order they have to be asked ─────────────────────────────────────────
  const separation = separationOf(rows, profiles, KAPPA_GRID.at(-1)!);
  console.log(
    `\nseparation at kappa ${separation.kappa}: ${separation.reachableTotal} reachable (answer wrong, rule addresses it), ${separation.atRiskTotal} at risk (answer right)`,
  );
  table(
    ['floor', 'reachable', 'at risk', 'precision'],
    separation.readings.map((one) => [
      String(one.floor),
      String(one.reachable),
      String(one.atRisk),
      one.precision === null ? '-' : one.precision.toFixed(3),
    ]),
  );
  console.log(
    `best ${
      separation.best === null
        ? '-'
        : `${separation.best.floor} at precision ${separation.best.precision!.toFixed(3)}`
    }; separable: ${separation.separable ? 'YES' : 'NO'} (needs >= ${MIN_SEPARATION_PRECISION})`,
  );

  const conditioned = crossValidateConditioned(rows, profiles);
  console.log('\nthe conditioned sweep (correct per fold, then what it changed)');
  table(
    ['kappa', 'floor', 'fold 0', 'fold 1', 'repairs', 'breaks'],
    conditioned.cells.map((one) => [
      String(one.kappa),
      String(one.floor),
      String(one.correct[0]),
      String(one.correct[1]),
      String(one.repairs),
      String(one.breaks),
    ]),
  );
  const chosen = conditioned.selected[0];
  const inSample = Math.max(...conditioned.cells.map((one) => one.correct[0] + one.correct[1]));
  console.log(
    `\nselected on fold 0: ${chosen.kappa}/${chosen.floor}, on fold 1: ${conditioned.selected[1].kappa}/${conditioned.selected[1].floor}`,
  );
  console.log(
    `held out: ${conditioned.heldOut[0]} / ${conditioned.heldOut[1]} (delta ${conditioned.deltas[0]} / ${conditioned.deltas[1]})`,
  );
  console.log(
    `mean held-out ${((conditioned.heldOut[0] + conditioned.heldOut[1]) / 2).toFixed(1)} against ${
      pooled.mixed[0] + pooled.mixed[1]
    }`,
  );
  console.log(`in-sample maximum ${inSample} — reported for comparison, never for the claim`);
  console.log(
    `verdict: ${conditioned.passes ? 'PASSES' : 'REFUSED'} (needs >= ${MIN_CHANNEL_GAIN} on both folds, cells within one step in BOTH coordinates)`,
  );

  // Where the chosen cell fires per family, so a reader can see WHERE it pays rather than only how much — plus the
  // conditioning column's own distribution, because a column that is absent on most of the population cannot cut it.
  const byFamily = new Map<
    string,
    { cases: number; fires: number; repairs: number; breaks: number; rises: number[]; unmeasured: number }
  >();
  for (const one of rows) {
    const bucket = byFamily.get(one.faultType) ?? {
      cases: 0,
      fires: 0,
      repairs: 0,
      breaks: 0,
      rises: [],
      unmeasured: 0,
    };
    bucket.cases += 1;
    const before = resolvedUnder(one, profiles, null);
    const after = resolvedUnder(one, profiles, chosen.kappa, chosen.floor);
    const hitBefore = before !== null && one.truth.includes(before);
    const hitAfter = after !== null && one.truth.includes(after);
    if (after !== before) bucket.fires += 1;
    if (hitAfter && !hitBefore) bucket.repairs += 1;
    if (!hitAfter && hitBefore) bucket.breaks += 1;
    if (gateHolds(one)) {
      const rise =
        one.answer === null
          ? null
          : (profiles.get(one.datapack)?.get(one.answer)?.symptomRise ?? null);
      if (rise === null) bucket.unmeasured += 1;
      else bucket.rises.push(rise);
    }
    byFamily.set(one.faultType, bucket);
  }
  console.log(`\nwhere the cell of ${chosen.kappa}/${chosen.floor} fires`);
  table(
    ['fault', 'cases', 'fires', 'repairs', 'breaks'],
    [...byFamily]
      .filter(([, bucket]) => bucket.fires > 0)
      .sort((a, b) => b[1].fires - a[1].fires)
      .map(([fault, bucket]) => [
        fault,
        String(bucket.cases),
        String(bucket.fires),
        String(bucket.repairs),
        String(bucket.breaks),
      ]),
  );

  // `unmeasured` is the count of addressed answers whose error-rate family the case does not carry: it is the number
  // that decides whether the column can cut at all, and it is printed beside the quantiles rather than instead.
  console.log('\nthe answer’s error-rate rise, per family, over the population the rule addresses');
  table(
    ['fault', 'addressed', 'unmeasured', 'p10', 'p50', 'p90'],
    [...byFamily]
      .filter(([, bucket]) => bucket.rises.length + bucket.unmeasured > 0)
      .sort(
        (a, b) => b[1].rises.length + b[1].unmeasured - (a[1].rises.length + a[1].unmeasured),
      )
      .map(([fault, bucket]) => [
        fault,
        String(bucket.rises.length + bucket.unmeasured),
        String(bucket.unmeasured),
        quantile(bucket.rises, 0.1, 3),
        quantile(bucket.rises, 0.5, 3),
        quantile(bucket.rises, 0.9, 3),
      ]),
  );
  console.log(`grids swept: kappa ${KAPPA_GRID.join(', ')}; floor ${SYMPTOM_GRID.join(', ')}`);

  // A reading that fires on nothing has to be EXPLAINED rather than reported as a zero, and the explanation is either
  // a broken join or a refuted premise. Both are printed, because the two produce the same table.
  const noCase = rows.filter((one) => !profiles.has(one.datapack)).length;
  const noService = rows.filter((one) => {
    const services = profiles.get(one.datapack);
    return one.answer !== null && services !== undefined && !services.has(one.answer);
  }).length;
  const unmeasuredAnswers = rows.filter((one) => {
    if (!gateHolds(one) || one.answer === null) return false;
    return (profiles.get(one.datapack)?.get(one.answer)?.symptomRise ?? null) === null;
  }).length;
  console.log(
    `\nprofile join: ${noCase} rows with no case profile, ${noService} rows whose answer the case does not carry, ` +
      `${unmeasuredAnswers} addressed answers with no measured error rate`,
  );
}

main();
