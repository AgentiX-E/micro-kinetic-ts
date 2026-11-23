/**
 * Price the resolver's three modes on one artifact, with the interface witness read from the corpus.
 *
 * ## Why this exists instead of a dispatch
 *
 * The interface witness is a property of the CASE — the failing interfaces a case carries — and the artifact
 * already holds the answer the arm settled on. So the rule can be priced without a model call: read the witness
 * from the corpus, read the answer from the artifact, and run both through `applyResolver`, which is the function
 * the LOOP calls. A dispatch measures the endpoint's mood as well as the rule; this measures the rule.
 *
 * ## What it cannot tell you
 *
 * It cannot tell you whether SHOWING the new column changes what the model does. That question needs a dispatch,
 * and iteration 324 already answered it once for a different display: the overshoot rate moved from 36.18 % to
 * 36.50 %, which is inside the endpoint's own noise. A ¥0 replay prices the rule; only a run prices the prompt.
 *
 * @module benchmarks/edge-novel-census
 */

import type { Resolution, ResolverEvidence } from './query-agent.js';
import { applyResolver } from './query-agent.js';

/** What one case's interfaces witness, and nothing about the answer. */
export interface Witness {
  readonly datapack: string;
  /** The caller of the strongest novel interface, or `null` when the case carries none. */
  readonly novelCaller: string | null;
  /** That interface's novel-call count, or `null` when there is none. */
  readonly novelRise: number | null;
}

/** The part of an artifact row this prices. `QueryArmRow` satisfies it structurally. */
export interface PriceableRow {
  readonly datapack: string;
  readonly truth: readonly string[];
  /** The answer the run published, i.e. already renamed by whatever resolver that run dispatched. */
  readonly answer: string | null;
  /** The resolver evidence the row recorded about its own answer; `null` fields read as refusals. */
  readonly entry: string | null;
  readonly entryChildErrors: number | null;
  /** Whether a failing interface lands below the entry; `null` reads as a refusal, like every other missing field. */
  readonly belowFails: boolean | null;
  readonly answerSurprise: number | null;
}

/** One mode's reading. */
export interface ModeReading {
  readonly mode: Resolution;
  /** Cases the rule renamed. */
  readonly fires: number;
  readonly repairs: number;
  readonly breaks: number;
  /** `repairs − breaks`, the number that decides whether the mode ships. */
  readonly net: number;
  /** Cases answered correctly under this mode. */
  readonly correct: number;
}

/**
 * Apply every mode to every row and count what it did.
 *
 * The three modes are read from the SAME rows in one pass, which is what makes them comparable: a rule priced on
 * one population and shipped on another is two rules. `entry-prior` is idempotent on a row that the run already
 * resolved that way — `entryAttribution` refuses a name that is already the entry — so a `lag`/`entry-prior` run's
 * artifact prices all three without double-counting its own resolver.
 *
 * @param rows - The artifact's rows, one per case.
 * @param witnesses - The witness per case, keyed by `datapack`.
 * @param modes - The modes to price, in the order the table should read.
 * @returns One reading per mode.
 */
export function priceModes(
  rows: readonly PriceableRow[],
  witnesses: ReadonlyMap<string, Witness>,
  modes: readonly Resolution[] = ['none', 'entry-prior', 'edge-novel'],
): readonly ModeReading[] {
  return modes.map((mode) => {
    let fires = 0;
    let repairs = 0;
    let breaks = 0;
    let correct = 0;
    for (const row of rows) {
      const witness = witnesses.get(row.datapack);
      const evidence: ResolverEvidence = {
        entry: row.entry,
        entryChildErrors: row.entryChildErrors,
        belowFails: row.belowFails,
        answerSurprise: row.answerSurprise,
        // The channel split is priced by `channel-split.ts`, from a corpus walk rather than from an artifact: this
        // census's rows carry no answer-side profile, and a `null` here reads as "no channel evidence" — the state
        // `entryAttribution` refuses on rather than one it fires on. The first hop's column is absent for the same
        // reason and refuses for the same reason.
        answerChannels: null,
        entryInboundFails: null,
        novelCaller: witness?.novelCaller ?? null,
        novelRise: witness?.novelRise ?? null,
      };
      const before = row.answer;
      const resolved = applyResolver(before, evidence, mode);
      const hit = resolved.answer !== null && row.truth.includes(resolved.answer);
      if (hit) correct += 1;
      if (resolved.by === null) continue;
      fires += 1;
      const wasRight = before !== null && row.truth.includes(before);
      if (hit && !wasRight) repairs += 1;
      if (!hit && wasRight) breaks += 1;
    }
    return { mode, fires, repairs, breaks, net: repairs - breaks, correct };
  });
}
