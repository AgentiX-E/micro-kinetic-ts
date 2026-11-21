/**
 * Does the reconstruction reproduce the run it is analysing?
 *
 * Every screen in this record — the discriminator, the term-preserving menu, the formulation arms, the composition
 * arms — measures a candidate against a reconstruction of the shipped blend, and reports that reconstruction's score
 * as "shipped". **That is a claim about the ENGINE only if the reconstruction reproduces the engine's own ranking**,
 * and nothing said so.
 *
 * Iteration 112 measured it on `artifacts/r34928980425/fse26-results.txt`:
 *
 * | configuration | rank-1 agreement with the recorded order | cases right |
 * | --- | ---: | ---: |
 * | the current engine defaults (`poolWeight` 0.0679) | **1319 / 1422 (92.76%)** | 756 |
 * | `poolWeight` 0 | **1422 / 1422 (100.00%)** | 750 |
 *
 * Two things follow, and both matter more than any single screen's result:
 *
 * 1. **The recorded dump predates part of the current configuration.** Its header line is 96 characters and carries
 *    no `poolMetricPenaltyWeight`, no `stabilityWeight`, no `temporalWeight`, no `onsetShape` — every one of which the
 *    CURRENT formatter prints unconditionally. A run that had them would have printed them. So the reconstruction is
 *    applying terms to a run that never had them, and the agreement collapses from 100% to 92.76%.
 * 2. **"Shipped gets 756" was the reconstruction's number, not the engine's.** The engine's recorded rank-1 is right
 *    on **750** cases under the same hit rule, and the six-case difference is the pool penalty's effect on a run that
 *    did not carry it.
 *
 * Neither is a reason to discard the screens: every arm was measured against the SAME reconstruction, so their
 * relative comparisons stand. It is a reason to stop calling that reconstruction "the engine", and to print the
 * agreement beside it every time — which is what this module is for.
 *
 * @module benchmarks/fse26-engine-agreement
 */

import type { DiagnosedCase } from './fse26-diagnose-analyze.js';
import type { TermOracleOptions } from './fse26-term-oracle.js';
import { latencySlopes, rankCase } from './fse26-term-oracle.js';

/** How far the reconstruction is from the run it is analysing. */
export interface AgreementReport {
  /** Cases that name at least one root, the population every screen uses. */
  readonly cases: number;
  /** Cases where the reconstruction's rank-1 IS the recorded rank-1. */
  readonly agreed: number;
  /** Cases the RECORDED rank-1 gets right; the engine's own accuracy under this hit rule. */
  readonly recordedRight: number;
  /** Cases the RECONSTRUCTION gets right. */
  readonly rebuiltRight: number;
  /**
   * Cases whose recorded rank-1 names a service the block does not list.
   *
   * Not a reconciliation failure — the dump's prediction is the engine's own output and may name a service whose row
   * was truncated — but it must be counted, because such a case can never be right for either side and silently
   * including it would make both totals look worse for a reason that has nothing to do with the blend.
   */
  readonly recordedNotListed: number;
}

/**
 * Compare the reconstruction against the dump's recorded ranking.
 *
 * The hit rule is `root.has(...)` — ANY acceptable root — because that is the rule every screen in this record uses.
 * It is deliberately NOT the published Top@1 rule (the FIRST ground-truth label, per `run-fse26.ts`), and the
 * difference matters: the published FSE'26 number and this report's are not the same metric, which is why this module
 * reports both sides' counts under ONE rule rather than quoting a percentage that could belong to either.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration being reconstructed.
 * @returns The agreement counts.
 */
export function engineAgreement(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
): AgreementReport {
  let counted = 0;
  let agreed = 0;
  let recordedRight = 0;
  let rebuiltRight = 0;
  let recordedNotListed = 0;
  for (const kase of cases) {
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    if (root.size === 0) continue;
    counted++;
    const recorded = kase.prediction[0] ?? '';
    const listed = new Set(kase.services.map((service) => service.serviceId));
    if (recorded !== '' && !listed.has(recorded)) recordedNotListed++;
    const lat = latencySlopes(kase.services, opts.latFloor);
    const rebuilt = rankCase(kase, opts, 'recorded', lat).order[0] ?? '';
    if (recorded === rebuilt) agreed++;
    if (root.has(recorded)) recordedRight++;
    if (root.has(rebuilt)) rebuiltRight++;
  }
  return { cases: counted, agreed, recordedRight, rebuiltRight, recordedNotListed };
}

/** What the agreement earns. */
export type AgreementVerdict = 'reproduces' | 'differs';

/**
 * The verdict, stated as the threshold it is rather than as a shade of grey.
 *
 * A reconstruction that agrees on every case IS the run; anything less is a different blend wearing its name, however
 * close. There is no "mostly reproduces" — a screen's baseline is either the engine's ranking or it is not, and a
 * middle category is where a six-case discrepancy goes to be forgotten.
 *
 * @param report - The agreement counts.
 * @returns `reproduces` only at total agreement.
 */
export function agreementVerdict(report: AgreementReport): AgreementVerdict {
  return report.agreed === report.cases ? 'reproduces' : 'differs';
}

/**
 * Render the agreement, for a report to print above the screens it qualifies.
 *
 * @param report - The agreement counts.
 * @param label - What configuration was reconstructed, so two runs of the same dump can be told apart.
 * @returns The report block.
 */
export function formatAgreementReport(report: AgreementReport, label: string): string {
  const verdict = agreementVerdict(report);
  const percent = report.cases === 0 ? 0 : (100 * report.agreed) / report.cases;
  const lines = [
    `Engine agreement [${label}]:`,
    `  reconstruction reproduces the recorded rank-1 on ${report.agreed}/${report.cases} cases ` +
      `(${percent.toFixed(2)}%) — ${verdict === 'reproduces' ? 'REPRODUCES' : 'DIFFERS'}`,
    `  right under the any-root rule: recorded ${report.recordedRight}, reconstruction ${report.rebuiltRight}` +
      (report.recordedNotListed === 0
        ? ''
        : `; recorded rank-1 names an unlisted service on ${report.recordedNotListed}`),
  ];
  if (verdict === 'differs') {
    lines.push(
      '  the difference is a configuration the dump does not carry: every screen below compares against the ' +
        "RECONSTRUCTION, so their relative comparisons stand and their absolute totals are not the engine's",
    );
  }
  return lines.join('\n');
}
