/**
 * Write the arm's settled names under a stated gate policy, from an artifact that was dispatched under another one.
 *
 * The command exists to answer one question with a file instead of an argument: **does the model help?** The arm's
 * published `Top@1` is the score of the policy the dispatch happened to state, and a dispatch that states nothing
 * measures the arm with the gate off and no fallback — an investigation with the engine's answer taken away from it.
 * The same transcripts under `lag` with the engine behind them settle `1 181` of `1 422` where the free arm settles
 * `732` (`docs/sota-comparison.md`), and the difference is a configuration, not a model.
 *
 * So this command writes the second column at zero cost, and prints the check that makes it a reading of the loop
 * rather than of a copy of it: `--dispatched <policy>` replays the policy the run actually ran and refuses to write
 * anything when the result is not the artifact's own `answer` column.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/arm-gate-replay-report.ts \
 *     --arm artifacts/agentic/query-agent.ndjson \
 *     --policy lag \
 *     --dispatched none \
 *     --out artifacts/agentic/query-agent.lag.ndjson
 *
 * Read-only over the artifact. The file it writes carries the two columns `arm-order-report.ts` reads, so the next
 * two steps are the ones every other arm row in the programme took:
 *
 *   pnpm exec tsx benchmarks/src/arm-order-report.ts --engine depth.ndjson --arm query-agent.lag.ndjson --out lag-per-case.ndjson
 *   pnpm exec tsx benchmarks/src/fse26-board-report.ts --verdicts lag-per-case.ndjson --baseline per-case.ndjson
 *
 * @module benchmarks/arm-gate-replay-report
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { parseGateReplayRows, replayDisagreements, replayGateAnswers } from './arm-gate-replay.js';
import type { GatePolicy } from './query-agent.js';

const argv = process.argv.slice(2);
const args: { arm: string; policy: string; dispatched: string; out: string } = {
  arm: '',
  policy: '',
  dispatched: '',
  out: '',
};
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]!;
  const next = argv[index + 1];
  if (arg === '--arm' && next !== undefined) {
    args.arm = next;
    index++;
  } else if (arg === '--policy' && next !== undefined) {
    args.policy = next;
    index++;
  } else if (arg === '--dispatched' && next !== undefined) {
    args.dispatched = next;
    index++;
  } else if (arg === '--out' && next !== undefined) {
    args.out = next;
    index++;
  } else {
    // Refused rather than ignored: a replay written from a flag the caller mistyped is a column whose policy nobody
    // can name, which is the defect this command exists to remove one layer up.
    throw new Error(`arm-gate-replay-report: unrecognised argument '${arg}'`);
  }
}
if (args.arm === '') throw new Error('arm-gate-replay-report: --arm <path> is required');
if (args.policy === '') throw new Error('arm-gate-replay-report: --policy <policy> is required');

/** Thousands separators, the way every report in this programme prints a population. */
const grouped = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const rows = parseGateReplayRows(readFileSync(args.arm, 'utf8'));
const replay = replayGateAnswers(rows, args.policy as GatePolicy);
const { census } = replay;
const resolved = census.resolvedByRule;

console.log(`Arm artifact:  ${args.arm} (${grouped(census.cases)} cases)`);
console.log(`Policy:        ${args.policy}`);
console.log(
  `Replay:        ${grouped(replay.answers.length)} settled · ${grouped(census.settledBeforeModel)} ` +
    `settled before the model · ${grouped(census.agreedWithPrior)} agreed with the prior · ` +
    `${grouped(census.admitted)} admitted · ${grouped(census.refused)} refused · ` +
    `${grouped(census.unanswered)} with no name · ${grouped(census.errored)} errored`,
);
if (census.errored > 0) {
  console.log(
    `               the ${grouped(census.errored)} errored case(s) are NOT in the written file: an error is not a ` +
      'settlement, and a composed population that counted one would have a rank it never had',
  );
}
if (resolved > 0) {
  // The distinction a reader has to be able to make before quoting anything below: this replay prices the GATE, and a
  // resolver (`--resolve`) is a second rule that renamed the settled answer AFTER the gate settled it. Those rows are
  // in the written file at the gate's own settlement, which is what this command measures and not what the artifact
  // published, and the agreement check below skips them rather than calling the difference a disagreement.
  console.log(
    `               ${grouped(resolved)} case(s) were renamed by a RESOLVER and are excluded from the agreement ` +
      'check: this replay prices the gate, and a resolver is a second rule',
  );
}
if (args.dispatched !== '') {
  const recorded = replayGateAnswers(rows, args.dispatched as GatePolicy);
  const disagreements = replayDisagreements(rows, recorded.answers);
  if (disagreements.length > 0) {
    const first = disagreements
      .slice(0, 5)
      .map(
        (entry) =>
          `${entry.datapack}: artifact ${String(entry.recorded)} vs replay ${String(entry.replayed)}`,
      )
      .join(', ');
    throw new Error(
      `arm-gate-replay-report: replaying \`${args.dispatched}\` does not reproduce the artifact's own answers on ` +
        `${String(disagreements.length)} of ${String(census.cases)} case(s) (${first}) — this module and the loop ` +
        'would be two rules, so no policy can be priced from this artifact until they are one',
    );
  }
  const checked = replay.answers.length - resolved;
  console.log(
    `Agreement:     \`${args.dispatched}\` reproduces the artifact's own \`answer\` column on all ` +
      `${grouped(checked)} gate-settled case(s)`,
  );
}
if (args.out === '') {
  console.log('No --out was given, so nothing was written.');
} else {
  const text = replay.answers.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(args.out, text === '' ? '' : `${text}\n`);
  console.log(`Written:       ${args.out} (${grouped(replay.answers.length)} rows)`);
}
