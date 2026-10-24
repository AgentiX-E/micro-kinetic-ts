/**
 * Which SCALE does each term have to be read on, for ONE blend to serve both populations?
 *
 * The discriminator verdict closed the chooser question with a measurement (iteration 109): every
 * term-preserving reweighting is net negative out of sample, and the term-preserving menu's ceiling is 802
 * against the four-point menu's 878. **The 122-case headroom is reachable only by removing a term**, so the
 * conflict is not a decision problem — the two populations do not want different configurations of the same
 * blend, they want different BLENDS.
 *
 * This module tests the cheapest form of that hypothesis, and it is a FORMULATION change rather than a chooser:
 * **the same terms, the same weights, one ranking rule, applied to every case, fitting nothing.**
 *
 * ## The forms, and why these four
 *
 * "The two populations want different weights" is a statement about MAGNITUDE. A term's raw value has a
 * corpus-dependent spread — a log score of 3 is decisive in one case and unremarkable in another, and a latency
 * slope's scale varies by system — so a fixed weight is a compromise between two scales rather than a statement
 * about either. A term's ORDER within its own case carries no such scale: it says which service the term prefers,
 * which is the only thing the term can be evidence about.
 *
 * But the BASE term is different in kind: `log1p(selfAnomaly)` is the case's own deviation, and `log1p` already
 * tames its growth, so its magnitude may well be the evidence rather than an artefact of scale. The four forms
 * are therefore chosen to separate those two claims, not to search:
 *
 * | form | base | log | latency |
 * | --- | --- | --- | --- |
 * | `all ranks` | rank | rank | rank |
 * | `base magnitude` | **magnitude** | rank | rank |
 * | `log rank only` | magnitude | **rank** | magnitude |
 * | `latency rank only` | magnitude | magnitude | **rank** |
 *
 * Every form keeps every term and every weight. `all ranks` is the pure hypothesis; `base magnitude` is the
 * refinement that the first measurement (net −257) demands; the last two isolate which of the two
 * corpus-scaled terms carries the conflict.
 *
 * ## What would make one a candidate, and what would not
 *
 * A formula is judged once, on all cases — there is no fold structure to hold out, because nothing is fitted. The
 * screen reports what decides it: the shipped total, this form's total, and the split (`fixed` / `broken`).
 * **A net gain that trades is not a candidate**, for the same reason a net-positive chooser was not one: the
 * criterion's second half is zero regressed fault types.
 *
 * @module benchmarks/fse26-formulation
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import type { DiagnosedCase } from './fse26-diagnose-analyze.js';
import type { TermOracleOptions } from './fse26-term-oracle.js';
import { latencySlopes, rankCase } from './fse26-term-oracle.js';

/**
 * Midrank percentile of every member, over the members that are MEASURED.
 *
 * Three properties, each of which a naive `indexOf`-style rank gets wrong:
 *
 * - **Ties share a percentile.** Ten services with the same value are not ordered by their position in the array;
 *   a rank that broke them apart would make the score depend on input order, which is the defect the
 *   discriminator's own docblock records (`predictedIsTop` moved 1 → 0 when the rows were reversed).
 * - **An unmeasured member is `undefined`, not zero.** `0` would put it BELOW every measured member, i.e. assert
 *   that the term ranked it last; `undefined` lets the caller treat it as "this term says nothing".
 * - **The ends are the ends.** A single measured value is the whole population and takes `1`; with two, the lower
 *   is `0` and the higher `1`.
 *
 * @param values - One value per member, `undefined` where unmeasured.
 * @returns One percentile per member, `undefined` where the input was.
 */
export function midrankPercentiles(
  values: readonly (number | undefined)[],
): readonly (number | undefined)[] {
  const measured = values
    .map((value, index) => ({ value, index }))
    .filter(
      (entry): entry is { value: number; index: number } =>
        entry.value !== undefined && Number.isFinite(entry.value),
    );
  const sorted = [...measured].sort((a, b) => a.value - b.value || a.index - b.index);
  const out: (number | undefined)[] = values.map(() => undefined);
  let start = 0;
  while (start < sorted.length) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1]!.value === sorted[start]!.value) end++;
    const midrank = (start + end) / 2;
    const percentile = sorted.length === 1 ? 1 : midrank / (sorted.length - 1);
    for (let k = start; k <= end; k++) out[sorted[k]!.index] = percentile;
    start = end + 1;
  }
  return out;
}

/** Which scale each term is read on. */
export interface FormulationForm {
  readonly name: string;
  /** Read the base deviation by within-case rank instead of `log1p(magnitude)`. */
  readonly rankAnomaly: boolean;
  /** Read the log score by within-case rank instead of its credited value. */
  readonly rankLog: boolean;
  /** Read the latency term by within-case rank instead of the slope. */
  readonly rankLatency: boolean;
}

/**
 * The four forms, stated as DATA so a report can name the one it measured.
 *
 * Not a search grid: each entry answers a different question, and the table in this module's docblock is the
 * reason for each. A fifth "try another combination" would be a fit, and this axis is closed to fits.
 */
export const FORMULATION_FORMS: readonly FormulationForm[] = [
  { name: 'all ranks', rankAnomaly: true, rankLog: true, rankLatency: true },
  { name: 'base magnitude', rankAnomaly: false, rankLog: true, rankLatency: true },
  { name: 'log rank only', rankAnomaly: false, rankLog: true, rankLatency: false },
  { name: 'latency rank only', rankAnomaly: false, rankLog: false, rankLatency: true },
];

/**
 * One case's services ordered by a formulation.
 *
 * The weights are the shipped ones and they keep their meaning as RELATIVE IMPORTANCE where the inputs share a
 * scale. A term that cannot measure a service contributes nothing to it, which is what the shipped blend does
 * with a missing term too.
 *
 * The comparator states an ORDER, not just a difference: equal scores fall back to the service id, so the result
 * cannot depend on the order the dump happened to list the services in.
 *
 * @param kase - One parsed case.
 * @param opts - The shipped weights (only `logWeight`, `latWeight` and `latFloor` are read).
 * @param form - Which scale each term is read on.
 * @returns Service ids, best first.
 */
export function formulationOrder(
  kase: Pick<DiagnosedCase, 'services'>,
  opts: Pick<TermOracleOptions, 'logWeight' | 'latWeight' | 'latFloor'>,
  form: FormulationForm,
): readonly string[] {
  const lat = latencySlopes(kase.services, opts.latFloor);
  const anomalyRank = form.rankAnomaly
    ? midrankPercentiles(kase.services.map((service) => service.selfAnomaly))
    : undefined;
  const logRank = form.rankLog
    ? midrankPercentiles(kase.services.map((service) => service.logScore))
    : undefined;
  const latRank = form.rankLatency
    ? midrankPercentiles(kase.services.map((service) => lat.get(service.serviceId)))
    : undefined;
  const scored = kase.services.map((service, index) => {
    const base = form.rankAnomaly
      ? (anomalyRank![index] ?? 0)
      : Math.log1p(Math.max(service.selfAnomaly ?? 0, 0));
    const log = form.rankLog ? (logRank![index] ?? 0) : (service.logScore ?? 0);
    const latency = form.rankLatency ? (latRank![index] ?? 0) : (lat.get(service.serviceId) ?? 0);
    return {
      id: service.serviceId,
      score: base + opts.logWeight * log + opts.latWeight * latency,
    };
  });
  return scored
    .sort((a, b) => b.score - a.score || compareCasePaths(a.id, b.id))
    .map((entry) => entry.id);
}

/** What one formulation does against the shipped blend, over every case that names a root. */
export interface FormulationScreen {
  readonly form: FormulationForm;
  readonly cases: number;
  /** Cases the shipped blend gets right. */
  readonly shippedCorrect: number;
  /** Cases this formulation gets right. */
  readonly correct: number;
  /** Cases shipped gets wrong and this formulation gets right. */
  readonly fixed: readonly string[];
  /** Cases shipped gets right and this formulation gets wrong. */
  readonly broken: readonly string[];
}

/**
 * Score every form on the same population.
 *
 * Nothing is fitted and nothing is held out, because nothing is learned: a formula is judged by what it does to
 * the whole corpus. The split is reported because it is what decides the criterion's second half — a net gain
 * built out of regressions is not a candidate.
 *
 * @param cases - Parsed cases.
 * @param opts - The shipped configuration.
 * @param forms - The forms to score; defaults to {@link FORMULATION_FORMS}.
 * @returns One screen per form.
 */
export function formulationScreens(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  forms: readonly FormulationForm[] = FORMULATION_FORMS,
): readonly FormulationScreen[] {
  return forms.map((form) => {
    let counted = 0;
    let shippedCorrect = 0;
    let correct = 0;
    const fixed: string[] = [];
    const broken: string[] = [];
    for (const kase of cases) {
      const root = new Set(kase.groundTruth.filter((name) => name !== ''));
      if (root.size === 0) continue;
      counted++;
      const lat = latencySlopes(kase.services, opts.latFloor);
      const shipped = root.has(rankCase(kase, opts, 'recorded', lat).order[0] ?? '');
      const candidate = root.has(formulationOrder(kase, opts, form)[0] ?? '');
      if (shipped) shippedCorrect++;
      if (candidate) correct++;
      if (!shipped && candidate) fixed.push(kase.datapack);
      if (shipped && !candidate) broken.push(kase.datapack);
    }
    return { form, cases: counted, shippedCorrect, correct, fixed, broken };
  });
}

/**
 * Render the formulation screens.
 *
 * The verdict line is stated in the terms the criterion is written in, and it refuses to call a net gain a
 * candidate: `fixed` and `broken` are printed as a split precisely so that a reader cannot see a `+Z` without also
 * seeing what paid for it.
 *
 * @param screens - The screens to render.
 * @returns The report block.
 */
export function formatFormulationReport(screens: readonly FormulationScreen[]): string {
  const lines = [
    'Formulation screen (which SCALE does each term have to be read on, for ONE blend to serve both populations?):',
    '  form                cases  shipped   this   net   fixed / broken   verdict',
  ];
  for (const screen of screens) {
    const net = screen.correct - screen.shippedCorrect;
    const verdict =
      net > 0 && screen.broken.length === 0
        ? 'DOMINATES'
        : net > 0
          ? 'trades, cannot pass'
          : 'does not help';
    lines.push(
      `  ${screen.form.name.padEnd(18)}${String(screen.cases).padStart(5)}` +
        `${String(screen.shippedCorrect).padStart(9)}${String(screen.correct).padStart(7)}` +
        `${String(net >= 0 ? `+${net}` : net).padStart(6)}` +
        `${`${String(screen.fixed.length).padStart(6)} / ${String(screen.broken.length).padEnd(6)}`}` +
        `     ${verdict}`,
    );
  }
  lines.push(
    '  a formula is judged ONCE over the whole corpus (nothing is fitted, so there is no fold to hold out); ' +
      'a net gain that trades is not a candidate, because the criterion is zero regressed types',
  );
  return lines.join('\n');
}
