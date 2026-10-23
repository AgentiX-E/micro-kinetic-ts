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
import {
  admitsToGate,
  datumLocus,
  DEPLOYABLE_LAT_RISE_FLOOR,
  deployableGateReport,
  formatDatumLocus,
  formatDeployableGate,
  formatProxyAudit,
  proxyAudit,
  proxyRows,
  rankOneLatencyDominant,
  scoreProxy,
} from '../src/fse26-proxy-audit.js';
import type { TermOracleOptions } from '../src/fse26-term-oracle.js';

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

/** The oracle configuration every screen in this file runs under. */
const OPTS: TermOracleOptions = {
  logWeight: 1,
  latWeight: 0.561495,
  latFloor: 10.3,
  dominance: 0.5,
  dominanceGrid: [],
  poolWeight: 0,
  temporalWeight: 0,
  onsetShape: 'earliness',
};

const row = (o: Partial<ProxyRow> & Pick<ProxyRow, 'target'>): ProxyRow => ({
  datapack: 'd',
  records: 0,
  httpShare: 0,
  rankOneLatency: false,
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
  it('runs every proxy and reports that none clears the bar on a corpus where none can', () => {
    // `rankOneLatency: false` everywhere is the point: with the dominant proxy silent, the three counting proxies all
    // score at or below the base rate, and the audit must say so rather than finding a proxy that is not there.
    const rows = [
      row({ target: 'network', records: 5, httpShare: 1 }),
      row({ target: 'value', records: 5, httpShare: 1 }),
    ];
    const audit = proxyAudit(rows);
    expect(audit.verdicts).toHaveLength(4);
    expect(audit.anyInformative).toBe(false);
  });

  it('finds the dominant-metric proxy informative when it separates, which is the deployable one', () => {
    // Two of three cases are network and only those carry the duration-shaped dominant metric: precision 1.0 against a
    // base rate of 0.667, so the audit reports DEPLOYABLE — the state this corpus is in.
    const rows = [
      row({ target: 'network', rankOneLatency: true }),
      row({ target: 'network' }),
      row({ target: 'value' }),
    ];
    const audit = proxyAudit(rows);
    expect(audit.anyInformative).toBe(true);
    expect(
      formatProxyAudit(audit, {
        cases: 3,
        agreed: 3,
        recordedRight: 2,
        rebuiltRight: 2,
        recordedNotListed: 0,
      }),
    ).toContain('DEPLOYABLE');
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

describe('rankOneLatencyDominant — the only proxy in this record that needs no label', () => {
  it('reads the dominant metric of the RANK-1 service, not the ground truth', () => {
    // The GT service has a CPU metric and the rank-1 service a duration one. A proxy that read the GT would answer
    // false here; the engine can only see the rank, so the answer must follow the RANK.
    const kase0 = kase({
      groundTruth: ['a'],
      services: [
        svc({
          serviceId: 'a',
          isGroundTruth: true,
          predictedRank: 2,
          dominantMetric: 'container_cpu_usage',
        }),
        svc({
          serviceId: 'b',
          predictedRank: 1,
          dominantMetric: 'http_request_duration_p99_seconds',
        }),
      ],
    });
    expect(rankOneLatencyDominant(kase0)).toBe(true);
  });

  it('answers false when nothing is ranked, and for a non-duration dominant metric', () => {
    expect(rankOneLatencyDominant(kase({ services: [svc({ serviceId: 'a' })] }))).toBe(false);
    const errorish = kase({
      services: [svc({ serviceId: 'a', predictedRank: 1, dominantMetric: 'http_error_rate' })],
    });
    expect(rankOneLatencyDominant(errorish)).toBe(false);
  });
});

describe('deployableGateReport', () => {
  it('applies the term only to admitted cases, and names the residue', () => {
    // Admitted: a duration-dominant rank-1 with `source` as truth, which the direction fixes.
    // Refused: a resource-dominant case the direction would have broken — it must stay untouched.
    const cases = [
      kase({
        datapack: 'g1',
        faultType: 'NetworkLoss',
        groundTruth: ['source'],
        services: [svc({ serviceId: 'source', predictedRank: 1, dominantMetric: 'duration_p99' })],
      }),
      kase({
        datapack: 'g2',
        faultType: 'JVMMemoryStress',
        groundTruth: ['symptom'],
        services: [svc({ serviceId: 'symptom', predictedRank: 1, dominantMetric: 'memory_usage' })],
      }),
    ];
    const report = deployableGateReport(cases, OPTS, 3);
    expect(report.cases).toBe(2);
    expect(report.admitted).toBe(1);
    // Measured, not assumed: with one service per case the baseline ranking is already right in BOTH, so this fixture
    // cannot show a fix — and it must not pretend to. What it does show is the property the gate is judged on: the
    // refused case contributed its baseline unchanged, so nothing regressed.
    expect(report.correct).toBe(report.baselineCorrect);
    expect(report.regressed).toEqual([]);
  });

  it('skips a case with no root, refuses one with no rank-1, and renders a zero population', () => {
    // Three populations in one fixture: no root (not counted at all), no rank-1 (the gate refuses, so the case keeps
    // its baseline), and the empty-agreement render which must not divide by zero.
    const cases = [
      kase({
        datapack: 'z0',
        services: [svc({ serviceId: 'a', predictedRank: 1 })],
        groundTruth: [],
      }),
      kase({
        datapack: 'z1',
        faultType: 'NetworkLoss',
        groundTruth: ['source'],
        services: [svc({ serviceId: 'source' })],
      }),
    ];
    const report = deployableGateReport(cases, OPTS, 3);
    expect(report.cases).toBe(1);
    expect(report.admitted).toBe(0);
    expect(report.correct).toBe(report.baselineCorrect);
    const text = formatDeployableGate(report, {
      cases: 0,
      agreed: 0,
      recordedRight: 0,
      rebuiltRight: 0,
      recordedNotListed: 0,
    });
    expect(text).toContain('0/0');
    expect(text).not.toContain('NaN');
  });

  it('reports a NEGATIVE net when the gate admits a case the term breaks', () => {
    // The gate is a bet, and a bet can lose. A duration-dominant rank-1 whose truth is the CALLEE: admitting it lets
    // the direction term move the answer away, so the net is negative and the report must print a minus rather than a
    // bare `+`. This arm existed and was never exercised, which is how a formatter keeps a `>= 0` branch it never takes.
    // Two services, so the ranking can MOVE: `symptom` wins on anomaly at weight 0 (truth), and the direction term at
    // weight 3 hands the rank to `source` — a loss. One service cannot lose, because nothing can overtake it.
    const cases = [
      kase({
        datapack: 'lose',
        faultType: 'HTTPRequestDelay',
        groundTruth: ['symptom'],
        services: [
          svc({
            serviceId: 'symptom',
            selfAnomaly: Math.exp(1),
            predictedRank: 1,
            dominantMetric: 'duration_p99',
          }),
          svc({ serviceId: 'source', selfAnomaly: 0, failedEdgeScore: 1 }),
        ],
      }),
    ];
    const report = deployableGateReport(cases, OPTS, 3);
    expect(report.admitted).toBe(1);
    expect(report.correct).toBeLessThan(report.baselineCorrect);
    expect(report.regressed).toHaveLength(1);
    const text = formatDeployableGate(report, {
      cases: 1,
      agreed: 1,
      recordedRight: 1,
      rebuiltRight: 1,
      recordedNotListed: 0,
    });
    expect(text).toContain('(-1)');
  });

  it('counts a case whose root is in NO service, so both the base and the arm are false', () => {
    // The third population: a case that names a root nothing in the ranked set can match. It must be COUNTED (the
    // denominator is honest) and must contribute zero to both sides rather than being dropped.
    const cases = [
      kase({
        datapack: 'ghost',
        faultType: 'NetworkLoss',
        groundTruth: ['ghost'],
        services: [
          svc({
            serviceId: 'symptom',
            selfAnomaly: Math.exp(1),
            predictedRank: 1,
            dominantMetric: 'duration_p99',
          }),
          svc({ serviceId: 'source', selfAnomaly: 0, failedEdgeScore: 1 }),
        ],
      }),
    ];
    const report = deployableGateReport(cases, OPTS, 3);
    expect(report.cases).toBe(1);
    expect(report.admitted).toBe(1);
    expect(report.baselineCorrect).toBe(0);
    expect(report.correct).toBe(0);
    expect(report.regressed).toEqual([]);
  });

  it('renders the residue when the criterion is not met, and the MET verdict when it is', () => {
    const notMet = formatDeployableGate(
      {
        weight: 3,
        minLatRise: 0,
        admitted: 1,
        cases: 2,
        baselineCorrect: 1,
        correct: 2,
        regressed: ['JVMMemoryStress 3'],
      },
      { cases: 2, agreed: 2, recordedRight: 1, rebuiltRight: 1, recordedNotListed: 0 },
    );
    expect(notMet).toContain('NOT met');
    expect(notMet).toContain('JVMMemoryStress 3');
    const met = formatDeployableGate(
      {
        weight: 3,
        minLatRise: 250,
        admitted: 1,
        cases: 2,
        baselineCorrect: 1,
        correct: 2,
        regressed: [],
      },
      { cases: 2, agreed: 2, recordedRight: 1, rebuiltRight: 1, recordedNotListed: 0 },
    );
    expect(met).toContain('criterion is MET');
  });
});

describe('datumLocus — where the failure KIND stands, read off the rendered data', () => {
  it('counts only DEFINED fields, because the parser materialises every key', () => {
    const cases = [
      kase({
        services: [svc({ serviceId: 'a', predictedRank: 1, dominantMetric: 'duration_p99' })],
      }),
    ];
    const locus = datumLocus(cases);
    // `metricOutcomes` and friends are `undefined` on a dump that predates them, and a key whose value is undefined was
    // never rendered — counting it would report a field the file does not carry.
    expect(locus.serviceFields).toContain('dominantMetric');
    expect(locus.serviceFields).not.toContain('metricOutcomes');
    expect(locus.serviceFields).not.toContain('decisiveOutcome');
  });

  it('reports no service fields at all when every case is empty', () => {
    // A corpus whose cases carry no services has nothing to quote, and the report must say `(nothing)` rather than
    // reaching into a first element that does not exist.
    const locus = datumLocus([kase({ services: [], groundTruth: ['ghost'] })]);
    expect(locus.serviceFields).toEqual([]);
    expect(
      formatDatumLocus(locus, {
        cases: 1,
        agreed: 1,
        recordedRight: 0,
        rebuiltRight: 0,
        recordedNotListed: 0,
      }),
    ).toContain('(nothing)');
  });

  it('reads pairs-only, with-counts and no-edges from the edge render', () => {
    const pairs = datumLocus([kase({ services: [svc({ serviceId: 'a' })], edges: ['a>b'] })]);
    expect(pairs.edgeForm).toBe('pairs-only');
    const counts = datumLocus([
      kase({ services: [svc({ serviceId: 'a' })], edges: ['a>b failed=3'] }),
    ]);
    expect(counts.edgeForm).toBe('with-counts');
    const none = datumLocus([kase({ services: [svc({ serviceId: 'a' })] })]);
    expect(none.edgeForm).toBe('no-edges');
  });

  it('never calls an exception COUNT a kind, and does call a kind-ish suffix one', () => {
    // The defect this pins: `logicExceptionCount` contains the substring "exception", and the first version of the
    // check read that as "a kind is available". A count is not a kind; a name that ENDS in a kind-ish suffix is.
    const countOnly = datumLocus([
      kase({ services: [svc({ serviceId: 'a', logicExceptionCount: 4, httpExceptionCount: 2 })] }),
    ]);
    expect(countOnly.kindAvailable).toBe(false);
    const withKind = datumLocus([
      kase({
        services: [
          {
            ...svc({ serviceId: 'a' }),
            errorKind: 'connect-refused',
          } as unknown as DiagnosedService,
        ],
      }),
    ]);
    expect(withKind.kindAvailable).toBe(true);
  });

  it('renders both verdicts, and an empty population without dividing by it', () => {
    const agreement = {
      cases: 1,
      agreed: 1,
      recordedRight: 1,
      rebuiltRight: 1,
      recordedNotListed: 0,
    };
    const absent = formatDatumLocus(
      datumLocus([kase({ services: [svc({ serviceId: 'a' })] })]),
      agreement,
    );
    expect(absent).toContain('NO field carries a failure kind');
    const present = formatDatumLocus(
      {
        serviceFields: ['errorKind'],
        edgeForm: 'pairs-only',
        kindAvailable: true,
      },
      agreement,
    );
    expect(present).toContain('re-run the proxy audit');
    const empty = formatDatumLocus(
      { serviceFields: [], edgeForm: 'no-edges', kindAvailable: false },
      { cases: 0, agreed: 0, recordedRight: 0, rebuiltRight: 0, recordedNotListed: 0 },
    );
    expect(empty).toContain('0/0');
    expect(empty).toContain('(nothing)');
  });
});

describe('admitsToGate — the second observable: the rank-1 latency rise', () => {
  const durationTop = (latRise: number): DiagnosedCase =>
    kase({
      services: [
        svc({
          serviceId: 'a',
          predictedRank: 1,
          dominantMetric: 'http.server.request.duration',
          latRise,
        }),
      ],
      groundTruth: ['a'],
    });

  it('refuses a case whose metric is not duration-shaped, whatever its rise', () => {
    const notDuration = kase({
      services: [
        svc({
          serviceId: 'a',
          predictedRank: 1,
          dominantMetric: 'jvm.system.cpu.load_1m',
          latRise: 999,
        }),
      ],
      groundTruth: ['a'],
    });
    expect(admitsToGate(notDuration, 0)).toBe(false);
    expect(admitsToGate(notDuration, 250)).toBe(false);
  });

  it('admits on the metric alone when the floor is 0, and on BOTH when it is set', () => {
    // The floor is the second observable: `9.0` is the median rise of the two types the metric-only gate kept breaking,
    // `340.9` the median of the cases it is for. A case below the floor is refused even though its metric qualifies.
    expect(admitsToGate(durationTop(9), 0)).toBe(true);
    expect(admitsToGate(durationTop(9), 250)).toBe(false);
    expect(admitsToGate(durationTop(340.9), 250)).toBe(true);
    // Exactly at the floor passes: the rule is `>=`, and a test that only checks either side would miss a `<` slip.
    expect(admitsToGate(durationTop(250), 250)).toBe(true);
    expect(admitsToGate(durationTop(249.9), 250)).toBe(false);
  });

  it('treats a missing rise as 0, so a case without the field cannot pass a floor', () => {
    const noRise = kase({
      services: [svc({ serviceId: 'a', predictedRank: 1, dominantMetric: 'duration_p99' })],
      groundTruth: ['a'],
    });
    expect(admitsToGate(noRise, 0)).toBe(true);
    expect(admitsToGate(noRise, 1)).toBe(false);
  });

  it('reaches the criterion in the floored report on a corpus where the floor excludes the harmful case', () => {
    // Two cases: one the term fixes with a huge rise, one it breaks with a tiny rise. The floor refuses the second, so
    // the report shows a gain AND no regressed type — the shape the corpus has once the floor is applied.
    const cases = [
      kase({
        datapack: 'fix',
        faultType: 'NetworkLoss',
        groundTruth: ['source'],
        services: [
          svc({
            serviceId: 'symptom',
            selfAnomaly: Math.exp(1),
            predictedRank: 1,
            dominantMetric: 'duration_p99',
            latRise: 340,
          }),
          svc({ serviceId: 'source', selfAnomaly: 0, failedEdgeScore: 1 }),
        ],
      }),
      kase({
        datapack: 'harm',
        faultType: 'HTTPRequestDelay',
        groundTruth: ['symptom2'],
        services: [
          svc({
            serviceId: 'symptom2',
            selfAnomaly: Math.exp(1),
            predictedRank: 1,
            dominantMetric: 'duration_p99',
            latRise: 9,
          }),
          svc({ serviceId: 'source2', selfAnomaly: 0, failedEdgeScore: 1 }),
        ],
      }),
    ];
    const metricOnly = deployableGateReport(cases, OPTS, 3);
    expect(metricOnly.admitted).toBe(2);
    expect(metricOnly.regressed).toEqual(['HTTPRequestDelay 1']);

    const floored = deployableGateReport(cases, OPTS, 3, DEPLOYABLE_LAT_RISE_FLOOR);
    expect(floored.admitted).toBe(1);
    expect(floored.regressed).toEqual([]);
    expect(floored.correct).toBe(floored.baselineCorrect + 1);
    // The floor travels in the report, so two reports cannot be compared without it.
    expect(floored.minLatRise).toBe(DEPLOYABLE_LAT_RISE_FLOOR);
    expect(
      formatDeployableGate(floored, {
        cases: 2,
        agreed: 2,
        recordedRight: 1,
        rebuiltRight: 1,
        recordedNotListed: 0,
      }),
    ).toContain(`rank-1 latRise >= ${DEPLOYABLE_LAT_RISE_FLOOR}`);
  });
});
