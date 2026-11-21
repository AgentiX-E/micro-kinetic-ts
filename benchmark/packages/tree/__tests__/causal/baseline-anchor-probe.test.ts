/**
 * The WINDOW's own census — every series, the drift it read, and the reason its anchor was not placed.
 *
 * §187.7 recorded a defect and §188.5 made it worse by ruling out the cheap fix: the anchored arm can refuse
 * a series silently (no injection time, no boundary, a narrow side, a non-positive baseline, a pre-segment it
 * cannot certify), and no artifact said how often, so "this cell did not move" could not be told apart from
 * "every series in this cell was refused". The re-derivation from `metrics.json` answered a different
 * question, because the loader aligns and reshapes the series before the engine sees them.
 *
 * The fix is one function with two callers. {@link probePreInjectionWindow} answers "would a window be
 * placed here, and if not why", the engine asks it to place the window, and the benchmark's census asks it
 * per series — so the count and the decision cannot disagree, because they are the same call.
 *
 * The second property this suite fences is the one §188's FSE'26 arm exposed: the statistic is SIGNED, and
 * `|drift| ≤ tolerance` cannot tell a pre-segment that is still climbing (a baseline the service never held)
 * from one that opened high and settled (this axis' founding shape). Both are "non-stationary"; only the
 * first manufactures a rise, because a median of a rising segment UNDER-estimates the level at `t₀` and a
 * median of a settling one OVER-estimates it — and the deviation's two sides are not symmetric: a rise is
 * unbounded, a drop is capped at `log10(2)`.
 */
import { describe, expect, it } from 'vitest';

import {
  BASELINE_ANCHORS,
  DEFAULT_MAX_PRE_WINDOW_DRIFT,
  judgePreWindowDrift,
  MIN_STATIONARY_PRE_SAMPLES,
  PRE_WINDOW_GUARDS,
  preWindowDrift,
  probePreInjectionWindow,
  type PreWindowGuard,
} from '../../src/causal/topology-fault-graph.js';

/** One-second samples, so index `i` is `i × 1000` ms and `t₀` can be named as a sample boundary. */
function series(values: readonly number[]): { values: Float64Array; timestamps: number[] } {
  return { values: Float64Array.from(values), timestamps: values.map((_, i) => i * 1000) };
}

const INJECT_AT = 30_000;

/** A level and nothing else: the shape a baseline is made of. */
const PLATEAU = Array.from({ length: 30 }, () => 3.5);

/** A pre-segment that CLIMBS from 1 to 30 — a container still warming up when the fault lands. */
const RAMP = Array.from({ length: 30 }, (_, i) => 1 + i);

/** A pre-segment that OPENS HIGH and settles to 3.5 — 20 samples at 30, then 10 at the steady level. */
const SETTLING = [...Array<number>(20).fill(30), ...Array<number>(10).fill(3.5)];

const POST = Array.from({ length: 10 }, () => 40);

/** `settling` is only a refusal when the HIGH part is most of the segment, which is what makes it a shape. */
const STATIONARY_GUARD: PreWindowGuard = {
  kind: 'stationary',
  tolerance: DEFAULT_MAX_PRE_WINDOW_DRIFT,
};
const NON_RISING_GUARD: PreWindowGuard = {
  kind: 'non-rising',
  tolerance: DEFAULT_MAX_PRE_WINDOW_DRIFT,
};

describe('preWindowDrift — one statistic, signed, because the two directions are not the same failure', () => {
  it('is POSITIVE on a rising pre-segment and NEGATIVE on a settling one', () => {
    const ramp = series([...RAMP, ...POST]);
    const settling = series([...SETTLING, ...POST]);

    const rising = preWindowDrift(ramp.values, ramp.timestamps, INJECT_AT);
    const falling = preWindowDrift(settling.values, settling.timestamps, INJECT_AT);

    expect(rising).toBeDefined();
    expect(falling).toBeDefined();
    // The magnitude is the same kind of number on both sides — that is what made the absolute value look
    // like a sufficient statistic — and the sign is what separates them.
    expect(rising!).toBeGreaterThan(DEFAULT_MAX_PRE_WINDOW_DRIFT * 3);
    expect(falling!).toBeLessThan(-DEFAULT_MAX_PRE_WINDOW_DRIFT * 3);
  });

  it('is ~0 on a plateau, and on a plateau whose start-up step is a minority of the segment', () => {
    const flat = series([...PLATEAU, ...POST]);
    const stepped = series([...Array<number>(6).fill(30), ...Array<number>(24).fill(3.5), ...POST]);

    expect(Math.abs(preWindowDrift(flat.values, flat.timestamps, INJECT_AT)!)).toBeLessThan(0.01);
    // Six samples of 30 inside a thirty-sample pre-segment do not move either half's median: that is why
    // the anchor axis survives the guard on the corpus' own warm-up cases.
    expect(Math.abs(preWindowDrift(stepped.values, stepped.timestamps, INJECT_AT)!)).toBeLessThan(
      0.01,
    );
  });
});

describe('judgePreWindowDrift — the guard is a predicate on the statistic, in one place', () => {
  it('admits everything when no guard is configured, which is what `pre-injection` means', () => {
    expect(judgePreWindowDrift(undefined, undefined)).toBe(true);
    expect(judgePreWindowDrift(9.5, undefined)).toBe(true);
    expect(judgePreWindowDrift(-9.5, undefined)).toBe(true);
  });

  it('refuses an unmeasurable drift under any guard', () => {
    expect(judgePreWindowDrift(undefined, STATIONARY_GUARD)).toBe(false);
    expect(judgePreWindowDrift(undefined, NON_RISING_GUARD)).toBe(false);
  });

  it('treats `stationary` as a condition on the MAGNITUDE and `non-rising` as a condition on the SIGN', () => {
    // One case each, and the pair is the whole reason the second kind exists: both shapes are
    // non-stationary, and only the rising one manufactures a rise.
    expect(judgePreWindowDrift(-0.9, STATIONARY_GUARD)).toBe(false);
    expect(judgePreWindowDrift(-0.9, NON_RISING_GUARD)).toBe(true);
    expect(judgePreWindowDrift(0.9, STATIONARY_GUARD)).toBe(false);
    expect(judgePreWindowDrift(0.9, NON_RISING_GUARD)).toBe(false);
    // And both admit a level.
    expect(judgePreWindowDrift(0.02, STATIONARY_GUARD)).toBe(true);
    expect(judgePreWindowDrift(0.02, NON_RISING_GUARD)).toBe(true);
  });

  it('is inclusive at the tolerance, so the constant in the config is the boundary it names', () => {
    const at = DEFAULT_MAX_PRE_WINDOW_DRIFT;
    expect(judgePreWindowDrift(at, STATIONARY_GUARD)).toBe(true);
    expect(judgePreWindowDrift(-at, STATIONARY_GUARD)).toBe(true);
    expect(judgePreWindowDrift(at, NON_RISING_GUARD)).toBe(true);
    expect(judgePreWindowDrift(-at, NON_RISING_GUARD)).toBe(true);
  });
});

describe('probePreInjectionWindow — the decision and the reason it was taken', () => {
  it('places the window and reports the drift it read', () => {
    const ts = series([...PLATEAU, ...POST]);
    const probe = probePreInjectionWindow(ts.values, ts.timestamps, INJECT_AT);

    expect(probe.placed).toBe(true);
    if (!probe.placed) throw new Error('unreachable');
    expect(probe.baseline).toBeCloseTo(3.5, 10);
    // The post-segment is ten samples of 40, so both extremes are 40: this asserts the WINDOW (the pre-segment
    // is not in it) rather than the whole file, which is the property that makes the anchor an anchor.
    expect(probe.max).toBe(40);
    expect(probe.min).toBe(40);
    expect(probe.drift).toBeDefined();
    expect(Math.abs(probe.drift!)).toBeLessThan(0.01);
  });

  it('names each refusal, and the reasons partition the ways a window can fail', () => {
    const flat = series([...PLATEAU, ...POST]);
    // Two pre-samples in a forty-sample file: the tenth-of-the-series floor is `max(3, ⌈n/10⌉) = 4`, so a
    // two-sample side is refused by a RULE rather than by a taste.
    const narrow = series([...Array<number>(2).fill(3.5), ...Array<number>(38).fill(40)]);
    const zero = series([...Array<number>(30).fill(0), ...POST]);

    const reasons = [
      // No `t₀` at all: the graph builder's own default.
      probePreInjectionWindow(flat.values, flat.timestamps, 0),
      // A `t₀` no sample reaches: the injection is after the file ends.
      probePreInjectionWindow(flat.values, flat.timestamps, 1e12),
      probePreInjectionWindow(narrow.values, narrow.timestamps, 2_000),
      // A level of zero is not a denominator.
      probePreInjectionWindow(zero.values, zero.timestamps, INJECT_AT),
    ];

    expect(reasons.map((p) => (p.placed ? 'placed' : p.reason))).toEqual([
      'no-injection-time',
      'no-boundary',
      'narrow-segment',
      'non-positive-baseline',
    ]);
  });

  it('separates "too short to halve" from "the halves disagree", because length is not shape', () => {
    // Five pre-samples clear the tenth-of-the-series width floor and cannot be halved into two judgeable
    // halves: under a guard the reason must say WHICH, or a census cannot tell a corpus of short series from
    // a corpus of ramps.
    const five = series([...Array<number>(MIN_STATIONARY_PRE_SAMPLES - 1).fill(3.5), ...POST]);
    const shortProbe = probePreInjectionWindow(
      five.values,
      five.timestamps,
      5_000,
      STATIONARY_GUARD,
    );

    expect(shortProbe.placed).toBe(false);
    if (shortProbe.placed) throw new Error('unreachable');
    expect(shortProbe.reason).toBe('undecidable-drift');
    // …and the same series is placed when no guard asks the question.
    expect(probePreInjectionWindow(five.values, five.timestamps, 5_000).placed).toBe(true);
  });

  it('refuses a ramp under `stationary` and under `non-rising`, and a settling segment under `stationary` only', () => {
    const ramp = series([...RAMP, ...POST]);
    const settling = series([...SETTLING, ...POST]);

    const rampStationary = probePreInjectionWindow(
      ramp.values,
      ramp.timestamps,
      INJECT_AT,
      STATIONARY_GUARD,
    );
    const rampNonRising = probePreInjectionWindow(
      ramp.values,
      ramp.timestamps,
      INJECT_AT,
      NON_RISING_GUARD,
    );
    const settlingStationary = probePreInjectionWindow(
      settling.values,
      settling.timestamps,
      INJECT_AT,
      STATIONARY_GUARD,
    );
    const settlingNonRising = probePreInjectionWindow(
      settling.values,
      settling.timestamps,
      INJECT_AT,
      NON_RISING_GUARD,
    );

    expect(rampStationary.placed).toBe(false);
    expect(rampNonRising.placed).toBe(false);
    expect(settlingStationary.placed).toBe(false);
    // The one case that distinguishes the two guard kinds, and it is a MEASURED shape rather than a taste:
    // an over-estimated baseline suppresses the truth's rise, which is the failure the golden half punishes.
    expect(settlingNonRising.placed).toBe(true);
    for (const p of [rampStationary, rampNonRising, settlingStationary]) {
      if (p.placed) throw new Error('unreachable');
      expect(p.reason).toBe('drift');
      // The statistic travels with the refusal: a census that only counted the reason could not say how far
      // over the tolerance the segment was, which is the only way to tell a marginal refusal from a gross one.
      expect(p.drift).toBeDefined();
    }
  });

  it('reports the drift even where it placed the window, so the census is total over placed and refused alike', () => {
    const ts = series([...SETTLING, ...POST]);
    const probe = probePreInjectionWindow(ts.values, ts.timestamps, INJECT_AT, NON_RISING_GUARD);

    expect(probe.placed).toBe(true);
    if (!probe.placed) throw new Error('unreachable');
    expect(probe.drift!).toBeLessThan(-DEFAULT_MAX_PRE_WINDOW_DRIFT * 3);
    // A settling baseline is the segment's own median, unrepented: the guard licenses an over-estimate whose
    // direction the sign names, it does not repair it.
    expect(probe.baseline).toBeCloseTo(30, 10);
  });
});

describe('PRE_WINDOW_GUARDS — every anchor declares its guard, at compile time', () => {
  it('covers the union and leaves exactly the two unguarded values unguarded', () => {
    const unguarded = (
      Object.keys(PRE_WINDOW_GUARDS) as Array<keyof typeof PRE_WINDOW_GUARDS>
    ).filter((k) => PRE_WINDOW_GUARDS[k] === undefined);

    expect(new Set(Object.keys(PRE_WINDOW_GUARDS))).toEqual(new Set(Object.keys(BASELINE_ANCHORS)));
    expect(unguarded.sort()).toEqual(['pre-injection', 'whole-file']);
  });

  it('gives the guarded values the two guard KINDS rather than two thresholds of one kind', () => {
    const guarded = Object.entries(PRE_WINDOW_GUARDS)
      .filter(([, g]) => g !== undefined)
      .map(([, g]) => g!.kind)
      .sort();

    expect(guarded).toEqual(['non-rising', 'stationary']);
    // One tolerance, two readings: a second threshold would be a second constant with no measurement behind
    // it, and the arm that would measure it has not run.
    for (const g of Object.values(PRE_WINDOW_GUARDS)) {
      if (g !== undefined) expect(g.tolerance).toBe(DEFAULT_MAX_PRE_WINDOW_DRIFT);
    }
  });
});
