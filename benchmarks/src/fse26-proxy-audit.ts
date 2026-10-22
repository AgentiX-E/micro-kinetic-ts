/**
 * Can the fault CLASS be recovered from observables? The audit that decides whether the class gate can ship.
 *
 * Iterations 16 and 17 gated the failed-edge direction term on `classifyFaultType(case.faultType)` and measured
 * **819 (+69) with zero regressed types**. That number is correct and it is **not deployable**: `faultType` arrives in
 * the dump's `DIAG` header as the INJECTED LABEL, and the engine never sees it. A gate keyed on the answer is an oracle.
 *
 * So the shippable question is not "which classes" but **"is the class recoverable from evidence"**, and it has a
 * measurable answer: compare each candidate proxy against the BASE RATE. A proxy whose precision does not beat "admit
 * every case" carries no information about the class, however plausible its mechanism sounds.
 *
 * Measured on the FSE'26 dump, both proxies score BELOW the base rate — the class is not recoverable from the counts
 * this corpus retains, which makes the +69 an upper bound on what a class-aware gate COULD contribute rather than a
 * gain the engine can collect.
 *
 * @module benchmarks/fse26-proxy-audit
 */

import type { DiagnosedCase } from './fse26-diagnose-analyze.js';
import type { AgreementReport } from './fse26-engine-agreement.js';
import { agreementVerdict } from './fse26-engine-agreement.js';
import { classifyFaultType, type FaultClass } from './fse26-fourth-term.js';

/** One case's observable statistics, all computable without the label. */
export interface ProxyRow {
  readonly datapack: string;
  /** The LABEL — present only because this is an audit. Never available at inference. */
  readonly target: FaultClass;
  /** Failed calls the dump retained for the whole case. */
  readonly records: number;
  /** Share of the case's exceptions that are HTTP-level rather than logic-level. */
  readonly httpShare: number;
}

/**
 * Build the audit rows from parsed cases.
 *
 * @param cases - Parsed cases.
 * @returns One row per case that names a root.
 */
export function proxyRows(cases: readonly DiagnosedCase[]): readonly ProxyRow[] {
  const rows: ProxyRow[] = [];
  for (const kase of cases) {
    if (kase.groundTruth.filter((name) => name !== '').length === 0) continue;
    let records = 0;
    let http = 0;
    let logic = 0;
    for (const service of kase.services) {
      records += service.failedEdgeRecords ?? 0;
      http += service.httpExceptionCount ?? 0;
      logic += service.logicExceptionCount ?? 0;
    }
    rows.push({
      datapack: kase.datapack,
      target: classifyFaultType(kase.faultType),
      records,
      httpShare: http + logic === 0 ? 0 : http / (http + logic),
    });
  }
  return rows;
}

/** One proxy's verdict against the base rate. */
export interface ProxyVerdict {
  readonly proxy: string;
  readonly admitted: number;
  readonly precision: number;
  readonly recall: number;
  readonly baseRate: number;
  /** Precision must exceed the base rate: admitting every case is the bar a proxy has to clear to be informative. */
  readonly informative: boolean;
}

/**
 * Score one proxy rule against a target class.
 *
 * @param rows - The audit rows.
 * @param target - The class the proxy is trying to identify.
 * @param proxy - Its name, for the report.
 * @param admits - The rule, computed from observables only.
 * @returns Its verdict, with the base rate beside it.
 */
export function scoreProxy(
  rows: readonly ProxyRow[],
  target: FaultClass,
  proxy: string,
  admits: (row: ProxyRow) => boolean,
): ProxyVerdict {
  const positives = rows.filter((row) => row.target === target).length;
  let truePositives = 0;
  let admitted = 0;
  for (const row of rows) {
    if (!admits(row)) continue;
    admitted++;
    if (row.target === target) truePositives++;
  }
  const precision = admitted === 0 ? 0 : truePositives / admitted;
  const recall = positives === 0 ? 0 : truePositives / positives;
  const baseRate = rows.length === 0 ? 0 : positives / rows.length;
  return { proxy, admitted, precision, recall, baseRate, informative: admitted > 0 && precision > baseRate };
}

/** The audit's answer. */
export interface ProxyAudit {
  readonly verdicts: readonly ProxyVerdict[];
  /** True when at least one proxy beats the base rate — the precondition for a deployable class gate. */
  readonly anyInformative: boolean;
}

/**
 * Audit the two proxies this corpus supports: the count of retained failed calls, and the exception-kind share.
 *
 * **Two independent statistics, one conclusion.** The record counts have the same distribution in every class (`q50`
 * of 1–3 across all six), and the exception-kind share is ~1.00 everywhere because every injected fault surfaces as an
 * HTTP-level error — so both score BELOW the base rate, which is the audit's way of saying "this proxy is worse than
 * admitting everything".
 *
 * @param rows - The audit rows.
 * @param target - The class to recover; `network` by default, since that is the class the gate needs.
 * @returns The verdicts and whether any proxy is informative.
 */
export function proxyAudit(rows: readonly ProxyRow[], target: FaultClass = 'network'): ProxyAudit {
  const verdicts = [
    scoreProxy(rows, target, 'failedEdgeRecords >= 1', (row) => row.records >= 1),
    scoreProxy(rows, target, 'failedEdgeRecords >= 5', (row) => row.records >= 5),
    scoreProxy(rows, target, 'http share >= 0.9', (row) => row.httpShare >= 0.9),
  ];
  return { verdicts, anyInformative: verdicts.some((verdict) => verdict.informative) };
}

/**
 * Render the audit.
 *
 * @param audit - The audit to render.
 * @param agreement - The baseline's agreement with the recorded run (law 41).
 * @returns The block, agreement first and the verdict last.
 */
export function formatProxyAudit(audit: ProxyAudit, agreement: AgreementReport): string {
  const percent = agreement.cases === 0 ? 0 : (100 * agreement.agreed) / agreement.cases;
  const baseRate = audit.verdicts[0]?.baseRate ?? 0;
  const lines = [
    'Class-proxy audit — can the fault class be recovered WITHOUT the label?',
    `  baseline agreement with the recorded run: ${agreement.agreed}/${agreement.cases} ` +
      `(${percent.toFixed(2)}%) — ${agreementVerdict(agreement)}`,
    `  admitting every case would score ${(100 * baseRate).toFixed(1)}% precision on the target class — the bar to clear`,
    '  proxy                        admitted   precision   recall   beats the bar',
  ];
  for (const verdict of audit.verdicts) {
    lines.push(
      `  ${verdict.proxy.padEnd(28)}${String(verdict.admitted).padStart(7)}` +
        `${`${(100 * verdict.precision).toFixed(1)}%`.padStart(12)}` +
        `${`${(100 * verdict.recall).toFixed(1)}%`.padStart(9)}` +
        `${(verdict.informative ? 'YES' : 'NO').padStart(15)}`,
    );
  }
  lines.push(
    audit.anyInformative
      ? '  verdict: a proxy clears the bar — a class gate is DEPLOYABLE through it'
      : '  verdict: NO proxy clears the bar — the class gate is an ORACLE, and the +69 it measures can NOT ship',
  );
  return lines.join('\n');
}
