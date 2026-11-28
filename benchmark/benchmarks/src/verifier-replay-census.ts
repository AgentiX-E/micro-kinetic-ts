/**
 * A re-scorable census of what the mechanical claim verifier accepted, and why it refused the rest.
 *
 * ## Why this is a module and not a number in a progress document
 *
 * `agentic-fusion.md` records "3 321 of 5 335 claims survive `verifyClaim`", and `PROGRESS_2026-11-14a.md` records
 * the refusal decomposition — 2 014 of 5 335 (37.8 %), of which 1 774 were `unknown-channel` before iteration 284
 * split 774 of them into `channel-not-observed-on-both`. Those numbers are true, and they are re-scorable: every
 * claim in `claims.ndjson` names a case, every case in `fingerprints.ndjson` carries the posterior the claim was
 * checked against, and `verifyClaim` is a pure function of the two. What was missing was an owner — a tested entry
 * point that turns a replay into the tally, so the reading can be reproduced against any artifact rather than
 * re-derived by hand. This module is that owner.
 *
 * ## What is measured, and what is not
 *
 * The census counts FABRICATION refusals, not bad judgement. `verifyClaim` accepts a claim whose every field is
 * true even when its conclusion is wrong, because whether the conclusion is right is what Top@1 measures; a
 * verifier that also policed judgement would be a second scorer hidden inside the layer. So `verified` here means
 * "the claim was allowed to move the ranking", and `refused` means "the claim cited a channel, value, band or rate
 * the fingerprint did not support". `survival` is over ALL replayed claims, never over a consulted subset.
 *
 * The census is a TALLY of `verifyClaim`, never a second scorer: it calls `verifyClaim` once per row and buckets the
 * verdict it returns. A change in the verifier therefore changes the census in lockstep, which the tests pin by
 * comparing against a direct tally. Pure: no IO, no corpus, no clock.
 *
 * @module benchmarks/verifier-replay-census
 */

import {
  CLAIM_REJECTIONS,
  type ClaimRejection,
  type EliminationClaim,
  verifyClaim,
} from '../../packages/ai/src/agent/index.js';

import type { CandidateFingerprint, ClaimVerdict } from '../../packages/ai/src/agent/index.js';

/** One claim paired with the posterior it was verified against — the joined unit of a replay. */
export interface ReplayRow {
  readonly claim: EliminationClaim;
  readonly candidates: readonly CandidateFingerprint[];
}

/** A counter for each of the nine refusal families declared by {@link CLAIM_REJECTIONS}. */
export type RefusalCounts = Readonly<Record<ClaimRejection, number>>;

/** The tally over a replay. */
export interface VerdictCensus {
  /** Claims replayed. */
  readonly claims: number;
  /** Claims the verifier accepted — allowed to move the ranking. */
  readonly verified: number;
  /** Claims the verifier refused, summed over all families. */
  readonly refused: number;
  /** `verified / claims`, or `0` when the replay was empty. */
  readonly survival: number;
  /** Refusals by family; the values sum to {@link refused}. */
  readonly refusals: RefusalCounts;
}

/**
 * A fresh all-zero counter, one slot per declared refusal family.
 *
 * Fresh on every call so a caller can accumulate into it without mutating a shared template.
 */
export function emptyRefusalCounts(): RefusalCounts {
  const counts = {} as Record<ClaimRejection, number>;
  for (const reason of CLAIM_REJECTIONS) counts[reason] = 0;
  return counts;
}

/** Whether a verdict accepted its claim. Narrows the discriminated union at call sites. */
export function verdictVerified(verdict: ClaimVerdict): boolean {
  return verdict.ok;
}

/**
 * Tally one replay.
 *
 * `verifyClaim` is called exactly once per row; the census never re-implements its checks. Refusals are bucketed by
 * the reason the verifier returned — a reason can only be one of {@link CLAIM_REJECTIONS}, so the counters partition
 * `refused` exactly and no family is dropped or conflated.
 *
 * @param rows - Claims paired with the posterior each was verified against.
 * @returns The census; `survival` is `0` for an empty replay.
 */
export function replayVerdicts(rows: readonly ReplayRow[]): VerdictCensus {
  const refusals = {} as Record<ClaimRejection, number>;
  for (const reason of CLAIM_REJECTIONS) refusals[reason] = 0;
  let verified = 0;
  let refused = 0;
  for (const row of rows) {
    const verdict = verifyClaim(row.claim, row.candidates);
    if (verdict.ok) {
      verified += 1;
    } else {
      refused += 1;
      refusals[verdict.reason] += 1;
    }
  }
  return {
    claims: rows.length,
    verified,
    refused,
    survival: rows.length === 0 ? 0 : verified / rows.length,
    refusals,
  };
}
