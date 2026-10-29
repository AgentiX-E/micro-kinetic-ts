/**
 * The window's census — the instrument §187.7 asked for and §188.5 proved could not be built against
 * `metrics.json`.
 *
 * The properties fenced here are the ones that make the counts trustworthy rather than merely present:
 *
 * 1. **Every series is counted exactly once under every reading.** A census whose columns do not sum to its
 *    population can report a refusal rate that is a fraction of nothing.
 * 2. **The census agrees with the engine**, because both call `probePreInjectionWindow` and
 *    `judgePreWindowDrift` — there is no second copy of `drift <= tolerance` here to drift away from it.
 * 3. **A placement failure and a guard refusal are different numbers.** On a corpus of short series the four
 *    guard-independent mechanisms carry the count; on a corpus of ramps the `drift` key does. Merging them is
 *    exactly the defect that made "this cell did not move" unreadable.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from './helpers/source-text.js';

import {
  ANCHOR_REFUSALS,
  deriveAnchorCensus,
  type AnchorCensusInput,
  type AnchorReading,
} from '../src/anchor-census.js';

const READINGS: readonly AnchorReading[] = ['unguarded', 'stationary', 'non-rising'];

/** One-second samples, so index `i` is `i × 1000` ms and `t₀` can be named as a sample boundary. */
function metric(
  label: string,
  values: readonly number[],
): {
  label: string;
  values: Float64Array;
  timestamps: number[];
} {
  return { label, values: Float64Array.from(values), timestamps: values.map((_, i) => i * 1000) };
}

/** A metric whose samples start at `startMs`, which is how a series can be SHORT on the pre-injection side. */
function metricFrom(
  startMs: number,
  label: string,
  values: readonly number[],
): { label: string; values: Float64Array; timestamps: number[] } {
  return {
    label,
    values: Float64Array.from(values),
    timestamps: values.map((_, i) => startMs + i * 1000),
  };
}

const INJECT_AT = 30_000;
const POST = Array.from({ length: 10 }, () => 40);

/** A level, a ramp, a settling segment, a short pre-segment, and an un-anchorable one — five series in all. */
function mixedCase(truth = 'svc-a'): AnchorCensusInput {
  const level = metric('cpu', [...Array<number>(30).fill(3.5), ...POST]);
  const ramp = metric('mem', [...Array.from({ length: 30 }, (_, i) => 1 + i), ...POST]);
  const settling = metric('lat', [
    ...Array<number>(20).fill(30),
    ...Array<number>(10).fill(3.5),
    ...POST,
  ]);
  // Five pre-samples in a thirty-sample series: a boundary exists and clears the tenth-of-the-series floor, so
  // the series is MEASURABLE and only the halving floor can refuse it — the case the census must not confuse
  // with a series that has no boundary at all.
  const short = metricFrom(25_000, 'disk', [
    ...Array<number>(5).fill(3.5),
    ...Array<number>(25).fill(40),
  ]);
  const zero = metric('net', [...Array<number>(30).fill(0), ...POST]);
  return {
    metrics: new Map([
      ['svc-a', [level, ramp]],
      ['svc-b', [settling, short, zero]],
    ]),
    injectTime: INJECT_AT,
    truth,
  };
}

describe('deriveAnchorCensus — a partition, not a sample', () => {
  it('counts every (service, metric) series exactly once under every reading', () => {
    const census = deriveAnchorCensus(mixedCase(), 'pre-injection');

    expect(census.series).toBe(5);
    for (const reading of READINGS) {
      expect(census.decisions[reading].anchored + census.decisions[reading].refused).toBe(
        census.series,
      );
    }
    // …and the guard-independent column partitions the same population, which is what lets it be subtracted
    // from the total to get `measurable`.
    const unplaceable = Object.values(census.unplaceable).reduce((a, b) => a + b, 0);
    expect(unplaceable + census.measurable).toBe(census.series);
  });

  it('separates a SHORT pre-segment from an un-anchorable one, because they are different repairs', () => {
    const census = deriveAnchorCensus(mixedCase(), 'pre-injection');

    // `disk` is five samples of 3.5 then the fault: a boundary exists, so it is MEASURABLE, and only a guard
    // can refuse it (it cannot be halved). `net` has a zero baseline, which no guard can repair.
    expect(census.unplaceable['non-positive-baseline']).toBe(1);
    expect(census.unplaceable['narrow-segment']).toBe(0);
    expect(census.unplaceable['no-injection-time']).toBe(0);
    expect(census.measurable).toBe(4);
    expect(census.unplaceable['undecidable-drift']).toBe(0);
  });

  it('reads the same drift population whether the run was anchored or not', () => {
    // The statistic is a property of the series, which is what lets ONE dispatch price every value of the axis.
    const anchored = deriveAnchorCensus(mixedCase(), 'pre-injection');
    const shipped = deriveAnchorCensus(mixedCase(), 'whole-file');

    expect(shipped.drift).toEqual(anchored.drift);
    expect(shipped.measurable).toBe(anchored.measurable);
    expect(shipped.unplaceable).toEqual(anchored.unplaceable);
    // …and the three decision columns are IDENTICAL, because they are readings of the series rather than of the
    // configuration: `anchor` says which column the run used, the columns themselves do not move with it. That
    // is what lets a shipped-configuration dispatch price the axis it did not run.
    expect(shipped.decisions).toEqual(anchored.decisions);
  });

  it('prices all three readings on the same numbers', () => {
    const census = deriveAnchorCensus(mixedCase(), 'pre-injection');

    // Four measurable series: the level (drift ≈ 0), the settling one (−0.88), the ramp (+0.97) and the short
    // one (no drift). So `unguarded` anchors all four, `stationary` anchors only the level, and `non-rising`
    // anchors the level AND the settling one — which is the distinction the fourth value is built on.
    expect(census.decisions.unguarded.anchored).toBe(4);
    expect(census.decisions.stationary.anchored).toBe(1);
    expect(census.decisions['non-rising'].anchored).toBe(2);
    expect(census.drift).toEqual({
      judged: 3,
      rising: 1,
      settling: 1,
      level: 1,
      maxAbs: census.drift.maxAbs,
    });
    expect(census.drift.maxAbs).toBeGreaterThan(0.8);
  });
});

describe('deriveAnchorCensus — the truth column, and the reasons a reader will need', () => {
  it('records the truth’s own series with their drift and their outcome', () => {
    const census = deriveAnchorCensus(mixedCase('svc-a'), 'pre-injection-stationary');

    expect(census.truth.map((t) => t.label).sort()).toEqual(['cpu', 'mem']);
    const cpu = census.truth.find((t) => t.label === 'cpu')!;
    const mem = census.truth.find((t) => t.label === 'mem')!;
    expect(cpu.outcome).toBe('placed');
    expect(cpu.anchored).toBe(true);
    expect(Math.abs(cpu.drift!)).toBeLessThan(0.01);
    // The truth's ramp is refused BY THE GUARD, and the reason says so rather than saying "no window".
    expect(mem.outcome).toBe('drift');
    expect(mem.anchored).toBe(false);
    expect(mem.drift!).toBeGreaterThan(0.25);
  });

  it('does not report a shipped run’s series as guard-refused, because `whole-file` asks nothing', () => {
    // The distinction that keeps most artifacts honest: `whole-file` is what SHIPS, so a census that called its
    // series `drift`-refused would attribute a guard's decision to a configuration that has no guard.
    const census = deriveAnchorCensus(mixedCase('svc-a'), 'whole-file');

    expect(census.truth.map((t) => t.outcome)).toEqual([
      'no-window-by-config',
      'no-window-by-config',
    ]);
    expect(census.truth.every((t) => !t.anchored)).toBe(true);
    // …and the drift is still reported, because the statistic belongs to the series and not to the run.
    expect(census.truth.map((t) => t.drift !== undefined)).toEqual([true, true]);
  });

  it('carries a truth that is not in the graph as an empty column rather than as a fabricated entry', () => {
    const census = deriveAnchorCensus(mixedCase('svc-missing'), 'pre-injection');

    expect(census.truth).toEqual([]);
    expect(census.series).toBe(5);
  });

  it('reports every refusal key on every record, zeros included', () => {
    const census = deriveAnchorCensus(mixedCase(), 'pre-injection');

    for (const reason of ANCHOR_REFUSALS) {
      expect(census.unplaceable[reason]).toBeTypeOf('number');
    }
    expect(Object.keys(census.unplaceable).sort()).toEqual([...ANCHOR_REFUSALS].sort());
  });

  it('survives JSON with every key present, including a drift it could not read', () => {
    // `JSON.stringify` drops an undefined property, so a `number | undefined` drift would vanish from the
    // artifact for exactly the series whose pre-segment is too short to halve — a well-formed file with a field
    // silently missing, which is the failure mode the latency census' fence names.
    const census = deriveAnchorCensus(mixedCase('svc-b'), 'pre-injection');
    const back = JSON.parse(JSON.stringify(census)) as typeof census;

    expect(back.truth.map((t) => 'drift' in t)).toEqual([true, true, true]);
    // The settling series reads a number, and the two it cannot read — a five-sample pre-segment and a series
    // with no boundary — read `null` IN THE FILE rather than vanishing from it.
    expect(back.truth.map((t) => t.drift)).toEqual([expect.any(Number), null, null]);
    expect(back.truth[0]!.drift!).toBeLessThan(-0.25);
  });

  it('is JSON-safe, because the loss census writes it as one line per case', () => {
    const census = deriveAnchorCensus(mixedCase(), 'pre-injection');

    expect(JSON.parse(JSON.stringify(census))).toEqual(census);
  });
});

describe('deriveAnchorCensus — degenerate cases the corpus actually contains', () => {
  it('handles a case with no metrics at all without inventing a denominator', () => {
    const census = deriveAnchorCensus(
      { metrics: new Map(), injectTime: INJECT_AT, truth: 'svc' },
      'pre-injection',
    );

    expect(census.series).toBe(0);
    expect(census.measurable).toBe(0);
    expect(census.drift.maxAbs).toBe(0);
    for (const reading of READINGS)
      expect(census.decisions[reading]).toEqual({ anchored: 0, refused: 0 });
  });

  it('counts an unknown injection time as unplaceable under `no-injection-time`, for every series', () => {
    const census = deriveAnchorCensus({ ...mixedCase(), injectTime: 0 }, 'pre-injection');

    expect(census.unplaceable['no-injection-time']).toBe(census.series);
    expect(census.measurable).toBe(0);
    expect(census.decisions.unguarded.anchored).toBe(0);
  });

  it('counts a `t₀` past the end of every series as `no-boundary`, which is a different repair', () => {
    const census = deriveAnchorCensus({ ...mixedCase(), injectTime: 1e12 }, 'pre-injection');

    expect(census.unplaceable['no-boundary']).toBe(census.series);
    expect(census.unplaceable['no-injection-time']).toBe(0);
  });
});

describe('the instrument is wired to the engine and not to a second spelling of it', () => {
  /** The two source files this fence reads, resolved the way the other source-shape fences in this package are. */
  const read = (rel: string): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');

  it('derives its decisions from the engine’s predicate rather than re-spelling the comparison', () => {
    const source = stripComments(read('src/anchor-census.ts'));

    // The one line that must not exist here: a local `drift <= tolerance` is the boundary-without-the-engine
    // that `docs/term-gap.md` is about, and it would move silently the day the engine's guard changes.
    expect(source).not.toMatch(/drift\s*[<>]=?\s*\w*tolerance/);
    expect(source).toMatch(/judgePreWindowDrift/);
    expect(source).toMatch(/probePreInjectionWindow/);
    // …and the guards are the ENGINE's record, so `whole-file`/`pre-injection` cannot drift from unguarded.
    expect(source).toMatch(/PRE_WINDOW_GUARDS\[/);
  });

  it('is carried on the loss row as a REQUIRED field, computed from the series the engine receives', () => {
    const census = stripComments(read('src/loss-census.ts'));
    const runner = stripComments(read('src/run-rcaeval.ts'));

    expect(census).toMatch(/readonly anchorCensus: AnchorCensus;/);
    expect(census).not.toMatch(/anchorCensus\?/);
    // The row is built from the CASE's own metrics and injection time — the objects the loader handed the
    // engine — rather than from the corpus rows the census cannot match (§188.5).
    expect(runner).toMatch(
      /anchorCensus: deriveAnchorCensus\(\s*\{[^}]*metrics: c\.metrics[^}]*injectTime: c\.injectTime[^}]*\}/s,
    );
    expect(runner).not.toMatch(/readFileSync\([^)]*metrics\.json/);
  });
});
