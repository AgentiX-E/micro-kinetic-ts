/**
 * The board report: one per-case verdict file in, the board's six-metric contract out.
 *
 * `sota-comparison.md` §0c-vii could compare two of the board's six metrics because two were the ones that had
 * been typed. This entry point is the other half of the fix: the four it could not state are now a command, so a
 * reader who doubts a cell re-runs one file rather than trusting a table.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/fse26-board-report.ts --per-case <verdict.ndjson> \
 *     [--depths 1,3,5,10,20,30,49] [--out <report.json>]
 *
 * Read-only over the verdict file. The board table it differences against is pinned in `board-metrics.ts` with
 * the artifact's `generated_at` and both `dataset_revision` hashes, so a comparison cannot silently drift to a
 * later leaderboard revision.
 *
 * @module benchmarks/fse26-board-report
 */

import { writeFileSync } from 'node:fs';

import {
  avgAtK,
  compareToBoardBest,
  computeBoardMetrics,
  formatBoardMetrics,
  formatBoardTable,
  RCABENCH_LEADERBOARD,
  topAt,
  topRate,
} from './board-metrics.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** The rungs printed when the caller names none: the head, the board's three columns, and the closed ladder. */
const DEFAULT_DEPTHS = '1,2,3,4,5,8,10,12,15,20,25,30,40,49';

/** Parse `--depths 1,3,5` into the rungs to print, refusing anything that is not a positive integer. */
function parseDepths(text: string): number[] {
  return text.split(',').map((part) => {
    const value = Number(part.trim());
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`--depths takes comma-separated positive integers, got '${part}'`);
    }
    return value;
  });
}

const argv = process.argv.slice(2);
const args: { perCase: string; depths: string; out: string } = {
  perCase: '',
  depths: DEFAULT_DEPTHS,
  out: '',
};
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]!;
  const next = argv[index + 1];
  if (arg === '--per-case' && next !== undefined) {
    args.perCase = next;
    index++;
  } else if (arg === '--depths' && next !== undefined) {
    args.depths = next;
    index++;
  } else if (arg === '--out' && next !== undefined) {
    args.out = next;
    index++;
  } else {
    // Refused rather than ignored: a report that silently ran without the flag a caller typed is a report whose
    // population nobody can name — the same rule `run-fse26.ts` applies to its own flags.
    throw new Error(`fse26-board-report: unrecognised argument '${arg}'`);
  }
}
if (args.perCase === '') {
  throw new Error('fse26-board-report: --per-case <verdict.ndjson> is required');
}

const depths = parseDepths(args.depths);
const verdicts = readPerCaseVerdicts(args.perCase);
// The table always prints `Top@5`, `Avg@5` and the deltas, so the ladder is computed to at least five rungs even
// when `--depths` asks for fewer: a flag that can crash the report it configures is a flag whose refusal has to be
// at the boundary, and `--depths 3` is a legitimate request for a short ladder.
const widest = Math.max(5, ...depths);
const metrics = computeBoardMetrics(verdicts, widest);
const fse = RCABENCH_LEADERBOARD.benchmarks[0]!;

console.log(`Verdict file: ${args.perCase}`);
console.log(
  `Board: ${fse.benchmark.title} (${fse.benchmark.id}), revision ${fse.benchmark.datasetRevision}`,
);
console.log(`Board generated_at: ${RCABENCH_LEADERBOARD.generatedAt}`);
console.log('═'.repeat(80));
console.log(formatBoardMetrics(metrics, depths));
console.log('═'.repeat(80));
console.log(formatBoardTable(metrics, fse));
console.log('═'.repeat(80));

// The comparison is taken against the best published value of EACH metric, and the refusal is reported rather than
// bypassed: a verdict file from another corpus is a real input and its refusal is the answer.
const onSamePopulation = fse.entries.filter(
  (entry) => entry.cases === metrics.cases && entry.scope === 'all',
);
if (onSamePopulation.length === 0) {
  console.log(
    `No board row scores ${metrics.cases} cases, so no delta is computable: the denominator rule refuses one.`,
  );
} else {
  console.log(
    `Deltas against the field's best on each metric (${onSamePopulation.length} whole-corpus rows):`,
  );
  for (const delta of compareToBoardBest(metrics, onSamePopulation)) {
    const count = delta.oursCount === undefined ? '' : ` (${delta.oursCount} cases)`;
    console.log(
      `  ${delta.metric.padEnd(6)} ours ${(delta.ours * 100).toFixed(2)}%  ${delta.holder.padEnd(10)} ` +
        `${(delta.board * 100).toFixed(2)}%  delta ${delta.deltaPp >= 0 ? '+' : ''}${delta.deltaPp.toFixed(2)}pp` +
        count,
    );
  }
}

if (args.out !== '') {
  const report = {
    verdictFile: args.perCase,
    board: {
      id: fse.benchmark.id,
      generatedAt: RCABENCH_LEADERBOARD.generatedAt,
      datasetRevision: fse.benchmark.datasetRevision,
    },
    cases: metrics.cases,
    absent: metrics.absent,
    minPool: metrics.minPool,
    maxPool: metrics.maxPool,
    mrr: metrics.mrr,
    depths: depths.map((depth) => ({
      depth,
      count: topAt(metrics, depth),
      rate: topRate(metrics, depth),
      avgAtK: avgAtK(metrics, depth),
    })),
    deltas: onSamePopulation.length === 0 ? [] : compareToBoardBest(metrics, onSamePopulation),
  };
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nBoard report written to ${args.out}`);
}
