/**
 * The proxy audit: can the fault class be recovered without the label?
 *
 * The audit exists because the class gate of iterations 16–17 keys on `faultType` — the dump's INJECTED LABEL — and the
 * engine never sees it. A gate keyed on the answer is an oracle, so the shippable question is whether an observable can
 * stand in for the label. These tests hold the arithmetic that answers it, including the edge that decides the verdict:
 * a proxy must BEAT the base rate, not merely match it.
 *
 * @module benchmarks/__tests__/fse26-proxy-audit
 */

import { describe, expect, it } from 'vitest';

import type { DiagnosedCase, DiagnosedService } from '../src/fse26-diagnose-analyze.js';
import type { ProxyRow } from '../src/fse26-proxy-audit.js';
import { formatProxyAudit, proxyAudit, proxyRows, scoreProxy } from '../src/fse26-proxy-audit.js';

function svc(o: Partial<DiagnosedService> & Pick<DiagnosedService, 'serviceId'>): DiagnosedService {
  return {
    isGroundTruth: false,
    predictedRank: undefined,
    selfAnomaly: 0,
    logScore: 0,
    failedEdgeScore: undefined,
    failedEdgeRecords: undefined,
    latRise: undefined,
    latEdges: undefined,
    onsetDelayMs: undefined,
    dominantMetric: 'cpu',
    errorCount: 0,
    fatalCount: 0,
    logicExceptionCount: 0,
    httpExceptionCount: 0,
    bothExceptionCount: undefined,
    metricNames: undefined,
    metricOutcomes: undefined,
    decisiveOutcome: undefined,
    ...o,
  };
}

function kase(o: Partial<DiagnosedCase> & Pick<DiagnosedCase, 'services'>): DiagnosedCase {
  return {
    datapack: 'd1',
    faultType: 'NetworkLoss',
    groundTruth: [],
    logSignalMode: 'count',
    prediction: [],
    edges: undefined,
    injectTimeMs: undefined,
    fieldDecimals: undefined,
    ...o,
  };
}

const row = (o: Partial<ProxyRow> & Pick<ProxyRow, 'target'>): ProxyRow => ({
  datapack: 'd',
  records: 0,
  httpShare: 0,
  ...o,
});

describe('proxyRows', () => {
  it('sums the observables and skips a case that names no root', () => {
    const cases = [
      kase({
        services: [
          svc({
            serviceId: 'a',
            failedEdgeRecords: 2,
            httpExceptionCount: 3,
            logicExceptionCount: 1,
          }),
          svc({
            serviceId: 'b',
            failedEdgeRecords: 1,
            httpExceptionCount: 0,
            logicExceptionCount: 0,
          }),
        ],
        groundTruth: ['a'],
      }),
      kase({ services: [svc({ serviceId: 'c', failedEdgeRecords: 9 })], groundTruth: [] }),
    ];
    const rows = proxyRows(cases);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.records).toBe(3);
    // 3 HTTP of 4 exceptions across the case: the share is computed over the whole case, not per service.
    expect(rows[0]!.httpShare).toBeCloseTo(0.75, 6);
    expect(rows[0]!.target).toBe('network');
  });

  it('treats a MISSING exception count as zero, because a malformed dump is data rather than an error', () => {
    // The typed interface says these are numbers; the parser can still produce a service without them, and the audit
    // must read that as "no exceptions of that kind" rather than as NaN — a NaN would silently poison every precision.
    const malformed = {
      ...svc({ serviceId: 'a' }),
      httpExceptionCount: undefined as unknown as number,
      logicExceptionCount: undefined as unknown as number,
    };
    const rows = proxyRows([kase({ services: [malformed], groundTruth: ['a'] })]);
    expect(rows[0]!.httpShare).toBe(0);
    expect(Number.isNaN(rows[0]!.httpShare)).toBe(false);
  });

  it('answers a share of 0 when the case logged no exceptions at all', () => {
    const rows = proxyRows([kase({ services: [svc({ serviceId: 'a' })], groundTruth: ['a'] })]);
    expect(rows[0]!.httpShare).toBe(0);
  });
});

describe('scoreProxy', () => {
  it('computes precision and recall against the base rate', () => {
    // Four cases, two of the target class. A rule admitting the two targets and one non-target:
    // precision 2/3, recall 2/2, base rate 2/4 — it beats the bar, so it is informative.
    const rows = [
      row({ target: 'network', records: 5 }),
      row({ target: 'network', records: 5 }),
      row({ target: 'value', records: 5 }),
      row({ target: 'value', records: 0 }),
    ];
    const verdict = scoreProxy(rows, 'network', 'records >= 5', (r) => r.records >= 5);
    expect(verdict.admitted).toBe(3);
    expect(verdict.precision).toBeCloseTo(2 / 3, 6);
    expect(verdict.recall).toBe(1);
    expect(verdict.baseRate).toBe(0.5);
    expect(verdict.informative).toBe(true);
  });

  it('is NOT informative when it only MATCHES the base rate', () => {
    // Admitting every case gives precision == base rate exactly: a proxy that cannot beat "admit everything" carries no
    // information, which is the verdict this whole module exists to report.
    const rows = [row({ target: 'network' }), row({ target: 'value' })];
    const verdict = scoreProxy(rows, 'network', 'everything', () => true);
    expect(verdict.precision).toBe(verdict.baseRate);
    expect(verdict.informative).toBe(false);
  });

  it('answers 0 precision when it admits nothing, rather than dividing by zero', () => {
    const verdict = scoreProxy([row({ target: 'network' })], 'network', 'never', () => false);
    expect(verdict.admitted).toBe(0);
    expect(verdict.precision).toBe(0);
    expect(verdict.informative).toBe(false);
  });
});

describe('proxyAudit', () => {
  it('runs the three proxies and reports that none clears the bar on a corpus where none can', () => {
    const rows = [
      row({ target: 'network', records: 5, httpShare: 1 }),
      row({ target: 'value', records: 5, httpShare: 1 }),
    ];
    const audit = proxyAudit(rows);
    expect(audit.verdicts).toHaveLength(3);
    expect(audit.anyInformative).toBe(false);
  });

  it('reports a clearing proxy when one genuinely separates the class', () => {
    // A designed separation with a base rate BELOW 1: two of three cases are network, and the proxy admits only the one
    // that carries the signal — so its precision (1.0) beats the bar (0.667) and it is informative. A corpus of targets
    // only would have a base rate of 1 and NOTHING could beat it, which is a fixture mistake, not a finding.
    const rows = [
      row({ target: 'network', records: 5, httpShare: 1 }),
      row({ target: 'network', records: 0, httpShare: 0 }),
      row({ target: 'value', records: 0, httpShare: 0 }),
    ];
    const audit = proxyAudit(rows);
    expect(audit.verdicts[0]!.baseRate).toBeCloseTo(2 / 3, 6);
    expect(audit.anyInformative).toBe(true);
  });
});

describe('formatProxyAudit', () => {
  const agreement = {
    cases: 2,
    agreed: 2,
    recordedRight: 1,
    rebuiltRight: 1,
    recordedNotListed: 0,
  };

  it('prints the base rate as the bar BEFORE the proxies, so no precision is read without it', () => {
    const text = formatProxyAudit(
      proxyAudit([row({ target: 'network' }), row({ target: 'value' })]),
      agreement,
    );
    const lines = text.split('\n');
    expect(lines[1]).toContain('baseline agreement');
    expect(text.indexOf('the bar to clear')).toBeLessThan(text.indexOf('failedEdgeRecords >= 1'));
  });

  it('states the ORACLE verdict when no proxy clears the bar, and the deployable one when one does', () => {
    const none = formatProxyAudit(
      proxyAudit([row({ target: 'value', records: 5, httpShare: 1 })]),
      agreement,
    );
    expect(none).toContain('can NOT ship');
    const some = formatProxyAudit(
      proxyAudit([
        row({ target: 'network', records: 5, httpShare: 1 }),
        row({ target: 'network', records: 0, httpShare: 0 }),
        row({ target: 'value', records: 0, httpShare: 0 }),
      ]),
      agreement,
    );
    expect(some).toContain('DEPLOYABLE');
  });

  it('renders an audit with NO verdicts without reaching for a base rate that is not there', () => {
    const text = formatProxyAudit(
      { verdicts: [], anyInformative: false },
      { cases: 1, agreed: 1, recordedRight: 1, rebuiltRight: 1, recordedNotListed: 0 },
    );
    expect(text).toContain('0.0% precision');
    expect(text).toContain('can NOT ship');
  });

  it('renders a zero population without dividing by it', () => {
    const text = formatProxyAudit(proxyAudit([]), {
      cases: 0,
      agreed: 0,
      recordedRight: 0,
      rebuiltRight: 0,
      recordedNotListed: 0,
    });
    expect(text).toContain('0/0');
    expect(text).not.toContain('NaN');
  });
});
