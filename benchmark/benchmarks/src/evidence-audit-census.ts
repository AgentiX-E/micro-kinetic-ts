/**
 * The case-level census over {@link auditEvidence}: turning a three-family classifier into three rates.
 *
 * ## Why a census and not a per-case print
 *
 * The auditor answers per case, and a per-case answer cannot be quoted. What a report needs is two numbers per
 * family, and they are different numbers:
 *
 * - **findings** — how many defects, summed over cases. One case that dropped its whole fleet contributes many.
 * - **cases with** — how many cases had this defect at least once. This is the number a RATE is over, and a census
 *   that only carried findings would let a single case with a wide graph look like an epidemic.
 *
 * Both are carried, because either alone is misleading in a direction that is easy to argue for.
 *
 * ## The third number, which is the point
 *
 * `unauditable` counts cases the auditor could not read — no channel record at all. It is reported separately and
 * never folded into a zero, for the same reason `auditEvidence` answers `undefined` rather than an empty audit: a
 * run that took no diagnostic pass would otherwise render three perfect rates.
 */
import type { MetricDiagnostic, ScoreTerm } from '@agentix-e/micro-kinetic-core';
import { auditEvidence, type EvidenceFailureFamily } from '@agentix-e/micro-kinetic-tree';

/** The part of a diagnosed case the census reads. `DiagnosedCaseRecord` satisfies it structurally. */
export interface AuditableCase {
  readonly case: { readonly groundTruth: { readonly serviceId: string } };
  readonly graph: { readonly metricDiagnostics?: ReadonlyMap<string, readonly MetricDiagnostic[]> };
  readonly ranking: readonly {
    readonly serviceId: string;
    readonly terms?: readonly ScoreTerm[];
  }[];
}

/** Running totals over one cell. Mutated by {@link accumulateEvidenceAuditCensus}; read by the formatter. */
export interface EvidenceAuditCensus {
  /** Cases the auditor had a channel record for. */
  cases: number;
  /** Cases with no channel record — an absence, reported as one. */
  unauditable: number;
  /** Defects summed over cases, per family. */
  findings: Record<EvidenceFailureFamily, number>;
  /** Cases carrying at least one defect of each family — the denominator-free rate's numerator. */
  casesWith: Record<EvidenceFailureFamily, number>;
  /** Defects that landed on the case's own answer, per family. */
  onTruth: Record<EvidenceFailureFamily, number>;
  /**
   * Cases where the TRUTH was dropped from the ranking (`omitted` on truth) **and** the answer was wrong.
   *
   * The number that turns a count into a consequence. An `omitted` finding on a healthy service is the topology
   * discount doing its job — the service's anomaly was accounted for by a callee and is meant to leave the pool.
   * An `omitted` finding on the TRUTH is different in kind: the engine measured the right service and then removed
   * it, so the case cannot be answered correctly. This field says how often that actually happened, which is the
   * difference between "the discount has a cost" and "the discount cost THIS many cases".
   */
  omittedOnTruthMissed: number;
}

/** A census with nothing counted yet. */
export function createEvidenceAuditCensus(): EvidenceAuditCensus {
  return {
    cases: 0,
    unauditable: 0,
    findings: { omitted: 0, misinterpreted: 0, unsupported: 0 },
    casesWith: { omitted: 0, misinterpreted: 0, unsupported: 0 },
    onTruth: { omitted: 0, misinterpreted: 0, unsupported: 0 },
    omittedOnTruthMissed: 0,
  };
}

/** Fold one case into the census. */
export function accumulateEvidenceAuditCensus(
  census: EvidenceAuditCensus,
  record: AuditableCase,
): void {
  const audit = auditEvidence({
    diagnostics: record.graph.metricDiagnostics,
    ranked: record.ranking,
    truth: record.case.groundTruth.serviceId,
  });
  if (audit === undefined) {
    census.unauditable += 1;
    return;
  }
  census.cases += 1;
  // One CASE per family at most, and one FINDING per occurrence: the two loops are separate so a case with three
  // omissions counts 3 findings and 1 case, which is the whole reason both numbers exist.
  const families = new Set<EvidenceFailureFamily>();
  for (const finding of audit.findings) {
    census.findings[finding.family] += 1;
    families.add(finding.family);
    if (finding.onTruth) census.onTruth[finding.family] += 1;
  }
  for (const family of families) census.casesWith[family] += 1;
  // The consequence, not the count: `AC@1` on a single-label corpus is exactly `top-1 === truth`, so the two
  // facts — the truth left the pool, and the answer is not the truth — are read from the same record that
  // produced the finding and cannot disagree with it.
  const answeredCorrectly = record.ranking[0]?.serviceId === record.case.groundTruth.serviceId;
  if (audit.findings.some((f) => f.family === 'omitted' && f.onTruth) && !answeredCorrectly) {
    census.omittedOnTruthMissed += 1;
  }
}

/** `rate` as a one-decimal percentage of the audited cases, or `-` when nothing was audited. */
function rateOf(hits: number, total: number): string {
  if (total === 0) return '-';
  return `${((hits / total) * 100).toFixed(1)}%`;
}

/**
 * The cell's line, or `undefined` when no case was audited.
 *
 * `undefined` rather than a row of zeros, for the reason the module docblock gives: a zero over an empty set is
 * not a reading of the engine's evidence use, it is a reading of the caller's loop.
 */
export function formatEvidenceAuditCensusLine(census: EvidenceAuditCensus): string | undefined {
  if (census.cases === 0) return undefined;
  const part = (family: EvidenceFailureFamily): string =>
    `${family} ${census.casesWith[family]}/${census.cases} (${rateOf(census.casesWith[family], census.cases)})`;
  return (
    `[evidence-audit] ${census.cases} cases` +
    (census.unauditable > 0 ? `, ${census.unauditable} unauditable` : '') +
    ` — ${part('omitted')} · ${part('misinterpreted')} · ${part('unsupported')}` +
    ` · on truth ${census.onTruth.omitted}/${census.onTruth.misinterpreted}/${census.onTruth.unsupported}` +
    ` · findings ${census.findings.omitted}/${census.findings.misinterpreted}/${census.findings.unsupported}` +
    (census.omittedOnTruthMissed > 0
      ? ` · truth dropped and missed ${census.omittedOnTruthMissed}`
      : '')
  );
}
