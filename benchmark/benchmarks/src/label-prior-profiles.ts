/**
 * Build the per-case label prior every corpus needs before the engine can score it.
 *
 * ## Why the construction lives outside the runners
 *
 * Three runners score three corpora, and the arm this prices was measured over a fourth surface (an offline
 * re-pricing of dumped search traces). A prior rebuilt in each runner would be four implementations of one
 * distribution, and the first thing that breaks when a second implementation exists is agreement between them:
 * the engine's reading would then differ from the arm's for reasons that are arithmetic rather than empirical.
 * So the construction is here, once, with the two decisions it has to make stated.
 *
 * ## The two decisions
 *
 * **A case never counts itself.** `p` is an estimate of "how often is this service the answer ELSEWHERE", which is
 * the quantity a deployment has at inference time. A pool that included the case being scored would make the prior
 * a function of the answer, and the reading would be hindsight rather than history.
 *
 * **A multi-label case counts once, against its primary label.** A network fault injected on an edge has two
 * accepted answers, and counting the case once per accepted service would make the history's size larger than the
 * number of incidents it holds — which is the denominator `p` divides by. The primary label is the corpus's own
 * (`serviceId` is documented to be the first member of `serviceIds`), so this is a choice the corpus made rather
 * than one this module invents. It is the same rule the arm used, which is what makes the engine's reading
 * comparable with the arm's.
 *
 * @module benchmarks/label-prior-profiles
 */

import type { LabelPriorProfile } from '../../packages/core/src/index.js';

/** One case's contribution to the history: where it happened, and what the answer was. */
export interface LabelledCase {
  /** The benchmark case's id, as the runner keys its predictions. */
  readonly caseId: string;
  /**
   * The DEPLOYMENT the case belongs to — the pool its prior is estimated over.
   *
   * A system rather than a cell, because a cell is `system × category` and the category is what the ranking is
   * being asked for. Pooling by cell would make the prior's denominator a function of the label it is predicting,
   * which is the one split this term may not use even though it measures better (`docs/closed-axes-register.md`
   * §366: the cell scope is the ceiling at 0.5833 and is not deployable).
   */
  readonly system: string;
  /** The accepted answers, in the corpus's order. The first one is the case's contribution. */
  readonly accepted: readonly string[];
}

/**
 * One system's history: its counts and how many incidents they cover.
 *
 * Exported because the RCAEval runner pools a system whose cases it has NOT loaded yet (its loader holds one
 * slice of one cell at a time), so it builds the histories from the corpus's case directories and reads them per
 * case. A caller that only knows its cases can use {@link buildSystemLabelPrior} and ignore this shape.
 */
export interface SystemHistory {
  /** Incidents per service, over the whole system. */
  readonly counts: ReadonlyMap<string, number>;
  /** Incidents the whole system holds — the denominator a case's prior divides by, before its own is removed. */
  readonly labelled: number;
}

/**
 * Count every system's labelled incidents.
 *
 * @param cases - The population, in the runner's own order.
 * @returns System name → its history. A case with no accepted answer is skipped rather than counted as a zero: it
 *   is not an incident anyone diagnosed, and a zero would shrink every probability toward a uniform nobody measured.
 */
export function buildSystemHistories(
  cases: readonly LabelledCase[],
): ReadonlyMap<string, SystemHistory> {
  const bySystem = new Map<string, { counts: Map<string, number>; labelled: number }>();
  for (const one of cases) {
    const truth = one.accepted[0];
    if (truth === undefined) continue;
    let bucket = bySystem.get(one.system);
    if (bucket === undefined) {
      bucket = { counts: new Map(), labelled: 0 };
      bySystem.set(one.system, bucket);
    }
    bucket.counts.set(truth, (bucket.counts.get(truth) ?? 0) + 1);
    bucket.labelled += 1;
  }
  return bySystem;
}

/**
 * One case's prior: its system's history with its OWN incident subtracted.
 *
 * @param histories - The per-system counts, as {@link buildSystemHistories} returns them.
 * @param system - The deployment the case belongs to.
 * @param truth - The case's own accepted answer, or `undefined` when the corpus labels it with nothing.
 * @returns The profile the engine reads. A system the histories do not hold yields an empty history rather than a
 *   throw: a corpus can carry a system whose only case is the one being scored.
 */
export function priorExcludingTruth(
  histories: ReadonlyMap<string, SystemHistory>,
  system: string,
  truth: string | undefined,
): LabelPriorProfile {
  const bucket = histories.get(system);
  if (bucket === undefined) return { counts: new Map(), labelled: 0 };
  if (truth === undefined) return bucket;
  const counts = new Map(bucket.counts);
  const seen = counts.get(truth) ?? 0;
  // The subtraction is what makes the prior a HISTORY: the case being scored is the one incident the deployment had
  // not diagnosed yet. Deleting the entry at zero rather than storing it keeps the map meaning "was the answer
  // somewhere else", which is the only thing the engine reads.
  if (seen <= 1) counts.delete(truth);
  else counts.set(truth, seen - 1);
  return { counts, labelled: bucket.labelled - 1 };
}

/**
 * Estimate every case's prior from the other cases of its own system.
 *
 * @param cases - The population, in the runner's own order.
 * @returns Case id → the profile the engine reads for that case. Every case in `cases` carries an entry, so a
 *   caller never has to fall back — the fallback that would silently score a case with "no history".
 */
export function buildSystemLabelPrior(
  cases: readonly LabelledCase[],
): ReadonlyMap<string, LabelPriorProfile> {
  // The system's counts are built ONCE and the case's own contribution is subtracted per case, rather than
  // rebuilding the map per case: the difference is `O(n)` instead of `O(n²)` on a corpus whose largest system
  // holds hundreds of cases, and the two are the same arithmetic because a count is an integer.
  const histories = buildSystemHistories(cases);
  const out = new Map<string, LabelPriorProfile>();
  for (const one of cases) {
    out.set(one.caseId, priorExcludingTruth(histories, one.system, one.accepted[0]));
  }
  return out;
}

/**
 * Attach each case's prior to a suite, leaving every other field untouched.
 *
 * A transform rather than a mutation: the suite is what the runner scored before this arm existed, and a function
 * that returned the same object would make "the cases carry a prior" and "the cases are the ones the loader built"
 * indistinguishable to a caller holding a reference.
 *
 * @param cases - The suite's cases.
 * @param priors - Case id → profile, as {@link buildSystemLabelPrior} returns it.
 * @returns The cases, each carrying its own profile when the map holds one.
 */
export function withLabelPrior<C extends { readonly id: string }>(
  cases: readonly C[],
  priors: ReadonlyMap<string, LabelPriorProfile>,
): readonly (C & { readonly labelPrior?: LabelPriorProfile })[] {
  return cases.map((one) => {
    const prior = priors.get(one.id);
    return prior === undefined ? one : { ...one, labelPrior: prior };
  });
}
