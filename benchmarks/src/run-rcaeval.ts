/**
 * Real RCAEval benchmark — industry-standard per-system, per-dataset evaluation.
 *
 * I8: Topology-preserving fault graph with Pearson cross-service correlation
 * now integrated into TreePruner.buildFaultGraph() via buildTopologyFaultGraph().
 * RE2+RE3 cases with trace data benefit from the trace-topology augmentation, which
 * `rcaeval-corpus.ts` owns for every path that builds this corpus.
 *
 * Follows the RCAEval paper (arXiv:2412.17015) methodology:
 * - Cases grouped by benchmark system (OnlineBoutique/SockShop/TrainTicket)
 * - Cases grouped by dataset suite (RE1/RE2/RE3)
 * - Per-fault-type breakdown matching Table 6 format
 * - Results directly comparable with published baselines
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-rcaeval.ts [--data-dir <path>] [--suite re1|re2|re3] [--system ob|ss|tt] [--max-cases <n>]
 *   [--trace-weight <w>] [--log-weight <w>] [--temporal-weight <w>] [--onset-shape <shape>]
 *   [--stability-weight <w>] [--rank-normalization|--no-rank-normalization]
 *   [--diagnose-dump <path>]
 *
 * Every field this runner does not pin is the ENGINE's default, which is what makes
 * its per-cell results the golden reference for a shipped configuration — see
 * `benchmarks/__tests__/rcaeval-reported-config.test.ts` for the fields that ARE
 * pinned and why each one is allowed to be.
 *
 * @module benchmarks/run-rcaeval
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Container,
  DEFAULT_CLASSIFICATION_RULES,
  DI_TOKENS,
  RegexFaultClassifier,
} from '../../packages/core/src/index.js';
import type {
  FusionCasePrediction,
  RoutingProbeRecord,
} from '../../packages/kinetic/src/benchmarks/index.js';
import {
  analyzeRoutingProbe,
  BenchmarkRunner,
  computeFusionCeiling,
  computeFusionCeilingByCell,
  computePrismRanking,
  extractExceptionNames,
  RCAEvalLoader,
} from '../../packages/kinetic/src/benchmarks/index.js';
import type {
  BenchmarkCase,
  BenchmarkSuite,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import type {
  CasePrediction,
  RunResult,
} from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
// The suite-number fold. This file used to own it inline; it is now owned once, for both this path and
// the study's, because the two of them had implemented it with DIFFERENT conventions and the difference
// was recorded as an input defect for three runs (see the module's own header).
// The corpus assembly — the augmentation, the two direction-carrying inputs and the span activity — now
// lives in one owner, because this path and the study's had assembled it differently (this one pruned the
// graph from traces and the study never did).
import { assembleRCAEvalCase, formatCorpusLine, type LatencySource } from './rcaeval-corpus.js';
// The corpus traversal's ORDER, from its one owner: `readdirSync` order is unspecified, and this runner caps
// the corpus with `metas.slice(0, maxCases)`, so an unsorted walk made a capped run's population a property of
// the filesystem. See the module's docblock.
import { inCaseOrder } from '../../packages/kinetic/src/benchmarks/case-order.js';
import { discoverCaseMetas } from './case-corpus-walk.js';

import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { deriveAnchorCensus } from './anchor-census.js';
// The mode union, from the package that OWNS it — the same guard the CLI accepts its flag with and the same
// function the log census asks about admission, so one value means one thing along the whole chain.
import type { LogSignalMode } from '../../packages/tree/src/index.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';
// The latency-route census, from the module that owns the three views — and the SAME renderer the battery
// prints with, so the two artifacts' corpus lines are comparable across runs rather than merely similar. One
// renderer over two artifacts is what makes a candidate measured on one of them readable on the other.
import {
  directionGateLine,
  formatLatencyRoutes,
  summarizeLatencyRoutes,
  type LatencyRouteCensus,
  type LatencyRouteEntry,
} from './directional-evidence.js';
import {
  accumulateDualFamilyCensus,
  createDualFamilyCensus,
  formatDualFamilyCensusLine,
} from './dual-family-census.js';
import { DiagnoseDump, formatDiagnoseDumpLine } from './fse26-diagnose-dump.js';
import { renderDiagnosedCase } from './fse26-diagnose-sink.js';
import { formatFailedEdgeCoverageLine, summariseFailedEdgeCoverage } from './fse26-report.js';
import { buildMetricRows } from './rcaeval-metric-rows.js';
import {
  accumulateRiser,
  createRiserCensus,
  formatRiserCaseLine,
  formatRiserCensusLine,
} from './riser-census.js';
import { accumulateTermGap, createTermGapCensus, formatTermGapLine } from './term-gap-census.js';
import {
  accumulateTraceShare,
  createTraceShareCensus,
  formatTraceShareCensusLine,
} from './trace-share-census.js';
import {
  accumulateTraceVote,
  createTraceVoteCensus,
  formatTraceVoteLine,
} from './trace-vote-census.js';
import {
  accumulateTraceZ,
  createTraceZCensus,
  formatTraceZCaseLine,
  formatTraceZCensusLine,
} from './trace-z-census.js';
// The log-route census, from the module that owns it. `logWeight` is 1.0 and its map was empty on 719 of 735
// cases while the corpus supplied logs on all 360 RE2 and RE3 cases, and the four mechanisms that produce one
// empty map differ in everything a fix would depend on.
import {
  deriveLogRoute,
  formatLogRoutes,
  summarizeLogRoutes,
  type LogRouteCensus,
  type LogRouteEntry,
} from './log-route.js';
import {
  formatLossReport,
  formatRankingLadder,
  formatTermZeroes,
  summarizeLoss,
  summarizeTermZeroes,
  type LossRecord,
} from './loss-census.js';
import { parseRCAEvalArgs, type CliOptions } from './rcaeval-cli.js';
import {
  buildRCAEvalEngineOptions,
  formatSignalLine,
  type RCAEvalEngineOptions,
} from './rcaeval-engine-options.js';
import type { SemanticEnhancerConfig } from './rcaeval-semantic.js';
import {
  buildRCAEvalCallGraph,
  enhanceRCAEvalCallGraph,
  formatTopologyDiagnostic,
  initRCAEvalTopology,
  isRCAEvalTopologyInitialized,
} from './rcaeval-topology.js';
import { createSemanticConfig } from './semantic-config.js';

// ── Semantic Enhancement (optional, requires .env) ────────

/**
 * Load .env file if it exists (for API keys).
 * Hand-rolled to avoid external dependency — .env is gitignored.
 */
function loadEnvFile(): void {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ───────────────────────────────────────────────────

// ── CLI ───────────────────────────────────────────────────

// ── DI Assembly ───────────────────────────────────────────

function createContainer(engine: RCAEvalEngineOptions): Container {
  const container = new Container();
  container.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
  container.register(
    DI_TOKENS.RCA_ENGINE,
    () =>
      // Both arguments come from ONE call, so neither can carry a field the other lacks. The
      // hand-written topology literal that used to stand here restated four values — and the comment
      // above it claimed the first argument already carried them, which was true and useless: the
      // pruner's option type does NOT declare them, so it spread them into its own options and read
      // none of them, and this literal was the only path they reached the engine by.
      new TreePruner(engine.signals, engine.topology),
  );
  container.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());
  return container;
}

// ── System Identification ─────────────────────────────────

/** Parsed case metadata from directory name. */
interface CaseMeta {
  suite: 'RE1' | 'RE2' | 'RE3';
  system: 'OnlineBoutique' | 'SockShop' | 'TrainTicket' | 'Unknown';
  service: string;
  faultType: string;
  instance: number;
  dirPath: string;
}

function parseCaseDir(dirPath: string): CaseMeta | null {
  const name = basename(dirPath);

  // Pattern A: flat format — re{1-3}{ob|ss|tt}_{service}_{fault}_{instance}
  //   fault types include: cpu, mem, disk, delay, loss, socket
  //   and RE3 generic labels: f1, f2, f3, f4, f5
  const flatMatch = name.match(/^re([123])(ob|ss|tt)_(.+?)_([a-z0-9]+)_(\d+)$/i);
  if (flatMatch) {
    const suiteNum = flatMatch[1]!;
    const sysCode = flatMatch[2]!;
    return {
      suite: `RE${suiteNum}` as CaseMeta['suite'],
      system: sysCode === 'ob' ? 'OnlineBoutique' : sysCode === 'ss' ? 'SockShop' : 'TrainTicket',
      service: flatMatch[3]!,
      faultType: flatMatch[4]!.toLowerCase() as CaseMeta['faultType'],
      instance: parseInt(flatMatch[5]!, 10),
      dirPath,
    };
  }

  // Pattern B: nested format — any directory with metrics.json whose
  //   parent or grandparent chain contains re{1-3} and system codes.
  //   Used by HuggingFace datasets that unpack to nested layouts.
  //   e.g.: re3/OnlineBoutique/case_001, re3/ob/1, re2/ss/2
  const chain = dirPath.replace(/\\/g, '/').split('/');
  let suiteNum: string | undefined;
  let sysCode: string | undefined;

  for (let i = chain.length - 2; i >= 0; i--) {
    const segment = chain[i]!;
    // Try matching suite: re1, re2, re3 (case insensitive)
    const suiteM = segment.match(/^re([123])$/i);
    if (suiteM && !suiteNum) {
      suiteNum = suiteM[1]!;
      continue;
    }
    // Try matching system: ob, ss, tt, onlineboutique, sockshop, trainticket
    const sysM = segment.match(/^(ob|ss|tt|onlineboutique|sockshop|trainticket)$/i);
    if (sysM && !sysCode) {
      const s = sysM[1]!.toLowerCase();
      sysCode = s.length === 2 ? s : s === 'onlineboutique' ? 'ob' : s === 'sockshop' ? 'ss' : 'tt';
      break;
    }
  }

  if (!suiteNum || !sysCode) return null;

  const sysName: CaseMeta['system'] =
    sysCode === 'ob' ? 'OnlineBoutique' : sysCode === 'ss' ? 'SockShop' : 'TrainTicket';

  // Parse fault info from the directory name itself
  // Pattern: {service}_{faultType}_N or case_N or just N
  const svcFaultMatch = name.match(/^(.+?)_([a-z0-9]+)_(\d+)$/i);
  if (svcFaultMatch) {
    return {
      suite: `RE${suiteNum}` as CaseMeta['suite'],
      system: sysName,
      service: svcFaultMatch[1]!,
      faultType: svcFaultMatch[2]!.toLowerCase() as CaseMeta['faultType'],
      instance: parseInt(svcFaultMatch[3]!, 10),
      dirPath,
    };
  }

  const caseMatch = name.match(/^case_(\d+)$/i);
  const indexMatch = name.match(/^(\d+)$/);

  const instance = caseMatch
    ? parseInt(caseMatch[1]!, 10)
    : indexMatch
      ? parseInt(indexMatch[1]!, 10)
      : -1;

  if (instance < 0) return null;

  return {
    suite: `RE${suiteNum}` as CaseMeta['suite'],
    system: sysName,
    service: name,
    faultType: 'cpu' as CaseMeta['faultType'], // best-effort default
    instance,
    dirPath,
  };
}

// ── Case Discovery ────────────────────────────────────────

/**
 * Every readable case under `dataDir`, in the corpus's CANONICAL order.
 *
 * The traversal and its order live in `case-corpus-walk.ts`, and this function is the composition — walk, then
 * parse — because the ORDER is load-bearing here and not merely tidy: `runSuiteForSystem` caps the corpus with
 * `metas.slice(0, maxCases)`, so an unsorted walk made a capped run's population a property of the filesystem.
 * `readdirSync`'s order is unspecified; this file was one of only two traversals in the repository that
 * returned it raw, and the other was `run-ablation.ts`'s — i.e. exactly the two whose sliced population is
 * published. The siblings (`run-fse26.ts`, `run-optimize.ts`, `scripts/run-prism.ts`, the four dump scripts)
 * all canonicalised, which is how the class survived: it looked like a convention.
 *
 * @param dataDir - The corpus root.
 * @returns Parsed cases, canonical, with directories `parseCaseDir` cannot read dropped.
 */
function discoverAllCases(dataDir: string): CaseMeta[] {
  if (!existsSync(dataDir)) {
    console.error(`Data directory not found: ${dataDir}`);
    return [];
  }
  return discoverCaseMetas({ root: dataDir, marker: 'metrics.json', parse: parseCaseDir });
}

/**
 * Scan dataDir and return all directories with metrics.json, split into
 * matched (parseable) and unmatched (present but regex/chain fails).
 * Diagnostic-only — does not affect benchmark results.
 */
function discoverAllDirectoriesWithMetrics(dataDir: string): {
  totalWithMetrics: number;
  matched: string[];
  unmatched: string[];
} {
  const matched: string[] = [];
  const unmatched: string[] = [];

  if (!existsSync(dataDir)) return { totalWithMetrics: 0, matched, unmatched };

  const queue = [dataDir];
  while (queue.length > 0) {
    const current = queue.shift()!;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      const hasMetrics = entries.some((e) => e.isFile() && e.name === 'metrics.json');
      if (hasMetrics) {
        const rel = current.replace(dataDir + '/', '').replace(dataDir, '');
        if (parseCaseDir(current)) {
          matched.push(rel);
        } else {
          unmatched.push(rel);
        }
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          queue.push(join(current, entry.name));
        }
      }
    } catch {
      /* skip */
    }
  }

  // Canonical, so this diagnostic's two lists are a function of the corpus rather than of the filesystem: a
  // report a reader diffs between runs is only a report if its order is stable. Same convention as the walk's.
  return {
    totalWithMetrics: matched.length + unmatched.length,
    matched: inCaseOrder(matched, (rel) => rel),
    unmatched: inCaseOrder(unmatched, (rel) => rel),
  };
}

// ── Loader (with comprehensive error reporting) ───────────

interface LoadStats {
  cases: BenchmarkCase[];
  errors: string[];
  errorSamples: Map<string, number>; // error message → count
  /** Number of cases that got per-service trace-activity counts computed. */
  traceActivityCases: number;
  traceStats: {
    total: number;
    pruned: number;
    avgEdgesBefore: number;
    avgEdgesAfter: number;
    /** Raw traces.csv header (comma-joined column names). */
    header: string;
  };
  /** Semantic enhancement statistics (only when enhancer is configured). */
  semanticStats: {
    totalServices: number;
    semanticallyResolved: number;
    embeddingResolved: number;
    llmResolved: number;
    exactMatched: number;
  };
  /**
   * The latency-route census over this group's cases, from the owner's own summariser.
   *
   * Reported by {@link reportLatencyRoutes} with the owner's own renderer. It exists because the corpus is an
   * AXIS of this runner since iteration 89: a run can rank on the `shipped`, `capped` or `whole-file` view, and
   * an artifact that named the choice without counting what the chosen view HELD could not distinguish a corpus
   * that supplied rows from one that supplied none — the two are the same nine cells and different causes.
   */
  latencyRoutes: LatencyRouteCensus;
  /**
   * The SAME population, addressable by the case it describes.
   *
   * The census above is the population reduced to counts, and a sum cannot name its own rows: a reader of the
   * artifact can see that RE3 TrainTicket supplied 2006 rows and cannot ask which of its thirty cases carried
   * them. The channel's remaining question is a ROUTING one — whether a case wants the whole-file view or the
   * published composition — and its unit is the case, so the supply is kept beside the summary rather than
   * discarded one line after it is computed. The two cannot disagree about which cases exist: the summary is
   * derived FROM this map, and this map is the only collection that holds the entries.
   */
  latencyRouteByCaseId: ReadonlyMap<string, LatencyRouteEntry>;
  /**
   * The log channel's four levels over this group's cases, from this module's own summariser.
   *
   * `logWeight` is 1.0 and its input was an empty map on 719 of the run's 735 cases, while the same artifact
   * reports that the corpus supplied logs on all 270 RE2 and all 90 RE3 cases. `INPUT_MAP_EMPTY` cannot say which
   * of four mechanisms produced that, and this is the line that can: how many rows were read, how many the owner
   * retained, how many the MODE's gate admits, and how many of those name a graph node. Reported by
   * {@link reportLogRoutes} with the owner's own renderer.
   */
  logRoutes: LogRouteCensus;
  /** Log-loading diagnostics (RE2/RE3): whether logs flow to the engine. */
  logStats: {
    /** Cases carrying at least one log entry. */
    total: number;
    /** Total ERROR/FATAL entries (after severity derivation). */
    errorEntries: number;
    /** Raw logs.csv header (comma-joined column names). */
    header: string;
    /** First log entry's timestamp (ms), level, service, and message sample. */
    sampleTs: number;
    sampleLevel: string;
    sampleService: string;
    sampleMsg: string;
    /** ERROR/FATAL entries flagged as stack traces (code-level evidence). */
    stackTraceEntries: number;
    /** First stack-trace entry's message prefix (eyeball the gate's target). */
    sampleStackTraceMsg: string;
    /** Distinct exception/error type names sampled from ERROR/FATAL messages. */
    exceptionNamesSample: string;
  };
}

/**
 * Load a single case and build its call graph.
 *
 * Extracted as a separate function so the caller can hold only the
 * minimal required data (BenchmarkCase) and release the raw RCAEvalCase
 * (which may contain duplicate metric / trace arrays).
 */
async function loadSingleCase(
  meta: CaseMeta,
  loader: RCAEvalLoader,
  latencyFrom: LatencySource,
  semanticConfig?: SemanticEnhancerConfig,
  computeTraceActivity = false,
): Promise<{
  benchCase: BenchmarkCase;
  traceUsed: boolean;
  pruned: boolean;
  edgesBefore: number;
  edgesAfter: number;
  /** Log rows the loader read, before the owner's retention filter. See `assembleRCAEvalCase`. */
  logRowsRead: number;
  /**
   * This case's contribution to the latency-route census.
   *
   * Returned rather than dropped, and that is a defect being repaired rather than a field being added: the
   * assembler computes it on every case, the BATTERY reports it, and this path — the one whose cells are
   * published and whose corpus axis iteration 89 made dispatchable — threw it away. The consequence was not
   * cosmetic: a run with `--latency-view whole-file` printed `corpus: latencyView=whole-file` beside an
   * unchanged ranking, which is EXACTLY what a view that was supplied and INERT looks like, so the
   * floor/corpus decision could not be taken on an artifact that could not show its corpus carried anything.
   */
  latencyRoute: LatencyRouteEntry;
}> {
  const rawCase = loader.loadCase(meta.dirPath);
  const serviceIds = Object.keys(rawCase.metrics);

  // Use semantic-enhanced call graph when available
  let callGraph;
  if (semanticConfig?.embeddingProvider && isRCAEvalTopologyInitialized()) {
    callGraph = await enhanceRCAEvalCallGraph(rawCase.benchmark, serviceIds);
  } else {
    callGraph = buildRCAEvalCallGraph(rawCase.benchmark, serviceIds);
  }

  const suiteName =
    meta.suite === 'RE1'
      ? ('rcaeval-re1' as const)
      : meta.suite === 'RE2'
        ? ('rcaeval-re2' as const)
        : ('rcaeval-re3' as const);

  // The corpus, assembled by the ONE owner both this path and the study's call. `augmentFromTraces` is the
  // shipped value, stated rather than implied, because this path IS the published corpus and the option is
  // what makes that a decision instead of an omission.
  //
  // `latencyFrom` is now the PARSED option rather than a literal `'shipped'`, and the literal was the defect:
  // the shipped view's `edgeLatency` is an empty array on every corpus (the capped span list is truncated
  // before the injection window, and the unit defect the same expression carries is masked by that cap), so
  // the largest weight in the ranking multiplied nothing in every published cell — and the one axis that can
  // supply it was reachable from the ABLATION runner only, whose numbers are the all-flags-off battery rather
  // than the nine cells the kill criterion judges. A candidate measurable on one instrument and judged on
  // another has an undecidable other half. The parser's default is the shipped view, so the published cells
  // are reproduced by a bare dispatch; what changed is that they can now be MOVED. See
  // `docs/latency-channel-views.md`.
  const assembled = await assembleRCAEvalCase(loader, rawCase, meta, callGraph, suiteName, {
    augmentFromTraces: true,
    traceActivity: computeTraceActivity,
    latencyFrom,
  });

  // Free trace data after augmentation — prevents OOM on RE2 (270+ cases each with 100K+ trace spans). The
  // benchmark runner does not use `traces` downstream: the topology is already augmented and both
  // direction-carrying inputs are already derived.
  rawCase.traces = undefined;

  return {
    benchCase: assembled.benchCase,
    traceUsed: assembled.traceUsed,
    pruned: assembled.pruned,
    edgesBefore: assembled.edgesBefore,
    edgesAfter: assembled.edgesAfter,
    logRowsRead: assembled.logRowsRead,
    latencyRoute: assembled.latencyRoute,
  };
}

/**
 * Load and build benchmark cases, with optional semantic enhancement.
 *
 * When ZHIPU_API_KEY is in the environment, uses real embedding-based
 * semantic alignment; falls back to exact match + ring-connect otherwise.
 *
 * **Memory**: Each raw RCAEvalCase is dropped after conversion so that
 * duplicate metric / trace arrays are not retained.  For RE2/RE3 with
 * 270+ cases × 1000s of spans this cuts peak memory by ~40 %.
 */
async function loadCases(
  metas: CaseMeta[],
  loader: RCAEvalLoader,
  maxCases: number,
  latencyFrom: LatencySource,
  /**
   * The run's log mode, needed HERE rather than at the print site.
   *
   * The log census asks the same Level-1 gate the scorer does, and that gate is a function of the mode — so a
   * census computed after the run would have to re-derive which mode it ran under, which is the defect
   * `cli-argument-rejection-audit.md` records in the value direction. It sits beside `latencyFrom` because the two
   * are both the run's INPUT configuration: one names which view of `edgeLatency` the corpus carries, the other
   * which rows the log term admits.
   */
  logSignalMode: LogSignalMode,
  semanticConfig?: SemanticEnhancerConfig,
  computeTraceActivity = false,
): Promise<LoadStats> {
  const loaded: BenchmarkCase[] = [];
  const errors: string[] = [];
  const errorSamples = new Map<string, number>();
  let traceActivityCases = 0;
  const selected = maxCases > 0 ? metas.slice(0, maxCases) : metas;
  let traceCount = 0,
    prunedCount = 0,
    edgesBeforeSum = 0,
    edgesAfterSum = 0;
  let semTotalServices = 0,
    semResolved = 0,
    semEmbedding = 0,
    semLLM = 0,
    semExact = 0;
  let logCases = 0,
    logErrorEntries = 0;
  let logSampleTs = 0,
    logSampleLevel = '',
    logSampleService = '',
    logSampleMsg = '';
  let logSampleCaptured = false;
  let logStackTraceEntries = 0;
  let logSampleStackTraceMsg = '';
  let logStackTraceSampleCaptured = false;
  const exceptionNamesSeen = new Set<string>();
  const failedEdgeCases: Array<{
    failedTraceEdges?: BenchmarkCase['failedTraceEdges'];
    metricKeys: ReadonlySet<string>;
  }> = [];
  /**
   * The latency-route census's population, one entry per case, KEYED BY THE CASE.
   *
   * A map rather than an array because the census is documented per case and read per case: the loss-census row
   * below takes its own case's entry, and an array indexed by the loader's iteration order would be a second
   * order the two artifacts have to agree about. It is also the ONE collection the summariser reads, so the
   * printed counts and the per-case rows are the same population by construction rather than by agreement.
   */
  const latencyRouteByCaseId = new Map<string, LatencyRouteEntry>();
  /**
   * The log channel's population, one entry per assembled case.
   *
   * An ARRAY rather than the latency census's keyed map, and the difference is not an inconsistency: the latency
   * entries are keyed because the loss census joins on `caseId` to carry each case's own supply, while the log
   * census is read as a POPULATION — its question is "which of the four mechanisms emptied the tier on this
   * system", which is a property of the set. A key nothing looks up would be a second index to keep true.
   */
  const logRouteEntries: LogRouteEntry[] = [];

  for (const meta of selected) {
    try {
      const { benchCase, traceUsed, pruned, edgesBefore, edgesAfter, logRowsRead, latencyRoute } =
        await loadSingleCase(meta, loader, latencyFrom, semanticConfig, computeTraceActivity);
      // …and it is keyed here, in the same iteration that appends the case to `loaded`, which is what makes the
      // lookup at the loss-census row total: every case in `cases` was pushed after its entry was set.
      latencyRouteByCaseId.set(benchCase.id, latencyRoute);
      // The log census, taken on the case the ENGINE receives — `benchCase.logs` is the retained array, and the
      // node set is the case's own graph, so a row whose service the graph does not contain is counted as OFF
      // GRAPH rather than silently dropped.
      logRouteEntries.push(
        deriveLogRoute(
          benchCase.logs,
          new Set(benchCase.callGraph.nodes.keys()),
          logSignalMode,
          logRowsRead,
        ),
      );
      if (benchCase.traceActivity) traceActivityCases++;

      // Collect semantic stats from diagnostic labels on the call graph
      const firstNode = benchCase.callGraph.nodes.values().next().value;
      const diagLabels = firstNode?.labels;
      if (diagLabels?._diag_semantic) {
        const resolved = parseInt(diagLabels._diag_semantic, 10) || 0;
        const emb = parseInt(diagLabels._diag_embedding ?? '0', 10) || 0;
        const llm = parseInt(diagLabels._diag_llm ?? '0', 10) || 0;
        // Use benchCase.callGraph.node count as a proxy for total services;
        // it mirrors the original serviceIds length from rawCase.metrics.
        const svcCount = benchCase.callGraph.nodes.size;
        semTotalServices += svcCount;
        semResolved += resolved;
        semEmbedding += emb;
        semLLM += llm;
        semExact += svcCount - resolved;
      }

      if (traceUsed) traceCount++;
      if (pruned) prunedCount++;
      edgesBeforeSum += edgesBefore;
      edgesAfterSum += edgesAfter;

      // ── Log-loading diagnostics ──
      // Count ERROR/FATAL entries and capture the first log line so the
      // benchmark output can reveal whether logs reach the engine and whether
      // severity derivation (message-based) is actually producing errors.
      //
      // `logCases` is counted from `logRowsRead`, the loader's own pre-filter count, and NOT from the array
      // the case now holds: the owner retains only ERROR/FATAL rows, so counting the retained array would
      // report "cases with ERROR/FATAL logs" under the label "cases with logs" — a false statement about the
      // corpus for any case whose log file carries only INFO lines.
      if (logRowsRead > 0) logCases++;
      const caseLogs = benchCase.logs;
      if (caseLogs && caseLogs.length > 0) {
        for (const l of caseLogs) {
          if (l.level === 'ERROR' || l.level === 'FATAL') {
            logErrorEntries++;
            if (l.isStackTrace) {
              logStackTraceEntries++;
              if (!logStackTraceSampleCaptured) {
                logStackTraceSampleCaptured = true;
                logSampleStackTraceMsg = l.message.slice(0, 120);
              }
            }
            // Sample the distinct exception/error TYPE names so the benchmark
            // can discriminate logic exceptions (code-level fault) from
            // connectivity exceptions (resource cascade) — the next gate's axis.
            for (const name of extractExceptionNames(l.message)) {
              if (exceptionNamesSeen.size < 12 && !exceptionNamesSeen.has(name)) {
                exceptionNamesSeen.add(name);
              }
            }
          }
        }
        if (!logSampleCaptured) {
          logSampleCaptured = true;
          logSampleTs = caseLogs[0]!.timestamp;
          logSampleLevel = caseLogs[0]!.level;
          logSampleService = caseLogs[0]!.service;
          logSampleMsg = caseLogs[0]!.message.slice(0, 80);
        }
      }

      loaded.push(benchCase);
      // One compact projection per case for the failed-edge coverage counter: the
      // metric KEYS only, because a case's series are large and are released after
      // scoring. `toFaultGraphOptions` forwards `failedTraceEdges` for every caller,
      // and this is what reports whether the field it forwards is ever populated.
      failedEdgeCases.push({
        failedTraceEdges: benchCase.failedTraceEdges,
        metricKeys: new Set(benchCase.callGraph.nodes.keys()),
      });

      // Yield + GC every 10 cases during loading.  Each RE2 case holds
      // a call graph with Zhipu embedding vectors (2048 dim × services).
      // Without periodic GC the heap fragments and exceeds the 7 GB limit
      // on public GitHub runners.
      if (loaded.length % 10 === 0) {
        if (typeof globalThis.gc === 'function') globalThis.gc();
        await new Promise((r) => setTimeout(r, 5));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${meta.dirPath}: ${errMsg}`);
      const shortMsg = errMsg.substring(0, 60);
      errorSamples.set(shortMsg, (errorSamples.get(shortMsg) ?? 0) + 1);
    }
  }

  // Printed UNCONDITIONALLY, like the FSE'26 run's own line and for the same reason: a run
  // whose direction signal received nothing must be indistinguishable from one that
  // received everything only in the NUMBERS, never in the log. Until this line existed the
  // golden half had no way to say that the channel it was reporting as 0.000 had never
  // been fed at all.
  if (failedEdgeCases.length > 0) {
    console.log(`  ${formatFailedEdgeCoverageLine(summariseFailedEdgeCoverage(failedEdgeCases))}`);
  }

  return {
    cases: loaded,
    errors,
    errorSamples,
    traceActivityCases,
    latencyRoutes: summarizeLatencyRoutes([...latencyRouteByCaseId.values()]),
    latencyRouteByCaseId,
    logRoutes: summarizeLogRoutes(logRouteEntries),
    traceStats: {
      total: traceCount,
      pruned: prunedCount,
      avgEdgesBefore: edgesBeforeSum / Math.max(1, selected.length),
      avgEdgesAfter: edgesAfterSum / Math.max(1, selected.length),
      header: loader.lastTraceHeader,
    },
    semanticStats: {
      totalServices: semTotalServices,
      semanticallyResolved: semResolved,
      embeddingResolved: semEmbedding,
      llmResolved: semLLM,
      exactMatched: semExact,
    },
    logStats: {
      total: logCases,
      errorEntries: logErrorEntries,
      header: loader.lastLogHeader,
      sampleTs: logSampleTs,
      sampleLevel: logSampleLevel,
      sampleService: logSampleService,
      sampleMsg: logSampleMsg,
      stackTraceEntries: logStackTraceEntries,
      sampleStackTraceMsg: logSampleStackTraceMsg,
      exceptionNamesSample: [...exceptionNamesSeen].join(', '),
    },
  };
}

// ── Output — Industry-Standard Table ──────────────────────

/**
 * Print a table in the RCAEval paper format:
 *
 *   Method | Metric | CPU | MEM | DISK | SOCKET | DELAY | LOSS | AVERAGE
 */
function printResultsTable(
  systemName: string,
  suiteName: string,
  results: Map<string, RunResult>,
  faultTypes: string[],
): void {
  // Header
  console.log('');
  console.log(`${'═'.repeat(80)}`);
  console.log(
    `║  ${systemName.padEnd(30)} ${suiteName.padEnd(15)} ${'Micro-Kinetic'.padEnd(20)} ║`,
  );
  console.log(`${'═'.repeat(80)}`);

  // Column headers
  let header = '║ Method              | Metric |';
  for (const ft of faultTypes) header += ` ${ft.toUpperCase().padEnd(6)} |`;
  header += ' AVERAGE ║';
  console.log(header);

  console.log(`${'═'.repeat(80)}`);

  // Metric rows: AC@1, Avg@5, LA, TA — one field each, named once in `rcaeval-metric-rows`.
  // Until that module existed the loop below read `perFaultType[ft].accuracy` for EVERY row and used the
  // metric's key only for its LABEL, so the four rows printed one number: `Avg@5`, `LA` and `TA` were
  // the `AC@1` column reprinted on every published cell.
  const metricRows = buildMetricRows(faultTypes, (ft) => {
    const r = results.get(ft);
    return r?.perFaultType.get(ft);
  });
  for (const metric of metricRows) {
    let row = `║ Micro-Kinetic       | ${metric.label} |`;
    for (const cell of metric.cells) {
      row += cell === null ? '   N/A |' : ` ${(cell * 100).toFixed(1).padStart(5)}% |`;
    }
    // The published convention is the mean over the CELLS printed, not over the cases — the two coincide
    // only when every fault type holds the same number of cases, which is RE1 and is not RE2 or RE3. The
    // mean now comes from the row that owns it, so a row cannot be averaged over a different population
    // than the one it printed.
    row += ` ${(metric.average * 100).toFixed(1).padStart(5)}% ║`;
    console.log(row);
  }

  console.log(`${'═'.repeat(80)}`);
}

/**
 * Print per-case diagnostic data for the first N failing cases.
 *
 * Shows ground-truth anomaly score vs max, whether GT is in call graph,
 * and top-K predictions with confidence/depth.
 */
function printFailureDiagnostics(
  systemName: string,
  suiteName: string,
  results: Map<string, RunResult>,
): void {
  const MAX = 5;
  let total = 0;

  for (const [_ft, r] of results) {
    const failing = r.failures.filter((f) => f.diag);
    if (failing.length === 0) continue;
    if (total >= MAX * results.size) break;

    const show = Math.min(MAX, failing.length);
    if (total === 0) {
      console.log(
        `\n── Failure Diagnostics: ${systemName}/${suiteName} (top ${show}/fault type) ──`,
      );
    }

    for (let i = 0; i < show && total < MAX * results.size; i++, total++) {
      const f = failing[i]!;
      const d = f.diag!;
      console.log(`  Case: ${f.caseId}`);
      console.log(`    Expected: ${f.expectedService}  →  Predicted: ${f.actualTop ?? 'none'}`);
      console.log(
        `    GT anomaly=${d.gtAnomaly.toFixed(4)}  max=${d.maxAnomaly.toFixed(4)}  inGraph=${d.gtInGraph}  edges=${d.edges}`,
        // Where the truth sits in the FULL ranking, beside how long that ranking is. A rank of `0` means the
        // truth is not a candidate at all — a retrieval failure, which no reweighting can address — and the
        // denominator is what turns "deep" into a distance.
        `    GT rank=${d.gtRank === 0 ? 'ABSENT' : d.gtRank} of ${d.candidateCount}`,
      );
      if (d.gtMetric || (d.gtMetricHead?.length ?? 0) > 0) {
        console.log(
          `    GT metric=${d.gtMetric ?? '?'} head=[${(d.gtMetricHead ?? []).join(',')}] tail=[${(d.gtMetricTail ?? []).join(',')}]`,
        );
      }
      if (d.gtDominantLabel) {
        console.log(
          `    GT dominant=${d.gtDominantLabel} head=[${(d.gtDominantHead ?? []).join(',')}] tail=[${(d.gtDominantTail ?? []).join(',')}]`,
        );
      }
      if (d.gtBreakdown) {
        console.log(`    GT breakdown=${d.gtBreakdown}`);
      }
      if ((d.gtTransientSkipped ?? []).length > 0) {
        console.log(`    GT transientSkipped=[${d.gtTransientSkipped!.join(',')}]`);
      }
      if (d.topAnomaly && d.topAnomaly.length > 0) {
        console.log(
          `    topAnomaly: ${d.topAnomaly.map((t) => `${t.serviceId}(${t.score.toFixed(3)})`).join(' | ')}`,
        );
      }
      if (d.top1MetricLabel) {
        console.log(
          `    top1 metric=${d.top1MetricLabel} head=[${(d.top1MetricHead ?? []).join(',')}] tail=[${(d.top1MetricTail ?? []).join(',')}]`,
        );
      }
      if (d.top1Breakdown) {
        console.log(`    top1 breakdown=${d.top1Breakdown}`);
      }
      if ((d.top1TransientSkipped ?? []).length > 0) {
        console.log(`    top1 transientSkipped=[${d.top1TransientSkipped!.join(',')}]`);
      }
      if (d.gtOnset !== undefined && d.topOnset !== undefined) {
        console.log(
          `    onset GT=${d.gtOnset} top1=${d.topOnset} (${d.gtOnset < d.topOnset ? 'source earlier ✓' : d.gtOnset > d.topOnset ? 'source later ✗' : 'tie'})`,
        );
      }
      if (d.gtInjectDelay !== undefined && d.topInjectDelay !== undefined) {
        const gtD = d.gtInjectDelay < 0 ? 'undef' : d.gtInjectDelay;
        const topD = d.topInjectDelay < 0 ? 'undef' : d.topInjectDelay;
        const verdict =
          d.gtInjectDelay < 0 || d.topInjectDelay < 0
            ? 'undetermined'
            : d.gtInjectDelay < d.topInjectDelay
              ? 'source earlier ✓'
              : d.gtInjectDelay > d.topInjectDelay
                ? 'source later ✗'
                : 'tie';
        console.log(`    injectDelay GT=${gtD} top1=${topD} (${verdict})`);
      }
      if (d.gtLogScore !== undefined || d.topLogScore !== undefined) {
        console.log(
          `    logScore GT=${d.gtLogScore?.toFixed(3) ?? '-'} top1=${d.topLogScore?.toFixed(3) ?? '-'}`,
        );
      }
      if (d.gtRatioContrib !== undefined || d.topRatioContrib !== undefined) {
        console.log(
          `    ratioContrib GT=${d.gtRatioContrib?.toFixed(3) ?? '-'} top1=${d.topRatioContrib?.toFixed(3) ?? '-'}`,
        );
      }
      if (d.gtTopoSource !== undefined || d.topTopoSource !== undefined) {
        console.log(
          `    topoSource GT=${d.gtTopoSource?.toFixed(3) ?? '-'} top1=${d.topTopoSource?.toFixed(3) ?? '-'}`,
        );
      }
      // Trace span-activity rise diagnostics. The signal awards one vote to the
      // UNIQUE riser satisfying `pre >= 500` AND `post/pre >= 1.15` AND
      // `post >= 1` (see DEFAULT_TRACE_ACTIVITY_OPTIONS), so printing the raw
      // pre/post/ratio triple for the ground truth and for the highest-ratio
      // service reveals WHY the vote landed where it did: a GT that misses a
      // threshold is a RECALL failure, while a qualifying non-GT riser is a
      // PRECISION failure.
      if (d.gtTraceActivity !== undefined || d.topTraceActivity !== undefined) {
        const gt = d.gtTraceActivity;
        const top = d.topTraceActivity;
        console.log(
          `    traceActivity GT=${gt ? `pre=${gt.pre} post=${gt.post} ratio=${gt.ratio.toFixed(3)}` : '-'}` +
            ` top=${top ? `${top.service} pre=${top.pre} post=${top.post} ratio=${top.ratio.toFixed(3)}` : '-'}`,
        );
      }
      console.log(`    Reason: ${f.reason}`);
      // Rendered by the module that owns the contract: the printed number is the value the ranking sorted
      // by, so the line can be checked against itself. It used to print `confidence` — a display value that
      // folds in depth and error-bound penalties and therefore need not decrease with rank — which put a
      // number in the score's position that the order did not come from.
      console.log(formatRankingLadder(d.topK));
    }
  }
}

/**
 * Log comprehensive error statistics for a group's load failures.
 * Shows both deduplicated error patterns and individual samples.
 */
function reportLoadErrors(systemName: string, suiteName: string, stats: LoadStats): void {
  const { errors, errorSamples } = stats;
  if (errors.length === 0) return;

  console.log(`\n┌── Load Errors: ${systemName}/${suiteName} (${errors.length} total)`);

  // Deduplicated error patterns (sorted by frequency)
  const sorted = [...errorSamples.entries()].sort((a, b) => b[1] - a[1]);
  for (const [pattern, count] of sorted) {
    const pct = ((count / errors.length) * 100).toFixed(0);
    console.log(`│  [${count}x, ${pct}%] ${pattern}`);
  }

  // Show first few individual errors for diagnosis
  if (errors.length > 0) {
    console.log(`│  --- Samples ---`);
    for (const e of errors.slice(0, 5)) {
      const parts = e.split(': ');
      const dirName = parts.length > 1 ? basename(parts[0]!) : parts[0]!;
      const msg = parts.slice(1).join(': ');
      console.log(`│  ${dirName}: ${msg}`);
    }
    if (errors.length > 5) {
      console.log(`│  ... and ${errors.length - 5} more`);
    }
  }

  console.log(`└${'─'.repeat(50)}`);
}

/**
 * Log trace topology pruning diagnostics.
 */
function reportTraceDiagnostics(systemName: string, suiteName: string, stats: LoadStats): void {
  if (stats.traceStats.total > 0) {
    const { total, pruned, avgEdgesBefore, avgEdgesAfter, header } = stats.traceStats;
    const reduction =
      avgEdgesBefore > 0
        ? (((avgEdgesBefore - avgEdgesAfter) / avgEdgesBefore) * 100).toFixed(0)
        : '0';
    console.log(
      `  [trace] ${total}/${stats.cases.length} cases with traces, ` +
        `${pruned} pruned, avg edges: ${avgEdgesBefore.toFixed(0)} → ${avgEdgesAfter.toFixed(0)} ` +
        `(${reduction}% reduction)`,
    );
    if (header) console.log(`  [trace] header: ${header}`);
  } else if (stats.cases.length > 0) {
    console.log(`  [trace] No trace data available for ${stats.cases.length} cases`);
  }
}

/**
 * Report the latency-route census: whether the corpus the run ranked on carried a latency channel at all.
 *
 * The lines are the OWNER's, printed verbatim rather than re-indented into this report's style, because the
 * battery prints the same lines from the same function and the two artifacts are read against each other: a
 * candidate measured in the battery is compared with the published cells, and the comparison is only possible
 * while both say "which view, how many rows, which verdict" in the same words. Re-rendering here would be the
 * second spelling of one fact — and the verdict arms (`STARVED`, `CAP TRUNCATES`) are the renderer's to choose,
 * not this runner's.
 *
 * It runs beside {@link reportTraceDiagnostics} because the three views come out of the same spans: that
 * function reports what the pruning did to the GRAPH, and this one reports what the assembly did to the
 * CHANNEL.
 */
function reportLatencyRoutes(systemName: string, stats: LoadStats, opts: CliOptions): void {
  for (const line of formatLatencyRoutes(stats.latencyRoutes, systemName)) console.log(line);
  // The census says how many rows each view supplied; THIS says whether the direction term can read one. The
  // two are one sentence and were printed as two paragraphs: a run on the shipped view supplies zero rows, so a
  // weight above zero buys a term that cannot fire, and its cells would read identical for a reason that is not
  // the term's safety. See `directionGateLine`.
  const rows =
    opts.latencyView === 'whole-file'
      ? stats.latencyRoutes.wholeFileRows
      : opts.latencyView === 'capped'
        ? stats.latencyRoutes.cappedRows
        : stats.latencyRoutes.shippedRows;
  console.log(
    `  ${directionGateLine(opts.failedEdgeWeight, opts.latencyView, rows, stats.latencyRoutes.cases)}`,
  );
}

/**
 * Report the log channel's four levels, from the module that owns them.
 *
 * Beside {@link reportLatencyRoutes} rather than inside {@link reportLogDiagnostics}, because the two answer
 * different questions about the same rows: the diagnostics count what the LOADER produced, and this counts what
 * the MODE admits and the GRAPH can address. A run whose `[log]` line reads `30/30 cases with logs, 41401
 * ERROR/FATAL entries` and whose `log-routes` line reads `admitted 0` has a gate for a mechanism; one that reads
 * `in-graph 0` has a mapping problem instead.
 */
function reportLogRoutes(systemName: string, stats: LoadStats): void {
  for (const line of formatLogRoutes(stats.logRoutes, systemName)) console.log(line);
}

/**
 * Log log-loading diagnostics: whether logs reach the engine, how many
 * ERROR/FATAL entries the severity derivation produced, and a sample of the
 * first log line (timestamp/level/service/message) to eyeball the raw format.
 */
function reportLogDiagnostics(systemName: string, suiteName: string, stats: LoadStats): void {
  const {
    total,
    errorEntries,
    header,
    sampleTs,
    sampleLevel,
    sampleService,
    sampleMsg,
    stackTraceEntries,
    sampleStackTraceMsg,
    exceptionNamesSample,
  } = stats.logStats;
  if (total > 0) {
    console.log(
      `  [log] ${total}/${stats.cases.length} cases with logs, ${errorEntries} ERROR/FATAL entries, ${stackTraceEntries} stack-trace entries`,
    );
    console.log(`  [log] header: ${header}`);
    console.log(
      `  [log] sample: ts=${sampleTs} level=${sampleLevel || '?'} svc=${sampleService} msg="${sampleMsg}"`,
    );
    if (sampleStackTraceMsg) {
      console.log(`  [log] stacktrace sample: "${sampleStackTraceMsg}"`);
    }
    if (exceptionNamesSample) {
      console.log(`  [log] exception types: ${exceptionNamesSample}`);
    }
  } else if (stats.cases.length > 0) {
    console.log(`  [log] No log data available for ${stats.cases.length} cases`);
  }
}

/**
 * Gated per-case diagnostic: for the first few log-bearing cases, dump each
 * case's per-service DEEPEST exception classes and their document frequencies
 * (`df = distinct services emitting that class / total services`).
 *
 * This is the ground-truth probe for the log signal's `novelty` mode: it shows
 * whether the GROUND-TRUTH source service emits a rare root-cause exception
 * (e.g. `IllegalArgumentException`, df=1) while the symptom services share a
 * wrapper (e.g. Spring's `HttpServerErrorException`, df=N). If that split does
 * NOT hold for TrainTicket RE3, the novelty signal cannot help that cell.
 *
 * Enabled by `BENCHMARK_LOG_DIAG=1`; silent otherwise (it is verbose).
 */
function reportDeepestExceptionDiagnostics(
  systemName: string,
  suiteName: string,
  stats: LoadStats,
): void {
  if (process.env['BENCHMARK_LOG_DIAG'] !== '1') return;
  const MAX_CASES = 6;

  let shown = 0;
  for (const c of stats.cases) {
    if (shown >= MAX_CASES) break;
    const logs = c.logs;
    if (!logs || logs.length === 0) continue;

    // per-service → per-deepest-class counts (post-inject ERROR/FATAL only).
    const perService = new Map<string, Map<string, number>>();
    for (const l of logs) {
      if (l.level !== 'ERROR' && l.level !== 'FATAL') continue;
      if (c.injectTime > 0 && l.timestamp < c.injectTime) continue;
      const cls = l.deepestExceptionClass ?? '?';
      let m = perService.get(l.service);
      if (!m) {
        m = new Map<string, number>();
        perService.set(l.service, m);
      }
      m.set(cls, (m.get(cls) ?? 0) + 1);
    }
    if (perService.size === 0) continue;

    const df = new Map<string, number>();
    for (const m of perService.values()) {
      for (const cls of m.keys()) df.set(cls, (df.get(cls) ?? 0) + 1);
    }
    const totalSvcs = perService.size;

    let wrapper = '?';
    let wrapperDf = 0;
    for (const [cls, d] of df) {
      if (d > wrapperDf) {
        wrapperDf = d;
        wrapper = cls;
      }
    }

    const gt = c.groundTruth?.serviceId ?? '?';
    const gtClasses = perService.get(gt);
    const gtStr = gtClasses
      ? [...gtClasses.keys()].map((cls) => `${cls}(df=${df.get(cls)}/${totalSvcs})`).join(', ')
      : '<none>';

    // Dump the source's first ERROR/FATAL line (FULL, untruncated) so the raw
    // message format is visible — TrainTicket embeds a Spring Boot preamble and
    // the exception class may be absent or buried, which the deepest-class
    // extractor must handle to make the novelty signal fire.
    let srcMsg = '<no ERROR line>';
    for (const l of logs) {
      if (l.service !== gt) continue;
      if (l.level !== 'ERROR' && l.level !== 'FATAL') continue;
      if (c.injectTime > 0 && l.timestamp < c.injectTime) continue;
      srcMsg = l.message;
      break;
    }

    console.log(`  [log-diag] ${c.id} gt=${gt}`);
    console.log(`    source deepest: ${gtStr}`);
    console.log(`    wrapper deepest: ${wrapper}(df=${wrapperDf}/${totalSvcs})`);
    console.log(`    source msg: ${srcMsg.slice(0, 400)}`);

    shown++;
  }
}

/**
 * The signal configuration, as one line.
 *
 * MOVED to `rcaeval-engine-options.ts`. It lived here, in a file that calls `main()` at import time,
 * so no test could call it — which is why its omission of `latWeight`, `latMinRise` and
 * `poolMetricPenaltyWeight` survived: the line is rendered by the same module that builds the
 * engine's arguments now, and a test holds the two against each other. See that module for the rule
 * the line obeys. The dump's header consumes the same function, so the banner and the artifact
 * cannot state different configurations.
 */

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseRCAEvalArgs(process.argv.slice(2));
  const startTime = Date.now();

  console.log('Micro-Kinetic — RCAEval Industry-Standard Benchmark');
  console.log('═'.repeat(65));
  console.log(`Data:  ${opts.dataDir}`);
  console.log(
    `Filter: system=${opts.system}, suite=${opts.suite}${opts.maxCases > 0 ? ` (max ${opts.maxCases} cases)` : ''}`,
  );
  const injectMode = opts.noInjectTime
    ? 'OFF (dataset-decoupled)'
    : 'ON (RCAEval baseline protocol)';
  // `temporalWeight` and `onsetShape` used to be printed HERE as well, which made two renderings of
  // the same two fields and left the signals line free to omit them. They are on the signals line
  // now, once, beside every other forwarded option.
  console.log(`injectTime: ${injectMode}`);
  // The run's configuration, as ONE string, so the banner and the dump cannot state different ones: the
  // signals line names the options the engine's constructor receives, and the corpus line names the view the
  // INPUT was assembled in — which is not an engine option and therefore cannot live on that line, but is
  // just as able to move a published cell. Two lines, one owner, printed here and written into the dump's
  // header verbatim (`DiagnoseDump` takes it as one string for the same reason).
  const configuration = `${formatSignalLine(opts)}\n${formatCorpusLine(opts.latencyView)}`;
  console.log(configuration);

  const allCases = discoverAllCases(opts.dataDir);
  console.log(`Cases discovered: ${allCases.length}`);

  if (allCases.length === 0) {
    console.log('No cases found. Ensure cache-datasets workflow has been run.');
    return;
  }

  // Discovery diagnostics — scan unmatched directories for debugging
  const scannedDirs = discoverAllDirectoriesWithMetrics(opts.dataDir);
  console.log(`\nScanned ${scannedDirs.totalWithMetrics} directories with metrics.json`);
  if (scannedDirs.unmatched.length > 0) {
    console.log(`Unmatched directories (${scannedDirs.unmatched.length} total, showing first 20):`);
    for (const d of scannedDirs.unmatched.slice(0, 20)) {
      console.log(`  → ${d}`);
    }
    if (scannedDirs.unmatched.length > 20) {
      console.log(`  ... and ${scannedDirs.unmatched.length - 20} more`);
    }
  }

  // ── Discovery diagnostics ───────────────────────────────
  const discoveryStats = new Map<string, number>();
  for (const c of allCases) {
    const key = `${c.system}:${c.suite}`;
    discoveryStats.set(key, (discoveryStats.get(key) ?? 0) + 1);
  }
  console.log('Case distribution:');
  for (const [key, count] of [...discoveryStats.entries()].sort()) {
    console.log(`  ${key}: ${count} cases`);
  }

  // Group by system + suite
  const groups = new Map<string, CaseMeta[]>();
  for (const c of allCases) {
    if (
      opts.system !== 'all' &&
      c.system !== 'OnlineBoutique' &&
      c.system !== 'SockShop' &&
      c.system !== 'TrainTicket'
    )
      continue;
    // Suite filter
    if (opts.suite !== 'all' && c.suite !== `RE${opts.suite.replace(/^re/i, '')}`) continue;
    const groupKey = `${c.system}:${c.suite}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(c);
  }

  if (groups.size === 0) {
    console.log('No cases found. Exiting.');
    return;
  }

  console.log(`\nGroups to evaluate: ${groups.size}`);
  console.log('═'.repeat(65));

  // The engine's TWO arguments are built by the module that also renders the line the artifact
  // carries, so neither the two objects nor the line can disagree: a hand-written literal here would
  // be a second owner of the option list, and the field that is present in one and missing from the
  // other is exactly how the golden half came to omit three of its load-bearing weights.
  const container = createContainer(buildRCAEvalEngineOptions(opts));
  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  const runner = new BenchmarkRunner(
    container,
    classifier,
    undefined,
    undefined,
    !opts.noInjectTime,
  );
  const loader = new RCAEvalLoader();

  // ── Init YAML-driven topology registry ──────────────────
  // Load all three system topology configs once before benchmarking.
  // Falls back gracefully to ring-connect if configs are not found.
  //
  // Semantic enhancement: when ZHIPU_API_KEY is available, real embedding-based
  // alignment is used; otherwise falls back to TF-IDF (local, zero-cost).
  loadEnvFile();
  const semanticConfig = await createSemanticConfig();
  await initRCAEvalTopology(undefined, semanticConfig);
  const useSemantic = Boolean(semanticConfig.embeddingProvider);
  console.log(
    `Topology: YAML v2 (${isRCAEvalTopologyInitialized() ? 'loaded' : 'unavailable'})` +
      (useSemantic ? ' + semantic enhancement (Zhipu embedding-3)' : ''),
  );
  console.log('═'.repeat(65));

  // ── Fusion-ceiling accumulation (engine vs PRISM) ──
  // One record per case, populated across the group loop; consumed by the
  // report emitted after the loop. Always declared so the emit step below can
  // reference it unconditionally.
  const fusionRecords: FusionCasePrediction[] = [];
  // Per-case routing-feasibility records (engine ranking scores + PRISM
  // M-scores), consumed by the routing-probe report emitted after the loop.
  const routingRecords: RoutingProbeRecord[] = [];
  // One census row per case of EVERY group, accumulated across the loop and written once after it. Not the
  // failures and not a sample of them: `printFailureDiagnostics` shows the first few per fault type, so a
  // split computed from the console would be a split of a sample while reading as one of the population.
  const lossRecords: LossRecord[] = [];
  // The dump is ONE file for the whole invocation, owned here rather than inside the group loop
  // below: `--suite re1` covers three systems, and the first version of this feature wrote the file
  // once per group, so each system truncated the last one's and the artifact held a third of the
  // run while the console printed the same count three times.
  const diagnoseDump =
    opts.diagnoseDump === '' ? undefined : new DiagnoseDump(opts.diagnoseDump, configuration);

  for (const [groupKey, metas] of groups) {
    const [systemName, suiteName] = groupKey.split(':') as [string, string];
    const caseLimit = opts.maxCases > 0 ? Math.min(opts.maxCases, metas.length) : 0;
    const stats = await loadCases(
      metas,
      loader,
      caseLimit,
      opts.latencyView,
      // The mode the run RAN under, read from the parsed options at the one site that hands the loader its
      // configuration, so the census cannot count a different gate than the scorer applied.
      opts.logSignalMode,
      semanticConfig,
      opts.traceWeight > 0,
    );

    // ── Report load errors with comprehensive diagnostics ──
    reportLoadErrors(systemName, suiteName, stats);

    if (stats.cases.length === 0) {
      console.log(`  ⚠ No cases loaded for ${systemName}/${suiteName} — skipping benchmark`);
      continue;
    }

    // ── Semantic enhancement diagnostics ──────────────────
    if (useSemantic) {
      const sem = stats.semanticStats;
      const pct =
        sem.totalServices > 0
          ? ((sem.semanticallyResolved / sem.totalServices) * 100).toFixed(1)
          : '0.0';
      console.log(
        `  [semantic] ${sem.semanticallyResolved}/${sem.totalServices} services` +
          ` resolved (${pct}%) — embedding=${sem.embeddingResolved}, llm=${sem.llmResolved}, exact=${sem.exactMatched}`,
      );
    }

    // ── Trace pruning diagnostics ─────────────────────────
    reportTraceDiagnostics(systemName, suiteName, stats);

    // ── The latency channel's own census ──────────────────
    // Which of the three views this run ranked on carried rows, and the verdict those counts earn. Without it a
    // run on the `whole-file` corpus and a run on one that supplied nothing print the same cells.
    reportLatencyRoutes(systemName, stats, opts);

    // ── Log-loading diagnostics ───────────────────────────
    reportLogDiagnostics(systemName, suiteName, stats);
    reportDeepestExceptionDiagnostics(systemName, suiteName, stats);

    // ── The log channel's own census, beside its diagnostics ──
    // The diagnostics above count what the LOADER produced; this counts what the MODE admits and what the GRAPH
    // can address. `logWeight` is 1.0 — the largest weight in the ranking — and `INPUT_MAP_EMPTY` cannot say
    // which of the four mechanisms emptied its map, so a run that prints the first without the second reports a
    // zero it cannot attribute.
    reportLogRoutes(systemName, stats);

    // ── PRISM graph-free baseline (for the fusion ceiling + routing probe) ──
    // PRISM runs on the SAME loaded BenchmarkCase metrics (timestamps in ms,
    // injectTime in ms), so no extra loading pass is needed. This is the
    // graph-free internal/external asymmetry scorer from arXiv:2601.21359. The
    // full ranking (not just top-1) is kept so the routing probe can record
    // PRISM's top-2 M-score margin.
    const prismRankingByCaseId = new Map<string, ReturnType<typeof computePrismRanking>>();
    if (opts.fusionCeiling || opts.routingProbe) {
      for (const c of stats.cases) {
        prismRankingByCaseId.set(
          c.id,
          computePrismRanking(c.metrics, c.injectTime, { pooling: 'additive' }),
        );
      }
    }
    const prismTop1ByCaseId = new Map<string, string | undefined>();
    for (const [id, ranking] of prismRankingByCaseId) {
      prismTop1ByCaseId.set(id, ranking[0]?.serviceId);
    }

    // Split by fault type (matching paper's Table 6 format)
    const byFaultType = new Map<string, BenchmarkCase[]>();
    for (const c of stats.cases) {
      const ft = c.groundTruth?.faultType?.toLowerCase() ?? 'unknown';
      if (!byFaultType.has(ft)) byFaultType.set(ft, []);
      byFaultType.get(ft)!.push(c);
    }

    // Print topology diagnostics. The line is built by the topology module's ONE renderer, so a field this
    // file names and that module never writes is a compile-time impossibility rather than an `undefined` on
    // every run.
    const diagNode = stats.cases[0]?.callGraph.nodes.values().next().value;
    const diagLine = formatTopologyDiagnostic(diagNode?.labels);
    if (diagLine !== undefined) console.log(diagLine);

    // Run each fault type separately
    const results = new Map<string, RunResult>();
    // The dual-family census for this cell. Accumulated from the ranking the correctness checks count from, so
    // it cannot disagree with the score about who was paid — see `dual-family-census.ts` for why the term's
    // POPULATION has to be printed at all (a constant membership only re-orders a cell whose family is a
    // strict subset, and no artifact said how large the family was where the cells did not move).
    const dualFamily = createDualFamilyCensus();
    for (const [ft, ftCases] of byFaultType) {
      if (ftCases.length === 0) continue;
      const suite: BenchmarkSuite = {
        name: `${systemName}-${suiteName}-${ft}`,
        cases: ftCases,
        totalCases: ftCases.length,
      };
      results.set(
        ft,
        await runner.runSuite(suite, (record) => {
          // Always on: the census costs one pass over an array the runner already built, and an instrument
          // that only ran under a flag would be absent from exactly the acceptance runs that must explain a
          // movement.
          accumulateDualFamilyCensus(dualFamily, record);
          if (diagnoseDump !== undefined) {
            diagnoseDump.record(
              groupKey,
              record.case.id,
              renderDiagnosedCase(record, {
                logSignalMode: opts.logSignalMode,
                useInjectTime: !opts.noInjectTime,
                fieldDecimals: opts.diagnoseDecimals,
              }),
            );
          }
        }),
      );
    }
    const dualFamilyLine = formatDualFamilyCensusLine(dualFamily);
    if (dualFamilyLine !== undefined) console.log(dualFamilyLine);

    // The term-gap census for this cell: which ranking TERM the misses were lost on. The dual-family census above
    // says how wide one membership was; this says which term would have to change to win the case back, summed
    // over the cell. Both are read off the same `casePredictions` the correctness count comes from.
    //
    // The reason it has to exist at all: the failure blocks print the ANOMALY that lost and never the TERM that
    // lost it, and a rank-2 miss and a rank-40 miss can have identical anomaly breakdowns.
    const termGap = createTermGapCensus();
    for (const r of results.values()) {
      for (const p of r.casePredictions) accumulateTermGap(termGap, p);
    }
    const termGapLine = formatTermGapLine(termGap);
    if (termGapLine !== undefined) console.log(termGapLine);

    // The ONE binary term's decisions, scored. `trace` is pinned on for RE3 alone, the term-gap census reads it as
    // the largest cost on the blocking cell, and a removal arm reads the pin as worth ten cases over the suite —
    // so the open question is which VOTES are wrong, which no artifact printed: the failure block shows the
    // highest-ratio service, and the rule usually disqualifies it on `pre >= 500`.
    const traceVote = createTraceVoteCensus();
    for (const r of results.values()) {
      for (const p of r.casePredictions) accumulateTraceVote(traceVote, p);
    }
    const traceVoteLine = formatTraceVoteLine(traceVote);
    if (traceVoteLine !== undefined) console.log(traceVoteLine);

    // The vote's CANDIDATE, described: the evidence that stood beside the rise, for the vote and for the truth,
    // plus the attribution of every wrong vote to the guard in the rule that excluded the truth. The census above
    // scores the decisions; this one explains the wrong ones, which is the question the rank histogram left open
    // after it killed the mask and the tail-only refinement on the same cell.
    //
    // One line per vote, printed for EVERY suite: a cell where the term never votes prints nothing, so the absence
    // is visible as the absence of the family rather than as a zero somebody has to interpret.
    const riser = createRiserCensus();
    for (const r of results.values()) {
      for (const p of r.casePredictions) {
        const line = formatRiserCaseLine(p);
        if (line !== undefined) console.log(line);
        accumulateRiser(riser, p);
      }
    }
    const riserLine = formatRiserCensusLine(riser);
    if (riserLine !== undefined) console.log(riserLine);

    // The axis the five refusals leave standing. Every refused refinement was a threshold on the RISE, and the
    // riser census shows why they all failed: the hits and the misses carry the SAME rise (1.16-2.22 against
    // 1.16-1.47) and differ in what the FLEET did (drift 0.05-0.11 against 0.79-0.99). A rise is a statement about
    // a service only next to the system's own move, so this census counts the votes that four floors on the
    // quotient `growth / drift` would keep, withdraw and give up. It enrols nothing: the decision is `withdrawn`
    // against `surrendered`, and the arm that flips the mode is what converts that arithmetic into cases.
    const share = createTraceShareCensus();
    for (const r of results.values()) {
      for (const p of r.casePredictions) accumulateTraceShare(share, p);
    }
    const shareLine = formatTraceShareCensusLine(share);
    if (shareLine !== undefined) console.log(shareLine);

    // The axis the four refused refinements leave standing. The riser census says WHY the truth was not a
    // candidate — on TrainTicket's five misses it fell (`growth` 0.82-0.94 on `pre ≈ 12 000`), so the rule's premise
    // ("a source does MORE work") is what excluded it. This census measures the change on an axis where a fall and a
    // rise are the same size of event: the count difference in units of its own Poisson fluctuation, with the
    // fleet's common-mode drift divided out. It also simulates two selectors over the same population, so the next
    // arm is decided from a reading rather than proposed from a mechanism.
    //
    // Printed for EVERY case with a measurable axis, not only for the cases the rule voted on: the ten cases where
    // the rule stays silent are half of what a replacement selector would have to decide.
    let traceZ = createTraceZCensus();
    for (const r of results.values()) {
      for (const p of r.casePredictions) {
        const line = formatTraceZCaseLine(p);
        if (line !== undefined) console.log(line);
        traceZ = accumulateTraceZ(traceZ, p);
      }
    }
    const traceZLine = formatTraceZCensusLine(traceZ);
    if (traceZLine !== undefined) console.log(traceZLine);

    // ── Fusion-ceiling records for this group ──
    // Join the engine's per-case top-1 (from the runner) with PRISM's, keyed
    // by the shared case id, and record one entry per case.
    if (opts.fusionCeiling) {
      const engineTop1ByCaseId = new Map<string, string | undefined>();
      for (const r of results.values()) {
        for (const p of r.casePredictions) {
          engineTop1ByCaseId.set(p.caseId, p.top1);
        }
      }
      const cell = `${suiteName}:${systemName}`;
      for (const c of stats.cases) {
        fusionRecords.push({
          caseId: c.id,
          cell,
          truth: c.groundTruth.serviceId,
          engineTop1: engineTop1ByCaseId.get(c.id),
          prismTop1: prismTop1ByCaseId.get(c.id),
        });
      }
    }

    // ── Routing-probe records for this group ──
    // Join the engine's per-case top-2 ranking scores (now carried by the
    // runner's case predictions) with PRISM's top-2 M-scores, so the offline
    // frontier analysis can test engine-margin / prism-margin routers.
    if (opts.routingProbe) {
      const engineByCaseId = new Map<string, CasePrediction>();
      for (const r of results.values()) {
        for (const p of r.casePredictions) {
          engineByCaseId.set(p.caseId, p);
        }
      }
      const cell = `${suiteName}:${systemName}`;
      for (const c of stats.cases) {
        const ep = engineByCaseId.get(c.id);
        const ranking = prismRankingByCaseId.get(c.id) ?? [];
        routingRecords.push({
          caseId: c.id,
          cell,
          faultType: c.groundTruth?.faultType?.toLowerCase() ?? 'unknown',
          truth: c.groundTruth.serviceId,
          engineTop1: ep?.top1,
          engineTop1Score: ep?.top1Score,
          engineTop2: ep?.top2,
          engineTop2Score: ep?.top2Score,
          prismTop1: ranking[0]?.serviceId,
          prismTop1Score: ranking[0]?.score,
          prismTop2: ranking[1]?.serviceId,
          prismTop2Score: ranking[1]?.score,
        });
      }
    }

    // ── Loss-census rows for this group ──
    // The same join the fusion and routing blocks above perform, asking a different question of it: not
    // "who was right" but "was the truth reachable at all, and if so how deep".
    if (opts.lossCensus !== '') {
      const engineByCaseId = new Map<string, CasePrediction>();
      for (const r of results.values()) {
        for (const p of r.casePredictions) engineByCaseId.set(p.caseId, p);
      }
      const cell = `${suiteName}:${systemName}`;
      for (const c of stats.cases) {
        const ep = engineByCaseId.get(c.id);
        lossRecords.push({
          caseId: c.id,
          cell,
          faultType: c.groundTruth?.faultType?.toLowerCase() ?? 'unknown',
          truth: c.groundTruth.serviceId,
          predicted: ep?.top1,
          correct: ep?.correct ?? false,
          // The candidate pool is the graph's node set, and the runner records its size on the case's own
          // prediction record so the two cannot disagree about which set the ranking covered.
          pool: ep?.pool ?? 0,
          truthInGraph: c.callGraph.nodes.has(c.groundTruth.serviceId),
          truthRank: ep?.truthRank,
          errored: ep?.errored,
          // The truth's own evidence, carried so a DEEP miss can be split by whether anything moved at the
          // origin. Read from the runner's record of the truth's own `RootCauseResult` rather than recomputed
          // here: the threshold that decides the split is the engine's, and a second copy of it in this file
          // would be a boundary that moves without this line moving.
          truthEvidence: ep?.truthEvidence,
          // And the winner's breakdown, so the census can name the term the case was lost to. Both sides are
          // recorded rather than the difference, because a difference cannot be re-derived into its parts and
          // the parts can always be differenced.
          top1Terms: ep?.top1Terms,
          // …and what the latency CHANNEL's corpus supplied for THIS case, taken from the census's own map rather
          // than re-spelled here. The lookup is total: `cases` is `loaded`, and every element of it was pushed
          // after the line that set its entry, so there is no arm to write for an absent supply — and an absent
          // supply would mean the corpus owner never ran, which its own type cannot express.
          latencySupply: stats.latencyRouteByCaseId.get(c.id)!,
          // …and what the WINDOW did to the same case, taken on the series the engine received rather than on
          // the corpus rows: the loader reshapes a series before the engine sees it, so a census over
          // `metrics.json` measures a different object and cannot stand in for this one.
          anchorCensus: deriveAnchorCensus(
            { metrics: c.metrics, injectTime: c.injectTime, truth: c.groundTruth.serviceId },
            opts.baselineAnchor,
          ),
        });
      }
    }

    printResultsTable(systemName, suiteName, results, Array.from(byFaultType.keys()));
    printFailureDiagnostics(systemName, suiteName, results);

    // Release loaded cases between system groups to prevent OOM.
    // Each system's 245 cases with trace spans + call graphs + embeddings
    // consumes 3-5 GB; releasing between groups keeps peak under limit.
    stats.cases.length = 0;
    for (const cases of byFaultType.values()) cases.length = 0;
    byFaultType.clear();
    results.clear();
    if (typeof globalThis.gc === 'function') globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // ── The diagnostic dump ──
  // Written once, after the last group: the file is a function of the whole invocation, and the
  // accumulator refuses a second write for exactly the reason this line is not inside the loop.
  if (diagnoseDump !== undefined) {
    // The precision is named HERE as well as inside the file, because the CI log is what an operator
    // reads to confirm a dispatch produced the artifact they asked for — and a `--diagnose-decimals`
    // value that fell back to the shipped default is otherwise only visible after downloading the
    // dump. The file remains the authority; this is a convenience that can be checked against it.
    console.log(
      `  diagnose dump: ${formatDiagnoseDumpLine(diagnoseDump.write())}` +
        ` at ${opts.diagnoseDecimals} decimals per service field`,
    );
  }

  // ── The loss census ──
  // Written once, after the last group, for the same reason the dump above is: the artifact is a function of
  // the whole invocation, and a file per group would keep only the last system's cases.
  if (opts.lossCensus !== '') {
    const rows = summarizeLoss(lossRecords);
    writeFileSync(opts.lossCensus, lossRecords.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log('\n════════════════════════════════════════════════════════════');
    console.log(
      `Loss census — retrieval vs reranking (${lossRecords.length} cases -> ${opts.lossCensus})`,
    );
    console.log('════════════════════════════════════════════════════════════');
    for (const line of formatLossReport(rows)) console.log(line);
    // The separation §6.5 refuses to make from a contributions table: a zero is the same number whether the
    // weight is zero, the graph field is missing, or the evidence is absent, and only the producer knows
    // which. Printed for the truth's side, because the loss is about the truth.
    for (const line of formatTermZeroes(summarizeTermZeroes(lossRecords))) console.log(line);
  }

  // ── Fusion-ceiling report ──
  if (opts.fusionCeiling) {
    const ceiling = computeFusionCeiling(fusionRecords);
    const byCell = computeFusionCeilingByCell(fusionRecords);
    const report = {
      aggregate: ceiling,
      perCell: Object.fromEntries(
        [...byCell.entries()].map(([cell, c]) => [
          cell,
          {
            total: c.total,
            engineCorrect: c.engineCorrect,
            prismCorrect: c.prismCorrect,
            bothCorrect: c.bothCorrect,
            engineOnly: c.engineOnly,
            prismOnly: c.prismOnly,
            bothWrong: c.bothWrong,
            union: c.union,
            unionRate: c.unionRate,
          },
        ]),
      ),
      cases: fusionRecords.map((r) => ({
        caseId: r.caseId,
        cell: r.cell,
        truth: r.truth,
        engineTop1: r.engineTop1 ?? null,
        prismTop1: r.prismTop1 ?? null,
        engineCorrect: r.engineTop1 !== undefined && r.engineTop1 === r.truth,
        prismCorrect: r.prismTop1 !== undefined && r.prismTop1 === r.truth,
      })),
    };
    writeFileSync(opts.fusionCeiling, JSON.stringify(report, null, 2));
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('Fusion ceiling — engine vs PRISM (union of correct cases)');
    console.log('════════════════════════════════════════════════════════════');
    console.log(
      `  total=${ceiling.total} engine=${ceiling.engineCorrect} prism=${ceiling.prismCorrect}`,
    );
    console.log(
      `  bothCorrect=${ceiling.bothCorrect} engineOnly=${ceiling.engineOnly} ` +
        `prismOnly=${ceiling.prismOnly} bothWrong=${ceiling.bothWrong}`,
    );
    console.log(`  UNION=${ceiling.union} (${(ceiling.unionRate * 100).toFixed(1)}%)`);
    for (const [cell, c] of byCell) {
      console.log(
        `    ${cell.padEnd(22)} union=${c.union}/${c.total} (${(c.unionRate * 100).toFixed(1)}%)` +
          `  engine=${c.engineCorrect} prism=${c.prismCorrect}`,
      );
    }
    console.log('════════════════════════════════════════════════════════════');
  }

  // ── Routing-probe report ──
  if (opts.routingProbe) {
    const analysis = analyzeRoutingProbe(routingRecords);
    const report = {
      suite: opts.suite,
      records: routingRecords,
      aggregate: {
        total: analysis.total,
        engineCorrect: analysis.engineCorrect,
        prismCorrect: analysis.prismCorrect,
        disagreement: analysis.disagreement,
        engineOnly: analysis.engineOnly,
        prismOnly: analysis.prismOnly,
        bothWrong: analysis.bothWrong,
        union: analysis.union,
        unionRate: analysis.unionRate,
        baselineAccuracy: analysis.baselineAccuracy,
      },
      bestZeroRegression: analysis.bestZeroRegression,
    };
    writeFileSync(opts.routingProbe, JSON.stringify(report, null, 2));
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('Routing probe — engine vs PRISM (zero-regression frontier)');
    console.log('════════════════════════════════════════════════════════════');
    console.log(
      `  total=${analysis.total} engine=${analysis.engineCorrect} prism=${analysis.prismCorrect}` +
        ` disagree=${analysis.disagreement}`,
    );
    console.log(
      `  engineOnly=${analysis.engineOnly} prismOnly=${analysis.prismOnly} ` +
        `bothWrong=${analysis.bothWrong}`,
    );
    console.log(`  UNION=${analysis.union} (${(analysis.unionRate * 100).toFixed(1)}%)`);
    console.log(`  baseline(always-engine)=${(analysis.baselineAccuracy * 100).toFixed(1)}%`);
    const refs = analysis.rules.filter(
      (r) =>
        r.name === 'always-prism' ||
        r.name === 'resource-fault->prism' ||
        r.name === 'per-cell-oracle',
    );
    for (const r of refs) {
      const reg = r.regressingCells.length > 0 ? ` [regress ${r.regressingCells.length}]` : '';
      console.log(
        `    ${r.name.padEnd(26)} acc=${(r.accuracy * 100).toFixed(1)}%` +
          ` (gain ${(r.gain >= 0 ? '+' : '') + (r.gain * 100).toFixed(1)}pp)${reg}`,
      );
    }
    if (analysis.bestZeroRegression) {
      const b = analysis.bestZeroRegression;
      console.log(
        `  BEST zero-regression: ${b.name} = ${(b.accuracy * 100).toFixed(1)}% ` +
          `(gain ${(b.gain >= 0 ? '+' : '') + (b.gain * 100).toFixed(1)}pp)`,
      );
    } else {
      console.log('  BEST zero-regression: none (empty input)');
    }
    console.log('════════════════════════════════════════════════════════════');
  }

  console.log(`\nTotal duration: ${Date.now() - startTime}ms`);
}

main().catch((err) => {
  console.error('RCAEval benchmark failed:', err);
  process.exit(1);
});
