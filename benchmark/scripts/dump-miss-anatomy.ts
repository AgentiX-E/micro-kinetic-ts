/**
 * Diagnostic probe: what DID decide each miss, in the ranking formula's own terms.
 *
 * The published configuration leaves 236 of 1 422 cases outside `Top@1`, and 138 of those put the truth beyond
 * rank 10. The aggregate cannot say why, and eight iterations of arm-building have been paid for by guesses at
 * the answer. This probe replaces the guess with the formula's own breakdown: every result the engine returns
 * carries {@link ScoreTerm} rows that sum exactly to its `finalScore`, and the truth's row set and the winner's
 * row set differ term by term. The term with the largest positive difference is the one that decided the miss.
 *
 * That decomposition is not a re-derivation. It is read off `analyze`, so a probe row and a run row are the same
 * numbers by construction — the property `dump-failure-flows.ts` established for the flow counts, applied here
 * to the score.
 *
 * Three classes of answer are distinguishable, and they imply different work:
 *
 *   - `selfAnomalyLog1p` decides: the winner is louder in the metric channel. No prior can repair that, because
 *     every other term is a correction applied to this one; the work is to the anomaly itself.
 *   - a PRIOR decides (`topo`, `pool`, `log`, `trace`, `rise`, `lat`, …): the corpus gave the engine a signal that
 *     pointed the wrong way, and the sign and size of that misdirection is measurable here.
 *   - the truth is ABSENT from the results: it left the pool, which is a set decision taken before any score, and
 *     no weight can reach it.
 *
 * Read-only. Usage:
 *   pnpm exec tsx scripts/dump-miss-anatomy.ts \
 *     --data-dir <path> --per-case <ndjson from the run being explained> \
 *     [--out <path>] [<runner flags passed through>]
 *
 * @module scripts/dump-miss-anatomy
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import type { FSE26RawCase } from '../packages/kinetic/src/benchmarks/index.js';
import { FSE26Loader, toFaultGraphOptions } from '../packages/kinetic/src/benchmarks/index.js';
import type { TreePruner } from '../packages/tree/src/pruning/pruner.js';

import { discoverCaseDirs } from '../benchmarks/src/case-discovery.js';
import { buildContainmentPruner } from '../benchmarks/src/containment-pruner.js';
import { readFaultFreeProfileFile } from '../benchmarks/src/fault-free-profile-file.js';
import { parseFSE26Args } from '../benchmarks/src/fse26-cli.js';
import { buildFse26EngineOptions } from '../benchmarks/src/fse26-engine-options.js';
import { decompose, tableOf, type TermTable } from '../benchmarks/src/miss-anatomy.js';

/** Reporting width for a rank; wide enough that `0` means absent rather than large. */
const PROBE_WIDTH = 64;

/** Which cases to probe, and where the rows go. */
interface AnatomyOptions {
  readonly perCase: string;
  readonly out: string;
  readonly dataDir: string;
  readonly passthrough: readonly string[];
}

/**
 * Split this probe's own flags from the runner's.
 *
 * Everything else reaches the runner's parser unchanged, so the score being explained is the score a run of that
 * configuration would publish. A probe that hard-coded the shipped options would answer a question about a
 * dispatch nobody made.
 *
 * @param argv - Process arguments after the script name.
 * @returns The probe's own selection and the arguments the runner owns.
 */
function parseAnatomyArgs(argv: readonly string[]): AnatomyOptions {
  let perCase = '';
  let out = '';
  let dataDir = '';
  const passthrough: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--per-case' && i + 1 < argv.length) perCase = argv[++i]!;
    else if (arg === '--out' && i + 1 < argv.length) out = argv[++i]!;
    else if (arg === '--data-dir' && i + 1 < argv.length) {
      dataDir = argv[++i]!;
      passthrough.push('--data-dir', dataDir);
    } else passthrough.push(arg);
  }
  return {
    perCase,
    out,
    dataDir: dataDir === '' ? resolve(homedir(), 'rcabench/json') : dataDir,
    passthrough,
  };
}

/**
 * The datapacks a run placed outside `Top@1`, with the rank each was given.
 *
 * @param path - The run's per-case NDJSON.
 * @returns Datapack name to the truth's rank under that run.
 */
function readMisses(path: string): Map<string, number> {
  const misses = new Map<string, number>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as { datapack?: string; truthRank?: number };
    if (typeof row.datapack !== 'string') continue;
    const rank = typeof row.truthRank === 'number' ? row.truthRank : 0;
    if (rank !== 1) misses.set(row.datapack, rank);
  }
  return misses;
}

/** One case's row. */
interface AnatomyRow {
  readonly datapack: string;
  readonly faultType: string;
  /** The truth's rank in the published order; `0` when the results do not hold it. */
  readonly truthRank: number;
  /** The truth's own service, or the best-ranked accepted label when it was ranked. */
  readonly truthService: string;
  readonly truthScore: number;
  readonly winner: string;
  readonly winnerScore: number;
  /** The truth's contributions, or `null` when it never reached a result. */
  readonly truthTerms: TermTable | null;
  readonly winnerTerms: TermTable;
  /** The term whose contribution favoured the winner most: `winner − truth`, maximised. */
  readonly decisiveTerm: string;
  readonly decisiveDelta: number;
  /** Every term, `winner − truth`; absent terms are `0` on the side that lacks them. */
  readonly deltas: TermTable;
}

/**
 * Probe one case: rank it, and decompose the gap between the truth and the winner.
 *
 * @param loader - The corpus loader.
 * @param raw - The loaded datapack.
 * @param pruner - The engine, built under the caller's configuration.
 * @returns The row, or `undefined` when the case carries no call edges.
 */
function probeCase(
  loader: FSE26Loader,
  raw: FSE26RawCase,
  pruner: TreePruner,
): AnatomyRow | undefined {
  const benchCase = loader.toBenchmarkCase(raw);
  if (benchCase.callGraph.edges.length === 0) return undefined;
  const graph = pruner.buildFaultGraph(
    benchCase.callGraph,
    benchCase.metrics,
    toFaultGraphOptions(benchCase, benchCase.injectTime),
  );
  const width = Math.max(PROBE_WIDTH, benchCase.callGraph.nodes.size);
  const results = pruner.analyze(graph, width);
  const truth =
    raw.groundTruthServices.length > 0
      ? raw.groundTruthServices
      : [benchCase.groundTruth.serviceId];
  const winner = results[0];
  if (winner === undefined) return undefined;
  const winnerTerms = tableOf(winner.terms);
  const truthResult = results.find((row) => truth.includes(row.serviceId));
  const truthTerms = truthResult === undefined ? null : tableOf(truthResult.terms);
  // The decomposition itself is the measured module's, not this script's: a probe that re-implemented the rule
  // could disagree with the tool a test holds, and the disagreement would surface in a report nobody could trace.
  const { deltas, decisiveTerm, decisiveDelta } = decompose(truthTerms, winnerTerms);
  return {
    datapack: raw.datapack,
    faultType: raw.faultType ?? 'unknown',
    truthRank: truthResult?.rank ?? 0,
    truthService: truthResult?.serviceId ?? truth[0]!,
    truthScore: truthResult?.finalScore ?? 0,
    winner: winner.serviceId,
    winnerScore: winner.finalScore ?? 0,
    truthTerms,
    winnerTerms,
    decisiveTerm,
    decisiveDelta,
    deltas,
  };
}

/**
 * Run the probe over every miss the reference run recorded.
 *
 * @param options - Selection and destination.
 */
function main(options: AnatomyOptions): void {
  const parsed = parseFSE26Args([...options.passthrough, '--data-dir', options.dataDir]);
  const profileRead =
    parsed.faultFreeProfilePath === undefined
      ? undefined
      : readFaultFreeProfileFile(parsed.faultFreeProfilePath);
  const engineOptions = buildFse26EngineOptions(parsed, profileRead?.profile);
  const pruner = buildContainmentPruner(engineOptions);
  const loader = new FSE26Loader();
  const misses = readMisses(options.perCase);
  const dirs = discoverCaseDirs(options.dataDir);
  process.stderr.write(
    `probe: ${misses.size} misses, ${dirs.length} dirs -> ${options.out === '' ? 'stdout' : options.out}\n`,
  );
  const rows: AnatomyRow[] = [];
  let written = 0;
  for (const dir of dirs) {
    let raw: FSE26RawCase;
    try {
      raw = loader.loadCase(dir);
    } catch {
      continue;
    }
    if (!misses.has(raw.datapack)) continue;
    const row = probeCase(loader, raw, pruner);
    if (row === undefined) continue;
    rows.push(row);
    written++;
    if (written % 25 === 0) process.stderr.write(`probe: ${written}/${misses.size}\r`);
  }
  const text = rows.map((row) => `${JSON.stringify(row)}\n`).join('');
  if (options.out === '') process.stdout.write(text);
  else {
    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    writeFileSync(resolve(options.out), text, 'utf8');
  }
  process.stderr.write(`probe: wrote ${written} rows\n`);
}

main(parseAnatomyArgs(process.argv.slice(2)));
