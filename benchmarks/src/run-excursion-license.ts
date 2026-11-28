/**
 * Price the excursion licence on a containment dump and the per-case verdicts that produced it.
 *
 * A reader, not a second engine: every arm is a walk of the chain the dump recorded, and the only variable is the
 * requirement — the failed-interface record, or a resolvable callee excursion where the record was silent. It
 * prints the three arms, both decision censuses and the verdict, then writes the whole reading as JSON so a later
 * iteration can be priced on the same bytes.
 *
 * `unmeasured` exits **3**: a refusal that is a finding leaves the job green, while an artifact that cannot be
 * walked means nothing on the row above it describes the run, and a green job would publish that as a measurement.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-excursion-license.ts \
 *     --rows <containment.ndjson> --per-case <per-case.ndjson> [--output <json>]
 *
 * @module benchmarks/run-excursion-license
 */

import { writeFileSync } from 'node:fs';

import { licenseVerdict, readExcursionLicense } from './containment-excursion-license-study.js';
import { STANDING_CRITERION } from './containment-gate.js';
import { readContainmentRows } from './containment-rows.js';
import { parseVetoArgs } from './containment-veto-report.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** Exit code for "the artifact could not be walked, so nothing was measured". */
const EXIT_UNMEASURED = 3;

function main(): void {
  const opts = parseVetoArgs(process.argv.slice(2));
  const rows = readContainmentRows(opts.rows);
  const verdicts = readPerCaseVerdicts(opts.perCase);

  if (verdicts.length !== rows.length) {
    console.error(
      `  excursion-license: UNMEASURED — the verdict file has ${verdicts.length} cases and the containment dump ${rows.length}; they are not the same run (exit 3)`,
    );
    process.exitCode = EXIT_UNMEASURED;
    return;
  }

  const accepted = new Map<string, readonly string[]>();
  for (const verdict of verdicts) accepted.set(verdict.datapack, verdict.accepted);

  const reading = readExcursionLicense(rows, accepted);
  console.log('');
  console.log('═'.repeat(72));
  console.log('  Excursion licence — a resolvable callee where the record was silent');
  console.log('═'.repeat(72));
  console.log(`  rows=${opts.rows}  per-case=${opts.perCase}`);
  console.log(
    `  rows=${reading.cases} replayable=${reading.replayable} scored=${reading.scored} disagreements=${reading.disagreements}`,
  );
  const a = reading.arms;
  console.log(
    `  fusion   top1=${a.fusion.top1}   shipped top1=${a.shipped.top1} +${a.shipped.gains}/-${a.shipped.losses}`,
  );
  console.log(
    `  licensed top1=${a.licensed.top1} +${a.licensed.gains}/-${a.licensed.losses} (vs fusion)`,
  );
  console.log(
    `  decisions excursion-licensed=${reading.decisions['excursion-licensed']} inverted=${reading.decisions.inverted} callee-in-band=${reading.decisions['callee-in-band']} no-failed-interface=${reading.decisions['no-failed-interface']}`,
  );
  console.log(
    `  control   excursion-licensed=${reading.control['excursion-licensed']} inverted=${reading.control.inverted} callee-in-band=${reading.control['callee-in-band']} no-failed-interface=${reading.control['no-failed-interface']}`,
  );

  const { verdict, reason } = licenseVerdict(reading, STANDING_CRITERION);
  console.log('─'.repeat(72));
  console.log(
    `  criterion: gains>=${STANDING_CRITERION.gains} losses<=${STANDING_CRITERION.losses} top1>${STANDING_CRITERION.shippedTop1}`,
  );
  console.log(`  excursion-license: ${verdict.toUpperCase()} — ${reason}`);

  if (opts.output !== undefined && opts.output !== '') {
    const output = opts.output;
    writeFileSync(output, JSON.stringify({ reading, verdict, reason }, null, 2) + '\n');
    console.log(`  reading written to ${output}`);
  }
  if (verdict === 'unmeasured') process.exitCode = EXIT_UNMEASURED;
}

main();
