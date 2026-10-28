/**
 * The trace-vote census: the one binary ranking term, scored on whether its DECISION was right.
 *
 * ## Why this exists
 *
 * The trace-activity term pays a unit to the UNIQUE service whose span count rose while its peers held or fell.
 * It is the only term in the formula whose value is a decision rather than a magnitude, it ships OFF everywhere,
 * and it is pinned ON for RE3 alone — because the silent-source case that motivated it (`ts-auth-service` doing
 * more work per request and emitting no error anywhere) is a TrainTicket RE3 fault.
 *
 * Two measurements of it now disagree in a way that neither can settle:
 *
 * - the term-gap census (`term-gap-census.ts`) reads `trace=+1.000` on **5 of TrainTicket RE3's 11 misses**, so
 *   on that cell the term is the single largest thing standing between this engine and the truth;
 * - a removal arm on the same commit reads **51 of 90 against 61**, so removing the term costs ten cases — it
 *   wins more than it loses, and a weight sweep is not the shape of the question.
 *
 * The question they leave open is *which* votes are wrong, and no artifact could answer it: the failure
 * diagnostics print the highest-ratio service, which is not the service the rule CHOSE (the rule requires
 * `pre >= 500`, so the highest-ratio service is usually disqualified).
 *
 * This census counts the decisions. `hits` is how often the vote landed on the ground truth; `decisive` is how
 * often a WRONG vote became the top-1 prediction — the subset where the term did not merely mislead, it decided.
 *
 * ## What an abstention is not
 *
 * `abstained` counts cases where the term reported no vote at all: either the term was off (its weight is 0 on
 * every suite but RE3), or the rule found zero or several qualifying risers and stayed neutral by construction.
 * Counted apart rather than as a miss, the rule every census here follows — a term that did not speak has not
 * been wrong.
 *
 * @module benchmarks/trace-vote-census
 */

import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

/** The running totals for one cell. */
export interface TraceVoteCensus {
  /** Cases the runner analysed. */
  cases: number;
  /** Cases where the term cast a vote. */
  votes: number;
  /** Cases where the vote was the ground truth. */
  hits: number;
  /** Cases where a wrong vote became the top-1 prediction, i.e. the term decided the case wrongly. */
  decisive: number;
  /** Cases where the term abstained: off, or no unique qualifying riser. */
  abstained: number;
}

/**
 * A census with nothing in it.
 *
 * @returns Zeroed totals, ready for {@link accumulateTraceVote}.
 */
export function createTraceVoteCensus(): TraceVoteCensus {
  return { cases: 0, votes: 0, hits: 0, decisive: 0, abstained: 0 };
}

/**
 * Fold one case's prediction into the census.
 *
 * @param census - The running totals, mutated in place.
 * @param prediction - The runner's record for one case, carrying the term's decision when it made one.
 */
export function accumulateTraceVote(census: TraceVoteCensus, prediction: CasePrediction): void {
  census.cases += 1;
  const vote = prediction.traceVote;
  if (vote === undefined) {
    census.abstained += 1;
    return;
  }
  census.votes += 1;
  if (vote === prediction.truth) {
    census.hits += 1;
    return;
  }
  // A wrong vote is only DECISIVE when it is also the case's top-1: a vote the ranking overruled went to the
  // wrong service without deciding anything, which is a different finding and a much smaller one.
  if (vote === prediction.top1) census.decisive += 1;
}

/**
 * The census as a line, or `undefined` when it saw no case.
 *
 * @param census - The running totals.
 */
export function formatTraceVoteLine(census: TraceVoteCensus): string | undefined {
  if (census.cases === 0) return undefined;
  const share = census.votes === 0 ? '0.0' : ((100 * census.hits) / census.votes).toFixed(1);
  const parts = [
    `[trace-vote] cases=${census.cases} votes=${census.votes} hits=${census.hits} (${share}%)`,
  ];
  if (census.abstained > 0) parts.push(`abstained=${census.abstained}`);
  if (census.votes > 0)
    parts.push(`wrong=${census.votes - census.hits} decisive=${census.decisive}`);
  return parts.join(' | ');
}
