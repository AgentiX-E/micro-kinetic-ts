/**
 * What a metric/log/edge arm can and cannot reach of Cloud-OpsBench's evidence labels — as a table, measured.
 *
 * Iteration 360 priced the closure axis at "one recorded field: the per-call argument, ¥0, 678 of 754 cases". That
 * price was wrong, and it was wrong in the only way a price can be: it counted the RECORDING and not the REACH. A
 * milestone is closed when the arm emitted a call the label admits, and the label's twelve tools read Kubernetes
 * objects, while this engine reads metric series, log lines and call edges. Recording the argument would make the
 * scorer able to compare an argument; it would not make the arm able to produce the call.
 *
 * So the twelve rows are declared here, one per tool the corpus names, and the census is computed from them.
 * Measured over all 754 cases and 2 478 milestones: **472 milestones (19.0 %) are inside a metric/log/edge
 * surface, 0 cases have every milestone inside it, 363 have some, 391 have none.** The axis is not adoptable at
 * case level by this arm at any price short of a Kubernetes-object read surface, and that is now a number rather
 * than an opinion.
 *
 * ## The same module audits the competitor's own replay surface
 *
 * `tool_cache.json` is the pre-rendered view their agent reads, so a milestone whose every admissible use is
 * absent from it is a label their own published artefact cannot check. That audit needs the same matcher, so it
 * lives here beside the reach table: **2 379 of 2 478 (96.0 %), 655 of 754 cases in full**, with the residual
 * concentrated in two tools — `GetSourceCode` (98 uses) and `GetRecentLogs` (72) appear in NO case's cache.
 *
 * @module benchmarks/src/cloudopsbench-census
 */
import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';

import type { ClosureCall, ClosureLabel, ClosureToolUse } from './closure-labels.js';
import { matchesUse } from './closure-labels.js';
import type { CloudOpsCase } from './cloudopsbench-case.js';

/**
 * The twelve tools the corpus names, in the order its own documentation lists them.
 *
 * Pinned as a constant so a thirteenth tool fails in CI: a table of twelve rows that silently ignored a new tool
 * would report reach over a vocabulary the corpus no longer has, which is the failure mode a census exists to
 * prevent.
 */
export const CLOUDOPS_TOOLS = [
  'GetResources',
  'DescribeResource',
  'CheckServiceConnectivity',
  'GetAppYAML',
  'GetErrorLogs',
  'GetClusterConfiguration',
  'GetAlerts',
  'ListCodeFiles',
  'GetSourceCode',
  'GetRecentLogs',
  'CheckNodeServiceStatus',
  'GetServiceDependencies',
] as const;

/** One of the twelve. */
export type CloudOpsTool = (typeof CLOUDOPS_TOOLS)[number];

/** One row of the reach table. */
export interface SurfaceRow {
  readonly tool: CloudOpsTool;
  /** Whether an arm reading metric series, log lines and call edges can emit a call of this tool at all. */
  readonly producible: boolean;
  /** Why — stated per row, because a bare boolean is a claim nobody can check. */
  readonly why: string;
}

/**
 * The arm's declared observation surface, one row per corpus tool.
 *
 * `producible` is about the CHANNEL and not about the arguments: `logs <service>` prints the tail of that
 * service's error lines, which is what `GetErrorLogs` returns, while `metric <service>` prints a window summary of
 * a series and nothing in the corpus's twelve tools returns a series — which is why the engine's own best channel
 * is evidence for NOTHING in their vocabulary. That asymmetry is the whole finding.
 */
export const METRIC_LOG_EDGE_SURFACE: readonly SurfaceRow[] = [
  {
    tool: 'GetResources',
    producible: true,
    why: 'only for `resource_type` of services: `services` enumerates them; pods, deployments, endpoints, replicasets, nodes, secrets, quotas, events and volumes are objects this arm never lists',
  },
  {
    tool: 'DescribeResource',
    producible: false,
    why: 'an object description (status, events, containers) has no counterpart in a series, a log tail or an edge',
  },
  {
    tool: 'CheckServiceConnectivity',
    producible: false,
    why: 'a port-level dial is not a failing-interface count: `failed` reports edges, not sockets',
  },
  {
    tool: 'GetAppYAML',
    producible: false,
    why: 'the deployment manifest is configuration, and this arm carries no configuration',
  },
  {
    tool: 'GetErrorLogs',
    producible: true,
    why: '`logs <service>` prints that service\u2019s ERROR/FATAL lines from the injection on — the same channel',
  },
  {
    tool: 'GetClusterConfiguration',
    producible: false,
    why: 'cluster shape (versions, node pools, quotas) is a property no case telemetry carries',
  },
  {
    tool: 'GetAlerts',
    producible: false,
    why: 'the corpus derives alerts from metrics upstream; this arm reads the metrics themselves and has no alert feed',
  },
  {
    tool: 'ListCodeFiles',
    producible: false,
    why: 'a source tree listing is the code channel, which lives in AgentiX-E/code-analyzer and is not wired here',
  },
  {
    tool: 'GetSourceCode',
    producible: false,
    why: 'reading a source file is the code channel; same reason',
  },
  {
    tool: 'GetRecentLogs',
    producible: true,
    why: 'the same `logs <service>` read, without the ERROR filter the corpus applies to `GetErrorLogs`',
  },
  {
    tool: 'CheckNodeServiceStatus',
    producible: false,
    why: 'a node-scoped status for one service is a placement fact; the arm\u2019s series are service-scoped and carry no node',
  },
  {
    tool: 'GetServiceDependencies',
    producible: true,
    why: '`edges <service>` prints the caller/callee sets the tool returns',
  },
];

/** The resource kinds that mean "a service", in the spellings the corpus uses. */
const SERVICE_KINDS = new Set(['services', 'service', 'svc']);

/**
 * Whether the arm can emit a call that would satisfy one admissible use.
 *
 * The argument test is not decoration: `GetResources(resource_type=services, name=adservice)` asks for ONE
 * service's object, and `services` prints a directory of names. A declaration that called that producible would
 * put a milestone into the denominator that no call of this arm could ever close, which is the population defect
 * the register has refused five times.
 *
 * @param use - One admissible use from a label.
 * @param surface - The declared table; the default is this module's metric/log/edge surface.
 * @returns Whether a call of this arm could be evidence for it.
 */
export function canProduce(
  use: ClosureToolUse,
  surface: readonly SurfaceRow[] = METRIC_LOG_EDGE_SURFACE,
): boolean {
  const row = surface.find((one) => one.tool === use.tool);
  if (row === undefined || !row.producible) return false;
  if (use.tool !== 'GetResources') return true;
  const kinds = use.arguments.resource_type;
  if (kinds === undefined) return false;
  return kinds.some((kind) => SERVICE_KINDS.has(kind)) && use.arguments.name === undefined;
}

/** What the reach census found. */
export interface ReachCensus {
  readonly cases: number;
  readonly milestones: number;
  /** Milestones with at least one producible use. */
  readonly reachable: number;
  /** Cases whose every milestone is reachable — the only cases a case-level score could ever be computed on. */
  readonly casesAll: number;
  readonly casesSome: number;
  readonly casesNone: number;
  /** Producible uses by tool, most frequent first, ties by name. */
  readonly byTool: readonly (readonly [string, number])[];
}

/**
 * Count what of a label corpus lies inside the arm's observation surface.
 *
 * The three case counts are the point and are never collapsed into a mean: a corpus in which every case is
 * reachable and one in which none is support two different claims, and 472 of 2 478 milestones = 19.0 % is a
 * number that says nothing about whether a CASE can be scored.
 *
 * @param labels - Every label the corpus carries.
 * @param surface - The declared table.
 * @returns The counts, ready to be quoted.
 */
export function evidenceReach(
  labels: readonly ClosureLabel[],
  surface: readonly SurfaceRow[] = METRIC_LOG_EDGE_SURFACE,
): ReachCensus {
  const byTool = new Map<string, number>();
  let milestones = 0;
  let reachable = 0;
  let casesAll = 0;
  let casesSome = 0;
  let casesNone = 0;
  for (const label of labels) {
    let reached = 0;
    for (const milestone of label.milestones) {
      milestones += 1;
      const hits = milestone.uses.filter((use) => canProduce(use, surface));
      if (hits.length === 0) continue;
      reached += 1;
      for (const use of hits) byTool.set(use.tool, (byTool.get(use.tool) ?? 0) + 1);
    }
    reachable += reached;
    if (reached === label.milestones.length) casesAll += 1;
    else if (reached === 0) casesNone += 1;
    else casesSome += 1;
  }
  return {
    cases: labels.length,
    milestones,
    reachable,
    casesAll,
    casesSome,
    casesNone,
    byTool: [...byTool.entries()].sort(([a, na], [b, nb]) => nb - na || compareCasePaths(a, b)),
  };
}

/** One case's replay surface, as `tool_cache.json` states it. */
export interface ToolCache {
  /** The calls the cache can serve, parsed from `Tool:<json>` keys. */
  readonly entries: readonly ClosureCall[];
  /**
   * Tool names that appear under a SECOND key convention, with no argument JSON.
   *
   * Nineteen `CheckServiceConnectivity-<ns>-<svc>-<port>` keys and 204 bare `GetClusterConfiguration` keys are
   * written this way across the corpus, which is a defect in their harness rather than in the labels: a scorer
   * that keyed strictly on `Tool:{json}` would read those calls as absent and under-report their own coverage.
   * They are kept as a name set so only an argument-free use can be credited by one — the alternative, guessing
   * which arguments a dash-joined key encodes, would credit evidence nobody can show.
   */
  readonly bare: readonly string[];
  /** Keys that parsed as neither convention, counted so a format change is visible. */
  readonly unreadable: number;
}

/**
 * Read one `tool_cache.json` into calls.
 *
 * @param text - The file's contents.
 * @returns The surface, as calls plus the second-convention names.
 */
export function readToolCache(text: string): ToolCache {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { entries: [], bare: [], unreadable: 1 };
  }
  // An array is not this format: the file is an object of call keys, and a root that is a list would otherwise
  // parse into zero calls while reporting nothing wrong.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { entries: [], bare: [], unreadable: 1 };
  }
  const entries: ClosureCall[] = [];
  const bare = new Set<string>();
  let unreadable = 0;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    // The one non-call key the file carries; a stamp is not a read.
    if (key === 'collection_timestamp') continue;
    const cut = key.indexOf(':');
    if (cut < 0) {
      const name = key.split('-')[0]!;
      if (name !== '') bare.add(name);
      else unreadable += 1;
      continue;
    }
    try {
      const args = JSON.parse(key.slice(cut + 1)) as unknown;
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        unreadable += 1;
        continue;
      }
      entries.push({ tool: key.slice(0, cut), arguments: args as Record<string, unknown> });
    } catch {
      unreadable += 1;
    }
  }
  return { entries, bare: [...bare].sort(compareCasePaths), unreadable };
}

/** What the replay-surface audit found. */
export interface CacheConsistency {
  readonly cases: number;
  readonly uses: number;
  readonly satisfied: number;
  readonly milestones: number;
  readonly milestonesSatisfied: number;
  readonly casesAll: number;
  readonly casesSome: number;
  readonly casesNone: number;
  /** Unsatisfied uses by tool, most frequent first. */
  readonly missingByTool: readonly (readonly [string, number])[];
}

/**
 * Audit the corpus's labels against its own replay surface.
 *
 * This is a test of THEIR artefact, not of this engine, and it is the cheapest completeness check the programme
 * has ever run: it needs no cluster, no model and no key, because both sides of the comparison are files they
 * published.
 *
 * @param labels - The labels, keyed by case id.
 * @param caches - The replay surfaces, keyed by the same ids. A case with no cache contributes its milestones as
 *   unsatisfied and is counted in {@link CacheConsistency.casesNone}, which is what "the artefact cannot check
 *   this case" means.
 * @returns The audit.
 */
export function cacheConsistency(
  labels: readonly ClosureLabel[],
  caches: ReadonlyMap<string, ToolCache>,
): CacheConsistency {
  let uses = 0;
  let satisfied = 0;
  let milestones = 0;
  let milestonesSatisfied = 0;
  let casesAll = 0;
  let casesSome = 0;
  let casesNone = 0;
  const missing = new Map<string, number>();
  for (const label of labels) {
    const cache = caches.get(label.caseId) ?? { entries: [], bare: [], unreadable: 0 };
    let closed = 0;
    for (const milestone of label.milestones) {
      milestones += 1;
      let hit = false;
      for (const use of milestone.uses) {
        uses += 1;
        const matched =
          cache.entries.some((call) => matchesUse(call, use)) ||
          (cache.bare.includes(use.tool) && use.argumentKeys.length === 0);
        if (matched) {
          satisfied += 1;
          hit = true;
        } else {
          missing.set(use.tool, (missing.get(use.tool) ?? 0) + 1);
        }
      }
      if (hit) {
        milestonesSatisfied += 1;
        closed += 1;
      }
    }
    if (closed === label.milestones.length) casesAll += 1;
    else if (closed === 0) casesNone += 1;
    else casesSome += 1;
  }
  return {
    cases: labels.length,
    uses,
    satisfied,
    milestones,
    milestonesSatisfied,
    casesAll,
    casesSome,
    casesNone,
    missingByTool: [...missing.entries()].sort(
      ([a, na], [b, nb]) => nb - na || compareCasePaths(a, b),
    ),
  };
}

/** What the case census found: the comparable population, counted rather than recalled. */
export interface CaseCensus {
  readonly cases: number;
  /** Cases carrying `raw_data/metrics.csv` — the only input this engine reads. */
  readonly metricReadable: number;
  /** Cases carrying `tool_cache.json`. */
  readonly withToolCache: number;
  /** Cases whose `alert.json` states an anomaly window, i.e. cases that state an injection time. */
  readonly withAlert: number;
  /**
   * Metric-readable cases whose labelled service is one of the case's OWN series.
   *
   * The fence: `app/adservice` is expressible here only if the case's metrics name `adservice`. A case that
   * carries metrics but not its own answer would otherwise join the comparable population and charge the engine
   * for a name it was never shown.
   */
  readonly resolvable: number;
  readonly rows: { readonly min: number; readonly max: number };
  readonly services: { readonly min: number; readonly max: number };
  /** Per category: how many cases, and how many of those carry metrics. */
  readonly categories: readonly {
    readonly category: string;
    readonly cases: number;
    readonly metricReadable: number;
  }[];
}

/**
 * Count the corpus: population, readability, and whether the truth is expressible.
 *
 * @param cases - Every case the loader read.
 * @returns The census.
 */
export function summariseCases(cases: readonly CloudOpsCase[]): CaseCensus {
  const categories = new Map<string, { cases: number; metricReadable: number }>();
  let metricReadable = 0;
  let withToolCache = 0;
  let withAlert = 0;
  let resolvable = 0;
  let rowMin = Number.POSITIVE_INFINITY;
  let rowMax = 0;
  let serviceMin = Number.POSITIVE_INFINITY;
  let serviceMax = 0;
  for (const one of cases) {
    const bucket = categories.get(one.category) ?? { cases: 0, metricReadable: 0 };
    bucket.cases += 1;
    if (one.series.length > 0) {
      bucket.metricReadable += 1;
      metricReadable += 1;
      rowMin = Math.min(rowMin, one.metricsRows);
      rowMax = Math.max(rowMax, one.metricsRows);
      serviceMin = Math.min(serviceMin, one.services.length);
      serviceMax = Math.max(serviceMax, one.services.length);
      const cut = one.faultObject.indexOf('/');
      const named = cut > 0 ? one.faultObject.slice(cut + 1) : one.faultObject;
      if (one.faultObject.startsWith('app/') && one.services.includes(named)) resolvable += 1;
    }
    if (one.hasToolCache) withToolCache += 1;
    if (one.alert !== null) withAlert += 1;
    categories.set(one.category, bucket);
  }
  return {
    cases: cases.length,
    metricReadable,
    withToolCache,
    withAlert,
    resolvable,
    rows: {
      min: Number.isFinite(rowMin) ? rowMin : 0,
      max: rowMax,
    },
    services: {
      min: Number.isFinite(serviceMin) ? serviceMin : 0,
      max: serviceMax,
    },
    categories: [...categories.entries()]
      .map(([category, counts]) => ({ category, ...counts }))
      .sort((a, b) => compareCasePaths(a.category, b.category)),
  };
}
