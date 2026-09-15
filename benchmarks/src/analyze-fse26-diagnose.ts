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
  formatMissReport,
  formatWeightSeparationReport,
  formatZeroRegressionWindowReport,
  parseDiagnosticDump,
  type SlopeKind,
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
  /**
   * The run's log weight, present only when `--misses` was given.
   *
   * It is a VALUE rather than a bare switch on purpose: attributing each miss
   * needs the scale the log term actually ran at, and a defaulted weight would
   * attribute losses to a term at a scale the run never used.
   */
  readonly logWeight: number | undefined;
  /** Same value, same reason, for the weight-separation section. */
  readonly weightSweep: number | undefined;
  /**
   * The run's log weight, present only when `--window` was given.
   *
   * The zero-regression window is a different question from `--weight-sweep`
   * (nothing gets worse, against everything is satisfied), so it is a different
   * flag: the first question's answer is NO on every input this benchmark has
   * produced, and reporting only it made the second look unaskable.
   */
  readonly windowSweep: number | undefined;
  /**
   * The rise a service must clear before the latency term credits it. 1 is the
   * shipped shape; anything else models a shape the engine does not have, so a report
   * carrying it is a prediction. Parsed always, used only by `--window`.
   */
  readonly latFloor: number;
  /**
   * Which term's score the weight solves for. `failedEdge` unless `--slope lat`
   * says otherwise: the latency term answers a DIFFERENT question (its own
   * regression set), and mixing the two would attribute one term's losses to the
   * other's scores.
   */
  readonly slope: SlopeKind;
  readonly output: string | undefined;
}

type CliOptions = ComparisonOptions | FamilyOptions;

const USAGE =
  'usage: analyze-fse26-diagnose --before <dump> --after <dump> | ' +
  '--dump <dump> [--family <regex>] [--family-label <name>] [--misses <logWeight>] ' +
  '[--weight-sweep <logWeight>] [--window <logWeight>] [--lat-floor <rise>] ' +
  '[--slope failedEdge|lat] [--output <file>]';

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
    const misses = values.get('misses');
    const sweep = values.get('weight-sweep');
    let weightSweep: number | undefined;
    if (sweep !== undefined) {
      const parsedSweep = Number(sweep);
      if (!Number.isFinite(parsedSweep)) {
        throw new Error(`--weight-sweep expects the run's log weight, got '${sweep}'\n${USAGE}`);
      }
      weightSweep = parsedSweep;
    }
    // A SEPARATE flag from `--weight-sweep`, not a second block on it: the two
    // answer different questions ("can every case be satisfied" against "can any
    // case get worse") and the first answers NO on every input this benchmark has
    // ever produced. Sharing one flag is how the second question came to look
    // unanswerable.
    const windowArg = values.get('window');
    let windowSweep: number | undefined;
    if (windowArg !== undefined) {
      const parsedWindow = Number(windowArg);
      if (!Number.isFinite(parsedWindow)) {
        throw new Error(`--window expects the run's log weight, got '${windowArg}'\n${USAGE}`);
      }
      windowSweep = parsedWindow;
    }
    // A shape the engine does not have yet, so the default is the shipped one and a
    // report that names a different floor is a PREDICTION about that shape. Kept
    // separate from `--slope` because the two select orthogonal things: which term,
    // and how thin a rise that term is willing to credit.
    const floorArg = values.get('lat-floor');
    let latFloor = 1;
    if (floorArg !== undefined) {
      const parsedFloor = Number(floorArg);
      if (!Number.isFinite(parsedFloor) || parsedFloor < 1) {
        throw new Error(`--lat-floor expects a rise of at least 1, got '${floorArg}'\n${USAGE}`);
      }
      latFloor = parsedFloor;
    }
    // Anything that is not exactly `lat` falls back to the term this solver was
    // built for, like every other switch here: a typo has to reproduce a known
    // configuration rather than invent one.
    const slope: SlopeKind = values.get('slope') === 'lat' ? 'lat' : 'failedEdge';
    let logWeight: number | undefined;
    if (misses !== undefined) {
      // STRICT: a weight that is not a finite number would attribute every miss
      // to a scale nobody chose, and the report would look like a measurement.
      const parsed = Number(misses);
      if (!Number.isFinite(parsed)) {
        throw new Error(`--misses expects the run's log weight, got '${misses}'\n${USAGE}`);
      }
      logWeight = parsed;
    }
    return {
      kind: 'dump',
      dump,
      // An invalid pattern is a loud failure, never a report whose family
      // silently matches nothing.
      family:
        family === undefined
          ? undefined
          : { label: values.get('family-label') ?? family, pattern: new RegExp(family) },
      logWeight,
      weightSweep,
      windowSweep,
      latFloor,
      slope,
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
        if (opts.logWeight !== undefined) {
          sections.unshift(formatMissReport(cases, { logWeight: opts.logWeight }));
        }
        if (opts.weightSweep !== undefined) {
          sections.unshift(
            formatWeightSeparationReport(cases, { logWeight: opts.weightSweep }, opts.slope),
          );
        }
        if (opts.windowSweep !== undefined) {
          sections.unshift(
            formatZeroRegressionWindowReport(
              cases,
              { logWeight: opts.windowSweep },
              opts.slope,
              opts.latFloor,
            ),
          );
        }
        return sections.join('\n');
      })();
process.stdout.write(report);
if (opts.output !== undefined) writeFileSync(opts.output, report);
