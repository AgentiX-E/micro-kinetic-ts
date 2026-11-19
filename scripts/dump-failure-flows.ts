/**
 * Diagnostic probe: the failure FLOW behind every candidate, per case.
 *
 * Iteration 313 ranked first the candidates whose `unexplainedFailures` are positive and measured **1 049**
 * against the control's 1 156 `Top@1` — with the *same* 242 losses iteration 312's coarser partition took, and
 * 135 gains instead of 71. That shape has exactly two explanations, and the aggregate cannot separate them:
 *
 *   1. the relay's residual is positive too (the statistic is a COUNT, so a high-traffic node accumulates one),
 *      in which case the partition keeps the truth behind it and the losses survive; or
 *   2. the relay leaves the lead set and the truth does not enter it, in which case the truth's own flow is
 *      missing from the graph and no membership rule can recover it.
 *
 * Both are statements about the four numbers per service the engine already computes — `knownIn`, `knownOut`,
 * `novelIn`, `novelOut` — and neither is in any artifact a run writes. This probe writes them.
 *
 * For each requested case it prints one row per service: the four counts, the residual under both readings
 * (`shape`, the shipped one, and `counts`), the residual as a SHARE of the failures the service received, the
 * service's rank in the shipped order, and whether it is in the residual lead set. The share is the quantity
 * the next arm would have to rank on if explanation 1 holds, so it is printed here rather than computed later
 * from a dump that did not carry the denominator.
 *
 * Every magnitude comes from the engine: the graph is built by `TreePruner.buildFaultGraph` with the same
 * option mapping the run uses, and the flows are read off `graph.failureFlows`. Nothing is recomputed here,
 * which is the property that makes a probe's numbers the run's numbers.
 *
 * Usage:
 *   pnpm exec tsx scripts/dump-failure-flows.ts \
 *     [--data-dir <path>] [--types A,B] [--per-type N] [--out <path>] [<runner flags passed through>]
 *
 * Read-only: never writes to the data directory.
 *
 * @module scripts/dump-failure-flows
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import type { FSE26RawCase } from '../packages/kinetic/src/benchmarks/index.js';
import { FSE26Loader, toFaultGraphOptions } from '../packages/kinetic/src/benchmarks/index.js';
import type {
  FailureAttribution,
  FailureContainmentScope,
  FailureFlow,
} from '../packages/tree/src/index.js';
import { applyFailureContainment, unexplainedFailures } from '../packages/tree/src/index.js';
import { TreePruner } from '../packages/tree/src/pruning/pruner.js';

import { discoverCaseDirs } from '../benchmarks/src/case-discovery.js';
import {
  buildContainmentPruner,
  quietEngineOptions,
} from '../benchmarks/src/containment-pruner.js';
import { readFaultFreeProfileFile } from '../benchmarks/src/fault-free-profile-file.js';
import { parseFSE26Args } from '../benchmarks/src/fse26-cli.js';
import { buildFse26EngineOptions } from '../benchmarks/src/fse26-engine-options.js';

/** Which cases to probe, and where the rows go. */
interface ProbeOptions {
  readonly types: readonly string[];
  readonly perType: number;
  readonly out: string;
  readonly dataDir: string;
  readonly passthrough: readonly string[];
}

/** Reporting width for `truthRank`; wide enough that `absent` means absent. */
const PROBE_WIDTH = 50;

/**
 * Split this probe's own flags from the runner's.
 *
 * The rest is handed to the runner's parser unchanged, so the graph is built under whatever configuration the
 * caller would have run — a probe that hard-coded the shipped options would answer questions about a
 * configuration nobody dispatched.
 *
 * @param argv - The process arguments after the script name.
 * @returns The probe's selection and the arguments the runner's parser owns.
 */
function parseProbeArgs(argv: readonly string[]): ProbeOptions {
  const types: string[] = [];
  let perType = 10;
  let out = '';
  let dataDir = '';
  const passthrough: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--types' && i + 1 < argv.length)
      types.push(...argv[++i]!.split(',').filter(Boolean));
    else if (arg === '--per-type' && i + 1 < argv.length)
      perType = Number.parseInt(argv[++i]!, 10) || 0;
    else if (arg === '--out' && i + 1 < argv.length) out = argv[++i]!;
    else if (arg === '--data-dir' && i + 1 < argv.length) {
      dataDir = argv[++i]!;
      passthrough.push('--data-dir', dataDir);
    } else passthrough.push(arg);
  }
  return {
    types,
    perType: perType > 0 ? perType : 10,
    out,
    dataDir: dataDir === '' ? resolve(homedir(), 'rcabench/json') : dataDir,
    passthrough,
  };
}

/** One service's flow, as the engine computed it. */
interface FlowRow {
  readonly serviceId: string;
  readonly knownIn: number;
  readonly knownOut: number;
  readonly novelIn: number;
  readonly novelOut: number;
  readonly residualShape: number;
  readonly residualCounts: number;
  /**
   * The residual over the failures the service RECEIVED.
   *
   * `knownIn + novelIn + novelOut` rather than `knownIn` alone: under the shipped reading a request that leaves
   * in a shape nothing asked for is evidence about the service that emitted it, so it belongs in the
   * denominator of "how much of what this service reported could it not explain". Zero when the service
   * reported nothing, which is the one case where the ratio has no meaning — the lead rule reads the residual,
   * not the share, and a share of zero would make a silent service look maximally explained.
   */
  readonly residualShare: number;
  readonly rank: number;
  readonly isLead: boolean;
}

/** One case's row. */
interface CaseRow {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  /** The truth's rank in the PUBLISHED order — the configuration's own answer. */
  readonly truthRank: number;
  /**
   * The truth's rank after the containment rule at each reach, applied to the FUSION order.
   *
   * Offline, from the engine's own `applyFailureContainment` on the case's own flows and edges: the fusion order
   * is what the quiet engine publishes, and the three readings are the same function the run would call. Nothing
   * is reimplemented here, so a reading that says "the wide reach moves this case" is the reading the arm would
   * take — which is what makes this a measurement rather than a forecast.
   *
   * `adjacent` must equal `truthRank` whenever the published configuration runs the shipped pass, which is the
   * self-check the read is built on.
   */
  readonly truthRankByScope: Readonly<Record<FailureContainmentScope, number>>;
  readonly leads: readonly string[];
  readonly services: readonly FlowRow[];
}

/**
 * The truth's rank in an order, or 0 when the order does not hold it.
 *
 * @param order - Service ids, best first.
 * @param truth - The case's accepted labels.
 * @returns The best rank any accepted label holds, 1-based, or 0.
 */
function rankOf(order: readonly string[], truth: readonly string[]): number {
  let best = 0;
  for (const id of truth) {
    const at = order.indexOf(id);
    if (at < 0) continue;
    if (best === 0 || at + 1 < best) best = at + 1;
  }
  return best;
}

/**
 * Render one service's flow row.
 *
 * @param serviceId - The service the flow belongs to.
 * @param flow - Its flow, or `undefined` when the channel did not measure it.
 * @param rank - Its position in the shipped order, 1-based, or 0 when it was not ranked.
 * @returns The row.
 */
function flowRow(serviceId: string, flow: FailureFlow | undefined, rank: number): FlowRow {
  const shown = { knownIn: 0, knownOut: 0, novelIn: 0, novelOut: 0, ...flow };
  const reported = shown.knownIn + shown.novelIn + shown.novelOut;
  const residualShape = unexplainedFailures(flow, 'shape');
  return {
    serviceId,
    knownIn: shown.knownIn,
    knownOut: shown.knownOut,
    novelIn: shown.novelIn,
    novelOut: shown.novelOut,
    residualShape,
    residualCounts: unexplainedFailures(flow, 'counts'),
    residualShare: reported === 0 ? 0 : residualShape / reported,
    rank,
    isLead: residualShape > 0,
  };
}

/**
 * Probe one case and write its row.
 *
 * @param loader - The corpus loader.
 * @param raw - The loaded datapack.
 * @param pruner - The engine, built under the caller's configuration.
 * @param quiet - The same engine with both relational passes off, so its order is the fusion's.
 * @param attribution - Which reading of the flow decides a pair, as the run would use it.
 * @param write - Sink for the rendered row.
 */
function probeCase(
  loader: FSE26Loader,
  raw: FSE26RawCase,
  pruner: TreePruner,
  quiet: TreePruner,
  attribution: FailureAttribution,
  write: (row: CaseRow) => void,
): void {
  const benchCase = loader.toBenchmarkCase(raw);
  if (benchCase.callGraph.edges.length === 0) return;
  const graph = pruner.buildFaultGraph(
    benchCase.callGraph,
    benchCase.metrics,
    toFaultGraphOptions(benchCase, benchCase.injectTime),
  );
  const width = Math.max(PROBE_WIDTH, benchCase.callGraph.nodes.size);
  const published = pruner.analyze(graph, width).map((row) => row.serviceId);
  const fusion = quiet.analyze(graph, width).map((row) => row.serviceId);
  const truth =
    raw.groundTruthServices.length > 0
      ? raw.groundTruthServices
      : [benchCase.groundTruth.serviceId];
  const flows = graph.failureFlows ?? new Map();
  const byScope = (scope: FailureContainmentScope): number =>
    rankOf(
      applyFailureContainment({
        ranking: fusion.map((service) => ({ service })),
        flows,
        failingEdges: graph.failingEdges,
        attribution,
        scope,
      }).map((one) => one.service),
      truth,
    );
  const services = [...new Set([...flows.keys(), ...published])].map((id) =>
    flowRow(id, flows.get(id), published.indexOf(id) + 1),
  );
  write({
    datapack: raw.datapack,
    faultType: raw.faultType,
    truth,
    truthRank: rankOf(published, truth),
    truthRankByScope: {
      adjacent: byScope('adjacent'),
      global: byScope('global'),
      'global-measured': byScope('global-measured'),
    },
    leads: services.filter((row) => row.isLead).map((row) => row.serviceId),
    services,
  });
}

async function main(): Promise<void> {
  const opts = parseProbeArgs(process.argv.slice(2));
  const runArgs = parseFSE26Args([...opts.passthrough, '--data-dir', opts.dataDir]);
  const profileRead =
    runArgs.faultFreeProfilePath === undefined
      ? undefined
      : readFaultFreeProfileFile(runArgs.faultFreeProfilePath);
  const engineOptions = buildFse26EngineOptions(runArgs, profileRead?.profile);
  const pruner = new TreePruner(engineOptions.signals, engineOptions.topology);
  // The FUSION order, from the same configuration with both relational passes off: the reach readings below are
  // applied to it rather than to the published order, because the published order is already one pass past it.
  const quiet = buildContainmentPruner(quietEngineOptions(engineOptions));
  const loader = new FSE26Loader();
  const wanted = new Set(opts.types);
  const taken = new Map<string, number>();
  const dirs = discoverCaseDirs(opts.dataDir);
  const sink = opts.out === '' ? undefined : createWriteStream(opts.out, { encoding: 'utf8' });
  if (sink !== undefined) mkdirSync(dirname(resolve(opts.out)), { recursive: true });
  // Named before the first case, so a probe that writes nowhere says so on its first line rather than after an
  // hour of ranking a corpus it will not record.
  console.error(
    `probe: ${dirs.length} dirs under ${opts.dataDir}, rows -> ${opts.out === '' ? '(stdout only)' : opts.out}`,
  );
  let probed = 0;
  let seen = 0;
  for (const dir of dirs) {
    // Progress on STDERR, because a probe over a corpus takes as long as a run and a silent one is
    // indistinguishable from a hung one. It is not part of any artifact: the rows go to `--out`.
    if (++seen % 25 === 0) console.error(`  … ${seen}/${dirs.length} dirs, ${probed} cases probed`);
    let raw: FSE26RawCase;
    try {
      raw = loader.loadCase(dir);
    } catch {
      continue;
    }
    if (wanted.size > 0 && !wanted.has(raw.faultType)) continue;
    const already = taken.get(raw.faultType) ?? 0;
    if (already >= opts.perType) continue;
    taken.set(raw.faultType, already + 1);
    const rows: CaseRow[] = [];
    probeCase(loader, raw, pruner, quiet, runArgs.failureAttribution, (row) => rows.push(row));
    for (const row of rows) sink?.write(`${JSON.stringify(row)}\n`);
    probed += rows.length;
  }
  sink?.end();
  console.log(`probed ${probed} cases across ${taken.size} fault types`);
  for (const [type, count] of [...taken].sort()) console.log(`  ${type} ${count}`);
  // The attribution is named rather than assumed: the two readings of `unexplainedFailures` are different
  // statistics, and a row whose `residualShape` was read as the `counts` one would be a different claim.
  const attribution: FailureAttribution = runArgs.failureAttribution;
  console.log(`attribution: ${attribution}`);
}

await main();
