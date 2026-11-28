/**
 * The miss-term census's runner — which term decided each of the Hard bucket's misses, per cell.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-miss-terms.ts --data-dir <checkout> [--topology ring]
 *
 * ## What it answers, and why the answer is actionable where §363's was not
 *
 * §363 closed the two structural explanations of the ordering headroom: the call graph is worth 0 of 156 cases and
 * neighbour propagation is refused at both signs. So the remaining 34.9 pp is inside the score, and the score
 * publishes its rows. This runner counts the term `decompose` names for each miss, per cell, and the counts are a
 * routing decision rather than a description:
 *
 * - a cell where `selfAnomalyLog1p` decides wants a better anomaly — the metric, the window, the baseline;
 * - a cell where a PRIOR decides wants a weight, and the prior is named;
 * - a cell where the truth is absent wants a candidate-set fix, and there is none to want here because `ranked` is
 *   1.0000 in every cell.
 *
 * Cost: CNY 0.00. No model call, no embedding, no agent — one engine pass and an arithmetic census over the term
 * rows the engine already produced.
 *
 * @module benchmarks/run-miss-terms
 */

import { resolve } from 'node:path';

import { parseCloudOpsArgs } from './cloudopsbench-cli.js';
import { censusByCell, formatCensus } from './miss-term-census.js';
import { initRCAEvalTopology } from './rcaeval-topology.js';
import { createContainer, loadSelection } from './run-cloudopsbench.js';

async function main(): Promise<void> {
  const args = parseCloudOpsArgs(process.argv.slice(2));
  const dataDir = resolve(args.dataDir);
  // The topology before the selection: `loadSelection` builds every case's graph and `callGraphOf` refuses the ring
  // fallback for a registered system, which is the defect iteration 363 found and closed.
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
    throw new Error(`${dataDir}: no scorable case, so there is nothing to decompose`);
  }

  const runner = createContainer(args.useInjectTime);
  const result = await runner.runSuite(selection.suite);
  const rows = censusByCell(result.casePredictions, selection.cells);
  const overall = rows[rows.length - 1]!;

  process.stdout.write(`case directories            ${directories}\n`);
  process.stdout.write(`cases scored                ${result.totalCases}\n`);
  process.stdout.write(
    `inject time                 ${args.useInjectTime ? 'forwarded (corpus alert window)' : 'NOT forwarded (ablation)'}\n`,
  );
  process.stdout.write(
    `call graph                  ${args.topology === 'registry' ? 'registry (the deployment)' : 'RING (ablation: not the deployment)'}\n\n`,
  );
  process.stdout.write(formatCensus(rows));
  process.stdout.write(
    `\nthe term that decided the most misses overall: ${overall.terms[0]?.term ?? '(none)'} — ${overall.terms[0]?.count ?? 0} of ${overall.misses}\n`,
  );
}

// Only when run as a script: the module's helpers are imported by the tests, and a top-level `main()` would make
// `import` an execution.
if (process.argv[1] !== undefined && process.argv[1].endsWith('run-miss-terms.ts')) {
  await main();
}
