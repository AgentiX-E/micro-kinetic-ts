/**
 * CLI entry point for the `--diagnose` dump reader.
 *
 * Deliberately thin. Everything a test can exercise — the flag surface, the
 * section order, the arithmetic — lives in `fse26-diagnose-analyze.ts`, because
 * this file calls `main()` at import time and therefore cannot be loaded by a
 * test. That is not a stylistic preference: leaving the parser here is what
 * allowed the run's log weight to be accepted on four different flags, and a
 * report computed at the wrong one to print without objection.
 *
 * What remains here is only file I/O and `process.exit`.
 *
 * @module benchmarks/analyze-fse26-diagnose
 */

import { readFileSync, writeFileSync } from 'node:fs';

import type { AnalyzeInput } from './fse26-diagnose-analyze.js';
import {
  formatAnalyzeSections,
  formatDiagnoseComparison,
  formatLossStatement,
  parseAnalyzeArgs,
  parseDiagnosticDumpWithReport,
  parseLosses,
  shouldRefuseToReport,
} from './fse26-diagnose-analyze.js';

/**
 * Read one artifact and keep what the reader refused alongside what it kept.
 *
 * The pairwise API is deliberately the one used here rather than `parseDiagnosticDump`: the whole
 * point of the refusal below is that the loss has to be READ, and a call site that asks for the cases
 * alone is a call site that cannot report it.
 */
function read(path: string): AnalyzeInput {
  const parsed = parseDiagnosticDumpWithReport(readFileSync(path, 'utf-8'));
  return { label: path, cases: parsed.cases, report: parsed.report };
}

const opts = parseAnalyzeArgs(process.argv.slice(2));
const inputs =
  opts.kind === 'comparison' ? [read(opts.before), read(opts.after)] : [read(opts.dump)];
/** How the invocation's population is named, in the statement and in the refusal alike. */
const readLabel = opts.kind === 'comparison' ? `${opts.before} -> ${opts.after}` : opts.dump;
// Each sibling is parsed from its OWN file, because the sections that compare artifacts solve each
// on its own population and in its own rounding box: one concatenated case list would draw one
// benchmark's digits in another's quantum. Read through the same path, so a sibling that lost blocks
// is subject to the same refusal as the primary — a comparison is only as sound as its worse half.
const siblings =
  opts.kind === 'dump' ? (opts.extraDumps ?? []).map((path) => read(path)) : ([] as AnalyzeInput[]);

const losses = parseLosses([...inputs, ...siblings]);
if (shouldRefuseToReport(losses, opts.allowDroppedBlocks)) {
  process.stderr.write(
    formatLossStatement(losses, readLabel) +
      '\nRefusing to report over a population this reader had to shrink: a verdict computed over a\n' +
      'smaller case set is a verdict about a different artifact. Re-run with --allow-dropped-blocks\n' +
      'to read the surviving blocks instead, which prints the loss above the report.\n',
  );
  process.exit(1);
}

const population = formatLossStatement(losses, readLabel);
const report =
  opts.kind === 'comparison'
    ? formatDiagnoseComparison(
        [...inputs[0]!.cases],
        [...inputs[1]!.cases],
        `${opts.before} -> ${opts.after}`,
      )
    : formatAnalyzeSections(
        [...inputs[0]!.cases],
        opts.dump,
        opts,
        siblings.map((one) => ({
          label: one.label,
          cases: [...one.cases],
        })),
      );
process.stdout.write(population + report);
if (opts.output !== undefined) writeFileSync(opts.output, population + report);
