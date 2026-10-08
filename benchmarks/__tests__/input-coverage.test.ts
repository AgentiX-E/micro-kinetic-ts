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
  channelCases,
  formatInputCoverage,
  readZero,
  summarizeInputCoverage,
  TERM_CHANNELS,
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
  };
};

describe('the input census', () => {
  it('counts every channel, and counts metrics as the population itself', () => {
    const coverage = summarizeInputCoverage([
      withChannels({ logs: 3, traces: 10, spanActivity: 2, failed: 1, latency: 4 }),
      withChannels({ logs: 0, traces: 5, latency: 2 }),
      // A case with nothing but metrics: the only channel every RCAEval case has, which is why the two
      // never-ablated priors are the sole levers on a suite whose other channels are empty.
      withChannels({}),
    ]);
    expect(coverage.cases).toBe(3);
    expect(coverage.casesWithLogs).toBe(1);
    expect(coverage.logEntries).toBe(3);
    expect(coverage.casesWithSpans).toBe(2);
    expect(coverage.casesWithSpanActivity).toBe(1);
    expect(coverage.casesWithFailedEdges).toBe(1);
    expect(coverage.casesWithLatency).toBe(2);
    expect(coverage.latencyEdges).toBe(6);
    expect(channelCases(coverage, 'metrics')).toBe(3);
    expect(channelCases(coverage, 'logs')).toBe(1);
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
      withChannels({ logs: 4, traces: 30, spanActivity: 2, failed: 1, latency: 3 }),
      withChannels({ logs: 4, traces: 30, spanActivity: 2, latency: 3 }),
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
