/**
 * Answer H2's second criterion from a containment-row dump: would requiring ρ > 0 make the pass better?
 *
 * ## What it prints, and what it refuses to print
 *
 * The first block is the instrument: how many rows carry the sweep's input, and how many cases the replay
 * reproduces. The second is the two priors — fitted on one half, applied to the other — with the count of edges
 * each half could fit and the count it could not, because a gate fitted on half a corpus refuses edges the whole
 * corpus could have measured and that refusal is part of what the arm costs. The third is the three arms: the
 * fusion baseline, the shipped interface requirement, and the residual requirement.
 *
 * The shipped row is a CHECK, not a result. Its replay must reproduce the corpus's published number; a mismatch
 * means the dump is missing an input, and then the residual row beneath it describes a walk the run never took.
 * That case is `unmeasured` and exits **3**, because a number produced by an incomplete chain would be read as a
 * finding about the residual when it is a finding about the artifact.
 *
 * A measured `pass` or `fail` is a FINDING and leaves the job green: a red build is a statement that the code is
 * broken, and a refused hypothesis is not broken code.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-containment-gate.ts \
 *     --rows <containment.ndjson> --per-case <per-case.ndjson> \
 *     [--score rho|phi] [--output <json>]
 *
 * @module benchmarks/run-containment-gate
 */

import { writeFileSync } from 'node:fs';

import { formatGateReading, parseGateArgs } from './containment-gate-report.js';
import { STANDING_CRITERION, gateVerdict, readGate } from './containment-gate.js';
import { readContainmentRows } from './containment-rows.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** Exit code for "the artifact could not be walked, so nothing was measured". */
const EXIT_UNMEASURED = 3;

/**
 * Run the report.
 */
function main(): void {
  const opts = parseGateArgs(process.argv.slice(2));
  const rows = readContainmentRows(opts.rows);
  const verdicts = readPerCaseVerdicts(opts.perCase);
  const accepted = new Map<string, readonly string[]>();
  for (const verdict of verdicts) accepted.set(verdict.datapack, verdict.accepted);

  console.log('');
  console.log('═'.repeat(72));
  console.log('  H2 — the residual as the containment pass’s requirement, cross-fitted');
  console.log('═'.repeat(72));
  console.log(
    `  rows=${opts.rows} (${rows.length} cases)  per-case=${opts.perCase} (${verdicts.length} cases)`,
  );

  const reading = readGate(rows, accepted, opts.score);
  for (const line of formatGateReading(reading)) console.log(line);

  const { verdict, reason } = gateVerdict(reading);
  console.log('─'.repeat(72));
  if (verdict === 'unmeasured') {
    console.log(`  H2-gate: UNMEASURED — ${reason} (exit 3)`);
    process.exitCode = EXIT_UNMEASURED;
  } else {
    console.log(`  H2-gate: ${verdict.toUpperCase()} — ${reason}`);
  }
  console.log('═'.repeat(72));

  if (opts.output !== '') {
    writeFileSync(
      opts.output,
      JSON.stringify(
        {
          criterion: STANDING_CRITERION,
          score: opts.score,
          verdict,
          reason,
          reading,
        },
        null,
        2,
      ),
    );
    console.log(`Results written to ${opts.output}`);
  }
}

main();
