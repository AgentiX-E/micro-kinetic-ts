/**
 * Unit tests for the term oracle — the module that rebuilds the engine's terms from
 * a dump and pre-screens alternative configurations offline.
 *
 * Blocks are produced by the REAL formatter and read back by the real parser, so a
 * format change fails here rather than making the oracle quietly rank nothing.
 *
 * The fixtures carry a strictly ordered, well-spread `selfAnomaly` vector by default.
 * Above the engine's rescale threshold that vector IS the rank rescale the producer
 * prints; below it the same numbers are a legal RAW vector, since a raw deviation is
 * whatever the case's data made it. This header used to claim the rank shape was the
 * only thing the producer could print, and that claim is what the reconstruction was
 * built on: it rebuilt the metric term from the row order, which is the engine's
 * quantity only where the engine rescaled. The check that should have caught it
 * (`max == 1.000 above the threshold`) now exists, and so does the test that a case
 * below the threshold is not asked for one.
 *
 * @module benchmarks/__tests__/fse26-term-oracle
 */

import { describe, expect, it } from 'vitest';

import {
  formatFSE26Diagnostic,
  SERVICE_FIELD_DECIMALS,
} from '../../packages/kinetic/src/benchmarks/index.js';
import {
  ANOMALY_NORMALIZE_NODE_THRESHOLD,
  computePoolMetricScores,
  DEFAULT_HTTP_DOMINANCE_THRESHOLD,
  DEFAULT_ONSET_SHAPE,
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
import type { ModeScreen, TermOracleOptions } from '../src/fse26-term-oracle.js';
import {
  blendScores,
  byAnomalyDescending,
  byScoreDescending,
  canReconstructLogFlood,
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
  logFloodReach,
  logSlopesForMode,
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
   * The temporal prior OFF, on the same rule as the pool penalty below: every expectation
   * in this file that predates the term was written against the FOUR-term score, and
   * inheriting the shipped pair would silently re-express all of them. The term's own
   * tests set the pair and say what they measure.
   */
  temporalWeight: 0,
  onsetShape: DEFAULT_ONSET_SHAPE,
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
   * the `logicHttp` mode computes it: `|logic ∪ http| / max|logic ∪ http|`.
   *
   * Derived rather than defaulted to 0, because the formatter takes the printed score
   * and the raw counts as INDEPENDENT inputs — a fixture that set the counts and left
   * this at 0 would be a block the engine never writes, and a test built on it would be
   * measuring the recorder rather than the mode. Set it explicitly only where the test
   * is about a disagreement between the two (the fidelity check counts those).
   */
  logScore?: number;
  /**
   * Defaults to a strictly ordered, well-spread vector derived from the spec's position.
   *
   * At or above `ANOMALY_NORMALIZE_NODE_THRESHOLD` candidates that is EXACTLY what the
   * producer prints, because the engine rescales there; below it the same numbers are a
   * legal raw vector rather than the implied one. Set it explicitly wherever the test is
   * about the metric term itself, a tie group, or a single candidate.
   */
  selfAnomaly?: number;
  latRise?: number;
  latEdges?: number;
  /** Onset delay in ms after injection; `-1` for the engine's "undetermined". */
  onset?: number;
  logic?: number;
  http?: number;
  /**
   * Lines carrying BOTH signature flags. Zero by default, i.e. the two sets are
   * disjoint, which is the case the fixtures predating this field were written for.
   *
   * Set it wherever the test is about the flood's arithmetic: `logic + http` is not
   * the number of admitted lines unless the sets are disjoint, and a fixture that
   * cannot express an overlap cannot expose the double-count.
   */
  both?: number;
  /**
   * ERROR lines, and FATAL lines.
   *
   * Default to the level-1 flood and to 0, which is what the fixtures written before the
   * `all` mode needed. Set them where the test is about the mode that admits EVERY error
   * line: its flood is `err + fatal`, and a fixture whose totals are derived from the
   * signature counts cannot express a source whose errors are neither signature.
   */
  err?: number;
  fatal?: number;
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
    /**
     * Render the block as a producer that predates the overlap count would: the
     * field is absent from every service line, so the level-1 flood cannot be
     * recovered and the reader must say so rather than assume disjoint sets.
     */
    omitOverlap?: boolean;
    /**
     * The mode the block DECLARES, and the one its printed term is derived from. They are
     * the same string by default (`logicHttp`), and separating them is what lets a test
     * write a block the producer could actually emit in another mode.
     */
    logMode?: string;
    mode?: 'logicHttp' | 'count' | 'all';
  } = {},
): string {
  const n = specs.length;
  const mode = overrides.mode ?? 'logicHttp';
  // The mode's own level-1 flood, which is what the engine divides by:
  //   `count`    — logic exceptions alone;
  //   the rest   — the UNION of the two signature sets (a line can carry both flags and the
  //                engine admits it once), which for fixtures that leave `both` unset is the sum;
  //   `all`      — every ERROR/FATAL line, so `err + fatal` and no union to recover.
  const flood = (spec: ServiceSpec): number => {
    if (mode === 'all') return (spec.err ?? 0) + (spec.fatal ?? 0);
    if (mode === 'count') return spec.logic ?? 0;
    return (spec.logic ?? 0) + (spec.http ?? 0) - (spec.both ?? 0);
  };
  const peak = specs.reduce((max, spec) => Math.max(max, flood(spec)), 0);
  const services = specs.map((spec, i) => ({
    serviceId: spec.serviceId,
    metricNames: ['cpu'],
    dominantMetric: spec.dominant ?? 'cpu',
    selfAnomaly: spec.selfAnomaly ?? (n < 2 ? 1 : (n - 1 - i) / (n - 1)),
    logScore: spec.logScore ?? (peak > 0 ? flood(spec) / peak : 0),
    failedEdgeScore: 0,
    failedEdgeRecords: 0,
    latRise: spec.latRise,
    latEdges: spec.latEdges ?? 0,
    onsetDelayMs: spec.onset,
    // Defaulted to the mode's own flood, which is what the producer's counts come from —
    // except in `all` mode, where the fixture says them and the flood is derived FROM them.
    errorCount: spec.err ?? flood(spec),
    fatalCount: spec.fatal ?? 0,
    logicExceptionCount: spec.logic ?? 0,
    httpExceptionCount: spec.http ?? 0,
    // `undefined` rather than 0 when the override asks for an OLD producer: the
    // formatter omits the whole field, which is the only shape that lets the reader
    // tell "measured disjoint" from "never measured".
    bothExceptionCount: overrides.omitOverlap === true ? undefined : (spec.both ?? 0),
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
    logSignalMode: overrides.logMode ?? mode,
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

describe('the metric term is READ off the row, never rebuilt', () => {
  it('scores each service with log1p of ITS OWN printed anomaly', () => {
    // The engine ranks on `log1p(selfScores.get(id))` (`pruner.ts` 1400/1575), and the row
    // prints that value, so the reconstruction must not substitute anything for it. The
    // metric term is isolated by zeroing the other three, which is what makes the expected
    // number the term's own rather than a blend's.
    const kase = casesOf(
      block([
        { serviceId: 'ts-high', selfAnomaly: 0.9 },
        { serviceId: 'ts-low', selfAnomaly: 0.4 },
      ]),
    )[0]!;
    const scores = blendScores(
      kase,
      { ...OPTS, logWeight: 0, latWeight: 0, poolWeight: 0, temporalWeight: 0 },
      'recorded',
      new Map(),
    );
    expect(scores.get('ts-high')!).toBeCloseTo(Math.log1p(0.9), 12);
    expect(scores.get('ts-low')!).toBeCloseTo(Math.log1p(0.4), 12);
  });

  it('keeps the row’s own GAP, which is what a flip under a perturbation is decided by', () => {
    // The defect in one number. A reconstruction that rebuilt the rank rescale from the row
    // order would put these two services at log1p(1) and log1p(0), i.e. a gap of 0.693 — 2.3×
    // the row's own 0.305 — and every window, margin and `--at-weight` verdict solved on that
    // base is solved on a quantity the engine never ranked on. Measured on the paired
    // dispatch, the model's gained/lost counts were 7/13 against the engine's 1/3.
    const kase = casesOf(
      block([
        { serviceId: 'ts-high', selfAnomaly: 0.9 },
        { serviceId: 'ts-low', selfAnomaly: 0.4 },
      ]),
    )[0]!;
    const scores = blendScores(
      kase,
      { ...OPTS, logWeight: 0, latWeight: 0, poolWeight: 0, temporalWeight: 0 },
      'recorded',
      new Map(),
    );
    const gap = scores.get('ts-high')! - scores.get('ts-low')!;
    expect(gap).toBeCloseTo(Math.log1p(0.9) - Math.log1p(0.4), 12);
    expect(gap).toBeLessThan(Math.log1p(1) - Math.log1p(0));
  });

  it('reads a RESCALED row as the rescaled value, not as the rank it implies', () => {
    // The mirror image, at or above the threshold: the printed value IS the rank rescale, and
    // reading it gives that value rather than a second derivation of it. For a case at the
    // threshold the top two services are 1.000 and 0.947 — not 1 and 0.9 — so a reconstruction
    // that replaced one with the other is wrong on this side of the boundary too. The expected
    // numbers are the RENDERED ones, because that is all the artifact carries.
    const specs = Array.from({ length: ANOMALY_NORMALIZE_NODE_THRESHOLD }, (_, i) => ({
      serviceId: `ts-${i}`,
    }));
    const kase = casesOf(block(specs))[0]!;
    const scores = blendScores(
      kase,
      { ...OPTS, logWeight: 0, latWeight: 0, poolWeight: 0, temporalWeight: 0 },
      'recorded',
      new Map(),
    );
    const n = ANOMALY_NORMALIZE_NODE_THRESHOLD;
    const second = Number(((n - 2) / (n - 1)).toFixed(SERVICE_FIELD_DECIMALS));
    expect(scores.get('ts-0')!).toBeCloseTo(Math.log1p(1), 12);
    expect(scores.get('ts-1')!).toBeCloseTo(Math.log1p(second), 12);
    expect(second).toBeLessThan(1);
  });

  it('the metric term’s own order is the rows’ order, ties broken by id', () => {
    const kase = casesOf(
      block([
        { serviceId: 'ts-b', selfAnomaly: 0.5 },
        { serviceId: 'ts-a', selfAnomaly: 0.5 },
        { serviceId: 'ts-c', selfAnomaly: 0.9 },
      ]),
    )[0]!;
    expect(rankCase(kase, OPTS, 'recorded', new Map()).byTerm.metric).toEqual([
      'ts-c',
      'ts-a',
      'ts-b',
    ]);
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
    { serviceId: 'src', logicExceptionCount: 0, httpExceptionCount: 8, bothExceptionCount: 0 },
    { serviceId: 'victim-a', logicExceptionCount: 0, httpExceptionCount: 1, bothExceptionCount: 0 },
    { serviceId: 'root', logicExceptionCount: 4, httpExceptionCount: 0, bothExceptionCount: 0 },
  ] as never;

  it('count mode admits logic exceptions only, and divides by the count it admits', () => {
    // The engine accumulates the denominator from the SAME level-1 gate as the
    // numerator, and `count` admits logic exceptions alone — a purely
    // framework-HTTP line is not a `count`-mode source signature. So the flood this
    // mode divides by is `max(logic)`, and the surviving root scores 4/4.
    //
    // This test used to assert `4 / 8`, on the reasoning that "the denominator stays
    // the level-1 maximum (`logic + http`)". That reasoning was wrong twice over: the
    // gate is mode-dependent, so the denominator must be too, and it was measured
    // against the engine's `count` mode, whose admitted map never sees the HTTP line.
    const slopes = logSlopesForMode(services, 'count', 0.5);
    expect(slopes.has('src')).toBe(false);
    expect(slopes.get('root')).toBeCloseTo(1, 12);
  });

  it('logicHttp mode admits both signatures against the same denominator', () => {
    const slopes = logSlopesForMode(services, 'logicHttp', 0.5);
    expect(slopes.get('src')).toBeCloseTo(1, 12);
    expect(slopes.get('root')).toBeCloseTo(0.5, 12);
  });

  it('counts a line that carries BOTH signatures ONCE', () => {
    // The defect this test was written for, with the run's own numbers.
    //
    // `logic` and `http` are counted independently, so a line that is both a logic
    // exception and a framework-HTTP exception increments both — and the engine,
    // whose gate is a boolean per line, admits it once. Here the source carries
    // `logic=3495` entirely INSIDE `http=3499` (out of `err=3499` lines), so the
    // union is 3499 while the sum is 6994.
    //
    // The dump prints the engine's own values for this case, which is what makes the
    // arithmetic falsifiable rather than a matter of reading the code:
    //   ts-basic-service 1.000   215/3499 = 0.0614 → printed 0.061
    //   ts-travel-service 0.061  215/6994 = 0.0307 → the old, double-counted value
    // 109 services across the shipped dump differed this way, and the instrument
    // reported the disagreement as its "error bar" rather than as this defect.
    const overlap = [
      {
        serviceId: 'ts-basic-service',
        logicExceptionCount: 3495,
        httpExceptionCount: 3499,
        bothExceptionCount: 3495,
      },
      {
        serviceId: 'ts-travel-service',
        logicExceptionCount: 0,
        httpExceptionCount: 215,
        bothExceptionCount: 0,
      },
      {
        serviceId: 'ts-preserve-service',
        logicExceptionCount: 0,
        httpExceptionCount: 13,
        bothExceptionCount: 0,
      },
    ] as never;
    const slopes = logSlopesForMode(overlap, 'logicHttp', 0.5);
    expect(slopes.get('ts-basic-service')).toBeCloseTo(1, 12);
    expect(slopes.get('ts-travel-service')).toBeCloseTo(215 / 3499, 12);
    expect(slopes.get('ts-preserve-service')).toBeCloseTo(13 / 3499, 12);
    // Not the sum: that is the value the dump contradicts.
    expect(slopes.get('ts-travel-service')).not.toBeCloseTo(215 / 6994, 6);
  });

  it('leaves `count` mode blind to the overlap because it never admits the HTTP half', () => {
    // Same case, `count` mode: the denominator is `max(logic)` = 3495, and the two
    // HTTP-only services are absent rather than scored. A reader that subtracted the
    // overlap from a sum here would move a mode the overlap cannot touch.
    const overlap = [
      {
        serviceId: 'ts-basic-service',
        logicExceptionCount: 3495,
        httpExceptionCount: 3499,
        bothExceptionCount: 3495,
      },
      {
        serviceId: 'ts-travel-service',
        logicExceptionCount: 0,
        httpExceptionCount: 215,
        bothExceptionCount: 0,
      },
    ] as never;
    const slopes = logSlopesForMode(overlap, 'count', 0.5);
    expect(slopes.get('ts-basic-service')).toBeCloseTo(1, 12);
    expect(slopes.has('ts-travel-service')).toBe(false);
  });

  it('recovers the union from the error total on a dump without the overlap, PROVING it', () => {
    // The fallback path, and the reason an old dump is still readable. The union is
    // bracketed by `max(logic, http) ≤ U ≤ min(logic + http, err + fatal)`; when the
    // bracket is a point the value is proved. Here `err=3499` equals the http count,
    // so every error line of the flood emitter is a signature line and U = 3499 —
    // the same value the `both=` field would have carried (3495 + 3499 − 3495).
    const legacy = [
      {
        serviceId: 'ts-basic-service',
        logicExceptionCount: 3495,
        httpExceptionCount: 3499,
        errorCount: 3499,
        fatalCount: 0,
      },
      {
        serviceId: 'ts-travel-service',
        logicExceptionCount: 0,
        httpExceptionCount: 215,
        errorCount: 215,
        fatalCount: 0,
      },
    ] as never;
    expect(canReconstructLogFlood(legacy, 'logicHttp')).toBe(true);
    const slopes = logSlopesForMode(legacy, 'logicHttp', 0.5);
    expect(slopes.get('ts-basic-service')).toBeCloseTo(1, 12);
    expect(slopes.get('ts-travel-service')).toBeCloseTo(215 / 3499, 12);
  });

  it('refuses a dump that only brackets the union, rather than defaulting either end', () => {
    // The bracket is not the value. With 10 error lines of which only some are
    // signature lines and a partial overlap, `logic=2 http=3` lies between 3 and 5 —
    // and choosing the lower end understates the flood while the upper end reproduces
    // the double-count. Both would print as measured numbers.
    const ambiguous = [
      {
        serviceId: 'src',
        logicExceptionCount: 2,
        httpExceptionCount: 3,
        errorCount: 10,
        fatalCount: 0,
      },
    ] as never;
    expect(canReconstructLogFlood(ambiguous, 'logicHttp')).toBe(false);
    expect(() => logSlopesForMode(ambiguous, 'logicHttp', 0.5)).toThrow(
      /bracket the union without pinning/,
    );
    // `count` never consults the HTTP half, so the same dump is still readable for it.
    expect(canReconstructLogFlood(ambiguous, 'count')).toBe(true);
    expect(logSlopesForMode(ambiguous, 'count', 0.5).get('src')).toBeCloseTo(1, 12);
  });

  it('takes the printed overlap when the dump carries it, even when the bracket disagrees', () => {
    // The field is the primitive and it WINS: it is the producer's direct count, while
    // the bracket is an argument about the same quantity. A dump that carried both and
    // had them disagree would be a producer defect, and preferring the field keeps the
    // reader from quietly re-deriving around it.
    const withField = [
      {
        serviceId: 'src',
        logicExceptionCount: 2,
        httpExceptionCount: 3,
        bothExceptionCount: 1,
        errorCount: 10,
        fatalCount: 0,
      },
    ] as never;
    expect(canReconstructLogFlood(withField, 'logicHttp')).toBe(true);
    // 2 + 3 − 1 = 4, not the bracket's endpoints (3 or 5).
    expect(logSlopesForMode(withField, 'logicHttp', 0.5).get('src')).toBeCloseTo(1, 12);
    const wider = [
      {
        serviceId: 'src',
        logicExceptionCount: 2,
        httpExceptionCount: 3,
        bothExceptionCount: 1,
        errorCount: 10,
        fatalCount: 0,
      },
      {
        serviceId: 'other',
        logicExceptionCount: 0,
        httpExceptionCount: 4,
        errorCount: 4,
        fatalCount: 0,
      },
    ] as never;
    expect(logSlopesForMode(wider, 'logicHttp', 0.5).get('src')).toBeCloseTo(4 / 4, 12);
  });

  it('reports the REACH of a mode, and counts a refusal exactly where it refuses', () => {
    // One walk, two readings: "may this be read at all" is `unproved === 0`, and the count is what a report
    // needs to say WHY a row is short. The three services below are the three states of the bracket, and two
    // of them are the shipped dump's own shapes — `logic=3495 http=3499 err=3499` pins at 3499, and
    // `logic=1407 http=1 err=1408` is refused over a ONE-line interval. Run `35035314921` refuses 31 rows in
    // 31 cases over intervals of 1 to 32 lines, measured through this same function.
    const mixed = [
      {
        serviceId: 'pinned',
        logicExceptionCount: 3495,
        httpExceptionCount: 3499,
        errorCount: 3499,
        fatalCount: 0,
      },
      {
        serviceId: 'refused',
        logicExceptionCount: 1407,
        httpExceptionCount: 1,
        errorCount: 1408,
        fatalCount: 0,
      },
      {
        serviceId: 'declared',
        logicExceptionCount: 2,
        httpExceptionCount: 3,
        bothExceptionCount: 1,
        errorCount: 10,
        fatalCount: 0,
      },
    ] as never;
    // `logic=1407 http=1 err=1408` leaves `max = 1407` against `min = 1408`: the union is unknown within
    // ONE line, which is the shape of all 31 refusals on the shipped dump (widest 7).
    expect(logFloodReach(mixed, 'logicHttp')).toEqual({ proved: 2, unproved: 1, widestRefusal: 1 });
    // The boolean is the count, not a second walk that could disagree with it.
    expect(canReconstructLogFlood(mixed, 'logicHttp')).toBe(false);
    // The modes that need no union cannot be refused at all — by construction, not usually.
    expect(logFloodReach(mixed, 'count')).toEqual({ proved: 3, unproved: 0, widestRefusal: 0 });
    expect(logFloodReach(mixed, 'all')).toEqual({ proved: 3, unproved: 0, widestRefusal: 0 });
    expect(logFloodReach([], 'logicHttp')).toEqual({ proved: 0, unproved: 0, widestRefusal: 0 });
  });

  it("prints a mode row's refusals, and gives the baseline none to claim", () => {
    // The reach has to travel with the row: a reader who sees `[1/2 cases]` and not the refusals looks for a
    // defect in the MODE rather than for the primitive the artifact does not carry. The baseline row
    // reconstructs nothing, so it carries `undefined` — a `0` there would read as "every service was proved",
    // which is a claim about a reconstruction that never ran.
    const text =
      block(
        [
          { serviceId: 'ts-root', selfAnomaly: 1, logic: 2, http: 3, err: 10, onset: 1 },
          { serviceId: 'ts-other', selfAnomaly: 0.5, logic: 1, http: 1, err: 2, onset: 2 },
        ],
        { omitOverlap: true, groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
      ) +
      block([{ serviceId: 'ts-root', selfAnomaly: 1, logic: 1, http: 0, onset: 1 }], {
        datapack: 'dp-2',
      });
    const cases = parseDiagnosticDump(text);
    expect(cases).toHaveLength(2);
    const screen = modeScreen(cases, OPTS);
    const logicHttpRow = screen.rows.find((row) => row.source === 'logicHttp')!;
    // TWO rows refused, in ONE case: the row-level count and the case-level population are different
    // populations, which is why the report prints both and why a reader must not read one as the other.
    expect(logicHttpRow.unprovedRows).toBe(2);
    // The widest refusal, in the lines the flood is counted in: `logic=2 http=3 err=10` leaves
    // `max = 3` and `min = 5`, i.e. the union is unknown within two lines — the cost, not just the count.
    expect(logicHttpRow.widestRefusal).toBe(2);
    expect(logicHttpRow.cases).toBe(1);
    expect(screen.rows[0]!.unprovedRows).toBeUndefined();
    expect(screen.rows[0]!.widestRefusal).toBeUndefined();
    const printed = formatModeScreen(screen);
    expect(printed).toContain('2 service row(s) unproved over ≤ 2 line(s)');
    expect(printed).toContain('no `both=` in this dump');
    expect(printed).toContain('[1/2 cases]');
    // A mode that needs no union prints no refusal at all, on the same dump.
    const countRow = screen.rows.find((row) => row.source === 'count')!;
    expect(countRow.unprovedRows).toBe(0);
  });

  it('dominant suppresses framework HTTP when the flood is spread', () => {
    const spread = [
      { serviceId: 'a', logicExceptionCount: 0, httpExceptionCount: 1, bothExceptionCount: 0 },
      { serviceId: 'b', logicExceptionCount: 0, httpExceptionCount: 1, bothExceptionCount: 0 },
      { serviceId: 'c', logicExceptionCount: 0, httpExceptionCount: 1, bothExceptionCount: 0 },
      { serviceId: 'd', logicExceptionCount: 0, httpExceptionCount: 1, bothExceptionCount: 0 },
      { serviceId: 'e', logicExceptionCount: 0, httpExceptionCount: 1, bothExceptionCount: 0 },
      { serviceId: 'root', logicExceptionCount: 4, httpExceptionCount: 0, bothExceptionCount: 0 },
    ] as never;
    const slopes = logSlopesForMode(spread, 'dominant', 0.5);
    expect(slopes.has('a')).toBe(false);
    expect(slopes.get('root')).toBeCloseTo(1, 12);
  });

  it('withdraws only the HTTP-ONLY lines when the dominant gate closes', () => {
    // The gate removes the framework-HTTP half, and "half" means the set difference:
    // a line that is BOTH a logic exception and an HTTP exception survives, because
    // the logic signature is self-caused and is never withdrawn. Subtracting the raw
    // http count instead would delete the source's own evidence with the cascade's.
    const concentrated = [
      { serviceId: 'src', logicExceptionCount: 2, httpExceptionCount: 10, bothExceptionCount: 2 },
      { serviceId: 'other', logicExceptionCount: 0, httpExceptionCount: 1, bothExceptionCount: 0 },
    ] as never;
    // Dominance 10/11 ≈ 0.909 ≥ 0.5, so the gate stays open: the source keeps its
    // whole admitted set (the union, 10) over the flood's maximum (10).
    expect(logSlopesForMode(concentrated, 'dominant', 0.5).get('src')).toBeCloseTo(1, 12);
  });

  it('keeps the level-1 denominator when the gate withdraws a flood', () => {
    // The engine's asymmetry: withdrawal can only LOWER a score and can never promote
    // a mid-tier emitter to 1.0, which is why the two maps are accumulated separately.
    const spread = [
      { serviceId: 'a', logicExceptionCount: 0, httpExceptionCount: 6, bothExceptionCount: 0 },
      { serviceId: 'b', logicExceptionCount: 0, httpExceptionCount: 6, bothExceptionCount: 0 },
      { serviceId: 'c', logicExceptionCount: 0, httpExceptionCount: 6, bothExceptionCount: 0 },
      { serviceId: 'root', logicExceptionCount: 3, httpExceptionCount: 0, bothExceptionCount: 0 },
    ] as never;
    expect(logSlopesForMode(spread, 'dominant', 0.5).get('root')).toBeCloseTo(0.5, 12);
  });

  it('treats the threshold as inclusive, matching the engine', () => {
    const even = [
      { serviceId: 'a', logicExceptionCount: 0, httpExceptionCount: 1, bothExceptionCount: 0 },
      { serviceId: 'b', logicExceptionCount: 0, httpExceptionCount: 1, bothExceptionCount: 0 },
    ] as never;
    expect(logSlopesForMode(even, 'dominant', 0.5).size).toBe(2);
    expect(logSlopesForMode(even, 'dominant', 0.5000001).size).toBe(0);
  });

  it('returns nothing when the case carries no admitted line', () => {
    expect(
      logSlopesForMode(
        [
          {
            serviceId: 'a',
            logicExceptionCount: 0,
            httpExceptionCount: 0,
            bothExceptionCount: 0,
          } as never,
        ],
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
    // Three candidates is below the engine's rescale threshold, so the rows carry raw
    // deviations — the population on which the metric term must be read rather than rebuilt.
    expect(fidelity.rawCases).toBe(1);
    expect(fidelity.rescaledCases).toBe(0);
    expect(fidelity.aboveOneAtOrAboveThreshold).toBe(0);
    expect(fidelity.orderConsistent).toBe(1);
    expect(fidelity.top1Matches).toBe(1);
    expect(fidelity.top1Correct).toBe(1);
    expect(fidelity.recordedLogFlips).toBe(0);
  });

  it('counts the cases the TEMPORAL prior reorders, against its own ablated arm', () => {
    // The term has no order of its own, so `temporalFlips` is the only place its
    // footprint is reported as a number — and a reconstruction that carried the pair but
    // never applied it would otherwise read exactly like one that did. The fixture puts
    // the metric leader second in time, so the shipped `earliest-only` shape promotes the
    // first mover: at weight 1 the rank-1 changes, at 0 it does not.
    const cases = casesOf(
      block(
        [
          { serviceId: 'ts-late', selfAnomaly: 0.9, onset: 60000 },
          { serviceId: 'ts-early', selfAnomaly: 0.8, onset: 0 },
        ],
        { groundTruth: ['ts-late'], topPredictions: ['ts-early'], injectTimeMs: 1_700_000_000_000 },
      ),
    );

    expect(oracleFidelity(cases, { ...OPTS, temporalWeight: 0 }).temporalFlips).toBe(0);
    expect(oracleFidelity(cases, { ...OPTS, temporalWeight: 1 }).temporalFlips).toBe(1);
  });

  it('flags a case at or above the threshold carrying a value ABOVE 1', () => {
    // The counter that replaces the deviation line, in the direction that can actually FAIL:
    // BOTH of the engine's rescales map the case maximum to 1, so a case this large carrying a
    // value above 1 is a case whose scores were not rescaled at all — the threshold moved, or
    // something else wrote the dump. This fixture is exactly that case, which the engine cannot
    // emit.
    const specs = Array.from({ length: ANOMALY_NORMALIZE_NODE_THRESHOLD }, (_, i) => ({
      serviceId: `ts-${i}`,
      selfAnomaly: 1.4 - i * 0.01,
    }));
    const fidelity = oracleFidelity(casesOf(block(specs)), OPTS);
    expect(fidelity.rescaledCases).toBe(1);
    expect(fidelity.rawCases).toBe(0);
    expect(fidelity.aboveOneAtOrAboveThreshold).toBe(1);
  });

  it('makes NO such claim one candidate below the threshold', () => {
    // A raw deviation above 1 is perfectly legal — it is what a modest case's own data looks
    // like — so the same block one candidate short must not be reported as a defect: a check
    // that fires on the engine's own output is worse than no check, because it teaches its
    // reader to ignore it.
    const specs = Array.from({ length: ANOMALY_NORMALIZE_NODE_THRESHOLD - 1 }, (_, i) => ({
      serviceId: `ts-${i}`,
      selfAnomaly: 1.4 - i * 0.01,
    }));
    const fidelity = oracleFidelity(casesOf(block(specs)), OPTS);
    expect(fidelity.rawCases).toBe(1);
    expect(fidelity.rescaledCases).toBe(0);
    expect(fidelity.aboveOneAtOrAboveThreshold).toBe(0);
  });

  it('does NOT claim a 1.000 maximum — a TIED top reads as the tie group’s mean rank', () => {
    // The stronger form of the check was written first and is false, and the first dump it was
    // pointed at said so in one line: 34 of the FSE'26 dump's 1422 rescaled cases carry a
    // maximum of 0.95–0.99, one of them a six-way tie at the top reading `47.5 / 50`. The
    // fixture is that arithmetic in the smallest form the engine can emit: with the top TWO of
    // 20 candidates tied, `rankNormalizeScores` gives the group the mean of ranks 18 and 19, so
    // both read `18.5 / 19 = 0.9737` — below 1, and on a case with nothing above 1 in it.
    const n = ANOMALY_NORMALIZE_NODE_THRESHOLD;
    // The mean of the last two 0-indexed ranks, over `n - 1`.
    const tied = (n - 2 + (n - 1)) / 2 / (n - 1);
    const specs = Array.from({ length: n }, (_, i) => ({
      serviceId: `ts-${i}`,
      selfAnomaly: i < 2 ? tied : Math.max(0, tied - 0.05 * (i - 1)),
    }));
    const fidelity = oracleFidelity(casesOf(block(specs)), OPTS);
    expect(tied).toBeLessThan(1);
    expect(fidelity.aboveOneAtOrAboveThreshold).toBe(0);
    expect(fidelity.subUnitMaximumCases).toBe(1);
  });

  it('counts an unlabelled row towards the node count the threshold reads', () => {
    // The `k8s.*` row with no service id is a candidate like any other, and the case's NODE
    // count is what decides whether the engine rescaled. A reader that dropped the row would
    // put a 20-node case below the threshold and then read a rescaled column as a raw one.
    const specs: Array<{ serviceId: string; selfAnomaly?: number }> = Array.from(
      { length: ANOMALY_NORMALIZE_NODE_THRESHOLD - 1 },
      (_, i) => ({ serviceId: `ts-${i}` }),
    );
    specs.push({ serviceId: '', selfAnomaly: 0 });
    const fidelity = oracleFidelity(casesOf(block(specs)), OPTS);
    expect(fidelity.services).toBe(ANOMALY_NORMALIZE_NODE_THRESHOLD);
    expect(fidelity.rescaledCases).toBe(1);
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
    // The rows are the recorded term, the two signature modes and `all`, then the grid — the
    // grid's order and its labels included, because a sweep whose rows cannot be told apart
    // reads as a plateau.
    expect(screen.rows.map((row) => row.source)).toEqual([
      'recorded',
      'count',
      'logicHttp',
      'all',
      'dominant',
    ]);
    expect(screen.rows.map((row) => row.dominance)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      0.5,
    ]);
    expect(screen.rows.at(-1)!.source).toBe('dominant');
  });

  it('skips a case with no acceptable root', () => {
    const noRoot = block([{ serviceId: 'ts-a' }], { groundTruth: [], datapack: 'no-root' });
    expect(modeScreen(casesOf(noRoot), OPTS).rows[0]!.perFaultType).toEqual([]);
  });

  it("self-checks the dump's OWN mode against the printed term, case for case", () => {
    // No extra data needed: the mode the run used is the mode the reader rebuilds, so
    // the two must agree on every case. This is the assertion that would have caught the
    // flood double-count — it read `+5/-0` for two iterations and was called an error
    // bar. A coherent fixture is `+0/-0` by construction.
    const coherent = casesOf(
      block(
        [
          { serviceId: 'ts-root', logic: 4 },
          { serviceId: 'ts-victim', logic: 1 },
        ],
        {
          groundTruth: ['ts-root'],
          topPredictions: ['ts-root'],
        },
      ),
    );
    const check = modeScreen(coherent, OPTS).selfCheck;
    expect(check).toEqual({
      dumpMode: 'logicHttp',
      source: 'logicHttp',
      cases: 1,
      unreadableCases: 0,
      violations: 0,
      gained: 0,
      regressed: 0,
    });
    expect(formatModeScreen(modeScreen(coherent, OPTS))).toContain('reproduces the printed term');
  });

  it('reports a NON-ZERO self-check when the printed term disagrees with the counts', () => {
    // The incoherent fixture: a printed `logScore` its own counts cannot produce. The
    // check must surface it, because every other row is measured through the same
    // reconstruction — and a silent `+0` here is what makes a defect look like a
    // rounding detail.
    //
    // The SCORE-level count is the one that fires: two reconstructions can rank
    // identically while disagreeing numerically, which is exactly how a double-counted
    // flood survived on most cases.
    const broken = casesOf(
      block([{ serviceId: 'ts-root', logScore: 1 }, { serviceId: 'ts-victim' }], {
        groundTruth: ['ts-root'],
        topPredictions: ['ts-root'],
      }),
    );
    const screen = modeScreen(broken, OPTS);
    expect(screen.selfCheck!.violations).toBe(1);
    const text = formatModeScreen(screen);
    expect(text).toContain('DISAGREES with the printed term');
    expect(text).toContain('do not read the rows below');
  });

  it('has no self-check for a mode this reader cannot rebuild', () => {
    // `novelty` is IDF-weighted and needs per-class line counts the dump does not carry,
    // so there is no reconstruction to check. Claiming one would be claiming a
    // measurement that does not exist.
    const novelty = casesOf(
      block([{ serviceId: 'ts-root', logic: 4 }], { groundTruth: ['ts-root'] }).replace(
        'logMode=logicHttp',
        'logMode=novelty',
      ),
    );
    expect(modeScreen(novelty, OPTS).selfCheck).toBeUndefined();
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

  it('prints the configuration, and labels a log-term disagreement as a DEFECT', () => {
    const text = formatFidelity(oracleFidelity(cases, OPTS), OPTS);
    expect(text).toContain('logWeight=1 latWeight=0.561495 latFloor=10.3');
    // The line used to call the disagreement an "error bar", which is a tolerance
    // claim — and a tolerance is a place a defect hides. The derived term is built
    // from the same counts the engine used, so disagreement is a defect, and the
    // rendered word says which of the two readings applies. `cases` here is the
    // fixture whose printed logScore deliberately disagrees with its counts.
    expect(text).toContain('NON-ZERO');
    expect(text).toContain('a reconstruction defect, not a tolerance');
    expect(text).not.toContain('error bar');
    expect(text).toContain('rank-1 same as the dump’s own recorded: 1/1 cases');
    // The caveat prints with the number, because the number alone is ambiguous: a
    // shortfall means "the flags are not the dump's configuration" OR "the
    // reconstruction drifted", and only a reader who knows which can act on it.
    expect(text).toContain('CONFIGURATION moving the winner');
  });

  it('says the log term is EXACT when the printed score is the flood the counts imply', () => {
    // The reading the fixed reconstruction earns: the derived `logicHttp` term IS the
    // dump's own mode, so the two agree service for service and the mode rows below
    // carry no error bar at all.
    const coherent = casesOf(
      block([{ serviceId: 'ts-root', logic: 4 }, { serviceId: 'ts-victim' }], {
        groundTruth: ['ts-root'],
        topPredictions: ['ts-root'],
      }),
    );
    const fidelity = oracleFidelity(coherent, OPTS);
    expect(fidelity.recordedLogViolations).toBe(0);
    expect(fidelity.recordedLogFlips).toBe(0);
    expect(fidelity.unpinnedFloodCases).toBe(0);
    expect(fidelity.unreadableLogCases).toBe(0);
    expect(fidelity.reconstructableCases).toBe(1);
    const text = formatFidelity(fidelity, OPTS);
    expect(text).toContain('EXACT');
    expect(text).toContain('no error bar');
  });

  it('says the log term is UNAVAILABLE, not clean, when the fields only bracket the union', () => {
    // The one reading that must never be inferred from a missing counter: "0
    // violations" and "not computed" are different, and a report that prints the
    // first for the second is the defect class this whole section exists to catch.
    //
    // Availability is a property of the COUNTS, not of the field's presence: the
    // rendered fixture is coherent (`err` = the flood), so it pins the union and stays
    // readable. Raising the error total above both signature counts leaves 7 error
    // lines of which only some are signature lines, and the union is then bracketed by
    // [3, 5] — genuinely unknown, so the section must say so.
    const ambiguous = block([{ serviceId: 'ts-root', logic: 2, http: 3 }], {
      groundTruth: ['ts-root'],
      topPredictions: ['ts-root'],
      omitOverlap: true,
    }).replace('err=5 fatal=0', 'err=10 fatal=0');
    expect(ambiguous).toContain('err=10 fatal=0');
    const old = casesOf(ambiguous);
    const text = formatFidelity(oracleFidelity(old, OPTS), OPTS);
    // Both facts always print: the counters are about the reconstructable subset, so a
    // line that showed only them would read as a clean whole-dump reconstruction.
    expect(text).toContain('services above 6e-4: 0');
    expect(text).toContain('1/1 cases are unreconstructable');
    expect(text).toContain('1 predate the overlap count');
    expect(text).toContain('bracketed but not pinned');
    // And it names the provenance that FIRED. The sentence used to assert the one it was written for, so a case
    // excluded for the other reason printed an explanation that was false of it.
    expect(text).not.toContain('no recorded term to reproduce');
    expect(text).not.toContain('EXACT');
    // And no mode row is drawn from a flood it cannot recover. `count` never consults
    // the HTTP half, so its row IS drawn — the filter is per row, not per dump.
    // `all` needs no union — it admits every error line — so it is the one counting mode whose
    // row survives a dump that predates the overlap count. The two signature modes drop, and
    // that difference is itself the reason the mode stays measurable on the oldest cache.
    expect(modeScreen(old, OPTS).rows.map((row) => row.source)).toEqual([
      'recorded',
      'count',
      'all',
    ]);
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
    const weights = {
      logWeight: 1,
      latWeight: 0,
      latFloor: 1,
      poolWeight: 0.25,
      temporalWeight: 0,
      onsetShape: DEFAULT_ONSET_SHAPE,
    };

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
    expect(
      shippedRank1(kase, {
        logWeight: 1,
        latWeight: 0,
        latFloor: 1,
        poolWeight: 0,
        temporalWeight: 0,
        onsetShape: DEFAULT_ONSET_SHAPE,
      }),
    ).toBe('ts-a');
  });

  it('returns undefined for a case with no candidates rather than a fabricated name', () => {
    // An absent rank-1 is a case the dump cannot score; naming anything would turn
    // "not measured" into a prediction and could silently count as a miss.
    const kase = casesOf(block([], { datapack: 'no-services' }))[0]!;
    expect(
      shippedRank1(kase, {
        logWeight: 1,
        latWeight: 0,
        latFloor: 1,
        poolWeight: 0,
        temporalWeight: 0,
        onsetShape: DEFAULT_ONSET_SHAPE,
      }),
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
      allowDroppedBlocks: false,
      family: undefined,
      sections: [
        {
          kind: 'termOracle',
          logWeight: 1,
          latWeight: 0.561495,
          latFloor: 10.3,
          poolWeight: 0,
          temporalWeight: 0,
          onsetShape: DEFAULT_ONSET_SHAPE,
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

describe('the `all` mode — the flood the engine computes when it admits every error line', () => {
  const services = [
    {
      serviceId: 'src',
      logicExceptionCount: 0,
      httpExceptionCount: 0,
      errorCount: 8,
      fatalCount: 0,
    },
    {
      serviceId: 'victim',
      logicExceptionCount: 0,
      httpExceptionCount: 0,
      errorCount: 2,
      fatalCount: 0,
    },
    {
      serviceId: 'root',
      logicExceptionCount: 4,
      httpExceptionCount: 0,
      errorCount: 4,
      fatalCount: 0,
    },
  ] as never;

  it('credits a service whose errors are neither a logic nor a framework-HTTP signature', () => {
    // The mode's stated target: a source that storms a PROPAGATED HTTP error, which the
    // signature gate scores 0. Both the shipped mode and `count` see nothing here.
    expect(logSlopesForMode(services, 'logicHttp', 0.5).has('src')).toBe(false);
    expect(logSlopesForMode(services, 'count', 0.5).has('src')).toBe(false);
    const all = logSlopesForMode(services, 'all', 0.5);
    expect(all.get('src')).toBeCloseTo(1, 12);
    expect(all.get('victim')).toBeCloseTo(0.25, 12);
    expect(all.get('root')).toBeCloseTo(0.5, 12);
  });

  it('needs no overlap count, because every line is admitted', () => {
    // |all| is the count of every ERROR/FATAL line, which is what `err`/`fatal` already say —
    // there is no union to recover, so a dump that predates `both=` can still be rebuilt in
    // this mode. That is the opposite of the two signature modes, and the reason the mode
    // stays measurable on the oldest dump in the cache.
    const legacy = [
      {
        serviceId: 'a',
        logicExceptionCount: 3,
        httpExceptionCount: 5,
        errorCount: 6,
        fatalCount: 0,
      },
    ] as never;
    expect(canReconstructLogFlood(legacy, 'all')).toBe(true);
    expect(canReconstructLogFlood(legacy, 'logicHttp')).toBe(false);
    expect(() => logSlopesForMode(legacy, 'all', 0.5)).not.toThrow();
    expect(logSlopesForMode(legacy, 'all', 0.5).get('a')).toBeCloseTo(1, 12);
  });

  it('is what the self-check rebuilds for a dump recorded in `all` mode', () => {
    const recorded = casesOf(
      block(
        [
          { serviceId: 'ts-root', logic: 0, http: 0, err: 6 },
          { serviceId: 'ts-victim', logic: 0, http: 0, err: 2 },
        ],
        { groundTruth: ['ts-root'], topPredictions: ['ts-root'], logMode: 'all', mode: 'all' },
      ),
    );
    const check = modeScreen(recorded, OPTS).selfCheck;
    expect(check).toEqual({
      dumpMode: 'all',
      source: 'all',
      cases: 1,
      unreadableCases: 0,
      violations: 0,
      gained: 0,
      regressed: 0,
    });
    expect(formatModeScreen(modeScreen(recorded, OPTS))).toContain('reproduces the printed term');
  });

  it('refuses to claim a self-check for a mode it does not rebuild', () => {
    // The line used to be printed only when a check EXISTED, so a dump in a mode this reader
    // cannot rebuild printed nothing at all — which reads as "no disagreement found". Naming
    // the mode and saying it is not rebuildable is the difference between a missing
    // measurement and a clean one.
    const novelty = casesOf(
      block([{ serviceId: 'ts-root' }], { groundTruth: ['ts-root'], topPredictions: ['ts-root'] }),
    ).map((kase) => ({ ...kase, logSignalMode: 'novelty' }));
    const screen = modeScreen(novelty, OPTS);
    expect(screen.selfCheck).toBeUndefined();
    expect(formatModeScreen(screen)).toContain('self-check: none');
    expect(formatModeScreen(screen)).toContain('novelty');
  });
});

describe('the `logicHttpJoint` gate — the fresh ablation the engine’s own doc asks for', () => {
  /** One service's flood, in the fields the reader actually reads. */
  const svc = (
    serviceId: string,
    selfAnomaly: number,
    flood: { logic?: number; http?: number },
  ) => ({
    serviceId,
    selfAnomaly,
    logicExceptionCount: flood.logic ?? 0,
    httpExceptionCount: flood.http ?? 0,
    errorCount: (flood.logic ?? 0) + (flood.http ?? 0),
    fatalCount: 0,
    bothExceptionCount: 0,
  });
  /**
   * `ts-http` is a VICTIM: it emits four framework-HTTP lines and its only callee is more
   * anomalous, so its own downstream call is what broke. `ts-peer` emits three and its callee is
   * not, which is the replace-code case the mode was written for.
   */
  const services = [
    svc('ts-http', 0.2, { http: 4 }),
    svc('ts-root', 0.9, { logic: 2 }),
    svc('ts-peer', 0.5, { http: 3 }),
  ] as never;
  const edges = ['ts-http>ts-root'];

  it('withdraws the framework-HTTP half from an emitter whose callee is more anomalous', () => {
    const joint = logSlopesForMode(services, 'logicHttpJoint', 0.5, edges);
    const plain = logSlopesForMode(services, 'logicHttp', 0.5, edges);
    // The union's maximum does not move, because the denominator is level 1 and the withdrawal is
    // level 2 — the asymmetry the engine's own comment calls load-bearing.
    expect(plain.get('ts-http')).toBeCloseTo(1, 12);
    expect(joint.has('ts-http')).toBe(false);
    // The emitter whose callee is NOT more anomalous keeps the half.
    expect(joint.get('ts-peer')).toBeCloseTo(0.75, 12);
    // And a service with no framework-HTTP lines is untouched either way.
    expect(joint.get('ts-root')).toBeCloseTo(0.5, 12);
  });

  it('is a STRICT inequality over the anomaly order, so a tie suppresses nothing', () => {
    // The predicate reads scores by ORDER only, which is what makes it invariant under the
    // rescales the engine ships; a tie is not an order, and treating it as one would suppress a
    // half on no evidence.
    const tied = [
      svc('ts-http', 0.5, { http: 4 }),
      svc('ts-root', 0.5, { logic: 2 }),
      svc('ts-peer', 0.5, { http: 3 }),
    ] as never;
    expect(logSlopesForMode(tied, 'logicHttpJoint', 0.5, edges).get('ts-http')).toBeCloseTo(1, 12);
  });

  it('refuses a dump with no graph rather than rebuilding the unjointed term', () => {
    // Defaulting here would produce a term labelled `logicHttpJoint` that is exactly `logicHttp`,
    // which is the same defect shape as defaulting an unpinned flood.
    expect(() => logSlopesForMode(services, 'logicHttpJoint', 0.5)).toThrow(/call graph/);
    // And the row is not drawn for such a dump, while every other counting row still is.
    const noGraph = casesOf(
      block([{ serviceId: 'ts-root', logic: 2 }], { groundTruth: ['ts-root'] }),
    );
    expect(modeScreen(noGraph, OPTS).rows.map((row) => row.source)).not.toContain('logicHttpJoint');
    const withGraph = noGraph.map((kase) => ({ ...kase, edges: ['ts-root>ts-other'] }));
    expect(modeScreen(withGraph, OPTS).rows.map((row) => row.source)).toContain('logicHttpJoint');
  });

  it('reads an edge whose caller is the EMPTY-named service, which the split used to drop', () => {
    // The empty service id is a real candidate and not a parse artefact — this module's own header says so,
    // and 1421 of the 1422 shipped cases carry such a row. The producer renders `${from}>${to}`, so the
    // empty-named service's own calls render with nothing in front of the separator, and `separator <= 0`
    // read that entry as MALFORMED and skipped it.
    //
    // The defect is one symbol: `indexOf` answers `-1` for "there is no separator" and `0` for "the
    // separator is the first character". The first is a SENTINEL and the second is a POSITION, and `<= 0`
    // is a test that cannot tell them apart — so the graph the gate compared was missing every edge the
    // empty-named service emits, and the emitter was withdrawn nothing on a graph nobody had read.
    const withEmptyCaller = [svc('', 0.2, { http: 4 }), svc('ts-root', 0.9, { logic: 2 })] as never;
    const graph = ['>ts-root'];
    // The unjointed mode keeps the half, which is what makes the difference a GATE's and not a fixture's.
    expect(logSlopesForMode(withEmptyCaller, 'logicHttp', 0.5, graph).get('')).toBeCloseTo(1, 12);
    // Its only callee is more anomalous, so the gate withdraws the whole framework-HTTP half and the
    // emitter leaves the term — the withdrawal the dropped entry made unreachable.
    expect(logSlopesForMode(withEmptyCaller, 'logicHttpJoint', 0.5, graph).has('')).toBe(false);
  });

  it('reads an edge whose CALLEE is the empty-named service, the mirror of the case above', () => {
    // The other half of the same grammar, and it needs its own test because the two halves are read
    // independently: `a>` names the empty-named service as the CALLEE, which is a real candidate for
    // exactly the reason a missing caller is. A split that answered an empty half with the whole entry
    // would compare the wrong service — and here the wrong service flips the gate's decision outright.
    const emptyCallee = [svc('ts-http', 0.2, { http: 4 }), svc('', 0.9, { logic: 2 })] as never;
    // `ts-http` calls the empty-named service, which is MORE anomalous, so its half is withdrawn.
    expect(logSlopesForMode(emptyCallee, 'logicHttpJoint', 0.5, ['ts-http>']).has('ts-http')).toBe(
      false,
    );
    // And the unjointed mode is the control: the half is there to be withdrawn.
    expect(
      logSlopesForMode(emptyCallee, 'logicHttp', 0.5, ['ts-http>']).get('ts-http'),
    ).toBeCloseTo(1, 12);
  });

  it('refuses an entry that names NEITHER half rather than reading a graph it only partly holds', () => {
    // The other side of the same split, and a different absence: an entry with no separator at all names
    // neither service, so the graph the reader built is missing an edge it cannot even describe. Skipping
    // it silently made the reach a FULL reach — the printed share carried no floor, and the case stayed in
    // the row's population — which are both claims about a graph this reader had not read.
    expect(() =>
      logSlopesForMode(services, 'logicHttpJoint', 0.5, ['ts-http', 'ts-http>ts-root']),
    ).toThrow(/caller>callee/);
    // And the case leaves the row's population, so the short row is named by the gate's own refusal.
    const refuse = casesOf(
      block(
        [
          { serviceId: 'ts-http', logic: 0, http: 6, selfAnomaly: 0.2 },
          { serviceId: 'ts-root', logic: 1, selfAnomaly: 0.9 },
        ],
        { groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
      ),
    ).map((kase) => ({ ...kase, edges: ['ts-http', 'ts-http>ts-root'] }));
    const decidable = casesOf(
      block(
        [
          { serviceId: 'ts-http', logic: 0, http: 6, selfAnomaly: 0.2 },
          { serviceId: 'ts-root', logic: 1, selfAnomaly: 0.9 },
        ],
        { groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
      ),
    ).map((kase) => ({ ...kase, edges: ['ts-http>ts-root'] }));
    // A joint row is drawn — the second case can be decided — and the row says how many cases it dropped.
    const row = modeScreen([...decidable, ...refuse], OPTS).rows.find(
      (one) => one.source === 'logicHttpJoint',
    );
    expect(row?.cases).toBe(1);
    expect(row?.gateRefusedCases).toBe(1);
  });

  it('self-checks a dump RECORDED in the joint mode, which it could not before', () => {
    // The mapping was removed while the gate was not rebuilt, because a "check" against the
    // unjointed half would have reported a disagreement on every case. Now it is rebuilt, so the
    // dump's own mode is checkable again — and `novelty`, which still cannot be, keeps saying so.
    const joint = casesOf(
      block(
        [
          { serviceId: 'ts-http', logic: 0, http: 4, logScore: 0, selfAnomaly: 0.2 },
          { serviceId: 'ts-root', logic: 2, logScore: 0.5, selfAnomaly: 0.9 },
          { serviceId: 'ts-peer', http: 3, logScore: 0.75, selfAnomaly: 0.5 },
        ],
        {
          groundTruth: ['ts-peer'],
          topPredictions: ['ts-peer'],
          logMode: 'logicHttpJoint',
        },
      ),
    ).map((kase) => ({ ...kase, edges: ['ts-http>ts-root'] }));
    const check = modeScreen(joint, OPTS).selfCheck;
    expect(check).toEqual({
      dumpMode: 'logicHttpJoint',
      source: 'logicHttpJoint',
      cases: 1,
      unreadableCases: 0,
      violations: 0,
      gained: 0,
      regressed: 0,
    });
    expect(formatModeScreen(modeScreen(joint, OPTS))).toContain('reproduces the printed term');
  });
});

describe('the joint gate’s footprint — the row’s net is not its mechanism', () => {
  /** Two cases: in the first the flood owner is a victim, in the second it is not. */
  const cases = (edges: string[]) =>
    casesOf(
      block(
        [
          { serviceId: 'ts-http', logic: 0, http: 6, selfAnomaly: 0.2 },
          { serviceId: 'ts-root', logic: 1, selfAnomaly: 0.9 },
          { serviceId: 'ts-quiet', selfAnomaly: 0.1 },
        ],
        { groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
      ),
    ).map((kase) => ({ ...kase, edges }));

  it('reports how far the withdrawal reaches and whether it takes the flood OWNER', () => {
    // `ts-http` owns all six framework-HTTP lines and calls `ts-root`, which is more anomalous:
    // the gate withdraws the flood from its own owner. That is the gate deleting the evidence it
    // was built to keep, and no row's net can say it.
    const screen = modeScreen(cases(['ts-http>ts-root']), OPTS);
    expect(screen.jointFootprint).toEqual({
      services: 3,
      victims: 1,
      medianCaseDensity: 1 / 3,
      ownerCases: 1,
      ownerSuppressed: 1,
      // Both endpoints of the graph are rows the block SCORES, so the reach above is exact rather
      // than a floor. BOTH refusal counters are asserted at zero rather than omitted, because "no
      // edge was refused" and "nobody counted" are different statements and only the first is true
      // here — and they are two counters because they are two different absent things.
      undecidedEdges: 0,
      unreadableEdges: 0,
    });
    expect(formatModeScreen(screen)).toContain('OWNER is itself withdrawn in 1/1');
  });

  it('reports the opposite case, where the owner keeps its flood', () => {
    // The replace-code shape: the emitter that OWNS the flood calls a callee that is LESS
    // anomalous, so its half survives — while `ts-quiet`, which calls the owner, becomes a victim
    // instead. The footprint names both facts, which is the point: a withdrawal that reaches a
    // bystander is not the same event as one that reaches the owner.
    const screen = modeScreen(cases(['ts-quiet>ts-http']), OPTS);
    expect(screen.jointFootprint).toMatchObject({ victims: 1, ownerCases: 1, ownerSuppressed: 0 });
    expect(formatModeScreen(screen)).toContain('OWNER is itself withdrawn in 0/1');
  });

  it('is undefined when no joint row was drawn, rather than a footprint of zero', () => {
    const noGraph = casesOf(
      block([{ serviceId: 'ts-root', logic: 2 }], { groundTruth: ['ts-root'] }),
    );
    const screen = modeScreen(noGraph, OPTS);
    expect(screen.jointFootprint).toBeUndefined();
    expect(formatModeScreen(screen)).not.toContain('joint gate footprint');
  });

  it('answers the gate for a GRAPHLESS case instead of throwing on it', () => {
    // The arm the coverage report found unexercised, and the repair is a caller rather than a test written
    // for dead code: a dump that carries a joint ROW — which needs one case with a graph — beside a case
    // without one. The graphless case is excluded from the row's population and still belongs to the
    // footprint's, so the gate has to ANSWER for it: no victims, no refusal, and its services counted.
    //
    // Both halves are asserted, because the guard is the else-branch of the one that draws the row: a
    // `return` that answered with the dump's own zero would report a case it never looked at.
    const withGraph = block(
      [
        { serviceId: 'ts-callee', selfAnomaly: 0.9, logic: 2 },
        { serviceId: 'ts-emitter', selfAnomaly: 0.1, http: 4 },
      ],
      { groundTruth: ['ts-callee'], topPredictions: ['ts-callee'] },
    );
    const noGraph = block([{ serviceId: 'ts-quiet', selfAnomaly: 0.5, logic: 1 }], {
      datapack: 'dp-nograph',
      groundTruth: ['ts-quiet'],
      topPredictions: ['ts-quiet'],
    });
    const cases = casesOf(withGraph, noGraph).map((kase) =>
      kase.datapack === 'dp-1' ? { ...kase, edges: ['ts-emitter>ts-callee'] } : kase,
    );
    const screen = modeScreen(cases, OPTS);
    // One victim, from the case that HAS a graph; nothing refused; and all three services counted, which is
    // what says the graphless case was answered for rather than skipped.
    expect(screen.jointFootprint).toMatchObject({
      services: 3,
      victims: 1,
      undecidedEdges: 0,
      ownerCases: 1,
      ownerSuppressed: 1,
    });
    // …and the row itself is drawn from the one case it could be measured on, so the footprint's population
    // and the row's are the two different populations this whole section is about.
    expect(screen.rows.find((row) => row.source === 'logicHttpJoint')!.cases).toBe(1);
    // The gate REFUSED nothing here, so the footprint's share is exact and the clause stays off.
    expect(formatModeScreen(screen)).not.toContain('edge(s) undecided');
  });

  it('counts an entry it cannot split as its OWN refusal, and names that cause in the print', () => {
    // The footprint has two ways to understate itself, and they are two different absences: an endpoint
    // whose anomaly the block flagged (a value the artifact declines to state) and an entry that is not
    // `caller>callee` at all (a line this reader cannot split). One counter for both would make the printed
    // sentence name a cause that did not fire, which is the defect this file has already corrected twice.
    const good = cases(['ts-http>ts-root']);
    const unsplittable = cases(['ts-http']);
    const screen = modeScreen([...good, ...unsplittable], OPTS);
    expect(screen.jointFootprint).toMatchObject({
      unreadableEdges: 1,
      // The flagged-endpoint counter is asserted at ZERO rather than omitted: "nothing was refused" and
      // "nobody counted the other kind" are different statements and only the first is true here.
      undecidedEdges: 0,
      // A REAL share over a real population. The axis used to answer an empty population with `?? 0`,
      // which is its MINIMUM, so a footprint over no case would have printed as "the gate withdraws
      // nothing" — a claim no artifact made.
      medianCaseDensity: 1 / 3,
    });
    const printed = formatModeScreen(screen);
    expect(printed).toContain('1 call-graph entry(ies) are not `caller>callee`');
    // And the cause that did NOT fire is not named, in either direction.
    expect(printed).not.toContain('edge(s) undecided');
  });

  it('prints the table for a screen that measured nothing, rather than a denominator of zero', () => {
    // The table's denominator is the BASELINE row's population, and `rows[0]` is the baseline by the
    // screen's own contract. A screen with no row has no `N` for a row to be a fraction of, and `?? 0`
    // answered that with a number: `row.cases < 0` is false for EVERY row, so the `[n/N cases]` marker's
    // absence read as "this row measured the whole population" where the truth was "this screen states no
    // population at all". The formatter is exported, so an empty screen is a real input and this is where
    // the absence is stated.
    const screen: ModeScreen = {
      rows: [],
      selfCheck: undefined,
      dumpMode: 'novelty',
      jointFootprint: undefined,
    };
    expect(formatModeScreen(screen)).toBe(
      [
        'Log-term mode pre-screen (every row against the recorded log term, per fault type):',
        "  self-check: none — this reader does not rebuild the dump's mode (`novelty`), so no row above " +
          'is verified against the printed term',
        '  configuration           correct   +/-cases   regressed types',
      ].join('\n'),
    );
  });
});

describe('the joint gate REFUSES an edge it cannot order, rather than reading a flagged anomaly as 0', () => {
  // A block's `selfAnomaly` is the only input this gate reads, and the reader now stores a flagged
  // one as `undefined`. The gate's lookup used one `?? 0` for TWO different absences: a service the
  // block does not describe — for which the engine's own tree holds no score either, so 0 is the
  // engine's reading and stays — and a service the block DESCRIBES and declines to score, for which
  // 0 is a claim the artifact does not make. The second is not cosmetic. `0` is the least anomalous
  // value there is, so reading it there names the flagged service the most quiescent one in its own
  // graph and withdraws the framework-HTTP half from every caller of it.
  //
  // The three-way fixture below is what makes the difference legible: the SAME graph with the
  // callee's anomaly stated at 0 and stated at 0.9 gives opposite withdrawals, and a callee whose
  // anomaly the block flagged gives neither.

  /** One case's services, parsed through the producer so a non-finite value renders as its token. */
  function servicesOf(specs: readonly ServiceSpec[]): DiagnosedCase['services'] {
    const parsed = casesOf(block(specs));
    expect(parsed).toHaveLength(1);
    return parsed[0]!.services;
  }

  it('withdraws from the caller of a callee the block states as 0, because 0 IS a measurement', () => {
    // The control in the direction that matters: the refusal below is about the ABSENCE of a value,
    // not about the value zero. `ts-emitter` owns the framework-HTTP flood and calls a callee stated
    // at 0, so the callee is the quiescent one, the predicate `0 > 0.2` is false, and the emitter
    // KEEPS its half — a slope of 1, since it also owns the case's flood.
    const quiet = servicesOf([
      { serviceId: 'ts-emitter', selfAnomaly: 0.2, http: 4 },
      { serviceId: 'ts-root', selfAnomaly: 0, logic: 2 },
    ]);
    expect(
      logSlopesForMode(quiet, 'logicHttpJoint', 0.5, ['ts-emitter>ts-root']).get('ts-emitter'),
    ).toBeCloseTo(1, 12);
    // …and the SAME graph with the callee stated at 0.9 fires the gate, so the emitter's own
    // downstream call is what broke: withdrawn, its numerator is 0, and the term omits a zero rather
    // than carrying it. The two assertions differ by the callee's VALUE and by nothing else.
    const loud = servicesOf([
      { serviceId: 'ts-emitter', selfAnomaly: 0.2, http: 4 },
      { serviceId: 'ts-root', selfAnomaly: 0.9, logic: 2 },
    ]);
    expect(
      logSlopesForMode(loud, 'logicHttpJoint', 0.5, ['ts-emitter>ts-root']).has('ts-emitter'),
    ).toBe(false);
  });

  it('refuses the case when the callee’s anomaly is the token, instead of keeping the half on a 0', () => {
    // The reading this replaces: `anomaly.get('ts-root') ?? 0` made the flagged callee the quietest
    // service in the graph, so `0 > 0.2` was false — no withdrawal — and the term came back with the
    // SAME number as the `quiet` case above while resting on a value the block declined to state. The
    // two readings are indistinguishable in the output and opposite in what they claim, which is why
    // the answer is a refusal rather than a default.
    const flagged = servicesOf([
      { serviceId: 'ts-emitter', selfAnomaly: 0.2, http: 4 },
      { serviceId: 'ts-root', selfAnomaly: Number.NaN, logic: 2 },
    ]);
    expect(flagged.find((one) => one.serviceId === 'ts-root')!.selfAnomaly).toBeUndefined();
    expect(() => logSlopesForMode(flagged, 'logicHttpJoint', 0.5, ['ts-emitter>ts-root'])).toThrow(
      /flagged as non-finite/,
    );
    expect(() =>
      logSlopesForMode(flagged, 'logicHttpJoint', 0.5, ['ts-emitter>ts-root']),
    ).not.toThrow(/call graph/);
    // The refusal is the GATE's: the same case in the unjointed mode is readable, so the counts are
    // all there and what is missing is the comparison.
    expect(
      logSlopesForMode(flagged, 'logicHttp', 0.5, ['ts-emitter>ts-root']).get('ts-emitter'),
    ).toBeCloseTo(1, 12);
  });

  it('refuses on the EMITTER side too, where the old 0 would have withdrawn its own half', () => {
    // The other side of the same predicate, and the one where the defect is loudest: a flagged
    // EMITTER read as 0 is by construction less anomalous than a callee stated at 0.9, so the gate
    // withdrew the framework-HTTP half from the very service that OWNS the flood — the gate deleting
    // the evidence it was built to keep, on the strength of a number the artifact does not state.
    // Both sides of the inequality are asserted, because a rule about one of them is not a rule
    // about the edge.
    const flagged = servicesOf([
      { serviceId: 'ts-emitter', selfAnomaly: Number.NaN, http: 4 },
      { serviceId: 'ts-root', selfAnomaly: 0.9, logic: 2 },
    ]);
    expect(() => logSlopesForMode(flagged, 'logicHttpJoint', 0.5, ['ts-emitter>ts-root'])).toThrow(
      /flagged as non-finite/,
    );
  });

  it('still reads a service the block does NOT describe as 0, which is the engine’s own reading', () => {
    // The half of the `?? 0` that was right, kept and now asserted: the engine's victim set is built
    // over ITS OWN tree, where a node it holds no score for contributes nothing — so an edge into a
    // service the dump never lists is decided, not refused. Losing this half would turn every dump
    // whose graph names a pruned node into an unreadable one.
    const services = servicesOf([
      { serviceId: 'ts-emitter', selfAnomaly: 0.2, http: 4 },
      { serviceId: 'ts-root', selfAnomaly: 0.9, logic: 2 },
    ]);
    const slopes = logSlopesForMode(services, 'logicHttpJoint', 0.5, ['ts-emitter>ts-absent']);
    expect(slopes.get('ts-emitter')).toBeCloseTo(1, 12);
  });

  it('drops the case from the joint ROW, counts it, and says which cause shortened the row', () => {
    // The row's population and the rebuild are one rule — a row kept over a case the rebuild throws
    // on is a report that takes the whole screen down. Two cases, one decidable, so the row survives
    // to carry the count; the count is over the SCORABLE population, like the flood refusals, because
    // the refusals ARE the cases the row cannot show.
    const decidable = block(
      [
        { serviceId: 'ts-emitter', selfAnomaly: 0.2, http: 4 },
        { serviceId: 'ts-root', selfAnomaly: 0.9, logic: 2 },
      ],
      { groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
    );
    const undecidable = block(
      [
        { serviceId: 'ts-emitter', selfAnomaly: 0.2, http: 4 },
        { serviceId: 'ts-root', selfAnomaly: Number.NaN, logic: 2 },
      ],
      { datapack: 'dp-flag', groundTruth: ['ts-root'], topPredictions: ['ts-root'] },
    );
    const cases = casesOf(decidable, undecidable).map((kase) => ({
      ...kase,
      edges: ['ts-emitter>ts-root'],
    }));
    const screen = modeScreen(cases, OPTS);
    const jointRow = screen.rows.find((row) => row.source === 'logicHttpJoint')!;
    expect(jointRow.cases).toBe(1);
    expect(jointRow.gateRefusedCases).toBe(1);
    // The flood is perfectly recoverable on both cases, so the OTHER cause's counter stays at zero:
    // the two mechanisms are counted independently and neither reads as the other.
    expect(jointRow.unprovedRows).toBe(0);
    // The baseline reconstructs nothing and refuses nothing, so the field is absent rather than 0.
    expect(screen.rows[0]!.gateRefusedCases).toBeUndefined();
    // A mode that needs no graph refuses nothing here, so a `0` there would be a claim about a gate
    // that was never consulted.
    expect(screen.rows.find((row) => row.source === 'logicHttp')!.gateRefusedCases).toBeUndefined();
    const text = formatModeScreen(screen);
    expect(text).toContain('1 case(s) dropped: the joint gate cannot order an edge');
    // …and NOT the other cause, which is the whole reason the clause is chosen from the counts
    // rather than written once.
    expect(text).not.toContain('no `both=` in this dump');
    expect(text).toContain('[1/2 cases]');
  });

  it('reports the refused edges on the footprint, so its withdrawal share is read as a floor', () => {
    // The footprint's `victims` counts only the edges the gate DECIDED, so with a refusal beside it
    // the share is a lower bound. Printed beside the share and only when non-zero, which is the
    // difference between "the artifact states every anomaly the gate reads" and "somebody forgot".
    //
    // TWO cases, and the first is what makes the footprint exist at all: it is drawn only when the
    // joint row is, and a row with no case to measure is omitted. The second case is the refusal —
    // both of its edges end at the flagged row, so it contributes a refusal and no victim.
    const decidable = block(
      [
        { serviceId: 'ts-callee', selfAnomaly: 0.9 },
        { serviceId: 'ts-emitter', selfAnomaly: 0.1, http: 4 },
      ],
      { groundTruth: ['ts-callee'], topPredictions: ['ts-callee'] },
    );
    const refused = block(
      [
        { serviceId: 'ts-flag', selfAnomaly: Number.NaN, logic: 2 },
        { serviceId: 'ts-caller', selfAnomaly: 0.3, http: 2 },
      ],
      { datapack: 'dp-flag', groundTruth: ['ts-caller'], topPredictions: ['ts-flag'] },
    );
    const cases = casesOf(decidable, refused).map((kase) =>
      kase.datapack === 'dp-1'
        ? { ...kase, edges: ['ts-emitter>ts-callee'] }
        : { ...kase, edges: ['ts-caller>ts-flag', 'ts-flag>ts-caller'] },
    );
    const screen = modeScreen(cases, OPTS);
    // One victim, from the case the gate could read; two refused edges, from the case it could not.
    expect(screen.jointFootprint).toMatchObject({ victims: 1, undecidedEdges: 2 });
    const jointRow = screen.rows.find((row) => row.source === 'logicHttpJoint')!;
    expect(jointRow.cases).toBe(1);
    expect(jointRow.gateRefusedCases).toBe(1);
    const text = formatModeScreen(screen);
    expect(text).toContain('2 edge(s) undecided');
    expect(text).toContain('LOWER bound');
    // The control: a dump whose every edge is decided prints no such clause, so the assertion above
    // is about the refusal rather than about the sentence being unconditional.
    const clean = casesOf(
      block(
        [
          { serviceId: 'ts-callee', selfAnomaly: 0.9 },
          { serviceId: 'ts-emitter', selfAnomaly: 0.1, http: 4 },
        ],
        { groundTruth: ['ts-callee'], topPredictions: ['ts-callee'] },
      ),
    ).map((kase) => ({ ...kase, edges: ['ts-emitter>ts-callee'] }));
    const cleanText = formatModeScreen(modeScreen(clean, OPTS));
    expect(cleanText).not.toContain('edge(s) undecided');
    expect(cleanText).not.toContain('LOWER bound');
  });

  it('omits the joint row entirely when NO case is decidable, rather than drawing an empty one', () => {
    // The row's own rule: a reconstruction with no case to measure is omitted, because an empty row
    // would print as a mode that scored nothing. The disposition is the same as for a dump with no
    // graph — and the self-check, which throws on a case it cannot rebuild, must not take the report
    // down on the way there.
    const onlyFlagged = casesOf(
      block(
        [
          { serviceId: 'ts-emitter', selfAnomaly: 0.2, http: 4 },
          { serviceId: 'ts-root', selfAnomaly: Number.NaN, logic: 2 },
        ],
        { groundTruth: ['ts-root'], topPredictions: ['ts-root'], logMode: 'logicHttpJoint' },
      ),
    ).map((kase) => ({ ...kase, edges: ['ts-emitter>ts-root'] }));
    const screen = modeScreen(onlyFlagged, OPTS);
    expect(() => formatModeScreen(screen)).not.toThrow();
    expect(screen.rows.map((row) => row.source)).not.toContain('logicHttpJoint');
    expect(screen.jointFootprint).toBeUndefined();
    // The self-check's own population: the case is excluded by a condition with its own explanation
    // (the mode's graph half), not counted as unreadable — that counter is about a flagged LOG, and
    // this case's log is a value.
    expect(screen.selfCheck).toMatchObject({ cases: 0, unreadableCases: 0 });
  });
});

describe('an undetermined value is not a score, and not a zero either', () => {
  // The producer renders a non-finite value as the literal `nonfinite` — a deliberate TRIPWIRE its own suite
  // asserts. The parser used to store `Number('nonfinite')` = `NaN` in `selfAnomaly`/`logScore`, and `NaN` IS a
  // `number`: every consumer's "is this measured?" test answered YES, `log1p(NaN)` carried it into a score, and
  // `rankScored`'s comparator — `if (b.score !== a.score) return b.score - a.score` — returned `NaN` (falsy =
  // "equal") so the entry kept the position the ROW ORDER gave it.
  //
  // The fixtures below produce the token the way the producer does: a real `Number.NaN` fed through
  // `formatFSE26Diagnostic`, not a typed-in string. A fixture that wrote `selfAnomaly=nonfinite` itself would be
  // measuring this file.

  /** A case whose first service's anomaly the block flagged, and whose second is a clean measurement. */
  function flaggedAnomaly(): DiagnosedCase {
    const text = block([
      { serviceId: 'ts-a', selfAnomaly: Number.NaN },
      { serviceId: 'ts-b', selfAnomaly: 0.5 },
    ]);
    return casesOf(text)[0]!;
  }

  it('carries `undefined` for the flagged field, on the parser as well as on the census', () => {
    const kase = flaggedAnomaly();
    const flagged = kase.services.find((one) => one.serviceId === 'ts-a')!;
    expect(flagged.selfAnomaly).toBeUndefined();
    // The control: on the same block, the other service is a number — so the assertion above is about the
    // VALUE rather than about the fixture having failed to render.
    expect(kase.services.find((one) => one.serviceId === 'ts-b')!.selfAnomaly).toBe(0.5);
  });

  it('gives that service NO score, at the weight where the term votes', () => {
    const kase = flaggedAnomaly();
    const lat = latencySlopes(kase.services, OPTS.latFloor);
    const scores = blendScores(kase, OPTS, 'recorded', lat);
    // The metric term is `log1p(selfAnomaly)` and it is always on, so a flagged anomaly leaves the sum
    // without an input. `0` would be the reading "measured and worth nothing", which is a different statement.
    expect(scores.get('ts-a')).toBeUndefined();
    expect(Number.isFinite(scores.get('ts-b')!)).toBe(true);
  });

  it('gives it a score at a weight where the flagged term does NOT vote, which is the exact rule', () => {
    // The rule is per configured COEFFICIENT, not "any term in the formula". A configuration with the log
    // weight at 0 does not read `logScore` at all, so `0 * undefined` must not be allowed to poison a score
    // whose every input is present — and that is measurable in both directions.
    const text = block([
      { serviceId: 'ts-a', logScore: Number.NaN },
      { serviceId: 'ts-b', logScore: 0.6 },
    ]);
    const kase = casesOf(text)[0]!;
    expect(kase.services.find((one) => one.serviceId === 'ts-a')!.logScore).toBeUndefined();
    const lat = latencySlopes(kase.services, OPTS.latFloor);
    expect(blendScores(kase, { ...OPTS, logWeight: 0 }, 'recorded', lat).get('ts-a')).toBeDefined();
    expect(
      blendScores(kase, { ...OPTS, logWeight: 1 }, 'recorded', lat).get('ts-a'),
    ).toBeUndefined();
  });

  it('ranks an unmeasured score LAST, and reaches the id tiebreak it never used to reach', () => {
    const kase = flaggedAnomaly();
    const lat = latencySlopes(kase.services, OPTS.latFloor);
    const ranked = rankCase(kase, OPTS, 'recorded', lat);
    // `ts-b` is measured, `ts-a` is not: an unmeasured score is not a low one, it is off the axis, so it comes
    // after every measured service including the ones it used to tie with at `NaN`.
    expect(ranked.order).toEqual(['ts-b', 'ts-a']);
    // And the SAME answer with the rows reversed, which is what makes it an order rather than a row order: the
    // comparator this replaced returned `NaN` for a `NaN` operand, i.e. "equal", so a stable sort preserved the
    // input order and this assertion would have read `['ts-a', 'ts-b']`.
    const reversed = casesOf(
      block([
        { serviceId: 'ts-b', selfAnomaly: 0.5 },
        { serviceId: 'ts-a', selfAnomaly: Number.NaN },
      ]),
    )[0]!;
    expect(rankCase(reversed, OPTS, 'recorded', lat).order).toEqual(['ts-b', 'ts-a']);
  });

  it('counts a flagged recorded log as UNRECONSTRUCTABLE rather than as zero violations', () => {
    // The counter's own contract: "Non-zero makes `recordedLogViolations` and the mode pre-screen meaningless
    // rather than zero: those counters are reported as UNAVAILABLE, not as clean." A service whose recorded log
    // the block flagged has no value to compare a derived one against, so the case is the second provenance of
    // exactly that fact.
    const clean = casesOf(
      block([
        { serviceId: 'ts-root', selfAnomaly: 0.9, logic: 3 },
        { serviceId: 'ts-other', selfAnomaly: 0.4, logic: 1 },
      ]),
    );
    const flagged = casesOf(
      block([
        { serviceId: 'ts-root', selfAnomaly: 0.9, logic: 3 },
        { serviceId: 'ts-other', selfAnomaly: 0.4, logScore: Number.NaN },
      ]),
    );
    const readable = oracleFidelity(clean, OPTS);
    const refused = oracleFidelity(flagged, OPTS);
    expect(readable.reconstructableCases).toBe(1);
    expect(readable.unreadableLogCases).toBe(0);
    expect(refused.reconstructableCases).toBe(0);
    expect(refused.unreadableLogCases).toBe(1);
    // The two provenances are INDEPENDENT facts, so neither is the other's complement: the flood is perfectly
    // pinned on the flagged fixture (`err` = the flood), and the counter that answers "does this dump predate
    // the overlap count" must not move because a value was refused.
    expect(refused.unpinnedFloodCases).toBe(0);
  });

  it('renders the provenance that fired, rather than the one the sentence was written for', () => {
    // The rendered sentence says WHY a case is unreconstructable, and before this fence it said one reason
    // only: "predate the overlap count (`both=`)". That is false of a case whose flood is pinned and whose
    // producer refused to render a value — the reader would go looking for an old dump that is not there.
    const flagged = casesOf(
      block([
        { serviceId: 'ts-root', selfAnomaly: 0.9, logic: 3, err: 3 },
        { serviceId: 'ts-other', selfAnomaly: 0.4, logic: 1, logScore: Number.NaN, err: 1 },
      ]),
    );
    const text = formatFidelity(oracleFidelity(flagged, OPTS), OPTS);
    expect(text).toContain('1/1 cases are unreconstructable');
    expect(text).toContain('no recorded term to reproduce');
    // The control, in the other direction: the sentence must NOT name the provenance that did not fire.
    expect(text).not.toContain('predate the overlap count');
    // And a coherent dump prints no such line at all, so the assertion above is about the reason rather than
    // about the line existing for every input.
    const coherent = casesOf(
      block([
        { serviceId: 'ts-root', selfAnomaly: 0.9, logic: 3, err: 3 },
        { serviceId: 'ts-other', selfAnomaly: 0.4, logic: 1, err: 1 },
      ]),
    );
    expect(formatFidelity(oracleFidelity(coherent, OPTS), OPTS)).not.toContain('unreconstructable');
  });

  it('counts the two provenances INDEPENDENTLY, so a case that fails both is in both', () => {
    // A partition would have to hide one of the two facts, and the one it hid is the one nobody could look up:
    // the renderer prints the total from the population the counters were measured over, so it subtracts
    // nothing and adds nothing, and each counter is free to be about every case that carries its own fact.
    // Here the flood is unpinned AND a log is flagged — one case, both reasons, and both counters read 1.
    const both = casesOf(
      block([{ serviceId: 'ts-root', logic: 2, http: 3, logScore: Number.NaN }], {
        omitOverlap: true,
      }),
    );
    const fidelity = oracleFidelity(both, OPTS);
    expect(fidelity.reconstructableCases).toBe(0);
    expect(fidelity.unpinnedFloodCases).toBe(1);
    expect(fidelity.unreadableLogCases).toBe(1);
    const text = formatFidelity(fidelity, OPTS);
    expect(text).toContain('1/1 cases are unreconstructable');
    expect(text).toContain('1 predate the overlap count');
    expect(text).toContain('1 carry a log the block flagged');
  });

  it('drops a case whose recorded log the block flagged from EVERY row, the baseline included', () => {
    // A row is a MODE against the BASELINE, and the baseline IS the recorded log term: on a case whose recorded
    // log the block flagged, `blendScores` gives every service an undetermined score, so the ranking falls back
    // to `rankScored`'s id order rather than to the engine's. A row kept over such a case would book that
    // degeneracy as the mode's effect — a measurement of this reader wearing the mode's name.
    //
    // The condition therefore does not live in the mode's branch: it is the baseline's own requirement, and the
    // baseline is every row's.
    const clean = casesOf(
      block([
        { serviceId: 'ts-root', logic: 5, http: 4 },
        { serviceId: 'ts-victim', logic: 1, http: 1 },
      ]),
    );
    const flagged = casesOf(
      block([
        { serviceId: 'ts-root', logic: 5, http: 4 },
        { serviceId: 'ts-victim', logScore: Number.NaN, logic: 1, http: 1 },
      ]),
    );
    expect(flagged[0]!.services.some((service) => service.logScore === undefined)).toBe(true);
    // The control first, so the assertion after it is about the exclusion rather than about a table that never
    // had a case to begin with.
    const cleanRows = modeScreen(clean, OPTS).rows;
    expect(cleanRows.length).toBeGreaterThan(1);
    for (const row of cleanRows) expect([row.source, row.cases]).toEqual([row.source, 1]);
    // Every surviving row reads 0, and the only survivor is the baseline — a reconstruction with no case to
    // measure is omitted, so the mode rows are GONE rather than printed as modes that scored nothing.
    const flaggedRows = modeScreen(flagged, OPTS).rows;
    expect(flaggedRows.map((row) => row.source)).toEqual(['recorded']);
    for (const row of flaggedRows) expect([row.source, row.cases]).toEqual([row.source, 0]);
  });

  it('measures the self-check over ITS OWN population, not over the row it verifies', () => {
    // The check used to report the ROW's size as its own denominator. The two coincide on a single-mode dump,
    // which is every dump measured so far, and they separate exactly where the check has a condition the row
    // does not: the check exists to ask whether the mode the run USED is the mode the reader rebuilds, so a case
    // recorded in another mode is not in its population at all. Here the `logicHttp` row is measured on both
    // cases and the check on the first one only, and the printed number is the check's.
    const first = block([
      { serviceId: 'ts-root', logic: 5, http: 4 },
      { serviceId: 'ts-victim', logic: 1, http: 1 },
    ]);
    const second = block(
      [
        { serviceId: 'ts-root', logic: 5, http: 4 },
        { serviceId: 'ts-victim', logic: 1, http: 1 },
      ],
      { datapack: 'dp-2', logMode: 'count', mode: 'count' },
    );
    const screen = modeScreen(casesOf(first, second), OPTS);
    const row = screen.rows.find((one) => one.source === 'logicHttp')!;
    expect(row.cases).toBe(2);
    expect(screen.selfCheck).toMatchObject({ dumpMode: 'logicHttp', cases: 1, unreadableCases: 0 });
    // The sentence and the number agree, which is the whole point of computing both in one loop.
    expect(formatModeScreen(screen)).toContain('over 1 cases');
  });

  it('names the exclusion rather than printing a vacuous clean check', () => {
    // "0 service(s) differ over 0 cases" is vacuously true. Rendered as `reproduces the printed term` it is a
    // claim about measurements taken, made where none were — the reading this register refuses wherever it is
    // reachable. A dump whose only case the block flagged reaches it.
    const flagged = casesOf(
      block([
        { serviceId: 'ts-root', logic: 5, http: 4 },
        { serviceId: 'ts-victim', logScore: Number.NaN, logic: 1, http: 1 },
      ]),
    );
    const screen = modeScreen(flagged, OPTS);
    expect(screen.selfCheck).toMatchObject({ cases: 0, unreadableCases: 1, violations: 0 });
    const text = formatModeScreen(screen);
    expect(text).toContain('NO case is comparable');
    expect(text).toContain('1 case(s) carry a recorded log the block flagged');
    expect(text).not.toContain('reproduces the printed term');
    // The control, in the other direction: the same dump with a readable log DOES print the verdict, so the
    // assertion above is about the state rather than about the sentence being unreachable.
    const clean = casesOf(
      block([
        { serviceId: 'ts-root', logic: 5, http: 4 },
        { serviceId: 'ts-victim', logic: 1, http: 1 },
      ]),
    );
    const cleanText = formatModeScreen(modeScreen(clean, OPTS));
    expect(cleanText).toContain('reproduces the printed term');
    expect(cleanText).not.toContain('not compared');
  });

  it('distinguishes the two reasons a check can have no case at all', () => {
    // The same state — nothing compared — reached for the OTHER reason: this dump cannot pin the union, so the
    // reader refuses the reconstruction. The two absences are different (one is a population the block
    // declined to describe, the other a flood the artifact never printed) and the line has to say which.
    const unpinned = casesOf(
      block([{ serviceId: 'ts-root', logic: 2, http: 3 }], { omitOverlap: true }),
    );
    const screen = modeScreen(unpinned, OPTS);
    expect(screen.selfCheck).toMatchObject({ cases: 0, unreadableCases: 0 });
    const text = formatModeScreen(screen);
    expect(text).toContain('NO case is comparable');
    expect(text).toContain('no case in this dump is scorable and reconstructable in that mode');
    expect(text).not.toContain('flagged a recorded log');
  });

  it('counts the excluded cases beside a population that still has one', () => {
    // The PARTIAL reading, which is where the denominator law bites hardest: one case compared, one excluded.
    // The check used to borrow its denominator from the row, so it would have printed the row's 2 beside a
    // comparison over 1 — and a silent exclusion is the reading this register refuses.
    const clean = block([
      { serviceId: 'ts-root', logic: 5, http: 4 },
      { serviceId: 'ts-victim', logic: 1, http: 1 },
    ]);
    const flagged = block(
      [
        { serviceId: 'ts-root', logic: 5, http: 4 },
        { serviceId: 'ts-victim', logScore: Number.NaN, logic: 1, http: 1 },
      ],
      { datapack: 'dp-2' },
    );
    const screen = modeScreen(casesOf(clean, flagged), OPTS);
    expect(screen.selfCheck).toMatchObject({ cases: 1, unreadableCases: 1, violations: 0 });
    const text = formatModeScreen(screen);
    expect(text).toContain('over 1 cases');
    expect(text).toContain('1 case(s) not compared: the block flagged a recorded log');
    // …and NOT the branch for a population with no case at all, so the two states cannot be confused.
    expect(text).not.toContain('NO case is comparable');
  });

  it('answers for the two degenerate populations instead of throwing on them', () => {
    // An empty dump: there is no case to read a mode off, so the check declines — the `not rebuildable`
    // reading, which is not the same as a clean one.
    expect(modeScreen([], OPTS).selfCheck).toBeUndefined();
    // A JOINT dump WITHOUT a graph. `logSlopesForMode` THROWS for that mode without edges — it refuses to
    // rebuild the unjointed term and label it joint — so the guard is what keeps a dump produced without the
    // graph from taking the whole report down. This state is also the one that made the row lookup wrong: the
    // joint row is omitted for want of a graph, and a check that consulted the rows would have reported
    // "this reader does not rebuild the dump's mode", which is false of it.
    const joint = casesOf(
      block(
        [
          { serviceId: 'ts-http', logic: 0, http: 4, selfAnomaly: 0.2 },
          { serviceId: 'ts-root', logic: 2, selfAnomaly: 0.9 },
        ],
        { groundTruth: ['ts-root'], logMode: 'logicHttpJoint' },
      ),
    );
    const screen = modeScreen(joint, OPTS);
    expect(screen.selfCheck).toMatchObject({ dumpMode: 'logicHttpJoint', cases: 0 });
    expect(formatModeScreen(screen)).toContain('NO case is comparable');
    expect(formatModeScreen(screen)).not.toContain('does not rebuild the dump’s mode');
  });

  it('makes NO claim about a sub-unit maximum where nothing was measured', () => {
    // `max` starts at `Number.NEGATIVE_INFINITY`, so `max < 1` is true for a case with no measured anomaly at
    // all — a counter that would report a sub-unit maximum because there was no maximum. The population is the
    // rescale threshold, so the case needs at least that many candidates to reach the branch.
    const specs = Array.from({ length: ANOMALY_NORMALIZE_NODE_THRESHOLD }, (_, index) => ({
      serviceId: `ts-${index}`,
      selfAnomaly: Number.NaN,
    }));
    const kase = casesOf(block(specs))[0]!;
    expect(kase.services.length).toBeGreaterThanOrEqual(ANOMALY_NORMALIZE_NODE_THRESHOLD);
    const fidelity = oracleFidelity([kase], OPTS);
    expect(fidelity.rescaledCases).toBe(1);
    expect(fidelity.subUnitMaximumCases).toBe(0);
  });
});

describe('byScoreDescending — one total order for both axes the oracle sorts on', () => {
  // A comparator is a property of PAIRS, so it is asserted on pairs. Sorting a three-element array leaves the
  // answer to TimSort's comparison sequence — which is how the comparator this replaced stayed wrong: the
  // branches a sort happens to need are not the branches the ORDER promises.

  const anomaly = (serviceId: string, selfAnomaly: number | undefined) => ({
    serviceId,
    selfAnomaly,
  });

  it('orders a measured pair by value, descending, and the anomaly axis is the same function', () => {
    expect(byAnomalyDescending(anomaly('a', 0.9), anomaly('b', 0.2))).toBeLessThan(0);
    expect(byAnomalyDescending(anomaly('a', 0.2), anomaly('b', 0.9))).toBeGreaterThan(0);
  });

  it('puts an undetermined score LAST in both directions', () => {
    // The two directions, named, because a comparator that is not antisymmetric is not an order — and this is
    // exactly the pair the old `b.score - a.score` answered with `NaN`, i.e. "equal".
    expect(byAnomalyDescending(anomaly('a', undefined), anomaly('b', 0.2))).toBeGreaterThan(0);
    expect(byAnomalyDescending(anomaly('a', 0.2), anomaly('b', undefined))).toBeLessThan(0);
  });

  it('breaks a tie by service id, in both the measured and the undetermined case', () => {
    // The engine's own tiebreak. It used to be UNREACHABLE for an undetermined entry, because `NaN !== NaN` sent
    // the comparator into the value branch, which returned `NaN`.
    expect(byAnomalyDescending(anomaly('a', 0.5), anomaly('b', 0.5))).toBeLessThan(0);
    expect(byAnomalyDescending(anomaly('b', 0.5), anomaly('a', 0.5))).toBeGreaterThan(0);
    expect(byAnomalyDescending(anomaly('a', undefined), anomaly('b', undefined))).toBeLessThan(0);
    expect(byAnomalyDescending(anomaly('b', undefined), anomaly('a', undefined))).toBeGreaterThan(
      0,
    );
  });

  it('answers 0 for one entry against itself, which is what makes it TOTAL', () => {
    // A total order needs a ⊑ a. `NaN` made this false for every NaN entry, which is the whole defect: a sort
    // given a comparator that says "not equal" for an element compared with itself cannot be relied on at all.
    const one = anomaly('a', undefined);
    expect(byAnomalyDescending(one, one)).toBe(0);
    expect(byAnomalyDescending(anomaly('a', 0.5), anomaly('a', 0.5))).toBe(0);
  });

  it('reads the score through the accessor it is given, so the score axis reuses it', () => {
    // The generic entry point: the same order over `{serviceId, score}` without a second implementation.
    const byScore = byScoreDescending<{ serviceId: string; score: number | undefined }>(
      (entry) => entry.score,
    );
    const entries = [
      { serviceId: 'z', score: undefined },
      { serviceId: 'a', score: 0.1 },
      { serviceId: 'm', score: 0.9 },
    ];
    expect([...entries].sort(byScore).map((entry) => entry.serviceId)).toEqual(['m', 'a', 'z']);
  });
});
