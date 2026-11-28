/**
 * Apply {@link classifyMiss} to an artifact, and print where the arm's misses actually are.
 *
 * The artifact is the record and the corpus is the shape, so this reads both and nothing else: no model call, no
 * token, no network. That is deliberate — a census that costs anything is a census nobody runs after every arm.
 *
 *     pnpm exec tsx benchmarks/src/run-agentic-failure-codes.ts \
 *       --artifact artifacts/agentic/query-agent.ndjson --data-dir $HOME/rcabench/json
 *
 * It prints the census, then up to three case ids per code, because a rate with no example is a number a reader
 * cannot check.
 *
 * @module benchmarks/run-agentic-failure-codes
 */

import { readFileSync } from 'node:fs';

import { FSE26Loader } from '../../packages/kinetic/src/benchmarks/index.js';
import {
  FAILURE_CODES,
  accumulateFailureCodeCensus,
  classifyMiss,
  createFailureCodeCensus,
  renderFailureCodeCensus,
  type FailureCode,
  type MissGraph,
  type MissRecord,
} from './agentic-failure-codes.js';
import { isEntryPoint } from './cell-baseline.js';
import { buildTelemetry } from './query-agent.js';

/** How many case ids to print per code. */
const EXAMPLES = 3;

/** The command line. */
export interface FailureCodeArgs {
  readonly artifact: string;
  readonly dataDir: string;
}

/**
 * Parse the command line.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments.
 */
export function parseFailureCodeArgs(argv: readonly string[]): FailureCodeArgs {
  let artifact = '';
  let dataDir = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--artifact') artifact = argv[++index] ?? '';
    else if (arg === '--data-dir') dataDir = argv[++index] ?? '';
    // A token that matches no branch is REFUSED rather than ignored: a mistyped path would leave the default and
    // the census would describe an artifact nobody named.
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (artifact === '' || dataDir === '') throw new Error('--artifact and --data-dir are required');
  return { artifact, dataDir };
}

/**
 * The truth's direct callers and callees, read from the case's own call graph.
 *
 * `callers` is the set a miss can be reversed INTO — the truth's upstream — and `callees` the set an overshoot
 * lands in. Two hops would blur the distinction the codes exist to draw, so this reads one.
 *
 * @param dir - The case directory.
 * @returns The graph, or `undefined` when the case cannot be loaded.
 */
export function graphOf(dir: string): MissGraph | undefined {
  const loader = new FSE26Loader();
  let raw;
  try {
    raw = loader.loadCase(dir);
  } catch {
    return undefined;
  }
  const bench = loader.toBenchmarkCase(raw);
  const truth =
    raw.groundTruthServices.length > 0 ? raw.groundTruthServices : [bench.groundTruth.serviceId];
  const telemetry = buildTelemetry(bench);
  const callers = new Set<string>();
  const callees = new Set<string>();
  for (const name of truth) {
    const service = telemetry.services.get(name);
    if (service === undefined) continue;
    for (const caller of service.callers) callers.add(caller);
    for (const callee of service.callees) callees.add(callee);
  }
  return { callers, callees };
}

/** Run the census over one artifact and print it. */
export function main(argv: readonly string[]): {
  readonly census: ReturnType<typeof createFailureCodeCensus>;
  readonly examples: ReadonlyMap<FailureCode, readonly string[]>;
} {
  const args = parseFailureCodeArgs(argv);
  let census = createFailureCodeCensus();
  const examples = new Map<FailureCode, string[]>(FAILURE_CODES.map((code) => [code, []]));
  for (const line of readFileSync(args.artifact, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as MissRecord & { datapack: string; stop: string };
    if (row.stop === 'error') continue;
    const graph = graphOf(`${args.dataDir}/${row.datapack}`);
    // A case the corpus no longer carries is out of the population rather than counted as a code: the census is
    // over misses it can describe, and a missing directory describes nothing.
    if (graph === undefined) continue;
    census = accumulateFailureCodeCensus(census, row, graph);
    const code = classifyMiss(row, graph);
    if (code !== undefined) {
      const bucket = examples.get(code)!;
      if (bucket.length < EXAMPLES) bucket.push(row.datapack);
    }
  }
  for (const line of renderFailureCodeCensus(census)) console.log(line);
  for (const code of FAILURE_CODES) {
    const bucket = examples.get(code)!;
    if (bucket.length === 0) continue;
    console.log(`  ${code}: ${bucket.join(', ')}`);
  }
  return { census, examples };
}

if (isEntryPoint(process.argv[1], import.meta.url)) main(process.argv.slice(2));
