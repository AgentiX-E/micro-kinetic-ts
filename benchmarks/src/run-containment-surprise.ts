/**
 * Answer H7 from a containment dump and a per-case verdict file: is the pass's ceiling the channel it reads?
 *
 * The arm is one swap inside a walk this repository already performs — `replayCase` with the surprise map in place
 * of the excursion map — so this file is a reader, not a second engine. It prints the instrument, the three arms,
 * the two censuses and the verdict, and it writes the whole reading as JSON so that a later arm can be priced on
 * the same bytes.
 *
 * `unmeasured` exits **3**: a refusal that is a finding (the arm loses cases) leaves the job green, while an
 * artifact that cannot be walked means nothing on the row above it describes the run, and a green job would
 * publish that as a measurement.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-containment-surprise.ts \
 *     --rows <containment.ndjson> --per-case <per-case.ndjson> [--output <json>]
 *
 * @module benchmarks/run-containment-surprise
 */

import { writeFileSync } from 'node:fs';

import { STANDING_CRITERION } from './containment-gate.js';
import { readContainmentRows } from './containment-rows.js';
import {
  formatSurpriseReading,
  formatSurpriseVerdict,
  parseSurpriseArgs,
} from './containment-surprise-report.js';
import { readSurprise, surpriseVerdict } from './containment-surprise-study.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** Exit code for "the artifact could not be walked, so nothing was measured". */
const EXIT_UNMEASURED = 3;

/**
 * Run the report.
 */
function main(): void {
  const opts = parseSurpriseArgs(process.argv.slice(2));
  const rows = readContainmentRows(opts.rows);
  const verdicts = readPerCaseVerdicts(opts.perCase);

  if (verdicts.length !== rows.length) {
    console.error(
      `  H7-surprise: UNMEASURED — the verdict file has ${verdicts.length} cases and the containment dump ${rows.length}; they are not the same run (exit 3)`,
    );
    process.exitCode = EXIT_UNMEASURED;
    return;
  }

  const accepted = new Map<string, readonly string[]>();
  for (const verdict of verdicts) accepted.set(verdict.datapack, verdict.accepted);

  console.log('');
  console.log('═'.repeat(72));
  console.log('  H7 — the containment pass reading every channel instead of one family');
  console.log('═'.repeat(72));
  console.log(`  rows=${opts.rows}  per-case=${opts.perCase}`);

  const reading = readSurprise(rows, accepted);
  for (const line of formatSurpriseReading(reading, STANDING_CRITERION)) console.log(line);

  const { verdict, reason } = surpriseVerdict(reading, STANDING_CRITERION);
  console.log('─'.repeat(72));
  if (verdict === 'unmeasured') {
    console.log(`${formatSurpriseVerdict(verdict, reason)} (exit 3)`);
    process.exitCode = EXIT_UNMEASURED;
  } else {
    console.log(formatSurpriseVerdict(verdict, reason));
  }
  console.log('═'.repeat(72));

  if (opts.output !== undefined) {
    writeFileSync(
      opts.output,
      JSON.stringify({ criterion: STANDING_CRITERION, verdict, reason, reading }, null, 2),
    );
  }
}

main();
