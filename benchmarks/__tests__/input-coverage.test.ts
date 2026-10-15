/**
 * The input census, and the STARVED/INERT distinction it exists to draw.
 *
 * ## Why this instrument exists
 *
 * `ABLATION_FINDINGS.md` v5 reports a table in which most rows read `Δ+0.0%`, and **a zero is only readable if
 * the artifact says which kind of zero it is** — the register's own requirement. Two of those zeros are not
 * the same statement at all:
 *
 * - **RE1** carries no `logs.csv` and no `traces.csv` (the golden's own artifact records
 *   `[log] No log data available for 125 cases` three times). Every boolean signal there multiplies an empty
 *   channel, so its zero is **STARVED** and says nothing about the term.
 * - **RE2** carries 50 of 50 cases with logs *and* with traces, and every engine term still reads `Δ+0.0%`.
 *   That zero is **INERT**: the input arrived and the ranking did not move.
 *
 * Reporting both as `+0.0` is what made the ledger unreadable; this module and these tests make the
 * distinction a value rather than a footnote.
 *
 * @module benchmarks/__tests__/input-coverage
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  configDiff,
  formatAblationConfigLine,
  type AblationFeatureFlags,
} from '../src/ablation-engine-options.js';
import {
  ABSENCE_LEVELS,
  channelCases,
  formatInputCoverage,
  readAbsenceLevel,
  readZero,
  summarizeInputCoverage,
  TERM_CHANNELS,
  type AbsenceLevel,
  type ChannelEvidence,
  type SignalChannel,
} from '../src/directional-evidence.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, '..', rel), 'utf8');

/** A case with exactly the channels a test wants it to have. */
const withChannels = (spec: {
  logs?: number;
  traces?: number;
  spanActivity?: number;
  failed?: number;
  latency?: number;
  /**
   * The case's metric telemetry, as the VALUES it holds.
   *
   * `[1, 2]` is two non-zero readings, `[0, 0]` is telemetry present in name and silently zero in value,
   * `[]` is a map with no point at all, and OMITTING it is a case that carries no metrics map. Those four are
   * the four levels of the metric channel's absence, and they are spelled as values because the census reads
   * values — a fixture that supplied a pre-counted summary could not distinguish them.
   */
  metrics?: number[];
}): Parameters<typeof summarizeInputCoverage>[0][number] => {
  // `Array.from({ length: n })` rather than `new Array(n).fill()`: the census reads `length` and `size`, so the
  // entries are placeholders — and the longer form is the one the lint rule accepts, which keeps the gate at
  // zero warnings rather than trading a warning for a habit.
  const entries = (n: number | undefined): ReadonlyArray<unknown> | undefined =>
    n ? Array.from({ length: n }, () => ({})) : undefined;
  return {
    logs: entries(spec.logs),
    traces: entries(spec.traces),
    traceActivity: spec.spanActivity ? new Map([['svc', {}]]) : undefined,
    failedTraceEdges: entries(spec.failed),
    edgeLatency: entries(spec.latency),
    metrics:
      spec.metrics === undefined
        ? undefined
        : new Map([['svc', [{ values: new Float64Array(spec.metrics) }]]]),
  };
};

/** Every case's metric channel, for the tests that need a population that is not degenerate. */
const LIVE_TELEMETRY = [1, 2, 3];

describe('the input census', () => {
  it('MEASURES the metric channel instead of assuming it', () => {
    // **The defect this test replaces.** The arm used to return `coverage.cases`, with the comment "every
    // RCAEval case has metrics" — a CONSTRUCTION where a measurement was asserted, on the one channel every
    // never-ablated prior acts on and the one a competitor's published allegation is about. The count is now the
    // cases whose telemetry holds a non-zero value.
    const coverage = summarizeInputCoverage([
      withChannels({ logs: 3, traces: 10, spanActivity: 2, failed: 1, latency: 4, metrics: [1] }),
      withChannels({ logs: 0, traces: 5, latency: 2, metrics: [0, 4] }),
      // The case the old arm counted as covered: telemetry present in NAME and zero in value.
      withChannels({ metrics: [0, 0, 0] }),
    ]);
    expect(coverage.cases).toBe(3);
    expect(coverage.casesWithMetrics).toBe(3);
    expect(coverage.casesWithNonZeroMetrics).toBe(2);
    // The construction would have said 3. This is the whole change.
    expect(channelCases(coverage, 'metrics')).toBe(2);
    expect(coverage.casesWithReadableLogs).toBe(1);
    expect(coverage.logEntries).toBe(3);
    expect(coverage.casesWithSpans).toBe(2);
    expect(coverage.casesWithSpanActivity).toBe(1);
    expect(coverage.casesWithFailedEdges).toBe(1);
    expect(coverage.casesWithLatency).toBe(2);
    expect(coverage.latencyEdges).toBe(6);
    expect(channelCases(coverage, 'logs')).toBe(1);
  });

  it('separates the SCHEMA mechanism from the DEGENERATE class, which is why the levels exist', () => {
    // Two populations that a bare zero cannot tell apart, differing ONLY in what the producer recorded.
    const columnAbsent = readAbsenceLevel(0, {
      present: true,
      rows: 40,
      columns: false,
      nonzero: 40,
    });
    const allZero = readAbsenceLevel(0, { present: true, rows: 40, columns: true, nonzero: 0 });
    const fileAbsent = readAbsenceLevel(0, { present: false, rows: 0, columns: false, nonzero: 0 });
    expect([columnAbsent, allZero, fileAbsent]).toEqual([
      'COLUMN-ABSENT',
      'ALL-ZERO',
      'FILE-ABSENT',
    ]);
    expect(new Set([columnAbsent, allZero, fileAbsent]).size).toBe(3);
    // `COLUMN-ABSENT` is `arXiv:2609.27069`'s mechanism — a schema that silently zeroes telemetry for 250 of
    // 375 RE1 cases — and `ALL-ZERO` is the degenerate class `benchmark-corpus-completeness.md` §8 defines.
    // An instrument printing one zero for both cannot say which it measured.
    // Every level in the union is REACHABLE, or the union is a decoration.
    const reached = new Set<AbsenceLevel>([
      readAbsenceLevel(4, undefined),
      fileAbsent,
      readAbsenceLevel(0, { present: true, rows: 0, columns: true, nonzero: 0 }),
      columnAbsent,
      allZero,
      readAbsenceLevel(0, { present: true, rows: 40, columns: true, nonzero: 40 }),
      readAbsenceLevel(0, undefined),
    ]);
    expect([...reached].sort()).toEqual([...ABSENCE_LEVELS].sort());
  });

  it('lets the COUNT win over the evidence, so a recorded level cannot contradict it', () => {
    // The reason the level is a FUNCTION of the count and the evidence rather than a field: a field could be set
    // to `READ` on an empty channel and nothing would notice. `at` names, for every level, an evidence that
    // WOULD produce it at zero coverage — so the loop below pins both directions of the mapping at once.
    const at = (level: AbsenceLevel): ChannelEvidence | undefined => {
      switch (level) {
        case 'READ':
          return undefined;
        case 'FILE-ABSENT':
          return { present: false, rows: 0, columns: false, nonzero: 0 };
        case 'NO-POINTS':
          return { present: true, rows: 0, columns: true, nonzero: 0 };
        case 'COLUMN-ABSENT':
          return { present: true, rows: 9, columns: false, nonzero: 9 };
        case 'ALL-ZERO':
          return { present: true, rows: 9, columns: true, nonzero: 0 };
        case 'NO-KEPT-ROW':
          return { present: true, rows: 9, columns: true, nonzero: 9 };
        case 'UNREPORTED':
          return undefined;
      }
    };
    for (const level of ABSENCE_LEVELS) {
      // `READ` is a covered channel and not a level of absence, so it has no evidence that reproduces it at zero.
      if (level !== 'READ') {
        expect(readAbsenceLevel(0, at(level)), `${level} at zero coverage`).toBe(level);
      }
      // **And one kept reading overrides every one of them**, which is the direction a field could not hold.
      expect(readAbsenceLevel(1, at(level)), `${level}: the count wins`).toBe('READ');
    }
    // And an unrecorded reason is a LEVEL, not a failure: "the reason is not recorded" and "the file is absent"
    // are different statements, which is law 3's middle level.
    expect(readAbsenceLevel(0, undefined)).toBe('UNREPORTED');
  });

  it('reads the metric levels off the case objects themselves, PER CASE', () => {
    const coverage = summarizeInputCoverage([
      withChannels({ metrics: [0, 1] }),
      withChannels({ metrics: [0, 0] }),
      withChannels({ metrics: [] }),
      withChannels({}),
    ]);
    expect(coverage.cases).toBe(4);
    // `with points` counts points, so the EMPTY map is not one: it is a level of its own, and a population could
    // hold it beside the others only because the level is computed per case.
    expect(coverage.casesWithMetrics).toBe(2);
    expect(coverage.casesWithNonZeroMetrics).toBe(1);
    // Three DIFFERENT levels in one population, which the first version of the census could not express: it
    // assigned the whole population one level and dropped every case that level did not describe. The order is
    // the union's own, so two runs of one corpus print the same lines.
    const levels = coverage.absence.filter((a) => a.channel === 'metrics');
    expect(levels.map((a) => [a.level, a.cases])).toEqual([
      ['FILE-ABSENT', 1],
      ['NO-POINTS', 1],
      ['ALL-ZERO', 1],
    ]);
    const lines = formatInputCoverage(coverage, 'RE1');
    expect(lines[0]).toContain('metrics 1/4 non-zero');
    expect(lines[0]).toContain('(2 with points)');
    expect(lines.some((l) => l.includes('absent[metrics]: ALL-ZERO on 1/4 cases'))).toBe(true);
    expect(lines.some((l) => l.includes('absent[metrics]: FILE-ABSENT on 1/4 cases'))).toBe(true);
  });

  it('reads a series with no value array, and a NaN is a point that is not a reading', () => {
    // Two shapes a real `MetricMap` can hold and a census must not crash on or over-count.
    const coverage = summarizeInputCoverage([
      // A series whose `values` is absent: it contributes no point at all, and it is NOT a zero.
      { metrics: new Map([['svc', [{}]]]) },
      // A `NaN` counts as a point — the engine cannot rank on it — and NOT as an observation, so a case of pure
      // NaN telemetry is `ALL-ZERO` rather than `READ`. Calling it covered would claim a reading that is not one.
      { metrics: new Map([['svc', [{ values: new Float64Array([Number.NaN, Number.NaN]) }]]]) },
      { metrics: new Map([['svc', [{ values: new Float64Array([0, 0, 7]) }]]]) },
    ]);
    expect(coverage.casesWithMetrics).toBe(2);
    expect(coverage.casesWithNonZeroMetrics).toBe(1);
    // The valueless series is `NO-POINTS` — a map with nothing in it, which is not a zero — and the NaN case is
    // `ALL-ZERO`, in the union's own order.
    const levels = coverage.absence.filter((a) => a.channel === 'metrics');
    expect(levels.map((a) => [a.level, a.cases])).toEqual([
      ['NO-POINTS', 1],
      ['ALL-ZERO', 1],
    ]);
  });

  it('accounts for every case at every channel, so a count cannot be a construction', () => {
    // The invariant that generalises the defect: a channel's covered count plus its absence count is the
    // population. A count that is a construction would break this the moment a case disagreed with it.
    const coverage = summarizeInputCoverage([
      withChannels({ logs: 2, traces: 1, spanActivity: 1, failed: 1, latency: 1, metrics: [5] }),
      withChannels({ metrics: [0] }),
      withChannels({}),
    ]);
    const channels: SignalChannel[] = ['metrics', 'logs', 'spans', 'spanActivity', 'latency'];
    for (const channel of channels) {
      const absence = coverage.absence
        .filter((a) => a.channel === channel)
        .reduce((n, a) => n + a.cases, 0);
      expect(channelCases(coverage, channel) + absence, `${channel}`).toBe(coverage.cases);
    }
    // And the metric channel's two counts are ordered, which a construction cannot be wrong about but a
    // measurement can: points without a single non-zero value is `ALL-ZERO`, never covered.
    expect(coverage.casesWithNonZeroMetrics).toBeLessThanOrEqual(coverage.casesWithMetrics);
    expect(coverage.casesWithMetrics).toBeLessThanOrEqual(coverage.cases);
  });

  it('says WHICH log quantity the count is, because another instrument counts another one', () => {
    // Two instruments print a log-case count over the same corpus and they are not the same quantity:
    // `run-rcaeval.ts` counts cases whose file yielded ANY row (`logRowsRead`, pre-filter) and prints
    // `cases with logs`; this census counts cases RETAINING a readable row (post-filter) and now prints
    // `readable`. Measured on RE2-OnlineBoutique those read 90/90 and 21/90 — a factor of four, under one
    // word. The label is the assertion, because the number alone cannot distinguish them.
    const lines = formatInputCoverage(
      summarizeInputCoverage([withChannels({ logs: 3 }), withChannels({})]),
      'RE2',
    );
    expect(lines[0]).toContain('logs 1/2 readable');
    // And the field is named for what it counts, so a consumer cannot read the other quantity by accident.
    expect(summarizeInputCoverage([withChannels({ logs: 3 })])).toHaveProperty(
      'casesWithReadableLogs',
    );
    expect(summarizeInputCoverage([withChannels({ logs: 3 })])).not.toHaveProperty('casesWithLogs');
  });

  it('distinguishes the two kinds of zero, which is the whole point', () => {
    // The distinction as a truth table, and the three cases are the three things a row can mean.
    expect(readZero(0, 0)).toBe('STARVED');
    expect(readZero(0, 50)).toBe('INERT');
    expect(readZero(0.012, 50)).toBe('moved');
    // Signed: a negative delta is movement too, and reading it as "no change" would hide a regression.
    expect(readZero(-0.012, 50)).toBe('moved');
    // Float dust is not movement, and an epsilon above it does not make a starved channel inert.
    expect(readZero(1e-12, 0)).toBe('STARVED');
  });

  it('names the terms a starved channel makes unmeasurable, and stays silent when none is', () => {
    // A suite like RE1: no logs, no spans, no span activity.
    const starved = summarizeInputCoverage([withChannels({}), withChannels({})]);
    const lines = formatInputCoverage(starved, 'RE1');
    expect(lines[0]).toContain('logs 0/2');
    expect(lines[0]).toContain('spans 0/2');
    expect(lines[1]).toContain('STARVED');
    expect(lines[1]).toContain('logWeight');
    expect(lines[1]).toContain('traceWeight');

    // A suite like RE2: both channels populated, so the same terms are measured rather than excused.
    const covered = summarizeInputCoverage([
      withChannels({
        logs: 4,
        traces: 30,
        spanActivity: 2,
        failed: 1,
        latency: 3,
        metrics: LIVE_TELEMETRY,
      }),
      withChannels({ logs: 4, traces: 30, spanActivity: 2, latency: 3, metrics: LIVE_TELEMETRY }),
    ]);
    const coveredLines = formatInputCoverage(covered, 'RE2');
    expect(coveredLines[0]).toContain('logs 2/2');
    expect(coveredLines[1]).toContain('INERT');
    expect(coveredLines[1]).not.toContain('UNMEASURABLE');
  });

  it('gives every signal term a channel, so a zero on it is always readable', () => {
    // The map is what makes the verdict computable, so it must cover the terms a row can vary. A term that
    // multiplies an INPUT is what a zero verdict is about; a floor and a form selector multiply nothing.
    const SIGNAL_TERMS = [
      'logWeight',
      'traceWeight',
      'topoWeight',
      'collisionWeight',
      'latWeight',
      'poolMetricPenaltyWeight',
      'stabilityWeight',
    ];
    for (const term of SIGNAL_TERMS) {
      expect(TERM_CHANNELS[term], `${term} must name its channel`).toBeDefined();
    }
    // And the channels are exactly the ones `channelCases` is total over — a `switch` with no `default`, so
    // the compiler is the guard that a new channel cannot be added without a count for it.
    const channels: SignalChannel[] = ['metrics', 'logs', 'spans', 'spanActivity', 'latency'];
    expect([...new Set(Object.values(TERM_CHANNELS))].sort()).toEqual([...channels].sort());
  });

  it('declares the terms that are NOT signal terms, so the verdict can say so', () => {
    // The verdict block renders `UNKNOWN-CHANNEL` for a varied field with no entry in the map, and the run of
    // 37832140805 produced it for exactly these — a SWITCH, a FLOOR, a FORM selector, and the metric-derived
    // terms whose input is the population itself. Naming them here turns "unknown" into "declared": the map is
    // not missing them, they are not signal terms, and a NEW one appearing is a failing test rather than a
    // token nobody reads.
    const NOT_SIGNAL_TERMS = [
      'enableCollisionAggregation', // a switch, not a weight
      'collapseDiscount', // a topology switch
      'rankNormalization', // a switch on the final ordering
      'suppressIdleTransients', // a suppression switch
      'latMinRise', // the latency prior's FLOOR, not a signal
      'prismPooling', // a form selector, not a term at all
    ];
    for (const term of NOT_SIGNAL_TERMS) {
      expect(TERM_CHANNELS[term], `${term} is not a signal term`).toBeUndefined();
    }
    // And a term with no channel CANNOT be starved: the verdict block falls back to the population, because a
    // switch multiplies no input. Without this the rows the block exists for — `+Rank Normalization`,
    // `+Idle Transient Suppression`, both `Δ+0.0%` on RE1 — would carry no verdict at all.
    const runner = read('src/run-ablation.ts');
    expect(runner).toContain('channel ? channelCases(cov, channel) : cov.cases');
    expect(runner, 'the unreadable token is gone').not.toContain('UNKNOWN-CHANNEL');
  });

  it('counts spans from the ASSEMBLY, not from what the case retains', () => {
    // The census's own worst defect, found by reading its first output: it reported `spans 0/30` on RE3 — a
    // corpus whose graph WAS augmented from traces — and declared `topoWeight` unmeasurable there, because the
    // assembly derives everything it needs and the runner drops the spans. It was counting what a case
    // RETAINS rather than what it HAD. The loader now takes the count from the assembly's own `traceUsed`.
    const runner = read('src/run-ablation.ts');
    // The WHOLE destructuring, not a prefix of it: `toContain` is satisfied by any superstring, so a bare
    // `const { benchCase, traceUsed }` assertion would also pass a line that destructured something else and
    // never read the flag it claims to read.
    expect(runner, 'the loader reads the assembly result').toMatch(
      /const \{ benchCase, traceUsed, latencyViews, latencyRoute \} = await assembleRCAEvalCase\(/,
    );
    expect(runner, 'and counts it').toContain('if (traceUsed) casesWithSpans++;');
    expect(runner, 'and overrides the retained-array count with it').toContain(
      'coverage: { ...summarizeInputCoverage(cases), casesWithSpans }',
    );
  });
});

describe('the rows the battery had never varied', () => {
  const ALL_OFF: AblationFeatureFlags = {
    collisionAggregation: false,
    extraTraceValidation: false,
    selfLearning: false,
    logSignal: false,
    topoSignal: false,
    collisionSignal: false,
    collapseDiscount: false,
    riseSignal: false,
    traceSignal: false,
    rankNormalization: false,
    suppressIdleTransients: false,
    prismSignal: false,
  };

  it('exist, are siblings of the baseline, and state their override on the artifact line', () => {
    const battery = read('src/run-ablation.ts');
    // Asserted as the QUOTED LITERAL, and that is not pedantry: a plain `toContain('STABILITY OFF')` is
    // satisfied by the `POOL PENALTY + STABILITY OFF` row, which is a SUPERSTRING of it — the mutation that
    // renamed the stability row to `STABILITY ROW` and deleted nothing **survived** the first version of this
    // test. A substring assertion is satisfied by any superstring, so the delimiter has to be part of it.
    for (const label of ['POOL PENALTY OFF', 'STABILITY OFF', 'POOL PENALTY + STABILITY OFF']) {
      expect(battery, `${label} must be a row, as a label literal`).toContain(`label: '${label}`);
    }
    // The whole point of an override is that the artifact states the value it produced, not the flag it came
    // from: the shipped values are 0.0679 and 0.007352, neither of which is 0 or 1.
    expect(formatAblationConfigLine(ALL_OFF, { poolMetricPenaltyWeight: 0 })).toContain(
      'poolMetricPenaltyWeight=0',
    );
    expect(formatAblationConfigLine(ALL_OFF, { stabilityWeight: 0 })).toContain(
      'stabilityWeight=0',
    );
    // And the shipped value is still reachable by naming no override — the pair is what makes the row a
    // measurement rather than a configuration nobody can reconstruct.
    expect(formatAblationConfigLine(ALL_OFF)).toContain('poolMetricPenaltyWeight=0.0679');
    expect(formatAblationConfigLine(ALL_OFF)).toContain('stabilityWeight=0.007352');
  });

  it('reads the override through ??, so an explicit zero survives', () => {
    // `||` cannot express zero, and zero is the only value these two rows express.
    const source = read('src/ablation-engine-options.ts');
    expect(source).toContain(
      'overrides.poolMetricPenaltyWeight ?? DEFAULT_POOL_METRIC_PENALTY_WEIGHT',
    );
    expect(source).toContain('overrides.stabilityWeight ?? DEFAULT_STABILITY_WEIGHT');
  });

  it('names the varied TERMS for a row, which is what a zero verdict is computed from', () => {
    // A label names a FLAG; a verdict needs the TERM. `configDiff` is the bridge, and it is why the run
    // record now carries its overrides.
    const base = formatAblationConfigLine(ALL_OFF);
    expect(configDiff(base, formatAblationConfigLine(ALL_OFF))).toEqual([]);
    expect(configDiff(base, formatAblationConfigLine(ALL_OFF, { stabilityWeight: 0 }))).toEqual([
      'stabilityWeight',
    ]);
    expect(
      configDiff(
        base,
        formatAblationConfigLine(ALL_OFF, { poolMetricPenaltyWeight: 0, stabilityWeight: 0 }),
      ),
    ).toEqual(['poolMetricPenaltyWeight', 'stabilityWeight']);
  });
});
