/**
 * Re-score the gate-policy ladder from a real arm artifact and check its monotonicity invariant.
 *
 * ## Why this exists
 *
 * The shipped arm's five gate policies are meant to be a strictness ladder: a stricter policy refuses a superset
 * of the overrides a looser one refuses, and every refusal falls back to the engine's prior. That nesting makes
 * admitted overrides non-increasing, refusals non-decreasing, and resolved Top@1 non-decreasing. The claim lives in
 * `query-agent.ts` (`summariseGatePolicies` and `gateAdmits`) and in `gate-replay.md`; this runner makes it
 * re-scorable against any arm artifact at zero model cost.
 *
 * It is also the exact place to compare with "Free to Look, Free to Reason" (arXiv:2610.35767, 2026-10), which
 * reports that a HIGHER prescribed-call ratio correlates with LOWER accuracy for a freely calling agent. Our
 * ladder moves the other way. The two are different mechanisms — the paper prices how an agent uses the calls it
 * chooses, while this table prices a deterministic fallback rule — so the runner states both readings rather than
 * declaring one a refutation of the other.
 *
 * ## Command
 *
 *   pnpm exec tsx benchmarks/src/run-gate-monotonicity.ts \
 *     --rows artifacts/agentic/query-agent.ndjson [--resolution entry-prior] [--out report.json]
 *
 * The runner calls `summariseGatePolicies` — it never re-derives a gate reading, because a second scorer here would
 * be a second definition of the metric. It refuses a file it cannot parse rather than silently dropping rows.
 *
 * @module benchmarks/run-gate-monotonicity
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkMonotonicity, formatMonotonicity } from './gate-policy-monotonicity.js';
import type { QueryArmRow, Resolution } from './query-agent.js';
import { summariseGatePolicies } from './query-agent.js';

interface Args {
  readonly rows: string;
  readonly resolution: Resolution;
  readonly out: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let rows: string | null = null;
  let resolution: Resolution = 'entry-prior';
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--rows' && next !== undefined) {
      rows = next;
      i += 1;
    } else if (arg === '--resolution' && next !== undefined) {
      resolution = next as Resolution;
      i += 1;
    } else if (arg === '--out' && next !== undefined) {
      out = next;
      i += 1;
    } else if (arg === '--help') printUsageAndExit(0);
    else throw new Error(`unknown argument: ${arg ?? '(missing)'}`);
  }
  if (rows === null) throw new Error('--rows is required');
  return { rows, resolution, out };
}

function printUsageAndExit(code: number): never {
  process.stdout.write(
    'usage: run-gate-monotonicity --rows <query-agent.ndjson> ' +
      '[--resolution entry-prior] [--out <report.json>]\n',
  );
  process.exit(code);
}

/** Read arm rows, refusing any line that is not a JSON object. */
function readRows(path: string): readonly QueryArmRow[] {
  const text = readFileSync(path, 'utf8');
  const rows: QueryArmRow[] = [];
  let lineNo = 0;
  for (const line of text.split('\n')) {
    lineNo += 1;
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${path}:${lineNo}: not valid JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${path}:${lineNo}: row is not an object`);
    }
    rows.push(parsed as QueryArmRow);
  }
  return rows;
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${String(error instanceof Error ? error.message : error)}\n`);
    printUsageAndExit(1);
  }

  const rows = readRows(args.rows);
  // The shipped scorer, not a re-derivation: these are the same GateReadings the runner prints.
  const table = summariseGatePolicies(rows, args.resolution);
  const seeded = rows.length > 0 && rows[0]!.seeded;
  const result = checkMonotonicity(table, { seeded });
  const digest = createHash('sha256').update(readFileSync(args.rows)).digest('hex');

  const report = {
    schema: 1,
    source: args.rows,
    digest,
    rows: rows.length,
    resolution: args.resolution,
    seeded,
    monotone: result.monotone,
    table: table.map((reading) => ({
      policy: reading.policy,
      admitted: reading.admitted,
      refused: reading.refused,
      correct: reading.correct,
      correctResolved: reading.correctResolved,
    })),
    steps: result.steps,
    firstViolation: result.firstViolation,
  };

  process.stdout.write(`rows ${rows.length} · resolution ${args.resolution} · seeded ${seeded}\n`);
  process.stdout.write('policy   admitted refused  correct  resolved\n');
  for (const r of report.table) {
    process.stdout.write(
      `  ${r.policy.padEnd(9)}${String(r.admitted).padStart(7)}${String(r.refused).padStart(8)}` +
        `${String(r.correct).padStart(9)}${String(r.correctResolved).padStart(10)}\n`,
    );
  }
  process.stdout.write(`\n${formatMonotonicity(result)}\n`);
  if (!seeded) {
    process.stdout.write(
      'NOTE: free arm — refused columns describe a policy it could not execute (no incumbent fallback).\n',
    );
  }
  process.stdout.write(
    '\nReference: arXiv:2610.35767 reports the opposite slope (more prescribed calls, lower accuracy) ' +
      'for a freely calling agent — a different mechanism, not a direct refutation.\n',
  );
  process.stdout.write(`sha256 ${digest}\n`);

  if (args.out !== null) writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}

main();
