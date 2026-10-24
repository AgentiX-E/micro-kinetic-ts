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
import type { FloorHoldout, ProxyRow } from '../src/fse26-proxy-audit.js';
import {
  admitsToGate,
  datumLocus,
  DEPLOYABLE_LAT_RISE_FLOOR,
  deployableGateReport,
  formatDatumLocus,
  formatDeployableGate,
  formatFloorHoldout,
  formatPlateauHoldout,
  formatPortAgreement,
  formatProxyAudit,
  holdoutFloorReport,
  holdoutPlateauReport,
  portAgreement,
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

describe('holdoutFloorReport — the floor chosen on four folds, read on the fifth', () => {
  const FLOORS = [0, 100, 250];

  it('chooses on the TRAINING folds only, and the held-out fold is read afterwards', () => {
    // A case the term fixes with a big rise, and one it breaks with a small rise. Both are ranked the same way, so the
    // only thing that separates the floors is which cases each admits — exactly the shape the chooser must reason about.
    const cases = [
      kase({
        datapack: 'a1',
        faultType: 'NetworkLoss',
        groundTruth: ['source'],
        services: [
          svc({
            serviceId: 'symptom',
            selfAnomaly: Math.exp(1),
            predictedRank: 1,
            dominantMetric: 'duration_p99',
            latRise: 400,
          }),
          svc({ serviceId: 'source', selfAnomaly: 0, failedEdgeScore: 1 }),
        ],
      }),
      kase({
        datapack: 'a2',
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
    const report = holdoutFloorReport(cases, OPTS, 3, FLOORS, 2);
    expect(report.folds).toHaveLength(2);
    // With two cases in two folds, the training set is always a single fold — so the floor is chosen on ONE case.
    for (const fold of report.folds) {
      expect(FLOORS).toContain(fold.chosen);
      expect(fold.trainingNet).toBeGreaterThanOrEqual(0);
    }
  });

  it('counts the distinct floors so a reader can see whether the choice is stable', () => {
    const stable = holdoutFloorReport(
      [
        kase({
          datapack: 's1',
          faultType: 'NetworkLoss',
          groundTruth: ['source'],
          services: [
            svc({
              serviceId: 'symptom',
              selfAnomaly: Math.exp(1),
              predictedRank: 1,
              dominantMetric: 'duration_p99',
              latRise: 400,
            }),
            svc({ serviceId: 'source', selfAnomaly: 0, failedEdgeScore: 1 }),
          ],
        }),
      ],
      OPTS,
      3,
      [0, 250],
      1,
    );
    expect(stable.distinct).toBe(1);
    expect(
      formatFloorHoldout(stable, {
        cases: 1,
        agreed: 1,
        recordedRight: 0,
        rebuiltRight: 0,
        recordedNotListed: 0,
      }),
    ).toContain('STABLE');
  });

  it('says NOT fully stable when the folds disagree, and never calls a majority stable', () => {
    const disagreement: FloorHoldout = {
      folds: [
        { fold: 0, chosen: 250, trainingNet: 30, heldOutNet: 11, heldOutCases: 278, regressed: 0 },
        { fold: 3, chosen: 100, trainingNet: 50, heldOutNet: 7, heldOutCases: 300, regressed: 1 },
      ],
      chosen: [250, 100],
      heldOutNet: 18,
      heldOutCases: 578,
      distinct: 2,
    };
    const text = formatFloorHoldout(disagreement, {
      cases: 2,
      agreed: 2,
      recordedRight: 1,
      rebuiltRight: 1,
      recordedNotListed: 0,
    });
    expect(text).toContain('NOT fully stable');
    expect(text).toContain('must not be taken on a majority');
    expect(text).toContain('distinct floors chosen: 2');
  });

  it('REFUSES a floor whose training net is higher but which regresses a type on training', () => {
    // The fold assignment is by datapack hash with 2 folds: g1/g3/h2 sit in fold 1, so fold 0's TRAINING set is
    // {g1, g3, h2}. Two of them are fixed by the term at floor 0 and one is broken by it, so floor 0 scores +1 with one
    // regressed type while floor 250 admits nothing and scores 0 with none. The constraint must pick the second —
    // a chooser that maximises the net alone picks the first, which is the mutation this test exists to kill.
    const good = (datapack: string) =>
      kase({
        datapack,
        faultType: 'NetworkLoss',
        groundTruth: ['source'],
        services: [
          svc({
            serviceId: 'symptom',
            selfAnomaly: Math.exp(1),
            predictedRank: 1,
            dominantMetric: 'duration_p99',
            latRise: 5,
          }),
          svc({ serviceId: 'source', selfAnomaly: 0, failedEdgeScore: 1 }),
        ],
      });
    const harmful = (datapack: string) =>
      kase({
        datapack,
        faultType: 'HTTPRequestDelay',
        groundTruth: ['symptom2'],
        services: [
          svc({
            serviceId: 'symptom2',
            selfAnomaly: Math.exp(1),
            predictedRank: 1,
            dominantMetric: 'duration_p99',
            latRise: 5,
          }),
          svc({ serviceId: 'source2', selfAnomaly: 0, failedEdgeScore: 1 }),
        ],
      });
    const report = holdoutFloorReport(
      [good('g1'), good('g3'), harmful('h2'), good('g2'), good('g4'), harmful('h1')],
      OPTS,
      3,
      [0, 250],
      2,
    );
    const foldZero = report.folds.find((fold) => fold.fold === 0)!;
    expect(foldZero.chosen).toBe(250);
    expect(foldZero.trainingNet).toBe(0);
  });

  it('never lets the chooser see the held-out fold', () => {
    // With ONE fold there is no training data at all, so the chooser has nothing to prefer and must fall back to the
    // first floor. A chooser that scored the whole corpus would find floor 250 better here and pick it — which is the
    // mutation, and it would be indistinguishable from a legitimate choice without this test.
    const cases = [
      kase({
        datapack: 'p1',
        faultType: 'NetworkLoss',
        groundTruth: ['source'],
        services: [
          svc({
            serviceId: 'symptom',
            selfAnomaly: Math.exp(1),
            predictedRank: 1,
            dominantMetric: 'duration_p99',
            latRise: 400,
          }),
          svc({ serviceId: 'source', selfAnomaly: 0, failedEdgeScore: 1 }),
        ],
      }),
      kase({
        datapack: 'p2',
        faultType: 'HTTPRequestDelay',
        groundTruth: ['symptom2'],
        services: [
          svc({
            serviceId: 'symptom2',
            selfAnomaly: Math.exp(1),
            predictedRank: 1,
            dominantMetric: 'duration_p99',
            latRise: 5,
          }),
          svc({ serviceId: 'source2', selfAnomaly: 0, failedEdgeScore: 1 }),
        ],
      }),
    ];
    const report = holdoutFloorReport(cases, OPTS, 3, [0, 250], 1);
    expect(report.chosen).toEqual([0]);
    expect(report.heldOutCases).toBe(2);
  });

  it('survives an EMPTY floor list and a fold where every floor regresses', () => {
    // No floors at all: the index has nothing to read, so the report must fall back to 0 rather than to `undefined`.
    const noFloors = holdoutFloorReport(
      [
        kase({
          datapack: 'e1',
          faultType: 'NetworkLoss',
          groundTruth: ['source'],
          services: [
            svc({
              serviceId: 'source',
              predictedRank: 1,
              dominantMetric: 'duration_p99',
              latRise: 400,
            }),
          ],
        }),
      ],
      OPTS,
      3,
      [],
      1,
    );
    expect(noFloors.chosen).toEqual([0]);
    // Every floor regresses on training: the chooser finds NOTHING admissible, and must report a training net of 0
    // rather than `-Infinity`, which would poison every later comparison.
    const allInfeasible = holdoutFloorReport(
      [
        kase({
          datapack: 'x1',
          faultType: 'HTTPRequestDelay',
          groundTruth: ['symptom'],
          services: [
            svc({
              serviceId: 'symptom',
              selfAnomaly: Math.exp(1),
              predictedRank: 1,
              dominantMetric: 'duration_p99',
              latRise: 400,
            }),
            svc({ serviceId: 'source', selfAnomaly: 0, failedEdgeScore: 1 }),
          ],
        }),
      ],
      OPTS,
      3,
      [0, 250],
      1,
    );
    for (const fold of allInfeasible.folds) expect(Number.isFinite(fold.trainingNet)).toBe(true);
  });

  it('prints a NEGATIVE held-out net with its sign, in the row and in the total', () => {
    const losing: FloorHoldout = {
      folds: [
        { fold: 0, chosen: 250, trainingNet: 30, heldOutNet: -3, heldOutCases: 100, regressed: 1 },
      ],
      chosen: [250],
      heldOutNet: -3,
      heldOutCases: 100,
      distinct: 1,
    };
    const text = formatFloorHoldout(losing, {
      cases: 1,
      agreed: 1,
      recordedRight: 1,
      rebuiltRight: 1,
      recordedNotListed: 0,
    });
    expect(text).toContain('-3');
    expect(text).not.toContain('+-3');
  });

  it('renders a zero population without dividing by it', () => {
    const empty = holdoutFloorReport([], OPTS, 3, [0, 250], 2);
    expect(empty.heldOutCases).toBe(0);
    const text = formatFloorHoldout(empty, {
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

describe('holdoutPlateauReport — the interval, and its midpoint read out of sample', () => {
  const fix = (datapack: string, latRise: number, faultType = 'NetworkLoss', truth = 'source') =>
    kase({
      datapack,
      faultType,
      groundTruth: [truth],
      services: [
        svc({
          serviceId: truth === 'source' ? 'symptom' : 'symptom',
          selfAnomaly: Math.exp(1),
          predictedRank: 1,
          dominantMetric: 'duration_p99',
          latRise,
        }),
        svc({
          serviceId: truth === 'source' ? 'source' : 'source2',
          selfAnomaly: 0,
          failedEdgeScore: 1,
        }),
      ],
    });

  it('reports the feasible interval and takes its midpoint, not a maximising point', () => {
    // Two folds' worth of cases so the training set is non-empty for each. Every floor from 200 up is feasible here
    // because the only admitted case is fixed by the term, so the interval is the whole grid and the midpoint is its
    // centre — which is the property that makes the choice arbitrary rather than fitted.
    const cases = [fix('q1', 500), fix('q2', 500), fix('q3', 500), fix('q4', 500)];
    const report = holdoutPlateauReport(cases, OPTS, 3, [200, 300, 400], 2);
    for (const fold of report.folds) {
      expect(fold.lo).toBe(200);
      expect(fold.hi).toBe(400);
      expect(fold.midpoint).toBe(300);
    }
    expect(report.leaking).toBe(0);
  });

  it('finds the interval on the TRAINING folds only, so a held-out case cannot widen it', () => {
    // Datapacks hash to folds deterministically with 2 folds: `g2` sits in fold 0 and `g1` in fold 1. Fold 0 gets the
    // GOOD case and fold 1 the HARMFUL one, so fold 1's training set is a single case that regresses nothing at any
    // floor — its interval must therefore start at the grid's floor. A chooser that scored the whole corpus would have
    // to climb to 310 to exclude the held-out harmful case, which is the mutation this test exists to kill.
    const good = kase({
      datapack: 'g2',
      faultType: 'NetworkLoss',
      groundTruth: ['source'],
      services: [
        svc({
          serviceId: 'symptom',
          selfAnomaly: Math.exp(1),
          predictedRank: 1,
          dominantMetric: 'duration_p99',
          latRise: 500,
        }),
        svc({ serviceId: 'source', selfAnomaly: 0, failedEdgeScore: 1 }),
      ],
    });
    const harmful = kase({
      datapack: 'g1',
      faultType: 'HTTPRequestDelay',
      groundTruth: ['symptom2'],
      services: [
        svc({
          serviceId: 'symptom2',
          selfAnomaly: Math.exp(1),
          predictedRank: 1,
          dominantMetric: 'duration_p99',
          latRise: 300,
        }),
        svc({ serviceId: 'source2', selfAnomaly: 0, failedEdgeScore: 1 }),
      ],
    });
    const report = holdoutPlateauReport([good, harmful], OPTS, 3, [200, 310, 400], 2);
    const foldOne = report.folds.find((fold) => fold.fold === 1)!;
    expect(foldOne.lo).toBe(200);
    expect(foldOne.hi).toBe(400);
  });

  it('collapses to a zero-width interval at the grid floor when no floor is feasible', () => {
    // Every floor admits the harmful case, so the criterion never holds on training: the plateau is empty and must be
    // reported as a point at the grid's first entry rather than as `undefined`.
    const cases = [
      fix('w1', 500, 'HTTPRequestDelay', 'symptom'),
      fix('w2', 500, 'HTTPRequestDelay', 'symptom'),
    ];
    const report = holdoutPlateauReport(cases, OPTS, 3, [200, 300], 2);
    for (const fold of report.folds) {
      expect(fold.hi).toBe(fold.lo);
      expect(fold.midpoint).toBe(fold.lo);
    }
    // And `leaking` must be DERIVED from the folds rather than asserted: the term breaks the held-out fold here, so
    // the count is at least one. A hard-coded zero would make the verdict sentence a claim instead of a measurement.
    expect(report.leaking).toBe(report.folds.filter((fold) => fold.regressed > 0).length);
    expect(report.leaking).toBeGreaterThan(0);
  });

  it('counts leaking folds, and the two verdicts say different things', () => {
    const clean = formatPlateauHoldout(
      {
        folds: [
          {
            fold: 0,
            lo: 240,
            hi: 600,
            midpoint: 420,
            heldOutNet: 11,
            heldOutCases: 278,
            regressed: 0,
          },
        ],
        heldOutNet: 11,
        heldOutCases: 278,
        leaking: 0,
      },
      { cases: 1, agreed: 1, recordedRight: 1, rebuiltRight: 1, recordedNotListed: 0 },
    );
    expect(clean).toContain('the licence the point fit could not give');
    const leaky = formatPlateauHoldout(
      {
        folds: [
          {
            fold: 3,
            lo: 200,
            hi: 200,
            midpoint: 200,
            heldOutNet: 5,
            heldOutCases: 300,
            regressed: 1,
          },
        ],
        heldOutNet: 5,
        heldOutCases: 300,
        leaking: 1,
      },
      { cases: 1, agreed: 1, recordedRight: 1, rebuiltRight: 1, recordedNotListed: 0 },
    );
    expect(leaky).toContain('does not protect every fold');
    expect(leaky).toContain('folds leaking a regressed type: 1');
  });

  it('handles a root with no services, a case with no rank-1, and an EMPTY grid', () => {
    // Three populations the plateau must survive: a root nothing can match (so the ranking has no order[0]), a case
    // whose services were never ranked (so there is no rise to read), and a grid with no candidate floor at all (so the
    // interval's lower edge has nothing to index).
    const cases = [
      kase({ datapack: 'k1', faultType: 'NetworkLoss', groundTruth: ['ghost'], services: [] }),
      kase({
        datapack: 'k2',
        faultType: 'NetworkLoss',
        groundTruth: ['source'],
        services: [svc({ serviceId: 'source' })],
      }),
    ];
    const report = holdoutPlateauReport(cases, OPTS, 3, [200, 300], 2);
    expect(report.heldOutCases).toBe(2);
    for (const fold of report.folds) expect(Number.isFinite(fold.heldOutNet)).toBe(true);

    const noGrid = holdoutPlateauReport(cases, OPTS, 3, [], 2);
    for (const fold of noGrid.folds) {
      expect(fold.lo).toBe(0);
      expect(fold.hi).toBe(0);
    }
  });

  it('renders a zero population without dividing by it, and no negative net with a plus sign', () => {
    const empty = holdoutPlateauReport([], OPTS, 3, [200, 300], 2);
    expect(empty.heldOutCases).toBe(0);
    const text = formatPlateauHoldout(empty, {
      cases: 0,
      agreed: 0,
      recordedRight: 0,
      rebuiltRight: 0,
      recordedNotListed: 0,
    });
    expect(text).toContain('0/0');
    expect(text).not.toContain('NaN');
    const negative = formatPlateauHoldout(
      {
        folds: [
          {
            fold: 0,
            lo: 240,
            hi: 600,
            midpoint: 420,
            heldOutNet: -2,
            heldOutCases: 100,
            regressed: 1,
          },
        ],
        heldOutNet: -2,
        heldOutCases: 100,
        leaking: 1,
      },
      { cases: 1, agreed: 1, recordedRight: 1, rebuiltRight: 1, recordedNotListed: 0 },
    );
    expect(negative).toContain('-2');
    expect(negative).not.toContain('+-2');
  });
});

describe('portAgreement — the engine’s predicate held to this module’s proxy', () => {
  const admitCase = (datapack: string) =>
    kase({
      datapack,
      groundTruth: ['a'],
      services: [
        svc({
          serviceId: 'a',
          predictedRank: 1,
          dominantMetric: 'http.server.request.duration',
          latRise: 500,
        }),
      ],
    });

  it('counts a case the two readings ADMIT as one agreement, and reports the admission on both sides', () => {
    const report = portAgreement([admitCase('d1')], 300);
    expect(report.cases).toBe(1);
    expect(report.benchmarkAdmits).toBe(1);
    expect(report.engineAdmits).toBe(1);
    expect(report.agreed).toBe(1);
    expect(report.mismatches).toEqual([]);
  });

  it('holds the ORACLE refusal on both sides: a resource metric at an enormous rise is refused twice', () => {
    // The mutation that would make the port a re-implementation: a rise of 999 on a CPU series. Both
    // readings must refuse, and the count is what says the engine reads the NAME too.
    const cpu = kase({
      datapack: 'd2',
      groundTruth: ['a'],
      services: [
        svc({
          serviceId: 'a',
          predictedRank: 1,
          dominantMetric: 'container_cpu_usage_seconds_total',
          latRise: 999,
        }),
      ],
    });
    const report = portAgreement([cpu], 300);
    expect(report.benchmarkAdmits).toBe(0);
    expect(report.engineAdmits).toBe(0);
    expect(report.agreed).toBe(1);
  });

  it('skips a case that names no root, because neither reading has a subject there', () => {
    const noRoot = kase({ datapack: 'd3', groundTruth: [], services: [] });
    expect(portAgreement([noRoot], 300).cases).toBe(0);
  });

  it('renders agreement BEFORE the net, and names the floor it read', () => {
    // Law 41: a reader who meets the total first has already been misled. The agreement line is
    // asserted to precede the arm's result in the rendered block, not merely to exist in it.
    const gate = deployableGateReport([admitCase('d1')], OPTS, 3, 300);
    const text = formatPortAgreement(portAgreement([admitCase('d1')], 300), gate, {
      cases: 1,
      agreed: 1,
      recordedRight: 1,
      rebuiltRight: 1,
      recordedNotListed: 0,
    });
    const lines = text.split('\n');
    const agreementAt = lines.findIndex((line) => line.includes('baseline agreement'));
    const netAt = lines.findIndex((line) => line.includes('behind that floor'));
    expect(agreementAt).toBeGreaterThan(-1);
    expect(netAt).toBeGreaterThan(agreementAt);
    expect(text).toContain('floor 300');
    expect(text).toContain('the port IS the semantics');
  });

  it('renders a zero population, a negative net and a regressed type without breaking the sentence', () => {
    // The three shapes every formatter in this module is held to: a division it must not perform, a
    // sign it must not print twice, and a residue it must name rather than summarise. The block is
    // printed on every screen, so a formatter that threw on an empty artifact would take the whole
    // discriminator section with it.
    const text = formatPortAgreement(
      {
        floor: 300,
        plateau: { lo: 240, hi: 360 },
        cases: 0,
        benchmarkAdmits: 0,
        engineAdmits: 0,
        agreed: 0,
        mismatches: [],
      },
      {
        weight: 3,
        minLatRise: 300,
        admitted: 0,
        cases: 0,
        baselineCorrect: 5,
        correct: 3,
        regressed: ['HTTPRequestDelay 2'],
      },
      { cases: 0, agreed: 0, recordedRight: 0, rebuiltRight: 0, recordedNotListed: 0 },
    );
    expect(text).toContain('0.00%');
    expect(text).toContain('(-2)');
    expect(text).not.toContain('+-2');
    expect(text).toContain('regressed types: HTTPRequestDelay 2');
    expect(text).not.toContain('NaN');
  });

  it('prints every DISAGREEMENT by datapack rather than a count, so a divergence is reproducible', () => {
    // The branch the two implementations only reach if they diverge. It is exercised by handing the
    // formatter a report that carries one, because the point of the failure text is what a reader
    // needs when a port has silently become a re-implementation.
    const text = formatPortAgreement(
      {
        floor: 300,
        plateau: { lo: 240, hi: 360 },
        cases: 2,
        benchmarkAdmits: 1,
        engineAdmits: 0,
        agreed: 1,
        mismatches: ['dp-17'],
      },
      deployableGateReport([admitCase('d1')], OPTS, 3, 300),
      { cases: 2, agreed: 2, recordedRight: 2, rebuiltRight: 2, recordedNotListed: 0 },
    );
    expect(text).toContain('DISAGREE on 1 case(s): dp-17');
    expect(text).not.toContain('the port IS the semantics');
  });
});
