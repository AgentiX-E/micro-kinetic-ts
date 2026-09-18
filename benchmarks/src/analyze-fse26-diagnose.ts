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

import {
  formatAnalyzeSections,
  formatDiagnoseComparison,
  parseAnalyzeArgs,
  parseDiagnosticDump,
} from './fse26-diagnose-analyze.js';

const opts = parseAnalyzeArgs(process.argv.slice(2));
const report =
  opts.kind === 'comparison'
    ? formatDiagnoseComparison(
        parseDiagnosticDump(readFileSync(opts.before, 'utf-8')),
        parseDiagnosticDump(readFileSync(opts.after, 'utf-8')),
        `${opts.before} -> ${opts.after}`,
      )
    : formatAnalyzeSections(
        parseDiagnosticDump(readFileSync(opts.dump, 'utf-8')),
        opts.dump,
        opts,
        // Each sibling is parsed from its OWN file, because the sections that compare artifacts
        // solve each on its own population and in its own rounding box: one concatenated case list
        // would draw one benchmark's digits in another's quantum.
        (opts.extraDumps ?? []).map((path) => ({
          label: path,
          cases: parseDiagnosticDump(readFileSync(path, 'utf-8')),
        })),
      );
process.stdout.write(report);
if (opts.output !== undefined) writeFileSync(opts.output, report);
