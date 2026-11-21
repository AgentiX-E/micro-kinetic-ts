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
 *     [--propose] [--model M] [--concurrency N] [--limit N] \
 *     [--depth <terms.ndjson> --promotion <off|threshold>]
 *
 * Output is the swept arm table, the oracle row, and the refusal census. With `--promotion` it is followed by the
 * gate table, the readout over the overrides it made, and a census of what the gate decided per case.
 *
 * `--depth` is the terms dump, and it is not optional decoration: the gate's band is a fraction of the case's own
 * spread, so the denominator is a property of the artifact it is read from. A spread taken from the five-wide
 * fingerprint dump would be the width of a presentation layer — `docs/agentic-promotion-gate.md` §3.
 *
 * @module benchmarks/run-agentic-nomination
 */

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import {
  buildNominationPrompt,
  formatPromotionCensus,
  type PublishedCandidate,
} from '../../packages/ai/src/agent/index.js';

import { inCaseOrder } from '../../packages/kinetic/src/benchmarks/case-order.js';

import { readFingerprintFile } from './agentic-fingerprint-file.js';
import { joinHeadroom, type HeadroomCase } from './agentic-headroom.js';
import {
  formatNominationStudy,
  nominateCases,
  parseNominationArgs,
  sweepNomination,
  sweepPromotion,
  type SweepPoint,
} from './agentic-nomination-study.js';
import {
  formatNominationRecord,
  formatPromotionReadout,
  formatPromotionTable,
  parseNominationRecords,
  spreadOrdersOf,
  type NominationRecord,
} from './agentic-nomination.js';
import { createChatClientFromEnv } from './chat-completions.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';
import { parseTermsDump } from './terms-dump.js';
import { readOneTopologyBrief } from './topology-brief-file.js';

/** A rate as the tables print it. */
function percent(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}

/** A count with its sign, so a delta of zero reads as a delta rather than as a missing value. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * Which of the two pre-registered hash halves a case belongs to.
 *
 * SHA-256 of the id and its low bit, which is the split `docs/agentic-promotion-gate.md` §4.1 reports. It is
 * deliberately **not** `hashId` from `agentic-sampling.ts`: that is FNV-1a and answers a different question (which
 * sampling stratum a case is in), so using it here would silently publish a different split under the same name.
 *
 * @param datapack - The case id.
 * @returns `0` or `1`.
 */
function halfOf(datapack: string): 0 | 1 {
  const digest = createHash('sha256').update(datapack).digest();
  return ((digest[digest.length - 1] ?? 0) & 1) as 0 | 1;
}

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

  // The brief is read before a single question is asked, and a file that cannot be used as ONE corpus's topology
  // stops the run: an arm that fell back to no brief would publish the control's number under the arm's name.
  let topologyBrief = '';
  if (args.topologyBrief !== '') {
    const read = readOneTopologyBrief(args.topologyBrief);
    if (!read.ok) {
      console.log(`REFUSING: ${read.why}`);
      process.exitCode = 1;
      return;
    }
    topologyBrief = read.brief;
    console.log(
      `Topology:      ${read.record.system} — ${read.record.services} services, ${read.record.edges} edges ` +
        `over ${read.record.cases} cases, ${read.brief.length} chars (~${Math.ceil(read.brief.length / 4)} tokens ` +
        `estimated), digest ${read.record.digest}`,
    );
  }

  const population =
    args.limit > 0
      ? inCaseOrder(join.cases, (one) => one.datapack).slice(0, args.limit)
      : join.cases;
  if (args.limit > 0) console.log(`SCOPE: first ${population.length} cases by id — not a sample`);

  const existing:
    { ok: true; records: Map<string, NominationRecord> } | { ok: false; why: string } = existsSync(
    args.nominations,
  )
    ? parseNominationRecords(readFileSync(args.nominations, 'utf8'))
    : { ok: true, records: new Map() };
  if (!existing.ok) {
    console.log(`REFUSING: ${args.nominations} is not a nominations artifact — ${existing.why}`);
    process.exitCode = 1;
    return;
  }

  // ONE owner for the options, built before either use. Two literals used to stand here, and the digest check
  // below would have read a divergence between them as every recorded answer being STALE — a report about the
  // artifact instead of about the build, which is the direction that costs a dispatch rather than a debugger.
  const nomination = {
    maxCandidates: args.maxCandidates,
    maxChannels: args.maxChannels,
    maxRanked: args.maxRanked,
    topologyBrief,
  };

  let records = existing.records;
  if (args.propose) {
    const { client, reason } = createChatClientFromEnv(args.model);
    if (client === null) {
      console.log(`${reason}. Scoring the ${records.size} recorded answer(s) only.`);
    } else {
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
  // produce against the one in the artifact is what tells a replay of this question from a replay of another --
  // and with a brief in the prompt, that is what tells an arm from the control it is differenced against.
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

  if (args.promotion !== null || args.admission !== null) {
    // The gate's spread comes from the full scored order and nowhere else. A population read from a five-wide
    // fingerprint dump carries five candidates, so reading the spread off it would be reading the artifact's width
    // — the error `docs/agentic-promotion-gate.md` §3 records as having been made twice already.
    //
    // An EVIDENCE arm reads no spread at all, and its control is the engine: the band switched off. The two are
    // scored by one function with one extra argument, which is the same shape the band's own control uses.
    const spreadOrder =
      args.depth === ''
        ? new Map<string, readonly PublishedCandidate[]>()
        : spreadOrdersOf(parseTermsDump(readFileSync(args.depth, 'utf8')));
    console.log('');
    console.log(
      args.admission === null
        ? `Gate over ${population.length} cases — spread from ${args.depth}`
        : `Gate over ${population.length} cases — rule evidence (${args.admission}), no spread read`,
    );
    const gated = [
      ...sweepPromotion(population, records, spreadOrder, [{ threshold: null }]),
      ...sweepPromotion(
        population,
        records,
        spreadOrder,
        [{ threshold: args.promotion }],
        args.admission,
      ),
    ];
    console.log(formatPromotionTable(gated));
    console.log('');
    const control = gated[0];
    const treatment = gated[1];
    if (control === undefined || treatment === undefined)
      throw new Error('the gate grid lost a point');
    console.log(`control (gate off): ${control.correct}/${control.cases}`);
    console.log(formatPromotionReadout(treatment));
    const delta = treatment.correct - control.correct;
    console.log(
      `end to end           ${control.correct} → ${treatment.correct}` +
        ` (${percent(control.top1)} → ${percent(treatment.top1)}), delta ${signed(delta)}`,
    );
    for (const [label, outcome] of [
      ['control', control],
      ['treatment', treatment],
    ] as const) {
      const tally = outcome.promotion;
      if (tally === null) continue;
      console.log('');
      console.log(
        `census — ${label} (${tally.admission === null ? `threshold ${tally.threshold ?? 'off'}` : `rule ${tally.admission}`})`,
      );
      console.log(formatPromotionCensus(tally.census, outcome.cases));
      if (tally.orderMissing > 0 || tally.orderDisagreement > 0) {
        console.log(
          `  orderMissing ${tally.orderMissing}, orderDisagreement ${tally.orderDisagreement}` +
            ` — a non-zero disagreement means ${args.depth} and ${args.fingerprints} are not one run`,
        );
      }
      if (tally.admission === null && tally.overrides > tally.band) {
        // Structurally impossible: a promotion is counted in the band before it is counted as an override. The line
        // exists because the alternative is that one of those two counters stops meaning what it says. It is guarded
        // on the BAND because an evidence arm has no band: its promotions are not counted in one, so the invariant
        // it states does not apply to them and firing there would be a false alarm about a correct reading.
        console.log(`  IMPOSSIBLE: ${tally.overrides} overrides in a ${tally.band}-case band`);
      }
    }

    // The halves the pre-registration names. SHA-256 of the id — not `hashId`, which is the sampling stratum's
    // FNV-1a — because the halves in `docs/agentic-promotion-gate.md` §4.1 are the SHA-256 ones and a re-derivation
    // has to be the same split or it is a different test.
    console.log('');
    console.log('hash halves (SHA-256 of the case id, low bit)');
    const halves: [HeadroomCase[], HeadroomCase[]] = [[], []];
    for (const oneCase of population) halves[halfOf(oneCase.datapack)].push(oneCase);
    for (const [label, subset] of [
      ['A', halves[0]],
      ['B', halves[1]],
    ] as const) {
      const [controlHalf, treatmentHalf] = [
        ...sweepPromotion(subset, records, spreadOrder, [{ threshold: null }]),
        ...sweepPromotion(
          subset,
          records,
          spreadOrder,
          [{ threshold: args.promotion }],
          args.admission,
        ),
      ];
      if (controlHalf === undefined || treatmentHalf === undefined) throw new Error('lost a point');
      const net = treatmentHalf.correct - controlHalf.correct;
      console.log(
        `  half ${label}: ${String(subset.length).padStart(5)} cases, ` +
          `${controlHalf.correct} → ${treatmentHalf.correct}, net ${signed(net)}`,
      );
    }
  }
}

await main();
