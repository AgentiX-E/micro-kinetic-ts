/**
 * The structured synthesis-repair loop: feed the exact validation error back and ask again, a bounded number of
 * times, instead of accepting a malformed answer or discarding it.
 *
 * ## Where this comes from
 *
 * The field's 90.0 % Acc@1 agent (`LGU-SE-Internal/ThinkDepthAI`) separates investigation from synthesis and puts a
 * `output_validator.py` on the synthesis node: it distinguishes empty / no-brace / never-closed / decode-error /
 * shape-error, and feeds the exact error verbatim into a repair prompt, for up to three attempts. That mechanism is
 * the one transferable, not-yet-built component named in `docs/agentic-layer-plan.md` §13 and
 * `PROGRESS_2026-11-28d.md` item 12. This module is it, reduced to its provider-agnostic decision core.
 *
 * ## What this module is, and is not
 *
 * It is PURE. It decides when to repair, what exact error to feed back, whether a reply parsed, and how much the
 * attempt sequence cost. It does not call a model: the transport is injected as {@link SynthesisComplete}, so the
 * same decision runs against DeepSeek, an offline provider or a recorded replay. The real HTTP wiring is measured
 * in `benchmarks/`, and the model transport itself is tested against a loopback server in `chat-completions.ts`.
 *
 * It does NOT give the model authority over a ranking. A repaired reply is still only a set of elimination claims;
 * every semantic question still belongs to `verifyClaim`. Repair recovers a *malformed* answer into a *readable*
 * one — it cannot make a well-formed but wrong answer right, and the guardrails in `docs/agentic-layer-plan.md` §8
 * hold exactly as before.
 *
 * ## The two disciplines that make it measurable
 *
 * * **The error is verbatim.** The rejected reply and the validator's own `why` string are copied into the repair
 *   turn unaltered, truncated only by a stated cap on a runaway reply. A repair that changed the error would be a
 *   different question, and the attempt count would no longer mean "same question, another try".
 * * **The budget is bounded and counted.** Attempts are clamped to {@link MAX_REPAIR_ATTEMPTS} and every call's
 *   reported tokens are summed. A repair arm that costs more than its ceiling cannot hide that in an accuracy cell.
 *
 * @module ai/agent/synthesis-repair
 */

import {
  DEFAULT_ELIMINATOR_OPTIONS,
  digestOf,
  parseEliminatorReply,
  type EliminatorPrompt,
} from './eliminator.js';
import type { EliminationClaim } from './hypothesis-space.js';

/**
 * Version of the repair contract. Bumped when the fault taxonomy or the repair turn changes: a recorded repair
 * belongs to the contract it was made under, as a recorded eliminator answer belongs to its protocol version.
 */
export const SYNTHESIS_REPAIR_PROTOCOL = 1;

/** ThinkDepth's own corrective budget: three repair calls after the first synthesis. */
export const DEFAULT_REPAIR_ATTEMPTS = 3;

/**
 * The cost ceiling. A caller may ask for more; the driver clamps rather than running an unbounded loop, because a
 * stuck provider would otherwise turn one case into a bill measured in hundreds of calls.
 */
export const MAX_REPAIR_ATTEMPTS = 5;

/** The categories ThinkDepth's `output_validator` distinguishes, plus our protocol's bound refusal. */
export type SynthesisFault =
  'empty' | 'no-brace' | 'never-closed' | 'decode-error' | 'shape-error' | 'bound-error';

/** What one call returned. The four fields are exactly what `ChatCompletion` reports. */
export interface SynthesisReply {
  readonly text: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** The provider boundary: any chat-completions client structural-fits this signature. */
export type SynthesisComplete = (turn: RepairTurn) => Promise<SynthesisReply>;

/** The bounded driver's options. */
export interface RepairOptions {
  /**
   * Repair calls after the first. Defaults to {@link DEFAULT_REPAIR_ATTEMPTS}, clamped to the hard cap.
   * One attempt is therefore two calls at most: the first synthesis plus one repair.
   */
  readonly maxAttempts?: number;
  /** The elimination bound the reply is checked against. Defaults to the presented protocol's bound. */
  readonly maxClaims?: number;
}

/** One repair turn, with a digest so a replay can tell which question it answered. */
export interface RepairTurn {
  readonly system: string;
  readonly user: string;
  readonly digest: string;
}

/** One call's step in the repair sequence. */
export interface RepairStep {
  readonly text: string;
  /** The validator's reason, verbatim; empty when the step parsed. */
  readonly why: string;
  /** The fault category, or `null` when the step parsed. */
  readonly fault: SynthesisFault | null;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** The whole outcome: the decision, the claims, the faults, and the bill. */
export interface RepairOutcome {
  readonly ok: boolean;
  readonly claims: readonly EliminationClaim[];
  /** The final reason a reply could not be read, verbatim; empty when `ok`. */
  readonly why: string;
  /** Calls made, including the first. */
  readonly attempts: number;
  /** Repair calls made after the first. */
  readonly repairs: number;
  /** One fault per failed step, in order; empty when the first step parsed. */
  readonly faults: readonly SynthesisFault[];
  /** True when the first step failed and a later step parsed. */
  readonly recovered: boolean;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly steps: readonly RepairStep[];
}

/**
 * Brace depth of a reply, ignoring braces inside double-quoted strings.
 *
 * The distinction matters: a service name such as `svc-a{b` is a legal JSON string, and a scanner that counted its
 * brace would call a complete reply "never-closed" and pay for a repair that was not needed. Backslash escapes are
 * honoured, so a quote inside a string does not end it.
 *
 * @param text - The reply text, fenced or not.
 * @returns The depth at the end (`0` when balanced), or `-1` when a closing brace appeared before any opening one.
 */
function braceDepth(text: string): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return -1;
    }
  }
  return depth;
}

/**
 * Classify a refusal into the fault taxonomy, in the order the validator reaches each check.
 *
 * Structural checks come first because they name a fix a model can act on ("close the object") that a generic
 * "not JSON" cannot. `why` is the parser's own verbatim reason and is never rewritten here — the repair turn feeds
 * it back exactly as it arrived.
 *
 * @param text - The rejected reply, verbatim.
 * @param why - The validator's reason, verbatim.
 * @returns The fault category.
 */
export function classifyFault(text: string, why: string): SynthesisFault {
  if (text.trim() === '') return 'empty';
  // Structural faults are diagnosed only when the parser actually failed to decode JSON. A reply such as `[]`
  // or `"a string"` is valid JSON with the wrong shape: calling it "no-brace" would tell the model it produced no
  // JSON at all, which is false, and the repair would be aimed at a fault that did not occur. The parser's own
  // `why` is the authority on whether decoding failed.
  if (why === 'the reply is not JSON') {
    if (!text.includes('{')) return 'no-brace';
    if (braceDepth(text) > 0) return 'never-closed';
    return 'decode-error';
  }
  if (why.startsWith('the reply carries ') && why.includes(' against a bound of '))
    return 'bound-error';
  return 'shape-error';
}

/** A runaway reply is truncated in the repair turn; the cap is stated rather than implicit. */
const REPLY_EXCERPT = 2000;

/**
 * Build the next question: the original table, the rejected reply and the exact error.
 *
 * The system carries the original instruction plus the corrective directive; the user carries the original
 * question plus the verbatim rejected reply and the verbatim error. Both the original `system` and the original
 * `user` are therefore still present, so the repair is an answer to the SAME question rather than a new one.
 *
 * @param original - The eliminator prompt the first answer was given to.
 * @param rejected - The reply that failed validation, verbatim.
 * @param why - The validator's reason, verbatim.
 * @param fault - The classified fault, named in the directive.
 * @param attempt - One-based repair attempt number.
 * @param maxAttempts - Total repairs allowed, printed so the model knows the budget.
 * @returns The repair turn and its digest.
 */
export function buildRepairTurn(
  original: EliminatorPrompt,
  rejected: string,
  why: string,
  fault: SynthesisFault,
  attempt: number,
  maxAttempts: number,
): RepairTurn {
  const directive = [
    '',
    `REPAIR MODE — attempt ${attempt} of ${maxAttempts}.`,
    'Your previous reply was rejected by the output validator for this exact reason:',
    why,
    `The fault category is ${fault}.`,
    'Produce a corrected reply that obeys every rule above. Reply with JSON ONLY.',
  ].join('\n');
  const excerpt =
    rejected.length > REPLY_EXCERPT ? `${rejected.slice(0, REPLY_EXCERPT)}…[truncated]` : rejected;
  const user = [
    original.user,
    '',
    '--- REJECTED REPLY (verbatim) ---',
    excerpt,
    '--- VALIDATOR ERROR (verbatim) ---',
    why,
    `(${fault})`,
    '--- Corrected JSON reply (JSON ONLY, no prose, no fences) ---',
  ].join('\n');
  const system = `${original.system}${directive}`;
  return { system, user, digest: digestOf(`${system}\u0000${user}`) };
}

/** Validate the positive-integer attempt count once, at the boundary, so a fractional budget cannot hide. */
function clampAttempts(value: number | undefined): number {
  const raw = value ?? DEFAULT_REPAIR_ATTEMPTS;
  if (!Number.isInteger(raw) || raw < 1) throw new Error('maxAttempts must be a positive integer');
  return Math.min(raw, MAX_REPAIR_ATTEMPTS);
}

/**
 * Drive the bounded repair loop.
 *
 * The first reply is supplied already fetched: the caller owns the transport and its retries, and this driver only
 * decides whether a malformed answer is worth another call. A transport error on a repair call propagates to that
 * caller, which records it in its own failure census — the driver does not swallow it into a "malformed" fault and
 * pretend the model declined.
 *
 * @param prompt - The original eliminator prompt.
 * @param first - The first reply, already fetched by the caller.
 * @param complete - The provider boundary, called only when a repair is needed.
 * @param options - Attempt budget and elimination bound.
 * @returns The accepted claims (or none) with the full attempt census and bill.
 */
export async function repairSynthesis(
  prompt: EliminatorPrompt,
  first: SynthesisReply,
  complete: SynthesisComplete,
  options: RepairOptions = {},
): Promise<RepairOutcome> {
  const maxAttempts = clampAttempts(options.maxAttempts);
  const maxClaims = options.maxClaims ?? DEFAULT_ELIMINATOR_OPTIONS.maxClaims;
  const faults: SynthesisFault[] = [];
  const steps: RepairStep[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  let current = first;
  let parsed = parseEliminatorReply(current.text, maxClaims);
  let why = parsed.ok ? '' : parsed.why;
  let fault: SynthesisFault | null = parsed.ok ? null : classifyFault(current.text, why);
  steps.push({
    text: current.text,
    why,
    fault,
    model: current.model,
    promptTokens: current.promptTokens,
    completionTokens: current.completionTokens,
  });
  promptTokens += current.promptTokens;
  completionTokens += current.completionTokens;
  if (!parsed.ok) faults.push(fault!);

  let repairs = 0;
  while (!parsed.ok && repairs < maxAttempts) {
    repairs += 1;
    const turn = buildRepairTurn(prompt, current.text, why, fault!, repairs, maxAttempts);
    current = await complete(turn);
    parsed = parseEliminatorReply(current.text, maxClaims);
    why = parsed.ok ? '' : parsed.why;
    fault = parsed.ok ? null : classifyFault(current.text, why);
    steps.push({
      text: current.text,
      why,
      fault,
      model: current.model,
      promptTokens: current.promptTokens,
      completionTokens: current.completionTokens,
    });
    promptTokens += current.promptTokens;
    completionTokens += current.completionTokens;
    if (!parsed.ok) faults.push(fault!);
  }

  return {
    ok: parsed.ok,
    claims: parsed.ok ? parsed.claims : [],
    why,
    attempts: steps.length,
    repairs,
    faults,
    recovered: !parsed.ok ? false : repairs > 0,
    promptTokens,
    completionTokens,
    steps,
  };
}
