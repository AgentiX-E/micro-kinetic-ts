/**
 * Unit tests for the term oracle — the module that rebuilds the engine's terms from
 * a dump and pre-screens alternative configurations offline.
 *
 * Blocks are produced by the REAL formatter and read back by the real parser, so a
 * format change fails here rather than making the oracle quietly rank nothing.
 *
 * The fixtures are RANK-CONSISTENT by default. The formatter prints `selfAnomaly` as
 * the rank-normalised value, so a hand-built block whose anomalies are not
 * `(n - 1 - i) / (n - 1)` over `n` candidates is a dump the engine could not have
 * produced — and the oracle's fidelity check, whose entire job is to notice exactly
 * that, would (correctly) flag every such fixture. Deriving the values from the
 * service order keeps the fixtures physical, leaves the fidelity assertion
 * meaningful, and is why the tests below order their services deliberately.
 *
 * @module benchmarks/__tests__/fse26-term-oracle
 */

import { describe, expect, it } from 'vitest';

import { formatFSE26Diagnostic } from '../../packages/kinetic/src/benchmarks/index.js';
import {
  computePoolMetricScores,
  DEFAULT_HTTP_DOMINANCE_THRESHOLD,
  POOL_METRIC_PREFIX,
} from '../../packages/tree/src/index.js';

import type { DiagnosedCase } from '../src/fse26-diagnose-analyze.js';
import {
  formatAnalyzeSections,
  isTop1Correct,
  parseAnalyzeArgs,
  parseDiagnosticDump,
  reconcileConfigurations,
} from '../src/fse26-diagnose-analyze.js';
import type { TermOracleOptions } from '../src/fse26-term-oracle.js';
import {
  blendScores,
  dominantFamily,
  dominantFamilyCensus,
  formatFamilyCensus,
  formatFidelity,
  formatModeScreen,
  formatOracleCensus,
  formatTermOracleReport,
  httpDominance,
  isPoolDominantLabel,
  latencySlopes,
  logSlopesForMode,
  metricSlopes,
  modeScreen,
  oracleCensus,
  oracleFidelity,
  rankCase,
  shippedRank1,
  shippedScores,
} from '../src/fse26-term-oracle.js';

const OPTS: TermOracleOptions = {
  logWeight: 1,
  latWeight: 0.561495,
  latFloor: 10.3,
  dominance: DEFAULT_HTTP_DOMINANCE_THRESHOLD,
  dominanceGrid: [0.5],
  /**
   * The pool penalty OFF. Every expectation in this file that predates the pool term
   * was written against the three-term score, so the shared fixture states that
   * ablation explicitly rather than inheriting a shipped weight those expectations
   * never saw. The pool term's own tests set their weight and say what they measure.
   */
  poolWeight: 0,
};

interface ServiceSpec {
  serviceId: string;
  /**
   * The count the engine would print, derived from the specs' own counts exactly as
   * the `logicHttp` mode computes it: `(logic + http) / max(logic + http)`.
   *
   * Derived rather than defaulted to 0, because the formatter takes the printed score
   * and the raw counts as INDEPENDENT inputs — a fixture that set the counts and left
   * this at 0 would be a block the engine never writes, and a test built on it would be
   * measuring the recorder rather than the mode. Set it explicitly only where the test
   * is about a disagreement between the two (the fidelity check counts those).
   */
  logScore?: number;
  /**
   * Defaults to the RANK-NORMALISED value implied by the spec's position, which is
   * what the producer prints. Set it only where the test is about the matcher rather
   * than about the data — a tie group, or a single candidate.
   */
  selfAnomaly?: number;
  latRise?: number;
  latEdges?: number;
  /** Onset delay in ms after injection; `-1` for the engine's "undetermined". */
  onset?: number;
  logic?: number;
  http?: number;
  /** The metric that won this service's anomaly maximum; defaults to `cpu`. */
  dominant?: string;
}

/** One diagnostic block, rendered by the real formatter. */
function block(
  specs: readonly ServiceSpec[],
  overrides: {
    datapack?: string;
    faultType?: string;
    groundTruth?: readonly string[];
    topPredictions?: readonly string[];
    injectTimeMs?: number;
  } = {},
): string {
  const n = specs.length;
  const peak = specs.reduce((max, spec) => Math.max(max, (spec.logic ?? 0) + (spec.http ?? 0)), 0);
  const services = specs.map((spec, i) => ({
    serviceId: spec.serviceId,
    metricNames: ['cpu'],
    dominantMetric: spec.dominant ?? 'cpu',
    selfAnomaly: spec.selfAnomaly ?? (n < 2 ? 1 : (n - 1 - i) / (n - 1)),
    logScore: spec.logScore ?? (peak > 0 ? ((spec.logic ?? 0) + (spec.http ?? 0)) / peak : 0),
    failedEdgeScore: 0,
    failedEdgeRecords: 0,
    latRise: spec.latRise,
    latEdges: spec.latEdges ?? 0,
    onsetDelayMs: spec.onset,
    errorCount: (spec.logic ?? 0) + (spec.http ?? 0),
    fatalCount: 0,
    logicExceptionCount: spec.logic ?? 0,
    httpExceptionCount: spec.http ?? 0,
    sampleErrorMessages: [],
    exceptionClasses: [],
    metricOutcomes: undefined,
  }));
  // The formatter sorts by anomaly, which is the order the producer's reader sees.
  // Sorting here as well keeps a fixture's `topPredictions` honest.
  services.sort((a, b) => b.selfAnomaly - a.selfAnomaly);
  return formatFSE26Diagnostic({
    datapack: overrides.datapack ?? 'dp-1',
    faultType: overrides.faultType ?? 'JVMMemoryStress',
    groundTruthServices: [...(overrides.groundTruth ?? ['ts-root'])],
    services,
    topPredictions: [...(overrides.topPredictions ?? [])],
    logSignalMode: 'logicHttp',
    ...(overrides.injectTimeMs === undefined ? {} : { injectTimeMs: overrides.injectTimeMs }),
  });
}

/** Parse one or more rendered blocks into cases. */
function casesOf(...texts: readonly string[]): DiagnosedCase[] {
  return parseDiagnosticDump(texts.join('\n'));
}

describe('latencySlopes', () => {
  it('normalises log1p(rise - 1) by the case maximum', () => {
    const slopes = latencySlopes([
      { serviceId: 'hot', latRise: 101 } as never,
      { serviceId: 'warm', latRise: 11 } as never,
    ]);
    expect(slopes.get('hot')).toBeCloseTo(1, 9);
    expect(slopes.get('warm')).toBeCloseTo(Math.log1p(10) / Math.log1p(100), 9);
  });

  it('keeps a rise at or below 1 present with magnitude 0 beside a real rise', () => {
    // The shipped identity: a collapse is credited NOTHING, not dropped — which is
    // what makes `minRise = 1` byte-identical to the shipped term. It is only when no
    // measurement carries a rise at all that the term is empty, because there is then
    // no maximum to normalise against.
    const slopes = latencySlopes([
      { serviceId: 'collapsed', latRise: 0.5 } as never,
      { serviceId: 'risen', latRise: 101 } as never,
    ]);
    expect(slopes.has('collapsed')).toBe(true);
    expect(slopes.get('collapsed')).toBe(0);
    expect(latencySlopes([{ serviceId: 'collapsed', latRise: 0.5 } as never]).size).toBe(0);
  });

  it('masks a rise strictly between 1 and the floor, reading it as unmeasured', () => {
    const services = [
      { serviceId: 'a', latRise: 5 },
      { serviceId: 'b', latRise: 100 },
    ] as never;
    expect(latencySlopes(services, 1).has('a')).toBe(true);
    expect(latencySlopes(services, 10.3).has('a')).toBe(false);
    // The mask does not move the divisor: the surviving maximum is still the case
    // maximum, so no slope is raised by deleting a competitor.
    expect(latencySlopes(services, 10.3).get('b')).toBeCloseTo(1, 9);
  });

  it('returns nothing when no measurement carries a rise', () => {
    expect(latencySlopes([]).size).toBe(0);
    expect(latencySlopes([{ serviceId: 'a', latRise: undefined } as never]).size).toBe(0);
  });
});

describe('metricSlopes', () => {
  it('gives distinct values their own rank divided by n - 1', () => {
    const slopes = metricSlopes([
      { serviceId: 'a', selfAnomaly: 1 } as never,
      { serviceId: 'b', selfAnomaly: 0.5 } as never,
      { serviceId: 'c', selfAnomaly: 0 } as never,
    ]);
    expect(slopes.get('a')).toBeCloseTo(1, 12);
    expect(slopes.get('b')).toBeCloseTo(0.5, 12);
    expect(slopes.get('c')).toBeCloseTo(0, 12);
  });

  it('gives a tie group the AVERAGE of the ranks it occupies', () => {
    // This is the reconstruction's whole content: `rankNormalizeScores` collapses a
    // tie group to its mean rank, so reading ranks off positions reports the distinct
    // ranks the engine collapsed.
    const slopes = metricSlopes([
      { serviceId: 'a', selfAnomaly: 1 } as never,
      { serviceId: 'b', selfAnomaly: 0.25 } as never,
      { serviceId: 'c', selfAnomaly: 0.25 } as never,
    ]);
    expect(slopes.get('b')).toBeCloseTo((3 - 1 - 1.5) / 2, 12);
    expect(slopes.get('c')).toBe(slopes.get('b'));
    expect(slopes.get('b')).not.toBeCloseTo(0, 3);
  });

  it('counts a candidate with an empty id in n, as the engine does', () => {
    // The unlabelled `k8s.*` row is one of the n candidates, and n is the divisor, so
    // dropping it changes every other service's metric term.
    const withRow = metricSlopes([
      { serviceId: 'a', selfAnomaly: 1 } as never,
      { serviceId: 'b', selfAnomaly: 1 } as never,
      { serviceId: '', selfAnomaly: 0 } as never,
    ]);
    expect(withRow.get('a')).toBeCloseTo(0.75, 12);
  });

  it('is independent of the array order, including inside a tie group', () => {
    const forward = metricSlopes([
      { serviceId: 'ts-a', selfAnomaly: 0.9 } as never,
      { serviceId: 'ts-b', selfAnomaly: 0.4 } as never,
    ]);
    const reversed = metricSlopes([
      { serviceId: 'ts-b', selfAnomaly: 0.4 } as never,
      { serviceId: 'ts-a', selfAnomaly: 0.9 } as never,
    ]);
    expect(reversed.get('a')).toBe(forward.get('a'));
    expect(reversed.get('b')).toBe(forward.get('b'));
    // A tie makes the comparator read the ids in BOTH directions.
    const tie = metricSlopes([
      { serviceId: 'ts-b', selfAnomaly: 0.5 } as never,
      { serviceId: 'ts-a', selfAnomaly: 0.5 } as never,
    ]);
    expect(tie.get('ts-a')).toBe(tie.get('ts-b'));
  });

  it('returns the raw score for a single candidate rather than dividing by zero', () => {
    expect(metricSlopes([{ serviceId: 'a', selfAnomaly: 0.37 } as never]).get('a')).toBe(0.37);
  });
});

describe('httpDominance', () => {
  it('is zero when no framework-HTTP line survived', () => {
    expect(httpDominance([{ httpExceptionCount: 0 } as never])).toBe(0);
  });

  it("is the top emitter's share of the flood", () => {
    expect(
      httpDominance([{ httpExceptionCount: 9 } as never, { httpExceptionCount: 1 } as never]),
    ).toBeCloseTo(0.9, 12);
  });
});

describe('logSlopesForMode', () => {
  const services = [
    { serviceId: 'src', logicExceptionCount: 0, httpExceptionCount: 8 },
    { serviceId: 'victim-a', logicExceptionCount: 0, httpExceptionCount: 1 },
    { serviceId: 'root', logicExceptionCount: 4, httpExceptionCount: 0 },
  ] as never;

  it('count mode admits logic exceptions only, against the level-1 flood', () => {
    const slopes = logSlopesForMode(services, 'count', 0.5);
    expect(slopes.has('src')).toBe(false);
    // The denominator stays the level-1 maximum (`logic + http`), not the maximum of
    // what `count` admits: 4 / 8, not 4 / 4.
    expect(slopes.get('root')).toBeCloseTo(0.5, 12);
  });

  it('logicHttp mode admits both signatures against the same denominator', () => {
    const slopes = logSlopesForMode(services, 'logicHttp', 0.5);
    expect(slopes.get('src')).toBeCloseTo(1, 12);
    expect(slopes.get('root')).toBeCloseTo(0.5, 12);
  });

  it('dominant suppresses framework HTTP when the flood is spread', () => {
    const spread = [
      { serviceId: 'a', logicExceptionCount: 0, httpExceptionCount: 1 },
      { serviceId: 'b', logicExceptionCount: 0, httpExceptionCount: 1 },
      { serviceId: 'c', logicExceptionCount: 0, httpExceptionCount: 1 },
      { serviceId: 'd', logicExceptionCount: 0, httpExceptionCount: 1 },
      { serviceId: 'e', logicExceptionCount: 0, httpExceptionCount: 1 },
      { serviceId: 'root', logicExceptionCount: 4, httpExceptionCount: 0 },
    ] as never;
    const slopes = logSlopesForMode(spread, 'dominant', 0.5);
    expect(slopes.has('a')).toBe(false);
    expect(slopes.get('root')).toBeCloseTo(1, 12);
  });

  it('keeps the level-1 denominator when the gate withdraws a flood', () => {
    // The engine's asymmetry: withdrawal can only LOWER a score and can never promote
    // a mid-tier emitter to 1.0, which is why the two maps are accumulated separately.
    const spread = [
      { serviceId: 'a', logicExceptionCount: 0, httpExceptionCount: 6 },
      { serviceId: 'b', logicExceptionCount: 0, httpExceptionCount: 6 },
      { serviceId: 'c', logicExceptionCount: 0, httpExceptionCount: 6 },
      { serviceId: 'root', logicExceptionCount: 3, httpExceptionCount: 0 },
    ] as never;
    expect(logSlopesForMode(spread, 'dominant', 0.5).get('root')).toBeCloseTo(0.5, 12);
  });

  it('treats the threshold as inclusive, matching the engine', () => {
    const even = [
      { serviceId: 'a', logicExceptionCount: 0, httpExceptionCount: 1 },
      { serviceId: 'b', logicExceptionCount: 0, httpExceptionCount: 1 },
    ] as never;
    expect(logSlopesForMode(even, 'dominant', 0.5).size).toBe(2);
    expect(logSlopesForMode(even, 'dominant', 0.5000001).size).toBe(0);
  });

  it('returns nothing when the case carries no admitted line', () => {
    expect(
      logSlopesForMode(
        [{ serviceId: 'a', logicExceptionCount: 0, httpExceptionCount: 0 } as never],
        'logicHttp',
        0.5,
      ).size,
    ).toBe(0);
  });
});

describe('rankCase', () => {
  const kase = casesOf(
    block(
      [
        { serviceId: 'ts-a', logScore: 0 },
        { serviceId: 'ts-b', logScore: 1 },
      ],
      { groundTruth: ['ts-b'], topPredictions: ['ts-b'] },
    ),
  )[0]!;

  it('ranks by the blend, and by each term alone, separately', () => {
    const rankings = rankCase(kase, OPTS, 'recorded', new Map());
    expect(rankings.order[0]).toBe('ts-b');
    expect(rankings.byTerm.metric[0]).toBe('ts-a');
    expect(rankings.byTerm.log[0]).toBe('ts-b');
    // The latency term has no evidence in this case, so its order is the id tiebreak
    // — which is what the engine would produce with only that term switched on.
    expect(rankings.byTerm.lat[0]).toBe('ts-a');
  });

  it('breaks a score tie by service id, like the engine', () => {
    const tied = casesOf(
      block([
        { serviceId: 'ts-b', selfAnomaly: 0.5 },
        { serviceId: 'ts-a', selfAnomaly: 0.5 },
      ]),
    )[0]!;
    expect(rankCase(tied, OPTS, 'recorded', new Map()).order).toEqual(['ts-a', 'ts-b']);
  });
});

describe('oracleFidelity', () => {
  it('reproduces the printed anomaly, the printed order and the run’s own rank-1', () => {
    const cases = casesOf(
      block(
        [{ serviceId: 'ts-a', http: 3 }, { serviceId: 'ts-b', http: 1 }, { serviceId: 'ts-c' }],
        { groundTruth: ['ts-a'], topPredictions: ['ts-a'] },
      ),
    );
    const fidelity = oracleFidelity(cases, OPTS);
    expect(fidelity.cases).toBe(1);
    expect(fidelity.services).toBe(3);
    expect(fidelity.metricViolations).toBe(0);
    expect(fidelity.metricMaxDeviation).toBeLessThan(5e-4);
    expect(fidelity.orderConsistent).toBe(1);
    expect(fidelity.top1Matches).toBe(1);
    expect(fidelity.top1Correct).toBe(1);
    expect(fidelity.recordedLogFlips).toBe(0);
  });

  it('notices a block whose anomalies are not rank-normalised for its own n', () => {
    // The check earns its place here: this is a block the engine cannot emit, and a
    // reader that trusted the array order instead of re-deriving it would rank it.
    const impossible = casesOf(
      block([
        { serviceId: 'ts-a', selfAnomaly: 0.9 },
        { serviceId: 'ts-b', selfAnomaly: 0.9 },
      ]),
    );
    expect(oracleFidelity(impossible, OPTS).metricViolations).toBeGreaterThan(0);
  });

  it('counts a block whose printed log score is not the count ratio', () => {
    const cases = casesOf(
      block([
        { serviceId: 'ts-a', logScore: 0.9, logic: 1 },
        { serviceId: 'ts-b', logScore: 1, logic: 10 },
      ]),
    );
    expect(oracleFidelity(cases, OPTS).recordedLogViolations).toBe(1);
  });

  it('counts a case whose rank-1 moves when the log term is re-derived', () => {
    // The instrument's error bar, stated as a number. The contract of the field is
    // that the two ORDERS differ; on the shipped dump the cause is the dump's
    // three-decimal render of a score whose counts reach thousands, and this fixture
    // reaches the same disagreement with legible numbers — the printed log scores here
    // are not the count ratios, so the reconstructed term changes the winner.
    const cases = casesOf(
      block([
        { serviceId: 'ts-a', logScore: 0.6, logic: 30 },
        { serviceId: 'ts-b', logScore: 0.6, logic: 60 },
        { serviceId: 'ts-c', logic: 0 },
      ]),
    );
    const fidelity = oracleFidelity(cases, OPTS);
    expect(fidelity.recordedLogFlips).toBe(1);
    expect(fidelity.recordedLogViolations).toBe(2);
  });
});

describe('oracleCensus', () => {
  /** The log and latency terms name the root; the metric term does not. */
  const logRight = block(
    [{ serviceId: 'ts-victim' }, { serviceId: 'ts-root', logScore: 1, latRise: 100 }],
    { datapack: 'log-right', groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
  );
  /** The metric term names the root; the log and latency terms do not. */
  const metricRight = block(
    [{ serviceId: 'ts-root' }, { serviceId: 'ts-victim', logScore: 1, latRise: 100 }],
    { datapack: 'metric-right', groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
  );

  it('tallies which terms name a root and which pairs disagree', () => {
    const census = oracleCensus(casesOf(logRight, metricRight), OPTS);
    expect(census.cases).toBe(2);
    expect(census.rootsFirst).toEqual([
      { key: 'log+lat', cases: 1 },
      { key: 'metric', cases: 1 },
    ]);
    expect(census.conflicts).toEqual([
      { key: 'log+lat beats metric', cases: 1 },
      { key: 'metric beats log+lat', cases: 1 },
    ]);
  });

  it('reports the shipped count, the single-term ceiling and the menu ceiling', () => {
    const census = oracleCensus(casesOf(logRight, metricRight), OPTS);
    // ONE, not two — and the difference is the point. `metric-right`'s recorded
    // prediction names the root, but the blend does not: the victim carries the log
    // term (1.0) and the whole latency term (0.561) against the root's metric lead of
    // `log1p(1) = 0.693`, so the configuration under study ranks the VICTIM first.
    // Reading `kase.prediction` here reported 2, i.e. it credited the blend with a
    // case the blend loses — and it did so two lines above a `menuCoverage` row that
    // names `metric only` as the only configuration covering `metric-right`. Two
    // renderings of one configuration disagreed inside one function.
    expect(census.shippedCorrect).toBe(1);
    expect(census.singleTermCeiling).toBe(2);
    expect(census.singleTermUnreachable).toBe(0);
    expect(census.menuCeiling).toBe(2);
    expect(census.rootMetricRank).toEqual(
      expect.arrayContaining([
        { key: '1', cases: 1 },
        { key: '2', cases: 1 },
      ]),
    );
  });

  it('counts a case no term names as unreachable', () => {
    // The root is last on every term, so no choice from the menu can reach it.
    const hopeless = block(
      [{ serviceId: 'ts-a', logScore: 1, latRise: 100 }, { serviceId: 'ts-root' }],
      { datapack: 'hopeless', groundTruth: ['ts-root'], topPredictions: ['ts-a'] },
    );
    const census = oracleCensus(casesOf(hopeless), OPTS);
    expect(census.rootsFirst).toEqual([{ key: 'none', cases: 1 }]);
    expect(census.singleTermUnreachable).toBe(1);
    expect(census.menuCeiling).toBe(0);
  });

  it('accepts ANY root the benchmark lists', () => {
    // The labels are a list: naming the co-located service first is correct, and a
    // census that read `groundTruth[0]` would call this case unreachable.
    const twoRoots = block([{ serviceId: 'ts-order-service' }, { serviceId: 'mysql' }], {
      datapack: 'two-roots',
      groundTruth: ['mysql', 'ts-order-service'],
      topPredictions: ['ts-order-service'],
    });
    const census = oracleCensus(casesOf(twoRoots), OPTS);
    expect(census.shippedCorrect).toBe(1);
    expect(census.singleTermUnreachable).toBe(0);
  });

  it('counts the CONFIGURATION UNDER STUDY, not the dump the dump was recorded at', () => {
    // The two-instrument check that found the defect: on a 1422-case dump the census
    // printed `shipped 750` while the mode pre-screen on the same page printed
    // `baseline recorded: 756`, because the census read `kase.prediction` and the
    // pre-screen ranked the modelled score. Both are "the shipped configuration's
    // Top@1" and only one of them can be right, so the two must agree — and they
    // agree with the reconciliation the miss report prints, which is a third reader.
    const cases = casesOf(logRight, metricRight);
    const census = oracleCensus(cases, OPTS);
    expect(census.shippedCorrect).toBe(modeScreen(cases, OPTS).rows[0]!.correct);
    expect(census.shippedCorrect).toBe(
      reconcileConfigurations(cases, {
        logWeight: OPTS.logWeight,
        latWeight: OPTS.latWeight,
        latFloor: OPTS.latFloor,
        poolWeight: OPTS.poolWeight,
      }).modelledCorrect,
    );
    // And it is NOT the recorded count: the dump's own ranking gets both cases right.
    expect(cases.every((kase) => isTop1Correct(kase))).toBe(true);
    expect(census.shippedCorrect).toBe(1);
  });

  it('agrees with the recorded count when the flags are the dump’s own', () => {
    // The property that makes the change above safe: a faithful reconstruction's
    // order IS the recorded order, so nothing measured at the dump's own
    // configuration can move because `shippedCorrect` now ranks the score.
    const cases = casesOf(
      block([{ serviceId: 'ts-root' }, { serviceId: 'ts-victim' }], {
        datapack: 'own-config',
        topPredictions: ['ts-root'],
      }),
    );
    const fidelity = oracleFidelity(cases, OPTS);
    expect(fidelity.top1Matches).toBe(fidelity.cases);
    expect(oracleCensus(cases, OPTS).shippedCorrect).toBe(1);
  });

  it('skips a case with no acceptable root and survives one with no service rows', () => {
    // A case the benchmark did not label cannot be scored at all, and one whose dump
    // carried no rows has no order to read: both must leave the tally untouched rather
    // than contribute to a denominator.
    const unlabelled = block([{ serviceId: 'ts-a' }], { datapack: 'unlabelled', groundTruth: [] });
    const empty = block([], { datapack: 'empty', groundTruth: ['ts-root'] });
    const census = oracleCensus(casesOf(unlabelled, empty), OPTS);
    expect(census.cases).toBe(1);
    expect(census.rootsFirst).toEqual([{ key: 'none', cases: 1 }]);
    expect(census.rootMetricRank).toEqual([]);
  });
});

describe('modeScreen', () => {
  it('compares every row against the recorded log term, per fault type', () => {
    // Two cases of one fault type. The recorded term names the root in both; the
    // logic-only term loses the second one, where the root's only signature is the
    // framework-HTTP half `count` does not admit. The row must report one regressed
    // CASE and name the fault TYPE — the shared kill criterion asks about types.
    const a = block(
      [
        { serviceId: 'ts-root', logScore: 0.6, logic: 5, http: 4 },
        { serviceId: 'ts-victim', logic: 1 },
      ],
      {
        datapack: 'a',
        faultType: 'NetworkLoss',
        groundTruth: ['ts-root'],
        topPredictions: ['ts-root'],
      },
    );
    const b = block(
      [
        { serviceId: 'ts-root', logScore: 0.6, http: 4 },
        { serviceId: 'ts-victim', logic: 9 },
      ],
      {
        datapack: 'b',
        faultType: 'NetworkLoss',
        groundTruth: ['ts-root'],
        topPredictions: ['ts-root'],
      },
    );
    const screen = modeScreen(casesOf(a, b), OPTS);
    const recorded = screen.rows[0]!;
    const count = screen.rows[1]!;
    expect(recorded.source).toBe('recorded');
    expect(recorded.correct).toBe(2);
    expect(recorded.regressedTypes).toEqual([]);
    expect(count.source).toBe('count');
    expect(count.correct).toBe(1);
    expect(count.gainedCases).toBe(0);
    expect(count.regressedCases).toBe(1);
    expect(count.regressedTypes).toEqual([{ key: 'NetworkLoss', cases: -1 }]);
    // The grid's rows are present, in the grid's order, and labelled by threshold.
    expect(screen.rows.map((row) => row.dominance)).toEqual([undefined, undefined, undefined, 0.5]);
    expect(screen.rows.at(-1)!.source).toBe('dominant');
  });

  it('skips a case with no acceptable root', () => {
    const noRoot = block([{ serviceId: 'ts-a' }], { groundTruth: [], datapack: 'no-root' });
    expect(modeScreen(casesOf(noRoot), OPTS).rows[0]!.perFaultType).toEqual([]);
  });

  it('reads the threshold on the ROW, so a sweep point can change the answer', () => {
    // The bug this pins: the renderer built one row per grid point and computed every
    // one of them at the options' threshold, so a sweep printed identical rows and read
    // as a plateau the mode does not have. Here the root wins only on the framework-HTTP
    // half (it is second on the metric), and the flood is spread over three emitters —
    // dominance 1/3, admitted at 0.2 and withdrawn at 0.5.
    const spread = block(
      [
        { serviceId: 'ts-victim' },
        { serviceId: 'ts-root', http: 1 },
        { serviceId: 'ts-e2', http: 1 },
        { serviceId: 'ts-e3', http: 1 },
      ],
      { datapack: 'spread', groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
    );
    const screen = modeScreen(casesOf(spread), { ...OPTS, dominanceGrid: [0.2, 0.5] });
    const atPointTwo = screen.rows.find((row) => row.dominance === 0.2)!;
    const atHalf = screen.rows.find((row) => row.dominance === 0.5)!;
    expect(atPointTwo.correct).toBe(1);
    expect(atHalf.correct).toBe(0);
    expect(atHalf.regressedCases).toBe(1);
    expect(atHalf.regressedTypes).toEqual([{ key: 'JVMMemoryStress', cases: -1 }]);
  });

  it('counts a fault type a mode GAINS, and scores a case whose service list is empty', () => {
    // The gain arm is the one the pre-screen exists for: a mode that only ever lost
    // cases would never need a per-type tally. A case with a root but NO parsed rows
    // must still be scored rather than skipped — it is a real case whose dump carried
    // no services, and skipping it would inflate every other row's ratio.
    const gain = block(
      [
        { serviceId: 'ts-victim', logScore: 0.8 },
        { serviceId: 'ts-root', logic: 9 },
      ],
      {
        datapack: 'gain',
        faultType: 'NetworkLoss',
        groundTruth: ['ts-root'],
        topPredictions: ['ts-victim'],
      },
    );
    const empty = block([], { datapack: 'empty', groundTruth: ['ts-root'] });
    // A third fault type, neutral in both modes: the per-type table is SORTED, and two
    // rows only ever exercise one arm of its comparator.
    const neutral = block([{ serviceId: 'ts-root', logic: 3 }, { serviceId: 'ts-victim' }], {
      datapack: 'neutral',
      faultType: 'PodKill',
      groundTruth: ['ts-root'],
      topPredictions: ['ts-root'],
    });
    const screen = modeScreen(casesOf(gain, empty, neutral), OPTS);
    expect(screen.rows[0]!.correct).toBe(1);
    expect(screen.rows[0]!.perFaultType.map((row) => row.key)).toEqual([
      'JVMMemoryStress',
      'NetworkLoss',
      'PodKill',
    ]);
    const count = screen.rows[1]!;
    expect(count.correct).toBe(2);
    expect(count.gainedCases).toBe(1);
    expect(count.gainedTypes).toEqual([{ key: 'NetworkLoss', cases: 1 }]);
    expect(count.regressedTypes).toEqual([]);
  });
});

describe('dominantFamilyCensus', () => {
  it('buckets the two variants of one duration series into one family', () => {
    // A classifier keyed on the FULL name splits `http.server.request.duration` from
    // its `.max` variant, which turns one separation into two that look like noise.
    expect(dominantFamily('http.server.request.duration')).toBe('http.server.duration');
    expect(dominantFamily('http.server.request.duration.max')).toBe('http.server.duration');
    expect(dominantFamily('hubble_http_request_duration_p99_seconds')).toBe('hubble_http');
    expect(dominantFamily('')).toBe('none');
  });

  it('returns an unclassified series as its OWN name rather than pooling it', () => {
    // An `other` bucket would hide exactly the series a reader needs to notice.
    expect(dominantFamily('someNewSeries')).toBe('someNewSeries');
  });

  it('counts the source and the wrong winner per family, over the misses only', () => {
    const miss = block([{ serviceId: 'ts-winner' }, { serviceId: 'ts-root' }], {
      datapack: 'miss',
      groundTruth: ['ts-root'],
      topPredictions: ['ts-winner'],
    });
    const hit = block([{ serviceId: 'ts-root' }], {
      datapack: 'hit',
      groundTruth: ['ts-root'],
      topPredictions: ['ts-root'],
    });
    const cells = dominantFamilyCensus(casesOf(miss, hit));
    // Both rows carry the fixture's `cpu` dominant, so the same family appears on both
    // sides of the one miss — and the correctly-ranked case contributes nothing.
    expect(cells).toEqual([{ key: 'cpu', source: 1, winner: 1 }]);
    expect(formatFamilyCensus(cells)).toContain('+0');
  });

  it('renders an empty census rather than a table with no body', () => {
    expect(formatFamilyCensus([])).toContain('no miss carries both');
  });

  it('orders two families of equal weight by name, deterministically', () => {
    // The tie-break arm: three families with the same peak count must not swap between
    // runs, or a report cannot be diffed against the one it replaces. Three, not two:
    // a two-element sort only ever compares the pair in one order.
    const mk = (tag: string, dominant: string) =>
      block(
        [
          { serviceId: `ts-w${tag}`, dominant },
          { serviceId: `ts-r${tag}`, dominant },
        ],
        { datapack: tag, groundTruth: [`ts-r${tag}`], topPredictions: [`ts-w${tag}`] },
      );
    const cells = dominantFamilyCensus(
      casesOf(
        // Fed in ASCENDING family order, so the sort meets a comparison in both
        // directions; the reverse order only ever exercises one arm.
        mk('c', 'container.cpu.usage'),
        mk('b', 'jvm.system.cpu.load_1m'),
        mk('a', 'k8s.pod.phase'),
      ),
    );
    expect(cells.map((cell) => cell.key)).toEqual(['container', 'jvm', 'k8s']);
  });

  it('reports a family that appears on ONLY one side, and a signed delta', () => {
    // The `?? 0` arms: a family the source owns and the winner never does is exactly
    // the shape a candidate rule would exploit, so the census must render it as
    // `winner 0` rather than dropping the row.
    const sourceOnly = block(
      [
        { serviceId: 'ts-w', dominant: 'http.client.request.duration.max' },
        { serviceId: 'ts-r', dominant: 'k8s.pod.phase' },
      ],
      { datapack: 'source-only', groundTruth: ['ts-r'], topPredictions: ['ts-w'] },
    );
    const cells = dominantFamilyCensus(casesOf(sourceOnly));
    // Ordered by the larger side, descending — a tie here — then by name.
    expect(cells).toEqual([
      { key: 'http.client.duration', source: 0, winner: 1 },
      { key: 'k8s', source: 1, winner: 0 },
    ]);
    const text = formatFamilyCensus(cells);
    expect(text).toContain('+1');
    expect(text).toContain('-1');
  });

  it('skips a miss whose winner has no row in its own dump', () => {
    // A prediction naming a service the block does not describe cannot be censused;
    // counting it would attribute the miss to a family the case never reported.
    const ghost = block([{ serviceId: 'ts-root', dominant: 'k8s.pod.phase' }], {
      datapack: 'ghost',
      groundTruth: ['ts-root'],
      topPredictions: ['ts-not-in-the-block'],
    });
    expect(dominantFamilyCensus(casesOf(ghost))).toEqual([]);
  });
});

describe('formatters', () => {
  const cases = casesOf(
    block([{ serviceId: 'ts-victim' }, { serviceId: 'ts-root', logScore: 1 }], {
      groundTruth: ['ts-root'],
      topPredictions: ['ts-root'],
    }),
  );

  it('labels every row of the mode screen with its pass or fail', () => {
    const text = formatModeScreen(modeScreen(cases, OPTS));
    expect(text).toContain('PASSES the second half');
    expect(text).toContain('baseline recorded');
  });

  it('prints the configuration and the error bar with the fidelity numbers', () => {
    const text = formatFidelity(oracleFidelity(cases, OPTS), OPTS);
    expect(text).toContain('logWeight=1 latWeight=0.561495 latFloor=10.3');
    expect(text).toContain('error bar');
    expect(text).toContain('rank-1 same as the dump’s own recorded: 1/1 cases');
    // The caveat prints with the number, because the number alone is ambiguous: a
    // shortfall means "the flags are not the dump's configuration" OR "the
    // reconstruction drifted", and only a reader who knows which can act on it.
    expect(text).toContain('CONFIGURATION moving the winner');
  });

  it('prints the ceilings and the conflicts', () => {
    const text = formatOracleCensus(oracleCensus(cases, OPTS), OPTS);
    expect(text).toContain('single-term ceiling');
    expect(text).toContain('menu ceiling');
    expect(text).toContain('conflicts');
    expect(text).toContain('metric rank of a root');
  });

  it('renders the whole section behind its own flag', () => {
    const text = formatTermOracleReport(cases, 'dump.txt', OPTS);
    expect(text).toContain('Term oracle — dump.txt');
    expect(text).toContain('Instrument fidelity');
    expect(text).toContain('Log-term mode pre-screen');
  });

  it('prints n/a rather than a division by zero for an empty dump', () => {
    // A dump with no blocks is a real input (a `--diagnose` selection that matched
    // nothing) and a report that printed `NaN%` would look like a measured result.
    const text = formatOracleCensus(oracleCensus([], OPTS), OPTS);
    expect(text).toContain('n/a');
    expect(text).not.toContain('NaN');
  });
});

describe('isPoolDominantLabel — the instrument’s rule agrees with the engine’s', () => {
  it('classifies label for label exactly what the engine classifies', () => {
    // The PREFIX is imported from the engine, but the RULE (starts-with it) is
    // restated here, so it is validated against the engine's own classifier instead
    // of being assumed. A screen that penalises a different family than the engine
    // does is a screen that validates nothing — and the failure would be silent,
    // because both sides would keep producing numbers.
    const labels = [
      `${POOL_METRIC_PREFIX}use_time.max`,
      `${POOL_METRIC_PREFIX}wait_time.max`,
      `${POOL_METRIC_PREFIX}timeouts`,
      POOL_METRIC_PREFIX.replace(/\.$/, ''),
      `${POOL_METRIC_PREFIX.replace(/\.$/, '')}Total`,
      'container.cpu.usage',
      'http.client.request.duration.max',
      '',
    ];
    const ids = labels.map((_, index) => `svc-${index}`);
    const engine = computePoolMetricScores(
      new Map(ids.map((id, index) => [id, { label: labels[index]!, head: [1], tail: [2] }])),
      new Set(ids),
    );

    for (let index = 0; index < labels.length; index++) {
      expect(isPoolDominantLabel(labels[index]!)).toBe(engine.get(ids[index]!) === 1);
    }
    // The rule is not vacuous in either direction.
    expect(labels.filter((label) => isPoolDominantLabel(label))).toHaveLength(3);
  });
});

describe('blendScores — the score the engine ranks by', () => {
  const poolCase = (): DiagnosedCase =>
    casesOf(
      block([
        { serviceId: 'ts-pool', selfAnomaly: 0.9, dominant: `${POOL_METRIC_PREFIX}use_time.max` },
        { serviceId: 'ts-cpu', selfAnomaly: 0.4, dominant: 'container.cpu.usage' },
      ]),
    )[0]!;

  it('subtracts exactly the pool weight from the pool-dominant service, and nobody else', () => {
    const kase = poolCase();
    const off = blendScores(kase, OPTS, 'recorded', new Map());
    const on = blendScores(kase, { ...OPTS, poolWeight: 0.25 }, 'recorded', new Map());

    expect(off.get('ts-pool')! - on.get('ts-pool')!).toBeCloseTo(0.25, 12);
    expect(on.get('ts-cpu')).toBeCloseTo(off.get('ts-cpu')!, 12);
  });

  it('does not penalise a service whose dominant metric is ABSENT', () => {
    // Absence must not become the punished state — the same rule the engine keeps.
    // Subtracting from a service the engine never measured would be a fabricated
    // finding, and it would grow with the weight.
    const kase = casesOf(block([{ serviceId: 'ts-plain', selfAnomaly: 0.7, dominant: '' }]))[0]!;
    const off = blendScores(kase, OPTS, 'recorded', new Map());
    const on = blendScores(kase, { ...OPTS, poolWeight: 0.25 }, 'recorded', new Map());

    expect(on.get('ts-plain')).toBe(off.get('ts-plain'));
  });
});

describe('rankCase — the pool term is part of the shipped blend', () => {
  it('flips the blend when the penalty outweighs the metric gap', () => {
    const kase = casesOf(
      block([
        { serviceId: 'ts-pool', selfAnomaly: 0.9, dominant: `${POOL_METRIC_PREFIX}use_time.max` },
        { serviceId: 'ts-cpu', selfAnomaly: 0.4, dominant: 'container.cpu.usage' },
      ]),
    )[0]!;

    expect(rankCase(kase, OPTS, 'recorded', new Map()).order[0]).toBe('ts-pool');
    expect(rankCase(kase, { ...OPTS, poolWeight: 0.8 }, 'recorded', new Map()).order[0]).toBe(
      'ts-cpu',
    );
  });
});

describe('oracleFidelity — the term the dump’s own run had on', () => {
  it('counts the cases whose rank-1 the penalty moves, and only those', () => {
    // Two cases in one dump: in the first the penalty overtakes the pool-dominant
    // leader, in the second the pool-dominant service is already last so the penalty
    // cannot reorder anything. One flip, not two.
    const moved = block(
      [
        { serviceId: 'ts-pool', selfAnomaly: 0.9, dominant: `${POOL_METRIC_PREFIX}use_time.max` },
        { serviceId: 'ts-cpu', selfAnomaly: 0.4, dominant: 'container.cpu.usage' },
      ],
      { datapack: 'moved' },
    );
    const still = block(
      [
        { serviceId: 'ts-cpu', selfAnomaly: 0.9, dominant: 'container.cpu.usage' },
        { serviceId: 'ts-pool', selfAnomaly: 0.4, dominant: `${POOL_METRIC_PREFIX}use_time.max` },
      ],
      { datapack: 'still' },
    );
    const cases = casesOf(moved, still);

    expect(oracleFidelity(cases, { ...OPTS, poolWeight: 0.8 }).poolFlips).toBe(1);
    expect(oracleFidelity(cases, OPTS).poolFlips).toBe(0);
  });
});

describe('shippedScores — one entry point for the score the engine ranks by', () => {
  it('is the blend at the same configuration, with the RECORDED log term', () => {
    // A wrapper is only worth having if it agrees with what it wraps: the mode pre-screen
    // needs a log source and a dominance grid, and a caller asking "what does the engine
    // score this case at" must not have to guess either. If they ever disagree, this
    // test fails before a screen reports a window solved against the wrong base.
    const kase = casesOf(
      block([
        { serviceId: 'ts-a', selfAnomaly: 0.9, logScore: 0.5 },
        { serviceId: 'ts-b', selfAnomaly: 0.4, logScore: 0.1, dominant: 'k8s.pod.phase' },
      ]),
    )[0]!;
    const weights = { logWeight: 1, latWeight: 0, latFloor: 1, poolWeight: 0.25 };

    const scores = shippedScores(kase, weights);
    const blended = blendScores(kase, { ...OPTS, ...weights }, 'recorded', new Map());

    expect([...scores.keys()].sort()).toEqual([...blended.keys()].sort());
    for (const [serviceId, score] of scores) {
      expect(score).toBeCloseTo(blended.get(serviceId)!, 12);
    }
  });
});

describe('shippedRank1 — one owner of "who the modelled score puts first"', () => {
  it('breaks a tie the way the ENGINE breaks it', () => {
    // Two orders for one score is how a report printed 750, 756 and 672 for one run:
    // the census read the recorded array, the pre-screen ranked the score, and the
    // reconciliation would have invented a third `argmax`. The tiebreak is part of
    // the tie — a different one is a different prediction, not a rounding detail.
    const kase = casesOf(
      block([
        { serviceId: 'ts-b', selfAnomaly: 0.5 },
        { serviceId: 'ts-a', selfAnomaly: 0.5 },
      ]),
    )[0]!;
    expect(shippedRank1(kase, { logWeight: 1, latWeight: 0, latFloor: 1, poolWeight: 0 })).toBe(
      'ts-a',
    );
  });

  it('returns undefined for a case with no candidates rather than a fabricated name', () => {
    // An absent rank-1 is a case the dump cannot score; naming anything would turn
    // "not measured" into a prediction and could silently count as a miss.
    const kase = casesOf(block([], { datapack: 'no-services' }))[0]!;
    expect(
      shippedRank1(kase, { logWeight: 1, latWeight: 0, latFloor: 1, poolWeight: 0 }),
    ).toBeUndefined();
  });
});

describe('--onset-screen wiring', () => {
  it('is a switch, maps to its section kind, and still needs the log weight', () => {
    // Same contract as every other reconstruction: a switch whose kebab name does not
    // map to a section kind is accepted and never rendered, which is indistinguishable
    // from a section with nothing to say.
    expect(() => parseAnalyzeArgs(['--dump', 'd.txt', '--onset-screen'])).toThrow(/log-weight/);
    const opts = parseAnalyzeArgs(['--dump', 'd.txt', '--onset-screen', '--log-weight', '1']);
    expect(opts.kind).toBe('dump');
    const requested = opts.kind === 'dump' ? opts.sections.map((section) => section.kind) : [];
    expect(requested).toEqual(['onsetScreen']);
  });

  it('renders its section from the parsed dump, carrying its own configuration', () => {
    // The section is data, so this is the only place that proves the parsed dump and
    // the flag meet: the availability line cannot be printed from a dump that never
    // carried an onset, and the report says so rather than solving an empty window.
    const text = block(
      [
        { serviceId: 'ts-src', onset: 0 },
        { serviceId: 'ts-win', onset: 60000 },
      ],
      {
        datapack: 'onset-wiring',
        groundTruth: ['ts-src'],
        topPredictions: ['ts-win'],
        injectTimeMs: 1_700_000_000_000,
      },
    );
    const opts = parseAnalyzeArgs([
      '--dump',
      'd.txt',
      '--onset-screen',
      '--log-weight',
      '1',
      '--lat-weight',
      '0',
    ]);
    const report = formatAnalyzeSections(parseDiagnosticDump(text), 'header.txt', opts as never);

    expect(report).toContain('Temporal (onset) screen');
    expect(report).toMatch(/with an injection anchor 1/);
  });
});

describe('--term-oracle wiring', () => {
  it('is a switch, maps to its section kind, and still needs the log weight', () => {
    // A switch whose kebab name does not map to a section kind is accepted and never
    // rendered, which is indistinguishable from a section with nothing to say.
    expect(() => parseAnalyzeArgs(['--dump', 'd.txt', '--term-oracle'])).toThrow(/log-weight/);
    const opts = parseAnalyzeArgs(['--dump', 'd.txt', '--term-oracle', '--log-weight', '1']);
    expect(opts.kind).toBe('dump');
    if (opts.kind !== 'dump') throw new Error('unreachable');
    expect(opts.sections.map((s) => s.kind)).toEqual(['termOracle']);
  });

  it('renders its section from the parsed dump, carrying its own configuration', () => {
    const cases = casesOf(
      block([{ serviceId: 'ts-root' }], { groundTruth: ['ts-root'], topPredictions: ['ts-root'] }),
    );
    const text = formatAnalyzeSections(cases, 'dump.txt', {
      kind: 'dump',
      dump: 'dump.txt',
      family: undefined,
      sections: [
        {
          kind: 'termOracle',
          logWeight: 1,
          latWeight: 0.561495,
          latFloor: 10.3,
          poolWeight: 0,
        },
      ],
      slope: 'lat',
      output: undefined,
    });
    expect(text).toContain('Term oracle — dump.txt');
    expect(text).toContain('Log-term mode pre-screen');
    expect(text).toContain('logWeight=1 latWeight=0.561495 latFloor=10.3');
  });
});
