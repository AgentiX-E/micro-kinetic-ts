/**
 * The failed-edge ledger's own JURISDICTION over the ranking: the nodes an inbound call FAILED against come
 * first, in the order the ranking gives them, and everything else follows behind.
 *
 * ## What the ledger already knows, and what the ranking does with it
 *
 * `computeFailedEdgeLedger` walks the case's failed calls once and charges each one to its CALLEE — the service
 * whose interface was failing. It is the only channel in this engine that carries the DIRECTION of a fault, and
 * the corpus says it is nearly total: on the 421 value-replacement datapacks of `docs/fse26-entry-point.md`,
 * **418 of 421 truths (99.3 %)** carry a positive credit, against **6.6 %** of all candidates (1 372 of 20 632).
 * In one sentence: the truth is almost always in that set, and the set is a fortieth of the graph (median three
 * members of forty-nine).
 *
 * The shipped engine reads that map through ONE mechanism — `failedEdgeWeight`'s gate, which may OVERRIDE the
 * champion when the baseline's rank-1 itself qualifies (`admitsFailedEdgeTerm`). That form decides about the
 * champion the base ranking already chose, so it can only ever substitute one answer for another; it cannot
 * change the question. And on this corpus the gate refuses almost every case, which is why the term's measured
 * value is +41 cases while the set it computes covers 99.3 % of the truths.
 *
 * ## The rule, stated as an ORDER
 *
 * A candidate the ledger credited is ranked ahead of one it did not, and within each half the base ranking's
 * order is preserved. Three properties follow from the form rather than from a parameter:
 *
 * - **No node is deleted.** A truth the ledger missed is not removed from the answer; it is displaced by however
 *   many candidates the ledger DID name. That is the difference between this rule and a filter, and it is why the
 *   worst case is bounded by the candidate count (median three) rather than by the corpus.
 * - **No magnitude is invented.** The partition reads membership, not the credit's size: a case whose credit is
 *   0.004 and a case whose credit is 1.000 are equally "in". A graded version would need a weight, and a weight is
 *   the thing this project refuses to ship without a measurement.
 * - **Nothing is scored twice.** The map is the ledger's, built once per case whether or not the weight is set,
 *   so the order and the term cannot disagree about which edges counted.
 *
 * ## Why an order rather than a weight
 *
 * The additive form (`score += w × credit`) was the term's first shape and it is what `failedEdgeWeight` still is
 * inside its gate. It cannot express this rule: the credit is a share in [0, 1] and the base term is
 * `log1p(selfAnomaly)` in [0, 0.693], so any weight large enough to lift an uncredited node past a credited one
 * also lifts a credited node past every uncredited truth. A partition has no such failure mode because it never
 * compares a credit to an anomaly: it compares membership to membership, which is the only comparison the
 * ledger's own evidence licenses.
 *
 * @module pruning/failed-edge-order
 */

import type { ServiceId } from '@agentix-e/micro-kinetic-core';

/**
 * Order the candidates so that every node the failed-edge ledger credited precedes every node it did not.
 *
 * @param ranking - The scored candidates, best first. Not mutated.
 * @param credits - The ledger's per-callee credit. `undefined` (the map was never built) and an empty map are
 *   the same statement here — no case evidence — and both leave the ranking untouched.
 * @returns `ranking` itself when the partition would move nothing, otherwise a new array: the credited nodes in
 *   their original relative order, then the rest in theirs.
 */
export function orderFailedEdgeFirst<T extends { readonly serviceId: ServiceId }>(
  ranking: readonly T[],
  credits: ReadonlyMap<ServiceId, number> | undefined,
): readonly T[] {
  if (credits === undefined || credits.size === 0) return ranking;
  // `> 0` rather than a truthiness test: a credit of `-0` is a zero, and `NaN > 0` is false, so a broken ledger
  // entry is treated as no evidence rather than as evidence for whichever side a comparison happens to fall on.
  return partitionFirst(ranking, (id) => {
    const credit = credits.get(id);
    return credit !== undefined && credit > 0;
  });
}

/**
 * Order the candidates so that every candidate {@link isLead} admits precedes every candidate it does not.
 *
 * The general form of the rule, and the form the two membership tests share: the ledger's CREDIT (`> 0`) and the
 * failure flow's RESIDUAL (`unexplainedFailures > 0`) answer different questions about a candidate, and the
 * partition is indifferent to which one named the lead. Expressing the rule once is what keeps the two arms
 * comparable: a second copy of a stable partition is a second chance for one of them to stop being stable.
 *
 * @param ranking - The scored candidates, best first. Not mutated.
 * @param isLead - The membership test. Called once per candidate, in ranking order.
 * @returns `ranking` itself when the partition would move nothing, otherwise a new array.
 */
export function partitionFirst<T extends { readonly serviceId: ServiceId }>(
  ranking: readonly T[],
  isLead: (serviceId: ServiceId) => boolean,
): readonly T[] {
  const leads: T[] = [];
  const rest: T[] = [];
  for (const candidate of ranking) {
    if (isLead(candidate.serviceId)) leads.push(candidate);
    else rest.push(candidate);
  }
  // The degenerate cases are the ones that must cost nothing: no lead (the rule has nothing to lift) and no other
  // candidate (everything is already lifted) both return the caller's array rather than a copy of it.
  if (leads.length === 0 || rest.length === 0) return ranking;
  return [...leads, ...rest];
}
