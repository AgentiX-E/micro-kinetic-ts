/**
 * `run-depth-slice` — print the causal-depth table of an artifact that has already been paid for.
 *
 * One artifact pair in, one table out: the answers a dispatch published (`query-agent.ndjson`) and the call graph the
 * containment artifact carries (`containment.ndjson`). No corpus, no engine, no model call — the slice is a property
 * of the cases, so pricing it twice would be paying for the same number.
 *
 * Both files are identified by digest before the table is printed. 329 spent a day on a two-case difference that was
 * only ever two dispatches, and a table read from a file nobody can name is not a reading.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-depth-slice.ts \
 *     --containment artifacts/agentic/containment.ndjson \
 *     --queries artifacts/agentic/query-agent.ndjson
 *
 * @module benchmarks/run-depth-slice
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { formatSliceReport, sliceByCausalDepth, type SliceRow } from './causal-depth-slice.js';
import type { CallGraph } from './channel-ancestry.js';

/** The flags this runner accepts. */
interface Args {
  readonly containment: string;
  readonly queries: string;
  readonly entry: string;
}

/** One line of the query artifact, in the fields this runner reads. */
interface QueryLine {
  readonly datapack: string;
  readonly truth: readonly string[];
  readonly answer: string | null;
  readonly answeredBy: string;
}

/** One line of the containment artifact, in the fields this runner reads. */
interface ContainmentLine {
  readonly datapack: string;
  readonly chain: { readonly edges: readonly (readonly [string, string])[] };
}

/** Read the flags, refusing an unknown one rather than ignoring it. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index] ?? '';
    if (!key.startsWith('--')) throw new Error(`unknown argument \`${key}\``);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const containment = map.get('containment') ?? '';
  const queries = map.get('queries') ?? '';
  if (containment === '' || queries === '') {
    throw new Error('--containment and --queries are required');
  }
  return { containment, queries, entry: map.get('entry') ?? 'ts-ui-dashboard' };
}

/** Read newline-delimited JSON, refusing a malformed line by number. */
function readLines<T>(path: string): T[] {
  const text = readFileSync(path, 'utf8');
  const rows: T[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      throw new Error(`${path}:${index + 1} is not JSON`);
    }
  });
  return rows;
}

/** The first sixteen hex characters of a file's digest, which is enough to name a dispatch. */
function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

const args = parseArgs(process.argv.slice(2));
const queries = readLines<QueryLine>(args.queries);
const containment = readLines<ContainmentLine>(args.containment);

const graphs = new Map<string, CallGraph>();
for (const line of containment) graphs.set(line.datapack, { edges: line.chain.edges });

const rows: readonly SliceRow[] = queries.map((line) => ({
  datapack: line.datapack,
  truth: line.truth,
  answer: line.answer,
}));

console.log(
  `queries      ${args.queries}  sha256:${digestOf(args.queries)}  rows=${queries.length}`,
);
console.log(
  `containment  ${args.containment}  sha256:${digestOf(args.containment)}  rows=${containment.length}`,
);
console.log('');

const report = sliceByCausalDepth(rows, (datapack) => graphs.get(datapack) ?? null, args.entry);
console.log(formatSliceReport(report, args.entry));

const byAnswered = new Map<string, number>();
for (const line of queries)
  byAnswered.set(line.answeredBy, (byAnswered.get(line.answeredBy) ?? 0) + 1);
console.log('');
console.log(
  `answered by: ${[...byAnswered.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([who, count]) => `${who} ${count}`)
    .join(' · ')}`,
);
