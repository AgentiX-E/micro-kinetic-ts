/**
 * Does ONE composition serve both populations? — the formula axis, second form.
 *
 * Iteration 110 closed the SCALE question with four numbers: replacing any term's magnitude by its within-case rank
 * costs 13 to 257 cases. **Magnitude is evidence**, so the remaining degree of freedom is not how a term is READ but
 * how the terms are COMBINED.
 *
 * ## The hypothesis
 *
 * The shipped blend ADDS its three evidence terms, so a service that is mildly unusual on all three beats a service
 * that is decisive on one. That is a claim about how evidence aggregates, and there are two standard alternatives:
 *
 * | composition | claim |
 * | --- | --- |
 * | `sum` | three weak votes outweigh one strong one: evidence is ADDITIVE |
 * | `max` | the strongest channel decides: the root is decisive SOMEWHERE, and the others do not dilute it |
 * | `lse` | a soft maximum: channels reinforce each other, but one decisive channel cannot be outvoted |
 *
 * `max` and `lse` are exactly the shapes that would explain the conflict the chooser measurement found — the
 * populations that want the log term switched OFF may be the ones where ONE channel is decisive, and switching it off
 * is a crude way to stop it diluting the others.
 *
 * ## Three properties that make this a measurement
 *
 * 1. **The terms are not re-spelled.** Every arm composes {@link ScoreTerms}, the single decomposition the shipped
 *    score is built from, so no arm can differ from another by a re-derived slope.
 * 2. **The pool penalty stays OUTSIDE the composition.** It is not evidence for a service; it is a demotion for
 *    carrying a metric that belongs to the pool. A `max` that let it inside would let a pool-dominant service escape
 *    the penalty by being large on one channel, which is precisely what the penalty exists to prevent — so all three
 *    arms add it with the same sign, after combining the evidence.
 * 3. **`sum` is an ARM, and it must reproduce the shipped total exactly.** A composition experiment whose own baseline
 *    does not reproduce the number it is compared against is measuring its own defect; the screen reports it beside
 *    the others so that a disagreement is visible rather than assumed away.
 *
 * Nothing is fitted: a composition is a formula, judged once over the whole corpus. The split is printed because a
 * net gain built out of regressions is not a candidate.
 *
 * @module benchmarks/fse26-composition
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import type { DiagnosedCase } from './fse26-diagnose-analyze.js';
import type { TermOracleOptions } from './fse26-term-oracle.js';
import { latencySlopes, rankCase, scoreTerms, type ScoreTerms } from './fse26-term-oracle.js';

/** How a score's evidence terms are combined. */
export type Composition = 'sum' | 'max' | 'lse';

/** One arm, stated as data so a report can name the one it measured. */
export interface CompositionArm {
  readonly composition: Composition;
  readonly description: string;
}

/**
 * The three arms, with the claim each makes.
 *
 * Not a grid: each is a different statement about how evidence aggregates, and a fourth entry would need a fourth
 * statement. A parameter sweep over a temperature would be a fit on 1422 cases, which this axis is closed to.
 */
export const COMPOSITION_ARMS: readonly CompositionArm[] = [
  { composition: 'sum', description: 'the shipped blend: the evidence terms add' },
  { composition: 'max', description: 'the strongest channel decides' },
  { composition: 'lse', description: 'log-sum-exp of the evidence terms, temperature 1' },
];

/**
 * A numerically stable log-sum-exp.
 *
 * The shift by the maximum is not decoration: `metric` is `log1p(selfAnomaly)` and routinely reaches 7, where
 * `exp` is 1096 and three of them are still exact — but a case with a large deviation pushes `exp` toward the
 * overflow boundary, and an `Infinity` there would make the arm's ranking depend on the platform's float handling
 * rather than on the data.
 *
 * @param values - The evidence terms, each finite.
 * @returns `log(exp(a) + exp(b) + …)`.
 */
function logSumExp(values: readonly number[]): number {
  const top = Math.max(...values);
  if (!Number.isFinite(top)) return top;
  let total = 0;
  for (const value of values) total += Math.exp(value - top);
  return top + Math.log(total);
}

/**
 * One service's score under an arm.
 *
 * @param terms - The service's decomposition.
 * @param composition - How the evidence terms are combined.
 * @returns The score, with the pool penalty applied identically in every arm.
 */
export function composedScore(terms: ScoreTerms, composition: Composition): number {
  const evidence = [terms.metric, terms.log!, terms.latency];
  const combined =
    composition === 'sum'
      ? terms.metric + terms.log! + terms.latency
      : composition === 'max'
        ? Math.max(...evidence)
        : logSumExp(evidence);
  return combined + terms.temporal - terms.pool;
}

/**
 * One case's services ordered by an arm.
 *
 * Same tie-break discipline as every other ordering here: equal scores fall back to the repository's own comparator,
 * so the result cannot depend on the order the dump happened to list the services in.
 *
 * @param kase - One parsed case.
 * @param opts - The shipped configuration.
 * @param composition - How the evidence terms are combined.
 * @returns Service ids, best first.
 */
export function compositionOrder(
  kase: DiagnosedCase,
  opts: TermOracleOptions,
  composition: Composition,
): readonly string[] {
  const lat = latencySlopes(kase.services, opts.latFloor);
  const terms = scoreTerms(kase, opts, 'recorded', lat);
  const scored: { id: string; score: number }[] = [];
  for (const service of kase.services) {
    const one = terms.get(service.serviceId);
    // A service the configuration cannot score takes no rank: it is not last, it is absent.
    if (one === undefined) continue;
    scored.push({ id: service.serviceId, score: composedScore(one, composition) });
  }
  return scored
    .sort((a, b) => b.score - a.score || compareCasePaths(a.id, b.id))
    .map((entry) => entry.id);
}

/** What one arm does against the shipped blend, over every case that names a root. */
export interface CompositionScreen {
  readonly arm: CompositionArm;
  readonly cases: number;
  /** Cases the shipped blend gets right. */
  readonly shippedCorrect: number;
  /** Cases this arm gets right. */
  readonly correct: number;
  /** Cases shipped gets wrong and this arm gets right. */
  readonly fixed: readonly string[];
  /** Cases shipped gets right and this arm gets wrong. */
  readonly broken: readonly string[];
}

/**
 * Score every arm on the same population.
 *
 * @param cases - Parsed cases.
 * @param opts - The shipped configuration.
 * @param arms - The arms to score; defaults to {@link COMPOSITION_ARMS}.
 * @returns One screen per arm, in the order the arms were given.
 */
export function compositionScreens(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  arms: readonly CompositionArm[] = COMPOSITION_ARMS,
): readonly CompositionScreen[] {
  return arms.map((arm) => {
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
      const candidate = root.has(compositionOrder(kase, opts, arm.composition)[0] ?? '');
      if (shipped) shippedCorrect++;
      if (candidate) correct++;
      if (!shipped && candidate) fixed.push(kase.datapack);
      if (shipped && !candidate) broken.push(kase.datapack);
    }
    return { arm, cases: counted, shippedCorrect, correct, fixed, broken };
  });
}

/**
 * Render the composition screens.
 *
 * The `sum` arm carries an extra statement: it IS the shipped arithmetic, so a `sum` that does not reproduce
 * `shippedCorrect` is a defect in this instrument and is labelled as one rather than reported as a fourth arm.
 *
 * @param screens - The screens to render.
 * @returns The report block.
 */
export function formatCompositionReport(screens: readonly CompositionScreen[]): string {
  const lines = [
    'Composition screen (does ONE composition serve both populations?):',
    '  arm   cases  shipped   this   net   fixed / broken   verdict',
  ];
  for (const screen of screens) {
    const net = screen.correct - screen.shippedCorrect;
    const verdict =
      screen.arm.composition === 'sum'
        ? screen.correct === screen.shippedCorrect
          ? 'coherence OK (reproduces the shipped total)'
          : 'COHERENCE FAILED — this instrument does not reproduce the shipped total'
        : net > 0 && screen.broken.length === 0
          ? 'DOMINATES'
          : net > 0
            ? 'trades, cannot pass'
            : 'does not help';
    lines.push(
      `  ${screen.arm.composition.padEnd(5)}${String(screen.cases).padStart(6)}` +
        `${String(screen.shippedCorrect).padStart(9)}${String(screen.correct).padStart(7)}` +
        `${String(net >= 0 ? `+${net}` : net).padStart(6)}` +
        `   ${String(screen.fixed.length).padStart(6)} / ${String(screen.broken.length).padEnd(6)}` +
        `${verdict}`,
    );
  }
  lines.push(
    '  the terms are the shipped decomposition, combined differently; the pool penalty is applied identically in ' +
      'every arm because it is a demotion, not evidence; nothing is fitted, so nothing is held out',
  );
  return lines.join('\n');
}
