/**
 * The fourth term: does the failed-edge DIRECTION beat the blend the engine computes?
 *
 * Three families are closed (chooser it.108–109, scale it.110, composition it.111) and the baseline has been
 * corrected (it.112: the reconstruction reproduces the run exactly at `poolWeight` 0, **750** cases). What is left is
 * the only degree of freedom the blend has: **the set of terms.** 121 cases are unreachable by choosing, re-reading or
 * re-combining the three signals that exist.
 *
 * The candidate is the failed-edge direction — the one signal the record has already measured as an ENGINE SWITCH
 * (**+5.8pp on its own run**, rejected on two narrow regressions). Two things make this a different question rather
 * than a repeat:
 *
 * 1. **The baseline is the run that reproduces**, not a reconstruction 103 cases away from it. The switch's +82 was
 *    measured against a control that got 673; the engine now gets **750**, so most of that +82 may already have been
 *    collected by other repairs.
 * 2. **It is measured as a TERM**, over the whole corpus, with the split printed beside the net — the same form the
 *    other three families were held to, so the results are comparable rather than merely adjacent.
 *
 * ## Why the weights are data with a reason, not a grid
 *
 * `failedEdgeScore` is max-normalised, so a weight of 0 means "off" and 1 makes the term as strong as the log term
 * whose absence costs 241 cases. **The five weights are chosen to span that question**, not to search: off, a nudge,
 * half the log term's strength, equal to it, and double. A finer grid would be a fit on 1422 cases dressed as a
 * measurement — and the register's rule for a fitted quantity is that it needs a held-out protocol, which is the next
 * iteration's job if any of these is worth it.
 *
 * ## Law 41 applies here too
 *
 * The baseline arm is the engine's own blend, so the report prints the **agreement** for it first: a screen whose
 * zero-weight arm does not reproduce the run is measuring a baseline that is not the engine's, and every net below it
 * is measured against the wrong thing.
 *
 * @module benchmarks/fse26-fourth-term
 */

import type { DiagnosedCase } from './fse26-diagnose-analyze.js';
import {
  agreementVerdict,
  engineAgreement,
  type AgreementReport,
} from './fse26-engine-agreement.js';
import type { TermOracleOptions } from './fse26-term-oracle.js';
import { latencySlopes, rankCase } from './fse26-term-oracle.js';

/** One weight of the direction term, with the claim it makes. */
export interface DirectionArm {
  readonly weight: number;
  readonly claim: string;
}

/**
 * The five arms, each a STATEMENT rather than a grid point.
 *
 * `0` is the engine's own blend and the baseline. `1` makes the direction as strong as the log term, whose removal
 * costs 241 cases — so `1` asks "is the direction as informative as the log evidence". `2` asks the stronger question
 * and is the last point at which the answer could still be "the term should dominate"; beyond it the term stops being
 * a correction to the blend and becomes the blend.
 */
export const DIRECTION_ARMS: readonly DirectionArm[] = [
  { weight: 0, claim: 'the engine’s own blend (the baseline)' },
  { weight: 0.25, claim: 'a nudge: the direction breaks near-ties only' },
  { weight: 0.5, claim: 'half the log term’s strength' },
  { weight: 1, claim: 'as strong as the log term' },
  { weight: 2, claim: 'strong enough to dominate a moderate anomaly gap' },
  // `3` and `4` are here because the measured curve TURNS: 750, 763, 790, 810, 848, **855**, 852, 835 … 827. An arm
  // past the turning point is what distinguishes a term doing work from a gate that any direction would pass, and a
  // menu that stopped at 2 would have reported a monotone rise and left the reader unable to tell the two apart.
  { weight: 3, claim: 'past the turning point: the measured maximum' },
  { weight: 4, claim: 'and declining: 3 is a maximum, not a plateau' },
];

/** What one weight does against the baseline. */
export interface DirectionScreen {
  readonly arm: DirectionArm;
  readonly cases: number;
  /** Cases the BASELINE (weight 0) gets right. */
  readonly baselineCorrect: number;
  /** Cases this weight gets right. */
  readonly correct: number;
  readonly fixed: readonly string[];
  readonly broken: readonly string[];
}

/** The screen, with the baseline's agreement so law 41 is discharged before any net is read. */
export interface DirectionReport {
  readonly agreement: AgreementReport;
  readonly screens: readonly DirectionScreen[];
}

/**
 * Score every weight against the baseline.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration; its `failedEdgeWeight` is overridden per arm.
 * @param arms - The weights to score; defaults to {@link DIRECTION_ARMS}.
 * @returns The baseline's agreement and one screen per arm.
 */
export function directionReport(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  arms: readonly DirectionArm[] = DIRECTION_ARMS,
): DirectionReport {
  const at = (weight: number): TermOracleOptions => ({ ...opts, failedEdgeWeight: weight });
  const agreement = engineAgreement(cases, opts);
  const scored = arms.map((arm) => {
    const options = at(arm.weight);
    let counted = 0;
    let correct = 0;
    const fixed: string[] = [];
    const broken: string[] = [];
    for (const kase of cases) {
      const root = new Set(kase.groundTruth.filter((name) => name !== ''));
      if (root.size === 0) continue;
      counted++;
      // The latency term does not depend on the arm, so it is computed once: two calls would be a second
      // calculation of the same quantity, which is the defect class this record keeps finding.
      const lat = latencySlopes(kase.services, opts.latFloor);
      const hit = root.has(rankCase(kase, options, 'recorded', lat).order[0] ?? '');
      const baseHit = root.has(rankCase(kase, opts, 'recorded', lat).order[0] ?? '');
      if (hit) correct++;
      if (!baseHit && hit) fixed.push(kase.datapack);
      if (baseHit && !hit) broken.push(kase.datapack);
    }
    return { arm, cases: counted, correct, baselineCorrect: 0, fixed, broken };
  });
  // `baselineCorrect` is the weight-0 arm's own total, read back rather than recounted: the zero arm IS the engine's
  // blend, so a second traversal could disagree with it and the whole table would be off by that disagreement.
  const baseline = scored.find((screen) => screen.arm.weight === 0);
  const baselineCorrect = baseline === undefined ? 0 : baseline.correct;
  return {
    agreement,
    screens: scored.map((screen) => ({ ...screen, baselineCorrect })),
  };
}

/**
 * Render the screen.
 *
 * @param report - The report to render.
 * @returns The block, agreement first.
 */
export function formatDirectionReport(report: DirectionReport): string {
  const { agreement, screens } = report;
  const percent = agreement.cases === 0 ? 0 : (100 * agreement.agreed) / agreement.cases;
  const lines = [
    'Fourth-term screen — the failed-edge DIRECTION, against the blend the engine computes:',
    // Law 41: the baseline's provenance comes before any number measured against it.
    `  baseline agreement with the recorded run: ${agreement.agreed}/${agreement.cases} ` +
      `(${percent.toFixed(2)}%) — ${agreementVerdict(agreement)}`,
    '  weight   claim                                              right   net   fixed / broken   verdict',
  ];
  for (const screen of screens) {
    const net = screen.correct - screen.baselineCorrect;
    const verdict =
      screen.arm.weight === 0
        ? 'the baseline'
        : net > 0 && screen.broken.length === 0
          ? 'DOMINATES'
          : net > 0
            ? 'trades, cannot pass'
            : 'does not help';
    lines.push(
      `  ${String(screen.arm.weight).padEnd(9)}${screen.arm.claim.padEnd(50)}` +
        `${String(screen.correct).padStart(6)}${String(net >= 0 ? `+${net}` : net).padStart(6)}` +
        `   ${String(screen.fixed.length).padStart(6)} / ${String(screen.broken.length).padEnd(6)}` +
        `${verdict}`,
    );
  }
  lines.push(
    '  the arms are statements, not a grid: off, a nudge, half the log term, equal to it, double, and two past the ' +
      'turning point so a maximum can be told from a plateau. A weight chosen on this corpus is a FIT, so the bar is ' +
      'the same one the chooser failed: beat the baseline with ZERO losses — and a fit needs a held-out protocol ' +
      'before it may be called a candidate',
  );
  return lines.join('\n');
}
