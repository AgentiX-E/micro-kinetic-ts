/**
 * `run-agentic-ceiling` — the bound under each expression protocol, and the posterior's recall curve.
 *
 * Everything printed here is offline and free: it reads the fingerprint dump, the verdict file, the recorded
 * claims, and (when given) the ranking-depth dump. No model is called and no corpus is needed.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-agentic-ceiling.ts \
 *     --fingerprints <ndjson> --verdicts <ndjson> [--claims <ndjson>] [--depth <ndjson>]
 *
 * The table's `union` column is the number this command exists for. It is the accuracy of "the engine, or the arm"
 * — the ceiling of that protocol on this population, which no model can exceed — and it is printed beside the
 * `reader` column, which no protocol can exceed. A gap between the two is what a protocol costs to speak.
 *
 * @module benchmarks/run-agentic-ceiling
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  DEFAULT_ELIMINATOR_OPTIONS,
  applyClaims,
  verifyClaim,
} from '../../packages/ai/src/agent/index.js';

import { parseClaimRecords, replayOf } from './agentic-claims.js';
import { readFingerprintFile } from './agentic-fingerprint-file.js';
import { joinHeadroom } from './agentic-headroom.js';
import { digestsOf } from './agentic-proposer.js';
import {
  formatGateCeiling,
  formatRecallCurve,
  gateCeilingOf,
  recallCurveOf,
} from './agentic-protocol-ceiling.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** Parsed arguments. */
export interface CeilingArgs {
  readonly fingerprints: string;
  readonly verdicts: string;
  readonly claims: string;
  readonly depth: string;
  readonly weights: readonly number[];
}

/**
 * Parse the arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments.
 * @throws Error on an unknown flag or a missing value, so a typo cannot run a different study.
 */
export function parseCeilingArgs(argv: readonly string[]): CeilingArgs {
  const args = {
    fingerprints: '',
    verdicts: '',
    claims: '',
    depth: '',
    weights: [1, 0.5, 0.3] as number[],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    index += 1;
    if (arg === '--fingerprints') args.fingerprints = value;
    else if (arg === '--verdicts') args.verdicts = value;
    else if (arg === '--claims') args.claims = value;
    else if (arg === '--depth') args.depth = value;
    else if (arg === '--weights') {
      const parsed = value.split(',').map((one) => Number(one));
      if (parsed.some((one) => !Number.isFinite(one) || one < 0 || one > 1)) {
        throw new Error('--weights must be a comma-separated list in [0, 1]');
      }
      args.weights = parsed;
    } else throw new Error(`unknown flag ${arg}`);
  }
  if (args.fingerprints === '' || args.verdicts === '') {
    throw new Error('--fingerprints and --verdicts are both required');
  }
  return args;
}

function main(): void {
  const args = parseCeilingArgs(process.argv.slice(2));
  const join = joinHeadroom(
    readFingerprintFile(args.fingerprints),
    readPerCaseVerdicts(args.verdicts),
  );

  console.log('Micro-Kinetic — protocol ceilings');
  console.log('═'.repeat(78));
  console.log(`Paired: ${join.cases.length} cases`);
  if (join.disagreements.length > 0) {
    console.log(
      `DISAGREEMENTS: ${join.disagreements.length} — the artifacts are not from the same run.`,
    );
    process.exitCode = 1;
    return;
  }

  const rows: { label: string; ceiling: ReturnType<typeof gateCeilingOf> }[] = [
    {
      label: 'engine only',
      ceiling: gateCeilingOf(join.cases, (one) =>
        one.candidates.map((candidate) => candidate.service),
      ),
    },
  ];

  if (args.claims !== '' && existsSync(args.claims)) {
    const replay = replayOf(
      parseClaimRecords(readFileSync(args.claims, 'utf8')),
      digestsOf(join.cases, DEFAULT_ELIMINATOR_OPTIONS),
    );
    console.log(
      `claims: reused ${replay.reused}, stale ${replay.stale.length}, ` +
        `foreign ${replay.foreignProtocol.length}, unknown ${replay.unknown.length}, ` +
        `malformed ${replay.malformed}`,
    );
    for (const weight of args.weights) {
      rows.push({
        label: `claim w=${weight.toFixed(2)}`,
        ceiling: gateCeilingOf(join.cases, (one) => {
          const claims = replay.byCase.get(one.datapack) ?? [];
          const verdicts = claims.map((claim) => verifyClaim(claim, one.candidates));
          return applyClaims(one.candidates, verdicts, weight).map(
            (candidate) => candidate.service,
          );
        }),
      });
    }
  }

  console.log('');
  console.log(formatGateCeiling(rows));

  if (args.depth !== '' && existsSync(args.depth)) {
    const depth = readFileSync(args.depth, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { accepted: string[]; top: [string, number][] });
    const curve = recallCurveOf(
      depth.map((row) => ({ accepted: row.accepted, order: row.top.map(([service]) => service) })),
      [1, 2, 3, 5, 8, 10, 15, 20],
    );
    console.log('');
    console.log("recall over the engine's full order (ranking-depth dump):");
    console.log(formatRecallCurve(curve, depth.length));
    console.log(
      "A posterior WIDER than the published five raises the reader column and nothing else: the engine's top-1 is",
    );
    console.log('unchanged, so the width is a choice about what a reader is allowed to see.');
  }
}

main();
