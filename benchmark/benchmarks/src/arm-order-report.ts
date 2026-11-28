/**
 * Compose an arm's settled answers into a verdict file the board's metric layer can read.
 *
 * `sota-comparison.md` §0c-vii states the LLM arm's `Top@1` and refuses the other five columns, on the ground that
 * the arm's artifact records one name per case and four of the six metrics are functions of a position in an order.
 * The refusal was correct about the artefact it was reading and wrong about the run: the same artifact set carries
 * `depth.ndjson`, the engine's FULL order for every case, and the arm's name plus that order is an order — the name
 * first, the order behind it (see `arm-order.ts` for why that is the arm's own rule rather than a convenience).
 *
 * So this is the missing command, and it has one job: write the verdict file. The six columns come from
 * `fse26-board-report.ts` over the file this writes, which is the same reader every other number in the programme is
 * computed with — a second implementation of `Top@k` here would be a second definition of the metric.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/arm-order-report.ts \
 *     --engine artifacts/agentic/depth.ndjson \
 *     --arm    artifacts/agentic/query-agent.ndjson \
 *     --out    artifacts/agentic/arm-per-case.ndjson
 *
 * Read-only over both inputs. The composed file carries the same columns a run's own verdict file does, so a reader
 * can difference the arm against the engine case by case with `fse26-board-report.ts --baseline`.
 *
 * @module benchmarks/arm-order-report
 */

import { composeArmVerdicts, readArmAnswers, summariseComposition } from './arm-order.js';
import { writePerCaseVerdicts } from './fse26-per-case.js';
import { readDepthDump } from './ranking-depth.js';

const argv = process.argv.slice(2);
const args: { engine: string; arm: string; out: string } = { engine: '', arm: '', out: '' };
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]!;
  const next = argv[index + 1];
  if (arg === '--engine' && next !== undefined) {
    args.engine = next;
    index++;
  } else if (arg === '--arm' && next !== undefined) {
    args.arm = next;
    index++;
  } else if (arg === '--out' && next !== undefined) {
    args.out = next;
    index++;
  } else {
    // Refused rather than ignored: a composed file built without the flag a caller typed is a file whose population
    // nobody can name, which is the same rule every runner here applies to its own flags.
    throw new Error(`arm-order-report: unrecognised argument '${arg}'`);
  }
}
for (const [flag, value] of Object.entries(args)) {
  if (flag !== 'out' && value === '') {
    throw new Error(`arm-order-report: --${flag} <path> is required`);
  }
}

const engine = readDepthDump(args.engine);
const answers = readArmAnswers(args.arm);
const rows = composeArmVerdicts(engine, answers);
const census = summariseComposition(rows);
const grouped = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

console.log(`Engine order:  ${args.engine} (${grouped(engine.length)} cases)`);
console.log(`Arm answers:   ${args.arm} (${grouped(answers.length)} cases)`);
console.log(
  `Composition:   ${grouped(census.cases)} cases · already the engine's head ${grouped(census.alreadyFirst)} · ` +
    `promoted from inside the order ${grouped(census.promotedFromOrder)} · ` +
    `naming a service the pool did not carry ${grouped(census.promotedFromOutside)}`,
);
if (args.out === '') {
  console.log('No --out was given, so nothing was written.');
} else {
  const written = writePerCaseVerdicts(
    args.out,
    rows.map((row) => row.verdict),
  );
  console.log(`Written:       ${args.out} (${grouped(written)} rows)`);
}
