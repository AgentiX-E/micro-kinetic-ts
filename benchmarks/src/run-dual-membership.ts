/**
 * Cloud-OpsBench, the dual-family flag's membership — who it paid, and whether that was the right candidate.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-dual-membership.ts --data-dir <checkout> [--output <path>]
 *     [--max-cases N] [--no-inject-time]
 *
 * ## What this runner is for, and what it is not
 *
 * Iteration 364 found 15 of the Hard bucket's 76 misses decided by `dualFamily` and priced the WEIGHT: 0 buys +0.6 pp
 * overall, 5 gained / 4 lost, TrainTicket −3 cases, which is a swap and not a repair. A swap has two causes — a
 * mispriced term or a mis-fired one — and they need different work, so this runner reads the MEMBERSHIP: the four
 * cells of `winner paid × truth paid`, the weight each harmful case would need, and the offline repricing arms.
 *
 * It does NOT sweep the gate. A gate changes which components are members, so it has to go through the engine, and
 * `run-cloudopsbench.ts --dual-family-gate <share> --dual-family-gate-mode <channel|min>` is that arm — one command per
 * point, its own artifact, and the two exist separately so that a reading of "who is in the family" cannot be
 * confused with a reading of "what the family is worth".
 *
 * ## Why every number here is CNY 0.00
 *
 * The runner makes no model call and no embedding call: the records come from the deterministic engine, the grid is
 * read off the ranking's own term rows, and the repricing arms are a re-sort of scores the engine already produced.
 *
 * @module benchmarks/run-dual-membership
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import { parseCloudOpsArgs } from './cloudopsbench-cli.js';
import {
  flipBudget,
  isHit,
  movementOf,
  readMembership,
  reprice,
  toFlagCase,
  type FlagCase,
  type MembershipGrid,
  type MembershipReading,
} from './dual-family-membership.js';
import { initRCAEvalTopology } from './rcaeval-topology.js';
import { createContainer, loadSelection } from './run-cloudopsbench.js';

/** The aggregate row's name, so it sorts after the cells rather than among them. */
const ALL = 'all/all';

/** The weights the offline arms price, in the order they print. */
const WEIGHTS = [0, -0.25, -0.5, 0.5, 1] as const;

/** One cell's row, or the aggregate's. */
interface CellRow {
  readonly cell: string;
  readonly cases: number;
  readonly hits: MembershipGrid & { readonly cases: number };
  readonly misses: MembershipGrid & { readonly cases: number };
}

/**
 * Sum a set of cases into one row.
 *
 * @param cell - The row's name.
 * @param cases - The cases in it.
 * @returns The row; the four cells and `cases` are the reading's own counts rather than a second walk.
 */
function rowOf(cell: string, cases: readonly FlagCase[]): CellRow {
  const reading = readMembership(cases);
  return { cell, cases: reading.cases, hits: reading.hits, misses: reading.misses };
}

/**
 * Render the grid, one line per cell, with the harmful cell's share beside it.
 *
 * @param rows - The rows, in print order.
 * @param total - The aggregate reading, for the empty-family and precision lines.
 * @returns The table.
 */
function formatGrid(rows: readonly CellRow[], total: MembershipReading): string {
  const head = [
    'cell'.padEnd(24),
    'cases'.padStart(6),
    'miss'.padStart(6),
    'both'.padStart(6),
    'winOnly'.padStart(8),
    'truthOnly'.padStart(10),
    'neither'.padStart(8),
    'absent'.padStart(7),
    'harmful'.padStart(8),
  ].join('');
  const lines = [head, '-'.repeat(head.length)];
  for (const row of rows) {
    const harmful = row.misses.winnerOnly;
    const share = row.misses.cases === 0 ? 0 : harmful / row.misses.cases;
    lines.push(
      [
        row.cell.padEnd(24),
        String(row.cases).padStart(6),
        String(row.misses.cases).padStart(6),
        String(row.misses.bothIn).padStart(6),
        String(harmful).padStart(8),
        String(row.misses.truthOnly).padStart(10),
        String(row.misses.neither).padStart(8),
        String(row.misses.truthAbsent).padStart(7),
        `${harmful} (${(100 * share).toFixed(1)}%)`.padStart(8),
      ].join(''),
    );
  }
  lines.push('');
  lines.push(
    `empty families              ${total.emptyFamilies}/${total.cases} (${((100 * total.emptyFamilies) / Math.max(1, total.cases)).toFixed(1)}%)`,
  );
  lines.push(`median family size          ${total.medianMembers}`);
  lines.push(
    `precision (truth also paid) ${Number.isNaN(total.precision) ? 'unmeasured: no winner is a member' : `${(100 * total.precision).toFixed(1)}%`}`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Render the offline repricing arms against the engine's own ordering.
 *
 * @param cases - The population.
 * @param weights - The weights to price.
 * @returns One line per arm.
 */
function formatArms(cases: readonly FlagCase[], weights: readonly number[]): string {
  const base = cases.map(isHit);
  const lines = [
    [
      'weight'.padStart(7),
      'overall'.padStart(9),
      'gained'.padStart(7),
      'lost'.padStart(6),
      'p'.padStart(8),
    ].join(''),
    '-'.repeat(38),
    [
      'shipped'.padStart(7),
      (base.filter(Boolean).length / cases.length).toFixed(4).padStart(9),
      '—'.padStart(7),
      '—'.padStart(6),
      '—'.padStart(8),
    ].join(''),
  ];
  for (const weight of weights) {
    const arm = reprice(cases, weight);
    const move = movementOf(base, arm.correct);
    if (move === undefined)
      throw new Error(`weight ${weight}: the arm did not score the population it was given`);
    lines.push(
      [
        String(weight).padStart(7),
        arm.overall.toFixed(4).padStart(9),
        String(move.gained).padStart(7),
        String(move.lost).padStart(6),
        move.p.toFixed(4).padStart(8),
      ].join(''),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseCloudOpsArgs(process.argv.slice(2));
  const dataDir = resolve(args.dataDir);
  // Before the selection, for the reason `run-cloudopsbench.ts` records at its own call: the graph is built during
  // selection and the uninitialised fallback is a ring.
  await initRCAEvalTopology();
  const { selection, directories } = loadSelection(dataDir, args.maxCases, args.topology);

  const runner = createContainer(args.useInjectTime, {
    dualFamilyWeight: args.dualFamilyWeight,
    dualFamilyGate: args.dualFamilyGate,
    dualFamilyGateMode: args.dualFamilyGateMode,
  });
  const cases: FlagCase[] = [];
  const result = await runner.runSuite(selection.suite, (record) => {
    const truth = selection.cells.get(record.case.id);
    if (truth === undefined)
      throw new Error(`${record.case.id}: the selection has no cell for this case`);
    cases.push(toFlagCase(record, `${truth.system}/${truth.category}`));
  });
  // Sorted by the ONE order convention, so two runs print the same table: a `localeCompare` here would use the
  // machine's ICU collation and could differ between the sandbox and CI.
  cases.sort((a, b) => compareCasePaths(a.caseId, b.caseId));

  const cells = [...new Set(cases.map((one) => one.cell))].sort();
  const rows = [
    ...cells.map((cell) =>
      rowOf(
        cell,
        cases.filter((one) => one.cell === cell),
      ),
    ),
    rowOf(ALL, cases),
  ];
  const total = readMembership(cases);
  const budget = flipBudget(cases, args.dualFamilyWeight ?? 0.25);

  process.stdout.write(`case directories            ${directories}\n`);
  process.stdout.write(`cases read                  ${cases.length}\n`);
  process.stdout.write(
    `inject time                 ${args.useInjectTime ? 'forwarded (corpus alert window)' : 'NOT forwarded (ablation)'}\n`,
  );
  process.stdout.write(
    `dual-family gate            ${args.dualFamilyGate === undefined ? 'shipped default (0.25)' : `${args.dualFamilyGate} (ablation)`} / ${args.dualFamilyGateMode ?? 'channel'}\n`,
  );
  process.stdout.write(
    `dual-family weight          ${args.dualFamilyWeight === undefined ? 'shipped default (0.25)' : `${args.dualFamilyWeight} (ablation)`}\n\n`,
  );
  process.stdout.write(
    `the membership, by cell — MISSES only, since a hit's winner is the truth\n`,
  );
  process.stdout.write(formatGrid(rows, total));
  process.stdout.write(`\nthe harmful cell's flip budget (${budget.harmful} cases)\n`);
  process.stdout.write(`  covered by the shipped weight  ${budget.withinWeight}\n`);
  process.stdout.write(`  beyond it                      ${budget.beyondWeight}\n`);
  process.stdout.write(
    `  weights needed                 ${budget.gaps.map((gap) => gap.toFixed(3)).join(' ') || '(none)'}\n\n`,
  );
  process.stdout.write(`the offline repricing arms — same membership, moving only the weight\n`);
  process.stdout.write(formatArms(cases, WEIGHTS));

  if (args.output !== undefined) {
    writeFileSync(
      args.output,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dataDir,
          useInjectTime: args.useInjectTime,
          dualFamilyGate: args.dualFamilyGate ?? null,
          dualFamilyGateMode: args.dualFamilyGateMode ?? null,
          dualFamilyWeight: args.dualFamilyWeight ?? null,
          cases: cases.length,
          rows,
          total,
          budget,
          arms: WEIGHTS.map((weight) => {
            const arm = reprice(cases, weight);
            const move = movementOf(cases.map(isHit), arm.correct);
            return {
              weight,
              overall: arm.overall,
              gained: move?.gained ?? 0,
              lost: move?.lost ?? 0,
              p: move?.p ?? 1,
            };
          }),
          engine: { avgTop1: result.avgTop1, avgTop3: result.avgTop3, avgTop5: result.avgTop5 },
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`wrote ${args.output}\n`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('run-dual-membership.ts')) {
  await main();
}
