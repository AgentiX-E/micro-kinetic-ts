/**
 * The label prior: a deployment's own incident history, as the engine receives it.
 *
 * ## Why this is a type rather than a number the engine derives
 *
 * The quantity is a frequency over ROOT CAUSES, and a root cause is a label — the one thing an online engine
 * never has. So the history cannot be derived from the case being scored; it is an artifact the caller built
 * from incidents that were already diagnosed, which is why it is an INPUT beside {@link FaultPropagationGraph}
 * rather than a statistic inside it.
 *
 * ## The two fields are both required, and the reason is a division
 *
 * `counts` alone would have to be normalised over the candidates the case happens to carry, which is a
 * different denominator for every case: a service seen 30 times is the answer a third of the time in a
 * fifteen-candidate case and a fifth of the time in a fifty-candidate case. `labelled` carries the history's
 * own size, so the probability is over the DEPLOYMENT and the case's candidate set is only the support the
 * probability is read on.
 *
 * @module types/label-prior
 */

import type { ServiceId } from './graph.js';

/**
 * A deployment's labelled-incident history, as a count over services.
 *
 * The counts are the number of PAST incidents each service was the accepted root cause of. A case being
 * scored must not contribute to them: `p` is then an estimate of how often this service is the answer
 * elsewhere, which is what makes the term usable at inference time instead of only in hindsight.
 */
export interface LabelPriorProfile {
  /**
   * Past incident count per service.
   *
   * SPARSE by nature — most services have never been the root cause, and an absent entry is a measured zero
   * rather than a missing measurement, because the history counted every incident it holds. That is the
   * opposite of the sparse maps on the graph (e.g. `selfTimeScores`), and it is why the term that reads this
   * does not use the neutral-substitution rule those use.
   */
  readonly counts: ReadonlyMap<ServiceId, number>;
  /**
   * How many labelled incidents the history holds, i.e. the sum of `counts` over ALL services — including the
   * ones this case does not carry as candidates.
   *
   * Deliberately not derived from `counts` at the point of use: a caller that pooled a system's history and
   * handed the engine only the candidates' share would be reporting a different deployment than the one it
   * counted, and the difference is exactly the services the case cannot blame.
   */
  readonly labelled: number;
}
