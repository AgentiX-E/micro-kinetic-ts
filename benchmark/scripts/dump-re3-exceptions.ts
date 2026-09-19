/**
 * Diagnostic dump: exception-semantics inventory for RCAEval RE3 code-level
 * cases.
 *
 * Purpose: settle whether a semantic (LLM) exception classifier has headroom
 * over the deterministic `LOGIC_EXCEPTION_PATTERN` whitelist that powers the
 * log signal's `count`/`novelty` modes. For every RE3 case it samples the
 * ERROR/FATAL log lines emitted at/after fault injection, classifies each via
 * {@link classifyExceptionKind} (logic / propagated / unclassified / none), and
 * reports the GROUND-TRUTH source's exception inventory plus a per-case
 * "LLM headroom" verdict:
 *
 *   - LOGIC         — the GT source throws a whitelisted logic exception; the
 *                     log signal already ranks it (no LLM gap).
 *   - UNCLASSIFIED  — the GT source throws an exception/error class that the
 *                     whitelist neither rewards as logic nor flags as
 *                     propagated. The raw class names are printed so a human
 *                     can separate connectivity/token noise (correctly ignored)
 *                     from a genuinely-missed logic exception (LLM-recoverable).
 *   - PROPAGATED    — the GT source only throws empty-payload parse failures
 *                     (a wrong-value SYMPTOM signature; unusual for a source).
 *   - SILENT        — the GT source throws no exception at all; there is no
 *                     exception content for ANY log-based signal (deterministic
 *                     or LLM) to reason over.
 *
 * A UNCLASSIFIED verdict whose names are genuinely-missed logic exceptions is
 * the ONLY case where an LLM classifier has headroom; a SILENT verdict is
 * provably out of reach for any log-based signal.
 *
 * Usage:
 *   pnpm exec tsx scripts/dump-re3-exceptions.ts [--data-dir <path>] \
 *     [--system ob|ss|tt|all] [--suite re3]
 *
 * Read-only: never writes to the data directory.
 *
 * @module scripts/dump-re3-exceptions
 */

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import {
  RCAEvalLoader,
  classifyExceptionKind,
  extractDeepestExceptionClass,
  extractExceptionNames,
  type ExceptionKind,
} from '../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';

interface CliOptions {
  dataDir: string;
  system: string; // 'ob' | 'ss' | 'tt' | 'all'
  suite: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCAEval-json'),
    system: 'all',
    suite: 're3',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--system' && i + 1 < args.length) opts.system = args[++i]!;
    else if (args[i] === '--suite' && i + 1 < args.length) opts.suite = args[++i]!;
  }
  return opts;
}

/** A single exception-class tally bucketed by semantic kind. */
interface ClassTally {
  readonly cls: string;
  readonly kind: ExceptionKind;
  count: number;
}

/** Per-service exception inventory. */
interface ServiceInventory {
  logic: number;
  propagated: number;
  unclassified: number;
  tallies: Map<string, ClassTally>;
}

/**
 * Fold every qualifying ERROR/FATAL line into a per-service inventory.
 *
 * Qualifying = emitted at/after the fault injection instant. A pre-injection
 * error storm is the normal regime, not the fault (mirrors the engine's
 * `computeLogScores` time gate). The node-membership filter is intentionally
 * omitted: the GT service is always a graph member, and sampling every service
 * is the inclusive superset needed to see what could bury the source.
 */
function buildInventories(
  logs: ReadonlyArray<{
    readonly message: string;
    readonly service: string;
    readonly timestamp: number;
    readonly level: string;
  }>,
  injectTimeMs: number,
): Map<string, ServiceInventory> {
  const inventories = new Map<string, ServiceInventory>();
  for (const log of logs) {
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    if (injectTimeMs > 0 && log.timestamp < injectTimeMs) continue;

    const kind = classifyExceptionKind(log.message);
    if (kind === 'none') continue;

    let inv = inventories.get(log.service);
    if (!inv) {
      inv = { logic: 0, propagated: 0, unclassified: 0, tallies: new Map() };
      inventories.set(log.service, inv);
    }
    if (kind === 'logic') inv.logic++;
    else if (kind === 'propagated') inv.propagated++;
    else inv.unclassified++;

    const cls = extractDeepestExceptionClass(log.message) ?? '(unknown)';
    const key = `${cls}::${kind}`;
    let tally = inv.tallies.get(key);
    if (!tally) {
      tally = { cls, kind, count: 0 };
      inv.tallies.set(key, tally);
    }
    tally.count++;
  }
  return inventories;
}

/** Collect the full exception-name surface of a service's UNCLASSIFIED lines. */
function collectUnclassifiedNames(
  logs: ReadonlyArray<{
    readonly message: string;
    readonly service: string;
    readonly timestamp: number;
    readonly level: string;
  }>,
  service: string,
  injectTimeMs: number,
): Set<string> {
  const names = new Set<string>();
  for (const log of logs) {
    if (log.service !== service) continue;
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    if (injectTimeMs > 0 && log.timestamp < injectTimeMs) continue;
    if (classifyExceptionKind(log.message) !== 'unclassified') continue;
    for (const name of extractExceptionNames(log.message)) names.add(name);
  }
  return names;
}

/** Format a class tally list into compact `cls xN [kind]` lines. */
function formatTallies(inv: ServiceInventory, limit: number): string[] {
  const sorted = [...inv.tallies.values()].sort((a, b) => b.count - a.count);
  return sorted.slice(0, limit).map((t) => `    ${t.cls} x${t.count} [${t.kind}]`);
}

function main(): void {
  const opts = parseArgs();
  const loader = new RCAEvalLoader();

  // Discover matching case directories (metrics.json present), mirroring
  // dump-re3-metrics.ts. Flat names look like re3ss_carts_f1_1.
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
      const m = name.match(/^re[123](ob|ss|tt)_/i);
      if (
        m &&
        `re${name[2]}`.toLowerCase() === opts.suite.toLowerCase() &&
        (opts.system === 'all' || m[1]!.toLowerCase() === opts.system.toLowerCase())
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

  const verdictHistogram = new Map<string, number>();
  const unclassifiedCases: { name: string; gt: string; names: string[] }[] = [];

  for (const c of cases) {
    let raw;
    try {
      raw = loader.loadCase(c.dir);
    } catch (err) {
      console.log(`[${c.name}] LOAD ERROR: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const gt = raw.groundTruth.serviceId;
    const fault = raw.groundTruth.faultType;
    const injectMs = raw.injectTime * 1000;
    const logs = raw.logs ?? [];
    const inventories = buildInventories(logs, injectMs);

    console.log(`\n[${c.name}] gt=${gt} fault=${fault} inject=${injectMs}ms`);

    const gtInv = inventories.get(gt);
    if (!gtInv) {
      console.log(`  GT ${gt}: NO exception-bearing ERROR/FATAL lines`);
      console.log(`  VERDICT: SILENT`);
      verdictHistogram.set('SILENT', (verdictHistogram.get('SILENT') ?? 0) + 1);
      continue;
    }

    console.log(
      `  GT ${gt}: logic=${gtInv.logic} propagated=${gtInv.propagated} unclassified=${gtInv.unclassified}`,
    );
    for (const line of formatTallies(gtInv, 10)) console.log(line);

    let verdict: string;
    if (gtInv.logic > 0) verdict = 'LOGIC';
    else if (gtInv.unclassified > 0) verdict = 'UNCLASSIFIED';
    else verdict = 'PROPAGATED';
    console.log(`  VERDICT: ${verdict}`);

    if (verdict === 'UNCLASSIFIED') {
      const names = collectUnclassifiedNames(logs, gt, injectMs);
      const nameList = [...names].sort().slice(0, 15);
      console.log(`  GT unclassified names: ${nameList.join(', ') || '(none extracted)'}`);
      unclassifiedCases.push({ name: c.name, gt, names: nameList });
    }
    verdictHistogram.set(verdict, (verdictHistogram.get(verdict) ?? 0) + 1);
  }

  console.log('\n' + '='.repeat(100));
  console.log('VERDICT HISTOGRAM (across all dumped cases):');
  for (const [verdict, count] of [...verdictHistogram.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    console.log(`  ${verdict.padEnd(12)} ${count}`);
  }
  if (unclassifiedCases.length > 0) {
    console.log('\nUNCLASSIFIED GT cases (candidate LLM-recoverable headroom):');
    for (const u of unclassifiedCases) {
      console.log(`  [${u.name}] gt=${u.gt}: ${u.names.join(', ')}`);
    }
  }
}

main();
