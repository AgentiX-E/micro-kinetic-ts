/**
 * Cloud-OpsBench cases as `BenchmarkCase`s — the fourth vendor format this engine reads, and the first whose
 * inputs are a metric table and nothing else.
 *
 * ## What a case can and cannot be scored on
 *
 * `docs/cloud-opsbench-connection.md` §7 counted the corpus: **754 case directories, 170 with
 * `raw_data/metrics.csv`, 166 whose labelled entity is one of their own series.** This module turns those into the
 * only thing the engine consumes, and it REFUSES a case rather than repairing it, because every repair would be a
 * number attributed to the engine that no one could reproduce:
 *
 * | refusal | why it is not a case for THIS engine |
 * | --- | --- |
 * | `no-series` | 584 cases carry no `metrics.csv` at all — 442 admission/scheduling/startup/service/runtime, plus 25 performance and 10 codedefect |
 * | `no-alert-window` | the collision source at t₀ is defined against an injection time; a window invented at epoch zero would move every sample past the injection |
 * | `truth-outside-service-alphabet` | a `node/…` or `namespace/…` truth is not a service, so no service ranking can express it |
 * | `truth-absent-from-own-series` | the labelled service is not among the case's columns, so the engine cannot see the entity it is asked about |
 *
 * Those four refusals are ordered and each case is charged to the FIRST one it meets, so the counts sum to the
 * corpus rather than overlapping. Measured at iteration 362: **156 scorable** — 88 `boutique/codedefect`,
 * 21 `boutique/performance`, 47 `trainticket/performance`.
 *
 * ## The two fields a metric-only corpus does not have
 *
 * `BenchmarkCase` carries `logs`, `traces`, `failedTraceEdges` and `traceActivity`; this corpus publishes none of
 * them. They are left ABSENT rather than empty: `logs: []` claims "the file held nothing", which is a different
 * statement from "there is no log artefact", and the engine's log channel keys off the difference. The same holds
 * for the call graph — a case states its services, not its edges, so the graph comes from the same topology
 * registry the RCAEval cells use, and services the registry does not know are ring-connected by that shared code
 * path. A cell scored here is therefore comparable to a cell scored on RCAEval for the one thing that matters:
 * the engine and the graph builder are the same, and only the telemetry differs.
 *
 * ## What is deliberately NOT done here
 *
 * No `injectTime` estimate, no outlier repair, no unit conversion. The `alert.json` window is the injection time
 * because that is the only statement the corpus makes about when the fault began, and the CSV's cadence
 * (5 s, 46–53 rows) is carried through unchanged so a window the engine cannot resolve is visible as a miss
 * rather than smoothed into a hit.
 *
 * @module benchmarks/src/cloudopsbench-suite
 */

import type {
  CallEdge,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';

import type {
  BenchmarkCase,
  BenchmarkGroundTruth,
  BenchmarkSuite,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';

import type { CaseSeries, CloudOpsCase } from './cloudopsbench-case.js';
import { buildSystemCallGraph, isRCAEvalTopologyInitialized } from './rcaeval-topology.js';

/** The suite name every case of this corpus is filed under. */
export const CLOUDOPSBENCH_SUITE = 'cloudopsbench';

/**
 * Cloud-OpsBench's system slugs against the topology registry's system names.
 *
 * The corpus names two systems — `boutique` and `trainticket` — and the registry keys `OnlineBoutique` and
 * `TrainTicket`, i.e. the same two deployments RCAEval uses (`re2ob`/`re2tt`). A slug outside this map is not an
 * error: it builds a ring-connect graph from the case's own service list, which is what the RCAEval path does for
 * a case whose id names no system either.
 */
const SYSTEM_TOPOLOGY = new Map<string, 'OnlineBoutique' | 'SockShop' | 'TrainTicket'>([
  ['boutique', 'OnlineBoutique'],
  ['sock-shop', 'SockShop'],
  ['sock-shop-shop', 'SockShop'],
  ['trainticket', 'TrainTicket'],
  ['train-ticket', 'TrainTicket'],
]);

/** The four reasons a published case is not a case for a metric-reading engine, in charging order. */
export type ScorableRefusal =
  | 'no-series'
  | 'no-alert-window'
  | 'truth-outside-service-alphabet'
  | 'truth-absent-from-own-series';

/** Every refusal, in the order a case is charged to one. */
export const REFUSAL_ORDER: readonly ScorableRefusal[] = [
  'no-series',
  'no-alert-window',
  'truth-outside-service-alphabet',
  'truth-absent-from-own-series',
];

/**
 * The unit a metric column carries, as the column's own name states it.
 *
 * `BenchmarkCase.metrics` carries a `unit` and no consumer reads it, so this is a label for a human reading a
 * dump rather than a conversion: returning `''` for an unrecognised metric is the honest answer, and inventing
 * `'count'` would claim the file said something it did not.
 *
 * @param metric - The metric half of a `<service>-<metric>` column.
 * @returns A unit string, or `''` when the name states none.
 */
export function unitOfMetric(metric: string): string {
  const lower = metric.toLowerCase();
  if (lower === 'cpu' || lower.endsWith('_cpu')) return 'cores';
  if (lower === 'cpu_cfs') return 'cores';
  if (lower === 'mem' || lower.includes('memory') || lower.endsWith('_mem')) return 'bytes';
  // `p99latency`, `http_p99` and a bare `p50` are the same quantity written three ways, so the test is on the
  // token and not on the position: a substring test for `p99` would also claim `p99bucket_width`.
  if (lower.includes('latency') || /(^|_)(p50|p99)$/.test(lower)) return 'ms';
  if (lower === 'rps' || lower.endsWith('_rps')) return 'requests/s';
  if (lower.includes('rate')) return 'ratio';
  // `net_tx` and `tx_bytes` are the same quantity written two ways, so the test is on the TOKEN rather than
  // on the position: a substring test for `tx` would also claim `context_switches`.
  if (/(^|_)(net|tx|rx)(_|$)/.test(lower)) return 'bytes/s';
  return '';
}

/**
 * The labelled entity as a service id, or `null` when the label is not a service.
 *
 * The corpus writes `app/adservice`, `node/worker-02`, `namespace/boutique`. Only the first names something a
 * service ranking can contain, and the prefix is stripped rather than compared because the ranking's alphabet is
 * the CSV's service names.
 *
 * @param faultObject - The label as `metadata.json` states it.
 * @returns The service name, or `null` for every other scope.
 */
export function truthServiceOf(faultObject: string): string | null {
  const cut = faultObject.indexOf('/');
  if (cut <= 0 || cut === faultObject.length - 1) return null;
  return faultObject.slice(0, cut) === 'app' ? faultObject.slice(cut + 1) : null;
}

/**
 * Group a case's series by service, as `BenchmarkCase.metrics` wants them.
 *
 * @param series - The case's series, already ordered by service then metric.
 * @returns One entry per service, each holding that service's metrics in the input's order.
 */
export function groupSeriesByService(
  series: readonly CaseSeries[],
): ReadonlyMap<string, readonly TimeSeries[]> {
  const grouped = new Map<string, TimeSeries[]>();
  for (const one of series) {
    const entry: TimeSeries = {
      label: one.metric,
      timestamps: [...one.timestamps],
      values: Float64Array.from(one.values),
      unit: unitOfMetric(one.metric),
    };
    const bucket = grouped.get(one.service);
    if (bucket === undefined) grouped.set(one.service, [entry]);
    else bucket.push(entry);
  }
  return grouped;
}

/**
 * Which graph a case is scored on.
 *
 * `registry` is the deployment the registry carries and is the only arm a published number may come from. `ring`
 * is the ABLATION: it connects the case's services in a cycle regardless of what the registry knows, which is
 * exactly the graph this repository shipped by accident before the ordering defect in `callGraphOf` was found. It
 * is kept as an arm rather than deleted because "the totals did not move" and "no case moved" are different claims
 * and only the second prices the topology channel.
 */
export type CaseTopology = 'registry' | 'ring';

/**
 * Build a call graph over exactly the case's own services.
 *
 * ## The precondition, which is checked rather than documented
 *
 * `buildSystemCallGraph` falls back to a RING when the topology registry has not been initialised, and that
 * fallback is correct for a system the registry does not carry — but for `boutique` or `trainticket` it is a graph
 * of a different deployment. This repository shipped that defect once: `loadSelection` builds the suite, the suite
 * builds every case's graph, and the Cloud-OpsBench runner initialised the registry AFTER the selection, so an
 * entire corpus was scored on a ring while every docblock claimed the graph builder was shared with the RCAEval
 * cells. The reading it produced was not wrong arithmetic; it was arithmetic about a topology the corpus does not
 * have, which no reader of the table could have detected.
 *
 * The fix is not the call order alone — a caller can get an order wrong again — so the mismatch THROWS here, in
 * the one place that decides a case's graph, and names the bug it is preventing.
 *
 * @param one - The case.
 * @param topology - `registry` for the deployment, `ring` for the ablation arm.
 * @returns A graph whose node set is the case's service list.
 * @throws When the case names a registered system, the registry arm is asked for, and the registry is not
 *   initialised — because the fallback graph would be a ring rather than the deployment.
 */
export function callGraphOf(
  one: CloudOpsCase,
  topology: CaseTopology = 'registry',
): ServiceCallGraph {
  const system = SYSTEM_TOPOLOGY.get(one.system);
  if (system !== undefined && topology === 'registry') {
    if (!isRCAEvalTopologyInitialized()) {
      throw new Error(
        `${one.id}: ${one.system} names a registered system but the topology registry is not initialised, so the fallback graph would be a ring instead of ${system} — call initRCAEvalTopology() before selecting cases`,
      );
    }
    return buildSystemCallGraph(system, one.id, one.services);
  }
  // A system the registry does not carry still needs a connected graph, and this is the same ring-connect the
  // RCAEval path falls back to: an isolated node would make the collision tree a single-element set and score
  // every case as "the only service I was shown".
  const nodes = new Map<string, ServiceNode>();
  const edges: CallEdge[] = [];
  for (const id of one.services) nodes.set(id, { id, name: id, namespace: one.system, labels: {} });
  for (let i = 0; i < one.services.length; i += 1) {
    const from = one.services[i]!;
    const to = one.services[(i + 1) % one.services.length]!;
    edges.push({ from, to, type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 });
  }
  return { nodes, edges, systemLoad: 0.5 };
}

/**
 * The suite-level id, in the shape the RCAEval loader uses so a dump from either corpus reads the same way.
 *
 * @param one - The case.
 * @returns `<dataset>_<system>_<category>_<case>`.
 */
export function benchmarkCaseId(one: CloudOpsCase): string {
  const parts = one.id.split('/');
  const ordinal = parts[parts.length - 1]!;
  return `${CLOUDOPSBENCH_SUITE}_${one.system}_${one.category}_${ordinal}`;
}

/**
 * Convert one case into the engine's input format.
 *
 * The caller has already established the case is scorable — {@link selectScorable} is the only intended source —
 * and this function asserts that rather than re-deciding it, because two places deciding what is scoreable is how
 * a denominator and a score come to disagree.
 *
 * @param one - A case {@link selectScorable} kept.
 * @param topology - The graph arm; `registry` is the only arm a published number may come from.
 * @returns The `BenchmarkCase` the runner consumes.
 */
export function toBenchmarkCase(
  one: CloudOpsCase,
  topology: CaseTopology = 'registry',
): BenchmarkCase {
  const truth = truthServiceOf(one.faultObject);
  if (truth === null) {
    throw new Error(
      `${one.id}: "${one.faultObject}" names no service, so it must not reach toBenchmarkCase`,
    );
  }
  if (one.alert === null) {
    throw new Error(`${one.id}: no injection time, so it must not reach toBenchmarkCase`);
  }
  const groundTruth: BenchmarkGroundTruth = {
    serviceId: truth,
    faultType: one.rootCause === '' ? one.faultTaxonomy : one.rootCause,
  };
  return {
    id: benchmarkCaseId(one),
    datasetName: CLOUDOPSBENCH_SUITE,
    callGraph: callGraphOf(one, topology),
    metrics: groupSeriesByService(one.series),
    injectTime: one.alert.startMs,
    groundTruth,
    // ── The log artefact: present in 754 of 754 case directories and read on the arm that asks for it ──────────
    //
    // The three states are kept distinct all the way to the engine — absent (this arm did not read it), `[]` (read,
    // and the file held nothing) and entries — because the log channel keys off the difference and a bridge that
    // flattened them would make "no post-onset evidence" and "no bridge" the same reading.
    //
    // `logsReadRows` carries the rows the bridge READ rather than the entries it kept, so a case whose every line
    // was undatable says so instead of reporting an empty file.
    ...(one.logs === undefined || one.logs === null
      ? {}
      : { logs: one.logs.entries, logsReadRows: one.logs.rows }),
    // `traces`, `failedTraceEdges`, `traceActivity`, `edgeLatency` and `alerts` are ABSENT, not empty: this corpus
    // publishes a metric table, a log table and an anomaly window, and an empty array would claim the artefacts
    // existed.
  };
}

/**
 * Where a case lives in the corpus's own two-level taxonomy.
 *
 * Owned here rather than by the scorer because it is a property of the CORPUS and not of a reading: the id a suite
 * carries is `<dataset>_<system>_<category>_<ordinal>`, which parses back to these two only by re-deriving the
 * convention, and a re-derivation is exactly how a table comes to be filed under the wrong cell.
 */
export interface CellTruth {
  readonly system: string;
  readonly category: string;
}

/** The scorable population, with every exclusion charged to exactly one reason. */
export interface ScorableSelection {
  /** The suite the runner scores, named {@link CLOUDOPSBENCH_SUITE}. */
  readonly suite: BenchmarkSuite;
  /** Case ids kept, in the input's order. */
  readonly kept: readonly string[];
  /** Case ids refused, keyed by the one reason each was charged to. */
  readonly refused: ReadonlyMap<ScorableRefusal, readonly string[]>;
  /** Benchmark case id → the corpus cell it belongs to, for every kept case. */
  readonly cells: ReadonlyMap<string, CellTruth>;
}

/**
 * Split a corpus into the cases this engine can be scored on and the reason each of the others cannot be.
 *
 * @param cases - Every case a {@link readCloudOpsCase} pass returned.
 * @param topology - The graph arm every kept case is built on.
 * @returns The suite, the kept ids, and the refusals by reason.
 */
export function selectScorable(
  cases: readonly CloudOpsCase[],
  topology: CaseTopology = 'registry',
): ScorableSelection {
  const kept: CloudOpsCase[] = [];
  const refused = new Map<ScorableRefusal, string[]>();
  const charge = (reason: ScorableRefusal, id: string): void => {
    const bucket = refused.get(reason);
    if (bucket === undefined) refused.set(reason, [id]);
    else bucket.push(id);
  };

  for (const one of cases) {
    if (one.series.length === 0) {
      charge('no-series', one.id);
      continue;
    }
    if (one.alert === null) {
      charge('no-alert-window', one.id);
      continue;
    }
    const truth = truthServiceOf(one.faultObject);
    if (truth === null) {
      charge('truth-outside-service-alphabet', one.id);
      continue;
    }
    if (!one.services.includes(truth)) {
      charge('truth-absent-from-own-series', one.id);
      continue;
    }
    kept.push(one);
  }

  const cells = new Map<string, CellTruth>();
  for (const one of kept)
    cells.set(benchmarkCaseId(one), { system: one.system, category: one.category });

  return {
    suite: {
      name: CLOUDOPSBENCH_SUITE,
      cases: kept.map((one) => toBenchmarkCase(one, topology)),
      totalCases: kept.length,
    },
    kept: kept.map((one) => one.id),
    refused,
    cells,
  };
}
