/**
 * Read a containment-row dump and answer H2: does the factorisation residual separate a gain from a loss?
 *
 * ## Why this is a separate program
 *
 * The aggregation is a corpus-level statistic over an artifact, not a step inside the run that wrote it. Keeping
 * it outside means the population rule can be re-argued and re-computed against the same bytes for nothing, and
 * it means the number the pre-registration fixed can be read by someone who did not run the corpus. The same
 * argument `--terms-dump` records for weight screens applies here one axis over: an expensive question becomes a
 * local computation over one run.
 *
 * ## The three verdicts, and why an unmeasured one is not a failure
 *
 * `pass` (AUC above the bar) and `fail` (AUC measured, below it) are FINDINGS: both are recorded, and neither
 * turns a workflow red — a red build is a statement that the code is broken, not that a hypothesis was refused.
 * `unmeasured` is different in kind: the population could not support an estimate at all (one class empty, or no
 * labelled inversion had an edge with enough observations), and this program exits **3** so a dispatch cannot
 * read the absence of a measurement as a null result.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-containment-residual.ts \
 *     --rows <containment.ndjson> --per-case <per-case.ndjson> [--output <json>]
 *
 * @module benchmarks/run-containment-residual
 */

import { writeFileSync } from 'node:fs';

import { formatDiscrimination, parseResidualArgs } from './containment-residual-report.js';
import {
  DISCRIMINATION_BAR,
  MIN_POPULATION,
  discriminate,
  edgeCounts,
  populationCensus,
  residuals,
  verdictOf,
  type Discrimination,
} from './containment-residual.js';
import { readContainmentRows } from './containment-rows.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** Exit code for "the population could not support the estimate". */
const EXIT_UNMEASURED = 3;

/** The rows printed per side of the residual ranking. */
const TABLE_ROWS = 12;

/**
 * Print one arm's residual table.
 *
 * @param arm - The arm's name.
 * @param rows - The corpus's sweep rows.
 */
function printArmTable(
  arm: 'gated' | 'ungated',
  rows: ReturnType<typeof readContainmentRows>,
): void {
  const counts = edgeCounts(rows, arm);
  const census = populationCensus(counts);
  console.log('');
  console.log(
    `  ── ${arm} arm: ${census.edges} edges carry an inversion, ${census.observations} observations, ` +
      `${census.scoredEdges} edges at n >= ${MIN_POPULATION} ` +
      `(median n=${census.median}, largest n=${census.largest})`,
  );
  const scored = residuals(counts).filter(
    (residual): residual is typeof residual & { rho: number } => residual.rho !== null,
  );
  if (scored.length === 0) {
    console.log(
      `  ${arm} arm: no edge reached the population floor, so there is no residual to read`,
    );
    return;
  }
  const ranked = [...scored].sort((x, y) => y.rho - x.rho);
  for (const [label, slice] of [
    ['highest rho', ranked.slice(0, TABLE_ROWS)],
    ['lowest rho', ranked.slice(-TABLE_ROWS).reverse()],
  ] as const) {
    console.log(`  ${arm} arm: ${label}`);
    for (const edge of slice) {
      console.log(
        `    ${edge.a} <-> ${edge.b}  n=${edge.counts.measured} ` +
          `both=${edge.counts.bothOut} a=${edge.counts.aOut} b=${edge.counts.bOut} ` +
          `rho=${edge.rho.toFixed(4)} phi=${edge.phi === null ? 'N/A' : edge.phi.toFixed(4)}`,
      );
    }
  }
}

/**
 * Run the report.
 */
function main(): void {
  const opts = parseResidualArgs(process.argv.slice(2));
  const rows = readContainmentRows(opts.rows);
  const verdicts = readPerCaseVerdicts(opts.perCase);
  const accepted = new Map<string, readonly string[]>();
  for (const verdict of verdicts) accepted.set(verdict.datapack, verdict.accepted);

  console.log('');
  console.log('═'.repeat(72));
  console.log('  H2 — the factorisation residual of a pair’s out-of-band indicators');
  console.log('═'.repeat(72));
  console.log(
    `  rows=${opts.rows} (${rows.length} cases)  per-case=${opts.perCase} (${verdicts.length} cases)`,
  );
  const replay = { identical: 0, differs: 0, unavailable: 0 };
  for (const row of rows) replay[row.replay] += 1;
  console.log(
    `  replay: identical=${replay.identical} differs=${replay.differs} ` +
      `unavailable=${replay.unavailable}`,
  );

  // Both statistics, both arms: the pre-registered ρ decides H2, and φ is printed beside it because ρ's ceiling
  // depends on the marginals — an edge whose two ends are ALWAYS out of band reads 0 however perfectly they move
  // together. Reading the two in one pass means a separation ρ loses to its own scale is visible without a second
  // corpus walk. See `containment-residual.ts`.
  const results: Discrimination[] = [];
  for (const arm of ['ungated', 'gated'] as const) {
    printArmTable(arm, rows);
    for (const score of ['rho', 'phi'] as const) {
      const discrimination = discriminate(rows, accepted, arm, score);
      results.push(discrimination);
      for (const line of formatDiscrimination(discrimination)) console.log(line);
    }
  }

  console.log('');
  console.log('─'.repeat(72));
  // Two refusals, and they are different findings.
  //
  //   An EMPTY row file is an instrument failure: nothing was measured, and exit 3 says so rather than letting a
  //   zero read as a null result. A file with cases but no estimable AUC is a MEASUREMENT — the population could
  //   not separate the two classes, which is exactly what H2's own kill criterion names — so it prints as FAIL
  //   with the reason and leaves the exit code alone. Turning the second into a red build would make a refused
  //   hypothesis look like broken code, and the next dispatch would not know which of the two it was reading.
  if (rows.length === 0) {
    console.log(
      '  H2: UNMEASURED — the row file carries no case, so no population exists (exit 3)',
    );
    process.exitCode = EXIT_UNMEASURED;
  } else {
    // H2 is judged on the PRE-REGISTERED statistic only: a hypothesis is decided by the number it fixed, and
    // letting φ pass a gate ρ failed would be a criterion chosen after the data.
    const primary = results.filter((result) => result.score === 'rho');
    const passing = primary.filter((result) => verdictOf(result) === 'pass');
    const measured = primary.filter((result) => result.auc !== null);
    console.log(
      `  H2: ${passing.length > 0 ? 'PASS' : 'FAIL'} — ` +
        (measured.length === 0
          ? 'no arm produced an estimable AUC'
          : primary
              .map(
                (result) =>
                  `${result.arm} AUC=${result.auc === null ? 'N/A' : result.auc.toFixed(4)}`,
              )
              .join(', ')) +
        (measured.length === 0 ? '' : ` (bar ${DISCRIMINATION_BAR})`),
    );
  }
  console.log('═'.repeat(72));

  if (opts.output !== '') {
    writeFileSync(
      opts.output,
      JSON.stringify(
        {
          bar: DISCRIMINATION_BAR,
          minPopulation: MIN_POPULATION,
          cases: rows.length,
          replay,
          arms: results,
        },
        null,
        2,
      ),
    );
    console.log(`Results written to ${opts.output}`);
  }
}

main();
