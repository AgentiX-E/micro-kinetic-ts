/**
 * CLI: read `--diagnose` dumps and reduce them either against each other or
 * against a metric family.
 *
 * This file is argument parsing and file IO only. Both reports are built by pure
 * functions in `fse26-diagnose-analyze`, so they are covered by tests; a
 * formatter living here would be unreachable from a test, because importing this
 * module runs the IO below.
 *
 * Usage:
 *
 *     tsx benchmarks/src/analyze-fse26-diagnose.ts \
 *       --before <baseline-dump.txt> --after <candidate-dump.txt> [--output <file>]
 *
 *     tsx benchmarks/src/analyze-fse26-diagnose.ts \
 *       --dump <dump.txt> [--family <regex>] [--family-label <name>] [--output <file>]
 *
 * `--before` is the run under the configuration that is being defended (for the
 * `logicHttp` question, `--log-mode count`) and `--after` is the candidate. It
 * is run per candidate fix, so the same cases are compared every time — the
 * question is always both "does this recover the losses" and "does it keep the
 * gains".
 *
 * The single-dump mode answers the other two halves. Its shape report is always
 * printed: how each service's decisive metric was won (deviation vs bonus, rise
 * vs drop, against what baseline). `--family` adds the metric-family section,
 * which says whether a fault's signature was discarded by a guard or scored and
 * out-competed. `--family` is optional because the shape report needs no
 * family, and requiring it would make the shape report unreachable without
 * inventing a family to satisfy the parser.
 *
 * The two modes are selected by which flags are present, and an invocation that
 * names neither throws rather than defaulting to one of them: the defect this
 * tooling exists to avoid is a configuration that silently becomes a different
 * configuration.
 *
 * @module benchmarks/analyze-fse26-diagnose
 */

import { readFileSync, writeFileSync } from 'node:fs';

import type { MetricFamily } from './fse26-diagnose-analyze.js';
import {
  formatAnomalyShapeReport,
  formatDiagnoseComparison,
  formatMetricCompetitionReport,
  parseDiagnosticDump,
} from './fse26-diagnose-analyze.js';

interface ComparisonOptions {
  readonly kind: 'comparison';
  readonly before: string;
  readonly after: string;
  readonly output: string | undefined;
}

interface FamilyOptions {
  readonly kind: 'dump';
  readonly dump: string;
  /** Present only when `--family` was given; the shape report needs none. */
  readonly family: MetricFamily | undefined;
  readonly output: string | undefined;
}

type CliOptions = ComparisonOptions | FamilyOptions;

const USAGE =
  'usage: analyze-fse26-diagnose --before <dump> --after <dump> | ' +
  '--dump <dump> [--family <regex>] [--family-label <name>] [--output <file>]';

function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== undefined && flag.startsWith('--') && i + 1 < argv.length) {
      values.set(flag.slice(2), argv[++i]!);
    }
  }
  const output = values.get('output');

  const dump = values.get('dump');
  if (dump !== undefined) {
    const family = values.get('family');
    return {
      kind: 'dump',
      dump,
      // An invalid pattern is a loud failure, never a report whose family
      // silently matches nothing.
      family:
        family === undefined
          ? undefined
          : { label: values.get('family-label') ?? family, pattern: new RegExp(family) },
      output,
    };
  }

  const before = values.get('before');
  const after = values.get('after');
  if (before !== undefined && after !== undefined) {
    return { kind: 'comparison', before, after, output };
  }

  throw new Error(USAGE);
}

const opts = parseArgs(process.argv.slice(2));
const report =
  opts.kind === 'comparison'
    ? formatDiagnoseComparison(
        parseDiagnosticDump(readFileSync(opts.before, 'utf-8')),
        parseDiagnosticDump(readFileSync(opts.after, 'utf-8')),
        `${opts.before} -> ${opts.after}`,
      )
    : (() => {
        const cases = parseDiagnosticDump(readFileSync(opts.dump, 'utf-8'));
        const sections = [formatAnomalyShapeReport(cases, opts.dump)];
        if (opts.family !== undefined) {
          sections.unshift(formatMetricCompetitionReport(cases, opts.family, opts.dump));
        }
        return sections.join('\n');
      })();
process.stdout.write(report);
if (opts.output !== undefined) writeFileSync(opts.output, report);
