/**
 * The elimination study: ask a model to eliminate, verify what it said, and score the result.
 *
 * `run-agentic-eliminator.ts` is the two-line command that calls {@link runStudy}; everything that can be wrong is
 * here, where a test can read the table it prints.
 *
 * This is the study the elimination line was missing. `run-agentic-headroom` can price a **ceiling** and a
 * deterministic **evidence** rule, and it has carried an arm that replays somebody else's claims since iteration
 * 267 — but nothing produced such claims. Here is the producer, and the four readings one dispatch makes possible:
 *
 * | arm        | what it is                                                                   |
 * | ---------- | ---------------------------------------------------------------------------- |
 * | `engine`   | the control: the shipped ranking, untouched                                   |
 * | `oracle`   | the ceiling: every candidate above the truth removed, where a claim can be made |
 * | `evidence` | the deterministic rule (fault-free rate and departure), no model at all      |
 * | `recorded` | the model's answers, verified and applied at the given weight                |
 *
 * The model arm costs money per case; every other reading of it costs nothing, because answers are recorded with
 * the prompt digest they belong to (`agentic-claims.ts`). A weight sweep, a skip-rule sweep or a presentation
 * change is a re-read, not a second dispatch.
 *
 * Every arm's delta is also **priced**: `certifyLosses` turns the per-family regression into the smallest budget
 * the corpus can be said to permit at `--delta`, which is the number that separates "this arm gained 40 cases" from
 * "this arm gained 40 cases and lost no family more than the corpus forbids".
 *
 * @module benchmarks/agentic-eliminator-study
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { DEFAULT_ELIMINATOR_OPTIONS } from '../../packages/ai/src/agent/index.js';
import {
  formatClaimRecord,
  parseClaimRecords,
  replayOf,
  type ClaimRecord,
} from './agentic-claims.js';
import { readFingerprintFile } from './agentic-fingerprint-file.js';
import { formatArmTable, formatRefusals, formatSkipCensus } from './agentic-headroom-report.js';
import {
  certifiedBudgetOf,
  joinHeadroom,
  scoreArm,
  type ArmOutcome,
  type HeadroomCase,
} from './agentic-headroom.js';
import { nullReadingOf, swapTopTwo } from './agentic-null-model.js';
import { digestsOf, proposeClaims } from './agentic-proposer.js';
import { createChatClientFromEnv, type ChatClient } from './chat-completions.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** Parsed arguments. */
export interface EliminatorArgs {
  readonly fingerprints: string;
  readonly verdicts: string;
  readonly claims: string;
  readonly propose: boolean;
  readonly weight: number;
  readonly model: string;
  readonly concurrency: number;
  /**
   * Cases to ask about, in canonical id order, or zero for all.
   *
   * A scope, not a sample: the first `n` ids of the population sorted by name, so two runs naming the same `n`
   * score the same cases. It exists for a smoke run of the wiring, and a number measured under it is not
   * comparable with the corpus's.
   */
  readonly limit: number;
  readonly maxCandidates: number;
  readonly delta: number;
}

/**
 * Parse the arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments.
 * @throws Error on an unknown flag, a missing value or a value outside its range, so a typo cannot run a study.
 */
export function parseEliminatorArgs(argv: readonly string[]): EliminatorArgs {
  const args = {
    fingerprints: '',
    verdicts: '',
    claims: '',
    propose: false,
    weight: 1,
    model: 'deepseek-chat',
    concurrency: 4,
    limit: 0,
    maxCandidates: DEFAULT_ELIMINATOR_OPTIONS.maxCandidates,
    delta: 0.05,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--propose') {
      args.propose = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === '--fingerprints') args.fingerprints = value;
    else if (arg === '--verdicts') args.verdicts = value;
    else if (arg === '--claims') args.claims = value;
    else if (arg === '--model') args.model = value;
    else if (arg === '--weight') args.weight = Number(value);
    else if (arg === '--concurrency') args.concurrency = Number(value);
    else if (arg === '--limit') args.limit = Number(value);
    else if (arg === '--max-candidates') args.maxCandidates = Number(value);
    else if (arg === '--delta') args.delta = Number(value);
    else throw new Error(`unrecognised argument ${arg}`);
    index += 1;
  }
  if (args.fingerprints === '' || args.verdicts === '') {
    throw new Error('--fingerprints and --verdicts are both required');
  }
  if (args.propose && args.claims === '') throw new Error('--propose needs --claims to write to');
  if (!(args.weight >= 0 && args.weight <= 1)) throw new Error('--weight must be inside [0, 1]');
  if (!Number.isInteger(args.maxCandidates) || args.maxCandidates < 2) {
    throw new Error('--max-candidates must be an integer of at least 2');
  }
  if (!Number.isInteger(args.limit) || args.limit < 0)
    throw new Error('--limit must be 0 or a count');
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error('--concurrency must be a positive integer');
  }
  if (!(args.delta > 0 && args.delta < 1))
    throw new Error('--delta must be strictly inside (0, 1)');
  return args;
}

/** Read every record already in the claims file, or an empty list when there is no file yet. */
function readRecords(path: string): ClaimRecord[] {
  if (path === '' || !existsSync(path)) return [];
  return parseClaimRecords(readFileSync(path, 'utf8'));
}

/**
 * The scope the run scores over: everything, or the first `limit` ids in canonical order.
 *
 * The comparator has no equality arm on purpose. Two cases cannot share a datapack — `joinHeadroom` consumes each
 * verdict it pairs and reports the second fingerprint of a duplicate as unpaired — so a third arm would be code no
 * corpus can reach, and this repository deletes those rather than documenting them.
 *
 * @param cases - The paired population, in file order.
 * @param limit - Cases to keep, or zero for all.
 * @returns The population to score, in id order when scoped.
 */
function populationOf(cases: readonly HeadroomCase[], limit: number): readonly HeadroomCase[] {
  if (limit <= 0) return cases;
  return [...cases].sort((a, b) => (a.datapack < b.datapack ? -1 : 1)).slice(0, limit);
}

/** A gain as a signed, width-padded cell, so two rows of one table line up and a loss reads as a loss. */
function signed(gain: number): string {
  return `${gain >= 0 ? '+' : ''}${String(gain).padStart(4)}`;
}

/** What a caller may substitute for the one dependency that costs money. */
export interface StudyDeps {
  /**
   * The client the paid arm uses, `null` to force the "no client" path, or absent to resolve one from the
   * environment.
   *
   * Injected rather than only read from `process.env`, for two reasons that are both about a test being honest: a
   * test that drove the proposal through the environment would make a paid call the day a secret happened to be set
   * on the machine running it, and the transport is already measured where it lives (`chat-completions.ts`), so what
   * is left to observe here is what the study DOES with an answer.
   */
  readonly client?: ChatClient | null;
}

/** The client for this run, and the reason there is none. */
function resolveClient(
  model: string,
  deps: StudyDeps,
): { client: ChatClient | null; reason: string } {
  if (deps.client === undefined) return createChatClientFromEnv(model);
  if (deps.client === null) return { client: null, reason: 'this run supplied no client' };
  return { client: deps.client, reason: '' };
}

/**
 * Run one study.
 *
 * The output sink is a parameter rather than `console.log`, so a test can read the table a study prints instead of
 * spying on a global: every number below is a line somebody will quote, and a CLI whose output can only be observed
 * by running it end to end is a CLI whose table is untested.
 *
 * @param argv - Arguments after the script name.
 * @param out - Where each line goes.
 * @returns Nothing. Sets `process.exitCode` on a refusal a caller must see.
 */
export async function runStudy(
  argv: readonly string[],
  out: (line: string) => void = console.log,
  deps: StudyDeps = {},
): Promise<void> {
  const args = parseEliminatorArgs(argv);

  console.log('Micro-Kinetic — the elimination arm, measured against its own ceiling');
  console.log('═'.repeat(78));
  const join = joinHeadroom(
    readFingerprintFile(args.fingerprints),
    readPerCaseVerdicts(args.verdicts),
  );
  out(`Fingerprints: ${args.fingerprints}`);
  out(`Verdicts:     ${args.verdicts}`);
  out(`Paired:       ${join.cases.length} cases`);
  if (join.disagreements.length > 0) {
    out(
      `DISAGREEMENTS: ${join.disagreements.length} (first: ${join.disagreements[0]}) — the two artifacts are not ` +
        'from the same run, so nothing is scored',
    );
    process.exitCode = 1;
    return;
  }

  const population = populationOf(join.cases, args.limit);
  if (args.limit > 0)
    out(`SCOPE:        first ${population.length} ids (not comparable with the corpus)`);
  const eliminator = {
    ...DEFAULT_ELIMINATOR_OPTIONS,
    maxCandidates: args.maxCandidates,
    // Promoting the deepest presented candidate takes one elimination per candidate above it, so the bound is the
    // presentation's own arithmetic rather than a second parameter that could disagree with it.
    maxClaims: args.maxCandidates - 1,
  };
  const digests = digestsOf(population, eliminator);

  const existing = new Map<string, ClaimRecord>();
  for (const record of readRecords(args.claims)) existing.set(record.datapack, record);
  if (args.claims !== '') {
    out(`Claims:       ${args.claims} (${existing.size} records)`);
  }

  if (args.propose) {
    const built = resolveClient(args.model, deps);
    if (built.client === null) {
      out(`MODEL ARM NOT MEASURED: ${built.reason}`);
      process.exitCode = 1;
      return;
    }
    // A file with no records is a fresh run and is truncated by the writer; a file with records is resumed and
    // appended to, so answers already paid for are not paid for twice.
    if (existing.size === 0) appendFileSync(args.claims, '');
    const summary = await proposeClaims(population, {
      client: built.client,
      eliminator,
      concurrency: args.concurrency,
      existing,
      onRecord: (record) => {
        appendFileSync(args.claims, `${formatClaimRecord(record)}\n`);
      },
      onProgress: (done, total) => {
        if (done % 100 === 0 || done === total) out(`  proposed ${done}/${total}`);
      },
    });
    out('');
    out(
      `Proposal: asked ${summary.asked}, reused ${summary.reused}, answered ${summary.answered}, ` +
        `declined ${summary.declined}, unreadable ${summary.unreadable}`,
    );
    out(
      `          ${summary.claims} claims · ${summary.promptTokens} prompt + ${summary.completionTokens} ` +
        `completion tokens · ${(summary.elapsedMs / 1000).toFixed(0)} s`,
    );
    for (const one of summary.unreadableCases.slice(0, 5)) out(`  UNREADABLE ${one}`);
  }

  const replay = replayOf(readRecords(args.claims), digests);
  if (args.claims !== '') {
    const refused = [
      replay.stale.length > 0 ? `${replay.stale.length} stale` : '',
      replay.foreignProtocol.length > 0
        ? `${replay.foreignProtocol.length} from another protocol`
        : '',
      replay.unknown.length > 0 ? `${replay.unknown.length} not in this population` : '',
      replay.malformed > 0 ? `${replay.malformed} unreadable` : '',
    ].filter((part) => part !== '');
    out(
      `Replay:       ${replay.reused} of ${population.length} cases carry an answer to this prompt` +
        (refused.length > 0 ? ` — refused: ${refused.join(', ')}` : ''),
    );
    for (const one of replay.stale.slice(0, 3)) out(`  STALE ${one}`);
    for (const one of replay.foreignProtocol.slice(0, 3)) out(`  PROTOCOL ${one}`);
    for (const one of replay.unknown.slice(0, 3)) out(`  UNKNOWN ${one}`);
  }

  const outcomes: ArmOutcome[] = [
    scoreArm(population, { arm: 'engine', weight: 0, useSkipRule: false }),
    scoreArm(population, { arm: 'oracle', weight: args.weight, useSkipRule: false }),
    scoreArm(population, {
      arm: 'evidence',
      weight: args.weight,
      useSkipRule: false,
      thresholds: { rateFloor: 0, margin: 0 },
    }),
  ];
  if (replay.reused > 0) {
    outcomes.push(
      scoreArm(population, {
        arm: 'recorded',
        weight: args.weight,
        useSkipRule: false,
        recorded: replay.byCase,
      }),
    );
  }
  out('');
  out(`${population.length} cases · weight=${args.weight} · presentation=${args.maxCandidates}`);
  out(formatArmTable(outcomes));
  out(formatSkipCensus(outcomes[0]!));
  out('');
  out(
    `Delta against the control, with the budget the corpus permits at delta=${args.delta} (Holm over families):`,
  );
  const control = outcomes[0]!;
  for (const outcome of outcomes) {
    if (outcome.arm === 'engine') continue;
    const gain = outcome.correct - control.correct;
    // The ceiling is an oracle and its per-family counts are a property of the labels, not of a method, so it is
    // reported as a gain without a certificate: there is nothing to certify about a rule that reads the answer.
    if (outcome.arm === 'oracle') {
      out(`  oracle    ${signed(gain)} cases · ceiling, not a method`);
      continue;
    }
    const price = certifiedBudgetOf(population, control.byFamily, outcome.byFamily, args.delta);
    out(
      `  ${outcome.arm.padEnd(9)} ${signed(gain)} cases · ` +
        `budget ${price.budget === null ? 'none' : String(price.budget).padStart(3)} · ` +
        `worst ${price.worst} · refusals: ${formatRefusals(outcome)}`,
    );
  }
  if (replay.reused === 0) {
    out('  recorded  not scored — no answer in the claims file belongs to this prompt');
  }

  // The nulls come last because they are the reading of last resort: an arm's delta says whether it won, and these
  // two say whether the thing that produced the delta was reading the case. They are printed even when the arm is
  // absent, from whatever records the file holds, because a refused replay still contains the claims.
  const replayable = [...replay.byCase.entries()].map(([datapack, claims]) => ({
    datapack,
    claims,
  }));
  const reading = nullReadingOf(population, replayable);
  const swapped = swapTopTwo(population);
  if (reading.claims > 0 || reading.outside > 0) {
    out('');
    out('Was it reading the case? Two nulls, both computed from the same artifact:');
    if (reading.claims > 0) {
      out(
        `  uniform   ${reading.hits} of ${reading.claims} claims keep a true service ` +
          `(${percent(reading.hits, reading.claims)}) against ${reading.expected.toFixed(0)} expected ` +
          `(${percent(reading.expected, reading.claims)}) · z ${reading.z.toFixed(1)} ` +
          `(clustered ${reading.clusteredZ.toFixed(1)}, because claims from one case are not independent)`,
      );
      out(
        `  removed   ${reading.removedTruth} of ${reading.claims} claims ask for the truth itself to be deleted ` +
          `(${percent(reading.removedTruth, reading.claims)})`,
      );
      out(
        `  constant  promoting rank 1 on every case scores ${swapped.swapped} of ${swapped.cases} ` +
          `against the engine's ${swapped.engine} · the claims promote it ` +
          `${percent(reading.promotingRank1, reading.claims)}, and ${reading.swappingTopTwo} are exactly ` +
          'remove rank 0 / keep rank 1',
      );
    }
    // Printed whether or not any claim was scoreable: a file whose every claim names a service the engine never
    // presented is the one case where the nulls have nothing to say and the reason is the finding.
    if (reading.outside > 0) {
      out(`  outside   ${reading.outside} claims named a service the engine did not present`);
    }
  }
}

/** A share of a total, as a one-decimal percentage. Always called with a positive total, so it has no `n/a` arm. */
function percent(part: number, whole: number): string {
  return `${((100 * part) / whole).toFixed(1)} %`;
}
