/**
 * Unit tests for the FSE'26 structured result summary.
 *
 * The summary is the machine-readable half of a run: the CI workflow uploads it
 * as an artifact and every downstream reader works from it. These tests pin the
 * property that made it untrustworthy — the artifact did not carry the
 * configuration that produced its numbers.
 *
 * The concrete case: the 47.3% (`logicHttp`) and 23.1% (`count`) runs of
 * 2026-09-11 published an IDENTICAL `config` block,
 * `{"logWeight":1,"rankNormalization":true}`, because both fields that differ
 * were missing from it. Two artifacts 24.2pp apart could not be told apart.
 *
 * @module benchmarks/__tests__/fse26-report
 */

import { describe, expect, it } from 'vitest';

// The threshold's default, READ from its owner rather than restated: a test that hard-coded 20 would keep
// passing after the engine's default moved, and the line it guards would then describe a run nobody made.
import { ANOMALY_NORMALIZE_NODE_THRESHOLD } from '../../packages/tree/src/index.js';

import type { FSE26RunConfig } from '../src/fse26-report.js';
import {
  buildFSE26Report,
  formatFailedEdgeCoverageLine,
  formatFSE26ConfigLine,
  missingReportedConfigFields,
  REPORTED_CONFIG_FIELDS,
  summariseFailedEdgeCoverage,
} from '../src/fse26-report.js';

const ANCHOR = { sotaAvgTop1: 0.21, sotaBestTop1: 0.37 };

function makeConfig(overrides: Partial<FSE26RunConfig> = {}): FSE26RunConfig {
  return {
    logWeight: 1,
    logSignalMode: 'logicHttp',
    rankNormalization: true,
    anomalyNormalizeNodeThreshold: ANOMALY_NORMALIZE_NODE_THRESHOLD,
    // Shipped composition. The four are REQUIRED fields rather than optional ones so that a test fixture
    // cannot omit them: an optional field here is a fixture that silently describes a different engine.
    anomalyTrendWeight: 0.15,
    anomalyBurstWeight: 0.1,
    anomalyCvWeight: 0.05,
    // The SHIPPED pair, so this fixture describes the engine a default run builds — an enrolment is two
    // numbers and a fixture frozen at the pre-enrolment zeroes would describe an engine nobody runs.
    anomalyBreadthWeight: 0.05,
    anomalyBreadthGate: 0.8,
    dropMetrics: [],
    metricRiseCeiling: 0,
    metricFleetBaseline: false,
    failedEdgeWeight: 0,
    failedEdgeMode: 'sum',
    failedEdgeMinRecords: 1,
    latWeight: 0,
    latMinRise: 1,
    poolMetricPenaltyWeight: 0,
    stabilityWeight: 0,
    selfTimeWeight: 0,
    temporalWeight: 0,
    onsetShape: 'earliness',
    // The eight the mirror made reachable on this half, all at their SHIPPED values — which is what makes
    // this fixture the published configuration rather than a configuration nobody ran.
    traceWeight: 0,
    topoWeight: 0,
    collisionWeight: 0,
    prismWeight: 0,
    prismPooling: 'additive',
    collapseDiscount: 0,
    suppressIdleTransients: false,
    suppressNearZeroBaselineRise: false,
    // The demand guard's SHIPPED pole, so this fixture remains the published configuration.
    suppressDemandMetrics: true,
    ...overrides,
  };
}

function makeReport(overrides: Partial<Parameters<typeof buildFSE26Report>[0]> = {}) {
  return buildFSE26Report({
    anchor: ANCHOR,
    config: makeConfig(),
    cases: 1422,
    top1: 0.4732770745428973,
    top3: 0.6068917018284107,
    top5: 0.6575246132208158,
    loadErrors: 0,
    engineErrors: 0,
    emptyGraphs: 0,
    perFaultType: new Map([
      ['HTTPResponseReplaceCode', { total: 231, correct: 159 }],
      ['JVMMemoryStress', { total: 171, correct: 4 }],
      ['HTTPRequestReplaceMethod', { total: 190, correct: 123 }],
    ]),
    ...overrides,
  });
}

describe('FSE26 report — attribution', () => {
  it('carries every field that can change the number', () => {
    const report = makeReport();
    for (const field of REPORTED_CONFIG_FIELDS) {
      expect(report.config[field]).toBeDefined();
    }
    // Spot-check the value, not just its presence.
    expect(report.config.logSignalMode).toBe('logicHttp');
  });

  it('reports nothing missing for a complete configuration', () => {
    expect(missingReportedConfigFields(makeConfig())).toEqual([]);
  });

  it('detects the exact configuration block the two published runs carried', () => {
    // Verbatim from the artifacts of runs 34604105028 (47.3%) and 34604119657
    // (23.1%). Both fields that differ between those runs are absent, so this
    // check is what would have flagged them as unattributable.
    // `metricRiseCeiling` is additionally absent because it postdates those
    // runs; `failedEdgeWeight` likewise, and `poolMetricPenaltyWeight` too. The point
    // of the check is that TODAY's requirement set flags them — which is why it grows
    // with every reported field rather than being frozen at the published list.
    const published = { logWeight: 1, rankNormalization: true };
    expect(missingReportedConfigFields(published)).toEqual([
      'logSignalMode',
      'dropMetrics',
      'metricRiseCeiling',
      'metricFleetBaseline',
      'failedEdgeWeight',
      'failedEdgeMode',
      'failedEdgeMinRecords',
      'latWeight',
      'latMinRise',
      'poolMetricPenaltyWeight',
      'stabilityWeight',
      'selfTimeWeight',
      'temporalWeight',
      'onsetShape',
    ]);
  });

  it('treats a non-object as carrying nothing', () => {
    expect(missingReportedConfigFields(null)).toEqual([...REPORTED_CONFIG_FIELDS]);
    expect(missingReportedConfigFields('config')).toEqual([...REPORTED_CONFIG_FIELDS]);
    expect(missingReportedConfigFields(undefined)).toEqual([...REPORTED_CONFIG_FIELDS]);
  });
});

describe('FSE26 report — the two renderings agree', () => {
  it('names every reported field in the header line', () => {
    const line = formatFSE26ConfigLine(makeConfig());
    expect(line).toContain('logWeight=1');
    expect(line).toContain('logMode=logicHttp');
    expect(line).toContain('rankNormalization=true');
    // The line and the JSON are rendered from one object; `missingReportedConfigFields`
    // is the executable form of "both carry the same four fields".
    expect(missingReportedConfigFields(makeConfig())).toHaveLength(0);
  });

  it('names the failed-edge weight only when it is non-zero', () => {
    // The shipped value is 0, so a zero-weight line stays byte-identical to the
    // published one — and a flipped switch cannot hide inside it. That is the
    // omission rule this field obeys and the latency weight does NOT, because its
    // shipped value is not zero.
    const shipped = formatFSE26ConfigLine(makeConfig());
    expect(shipped).not.toContain('failedEdgeWeight');
    // The temporal term's two fields are printed UNCONDITIONALLY, unlike this one: its
    // weight is 0 today, so an omission rule would work — and would then render the
    // shipped run and `--temporal-weight 0` byte-identically the day the weight flips,
    // which is the defect the line exists to prevent. A SHAPE has no default-0 to be
    // omitted against at all.
    // …and the rank-normalization axis' second half travels with the boolean, printed unconditionally on the
    // latency weight's rule: its shipped value is 20 rather than 0, so the pair "the flag acted / the flag
    // could not be consulted" is exactly what the two fields together say, and an omitted one would leave the
    // line unable to distinguish the two populations.
    expect(shipped).toBe(
      'Config: logWeight=1 logMode=logicHttp rankNormalization=true ' +
        `anomalyNormalizeNodeThreshold=${ANOMALY_NORMALIZE_NODE_THRESHOLD} ` +
        // The anomaly composition, unconditional for the threshold's reason: three of the four are non-zero,
        // so an omission rule would render the shipped run and an ablation identically — and the fourth is
        // the knob a dispatch varies.
        'anomalyTrendWeight=0.15 anomalyBurstWeight=0.1 anomalyCvWeight=0.05 anomalyBreadthWeight=0.05 ' +
        'anomalyBreadthGate=0.8 ' +
        'latWeight=0 ' +
        'poolMetricPenaltyWeight=0 stabilityWeight=0 selfTimeWeight=0 temporalWeight=0 onsetShape=earliness',
    );
    expect(formatFSE26ConfigLine(makeConfig({ failedEdgeWeight: 1 }))).toContain(
      'failedEdgeWeight=1',
    );
    // The shipped aggregation stays off the line; a non-shipped one must show,
    // or a run that ranks differently looks identical to the published one.
    expect(
      formatFSE26ConfigLine(makeConfig({ failedEdgeWeight: 1, failedEdgeMode: 'mean' })),
    ).toContain('failedEdgeMode=mean');
    // At weight 0 the aggregation cannot change anything, so it is not printed.
    expect(formatFSE26ConfigLine(makeConfig({ failedEdgeMode: 'mean' }))).not.toContain(
      'failedEdgeMode',
    );
    // The shipped floor stays off the line; a raised one must show, because it
    // changes which callees the signal credits at all.
    expect(
      formatFSE26ConfigLine(makeConfig({ failedEdgeWeight: 1, failedEdgeMinRecords: 2 })),
    ).toContain('failedEdgeMinRecords=2');
    expect(formatFSE26ConfigLine(makeConfig({ failedEdgeMinRecords: 2 }))).not.toContain(
      'failedEdgeMinRecords',
    );
  });

  it('names the pool penalty on every run, so an ablation cannot hide behind the default', () => {
    // Unconditional for the same reason as the latency weight, and here it is
    // already load-bearing while the shipped value is still 0: `--pool-penalty 0` is a
    // DIFFERENT measured configuration, and a field printed only when it differs from
    // its default would render the shipped run and that ablation identically the day
    // the default moves.
    expect(formatFSE26ConfigLine(makeConfig())).toContain('poolMetricPenaltyWeight=0');
    expect(formatFSE26ConfigLine(makeConfig({ poolMetricPenaltyWeight: 0.0679 }))).toContain(
      'poolMetricPenaltyWeight=0.0679',
    );
  });

  it('names the latency weight on every run, the shipped value included', () => {
    // UNCONDITIONAL, unlike `riseCeiling` and `fleetBaseline`: the rule that lets a
    // field be omitted when it holds its default only holds while that default is
    // zero. The shipped latency weight is not zero, so an omitted-when-default field
    // would render a 694-case run and a 673-case run with byte-identical `Config:`
    // lines — the exact defect this line exists to prevent.
    expect(formatFSE26ConfigLine(makeConfig())).toContain('latWeight=0');
    expect(formatFSE26ConfigLine(makeConfig({ latWeight: 0.03 }))).toContain('latWeight=0.03');
    expect(formatFSE26ConfigLine(makeConfig({ latWeight: 0.75 }))).toContain('latWeight=0.75');
    // Still printed when the failed-edge weight is 0 — the two terms are
    // independent, and the latency term can be on while that one is off.
    expect(formatFSE26ConfigLine(makeConfig({ latWeight: 0.75, failedEdgeWeight: 0 }))).toContain(
      'latWeight=0.75',
    );
  });

  it('names the latency rise floor only when it is not the shipped 1', () => {
    // The shipped floor is 1, so it stays off the line — and a run with a floor is a
    // DIFFERENT term, not a different weight, so it has to be visible independently
    // of `latWeight`.
    expect(formatFSE26ConfigLine(makeConfig())).not.toContain('latMinRise');
    expect(formatFSE26ConfigLine(makeConfig({ latMinRise: 10.3 }))).toContain('latMinRise=10.3');
    expect(formatFSE26ConfigLine(makeConfig({ latMinRise: 10.3, latWeight: 0 }))).toContain(
      'latMinRise=10.3',
    );
  });

  it('names the rise ceiling only when it changes the configuration', () => {
    // The shipped configuration is an unbounded rise, so a ceiling of 0 adds
    // nothing to the line — but a run WITH one is a different configuration and
    // must be distinguishable from the published numbers at a glance.
    expect(formatFSE26ConfigLine(makeConfig())).not.toContain('riseCeiling');
    expect(formatFSE26ConfigLine(makeConfig({ metricRiseCeiling: 10 }))).toContain(
      'riseCeiling=10',
    );
  });

  it('names the fleet baseline only when it is on', () => {
    expect(formatFSE26ConfigLine(makeConfig())).not.toContain('fleetBaseline');
    expect(formatFSE26ConfigLine(makeConfig({ metricFleetBaseline: true }))).toContain(
      'fleetBaseline=true',
    );
  });

  it('mentions the dropped metric names only when there is an ablation', () => {
    expect(formatFSE26ConfigLine(makeConfig())).not.toContain('dropMetrics');
    const ablated = formatFSE26ConfigLine(
      makeConfig({ dropMetrics: ['http.server.request.duration.max'] }),
    );
    expect(ablated).toContain('dropMetrics=[http.server.request.duration.max]');
  });

  it('renders the mode the report actually ran with', () => {
    const config = makeConfig({ logSignalMode: 'count' });
    const line = formatFSE26ConfigLine(config);
    const report = buildFSE26Report({
      anchor: ANCHOR,
      config,
      cases: 1422,
      top1: 0.2307,
      top3: 0.35,
      top5: 0.444,
      loadErrors: 0,
      engineErrors: 0,
      emptyGraphs: 0,
      perFaultType: new Map(),
    });
    // The value in the line must be the value in the object — the failure mode
    // was a line and an object produced independently.
    expect(line).toContain(`logMode=${String(report.config.logSignalMode)}`);
    expect(report.config.logSignalMode).toBe('count');
  });
});

describe('FSE26 report — summary arithmetic', () => {
  it('derives the per-fault-type top1 ratio', () => {
    const report = makeReport();
    expect(report.perFaultType['HTTPResponseReplaceCode']).toEqual({
      total: 231,
      correct: 159,
      top1: 159 / 231,
    });
  });

  it('reports top1 = 0 for a fault type with no cases', () => {
    const report = makeReport({ perFaultType: new Map([['Ghost', { total: 0, correct: 0 }]]) });
    expect(report.perFaultType['Ghost']?.top1).toBe(0);
  });

  it('orders the cells by descending total, then by name', () => {
    const report = makeReport();
    expect(Object.keys(report.perFaultType)).toEqual([
      'HTTPResponseReplaceCode',
      'HTTPRequestReplaceMethod',
      'JVMMemoryStress',
    ]);

    const tied = makeReport({
      perFaultType: new Map([
        ['Zeta', { total: 5, correct: 1 }],
        ['Alpha', { total: 5, correct: 2 }],
        ['Mu', { total: 5, correct: 3 }],
      ]),
    });
    // Equal totals must not fall back to insertion order: the artifact is
    // diffed between runs, so the order has to be a function of the content.
    expect(Object.keys(tied.perFaultType)).toEqual(['Alpha', 'Mu', 'Zeta']);
  });

  it('derives the delta against the anchor average', () => {
    const report = makeReport({ top1: 0.4732770745428973 });
    expect(report.deltaVsSotaAvg).toBeCloseTo(0.4732770745428973 - ANCHOR.sotaAvgTop1, 12);
  });

  it('passes the run counts through unchanged', () => {
    const report = makeReport({ loadErrors: 1, engineErrors: 2, emptyGraphs: 3, cases: 9 });
    expect([report.cases, report.loadErrors, report.engineErrors, report.emptyGraphs]).toEqual([
      9, 1, 2, 3,
    ]);
  });
});

describe('summariseFailedEdgeCoverage', () => {
  const oneCase = (
    rows: Array<[string, string, number, number]> | undefined,
    metricKeys: string[],
  ) => ({
    // Mirrors the loader: the bridge's 4-tuples become the engine's per-edge
    // records, so the counter is fed exactly what the signal is fed.
    failedTraceEdges: rows?.map(([caller, callee, failed, baseline]) => ({
      caller,
      callee,
      failed,
      baseline,
    })),
    metricKeys: new Set(metricKeys),
  });

  it('counts the cases, records and in-graph evidence a run actually loaded', () => {
    const coverage = summariseFailedEdgeCoverage([
      oneCase(
        [
          ['a', 'b', 10, 2],
          ['a', 'c', 3, 0],
        ],
        ['a', 'b', 'c'],
      ),
      oneCase([['a', 'b', 5, 5]], ['a', 'b']),
    ]);

    expect(coverage).toEqual({
      cases: 2,
      casesWithEdges: 2,
      edges: 3,
      inGraphEdges: 3,
      // (10 - 2) + 3 + max(0, 5 - 5)
      netFailures: 11,
    });
  });

  it('separates RECORDS from usable evidence when the callee has no metric series', () => {
    // The signal drops an edge to a service with no rankable node, including
    // from its normalisation denominator. Counting it as usable would report
    // evidence the ranking never received — exactly the confusion this counter
    // exists to prevent.
    const coverage = summariseFailedEdgeCoverage([
      oneCase(
        [
          ['a', 'loadgenerator', 400, 0],
          ['a', 'c', 4, 0],
        ],
        ['a', 'c'],
      ),
    ]);

    expect(coverage.edges).toBe(2);
    expect(coverage.inGraphEdges).toBe(1);
    expect(coverage.netFailures).toBe(4);
  });

  it('treats a self-edge as a record but not as in-graph evidence', () => {
    const coverage = summariseFailedEdgeCoverage([oneCase([['a', 'a', 7, 0]], ['a'])]);

    expect(coverage.edges).toBe(1);
    expect(coverage.inGraphEdges).toBe(0);
    expect(coverage.netFailures).toBe(0);
  });

  it('clamps a negative net at zero, like the signal does', () => {
    const coverage = summariseFailedEdgeCoverage([
      oneCase(
        [
          ['a', 'b', 1, 9],
          ['a', 'c', 2, 0],
        ],
        ['a', 'b', 'c'],
      ),
    ]);

    expect(coverage.inGraphEdges).toBe(2);
    expect(coverage.netFailures).toBe(2);
  });

  it('reports an EMPTY evidence class as zero, not as a healthy run', () => {
    // The shape that reads as "the signal changed nothing": every counter zero.
    const absent = summariseFailedEdgeCoverage([oneCase(undefined, ['a'])]);
    expect(absent).toEqual({
      cases: 1,
      casesWithEdges: 0,
      edges: 0,
      inGraphEdges: 0,
      netFailures: 0,
    });
    expect(summariseFailedEdgeCoverage([oneCase([], ['a'])])).toEqual(absent);
    expect(summariseFailedEdgeCoverage([])).toEqual({
      cases: 0,
      casesWithEdges: 0,
      edges: 0,
      inGraphEdges: 0,
      netFailures: 0,
    });
  });

  it('renders one line that names every counter', () => {
    const line = formatFailedEdgeCoverageLine({
      cases: 1422,
      casesWithEdges: 12,
      edges: 30,
      inGraphEdges: 7,
      netFailures: 41,
    });

    expect(line).toBe(
      'Data:   failed edges in 12/1422 cases (30 records, 7 in-graph, net 41 failures)',
    );
  });

  it('names each of the EIGHT the mirror added when it leaves its default, and only then', () => {
    // The shipped line above is the negative half — nothing printed. This is the positive half, and it is
    // the one that matters more: a line that printed NONE of the eight would satisfy every assertion up
    // there, so the omission rule is only fenced once both directions are asserted.
    //
    // Each row is a field, the value a dispatch would send, and the token the line must gain. The shipped
    // value is checked first in the same loop, so a field that printed unconditionally would fail here
    // rather than pass the negative half by accident.
    const rows: readonly { patch: Partial<FSE26RunConfig>; token: string; shipped: string }[] = [
      { patch: { traceWeight: 1 }, token: 'traceWeight=1', shipped: 'traceWeight' },
      { patch: { topoWeight: 0.25 }, token: 'topoWeight=0.25', shipped: 'topoWeight' },
      { patch: { collisionWeight: 0.5 }, token: 'collisionWeight=0.5', shipped: 'collisionWeight' },
      { patch: { prismWeight: 0.125 }, token: 'prismWeight=0.125', shipped: 'prismWeight' },
      {
        patch: { collapseDiscount: 0.4 },
        token: 'collapseDiscount=0.4',
        shipped: 'collapseDiscount',
      },
      {
        patch: { suppressIdleTransients: true },
        token: 'suppressIdleTransients=true',
        shipped: 'suppressIdleTransients',
      },
      {
        patch: { suppressNearZeroBaselineRise: true },
        token: 'suppressNearZeroBaselineRise=true',
        shipped: 'suppressNearZeroBaselineRise',
      },
    ];
    for (const { patch, token, shipped } of rows) {
      expect(
        formatFSE26ConfigLine(makeConfig()),
        `${shipped} printed at its shipped value`,
      ).not.toContain(shipped);
      expect(formatFSE26ConfigLine(makeConfig(patch)), `${token} missing`).toContain(token);
    }
    // `prismPooling` is the eighth and the one that is NOT a plain omit-when-default field, because the
    // pooling is INERT at a zero weight: printing it there would report a difference the engine cannot
    // have. So it is nested under the weight, exactly as `failedEdgeMode` is nested under its own — and
    // asserting that nesting is the point, because "omitted when default" and "omitted when inert" are
    // different rules and only one of them is right for a value the engine multiplies by zero.
    expect(formatFSE26ConfigLine(makeConfig({ prismPooling: 'conjunctive' }))).not.toContain(
      'prismPooling',
    );
    expect(
      formatFSE26ConfigLine(makeConfig({ prismWeight: 0.125, prismPooling: 'conjunctive' })),
    ).toContain('prismPooling=conjunctive');
    // …and the shipped pooling stays off even once the weight is on, so an ablation of the pooling alone
    // is visible while the shipped pairing keeps the line it always had.
    expect(formatFSE26ConfigLine(makeConfig({ prismWeight: 0.125 }))).not.toContain('prismPooling');
  });
});
