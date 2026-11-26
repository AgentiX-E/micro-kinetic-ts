/**
 * The margin-gated label prior — the first arm on this corpus that separates a cell it helps from a cell it breaks.
 *
 * ## What this prices, and why it needed the margin to price it
 *
 * Four arms have now been refused on this corpus for the same shape: neighbour propagation (§363), the alert window
 * (§362), the dual-family gate's high end and the raw label prior all lift one cell and charge another. The prior is
 * the sharpest case: ranking a case's candidates by how often each is the labelled root cause ELSEWHERE in the same
 * system — a deployment's own incident history, which is available at inference time and contains nothing about the
 * case being scored — moves `boutique/codedefect` from 0.3636 to **0.5227** at weight 0.05 while collapsing
 * `trainticket/performance` from 0.6596 to 0.2766.
 *
 * The reason is measurable and it is not about the prior: **the engine's own top-1 margin differs by a factor of
 * fifty between those cells.** Measured on the 156 cases, the gap between the first and second candidate is
 *
 * | cell | median `top1 − top2` | cases with a gap below 0.05 |
 * | --- | ---: | ---: |
 * | `boutique/performance` | 0.5294 | 4.8 % |
 * | `boutique/codedefect` | 0.1376 | 29.5 % |
 * | `trainticket/performance` | **0.0102** | **74.5 %** |
 *
 * A ranking whose head is separated by 0.01 has no room for an external term and a ranking separated by 0.5 has
 * plenty. So the gate is not the cell's name — which a deployment does not know — but the engine's OWN margin, which
 * it always knows. That is what this module prices: apply the prior only where the ranking says it has room.
 *
 * ## The two things this module refuses to do
 *
 * It does not use the case's own label. Every prior is leave-one-out over the pool, so the case being scored
 * contributes nothing to its own distribution — the difference between a transductive estimate over an incident
 * history and a leak.
 *
 * It does not smooth by a constant it invented. The Laplace term is `1/V` with `V` the case's own candidate count, so a
 * pool of 51 candidates does not treat a never-seen service as more likely than a pool of 15 would: the prior is a
 * probability over THIS case's candidates, and its floor is one pseudo-count spread across them.
 *
 * @module benchmarks/margin-gated-prior
 */

import type { FlagCase, RepriceArm } from './dual-family-membership.js';

/** The pool a prior is estimated over. */
export type PriorScope = 'system' | 'cell';

/** One arm's configuration. */
export interface PriorOptions {
  /** How much a unit of `log p` is worth in the engine's own score units. */
  readonly beta: number;
  /** The smallest top-1 margin at which the prior is allowed to speak at all. */
  readonly tau: number;
  /** Which pool the prior is estimated over. */
  readonly scope: PriorScope;
}

/**
 * The gap between a ranking's first and second candidate.
 *
 * @param order - The ranking, best first.
 * @returns The margin, or `Infinity` for a ranking with fewer than two candidates — a single candidate is not in
 *   competition with anything, so no external term can displace it and every gate should let one through.
 */
export function topMargin(order: FlagCase['order']): number {
  if (order.length < 2) return Number.POSITIVE_INFINITY;
  return order[0]!.score - order[1]!.score;
}

/**
 * The system a cell belongs to, as `<system>/<category>` spells it.
 *
 * A cell with no separator is returned whole rather than treated as an error: `scope: 'system'` is also what a caller
 * uses when it has no categories, and a throw there would make the deployable scope unusable on exactly the corpora
 * that need no pooling.
 *
 * @param cell - The cell name.
 * @returns The part before the first separator, or the whole string.
 */
function systemOf(cell: string): string {
  const slash = cell.indexOf('/');
  return slash < 0 ? cell : cell.slice(0, slash);
}

/**
 * Which cases one case may learn from.
 *
 * @param one - The case.
 * @param all - The population.
 * @param scope - `system` pools every case of the same system, `cell` only the same system AND category.
 * @returns The pool, excluding `one` itself.
 */
function poolOf(one: FlagCase, all: readonly FlagCase[], scope: PriorScope): readonly FlagCase[] {
  return all.filter((other) => {
    if (other.caseId === one.caseId) return false;
    if (scope === 'cell') return other.cell === one.cell;
    return systemOf(other.cell) === systemOf(one.cell);
  });
}

/**
 * Estimate, for every case, a probability over ITS OWN candidates from the labels of the other cases in the pool.
 *
 * @param cases - The population.
 * @param scope - Which pool each case learns from.
 * @returns Case id → (service id → probability). Every candidate of a case carries an entry, and the entries of one
 *   case sum to 1.
 */
export function labelPrior(
  cases: readonly FlagCase[],
  scope: PriorScope,
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const out = new Map<string, ReadonlyMap<string, number>>();
  for (const one of cases) {
    const counts = new Map<string, number>();
    let labelled = 0;
    for (const other of poolOf(one, cases, scope)) {
      const truth = other.accepted[0];
      // A case with no accepted label says nothing about frequency, and counting it would shrink every probability
      // toward a uniform it did not measure.
      if (truth === undefined) continue;
      labelled += 1;
      counts.set(truth, (counts.get(truth) ?? 0) + 1);
    }
    // `1/V` per candidate rather than `1`: the prior is a distribution over THIS case's pool, and a service that has
    // never been the answer should cost the same pseudo-count whether the pool holds 15 candidates or 51.
    const floor = 1 / Math.max(1, one.order.length);
    const probabilities = new Map<string, number>();
    const denominator = labelled + 1;
    for (const candidate of one.order) {
      probabilities.set(
        candidate.serviceId,
        ((counts.get(candidate.serviceId) ?? 0) + floor) / denominator,
      );
    }
    out.set(one.caseId, probabilities);
  }
  return out;
}

/**
 * Re-rank every case with the prior added at `beta × log p`, but only where the margin clears `tau`.
 *
 * @param cases - The population.
 * @param options - The arm.
 * @returns The arm's score, its cells and its per-case verdicts, in the population's own order.
 */
export function gatedPriorArm(cases: readonly FlagCase[], options: PriorOptions): RepriceArm {
  const priors = labelPrior(cases, options.scope);
  const cells = new Map<string, [number, number]>();
  const correct: boolean[] = [];
  for (const one of cases) {
    // The engine's own margin, read BEFORE the prior is added: a gate computed from the gated score would be the
    // arm's own output deciding whether the arm runs.
    const speaks = topMargin(one.order) >= options.tau;
    // `labelPrior` builds an entry for EVERY case it is handed, from the same list this loop walks, so the lookup
    // cannot miss. A `??` fallback here would be a branch no input reaches — and one that would silently score a
    // candidate at `p = 1` if it ever did.
    const probabilities = priors.get(one.caseId)!;
    const rescored = one.order.map((candidate, index) => {
      const probability = probabilities.get(candidate.serviceId)!;
      return {
        serviceId: candidate.serviceId,
        score: candidate.score + (speaks ? options.beta * Math.log(probability) : 0),
        index,
      };
    });
    // Stable in the engine's own order, the rule every reprice here follows: a tie broken by service id would report
    // a movement that is the comparator's.
    rescored.sort((a, b) => b.score - a.score || a.index - b.index);
    const head = rescored[0];
    const ok = head !== undefined && one.accepted.includes(head.serviceId);
    correct.push(ok);
    const cur = cells.get(one.cell) ?? [0, 0];
    cur[0] += ok ? 1 : 0;
    cur[1] += 1;
    cells.set(one.cell, cur);
  }
  return {
    weight: options.beta,
    overall: cases.length === 0 ? Number.NaN : correct.filter(Boolean).length / cases.length,
    cells: new Map([...cells].map(([key, [hit, total]]) => [key, hit / total])),
    correct,
  };
}

/**
 * The grid the runner prints, in one place so two runs cannot disagree about which arms were priced.
 *
 * Registered as a CONSTANT rather than built at the call site: the list below is the claim "these arms were measured",
 * and a list assembled inline in a runner is a claim nothing can hold it to.
 */
export const PRIOR_ARMS: readonly PriorOptions[] = [
  { beta: 0, tau: 0, scope: 'system' },
  { beta: 0.05, tau: 0, scope: 'system' },
  { beta: 0.1, tau: 0, scope: 'system' },
  { beta: 0.2, tau: 0, scope: 'system' },
  { beta: 0.05, tau: 0.02, scope: 'system' },
  { beta: 0.1, tau: 0.02, scope: 'system' },
  { beta: 0.1, tau: 0.05, scope: 'system' },
  { beta: 0.2, tau: 0.05, scope: 'system' },
  { beta: 0.1, tau: 0.1, scope: 'system' },
  { beta: 0.1, tau: 0.02, scope: 'cell' },
  { beta: 0.1, tau: 0.05, scope: 'cell' },
  { beta: 0.2, tau: 0.05, scope: 'cell' },
];
