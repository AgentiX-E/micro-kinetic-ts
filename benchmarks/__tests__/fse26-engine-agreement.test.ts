/**
 * The engine-agreement instrument: does the reconstruction reproduce the run it is analysing?
 *
 * Four iterations of screens reported their reconstruction's total as "shipped". This module is the check that makes
 * that claim falsifiable, so its own behaviour has to be pinned: what counts as an agreement, what a case the dump
 * cannot resolve does, and how the verdict is stated.
 *
 * @module benchmarks/__tests__/fse26-engine-agreement
 */

import { describe, expect, it } from 'vitest';

import type { DiagnosedCase, DiagnosedService } from '../src/fse26-diagnose-analyze.js';
import {
  agreementVerdict,
  engineAgreement,
  formatAgreementReport,
} from '../src/fse26-engine-agreement.js';
import type { TermOracleOptions } from '../src/fse26-term-oracle.js';

const OPTS: TermOracleOptions = {
  logWeight: 1,
  latWeight: 0.561495,
  latFloor: 10.3,
  dominance: 0.5,
  dominanceGrid: [],
  poolWeight: 0.0679,
  temporalWeight: 0,
  onsetShape: 'earliness',
};

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
    faultType: 'cpu',
    groundTruth: [],
    logSignalMode: 'count',
    prediction: [],
    edges: undefined,
    injectTimeMs: undefined,
    fieldDecimals: undefined,
    ...o,
  };
}

/**
 * Two services where the reconstruction's choice was MEASURED, not assumed: with `a` at anomaly 1000 / log 0 and `b`
 * at anomaly 1 / log 50, the blend names `b` (the log term's magnitude decides) and never `a`. So `prediction: ['a']`
 * is a run the reconstruction does not reproduce, and `prediction: ['b']` is one it does.
 */
const services = () => [
  svc({ serviceId: 'a', selfAnomaly: 1000, logScore: 0 }),
  svc({ serviceId: 'b', selfAnomaly: 1, logScore: 50 }),
];

describe('engineAgreement', () => {
  it('counts a case the reconstruction reproduces, and counts it right for both sides', () => {
    const report = engineAgreement(
      [kase({ services: services(), groundTruth: ['b'], prediction: ['b'] })],
      OPTS,
    );
    expect(report.cases).toBe(1);
    expect(report.agreed).toBe(1);
    expect(report.recordedRight).toBe(1);
    expect(report.rebuiltRight).toBe(1);
    expect(agreementVerdict(report)).toBe('reproduces');
  });

  it('counts a case it does NOT reproduce, and keeps the two accuracies apart', () => {
    // The recorded run named `a`; the reconstruction names `b`. The truth is `a`, so the ENGINE is right and the
    // reconstruction is wrong — which is precisely the situation the six-case gap on the real corpus has.
    const report = engineAgreement(
      [kase({ services: services(), groundTruth: ['a'], prediction: ['a'] })],
      OPTS,
    );
    expect(report.agreed).toBe(0);
    expect(report.recordedRight).toBe(1);
    expect(report.rebuiltRight).toBe(0);
    expect(agreementVerdict(report)).toBe('differs');
  });

  it('counts a recorded rank-1 the block does not list, instead of silently scoring it wrong', () => {
    const report = engineAgreement(
      [kase({ services: services(), groundTruth: ['ghost'], prediction: ['ghost'] })],
      OPTS,
    );
    expect(report.recordedNotListed).toBe(1);
    // `ghost` is the truth, so the recorded side is right even though no row describes it — the engine named it and
    // the hit rule only asks whether the label matches.
    expect(report.recordedRight).toBe(1);
    // The reconstruction cannot name a service it has no row for, so this is a disagreement by construction.
    expect(report.agreed).toBe(0);
  });

  it('treats an EMPTY prediction as no recorded ranking, and never as an unlisted service', () => {
    // A block whose `prediction=` line is empty leaves `recorded` as `''`. It must not be reported as naming a service
    // the block does not list (that count is about a service the engine named and the dump did not describe), and it
    // can never agree with a reconstruction that does name one.
    const report = engineAgreement(
      [kase({ services: services(), groundTruth: ['b'], prediction: [] })],
      OPTS,
    );
    expect(report.cases).toBe(1);
    expect(report.recordedNotListed).toBe(0);
    expect(report.agreed).toBe(0);
    expect(report.recordedRight).toBe(0);
    expect(report.rebuiltRight).toBe(1);
  });

  it('excludes a case that names no root, like every other population in this record', () => {
    const report = engineAgreement(
      [kase({ services: services(), groundTruth: [], prediction: ['a'] })],
      OPTS,
    );
    expect(report.cases).toBe(0);
    expect(report.agreed).toBe(0);
  });
});

describe('agreementVerdict', () => {
  it('has exactly two outcomes, and total agreement is the boundary', () => {
    const base = { cases: 10, recordedRight: 5, rebuiltRight: 5, recordedNotListed: 0 };
    expect(agreementVerdict({ ...base, agreed: 10 })).toBe('reproduces');
    // One missed case is a DIFFERENT blend wearing the engine's name, however close — there is no "mostly".
    expect(agreementVerdict({ ...base, agreed: 9 })).toBe('differs');
  });
});

describe('formatAgreementReport', () => {
  const base = { cases: 100, recordedRight: 50, rebuiltRight: 50, recordedNotListed: 0 };

  it('states both accuracies and the verdict', () => {
    const text = formatAgreementReport({ ...base, agreed: 100 }, 'at the defaults');
    expect(text).toContain('Engine agreement [at the defaults]');
    expect(text).toContain('REPRODUCES');
    expect(text).toContain('recorded 50, reconstruction 50');
  });

  it('and says what a disagreement costs the screens below it', () => {
    const text = formatAgreementReport({ ...base, agreed: 92 }, 'at the defaults');
    expect(text).toContain('DIFFERS');
    expect(text).toContain('not the engine');
    // The qualifier is only printed when it applies: a reproducing reconstruction owes no disclaimer.
    expect(formatAgreementReport({ ...base, agreed: 100 }, 'x')).not.toContain('not the engine');
  });

  it('reports a ZERO population without dividing by it', () => {
    // An empty population "agrees" vacuously, so the verdict reads REPRODUCES — which is why the counts are printed
    // beside it. The one thing that must not happen is a division by zero rendering `NaN`.
    const text = formatAgreementReport(
      { cases: 0, agreed: 0, recordedRight: 0, rebuiltRight: 0, recordedNotListed: 0 },
      'empty',
    );
    expect(text).toContain('0/0 cases (0.00%)');
    expect(text).not.toContain('NaN');
  });

  it('mentions an unlisted recorded rank-1 only when there is one', () => {
    expect(formatAgreementReport({ ...base, agreed: 100 }, 'x')).not.toContain('unlisted');
    expect(formatAgreementReport({ ...base, agreed: 100, recordedNotListed: 3 }, 'x')).toContain(
      'unlisted service on 3',
    );
  });
});
