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

import type { FSE26RunConfig } from '../src/fse26-report.js';
import {
  REPORTED_CONFIG_FIELDS,
  buildFSE26Report,
  formatFSE26ConfigLine,
  missingReportedConfigFields,
} from '../src/fse26-report.js';

const ANCHOR = { sotaAvgTop1: 0.21, sotaBestTop1: 0.37 };

function makeConfig(overrides: Partial<FSE26RunConfig> = {}): FSE26RunConfig {
  return {
    logWeight: 1,
    logSignalMode: 'logicHttp',
    rankNormalization: true,
    dropMetrics: [],
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
    const published = { logWeight: 1, rankNormalization: true };
    expect(missingReportedConfigFields(published)).toEqual(['logSignalMode', 'dropMetrics']);
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
      ]),
    });
    // Equal totals must not fall back to insertion order: the artifact is
    // diffed between runs, so the order has to be a function of the content.
    expect(Object.keys(tied.perFaultType)).toEqual(['Alpha', 'Zeta']);
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
