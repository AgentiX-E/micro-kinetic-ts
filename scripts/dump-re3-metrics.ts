/**
 * Diagnostic dump: global metric-ranking + guard-leak analysis for a target
 * system's RE3 cases.
 *
 * Purpose: reveal WHY the ground-truth (GT) source is buried beneath false
 * near-zero-baseline spikes. For every case it collects every metric across
 * all services, reproduces `buildTopologyFaultGraph`'s guard sequence
 * (mean <= 0 -> idle -> transient -> change-point -> robust baseline ->
 * deviation), then prints the GT source's rank and every ACTIVE metric ranked
 * ABOVE it with full guard telemetry (head/tail/permanence/nearZero/changePt/
 * isDrop/isCrash). The leak — whether the idle guard or the transient guard
 * failed to discard the false spikes — is directly visible.
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

/** Guard state mirroring buildTopologyFaultGraph's skip sequence. */
interface GuardState {
  meanNonPositive: boolean;
  idleSkipped: boolean;
  transientSkipped: boolean;
}

interface RankedMetric {
  svc: string;
  metric: string;
  n: number;
  b: BaselineBreakdown;
  guard: GuardState;
  active: boolean;
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

    // Collect every metric (across all services) with its baseline breakdown
    // and guard state, mirroring buildTopologyFaultGraph's skip sequence:
    //   mean <= 0  ->  idle (nearZero > 0.4n)  ->  transient (nonZeroBaseline &
    //   permanence < 0.3)  ->  change-point  ->  robust baseline  ->  deviation.
    const ranked: RankedMetric[] = [];
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
        const vals = new Float64Array(valsArr);
        const n = vals.length;
        if (n < 5) continue;
        const b = computeBaselineBreakdown(vals);
        const guard: GuardState = {
          meanNonPositive: b.mean <= 0,
          idleSkipped: b.nearZeroCount > n * 0.4,
          transientSkipped: b.transientSkipped,
        };
        const active = !guard.meanNonPositive && !guard.idleSkipped && !guard.transientSkipped;
        ranked.push({ svc, metric, n, b, guard, active });
      }
    }

    // Active metrics only — the ranking set the pipeline actually scores.
    const active = ranked.filter((r) => r.active).sort((a, b) => b.b.deviation - a.b.deviation);

    // GT source = the GT service's highest-deviation active metric.
    const gtActive = ranked.filter((r) => r.svc === gt && r.active);
    const gtSource =
      gtActive.length > 0
        ? gtActive.reduce((best, r) => (r.b.deviation > best.b.deviation ? r : best))
        : undefined;

    const total = active.length;
    const skipped = ranked.length - total;
    console.log(
      `  Active metrics (not guard-skipped): ${total}; guard-skipped: ${skipped}` +
        ` (idle=${ranked.filter((r) => r.guard.idleSkipped).length}` +
        ` transient=${ranked.filter((r) => r.guard.transientSkipped).length}` +
        ` meanNonPositive=${ranked.filter((r) => r.guard.meanNonPositive).length})`,
    );
    if (gtSource) {
      const gtRank = active.indexOf(gtSource) + 1;
      console.log(
        `  GT source: ${gtSource.svc}::${gtSource.metric} dev=${gtSource.b.deviation.toFixed(3)}` +
          ` (rank ${gtRank}/${total})`,
      );
    } else {
      console.log(`  GT source: NONE (GT service has no active metric — all guard-skipped)`);
    }

    // Dump every active metric ranked ABOVE the GT source — these are the
    // false signals that bury the socket-drop source. Print their guard
    // telemetry so the leak (why the idle/transient guards missed them) is
    // visible.
    const above = gtSource ? active.slice(0, active.indexOf(gtSource)) : [];
    if (!opts.gtOnly) {
      const limit = Math.min(above.length, 50);
      console.log(`  --- ${above.length} active metrics ranked ABOVE GT (showing ${limit}) ---`);
      for (let i = 0; i < limit; i++) {
        const r = above[i]!;
        console.log(
          `  #${String(i + 1).padStart(2)} ${r.svc}::${r.metric} dev=${r.b.deviation.toFixed(3)}` +
            ` rise=${r.b.riseRatio.toFixed(2)} drop=${r.b.dropRatio.toFixed(2)}` +
            ` nearZero=${r.b.nearZeroCount}/${r.n} head=${r.b.headLevel.toFixed(4)} tail=${r.b.tailLevel.toFixed(4)}` +
            ` perm=${r.b.permanence.toFixed(3)} changePt=${r.b.changePt} strat=${r.b.strategy}` +
            ` isDrop=${r.b.isDrop} isCrash=${r.b.isCrash}`,
        );
      }
    }

    // Keep the GT-service per-metric breakdown for the socket-drop mechanism.
    for (const r of ranked.filter((x) => x.svc === gt)) {
      const b = r.b;
      console.log(
        `  [GT] ${r.svc}::${r.metric} dev=${b.deviation.toFixed(3)}` +
          ` mean=${b.mean.toFixed(4)} max=${b.max.toFixed(4)} min=${b.min.toFixed(4)}` +
          ` nearZero=${b.nearZeroCount}/${r.n} head=${b.headLevel.toFixed(4)} tail=${b.tailLevel.toFixed(4)}` +
          ` permanence=${b.permanence.toFixed(3)} transientSkip=${b.transientSkipped}` +
          ` changePt=${b.changePt} strategy=${b.strategy} isDrop=${b.isDrop} isCrash=${b.isCrash}` +
          ` base=${b.baselineMean.toFixed(4)} rise=${b.riseRatio.toFixed(3)} drop=${b.dropRatio.toFixed(3)}` +
          `${r.active ? '' : '  (guard-skipped)'}`,
      );
    }
  }
}

main();
