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
import type { TermOracleOptions } from './fse26-term-oracle.js';
import { latencySlopes, rankCase } from './fse26-term-oracle.js';

/** One case's observable statistics, all computable without the label. */
export interface ProxyRow {
  readonly datapack: string;
  /** The LABEL — present only because this is an audit. Never available at inference. */
  readonly target: FaultClass;
  /** Failed calls the dump retained for the whole case. */
  readonly records: number;
  /** Share of the case's exceptions that are HTTP-level rather than logic-level. */
  readonly httpShare: number;
  /** Whether the engine's RANK-1 service carries a duration-shaped dominant metric. */
  readonly rankOneLatency: boolean;
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
      rankOneLatency: rankOneLatencyDominant(kase),
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
  return {
    proxy,
    admitted,
    precision,
    recall,
    baseRate,
    informative: admitted > 0 && precision > baseRate,
  };
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
    // The proxy that clears the bar, and the only one here that needs no label at inference: the rank-1 service's own
    // dominant metric. It is listed LAST on purpose — the two above it are the ones that fail, and a reader should meet
    // them first.
    scoreProxy(rows, target, 'rank-1 dominant latency-ish', (row) => row.rankOneLatency),
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

/**
 * Where the failure KIND would have to come from — checked mechanically rather than asserted in prose.
 *
 * The audit above measures that no proxy beats the base rate. This answers the question a reader asks next: **why is
 * there nothing to proxy with?** Three places were checked, and the answer is the same at all three:
 *
 * 1. **The dump's service line** renders magnitudes (`selfAnomaly`, `log`, `failedEdge`, `failedEdgeRecords`, `latRise`,
 *    `latEdges`, exception COUNTS) — no kind.
 * 2. **The dump's edge line** renders pairs, `caller>callee`, with no per-edge failure count and therefore no kind.
 * 3. **The engine's edge record** — the input of `computeFailedEdgeScores` in
 *    `packages/tree/src/pruning/ranking-signals.ts` — carries `caller`, `callee`, `failed` and `baseline`. Counts.
 *
 * So the kind is not discarded at dump time; **it never enters the data model.** Retaining it is a capture change at the
 * source that builds edges from traces, and until that happens **no gate keyed on the fault class can be deployed**, and
 * the +69 stays an upper bound. That is a statement about the pipeline, and this function makes it checkable per run.
 */
export interface DatumLocus {
  /** The per-service fields the dump actually renders, sorted, taken from a real case. */
  readonly serviceFields: readonly string[];
  /** Whether the edge render is pairs only (`caller>callee`) or carries per-edge numbers. */
  readonly edgeForm: 'pairs-only' | 'with-counts' | 'no-edges';
  /** True when some field on either line could carry a failure kind. */
  readonly kindAvailable: boolean;
}

/**
 * Field names that would indicate a failure kind if the renderer ever grew one.
 *
 * **Matched as SUFFIXES, and never on a `...Count`.** The first version of this check matched the substring
 * `exception`, which fired on `logicExceptionCount` — a count of exceptions is not the kind of one, and the report said
 * a kind was available when none was. The general form of that mistake: a name test has to say what the field MEANS,
 * and `Count` is the word that says it does not mean a kind.
 */
const KIND_SUFFIXES = ['kind', 'status', 'statuscode', 'errno', 'class'] as const;

/**
 * Read where the datum stands, from the cases rather than from the source.
 *
 * @param cases - Parsed cases.
 * @returns The rendered service fields, the edge form, and whether a kind is available anywhere.
 */
export function datumLocus(cases: readonly DiagnosedCase[]): DatumLocus {
  const first = cases.find((kase) => kase.services.length > 0);
  // Only fields whose value is DEFINED count as rendered: the parser builds every key even when the dump predates the
  // field, so `Object.keys` alone would report a field the file never carried.
  const serviceFields =
    first === undefined
      ? []
      : Object.entries(first.services[0]!)
          .filter(([, value]) => value !== undefined)
          .map(([name]) => name)
          .sort();
  const sampled = cases.filter((kase) => kase.edges !== undefined).slice(0, 50);
  // A pair is two IDENTIFIERS either side of one `>`. The first version of this test was `/^[^>]+>[^>]+$/`, which
  // accepted `a>b failed=3` — the right-hand group swallowed the trailing field — so it reported `pairs-only` for a
  // render that carried numbers. A pair has no space and no `=`.
  const pairsOnly =
    sampled.length > 0 &&
    sampled.every((kase) => (kase.edges ?? []).every((edge) => /^[^>\s=]+>[^>\s=]+$/.test(edge)));
  const edgeForm: DatumLocus['edgeForm'] =
    sampled.length === 0 ? 'no-edges' : pairsOnly ? 'pairs-only' : 'with-counts';
  const kindAvailable = serviceFields.some((field) => {
    const name = field.toLowerCase();
    if (name.endsWith('count')) return false;
    return KIND_SUFFIXES.some((suffix) => name.endsWith(suffix));
  });
  return { serviceFields, edgeForm, kindAvailable };
}

/**
 * Render the locus finding.
 *
 * @param locus - The locus to render.
 * @param agreement - The baseline's agreement with the recorded run (law 41).
 * @returns The block.
 */
export function formatDatumLocus(locus: DatumLocus, agreement: AgreementReport): string {
  const percent = agreement.cases === 0 ? 0 : (100 * agreement.agreed) / agreement.cases;
  const lines = [
    'Where the failure KIND stands — checked per run, not asserted in prose:',
    `  baseline agreement with the recorded run: ${agreement.agreed}/${agreement.cases} ` +
      `(${percent.toFixed(2)}%) — ${agreementVerdict(agreement)}`,
    `  the dump's service line renders: ${locus.serviceFields.length === 0 ? '(nothing)' : locus.serviceFields.join(', ')}`,
    `  the dump's edge line renders: ${locus.edgeForm}`,
    locus.kindAvailable
      ? '  verdict: a field that could carry a failure kind IS rendered — re-run the proxy audit'
      : '  verdict: NO field carries a failure kind anywhere the dump can reach, so no proxy can exist until the ' +
        'pipeline CAPTURES it at the source that builds edges from traces',
  ];
  return lines.join('\n');
}

/**
 * Does the case's RANK-1 service carry a latency-shaped dominant metric?
 *
 * This is the proxy the audit needed: it is computable at inference (the engine's own top-1, never the label), and it
 * **beats the base rate** — measured at 30.1% precision against 17.9% on this corpus, with 90.6% recall. It is not a
 * good classifier; it is a better one than nothing, which is the bar the audit enforces.
 *
 * The mechanism is the one section 18 predicted: a link fault shows up as SLOWNESS on the service that owns the
 * connection, so the metric that dominates its anomaly is a duration.
 *
 * @param kase - The case.
 * @returns True when the rank-1 service's dominant metric is a duration or latency series.
 */
export function rankOneLatencyDominant(kase: DiagnosedCase): boolean {
  const top = kase.services.find((service) => service.predictedRank === 1);
  if (top === undefined) return false;
  return /duration|latency|time|p99|p95/i.test(top.dominantMetric ?? '');
}

/**
 * The rank-1 latency-rise floor the gate is REPORTED at, in the dump's own units.
 *
 * **FITTED, not derived.** A scan of 60…300 puts the first zero-regression point at 250; below it one type still breaks.
 * It is exported so the report prints the number it ran with, and so it.121 can hold it out across folds rather than
 * trusting a scan — a threshold chosen by looking at the whole corpus is exactly the defect iteration 117 corrected for
 * the class set, and this one has NOT yet paid that debt.
 */
export const DEPLOYABLE_LAT_RISE_FLOOR = 250;

/** What the deployable gate does to the direction term. */
export interface DeployableGateReport {
  readonly weight: number;
  /** The rank-1 latency-rise floor the report ran with, so two reports cannot be compared without it. */
  readonly minLatRise: number;
  readonly admitted: number;
  readonly cases: number;
  readonly baselineCorrect: number;
  readonly correct: number;
  readonly regressed: readonly string[];
}

/**
 * Does the case pass the gate — the dominant metric AND the latency-rise floor?
 *
 * @param kase - The case.
 * @param minLatRise - The rank-1 rise below which the term is refused; `0` disables the floor.
 * @returns True when the term may act on this case.
 */
export function admitsToGate(kase: DiagnosedCase, minLatRise: number): boolean {
  if (!rankOneLatencyDominant(kase)) return false;
  if (minLatRise <= 0) return true;
  const top = kase.services.find((service) => service.predictedRank === 1);
  return (top?.latRise ?? 0) >= minLatRise;
}

/**
 * Score the direction term behind the DEPLOYABLE gate — the rank-1 latency-dominant proxy — and report its split.
 *
 * **This is the first gate in the record that is both deployable and profitable**: it needs no label, it admits 765 of
 * 1422, and at weight 3 it takes the corpus from 750 to **860 (+110)** — above the ungated term's own 855, because the
 * cases it refuses include the ones the term was breaking — while cutting regressed types from **8 to 2**.
 *
 * **It still does not ship**: 2 types regress, so the engine's criterion is unmet and `DEFAULT_FAILED_EDGE_WEIGHT` stays
 * 0. What moved is the frontier: from "no deployable gate exists" to "one exists, and its residue is named".
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration.
 * @param weight - The direction weight inside the gate.
 * @returns The totals, how many cases the gate admitted, and the regressed types.
 */
export function deployableGateReport(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  weight: number,
  /**
   * The rank-1 latency rise below which the term is refused, in the dump's own units.
   *
   * `0` is iteration 119's gate: the dominant metric alone. **A floor is a SECOND observable and it is what closes the
   * residue**: the two types the metric-only gate kept breaking have a median rank-1 rise of **9.0** while the cases
   * the gate is FOR have **340.9** — a 38× separation that no metric NAME could give, because the harmful types' dominant
   * metric is literally `http.server.request.duration`, the same series as the useful ones.
   *
   * **The number is FITTED** — a scan of 60…300 shows the criterion met from 250 up, at +42 instead of +110. A fitted
   * threshold is not a mechanism until it is chosen on four folds and read on the fifth, which has NOT been done.
   */
  minLatRise = 0,
): DeployableGateReport {
  let counted = 0;
  let admitted = 0;
  let baselineCorrect = 0;
  let correct = 0;
  const perType = new Map<string, { base: number; arm: number }>();
  for (const kase of cases) {
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    if (root.size === 0) continue;
    counted++;
    const admits = admitsToGate(kase, minLatRise);
    if (admits) admitted++;
    const lat = latencySlopes(kase.services, opts.latFloor);
    const base = root.has(rankCase(kase, opts, 'recorded', lat).order[0] ?? '');
    const arm = admits
      ? root.has(
          rankCase(kase, { ...opts, failedEdgeWeight: weight }, 'recorded', lat).order[0] ?? '',
        )
      : base;
    if (base) baselineCorrect++;
    if (arm) correct++;
    const row = perType.get(kase.faultType) ?? { base: 0, arm: 0 };
    row.base += base ? 1 : 0;
    row.arm += arm ? 1 : 0;
    perType.set(kase.faultType, row);
  }
  const regressed = [...perType.entries()]
    .filter(([, counts]) => counts.arm < counts.base)
    .map(([type, counts]) => `${type} ${counts.base - counts.arm}`);
  return { weight, minLatRise, admitted, cases: counted, baselineCorrect, correct, regressed };
}

/**
 * Render the deployable gate's result.
 *
 * @param report - The report to render.
 * @param agreement - The baseline's agreement with the recorded run (law 41).
 * @returns The block.
 */
export function formatDeployableGate(
  report: DeployableGateReport,
  agreement: AgreementReport,
): string {
  const percent = agreement.cases === 0 ? 0 : (100 * agreement.agreed) / agreement.cases;
  const net = report.correct - report.baselineCorrect;
  const lines = [
    'Deployable gate — the direction term admitted only where the RANK-1 dominant metric is a duration:',
    `  baseline agreement with the recorded run: ${agreement.agreed}/${agreement.cases} ` +
      `(${percent.toFixed(2)}%) — ${agreementVerdict(agreement)}`,
    `  weight ${report.weight}${report.minLatRise > 0 ? `, rank-1 latRise >= ${report.minLatRise}` : ''}: ` +
      `the gate admits ${report.admitted}/${report.cases} cases (no label read)`,
    `  right ${report.correct} against a baseline of ${report.baselineCorrect} (${net >= 0 ? `+${net}` : net})`,
    `  regressed types: ${report.regressed.length === 0 ? 'NONE' : `${report.regressed.length} — ${report.regressed.join(', ')}`}`,
    report.regressed.length === 0
      ? '  verdict: the criterion is MET by a deployable gate'
      : '  verdict: the criterion is NOT met — the flip stays refused, and this is the residue to attack next',
  ];
  return lines.join('\n');
}
