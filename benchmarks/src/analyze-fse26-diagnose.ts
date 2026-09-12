/**
 * CLI: turn two `--diagnose` dumps into the regression set and its mechanism.
 *
 * This file is argument parsing and file IO only. The report itself is built by
 * `formatDiagnoseComparison` in the pure `fse26-diagnose-analyze` module, so it
 * is covered by tests; a formatter living here would be unreachable from a test,
 * because importing this module runs the IO below.
 *
 * Usage:
 *
 *     tsx benchmarks/src/analyze-fse26-diagnose.ts \
 *       --before <baseline-dump.txt> --after <candidate-dump.txt> [--output <file>]
 *
 * `--before` is the run under the configuration that is being defended (for the
 * `logicHttp` question, `--log-mode count`) and `--after` is the candidate. It
 * is run per candidate fix, so the same cases are compared every time — the
 * question is always both "does this recover the losses" and "does it keep the
 * gains".
 *
 * @module benchmarks/analyze-fse26-diagnose
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { formatDiagnoseComparison, parseDiagnosticDump } from './fse26-diagnose-analyze.js';

interface CliOptions {
  readonly before: string;
  readonly after: string;
  readonly output: string | undefined;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== undefined && flag.startsWith('--') && i + 1 < argv.length) {
      values.set(flag.slice(2), argv[++i]!);
    }
  }
  const before = values.get('before');
  const after = values.get('after');
  if (before === undefined || after === undefined) {
    throw new Error(
      'usage: analyze-fse26-diagnose --before <dump> --after <dump> [--output <file>]',
    );
  }
  return { before, after, output: values.get('output') };
}

const opts = parseArgs(process.argv.slice(2));
const report = formatDiagnoseComparison(
  parseDiagnosticDump(readFileSync(opts.before, 'utf-8')),
  parseDiagnosticDump(readFileSync(opts.after, 'utf-8')),
  `${opts.before} -> ${opts.after}`,
);
process.stdout.write(report);
if (opts.output !== undefined) writeFileSync(opts.output, report);
