/**
 * Real RCAEval benchmark — industry-standard per-system, per-dataset evaluation.
 *
 * I8: Topology-preserving fault graph with Pearson cross-service correlation
 * now integrated into TreePruner.buildFaultGraph() via buildTopologyFaultGraph().
 * RE2+RE3 cases with trace data benefit from augmentTopologyWithTraces().
 *
 * Follows the RCAEval paper (arXiv:2412.17015) methodology:
 * - Cases grouped by benchmark system (OnlineBoutique/SockShop/TrainTicket)
 * - Cases grouped by dataset suite (RE1/RE2/RE3)
 * - Per-fault-type breakdown matching Table 6 format
 * - Results directly comparable with published baselines
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-rcaeval.ts [--data-dir <path>] [--suite re1|re2|re3] [--system ob|ss|tt] [--max-cases <n>]
 *
 * @module benchmarks/run-rcaeval
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TraceSpan } from '@agentix-e/micro-kinetic-core';
import {
  Container,
  DEFAULT_CLASSIFICATION_RULES,
  DI_TOKENS,
  RegexFaultClassifier,
} from '../../packages/core/src/index.js';
import { BenchmarkRunner, RCAEvalLoader } from '../../packages/kinetic/src/benchmarks/index.js';
import type {
  BenchmarkCase,
  BenchmarkSuite,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import type { RunResult } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import { augmentTopologyWithTraces } from '../../packages/kinetic/src/signals/trace-topology.js';
import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';
import {
  buildRCAEvalCallGraph,
  enhanceRCAEvalCallGraph,
  initRCAEvalTopology,
  isRCAEvalTopologyInitialized,
} from './rcaeval-topology.js';

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

/**
 * Environment-driven semantic enhancer configuration.
 *
 * Reads ZHIPU_API_KEY and DEEPSEEK_API_KEY from env. If neither is
 * available, semantic enhancement is disabled and buildRCAEvalCallGraph
 * (exact match only) is used.
 *
 * NEVER contains API keys — only env variable names.
 */
async function createSemanticConfig() {
  const { TfIdfEmbeddingProvider } = await import('@agentix-e/micro-kinetic-ai');
  const { createApiEmbeddingFromEnv } = await import('@agentix-e/micro-kinetic-ai');

  // Prefer real API embedding; fall back to TF-IDF for local-only runs.
  // ZHIPU_EMBEDDING_ENDPOINT: override the default Zhipu API endpoint.
  //   - Default: https://open.bigmodel.cn/api/paas/v4/embeddings (China mainland)
  //   - For CI / overseas runners: https://api.z.ai/api/paas/v4/embeddings
  //
  // When BENCHMARK_USE_TFIDF=1: force local TF-IDF embedding (zero network dependency).
  // Use this in CI to prevent API latency from inflating benchmark runtime.
  const forceTfIdf = process.env['BENCHMARK_USE_TFIDF'] === '1';
  const zhipuKey = process.env['ZHIPU_API_KEY'];
  const embeddingProvider =
    zhipuKey && !forceTfIdf
      ? createApiEmbeddingFromEnv({
          vendorPrefix: 'ZHIPU',
          endpoint:
            process.env['ZHIPU_EMBEDDING_ENDPOINT'] ??
            'https://open.bigmodel.cn/api/paas/v4/embeddings',
          model: process.env['ZHIPU_EMBEDDING_MODEL'] ?? 'embedding-3',
          dimension: Number(process.env['ZHIPU_EMBEDDING_DIMENSION'] ?? '2048'),
        })
      : new TfIdfEmbeddingProvider();

  return {
    embeddingProvider,
    llmProvider: null, // LLM fallback not needed for embedding-based matching
    alignmentConfig: {
      embeddingThreshold: 0.6,
      llmThreshold: 0.5,
    },
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ───────────────────────────────────────────────────

interface CliOptions {
  dataDir: string;
  maxCases: number;
  /** Filter to specific system: 'ob', 'ss', 'tt', or 'all' */
  system: string;
  /** Filter to specific suite: 're1', 're2', 're3', or 'all' */
  suite: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCAEval-json'),
    maxCases: 0,
    system: 'all',
    suite: 'all',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--max-cases' && i + 1 < args.length)
      opts.maxCases = parseInt(args[++i]!, 10) || 0;
    else if (args[i] === '--system' && i + 1 < args.length) opts.system = args[++i]!;
    else if (args[i] === '--suite' && i + 1 < args.length) opts.suite = args[++i]!;
  }
  return opts;
}

// ── DI Assembly ───────────────────────────────────────────

function createContainer(): Container {
  const container = new Container();
  container.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
  container.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner());
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

function discoverAllCases(dataDir: string): CaseMeta[] {
  if (!existsSync(dataDir)) {
    console.error(`Data directory not found: ${dataDir}`);
    return [];
  }

  const cases: CaseMeta[] = [];
  const queue = [dataDir];

  while (queue.length > 0) {
    const current = queue.shift()!;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      const hasMetrics = entries.some((e) => e.isFile() && e.name === 'metrics.json');
      if (hasMetrics) {
        const meta = parseCaseDir(current);
        if (meta) cases.push(meta);
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          queue.push(join(current, entry.name));
        }
      }
    } catch {
      /* skip inaccessible directories */
    }
  }

  return cases;
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

  return {
    totalWithMetrics: matched.length + unmatched.length,
    matched,
    unmatched,
  };
}

// ── Loader (with comprehensive error reporting) ───────────

interface LoadStats {
  cases: BenchmarkCase[];
  errors: string[];
  errorSamples: Map<string, number>; // error message → count
  traceStats: {
    total: number;
    pruned: number;
    avgEdgesBefore: number;
    avgEdgesAfter: number;
  };
  /** Semantic enhancement statistics (only when enhancer is configured). */
  semanticStats: {
    totalServices: number;
    semanticallyResolved: number;
    embeddingResolved: number;
    llmResolved: number;
    exactMatched: number;
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
  semanticConfig?: { embeddingProvider: any; llmProvider: any; alignmentConfig: any },
): Promise<{
  benchCase: BenchmarkCase;
  traceUsed: boolean;
  pruned: boolean;
  edgesBefore: number;
  edgesAfter: number;
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

  const edgesBefore = callGraph.edges.length;
  let traceUsed = false;
  let pruned = false;

  // Trace-validated topology pruning for RE2/RE3
  if (rawCase.traces && rawCase.traces.length > 0) {
    traceUsed = true;
    const spans: TraceSpan[] = rawCase.traces.map((t) => ({
      traceId: t.traceId,
      spanId: t.spanId,
      parentSpanId: t.parentSpanId ?? '',
      service: t.service,
      operation: t.operationName,
      duration: t.duration,
      statusCode: t.status === 'ERROR' ? 500 : 200,
      isError: t.status === 'ERROR',
      startTime: t.startTime * 1000,
    }));
    callGraph = augmentTopologyWithTraces(callGraph, spans, {
      minCallFrequency: 1,
    });
    pruned = callGraph.edges.length < edgesBefore;
  }
  const edgesAfter = callGraph.edges.length;

  const suiteName =
    meta.suite === 'RE1'
      ? ('rcaeval-re1' as const)
      : meta.suite === 'RE2'
        ? ('rcaeval-re2' as const)
        : ('rcaeval-re3' as const);

  const benchCase = loader.toBenchmarkCase(rawCase, callGraph, suiteName);

  // Free trace data after augmentation — prevents OOM on RE2 (270+ cases
  // each with 100K+ trace spans).  The benchmark runner does not use
  // traces downstream; the topology is already augmented.
  rawCase.traces = undefined;

  return { benchCase, traceUsed, pruned, edgesBefore, edgesAfter };
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
  semanticConfig?: { embeddingProvider: any; llmProvider: any; alignmentConfig: any },
): Promise<LoadStats> {
  const loaded: BenchmarkCase[] = [];
  const errors: string[] = [];
  const errorSamples = new Map<string, number>();
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

  for (const meta of selected) {
    try {
      const { benchCase, traceUsed, pruned, edgesBefore, edgesAfter } = await loadSingleCase(
        meta,
        loader,
        semanticConfig,
      );

      // Collect semantic stats from diagnostic labels on the call graph
      const firstNode = benchCase.callGraph.nodes.values().next().value;
      if (firstNode?.labels?._diag_semantic) {
        const resolved = parseInt(firstNode.labels._diag_semantic, 10) || 0;
        const emb = parseInt(firstNode.labels._diag_embedding, 10) || 0;
        const llm = parseInt(firstNode.labels._diag_llm, 10) || 0;
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

      loaded.push(benchCase);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${meta.dirPath}: ${errMsg}`);
      const shortMsg = errMsg.substring(0, 60);
      errorSamples.set(shortMsg, (errorSamples.get(shortMsg) ?? 0) + 1);
    }
  }

  return {
    cases: loaded,
    errors,
    errorSamples,
    traceStats: {
      total: traceCount,
      pruned: prunedCount,
      avgEdgesBefore: edgesBeforeSum / Math.max(1, selected.length),
      avgEdgesAfter: edgesAfterSum / Math.max(1, selected.length),
    },
    semanticStats: {
      totalServices: semTotalServices,
      semanticallyResolved: semResolved,
      embeddingResolved: semEmbedding,
      llmResolved: semLLM,
      exactMatched: semExact,
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

  // Metric rows: AC@1, Avg@5, LA, TA
  const metrics: Array<{ key: keyof RunResult; label: string }> = [
    { key: 'avgTop1', label: 'AC@1  ' },
    { key: 'avgTop5', label: 'Avg@5 ' },
    { key: 'locationAccuracy', label: 'LA    ' },
    { key: 'typeAccuracy', label: 'TA    ' },
  ];

  for (const metric of metrics) {
    const averages: number[] = [];
    let row = `║ Micro-Kinetic       | ${metric.label} |`;
    for (const ft of faultTypes) {
      const r = results.get(ft);
      if (r) {
        const perFault = r.perFaultType.get(ft);
        const val = perFault ? perFault.accuracy : 0;
        row += ` ${(val * 100).toFixed(1).padStart(5)}% |`;
        averages.push(val * 100);
      } else {
        row += `   N/A |`;
      }
    }
    const avg = averages.length > 0 ? averages.reduce((s, v) => s + v, 0) / averages.length : 0;
    row += ` ${avg.toFixed(1).padStart(5)}% ║`;
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
      );
      console.log(
        `    Top-K: ${d.topK.map((t) => `${t.serviceId}(${t.confidence.toFixed(2)},d${t.depth})`).join(' | ')}`,
      );
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
    const { total, pruned, avgEdgesBefore, avgEdgesAfter } = stats.traceStats;
    const reduction =
      avgEdgesBefore > 0
        ? (((avgEdgesBefore - avgEdgesAfter) / avgEdgesBefore) * 100).toFixed(0)
        : '0';
    console.log(
      `  [trace] ${total}/${stats.cases.length} cases with traces, ` +
        `${pruned} pruned, avg edges: ${avgEdgesBefore.toFixed(0)} → ${avgEdgesAfter.toFixed(0)} ` +
        `(${reduction}% reduction)`,
    );
  } else if (stats.cases.length > 0) {
    console.log(`  [trace] No trace data available for ${stats.cases.length} cases`);
  }
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log('Micro-Kinetic — RCAEval Industry-Standard Benchmark');
  console.log('═'.repeat(65));
  console.log(`Data:  ${opts.dataDir}`);
  console.log(
    `Filter: system=${opts.system}, suite=${opts.suite}${opts.maxCases > 0 ? ` (max ${opts.maxCases} cases)` : ''}`,
  );

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

  const container = createContainer();
  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  const runner = new BenchmarkRunner(container, classifier);
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

  for (const [groupKey, metas] of groups) {
    const [systemName, suiteName] = groupKey.split(':') as [string, string];
    const caseLimit = opts.maxCases > 0 ? Math.min(opts.maxCases, metas.length) : 0;

    // ── Batch loading to keep heap below 7 GB ──────────
    // Public GitHub runners have 7 GB physical RAM.  Loading all
    // 735 RE2 cases with trace spans + Zhipu embeddings at once
    // exceeds this limit.  Process in batches of 50, accumulating
    // stats incrementally without holding all cases in memory.
    const BATCH_SIZE = 50;
    const selected = caseLimit > 0 ? metas.slice(0, caseLimit) : metas;
    const byFaultType = new Map<string, BenchmarkCase[]>();
    let totalEdgesBefore = 0,
      totalEdgesAfter = 0,
      batchCaseTotal = 0;
    const aggStats: LoadStats = {
      cases: [],
      errors: [],
      errorSamples: new Map<string, number>(),
      semanticStats: {
        totalServices: 0,
        semanticallyResolved: 0,
        embeddingResolved: 0,
        llmResolved: 0,
        exactMatched: 0,
      },
      traceStats: { total: 0, pruned: 0, avgEdgesBefore: 0, avgEdgesAfter: 0 },
    };

    for (let i = 0; i < selected.length; i += BATCH_SIZE) {
      const batch = selected.slice(i, i + BATCH_SIZE);
      const stats = await loadCases(batch, loader, BATCH_SIZE, semanticConfig);

      // Accumulate semantic + trace stats
      aggStats.errors.push(...stats.errors);
      for (const [k, v] of stats.errorSamples)
        aggStats.errorSamples.set(k, (aggStats.errorSamples.get(k) || 0) + v);
      const s = aggStats.semanticStats;
      const b = stats.semanticStats;
      s.totalServices += b.totalServices;
      s.semanticallyResolved += b.semanticallyResolved;
      s.embeddingResolved += b.embeddingResolved;
      s.llmResolved += b.llmResolved;
      s.exactMatched += b.exactMatched;
      let batchCaseCount = 0;
      // Accumulate trace stats from this batch
      aggStats.traceStats.total += stats.traceStats.total;
      aggStats.traceStats.pruned += stats.traceStats.pruned;
      totalEdgesBefore += stats.traceStats.avgEdgesBefore * stats.cases.length;
      totalEdgesAfter += stats.traceStats.avgEdgesAfter * stats.cases.length;
      batchCaseTotal += stats.cases.length;

      // Partition loaded cases by fault type
      for (const c of stats.cases) {
        const ft = c.groundTruth?.faultType?.toLowerCase() ?? 'unknown';
        if (!byFaultType.has(ft)) byFaultType.set(ft, []);
        byFaultType.get(ft)!.push(c);
      }

      // Release batch immediately so GC can reclaim before next batch
      stats.cases.length = 0;
      if (typeof globalThis.gc === 'function') globalThis.gc();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // Compute weighted averages for trace stats across batches
    if (batchCaseTotal > 0) {
      aggStats.traceStats.avgEdgesBefore = totalEdgesBefore / batchCaseTotal;
      aggStats.traceStats.avgEdgesAfter = totalEdgesAfter / batchCaseTotal;
    }

    // ── Report load errors with comprehensive diagnostics ──
    aggStats.cases = []; // not used after batch partitioning
    reportLoadErrors(systemName, suiteName, aggStats);

    if (byFaultType.size === 0) {
      console.log(`  ⚠ No cases loaded for ${systemName}/${suiteName} — skipping benchmark`);
      continue;
    }

    // ── Semantic enhancement diagnostics ──────────────────
    if (useSemantic) {
      const sem = aggStats.semanticStats;
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
    reportTraceDiagnostics(systemName, suiteName, aggStats);

    // byFaultType was built incrementally during batch loading — reuse it directly.

    // Run each fault type separately
    const results = new Map<string, RunResult>();
    for (const [ft, ftCases] of byFaultType) {
      if (ftCases.length === 0) continue;
      const suite: BenchmarkSuite = {
        name: `${systemName}-${suiteName}-${ft}`,
        cases: ftCases,
        totalCases: ftCases.length,
      };
      results.set(ft, await runner.runSuite(suite));
    }

    printResultsTable(systemName, suiteName, results, Array.from(byFaultType.keys()));
    printFailureDiagnostics(systemName, suiteName, results);

    // Release partitioned cases + results to free heap before next system group.
    for (const cases of byFaultType.values()) cases.length = 0;
    byFaultType.clear();
    results.clear();
    if (typeof globalThis.gc === 'function') globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  console.log(`\nTotal duration: ${Date.now() - startTime}ms`);
}

main().catch((err) => {
  console.error('RCAEval benchmark failed:', err);
  process.exit(1);
});
