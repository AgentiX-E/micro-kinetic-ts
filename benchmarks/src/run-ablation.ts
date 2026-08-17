/**
 * Ablation Study Runner — measures each feature's marginal contribution
 * by running benchmarks with features individually toggled on/off.
 *
 * ## Matrix
 *
 * | Feature        | Flag       | Expected effect    |
 * |----------------|------------|--------------------|
 * | Collision Q(f,f) | collisionAg | Amplifies bottleneck detection |
 * | PC Causal       | pcDisc      | Prunes spurious edges |
 * | Trace Topo      | traceAug    | Discovers missing edges from traces |
 * | Weight Calib    | selfLearn   | Adaptive signal blending |
 *
 * ## Methodology
 *
 * For each feature toggle combination, run ALL benchmark cases × 3 repetitions.
 * Compute mean A@1 and standard deviation. Report Δ vs baseline (all OFF).
 *
 * @module benchmarks/run-ablation
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { WeightCalibrator } from '../../packages/kinetic/src/signals/weight-calibrator.js';
import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';
import {
  buildRCAEvalCallGraph,
  enhanceRCAEvalCallGraph,
  initRCAEvalTopology,
  isRCAEvalTopologyInitialized,
} from './rcaeval-topology.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Feature Configuration ─────────────────────────────────

interface FeatureFlags {
  /** Collision tree aggregator with Boltzmann Q(f,f). */
  collisionAggregation: boolean;
  /** Trace topology augmentation. */
  traceAugmentation: boolean;
  /** Online weight calibration (self-evolving). */
  selfLearning: boolean;
  /** Log signal: reward post-injection ERROR/FATAL volume (logWeight). */
  logSignal: boolean;
  /** Topological-source signal: reward no-anomalous-parent nodes (topoWeight). */
  topoSignal: boolean;
  /** Collision-energy signal: penalise upstream-inherited energy (collisionWeight). */
  collisionSignal: boolean;
  /** Monotonicity-based trend when code-level evidence is present. */
  codeLevelTrend: boolean;
}

interface AblationRun {
  flags: FeatureFlags;
  label: string;
  results: Map<string, AblationResult>;
}

interface AblationResult {
  aTop1: number;
  aTop5: number;
  la: number;
  ta: number;
  totalCases: number;
  duration: number;
  failures: number;
  // Per-fault-type breakdown
  perFaultType: Map<string, { cases: number; accuracy: number }>;
  // Individual repetitions for stddev
  reps: number[];
}

// ── Configurations to Test ────────────────────────────────
//
// Full factorial over the 3 remaining features (2^3 = 8 configs).
// PC Causal Discovery was removed — see ABLATION_FINDINGS.md in the
// docs repo: it reduced Top-1 accuracy by up to 4.0% on RE2.

const CONFIGS: Array<{ flags: FeatureFlags; label: string }> = [
  // Baseline: everything OFF
  {
    flags: {
      collisionAggregation: false,
      traceAugmentation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: 'BASELINE (all OFF)',
  },
  // Individual features
  {
    flags: {
      collisionAggregation: true,
      traceAugmentation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: '+Collision Q(f,f)',
  },
  {
    flags: {
      collisionAggregation: false,
      traceAugmentation: true,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: '+Trace Topo',
  },
  {
    flags: {
      collisionAggregation: false,
      traceAugmentation: false,
      selfLearning: true,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: '+SelfLearn',
  },
  // Pairs
  {
    flags: {
      collisionAggregation: true,
      traceAugmentation: true,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: '+Collision+Trace',
  },
  {
    flags: {
      collisionAggregation: true,
      traceAugmentation: false,
      selfLearning: true,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: '+Collision+SelfLearn',
  },
  {
    flags: {
      collisionAggregation: false,
      traceAugmentation: true,
      selfLearning: true,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: '+Trace+SelfLearn',
  },
  // Full stack
  {
    flags: {
      collisionAggregation: true,
      traceAugmentation: true,
      selfLearning: true,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: 'FULL STACK (all ON)',
  },
  // ── New ranking signals (marginal over BASELINE, one at a time) ──
  // Each measures the marginal contribution of a single ranking signal.
  // They are NOT part of the full factorial above — 2^6 = 64 configs × 3 reps
  // would exceed CI budget — so they are added as 1-D slices: baseline + one
  // signal at full strength (weight 1.0).
  {
    flags: {
      collisionAggregation: false,
      traceAugmentation: false,
      selfLearning: false,
      logSignal: true,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: '+Log Signal',
  },
  {
    flags: {
      collisionAggregation: false,
      traceAugmentation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: true,
      collisionSignal: false,
      codeLevelTrend: false,
    },
    label: '+Topo Signal',
  },
  {
    // The collision signal consumes `ratioContrib`, which is only populated
    // when Boltzmann aggregation is ON — so this config enables aggregation
    // (unlike +Log/+Topo). Its marginal over "+Collision Q(f,f)" isolates the
    // collisionWeight penalty from the aggregation itself.
    flags: {
      collisionAggregation: true,
      traceAugmentation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: true,
      codeLevelTrend: false,
    },
    label: '+Collision Signal',
  },
  {
    // Monotonicity-based trend when the case carries code-level evidence
    // (logic exceptions). Marginal over BASELINE — isolates whether suppressing
    // the magnitude trend for a symptom's sharp collapse lifts TT RE3 without
    // hurting the resource-fault cells.
    flags: {
      collisionAggregation: false,
      traceAugmentation: false,
      selfLearning: false,
      logSignal: false,
      topoSignal: false,
      collisionSignal: false,
      codeLevelTrend: true,
    },
    label: '+CodeLevel Trend',
  },
];

// Default to 3 repetitions for statistical significance
const REPETITIONS = 3;

// ── Helpers ───────────────────────────────────────────────

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
    if (!process.env[key]) process.env[key] = value;
  }
}

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

  // Pattern B: nested format — walk parent chain for re{1-3} and system code
  const chain = dirPath.replace(/\\/g, '/').split('/');
  let suiteNum: string | undefined;
  let sysCode: string | undefined;

  for (let i = chain.length - 2; i >= 0; i--) {
    const segment = chain[i]!;
    const suiteM = segment.match(/^re([123])$/i);
    if (suiteM && !suiteNum) {
      suiteNum = suiteM[1]!;
      continue;
    }
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
    faultType: 'cpu' as CaseMeta['faultType'],
    instance,
    dirPath,
  };
}

function discoverAllCases(dataDir: string): CaseMeta[] {
  if (!existsSync(dataDir)) return [];
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
      /* skip */
    }
  }
  return cases;
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let dataDir = join(homedir(), 'RCAEval-json');
  let systemFilter = 'all';
  let suiteFilter = 'all';
  let maxCases = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) dataDir = args[++i]!;
    else if (args[i] === '--system' && i + 1 < args.length) systemFilter = args[++i]!;
    else if (args[i] === '--suite' && i + 1 < args.length) suiteFilter = args[++i]!;
    else if (args[i] === '--max-cases' && i + 1 < args.length)
      maxCases = parseInt(args[++i]!, 10) || 0;
  }

  console.log('═'.repeat(80));
  console.log('Micro-Kinetic — Feature Ablation Study');
  console.log('═'.repeat(80));
  console.log(`Data:       ${dataDir}`);
  console.log(`Filter:     system=${systemFilter}, suite=${suiteFilter}`);
  console.log(`Configs:    ${CONFIGS.length}`);
  console.log(`Repetitions: ${REPETITIONS}`);
  console.log('═'.repeat(80));

  loadEnvFile();

  const allCases = discoverAllCases(dataDir);
  console.log(`\nDiscovered: ${allCases.length} cases`);

  // ── Group by system ──
  const systemGroups = new Map<string, CaseMeta[]>();
  for (const c of allCases) {
    if (systemFilter !== 'all' && !c.system.toLowerCase().includes(systemFilter.toLowerCase()))
      continue;
    // Suite filter: 're1' matches RE1, 're2' matches RE2, etc.
    if (suiteFilter !== 'all' && c.suite !== `RE${suiteFilter.replace(/^re/i, '')}`) continue;
    const key = c.system;
    if (!systemGroups.has(key)) systemGroups.set(key, []);
    systemGroups.get(key)!.push(c);
  }

  if (systemGroups.size === 0) {
    console.log('No cases found. Exiting.');
    return;
  }

  // ── Init topology ──
  const semanticConfig = {
    embeddingProvider: null,
    llmProvider: null,
    alignmentConfig: { embeddingThreshold: 0.6, llmThreshold: 0.5 },
  };

  const forceTfIdf = process.env['BENCHMARK_USE_TFIDF'] === '1';
  const zhipuKey = process.env['ZHIPU_API_KEY'];
  if (zhipuKey && !forceTfIdf) {
    try {
      const { createApiEmbeddingFromEnv } = await import('@agentix-e/micro-kinetic-ai');
      semanticConfig.embeddingProvider = createApiEmbeddingFromEnv({
        vendorPrefix: 'ZHIPU',
        endpoint:
          process.env['ZHIPU_EMBEDDING_ENDPOINT'] ??
          'https://open.bigmodel.cn/api/paas/v4/embeddings',
        model: process.env['ZHIPU_EMBEDDING_MODEL'] ?? 'embedding-3',
        dimension: Number(process.env['ZHIPU_EMBEDDING_DIMENSION'] ?? '2048'),
      });
      console.log('Semantic: Zhipu embedding-3 ✓');
    } catch {
      console.log('Semantic: TF-IDF fallback');
    }
  } else {
    console.log('Semantic: TF-IDF (no ZHIPU_API_KEY)');
  }

  await initRCAEvalTopology(undefined, semanticConfig);

  /**
   * Build a fresh DI container for a single ablation config.
   *
   * The collision-aggregation feature is controlled by the TreePruner's
   * `enableCollisionAggregation` option; the three ranking signals map to the
   * `collisionWeight` / `topoWeight` / `logWeight` options (weight 1.0 when
   * enabled). Each config gets its own container so the flags are wired
   * directly into the engine registered under RCA_ENGINE.
   */
  function buildContainer(flags: FeatureFlags): Container {
    const c = new Container();
    c.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
    c.register(
      DI_TOKENS.RCA_ENGINE,
      () =>
        new TreePruner(
          {
            enableCollisionAggregation: flags.collisionAggregation,
            collisionWeight: flags.collisionSignal ? 1.0 : 0.0,
            topoWeight: flags.topoSignal ? 1.0 : 0.0,
            logWeight: flags.logSignal ? 1.0 : 0.0,
          },
          { codeLevelMonotonicTrend: flags.codeLevelTrend },
        ),
    );
    c.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());
    return c;
  }

  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  const loader = new RCAEvalLoader();

  // ── Load cases per-system (streaming) ──────────────────
  // On RE2/RE3 (270+ cases × thousands of trace spans each) loading
  // everything into memory crashes the heap even at 6 GiB.  Load and
  // process one system-bundle at a time, then release the references
  // so that GC can reclaim before the next bundle.
  //
  // Each system-bundle is the full (OnlineBoutique, RE1-3) set, or
  // (SockShop, RE1-3), or (TrainTicket, RE1-3).  The grouping is
  // coarse enough that ablations see the full dataset, but fine enough
  // that peak memory stays within the default 4 GiB heap.
  type SystemBundle = {
    systemName: string;
    cases: BenchmarkCase[];
    /** Case id → directory path, for lazy per-case trace loading. */
    caseDirMap: Map<string, string>;
  };

  async function loadSystemBundle(systemName: string, metas: CaseMeta[]): Promise<SystemBundle> {
    const cases: BenchmarkCase[] = [];
    const caseDirMap = new Map<string, string>();
    const selected = maxCases > 0 ? metas.slice(0, maxCases) : metas;
    for (const meta of selected) {
      try {
        const rawCase = loader.loadCase(meta.dirPath);
        const serviceIds = Object.keys(rawCase.metrics);

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

        const benchCase = loader.toBenchmarkCase(rawCase, callGraph, suiteName);
        // Do NOT retain per-case traces here — RE2 traces.csv files are
        // large enough that holding all 50 cases' spans at once OOMs.
        // Record the directory path so the traceAugmentation config can
        // load traces lazily, one fault-type group at a time.
        cases.push(benchCase);
        caseDirMap.set(benchCase.id, meta.dirPath);
      } catch (err) {
        console.log(
          `  ⚠ load error: ${meta.dirPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { systemName, cases, caseDirMap };
  }

  console.log('\n═'.repeat(80));
  console.log('Running Ablation');

  if (systemGroups.size === 0) {
    console.log('No benchmark cases discovered. Exiting.');
    return;
  }
  console.log('═'.repeat(80));

  // ── Run Ablation ──
  // Process ONE system at a time: load its bundle, run ALL configs on it,
  // release, then next system.  Pre-building all systems at once holds
  // 150+ RE2 cases (call graphs + trace spans + Zhipu embeddings) in memory
  // → OOM on public runners (TrainTicket has 68-69 services/case).
  const allRuns: AblationRun[] = CONFIGS.map((c) => ({
    flags: c.flags,
    label: c.label,
    results: new Map<string, AblationResult>(),
  }));

  for (const [systemName, metas] of systemGroups) {
    console.log(`\n${'═'.repeat(60)}`);

    // ── Pre-build this system's bundle ONCE ──
    console.log(`  Pre-building ${systemName} …`);
    const bundle = await loadSystemBundle(systemName, metas);
    console.log(`  Pre-built: ${systemName} → ${bundle.cases.length} cases`);

    // Split cases by fault type (same across all configs for this system)
    const byFT = new Map<string, BenchmarkCase[]>();
    for (const c of bundle.cases) {
      const ft = (c.groundTruth?.faultType ?? 'unknown').toLowerCase();
      if (!byFT.has(ft)) byFT.set(ft, []);
      byFT.get(ft)!.push(c);
    }

    for (let ci = 0; ci < CONFIGS.length; ci++) {
      const config = CONFIGS[ci]!;
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Running: ${config.label}`);
      console.log(`Flags: ${JSON.stringify(config.flags)}`);
      console.log(`${'─'.repeat(60)}`);

      console.log(`  ${systemName}: ${bundle.cases.length} cases`);

      // ── Wire feature flags into this config's engine ──
      // Collision aggregation: toggles TreePruner.enableCollisionAggregation.
      // The three ranking signals map to collisionWeight/topoWeight/logWeight.
      const container = buildContainer(config.flags);
      // Self-learning: a SHARED calibrator across this config's reps/Fts so
      // weight updates from earlier cases feed back into later ones.
      const calibrator = config.flags.selfLearning ? new WeightCalibrator() : undefined;

      let allA1 = 0,
        allA5 = 0,
        allLA = 0,
        allTA = 0;
      let totalCases = 0,
        totalFailures = 0,
        totalDuration = 0;
      const perFaultType = new Map<string, { cases: number; accuracy: number }>();
      const reps: number[] = [];

      for (let rep = 0; rep < REPETITIONS; rep++) {
        let repA1 = 0,
          repCases = 0;

        for (const [ft, ftCases] of byFT) {
          if (ftCases.length === 0) continue;

          // ── Apply feature flags ──

          // Trace topology augmentation: when enabled and trace span
          // data is present (RE2/RE3), augment the call graph with
          // observed parent-child relationships from traces. Traces are
          // loaded lazily per fault-type group (NOT pre-loaded) so peak
          // memory stays bounded — RE2 traces.csv files are large enough
          // that holding every case's spans at once OOMs.
          const traceOpts = config.flags.traceAugmentation
            ? {
                enabled: true,
                pruneUnobserved: true,
                discoverNewEdges: false,
                minCallFrequency: 0,
                spans: [],
              }
            : undefined;

          // Attach per-case traces only when this config needs them; other
          // configs reuse the plain (trace-free) cases.
          const suiteCases = config.flags.traceAugmentation
            ? ftCases.map((c) => {
                const dirPath = bundle.caseDirMap.get(c.id);
                return { ...c, traces: dirPath ? loader.loadTraces(dirPath) : undefined };
              })
            : ftCases;
          const suite: BenchmarkSuite = {
            name: `${systemName}-${ft}`,
            cases: suiteCases,
            totalCases: suiteCases.length,
          };

          const runner = new BenchmarkRunner(container, classifier, traceOpts, calibrator);

          const result = await runner.runSuite(suite);
          repCases += suite.cases.length;

          totalCases += suite.cases.length;
          allA1 += result.avgTop1 * suite.cases.length;
          allA5 += result.avgTop5 * suite.cases.length;
          allLA += result.locationAccuracy * suite.cases.length;
          allTA += result.typeAccuracy * suite.cases.length;
          totalFailures += result.failures.length;
          totalDuration += result.duration;

          // Per-fault-type
          const existing = perFaultType.get(ft) ?? { cases: 0, accuracy: 0 };
          let ftAcc: number;
          const ftMetric = result.perFaultType.get(ft);
          if (ftMetric) {
            ftAcc =
              (existing.accuracy * existing.cases + ftMetric.accuracy * ftMetric.cases) /
              Math.max(1, existing.cases + ftMetric.cases);
          } else {
            ftAcc = existing.accuracy;
          }
          perFaultType.set(ft, { cases: existing.cases + ftCases.length, accuracy: ftAcc });
        }

        reps.push(repCases > 0 ? repA1 / repCases : 0);

        if (REPETITIONS > 1) {
          const pct = (((rep + 1) / REPETITIONS) * 100).toFixed(0);
          process.stdout.write(`  Rep ${rep + 1}/${REPETITIONS} (${pct}%)... `);
        }
      }

      const avgA1 = totalCases > 0 ? allA1 / totalCases : 0;
      const avgA5 = totalCases > 0 ? allA5 / totalCases : 0;
      const avgLA = totalCases > 0 ? allLA / totalCases : 0;
      const avgTA = totalCases > 0 ? allTA / totalCases : 0;

      allRuns[ci]!.results.set(systemName, {
        aTop1: avgA1,
        aTop5: avgA5,
        la: avgLA,
        ta: avgTA,
        totalCases,
        duration: totalDuration,
        failures: totalFailures,
        perFaultType,
        reps,
      });

      console.log(
        `  A@1=${(avgA1 * 100).toFixed(1)}% A@5=${(avgA5 * 100).toFixed(1)}% ` +
          `LA=${(avgLA * 100).toFixed(1)}% TA=${(avgTA * 100).toFixed(1)}% ` +
          `(${totalCases} cases, ${totalFailures} failures, ${totalDuration}ms)`,
      );

      // Yield to event loop after each config so GC can collect temporary
      // BenchmarkSuite / RunResult objects before the next config starts.
      if (typeof globalThis.gc === 'function') {
        globalThis.gc();
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    } // end config loop

    // Release this system's bundle before loading the next system.
    // Each RE2 system holds 50 cases × call graphs + trace spans + embeddings;
    // releasing prevents accumulation across systems (OOM on TrainTicket).
    bundle.cases.length = 0;
    byFT.clear();
    if (typeof globalThis.gc === 'function') globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } // end system loop

  // ── Results Table ──
  console.log(`\n${'═'.repeat(80)}`);
  console.log('ABLATION RESULTS');
  console.log(`${'═'.repeat(80)}`);

  // Header — use system groups as dataset keys
  const datasets = [...systemGroups.keys()];
  let header = `${'Configuration'.padEnd(30)}`;
  for (const ds of datasets) header += ` ${ds.padEnd(16)}`;
  header += ' AVG';
  console.log(header);
  console.log('─'.repeat(80));

  const baseline = allRuns[0]!;
  const baselineAvgs = new Map<string, number>();
  for (const [ds, r] of baseline.results) baselineAvgs.set(ds, r.aTop1);

  for (const run of allRuns) {
    let row = `${run.label.padEnd(30)}`;
    let totalA1 = 0;
    let count = 0;
    for (const ds of datasets) {
      const r = run.results.get(ds);
      const val = r ? (r.aTop1 * 100).toFixed(1) + '%' : '     N/A';
      row += ` ${val.padEnd(16)}`;
      if (r) {
        totalA1 += r.aTop1;
        count++;
      }
    }
    const avg = count > 0 ? ((totalA1 / count) * 100).toFixed(1) + '%' : 'N/A';

    // Δ vs baseline
    const bAvg = count > 0 ? totalA1 / count : 0;
    const baseAvg = count > 0 ? [...baselineAvgs.values()].reduce((s, v) => s + v, 0) / count : 0;
    const delta = bAvg - baseAvg;
    const deltaStr = delta >= 0 ? `+${(delta * 100).toFixed(1)}%` : `${(delta * 100).toFixed(1)}%`;
    row += ` ${avg.padEnd(6)} Δ${deltaStr}`;
    console.log(row);
  }

  console.log(`${'═'.repeat(80)}`);

  // ── Per-fault-type breakdown ──
  // Reconstruct fault-type sets from all runs' perFaultType results.
  for (const systemName of systemGroups.keys()) {
    // Collect fault types observed for this system across all configs.
    const ftSet = new Set<string>();
    for (const run of allRuns) {
      const res = run.results.get(systemName);
      if (res) {
        for (const ft of res.perFaultType.keys()) {
          ftSet.add(ft);
        }
      }
    }
    const faultTypes = [...ftSet].sort();

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`${systemName} — Per-Fault-Type A@1 Breakdown`);
    console.log(`${'─'.repeat(80)}`);

    let ftHeader = `${'Configuration'.padEnd(30)}`;
    for (const ft of faultTypes) ftHeader += ` ${ft.padEnd(10)}`;
    console.log(ftHeader);

    for (const run of allRuns) {
      const r = run.results.get(systemName);
      let ftRow = `${run.label.padEnd(30)}`;
      if (r) {
        for (const ft of faultTypes) {
          const ftData = r.perFaultType.get(ft);
          const val = ftData
            ? (ftData.accuracy * 100).toFixed(0) + '%' + `(${ftData.cases})`.padStart(5)
            : '   N/A    ';
          ftRow += ` ${val.padEnd(10)}`;
        }
      }
      console.log(ftRow);
    }
  }

  // ── Save results ──
  // Total cases across all loaded bundles (sum of system group meta counts).
  const totalCaseCount = [...systemGroups.values()].reduce((s, m) => s + m.length, 0);
  const resultsJson = {
    timestamp: new Date().toISOString(),
    systemFilter,
    repetitions: REPETITIONS,
    totalCases: totalCaseCount,
    datasets: datasets,
    runs: allRuns.map((r) => ({
      label: r.label,
      flags: r.flags,
      results: Object.fromEntries(
        [...r.results.entries()].map(([ds, res]) => [
          ds,
          {
            aTop1: res.aTop1,
            aTop5: res.aTop5,
            la: res.la,
            ta: res.ta,
            totalCases: res.totalCases,
            duration: res.duration,
            failures: res.failures,
            reps: res.reps,
            perFaultType: Object.fromEntries(res.perFaultType),
          },
        ]),
      ),
    })),
  };

  const outputPath = join(__dirname, '..', '..', 'ablation-results.json');
  writeFileSync(outputPath, JSON.stringify(resultsJson, null, 2));
  console.log(`\nResults saved: ${outputPath}`);
}

main().catch((err) => {
  console.error('Ablation study failed:', err);
  process.exit(1);
});
