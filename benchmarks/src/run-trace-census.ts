/**
 * Runner for the trace-channel census — the FSE'26 cell scored five times with its trace-derived inputs
 * ablated one at a time.
 *
 * ## Why this is a runner and not a dispatch
 *
 * Every other arm in this programme costs a workflow run and, on the golden half, model calls. This one costs
 * neither: the engine is a pure function of a case on local disk, and the ablation is an edit to that case
 * before the engine sees it. So the census is taken here, offline, and **the only input it shares with a
 * dispatched run is the engine configuration** — which is read from {@link buildFse26EngineOptions} so the
 * control arm is the shipped cell rather than a second implementation of it.
 *
 * ## The control is asserted, not assumed
 *
 * An ablation's numbers mean nothing if the control is not the arm the programme publishes, and "it looked
 * about right" is how `BASELINE (all OFF)` came to label a run with four terms switched on. `--expect-baseline`
 * makes the check mechanical: the run **fails** when its own control disagrees with the published cell instead
 * of printing a table nobody can place. The published value is 1 186 / 1 422 (83.40 %, `global-measured`); pass
 * it and the control has been reproduced case for case or the run stops.
 *
 * ## What each arm costs and what it can say
 *
 * | arm | the edit | what a fall in accuracy means |
 * | --- | --- | --- |
 * | `baseline` | none | — |
 * | `call-graph-edges` | `traceEdges: []` | the edge set the bridge observed is load-bearing over the static topology |
 * | `failed-edges` | `failedTraceEdges: []` | the failure-crossed-the-door channel is load-bearing |
 * | `edge-latency` | `traceEdgeLatency: []` | the per-edge duration channel is load-bearing |
 * | `all-trace` | all three | the cell's total dependence on traces |
 *
 * A channel whose removal costs nothing is not evidence that the channel is useless — it may be redundant with
 * the static topology, which is the reading `arXiv:2603.02057` invites. A channel whose removal **gains** cases
 * is evidence that it is misleading, and that is reported as a gain rather than swallowed by a delta of zero.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-trace-census.ts \
 *     --data-dir ~/rcabench/json --fault-free-profile ~/fault-free-profile.json \
 *     --failure-containment-scope global-measured [--expect-baseline 1186] [--output trace-census.json]
 *
 * @module benchmarks/run-trace-census
 */

import { writeFileSync } from 'node:fs';

import type { FSE26RawCase } from '../../packages/kinetic/src/benchmarks/index.js';
import {
  dropFSE26MetricNames,
  FSE26Loader,
  toFaultGraphOptions,
} from '../../packages/kinetic/src/benchmarks/index.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';

import { discoverCaseDirs } from './case-discovery.js';
import { extractOwnFlags } from './cli-args.js';
import { readFaultFreeProfileFile } from './fault-free-profile-file.js';
import { parseFSE26Args } from './fse26-cli.js';
import { buildFse26EngineOptions } from './fse26-engine-options.js';
import {
  acceptedServices,
  accumulateTraceCase,
  createTraceCensus,
  formatTraceCensusLine,
  rawForArm,
  topOneHit,
  TRACE_ARM_NAMES,
  TRACE_CHANNELS,
  type TraceArmHits,
  type TraceArmName,
} from './trace-channel-census.js';

/**
 * The one flag this runner adds to the FSE'26 vocabulary.
 *
 * `--output` is NOT here: the shared parser already carries it, and a second owner for a flag the FSE'26 run
 * honours is the defect `cli-args.ts` exists to prevent. Everything this runner does not own is forwarded
 * untouched, so a flag the shipped cell honours is a flag this census honours without a list to drift.
 */
const RUNNER_FLAGS = ['--expect-baseline'] as const;

async function main(): Promise<void> {
  const { passthrough, own } = extractOwnFlags(process.argv.slice(2), RUNNER_FLAGS);
  const opts = parseFSE26Args(passthrough);
  const expectBaseline =
    own['--expect-baseline'] === undefined ? undefined : Number(own['--expect-baseline']);
  if (expectBaseline !== undefined && !Number.isInteger(expectBaseline)) {
    throw new Error(`--expect-baseline must be an integer, got ${own['--expect-baseline']}`);
  }

  const loader = new FSE26Loader();
  const dropSet = new Set(opts.dropMetrics);
  const profileRead =
    opts.faultFreeProfilePath === undefined
      ? undefined
      : readFaultFreeProfileFile(opts.faultFreeProfilePath);
  const engineOptions = buildFse26EngineOptions(opts, profileRead?.profile);
  const pruner = new TreePruner(engineOptions.signals, engineOptions.topology);

  // Sorted, because a census whose population depends on readdir order cannot be re-run to the same number on a
  // different filesystem, and every arm must score the same set of cases or the denominators are not comparable.
  const dirs = discoverCaseDirs(opts.dataDir).sort();
  const selected = opts.maxCases > 0 ? dirs.slice(0, opts.maxCases) : dirs;

  console.log("Micro-Kinetic — trace-channel census (FSE'26)");
  console.log('═'.repeat(65));
  console.log(`Data:    ${opts.dataDir}`);
  console.log(`Cases:   ${selected.length} of ${dirs.length} discovered`);
  console.log(
    `Profile: ${opts.faultFreeProfilePath === undefined ? 'absent' : (profileRead?.digest ?? 'absent')}`,
  );
  console.log(
    `Engines: ${TRACE_ARM_NAMES.length} arms (1 control, ${Object.keys(TRACE_CHANNELS).length} singles, 1 composite)`,
  );

  let census = createTraceCensus();
  let loadErrors = 0;
  let emptyGraphs = 0;
  const perCase: Array<{ id: string; hits: TraceArmHits }> = [];
  const started = Date.now();

  for (const dir of selected) {
    let base: FSE26RawCase;
    try {
      base = loader.loadCase(dir);
    } catch (err) {
      loadErrors += 1;
      if (loadErrors <= 3) {
        console.error(`[loadError] ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }
    if (dropSet.size > 0) base = dropFSE26MetricNames(base, dropSet);

    const hits = {} as Record<TraceArmName, boolean>;
    for (const arm of TRACE_ARM_NAMES) {
      // Built and released inside the loop: the case carries the whole datapack's metrics, and five of them
      // alive at once is the memory this census does not have to spend.
      const benchCase = loader.toBenchmarkCase(rawForArm(base, arm));
      if (benchCase.callGraph.edges.length === 0) {
        // No edges, no order, no hit. Counted per arm so the denominators stay equal across arms.
        hits[arm] = false;
        if (arm === 'baseline') emptyGraphs += 1;
        continue;
      }
      const graph = pruner.buildFaultGraph(
        benchCase.callGraph,
        benchCase.metrics,
        toFaultGraphOptions(benchCase, benchCase.injectTime),
      );
      const order = pruner.analyze(graph, Math.max(1, benchCase.callGraph.nodes.size));
      hits[arm] = topOneHit(order, acceptedServices(benchCase));
    }
    census = accumulateTraceCase(census, base.datapack, hits);
    perCase.push({ id: base.datapack, hits });
  }

  const seconds = (Date.now() - started) / 1000;
  console.log('');
  for (const arm of TRACE_ARM_NAMES) {
    console.log(`  ${formatTraceCensusLine(census, arm)}`);
  }
  console.log('');
  console.log(
    `  Scored ${census.arms.baseline.total} cases in ${seconds.toFixed(0)} s ` +
      `(loadErrors=${loadErrors} emptyGraphs=${emptyGraphs})`,
  );

  const baselineHits = census.arms.baseline.hits;
  if (expectBaseline !== undefined && baselineHits !== expectBaseline) {
    // A table whose control is not the published arm is a table about a different configuration. Refusing is
    // the only honest outcome: the numbers below would otherwise be quoted as if they answered the question.
    throw new Error(
      `control disagrees with the published cell: baseline read ${baselineHits}, expected ${expectBaseline}. ` +
        'The ablation below is about a configuration this programme does not report, so it is not reported.',
    );
  }

  if (opts.output !== '') {
    writeFileSync(
      opts.output,
      `${JSON.stringify(
        {
          arms: census.arms,
          cases: census.arms.baseline.total,
          loadErrors,
          emptyGraphs,
          seconds: Math.round(seconds),
          expectBaseline: expectBaseline ?? null,
          channels: TRACE_CHANNELS,
          perCase,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`  Artifact: ${opts.output}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
