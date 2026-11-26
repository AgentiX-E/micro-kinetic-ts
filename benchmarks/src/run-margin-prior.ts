/**
 * Cloud-OpsBench, the margin-gated label prior — the first arm that lifts one cell without charging another.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-margin-prior.ts --data-dir <checkout> [--output <path>] [--max-cases N]
 *
 * ## What it measures, and what it deliberately does not
 *
 * The prior is a deployment's own incident history: how often each service was the labelled root cause elsewhere in
 * the same system. It is available at inference time, it is estimated LEAVE-ONE-OUT so the case being scored
 * contributes nothing to its own distribution, and it is scaled by `beta × log p` before being added to the engine's
 * score. The gate is the engine's OWN top-1 margin, because the measurement in `margin-gated-prior.ts` shows the
 * cells that break under an external term are the cells whose head is separated by 0.01.
 *
 * What it does not do is fit `beta` or `tau` per cell: every arm in {@link PRIOR_ARMS} applies one pair to all 156
 * cases, and the cell table is a READING of what one pair did, never a switch.
 *
 * ## Cost
 *
 * CNY 0.00. No model call, no embedding call: the records are the deterministic engine's and every arm is a re-sort.
 *
 * @module benchmarks/run-margin-prior
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import { parseCloudOpsArgs } from './cloudopsbench-cli.js';
import { movementOf, toFlagCase, type FlagCase } from './dual-family-membership.js';
import { gatedPriorArm, PRIOR_ARMS, topMargin, type PriorOptions } from './margin-gated-prior.js';
import { initRCAEvalTopology } from './rcaeval-topology.js';
import { createContainer, loadSelection } from './run-cloudopsbench.js';

/** One arm's line. */
interface ArmLine {
  readonly options: PriorOptions;
  readonly overall: number;
  readonly cells: ReadonlyMap<string, number>;
  readonly gained: number;
  readonly lost: number;
  readonly p: number;
  readonly halfA: number;
  readonly halfB: number;
}

/**
 * Score one arm against the engine and split the movement over two disjoint halves.
 *
 * The halves are taken by SORTED POSITION, not by cell: a split along the cells would let a cell that the arm helps
 * dominate one half and a cell it breaks dominate the other, which is the conclusion the split is meant to test.
 *
 * @param cases - The population, already in print order.
 * @param base - The engine's per-case verdicts.
 * @param options - The arm.
 * @returns Its line.
 */
function lineOf(
  cases: readonly FlagCase[],
  base: readonly boolean[],
  options: PriorOptions,
): ArmLine {
  const arm = gatedPriorArm(cases, options);
  const move = movementOf(base, arm.correct);
  if (move === undefined)
    throw new Error(
      `${JSON.stringify(options)}: the arm did not score the population it was given`,
    );
  const half = (parity: number): number => {
    let hit = 0;
    let total = 0;
    for (let index = 0; index < cases.length; index += 1) {
      if (index % 2 !== parity) continue;
      total += 1;
      if (arm.correct[index] === true) hit += 1;
    }
    return total === 0 ? Number.NaN : hit / total;
  };
  return {
    options,
    overall: arm.overall,
    cells: arm.cells,
    gained: move.gained,
    lost: move.lost,
    p: move.p,
    halfA: half(0),
    halfB: half(1),
  };
}

/**
 * Render the arms as a table.
 *
 * @param cases - The population.
 * @param base - The engine's verdicts.
 * @param cells - The cell names, in print order.
 * @returns The table.
 */
function formatArms(
  cases: readonly FlagCase[],
  base: readonly boolean[],
  cells: readonly string[],
): { text: string; lines: readonly ArmLine[] } {
  const head = [
    'beta'.padStart(6),
    'tau'.padStart(6),
    'scope'.padStart(8),
    'overall'.padStart(9),
    'halfA'.padStart(7),
    'halfB'.padStart(7),
    'gain'.padStart(5),
    'lost'.padStart(5),
    'p'.padStart(8),
    ...cells.map((one) => one.padStart(24)),
  ].join('');
  const lines: ArmLine[] = [];
  const body: string[] = [head, '-'.repeat(head.length)];
  for (const options of PRIOR_ARMS) {
    const line = lineOf(cases, base, options);
    lines.push(line);
    body.push(
      [
        String(options.beta).padStart(6),
        String(options.tau).padStart(6),
        options.scope.padStart(8),
        line.overall.toFixed(4).padStart(9),
        line.halfA.toFixed(4).padStart(7),
        line.halfB.toFixed(4).padStart(7),
        String(line.gained).padStart(5),
        String(line.lost).padStart(5),
        line.p.toFixed(4).padStart(8),
        ...cells.map((one) => (line.cells.get(one) ?? Number.NaN).toFixed(4).padStart(24)),
      ].join(''),
    );
  }
  return { text: `${body.join('\n')}\n`, lines };
}

async function main(): Promise<void> {
  const args = parseCloudOpsArgs(process.argv.slice(2));
  const dataDir = resolve(args.dataDir);
  await initRCAEvalTopology();
  const { selection, directories } = loadSelection(dataDir, args.maxCases, args.topology);

  const runner = createContainer(args.useInjectTime, {
    dualFamilyWeight: args.dualFamilyWeight,
    dualFamilyGate: args.dualFamilyGate,
    dualFamilyGateMode: args.dualFamilyGateMode,
  });
  const cases: FlagCase[] = [];
  const result = await runner.runSuite(selection.suite, (record) => {
    const cell = selection.cells.get(record.case.id);
    if (cell === undefined)
      throw new Error(`${record.case.id}: the selection has no cell for this case`);
    cases.push(toFlagCase(record, `${cell.system}/${cell.category}`));
  });
  cases.sort((a, b) => compareCasePaths(a.caseId, b.caseId));

  const base = cases.map((one) => one.accepted.includes(one.order[0]?.serviceId ?? ''));
  const cells = [...new Set(cases.map((one) => one.cell))].sort();

  process.stdout.write(`case directories            ${directories}\n`);
  process.stdout.write(`cases read                  ${cases.length}\n`);
  process.stdout.write(
    `inject time                 ${args.useInjectTime ? 'forwarded (corpus alert window)' : 'NOT forwarded (ablation)'}\n`,
  );
  process.stdout.write(
    `engine (no prior)           ${(base.filter(Boolean).length / cases.length).toFixed(4)}\n\n`,
  );

  // The margin distribution the gate reads, so the table below can be checked against the structure it exploits.
  const margins = cells.map((cell) => {
    const own = cases.filter((one) => one.cell === cell).map((one) => topMargin(one.order));
    const sorted = [...own].sort((a, b) => a - b);
    return {
      cell,
      median: sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.NaN,
      below: own.filter((gap) => gap < 0.05).length / Math.max(1, own.length),
    };
  });
  process.stdout.write(`the engine's own top-1 margin, per cell\n`);
  for (const one of margins) {
    process.stdout.write(
      `  ${one.cell.padEnd(24)} median ${one.median.toFixed(4)}   share under 0.05 ${(100 * one.below).toFixed(1)}%\n`,
    );
  }
  process.stdout.write(`\nthe arms — one (beta, tau, scope) for all 156 cases, never per cell\n`);
  const table = formatArms(cases, base, cells);
  process.stdout.write(table.text);

  if (args.output !== undefined) {
    writeFileSync(
      args.output,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dataDir,
          useInjectTime: args.useInjectTime,
          cases: cases.length,
          engine: {
            overall: base.filter(Boolean).length / cases.length,
            avgTop1: result.avgTop1,
            avgTop3: result.avgTop3,
            avgTop5: result.avgTop5,
          },
          margins,
          arms: table.lines.map((one) => ({
            ...one.options,
            overall: one.overall,
            halfA: one.halfA,
            halfB: one.halfB,
            gained: one.gained,
            lost: one.lost,
            p: one.p,
            cells: Object.fromEntries(one.cells),
          })),
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`wrote ${args.output}\n`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('run-margin-prior.ts')) {
  await main();
}
