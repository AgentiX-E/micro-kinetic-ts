/**
 * Diagnostic dump: network-loss ("loss") fault signature analysis.
 *
 * The routing probe readback showed `loss` is the single largest bothWrong
 * contributor (34/77) and the worst union rate among the big fault types
 * (66.7%; engine 55.9% / PRISM 52.0%, both near chance). This dump answers the
 * question that decides whether loss is deterministically crackable: DOES the
 * ground-truth source service show ANY metric deviation, and if so, in what
 * metric name and direction (rise vs drop)?
 *
 * For every loss case across RE1/RE2 it collects every metric across all
 * services, reproduces `buildTopologyFaultGraph`'s guard sequence + baseline
 * breakdown (mean<=0 -> idle -> transient -> change-point -> robust baseline
 * -> deviation), then reports:
 *   - the metric-name inventory (so the loss-specific metric, e.g. a
 *     request-count/throughput drop, can be identified);
 *   - the GT source's per-metric breakdown (is the source silent, a rise, or a
 *     drop?);
 *   - the top-ranked metric (the engine's would-be false positive).
 *
 * Usage:
 *   pnpm exec tsx scripts/dump-loss-metrics.ts [--data-dir <path>] [--limit N]
 *                                              [--fault-type <type>]
 *
 * Read-only: never writes to the data directory.
 *
 * @module scripts/dump-loss-metrics
 */

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { RCAEvalLoader } from '../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';

interface CliOptions {
  dataDir: string;
  limit: number;
  faultType: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCAEval-json'),
    limit: Number.POSITIVE_INFINITY,
    faultType: 'loss',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--limit' && i + 1 < args.length) opts.limit = Number(args[++i]!);
    else if (args[i] === '--fault-type' && i + 1 < args.length) opts.faultType = args[++i]!;
  }
  return opts;
}

/**
 * Mirror of `packages/tree/src/causal/topology-fault-graph.ts`'s baseline path,
 * reproduced here (as in dump-re3-metrics.ts) so the dump reports the SAME
 * base/rise/drop/deviation the engine actually scores.
 */
function medianOfRange(values: Float64Array, start: number, end: number): number {
  const slice = Array.from(values.slice(start, end)).sort((a, b) => a - b);
  const n = slice.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? slice[mid]! : (slice[mid - 1]! + slice[mid]!) / 2;
}

function detectBaselineStrategy(values: Float64Array, n: number): 'q25' | 'sliding-window' {
  const minVal = Math.min(...values.slice(0, n));
  const maxVal = Math.max(...values.slice(0, n));
  if (maxVal === minVal) return 'sliding-window';
  let spikeCount = 0;
  for (let i = 0; i < n; i++) if (values[i]! >= maxVal * 0.8) spikeCount++;
  const spikeRatio = spikeCount / n;
  return spikeRatio > 0.3 && spikeRatio <= 0.7 ? 'q25' : 'sliding-window';
}

interface BaselineBreakdown {
  mean: number;
  max: number;
  min: number;
  nearZeroCount: number;
  headLevel: number;
  tailLevel: number;
  permanence: number;
  changePt: number;
  baselineMean: number;
  strategy: 'q25' | 'sliding-window';
  isDrop: boolean;
  isCrash: boolean;
  riseRatio: number;
  dropRatio: number;
  deviation: number;
}

function computeBaselineBreakdown(values: Float64Array): BaselineBreakdown {
  const n = values.length;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    sum += v;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  const mean = sum / n;

  let nearZeroCount = 0;
  for (let i = 0; i < n; i++) if (values[i]! <= max * 0.001) nearZeroCount++;

  const headLevel = values[0]!;
  const tailLevel = values[n - 1]!;
  const range = max - min;
  const headTailSpread = Math.abs(headLevel - tailLevel);
  const permanence = range > max * 1e-6 ? headTailSpread / range : 1;

  let baselineMean = mean;
  let changePt = n;
  const fullVariance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const fullStd = Math.sqrt(fullVariance);
  for (let i = 1; i < n; i++) {
    if (values[i]! > mean + 1.5 * fullStd) {
      changePt = i;
      break;
    }
  }
  if (changePt < n && changePt > 2) {
    let bs = 0;
    for (let i = 0; i < changePt; i++) bs += values[i]!;
    baselineMean = bs / changePt;
    if (baselineMean <= 0) baselineMean = mean;
  } else {
    const strategy = detectBaselineStrategy(values, n);
    const headWin = Math.max(2, Math.min(5, n));
    const tailWin = Math.max(2, Math.min(5, n));
    const headMedian = medianOfRange(values, 0, headWin);
    const tailMedian = medianOfRange(values, n - tailWin, n);
    const isCrash = headMedian > 0.001 && tailMedian < headMedian * 0.1;
    const half = Math.floor(n / 2);
    let firstSum = 0;
    for (let i = 0; i < half; i++) firstSum += values[i]!;
    let secondSum = 0;
    for (let i = half; i < n; i++) secondSum += values[i]!;
    const isDrop = firstSum / half > secondSum / (n - half);
    if (isCrash) {
      const headSorted = Array.from(values.slice(0, headWin)).sort((a, b) => a - b);
      const upperIdx = Math.min(headSorted.length - 1, Math.ceil(headSorted.length * 0.75) - 1);
      baselineMean = headSorted[upperIdx]! > 0.001 ? headSorted[upperIdx]! : mean;
    } else if (strategy === 'q25') {
      const sorted = Array.from(values.slice(0, n)).sort((a, b) => a - b);
      if (isDrop) {
        const lo = Math.floor(n * 0.75);
        let s = 0;
        for (let k = lo; k < n; k++) s += sorted[k]!;
        baselineMean = s / (n - lo);
      } else {
        const q25Idx = Math.max(1, Math.floor(n * 0.25));
        let s = 0;
        for (let k = 0; k < q25Idx; k++) s += sorted[k]!;
        baselineMean = s / q25Idx;
      }
      if (baselineMean <= 0.001) baselineMean = mean;
    } else {
      const winSize = Math.max(2, Math.ceil(n * 0.25));
      let extreme = isDrop ? -Infinity : Infinity;
      for (let w = 0; w <= n - winSize; w++) {
        let s = 0;
        for (let k = 0; k < winSize; k++) s += values[w + k]!;
        const m = s / winSize;
        if (isDrop ? m > extreme : m < extreme) extreme = m;
      }
      baselineMean = extreme > 0.001 ? extreme : mean;
    }
  }

  const riseRatio = Math.abs(max - baselineMean) / baselineMean;
  const dropRatio = Math.abs(baselineMean - min) / baselineMean;
  const ratio = Math.max(riseRatio, dropRatio);
  const deviation = Math.log10(1 + ratio);

  const headWin = Math.max(2, Math.min(5, n));
  const tailWin = Math.max(2, Math.min(5, n));
  const headMedian = medianOfRange(values, 0, headWin);
  const tailMedian = medianOfRange(values, n - tailWin, n);
  const isCrash = headMedian > 0.001 && tailMedian < headMedian * 0.1;
  const half = Math.floor(n / 2);
  let firstSum = 0;
  for (let i = 0; i < half; i++) firstSum += values[i]!;
  let secondSum = 0;
  for (let i = half; i < n; i++) secondSum += values[i]!;
  const isDrop = firstSum / half > secondSum / (n - half);

  return {
    mean,
    max,
    min,
    nearZeroCount,
    headLevel,
    tailLevel,
    permanence,
    changePt,
    baselineMean,
    strategy: detectBaselineStrategy(values, n),
    isDrop,
    isCrash,
    riseRatio,
    dropRatio,
    deviation,
  };
}

interface MetricSample {
  svc: string;
  metric: string;
  n: number;
  b: BaselineBreakdown;
  active: boolean;
}

/** Aggregate signature across all dumped cases. */
const agg = {
  cases: 0,
  gtHasActive: 0,
  gtDrop: 0,
  gtRise: 0,
  gtSilent: 0,
  gtTop1: 0,
  metricDir: new Map<string, { drop: number; rise: number }>(),
};

function main(): void {
  const opts = parseArgs();
  const loader = new RCAEvalLoader();

  // Discover loss case directories (name pattern `re[12](ob|ss|tt)_<svc>_loss_<n>`).
  const cases: { dir: string; name: string }[] = [];
  const queue = [opts.dataDir];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    const hasMetrics = entries.some((e) => e.isFile() && e.name === 'metrics.json');
    if (hasMetrics) {
      const name = basename(cur);
      // Escape the fault type so it is matched literally (fault types are
      // simple identifiers, but never interpolate user input unescaped).
      const ftPattern = opts.faultType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`^re[12](ob|ss|tt)_.*_${ftPattern}_\\d+$`, 'i').test(name)) {
        cases.push({ dir: cur, name });
      }
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) queue.push(join(cur, e.name));
    }
  }
  cases.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Dumping ${cases.length} ${opts.faultType} cases (limit ${opts.limit})`);
  console.log('='.repeat(100));

  for (const c of cases.slice(0, opts.limit)) {
    let raw;
    try {
      raw = loader.loadCase(c.dir);
    } catch (err) {
      console.log(`[${c.name}] LOAD ERROR: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const gt = raw.groundTruth.serviceId;
    agg.cases++;

    const samples: MetricSample[] = [];
    const metricNames = new Set<string>();
    for (const svc of Object.keys(raw.metrics)) {
      const byMetric = new Map<string, number[]>();
      for (const p of raw.metrics[svc]!) {
        let arr = byMetric.get(p.metric_name);
        if (!arr) {
          arr = [];
          byMetric.set(p.metric_name, arr);
        }
        arr.push(p.value);
      }
      for (const [metric, valsArr] of byMetric) {
        metricNames.add(metric);
        const vals = new Float64Array(valsArr);
        const n = vals.length;
        if (n < 5) continue;
        const b = computeBaselineBreakdown(vals);
        const meanNonPositive = b.mean <= 0;
        const idleSkipped = b.nearZeroCount > n * 0.4;
        const active = !meanNonPositive && !idleSkipped;
        samples.push({ svc, metric, n, b, active });
      }
    }

    const active = samples.filter((s) => s.active).sort((a, b) => b.b.deviation - a.b.deviation);
    const gtActive = samples.filter((s) => s.svc === gt && s.active);
    const gtBest =
      gtActive.length > 0
        ? gtActive.reduce((best, s) => (s.b.deviation > best.b.deviation ? s : best))
        : undefined;

    if (gtBest) {
      agg.gtHasActive++;
      if (gtBest.b.isDrop) agg.gtDrop++;
      else agg.gtRise++;
      if (active[0] === gtBest) agg.gtTop1++;
      const dir = agg.metricDir.get(gtBest.metric) ?? { drop: 0, rise: 0 };
      if (gtBest.b.isDrop) dir.drop++;
      else dir.rise++;
      agg.metricDir.set(gtBest.metric, dir);
    } else {
      agg.gtSilent++;
    }

    console.log(`\n[${c.name}] gt=${gt}`);
    console.log(`  metric-name inventory: ${Array.from(metricNames).sort().join(', ')}`);
    if (gtBest) {
      console.log(
        `  GT source best: ${gtBest.metric} dev=${gtBest.b.deviation.toFixed(3)}` +
          ` ${gtBest.b.isDrop ? 'DROP' : 'RISE'}` +
          ` rise=${gtBest.b.riseRatio.toFixed(2)} drop=${gtBest.b.dropRatio.toFixed(2)}` +
          ` (rank ${active.indexOf(gtBest) + 1}/${active.length})`,
      );
    } else {
      console.log(`  GT source: SILENT (no active metric — all guard-skipped or near-zero)`);
    }
    if (active.length > 0 && active[0]!.svc !== gt) {
      console.log(
        `  top false positive: ${active[0]!.svc}::${active[0]!.metric}` +
          ` dev=${active[0]!.b.deviation.toFixed(3)} ${active[0]!.b.isDrop ? 'DROP' : 'RISE'}`,
      );
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log(`AGGREGATE ${opts.faultType.toUpperCase()} SIGNATURE`);
  console.log('='.repeat(100));
  console.log(`  cases: ${agg.cases}`);
  console.log(
    `  GT source: active=${agg.gtHasActive} (${((agg.gtHasActive / Math.max(1, agg.cases)) * 100).toFixed(1)}%)` +
      `  silent=${agg.gtSilent}`,
  );
  console.log(`    of active: DROP=${agg.gtDrop}  RISE=${agg.gtRise}  top1=${agg.gtTop1}`);
  console.log('  GT source best metric by direction:');
  const sortedMetrics = Array.from(agg.metricDir.entries()).sort(
    (a, b) => b[1].drop + b[1].rise - (a[1].drop + a[1].rise),
  );
  for (const [metric, d] of sortedMetrics) {
    console.log(`    ${metric}: drop=${d.drop} rise=${d.rise}`);
  }
}

main();
