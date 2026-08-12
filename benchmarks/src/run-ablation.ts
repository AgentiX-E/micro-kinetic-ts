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
  /** PC algorithm causal discovery. */
  pcCausalDiscovery: boolean;
  /** Trace topology augmentation. */
  traceAugmentation: boolean;
  /** Online weight calibration (self-evolving). */
  selfLearning: boolean;
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

const CONFIGS: Array<{ flags: FeatureFlags; label: string }> = [
  // Baseline: everything OFF
  {
    flags: {
      collisionAggregation: false,
      pcCausalDiscovery: false,
      traceAugmentation: false,
      selfLearning: false,
    },
    label: 'BASELINE (all OFF)',
  },
  // Individual features
  {
    flags: {
      collisionAggregation: true,
      pcCausalDiscovery: false,
      traceAugmentation: false,
      selfLearning: false,
    },
    label: '+Collision Q(f,f)',
  },
  {
    flags: {
      collisionAggregation: false,
      pcCausalDiscovery: true,
      traceAugmentation: false,
      selfLearning: false,
    },
    label: '+PC Causal',
  },
  {
    flags: {
      collisionAggregation: false,
      pcCausalDiscovery: false,
      traceAugmentation: true,
      selfLearning: false,
    },
    label: '+Trace Topo',
  },
  {
    flags: {
      collisionAggregation: false,
      pcCausalDiscovery: false,
      traceAugmentation: false,
      selfLearning: true,
    },
    label: '+SelfLearn',
  },
  // Pairs
  {
    flags: {
      collisionAggregation: true,
      pcCausalDiscovery: true,
      traceAugmentation: false,
      selfLearning: false,
    },
    label: '+Collision+PC',
  },
  {
    flags: {
      collisionAggregation: true,
      pcCausalDiscovery: false,
      traceAugmentation: true,
      selfLearning: false,
    },
    label: '+Collision+Trace',
  },
  {
    flags: {
      collisionAggregation: false,
      pcCausalDiscovery: true,
      traceAugmentation: true,
      selfLearning: false,
    },
    label: '+PC+Trace',
  },
  // Full stack
  {
    flags: {
      collisionAggregation: true,
      pcCausalDiscovery: true,
      traceAugmentation: true,
      selfLearning: false,
    },
    label: '+Collision+PC+Trace',
  },
  {
    flags: {
      collisionAggregation: true,
      pcCausalDiscovery: true,
      traceAugmentation: true,
      selfLearning: true,
    },
    label: 'FULL STACK (all ON)',
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

  const container = new Container();
  container.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
  container.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner());
  container.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());

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
  };

  async function loadSystemBundle(systemName: string, metas: CaseMeta[]): Promise<SystemBundle> {
    const cases: BenchmarkCase[] = [];
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
        cases.push(benchCase);
      } catch (err) {
        console.log(
          `  ⚠ load error: ${meta.dirPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { systemName, cases };
  }

  console.log('\n═'.repeat(80));
  console.log('Running Ablation');

  if (systemGroups.size === 0) {
    console.log('No benchmark cases discovered. Exiting.');
    return;
  }
  console.log('═'.repeat(80));

  // ── Run Ablation ──
  const allRuns: AblationRun[] = [];

  for (const config of CONFIGS) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Running: ${config.label}`);
    console.log(`Flags: ${JSON.stringify(config.flags)}`);
    console.log(`${'─'.repeat(60)}`);

    const runResults = new Map<string, AblationResult>();

    // Process each system independently to bound peak memory
    for (const [systemName, bundle] of systemBundles) {
      console.log(`  ${systemName}: ${bundle.cases.length} cases`);
      // Split cases by fault type for per-fault-type breakdown
      const byFT = new Map<string, BenchmarkCase[]>();
      for (const c of bundle.cases) {
        const ft = (c.groundTruth?.faultType ?? 'unknown').toLowerCase();
        if (!byFT.has(ft)) byFT.set(ft, []);
        byFT.get(ft)!.push(c);
      }

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
          const suite: BenchmarkSuite = {
            name: `${systemName}-${ft}`,
            cases: ftCases,
            totalCases: ftCases.length,
          };

          // ── Apply feature flags ──
          // PC causal discovery: when enabled, prune non-causal edges
          // and discover new edges from conditional independence tests.
          const pcOpts = config.flags.pcCausalDiscovery
            ? { enabled: true, pruneNonCausal: true, discoverNewEdges: true }
            : undefined;

          // Trace topology augmentation: when enabled and trace span
          // data is present (RE2/RE3), augment the call graph with
          // observed parent-child relationships from traces.
          const traceOpts = config.flags.traceAugmentation
            ? {
                enabled: true,
                pruneUnobserved: true,
                discoverNewEdges: false,
                minCallFrequency: 0,
                spans: [],
              }
            : undefined;

          // Collision aggregation is controlled via a TreePruner config
          // override on the container-registered engine.  Self-learning
          // is always instantiated but only affects subsequent runs
          // through the same calibrator instance.
          const runner = new BenchmarkRunner(container, classifier, pcOpts, traceOpts);

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

      runResults.set(systemName, {
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
      // Bundle is pre-built and cached — no need to release.
    }

    allRuns.push({ flags: config.flags, label: config.label, results: runResults });

    // Yield to event loop after each config so GC can collect temporary
    // BenchmarkSuite / RunResult objects before the next config starts.
    // Without this the node process retains ~3.8 GB of stale reachable
    // objects (closure scopes + suite arrays), causing OOM on RE2/RE3.
    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

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
