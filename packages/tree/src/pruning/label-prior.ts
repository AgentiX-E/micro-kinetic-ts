/**
 * The label prior as a score term, and the margin gate that decides when it may speak.
 *
 * ## What the term is
 *
 *   finalScore(v) += labelPriorWeight × log p(v),  p(v) = (count(v) + 1/V) / (labelled + 1)
 *
 * `count(v)` is how often `v` was the labelled root cause of the deployment's PAST incidents, `labelled` is how
 * many those incidents are, and `V` is the number of candidates THIS case carries. The term is therefore a
 * statement about the deployment applied to the case, not a measurement of the case — the one thing in the
 * ranking sum that is true before any telemetry has been read.
 *
 * ## Why the floor is `1/V` and not a constant
 *
 * `p` is a distribution over the case's own candidates, so its floor must be one pseudo-count SPREAD OVER them:
 * a service that has never been the answer should cost the same whether the case has fifteen candidates or fifty.
 * A constant floor would make the term's strength depend on the system's size, which is a property of the
 * deployment and not of the evidence.
 *
 * ## Why the gate exists at all, and why it reads the ENGINE's number
 *
 * The arm that measured this term was refused twice before it was gated, and both refusals had the same shape:
 * it lifted one cell and collapsed another. The difference between those cells is not their name — a deployment
 * does not know which cell it is in — it is **how far apart the engine's own first and second candidates are**.
 * Measured over 156 cases, the median `top1 − top2` is 0.5294 in one cell and 0.0102 in another: a ranking whose
 * head is separated by a hundredth has no room for an external term, and one separated by half a unit has plenty.
 *
 * So the gate is a threshold on the margin the engine already produced, read BEFORE the term is added. A gate
 * computed from the gated score would be the arm's own output deciding whether the arm runs.
 *
 * @module pruning/label-prior
 */

import type { LabelPriorProfile, ServiceId } from '@agentix-e/micro-kinetic-core';

/**
 * The shipped weight of the label-prior term — **0.1**, the arm that cleared both halves of the kill criterion.
 *
 * It shipped at 0 (the ablation) until iteration 369, because that was the only honest default while the arm was
 * unmeasured on the second half. What changed is not the size of the arm but the number of readings:
 *
 * | half | reading at this weight |
 * | --- | --- |
 * | FSE'26 panel, 1 422 cases | `Top@1` 1 186 (83.40 %) — arm A to the case, 1 gained / 1 lost, p = 1.000; `Top@3` +24 and `Top@5` +27, both p < 0.001 |
 * | nine RCAEval cells, 735 cases | `AC@1` 666 of 666, cell for cell, no fault type down; nine-cell `Avg@5` mean 92.47 % → **94.48 %** |
 *
 * Both are pinned readings, so the head claim is a construction rather than a hope: see
 * {@link DEFAULT_LABEL_PRIOR_JURISDICTION}. 0 remains reachable as the ablation, which is what every dispatch that
 * names `label_prior_weight=0` measures.
 */
export const DEFAULT_LABEL_PRIOR_WEIGHT = 0.1;

/**
 * The smallest margin at which the label prior is allowed to speak — shipped at **0**, and that is only safe
 * because the jurisdiction pins the head.
 *
 * The three constants are ONE configuration. Under `tail` the gate protects nothing — the head is not the term's
 * to move — and it costs depth: at `τ = 0.02` under the pin the panel reads `+16 / +19` instead of `+24 / +27`,
 * with 89 cases withheld and 8–11 cases of depth paid for a head that could not have moved anyway. So the gate is
 * a SUBSTITUTE for the pin, not a complement, and shipping both would ship the shallower arm.
 *
 * The asymmetry is what makes the pair defensible rather than merely convenient: `0` with `everywhere` is the
 * refused ungated arm, `0.02` with `tail` is a weaker enrolled arm, and only `0` with `tail` is the arm that was
 * measured. A change to one of the three without the others is a configuration nobody ran.
 */
export const DEFAULT_LABEL_PRIOR_MARGIN_GATE = 0;

/**
 * Turn a deployment's history into this case's log-probabilities.
 *
 * @param profile - The history: past-incident counts and how many incidents they cover.
 * @param candidates - The services this case is scoring, in the engine's own candidate order. Its length is the
 *   `V` of the floor, so the map is a distribution over exactly what the ranking can choose between.
 * @returns Every candidate's `log p`, sparse in nothing: a candidate the history never saw carries the floor.
 */
export function computeLabelPriorValues(
  profile: LabelPriorProfile,
  candidates: readonly ServiceId[],
): ReadonlyMap<ServiceId, number> {
  // `1/V` per candidate. `max(1, ...)` rather than a bare division because a case with no candidates is a case the
  // term is never asked about, and a `NaN` floor would be a number the ranking sorts by rather than a refusal.
  const floor = 1 / Math.max(1, candidates.length);
  // Laplace's denominator: the history's own size plus the one pseudo-count the floors add up to. Written from the
  // profile rather than from `counts`' sum, because the history counts services this case cannot blame — see
  // `LabelPriorProfile.labelled`.
  const denominator = profile.labelled + 1;
  const values = new Map<ServiceId, number>();
  for (const id of candidates) {
    values.set(id, Math.log(((profile.counts.get(id) ?? 0) + floor) / denominator));
  }
  return values;
}

/**
 * The gap between the best and the second-best value.
 *
 * @param scores - The values, in any order. Duplicates are not collapsed: two candidates at the same score have a
 *   margin of 0, which is the statement that the head is undecided.
 * @returns The gap, or `Infinity` when there are fewer than two values — a single candidate is not in competition
 *   with anything, so no external term can displace it and every gate should let one through.
 */
export function topTwoGap(scores: Iterable<number>): number {
  let best = Number.NEGATIVE_INFINITY;
  let second = Number.NEGATIVE_INFINITY;
  for (const score of scores) {
    if (score > best) {
      second = best;
      best = score;
    } else if (score > second) {
      second = score;
    }
  }
  return second === Number.NEGATIVE_INFINITY ? Number.POSITIVE_INFINITY : best - second;
}

/**
 * Where in a ranking the label prior is allowed to act.
 *
 * `'everywhere'` is the term as a score: it is summed with the rest and the sort decides. `'tail'` clamps the head
 * of the ranking the engine produces WITHOUT it and lets the prior reorder positions 2..n, so position 1 is not
 * this term's to move.
 *
 * ## Why this is a field rather than a weight
 *
 * The two corpora disagree about the head and agree about the depth, and no single weight reproduces both. On the
 * 156-case Cloud-OpsBench panel the term **wins** at the head — +6.41 pp on `CA@1`, 11 cases gained against 1 lost
 * — because that corpus's median `top1 − top2` is 0.0102 and a frequency is better than a coin flip there. On the
 * 1 422-case FSE'26 panel the same term loses the head at every price and gate (−2 ungated, −10 at the plateau)
 * while gaining **24 cases at `Top@3` and 24 at `Top@5` in every armed arm**. The difference is not the corpus's
 * labels, it is which position the term is asked about.
 *
 * A weight small enough to protect the head is also too small to move the tail — measured, not argued: at
 * `β = 0.05` the FSE'26 depth gain falls from +24 to +12 — so the choice is structural. `'tail'` makes the head
 * invariant BY CONSTRUCTION at any weight, which turns "the prior is safe at the head" from a tuning claim into a
 * property of the order.
 */
export type LabelPriorJurisdiction = 'everywhere' | 'tail';

/**
 * The jurisdiction vocabulary, spelled once so a parser, an artifact field and a dispatch key cannot disagree about
 * which words the engine accepts.
 */
export const LABEL_PRIOR_JURISDICTIONS: Readonly<Record<LabelPriorJurisdiction, true>> = {
  everywhere: true,
  tail: true,
};

/**
 * Whether a string names a jurisdiction the engine accepts.
 *
 * @param value - The candidate word, typically straight off a command line.
 * @returns `true` when it is a member of {@link LABEL_PRIOR_JURISDICTIONS}.
 */
export function isLabelPriorJurisdiction(value: string): value is LabelPriorJurisdiction {
  return Object.hasOwn(LABEL_PRIOR_JURISDICTIONS, value);
}

/**
 * The shipped jurisdiction: the head of the order computed with the term SILENT is clamped at position 1, and the
 * term reorders 2..n. This is the enrolled arm, and the reason it is the default is narrower than "it scored
 * better": it is the only arm whose head cost is **zero by construction**, for every weight and every corpus.
 *
 * `'everywhere'` is still reachable and still measured — it is the configuration every pre-369 published number was
 * taken with — but its record is a head that moves: `−2` cases on the panel, 20 gained against 22 lost, p = 0.878.
 * Shipping it would ship the arm the criterion refused.
 *
 * What the pin does NOT do, stated because a reader will otherwise assume it does: position 1 can still be moved by
 * a pass that runs AFTER the ranking. The containment pass moves it in 43 of 1 422 panel cases and is the whole of
 * this arm's `1/1` head residue — which is why the residue is attributed to that module and not to the term.
 */
export const DEFAULT_LABEL_PRIOR_JURISDICTION: LabelPriorJurisdiction = 'tail';

/**
 * Move one candidate to the front of an order, leaving every other position in its own relative order.
 *
 * The whole of `'tail'`'s mechanism: the pruner computes the order it would report with the term SILENT, passes
 * that order's head here, and the prior's own ordering survives everywhere below it. Because the pinned id is read
 * from the silent order rather than guessed from the scores, `Top@1` is invariant to the last comparison — not
 * approximately, and not only for small weights.
 *
 * @param order - The order the scores produced, best first.
 * @param head - The candidate to clamp first, normally the head of the order computed with the term silent.
 * @returns A new array with `head` first. A `head` the order does not contain is the identity: a pin is a
 *   preference about ORDER, not an assertion about membership, so a caller whose pool narrowed must not crash here.
 */
export function pinHeadFirst<T extends { readonly serviceId: ServiceId }>(
  order: readonly T[],
  head: ServiceId,
): T[] {
  const at = order.findIndex((row) => row.serviceId === head);
  if (at <= 0) return [...order];
  return [order[at]!, ...order.slice(0, at), ...order.slice(at + 1)];
}
