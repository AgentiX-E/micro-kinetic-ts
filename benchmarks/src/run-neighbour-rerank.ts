/**
 * The neighbour rerank probe's runner — one sweep, on the same 156 cases the score was taken on.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-neighbour-rerank.ts --data-dir <checkout> [--output <path>]
 *     [--max-cases N] [--no-inject-time]
 *
 * ## The control, which is asserted rather than hoped for
 *
 * Every arm in this probe is a RERANKING of the engine's own published scores, so the arm at `α = 0` must be the
 * engine exactly. Two identities are checked before any table is printed:
 *
 * 1. every case's `α = 0` ordering equals the engine's ordering, and the record `asPrediction` produces for it
 *    equals the record the runner produced (`correct` and `truthRank`, field for field);
 * 2. the `α = 0` row of the sweep equals `scoreByCell` over the runner's own predictions, cell for cell.
 *
 * Either identity failing means the probe is measuring a different engine than the one this repository publishes,
 * and it raises instead of printing a gain — which is the only way a reranker's arithmetic can be trusted to be
 * about the ranking it says it is about.
 *
 * ## What the run costs
 *
 * CNY 0.00. No model call, no embedding, no agent: the sweep is arithmetic over a ranking the engine already
 * produced in one pass, and `α` costs nothing to vary.
 *
 * @module benchmarks/run-neighbour-rerank
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { acceptedTruthServiceIds } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

import { parseCloudOpsArgs } from './cloudopsbench-cli.js';
import { formatCellTable, scoreByCell, type CellScore } from './cloudopsbench-score.js';
import {
  asPrediction,
  decide,
  directionSplit,
  formatDirectionSplit,
  formatSweep,
  MIRROR_GRID,
  movementOf,
  neighbourNull,
  rerankCase,
  sweep,
  type ArmRow,
  type Movement,
  type ProbeCase,
  type Verdict,
} from './neighbour-rerank.js';
import { initRCAEvalTopology } from './rcaeval-topology.js';
import { createContainer, loadSelection } from './run-cloudopsbench.js';

/** The probe population, read off one engine pass. */
export interface ProbeReadout {
  readonly cases: readonly ProbeCase[];
  /** The runner's own verdicts, in the same order — the control the probe is checked against. */
  readonly predictions: readonly CasePrediction[];
}

/**
 * Compare two cell tables, cell for cell, and name the first difference.
 *
 * @param left - The engine's table.
 * @param right - The arm's table.
 * @returns `null` when the two tables are the same table, or a sentence naming the first cell that differs.
 */
export function firstCellDifference(
  left: readonly CellScore[],
  right: readonly CellScore[],
): string | null {
  if (left.length !== right.length) {
    return `${left.length} cells against ${right.length}`;
  }
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]!;
    const b = right[i]!;
    if (a.system !== b.system || a.category !== b.category) {
      return `row ${i} is ${a.system}/${a.category} on one side and ${b.system}/${b.category} on the other`;
    }
    if (a.cases !== b.cases || a.top1 !== b.top1 || a.top3 !== b.top3 || a.top5 !== b.top5) {
      return `${a.system}/${a.category}: ${a.top1}/${a.top3}/${a.top5} against ${b.top1}/${b.top3}/${b.top5} over ${a.cases} and ${b.cases} cases`;
    }
  }
  return null;
}

/**
 * Check the `α = 0` arm against the engine, on every case and on every cell.
 *
 * @param readout - The case records and the runner's verdicts.
 * @param base - `scoreByCell` over the runner's own predictions.
 * @param sweepRows - The sweep; row 0 is `α = 0`.
 * @throws When the probe's `α = 0` arm is not the engine. The message names which identity broke.
 */
export function assertIdentity(
  readout: ProbeReadout,
  base: readonly CellScore[],
  sweepRows: readonly ArmRow[],
): void {
  const identity = sweepRows[0];
  if (identity === undefined) throw new Error('the sweep has no α = 0 arm, so there is no control');
  for (let i = 0; i < readout.cases.length; i += 1) {
    const one = readout.cases[i]!;
    const engine = one.ranking.map((candidate) => candidate.serviceId);
    const rebuilt = asPrediction(one, engine);
    const shipped = readout.predictions[i]!;
    if (rebuilt.caseId !== shipped.caseId) {
      throw new Error(`case ${i}: ${rebuilt.caseId} against ${shipped.caseId}`);
    }
    if (rebuilt.correct !== shipped.correct || rebuilt.truthRank !== shipped.truthRank) {
      throw new Error(
        `${one.caseId}: the α = 0 arm reads correct=${String(rebuilt.correct)} rank=${String(rebuilt.truthRank)} where the runner read correct=${String(shipped.correct)} rank=${String(shipped.truthRank)}`,
      );
    }
    const reranked = rerankCase(one, 0);
    if (reranked.length !== engine.length || reranked.some((id, index) => id !== engine[index])) {
      throw new Error(`${one.caseId}: α = 0 did not reproduce the engine's ordering`);
    }
  }
  const difference = firstCellDifference(base, identity.cells);
  if (difference !== null) {
    throw new Error(`the α = 0 row is not the published cells: ${difference}`);
  }
}

async function main(): Promise<void> {
  const args = parseCloudOpsArgs(process.argv.slice(2));
  const dataDir = resolve(args.dataDir);
  // The topology BEFORE the selection: `loadSelection` builds every case's graph, and `callGraphOf` throws when a
  // registered system's graph would be the ring fallback. The order is the same one the score runner now states.
  await initRCAEvalTopology();
  const { selection, directories, refusedReads } = loadSelection(
    dataDir,
    args.maxCases,
    args.topology,
  );
  if (refusedReads.length > 0) {
    throw new Error(
      `${refusedReads.length} case directories could not be read; first: ${refusedReads[0]!}`,
    );
  }
  if (selection.suite.totalCases === 0) {
    throw new Error(`${dataDir}: no scorable case, so there is nothing to rerank`);
  }

  const runner = createContainer(args.useInjectTime);
  const cases: ProbeCase[] = [];
  const result = await runner.runSuite(selection.suite, (record) => {
    cases.push({
      caseId: record.case.id,
      ranking: record.ranking.map((one) => {
        // The probe's whole input is the engine's PUBLISHED score. A candidate without one has no place in the
        // ordering the arm reranks, and substituting a zero would put it wherever zero happens to sort.
        if (one.finalScore === undefined) {
          throw new Error(
            `${record.case.id}: ${one.serviceId} reached the ranking without a finalScore, so there is no order to probe`,
          );
        }
        return { serviceId: one.serviceId, score: one.finalScore };
      }),
      edges: record.callGraph.edges.map((edge) => ({ from: edge.from, to: edge.to })),
      accepted: acceptedTruthServiceIds(record.case.groundTruth),
    });
  });

  const readout: ProbeReadout = { cases, predictions: result.casePredictions };
  const base = scoreByCell(result.casePredictions, selection.cells);
  const rows = sweep(cases, selection.cells);
  assertIdentity(readout, base, rows);
  const mirror = sweep(cases, selection.cells, MIRROR_GRID);

  /** Pair every arm in a grid against the engine and refuse a grid that scored a different population. */
  const movementsOf = (grid: readonly ArmRow[]): readonly Movement[] =>
    grid.map((row) => {
      const armPredictions = cases.map((one) => asPrediction(one, rerankCase(one, row.alpha)));
      const move = movementOf(result.casePredictions, armPredictions);
      if (move === null) {
        throw new Error(`α = ${row.alpha}: the arm did not score the population it was given`);
      }
      return move;
    });
  const moves = movementsOf(rows);
  const mirrorMoves = movementsOf(mirror);
  const verdict: Verdict = decide(rows, moves);
  const mirrorVerdict: Verdict = decide(mirror, mirrorMoves);
  const nullReading = neighbourNull(cases, result.casePredictions);
  const split = directionSplit(cases, result.casePredictions);

  process.stdout.write(`case directories            ${directories}\n`);
  process.stdout.write(`cases probed                ${cases.length}\n`);
  process.stdout.write(
    `inject time                 ${args.useInjectTime ? 'forwarded (corpus alert window)' : 'NOT forwarded (ablation)'}\n`,
  );
  process.stdout.write(
    `call graph                  ${args.topology === 'registry' ? 'registry (the deployment)' : 'RING (ablation: not the deployment)'}\n\n`,
  );
  process.stdout.write(`the engine (\u03b1 = 0, asserted identical to the published cells)\n`);
  process.stdout.write(formatCellTable(base));
  process.stdout.write(
    `\nthe neighbour share of the misses, against the null the graph produces\n`,
  );
  if (nullReading === null) {
    process.stdout.write('unavailable: the cases and the verdicts are not one population\n');
  } else {
    process.stdout.write(
      `observed ${nullReading.observed}/${nullReading.misses} = ${(nullReading.observed / Math.max(1, nullReading.misses)).toFixed(4)}; ` +
        `a uniformly random wrong winner gives ${nullReading.expected.toFixed(2)} = ${(nullReading.expected / Math.max(1, nullReading.misses)).toFixed(4)}; ` +
        `exact two-sided p = ${nullReading.p.toFixed(4)}\n`,
    );
  }
  process.stdout.write(formatDirectionSplit(split));
  process.stdout.write(`\nthe pre-registered sweep — CA@1 per cell, movement against the engine\n`);
  process.stdout.write(formatSweep(rows, moves));
  process.stdout.write(
    `\nverdict                     ${verdict.adopted ? `ADOPT α = ${verdict.alpha}` : 'REFUSE'}\n`,
  );
  process.stdout.write(`because                     ${verdict.reason}\n`);
  process.stdout.write(`\nthe mirror sweep (post-hoc: the sign came from the sweep above)\n`);
  process.stdout.write(formatSweep(mirror, mirrorMoves));
  process.stdout.write(
    `\nverdict                     ${mirrorVerdict.adopted ? `ADOPT α = ${mirrorVerdict.alpha}` : 'REFUSE'}\n`,
  );
  process.stdout.write(`because                     ${mirrorVerdict.reason}\n`);

  if (args.output !== undefined) {
    const armRows = (grid: readonly ArmRow[], pairs: readonly Movement[]): unknown =>
      grid.map((row, index) => ({
        alpha: row.alpha,
        cells: row.cells,
        gained: pairs[index]?.gained ?? 0,
        lost: pairs[index]?.lost ?? 0,
        p: pairs[index]?.p ?? 1,
      }));
    writeFileSync(
      args.output,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dataDir,
          useInjectTime: args.useInjectTime,
          topology: args.topology,
          cases: cases.length,
          engine: base,
          neighbours: nullReading,
          directions: split,
          arms: armRows(rows, moves),
          mirrorArms: armRows(mirror, mirrorMoves),
          verdict,
          mirrorVerdict,
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`wrote ${args.output}\n`);
  }
}

// Only when run as a script: the module's helpers are imported by the tests, and a top-level `main()` would make
// `import` an execution.
if (process.argv[1] !== undefined && process.argv[1].endsWith('run-neighbour-rerank.ts')) {
  await main();
}
