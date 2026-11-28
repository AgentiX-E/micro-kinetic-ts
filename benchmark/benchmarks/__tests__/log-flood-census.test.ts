/**
 * Unit tests for the log flood census.
 *
 * The instrument's whole value is the distinctions it refuses to collapse, so the tests are organised around
 * them rather than around the arithmetic: a case with no flood against one with a quiet flood, a truth that TIES
 * for the top count against one that owns it, and a concentration statistic that must not absorb the 230 cases
 * on which it is `0 / 0`. Every expectation is computed from a hand-built row set, so a change in the engine's
 * admission rule shows up here as a count and not as a shifted quantile.
 *
 * @module benchmarks/__tests__/log-flood-census
 */

import { describe, expect, it } from 'vitest';

import type { FaultLogEntry } from '../../packages/core/src/interfaces/rca-engine.js';
import {
  type LogFloodInput,
  type LogFloodRow,
  censusLogFlood,
  summariseLogFlood,
} from '../src/log-flood-census.js';

/** An ERROR line admitted by `logicHttp` unless overridden. */
const line = (service: string, overrides: Partial<FaultLogEntry> = {}): FaultLogEntry => ({
  timestamp: 2_000,
  service,
  level: 'ERROR',
  isLogicException: true,
  ...overrides,
});

/** A case with `nodes` in its graph and the truth first. */
const input = (
  logs: readonly FaultLogEntry[],
  overrides: Partial<LogFloodInput> = {},
): LogFloodInput => ({
  id: 'case',
  faultType: 'JVMMemoryStress',
  logs,
  nodeIds: new Set(['a', 'b', 'c']),
  injectTimeMs: 1_000,
  groundTruth: ['a'],
  ...overrides,
});

describe('censusLogFlood counts a case exactly as the ranking counts it', () => {
  it('drops the lines the engine drops: wrong level, out of graph, before injection, not admitted', () => {
    const row = censusLogFlood(
      input([
        line('a'),
        line('a', { level: 'INFO' }),
        line('outside'),
        line('a', { timestamp: 999 }),
        line('a', { isLogicException: false }),
        { timestamp: 2_000, service: 'a', level: 'ERROR' },
      ]),
    );

    // One line survives: the logic exception at the injection boundary. `INFO`, an out-of-graph service, a
    // pre-injection line, a plain ERROR under `logicHttp` and a line with no flags at all are all refused — and
    // each is refused by a different clause, which is why each is a separate row of this fixture.
    expect(row.max).toBe(1);
    expect(row.total).toBe(1);
    expect(row.atTruth).toBe(1);
    expect(row.tied).toBe(1);
  });

  it('honours the mode, so the census can be re-read under any admission rule', () => {
    const logs = [line('a'), line('a', { isLogicException: false })];
    // `logicHttp` admits one logic line; `all` admits both ERROR lines.
    expect(censusLogFlood(input(logs), 'logicHttp').max).toBe(1);
    expect(censusLogFlood(input(logs), 'all').max).toBe(2);
  });

  it('counts the tie that `max`-normalisation pays twice, and the truth that is not the emitter', () => {
    const row = censusLogFlood(
      input([line('b'), line('b'), line('a'), line('a'), line('c')], { groundTruth: ['c'] }),
    );

    // b and a tie at two, so both are paid `1.0`; the truth emitted one line and is not the champion. A census
    // that reported only `max` would call this case one where the log term pointed at two services and would
    // have no way to say the truth was a third of the way up.
    expect(row.max).toBe(2);
    expect(row.total).toBe(5);
    expect(row.tied).toBe(2);
    expect(row.atTruth).toBe(1);
  });

  it('reports a truth that emits NOTHING under a neighbour’s flood as `atTruth = 0`', () => {
    const row = censusLogFlood(input([line('b'), line('b'), line('b')], { groundTruth: ['a'] }));

    expect(row.max).toBe(3);
    expect(row.atTruth).toBe(0);
  });

  it('reports zero everywhere on a case with no log channel and on a case with no candidates', () => {
    const noLogs = censusLogFlood(input([], { logs: undefined }));
    const noGraph = censusLogFlood(input([line('a')], { nodeIds: new Set() }));

    for (const row of [noLogs, noGraph]) {
      expect(row).toMatchObject({ max: 0, total: 0, tied: 0, atTruth: 0 });
    }
  });

  it('reads the truth from EVERY ground-truth service, not from the first', () => {
    // A datapack may name several services; the census must not be tuned to a single-service corpus, because
    // that would make `truthSilent` a statement about the fixture rather than about the case.
    const row = censusLogFlood(input([line('c')], { groundTruth: ['a', 'c'] }));
    expect(row.atTruth).toBe(1);
  });
});

describe('summariseLogFlood keeps the four populations apart', () => {
  /** Two flooding cases (one tied, one truth-silent), one single-line case, one silent case. */
  const rows: readonly LogFloodRow[] = [
    { id: 'flood', faultType: 'A', max: 10, total: 20, tied: 1, atTruth: 10 },
    { id: 'tied-silent-truth', faultType: 'A', max: 6, total: 24, tied: 3, atTruth: 0 },
    { id: 'one-line', faultType: 'B', max: 1, total: 1, tied: 1, atTruth: 0 },
    { id: 'silent', faultType: 'B', max: 0, total: 0, tied: 0, atTruth: 0 },
  ];

  it('separates the flood from the silence, and a tie from a champion', () => {
    const summary = summariseLogFlood(rows);

    expect(summary.cases).toBe(4);
    expect(summary.withFlood).toBe(3);
    expect(summary.zeroFlood).toBe(1);
    expect(summary.atMostOne).toBe(1);
    // Only the first row has the truth AS the top emitter. The third row has `atTruth = 0` and `max = 0`, and a
    // naive `atTruth === max` would have counted it — which is why the champion test is guarded on `max > 0`.
    expect(summary.truthIsChampion).toBe(1);
    // Two, not one: the tied row AND the one-line row both have a neighbour's flood and a silent truth. The
    // single-line case is the one worth stating — one line is a flood, so the term scores it `1.0` and points at
    // the wrong service just as confidently as it does on a 400-line cascade.
    expect(summary.truthSilent).toBe(2);
  });

  it('takes the quantiles over every censused case, silence included', () => {
    // The question is "how much evidence does a `1.0` stand for", and a silent case's answer is zero. Sorted:
    // 0, 1, 6, 10 — nearest rank, so p75 lands on the third of four.
    const summary = summariseLogFlood(rows);
    expect(summary.quantiles).toEqual({ p25: 1, p50: 6, p75: 6, p90: 10, p99: 10 });
  });

  it('takes the concentration over the FLOODING cases only, because it is `0 / 0` on a silent one', () => {
    // 10/20 = 0.5, 6/24 = 0.25, 1/1 = 1. A mean that had absorbed the silent row as a zero would read 0.4375.
    const summary = summariseLogFlood(rows);
    expect(summary.meanConcentration).toBeCloseTo((0.5 + 0.25 + 1) / 3, 12);
    expect(summary.medianConcentration).toBeCloseTo(0.5, 12);
  });

  it('reports zeros rather than NaN on an empty population', () => {
    const summary = summariseLogFlood([]);

    expect(summary.cases).toBe(0);
    expect(summary.meanConcentration).toBe(0);
    expect(summary.medianConcentration).toBe(0);
    expect(summary.quantiles).toEqual({ p25: 0, p50: 0, p75: 0, p90: 0, p99: 0 });
  });

  it('reports zeros on a population where nothing floods', () => {
    const summary = summariseLogFlood([
      { id: 'x', faultType: 'A', max: 0, total: 0, tied: 0, atTruth: 0 },
    ]);

    expect(summary.withFlood).toBe(0);
    expect(summary.zeroFlood).toBe(1);
    expect(summary.meanConcentration).toBe(0);
    expect(summary.truthSilent).toBe(0);
  });
});
