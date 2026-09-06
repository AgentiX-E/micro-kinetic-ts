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

import { existsSync, readdirSync } from 'node:fs';
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
      if (m && `re${name[2]}`.toLowerCase() === opts.suite.toLowerCase() && m[1]!.toLowerCase() === opts.system) {
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
      }
    }
  }
}

main();
