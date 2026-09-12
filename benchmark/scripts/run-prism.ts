/**
 * PRISM head-to-head runner — reimplement PRISM (arXiv:2601.21359) and score
 * it on the SAME 735 RCAEval cases our engine evaluates.
 *
 * PRISM is graph-free: it only needs per-service metrics and the injection
 * time, so this script loads each case, converts the raw metric points into
 * the TimeSeries shape, runs {@link computePrismRanking}, and compares the
 * top-1 prediction against the ground-truth service. The output is the same
 * 9-cell (RE1/RE2/RE3 x OB/SS/TT) AC@1 table the benchmark runner prints,
 * so the two numbers are directly comparable on identical cases.
 *
 * Usage:
 *   pnpm exec tsx scripts/run-prism.ts [--data-dir <path>] \
 *     [--pooling additive|conjunctive] [--max-cases <n>]
 *
 * Read-only: never writes to the data directory.
 *
 * @module scripts/run-prism
 */

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import type { TimeSeries } from '../packages/core/src/types/time-series.js';

import { RCAEvalLoader } from '../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';
import {
  computePrismRanking,
  type PrismPooling,
} from '../packages/kinetic/src/benchmarks/leaderboard/prism.js';

interface CliOptions {
  dataDir: string;
  pooling: PrismPooling;
  maxCases: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { dataDir: join(homedir(), 'RCAEval-json'), pooling: 'additive', maxCases: 0 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--pooling' && i + 1 < args.length)
      opts.pooling = args[++i] === 'conjunctive' ? 'conjunctive' : 'additive';
    else if (args[i] === '--max-cases' && i + 1 < args.length) opts.maxCases = Number(args[++i]);
  }
  return opts;
}

/**
 * Convert raw RCAEval metric points (service -> {timestamp,value,metric_name})
 * into the TimeSeries map PRISM consumes. Mirrors RCAEvalLoader.buildMetricMap:
 * group by metric_name, sort by timestamp, timestamps in milliseconds.
 */
function toMetricMap(
  rawMetrics: Record<string, ReadonlyArray<{ timestamp: number; value: number; metric_name: string }>>,
): Map<string, readonly TimeSeries[]> {
  const map = new Map<string, readonly TimeSeries[]>();
  for (const [svc, points] of Object.entries(rawMetrics)) {
    const byMetric = new Map<string, { t: number; v: number }[]>();
    for (const p of points) {
      let entry = byMetric.get(p.metric_name);
      if (!entry) {
        entry = [];
        byMetric.set(p.metric_name, entry);
      }
      entry.push({ t: p.timestamp * 1000, v: p.value });
    }
    const series: TimeSeries[] = [];
    for (const [name, data] of byMetric) {
      data.sort((a, b) => a.t - b.t);
      series.push({
        label: name,
        timestamps: data.map((d) => d.t),
        values: new Float64Array(data.map((d) => d.v)),
        unit: '',
      });
    }
    map.set(svc, series);
  }
  return map;
}

/** Per-cell accuracy accumulator. */
interface Cell {
  correct: number;
  total: number;
}

const SUITES = ['re1', 're2', 're3'] as const;
const SYSTEMS: Record<string, string> = { ob: 'OnlineBoutique', ss: 'SockShop', tt: 'TrainTicket' };

function main(): void {
  const opts = parseArgs();
  const loader = new RCAEvalLoader();

  // Discover every case directory (metrics.json present), mirroring the dump
  // script's BFS. Case dir names look like re1ob_*, re2ss_*, re3tt_*, etc.
  const dirs: string[] = [];
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
      if (/^re[123](ob|ss|tt)_/i.test(name)) dirs.push(cur);
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) queue.push(join(cur, e.name));
    }
  }
  dirs.sort();

  const selected = opts.maxCases > 0 ? dirs.slice(0, opts.maxCases) : dirs;

  const cells = new Map<string, Cell>();
  const keyFor = (suite: string, sys: string) => `${suite}|${sys}`;
  const cellFor = (suite: string, sys: string): Cell => {
    const k = keyFor(suite, sys);
    let c = cells.get(k);
    if (!c) {
      c = { correct: 0, total: 0 };
      cells.set(k, c);
    }
    return c;
  };

  let loadErrors = 0;

  for (const dir of selected) {
    const name = basename(dir);
    const m = name.match(/^re([123])(ob|ss|tt)_/i);
    if (!m) continue;
    const suite = `re${m[1]}`.toLowerCase();
    const sys = m[2]!.toLowerCase();

    let raw;
    try {
      raw = loader.loadCase(dir);
    } catch {
      loadErrors++;
      continue;
    }

    const metrics = toMetricMap(raw.metrics);
    // RCAEval stores inject_time in seconds; PRISM scores in milliseconds.
    const injectMs = raw.injectTime * 1000;
    const ranking = computePrismRanking(metrics, injectMs, { pooling: opts.pooling });
    const top1 = ranking[0]?.serviceId;
    const cell = cellFor(suite, sys);
    cell.total++;
    if (top1 === raw.groundTruth.serviceId) cell.correct++;
  }

  // ── Report ───────────────────────────────────────────────
  console.log('');
  console.log(`${'═'.repeat(80)}`);
  console.log(`PRISM (reimplementation) — RCAEval graph-free RCA  [pooling=${opts.pooling}]`);
  console.log(`${'═'.repeat(80)}`);
  console.log(`Cases discovered: ${dirs.length}; evaluated: ${selected.length}; load errors: ${loadErrors}`);
  console.log('');

  const suiteLabel: Record<string, string> = { re1: 'RE1', re2: 'RE2', re3: 'RE3' };
  let overallCorrect = 0;
  let overallTotal = 0;

  for (const suite of SUITES) {
    for (const sysCode of ['ob', 'ss', 'tt']) {
      const cell = cells.get(keyFor(suite, sysCode));
      const total = cell?.total ?? 0;
      const correct = cell?.correct ?? 0;
      const pct = total > 0 ? ((correct / total) * 100).toFixed(1) : 'N/A';
      console.log(
        `  [${suiteLabel[suite]}] ${SYSTEMS[sysCode]!.padEnd(14)} AC@1 = ${pct}%  (${correct}/${total})`,
      );
      overallCorrect += correct;
      overallTotal += total;
    }
  }

  const overall = overallTotal > 0 ? ((overallCorrect / overallTotal) * 100).toFixed(1) : 'N/A';
  console.log('');
  console.log(`${'═'.repeat(80)}`);
  console.log(`  Overall Top-1 = ${overall}%  (${overallCorrect}/${overallTotal})`);
  console.log(`${'═'.repeat(80)}`);
}

main();
