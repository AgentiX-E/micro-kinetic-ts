/**
 * The nomination study: ask a model to rank, verify what it said, fuse it, and score the result.
 *
 * `run-agentic-nomination.ts` is the two-line command that calls {@link runNominationStudy}; everything that can be
 * wrong is here, where a test can read the table it prints.
 *
 * ## Why this study exists beside the elimination one
 *
 * Iteration 285 measured what the elimination protocol costs. On 1 422 cases the engine answers 75.5 %, a perfect
 * reader of the same posterior reaches 87.8 %, and an arm allowed to remove **exactly** the candidates above the
 * truth — the protocol's own ceiling, which no model can exceed — reaches **79.4 %**. The 8.4-point gap is the
 * protocol's price: a promotion has to be spelled as one elimination per candidate above it, each citing a channel
 * printed on both rows and outside the removed row's band, so a case with one discriminating channel but not three
 * cannot say what it knows. This study asks the same question of the same table and lets the answer be a ranking.
 *
 * ## The readings one dispatch makes possible
 *
 * | arm        | what it is                                                                 |
 * | ---------- | -------------------------------------------------------------------------- |
 * | `engine`   | the shipped ranking. Every delta is against it.                            |
 * | `oracle`   | the truth at rank 0 wherever the posterior holds it. 87.8 % here.           |
 * | `nominate` | the model's ranking, verified, fused at a swept weight.                     |
 *
 * `engine` and `oracle` are not methods, and neither is a special case of the other: both are properties of the
 * posterior, printed so a reader can tell a protocol that cannot express an answer from a model that did not see
 * one.
 *
 * @module benchmarks/agentic-nomination-study
 */

import {
  DEFAULT_NOMINATION_OPTIONS,
  DEFAULT_PROMOTION_THRESHOLD,
  NOMINATION_PROTOCOL,
  buildNominationPrompt,
  parseNominationReply,
  type EvidenceVariant,
  type NominationOptions,
  type PublishedCandidate,
} from '../../packages/ai/src/agent/index.js';

import type { HeadroomCase } from './agentic-headroom.js';
import {
  formatNominationRefusals,
  formatNominationTable,
  oracleTop1,
  scoreNomination,
  type NominationOutcome,
  type NominationRecord,
} from './agentic-nomination.js';
import type { ChatClient } from './chat-completions.js';
import { ChatCompletionError } from './chat-completions.js';

/** Parsed arguments. */
export interface NominationArgs {
  readonly fingerprints: string;
  readonly verdicts: string;
  readonly nominations: string;
  readonly propose: boolean;
  readonly model: string;
  readonly concurrency: number;
  /** Cases to ask about, in canonical id order, or zero for all. A scope, not a sample. */
  readonly limit: number;
  readonly maxCandidates: number;
  readonly maxChannels: number;
  readonly maxRanked: number;
  readonly delta: number;
  /** The terms dump a gate reads its spread from, or empty when there is none. */
  readonly depth: string;
  /**
   * The corpus topology brief an arm carries, or empty for a prompt with no graph in it.
   *
   * A PATH rather than the text: the brief is an artifact a corpus pass wrote, and a dispatch that could type one
   * could attach a topology nobody measured. The file's digest is printed beside the arm's table, so a replay
   * names the bytes it used.
   */
  readonly topologyBrief: string;
  /** The gate's threshold, or `null` when the arm is a fusion. */
  readonly promotion: number | null;
  /**
   * Which admission rule to score, or `null` for the band — the rule every published number was measured on.
   *
   * The evidence rules read the case's channels and no score, so they need no `--depth`; the band reads the spread
   * and no channel, so it needs one. The two are separate flags because they are separate claims, and one flag with
   * three spellings would let a reader think the band was one of them.
   */
  readonly admission: EvidenceVariant | null;
}

/**
 * Parse the arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments.
 * @throws Error on an unknown flag, a missing value or a value outside its range, so a typo cannot run a study.
 */
export function parseNominationArgs(argv: readonly string[]): NominationArgs {
  const args: { -readonly [K in keyof NominationArgs]: NominationArgs[K] } = {
    fingerprints: '',
    verdicts: '',
    nominations: '',
    propose: false,
    model: 'deepseek-chat',
    concurrency: 4,
    limit: 0,
    maxCandidates: DEFAULT_NOMINATION_OPTIONS.maxCandidates,
    maxChannels: DEFAULT_NOMINATION_OPTIONS.maxChannels,
    maxRanked: DEFAULT_NOMINATION_OPTIONS.maxRanked,
    delta: 0.05,
    depth: '',
    topologyBrief: '',
    promotion: null,
    admission: null,
  };
  const numeric = new Map<string, (value: number) => void>([
    [
      '--concurrency',
      (value: number) => {
        if (!(value >= 1 && value <= 32)) throw new Error('--concurrency must be in [1, 32]');
        args.concurrency = value;
      },
    ],
    [
      '--limit',
      (value: number) => {
        if (!(value >= 0)) throw new Error('--limit must be non-negative');
        args.limit = value;
      },
    ],
    [
      '--max-candidates',
      (value: number) => {
        if (!(value >= 1 && value <= 50)) throw new Error('--max-candidates must be in [1, 50]');
        args.maxCandidates = value;
      },
    ],
    [
      '--max-channels',
      (value: number) => {
        if (!(value >= 1 && value <= 64)) throw new Error('--max-channels must be in [1, 64]');
        args.maxChannels = value;
      },
    ],
    [
      '--max-ranked',
      (value: number) => {
        if (!(value >= 1 && value <= 50)) throw new Error('--max-ranked must be in [1, 50]');
        args.maxRanked = value;
      },
    ],
    [
      '--delta',
      (value: number) => {
        if (!(value > 0 && value < 1)) throw new Error('--delta must be in (0, 1)');
        args.delta = value;
      },
    ],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--propose') {
      args.propose = true;
      continue;
    }
    if (arg === '--help') throw new Error('--help');
    const assign = numeric.get(arg);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} needs a value`);
    }
    index += 1;
    if (assign !== undefined) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`${arg} needs a number, got ${value}`);
      assign(parsed);
      continue;
    }
    if (arg === '--fingerprints') args.fingerprints = value;
    else if (arg === '--verdicts') args.verdicts = value;
    else if (arg === '--nominations') args.nominations = value;
    else if (arg === '--model') args.model = value;
    else if (arg === '--depth') args.depth = value;
    else if (arg === '--topology-brief') args.topologyBrief = value;
    else if (arg === '--admission') {
      if (value === 'count' || value === 'count-and-rarity') args.admission = value;
      else throw new Error(`--admission must be 'count' or 'count-and-rarity', got ${value}`);
    } else if (arg === '--promotion') {
      if (value === 'off') {
        args.promotion = null;
      } else {
        const threshold = Number(value);
        if (!Number.isFinite(threshold) || !(threshold > 0 && threshold < 1)) {
          throw new Error(`--promotion must be 'off' or a threshold in (0, 1), got ${value}`);
        }
        args.promotion = threshold;
      }
    } else throw new Error(`unknown flag ${arg}`);
  }
  if (args.fingerprints === '' || args.verdicts === '') {
    throw new Error('--fingerprints and --verdicts are both required');
  }
  if (args.propose && args.nominations === '') {
    throw new Error('--propose writes an artifact, so --nominations is required');
  }
  if (args.promotion !== null && args.depth === '') {
    // The gate's denominator is the spread, and the spread comes from the full scored order. Without `--depth` the
    // only order in hand is the population's, whose width is whatever the dump was asked for — the exact
    // substitution `docs/agentic-promotion-gate.md` §3 records as an error made twice already.
    throw new Error(
      '--promotion needs --depth: the gate reads its spread from the full scored order',
    );
  }
  return args;
}

/** How a proposal run is driven. */
export interface ProposeNominationOptions {
  readonly client: ChatClient;
  readonly nomination?: NominationOptions;
  /** Calls in flight. Four is what a shared endpoint tolerates without a 429 as the common case. */
  readonly concurrency?: number;
  /** Answers already recorded, keyed by case. Reused only when the digest matches. */
  readonly existing?: ReadonlyMap<string, NominationRecord>;
  /** Called once per case, in completion order, so a caller can append to the artifact as it grows. */
  readonly onRecord: (record: NominationRecord) => void;
  readonly onProgress?: (done: number, total: number) => void;
  /** Injected clock, so a test can assert the elapsed field without waiting. */
  readonly now?: () => number;
}

/** What a proposal run did. */
export interface NominateSummary {
  readonly cases: number;
  readonly asked: number;
  readonly reused: number;
  readonly ranked: number;
  readonly declined: number;
  readonly unreadable: number;
  readonly unreadableCases: readonly string[];
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly elapsedMs: number;
}

/**
 * Ask the model about every case that is not already answered under the current prompt.
 *
 * A failure is an answer with a reason: a call that never returned is recorded as a case whose reply could not be
 * read, not dropped. Dropping it would let an outage improve the accuracy by shrinking the population.
 *
 * @param cases - The population, in file order.
 * @param options - Client, width, concurrency and the sink for each record.
 * @returns Counts for the run's log line. Never throws for a failed case.
 */
export async function nominateCases(
  cases: readonly HeadroomCase[],
  options: ProposeNominationOptions,
): Promise<NominateSummary> {
  const nomination = options.nomination ?? DEFAULT_NOMINATION_OPTIONS;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 32));
  const existing = options.existing ?? new Map<string, NominationRecord>();
  const now = options.now ?? Date.now;
  const started = now();

  let asked = 0;
  let reused = 0;
  let ranked = 0;
  let declined = 0;
  let unreadable = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const unreadableCases: string[] = [];

  const pending: { readonly oneCase: HeadroomCase; readonly digest: string }[] = [];
  for (const oneCase of cases) {
    const prompt = buildNominationPrompt(oneCase.faultType, oneCase.candidates, nomination);
    const previous = existing.get(oneCase.datapack);
    if (previous !== undefined && previous.digest === prompt.digest) {
      reused += 1;
      continue;
    }
    pending.push({ oneCase, digest: prompt.digest });
  }

  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const job = pending[index];
      if (job === undefined) return;
      const prompt = buildNominationPrompt(
        job.oneCase.faultType,
        job.oneCase.candidates,
        nomination,
      );
      asked += 1;
      const began = now();
      let record: NominationRecord;
      try {
        const completion = await options.client.complete({
          system: prompt.system,
          user: prompt.user,
        });
        promptTokens += completion.promptTokens;
        completionTokens += completion.completionTokens;
        const parsed = parseNominationReply(completion.text, nomination.maxRanked);
        if (!parsed.ok) {
          unreadable += 1;
          unreadableCases.push(`${job.oneCase.datapack}: ${parsed.why}`);
          record = {
            datapack: job.oneCase.datapack,
            model: completion.model,
            protocol: NOMINATION_PROTOCOL,
            digest: prompt.digest,
            ranking: [],
            malformed: parsed.why,
            ms: now() - began,
            promptTokens: completion.promptTokens,
            completionTokens: completion.completionTokens,
          };
        } else {
          if (parsed.order.length === 0) declined += 1;
          else ranked += 1;
          record = {
            datapack: job.oneCase.datapack,
            model: completion.model,
            protocol: NOMINATION_PROTOCOL,
            digest: prompt.digest,
            ranking: [...parsed.order],
            ms: now() - began,
            promptTokens: completion.promptTokens,
            completionTokens: completion.completionTokens,
          };
        }
      } catch (error) {
        const why =
          error instanceof ChatCompletionError
            ? `call failed: ${error.message}`
            : `call failed: ${String(error)}`;
        unreadable += 1;
        unreadableCases.push(`${job.oneCase.datapack}: ${why}`);
        record = {
          datapack: job.oneCase.datapack,
          model: options.client.model,
          protocol: NOMINATION_PROTOCOL,
          digest: prompt.digest,
          ranking: [],
          malformed: why,
          ms: now() - began,
          promptTokens: 0,
          completionTokens: 0,
        };
      }
      options.onRecord(record);
      done += 1;
      options.onProgress?.(done, pending.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, pending.length)) }, worker),
  );

  return {
    cases: cases.length,
    asked,
    reused,
    ranked,
    declined,
    unreadable,
    unreadableCases,
    promptTokens,
    completionTokens,
    elapsedMs: now() - started,
  };
}

/** One swept configuration. */
export interface SweepPoint {
  readonly strategy: 'rrf' | 'borda';
  readonly weight: number;
}

/** The grid this study sweeps: both rank strategies over a decade of weights, ending at the control. */
export const DEFAULT_SWEEP: readonly SweepPoint[] = [
  { strategy: 'rrf', weight: 0 },
  { strategy: 'rrf', weight: 0.1 },
  { strategy: 'rrf', weight: 0.2 },
  { strategy: 'rrf', weight: 0.3 },
  { strategy: 'rrf', weight: 0.5 },
  { strategy: 'rrf', weight: 0.7 },
  { strategy: 'rrf', weight: 1 },
  { strategy: 'borda', weight: 0.3 },
  { strategy: 'borda', weight: 0.5 },
  { strategy: 'borda', weight: 1 },
];

/**
 * Score every configuration on the grid.
 *
 * The control is on the grid as `rrf` at weight zero, so the table's own first row is the engine and a reader never
 * has to subtract two numbers printed from different code paths.
 *
 * @param cases - The paired population.
 * @param records - Recorded answers, keyed by case.
 * @param grid - The configurations to score. Defaults to {@link DEFAULT_SWEEP}.
 * @returns One outcome per point, in grid order.
 */
export function sweepNomination(
  cases: readonly HeadroomCase[],
  records: ReadonlyMap<string, NominationRecord>,
  grid: readonly SweepPoint[] = DEFAULT_SWEEP,
): readonly NominationOutcome[] {
  return grid.map((point) =>
    scoreNomination(cases, records, { strategy: point.strategy, weight: point.weight }),
  );
}

/**
 * Render the whole study: the arm table, the ceiling, and the refusal census.
 *
 * @param cases - The paired population, for the oracle row's denominator.
 * @param outcomes - The swept outcomes.
 * @returns The report, as text.
 */
export function formatNominationStudy(
  cases: readonly HeadroomCase[],
  outcomes: readonly NominationOutcome[],
): string {
  const oracle = oracleTop1(cases);
  return [
    formatNominationTable(outcomes, oracle, cases.length),
    '',
    formatNominationRefusals(outcomes),
  ].join('\n');
}

/** One gate configuration. `null` is the control and is on the grid, so the table states its own baseline. */
export interface GatePoint {
  readonly threshold: number | null;
}

/**
 * Score the gate against its own control.
 *
 * `strategy` and `weight` are passed through as the control's label and are **not read** by the gate path — a gate
 * has one degree of freedom, the threshold, and the arm's table is printed by
 * `formatPromotionTable` rather than by the fusion table. Passing them anyway keeps one
 * `NominationOutcome` shape for both kinds of arm, which is what lets the two be differenced by a reader who trusts
 * the loop rather than the formatting.
 *
 * @param cases - The paired population.
 * @param records - Recorded answers, keyed by case.
 * @param spreadOrder - The full scored order, by case — where the spread comes from.
 * @param grid - Gate points to score. Defaults to the control plus the pre-registered threshold.
 * @returns One outcome per point, in grid order.
 */
export function sweepPromotion(
  cases: readonly HeadroomCase[],
  records: ReadonlyMap<string, NominationRecord>,
  spreadOrder: ReadonlyMap<string, readonly PublishedCandidate[]>,
  grid: readonly GatePoint[] = [{ threshold: null }, { threshold: DEFAULT_PROMOTION_THRESHOLD }],
  admission: EvidenceVariant | null = null,
): readonly NominationOutcome[] {
  return grid.map((point) =>
    scoreNomination(cases, records, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: point.threshold },
      // An evidence arm's spread order is deliberately ABSENT: the rule reads no score, and handing it an artifact
      // it does not use would let a later edit read one without changing anything a reader could see.
      ...(admission === null ? { spreadOrder } : {}),
      admission,
    }),
  );
}
