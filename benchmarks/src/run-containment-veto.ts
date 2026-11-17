/**
 * Answer H8 from a containment dump and a per-case verdict file: is the interface record a licence or a veto?
 *
 * The arm is one word inside a walk this repository already performs — `replayCase` with `recordScope: 'case'` — so
 * this file is a reader, not a second engine. It prints the instrument, the two priors, the three arms, the census
 * and the family's ceiling, and it writes the whole reading as JSON so that a later arm can be priced on the same
 * bytes.
 *
 * `unmeasured` exits **3**: a refusal that is a finding (the arm loses cases) leaves the job green, while an
 * artifact that cannot be walked means nothing on the row above it describes the run, and a green job would
 * publish that as a measurement.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-containment-veto.ts \
 *     --rows <containment.ndjson> --per-case <per-case.ndjson> [--output <json>]
 *
 * @module benchmarks/run-containment-veto
 */

import { writeFileSync } from 'node:fs';

import { STANDING_CRITERION } from './containment-gate.js';
import { readContainmentRows } from './containment-rows.js';
import { formatVetoReading, formatVetoVerdict, parseVetoArgs } from './containment-veto-report.js';
import { readVeto, vetoVerdict } from './containment-veto-study.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** Exit code for "the artifact could not be walked, so nothing was measured". */
const EXIT_UNMEASURED = 3;

/**
 * Run the report.
 */
function main(): void {
  const opts = parseVetoArgs(process.argv.slice(2));
  const rows = readContainmentRows(opts.rows);
  const verdicts = readPerCaseVerdicts(opts.perCase);

  if (verdicts.length !== rows.length) {
    console.error(
      `  H8-veto: UNMEASURED — the verdict file has ${verdicts.length} cases and the containment dump ${rows.length}; they are not the same run (exit 3)`,
    );
    process.exitCode = EXIT_UNMEASURED;
    return;
  }

  const accepted = new Map<string, readonly string[]>();
  for (const verdict of verdicts) accepted.set(verdict.datapack, verdict.accepted);

  console.log('');
  console.log('═'.repeat(72));
  console.log('  H8 — the interface record kept as a veto and dropped as a licence');
  console.log('═'.repeat(72));
  console.log(`  rows=${opts.rows}  per-case=${opts.perCase}`);

  const reading = readVeto(rows, accepted);
  for (const line of formatVetoReading(reading, STANDING_CRITERION)) console.log(line);

  const { verdict, reason } = vetoVerdict(reading, STANDING_CRITERION);
  console.log('─'.repeat(72));
  if (verdict === 'unmeasured') {
    console.log(`${formatVetoVerdict(verdict, reason)} (exit 3)`);
    process.exitCode = EXIT_UNMEASURED;
  } else {
    console.log(formatVetoVerdict(verdict, reason));
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
