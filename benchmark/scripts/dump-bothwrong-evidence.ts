/**
 * Diagnostic probe: dump the evidence a gated LLM judge would see for the
 * bothWrong hard-floor cases (where the deterministic engine AND PRISM both
 * miss the ground-truth source).
 *
 * The fusion-ceiling readback fixed the deterministic frontier at ~82% and the
 * union ceiling at 87.5%, leaving 77 bothWrong cases (12.5%) that no
 * deterministic signal recovers. The loss and delay verdicts attributed those
 * misses to a "weak source" — the victim's latency rises MORE than the source's,
 * and RCAEval's service-granularity metric schema (no inbound/outbound split)
 * makes them observationally equivalent.
 *
 * The open question this probe answers: does the MULTIMODAL evidence (trace
 * call graph + deepest exception classes) carry information the metric-only
 * signals cannot, such that an LLM judge could disambiguate source from victim?
 *
 * For each requested case it dumps three evidence channels:
 *   1. trace-derived call edges (parentSpanId -> child service), the runtime
 *      causal graph the metric-only signals do not see;
 *   2. per-service metric deviation (direction + magnitude), reproducing the
 *      engine's own baseline path so the weak-source signature is visible;
 *   3. per-service deepest `Caused by:` exception class (the code-level fault
 *      fingerprint).
 *
 * Usage:
 *   pnpm exec tsx scripts/dump-bothwrong-evidence.ts \
 *     [--data-dir <path>] [--cases <name1,name2,...>] [--limit N]
 *
 * Read-only: never writes to the data directory.
 *
 * @module scripts/dump-bothwrong-evidence
 */

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import {
  classifyExceptionKind,
  RCAEvalLoader,
} from '../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';

interface CliOptions {
  dataDir: string;
  cases: string[];
  limit: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCAEval-json'),
    cases: [],
    limit: Number.POSITIVE_INFINITY,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--cases' && i + 1 < args.length)
      opts.cases = args[++i]!.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    else if (args[i] === '--limit' && i + 1 < args.length) opts.limit = Number(args[++i]!);
  }
  return opts;
}

/**
 * Mirror of `packages/tree/src/causal/topology-fault-graph.ts`'s baseline path,
 * reproduced here (as in dump-loss-metrics.ts) so the dump reports the SAME
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
  return spikeCount / n > 0.3 && spikeCount / n <= 0.7 ? 'q25' : 'sliding-window';
}

interface BaselineBreakdown {
  mean: number;
  nearZeroCount: number;
  deviation: number;
  isDrop: boolean;
  isCrash: boolean;
  riseRatio: number;
  dropRatio: number;
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

  return { mean, nearZeroCount, deviation, isDrop, isCrash, riseRatio, dropRatio };
}

interface MetricSample {
  svc: string;
  metric: string;
  dev: number;
  isDrop: boolean;
  active: boolean;
}

/** Trace span shape (the subset this probe reads). */
interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  service: string;
}

/**
 * Derive the runtime call graph from trace spans: for every span whose parent
 * lives in a DIFFERENT service, add a directed edge parentService -> service.
 * This is the causal direction the metric-only signals never see.
 */
function deriveCallEdges(traces: readonly TraceSpan[] | undefined): string[] {
  if (!traces || traces.length === 0) return [];
  const spanToService = new Map<string, string>();
  for (const t of traces) spanToService.set(t.spanId, t.service);
  const edges = new Set<string>();
  for (const t of traces) {
    if (!t.parentSpanId) continue;
    const parentSvc = spanToService.get(t.parentSpanId);
    if (parentSvc && parentSvc !== t.service) edges.add(`${parentSvc}->${t.service}`);
  }
  return Array.from(edges).sort();
}

function main(): void {
  const opts = parseArgs();
  const loader = new RCAEvalLoader();

  // Discover case directories (any fault type), then filter to the requested
  // names when provided.
  const allCases: { dir: string; name: string }[] = [];
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
      allCases.push({ dir: cur, name: basename(cur) });
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) queue.push(join(cur, e.name));
    }
  }
  const wanted = opts.cases.length > 0 ? new Set(opts.cases) : undefined;
  const cases = (wanted ? allCases.filter((c) => wanted.has(c.name)) : allCases).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  console.log(`Dumping evidence for ${cases.length} cases (limit ${opts.limit})`);
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

    // 1. Metric deviations (top 6 by |dev|).
    const samples: MetricSample[] = [];
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
        if (vals.length < 5) continue;
        const b = computeBaselineBreakdown(vals);
        const active = b.mean > 0 && b.nearZeroCount <= vals.length * 0.4;
        samples.push({ svc, metric, dev: b.deviation, isDrop: b.isDrop, active });
      }
    }
    const top = samples
      .filter((s) => s.active)
      .sort((a, b) => b.dev - a.dev)
      .slice(0, 6);

    // 2. Trace-derived call edges.
    const edges = deriveCallEdges(raw.traces as readonly TraceSpan[] | undefined);

    // 3. Deepest exceptions per service (labelled by semantic kind). The
    //    `unclassified` bucket is exactly where an LLM classifier could have
    //    headroom over the deterministic logic whitelist.
    const excBySvc = new Map<string, { cls: string; kind: string }>();
    if (raw.logs) {
      for (const log of raw.logs) {
        const kind = classifyExceptionKind(log.message);
        if (kind === 'none') continue;
        const cls = log.deepestExceptionClass ?? '(unnamed)';
        const prev = excBySvc.get(log.service);
        // First exception wins; a service's own logic exception is the source
        // signature, while a propagated/connectivity exception is the symptom.
        if (!prev) excBySvc.set(log.service, { cls, kind });
      }
    }

    console.log(`\n[${c.name}] fault=${raw.fault} gt=${gt}`);
    console.log(`  call edges: ${edges.length > 0 ? edges.join(', ') : '(none — metrics-only)'}`);
    console.log('  metric devs (top 6):');
    for (const s of top) {
      const mark = s.svc === gt ? '  <== GT' : '';
      console.log(
        `    ${s.svc}::${s.metric} dev=${s.dev.toFixed(3)} ${s.isDrop ? 'DROP' : 'RISE'}${mark}`,
      );
    }
    const excs = Array.from(excBySvc.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    console.log(
      `  deepest exceptions: ${excs.length > 0 ? excs.map(([s, e]) => `${s}:${e.cls}(${e.kind})`).join(', ') : '(none)'}`,
    );
  }
}

main();
