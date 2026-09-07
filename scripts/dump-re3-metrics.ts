/**
 * Diagnostic dump: full metric-series shape for a target system's RE3 cases.
 *
 * Purpose: pin down the exact head/tail shape that the crash-victim baseline
 * gate (`computeRobustBaseline`) must distinguish. It dumps, per metric, the
 * head/tail medians, the fraction of the series sitting at the "high" (head)
 * level, whether the current crash gate (`tailMedian < headMedian × 0.1`)
 * would fire, and the full compressed value series.
 *
 * Usage:
 *   pnpm exec tsx scripts/dump-re3-metrics.ts [--data-dir <path>] \
 *     [--system ss|ob|tt] [--suite re3] [--gt-only]
 *
 * Read-only: never writes to the data directory.
 *
 * @module scripts/dump-re3-metrics
 */

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { RCAEvalLoader } from '../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';

interface CliOptions {
  dataDir: string;
  system: string;
  suite: string;
  gtOnly: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCAEval-json'),
    system: 'ss',
    suite: 're3',
    gtOnly: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--system' && i + 1 < args.length) opts.system = args[++i]!;
    else if (args[i] === '--suite' && i + 1 < args.length) opts.suite = args[++i]!;
    else if (args[i] === '--gt-only') opts.gtOnly = true;
  }
  return opts;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function medianOf(values: Float64Array, start: number, end: number): number {
  return median(Array.from(values.slice(start, end)).sort((a, b) => a - b));
}

/** Downsample a long series to ~40 representative points for a compact dump. */
function summarize(values: Float64Array): string {
  const n = values.length;
  if (n <= 40) return Array.from(values).join(',');
  // Keep first 12, middle 16, last 12 — enough to see the head/tail/transition.
  const step = Math.floor((n - 24) / 16) || 1;
  const out: number[] = [];
  for (let i = 0; i < 12; i++) out.push(values[i]!);
  for (let k = 0; k < 16; k++) out.push(values[12 + k * step]!);
  for (let i = n - 12; i < n; i++) out.push(values[i]!);
  return out.join(',');
}

/**
 * Mirror of the tree package's internal `computeAnomalyFeatures` baseline path
 * (change-point detection -> robust baseline -> rise/drop/deviation), reproduced
 * here so the dump reveals WHY a metric got its reported base/rise/drop without
 * exporting the private helpers. Kept in lockstep with
 * `packages/tree/src/causal/topology-fault-graph.ts`.
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
  transientSkipped: boolean;
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

  // Idle guard.
  let nearZeroCount = 0;
  for (let i = 0; i < n; i++) if (values[i]! <= max * 0.001) nearZeroCount++;

  // Transient guard.
  const headLevel = values[0]!;
  const tailLevel = values[n - 1]!;
  const range = max - min;
  const headTailSpread = Math.abs(headLevel - tailLevel);
  const nonZeroBaseline = headLevel > max * 0.001 && tailLevel > max * 0.001;
  const permanence = range > max * 1e-6 ? headTailSpread / range : 1;
  const transientSkipped = nonZeroBaseline && permanence < 0.3;

  // Change-point detection.
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

  // Recompute isDrop/isCrash for reporting (already computed above in the
  // fallback path; recompute cheaply for the changePt>2 path).
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
    transientSkipped,
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

function main(): void {
  const opts = parseArgs();
  const loader = new RCAEvalLoader();

  // Discover matching case directories (metrics.json present).
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
      // Flat names look like re3ss_carts_f1_1; the suite digit is at index 2.
      const m = name.match(/^re[123](ob|ss|tt)_/i);
      if (
        m &&
        `re${name[2]}`.toLowerCase() === opts.suite.toLowerCase() &&
        m[1]!.toLowerCase() === opts.system
      ) {
        cases.push({ dir: cur, name });
      }
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) queue.push(join(cur, e.name));
    }
  }
  cases.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Dumping ${cases.length} cases (system=${opts.system}, suite=${opts.suite})`);
  console.log('='.repeat(100));

  for (const c of cases) {
    let raw;
    try {
      raw = loader.loadCase(c.dir);
    } catch (err) {
      console.log(`[${c.name}] LOAD ERROR: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const gt = raw.groundTruth.serviceId;
    const inject = raw.injectTime;
    console.log(`\n[${c.name}] gt=${gt} inject=${inject} fault=${raw.groundTruth.faultType}`);

    const serviceNames = Object.keys(raw.metrics);
    for (const svc of serviceNames) {
      if (opts.gtOnly && svc !== gt) continue;
      // Group points by metric_name.
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
        const vals = new Float64Array(valsArr);
        const n = vals.length;
        if (n < 5) continue;
        const headMedian = medianOf(vals, 0, Math.min(5, n));
        const tailMedian = medianOf(vals, n - Math.min(5, n), n);
        // "high" = points at/above half the head median (the pre-crash level).
        let highCount = 0;
        for (let i = 0; i < n; i++) if (vals[i]! >= headMedian * 0.5) highCount++;
        const highFraction = highCount / n;
        const crashFires = headMedian > 0.001 && tailMedian < headMedian * 0.1;
        const marker = crashFires ? 'CRASH-GATE-FIRES' : 'no-fire';
        const gtTag = svc === gt ? '  <GT>' : '';
        console.log(
          `  ${svc}${gtTag} :: ${metric} n=${n} headMedian=${headMedian.toFixed(4)}` +
            ` tailMedian=${tailMedian.toFixed(4)} tail/head=${(headMedian > 0 ? tailMedian / headMedian : 0).toFixed(3)}` +
            ` highFraction=${(highFraction * 100).toFixed(1)}% ${marker}`,
        );
        // Dump the series only for crash-gated metrics and GT metrics (the
        // shapes that matter for the fix).
        if (crashFires || svc === gt) {
          console.log(`      series=[${summarize(vals)}]`);
        }
        // For GT metrics, emit the full baseline breakdown so the socket-drop
        // under-scoring mechanism (base anchored to the wrong side) is visible.
        if (svc === gt) {
          const b = computeBaselineBreakdown(vals);
          console.log(
            `      breakdown: mean=${b.mean.toFixed(4)} max=${b.max.toFixed(4)} min=${b.min.toFixed(4)}` +
              ` nearZero=${b.nearZeroCount}/${n} head=${b.headLevel.toFixed(4)} tail=${b.tailLevel.toFixed(4)}` +
              ` permanence=${b.permanence.toFixed(3)} transientSkip=${b.transientSkipped}` +
              ` changePt=${b.changePt} strategy=${b.strategy} isDrop=${b.isDrop} isCrash=${b.isCrash}` +
              ` base=${b.baselineMean.toFixed(4)} rise=${b.riseRatio.toFixed(3)} drop=${b.dropRatio.toFixed(3)} dev=${b.deviation.toFixed(3)}`,
          );
        }
      }
    }
  }
}

main();
