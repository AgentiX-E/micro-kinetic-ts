import type { MetricDiagnostic } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';
import {
  accumulateEvidenceAuditCensus,
  createEvidenceAuditCensus,
  formatEvidenceAuditCensusLine,
  type AuditableCase,
} from '../src/evidence-audit-census.js';

/**
 * The census is what turns the per-case auditor into a rate. Its only real obligation is that a case the auditor
 * could not read is counted as UNAUDITABLE rather than folded into a zero — the distinction the auditor itself is
 * built on, one level up.
 */

const kept = (label: string, score: number, rise = 1, drop = 0): MetricDiagnostic => ({
  label,
  outcome: 'kept',
  score,
  breakdown: {
    deviation: 1,
    trend: 0,
    cv: 0,
    burst: 0,
    riseRatio: rise,
    dropRatio: drop,
    baselineMean: 1,
  },
});

/** One case as the runner hands it over, narrowed to the fields the census reads. */
const record = (
  truth: string,
  diagnostics: ReadonlyMap<string, readonly MetricDiagnostic[]> | undefined,
  ranking: AuditableCase['ranking'],
): AuditableCase => ({
  case: { groundTruth: { serviceId: truth } },
  graph: { metricDiagnostics: diagnostics },
  ranking,
});

const base = (v: number) => ({ name: 'selfAnomalyLog1p', contribution: v });
const rise = (v: number) => ({ name: 'rise', contribution: v });

describe('the evidence-audit census', () => {
  it('counts cases per family as well as findings, because a rate needs the case denominator', () => {
    const census = createEvidenceAuditCensus();
    // One case with two omitted services: two FINDINGS, one CASE. A report that quoted findings as a rate would
    // overstate a case that dropped its whole fleet.
    accumulateEvidenceAuditCensus(
      census,
      record(
        'A',
        new Map([
          ['B', [kept('cpu', 0.9)]],
          ['C', [kept('cpu', 0.8)]],
        ]),
        [{ serviceId: 'A', terms: [base(1)] }],
      ),
    );
    expect(census.findings.omitted).toBe(2);
    expect(census.casesWith.omitted).toBe(1);
  });

  it('reports a case with no channel record as UNAUDITABLE rather than as a clean one', () => {
    const census = createEvidenceAuditCensus();
    accumulateEvidenceAuditCensus(
      census,
      record('A', undefined, [{ serviceId: 'A', terms: [base(1)] }]),
    );
    expect(census.unauditable).toBe(1);
    expect(census.cases).toBe(0);
    expect(census.findings.omitted).toBe(0);
  });

  it('attributes findings to the truth label without letting it decide them', () => {
    const census = createEvidenceAuditCensus();
    accumulateEvidenceAuditCensus(
      census,
      record('A', new Map([['A', [kept('cpu', 0.9, 0.2, 0.8)]]]), [
        { serviceId: 'A', terms: [base(1), rise(0.3)] },
      ]),
    );
    expect(census.findings.misinterpreted).toBe(1);
    expect(census.onTruth.misinterpreted).toBe(1);
  });

  it('separates the three families in one line, with cases as the denominator on every rate', () => {
    const census = createEvidenceAuditCensus();
    accumulateEvidenceAuditCensus(
      census,
      record('A', new Map([['A', [kept('cpu', 0.9, 0.2, 0.8)]]]), [
        { serviceId: 'A', terms: [base(1), rise(0.3)] },
      ]),
    );
    accumulateEvidenceAuditCensus(
      census,
      record('B', new Map([['B', [kept('cpu', 0.9)]]]), [{ serviceId: 'B', terms: [base(1)] }]),
    );
    const line = formatEvidenceAuditCensusLine(census)!;
    expect(line).toContain('2 cases');
    expect(line).toContain('misinterpreted 1/2');
    expect(line).toContain('omitted 0/2');
  });

  it('prints nothing when it read no case at all, rather than a row of zeros', () => {
    // Same rule as the auditor's own `undefined`: a zero over an empty set is not a reading. A cell whose run
    // produced no diagnostic pass would otherwise render three perfect rates.
    expect(formatEvidenceAuditCensusLine(createEvidenceAuditCensus())).toBe(undefined);
  });

  it('counts a dropped TRUTH that cost the case, and not one that did not', () => {
    // The distinction that makes the count a consequence: the topology discount legitimately removes services
    // whose anomaly a callee accounts for, so an omission on a healthy service is the design working. An omission
    // on the TRUTH cannot be answered around, and only that one is counted here.
    const cost = createEvidenceAuditCensus();
    // Truth `A` measured and then absent from the ranking: `B` is the answer, so the case is wrong.
    accumulateEvidenceAuditCensus(
      cost,
      record('A', new Map([['A', [kept('cpu', 0.9)]]]), [{ serviceId: 'B', terms: [base(1)] }]),
    );
    expect(cost.findings.omitted).toBe(1);
    expect(cost.onTruth.omitted).toBe(1);
    expect(cost.omittedOnTruthMissed).toBe(1);

    const noCost = createEvidenceAuditCensus();
    // An omission that is NOT on the truth — `B` was dropped, the answer is still `A`. The design's cost, not
    // this case's.
    accumulateEvidenceAuditCensus(
      noCost,
      record(
        'A',
        new Map([
          ['A', [kept('cpu', 0.9)]],
          ['B', [kept('cpu', 0.8)]],
        ]),
        [{ serviceId: 'A', terms: [base(1)] }],
      ),
    );
    expect(noCost.findings.omitted).toBe(1);
    expect(noCost.onTruth.omitted).toBe(0);
    expect(noCost.omittedOnTruthMissed).toBe(0);
  });

  it('names the unreadable cases in the line instead of hiding them behind the denominator', () => {
    const census = createEvidenceAuditCensus();
    accumulateEvidenceAuditCensus(
      census,
      record('A', new Map([['A', [kept('cpu', 0.9)]]]), [{ serviceId: 'A', terms: [base(1)] }]),
    );
    accumulateEvidenceAuditCensus(
      census,
      record('B', undefined, [{ serviceId: 'B', terms: [base(1)] }]),
    );
    const line = formatEvidenceAuditCensusLine(census)!;
    expect(line).toContain('1 unauditable');
  });
});
