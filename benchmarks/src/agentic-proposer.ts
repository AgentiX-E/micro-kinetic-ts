/**
 * The proposer: one prompt per case, one call, one recorded answer.
 *
 * It is deliberately thin. Every decision it could take — which candidate to remove, whether the claim is true, how
 * far the ranking may move — belongs to `packages/ai` (the protocol and the verifier) or to the scoring arm. What
 * is left here is the part that touches the world: an ordering, a concurrency bound, a failure that must not stop
 * the run, and a record written as soon as it exists.
 *
 * **A failure is an answer with a reason.** A call that never returned is recorded as a case whose reply could not
 * be read, not as a missing case and not as a crash: the arm then abstains there, the denominator stays the corpus,
 * and the run reports `failed: n` beside its score. The alternative — dropping the case — would let a network
 * outage improve the accuracy by shrinking the population.
 *
 * **Answers are reused only under the same question.** A case already answered under the current prompt digest is
 * not asked again, which is what makes a resumed run cheap; a case answered under a different digest is asked
 * again, because its old answer belongs to a different question.
 */

import {
  DEFAULT_ELIMINATOR_OPTIONS,
  ELIMINATOR_PROTOCOL,
  SYNTHESIS_REPAIR_PROTOCOL,
  buildEliminatorPrompt,
  parseEliminatorReply,
  repairSynthesis,
  type EliminatorOptions,
  type SynthesisFault,
} from '../../packages/ai/src/agent/index.js';
import type { ClaimRecord, RepairProvenance } from './agentic-claims.js';
import type { HeadroomCase } from './agentic-headroom.js';
import type { ChatClient } from './chat-completions.js';
import { ChatCompletionError } from './chat-completions.js';

/** The gated structured synthesis-repair option, passed through to the pure driver. */
export interface ProposeRepairOptions {
  /** Off by default: the shipped arm never pays for a repair unless a caller opens the gate. */
  readonly enabled: boolean;
  /** Repair calls after the first synthesis. Defaults to the driver's ThinkDepth budget. */
  readonly maxAttempts?: number;
}

/** How the proposer is driven. */
export interface ProposeOptions {
  readonly client: ChatClient;
  /** Presentation width and reply bound. The default is the published top five. */
  readonly eliminator?: EliminatorOptions;
  /**
   * The structured synthesis-repair gate. Absent or disabled is bit-identical to the pre-repair arm: no extra
   * call, no extra token, no provenance field. This is both the production switch and the ablation arm.
   */
  readonly repair?: ProposeRepairOptions;
  /** Calls in flight. Four is what a shared endpoint tolerates without a 429 as the common case. */
  readonly concurrency?: number;
  /** Answers already recorded, keyed by case. Reused only when the digest matches. */
  readonly existing?: ReadonlyMap<string, ClaimRecord>;
  /** Called once per case, in completion order, so a caller can append to the artifact as it grows. */
  readonly onRecord: (record: ClaimRecord) => void;
  /** Called after each case, for a heartbeat. */
  readonly onProgress?: (done: number, total: number) => void;
}

/** What a proposal run did. Token counts are what the endpoint reported. */
export interface ProposeSummary {
  /** Cases in the population. */
  readonly cases: number;
  /** Cases asked. */
  readonly asked: number;
  /** Cases answered from a previous run under the same prompt. */
  readonly reused: number;
  /** Answers that carried at least one claim (before verification). */
  readonly answered: number;
  /** Answers that carried none: the model agreed with the engine. */
  readonly declined: number;
  /** Replies that could not be read, plus calls that failed, by count. */
  readonly unreadable: number;
  /** Every unreadable case, as `case: reason`. */
  readonly unreadableCases: readonly string[];
  /** Claims proposed, before verification. */
  readonly claims: number;
  /** Cases whose first reply was malformed and whose repair produced a readable claim. */
  readonly repaired: number;
  /** Repair calls made after a first synthesis, summed over the run. */
  readonly repairCalls: number;
  /** One fault category per failed parse, in order, including the first synthesis when it failed. */
  readonly repairFaults: readonly SynthesisFault[];
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Wall clock of the whole run. */
  readonly elapsedMs: number;
}

/** The prompt digest for every case, which is what a replay pairs a recorded answer against. */
export function digestsOf(
  cases: readonly HeadroomCase[],
  eliminator: EliminatorOptions = DEFAULT_ELIMINATOR_OPTIONS,
): Map<string, string> {
  const digests = new Map<string, string>();
  for (const oneCase of cases) {
    digests.set(
      oneCase.datapack,
      buildEliminatorPrompt(oneCase.faultType, oneCase.candidates, eliminator).digest,
    );
  }
  return digests;
}

/**
 * Ask the model about every case that is not already answered under the current prompt.
 *
 * @param cases - The population, in file order.
 * @param options - Client, width, concurrency and the sink for each record.
 * @returns Counts for the run's log line. Never throws for a failed case.
 */
export async function proposeClaims(
  cases: readonly HeadroomCase[],
  options: ProposeOptions,
): Promise<ProposeSummary> {
  const eliminator = options.eliminator ?? DEFAULT_ELIMINATOR_OPTIONS;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 32));
  const existing = options.existing ?? new Map<string, ClaimRecord>();
  const started = Date.now();

  let asked = 0;
  let reused = 0;
  let answered = 0;
  let declined = 0;
  let unreadable = 0;
  let claims = 0;
  let repaired = 0;
  let repairCalls = 0;
  const repairFaults: SynthesisFault[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  const unreadableCases: string[] = [];

  const pending: HeadroomCase[] = [];
  for (const oneCase of cases) {
    const previous = existing.get(oneCase.datapack);
    const prompt = buildEliminatorPrompt(oneCase.faultType, oneCase.candidates, eliminator);
    if (previous !== undefined && previous.digest === prompt.digest) {
      // Counted and NOT emitted: the caller's artifact already holds this line, and an append-only sink would write
      // it a second time — a file that grew by one line per resumed case would read as a run that asked twice.
      reused += 1;
      continue;
    }
    pending.push(oneCase);
  }

  let cursor = 0;
  let done = 0;
  const total = pending.length;

  const askOne = async (oneCase: HeadroomCase): Promise<void> => {
    const prompt = buildEliminatorPrompt(oneCase.faultType, oneCase.candidates, eliminator);
    const at = Date.now();
    asked += 1;
    let record: ClaimRecord;
    let madeRepairCalls = 0;
    try {
      const completion = await options.client.complete({
        system: prompt.system,
        user: prompt.user,
      });
      const model = completion.model === '' ? options.client.model : completion.model;

      // With the gate off, the path below is the original one call / one parse / one record. With it on, the same
      // first completion is handed to the pure repair driver, which makes further calls ONLY when it failed to
      // parse and feeds the exact error back on each. The driver's token totals cover every call, so the record
      // and the summary charge the whole repair sequence and no token is counted twice.
      const gate = options.repair?.enabled === true ? options.repair : null;
      const result = gate
        ? await repairSynthesis(
            prompt,
            completion,
            (turn) => {
              madeRepairCalls += 1;
              return options.client.complete({ system: turn.system, user: turn.user });
            },
            { maxAttempts: gate.maxAttempts, maxClaims: eliminator.maxClaims },
          )
        : null;
      const ok =
        result === null ? parseEliminatorReply(completion.text, eliminator.maxClaims) : null;
      const accepted = result?.ok === true || (ok !== null && ok.ok);
      const finalClaims = result !== null ? result.claims : ok !== null && ok.ok ? ok.claims : [];
      const why = result !== null ? result.why : ok !== null && !ok.ok ? ok.why : '';
      const spentPrompt = result?.promptTokens ?? completion.promptTokens;
      const spentCompletion = result?.completionTokens ?? completion.completionTokens;
      promptTokens += spentPrompt;
      completionTokens += spentCompletion;

      if (result !== null) {
        repairCalls += madeRepairCalls;
        repairFaults.push(...result.faults);
        if (result.recovered) repaired += 1;
      }
      const repair: RepairProvenance | undefined =
        result !== null && (result.repairs > 0 || result.faults.length > 0)
          ? {
              protocol: SYNTHESIS_REPAIR_PROTOCOL,
              calls: result.repairs,
              faults: [...result.faults],
            }
          : undefined;

      if (accepted) {
        claims += finalClaims.length;
        answered += finalClaims.length > 0 ? 1 : 0;
        declined += finalClaims.length === 0 ? 1 : 0;
        record = {
          datapack: oneCase.datapack,
          model,
          protocol: ELIMINATOR_PROTOCOL,
          digest: prompt.digest,
          claims: finalClaims,
          ...(repair === undefined ? {} : { repair }),
          ms: Date.now() - at,
          promptTokens: spentPrompt,
          completionTokens: spentCompletion,
        };
      } else {
        unreadable += 1;
        unreadableCases.push(`${oneCase.datapack}: ${why}`);
        record = {
          datapack: oneCase.datapack,
          model,
          protocol: ELIMINATOR_PROTOCOL,
          digest: prompt.digest,
          claims: [],
          malformed: why,
          ...(repair === undefined ? {} : { repair }),
          ms: Date.now() - at,
          promptTokens: spentPrompt,
          completionTokens: spentCompletion,
        };
      }
    } catch (error) {
      // A failed call is recorded with the reason it failed, under the digest of the question that was asked, so a
      // resumed run does not pay for it twice and a reader can tell it apart from a model that said nothing. A
      // transport failure DURING a repair propagates out of the pure driver to here, where it is counted as the
      // unreadable case it is rather than swallowed into a "the model declined" fault.
      const why =
        error instanceof ChatCompletionError
          ? `the call failed: ${error.message}`
          : `the call failed: ${String(error)}`;
      unreadable += 1;
      repairCalls += madeRepairCalls;
      unreadableCases.push(`${oneCase.datapack}: ${why}`);
      record = {
        datapack: oneCase.datapack,
        model: options.client.model,
        protocol: ELIMINATOR_PROTOCOL,
        digest: prompt.digest,
        claims: [],
        malformed: why,
        ...(madeRepairCalls > 0
          ? {
              repair: {
                protocol: SYNTHESIS_REPAIR_PROTOCOL,
                calls: madeRepairCalls,
                faults: [] as string[],
              },
            }
          : {}),
        ms: Date.now() - at,
        promptTokens: 0,
        completionTokens: 0,
      };
    }
    options.onRecord(record);
    done += 1;
    options.onProgress?.(done, total);
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;
      await askOne(pending[index]!);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, worker));

  return {
    cases: cases.length,
    asked,
    reused,
    answered,
    declined,
    unreadable,
    unreadableCases,
    claims,
    repaired,
    repairCalls,
    repairFaults,
    promptTokens,
    completionTokens,
    elapsedMs: Date.now() - started,
  };
}
