/**
 * Answer H6 from a containment dump and a depth dump: does the residual pay better as a TERM than as a gate?
 *
 * ## What it prints
 *
 * The instrument first (`replayable`, `disagreements`, `unordered`), then the population census, then the two φ
 * fits, then the transfers' census, then the four arms — and then the λ sweep, because the pre-registration commits
 * to the curve rather than to a point.
 *
 * The `shipped` row is a CHECK and not a result, on the same principle as the gate's report: if its replay does not
 * reproduce the corpus's published 1 156, the dump is missing an input and the graded row beneath it describes a
 * case set the run never walked. That is `unmeasured` and exits **3**; a measured pass or fail is a finding and
 * leaves the job green, because a refused hypothesis is not broken code.
 *
 * ## Why the depth dump is an input
 *
 * A term is a quantity in the score, so the arm needs the score the fusion gave each candidate, and the containment
 * dump does not carry it — the depth dump does, for the same run and from the same corpus walk. Joining them on
 * `datapack` is therefore a join inside one artifact, not across two experiments; the two files' case counts are
 * compared here and a mismatch is an error rather than a smaller population.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-containment-term.ts \
 *     --rows <containment.ndjson> --depth <depth.ndjson> --per-case <per-case.ndjson> \
 *     [--lambdas 0.25,0.5,1,2,4] [--output <json>]
 *
 * @module benchmarks/run-containment-term
 */

import { writeFileSync } from 'node:fs';

import { STANDING_CRITERION } from './containment-gate.js';
import { readContainmentRows } from './containment-rows.js';
import { formatTermReading, formatTermSweep, parseTermArgs } from './containment-term-report.js';
import { sweepTerm, termVerdict, type ScoreTable } from './containment-term-study.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';
import { readDepthDump } from './ranking-depth.js';

/** Exit code for "the artifact could not be walked, so nothing was measured". */
const EXIT_UNMEASURED = 3;

/** The λ a reading is taken at when the grid is the default one. */
const PRIMARY_LAMBDA = 1;

/**
 * Run the report.
 */
function main(): void {
  const opts = parseTermArgs(process.argv.slice(2));
  const rows = readContainmentRows(opts.rows);
  const depth = readDepthDump(opts.depth);
  const verdicts = readPerCaseVerdicts(opts.perCase);

  // A join inside one artifact: the two dumps are written by the same corpus walk, so a size mismatch means one
  // of them was produced by a different run and nothing below it would be about a single population.
  if (depth.length !== rows.length) {
    console.error(
      `  H6-term: UNMEASURED — the depth dump has ${depth.length} cases and the containment dump ${rows.length}; they are not the same run (exit 3)`,
    );
    process.exitCode = EXIT_UNMEASURED;
    return;
  }

  const accepted = new Map<string, readonly string[]>();
  for (const verdict of verdicts) accepted.set(verdict.datapack, verdict.accepted);
  const scores: ScoreTable = new Map(
    depth.map((row) => [
      row.datapack,
      new Map(
        row.top.flatMap(([service, score]) => (score === null ? [] : [[service, score] as const])),
      ),
    ]),
  );

  console.log('');
  console.log('═'.repeat(72));
  console.log('  H6 — the residual as a bounded TERM in the score, cross-fitted');
  console.log('═'.repeat(72));
  console.log(
    `  rows=${opts.rows} (${rows.length} cases)  depth=${opts.depth} (${depth.length} cases)  per-case=${opts.perCase} (${verdicts.length} cases)`,
  );

  const readings = sweepTerm(rows, scores, accepted, opts.lambdas);
  const primary = readings.find((reading) => reading.lambda === PRIMARY_LAMBDA) ?? readings[0]!;
  for (const line of formatTermReading(primary)) console.log(line);
  for (const line of formatTermSweep(readings)) console.log(line);

  const { verdict, reason } = termVerdict(primary);
  console.log('─'.repeat(72));
  if (verdict === 'unmeasured') {
    console.log(`  H6-term: UNMEASURED — ${reason} (exit 3)`);
    process.exitCode = EXIT_UNMEASURED;
  } else {
    console.log(`  H6-term: ${verdict.toUpperCase()} — ${reason}`);
  }
  console.log('═'.repeat(72));

  if (opts.output !== '') {
    writeFileSync(
      opts.output,
      JSON.stringify({ criterion: STANDING_CRITERION, verdict, reason, readings }, null, 2),
    );
  }
}

main();
