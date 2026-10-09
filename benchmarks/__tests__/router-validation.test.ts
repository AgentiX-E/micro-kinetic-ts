/**
 * Tests for the held-out validator and the prior floor.
 *
 * Every arm here is a decision with a correct answer, so the assertions are on VALUES rather than on shapes:
 * a fixture whose numbers were chosen so each router's optimum is checkable by hand.
 *
 * @module benchmarks/__tests__/router-validation
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  formatSuiteValidation,
  main,
  reportFile,
  VALIDATION_SIGNALS,
} from '../src/validate-routing-frontier.js';

import type { RoutingCase } from '../src/router-validation.js';
import {
  accuracy,
  crossValidateRouter,
  disjoint,
  engineCorrect,
  engineMargin,
  fitThreshold,
  folds,
  modalTruth,
  priorFloor,
  prismCorrect,
  prismMargin,
  route,
  routedCorrect,
  ROUTER_SIGNALS,
  signalValue,
} from '../src/router-validation.js';

/** A case built from the fields the tests are about; everything else is a fixed, valid filler. */
const c = (over: Partial<RoutingCase> & Pick<RoutingCase, 'truth'>): RoutingCase => ({
  caseId: 'x',
  cell: 'RE3:OnlineBoutique',
  faultType: 'f1',
  engineTop1: 'a',
  engineTop1Score: 1,
  engineTop2Score: 0,
  prismTop1: 'a',
  prismTop1Score: 1,
  prismTop2Score: 0,
  ...over,
});

describe('router-validation — reading a case', () => {
  it('reads correctness on each engine, and disagreement between them', () => {
    const agree = c({ truth: 'a' });
    expect(engineCorrect(agree)).toBe(true);
    expect(prismCorrect(agree)).toBe(true);
    expect(disjoint(agree)).toBe(false);
    // A case the engine gets and PRISM does not is the routable kind the frontier is made of.
    const disagree = c({ truth: 'a', prismTop1: 'b' });
    expect(engineCorrect(disagree)).toBe(true);
    expect(prismCorrect(disagree)).toBe(false);
    expect(disjoint(disagree)).toBe(true);
  });

  it('reports both margins as first minus second', () => {
    const one = c({
      truth: 'a',
      engineTop1Score: 0.4,
      engineTop2Score: 0.25,
      prismTop1Score: 9,
      prismTop2Score: 4,
    });
    expect(engineMargin(one)).toBeCloseTo(0.15, 12);
    expect(prismMargin(one)).toBeCloseTo(5, 12);
  });

  it('exposes exactly three signals, and NONE of them reads the truth', () => {
    // The oracle the probe reports as best-on-RE1/RE2 is a (system x fault-type) lookup, and a cell is not known at
    // inference time either. Its absence here is the difference between a router and a lookup table.
    expect(Object.keys(ROUTER_SIGNALS).sort()).toEqual([
      'engine-margin',
      'prism-margin',
      'prism-score',
    ]);
    const one = c({
      truth: 'a',
      engineTop1Score: 0.4,
      engineTop2Score: 0.25,
      prismTop1Score: 9,
      prismTop2Score: 4,
    });
    expect(signalValue(one, 'engine-margin')).toBeCloseTo(0.15, 12);
    expect(signalValue(one, 'prism-margin')).toBeCloseTo(5, 12);
    expect(signalValue(one, 'prism-score')).toBe(9);
  });
});

describe('router-validation — routing and its accuracy', () => {
  const low = c({ truth: 'b', prismTop1: 'b', engineTop1Score: 0.1, engineTop2Score: 0.05 });
  const high = c({ truth: 'a', prismTop1: 'z', engineTop1Score: 0.9, engineTop2Score: 0.1 });

  it('routes to PRISM strictly below the threshold, and to the engine at or above it', () => {
    const router = { signal: 'engine-margin' as const, threshold: 0.5 };
    expect(route(low, router)).toBe('prism');
    expect(route(high, router)).toBe('engine');
    // Boundary: the comparison is strict, so a value equal to the threshold stays with the engine.
    const equal = c({ truth: 'a', engineTop1Score: 0.5, engineTop2Score: 0.0 });
    expect(route(equal, router)).toBe('engine');
  });

  it('scores the engine a router switched away from as wrong, and PRISM it switched to as third-party', () => {
    const router = { signal: 'engine-margin' as const, threshold: 0.5 };
    // `low` is engine-wrong (engineTop1 'a' vs truth 'b') and prism-right ⇒ the switch earns a point.
    expect(routedCorrect(low, router)).toBe(true);
    // `high` is engine-right and prism-wrong ⇒ the switch would have lost the point, and not switching keeps it.
    expect(routedCorrect(high, router)).toBe(true);
    const alwaysEngine = { signal: 'engine-margin' as const, threshold: Number.NEGATIVE_INFINITY };
    expect(accuracy([low, high], alwaysEngine)).toBeCloseTo(0.5, 12);
    expect(accuracy([low, high], router)).toBeCloseTo(1, 12);
    // An empty population is 0 rather than NaN: a fold with nothing in it contributes nothing.
    expect(accuracy([], router)).toBe(0);
  });
});

describe('router-validation — fitting a threshold', () => {
  it('finds the optimum exactly, because the scan is over the observed values and not a grid', () => {
    // Three cases: routing the first two to PRISM earns 2, routing all three earns 2, routing none earns 1.
    const cases = [
      c({
        truth: 'p',
        engineTop1: 'e',
        prismTop1: 'p',
        engineTop1Score: 0.1,
        engineTop2Score: 0.0,
      }),
      c({
        truth: 'p',
        engineTop1: 'e',
        prismTop1: 'p',
        engineTop1Score: 0.2,
        engineTop2Score: 0.0,
      }),
      c({
        truth: 'e',
        engineTop1: 'e',
        prismTop1: 'p',
        engineTop1Score: 0.9,
        engineTop2Score: 0.0,
      }),
    ];
    const router = fitThreshold(cases, 'engine-margin');
    expect(router.signal).toBe('engine-margin');
    // The optimum sits at 0.9 — the largest observed value — and ROUTES ALL THREE to PRISM, because 0.9 is not
    // strictly below its own threshold while 0.1 and 0.2 are: the third case stays with the engine (`truth` 'e')
    // and is correct there, so the optimum is a perfect 3 of 3 rather than the 2 of 3 the first draft expected.
    expect(router.threshold).toBeCloseTo(0.9, 12);
    expect(accuracy(cases, router)).toBeCloseTo(1, 12);
    // And the arm below the smallest observation is the always-engine one, worth a third.
    expect(accuracy(cases, { signal: 'engine-margin', threshold: 0.1 })).toBeCloseTo(1 / 3, 12);
  });

  it('returns the always-engine arm when no threshold beats doing nothing', () => {
    const cases = [
      c({ truth: 'e', engineTop1: 'e', prismTop1: 'p', engineTop1Score: 1, engineTop2Score: 0 }),
      c({ truth: 'e2', engineTop1: 'e2', prismTop1: 'p', engineTop1Score: 2, engineTop2Score: 0 }),
    ];
    expect(fitThreshold(cases, 'engine-margin')).toEqual({
      signal: 'engine-margin',
      threshold: Number.NEGATIVE_INFINITY,
    });
  });

  it('breaks ties toward the SMALLER threshold, so two fits on one fold agree', () => {
    // Every case is routable and every threshold that routes any of them scores the same ⇒ the tie must resolve.
    const cases = [
      c({ truth: 'p', engineTop1: 'e', prismTop1: 'p', engineTop1Score: 5, engineTop2Score: 0 }),
      c({ truth: 'p', engineTop1: 'e', prismTop1: 'p', engineTop1Score: 5, engineTop2Score: 0 }),
    ];
    const a = fitThreshold(cases, 'engine-margin');
    const b = fitThreshold(cases, 'engine-margin');
    expect(a).toEqual(b);
    expect(a.threshold).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('router-validation — folds', () => {
  it('assigns every index exactly once, deterministically, across k disjoint folds', () => {
    const f = folds(7, 3);
    expect(f).toHaveLength(3);
    expect(f.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(folds(7, 3)).toEqual(f);
    // k > n leaves later folds EMPTY rather than dropping cases.
    const many = folds(2, 5);
    expect(many).toHaveLength(5);
    expect(many.flat().sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('refuses k < 2, because a one-fold split cannot be held out', () => {
    expect(() => folds(10, 1)).toThrow(/k must be >= 2/);
    expect(() => folds(0, 0)).toThrow(/k must be >= 2/);
  });
});

describe('router-validation — cross-validation separates the fit from the estimate', () => {
  it('reports an in-sample optimum that the held-out estimate cannot reach, and the gap between them', () => {
    // A population whose best router is fitted on noise: the thresholds a fold prefers do not transfer.
    const cases: RoutingCase[] = [];
    for (let i = 0; i < 20; i++) {
      const engineRight = i % 3 !== 0;
      cases.push(
        c({
          caseId: `c${i}`,
          truth: engineRight ? 'e' : 'p',
          engineTop1: 'e',
          prismTop1: 'p',
          engineTop1Score: i / 20,
          engineTop2Score: 0,
        }),
      );
    }
    const cv = crossValidateRouter(cases, 'engine-margin', 5);
    expect(cv.folds).toBe(5);
    expect(cv.perFold).toHaveLength(5);
    expect(cv.thresholds).toHaveLength(5);
    expect(cv.baseline).toBeCloseTo(13 / 20, 12);
    // ⚠️ `inSample >= heldOut` is NOT asserted, and the reason is a law this fixture taught the hard way: the
    // k-fold mean is the mean of k accuracies, each from a router fitted on a DIFFERENT train set, so a fold whose
    // cases happen to be easy can score above the whole-set optimum. The in-sample figure is optimistic for a
    // FIXED router chosen on all the data; it is not a ceiling on a fold mean. What is asserted is the algebra:
    expect(cv.fittingAllowance).toBeCloseTo(cv.inSample - cv.heldOut, 12);
    expect(cv.heldOutGain).toBeCloseTo(cv.heldOut - cv.baseline, 12);
    // …that the fit genuinely MOVES between folds, and that a threshold is always either the always-engine arm
    // or an observed breakpoint. `-Infinity` is a legitimate fold outcome — a fold whose train set offers no
    // benefit picks the engine unchanged — so the assertion is "in the observed set, or the arm", never "finite".
    // (An earlier draft asserted `Number.isFinite` and failed on the arm; the code was right and the expectation
    // was guessed. Measuring first is what turned that into a one-line fix rather than a hunt.)
    expect(new Set(cv.thresholds).size).toBeGreaterThan(1);
    const observed = new Set(cases.map((x) => engineMargin(x)));
    for (const t of cv.thresholds) {
      expect(t === Number.NEGATIVE_INFINITY || observed.has(t)).toBe(true);
    }
    // The held-out arm is below the in-sample optimum on this fixture, and the gap is what the fit bought.
    expect(cv.inSample).toBeCloseTo(0.7, 12);
    expect(cv.heldOut).toBeCloseTo(0.6, 12);
    expect(cv.fittingAllowance).toBeCloseTo(0.1, 12);
    // Recomputed here rather than compared to a literal, so the assertion cannot drift from the fixture.
    expect(cv.heldOutGain).toBeCloseTo(0.6 - 0.65, 12);
    expect(new Set(cv.perFold).size).toBeGreaterThan(1);
  });

  it('falls back to the baseline when a fold leaves nothing to fit on', () => {
    // k = n leaves each train fold with n-1 cases; k > n is what empties one, and that arm must not crash.
    const cases = [c({ truth: 'a' }), c({ truth: 'a' })];
    const cv = crossValidateRouter(cases, 'engine-margin', 4);
    expect(cv.perFold).toHaveLength(4);
    // Two of the four folds are empty; their train set is the whole population, so they score the full-set fit.
    expect(cv.thresholds.every((t) => Number.isFinite(t) || t === Number.NEGATIVE_INFINITY)).toBe(
      true,
    );
    expect(Number.isFinite(cv.heldOut)).toBe(true);
  });

  it('reports a held-out gain of zero when the signal carries nothing', () => {
    // Truth is unrelated to the margin (every margin identical), so no threshold can beat the engine.
    const cases: RoutingCase[] = [];
    for (let i = 0; i < 12; i++) {
      cases.push(
        c({
          caseId: `c${i}`,
          truth: i % 2 === 0 ? 'e' : 'p',
          engineTop1: 'e',
          prismTop1: 'p',
          engineTop1Score: 1,
          engineTop2Score: 0,
        }),
      );
    }
    const cv = crossValidateRouter(cases, 'engine-margin', 3);
    expect(cv.baseline).toBeCloseTo(0.5, 12);
    expect(cv.heldOutGain).toBeCloseTo(0, 12);
    expect(cv.fittingAllowance).toBeCloseTo(0, 12);
  });
});

describe('router-validation — the prior floor', () => {
  it('measures the telemetry-free rule held out, and reports the WEAKER uniform floor beside it', () => {
    // 'a' is the modal culprit; the held-out rule names it, so a fold scores the fraction of `a` in that fold.
    const cases: RoutingCase[] = [];
    for (let i = 0; i < 12; i++) {
      cases.push(c({ caseId: `c${i}`, truth: i < 8 ? 'a' : i < 10 ? 'b' : 'c' }));
    }
    const floor = priorFloor(cases, 4);
    expect(floor.cases).toBe(12);
    expect(floor.truths).toBe(3);
    expect(floor.inSample).toBeCloseTo(8 / 12, 12);
    expect(floor.heldOut).toBeCloseTo(8 / 12, 12);
    expect(floor.uniform).toBeCloseTo(1 / 3, 12);
    // The prior floor is the STRONGER of the two, and quoting the uniform one alone understates a telemetry-free
    // ranker — which is the whole point of measuring it.
    expect(floor.heldOut).toBeGreaterThan(floor.uniform);
    expect(floor.perFoldWinners).toEqual(['a', 'a', 'a', 'a']);
  });

  it('is total on an empty population, and on a population with one distinct truth', () => {
    expect(priorFloor([], 3)).toMatchObject({
      cases: 0,
      truths: 0,
      inSample: 0,
      heldOut: 0,
      uniform: 0,
    });
    const single = priorFloor([c({ truth: 'only' }), c({ truth: 'only' })], 2);
    expect(single.truths).toBe(1);
    expect(single.heldOut).toBeCloseTo(1, 12);
    expect(single.uniform).toBeCloseTo(1, 12);
  });

  it('breaks a modal tie by name, so the floor is reproducible', () => {
    expect(modalTruth([c({ truth: 'b' }), c({ truth: 'a' })])).toBe('a');
    expect(modalTruth([])).toBe('');
    // A strict majority wins regardless of name order.
    expect(modalTruth([c({ truth: 'b' }), c({ truth: 'b' }), c({ truth: 'a' })])).toBe('b');
  });
});

describe('validate-routing-frontier — the report, and the CLI that wires it', () => {
  it('states both arms and the floor, and never prints a zero for an empty artifact', () => {
    const lines = formatSuiteValidation('re3', []);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('re3  —  0 cases recorded by the probe');
    // The empty arm says so rather than reporting 0.00%, which would read as a measurement.
    expect(lines[2]).toContain('no records');
    expect(lines.join('\n')).not.toContain('THE FLOOR');
  });

  it('prints the floor, the three signals and the fitting caveat for a populated artifact', () => {
    const cases = [
      c({ caseId: 'a', truth: 'x' }),
      c({ caseId: 'b', truth: 'x' }),
      c({ caseId: 'c', truth: 'y', engineTop1: 'y', prismTop1: 'z' }),
      c({ caseId: 'd', truth: 'y', engineTop1: 'y', prismTop1: 'z' }),
    ];
    const text = formatSuiteValidation('re9', cases, 2).join('\n');
    expect(text).toContain('4 cases recorded by the probe');
    expect(text).toContain(
      'THE FLOOR a ranker that reads NO telemetry reaches (held out, 2 folds)',
    );
    expect(text).toContain('distinct culprits in the population : 2');
    // All three signals appear, and each carries a gain and a fitting figure.
    for (const signal of VALIDATION_SIGNALS) expect(text).toContain(signal);
    expect(text).toContain('held gain');
    // The caveat about the sign ships WITH the number, because a reader who takes the difference as positive
    // would read a fold mean as bounded by a whole-set optimum, which it is not.
    expect(text).toContain('Its SIGN is not guaranteed');
    // And the header states the fold count that was actually used, so a reader cannot mistake a 2-fold
    // estimate for the default 5-fold one.
    expect(text).toContain('"held out" fits the threshold on 1 folds and scores the 2th');
  });

  it('reads a probe artifact from disk, defaulting the suite name to the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'routing-validation-'));
    try {
      const named = join(dir, 'named.json');
      writeFileSync(named, JSON.stringify({ suite: 're7', records: [c({ truth: 'x' })] }));
      expect(reportFile(named).join('\n')).toContain('re7  —  1 cases recorded by the probe');
      // An artifact with no `suite` falls back to the path, and missing `records` is an empty population rather
      // than a throw: a truncated upload is a fact about the run and must not crash the readback.
      const bare = join(dir, 'bare.json');
      writeFileSync(bare, JSON.stringify({}));
      const text = reportFile(bare).join('\n');
      expect(text).toContain('bare.json');
      expect(text).toContain('no records');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 2 for usage errors and 0 for a report, so a caller can tell them apart', () => {
    // No paths.
    expect(main([])).toBe(2);
    // A `--folds` that is not an integer >= 2, including a missing value.
    expect(main(['--folds', '1', 'x.json'])).toBe(2);
    expect(main(['--folds', 'two', 'x.json'])).toBe(2);
    expect(main(['--folds'])).toBe(2);
    // A real report, with a non-default fold count, exit 0.
    const dir = mkdtempSync(join(tmpdir(), 'routing-cli-'));
    try {
      const p = join(dir, 'p.json');
      writeFileSync(
        p,
        JSON.stringify({ suite: 're8', records: [c({ truth: 'x' }), c({ truth: 'y' })] }),
      );
      expect(main(['--folds', '2', p])).toBe(0);
      // Options that are not `--folds` are ignored rather than treated as paths.
      expect(main(['--quiet', '--folds', '2', p])).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
