/**
 * The nine published cells are held to a committed BASELINE, so that a case-level fix is as visible as a regression.
 *
 * ## The defect this file exists for
 *
 * `docs/sota-comparison.md` publishes one block of nine cells and a total. `standing-anchor.test.ts` holds four
 * tables to that block and `anchor-config-fingerprint.test.ts` holds its marker to the shipped configuration — and
 * between them there was still a hole, one case wide, that stayed open for four days.
 *
 * `RE1:OnlineBoutique` read `112` in the block and `113` in every run of the shipped configuration. The cell moved
 * when one of thirty-five engine commits fixed `re1ob_currencyservice_loss_1`, which had been answered with its
 * caller `checkoutservice` instead of the truth `currencyservice`. Every assertion in the repository was green,
 * because every one of them compares the document against ITSELF: the cells summed to their suites, the suites to
 * the total, the tables quoted the block. **A transcript that is internally consistent cannot be wrong about the
 * world, it can only be stale**, and nothing was positioned to notice — the configuration fingerprint cannot see
 * this class either, since the run's `signals:` line is byte-identical before and after a fix.
 *
 * What can see it is a comparison against a recorded reading of the same nine cells. That reading is
 * `benchmarks/baselines/rcaeval-nine-cells.json`, and this module is the comparison: it counts each cell from the
 * run's own per-case census, compares it against the baseline, and **fails the job on any cell that moved**. A
 * deliberate improvement therefore cannot land silently — it has to update the baseline in the same commit that
 * declares it, which is the whole mechanism: a movement is either announced or red.
 *
 * ## Why it is a separate, dependency-free module
 *
 * It runs in the one job that has all three suites' artifacts and nothing else installed, so it imports the standard
 * library and not one workspace package. That is a constraint rather than a preference: the moment this file needs
 * the engine, it needs the engine's dependencies, and the gate becomes something that runs only where a full install
 * has happened — which is how gates stop running.
 *
 * ## What it does NOT hold
 *
 * FSE'26 and the RCABench archive. They have their own readings (`61.46% (874/1422)` and `759/1303`) and no baseline
 * file yet; the nine cells are first because they are what the standing document quotes first. It also says nothing
 * about an ARM: a dispatch that changes a default is *supposed* to move cells, so the tool compares the run's own
 * configuration digest against the baseline's and **skips the comparison** when they differ — but only for a run that
 * says it is an arm (`--arm`, which the workflow derives from the dispatch's own inputs). A push cannot name a knob,
 * so a digest mismatch there is a STALE BASELINE and the tool fails instead of skipping. The two were one condition
 * until run `43215496103` was read: it measured `1fa9e7bca975` against a baseline taken at `a0ed4a8a906e`, printed
 * the arm line, and the job went green with every cell unread — a skip that cannot distinguish an experiment from a
 * stale anchor is a gate that has stopped gating.
 *
 * @module benchmarks/src/cell-baseline
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** One recorded reading of the nine cells, with the run that produced it. */
export interface CellBaseline {
  /** Workflow run id the reading was taken from. */
  readonly battery: string;
  /** Revision that run measured. */
  readonly revision: string;
  /** Digest of the run's own `signals:` line — see `anchor-config-fingerprint.test.ts`. */
  readonly configuration: string;
  /** Correct cases per cell, keyed `RE<suite>:<system>`. */
  readonly cells: Readonly<Record<string, number>>;
  /** Correct cases over all nine, which the cells must sum to. */
  readonly total: number;
}

/** The minimum a census line must carry for this comparison: which cell, and whether the case was answered. */
interface CensusCase {
  readonly cell: string;
  readonly correct: boolean;
}

/** One cell that reads differently from the baseline. */
export interface CellMovement {
  readonly cell: string;
  readonly baseline: number;
  readonly actual: number;
}

/** The whole comparison, including the two ways a cell can be absent from one side. */
export interface CellComparison {
  readonly movements: readonly CellMovement[];
  /** Cells the baseline names and the run does not: a suite that did not run, or a cell renamed. */
  readonly absent: readonly string[];
  /** Cells the run names and the baseline does not: a tenth cell, or a rename. */
  readonly unexpected: readonly string[];
  /** Sum over every cell the run reported, so a total that disagrees with its cells is visible. */
  readonly actualTotal: number;
}

/**
 * Parse the baseline file, refusing a shape that would make the comparison vacuous.
 *
 * The two refusals are the ones that matter: a baseline with no cells would pass every comparison, and a `total`
 * that disagrees with its own cells is a baseline no run can be held to.
 *
 * @param text - The JSON file's contents.
 * @returns The parsed baseline.
 * @throws When the shape is not a baseline, or when its own arithmetic does not close.
 */
export function parseBaseline(text: string): CellBaseline {
  const parsed = JSON.parse(text) as Partial<CellBaseline>;
  const { battery, revision, configuration, cells, total } = parsed;
  if (typeof battery !== 'string' || typeof revision !== 'string') {
    throw new Error(
      'cell-baseline: `battery` and `revision` must name the run the reading came from',
    );
  }
  if (typeof configuration !== 'string' || !/^[0-9a-f]{12}$/.test(configuration)) {
    throw new Error(
      "cell-baseline: `configuration` must be the twelve-hex digest of the run's `signals:` line",
    );
  }
  if (cells === undefined || typeof cells !== 'object' || Object.keys(cells).length === 0) {
    throw new Error(
      'cell-baseline: `cells` is empty, and an empty baseline compares equal to nothing',
    );
  }
  for (const [cell, count] of Object.entries(cells)) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`cell-baseline: \`cells.${cell}\` is ${String(count)}, not a case count`);
    }
  }
  if (typeof total !== 'number') {
    throw new Error('cell-baseline: `total` must be the sum of the cells');
  }
  const sum = Object.values(cells).reduce((acc, count) => acc + count, 0);
  if (sum !== total) {
    throw new Error(`cell-baseline: the cells sum to ${sum} and \`total\` says ${total}`);
  }
  return { battery, revision, configuration, cells, total };
}

/**
 * Count each cell's correct cases from the run's per-case census.
 *
 * The census is one JSON object per line, written by every run, and it is the artifact the accuracy came from —
 * which is why the comparison reads it rather than the printed summary: a summary is a rendering, the census is
 * the cases.
 *
 * @param lines - The census file's lines, in any order.
 * @returns Correct cases per cell.
 * @throws When a line is not a census record — a truncated artifact must not count as zero cases.
 */
export function countCells(lines: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    if (line.trim() === '') continue;
    const record = JSON.parse(line) as Partial<CensusCase>;
    if (typeof record.cell !== 'string' || typeof record.correct !== 'boolean') {
      throw new Error(`cell-baseline: a census line is not a case record: ${line.slice(0, 120)}`);
    }
    counts[record.cell] = (counts[record.cell] ?? 0) + (record.correct ? 1 : 0);
  }
  return counts;
}

/**
 * Compare a run's cells against the baseline.
 *
 * @param baseline - The recorded reading.
 * @param actual - The run's cells.
 * @returns Every movement, plus the two directions of absence and the run's own total.
 */
export function compareCells(
  baseline: CellBaseline,
  actual: Readonly<Record<string, number>>,
): CellComparison {
  const movements: CellMovement[] = [];
  for (const [cell, count] of Object.entries(baseline.cells)) {
    const seen = actual[cell];
    if (seen === undefined) continue;
    if (seen !== count) movements.push({ cell, baseline: count, actual: seen });
  }
  const absent = Object.keys(baseline.cells).filter((cell) => actual[cell] === undefined);
  const unexpected = Object.keys(actual).filter((cell) => baseline.cells[cell] === undefined);
  const actualTotal = Object.values(actual).reduce((acc, count) => acc + count, 0);
  return { movements, absent, unexpected, actualTotal };
}

/**
 * The digest `docs/sota-comparison.md`'s anchor carries, computed the same way here.
 *
 * @param signalLine - The run's `signals:` line, verbatim.
 * @returns Twelve hex characters of its SHA-256.
 */
export function configDigest(signalLine: string): string {
  return createHash('sha256').update(signalLine).digest('hex').slice(0, 12);
}

/**
 * The first `signals:` line of a results file.
 *
 * @param text - The file's contents.
 * @returns The line, or `undefined` when the file carries none — a run whose banner did not print its
 * configuration cannot be identified as an arm or as the shipped configuration.
 */
export function findSignalLine(text: string): string | undefined {
  return text.split('\n').find((line) => line.startsWith('signals: '));
}

/**
 * Render the comparison as the text a job log carries.
 *
 * @param comparison - The comparison.
 * @param baseline - The baseline it was read against.
 * @returns One line per fact, with a verdict line first so a reader who scrolls to the end sees it too.
 */
export function formatComparison(comparison: CellComparison, baseline: CellBaseline): string {
  const lines: string[] = [];
  const clean =
    comparison.movements.length === 0 &&
    comparison.absent.length === 0 &&
    comparison.unexpected.length === 0;
  lines.push(
    clean
      ? `cell-baseline: all nine cells match battery ${baseline.battery} at ${baseline.revision}`
      : `cell-baseline: THE NINE CELLS MOVED against battery ${baseline.battery} at ${baseline.revision}`,
  );
  for (const move of comparison.movements) {
    const delta = move.actual - move.baseline;
    lines.push(
      `  ${move.cell.padEnd(22)} ${move.baseline} -> ${move.actual}  (${delta > 0 ? '+' : ''}${delta})`,
    );
  }
  for (const cell of comparison.absent) lines.push(`  ${cell.padEnd(22)} absent from this run`);
  for (const cell of comparison.unexpected) lines.push(`  ${cell.padEnd(22)} not in the baseline`);
  lines.push(
    `  total ${baseline.total} -> ${comparison.actualTotal} (${
      comparison.actualTotal === baseline.total ? 'unchanged' : 'moved'
    })`,
  );
  if (!clean) {
    lines.push(
      '  A movement is not automatically a defect: it is a claim nobody has made yet. Re-read the block in',
    );
    lines.push(
      '  docs/sota-comparison.md, record what moved and why, and update benchmarks/baselines/rcaeval-nine-cells.json',
    );
    lines.push(
      '  in the same commit. A regression is refused the same way an improvement is announced.',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The job's entry point.
 *
 * @param argv - Arguments after the script name.
 * @param read - File reader, injected so a test can supply a fixture.
 * @param write - Line writer, injected for the same reason.
 * @returns `0` when the run matches, is an arm, or is not comparable; `1` when a cell moved; `2` on bad arguments.
 */
export function main(
  argv: readonly string[],
  read: (path: string) => string,
  write: (text: string) => void,
): number {
  const values = (flag: string): string[] => {
    const found: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
      if (argv[index] === flag && argv[index + 1] !== undefined) found.push(argv[index + 1]!);
    }
    return found;
  };
  const baselinePath = values('--baseline')[0];
  const results = values('--results');
  const census = values('--census');
  // `--arm` is the caller's ASSERTION that this run is an experiment rather than the shipped configuration. It is
  // passed by the workflow from the dispatch's own inputs, so a bare dispatch and every push are held to the
  // baseline and only a named arm is exempt.
  const arm = argv.includes('--arm');
  if (baselinePath === undefined || results.length === 0 || census.length === 0) {
    write(
      'cell-baseline: usage: --baseline <json> --results <txt>... --census <jsonl>... [--arm]\n',
    );
    return 2;
  }
  const baseline = parseBaseline(read(baselinePath));

  // The comparison is meaningful only when the run measured the configuration the baseline was taken from. Two
  // different situations produce a mismatch and they must not share a verdict: an ARM is expected to move cells, while
  // a PUSH cannot name a flag at all, so a digest that differs there means the BASELINE is stale — the configuration
  // moved and the baseline was not re-anchored with it. That second case used to be reported as an arm and the job
  // stayed green, which is a gate that had stopped gating: run `43215496103` measured `1fa9e7bca975` against a
  // baseline taken at `a0ed4a8a906e` and printed the arm line while every cell it was built to check went unread.
  const signalLine = findSignalLine(read(results[0]!));
  if (signalLine === undefined) {
    write(
      `cell-baseline: ${results[0]!} carries no \`signals:\` line, so the run cannot be identified; skipped.\n`,
    );
    return 0;
  }
  const digest = configDigest(signalLine);
  if (digest !== baseline.configuration) {
    if (arm) {
      write(
        `cell-baseline: this run measured configuration ${digest} and the baseline was taken at ` +
          `${baseline.configuration} — an ARM, so its cells are not compared.\n`,
      );
      return 0;
    }
    write(
      `cell-baseline: this run measured configuration ${digest} and the baseline was taken at ` +
        `${baseline.configuration}, and this run is NOT an arm. The baseline is stale, not the run: re-anchor ` +
        'benchmarks/baselines/rcaeval-nine-cells.json in the commit that moved the configuration, and pass --arm ' +
        'only from a dispatch that names a knob.\n',
    );
    return 1;
  }

  const counts: Record<string, number> = {};
  for (const path of census) {
    for (const [cell, count] of Object.entries(countCells(read(path).split('\n')))) {
      counts[cell] = (counts[cell] ?? 0) + count;
    }
  }
  const comparison = compareCells(baseline, counts);
  write(formatComparison(comparison, baseline));
  // `actualTotal` is deliberately NOT one of the conditions: with the two key sets equal and every shared value
  // equal, the sums are equal, so a total that disagrees is only reachable together with a movement or an absence —
  // and a condition that cannot be reached on its own is a branch nothing can cover.
  const moved =
    comparison.movements.length > 0 ||
    comparison.absent.length > 0 ||
    comparison.unexpected.length > 0;
  return moved ? 1 : 0;
}

/**
 * Whether this module is the process's entry point, as a pure predicate.
 *
 * Extracted for the reason `validate-routing-frontier.ts` records about its own: the guard exists so a test can
 * import this file, which leaves its condition as the one statement only a spawned process executes.
 *
 * @param argv1 - `process.argv[1]`, or `undefined` when the process was started without a script.
 * @param moduleUrl - `import.meta.url` of the module asking.
 * @returns `true` only when `argv1` names this exact file.
 */
export function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  return argv1 !== undefined && moduleUrl === pathToFileURL(argv1).href;
}

/** Run only when this file IS the entry point. */
if (isEntryPoint(process.argv[1], import.meta.url)) {
  process.exit(
    main(
      process.argv.slice(2),
      (path) => readFileSync(path, 'utf8'),
      (text) => process.stdout.write(text),
    ),
  );
}
