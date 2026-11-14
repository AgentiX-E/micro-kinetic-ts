/**
 * `run-agentic-nomination` — ask a model to rank, then score the ranking offline against the engine.
 *
 * Two inputs, both written by a benchmark run: the per-case fingerprint dump (`--fingerprint-out`) and the per-case
 * verdict file (`--per-case-out`). A third file, the nominations artifact (`--nominations`), is written by this
 * command when `--propose` is given and read by it otherwise. The join is refused when the dump and the verdicts
 * disagree about a case's ordering, because that means the files came from different runs.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-agentic-nomination.ts \
 *     --fingerprints <ndjson> --verdicts <ndjson> --nominations <ndjson> \
 *     [--propose] [--model M] [--concurrency N] [--limit N]
 *
 * Output is the swept arm table, the oracle row, and the refusal census.
 *
 * @module benchmarks/run-agentic-nomination
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { buildNominationPrompt } from '../../packages/ai/src/agent/index.js';

import { inCaseOrder } from '../../packages/kinetic/src/benchmarks/case-order.js';

import { readFingerprintFile } from './agentic-fingerprint-file.js';
import { joinHeadroom } from './agentic-headroom.js';
import {
  formatNominationStudy,
  nominateCases,
  parseNominationArgs,
  sweepNomination,
  type SweepPoint,
} from './agentic-nomination-study.js';
import {
  formatNominationRecord,
  parseNominationRecords,
  type NominationRecord,
} from './agentic-nomination.js';
import { createChatClientFromEnv } from './chat-completions.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** A grid that also covers the control on both strategies, so the table shows the operator doing nothing. */
const GRID: readonly SweepPoint[] = [
  { strategy: 'rrf', weight: 0 },
  { strategy: 'rrf', weight: 0.1 },
  { strategy: 'rrf', weight: 0.2 },
  { strategy: 'rrf', weight: 0.3 },
  { strategy: 'rrf', weight: 0.5 },
  { strategy: 'rrf', weight: 0.7 },
  { strategy: 'rrf', weight: 1 },
  { strategy: 'borda', weight: 0.5 },
  { strategy: 'borda', weight: 1 },
];

async function main(): Promise<void> {
  const args = parseNominationArgs(process.argv.slice(2));
  const join = joinHeadroom(
    readFingerprintFile(args.fingerprints),
    readPerCaseVerdicts(args.verdicts),
  );

  console.log('Micro-Kinetic — nomination arm');
  console.log('═'.repeat(78));
  console.log(`Fingerprints:  ${args.fingerprints}`);
  console.log(`Verdicts:      ${args.verdicts}`);
  console.log(`Nominations:   ${args.nominations}`);
  console.log(`Paired:        ${join.cases.length} cases`);
  for (const [name, list] of [
    ['UNPAIRED fingerprints', join.unpairedFingerprints],
    ['UNPAIRED verdicts', join.unpairedVerdicts],
  ] as const) {
    if (list.length > 0) console.log(`${name}: ${list.length} (first: ${list[0]})`);
  }
  if (join.disagreements.length > 0) {
    console.log(`DISAGREEMENTS: ${join.disagreements.length} (first: ${join.disagreements[0]})`);
    console.log('Refusing to score: the two artifacts are not from the same run.');
    process.exitCode = 1;
    return;
  }

  const population =
    args.limit > 0
      ? inCaseOrder(join.cases, (one) => one.datapack).slice(0, args.limit)
      : join.cases;
  if (args.limit > 0) console.log(`SCOPE: first ${population.length} cases by id — not a sample`);

  const existing: { ok: true; records: Map<string, NominationRecord> } | { ok: false; why: string } =
    existsSync(args.nominations)
      ? parseNominationRecords(readFileSync(args.nominations, 'utf8'))
      : { ok: true, records: new Map() };
  if (!existing.ok) {
    console.log(`REFUSING: ${args.nominations} is not a nominations artifact — ${existing.why}`);
    process.exitCode = 1;
    return;
  }

  let records = existing.records;
  if (args.propose) {
    const { client, reason } = createChatClientFromEnv(args.model);
    if (client === null) {
      console.log(`${reason}. Scoring the ${records.size} recorded answer(s) only.`);
    } else {
      const nomination = {
        maxCandidates: args.maxCandidates,
        maxChannels: args.maxChannels,
        maxRanked: args.maxRanked,
      };
      const summary = await nominateCases(population, {
        client,
        nomination,
        concurrency: args.concurrency,
        existing: records,
        onRecord: (record) =>
          appendFileSync(args.nominations, `${formatNominationRecord(record)}\n`),
        onProgress: (done, total) => {
          if (done % 100 === 0 || done === total) console.log(`  asked ${done}/${total}`);
        },
      });
      console.log('');
      console.log(
        `proposed: asked ${summary.asked}, reused ${summary.reused}, ranked ${summary.ranked}, ` +
          `declined ${summary.declined}, unreadable ${summary.unreadable}, ` +
          `tokens ${summary.promptTokens}+${summary.completionTokens}, ${summary.elapsedMs} ms`,
      );
      for (const one of summary.unreadableCases.slice(0, 5)) console.log(`  UNREADABLE ${one}`);
      const reread = parseNominationRecords(readFileSync(args.nominations, 'utf8'));
      if (!reread.ok) {
        console.log(`REFUSING: the artifact written this run does not read back — ${reread.why}`);
        process.exitCode = 1;
        return;
      }
      records = reread.records;
    }
  }

  // A recorded answer belongs to the question that produced it. Comparing the digest the current build would
  // produce against the one in the artifact is what tells a replay of this question from a replay of another.
  const nomination = {
    maxCandidates: args.maxCandidates,
    maxChannels: args.maxChannels,
    maxRanked: args.maxRanked,
  };
  let stale = 0;
  for (const oneCase of population) {
    const record = records.get(oneCase.datapack);
    if (record === undefined) continue;
    const prompt = buildNominationPrompt(oneCase.faultType, oneCase.candidates, nomination);
    if (record.digest !== prompt.digest) stale += 1;
  }
  if (stale > 0) {
    console.log(
      `STALE: ${stale} recorded answer(s) belong to a different prompt. They are scored as recorded, and the`,
    );
    console.log('       table describes that prompt rather than this build.');
  }

  console.log('');
  console.log(`All ${population.length} paired cases`);
  console.log(formatNominationStudy(population, sweepNomination(population, records, GRID)));
}

await main();
