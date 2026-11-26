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
 * The shipped weight of the label-prior term — **0**, i.e. the term is in the formula and spends nothing.
 *
 * Not a placeholder: 0 is the ABLATION, and it is the only honest default until the arm has cleared both halves
 * of the kill criterion (the nine RCAEval cells and the FSE'26 panel). At 0 the profile is not read, so the
 * shipped ranking is bit-identical to the engine that had no such term — the rule every weight here follows.
 */
export const DEFAULT_LABEL_PRIOR_WEIGHT = 0;

/**
 * The smallest margin at which the label prior is allowed to speak, shipped at the value that was MEASURED.
 *
 * Inert while {@link DEFAULT_LABEL_PRIOR_WEIGHT} is 0, and it is stated as the measured pair anyway because a
 * weight and its gate are one configuration: `0.02` is the threshold the arm was priced at (`β = 0.1`), and a
 * default of 0 would describe an arm nobody ran — "speak everywhere" is the ungated reading that was refused.
 */
export const DEFAULT_LABEL_PRIOR_MARGIN_GATE = 0.02;

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
